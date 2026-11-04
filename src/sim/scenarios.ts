/**
 * Scenarios: curated starts with a clear ending. Each gives you a nation, a moment and a deadline, and three goals,
 * one star each. The first goal is the one that decides victory; the other two are stars for doing it well. Goals are
 * of three kinds: reached once (it counts from then on), held for a stretch of time, or judged on the final day.
 * The scenario ends at the deadline, early once all three stars are won, or in defeat if the nation falls.
 */
import { clamp } from './util';
import { logEvent } from './log';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { alliesOf, isAtWar, NAME_TO_ID } from './relations';
import type { Country, GameState } from './types';

export interface ScenGoal {
  label: string;
  kind: 'reach' | 'hold' | 'end';
  /** for 'hold': how many weeks in a row */
  weeks?: number;
  /** progress 0..1 (1 = met right now) and a short status */
  value: (s: GameState, c: Country, st: ScenarioState) => { v: number; text: string };
}
export interface Scenario {
  id: string; icon: string; title: string; country: string; year: 2021 | 2024; years: number;
  pitch: string; brief: string; difficulty: 'easy' | 'normal' | 'hard'; goals: ScenGoal[];
  /** the nation falls (on top of being annexed): returns why, or null */
  fail?: (s: GameState, c: Country, st: ScenarioState) => string | null;
}
export interface ScenarioState {
  id: string; start: number; until: number;
  /** stars won (reach/hold goals count from the moment they are met) */
  stars: boolean[];
  /** weeks the 'hold' goals have been met in a row */
  streak: number[];
  /** the starting numbers goals are measured against */
  base: { real: number; rank: number; prov: number; techs: number; ind: number };
  done?: { won: boolean; stars: number; score: number; why: string; tick: number };
}

const rankGoal = (n: number): ScenGoal['value'] => (s, c, st) => { const r = powerRank(s, c.id); return { v: r <= n ? 1 : clamp((st.base.rank - r) / Math.max(1, st.base.rank - n), 0, 0.99), text: `#${r} now (goal #${n})` }; };
const lowGoal = (get: (c: Country) => number, goal: number, fmt: (v: number) => string): ScenGoal['value'] => (_s, c) => { const v = get(c); return { v: v <= goal ? 1 : clamp(goal / Math.max(1e-6, v), 0, 0.99), text: `${fmt(v)} now (goal ${fmt(goal)})` }; };
const pctF = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const clientsGoal = (n: number): ScenGoal['value'] => (s, c) => { const k = clientsOf(s, c.id).length; return { v: clamp(k / n, 0, 1), text: `${k} of ${n} client states` }; };
const realGoal = (x: number): ScenGoal['value'] => (_s, c, st) => { const g = c.eco.realGdp / Math.max(1, st.base.real); return { v: clamp((g - 1) / (x - 1), 0, 1), text: `economy ×${g.toFixed(2)} (goal ×${x})` }; };
/** rungs climbed (−1 before research has started: the base is filled in on the first month) */
const techs = (c: Country) => (c.rs ? c.rs.lv.reduce((t, v) => t + v, 0) : -1);
const indOf = (c: Country, ids: string[]) => (c.ind ? ids.reduce((t, k) => t + ((c.ind!.lv as Record<string, number>)[k] ?? 0), 0) : -1);

