import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Germany']);
const U = s.countries[NAME_TO_ID[process.argv[2] ?? 'Ukraine']];
for (let i = 0; i < 104; i++) { tick(s, geo); if (U.mil.wsParts && i % 4 === 0) console.log(i, U.gov, (U.mil.warSupport!*100).toFixed(0), JSON.stringify(Object.fromEntries(Object.entries(U.mil.wsParts).map(([k,v])=>[k,+(v*1000).toFixed(1)]))), 'cas', Math.round(U.mil.casualties), 'pop', (U.eco.pop/1e6).toFixed(1), 'infl', U.eco.inflation.toFixed(2)); }
