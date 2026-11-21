/**
 * Build-time geography pipeline.
 *   Natural Earth admin-0 (via world-atlas, public domain) -> projected polygons
 *   -> per-country provinces (k-means + Voronoi, clipped to the real border)
 *   -> province adjacency graph -> src/data/generated/world.json
 *
 * The runtime game only reads world.json; it never touches the raw topology.
 * Run: npm run build:map
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoArea, geoNaturalEarth1, geoPath, geoStream } from 'd3-geo';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { COUNTRY_BASE, DEPENDENCIES, EXCLUDED_FEATURES } from '../src/data/countryData';

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[]; // [exterior, ...holes]
type MPoly = Poly[];

const require = createRequire(import.meta.url);
// Natural Earth 1:10m borders, simplified along the shared arcs of the topology so that neighbours keep identical
// borders (no slivers, no gaps): far more detail than 1:50m at a similar size once simplified
const topo = require('world-atlas/countries-10m.json');
simplifyTopology(topo, Number(process.env.WO_SIMPLIFY ?? 0.018));
const fc = feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
for (const f of fc.features) f.geometry = fixWinding(f.geometry);

/**
 * On the sphere a ring's winding says which side is inside: simplification can flip a tiny island, and the projection
 * then reads it as "the whole globe except this speck". Drop rings that collapsed, and turn flipped ones around.
 */
function fixWinding(g: GeoJSON.Geometry): GeoJSON.Geometry {
  const polys: GeoJSON.Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const out: GeoJSON.Position[][][] = [];
  for (const poly of polys) {
    const rings: GeoJSON.Position[][] = [];
    let outer = true;
    poly.forEach((ring, i) => {
      const uniq = new Set(ring.map((p) => `${p[0]},${p[1]}`));
      if (uniq.size < 3) { if (i === 0) outer = false; return; }
      if (!outer) return;
      const a = geoArea({ type: 'Polygon', coordinates: [ring] });
      // an outer ring covers less than a hemisphere; a hole, taken alone, more
      const flipped = i === 0 ? a > 2 * Math.PI : a < 2 * Math.PI;
      rings.push(flipped ? [...ring].reverse() : ring);
    });
    if (outer && rings.length) out.push(rings);
  }
  return { type: 'MultiPolygon', coordinates: out };
}

/** Decode the quantized arcs, Douglas-Peucker each one (endpoints kept, so junctions stay shared), store them plain. */
function simplifyTopology(t: { arcs: number[][][]; transform?: { scale: [number, number]; translate: [number, number] } }, tol: number) {
  const tr = t.transform;
  t.arcs = t.arcs.map((arc) => {
    let x = 0, y = 0;
    const pts: Pt[] = arc.map(([dx, dy]) => {
      if (!tr) return [dx, dy];
      x += dx; y += dy;
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
    return dp(pts, tol);
  });
  delete t.transform;
}
function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-12 ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  // a closed ring needs at least four points to survive
  const out = pts.filter((_, i) => keep[i]);
  if (out.length < 4 && pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) return [pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor((2 * pts.length) / 3)], pts[pts.length - 1]];
  return out;
}

const W = 1000;
const projection = geoNaturalEarth1().fitWidth(W, { type: 'Sphere' });
const b = geoPath(projection).bounds({ type: 'Sphere' });
const H = Math.ceil(b[1][1]);

