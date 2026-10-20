/**
 * Peace terms beyond borders. On top of the territorial settlement, the side that sets the terms can demand:
 *   reparations      — 2% of their GDP a year, paid to you every month for five years
 *   demilitarisation — for ten years their defence budget is capped at 1.2% of GDP, their border forts facing you
 *                      are razed, and they cannot attack you
 *   leave alliances  — they quit their defence pacts and military alliances
 *   friendly government — their government is replaced by one that leans your way and signs an alliance with you
 *   formal apology   — they admit starting the war: your standing and stability rise, theirs fall
 * Every demand makes the deal harder to accept (it adds to what the other side needs before saying yes).
 */
import type { CountryId, GameState } from './types';
import { addRelation, alliesOf, ensureTreaty, getRelation, touchTreaties } from './relations';
import { leaveOrg } from './alignment';
import { crownLeader } from './leaders';
import { record } from './treasury';
import { logEvent } from './log';
import { clamp, fmtMoney } from './util';

export type PeaceExtra = 'reparations' | 'demilitarise' | 'leave_alliances' | 'friendly_gov' | 'apology';
export const EXTRA_ORDER: PeaceExtra[] = ['reparations', 'demilitarise', 'leave_alliances', 'friendly_gov', 'apology'];
export const PEACE_EXTRAS: Record<PeaceExtra, { icon: string; label: string; desc: string; cost: number }> = {
  reparations: { icon: '💰', label: 'Reparations', desc: '2% of their GDP a year for five years, paid to you monthly.', cost: 0.22 },
  demilitarise: { icon: '🚫', label: 'Demilitarisation', desc: 'For ten years: their defence budget capped at 1.2% of GDP, border forts facing you razed, no war against you.', cost: 0.28 },
  leave_alliances: { icon: '✂', label: 'Leave their alliances', desc: 'They quit their defence pacts and military alliances.', cost: 0.12 },
  friendly_gov: { icon: '🏛', label: 'A friendly government', desc: 'Their leaders step down; the new government leans your way and signs an alliance with you.', cost: 0.5 },
  apology: { icon: '📜', label: 'Formal apology', desc: 'They admit they started the war: your standing and stability rise, theirs fall.', cost: 0.08 },
};
export type { PeaceDeal } from './types';

/** How much harder a demand makes the deal (added to what the other side needs). */
export function extraCost(s: GameState, x: PeaceExtra, payer: CountryId): number {
  let c = PEACE_EXTRAS[x].cost;
  if (x === 'leave_alliances') c += 0.04 * Math.min(4, alliesOf(s, payer).length);
  return c;
}
/** Whether a demand makes sense against this country (why not, or null). */
export function extraBlocked(s: GameState, x: PeaceExtra, a: CountryId, b: CountryId): string | null {
  const B = s.countries[b];
  if (x === 'leave_alliances' && !alliesOf(s, b).length && !(s.orgs ?? []).some((o) => o.kind === 'defence' && o.members.includes(b))) return 'They have no allies';
  if (x === 'friendly_gov' && b === s.player) return 'Not possible against you';
  if (x === 'apology' && s.wars.some((w) => w.attackers[0] === a && w.defenders.includes(b))) return 'You started this war';
  if (x === 'friendly_gov' && B.provinces.includes(B.capital) && B.mil.exhaustion < 0.6) return 'Only when their capital has fallen or they are exhausted';
  if (x === 'demilitarise' && s.peaceDeals?.some((d) => d.kind === 'demil' && d.b === b && d.until > s.tick)) return 'Already demilitarised';
  void a;
  return null;
}

