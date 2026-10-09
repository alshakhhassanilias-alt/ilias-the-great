/**
 * Objectives. A pool of ~28 goals; three are active at a time, chosen by what is relevant to the
 * player's situation (so a peaceful trader and a warlord see different tasks). Completing one pays out
 * immediately and the next relevant goal takes its place.
 */
import { clamp } from './util';
import { logEvent } from './log';
import { strength } from './military';
import { alliesOf, areAtWar, getRelation, isAtWar, partnersOf, sanctionLevel } from './relations';
import { computeBlocs } from './politics';
import { hash01 } from './rng';
import type { Country, GameState } from './types';

export interface GoalProgress { value: number; text: string } // value 0..1
export interface Goal {
  id: string; title: string; desc: string; reward: string; theme: 'economy' | 'politics' | 'military';
  /** is this goal relevant right now? (keeps the task list from feeling generic) */
  when?: (s: GameState, c: Country) => boolean;
  progress: (s: GameState, c: Country) => GoalProgress;
  pay: (c: Country, s: GameState) => void;
}
const gdpRank = (s: GameState, c: Country) => [...s.countries].filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((x) => x.id === c.id) + 1;
const milRank = (s: GameState, c: Country) => [...s.countries].filter((x) => x.alive).sort((a, b) => strength(b) - strength(a)).findIndex((x) => x.id === c.id) + 1;
const techRank = (s: GameState, c: Country) => [...s.countries].filter((x) => x.alive).sort((a, b) => b.eco.tech - a.eco.tech).findIndex((x) => x.id === c.id) + 1;
const cash = (pct: number) => (c: Country) => { c.eco.cash += pct * c.eco.gdp; };
const R = (pct: number, extra = '') => `${(pct * 100).toFixed(1)}% of GDP${extra}`;
const stat = (s: GameState, k: string) => s.stats[k] ?? 0;
const bar = (n: number, goal: number) => clamp(n / goal, 0, 1);
const rivalsOf = (s: GameState, c: Country) => s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -30);