// ---------- geometry helpers ----------
const signedArea = (r: Ring) => {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};
function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInMPoly = (p: Pt, mp: MPoly) => mp.some((poly) => {
  if (!pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
});
const polyAreaNet = (poly: Poly) => poly.reduce((s, r, i) => s + (i === 0 ? 1 : -1) * Math.abs(signedArea(r)), 0);
const mpolyArea = (mp: MPoly) => mp.reduce((s, p) => s + polyAreaNet(p), 0);

function projectFeature(f: GeoJSON.Feature): MPoly {
  const rings: Ring[] = [];
  let cur: Ring = [];
  const sink = {
    point(x: number, y: number) { cur.push([x, y]); },
    lineStart() { cur = []; },
    lineEnd() {
      if (cur.length > 1 && cur[0][0] === cur[cur.length - 1][0] && cur[0][1] === cur[cur.length - 1][1]) cur.pop();
      if (cur.length >= 3) rings.push(cur);
    },
    polygonStart() {}, polygonEnd() {}, sphere() {},
  };
  geoStream(f as never, projection.stream(sink as never));
  // classify exterior vs hole by orientation relative to the largest ring
  if (!rings.length) return [];
  let big = rings[0];
  for (const r of rings) if (Math.abs(signedArea(r)) > Math.abs(signedArea(big))) big = r;
  const extSign = Math.sign(signedArea(big));
  const exts: Ring[] = [];
  const holes: Ring[] = [];
  for (const r of rings) (Math.sign(signedArea(r)) === extSign ? exts : holes).push(r);
  const polys: MPoly = exts.map((e) => [e]);
  for (const h of holes) {
    let best = -1;
    let bestA = Infinity;
    polys.forEach((p, i) => {
      if (pointInRing(h[0], p[0])) {
        const a = Math.abs(signedArea(p[0]));
        if (a < bestA) { bestA = a; best = i; }
      }
    });
    if (best >= 0) polys[best].push(h);
  }
  return polys;
}

const rnd = (v: number) => Math.round(v * 10) / 10;
function cleanMPoly(mp: MPoly): MPoly {
  const out: MPoly = [];
  for (const poly of mp) {
    const rings: Poly = [];
    for (const ring of poly) {
      const r: Ring = [];
      for (const [x, y] of ring) {
        const p: Pt = [rnd(x), rnd(y)];
        const l = r[r.length - 1];
        if (!l || l[0] !== p[0] || l[1] !== p[1]) r.push(p);
      }
      if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
      if (r.length >= 3 && Math.abs(signedArea(r)) > 0.02) rings.push(r);
      else if (rings.length === 0) break; // exterior vanished
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

function centroid(mp: MPoly): Pt {
  let best: Poly | null = null;
  let bestA = -1;
  for (const p of mp) { const a = polyAreaNet(p); if (a > bestA) { bestA = a; best = p; } }
  if (!best) return [0, 0];
  const r = best[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return r[0];
  return [cx / (3 * a), cy / (3 * a)];
}
function bboxOf(mp: MPoly): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of mp) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

// ---------- deterministic rng ----------
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- terrain (game-generated, hand-placed approximate rugged/harsh zones) ----------
// [lonMin, latMin, lonMax, latMax, ruggedness 0..1]
const TERRAIN: [number, number, number, number, number][] = [
  [75, 27, 100, 37, 0.95], [82, 27, 98, 31, 1.0], [68, 33, 75, 38, 0.9], // Himalaya, Tibet, Hindu Kush
  [-80, -55, -66, 10, 0.85], [-122, 30, -104, 55, 0.7], // Andes, Rockies
  [5, 44, 16, 48, 0.85], [40, 41, 48, 44, 0.9], [20, 44, 27, 48, 0.55], // Alps, Caucasus, Carpathians
  [5, 60, 20, 70, 0.6], [-85, 34, -77, 41, 0.45], // Scandes, Appalachians
  [34, 5, 42, 15, 0.8], [-8, 29, 10, 36, 0.6], [44, 30, 56, 38, 0.75], // Ethiopian highlands, Atlas, Zagros
  [58, 52, 62, 68, 0.5], [90, 45, 120, 55, 0.5], [100, 60, 170, 70, 0.55], // Urals, Altai/Sayan, Siberian highlands
  [-5, 36, 2, 38, 0.5], [18, 40, 24, 44, 0.65], [98, 20, 108, 28, 0.7], // Sierra Nevada, Balkans, Yunnan
  [-75, -10, -50, 5, 0.75], [10, -5, 30, 5, 0.7], [95, -5, 120, 8, 0.6], [140, -10, 150, -2, 0.85], // jungles
  [-10, 15, 35, 30, 0.45], [45, 18, 56, 28, 0.4], [118, 38, 105, 45, 0.45], // Sahara, Arabian, Gobi
  [125, 60, 180, 72, 0.6], [-170, 60, -140, 72, 0.7], [-60, 60, -20, 84, 0.8], // Siberia, Alaska, Greenland
];
function terrainAt(lon: number, lat: number): number {
  let t = 0.18;
  for (const [x0, y0, x1, y1, v] of TERRAIN) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    if (lon >= xa && lon <= xb && lat >= y0 && lat <= y1) t = Math.max(t, v);
  }
  return t;
}

// ---------- main ----------
// 1:10m has a few extra pieces: enclaves that belong to the surrounding country in this game, and specks of reef
const MERGE: Record<string, string> = { Baikonur: 'Kazakhstan', 'Cyprus U.N. Buffer Zone': 'Cyprus', Dhekelia: 'Cyprus', Akrotiri: 'Cyprus', 'USNB Guantanamo Bay': 'Cuba' };
const DROP = new Set(['Gibraltar', 'Tuvalu', 'U.S. Minor Outlying Is.', 'Coral Sea Is.', 'Spratly Is.', 'Clipperton I.', 'Bajo Nuevo Bank', 'Serranilla Bank', 'Scarborough Reef']);
const features = fc.features.filter((f) => !EXCLUDED_FEATURES.includes(f.properties.name) && !DROP.has(f.properties.name) && !(f.properties.name in MERGE));
const featByName = new Map(features.map((f) => [f.properties.name, f]));
const projected = new Map<string, MPoly>();
for (const f of features) projected.set(f.properties.name, projectFeature(f));
for (const f of fc.features) {
  const host = MERGE[f.properties.name];
  if (!host || !projected.has(host)) continue;
  projected.set(host, polygonClipping.union(projected.get(host)! as never, projectFeature(f) as never) as unknown as MPoly);
}

// ---------- real towns: provinces are built around them and named after them ----------
interface Town { n: string; x: number; y: number; pop: number; cap: boolean }
const NE_DIR = process.env.WO_NE_DIR ?? '/tmp/claude-0/ne';
const towns: Town[] = [];
{
  const fcT = JSON.parse(fs.readFileSync(path.join(NE_DIR, 'ne_10m_populated_places_simple.geojson'), 'utf8')) as GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; nameascii?: string; pop_max: number; adm0cap: number; featurecla: string }>;
  for (const f of fcT.features) {
    const xy = projection(f.geometry.coordinates as [number, number]);
    if (!xy) continue;
    const n = (f.properties.name || f.properties.nameascii || '').replace(/\s+/g, ' ').trim();
    if (!n) continue;
    towns.push({ n, x: xy[0], y: xy[1], pop: Math.max(1, f.properties.pop_max || 0), cap: f.properties.adm0cap === 1 });
  }
  towns.sort((a, b) => b.pop - a.pop);
}

const missing = COUNTRY_BASE.filter((c) => !featByName.has(c.name)).map((c) => c.name);
if (missing.length) throw new Error('Countries without geometry: ' + missing.join(', '));
const unassigned = features.map((f) => f.properties.name).filter((n) => !COUNTRY_BASE.some((c) => c.name === n) && !(n in DEPENDENCIES));
if (unassigned.length) throw new Error('Features without country/dependency: ' + unassigned.join(', '));

interface OutProvince {
  poly: number[][][]; // polygons -> rings -> flat int*10
  seed: Pt;
  area: number;
  bbox: [number, number, number, number];
  terrain: number;
  coast?: number;
  territory?: string;
  capital?: boolean;
  /** the real town the region is built around */
  name?: string;
  /** people in its towns (thousands) */
  pop?: number;
}
interface OutCountry { name: string; provinces: OutProvince[]; }

/**
 * How many regions a country gets: more for a big country and for a populous one (crowded Europe and India get small
 * regions, empty Siberia and the Sahara big ones). About 2.5 times the old count.
 */
function provinceCount(areaPx: number, popM: number): number {
  return Math.max(1, Math.min(118, Math.round(Math.sqrt(areaPx) / 1.65 + 1.1 * Math.sqrt(Math.max(0, popM)))));
}

function flat(mp: MPoly): number[][][] {
  return mp.map((poly) => poly.map((ring) => ring.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])));
}

