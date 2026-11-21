import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { stepEconomies } from '../src/sim/economy';
import { stepWars } from '../src/sim/war';
import { stepAI } from '../src/sim/ai';
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Germany']);
const T = { eco: 0, war: 0, ai: 0 };
for (let i = 0; i < 200; i++) {
  s.tick++;
  let a = performance.now(); stepEconomies(s, geo); T.eco += performance.now() - a;
  a = performance.now(); stepWars(s, geo); T.war += performance.now() - a;
  a = performance.now(); stepAI(s, geo); T.ai += performance.now() - a;
}
console.log('avg ms/tick', Object.fromEntries(Object.entries(T).map(([k, v]) => [k, (v / 200).toFixed(2)])));
