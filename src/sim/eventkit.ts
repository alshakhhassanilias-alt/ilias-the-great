import type { Geo } from './geo';
import { clamp, fmtMoney } from './util';
import { fund } from './actions';
import type { Country, GameState } from './types';

export type D = Record<string, number>;
export interface EventOption { label: string; hint: string; enabled?: (s: GameState, c: Country) => boolean; apply: (s: GameState, c: Country, d: D, geo: Geo) => string }
export interface EventDef {
  id: string; icon: string; title: string; weight: number; cooldown: number;
  eligible: (s: GameState, c: Country, geo: Geo) => D | null;
  text: (s: GameState, c: Country, d: D) => string;
  options: EventOption[];
}

export const name = (s: GameState, id: number) => s.countries[id].name;
export const pay = (s: GameState, c: Country, pct: number) => fund(s, c.id, pct * c.eco.gdp);
export const stab = (c: Country, v: number) => { c.eco.stability = clamp(c.eco.stability + v, 0, 100); };
export const rep = (c: Country, v: number) => { c.reputation = clamp(c.reputation + v, 0, 100); };
export const money = (c: Country, pct: number) => fmtMoney(pct * c.eco.gdp);
export const canPay = (pct: number) => (_s: GameState, c: Country) => (c.eco.debt + pct * c.eco.gdp) / c.eco.gdp < 2.5;