// deterministic smooth noise for one border: a few sine waves with phases and frequencies from the border's own hash
function hashStr(t: string): number { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const meanderCache = new Map<string, Pt[]>();
/**
 * A border between two regions that winds like a real one (rivers, ridges, old county lines) instead of a straight
 * Voronoi edge. The wiggle stays inside the two triangles the edge forms with the two region centres, so borders
 * never cross each other; both regions get exactly the same line.
 */
function meander(a: Pt, b: Pt, site: Pt): Pt[] {
  const ka = `${a[0].toFixed(5)},${a[1].toFixed(5)}`, kb = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  const fwd = ka < kb;
  const key = fwd ? `${ka}|${kb}` : `${kb}|${ka}`;
  const hit = meanderCache.get(key);
  if (hit) return fwd ? hit : [...hit].reverse();
  const [p, q] = fwd ? [a, b] : [b, a];
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  let pts: Pt[] = [p, q];
  if (len > 0.5) {
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    // the region centre: how far it sits from the edge, and where along the edge it projects
    const h = Math.abs((site[0] - p[0]) * nx + (site[1] - p[1]) * ny);
    const tm = ((site[0] - p[0]) * ux + (site[1] - p[1]) * uy) / len;
    const room = (t: number) => (0.75 * h * Math.min(t, 1 - t)) / Math.max(1, tm, 1 - tm);
    const r = mulberry(hashStr(key));
    const f1 = 1 + Math.floor(r() * 2), f2 = 2 + Math.floor(r() * 3), f3 = 5 + Math.floor(r() * 4);
    const p1 = r() * 6.283, p2 = r() * 6.283, p3 = r() * 6.283;
    const amp = Math.min(0.22 * len, 6);
    const n = Math.max(3, Math.ceil(len / 0.42));
    pts = [p];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      // a taper keeps the ends fixed at the junctions; the noise is a few smooth waves
      const w = Math.sin(Math.PI * t);
      const v = (0.55 * Math.sin(Math.PI * f1 * t + p1) + 0.3 * Math.sin(Math.PI * f2 * t + p2) + 0.15 * Math.sin(Math.PI * f3 * t + p3)) * w;
      let off = v * amp;
      const lim = room(t);
      if (off > lim) off = lim; else if (off < -lim) off = -lim;
      pts.push([p[0] + dx * t + nx * off, p[1] + dy * t + ny * off]);
    }
    pts.push(q);
  }
  meanderCache.set(key, pts);
  return fwd ? pts : [...pts].reverse();
}