export const SCENARIOS: Scenario[] = [
  { id: 'poland', icon: '🦅', title: 'The Eagle Rises', country: 'Poland', year: 2024, years: 15, difficulty: 'normal',
    pitch: 'Europe’s fastest riser wants a seat at the top table.',
    brief: 'Poland has grown for thirty years without a recession and now spends more on defence than almost anyone in Europe. Turn that momentum into real power: break into the world’s top ten and build a circle of friends to the east, without wrecking the books.',
    goals: [
      { label: 'Break into the world’s top 10', kind: 'reach', value: rankGoal(10) },
      { label: 'Win 3 client states', kind: 'reach', value: clientsGoal(3) },
      { label: 'Finish with public debt below 70% of GDP', kind: 'end', value: lowGoal((c) => c.eco.debt / c.eco.gdp, 0.7, pctF) },
    ] },
  { id: 'argentina', icon: '🧉', title: 'Never Again', country: 'Argentina', year: 2024, years: 10, difficulty: 'hard',
    pitch: 'Inflation at 25%, debt at 85%. Break the cycle for good.',
    brief: 'Argentina has defaulted nine times and lived with runaway prices for most of a century. You have ten years to do what nobody has managed: bring inflation down and keep it down, put the debt on a sane path, and climb back up the world table.',
    goals: [
      { label: 'Hold inflation below 5% for a full year', kind: 'hold', weeks: 52, value: lowGoal((c) => c.eco.inflation, 0.05, pctF) },
      { label: 'Bring public debt below 60% of GDP', kind: 'reach', value: lowGoal((c) => c.eco.debt / c.eco.gdp, 0.6, pctF) },
      { label: 'Climb into the world’s top 25', kind: 'reach', value: rankGoal(25) },
    ],
    fail: (_s, c) => (c.eco.stability < 12 ? 'The streets turned against the government and it fell.' : null) },
  { id: 'turkey', icon: '🌉', title: 'The Bridge Between Worlds', country: 'Turkey', year: 2024, years: 12, difficulty: 'normal',
    pitch: 'Lead your region, answer to no camp.',
    brief: 'Turkey sits between Europe, Russia and the Middle East and plays them against each other. Make it a power in its own right: a top-ten nation with its own sphere of influence, and finally tame the inflation that eats your people’s wages.',
    goals: [
      { label: 'Break into the world’s top 10', kind: 'reach', value: rankGoal(10) },
      { label: 'Win 5 client states', kind: 'reach', value: clientsGoal(5) },
      { label: 'Hold inflation below 8% for a full year', kind: 'hold', weeks: 52, value: lowGoal((c) => c.eco.inflation, 0.08, pctF) },
    ] },
  { id: 'ukraine', icon: '🌻', title: 'Survive and Rebuild', country: 'Ukraine', year: 2024, years: 10, difficulty: 'hard',
    pitch: 'At war with a far larger neighbour. Endure, then rebuild.',
    brief: 'It is 2024 and the war is in its third year. Hold the capital and the heart of the country, find allies who will stand with you, and when the guns fall silent, rebuild an economy that outgrows what you lost.',
    goals: [
      { label: 'Still hold Kyiv and at least 18 regions at the end', kind: 'end', value: (_s, c) => ({ v: c.provinces.includes(c.capital) ? clamp(c.provinces.length / 18, 0, 1) : 0, text: `${c.provinces.length} regions${c.provinces.includes(c.capital) ? '' : ', capital lost'}` }) },
      { label: 'Grow the economy by 60%', kind: 'reach', value: realGoal(1.6) },
      { label: 'Have 2 allies and be at peace', kind: 'end', value: (s, c) => { const a = alliesOf(s, c.id).length; const w = isAtWar(s, c.id); return { v: w ? Math.min(0.5, a / 4) : clamp(a / 2, 0, 1), text: `${a} allies${w ? ', still at war' : ', at peace'}` }; } },
    ] },
  { id: 'india', icon: '🐘', title: 'The Next Superpower', country: 'India', year: 2024, years: 25, difficulty: 'normal',
    pitch: 'The most people, the fastest growth. Now the crown.',
    brief: 'India is already the world’s third power and growing faster than any large economy. A quarter of a century from now, the world could have a new superpower. Overtake the two ahead of you and lead the world in technology.',
    goals: [
      { label: 'Become the world’s #2 power', kind: 'reach', value: rankGoal(2) },
      { label: 'Become the world’s #1 power', kind: 'reach', value: rankGoal(1) },
      { label: 'Master 12 new technologies', kind: 'reach', value: (_s, c, st) => { const n = st.base.techs < 0 ? 0 : techs(c) - st.base.techs; return { v: clamp(n / 12, 0, 1), text: `${n} of 12` }; } },
    ] },
  { id: 'japan', icon: '🗾', title: 'The Comeback', country: 'Japan', year: 2021, years: 15, difficulty: 'hard',
    pitch: 'Three lost decades. Wake the giant.',
    brief: 'Japan has barely grown since 1990 and carries the heaviest public debt in the rich world. Prove the pessimists wrong: grow the economy by a third, bring the debt down, and climb back into the top three.',
    goals: [
      { label: 'Grow the economy by 30%', kind: 'reach', value: realGoal(1.3) },
      { label: 'Bring public debt below 200% of GDP', kind: 'reach', value: lowGoal((c) => c.eco.debt / c.eco.gdp, 2, pctF) },
      { label: 'Climb into the world’s top 3', kind: 'reach', value: rankGoal(3) },
    ] },
  { id: 'saudi', icon: '🛢', title: 'Beyond Oil', country: 'Saudi Arabia', year: 2024, years: 15, difficulty: 'normal',
    pitch: 'Turn oil money into a modern economy before the oil age ends.',
    brief: 'Oil pays for everything in Saudi Arabia, for now. Use the windfall to build industries that will outlast it: technology and services, a top-ten place in the world, and a circle of client states across the region.',
    goals: [
      { label: 'Expand technology and services by 4 levels', kind: 'reach', value: (_s, c, st) => { const n = st.base.ind < 0 ? 0 : indOf(c, ['tech', 'services']) - st.base.ind; return { v: clamp(n / 4, 0, 1), text: `+${n.toFixed(1)} of 4 levels` }; } },
      { label: 'Break into the world’s top 10', kind: 'reach', value: rankGoal(10) },
      { label: 'Win 4 client states', kind: 'reach', value: clientsGoal(4) },
    ] },
  { id: 'nigeria', icon: '🦁', title: 'Africa’s Giant', country: 'Nigeria', year: 2024, years: 20, difficulty: 'hard',
    pitch: 'Two hundred million people. Make them prosperous.',
    brief: 'Nigeria has the people, the oil and the energy of a great power, and the inflation, insecurity and debts of a fragile one. Make it the richest economy in Africa, calm the prices, and take a place among the world’s top 25.',
    goals: [
      { label: 'Become Africa’s largest economy', kind: 'reach', value: (s, c) => { const top = s.countries.filter((x) => x.alive && x.region === 'AF' && x.id !== c.id).sort((a, b) => b.eco.gdp - a.eco.gdp)[0]; return { v: top ? clamp(c.eco.gdp / top.eco.gdp, 0, 1) : 1, text: top ? `${Math.round((c.eco.gdp / top.eco.gdp) * 100)}% of ${top.name}` : 'first' }; } },
      { label: 'Hold inflation below 6% for a full year', kind: 'hold', weeks: 52, value: lowGoal((c) => c.eco.inflation, 0.06, pctF) },
      { label: 'Climb into the world’s top 25', kind: 'reach', value: rankGoal(25) },
    ],
    fail: (_s, c) => (c.eco.stability < 10 ? 'The country slid into chaos and the government fell.' : null) },
];
export const scenarioById = (id: string | undefined) => SCENARIOS.find((x) => x.id === id);
export const scenarioPlayer = (sc: Scenario) => NAME_TO_ID[sc.country];

