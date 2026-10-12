import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { actChooseAgenda, grade, epithet } from '../src/sim/legacy';
import { resolveEvent } from '../src/sim/events';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const who = process.argv[2] ?? 'Poland';
const s = createGame(geo, { ...DEFAULT_SETTINGS, mode: 'legacy', control: { economy: 'auto', military: 'auto', diplomacy: 'auto' }, seed: Number(process.env.SEED ?? 1) }, NAME_TO_ID[who]);
const L = s.legacy!;
console.log(L.leader, L.title, 'hand', L.hand);
for (let i = 0; i < 52 * 41 && L.status !== 'ended'; i++) {
  if (L.hand.length) actChooseAgenda(s, L.hand.slice(0, 3));
  for (const it of [...s.inbox]) resolveEvent(s, geo, 0, it.uid);
  tick(s, geo);
}
for (const t of L.terms) console.log('TERM', t.term, t.result, t.headline, '|', t.lines.join(' | '));
console.log('status', L.status, L.endReason, 'score', L.score.toFixed(0), grade(L.score), epithet(s), JSON.stringify(Object.fromEntries(Object.entries(L.parts).map(([k, v]) => [k, Math.round(v)]))));
console.log('chronicle', L.chronicle.length, L.chronicle.slice(0, 12).map((c) => c.text).join('\n  '));
