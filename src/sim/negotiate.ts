/**
 * The negotiating table. Instead of a blind accept/refuse, every country has interests you can read and trade on:
 *
 * - its stance comes from relations, its leader's traits, grudges, power, blocs, rivals, sanctions and wars;
 * - it shows what it wants (money, security, technology, trade, relief, distance from its rival), its red lines,
 *   and the leverage you hold;
 * - you add terms (an investment package, lifting your sanctions, technology, a guarantee, cutting ties with its
 *   rival) and see the odds move, factor by factor;
 * - the answer is a roll against those odds. A near miss brings a counteroffer naming the term that would close
 *   the deal; a hopeless offer is refused with its reasons; patience runs out if you keep pushing.
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp, fmtMoney } from './util';
import { strength } from './military';
import { neighborsOf, applyTreaty, evaluateProposal, PROPOSAL_LABEL, type Proposal, liftSanction, cancelTreaty } from './diplomacy';
import { addRelation, alliesOf, areAtWar, getRelation, getTreaty, hasGuarantee, isAtWar, sanctionLevel } from './relations';
import { grudgeScore, addGrudge } from './leaders';
import { claimStrength } from './war';
import { computeBlocs } from './politics';
import { fund, actGuarantee } from './actions';
import { logEvent } from './log';
import { cable } from './cables';
import type { Country, CountryId, GameState } from './types';

export type Goal = Proposal | 'aid' | 'relief';
export const GOAL_LABEL: Record<Goal, string> = { ...PROPOSAL_LABEL, aid: 'Financial aid for you', relief: 'Lift their sanctions on you' };
export const GOAL_DESC: Record<Goal, string> = {
  trade: 'Both economies gain exports and cheaper imports; relations improve over time.',
  nap: 'Neither side may attack the other without a heavy reputation penalty.',
  coop: 'Joint exercises and technology sharing; a step toward an alliance.',
  alliance: 'Mutual defence: each side is called to the other’s defensive wars.',
  aid: 'They transfer 0.5% of their GDP to your treasury.',
  relief: 'They lift the sanctions or embargo they have imposed on you.',
};

/** Terms you can put on the table. */
export type Term = 'cash1' | 'cash3' | 'cash6' | 'lift' | 'tech' | 'guarantee' | 'cut';
export interface Terms { goal: Goal; give: Term[] }
export const TERM_LABEL: Record<Term, string> = {
  cash1: 'Investment package (0.1% of your GDP)', cash3: 'Investment package (0.3% of your GDP)', cash6: 'Investment package (0.6% of your GDP)',
  lift: 'Lift your sanctions on them', tech: 'Share technology', guarantee: 'Guarantee their security', cut: 'Cut your ties with their rival',
};
const CASH: Partial<Record<Term, number>> = { cash1: 0.001, cash3: 0.003, cash6: 0.006 };

export interface Interest { key: string; label: string; w: number }
export interface Factor { label: string; pts: number }
export interface Stance {
  /** what they care about most, strongest first (w 0..1) */
  interests: Interest[];
  redLines: string[];
  /** a red line that blocks this goal outright */
  blocked: string | null;
  leverage: Factor[];
  factors: Factor[];
  /** chance they accept, 0..1 */
  p: number;
  /** what each available term would add, in points (so the player can see which sweetener matters) */
  termValue: Partial<Record<Term, number>>;
  available: Term[];
  rival: CountryId | -1;
  patience: number;
  /** a counteroffer they made earlier for this goal (accepting it is certain) */
  counter?: Term[];
  costs: string[];
}

interface NegoMemo { patience: number; until: number; counter?: { goal: Goal; give: Term[]; tick: number } }
function memo(s: GameState, them: CountryId): NegoMemo {
  const m = (s.nego ??= {}) as Record<number, NegoMemo>;
  const x = (m[them] ??= { patience: 3, until: -1 });
  // patience recovers over time
  if (x.patience < 3 && s.tick - x.until > 26) { x.patience = 3; }
  return x;
}

