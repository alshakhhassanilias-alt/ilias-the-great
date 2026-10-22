/**
 * Levers: concrete things a government can do to raise money and to build political capital, each with a price
 * someone pays. Nothing here is free; everything has a cooldown, so the levers are choices, not a cash machine.
 *
 * Money
 *   privatise   sell state companies: cash now, the unions hate it, business loves it; each sale yields less
 *   review      a spending review: every civilian budget line trimmed by 4%, paid for in political capital
 *   enforce     a tax enforcement drive: tax collection +1.5 points for good, business grumbles
 *   friendLoan  a cheap loan from a friendly power: cash at a low rate, and you owe them
 *   concession  (energy exporters) sell an oil & gas concession to foreign companies
 *   fiscal rule the finance minister trims the deficit every quarter, a little at a time (a toggle)
 *
 * Political capital
 *   speech      address the nation: more capital the more popular you are
 *   favours     hand out favours and contracts: money turned into capital, at a cost to your name
 *   bargain     call in a favour from a friendly faction: capital now, their goodwill spent
 *   purge       (not in a democracy) silence the opposition: lots of capital, a stain on your record
 */
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';
import { addRelation, getRelation } from './relations';
import { fund, setBudget, BUDGET_LIMITS } from './actions';
import { budgetReport } from './treasury';
import { revenueAnnual } from './economy';
import { ministerOf } from './cabinet';
import { sway, factionMeta, free } from './domestic';
import { addRec } from './minds';
import type { Country, GameState } from './types';

export type LeverId = 'privatise' | 'review' | 'enforce' | 'friendLoan' | 'concession' | 'speech' | 'favours' | 'bargain' | 'purge';
export interface LeverView { id: LeverId; icon: string; title: string; gain: string; price: string; ok: boolean; why?: string; wait: number; kind: 'money' | 'pc' }

const COOLDOWN: Record<LeverId, number> = { privatise: 104, review: 52, enforce: 78, friendLoan: 156, concession: 156, speech: 13, favours: 8, bargain: 26, purge: 52 };
const lastAt = (s: GameState, id: LeverId) => s.stats[`lever:${id}`] ?? -9999;
export const leverWait = (s: GameState, id: LeverId) => Math.max(0, COOLDOWN[id] - (s.tick - lastAt(s, id)));
const pcOf = (c: Country) => c.politics?.pc ?? 0;

/** How much a privatisation raises: each sale finds less worth selling. */
const privatiseYield = (s: GameState) => 0.015 * Math.pow(0.7, s.stats['lever:privatiseN'] ?? 0);
/** The friendliest power rich enough to lend to you. */
export function lenderFor(s: GameState, c: Country): Country | null {
  let best: Country | null = null, bv = 30;
  for (const x of s.countries) {
    if (!x.alive || x.id === c.id || x.eco.gdp < c.eco.gdp * 0.8 || x.eco.debt / x.eco.gdp > 1.6) continue;
    const r = getRelation(s, c.id, x.id);
    if (r > bv) { bv = r; best = x; }
  }
  return best;
}
const exporter = (c: Country) => c.eco.energyCap > c.eco.energyDemand * 1.25;
/** The friendliest faction big enough to matter (for a bargain). */
function friendFaction(c: Country) {
  return [...(c.politics?.factions ?? [])].filter((f) => f.mood >= 55 && f.support >= 10).sort((a, b) => b.mood * b.support - a.mood * a.support)[0];
}
const speechGain = (appr: number) => Math.round(clamp(3 + (appr - 30) / 6, 2, 12));

