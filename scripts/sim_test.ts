/**
 * sim_test: a headless war test. No browser, no rendering: the world simulation alone.
 *
 * Two AI nations go to war (the player is a spectator far away, whose desk is cleared every week) and the world runs for
 * N in-game days. Every week it records the war between them: territory, every front (progress, attack and defence,
 * supply), each side's supply network (capacity, pockets), troops, casualties, war support, the economy; and it checks
 * every country for broken numbers. At the end it finds the problems: crashes, frozen fronts (stalemates), a war with no
 * movement at all (a freeze), supply starvation spikes, economies in free fall, and it prints a report (text, or JSON).
 *
 *   npm run sim_test                                  the default matchups, 300 days each
 *   npm run sim_test -- --a Poland --b Belarus        one matchup
 *   npm run sim_test -- --days 300 --seed 7 --json report.json
 *
 * Exit code 1 if any matchup crashed, broke an invariant or froze. Budget: 300 days in under 5 seconds per matchup.
 */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS, type GameState, type War } from '../src/sim/types';
import { NAME_TO_ID, warBetween, warSideOf } from '../src/sim/relations';
import { declareWar, warScore } from '../src/sim/war';
import { supplyNet } from '../src/sim/supply';
import { setGeoRef } from '../src/sim/geoRef';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', '300'));
const SEED = Number(arg('seed', '11'));
const SPECTATOR = arg('player', 'Iceland')!;
const MATCHUPS: [string, string][] = arg('a') ? [[arg('a')!, arg('b')!]] : [['Poland', 'Belarus'], ['India', 'Pakistan'], ['Brazil', 'Argentina'], ['Iran', 'Iraq'], ['Germany', 'France'], ['Nigeria', 'Cameroon']];

const t0 = performance.now();
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
setGeoRef(geo);
const loadMs = performance.now() - t0;

interface Week { w: number; owned: [number, number]; fronts: { n: number; byA: number; byB: number; avgProg: number; stalled: number }; supply: [number, number]; pocket: [number, number]; frontSup: [number, number]; troops: [number, number]; cas: [number, number]; ws: [number, number]; score: number; gdp: [number, number]; stab: [number, number] }
interface Report {
  a: string; b: string; days: number; ms: number; msPerWeek: number;
  outcome: string; warWeeks: number; crashed: string | null; invariants: string[];
  territory: { aStart: number; aEnd: number; bStart: number; bEnd: number; changes: number; maxQuietWeeks: number };
  stalemates: { prov: string; by: string; weeks: number; progress: number; atk: number; def: number; sup: number }[];
  supplySpikes: { week: number; side: string; from: number; to: number; pocket: number }[];
  /** weeks each side had regions cut off from supply */
  pocketWeeks: [number, number];
  economy: { gdpA: number; gdpB: number; /** the worst one-week GDP fall in a week when no territory changed hands */ worstWeeklyDrop: number };
  casualties: [number, number]; troops: { aStart: number; aEnd: number; bStart: number; bEnd: number };
  warSupport: [number, number]; finalScore: number; verdict: string[];
  weeks?: Week[];
}

function invariants(s: GameState): string[] {
  const out: string[] = [];
  for (const c of s.countries) {
    if (!c.alive) continue;
    const e = c.eco;
    for (const [k, v] of Object.entries({ gdp: e.gdp, pop: e.pop, cash: e.cash, debt: e.debt, stability: e.stability, troops: c.mil.troops, supply: c.mil.supply })) if (!Number.isFinite(v)) out.push(`${c.name}.${k}=${v}`);
    if (e.gdp <= 0) out.push(`${c.name} gdp<=0`);
    if (c.mil.troops < 0) out.push(`${c.name} troops<0`);
    if (e.stability < 0 || e.stability > 100) out.push(`${c.name} stability ${e.stability}`);
  }
  for (let p = 0; p < s.owner.length; p++) if (!s.countries[s.owner[p]]?.alive) { out.push(`province ${p} owned by dead ${s.countries[s.owner[p]]?.name}`); break; }
  for (const c of s.countries) if (c.alive) for (const p of c.provinces) if (s.owner[p] !== c.id) { out.push(`${c.name}.provinces lists ${p} owned by ${s.countries[s.owner[p]].name}`); break; }
  for (const w of s.wars) for (const f of w.fronts) if (!Number.isFinite(f.progress) || f.progress < -0.01 || f.progress > 1.01) out.push(`front progress ${f.progress}`);
  return out;
}