const hasTrait = (c: Country, t: string) => !!c.leader?.traits.includes(t);

/** The country this one dislikes most (its rival), if any. */
function rivalOf(s: GameState, T: Country, me: CountryId): CountryId | -1 {
  let best = -1, low = -35;
  for (const x of s.countries) {
    if (!x.alive || x.id === T.id || x.id === me) continue;
    const r = getRelation(s, T.id, x.id);
    if (r < low) { low = r; best = x.id; }
  }
  return best;
}

/** How exposed they feel: the strongest hostile neighbour relative to them (0 safe .. 1 in danger). */
function insecurity(s: GameState, geo: Geo, T: Country): { v: number; who: CountryId | -1 } {
  let v = 0, who: CountryId | -1 = -1;
  for (const n of neighborsOf(s, geo, T.id)) {
    const r = getRelation(s, T.id, n);
    if (r > -20) continue;
    const ratio = strength(s.countries[n]) / Math.max(1, strength(T));
    const x = clamp((ratio - 0.6) / 2, 0, 1) * clamp(-r / 70, 0.3, 1);
    if (x > v) { v = x; who = n; }
  }
  if (isAtWar(s, T.id)) v = Math.max(v, 0.6);
  return { v, who };
}

export function stanceOf(s: GameState, geo: Geo, them: CountryId, t: Terms): Stance {
  const me = s.player, P = s.countries[me], T = s.countries[them];
  const rel = getRelation(s, them, me);
  const tr = getTreaty(s, them, me);
  const mySanc = sanctionLevel(s, me, them), theirSanc = sanctionLevel(s, them, me);
  const sec = insecurity(s, geo, T);
  const rival = rivalOf(s, T, me);
  const power = strength(P) / Math.max(1, strength(T));
  const debt = T.eco.debt / T.eco.gdp, poor = T.eco.gdp / Math.max(1, T.eco.pop) < 6000;
  const techGap = P.eco.tech - T.eco.tech;
  const tradeDep = clamp(P.eco.gdp / Math.max(1, T.eco.gdp), 0, 3);
  const mine = (k: number) => Math.round(k);

  // ---- what they want ----
  const I: Interest[] = [];
  const add = (key: string, label: string, w: number) => { if (w > 0.12) I.push({ key, label, w: clamp(w, 0, 1) }); };
  add('money', poor ? 'Money: a poorer country short of investment' : debt > 1 ? `Money: debt is ${(debt * 100).toFixed(0)}% of GDP` : T.eco.growth < 0 ? 'Money: its economy is shrinking' : 'Money',
    (poor ? 0.45 : 0.15) + (debt > 1 ? 0.25 : 0) + (T.eco.growth < 0 ? 0.2 : 0) + (hasTrait(T, 'pragmatist') ? 0.2 : 0) + (hasTrait(T, 'mercantilist') ? 0.1 : 0));
  add('security', sec.who >= 0 ? `Security: fears ${s.countries[sec.who].name}` : isAtWar(s, them) ? 'Security: it is at war' : 'Security', sec.v + (hasTrait(T, 'paranoid') ? 0.2 : 0));
  add('trade', T.ai.trade > 0.6 ? 'Trade: a trading nation' : 'Trade', 0.3 * T.ai.trade + 0.2 * Math.min(1, tradeDep) + (hasTrait(T, 'mercantilist') ? 0.2 : 0));
  add('tech', `Technology: you are ${techGap.toFixed(0)} points ahead`, techGap > 4 ? clamp(techGap / 25, 0.15, 0.7) + (hasTrait(T, 'reformer') ? 0.15 : 0) : 0);
  add('relief', 'Relief from your sanctions', mySanc ? 0.45 + 0.2 * mySanc : 0);
  add('rival', rival >= 0 ? `Isolating its rival ${s.countries[rival].name}` : '', rival >= 0 && hasTiesWith(s, me, rival) ? clamp(-getRelation(s, them, rival) / 100, 0.2, 0.8) : 0);
  I.sort((a, b) => b.w - a.w);
  const want = (k: string) => I.find((x) => x.key === k)?.w ?? 0;

  // ---- red lines ----
  const redLines: string[] = [];
  let blocked: string | null = null;
  const line = (txt: string, goals: Goal[]) => { redLines.push(txt); if (goals.includes(t.goal)) blocked ??= txt; };
  if (areAtWar(s, me, them)) line('We are at war: talk peace first', ['trade', 'nap', 'coop', 'alliance', 'aid', 'relief']);
  if (rival >= 0 && alliesOf(s, me).includes(rival)) line(`No alliance while you are allied with ${s.countries[rival].name} (offer to cut those ties)`, t.give.includes('cut') ? [] : ['alliance', 'coop']);
  if (hasTrait(T, 'nationalist') && claimStrength(them, me) > 0.3) line('A nationalist leader will not sign away its claims on your land', ['nap', 'alliance']);
  if (hasTrait(T, 'ideologue') && T.gov !== P.gov && (T.gov === 'A' || P.gov === 'A' || T.gov === 'C' || P.gov === 'C')) line('An ideologue will not ally with your kind of government', ['alliance']);
  if (grudgeScore(s, them, me) > 25) line('It does not trust you: you broke faith with it recently', ['alliance', 'aid']);
  const bl = computeBlocs(s, true);
  const bT = bl.of.get(them), bP = bl.of.get(me);
  if (bT !== undefined && bP !== undefined && bT !== bP) line('It belongs to a rival bloc', ['alliance']);
  if (t.goal === 'relief' && !theirSanc) blocked ??= 'They do not sanction you';
  if (t.goal === 'aid' && (T.eco.gdp < P.eco.gdp * 0.25 || T.eco.cash < 0.002 * T.eco.gdp)) blocked ??= 'They cannot afford to give aid';
  if (t.goal !== 'aid' && t.goal !== 'relief' && tr?.[t.goal]) blocked ??= 'Already in force';
  if ((t.goal === 'trade' || t.goal === 'coop' || t.goal === 'alliance' || t.goal === 'nap') && (mySanc || theirSanc) && !t.give.includes('lift')) blocked ??= mySanc ? 'You sanction them: offer to lift your sanctions first' : 'They sanction you: ask for relief first';

  // ---- leverage you hold ----
  const leverage: Factor[] = [];
  if (power > 1.5) leverage.push({ label: `You are ${power.toFixed(1)}× stronger`, pts: mine(Math.min(15, (power - 1) * 6) * (hasTrait(T, 'strongman') ? 1.5 : 1)) });
  if (tradeDep > 1.5) leverage.push({ label: `Your economy is ${tradeDep.toFixed(1)}× theirs: they need your market`, pts: mine(Math.min(10, tradeDep * 3)) });
  if (mySanc) leverage.push({ label: 'Your sanctions hurt them (offer to lift them)', pts: 0 });
  if (alliesOf(s, me).length >= 3) leverage.push({ label: `${alliesOf(s, me).length} allies stand behind you`, pts: 4 });
  if (P.reputation > 65) leverage.push({ label: `Your word is trusted (reputation ${P.reputation.toFixed(0)})`, pts: 5 });

  // ---- the base case for the goal, using the existing treaty model where it applies ----
  const factors: Factor[] = [];
  factors.push({ label: `Relations ${rel >= 0 ? '+' : ''}${rel.toFixed(0)}`, pts: mine(rel * 0.45) });
  if (rel < -50) factors.push({ label: 'Bitter rivals: a deal looks like surrender at home', pts: -15 });
  const g = grudgeScore(s, them, me);
  if (g > 2) factors.push({ label: 'Grudges against you', pts: -mine(Math.min(30, g)) });
  if (T.leader) {
    const tl = T.leader.traits;
    const tv = (tl.includes('dove') ? (t.goal === 'nap' || t.goal === 'trade' ? 8 : t.goal === 'alliance' ? -6 : 0) : 0)
      + (tl.includes('hawk') ? (t.goal === 'nap' ? -10 : t.goal === 'coop' || t.goal === 'alliance' ? 4 : 0) : 0)
      + (tl.includes('mercantilist') && t.goal === 'trade' ? 12 : 0) + (tl.includes('pragmatist') ? 4 : 0)
      + (tl.includes('paranoid') && (t.goal === 'alliance' || t.goal === 'coop') ? (power > 1 ? 8 : -8) : 0)
      + (tl.includes('ideologue') && T.gov !== P.gov ? -8 : 0) + (tl.includes('nationalist') && t.goal === 'aid' ? -8 : 0);
    if (tv) factors.push({ label: `${T.leader.name}'s character`, pts: tv });
  }
  switch (t.goal) {
    case 'trade': factors.push({ label: 'Trade suits its economy', pts: mine(30 * want('trade')) }); factors.push({ label: 'Base reluctance', pts: -10 }); break;
    case 'nap': {
      factors.push({ label: 'It wants security', pts: mine(30 * want('security')) });
      if (power > 1.4 && neighborsOf(s, geo, me).includes(them)) factors.push({ label: 'Peace with a stronger neighbour is safer', pts: 10 });
      factors.push({ label: `Its appetite for war (aggression ${(T.ai.aggression * 100).toFixed(0)})`, pts: -mine(25 * T.ai.aggression * s.settings.aggression) });
      if (claimStrength(them, me) > 0.3) factors.push({ label: 'It claims land you hold', pts: -25 });
      break;
    }
    case 'coop': factors.push({ label: 'Base reluctance', pts: -20 }); if (tr?.alliance) factors.push({ label: 'Already allies', pts: 20 }); if (techGap > 4) factors.push({ label: 'Your military technology is better', pts: 8 }); break;
    case 'alliance': {
      factors.push({ label: 'An alliance is a big commitment', pts: -35 });
      factors.push({ label: 'It wants security', pts: mine(35 * want('security')) });
      if (power > 1) factors.push({ label: 'You are a strong partner', pts: mine(Math.min(15, power * 5)) }); else factors.push({ label: 'You are the weaker partner', pts: -10 });
      if (isAtWar(s, me)) factors.push({ label: 'You are at war: it would be dragged in', pts: -20 });
      if (rel < 25) factors.push({ label: 'Not yet trusted enough (needs relations +25)', pts: -15 });
      break;
    }
    case 'aid': factors.push({ label: 'Giving money away', pts: -25 }); if (tr?.alliance) factors.push({ label: 'You are allies', pts: 15 }); if (rival >= 0 && getRelation(s, me, rival) < -30) factors.push({ label: `You both oppose ${s.countries[rival].name}`, pts: 10 }); break;
    case 'relief': factors.push({ label: `Lifting ${theirSanc === 2 ? 'an embargo' : 'sanctions'} costs it face`, pts: theirSanc === 2 ? -30 : -18 }); if (P.reputation > 60) factors.push({ label: 'You have mended your reputation', pts: 8 }); break;
  }
  // the old treaty model still knows about shared rivals and conflicting alliances
  if (t.goal !== 'aid' && t.goal !== 'relief') {
    const ev = evaluateProposal(s, geo, me, them, t.goal);
    for (const r of ev.reasons) if (/rival|friend|ideolog|preoccupied/i.test(r)) factors.push({ label: r, pts: /shared/i.test(r) ? 8 : -12 });
  }
  const lev = leverage.reduce((a, x) => a + x.pts, 0);
  if (lev && (t.goal === 'nap' || t.goal === 'relief' || t.goal === 'trade')) factors.push({ label: 'Your leverage', pts: lev });

  // ---- what each term is worth to them ----
  const available: Term[] = ['cash1', 'cash3', 'cash6'];
  if (mySanc) available.push('lift');
  if (techGap > 4) available.push('tech');
  if (!hasGuarantee(s, me, them) && rel > -15) available.push('guarantee');
  if (rival >= 0 && hasTiesWith(s, me, rival)) available.push('cut');
  const moneyW = 0.4 + want('money');
  const termValue: Partial<Record<Term, number>> = {};
  for (const k of available) {
    const cash = CASH[k];
    // money matters more to a poor or indebted country, with diminishing returns; a hostile one distrusts any offer
    const share = cash ? (cash * P.eco.gdp) / Math.max(1, T.eco.gdp) : 0;
    const trust = rel < -60 ? 0.4 : rel < -30 ? 0.6 : rel < 0 ? 0.85 : 1;
    termValue[k] = cash ? mine(trust * Math.min(30, Math.sqrt(share * 100) * 9 * moneyW * (t.goal === 'aid' ? 0.4 : 1)))
      // lifting sanctions is relief, not a promise, so distrust does not discount it
      : k === 'lift' ? mine(Math.min(45, 20 + 15 * mySanc)) : k === 'tech' ? mine(trust * Math.min(25, 6 + 25 * want('tech')))
      : k === 'guarantee' ? mine(trust * Math.min(30, 6 + 35 * want('security') * clamp(power, 0.3, 1.5))) : mine(trust * Math.min(30, 10 + 30 * want('rival')));
  }
  // only one cash package counts
  let cashSeen = false;
  for (const k of t.give) {
    if (!available.includes(k)) continue;
    if (CASH[k]) { if (cashSeen) continue; cashSeen = true; }
    factors.push({ label: TERM_LABEL[k], pts: termValue[k] ?? 0 });
  }
  const total = factors.reduce((a, x) => a + x.pts, 0);
  // a logistic curve: 0 points ≈ 50%; every 10 points roughly doubles the odds
  const p = blocked ? 0 : clamp(1 / (1 + Math.exp(-total / 14)), 0.02, 0.97);
  const M = memo(s, them);
  const counter = M.counter && M.counter.goal === t.goal && s.tick - M.counter.tick < 26 ? M.counter.give : undefined;

  // ---- what it costs you ----
  const costs: string[] = [];
  const cashK = t.give.find((k) => CASH[k]);
  if (cashK) costs.push(`${fmtMoney(CASH[cashK]! * P.eco.gdp)} from your treasury (borrowed if it is empty)`);
  if (t.give.includes('guarantee')) costs.push(`You promise to defend ${T.name} if it is attacked`);
  if (t.give.includes('cut') && rival >= 0) costs.push(`Your treaties with ${s.countries[rival].name} end (relations −20)`);
  if (t.give.includes('tech')) costs.push('Their technology closes some of the gap with yours');
  if (t.goal === 'alliance') costs.push('You may be called into its defensive wars');

  return { interests: I, redLines, blocked, leverage, factors, p, termValue, available, rival, patience: M.patience, counter, costs };
}

