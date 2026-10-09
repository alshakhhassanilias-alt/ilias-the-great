import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { declareWar, attackCandidates } from '../src/sim/war';
import { landPower, quality, techMult, equipRatio } from '../src/sim/military';
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
const s = createGame(geo, { ...DEFAULT_SETTINGS, defensiveAlliances: false }, NAME_TO_ID['Russia']);
const a = s.countries[NAME_TO_ID['Russia']], d = s.countries[NAME_TO_ID['Ukraine']];
s.tick = 60; declareWar(s, geo, a.id, d.id);
console.log('RU quality', quality(a.mil).toFixed(2), 'tech', techMult(a.mil).toFixed(2), 'eqRatio', equipRatio(a.mil).toFixed(2), 'readiness', a.mil.readiness.toFixed(2));
console.log('UA quality', quality(d.mil).toFixed(2), 'tech', techMult(d.mil).toFixed(2), 'eqRatio', equipRatio(d.mil).toFixed(2), 'readiness', d.mil.readiness.toFixed(2));
const w = s.wars[0];
console.log('cands', attackCandidates(s, geo, a, w).map((c) => `${c.prov}:${c.supply.toFixed(2)}:${c.score.toFixed(2)}`));
for (let i = 0; i < 6; i++) { tick(s, geo); console.log(i, JSON.stringify(w.fronts.map((f) => [f.prov, f.progress.toFixed(2)]))); }
console.log('provinces UA', d.provinces.map((p) => `${p}:area${geo.provinces[p].area}:w${geo.provinces[p].w.toFixed(2)}:t${geo.provinces[p].terrain}`));