function run(aName: string, bName: string): Report {
  const A = NAME_TO_ID[aName], B = NAME_TO_ID[bName];
  if (A === undefined || B === undefined) throw new Error(`unknown country ${aName} or ${bName}`);
  const s = createGame(geo, { ...DEFAULT_SETTINGS, seed: SEED, randomEvents: false }, NAME_TO_ID[SPECTATOR]);
  const name = (i: number) => s.countries[i].name;
  const r = declareWar(s, geo, A, B, 'sim_test');
  if (!r.ok) throw new Error(`cannot declare war: ${r.reason}`);
  const w0 = warBetween(s, A, B)!;
  const startOwned = [s.countries[A].provinces.length, s.countries[B].provinces.length];
  const troops0 = [s.countries[A].mil.troops, s.countries[B].mil.troops];
  const gdp0 = [s.countries[A].eco.gdp, s.countries[B].eco.gdp];
  const weeks: Week[] = [];
  const frontAge = new Map<string, { since: number; prog: number; last: number }>();
  const stalls: Report['stalemates'] = [];
  const spikes: Report['supplySpikes'] = [];
  const inv = new Set<string>();
  let crashed: string | null = null, changes = 0, quiet = 0, maxQuiet = 0, warWeeks = 0, worstDrop = 0;
  let prevOwned = [...startOwned], prevCap = [1, 1], prevPocket: [number, number] = [0, 0];
  const pocketWeeks: [number, number] = [0, 0];
  let outcome = 'still at war';
  const nWeeks = Math.ceil(DAYS / 7);
  const t1 = performance.now();
  for (let i = 0; i < nWeeks; i++) {
    s.inbox = []; s.offers = s.offers.filter((o) => o.from !== s.player);
    const gPrev = [s.countries[A].eco.gdp, s.countries[B].eco.gdp];
    try { tick(s, geo); } catch (e) { crashed = `week ${i}: ${String((e as Error).stack).split('\n').slice(0, 4).join(' | ')}`; break; }
    for (const x of invariants(s)) inv.add(x);
    const cA = s.countries[A], cB = s.countries[B];
    if (!cA.alive || !cB.alive) { outcome = `${cA.alive ? bName : aName} was wiped off the map (week ${i})`; break; }
    const w: War | undefined = warBetween(s, A, B);
    if (!w) { const last = s.warHistory?.at(-1); outcome = `peace in week ${i}${last ? `: ${JSON.stringify(last).slice(0, 160)}` : ''}`; break; }
    warWeeks++;
    const owned: [number, number] = [cA.provinces.length, cB.provinces.length];
    const moved = Math.abs(owned[0] - prevOwned[0]) + Math.abs(owned[1] - prevOwned[1]);
    changes += moved; quiet = moved ? 0 : quiet + 1; maxQuiet = Math.max(maxQuiet, quiet); prevOwned = owned;
    const nets = [supplyNet(s, geo, A), supplyNet(s, geo, B)];
    const cap: [number, number] = [nets[0].capacity, nets[1].capacity];
    const pocket: [number, number] = [nets[0].pocket.length, nets[1].pocket.length];
    // a spike is supply collapsing or a pocket forming (or growing), not a pocket that simply lasts (weeks counted apart)
    for (const k of [0, 1]) {
      if (i > 0 && (prevCap[k] - cap[k] > 0.15 || pocket[k] - prevPocket[k] >= Math.max(1, 0.1 * owned[k]))) spikes.push({ week: i, side: k ? bName : aName, from: +prevCap[k].toFixed(3), to: +cap[k].toFixed(3), pocket: pocket[k] });
      if (pocket[k]) pocketWeeks[k]++;
    }
    prevCap = cap; prevPocket = pocket;
    const mine = (id: number) => w.fronts.filter((f) => f.by === id);
    const fsA = mine(A), fsB = mine(B);
    const supAvg = (fs: War['fronts']) => (fs.length ? fs.reduce((t, f) => t + (f.sup ?? 1), 0) / fs.length : 1);
    let stalled = 0;
    // a front is judged by the best progress any attacker makes on that region and side (allies in a joint attack split
    // the credit, so one of them can sit near 0 while the region is falling)
    const best = new Map<string, number>();
    for (const f of w.fronts) { const k = `${f.prov}:${warSideOf(w, f.by)}`; best.set(k, Math.max(best.get(k) ?? 0, f.progress)); }
    for (const [k, prog] of best) {
      const st = frontAge.get(k);
      if (!st || Math.abs(prog - st.prog) > 0.03) frontAge.set(k, { since: i, prog, last: i });
      else { st.last = i; if (i - st.since >= 8) stalled++; }
    }
    for (const [k, st] of frontAge) if (st.last < i - 1) frontAge.delete(k);
    weeks.push({ w: i, owned, fronts: { n: w.fronts.length, byA: fsA.length, byB: fsB.length, avgProg: +(w.fronts.reduce((t, f) => t + f.progress, 0) / Math.max(1, w.fronts.length)).toFixed(3), stalled },
      supply: [+cap[0].toFixed(3), +cap[1].toFixed(3)], pocket, frontSup: [+supAvg(fsA).toFixed(3), +supAvg(fsB).toFixed(3)], troops: [Math.round(cA.mil.troops), Math.round(cB.mil.troops)],
      cas: [Math.round(w.casualties[A] ?? 0), Math.round(w.casualties[B] ?? 0)], ws: [+(cA.mil.warSupport ?? 0).toFixed(3), +(cB.mil.warSupport ?? 0).toFixed(3)], score: +warScore(s, w, A).toFixed(3),
      gdp: [+(cA.eco.gdp / gdp0[0]).toFixed(3), +(cB.eco.gdp / gdp0[1]).toFixed(3)], stab: [Math.round(cA.eco.stability), Math.round(cB.eco.stability)] });
    // (a big region changing hands takes its economy with it: only a drop in a week without a capture is suspicious)
    if (!moved) for (const k of [0, 1]) worstDrop = Math.max(worstDrop, 1 - [cA, cB][k].eco.gdp / gPrev[k]);
    if (i === nWeeks - 1) for (const f of w.fronts) { const st = frontAge.get(`${f.prov}:${warSideOf(w, f.by)}`); if (st && i - st.since >= 8 && !stalls.some((x) => x.prov === (geo.provinces[f.prov].name || String(f.prov)))) stalls.push({ prov: geo.provinces[f.prov].name || String(f.prov), by: name(f.by), weeks: i - st.since, progress: +f.progress.toFixed(3), atk: Math.round(f.atk ?? 0), def: Math.round(f.def ?? 0), sup: +(f.sup ?? 1).toFixed(2) }); }
  }
  const ms = performance.now() - t1;
  const cA = s.countries[A], cB = s.countries[B];
  const w = warBetween(s, A, B) ?? w0;
  const verdict: string[] = [];
  if (crashed) verdict.push('CRASH');
  if (inv.size) verdict.push('BROKEN INVARIANTS');
  if (warWeeks >= 12 && changes === 0) verdict.push('FREEZE: no territory changed hands');
  if (maxQuiet >= 16 && outcome === 'still at war') verdict.push(`STALL: ${maxQuiet} weeks without a single province changing hands`);
  if (stalls.length >= 3) verdict.push(`STALEMATE: ${stalls.length} fronts frozen for 8+ weeks`);
  if (spikes.length >= 4) verdict.push(`SUPPLY: ${spikes.length} starvation spikes`);
  if (worstDrop > 0.06) verdict.push(`ECONOMY: a ${Math.round(worstDrop * 100)}% GDP drop in a week with no territory lost`);
  if (!verdict.length) verdict.push('OK');
  return {
    a: aName, b: bName, days: DAYS, ms: Math.round(ms), msPerWeek: +(ms / Math.max(1, weeks.length)).toFixed(1), outcome, warWeeks, crashed, invariants: [...inv].slice(0, 20),
    territory: { aStart: startOwned[0], aEnd: cA.provinces.length, bStart: startOwned[1], bEnd: cB.provinces.length, changes, maxQuietWeeks: maxQuiet },
    stalemates: stalls.slice(0, 12), supplySpikes: spikes.slice(0, 12), pocketWeeks,
    economy: { gdpA: +(cA.eco.gdp / gdp0[0]).toFixed(3), gdpB: +(cB.eco.gdp / gdp0[1]).toFixed(3), worstWeeklyDrop: +worstDrop.toFixed(3) },
    casualties: [Math.round(w.casualties[A] ?? 0), Math.round(w.casualties[B] ?? 0)], troops: { aStart: Math.round(troops0[0]), aEnd: Math.round(cA.mil.troops), bStart: Math.round(troops0[1]), bEnd: Math.round(cB.mil.troops) },
    warSupport: [+(cA.mil.warSupport ?? 0).toFixed(2), +(cB.mil.warSupport ?? 0).toFixed(2)], finalScore: +warScore(s, w, A).toFixed(3), verdict,
    ...(process.argv.includes('--weeks') ? { weeks } : {}),
  };
}

