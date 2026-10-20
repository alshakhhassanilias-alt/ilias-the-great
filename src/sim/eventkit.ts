import type { Geo } from './geo';
import { clamp, fmtMoney } from './util';
import { fund } from './actions';
import type { Country, GameState } from './types';

export type D = Record<string, number>;
export interface EventOption { label: string; hint: string; enabled?: (s: GameState, c: Country) => boolean; /** why a disabled option is locked (default: cannot afford) */ why?: (s: GameState, c: Country) => string; apply: (s: GameState, c: Country, d: D, geo: Geo) => string }
export interface EventDef {
  id: string; icon: string; title: string; weight: number; cooldown: number;
  eligible: (s: GameState, c: Country, geo: Geo) => D | null;
  text: (s: GameState, c: Country, d: D) => string;
  options: EventOption[];
  /** seconds-of-game-time the offer stays open (weeks). Default 40; urgent items default to 14 */
  ttl?: number;
  /** urgent items are flagged red and slow fast-forward down */
  urgent?: boolean;
  /** what happens if the player lets it lapse (default: nothing, the chance is gone) */
  lapse?: (s: GameState, c: Country, d: D, geo: Geo) => string;
  /** who brings it to you (shown with their portrait); default: the minister in charge */
  speaker?: (s: GameState, c: Country, d: D) => { name: string; role: string; cid: number; kind: 'leader' | 'minister' | 'general' } | null;
  /** part of a multi-stage crisis: shown as "stage n of m" */
  arc?: { title: string; stage: number; of: number };
}

export const name = (s: GameState, id: number) => s.countries[id].name;
/**
 * One-off decision costs are written as "Costs 1% of GDP" in the event tables and charged at this fraction of that,
 * so a handful of decisions no longer empties a treasury that a year of normal income cannot refill. The UI shows
 * the real price (`costHint`).
 */
export const DECISION_COST = 0.5;
export const pay = (s: GameState, c: Country, pct: number) => fund(s, c.id, pct * DECISION_COST * c.eco.gdp);
export const stab = (c: Country, v: number) => { c.eco.stability = clamp(c.eco.stability + v, 0, 100); };
export const rep = (c: Country, v: number) => { c.reputation = clamp(c.reputation + v, 0, 100); };
export const money = (c: Country, pct: number) => fmtMoney(pct * DECISION_COST * c.eco.gdp);
export const canPay = (pct: number) => (_s: GameState, c: Country) => (c.eco.debt + pct * DECISION_COST * c.eco.gdp) / c.eco.gdp < 2.5;
/** "Costs 1% of GDP" in a table → "Costs $23B (0.5% of GDP)": the price actually charged, in money. */
export function costHint(c: Country, hint: string): string {
  return hint.replace(/Costs ([\d.]+)% of GDP/, (_m, v: string) => { const p = (Number(v) / 100) * DECISION_COST; return `Costs ${fmtMoney(p * c.eco.gdp)} (${(p * 100).toFixed(p < 0.001 ? 2 : 1)}% of GDP)`; });
}
/** The amount a hint's one-off cost will actually charge, or 0. */
export function hintCost(c: Country, hint: string): number {
  const m = /Costs ([\d.]+)% of GDP/.exec(hint);
  return m ? (Number(m[1]) / 100) * DECISION_COST * c.eco.gdp : 0;
}

