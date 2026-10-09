/** Headless world simulation for balance/debugging: npx tsx scripts/headless-sim.ts [years] [playerName] */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS } from '../src/sim/types';
import { NAME_TO_ID } from '../src/sim/relations';
import { fmtMoney } from '../src/sim/util';
import { strengthIndex } from '../src/sim/military';

const years = Number(process.argv[2] ?? 10);
const playerName = process.argv[3] ?? 'Germany';
const raw = JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld;
const geo = buildGeo(raw);
const s = createGame(geo, { ...DEFAULT_SETTINGS }, NAME_TO_ID[playerName]);
const show = (label: string, names: string[]) => {
  console.log(`--- ${label} (year ${(s.tick / 52).toFixed(1)}) ---`);
  for (const n of names) {
    const c = s.countries[NAME_TO_ID[n]];
    if (!c.alive) { console.log(n, 'DEAD'); continue; }
    const e = c.eco;
    console.log(
      n.padEnd(14), 'GDP', fmtMoney(e.gdp).padEnd(8), 'pc', Math.round(e.gdp / e.pop).toString().padEnd(6), 'g', (e.growth * 100).toFixed(1).padStart(5) + '%',
      'infl', (e.inflation * 100).toFixed(1).padStart(5) + '%', 'u', (e.unemployment * 100).toFixed(1).padStart(5) + '%',
      'debt', ((e.debt / e.gdp) * 100).toFixed(0).padStart(4) + '%', 'stab', e.stability.toFixed(0).padStart(3), 'cash', fmtMoney(e.cash).padEnd(8),
      'troops', Math.round(c.mil.troops / 1000) + 'k', 'mil', strengthIndex(c).toFixed(0), 'provs', c.provinces.length,
    );
  }
};
const NAMES = ['United States of America', 'China', 'Germany', 'Japan', 'India', 'Russia', 'Brazil', 'Nigeria', 'Ukraine', 'Israel', 'Argentina', 'Turkey', 'Iran'];
show('start', NAMES);
const t0 = Date.now();
let maxMs = 0;
const allLogs: { tick: number; text: string; kind: string }[] = [];
for (let i = 0; i < years * 52; i++) {
  const a = Date.now();
  tick(s, geo);
  maxMs = Math.max(maxMs, Date.now() - a);
  for (let k = s.log.length - 1; k >= 0 && s.log[k].tick === s.tick; k--) allLogs.push(s.log[k]);
  if (i === 51 || (i + 1) % (52 * Math.max(1, Math.floor(years / 3))) === 0) show('', NAMES);
}
console.log(`ticks=${years * 52} total=${Date.now() - t0}ms avg=${((Date.now() - t0) / (years * 52)).toFixed(1)}ms max=${maxMs}ms`);
const bad = s.countries.filter((c) => c.alive && Object.values(c.eco).some((v) => typeof v === 'number' && !Number.isFinite(v)));
console.log('countries with NaN/inf:', bad.map((c) => c.name).join(', ') || 'none');
console.log('wars now:', s.wars.length, '| alive countries:', s.countries.filter((c) => c.alive).length, '| wars started:', s.nextWarId - 1);
const decl = allLogs.filter((l) => l.text.includes('declared war'));
console.log('war declarations:', decl.length);
console.log(decl.slice(0, 25).map((l) => `  y${(l.tick / 52).toFixed(1)} ${l.text}`).join('\n'));
const terr = allLogs.filter((l) => l.kind === 'territory');
console.log('territory events:', terr.length, '| peace:', allLogs.filter((l) => l.kind === 'peace').length, '| diplo:', allLogs.filter((l) => l.kind === 'diplo').length);
console.log(allLogs.filter((l) => l.kind === 'peace').slice(0, 8).map((l) => `  y${(l.tick / 52).toFixed(1)} ${l.text}`).join('\n'));
