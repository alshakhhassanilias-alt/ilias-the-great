import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID['Brazil']);
const seen = new Set<string>();
for (let i = 0; i < 52 * 6; i++) { tick(s, geo); for (const o of s.offers) seen.add(`${o.id}:${s.countries[o.from].name}:${o.kind}`); }
console.log('distinct offers to player over 6 years:', seen.size);
console.log([...seen].slice(0, 8).join('\n'));
