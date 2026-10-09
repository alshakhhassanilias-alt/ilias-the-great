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
import { geoNaturalEarth1, geoPath, geoStream } from 'd3-geo';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { COUNTRY_BASE, DEPENDENCIES, EXCLUDED_FEATURES } from '../src/data/countryData';

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[]; // [exterior, ...holes]
type MPoly = Poly[];

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');
const fc = feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;

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
const features = fc.features.filter((f) => !EXCLUDED_FEATURES.includes(f.properties.name));
const featByName = new Map(features.map((f) => [f.properties.name, f]));
const projected = new Map<string, MPoly>();
for (const f of features) projected.set(f.properties.name, projectFeature(f));

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
}
interface OutCountry { name: string; provinces: OutProvince[]; }

function provinceCount(areaPx: number): number {
  return Math.max(1, Math.min(22, Math.round(Math.sqrt(areaPx) / 5.2)));
}

function flat(mp: MPoly): number[][][] {
  return mp.map((poly) => poly.map((ring) => ring.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)])));
}

function splitCountry(name: string, mp: MPoly, capitalPx: Pt | null, rng: () => number): { mp: MPoly; seed: Pt }[] {
  const area = mpolyArea(mp);
  const k = provinceCount(area);
  if (k <= 1 || mp.length === 0) return [{ mp, seed: centroid(mp) }];
  const [x0, y0, x1, y1] = bboxOf(mp);
  const step = Math.max(0.5, Math.min(3, Math.sqrt(area / 900)));
  const pts: Pt[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) if (pointInMPoly([x, y], mp)) pts.push([x, y]);
  }
  if (pts.length < k * 3) return [{ mp, seed: centroid(mp) }];
  // farthest-first init starting from the point nearest the capital (so province 0 holds the capital)
  const startPt = capitalPx ?? pts[Math.floor(rng() * pts.length)];
  let first = pts[0], fd = Infinity;
  for (const p of pts) { const d = (p[0] - startPt[0]) ** 2 + (p[1] - startPt[1]) ** 2; if (d < fd) { fd = d; first = p; } }
  const centers: Pt[] = [first];
  const dmin = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let bi = 0, bd = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - c[0]) ** 2 + (pts[i][1] - c[1]) ** 2;
      if (d < dmin[i]) dmin[i] = d;
      if (dmin[i] > bd) { bd = dmin[i]; bi = i; }
    }
    centers.push(pts[bi]);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 18; it++) {
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
    for (let j = 0; j < k; j++) if (n[j]) centers[j] = [sx[j] / n[j], sy[j] / n[j]];
  }
  const pad = 20;
  const del = Delaunay.from(centers);
  const vor = del.voronoi([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
  const out: { mp: MPoly; seed: Pt }[] = [];
  for (let j = 0; j < k; j++) {
    const cell = vor.cellPolygon(j);
    if (!cell) continue;
    let clipped: MPoly = [];
    try {
      clipped = polygonClipping.intersection([cell as Pt[]] as never, mp as never) as unknown as MPoly;
    } catch (e) {
      console.warn('clip failed', name, j, (e as Error).message);
    }
    clipped = cleanMPoly(clipped);
    if (!clipped.length || mpolyArea(clipped) < 0.4) continue;
    out.push({ mp: clipped, seed: centroid(clipped) });
  }
  return out.length ? out : [{ mp, seed: centroid(mp) }];
}

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
  const parts = splitCountry(base.name, own, capPx, rng);
  const provinces: OutProvince[] = parts.map((p) => {
    const [lon, lat] = projection.invert!(p.seed) ?? [0, 0];
    return { poly: flat(p.mp), seed: [rnd(p.seed[0]), rnd(p.seed[1])], area: rnd(mpolyArea(p.mp)), bbox: bboxOf(p.mp).map(rnd) as never, terrain: terrainAt(lon, lat) };
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

// ---------- adjacency via shared boundary segments ----------
interface Seg { id: number; p: number; ax: number; ay: number; bx: number; by: number; }
let segCounter = 0;
const seenPairs = new Set<number>();
const flatProvs: { c: number; prov: OutProvince }[] = [];
countriesOut.forEach((c, ci) => c.provinces.forEach((prov) => flatProvs.push({ c: ci, prov })));
const CELL = 6;
const grid = new Map<number, Seg[]>();
const key = (cx: number, cy: number) => cx * 4096 + cy;
flatProvs.forEach(({ prov }, pi) => {
  for (const poly of prov.poly) for (const ring of poly) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2] / 10, ay = ring[i * 2 + 1] / 10;
      const j = (i + 1) % n;
      const bx = ring[j * 2] / 10, by = ring[j * 2 + 1] / 10;
      const s: Seg = { id: segCounter++, p: pi, ax, ay, bx, by };
      const cx0 = Math.floor(Math.min(ax, bx) / CELL), cx1 = Math.floor(Math.max(ax, bx) / CELL);
      const cy0 = Math.floor(Math.min(ay, by) / CELL), cy1 = Math.floor(Math.max(ay, by) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(s);
      }
    }
  }
});
const adjLen = new Map<number, number>();
const N = flatProvs.length;
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
      const pk = Math.min(s.id, t.id) * 4000000 + Math.max(s.id, t.id);
      if (seenPairs.has(pk)) continue;
      seenPairs.add(pk);
      const d1 = Math.abs((t.ax - s.ax) * uy - (t.ay - s.ay) * ux);
      const d2 = Math.abs((t.bx - s.ax) * uy - (t.by - s.ay) * ux);
      if (d1 > 0.22 || d2 > 0.22) continue;
      const t1 = (t.ax - s.ax) * ux + (t.ay - s.ay) * uy;
      const t2 = (t.bx - s.ax) * ux + (t.by - s.ay) * uy;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo > 0.15) {
        const a = Math.min(s.p, t.p), c = Math.max(s.p, t.p);
        const k = a * N + c;
        adjLen.set(k, (adjLen.get(k) ?? 0) + (hi - lo));
      }
    }
  }
}
const adjacency: [number, number][] = [];
for (const [k, l] of adjLen) if (l > 0.5) adjacency.push([Math.floor(k / N), k % N]);
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
for (const [k, l] of adjLen) { if (l <= 0.5) continue; shared[Math.floor(k / N)] += l; shared[k % N] += l; }
flatProvs.forEach(({ prov }, pi) => { prov.coast = Math.round(Math.max(0, Math.min(1, 1 - shared[pi] / Math.max(perim[pi], 0.01))) * 100) / 100; });

const out = {
  version: 1,
  source: 'Natural Earth admin-0 countries 1:50m via world-atlas@2.0.2 (public domain). Provinces are game-generated subdivisions.',
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