interface Part { mp: MPoly; seed: Pt; name?: string; pop?: number }
/** people living in the towns of a region (Natural Earth populated places, thousands) */
function popIn(mp: MPoly, list: Town[]): number {
  const [x0, y0, x1, y1] = bboxOf(mp);
  let t = 0;
  for (const tw of list) if (tw.x >= x0 && tw.x <= x1 && tw.y >= y0 && tw.y <= y1 && pointInMPoly([tw.x, tw.y], mp)) t += tw.pop;
  return Math.round(t / 1000);
}
function splitCountry(name: string, mp: MPoly, capitalPx: Pt | null, popM: number, rng: () => number): Part[] {
  const area = mpolyArea(mp);
  const k = provinceCount(area, popM);
  const [x0, y0, x1, y1] = bboxOf(mp);
  // the country's towns, biggest first
  const mine = towns.filter((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1 && pointInMPoly([t.x, t.y], mp));
  if (k <= 1 || mp.length === 0) {
    const cap = mine.find((t) => t.cap) ?? mine[0];
    return [{ mp, seed: centroid(mp), name: k <= 1 ? undefined : cap?.n, pop: popIn(mp, mine) }];
  }
  const step = Math.max(0.25, Math.min(3, Math.sqrt(area / 1600)));
  const pts: Pt[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) if (pointInMPoly([x, y], mp)) pts.push([x, y]);
  }
  if (pts.length < k * 3) {
    const cap = mine.find((t) => t.cap) ?? mine[0];
    return [{ mp, seed: centroid(mp), name: cap?.n, pop: popIn(mp, mine) }];
  }
  // seeds: the capital, then the largest towns that are not crowded together, then the emptiest land
  const spacing = 0.62 * Math.sqrt(area / k);
  const centers: Pt[] = [];
  const anchor: (Town | null)[] = [];
  const capT = mine.find((t) => t.cap) ?? (capitalPx ? mine.find((t) => Math.hypot(t.x - capitalPx[0], t.y - capitalPx[1]) < 2) : undefined);
  const order = capT ? [capT, ...mine.filter((t) => t !== capT)] : mine;
  for (const t of order) {
    if (centers.length >= k) break;
    if (centers.some((c) => Math.hypot(c[0] - t.x, c[1] - t.y) < spacing)) continue;
    centers.push([t.x, t.y]); anchor.push(t);
  }
  if (!centers.length) { const c0 = capitalPx ?? pts[Math.floor(rng() * pts.length)]; centers.push(c0); anchor.push(null); }
  const dmin = new Float64Array(pts.length).fill(Infinity);
  for (const c of centers) for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - c[0]) ** 2 + (pts[i][1] - c[1]) ** 2; if (d < dmin[i]) dmin[i] = d; }
  while (centers.length < k) {
    let bi = 0, bd = -1;
    for (let i = 0; i < pts.length; i++) if (dmin[i] > bd) { bd = dmin[i]; bi = i; }
    const c = pts[bi];
    centers.push(c); anchor.push(null);
    for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - c[0]) ** 2 + (pts[i][1] - c[1]) ** 2; if (d < dmin[i]) dmin[i] = d; }
  }
  // relax toward even sizes, but towns hold their regions' centres near them
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 10; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bj = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = (pts[i][0] - centers[j][0]) ** 2 + (pts[i][1] - centers[j][1]) ** 2;
        if (d < bd) { bd = d; bj = j; }
      }
      assign[i] = bj;
    }
    const sx = new Float64Array(k), sy = new Float64Array(k), n = new Int32Array(k);
    for (let i = 0; i < pts.length; i++) { sx[assign[i]] += pts[i][0]; sy[assign[i]] += pts[i][1]; n[assign[i]]++; }
    for (let j = 0; j < k; j++) {
      if (!n[j]) continue;
      const m: Pt = [sx[j] / n[j], sy[j] / n[j]];
      const t = anchor[j];
      centers[j] = t ? [t.x * 0.55 + m[0] * 0.45, t.y * 0.55 + m[1] * 0.45] : m;
    }
  }
  const pad = 20;
  const B = [x0 - pad, y0 - pad, x1 + pad, y1 + pad] as const;
  const del = Delaunay.from(centers);
  const vor = del.voronoi([...B]);
  const onBox = (p: Pt) => Math.abs(p[0] - B[0]) < 1e-6 || Math.abs(p[0] - B[2]) < 1e-6 || Math.abs(p[1] - B[1]) < 1e-6 || Math.abs(p[1] - B[3]) < 1e-6;
  const out: Part[] = [];
  for (let j = 0; j < k; j++) {
    const cell = vor.cellPolygon(j) as Pt[] | null;
    if (!cell) continue;
    // wind every inner border
    const ring: Pt[] = [];
    for (let i = 0; i + 1 < cell.length; i++) {
      const a = cell[i], b = cell[i + 1];
      const seg = onBox(a) && onBox(b) ? [a, b] : meander(a, b, centers[j]);
      for (let m = 0; m < seg.length - 1; m++) ring.push(seg[m]);
    }
    ring.push(ring[0]);
    let clipped: MPoly = [];
    try {
      clipped = polygonClipping.intersection([ring] as never, mp as never) as unknown as MPoly;
    } catch (e) {
      console.warn('clip failed', name, j, (e as Error).message);
    }
    clipped = cleanMPoly(clipped);
    if (!clipped.length || mpolyArea(clipped) < 0.12) continue;
    // name: its anchor town, else the biggest town inside it
    let nm = anchor[j]?.n;
    if (!nm || !pointInMPoly([anchor[j]!.x, anchor[j]!.y], clipped)) nm = mine.find((t) => pointInMPoly([t.x, t.y], clipped))?.n ?? nm;
    out.push({ mp: clipped, seed: centroid(clipped), name: nm, pop: popIn(clipped, mine) });
  }
  return out.length ? out : [{ mp, seed: centroid(mp) }];
}