/** Every lever with what it would do right now and whether you can pull it. */
export function leverViews(s: GameState, c: Country, appr: number): LeverView[] {
  const e = c.eco, gdp = e.gdp;
  const out: LeverView[] = [];
  const add = (v: Omit<LeverView, 'wait'> & { wait?: number }) => { const wait = leverWait(s, v.id); out.push({ ...v, wait, ok: v.ok && wait === 0, why: wait > 0 ? `again in ${wait} weeks` : v.why }); };
  const py = privatiseYield(s);
  add({ id: 'privatise', kind: 'money', icon: '🏭', title: 'Sell state companies', gain: `+${fmtMoney(py * gdp)} cash now`, price: `Unions furious, business pleased${c.gov === 'C' ? ', the party old guard appalled' : ''}; each sale raises less (${(py * 100).toFixed(1)}% of GDP this time)`, ok: py > 0.003, why: py > 0.003 ? undefined : 'nothing much left worth selling' });
  const civ = (c.budget.social + c.budget.infra + c.budget.industry + c.budget.education) * 0.04 * gdp;
  add({ id: 'review', kind: 'money', icon: '✂', title: 'Spending review', gain: `saves about ${fmtMoney(civ)} a year`, price: '10 political capital · every civilian budget line −4% · unions and regions unhappy', ok: pcOf(c) >= 10, why: pcOf(c) >= 10 ? undefined : 'needs 10 political capital' });
  const enf = Math.min(0.015, 0.95 - e.collection);
  const enfGain = enf * gdp * (revenueAnnual(c) / Math.max(1, gdp * e.collection));
  add({ id: 'enforce', kind: 'money', icon: '🧾', title: 'Tax enforcement drive', gain: `about +${fmtMoney(enfGain)} revenue a year, for good`, price: '8 political capital · business grumbles', ok: enf > 0.002 && pcOf(c) >= 8, why: enf <= 0.002 ? 'collection is already as good as it gets' : pcOf(c) < 8 ? 'needs 8 political capital' : undefined });
  const L = lenderFor(s, c);
  add({ id: 'friendLoan', kind: 'money', icon: '🤝', title: L ? `Loan from ${L.name}` : 'Loan from a friendly power', gain: `+${fmtMoney(0.02 * gdp)} cash at 1.5% interest`, price: L ? `Adds to debt; ${L.name} expects your support for years` : 'No friendly power (relations above +30, at least as rich as you) is willing', ok: !!L && (e.debt + 0.02 * gdp) / gdp < 2.4, why: L ? undefined : 'no friendly lender' });
  if (exporter(c)) add({ id: 'concession', kind: 'money', icon: '🛢', title: 'Sell an oil & gas concession', gain: `+${fmtMoney(0.012 * gdp)} cash now`, price: 'Foreign companies take a share of future output · nationalists and regions object', ok: true });
  const sg = speechGain(appr);
  add({ id: 'speech', kind: 'pc', icon: '🎙', title: 'Address the nation', gain: `+${sg} political capital`, price: appr < 35 ? 'An unpopular leader is heckled: half the gain and stability −1' : `Works better the more popular you are (approval ${Math.round(appr)}%)`, ok: true });
  add({ id: 'favours', kind: 'pc', icon: '🎁', title: 'Hand out favours and contracts', gain: '+10 political capital', price: `${fmtMoney(0.0025 * gdp)} · liberals and the press cry corruption · reputation −1`, ok: (e.debt + 0.0025 * gdp) / gdp < 2.5 });
  const ff = friendFaction(c);
  add({ id: 'bargain', kind: 'pc', icon: '🤜', title: ff ? `Call in a favour from the ${factionMeta(ff.id).short}` : 'Call in a favour from a faction', gain: '+12 political capital', price: ff ? `${factionMeta(ff.id).name} lose some goodwill (mood −8)` : 'No faction is happy enough with you to owe you one', ok: !!ff, why: ff ? undefined : 'no faction is content enough (mood 55+)' });
  if (!free(c)) add({ id: 'purge', kind: 'pc', icon: '⛓', title: 'Silence the opposition', gain: '+18 political capital', price: 'Liberals furious · reputation −4 · stability −2 · the world remembers the crackdown', ok: true });
  return out;
}