function hasTiesWith(s: GameState, a: CountryId, b: CountryId) {
  const t = getTreaty(s, a, b);
  return !!(t && (t.trade || t.coop || t.alliance));
}

export interface NegoResult { ok: boolean; outcome: 'accepted' | 'counter' | 'refused' | 'blocked'; message: string; why: string[]; counter?: Term[] }

/** Put the offer on the table. Uncertain: a roll against the odds the player saw. */
export function negotiate(s: GameState, geo: Geo, them: CountryId, t: Terms, acceptCounter = false): NegoResult {
  const T = s.countries[them];
  const M = memo(s, them);
  if (M.patience <= 0) return { ok: false, outcome: 'blocked', message: `${T.name} will not negotiate again until ${Math.max(1, M.until + 26 - s.tick)} more weeks have passed.`, why: ['Out of patience'] };
  const st = stanceOf(s, geo, them, t);
  if (st.blocked) return { ok: false, outcome: 'blocked', message: `${T.name} refuses outright: ${st.blocked}.`, why: [st.blocked] };
  const isCounter = acceptCounter && st.counter && st.counter.every((k) => t.give.includes(k));
  const roll = nextRand(s);
  const top = [...st.factors].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 3).map((f) => `${f.label} (${f.pts >= 0 ? '+' : ''}${f.pts})`);
  if (isCounter || roll < st.p) {
    // pay what was promised
    const P = s.countries[s.player];
    const cashK = t.give.find((k) => CASH[k]);
    if (cashK) { const f = fund(s, s.player, CASH[cashK]! * P.eco.gdp, `Deal with ${T.name}`); if (!f.ok) return { ok: false, outcome: 'blocked', message: f.message, why: [] }; T.eco.cash += CASH[cashK]! * P.eco.gdp; }
    if (t.give.includes('lift')) liftSanction(s, s.player, them);
    if (t.give.includes('tech')) { T.eco.tech = Math.min(P.eco.tech, T.eco.tech + 2); T.mil.milTech = Math.min(P.mil.milTech, T.mil.milTech + 1); }
    if (t.give.includes('guarantee')) actGuarantee(s, s.player, them, true);
    if (t.give.includes('cut') && st.rival >= 0) for (const k of ['trade', 'coop', 'alliance'] as Proposal[]) cancelTreaty(s, s.player, st.rival, k);
    switch (t.goal) {
      case 'aid': { const amt = 0.005 * T.eco.gdp; T.eco.cash -= amt; P.eco.cash += amt; addRelation(s, them, s.player, 3); logEvent(s, `${T.name} sends ${fmtMoney(amt)} in aid to ${P.name}.`, 'diplo', [them, s.player], true); break; }
      case 'relief': liftSanction(s, them, s.player); break;
      default: applyTreaty(s, s.player, them, t.goal);
    }
    M.counter = undefined;
    cable(s, them, 'treaty_yes');
    return { ok: true, outcome: 'accepted', message: `${T.name} accepts: ${GOAL_LABEL[t.goal].toLowerCase()}.`, why: isCounter ? ['They accept the terms they asked for'] : top };
  }
  M.patience--; M.until = s.tick;
  addRelation(s, them, s.player, -1);
  // a near miss: they name the cheapest extra term that would get them to yes
  if (st.p > 0.2 && M.patience > 0) {
    const missing = 14 * Math.log(0.8 / 0.2) - st.factors.reduce((a, x) => a + x.pts, 0); // points needed for ~80%
    const cand = st.available.filter((k) => !t.give.includes(k) && !(CASH[k] && t.give.some((g) => CASH[g])) && (st.termValue[k] ?? 0) > 0)
      .sort((a, b) => costRank(a) - costRank(b));
    const pick = cand.find((k) => (st.termValue[k] ?? 0) >= missing) ?? cand.sort((a, b) => (st.termValue[b] ?? 0) - (st.termValue[a] ?? 0))[0];
    // upgrading the cash package also counts
    const upgrade = t.give.find((k) => CASH[k]) && (['cash3', 'cash6'] as Term[]).find((k) => !t.give.includes(k) && (CASH[k]! > CASH[t.give.find((g) => CASH[g])!]!));
    const extra = pick ?? upgrade;
    if (extra) {
      const give = [...t.give.filter((k) => !(CASH[extra] && CASH[k])), extra];
      M.counter = { goal: t.goal, give, tick: s.tick };
      cable(s, them, 'offer');
      return { ok: false, outcome: 'counter', message: `${T.name} counters: “Add ${TERM_LABEL[extra].toLowerCase()} and we have a deal.”`, why: top, counter: give };
    }
  }
  cable(s, them, 'treaty_no');
  if (M.patience <= 0) addGrudge(s, them, s.player, 'pressed it too hard at the table', 3);
  return { ok: false, outcome: 'refused', message: `${T.name} refuses (the odds were ${(st.p * 100).toFixed(0)}%).${M.patience <= 0 ? ' Its patience is exhausted for half a year.' : ` Patience left: ${M.patience}.`}`, why: top };
}
const costRank = (k: Term) => ({ lift: 0, tech: 1, cash1: 2, cut: 3, cash3: 4, guarantee: 5, cash6: 6 } as Record<Term, number>)[k];

/** Walk away from a counteroffer (no cost). */
export function walkAway(s: GameState, them: CountryId) { const M = memo(s, them); M.counter = undefined; }