const T0 = Date.now();
const countriesOut: OutCountry[] = [];
const rng = mulberry(20240101);
for (const base of COUNTRY_BASE) {
  let own = cleanMPoly(projected.get(base.name)!);
  if (!own.length) {
    // microstate (Monaco, Vatican ...): too small to survive rounding, so draw a tiny marker at its true location
    const [bx, by] = (projection([base.capital![1], base.capital![0]]) as Pt | null) ?? [0, 0];
    const h = 0.45;
    own = [[[[bx - h, by], [bx, by - h], [bx + h, by], [bx, by + h]]]];
  }
  const capPx = projection([base.capital![1], base.capital![0]]) as Pt | null;
  const tc = Date.now();
  const parts = splitCountry(base.name, own, capPx, base.popM, rng);
  if (Date.now() - tc > 3000) console.log(`  ${base.name}: ${parts.length} regions in ${((Date.now() - tc) / 1000).toFixed(1)}s`);
  const used = new Map<string, number>();
  const provinces: OutProvince[] = parts.map((p) => {
    const [lon, lat] = projection.invert!(p.seed) ?? [0, 0];
    // two regions named after the same town (a big city split in two) get "Greater" and "Outer"
    let name = p.name;
    if (name) { const n = (used.get(name) ?? 0) + 1; used.set(name, n); if (n > 1) name = `${name} ${['', 'Outer', 'Rural', 'Upper', 'Lower'][n - 1] ?? n}`.trim(); }
    return { poly: flat(p.mp), seed: [rnd(p.seed[0]), rnd(p.seed[1])], area: Math.round(mpolyArea(p.mp) * 100) / 100, bbox: bboxOf(p.mp).map(rnd) as never, terrain: terrainAt(lon, lat), ...(name ? { name } : {}), ...(p.pop ? { pop: p.pop } : {}) };
  });
  // capital province = nearest seed to capital
  if (capPx) {
    let bi = 0, bd = Infinity;
    provinces.forEach((p, i) => { const d = (p.seed[0] - capPx[0]) ** 2 + (p.seed[1] - capPx[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
    provinces[bi].capital = true;
  }
  countriesOut.push({ name: base.name, provinces });
}
for (const [dep, parent] of Object.entries(DEPENDENCIES)) {
  const mp = cleanMPoly(projected.get(dep)!);
  if (!mp.length) { console.warn('dependency vanished after cleaning:', dep); continue; }
  const c = countriesOut.find((x) => x.name === parent)!;
  const s = centroid(mp);
  const [lon, lat] = projection.invert!(s) ?? [0, 0];
  c.provinces.push({ poly: flat(mp), seed: [rnd(s[0]), rnd(s[1])], area: rnd(mpolyArea(mp)), bbox: bboxOf(mp).map(rnd) as never, terrain: terrainAt(lon, lat), territory: dep });
}

console.log(`regions built in ${((Date.now() - T0) / 1000).toFixed(0)}s`);
// ---------- adjacency via shared boundary segments ----------
// Most shared borders are identical segment for segment (same arcs, same rounding), so they are matched exactly by
// key; only what is left (coasts, and border segments split where a region edge meets them) is tested geometrically.
interface Seg { id: number; p: number; ax: number; ay: number; bx: number; by: number; best: number; lab: number; }
let segCounter = 0;
const flatProvs: { c: number; prov: OutProvince }[] = [];
countriesOut.forEach((c, ci) => c.provinces.forEach((prov) => flatProvs.push({ c: ci, prov })));
const CELL = 4;
const segsOf: Seg[][] = flatProvs.map(() => []);
const N = flatProvs.length;
const adjLen = new Map<number, number>();
const addAdj = (s: Seg, t: Seg, ov: number) => {
  if (ov > s.best) { s.best = ov; s.lab = t.p; }
  if (ov > t.best) { t.best = ov; t.lab = s.p; }
  const a = Math.min(s.p, t.p), c = Math.max(s.p, t.p);
  adjLen.set(a * N + c, (adjLen.get(a * N + c) ?? 0) + ov);
};
const exact = new Map<string, Seg>();
const loose: Seg[] = [];
flatProvs.forEach(({ prov }, pi) => {
  for (const poly of prov.poly) for (const ring of poly) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const s: Seg = { id: segCounter++, p: pi, ax: ring[i * 2] / 10, ay: ring[i * 2 + 1] / 10, bx: ring[j * 2] / 10, by: ring[j * 2 + 1] / 10, best: 0, lab: -1 };
      segsOf[pi].push(s);
      const k1 = `${ring[i * 2]},${ring[i * 2 + 1]},${ring[j * 2]},${ring[j * 2 + 1]}`, k2 = `${ring[j * 2]},${ring[j * 2 + 1]},${ring[i * 2]},${ring[i * 2 + 1]}`;
      const t = exact.get(k2);
      if (t && t.p !== pi && t.lab < 0) { addAdj(s, t, Math.hypot(s.bx - s.ax, s.by - s.ay)); exact.delete(k2); }
      else exact.set(k1, s);
    }
  }
});
for (const s of exact.values()) if (s.lab < 0) loose.push(s);
const grid = new Map<number, Seg[]>();
const key = (cx: number, cy: number) => cx * 4096 + cy;
for (const s of loose) {
  const cx0 = Math.floor(Math.min(s.ax, s.bx) / CELL), cx1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
  const cy0 = Math.floor(Math.min(s.ay, s.by) / CELL), cy1 = Math.floor(Math.max(s.ay, s.by) / CELL);
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const k = key(cx, cy);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(s);
  }
}
const done = new Set<string>();
for (const segs of grid.values()) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j];
      if (t.p === s.p) continue;
      const d1 = Math.abs((t.ax - s.ax) * uy - (t.ay - s.ay) * ux);
      const d2 = Math.abs((t.bx - s.ax) * uy - (t.by - s.ay) * ux);
      if (d1 > 0.22 || d2 > 0.22) continue;
      const t1 = (t.ax - s.ax) * ux + (t.ay - s.ay) * uy;
      const t2 = (t.bx - s.ax) * ux + (t.by - s.ay) * uy;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo <= 0.05) continue;
      const pk = s.id < t.id ? `${s.id}|${t.id}` : `${t.id}|${s.id}`;
      if (done.has(pk)) continue;
      done.add(pk);
      addAdj(s, t, hi - lo);
    }
  }
}
const adjacency: [number, number][] = [];
for (const [k, l] of adjLen) if (l > 0.3) adjacency.push([Math.floor(k / N), k % N]);
adjacency.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// coastline ratio per province = 1 - (border shared with other provinces / perimeter)
const perim = new Float64Array(N);
const shared = new Float64Array(N);
flatProvs.forEach(({ prov }, pi) => {
  for (const poly of prov.poly) for (const ring of poly) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      perim[pi] += Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]) / 10;
    }
  }
});
for (const [k, l] of adjLen) { if (l <= 0.3) continue; shared[Math.floor(k / N)] += l; shared[k % N] += l; }
flatProvs.forEach(({ prov }, pi) => { prov.coast = Math.round(Math.max(0, Math.min(1, 1 - shared[pi] / Math.max(perim[pi], 0.01))) * 100) / 100; });

