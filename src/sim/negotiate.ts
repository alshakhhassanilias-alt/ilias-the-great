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
import { isMajor } from './drama';
import { spendPC, sway } from './domestic';
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
export type Term = 'cash1' | 'cash3' | 'cash6' | 'lift' | 'tech' | 'guarantee' | 'cut' | 'visit' | 'apology' | 'withdraw' | 'arms';
export interface Terms { goal: Goal; give: Term[] }
export const TERM_LABEL: Record<Term, string> = {
  cash1: 'Investment package (0.1% of your GDP)', cash3: 'Investment package (0.3% of your GDP)', cash6: 'Investment package (0.6% of your GDP)',
  lift: 'Lift your sanctions on them', tech: 'Share technology', guarantee: 'Guarantee their security', cut: 'Cut your ties with their rival',
  visit: 'A state visit with full honours (6 political capital)', apology: 'A formal apology for past wrongs (8 political capital)',
  withdraw: 'Pull your troops back from the border', arms: 'Sell them modern weapons at a discount (0.1% of your GDP)',
};

// ------------------------------------------------------------------ negotiating styles
/**
 * Every country negotiates in its own way, set by its leader and its system: a merchant haggles and always comes
 * back with a number; a proud nationalist will not be bought but can be honoured; a cautious leader wants
 * guarantees and goes one step at a time; an ideologue cares who you are; a strongman respects strength and
 * personal attention; a parliamentary democracy answers to its voters. The style changes what each term is worth,
 * how much patience they have, and how they talk.
 */
