/**
 * Build-time map features: rivers, lakes, cities, sea names, and a real city name for each region.
 * Inputs: Natural Earth 1:50m vector layers (public domain), as GeoJSON from
 *   https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
 *   ne_50m_rivers_lake_centerlines, ne_50m_lakes, ne_50m_populated_places_simple, ne_50m_geography_marine_polys
 * plus src/data/generated/world.json (for the projection and region polygons).
 * Output: src/data/generated/features.json
 *
 *   npx tsx scripts/build-features.ts <dir with the .geojson files>
 */
import fs from 'node:fs';
import path from 'node:path';
import { geoCentroid, geoNaturalEarth1, geoStream } from 'd3-geo';

type Pt = [number, number];
const DIR = process.argv[2] ?? '/tmp/claude-0/ne';
const W = 1000;
const projection = geoNaturalEarth1().fitWidth(W, { type: 'Sphere' });
const read = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;
const r10 = (v: number) => Math.round(v * 10);

/** Project any geometry into lines/rings of map points (d3 handles antimeridian clipping). */
function projectLines(g: GeoJSON.Geometry): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const sink = {
    point(x: number, y: number) { cur.push([x, y]); },
    lineStart() { cur = []; },
    lineEnd() { if (cur.length > 1) out.push(cur); },
    polygonStart() {}, polygonEnd() {}, sphere() {},
  };
  geoStream({ type: 'Feature', geometry: g, properties: {} } as never, projection.stream(sink as never));
  return out;
}

