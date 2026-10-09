import type { Country, GameState } from '../sim/types';
import { ALPHA, factors, fiscalNow, taxBurden } from '../sim/economy';
import { isAtWar } from '../sim/relations';
import { fmtMoney } from '../sim/util';

export const DRIVER_LABEL: Record<string, string> = {
  capital: 'Capital investment (factories, equipment)',
  labor: 'Workforce size & employment',
  tfp: 'Productivity & technology',
  infra: 'Infrastructure quality',
  energy: 'Energy supply & prices',
  trade: 'Trade access & sanctions',
  stability: 'Political stability',
  taxes: 'Tax burden',
  war: 'War damage & mobilisation',
  convergence: 'Adjustment lag (output catching up)',
};

export function drivers(c: Country): { key: string; label: string; v: number }[] {
  const ex = c.eco.explain;
  return Object.keys(DRIVER_LABEL).map((k) => ({ key: k, label: DRIVER_LABEL[k], v: ex[k] ?? 0 })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
}

export function growthNarrative(c: Country): string {
  const g = c.eco.growth;
  const d = drivers(c).filter((x) => x.key !== 'convergence' && Math.abs(x.v) >= 0.0008);
  const pos = d.filter((x) => x.v > 0).slice(0, 2);
  const neg = d.filter((x) => x.v < 0).slice(0, 2);
  const pp = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
  let t = g >= 0 ? `Real GDP is growing ${(g * 100).toFixed(1)}% a year` : `Real GDP is shrinking ${(-g * 100).toFixed(1)}% a year`;
  if (pos.length) t += `, helped by ${pos.map((x) => `${x.label.toLowerCase()} (${pp(x.v)})`).join(' and ')}`;
  if (neg.length) t += `${pos.length ? ',' : ';'} held back by ${neg.map((x) => `${x.label.toLowerCase()} (${pp(x.v)})`).join(' and ')}`;
  return t + '.';
}

/** Level effects: how far below its full potential is the economy because of each factor? */
export function drags(c: Country, s: GameState): { label: string; pct: number; tip: string }[] {
  const f = factors(c, s.market.priceE);
  const out: { label: string; pct: number; tip: string }[] = [];
  const add = (label: string, factor: number, tip: string) => { if (factor < 0.995) out.push({ label, pct: (factor - 1) * 100, tip }); };
  add('Tax distortion', f.tax, `Total tax burden is ${(taxBurden(c.budget) * c.eco.collection * 100).toFixed(0)}% of GDP; very high rates discourage work and investment.`);
  add('Instability', f.stab, 'Unrest disrupts production and investment.');
  add('Energy shortage', f.energy, 'Not enough power for industry; build energy capacity or secure imports.');
  add('War damage', f.war, 'Bombing and fighting have destroyed productive capacity.');
  if (f.trade < 1) add('Trade barriers', f.trade, 'Sanctions, blockades or war have cut trade.');
  if (f.infra < 1) add('Weak infrastructure', f.infra, 'Poor roads, ports and grids reduce productivity.');
  return out;
}

export interface Alert { level: 'bad' | 'warn' | 'info'; text: string; tab?: 'economy' | 'military' | 'diplomacy' }
export function alertsFor(c: Country, s: GameState): Alert[] {
  const e = c.eco, out: Alert[] = [];
  const fn = fiscalNow(c, s);
  const bal = fn.balance / e.gdp;
  if (bal < -0.06) out.push({ level: 'bad', text: `Budget deficit is ${(-bal * 100).toFixed(1)}% of GDP (${fmtMoney(-fn.balance)}/yr). Debt is rising fast.`, tab: 'economy' });
  else if (bal < -0.035) out.push({ level: 'warn', text: `Deficit of ${(-bal * 100).toFixed(1)}% of GDP is adding to debt.`, tab: 'economy' });
  if (e.debt / e.gdp > 1.5) out.push({ level: 'bad', text: `Debt is ${(100 * e.debt / e.gdp).toFixed(0)}% of GDP; interest costs ${fmtMoney(e.interest)}/yr.`, tab: 'economy' });
  if (e.inflation > 0.08) out.push({ level: 'bad', text: `Inflation is ${(e.inflation * 100).toFixed(1)}%.`, tab: 'economy' });
  if (e.unemployment > e.uNat + 0.04) out.push({ level: 'warn', text: `Unemployment is ${(e.unemployment * 100).toFixed(1)}% (normal ${(e.uNat * 100).toFixed(1)}%).`, tab: 'economy' });
  if (e.energyUnmet > 0.03) out.push({ level: 'bad', text: `Energy shortage: ${(e.energyUnmet * 100).toFixed(0)}% of demand unmet.`, tab: 'economy' });
  if (e.foodUnmet > 0.03) out.push({ level: 'bad', text: `Food shortage: ${(e.foodUnmet * 100).toFixed(0)}% of demand unmet. Famine threatens stability.`, tab: 'economy' });
  if (e.stability < 30) out.push({ level: 'bad', text: `Stability is critical (${e.stability.toFixed(0)}). Risk of upheaval.`, tab: 'economy' });
  else if (e.stability < 45) out.push({ level: 'warn', text: `Stability is low (${e.stability.toFixed(0)}).`, tab: 'economy' });
  if (e.sanctionShare > 0.1) out.push({ level: 'warn', text: `Sanctions are costing you ${(e.sanctionShare * 100).toFixed(0)}% of trade access.`, tab: 'diplomacy' });
  if (e.blockade > 0.1) out.push({ level: 'bad', text: `Naval blockade cuts ${(e.blockade * 100).toFixed(0)}% of sea trade.`, tab: 'military' });
  if (isAtWar(s, c.id)) out.push({ level: 'warn', text: `At war. Exhaustion ${(c.mil.exhaustion * 100).toFixed(0)}%.`, tab: 'military' });
  if (c.mil.readiness < 0.5) out.push({ level: 'warn', text: `Military readiness is only ${(c.mil.readiness * 100).toFixed(0)}%: the budget does not cover upkeep.`, tab: 'military' });
  if (e.occupation > 0.15) out.push({ level: 'warn', text: `Recently conquered land is causing unrest (${(e.occupation * 100).toFixed(0)}%).`, tab: 'economy' });
  void ALPHA;
  return out;
}