export const GOALS: Goal[] = [
  // ------------------------------------------------ economy
  { id: 'growth', theme: 'economy', title: 'Grow the economy', desc: 'Lift GDP to 115% of its starting size.', reward: `Reward: ${R(0.01)}`,
    progress: (s, c) => ({ value: clamp((c.eco.gdp / s.goalBase.gdp - 1) / 0.15, 0, 1), text: `${((c.eco.gdp / s.goalBase.gdp) * 100).toFixed(0)}% of start` }), pay: cash(0.01) },
  { id: 'trade', theme: 'economy', title: 'Open new markets', desc: 'Sign three more trade agreements than you started with.', reward: `Reward: ${R(0.005)} · reputation +3`,
    progress: (s, c) => { const n = partnersOf(s, c.id, 'trade').length; return { value: bar(n - s.goalBase.trade, 3), text: `${Math.max(0, n - s.goalBase.trade)} / 3 new` }; }, pay: (c) => { c.eco.cash += 0.005 * c.eco.gdp; c.reputation = clamp(c.reputation + 3, 0, 100); } },
  { id: 'hub', theme: 'economy', title: 'Become a trade hub', desc: 'Have trade agreements with 12 countries.', reward: `Reward: ${R(0.008)}`, when: (s, c) => partnersOf(s, c.id, 'trade').length >= 5,
    progress: (s, c) => { const n = partnersOf(s, c.id, 'trade').length; return { value: bar(n, 12), text: `${n} / 12 partners` }; }, pay: cash(0.008) },
  { id: 'infra', theme: 'economy', title: 'Build modern infrastructure', desc: 'Raise infrastructure quality to 65.', reward: `Reward: ${R(0.006)}`, when: (_s, c) => c.eco.infra < 65,
    progress: (_s, c) => ({ value: clamp(c.eco.infra / 65, 0, 1), text: `${c.eco.infra.toFixed(0)} / 65` }), pay: cash(0.006) },
  { id: 'tech', theme: 'economy', title: 'Technological leap', desc: 'Raise technology by 8 points.', reward: `Reward: ${R(0.008)}`,
    progress: (s, c) => ({ value: clamp((c.eco.tech - s.goalBase.tech) / 8, 0, 1), text: `+${Math.max(0, c.eco.tech - s.goalBase.tech).toFixed(1)} / 8` }), pay: cash(0.008) },
  { id: 'techlead', theme: 'economy', title: 'Join the tech elite', desc: 'Rank in the world top 10 for technology.', reward: `Reward: ${R(0.01)} · reputation +3`, when: (s, c) => techRank(s, c) > 10 && techRank(s, c) < 40,
    progress: (s, c) => { const r = techRank(s, c); return { value: r <= 10 ? 1 : clamp(1 - (r - 10) / 40, 0, 0.95), text: `#${r}` }; }, pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.reputation = clamp(c.reputation + 3, 0, 100); } },
  { id: 'stable', theme: 'economy', title: 'A contented nation', desc: 'Reach stability 80.', reward: `Reward: ${R(0.004)}`, when: (_s, c) => c.eco.stability < 80,
    progress: (_s, c) => ({ value: clamp((c.eco.stability - 40) / 40, 0, 1), text: `${c.eco.stability.toFixed(0)} / 80` }), pay: cash(0.004) },
  { id: 'debt', theme: 'economy', title: 'Fiscal discipline', desc: 'Cut public debt by 10 percentage points of GDP.', reward: `Reward: ${R(0.004)} · stability +3`, when: (s) => s.goalBase.debt > 0.35,
    progress: (s, c) => ({ value: clamp((s.goalBase.debt - c.eco.debt / c.eco.gdp) / 0.1, 0, 1), text: `${(c.eco.debt / c.eco.gdp * 100).toFixed(0)}% (goal ${(Math.max(0, s.goalBase.debt - 0.1) * 100).toFixed(0)}%)` }), pay: (c) => { c.eco.cash += 0.004 * c.eco.gdp; c.eco.stability = clamp(c.eco.stability + 3, 0, 100); } },
  { id: 'rank', theme: 'economy', title: 'Rise in the world', desc: 'Climb three places in the GDP rankings (or reach the top 3).', reward: `Reward: ${R(0.01)} · reputation +5`, when: (s) => s.goalBase.rank > 4,
    progress: (s, c) => { const r = gdpRank(s, c); const need = Math.max(3, s.goalBase.rank - 3); return { value: r <= need ? 1 : clamp((s.goalBase.rank - r) / Math.max(1, s.goalBase.rank - need), 0, 1), text: `#${r} (from #${s.goalBase.rank})` }; }, pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.reputation = clamp(c.reputation + 5, 0, 100); } },
  { id: 'energy', theme: 'economy', title: 'Energy independence', desc: 'Produce at least as much energy as you consume.', reward: `Reward: ${R(0.006)} · stability +2`, when: (_s, c) => c.eco.energyCap < c.eco.energyDemand,
    progress: (_s, c) => { const r = c.eco.energyCap / Math.max(1, c.eco.energyDemand); return { value: clamp(r, 0, 1), text: `${(r * 100).toFixed(0)}% self-sufficient` }; }, pay: (c) => { c.eco.cash += 0.006 * c.eco.gdp; c.eco.stability = clamp(c.eco.stability + 2, 0, 100); } },
  { id: 'food', theme: 'economy', title: 'Feed the nation', desc: 'Produce at least as much food as you consume.', reward: `Reward: ${R(0.006)} · stability +2`, when: (_s, c) => c.eco.foodCap < c.eco.foodDemand,
    progress: (_s, c) => { const r = c.eco.foodCap / Math.max(1, c.eco.foodDemand); return { value: clamp(r, 0, 1), text: `${(r * 100).toFixed(0)}% self-sufficient` }; }, pay: (c) => { c.eco.cash += 0.006 * c.eco.gdp; c.eco.stability = clamp(c.eco.stability + 2, 0, 100); } },
  { id: 'jobs', theme: 'economy', title: 'Full employment', desc: 'Bring unemployment down to its normal level.', reward: `Reward: ${R(0.005)}`, when: (_s, c) => c.eco.unemployment > c.eco.uNat + 0.005,
    progress: (_s, c) => ({ value: clamp(1 - (c.eco.unemployment - c.eco.uNat) / 0.06, 0, 1), text: `${(c.eco.unemployment * 100).toFixed(1)}% (normal ${(c.eco.uNat * 100).toFixed(1)}%)` }), pay: cash(0.005) },
  { id: 'industry', theme: 'economy', title: 'Industrialist', desc: 'Build factory complexes with a combined level of 2 in your regions.', reward: `Reward: ${R(0.006)}`,
    progress: (_s, c) => ({ value: bar(c.mil.bld.factory, 2), text: `${c.mil.bld.factory} / 2 levels` }), pay: cash(0.006) },
  // ------------------------------------------------ politics
  { id: 'ally', theme: 'politics', title: 'Find a friend', desc: 'Sign a defensive alliance.', reward: `Reward: reputation +4 · stability +2`,
    progress: (s, c) => { const n = alliesOf(s, c.id).length; return { value: n > s.goalBase.allies ? 1 : 0, text: `${n} allies` }; }, pay: (c) => { c.reputation = clamp(c.reputation + 4, 0, 100); c.eco.stability = clamp(c.eco.stability + 2, 0, 100); } },
  { id: 'bloc', theme: 'politics', title: 'Build a bloc', desc: 'Belong to an alliance bloc of at least four countries.', reward: `Reward: reputation +5 · ${R(0.005)}`, when: (s, c) => alliesOf(s, c.id).length >= 1,
    progress: (s, c) => { const { blocs, of } = computeBlocs(s); const b = of.has(c.id) ? blocs[of.get(c.id)!] : null; const n = b ? b.members.length : alliesOf(s, c.id).length + 1; return { value: bar(n, 4), text: `${n} / 4 in your bloc` }; }, pay: (c) => { c.reputation = clamp(c.reputation + 5, 0, 100); c.eco.cash += 0.005 * c.eco.gdp; } },
  { id: 'diplomat', theme: 'politics', title: 'Active diplomat', desc: 'Sign five agreements (treaties, guarantees) in total.', reward: `Reward: reputation +3 · ${R(0.003)}`,
    progress: (s) => ({ value: bar(stat(s, 'deals') + stat(s, 'guarantees'), 5), text: `${stat(s, 'deals') + stat(s, 'guarantees')} / 5 deals` }), pay: (c) => { c.reputation = clamp(c.reputation + 3, 0, 100); c.eco.cash += 0.003 * c.eco.gdp; } },
  { id: 'guardian', theme: 'politics', title: 'Protector of the small', desc: 'Guarantee another country\'s security (Diplomacy tab).', reward: `Reward: reputation +4`,
    progress: (s) => ({ value: stat(s, 'guarantees') > 0 ? 1 : 0, text: `${stat(s, 'guarantees')} guarantees` }), pay: (c) => { c.reputation = clamp(c.reputation + 4, 0, 100); } },
  { id: 'benefactor', theme: 'politics', title: 'Generous neighbour', desc: 'Send aid packages to two countries.', reward: `Reward: reputation +4`,
    progress: (s) => ({ value: bar(stat(s, 'aid'), 2), text: `${stat(s, 'aid')} / 2 packages` }), pay: (c) => { c.reputation = clamp(c.reputation + 4, 0, 100); } },
  { id: 'broker', theme: 'politics', title: 'Honest broker', desc: 'Mediate a ceasefire between two countries at war.', reward: `Reward: reputation +8 · ${R(0.005)}`, when: (s, c) => s.wars.some((w) => !w.attackers.includes(c.id) && !w.defenders.includes(c.id)),
    progress: (s) => ({ value: stat(s, 'mediations') > 0 ? 1 : 0, text: `${stat(s, 'mediations')} mediations` }), pay: (c) => { c.reputation = clamp(c.reputation + 8, 0, 100); c.eco.cash += 0.005 * c.eco.gdp; } },
  { id: 'assembly', theme: 'politics', title: 'Winning side', desc: 'Vote with the majority at the World Assembly three times.', reward: `Reward: reputation +4`,
    progress: (s) => ({ value: bar(stat(s, 'assemblyWins'), 3), text: `${stat(s, 'assemblyWins')} / 3 votes` }), pay: (c) => { c.reputation = clamp(c.reputation + 4, 0, 100); } },
  { id: 'respect', theme: 'politics', title: 'A name that counts', desc: 'Raise your reputation to 80.', reward: `Reward: ${R(0.006)}`, when: (_s, c) => c.reputation < 80,
    progress: (_s, c) => ({ value: clamp((c.reputation - 40) / 40, 0, 1), text: `${c.reputation.toFixed(0)} / 80` }), pay: cash(0.006) },
  { id: 'contain', theme: 'politics', title: 'Contain a rival', desc: 'Get three countries to sanction one of your rivals.', reward: `Reward: reputation +3 · ${R(0.004)}`, when: (s, c) => rivalsOf(s, c).length > 0,
    progress: (s, c) => { let best = 0; for (const r of rivalsOf(s, c)) best = Math.max(best, s.countries.filter((x) => x.alive && sanctionLevel(s, x.id, r.id) > 0).length); return { value: bar(best, 3), text: `${best} / 3 sanctioning` }; }, pay: (c) => { c.reputation = clamp(c.reputation + 3, 0, 100); c.eco.cash += 0.004 * c.eco.gdp; } },
  { id: 'peace', theme: 'politics', title: 'Years of peace', desc: 'Stay out of war for three years.', reward: `Reward: ${R(0.01)} · stability +3`,
    progress: (s) => ({ value: clamp((s.tick - stat(s, 'lastWar')) / 156, 0, 1), text: `${((s.tick - stat(s, 'lastWar')) / 52).toFixed(1)} / 3 years` }), pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.eco.stability = clamp(c.eco.stability + 3, 0, 100); } },
  // ------------------------------------------------ military
  { id: 'army', theme: 'military', title: 'A respected army', desc: 'Reach the top 15 in military power.', reward: `Reward: readiness +5% · ${R(0.005)}`, when: (s, c) => milRank(s, c) > 15,
    progress: (s, c) => { const r = milRank(s, c); return { value: r <= 15 ? 1 : clamp(1 - (r - 15) / 60, 0, 0.95), text: `#${r}` }; }, pay: (c) => { c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); c.eco.cash += 0.005 * c.eco.gdp; } },
  { id: 'fortress', theme: 'military', title: 'Fortify the frontier', desc: 'Build fortresses with a combined level of 3.', reward: `Reward: readiness +3%`, when: (s, c) => rivalsOf(s, c).length > 0 || isAtWar(s, c.id),
    progress: (_s, c) => ({ value: bar(c.mil.bld.fort, 3), text: `${c.mil.bld.fort} / 3 levels` }), pay: (c) => { c.mil.readiness = clamp(c.mil.readiness + 0.03, 0, 1); } },
  { id: 'airpower', theme: 'military', title: 'Command the skies', desc: 'Build airbases with a combined level of 2.', reward: `Reward: ${R(0.004)}`,
    progress: (_s, c) => ({ value: bar(c.mil.bld.airbase, 2), text: `${c.mil.bld.airbase} / 2 levels` }), pay: cash(0.004) },
  { id: 'conquer', theme: 'military', title: 'First conquest', desc: 'Capture enemy territory in a war.', reward: `Reward: ${R(0.01)} · war exhaustion −10%`, when: (s, c) => isAtWar(s, c.id),
    progress: (s, c) => { const n = s.owner.filter((o, p) => o === c.id && s.core[p] !== c.id).length; return { value: n > 0 ? 1 : 0, text: `${n} regions held` }; }, pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.mil.exhaustion = Math.max(0, c.mil.exhaustion - 0.1); } },
  { id: 'spymaster', theme: 'military', title: 'Spymaster', desc: 'Raise your intelligence rating to 70%.', reward: `Reward: ${R(0.004)}`, when: (_s, c) => c.mil.intel < 0.7,
    progress: (_s, c) => ({ value: clamp(c.mil.intel / 0.7, 0, 1), text: `${(c.mil.intel * 100).toFixed(0)}% / 70%` }), pay: cash(0.004) },
];

