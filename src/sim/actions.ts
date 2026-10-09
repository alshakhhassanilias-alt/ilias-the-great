/**
 * Actions available to both the player and AI. Every action takes effect IMMEDIATELY (no timers):
 * money moves now, capacity / forces / stats change now, and the next tick reflects the new state.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { manpower } from './military';
import { fmtMoney, fmtNum } from './util';
import { evaluatePeace, makePeace, type PeaceTerms, declareWar, termProvinces } from './war';
import { acceptOffer, cancelTreaty, declineOffer, imposeSanction, liftSanction, propose, type Proposal } from './diplomacy';
import { warBetween } from './relations';
import type { Budget, GameState, ProvId } from './types';

export interface ActionResult { ok: boolean; message: string }
const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });

export const BUDGET_LIMITS: Record<keyof Budget, [number, number]> = {
  taxIncome: [0, 0.7], taxCorporate: [0, 0.6], taxVat: [0, 0.35], social: [0, 0.35], infra: [0, 0.12], industry: [0, 0.12],
  education: [0, 0.12], military: [0, 0.25], intel: [0, 0.015], milArmy: [0, 1], milAir: [0, 1], milNavy: [0, 1],
};

export function setBudget(s: GameState, cid: number, key: keyof Budget, value: number): ActionResult {
  const c = s.countries[cid];
  const [lo, hi] = BUDGET_LIMITS[key];
  c.budget[key] = clamp(value, lo, hi);
  return ok('Policy updated');
}

/** Pay from cash, borrowing the shortfall if the country can still access credit. */
export function fund(s: GameState, cid: number, cost: number): ActionResult {
  const c = s.countries[cid], e = c.eco;
  if (cost <= e.cash) { e.cash -= cost; return ok('Paid from the treasury'); }
  const need = cost - e.cash;
  if ((e.debt + need) / e.gdp > 2.5) return fail(`Not enough funds (${fmtMoney(cost)} needed) and creditors refuse further lending`);
  e.debt += need;
  e.cash = 0;
  return ok(`Financed by borrowing ${fmtMoney(need)}`);
}
export const costOf = (s: GameState, cid: number, pctGdp: number) => pctGdp * s.countries[cid].eco.gdp;

export type Project = 'industry' | 'infra' | 'energy' | 'farms' | 'research';
export function buildProject(s: GameState, cid: number, kind: Project, pctGdp: number): ActionResult {
  const c = s.countries[cid], e = c.eco;
  const cost = costOf(s, cid, pctGdp);
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  const real = cost / e.price;
  switch (kind) {
    case 'industry':
      e.capital += real * 0.85;
      return ok(`Factories built: industrial capital +${((real * 0.85) / (e.capital - real * 0.85) * 100).toFixed(1)}%. ${f.message}`);
    case 'infra': {
      const gain = 3 * (pctGdp / 0.01) * (1 - e.infra / 110);
      e.infra = clamp(e.infra + gain, 5, 100);
      return ok(`Infrastructure +${gain.toFixed(1)} points. ${f.message}`);
    }
    case 'energy': {
      const add = (real * 0.9) / s.market.priceE;
      e.energyCap += add;
      return ok(`Power capacity +${((add / (e.energyCap - add)) * 100).toFixed(1)}%. ${f.message}`);
    }
    case 'farms': {
      const add = (real * 0.9) / s.market.priceF;
      e.foodCap += add;
      return ok(`Farmland & logistics: food output +${((add / (e.foodCap - add)) * 100).toFixed(1)}%. ${f.message}`);
    }
    case 'research': {
      const gain = 1.5 * (pctGdp / 0.01) * (1 - e.tech / 110);
      e.tech = clamp(e.tech + gain, 5, 100);
      e.tfp *= 1 + 0.002 * (pctGdp / 0.01);
      c.mil.milTech = clamp(c.mil.milTech + gain * 0.5, 5, 110);
      return ok(`Technology +${gain.toFixed(1)} points. ${f.message}`);
    }
  }
}

export function borrow(s: GameState, cid: number, pctGdp: number): ActionResult {
  const e = s.countries[cid].eco;
  const amt = pctGdp * e.gdp;
  if ((e.debt + amt) / e.gdp > 2.5) return fail('Creditors refuse further lending');
  e.debt += amt; e.cash += amt;
  return ok(`Borrowed ${fmtMoney(amt)}`);
}
export function repayDebt(s: GameState, cid: number, pctGdp: number): ActionResult {
  const e = s.countries[cid].eco;
  const amt = Math.min(pctGdp * e.gdp, e.cash, e.debt);
  if (amt <= 0) return fail('No cash available to repay debt');
  e.debt -= amt; e.cash -= amt;
  return ok(`Repaid ${fmtMoney(amt)} of debt`);
}
export function printMoney(s: GameState, cid: number, pctGdp: number): ActionResult {
  const e = s.countries[cid].eco;
  e.cash += pctGdp * e.gdp;
  e.monetary += pctGdp * 2.2;
  e.stability = Math.max(0, e.stability - pctGdp * 100 * 0.3);
  return ok(`Central bank created ${fmtMoney(pctGdp * e.gdp)}; expect inflation to rise.`);
}