// ---- edge groups: per province, runs of boundary segments grouped by neighbour (-1 = coast) ----
interface Edge { n: number; pts: number[] }
const edgesOut: Edge[][] = flatProvs.map(() => []);
flatProvs.forEach(({ prov }, pi) => {
  const segs = segsOf[pi];
  let k = 0;
  for (const poly of prov.poly) for (const ring of poly) {
    const n = ring.length / 2;
    let cur: Edge | null = null;
    for (let i = 0; i < n; i++, k++) {
      const sg = segs[k];
      const lab = sg.lab >= 0 && sg.best > 0.05 ? sg.lab : -1;
      const j = (i + 1) % n;
      if (cur && cur.n === lab) cur.pts.push(ring[j * 2], ring[j * 2 + 1]);
      else {
        if (cur) edgesOut[pi].push(cur);
        cur = { n: lab, pts: [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]] };
      }
    }
    if (cur) edgesOut[pi].push(cur);
  }
});
// keep each shared border once (from the lower-numbered side) when the other side also knows about it
flatProvs.forEach(({ prov }, pi) => {
  (prov as unknown as { edges: Edge[] }).edges = edgesOut[pi].filter((e) => !(e.n >= 0 && pi > e.n && edgesOut[e.n].some((x) => x.n === pi)));
});

const out = {
  version: 1,
  source: 'Natural Earth admin-0 countries 1:10m via world-atlas@2.0.2, simplified (public domain). Regions are game-generated around real towns (Natural Earth populated places).',
  width: W,
  height: H,
  countries: countriesOut,
  adjacency,
};
const dir = path.resolve('src/data/generated');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'world.json');
fs.writeFileSync(file, JSON.stringify(out));
const nProv = flatProvs.length;
console.log(`countries=${countriesOut.length} provinces=${nProv} adjacency=${adjacency.length} size=${(fs.statSync(file).size / 1024).toFixed(0)}KB map=${W}x${H}`);
const top = [...countriesOut].sort((a, b) => b.provinces.length - a.provinces.length).slice(0, 12);
console.log(top.map((c) => `${c.name}:${c.provinces.length}`).join(', '));
