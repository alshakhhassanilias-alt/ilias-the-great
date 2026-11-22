/**
 * The race: every nation ranked by power (its economy, its army and its influence in the world, as shares of the
 * world's). It is what the game is about: climb the table. Each tier you reach (top 50, 20, 10, 5, 3, 1) is a moment
 * with a reward; hold first place for five years and you are the world's superpower (a victory you can play on from).
 */
import { strength } from './military';
import { sphereWeight } from './influence';
import { alliesOf } from './relations';
import { logEvent } from './log';
import { clamp } from './util';
import type { Country, CountryId, GameState } from './types';

export interface PowerRow { id: CountryId; score: number; eco: number; mil: number; inf: number }
let cache: { st: GameState; tick: number; rows: PowerRow[]; rank: Map<number, number> } | null = null;

/** The world power table, strongest first (computed once a week). Scores are out of 1000 (the world's total). */
export function powerTable(s: GameState): PowerRow[] {
  if (cache && cache.st === s && cache.tick === s.tick) return cache.rows;
  const alive = s.countries.filter((c) => c.alive);
  // influence: standing (reputation × size × allies) plus the countries in its sphere
  const inf = (c: Country) => (c.reputation / 100) * Math.sqrt(Math.max(0, c.eco.gdp)) * (1 + 0.12 * Math.min(10, alliesOf(s, c.id).length)) + 0.6 * sphereWeight(s, c.id);
  let tg = 0, tm = 0, ti = 0;
  const raw = alive.map((c) => { const g = c.eco.gdp, m = strength(c), i = inf(c); tg += g; tm += m; ti += i; return { c, g, m, i }; });
  const rows = raw.map(({ c, g, m, i }) => {
    const eco = (1000 * g) / Math.max(1, tg), mil = (1000 * m) / Math.max(1, tm), infl = (1000 * i) / Math.max(1, ti);
    return { id: c.id, eco, mil, inf: infl, score: 0.45 * eco + 0.35 * mil + 0.2 * infl };
  }).sort((a, b) => b.score - a.score);
  cache = { st: s, tick: s.tick, rows, rank: new Map(rows.map((r, i) => [r.id, i + 1])) };
  return rows;
}
export const powerRank = (s: GameState, id: CountryId) => { powerTable(s); return cache!.rank.get(id) ?? 999; };

/** the tiers of the race */
export const TIERS = [50, 20, 10, 5, 3, 1] as const;
export const tierLabel = (t: number) => (t === 1 ? 'the world\'s superpower' : `the top ${t}`);
/** The next tier above the country's rank, or 0 at the top. */
export const nextTier = (rank: number) => TIERS.find((t) => t < rank) ?? 0;

/** Where the player stands in the race: rank, score, the country just above and how close it is. */
export function raceOf(s: GameState) {
  const rows = powerTable(s);
  const i = rows.findIndex((r) => r.id === s.player);
  const me = rows[i], above = i > 0 ? rows[i - 1] : null;
  const tier = nextTier(i + 1);
  return {
    rank: i + 1, score: me?.score ?? 0, above: above ? { id: above.id, score: above.score, gap: above.score - (me?.score ?? 0) } : null,
    /** 0..1: how close you are to passing the country above */
    toNext: above ? clamp((me?.score ?? 0) / Math.max(0.001, above.score), 0, 1) : 1,
    tier, tierRow: tier ? rows[tier - 1] : null, me,
    yearsTop: (s.stats.topSince ?? -1) >= 0 && i === 0 ? (s.tick - s.stats.topSince!) / 52 : 0,
  };
}

/** Monthly: milestones for climbing the table, and the superpower victory. */
export function stepRace(s: GameState) {
  if (s.tick % 4 !== 1) return;
  const P = s.countries[s.player];
  if (!P?.alive) return;
  const rank = powerRank(s, s.player);
  if (s.stats.powerStart === undefined) s.stats.powerStart = rank;
  s.stats.powerBest = Math.min(s.stats.powerBest ?? rank, rank);
  // tiers reached for the first time: a moment, and a reward
  for (const t of TIERS) {
    if (rank > t || s.stats[`tier:${t}`] !== undefined || t >= (s.stats.powerStart ?? 999)) continue;
    s.stats[`tier:${t}`] = s.tick;
    P.reputation = clamp(P.reputation + 4, 0, 100);
    P.eco.stability = clamp(P.eco.stability + 4, 0, 100);
    if (P.politics) P.politics.pc = Math.min(100, P.politics.pc + 15);
    logEvent(s, t === 1 ? `🏆 ${P.name.toUpperCase()} IS THE MOST POWERFUL NATION ON EARTH. Hold first place for five years to win.` : `🏆 ${P.name.toUpperCase()} ENTERS THE WORLD'S TOP ${t}. Reputation +4, stability +4, political capital +15.`, 'info', [s.player], true, { big: true, prov: P.capital });
  }
  // first place, held for five years: the superpower victory
  if (rank === 1) { if ((s.stats.topSince ?? -1) < 0) s.stats.topSince = s.tick; }
  else s.stats.topSince = -1;
  if (!s.victory && rank === 1 && s.tick - (s.stats.topSince ?? s.tick) >= 260 && (s.settings.victory ?? 'superpower') === 'superpower') {
    s.victory = { achieved: true, text: `Victory! ${P.name} has been the most powerful nation on Earth for five years. You may play on.` };
    logEvent(s, s.victory.text, 'info', [s.player], true, { big: true, prov: P.capital });
  }
}
