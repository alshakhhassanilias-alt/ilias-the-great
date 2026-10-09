/** Optional objectives that give a sandbox direction. Completing one pays a reward immediately. */
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';
import { strength } from './military';
import { alliesOf, partnersOf } from './relations';
import type { Country, GameState } from './types';

export interface GoalProgress { value: number; text: string } // value 0..1
export interface Goal {
  id: string; title: string; desc: string; reward: string;
  progress: (s: GameState, c: Country) => GoalProgress;
  pay: (c: Country) => void;
}
const gdpRank = (s: GameState, c: Country) => [...s.countries].filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((x) => x.id === c.id) + 1;
const milRank = (s: GameState, c: Country) => [...s.countries].filter((x) => x.alive).sort((a, b) => strength(b) - strength(a)).findIndex((x) => x.id === c.id) + 1;
const cash = (pct: number) => (c: Country) => { c.eco.cash += pct * c.eco.gdp; };
const R = (pct: number, extra = '') => `${(pct * 100).toFixed(1)}% of GDP${extra}`;

export const GOALS: Goal[] = [
  { id: 'growth', title: 'Grow the economy', desc: 'Lift GDP to 115% of its starting size.', reward: `Reward: ${R(0.01)}`,
    progress: (s, c) => ({ value: clamp((c.eco.gdp / s.goalBase.gdp - 1) / 0.15, 0, 1), text: `${((c.eco.gdp / s.goalBase.gdp) * 100).toFixed(0)}% of start` }), pay: cash(0.01) },
  { id: 'trade', title: 'Open new markets', desc: 'Sign three more trade agreements than you started with.', reward: `Reward: ${R(0.005)} · reputation +3`,
    progress: (s, c) => { const n = partnersOf(s, c.id, 'trade').length; return { value: clamp((n - s.goalBase.trade) / 3, 0, 1), text: `${Math.max(0, n - s.goalBase.trade)} / 3 new` }; }, pay: (c) => { c.eco.cash += 0.005 * c.eco.gdp; c.reputation = clamp(c.reputation + 3, 0, 100); } },
  { id: 'infra', title: 'Build modern infrastructure', desc: 'Raise infrastructure quality to 65.', reward: `Reward: ${R(0.006)}`,
    progress: (_s, c) => ({ value: clamp(c.eco.infra / 65, 0, 1), text: `${c.eco.infra.toFixed(0)} / 65` }), pay: cash(0.006) },
  { id: 'tech', title: 'Technological leap', desc: 'Raise technology by 8 points.', reward: `Reward: ${R(0.008)}`,
    progress: (s, c) => ({ value: clamp((c.eco.tech - s.goalBase.tech) / 8, 0, 1), text: `+${Math.max(0, c.eco.tech - s.goalBase.tech).toFixed(1)} / 8` }), pay: cash(0.008) },
  { id: 'stable', title: 'A contented nation', desc: 'Reach stability 80.', reward: `Reward: ${R(0.004)}`,
    progress: (_s, c) => ({ value: clamp((c.eco.stability - 40) / 40, 0, 1), text: `${c.eco.stability.toFixed(0)} / 80` }), pay: cash(0.004) },
  { id: 'debt', title: 'Fiscal discipline', desc: 'Cut public debt by 10 percentage points of GDP.', reward: `Reward: ${R(0.004)} · stability +3`,
    progress: (s, c) => ({ value: clamp((s.goalBase.debt - c.eco.debt / c.eco.gdp) / 0.1, 0, 1), text: `${(c.eco.debt / c.eco.gdp * 100).toFixed(0)}% (goal ${(Math.max(0, s.goalBase.debt - 0.1) * 100).toFixed(0)}%)` }), pay: (c) => { c.eco.cash += 0.004 * c.eco.gdp; c.eco.stability = clamp(c.eco.stability + 3, 0, 100); } },
  { id: 'rank', title: 'Rise in the world', desc: 'Climb three places in the GDP rankings (or reach the top 3).', reward: `Reward: ${R(0.01)} · reputation +5`,
    progress: (s, c) => { const r = gdpRank(s, c); const need = Math.max(3, s.goalBase.rank - 3); return { value: r <= need ? 1 : clamp((s.goalBase.rank - r) / Math.max(1, s.goalBase.rank - need), 0, 1), text: `#${r} (from #${s.goalBase.rank})` }; }, pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.reputation = clamp(c.reputation + 5, 0, 100); } },
  { id: 'ally', title: 'Find a friend', desc: 'Sign a defensive alliance.', reward: `Reward: reputation +4 · stability +2`,
    progress: (s, c) => { const n = alliesOf(s, c.id).length; return { value: n > s.goalBase.allies ? 1 : 0, text: `${n} allies` }; }, pay: (c) => { c.reputation = clamp(c.reputation + 4, 0, 100); c.eco.stability = clamp(c.eco.stability + 2, 0, 100); } },
  { id: 'army', title: 'A respected army', desc: 'Reach the top 15 in military power.', reward: `Reward: readiness +5% · ${R(0.005)}`,
    progress: (s, c) => { const r = milRank(s, c); return { value: r <= 15 ? 1 : clamp(1 - (r - 15) / 60, 0, 0.95), text: `#${r}` }; }, pay: (c) => { c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); c.eco.cash += 0.005 * c.eco.gdp; } },
  { id: 'conquer', title: 'First conquest', desc: 'Capture enemy territory in a war.', reward: `Reward: ${R(0.01)} · war exhaustion −10%`,
    progress: (s, c) => { const n = s.owner.filter((o, p) => o === c.id && s.core[p] !== c.id).length; return { value: n > 0 ? 1 : 0, text: `${n} regions held` }; }, pay: (c) => { c.eco.cash += 0.01 * c.eco.gdp; c.mil.exhaustion = Math.max(0, c.mil.exhaustion - 0.1); } },
];

export function stepGoals(s: GameState) {
  if (s.tick % 4 !== 0) return;
  const c = s.countries[s.player];
  if (!c.alive) return;
  for (const g of GOALS) {
    if (s.goalsDone[g.id] !== undefined) continue;
    if (g.progress(s, c).value >= 1) {
      s.goalsDone[g.id] = s.tick;
      g.pay(c);
      logEvent(s, `Objective complete: ${g.title}. ${g.reward.replace('Reward: ', 'You received ')}`, 'info', [s.player], true);
    }
  }
}
void fmtMoney;