function relevant(g: Goal, s: GameState, c: Country) { return !g.when || g.when(s, c); }

export function activeGoals(s: GameState): Goal[] {
  if (!s.goalsActive.length && s.countries[s.player]?.alive) refill(s, s.countries[s.player]);
  return s.goalsActive.map((id) => GOALS.find((g) => g.id === id)!).filter(Boolean);
}

/** Keep three relevant, unfinished goals active, mixing themes so the list does not feel repetitive. */
function refill(s: GameState, c: Country) {
  s.goalsActive = s.goalsActive.filter((id) => s.goalsDone[id] === undefined);
  while (s.goalsActive.length < 3) {
    const have = new Set(s.goalsActive.map((id) => GOALS.find((g) => g.id === id)!.theme));
    const pool = GOALS.filter((g) => s.goalsDone[g.id] === undefined && !s.goalsActive.includes(g.id) && relevant(g, s, c));
    if (!pool.length) break;
    pool.sort((a, b) => (have.has(a.theme) ? 1 : 0) - (have.has(b.theme) ? 1 : 0) || hash01('goal', a.id, c.id, s.goalsActive.length) - hash01('goal', b.id, c.id, s.goalsActive.length));
    s.goalsActive.push(pool[0].id);
  }
}

export function stepGoals(s: GameState) {
  const c = s.countries[s.player];
  if (!c.alive) return;
  if (isAtWar(s, c.id)) s.stats.lastWar = s.tick;
  if (s.tick % 4 !== 0 && s.goalsActive.length >= 3) return;
  refill(s, c);
  for (const g of GOALS) {
    if (s.goalsDone[g.id] !== undefined) continue;
    if (!s.goalsActive.includes(g.id)) continue; // only active goals can complete: keeps the list meaningful
    if (g.progress(s, c).value >= 1) {
      s.goalsDone[g.id] = s.tick;
      g.pay(c, s);
      logEvent(s, `Objective complete: ${g.title}. ${g.reward.replace('Reward: ', 'You received ')}`, 'info', [s.player], true);
    }
  }
  refill(s, c);
}
void areAtWar;
