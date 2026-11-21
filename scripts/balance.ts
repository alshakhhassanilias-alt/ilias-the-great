/** Balance report over many seeds: wars, eliminations, banners, economy health. npx tsx scripts/balance.ts [years] [seeds] */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
const years = Number(process.argv[2] ?? 15), seeds = Number(process.argv[3] ?? 4);
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
const names = ['Germany', 'Brazil', 'Japan', 'Nigeria', 'Poland', 'India'];
const agg = Number(process.env.AGG ?? DEFAULT_SETTINGS.aggression);
const tot = { wars: 0, elim: 0, big: 0, bigMine: 0, inbox: 0, crashes: 0, lowStab: 0, caps: 0, banners: 0 };
for (let k = 0; k < seeds; k++) {
  const s = createGame(geo, { ...DEFAULT_SETTINGS, aggression: agg, seed: 1000 + k * 77 } as any, NAME_TO_ID[names[k % names.length]]);
  const alive0 = s.countries.filter((c) => c.alive).length;
  let wars = 0, big = 0, inbox = 0;
  for (let i = 0; i < years * 52; i++) {
    tick(s, geo);
    for (let j = s.log.length - 1; j >= 0 && s.log[j].tick === s.tick; j--) { const e = s.log[j]; if (/declared war/.test(e.text)) wars++; if (e.big) big++; }
    if (s.inbox.length) inbox++;
  }
  const alive = s.countries.filter((c) => c.alive);
  const low = alive.filter((c) => c.eco.stability < 15).length;
  const gdp = alive.reduce((t, c) => t + c.eco.gdp, 0);
  console.log(`seed ${k} ${names[k % names.length]}: wars ${(wars / years).toFixed(1)}/yr  eliminated ${alive0 - alive.length}  banners ${(big / years).toFixed(1)}/yr  stab<15: ${low}  world GDP x${(gdp / s.countries.reduce((t, c) => t + c.baseline.gdp, 0)).toFixed(2)}  wars active ${s.wars.length}`);
  tot.wars += wars / years; tot.elim += alive0 - alive.length; tot.big += big / years; tot.lowStab += low; void inbox;
}
console.log(`AVG wars/yr ${(tot.wars / seeds).toFixed(1)}, eliminated/15y ${(tot.elim / seeds).toFixed(1)}, banners/yr ${(tot.big / seeds).toFixed(1)}`);
