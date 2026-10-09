import { hash01 } from '../sim/rng';
import type { Country, GameState } from '../sim/types';
import { fmtMoney, fmtNum, fmtPct } from '../sim/util';

export { fmtMoney, fmtNum, fmtPct };

export const GOV: Record<string, string> = { D: 'Democracy', F: 'Hybrid regime', A: 'Autocracy', M: 'Monarchy', C: 'One-party state' };
export const REGION: Record<string, string> = { NA: 'North America', LA: 'Latin America', EU: 'Europe', RU: 'Eurasia', ME: 'Middle East', AF: 'Africa', SA: 'South Asia', EA: 'East Asia', SEA: 'Southeast Asia', OC: 'Oceania' };

export function relLabel(r: number): { text: string; cls: string } {
  if (r >= 70) return { text: 'Close partner', cls: 'green' };
  if (r >= 35) return { text: 'Friendly', cls: 'green' };
  if (r >= 10) return { text: 'Cordial', cls: 'blue' };
  if (r > -10) return { text: 'Neutral', cls: '' };
  if (r > -35) return { text: 'Cool', cls: 'gold' };
  if (r > -60) return { text: 'Hostile', cls: 'red' };
  return { text: 'Bitter rival', cls: 'red' };
}

export function sizeClass(c: Country): string {
  const g = c.eco.gdp;
  if (g > 5e12) return 'Superpower';
  if (g > 1.2e12) return 'Great power';
  if (g > 3e11) return 'Major economy';
  if (g > 4e10) return 'Regional power';
  return 'Small state';
}

/** Intelligence fog: how well can the player see another country's numbers? */
export function fog(s: GameState, target: Country, v: number, key: string): { v: number; approx: boolean } {
  const me = s.countries[s.player];
  if (target.id === s.player) return { v, approx: false };
  const gap = Math.max(0, target.mil.intel - me.mil.intel + 0.25);
  if (gap < 0.08) return { v, approx: false };
  const j = (hash01(target.name, key, Math.floor(s.tick / 52)) - 0.5) * 2 * 0.35 * gap;
  return { v: v * (1 + j), approx: true };
}

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const signed = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
export const signedPct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
