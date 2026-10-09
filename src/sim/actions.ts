/**
 * Actions available to both the player and AI. Every action takes effect IMMEDIATELY (no timers):
 * money moves now, capacity / forces / stats change now, and the next tick reflects the new state.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { manpower } from './military';
import { fmtMoney, fmtNum } from './util';
import { evaluatePeace, makePeace, type PeaceTerms, declareWar, termProvinces, callAllies, airSuperiority } from './war';
import { runOp, OPS, type OpKind } from './ops';
import { resolveEvent } from './events';
import { build, type BType } from './buildings';
import { recordRipple, rippleTreaty } from './politics';
import { assessAttack } from './ai';
import { transferProvince } from './war';
import { hasGuarantee, warsOf } from './relations';
import { makePeace as makePeaceFn } from './war';
import { nextRand } from './rng';
import { addRelation, getRelation } from './relations';
import { logEvent } from './log';
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

// ---- active war operations ----
export function actAirstrike(s: GameState, cid: number, prov: ProvId): ActionResult {
  const c = s.countries[cid];
  const cost = 0.0015 * c.eco.gdp;
  if (c.mil.equipAir < 1e8) return fail('You have no air force to strike with');
  for (const w of s.wars) {
    const fr = w.fronts.find((f) => f.prov === prov && f.by === cid);
    if (!fr) continue;
    const f = fund(s, cid, cost);
    if (!f.ok) return f;
    const enemy = s.countries[s.owner[prov]];
    const sup = airSuperiority(c, enemy);
    const gain = 0.06 + 0.07 * Math.max(0, sup);
    fr.progress = Math.min(1.1, fr.progress + gain);
    enemy.eco.infra = Math.max(5, enemy.eco.infra - 1);
    c.mil.equipAir *= 0.998;
    return ok(`Air strike hit ${enemy.name}: offensive +${(gain * 100).toFixed(0)}% progress. ${f.message}`);
  }
  return fail('You have no active offensive against that region — pick a region on the front line');
}
export function actWarEconomy(s: GameState, cid: number, on: boolean): ActionResult {
  s.countries[cid].mil.warEconomy = on;
  return ok(on ? 'War economy: armament output +60%, but unrest and inflation rise.' : 'Back to a peacetime economy.');
}
export function actCallAllies(s: GameState, cid: number): ActionResult {
  const j = callAllies(s, cid);
  return j.length ? ok(`${j.map((x) => s.countries[x].name).join(', ')} joined the war!`) : fail('No allies agreed to join.');
}
export function actTotalMobilization(s: GameState, cid: number): ActionResult {
  const c = s.countries[cid];
  const r = recruit(s, cid, manpower(c) * 0.5);
  if (r.ok) c.mil.warEconomy = true;
  return r.ok ? ok(`${r.message} War economy switched on.`) : r;
}
export function actOp(s: GameState, cid: number, to: number, kind: OpKind): ActionResult { return runOp(s, cid, to, kind); }
export function actResolveEvent(s: GameState, geo: Geo, option: number): ActionResult { return resolveEvent(s, geo, option); }
export { OPS };

// ---- statecraft ----
export function actBuild(s: GameState, geo: Geo, cid: number, p: ProvId, t: BType): ActionResult { return build(s, geo, cid, p, t); }

export function actGuarantee(s: GameState, cid: number, to: number, on: boolean): ActionResult {
  const key = `${cid}>${to}`;
  if (!on) { s.guarantees = s.guarantees.filter((g) => g !== key); addRelation(s, cid, to, -6); return ok('Guarantee withdrawn'); }
  if (hasGuarantee(s, cid, to)) return fail('You already guarantee them');
  if (getRelation(s, cid, to) < -15) return fail('They do not trust you enough to accept a guarantee');
  s.guarantees.push(key);
  addRelation(s, cid, to, 12);
  s.stats.guarantees = (s.stats.guarantees ?? 0) + 1;
  const reactions = rippleTreaty(s, cid, to, 'guarantee');
  recordRipple(s, cid, to, 'guarantee', reactions);
  return ok(`You now guarantee ${s.countries[to].name}'s security: an attack on them is an attack on your word.`);
}
export function actAid(s: GameState, cid: number, to: number, pct: number): ActionResult {
  const c = s.countries[cid], T = s.countries[to];
  const cost = pct * c.eco.gdp;
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  T.eco.cash += cost; T.eco.stability = Math.min(100, T.eco.stability + 1.5);
  addRelation(s, cid, to, Math.min(25, 30 * pct * 100 / 1.0 * 0.4 + 4));
  c.reputation = Math.min(100, c.reputation + 1);
  s.stats.aid = (s.stats.aid ?? 0) + 1;
  return ok(`${fmtMoney(cost)} of aid delivered to ${T.name}. Relations improve.`);
}
export function actSummit(s: GameState, cid: number, to: number): ActionResult {
  const c = s.countries[cid], T = s.countries[to];
  const key = `${to}:summit`;
  if ((s.opCooldown[key] ?? -999) + 26 > s.tick) return fail('You held a summit with them recently');
  const cost = 0.001 * c.eco.gdp;
  if (c.eco.cash < cost) return fail(`Not enough cash (${fmtMoney(cost)})`);
  c.eco.cash -= cost; s.opCooldown[key] = s.tick;
  const rel = getRelation(s, cid, to);
  const p = rel < -40 ? 0.45 : rel < 0 ? 0.75 : 0.95;
  if (nextRand(s) > p) { addRelation(s, cid, to, -4); return fail(`The summit with ${T.name} ended in a public spat.`); }
  addRelation(s, cid, to, 9);
  return ok(`A summit with ${T.name} warmed relations.`);
}
export function actUltimatum(s: GameState, geo: Geo, cid: number, to: number, kind: 'cede' | 'tribute'): ActionResult {
  const c = s.countries[cid], T = s.countries[to];
  if (areAtWarSafe(s, cid, to)) return fail('You are already at war');
  const a = assessAttack(s, geo, c, T);
  const accept = nextRand(s) < clamp((a.ratio - 1.4) / 2.2, 0.02, 0.9) * (1 - 0.4 * T.ai.caution + 0.3) && !(T.mil.nuclear && !c.mil.nuclear);
  c.reputation = Math.max(0, c.reputation - 4);
  if (!accept) {
    addRelation(s, cid, to, -25);
    logEvent(s, `${T.name} rejected ${c.name}'s ultimatum.`, 'danger', [cid, to], true);
    return fail(`${T.name} rejected your ultimatum (odds were ${(clamp((a.ratio - 1.4) / 2.2, 0.02, 0.9) * 100).toFixed(0)}%). Relations −25. You can now declare war or back down.`);
  }
  addRelation(s, cid, to, -12);
  if (kind === 'tribute') { const amt = 0.015 * T.eco.gdp; T.eco.cash = Math.max(0, T.eco.cash - amt); T.eco.debt += Math.max(0, amt - T.eco.cash); c.eco.cash += amt; logEvent(s, `${T.name} paid tribute to ${c.name} under threat.`, 'diplo', [cid, to], true); return ok(`${T.name} paid ${fmtMoney(amt)}.`); }
  const mine = new Set(c.provinces);
  const cand = T.provinces.filter((p) => p !== T.capital && geo.adj[p].some((q) => mine.has(q))).sort((x, y) => geo.provinces[x].w - geo.provinces[y].w)[0];
  if (cand === undefined) return fail('No border region could be claimed.');
  const nm = geo.provinces[cand].name;
  transferProvince(s, geo, cand, cid);
  T.eco.stability = Math.max(0, T.eco.stability - 6);
  logEvent(s, `${T.name} ceded ${nm} to ${c.name} after an ultimatum.`, 'territory', [cid, to], true);
  return ok(`${T.name} ceded ${nm} without a fight.`);
}
function areAtWarSafe(s: GameState, a: number, b: number) { return warsOf(s, a).some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.defenders.includes(a) && w.attackers.includes(b))); }
export function actMediate(s: GameState, geo: Geo, cid: number, warId: number): ActionResult {
  const c = s.countries[cid];
  const w = s.wars.find((x) => x.id === warId);
  if (!w) return fail('That war is over');
  if (w.attackers.includes(cid) || w.defenders.includes(cid)) return fail('You are a party to this war');
  const key = `mediate:${warId}`;
  if ((s.opCooldown[key] ?? -999) + 13 > s.tick) return fail('You tried mediating this war very recently');
  const cost = 0.0025 * c.eco.gdp;
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  s.opCooldown[key] = s.tick;
  const A = s.countries[w.attackers[0]], B = s.countries[w.defenders[0]];
  const p = clamp(0.25 + c.reputation / 250 + (A.mil.exhaustion + B.mil.exhaustion) * 0.4 + (getRelation(s, cid, A.id) > 0 && getRelation(s, cid, B.id) > 0 ? 0.1 : -0.05), 0.08, 0.9);
  if (nextRand(s) < p) {
    makePeaceFn(s, geo, A.id, B.id, { kind: 'status_quo' });
    c.reputation = Math.min(100, c.reputation + 6); addRelation(s, cid, A.id, 12); addRelation(s, cid, B.id, 12);
    s.stats.mediations = (s.stats.mediations ?? 0) + 1;
    return ok(`Mediation worked: ${A.name} and ${B.name} agreed a ceasefire. Reputation +6.`);
  }
  addRelation(s, cid, A.id, -2); addRelation(s, cid, B.id, -2);
  return fail(`The talks failed (${(p * 100).toFixed(0)}% chance). Try again later or when both sides are more exhausted.`);
}
