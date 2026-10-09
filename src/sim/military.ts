/**
 * Country-level military model. Strength is derived from numbers *and* equipment, technology, readiness,
 * and supply. Money is in base-price (real) dollars; nominal values multiply by the price level.
 */
import { DT } from './types';
import type { Country, GameState } from './types';
import type { Geo } from './geo';
import { clamp } from './util';
import { isAtWar } from './relations';

export const BENCH_EQUIP_PER_TROOP = 150_000;
export const MAINT_RATE = 0.05;

export const equipTotal = (m: Country['mil']) => m.equipArmy + m.equipAir + m.equipNavy;
export const equipRatio = (m: Country['mil']) => (m.troops > 0 ? m.equipArmy / (m.troops * BENCH_EQUIP_PER_TROOP) : 0);
export const quality = (m: Country['mil']) => 0.35 + 0.65 * Math.pow(clamp(equipRatio(m), 0, 1.6), 0.7);
export const techMult = (m: Country['mil']) => 0.6 + 0.8 * (m.milTech / 100);
export const landPower = (m: Country['mil'], troops = m.troops) => troops * quality(m) * techMult(m);
export const airPower = (m: Country['mil']) => m.equipAir * techMult(m);
export const navalPower = (m: Country['mil']) => m.equipNavy * techMult(m);
export const manpower = (c: Country) => Math.max(0, c.eco.laborForce * (0.22 + 0.005 * c.mil.bld.barracks) - c.mil.troops);

/** Single comparable strength number ("troop equivalents"). */
export function strength(c: Country): number {
  const m = c.mil;
  const ready = 0.4 + 0.6 * m.readiness;
  return landPower(m) * ready + (0.8 * airPower(m)) / 1e6 + (0.4 * navalPower(m)) / 1e6;
}
export const strengthIndex = (c: Country) => strength(c) / 1000;

export function stepMilitary(c: Country, s: GameState, _geo: Geo): { total: number } {
  const m = c.mil, e = c.eco, b = c.budget;
  const budgetReal = b.military * e.realGdp;
  const personnel = m.troops * m.unitCost;
  const maint = MAINT_RATE * equipTotal(m);
  const upkeepReal = personnel + maint;
  const avail = budgetReal * DT;
  const need = upkeepReal * DT;
  const paid = Math.min(avail, need);
  const short = need - paid;
  const ratio = need > 0 ? avail / need : 2;
  let tgt = clamp(0.35 + 0.45 * Math.min(ratio, 1.5) + 0.02 * m.bld.barracks, 0.2, 0.97);
  if (e.stability < 30) tgt *= 0.7 + (0.3 * e.stability) / 30;
  m.readiness += (tgt - m.readiness) * 0.06;
  m.readiness = clamp(m.readiness, 0.05, 1);

  let proc = Math.max(0, avail - paid);
  if (m.warEconomy) {
    if (isAtWar(s, c.id)) { proc *= 1.6; e.stability = Math.max(0, e.stability - 0.03); e.monetary += 0.0004; }
    else m.warEconomy = false; // war footing ends with the war
  }
  const mix = b.milArmy + b.milAir + b.milNavy || 1;
  m.equipArmy += (proc * 0.9 * b.milArmy) / mix;
  m.equipAir += (proc * 0.9 * b.milAir) / mix;
  m.equipNavy += (proc * 0.9 * b.milNavy) / mix;
  if (short > 0 && need > 0) {
    const loss = 1 - MAINT_RATE * DT * (short / need);
    m.equipArmy *= loss; m.equipAir *= loss; m.equipNavy *= loss;
  }
  m.upkeep = upkeepReal * e.price;
  m.procurement = (proc / DT) * e.price;

  const intelTarget = clamp(0.1 + e.tech / 200 + 90 * b.intel, 0.05, 0.95);
  m.intel += (intelTarget - m.intel) * 0.05;
  m.milTech += (e.tech + (e.prev.milEdge ?? 0) - m.milTech) * 0.01 + 0.5 * DT * (proc / Math.max(equipTotal(m), 1));
  m.milTech = clamp(m.milTech, 5, 110);
  m.supply = clamp(0.3 + 0.5 * (e.infra / 100) + 0.2 * (e.tech / 100), 0.2, 1);
  if (!isAtWar(s, c.id)) m.exhaustion = Math.max(0, m.exhaustion - 0.004);
  return { total: b.military * e.gdp };
}