/** Pull a lever (player only). */
export function actLever(s: GameState, id: LeverId, appr: number): { ok: boolean; message: string } {
  const c = s.countries[s.player], e = c.eco, gdp = e.gdp, P = c.politics;
  const v = leverViews(s, c, appr).find((x) => x.id === id);
  if (!v) return { ok: false, message: 'Not available' };
  if (!v.ok) return { ok: false, message: v.why ?? 'Not possible now' };
  const fin = ministerOf(c, 'finance')?.name;
  let msg = '';
  switch (id) {
    case 'privatise': {
      const amt = privatiseYield(s) * gdp;
      e.cash += amt; e.tfp *= 1.001;
      s.stats['lever:privatiseN'] = (s.stats['lever:privatiseN'] ?? 0) + 1;
      sway(c, 'labour', -14); sway(c, 'business', 10); if (c.gov === 'C') sway(c, 'nationalists', -6);
      msg = `🏭 State companies sold for ${fmtMoney(amt)}. The unions call it a fire sale; the markets cheer.`;
      break;
    }
    case 'review': {
      P!.pc -= 10;
      for (const k of ['social', 'infra', 'industry', 'education'] as const) setBudget(s, c.id, k, c.budget[k] * 0.96);
      sway(c, 'labour', -8); sway(c, 'regions', -5);
      e.stability = clamp(e.stability - 1, 0, 100);
      msg = `✂ Spending review${fin ? ` led by ${fin}` : ''}: every civilian ministry loses 4% of its budget. Unions and governors protest.`;
      break;
    }
    case 'enforce': {
      P!.pc -= 8;
      e.collection = clamp(e.collection + Math.min(0.015, 0.95 - e.collection), 0.4, 0.95);
      sway(c, 'business', -6);
      msg = `🧾 Tax enforcement drive: inspectors, audits and a crackdown on evasion. Tax collection is now ${(e.collection * 100).toFixed(0)}%.`;
      break;
    }
    case 'friendLoan': {
      const L = lenderFor(s, c)!, amt = 0.02 * gdp;
      e.avgRate = (e.avgRate * e.debt + 0.015 * amt) / Math.max(1, e.debt + amt);
      e.debt += amt; e.cash += amt;
      addRelation(s, c.id, L.id, 6);
      s.stats[`owe:${L.id}`] = s.tick;
      msg = `🤝 ${L.name} lends ${fmtMoney(amt)} at 1.5%. ${L.leader ? `${L.leader.name} will` : 'They will'} expect your vote when it matters.`;
      break;
    }
    case 'concession': {
      const amt = 0.012 * gdp;
      e.cash += amt; e.energyCap *= 0.985;
      sway(c, 'nationalists', -6); sway(c, 'regions', -4); sway(c, 'business', 4);
      msg = `🛢 A thirty-year oil & gas concession is sold to foreign majors for ${fmtMoney(amt)}.`;
      break;
    }
    case 'speech': {
      const g = speechGain(appr), low = appr < 35;
      P!.pc = clamp(P!.pc + (low ? Math.ceil(g / 2) : g), 0, 100);
      if (low) e.stability = clamp(e.stability - 1, 0, 100);
      msg = low ? '🎙 The address to the nation is drowned out by heckling. A little capital, and a bad night on the news.' : `🎙 A televised address to the nation lands well: +${g} political capital.`;
      break;
    }
    case 'favours': {
      const f = fund(s, c.id, 0.0025 * gdp, 'Favours and contracts');
      if (!f.ok) return f;
      P!.pc = clamp(P!.pc + 10, 0, 100);
      sway(c, 'liberals', -5); c.reputation = clamp(c.reputation - 1, 0, 100);
      msg = '🎁 Contracts, posts and subsidies find their way to the right people. Votes follow; so do the headlines.';
      break;
    }
    case 'bargain': {
      const ff = friendFaction(c)!;
      P!.pc = clamp(P!.pc + 12, 0, 100);
      ff.mood = clamp(ff.mood - 8, 0, 100);
      msg = `🤜 The ${factionMeta(ff.id).name} deliver for you, but they will remember they did.`;
      break;
    }
    case 'purge': {
      P!.pc = clamp(P!.pc + 18, 0, 100);
      sway(c, 'liberals', -14); c.reputation = clamp(c.reputation - 4, 0, 100);
      e.stability = clamp(e.stability - 2, 0, 100);
      addRec(s, c.id, 'repress', 0.6);
      msg = '⛓ Opposition leaders are arrested and their papers shut. Parliament falls quiet; the world takes note.';
      break;
    }
  }
  s.stats[`lever:${id}`] = s.tick;
  logEvent(s, msg, v.kind === 'money' ? 'econ' : 'info', [c.id], true);
  return { ok: true, message: msg };
}