const reports = MATCHUPS.map(([a, b]) => run(a, b));
const total = Math.round(performance.now() - t0);
const json = arg('json');
if (json) fs.writeFileSync(json, JSON.stringify({ seed: SEED, days: DAYS, loadMs: Math.round(loadMs), totalMs: total, reports }, null, 1));
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
console.log(`sim_test · ${DAYS} days · seed ${SEED} · world loaded in ${Math.round(loadMs)} ms · total ${total} ms`);
for (const r of reports) {
  console.log(`\n${r.a} vs ${r.b}: ${r.verdict.join(' · ')}  (${r.ms} ms, ${r.msPerWeek} ms/week)`);
  console.log(`  outcome   ${r.outcome} · ${r.warWeeks} weeks of war · war score ${r.finalScore} for ${r.a}`);
  console.log(`  territory ${r.a} ${r.territory.aStart}→${r.territory.aEnd}, ${r.b} ${r.territory.bStart}→${r.territory.bEnd} · ${r.territory.changes} changes · longest quiet spell ${r.territory.maxQuietWeeks} wk`);
  console.log(`  armies    ${r.a} ${k(r.troops.aStart)}→${k(r.troops.aEnd)} (−${k(r.casualties[0])}), ${r.b} ${k(r.troops.bStart)}→${k(r.troops.bEnd)} (−${k(r.casualties[1])}) · war support ${r.warSupport.join(' / ')}`);
  console.log(`  economy   GDP ×${r.economy.gdpA} / ×${r.economy.gdpB} · worst weekly drop ${(r.economy.worstWeeklyDrop * 100).toFixed(1)}%`);
  if (r.stalemates.length) console.log(`  stalled   ${r.stalemates.map((x) => `${x.prov} by ${x.by} ${x.weeks}wk @${x.progress} (atk ${x.atk} def ${x.def} sup ${x.sup})`).join('; ')}`);
  console.log(`  supply    pockets ${r.pocketWeeks[0]} / ${r.pocketWeeks[1]} weeks${r.supplySpikes.length ? ' · ' : ''}${r.supplySpikes.map((x) => `w${x.week} ${x.side} ${x.from}→${x.to} pocket ${x.pocket}`).join('; ')}`);
  if (r.crashed) console.log(`  CRASH     ${r.crashed}`);
  if (r.invariants.length) console.log(`  broken    ${r.invariants.join('; ')}`);
}
const bad = reports.some((r) => r.crashed || r.invariants.length || r.verdict.some((v) => v.startsWith('FREEZE')));
process.exit(bad ? 1 : 0);
