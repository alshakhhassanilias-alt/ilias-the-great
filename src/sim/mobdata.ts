/**
 * Mobilisation and war strategy: the data only (no imports but types), so doctrines.ts and economy.ts can read the
 * effects without import cycles. The rules live in warmode.ts.
 */
import type { Country } from './types';
import type { Eff } from './doctrines';

export type MobLevel = 0 | 1 | 2 | 3;
export interface Mobilisation {
  level: MobLevel; name: string; short: string; icon: string; pros: string[]; cons: string[];
  /** effects on the armed forces (manpower, readiness through doctrines' Eff) */
  eff: Eff;
  /** multiplier on the economy's output while it lasts */
  output: number;
  /** stability drift per year; reservists called up per year as a share of the standing army */
  stab: number; callUp: number;
}
export const MOBILISATION: Mobilisation[] = [
  { level: 0, name: 'Peacetime footing', short: 'Peacetime', icon: 'olive', pros: ['The economy runs normally'], cons: ['The army fights with what it has'], eff: {}, output: 1, stab: 0, callUp: 0 },
  { level: 1, name: 'Partial mobilisation', short: 'Partial', icon: 'flag', pros: ['Reservists called up: the army grows by 15% over a year', 'Manpower +15%'], cons: ['Output −1%', 'Stability −2 a year'], eff: { manpower: 1.15, def: 1.03 }, output: 0.99, stab: -2, callUp: 0.15 },
  { level: 2, name: 'General mobilisation', short: 'General', icon: 'medal', pros: ['The army grows by 35% over a year', 'Manpower +35%, offence +4%, defence +6%'], cons: ['Output −3%', 'Stability −5 a year', 'Liberals and unions uneasy'], eff: { manpower: 1.35, off: 1.04, def: 1.06 }, output: 0.97, stab: -5, callUp: 0.35 },
  { level: 3, name: 'Total war economy', short: 'Total war', icon: 'factory', pros: ['The army grows by 60% over a year', 'Factories turn to the war: arms production +60%', 'Manpower +60%, offence +8%, defence +10%'], cons: ['Output −7%', 'Stability −9 a year, inflation rises', 'Every faction but the army and nationalists suffers'], eff: { manpower: 1.6, off: 1.08, def: 1.1 }, output: 0.93, stab: -9, callUp: 0.6 },
];
export const mobOf = (c: Country): Mobilisation => MOBILISATION[c.mob ?? 0] ?? MOBILISATION[0];

export type StratId = 'blitz' | 'depth' | 'attrition' | 'balanced';
export interface Strategy { id: StratId; name: string; short: string; icon: string; desc: string; pros: string[]; cons: string[]; eff: Eff; /** extra exhaustion per year: [ours, theirs] */ wear: [number, number] }
export const STRATEGIES: Strategy[] = [
  { id: 'balanced', name: 'Balanced campaign', short: 'Balanced', icon: 'compass', desc: 'Fight on every front as it comes.', pros: ['No extra risk'], cons: ['No edge either'], eff: {}, wear: [0, 0] },
  { id: 'blitz', name: 'Lightning offensive', short: 'Blitz', icon: 'bolt', desc: 'Everything forward at once, before they can organise.', pros: ['Offence +15%'], cons: ['Defence −8%', 'Our exhaustion rises 50% faster'], eff: { off: 1.15, def: 0.92 }, wear: [0.12, 0] },
  { id: 'depth', name: 'Defence in depth', short: 'Depth', icon: 'shield', desc: 'Trade space for time, dig in, let them break on our lines.', pros: ['Defence +18%', 'Support holds while we defend'], cons: ['Offence −12%'], eff: { def: 1.18, off: 0.88 }, wear: [-0.04, 0.04] },
  { id: 'attrition', name: 'War of attrition', short: 'Attrition', icon: 'hourglass', desc: 'Bleed them: raids, artillery, blockade. Slow, grim, effective.', pros: ['The enemy tires much faster'], cons: ['We tire faster too', 'Civilian suffering costs reputation'], eff: { off: 0.97 }, wear: [0.06, 0.16] },
];
export const stratById = (id: string | undefined) => STRATEGIES.find((x) => x.id === id) ?? STRATEGIES[0];