export type StyleId = 'merchant' | 'proud' | 'cautious' | 'ideologue' | 'strongman' | 'parliament' | 'pragmatic';
export interface Style { id: StyleId; name: string; icon: string; desc: string; patience: number; mult: Partial<Record<Term | 'cash', number>> }
export const STYLES: Record<StyleId, Style> = {
  merchant: { id: 'merchant', name: 'The Merchant', icon: '💱', desc: 'Haggles over everything and always comes back with a price. Money and trade talk; promises do not.', patience: 4, mult: { cash: 1.4, tech: 1.1, visit: 0.6, apology: 0.6, guarantee: 0.8 } },
  proud: { id: 'proud', name: 'National Pride', icon: '🚩', desc: 'Cannot be seen to be bought. Respect, honours and an apology move it; cash offers are an insult.', patience: 2, mult: { cash: 0.55, visit: 1.8, apology: 1.5, withdraw: 1.3, guarantee: 0.7 } },
  cautious: { id: 'cautious', name: 'Security First', icon: '🛡', desc: 'Wants guarantees and goes one step at a time. Pulling back troops and promising protection count most.', patience: 3, mult: { guarantee: 1.5, withdraw: 1.6, arms: 1.3, cash: 0.9 } },
  ideologue: { id: 'ideologue', name: 'The True Believer', icon: '📜', desc: 'Judges you by your system and your record. Shared values open doors; money cannot close the gap.', patience: 3, mult: { cash: 0.7, visit: 1.2, tech: 0.9 } },
  strongman: { id: 'strongman', name: 'The Strongman', icon: '🥊', desc: 'Respects strength and personal attention. A state visit and weapons impress; weakness invites contempt.', patience: 3, mult: { visit: 1.6, arms: 1.5, cash: 1.1, apology: 0.6 } },
  parliament: { id: 'parliament', name: 'Answers to Voters', icon: '🗳', desc: 'Any deal must survive its parliament and press. Your reputation and record weigh heavily; so does technology and trade.', patience: 4, mult: { tech: 1.3, cash: 0.9, visit: 1.1, arms: 0.8 } },
  pragmatic: { id: 'pragmatic', name: 'The Pragmatist', icon: '🧮', desc: 'Weighs costs and benefits without drama. Every term counts at face value.', patience: 3, mult: {} },
};
export function styleOf(T: Country): Style {
  const tr: string[] = T.leader?.traits ?? [];
  if (tr.includes('mercantilist') || (tr.includes('pragmatist') && T.ai.trade > 0.6)) return STYLES.merchant;
  if (tr.includes('nationalist')) return STYLES.proud;
  if (tr.includes('strongman') || (T.gov === 'A' && tr.includes('hawk'))) return STYLES.strongman;
  if (tr.includes('ideologue')) return STYLES.ideologue;
  if (tr.includes('paranoid') || tr.includes('isolationist')) return STYLES.cautious;
  if (T.gov === 'D' || T.gov === 'F') return STYLES.parliament;
  return STYLES.pragmatic;
}
/** What the leader says when you sit down: in their style, about what they want most. */
export function openingLine(s: GameState, T: Country, st: { interests: Interest[]; style: Style }, rel: number): string {
  const top = st.interests[0]?.key;
  const want = top === 'money' ? 'investment' : top === 'security' ? 'our security' : top === 'trade' ? 'access to your markets' : top === 'tech' ? 'technology' : top === 'relief' ? 'an end to your sanctions' : top === 'rival' ? 'distance between you and our enemies' : 'something real';
  const cold = rel < -40;
  switch (st.style.id) {
    case 'merchant': return cold ? `We do not like you. But we like money, and ${want}. Name your price.` : `Everything has a price. Ours is ${want}. Shall we talk numbers?`;
    case 'proud': return cold ? 'You come to us after everything you have done? Show us respect first, then we will see.' : `${T.name} is not for sale. Treat us as equals and we will listen.`;
    case 'cautious': return cold ? 'Words cost nothing. Pull back your soldiers and then we can talk.' : `Before anything else we need to know you will not threaten us. ${want.charAt(0).toUpperCase() + want.slice(1)} would help.`;
    case 'ideologue': return cold ? 'Your system and ours have nothing in common. Why should we trust you?' : `We judge partners by what they stand for. Convince us yours is a partnership of principle.`;
    case 'strongman': return cold ? 'You are either brave or foolish to come here. Impress me.' : `I deal with leaders, not clerks. Come in person, bring something worth my time.`;
    case 'parliament': return cold ? 'Our parliament would never approve a deal with you as things stand. Your record would have to change.' : `Whatever we agree must pass our parliament. Give us something we can sell to our voters: ${want}.`;
    default: return cold ? 'Relations are bad, but we are realists. Make it worth our while.' : `We are open to a sensible deal. ${want.charAt(0).toUpperCase() + want.slice(1)} is what matters to us.`;
  }
}
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
  style: Style;
  /** the reconciliation process with them, if any (détente gives a bonus at the table) */
  detente: boolean;
}

