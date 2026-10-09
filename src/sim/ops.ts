/** Covert operations against other countries. Success depends on the intelligence gap; failure has consequences. */
import { nextRand } from './rng';
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';
import { addRelation, getRelation } from './relations';
import { imposeSanction } from './diplomacy';
import type { CountryId, GameState } from './types';

export type OpKind = 'intel' | 'influence' | 'sabotage' | 'unrest' | 'steal';
export const OPS: Record<OpKind, { label: string; desc: string; cost: number; cooldown: number }> = {
  intel: { label: 'Gather intelligence', desc: 'See their true numbers for a year.', cost: 0.0005, cooldown: 26 },
  influence: { label: 'Influence campaign', desc: 'Win hearts and minds: relations +10.', cost: 0.0015, cooldown: 26 },
  steal: { label: 'Steal technology', desc: 'Close part of the tech gap.', cost: 0.002, cooldown: 52 },
  sabotage: { label: 'Sabotage infrastructure', desc: 'Damage their infrastructure and economy.', cost: 0.002, cooldown: 39 },
  unrest: { label: 'Incite unrest', desc: 'Fund protests: their stability drops.', cost: 0.0025, cooldown: 39 },
};

export function runOp(s: GameState, from: CountryId, to: CountryId, kind: OpKind): { ok: boolean; message: string } {
  const A = s.countries[from], B = s.countries[to];
  const op = OPS[kind];
  const key = `${to}:${kind}`;
  if ((s.opCooldown[key] ?? -999) + op.cooldown > s.tick) return { ok: false, message: `Wait ${Math.ceil((s.opCooldown[key] + op.cooldown) - s.tick)} more weeks before repeating this operation` };
  const cost = op.cost * A.eco.gdp;
  if (A.eco.cash < cost) return { ok: false, message: `Not enough cash (${fmtMoney(cost)} needed)` };
  A.eco.cash -= cost;
  s.opCooldown[key] = s.tick;
  const p = opChance(s, from, to, kind);
  if (nextRand(s) > p) {
    addRelation(s, from, to, -18);
    A.reputation = clamp(A.reputation - 4, 0, 100);
    logEvent(s, `${A.name}'s ${op.label.toLowerCase()} against ${B.name} was exposed!`, 'diplo', [from, to], from === s.player || to === s.player);
    if (to !== s.player && B.ai.ideology > 0.5 && nextRand(s) < 0.35) imposeSanction(s, to, from, 1);
    return { ok: false, message: `The operation was exposed. Relations −18, reputation −4.` };
  }
  switch (kind) {
    case 'intel': s.intelUntil[to] = s.tick + 52; return { ok: true, message: `Agents in ${B.name} deliver their true numbers for a year.` };
    case 'influence': addRelation(s, from, to, 10); return { ok: true, message: `Relations with ${B.name} improve (now ${getRelation(s, from, to).toFixed(0)}).` };
    case 'steal': { const g = clamp(0.2 * (B.eco.tech - A.eco.tech), 0.4, 3); A.eco.tech = clamp(A.eco.tech + g, 0, 100); A.mil.milTech += g * 0.6; return { ok: true, message: `Stolen designs raise your technology by ${g.toFixed(1)} points.` }; }
    case 'sabotage': B.eco.infra = Math.max(5, B.eco.infra - 4); B.eco.damage = Math.min(1, B.eco.damage + 0.01); addRelation(s, from, to, -6); return { ok: true, message: `Saboteurs damaged ${B.name}'s infrastructure (−4).` };
    case 'unrest': B.eco.stability = Math.max(0, B.eco.stability - 9); addRelation(s, from, to, -6); return { ok: true, message: `Protests erupt in ${B.name} (stability −9).` };
  }
}

export function opChance(s: GameState, from: CountryId, to: CountryId, kind: OpKind): number {
  const A = s.countries[from], B = s.countries[to];
  return clamp(clamp(0.4 + 0.65 * (A.mil.intel - B.mil.intel) + 0.12, 0.12, 0.92) * (kind === 'intel' || kind === 'influence' ? 1.15 : 1), 0.1, 0.95);
}
