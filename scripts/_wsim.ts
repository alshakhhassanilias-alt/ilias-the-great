import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { supplyNet } from '../src/sim/supply';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS, seed: Number(process.env.SEED ?? 20240101) }, NAME_TO_ID['Germany']);
const t0 = Date.now(); let maxMs = 0; let conq = 0, enc = 0, prot = 0, wars = 0;
const sups: number[] = []; const wsv: number[] = [];
for (let i = 0; i < 520; i++) {
  const a = Date.now(); tick(s, geo); maxMs = Math.max(maxMs, Date.now() - a);
  for (let k = s.log.length - 1; k >= 0 && s.log[k].tick === s.tick; k--) { const t = s.log[k].text; if (t.startsWith('Battle of')) conq++; if (t.includes('ENCIRCLED')) { enc++; if (enc < 6) console.log('  ', t); } if (t.includes('anti-war') || t.includes('Anti-war')) { prot++; if (prot < 5) console.log('  ', t); } if (t.includes('declared war')) wars++; }
  for (const w of s.wars) for (const f of w.fronts) if (f.sup !== undefined) sups.push(f.sup);
  if (i % 52 === 51) { const at = s.countries.filter(c => c.alive && s.wars.some(w => w.attackers.includes(c.id) || w.defenders.includes(c.id))); for (const c of at) wsv.push(c.mil.warSupport ?? 0.6);
    console.log(`y${(i+1)/52} wars ${s.wars.length} atWar ${at.length} ws ${at.slice(0,6).map(c=>c.name.slice(0,8)+':'+((c.mil.warSupport??0)*100).toFixed(0)).join(' ')}`); }
}
sups.sort((a,b)=>a-b); wsv.sort((a,b)=>a-b);
const q = (arr:number[], f:number) => arr[Math.floor(arr.length*f)]?.toFixed(2);
console.log('declared', wars, 'conquests', conq, 'encirclements', enc, 'protests', prot, 'avg tick ms', ((Date.now()-t0)/520).toFixed(1), 'max', maxMs);
console.log('front supply p10/p50/p90', q(sups,0.1), q(sups,0.5), q(sups,0.9), 'ws p10/p50/p90', q(wsv,0.1), q(wsv,0.5), q(wsv,0.9));
console.log('alive', s.countries.filter(c=>c.alive).length);
