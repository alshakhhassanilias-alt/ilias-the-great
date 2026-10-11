import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { declareWar } from '../src/sim/war';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Poland']);
const P = s.countries[NAME_TO_ID['Poland']];
declareWar(s, geo, P.id, NAME_TO_ID['Belarus']);
console.log('war', s.wars.map(w => [w.attackers.map(a=>s.countries[a].name), w.defenders.map(a=>s.countries[a].name)]));
for (let i = 0; i < 60; i++) { tick(s, geo); if (i % 10 === 9) console.log(i, 'Poland provs', P.provinces.length, 'Belarus', s.countries[NAME_TO_ID['Belarus']].provinces.length, 'Russia', s.countries[NAME_TO_ID['Russia']].provinces.length, 'ws', (P.mil.warSupport ?? 0).toFixed(2), 'troops', Math.round(P.mil.troops)); }
