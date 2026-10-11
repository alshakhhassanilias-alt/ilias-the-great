import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const P = geo.provinces as any[];
console.log(Object.keys(P[0]));
const adj2: Set<number>[] = P.map(() => new Set());
for (let p = 0; p < P.length; p++) for (const e of (P[p].edges ?? [])) if (e.n >= 0) { adj2[p].add(e.n); adj2[e.n].add(p); }
let missing = 0; for (let p = 0; p < P.length; p++) for (const q of adj2[p]) if (!geo.adj[p].includes(q)) missing++;
console.log('edge-neighbours not in adj', missing/2, 'adj pairs', geo.adj.reduce((t,a)=>t+a.length,0)/2);
const byC = new Map<number, number[]>(); P.forEach((p, i) => { const a = byC.get(p.country0) ?? []; a.push(i); byC.set(p.country0, a); });
let multi = 0;
for (const [c, ps] of byC) { const set = new Set(ps); const seen = new Set<number>(); let comps = 0; for (const s0 of ps) { if (seen.has(s0)) continue; comps++; const st=[s0]; seen.add(s0); while (st.length) { const p = st.pop()!; for (const q of geo.adj[p]) if (set.has(q) && !seen.has(q)) { seen.add(q); st.push(q);} } } if (comps > 1) { multi++; if (multi < 15) console.log(c, ps.length, 'components', comps, P[ps[0]].name); } }
console.log('countries with >1 component', multi);