/** Carry out the extra terms of a peace: `a` set them, `b` accepted them. */
export function applyExtras(s: GameState, a: CountryId, b: CountryId, extras: PeaceExtra[]) {
  const A = s.countries[a], B = s.countries[b];
  const D = (s.peaceDeals ??= []);
  for (const x of extras) {
    if (x === 'reparations') D.push({ kind: 'rep', a, b, until: s.tick + 260, share: 0.02, paid: 0 });
    else if (x === 'demilitarise') {
      D.push({ kind: 'demil', a, b, until: s.tick + 520 });
      B.budget.military = Math.min(B.budget.military, 0.012);
      for (const p of B.provinces) if (s.bld[`${p}:fort`]) s.bld[`${p}:fort`] = 0;
    } else if (x === 'leave_alliances') {
      for (const o of [...(s.orgs ?? [])]) if (o.kind === 'defence' && o.members.includes(b)) leaveOrg(s, o, b, `forced out by the peace with ${A.name}`);
      for (const m of alliesOf(s, b)) { const t = ensureTreaty(s, b, m); t.alliance = false; addRelation(s, b, m, -10); }
      touchTreaties(s);
    } else if (x === 'friendly_gov') {
      B.orient = clamp((A.orient ?? 0) * 0.8 + (B.orient ?? 0) * 0.2, -1, 1);
      B.hostile = A.hostile ?? 0;
      if (!B.isPlayer) crownLeader(s, B, s.tick * 31 + b);
      const t = ensureTreaty(s, a, b); t.alliance = true; t.nap = true; touchTreaties(s);
      addRelation(s, a, b, 45);
      B.eco.stability = Math.max(0, B.eco.stability - 8);
      logEvent(s, `🏛 REGIME CHANGE: ${B.name}'s government falls as part of the peace; its successor allies with ${A.name}.`, 'diplo', [b, a], true, { big: true, prov: B.capital });
    } else if (x === 'apology') {
      A.reputation = Math.min(100, A.reputation + 3); B.reputation = Math.max(0, B.reputation - 6);
      A.eco.stability = Math.min(100, A.eco.stability + 3); B.eco.stability = Math.max(0, B.eco.stability - 4);
    }
  }
  if (extras.length) logEvent(s, `The peace obliges ${B.name} to: ${extras.map((x) => PEACE_EXTRAS[x].label.toLowerCase()).join(', ')}.`, 'peace', [a, b], a === s.player || b === s.player);
}

/** Is `b` barred from attacking `a` by a demilitarisation clause? */
export const demilitarised = (s: GameState, b: CountryId, a?: CountryId) => !!s.peaceDeals?.some((d) => d.kind === 'demil' && d.b === b && (a === undefined || d.a === a) && d.until > s.tick);

/** Weekly: reparations are paid monthly, demilitarised countries stay under the cap, expired deals end. */
export function stepPeaceDeals(s: GameState) {
  if (!s.peaceDeals?.length) return;
  for (const d of s.peaceDeals) {
    const A = s.countries[d.a], B = s.countries[d.b];
    if (!A?.alive || !B?.alive) { d.until = 0; continue; }
    if (d.kind === 'demil') { if (B.budget.military > 0.012) B.budget.military = 0.012; continue; }
    if ((s.tick - d.until) % 4 !== 0) continue;
    const amt = (d.share ?? 0.02) * B.eco.gdp / 13;
    B.eco.cash -= amt;
    let borrowed = 0;
    if (B.eco.cash < 0) { borrowed = -B.eco.cash; B.eco.debt += borrowed; B.eco.cash = 0; }
    A.eco.cash += amt;
    d.paid = (d.paid ?? 0) + amt;
    record(s, A, `Reparations from ${B.name}`, amt, 0);
    record(s, B, `Reparations to ${A.name}`, -amt, borrowed);
    // paying for a lost war is humiliating: it keeps the grudge alive
    if (s.tick % 52 === 0) addRelation(s, d.b, d.a, -2);
  }
  const done = s.peaceDeals.filter((d) => d.until <= s.tick);
  for (const d of done) {
    const A = s.countries[d.a], B = s.countries[d.b];
    if (A?.alive && B?.alive && d.until > 0) logEvent(s, d.kind === 'rep' ? `${B.name} has made its last reparations payment to ${A.name} (${fmtMoney(d.paid ?? 0)} in all).` : `The demilitarisation of ${B.name} imposed by ${A.name} has ended.`, 'peace', [d.a, d.b], d.a === s.player || d.b === s.player);
  }
  if (done.length) s.peaceDeals = s.peaceDeals.filter((d) => d.until > s.tick);
}

/** What the AI demands on top of borders when it has the upper hand. */
export function aiExtras(s: GameState, a: CountryId, b: CountryId, score: number, defender: boolean): PeaceExtra[] {
  const A = s.countries[a], B = s.countries[b];
  const out: PeaceExtra[] = [];
  if (score > 0.45 && B.eco.gdp > 0.15 * A.eco.gdp) out.push('reparations');
  if (score > 0.6 && A.ai.aggression > 0.6 && !extraBlocked(s, 'demilitarise', a, b)) out.push('demilitarise');
  if (score > 0.5 && !extraBlocked(s, 'friendly_gov', a, b) && A.ai.ideology > 0.5 && getRelation(s, a, b) < -30) out.push('friendly_gov');
  if (defender && score > 0.25) out.push('apology');
  return out;
}
export const extrasText = (xs: PeaceExtra[] | undefined) => (xs ?? []).map((x) => PEACE_EXTRAS[x].label.toLowerCase()).join(', ');