// ------------------------------------------------------------------ the fiscal rule
export const fiscalRuleOn = (s: GameState) => (s.stats.fiscalRule ?? 0) > 0;
export function setFiscalRule(s: GameState, on: boolean) { s.stats.fiscalRule = on ? 1 : 0; }
/** The deficit the fiscal rule aims for (balance as a share of GDP): heavier debt, tighter target. */
export const ruleTarget = (debtPct: number) => (debtPct > 1.2 ? 0.01 : debtPct > 0.8 ? 0.005 : debtPct > 0.5 ? 0 : -0.01);

/**
 * Quarterly, if the player switched on the fiscal rule: the finance minister closes up to 0.4% of GDP of the gap
 * between the balance and the target, half from taxes and half from public services, staying under the levels that
 * hurt growth. With a comfortable surplus and a full treasury, they hand some back as tax cuts.
 */
export function stepFiscalRule(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.alive || !fiscalRuleOn(s) || s.tick % 13 !== 7) return;
  const B = budgetReport(s, c), e = c.eco, b = c.budget;
  const gap = ruleTarget(B.debtPct) - B.balancePct;
  const fin = ministerOf(c, 'finance')?.name ?? 'The finance minister';
  const perPoint = (k: 'taxVat' | 'taxIncome') => { const save = b[k]; b[k] = save + 0.01; const r = revenueAnnual(c); b[k] = save; return Math.max(1, r - revenueAnnual(c)); };
  if (gap > 0.0015) {
    const step = Math.min(gap, 0.004) * e.gdp;
    const k: 'taxVat' | 'taxIncome' = b.taxVat < 0.22 ? 'taxVat' : 'taxIncome';
    const room = (k === 'taxVat' ? 0.25 : 0.38) - b[k];
    const dTax = clamp((step / 2 / perPoint(k)) * 0.01, 0, Math.max(0, room));
    const dSoc = Math.min((step - (dTax / 0.01) * perPoint(k)) / e.gdp, Math.max(0, b.social - e.baseSocial * 0.85));
    if (dTax + dSoc < 0.0003) { if (s.tick - (s.stats.ruleStuck ?? -999) > 104) { s.stats.ruleStuck = s.tick; logEvent(s, `💼 ${fin}: the fiscal rule has run out of painless options. Taxes and services are at their limits; only growth, a spending review or fewer commitments can close the rest.`, 'econ', [c.id], true); } return; }
    const was = `${(B.balancePct * 100).toFixed(1)}%`;
    if (dTax > 0) setBudget(s, c.id, k, b[k] + dTax);
    if (dSoc > 0) setBudget(s, c.id, 'social', b.social - dSoc);
    const after = budgetReport(s, c).balancePct;
    logEvent(s, `💼 Budget rule: ${[dTax > 0 ? `${k === 'taxVat' ? 'VAT' : 'income tax'} up to ${(b[k] * 100).toFixed(1)}%` : '', dSoc > 0 ? 'services trimmed' : ''].filter(Boolean).join(', ')}. Balance ${was} → ${(after * 100).toFixed(1)}% of GDP.`, 'econ', [c.id]);
  } else if (gap < -0.012 && B.cash > 0.06 * e.gdp) {
    const k: 'taxVat' | 'taxIncome' = b.taxIncome > b.taxVat * 1.4 ? 'taxIncome' : 'taxVat';
    const d = Math.min((Math.min(-gap - 0.008, 0.004) * e.gdp / perPoint(k)) * 0.01, b[k] - BUDGET_LIMITS[k][0]);
    if (d <= 0) return;
    setBudget(s, c.id, k, b[k] - d);
    logEvent(s, `💼 Budget rule: a surplus, so ${k === 'taxVat' ? 'VAT' : 'income tax'} is cut to ${(b[k] * 100).toFixed(1)}%.`, 'econ', [c.id]);
  }
}
