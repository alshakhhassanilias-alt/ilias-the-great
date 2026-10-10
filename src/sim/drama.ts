/** Helpers that decide what is worth a BREAKING banner. */
import type { CountryId, GameState } from './types';

let cache: { tick: number; set: Set<CountryId> } | null = null;
let cacheState: GameState | null = null;

/** The 25 largest economies (refreshed once a week). */
export function majors(s: GameState): Set<CountryId> {
  if (!cache || cacheState !== s || cache.tick !== s.tick) {
    cache = { tick: s.tick, set: new Set(s.countries.filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 25).map((c) => c.id)) };
    cacheState = s;
  }
  return cache.set;
}
export const isMajor = (s: GameState, id: CountryId) => majors(s).has(id);
/** World-shaking: involves the player or two great powers. */
export const isBigNews = (s: GameState, a: CountryId, b: CountryId) => a === s.player || b === s.player || (isMajor(s, a) && isMajor(s, b));

export const MILESTONES = [25_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];
export const fmtCas = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${Math.round(n / 1000)},000`);