interface NegoMemo { patience: number; until: number; counter?: { goal: Goal; give: Term[]; tick: number } }
function memo(s: GameState, them: CountryId): NegoMemo {
  const m = (s.nego ??= {}) as Record<number, NegoMemo>;
  const full = styleOf(s.countries[them]).patience;
  const x = (m[them] ??= { patience: full, until: -1 });
  // patience recovers over time
  if (x.patience < full && s.tick - x.until > 26) { x.patience = full; }
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
  const style = styleOf(T);
  const detente = (s.nego?.[them]?.track?.detenteUntil ?? -1) > s.tick;
  if (detente) factors.push({ label: 'The détente: you are reconciling', pts: 15 });
  else if (rel < -50) factors.push({ label: 'Bitter rivals: a deal looks like surrender at home (try the reconciliation process)', pts: -15 });
  if (style.id === 'parliament') { const v = mine((P.reputation - 50) * 0.35 + (P.gov === 'D' ? 4 : -6)); if (v) factors.push({ label: `Their voters judge your record (reputation ${P.reputation.toFixed(0)})`, pts: v }); }
  if (style.id === 'strongman' && power < 0.7) factors.push({ label: 'A strongman despises weakness', pts: -8 });
  if (style.id === 'ideologue') factors.push({ label: T.gov === P.gov ? 'Same political system' : 'A different political system', pts: T.gov === P.gov ? 10 : -6 });
  if (style.id === 'cautious' && t.goal === 'alliance' && !tr?.coop && !tr?.nap) factors.push({ label: 'One step at a time: a pact or cooperation first', pts: -15 });
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
  available.push('visit');
  if (g > 5) available.push('apology');
  const nb = neighborsOf(s, geo, me).includes(them);
  if (nb) available.push('withdraw');
  if (P.mil.milTech > T.mil.milTech + 3 && rel > -40) available.push('arms');
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
      : k === 'guarantee' ? mine(trust * Math.min(30, 6 + 35 * want('security') * clamp(power, 0.3, 1.5)))
      : k === 'visit' ? mine(Math.min(22, 7 + rel * 0.04 + (isMajor(s, me) ? 4 : 0)))
      : k === 'apology' ? mine(Math.min(30, 6 + g * 0.8))
      : k === 'withdraw' ? mine(Math.min(28, 6 + (sec.who === me ? 30 * sec.v : 0) + 8 * want('security')))
      : k === 'arms' ? mine(trust * Math.min(24, 6 + 22 * want('security') + (hasTrait(T, 'hawk') ? 4 : 0)))
      : mine(trust * Math.min(30, 10 + 30 * want('rival')));
    const mult = style.mult[CASH[k] ? 'cash' : k] ?? 1;
    termValue[k] = mine((termValue[k] ?? 0) * mult);
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
  if (t.give.includes('visit')) costs.push('6 political capital');
  if (t.give.includes('apology')) costs.push('8 political capital · nationalists at home are angry');
  if (t.give.includes('withdraw')) costs.push('Your army readiness −5%');
  if (t.give.includes('arms')) costs.push(`${fmtMoney(0.001 * P.eco.gdp)} and their army gets stronger`);
  const pcNeed = (t.give.includes('visit') ? 6 : 0) + (t.give.includes('apology') ? 8 : 0);
  if (pcNeed > (P.politics?.pc ?? 0)) blocked ??= `You need ${pcNeed} political capital for these terms`;
  const p2 = blocked ? 0 : p;

  return { interests: I, redLines, blocked, leverage, factors, p: p2, termValue, available, rival, patience: M.patience, counter, costs, style, detente };
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
    if (t.give.includes('visit')) { spendPC(P, 6); addRelation(s, them, s.player, 3); }
    if (t.give.includes('apology')) { spendPC(P, 8); sway(P, 'nationalists', -6); for (const gr of s.grudges?.[`${them}>${s.player}`] ?? []) gr.w *= 0.5; }
    if (t.give.includes('withdraw')) P.mil.readiness = clamp(P.mil.readiness - 0.05, 0.2, 1);
    if (t.give.includes('arms')) { const f = fund(s, s.player, 0.001 * P.eco.gdp, `Arms sale to ${T.name}`); if (f.ok) { T.mil.milTech += 1; T.mil.equipArmy += 0.002 * T.eco.gdp; } }
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
  if ((st.p > 0.2 || (st.style.id === 'merchant' && st.p > 0.08)) && M.patience > 0) {
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
  const worst = [...st.factors].sort((a, b) => a.pts - b.pts)[0];
  cable(s, them, 'treaty_no', worst && worst.pts < -5 ? `What stands in the way: ${worst.label.charAt(0).toLowerCase()}${worst.label.slice(1)}.` : undefined);
  if (M.patience <= 0) addGrudge(s, them, s.player, 'pressed it too hard at the table', 3);
  return { ok: false, outcome: 'refused', message: `${T.name} refuses (the odds were ${(st.p * 100).toFixed(0)}%).${M.patience <= 0 ? ' Its patience is exhausted for half a year.' : ` Patience left: ${M.patience}.`}`, why: top };
}
const costRank = (k: Term) => ({ lift: 0, visit: 1, tech: 1, withdraw: 2, cash1: 2, apology: 3, cut: 3, arms: 3, cash3: 4, guarantee: 5, cash6: 6 } as Record<Term, number>)[k];

/** Walk away from a counteroffer (no cost). */
export function walkAway(s: GameState, them: CountryId) { const M = memo(s, them); M.counter = undefined; }
