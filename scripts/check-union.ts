import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
const w = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8'));
type Pt = [number, number];
const toM = (poly: number[][][]) => poly.map((rings) => rings.map((flat) => { const r: Pt[] = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10]); return r; }));
let bad = 0;
for (const c of w.countries) {
  if (c.provinces.length < 2) continue;
  const parts = c.provinces.map((p: { poly: number[][][] }) => toM(p.poly));
  try {
    const t = performance.now();
    const u = polygonClipping.union(parts[0], ...parts.slice(1));
    const ms = performance.now() - t;
    if (!u.length || u.some((p) => !p[0] || !p[0].length)) { bad++; console.log('EMPTY', c.name, c.provinces.length); }
    else if (ms > 150) console.log('slow', c.name, c.provinces.length, ms.toFixed(0) + 'ms');
  } catch (e) { bad++; console.log('ERR', c.name, (e as Error).message.slice(0, 80)); }
}
console.log('bad', bad);