export function ensureScenario(s: GameState): ScenarioState | null {
  const sc = scenarioById(s.settings.scenario);
  if (!sc) return null;
  if (!s.scen || s.scen.id !== sc.id) {
    const c = s.countries[s.player];
    s.scen = { id: sc.id, start: s.tick, until: s.tick + sc.years * 52, stars: sc.goals.map(() => false), streak: sc.goals.map(() => 0),
      base: { real: c.eco.realGdp, rank: powerRank(s, s.player), prov: c.provinces.length, techs: techs(c), ind: indOf(c, ['tech', 'services']) } };
  }
  return s.scen;
}

/** Live view of the goals: progress, and whether each star is won (or, for end goals, would be now). */
export function scenarioGoals(s: GameState) {
  const sc = scenarioById(s.settings.scenario), st = s.scen;
  if (!sc || !st) return [];
  const c = s.countries[s.player];
  return sc.goals.map((g, i) => { const p = g.value(s, c, st); return { g, i, ...p, won: st.stars[i] || (g.kind === 'end' && p.v >= 1), locked: st.stars[i], streak: st.streak[i] }; });
}

/** Monthly: stars, the clock, the ending. */
export function stepScenario(s: GameState) {
  const st = ensureScenario(s);
  if (!st || st.done) return;
  const sc = scenarioById(st.id)!, c = s.countries[s.player];
  const end = (won: boolean, why: string) => {
    const stars = sc.goals.filter((g, i) => st.stars[i] || (g.kind === 'end' && c.alive && g.value(s, c, st).v >= 1)).length;
    const winNow = won && (st.stars[0] || (sc.goals[0].kind === 'end' && c.alive && sc.goals[0].value(s, c, st).v >= 1));
    const score = (winNow ? 1000 : 0) + stars * 1000 + Math.max(0, st.until - s.tick) * 3 + Math.max(0, (st.base.rank - (c.alive ? powerRank(s, s.player) : 999))) * 25;
    st.done = { won: winNow, stars: winNow ? stars : Math.min(stars, 1), score: Math.max(0, score), why, tick: s.tick };
    logEvent(s, `🏁 ${sc.title.toUpperCase()}: ${winNow ? `VICTORY, ${'★'.repeat(st.done.stars)}` : 'DEFEAT'}. ${why}`, winNow ? 'info' : 'danger', [s.player], true, { big: true, prov: c.capital });
  };
  if (!c.alive) return end(false, `${c.name} has fallen.`);
  const why = sc.fail?.(s, c, st);
  if (why) return end(false, why);
  const last = s.tick >= st.until;
  if (s.tick % 4 !== 2 && !last) return;
  if (st.base.techs < 0) st.base.techs = techs(c);
  if (st.base.ind < 0) st.base.ind = indOf(c, ['tech', 'services']);
  sc.goals.forEach((g, i) => {
    if (st.stars[i] || g.kind === 'end') return;
    const v = g.value(s, c, st).v;
    if (g.kind === 'hold') { if (s.tick % 4 !== 2) return; st.streak[i] = v >= 1 ? st.streak[i] + 4 : 0; if (st.streak[i] < (g.weeks ?? 52)) return; }
    else if (v < 1) return;
    st.stars[i] = true;
    logEvent(s, `⭐ STAR WON: ${g.label}.`, 'info', [s.player], true, { big: true, prov: c.capital });
  });
  if (sc.goals.every((_g, i) => st.stars[i])) return end(true, `Every goal achieved, ${Math.round((st.until - s.tick) / 52)} years ahead of time.`);
  if (last) end(true, `Time is up: ${sc.years} years have passed.`);
}