/** Douglas-Peucker simplification in map units. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const flat = (pts: Pt[]) => pts.flatMap(([x, y]) => [r10(x), r10(y)]);

// ---------------------------------------------------------------- rivers
const rivers: { r: number; n: string; pts: number[] }[] = [];
for (const f of read('ne_50m_rivers_lake_centerlines').features) {
  const p = f.properties as { scalerank: number; featurecla: string; name: string };
  if (!/River/i.test(p.featurecla)) continue;
  for (const line of projectLines(f.geometry)) {
    const s = simplify(line, 0.12);
    if (s.length < 2) continue;
    rivers.push({ r: p.scalerank, n: p.name ?? '', pts: flat(s) });
  }
}

// ---------------------------------------------------------------- lakes
const lakes: { r: number; n: string; rings: number[][] }[] = [];
for (const f of read('ne_50m_lakes').features) {
  const p = f.properties as { scalerank: number; name: string };
  const rings = projectLines(f.geometry).map((r) => simplify(r, 0.08)).filter((r) => r.length >= 3);
  if (!rings.length) continue;
  lakes.push({ r: p.scalerank, n: p.name ?? '', rings: rings.map(flat) });
}

// ---------------------------------------------------------------- regions (for city -> region names)
const world = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as { countries: { name: string; provinces: { poly: number[][][]; bbox: number[]; territory?: string }[] }[] };
const provs: { c: string; poly: number[][][]; bbox: number[]; territory?: string }[] = [];
for (const c of world.countries) for (const p of c.provinces) provs.push({ c: c.name, poly: p.poly, bbox: p.bbox, territory: p.territory });
function inRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i] / 10, yi = ring[i + 1] / 10, xj = ring[j] / 10, yj = ring[j + 1] / 10;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function provinceAt(x: number, y: number): number {
  for (let i = 0; i < provs.length; i++) {
    const b = provs[i].bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    for (const poly of provs[i].poly) if (inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h))) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- cities
interface City { n: string; x: number; y: number; pop: number; cap: number; r: number; prov: number }
const cities: City[] = [];
for (const f of read('ne_50m_populated_places_simple').features) {
  const p = f.properties as { name: string; pop_max: number; featurecla: string; scalerank: number; longitude: number; latitude: number; adm0cap: number };
  const xy = projection([p.longitude, p.latitude]);
  if (!xy) continue;
  const cap = /Admin-0 capital/.test(p.featurecla) && !/alt|region/i.test(p.featurecla) ? 2 : p.adm0cap ? 2 : /Admin-1/.test(p.featurecla) ? 1 : 0;
  cities.push({ n: p.name.replace(/\s+/g, ' ').trim(), x: r10(xy[0]), y: r10(xy[1]), pop: p.pop_max, cap, r: p.scalerank, prov: provinceAt(xy[0], xy[1]) });
}
cities.sort((a, b) => b.pop - a.pop);
// each region is named after its capital city if it has one, otherwise its largest city.
// The 1:10m places layer (about 7,000 towns) is used only for naming, so even empty regions get a real place name.
const provCity: Record<number, string> = {};
for (const c of cities) if (c.prov >= 0 && c.cap === 2 && !provCity[c.prov]) provCity[c.prov] = c.n;
const towns: { n: string; pop: number; prov: number }[] = [];
if (fs.existsSync(path.join(DIR, 'ne_10m_populated_places_simple.geojson'))) {
  for (const f of read('ne_10m_populated_places_simple').features) {
    const p = f.properties as { name: string; pop_max: number; longitude: number; latitude: number };
    const xy = projection([p.longitude, p.latitude]);
    if (xy) towns.push({ n: p.name, pop: p.pop_max, prov: provinceAt(xy[0], xy[1]) });
  }
}
const pool = [...cities.map((c) => ({ n: c.n, pop: c.pop, prov: c.prov })), ...towns].sort((a, b) => b.pop - a.pop);
// towns for close zoom: the 1:10m places not already in the main city list, compact [name, x10, y10, prov]
const known = new Set(cities.map((c) => `${c.n}|${c.prov}`));
const townsOut: [string, number, number, number][] = [];
if (fs.existsSync(path.join(DIR, 'ne_10m_populated_places_simple.geojson'))) {
  const raw = read('ne_10m_populated_places_simple').features.map((f) => f.properties as { name: string; pop_max: number; longitude: number; latitude: number })
    .filter((p) => p.pop_max >= 40000).sort((a, b) => b.pop_max - a.pop_max);
  for (const p of raw) {
    const xy = projection([p.longitude, p.latitude]);
    if (!xy) continue;
    const prov = provinceAt(xy[0], xy[1]);
    const n = p.name.replace(/\s+/g, ' ').trim();
    if (prov < 0 || known.has(`${n}|${prov}`)) continue;
    known.add(`${n}|${prov}`);
    townsOut.push([n, r10(xy[0]), r10(xy[1]), prov]);
    if (townsOut.length >= 2600) break;
  }
}
for (const c of pool) if (c.prov >= 0 && !provCity[c.prov] && !provs[c.prov].territory) provCity[c.prov] = c.n;
for (const k of Object.keys(provCity)) provCity[+k] = provCity[+k].replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- seas and oceans
const OCEANS: Record<string, Pt> = {
  'North Atlantic Ocean': [-42, 31], 'South Atlantic Ocean': [-16, -30], 'North Pacific Ocean': [-150, 24], 'South Pacific Ocean': [-120, -32],
  'INDIAN OCEAN': [78, -24], 'Arctic Ocean': [10, 82], 'SOUTHERN OCEAN': [60, -60],
};
const seas: { n: string; x: number; y: number; r: number }[] = [];
for (const f of read('ne_50m_geography_marine_polys').features) {
  const p = f.properties as { name: string; scalerank: number; featurecla: string };
  if (p.scalerank > 3 || !p.name) continue;
  const ll = OCEANS[p.name] ?? (geoCentroid(f as never) as Pt);
  const xy = projection(ll);
  if (!xy || provinceAt(xy[0], xy[1]) >= 0) continue; // never put a sea label on land
  const name = p.name === p.name.toUpperCase() ? p.name.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).replace(/ Of /g, ' of ') : p.name;
  seas.push({ n: name, x: r10(xy[0]), y: r10(xy[1]), r: p.scalerank });
}
// a second label for the vast Pacific, on the Asian side of the map
{ const xy = projection([165, 22])!; seas.push({ n: 'North Pacific Ocean', x: r10(xy[0]), y: r10(xy[1]), r: 0 }); }

const out = {
  source: 'Natural Earth 1:50m rivers, lakes, populated places and marine areas (public domain).',
  rivers, lakes, cities, towns: townsOut, seas, provCity,
};
const file = 'src/data/generated/features.json';
fs.writeFileSync(file, JSON.stringify(out));
console.log(`towns=${townsOut.length} rivers=${rivers.length} lakes=${lakes.length} cities=${cities.length} (in regions: ${cities.filter((c) => c.prov >= 0).length}) seas=${seas.length} named regions=${Object.keys(provCity).length}/${provs.length} size=${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
