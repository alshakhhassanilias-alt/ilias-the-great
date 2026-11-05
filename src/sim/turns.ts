/**
 * Turning points: how a country changes sides. Never at random, only through a chain of causes:
 *
 *   crisis      a lost war, an economic collapse, crushing sanctions, a government losing its grip
 *   → cracks    the regime changes faces sooner than it would; under a deep crisis it may fall outright
 *   → a turn    the new leader breaks with the old line (an opener in a besieged autocracy, a nationalist or
 *               "country first" leader in a disappointed Western country), with a mandate to do so
 *   → a thaw    the country steers toward the other camp; the camp it courts warms to it and drops its guard,
 *               the camp it leaves cools; its alliances sort themselves out on their own
 *   → backlash  the old guard fights back: the further and faster the turn, the likelier a coup that restores
 *               the old order. A turn can be reversed.
 *
 * Leaders' economic policies live here too: reformers and traders lift productivity a little every year, tariffs,
 * cronyism and dogma cost a little; debt crises hit countries that borrow too much at high rates.
 */
import { clamp } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { addRelation } from './relations';
import { strength } from './military';
import { isMajor } from './drama';
import { moodOf } from './minds';
import type { Country, GameState } from './types';

/**
 * How deep a country's crisis runs, 0..1. Only acute shocks count, not chronic hardship (years of sanctions are a
 * way of life, not a turning point): a lost war, a collapsing economy, a debt crisis, runaway inflation, a government
 * losing its grip. A Western country humiliated by an Eastern aggressor clings tighter to the West, so for it only
 * the economy and the state's grip count.
 */
export function crisisOf(c: Country, s?: GameState): number {
  const e = c.eco, m = moodOf(c);
  const collapse = clamp((-e.growth - 0.01) / 0.05, 0, 1) + (e.inflation > 0.25 ? 0.4 : 0) + (s && s.tick - (s.stats[`debtCrisis:${c.id}`] ?? -9999) < 104 ? 0.5 : 0);
  const acute = Math.max((c.orient ?? 0) > 0.3 ? 0 : m.shame, collapse);
  return clamp((acute - 0.3) / 0.5 + (e.stability < 30 ? (30 - e.stability) / 60 : 0), 0, 1);
}

const OPENING = ['reformer', 'pragmatist', 'dove', 'mercantilist', 'internationalist'];
const BREAKING = ['nationalist', 'strongman', 'isolationist'];

/** At a succession in a country in crisis: does the new leader break with the old line? (sets lean, mandate, turn) */
export function turningLeader(s: GameState, c: Country, gen: number): boolean {
  const L = c.leader;
  const o = c.orient ?? 0;
  const cr = crisisOf(c, s);
  if (!L || c.isPlayer || cr < 0.25 || Math.abs(o) < 0.4) return false;
  if (s.tick - (s.stats[`turnAt:${c.id}`] ?? -9999) < 520) return false; // after a turn (or its reversal), a decade before the next
  const pool = o < 0 ? OPENING : BREAKING;
  if (!L.traits.some((t) => pool.includes(t))) return false;
  if (hash01('turn', c.id, gen, s.settings.seed) > cr * (o < 0 ? 0.5 : 0.4)) return false;
  L.lean = +clamp(o - Math.sign(o) * (0.7 + 0.6 * cr), -1, 1).toFixed(2);
  L.turn = { from: +o.toFixed(2), since: s.tick };
  s.stats[`turnAt:${c.id}`] = s.tick;
  L.mandate = o < 0 ? 'promising to end the isolation and make peace with the West' : 'promising to break with the alliances that failed the country';
  return true;
}

/** Quarterly, for a leader who is turning: steer toward the other camp; that camp warms, the old one cools. */
export function stepThaw(s: GameState, c: Country) {
  const L = c.leader;
  if (!L?.turn || L.lean === undefined) return;
  const o = c.orient ?? 0;
  c.orient = clamp(o + (L.lean - o) * 0.09, -1, 1);
  const dir = Math.sign(L.lean - L.turn.from);
  if (dir > 0) c.hostile = Math.max(0, (c.hostile ?? 0) - 0.05);
  const camp = (sign: number) => s.countries.filter((x) => x.alive && x.id !== c.id && (x.orient ?? 0) * sign > 0.5).sort((a, b) => strength(b) - strength(a)).slice(0, 3);
  for (const x of camp(dir)) addRelation(s, c.id, x.id, 2);
  for (const x of camp(-dir)) addRelation(s, c.id, x.id, -1.5);
}

/** Monthly: the old guard may strike back against a turn. Returns true if it did (the caller crowns the hardliner). */
export function backlashDue(s: GameState, c: Country): boolean {
  const T = c.leader?.turn;
  if (!T) return false;
  const shift = Math.abs((c.orient ?? 0) - T.from);
  const p = 0.005 * (shift > 0.25 ? 1.5 : 0.6) * (1.3 - c.eco.stability / 100) * (c.gov === 'A' || c.gov === 'C' ? 1.4 : 0.7);
  return nextRand(s) < p;
}

// ------------------------------------------------------------------ economic policy
/** Yearly productivity effect of a leader's economic instincts (about ±0.5% a year at the extremes). */
const TRAIT_TFP: Record<string, number> = {
  reformer: 0.003, mercantilist: 0.0015, internationalist: 0.001, pragmatist: 0.0005, dove: 0.0005,
  isolationist: -0.002, nationalist: -0.0015, strongman: -0.002, paranoid: -0.001, hawk: -0.0005,
};
export function policyTfp(c: Country): number {
  const L = c.leader;
  if (!L || c.isPlayer) return 0;
  let t = 0;
  for (const tr of L.traits) t += tr === 'ideologue' ? (c.gov === 'C' || c.gov === 'A' ? -0.0015 : 0) : TRAIT_TFP[tr] ?? 0;
  if (c.goal?.kind === 'growth') t += 0.001;
  return t;
}
export const policyLabel = (v: number) => (v > 0.0025 ? 'pro-growth reforms' : v > 0.0008 ? 'business-friendly' : v < -0.0025 ? 'tariffs, cronyism or dogma are costing growth' : v < -0.0008 ? 'protectionist' : 'steady');

/** Monthly: a country that borrows too much at high rates can lose the markets' trust. */
export function stepDebtCrisis(s: GameState, c: Country) {
  const e = c.eco, ratio = e.debt / Math.max(1, e.gdp);
  if (c.isPlayer || ratio < 1.25 || e.avgRate < 0.05 || s.tick - (s.stats[`debtCrisis:${c.id}`] ?? -9999) < 260) return;
  if (nextRand(s) > 0.012 * Math.min(3, (ratio - 1.05) * 4)) return;
  s.stats[`debtCrisis:${c.id}`] = s.tick;
  e.tfp *= 0.97; e.capital *= 0.97;
  e.stability = Math.max(0, e.stability - 10);
  if (c.mood) c.mood.pain = Math.min(1, c.mood.pain + 0.3);
  logEvent(s, `💥 DEBT CRISIS in ${c.name}: markets refuse to roll over its debt (${(ratio * 100).toFixed(0)}% of GDP); the economy contracts and the government reels.`, 'econ', [c.id], isMajor(s, c.id), isMajor(s, c.id) ? { big: true, prov: c.capital } : undefined);
}