// ---- military ----
export function recruit(s: GameState, cid: number, n: number): ActionResult {
  const c = s.countries[cid], m = c.mil, e = c.eco;
  const avail = manpower(c);
  n = Math.floor(Math.min(n, avail));
  if (n <= 0) return fail('No available manpower');
  const cost = n * m.unitCost * e.price * 0.5;
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  const total = m.troops + n;
  m.readiness = (m.readiness * m.troops + 0.45 * n) / total;
  m.troops = total;
  return ok(`Recruited ${fmtNum(n)} troops for ${fmtMoney(cost)}. ${f.message}`);
}
export function demobilize(s: GameState, cid: number, n: number): ActionResult {
  const m = s.countries[cid].mil;
  n = Math.floor(Math.min(n, m.troops));
  if (n <= 0) return fail('Nobody to demobilise');
  m.troops -= n;
  return ok(`Demobilised ${fmtNum(n)} troops; they return to the workforce.`);
}
export function buyEquipment(s: GameState, cid: number, kind: 'army' | 'air' | 'navy', pctGdp: number): ActionResult {
  const c = s.countries[cid], m = c.mil;
  const cost = costOf(s, cid, pctGdp);
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  const real = (cost / c.eco.price) * 0.9;
  if (kind === 'army') m.equipArmy += real; else if (kind === 'air') m.equipAir += real; else m.equipNavy += real;
  return ok(`Bought ${fmtMoney(cost)} of ${kind} equipment. ${f.message}`);
}
export function setCommit(s: GameState, cid: number, v: number): ActionResult {
  s.countries[cid].mil.commit = clamp(v, 0.05, 1);
  return ok('Offensive commitment updated');
}
export function setAutoAdvance(s: GameState, cid: number, v: boolean): ActionResult {
  s.countries[cid].mil.autoAdvance = v;
  return ok(v ? 'Generals will pick targets automatically' : 'You now direct the offensive manually');
}
export function toggleFocus(s: GameState, cid: number, p: ProvId): ActionResult {
  const m = s.countries[cid].mil;
  m.focus = m.focus.includes(p) ? m.focus.filter((x) => x !== p) : [...m.focus, p].slice(-5);
  return ok('Offensive target updated');
}

// ---- diplomacy wrappers ----
export function actPropose(s: GameState, geo: Geo, cid: number, to: number, kind: Proposal): ActionResult {
  const r = propose(s, geo, cid, to, kind);
  return r.accept ? ok('Accepted!') : fail(r.reasons.join(' · ') || 'Declined');
}
export function actCancel(s: GameState, cid: number, to: number, kind: Proposal): ActionResult { cancelTreaty(s, cid, to, kind); return ok('Treaty cancelled'); }
export function actSanction(s: GameState, cid: number, to: number, level: 0 | 1 | 2): ActionResult {
  if (level === 0) liftSanction(s, cid, to); else imposeSanction(s, cid, to, level);
  return ok(level === 0 ? 'Sanctions lifted' : level === 1 ? 'Sanctions imposed' : 'Embargo imposed');
}
export function actDeclareWar(s: GameState, geo: Geo, cid: number, to: number): ActionResult {
  const r = declareWar(s, geo, cid, to);
  return r.ok ? ok('War declared') : fail(r.reason ?? 'Cannot declare war');
}
export function actPeace(s: GameState, geo: Geo, cid: number, to: number, terms: PeaceTerms): ActionResult & { reasons?: string[] } {
  if (!warBetween(s, cid, to)) return fail('You are not at war with them');
  const ev = evaluatePeace(s, geo, cid, to, terms);
  if (ev.accept) { makePeace(s, geo, cid, to, terms); return { ...ok('Peace agreed'), reasons: ev.reasons }; }
  return { ...fail(`Rejected (willingness ${(ev.willingness * 100).toFixed(0)} vs required ${(ev.required * 100).toFixed(0)})`), reasons: ev.reasons };
}
export function actAcceptOffer(s: GameState, geo: Geo, offerId: number): ActionResult {
  acceptOffer(s, geo, offerId, (a, b, terms) => makePeace(s, geo, a, b, terms as PeaceTerms));
  return ok('Offer accepted');
}
export function actDeclineOffer(s: GameState, offerId: number): ActionResult { declineOffer(s, offerId); return ok('Offer declined'); }
export { termProvinces };
