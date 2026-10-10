/** Which decision events fire, and how often? npx tsx scripts/event-hist.ts [years] [country] */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { resolveEvent, eventById } from '../src/sim/events';
const years = Number(process.argv[2] ?? 5);
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, DEFAULT_SETTINGS, NAME_TO_ID[process.argv[3] ?? 'Poland']);
const hist: Record<string, number> = {}; const seq: string[] = [];
for (let i = 0; i < years * 52; i++) {
  tick(s, geo);
  const pe = (s as any).inbox[0];
  if (pe) { hist[pe.id] = (hist[pe.id] ?? 0) + 1; seq.push(pe.id + '@' + s.tick); resolveEvent(s, geo, Math.min(1, eventById(pe.id).options.length - 1), pe.uid); }
}
console.log('total', seq.length, 'per year', (seq.length / years).toFixed(1));
console.log(Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join('  '));
console.log(seq.slice(0, 40).join(' '));
