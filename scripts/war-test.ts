/** Scenario harness: npx tsx scripts/war-test.ts Attacker Defender [years] [allies=0|1] */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { declareWar } from '../src/sim/war';
const [A, D, Y = '3', AL = '0'] = process.argv.slice(2);
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
const s = createGame(geo, { ...DEFAULT_SETTINGS, defensiveAlliances: AL === '1' }, NAME_TO_ID[A]);
const a = s.countries[NAME_TO_ID[A]], d = s.countries[NAME_TO_ID[D]];
s.tick = 60; // skip AI grace period
declareWar(s, geo, a.id, d.id);
const row = () => `t+${String(s.tick - 60).padStart(3)}w  ${A}: ${a.provinces.length}p troops ${(a.mil.troops / 1e3).toFixed(0)}k exh ${a.mil.exhaustion.toFixed(2)} | ${D}: ${d.alive ? d.provinces.length : 0}p troops ${(d.mil.troops / 1e3).toFixed(0)}k exh ${d.mil.exhaustion.toFixed(2)} | wars ${s.wars.length} fronts ${s.wars[0]?.fronts.length ?? 0}`;
console.log(row());
for (let i = 0; i < Number(Y) * 52; i++) {
  tick(s, geo);
  if (i % 13 === 12) console.log(row());
  if (!s.wars.length) { console.log('WAR OVER at +' + (s.tick - 60) + 'w'); break; }
}
console.log(s.log.filter((l) => l.kind === 'peace' || l.kind === 'territory').slice(-6).map((l) => '  ' + l.text).join('\n'));
