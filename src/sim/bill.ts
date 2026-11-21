/**
 * The bill: a law is not a button. You introduce it, and for a few weeks it is fought over, seat by seat.
 *
 * The chamber is real: 400 seats split between the factions in a democracy (or a managed parliament), or the sixty
 * members of the inner circle in an autocracy, where what counts is clout, not votes. Every faction's members lean
 * yes or no from its mood and what the law does to it. You see the headcount and the number you need.
 *
 * You start with two moves and get one more each week (two at most in hand), and each move has a price someone pays:
 *   whip         lean on your own: strong with your partners in government (or the pillars of the regime), weak with
 *                anyone else, weaker every time (4 capital)
 *   sweetener    a budget line for one faction's people (money): they come over, the rest call it pork
 *   deal         a back-room deal with a faction's leader: a lot of votes that do not fade, and a favour owed: pass a
 *                law they want within a year or they turn on you (two open favours at most)
 *   twist arms   pressure, files, threats (3 capital): it works, and the more you do it the likelier it leaks
 *   water down   (once) the law does less, its opponents relax, its supporters cool
 *   sunset       (once) it expires after four years: its opponents relax
 *   go public    (3 capital, every other week) address the nation: worth as much as your approval, or worse than nothing
 *   delay        (twice) the vote moves two weeks out: more time for you, and for them
 * You can call the vote early, or withdraw the bill (half the capital back).
 *
 * The opposition works too: every week its leader goes after the faction that is easiest to turn (the closer it is
 * to the line and the more seats it has, the likelier), stronger when you are unpopular; in a democracy they may
 * filibuster once. What you won fades a little every week: people waver. Then the vote: a roll call, faction by
 * faction, with a little uncertainty left in it. Win against the odds and it is a landmark; lose and it costs you.
 */
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { personName } from './leaders';
import { minority } from './coalition';
import { approval } from './approval';
import { FACTIONS, LAWS, enactLaw, dropLaw, factionMeta, free, clout, hasLaw, lawById, lawCost, leanOf, spendPC, sway, type Law } from './domestic';
import type { Country, FactionId, GameState } from './types';

export type BillMove = 'whip' | 'sweeten' | 'deal' | 'twist' | 'water' | 'sunset' | 'public' | 'delay';
export interface Bill {
  law: string; started: number; vote: number; status: 'open' | 'passed' | 'failed' | 'withdrawn';
  chamber: 'parliament' | 'circle';
  seats: Partial<Record<FactionId, number>>;
  /** votes won (or lost) with each faction: fades about 10% a week */
  bonus: Partial<Record<FactionId, number>>;
  /** votes bought with a deal: they do not fade */
  lock: Partial<Record<FactionId, number>>;
  /** the moves made, as `move:faction` (or `move` for the bill as a whole), and when */
  used: { k: string; tick: number }[];
  moves: number;
  /** the amendments: supporters' and opponents' feeling (pm, nm), the law's effect (em), a sunset clause */
  pm: number; nm: number; em: number; sunset: boolean;
  delays: number; filibuster?: boolean; twists: number;
  foe: string; cost: number;
  /** the headcount when it was introduced, as a share of the chamber */
  odds0: number;
  beats: { tick: number; text: string; tone: 'good' | 'bad' | 'info' }[];
  result?: { yes: number; no: number; by: { f: FactionId; yes: number; no: number }[] };
  seen?: boolean; warned?: boolean;
}
export interface BillRec { law: string; tick: number; passed: boolean; yes: number; no: number; odds0: number }
export interface Iou { f: FactionId; since: number; due: number; law: string; want?: string }

export const MOVE_META: Record<BillMove, { icon: string; name: string; desc: string; per: boolean }> = {
  whip: { icon: '📣', name: 'Whip', desc: 'Lean on them: strong with your partners, weak with anyone else, weaker every time', per: true },
  sweeten: { icon: '🎁', name: 'Sweetener', desc: 'A budget line for their people: they come over, the rest call it pork', per: true },
  deal: { icon: '🤝', name: 'Back-room deal', desc: 'Votes that do not fade; you owe them a law they want within a year', per: true },
  twist: { icon: '🗂', name: 'Twist arms', desc: 'Pressure and files: it works, and it may leak', per: true },
  water: { icon: '💧', name: 'Water it down', desc: 'The law does 30% less: its opponents relax, its supporters cool', per: false },
  sunset: { icon: '🌅', name: 'Sunset clause', desc: 'It expires after four years: its opponents relax', per: false },
  public: { icon: '🎙', name: 'Go public', desc: 'Address the nation: worth as much as your approval', per: false },
  delay: { icon: '⏳', name: 'Delay the vote', desc: 'Two more weeks: for you, and for them', per: false },
};

const isPartner = (c: Country, f: FactionId) => !!c.politics?.gov?.partners.includes(f);
const lawOf = (b: Bill): Law => lawById(b.law)!;
const sumSeats = (b: Bill) => Object.values(b.seats).reduce((t, v) => t + (v ?? 0), 0);
export const needOf = (b: Bill) => Math.floor(sumSeats(b) / 2) + 1;
export const activeBill = (s: GameState): Bill | undefined => { const b = s.countries[s.player]?.politics?.bill; return b && b.status === 'open' ? b : undefined; };
export const chamberName = (b: Pick<Bill, 'chamber'>) => (b.chamber === 'circle' ? 'the inner circle' : 'parliament');

/** How a faction's members lean before any move: their mood, and what the law (as amended) does to them. */
function baseStance(s: GameState, c: Country, b: Pick<Bill, 'law' | 'pm' | 'nm' | 'chamber'>, f: FactionId): number {
  const F = c.politics!.factions.find((x) => x.id === f)!;
  const lean = leanOf(lawOf(b as Bill), f, b);
  let p = 1 / (1 + Math.exp(-((F.mood - 50) / 13 + lean / 7)));
  if (isPartner(c, f)) p += 0.06;
  if (b.chamber === 'parliament') { if (c.gov === 'F') p += 0.1; if (minority(c)) p -= 0.08; }
  return p;
}
export function stanceOf(s: GameState, c: Country, b: Bill, f: FactionId): number {
  return clamp(baseStance(s, c, b, f) + (b.bonus[f] ?? 0) + (b.lock[f] ?? 0), 0.02, 0.98);
}
export interface Headcount { yes: number; no: number; need: number; total: number; by: { f: FactionId; seats: number; p: number; yes: number }[] }
export function headcount(s: GameState, b: Bill): Headcount {
  const c = s.countries[s.player];
  const by = FACTIONS.map(({ id }) => { const seats = b.seats[id] ?? 0; const p = stanceOf(s, c, b, id); return { f: id, seats, p, yes: seats * p }; }).filter((x) => x.seats > 0);
  const total = sumSeats(b);
  const yes = by.reduce((t, x) => t + x.yes, 0);
  return { yes, no: total - yes, need: needOf(b), total, by };
}
/** The chance the vote passes as things stand (the roll call keeps a little uncertainty: about ±5% per faction). */
export function passOdds(s: GameState, b: Bill): number {
  const h = headcount(s, b);
  const sd = Math.sqrt(h.by.reduce((t, x) => t + (x.seats * 0.058) ** 2, 0)) || 1;
  const z = (h.yes - (h.need - 0.5)) / sd;
  return clamp(1 / (1 + Math.exp(-1.7 * z)), 0.01, 0.99);
}

// ------------------------------------------------------------------ moves
const timesUsed = (b: Bill, k: string) => b.used.filter((u) => u.k === k).length;
const lastUsed = (b: Bill, k: string) => b.used.filter((u) => u.k === k).reduce((t, u) => Math.max(t, u.tick), -999);
export const sweetCost = (c: Country) => 0.001 * c.eco.gdp;
/** The law a faction most wants that is not yet in force (what a deal will have to be repaid with). */
export function wantOf(c: Country, f: FactionId, not?: string): Law | undefined {
  return LAWS.filter((l) => l.id !== not && !hasLaw(c, l.id) && (l.lean[f] ?? 0) >= 6 && !(l.excl && hasLaw(c, l.excl)) && !l.req?.(c)).sort((a, z) => (z.lean[f] ?? 0) - (a.lean[f] ?? 0))[0];
}

export interface MoveCheck { ok: boolean; why?: string; pc: number; cash: number; risk?: number }
export function moveCheck(s: GameState, b: Bill, m: BillMove, f?: FactionId): MoveCheck {
  const c = s.countries[s.player], P = c.politics!;
  const out = (ok: boolean, why: string | undefined, pc = 0, cash = 0, risk?: number): MoveCheck => ({ ok: ok && (!why), ...(why ? { why } : {}), pc, cash, ...(risk !== undefined ? { risk } : {}) });
  if (b.status !== 'open') return out(false, 'The vote is over');
  if (b.moves < 1) return out(false, 'No moves left this week');
  if (MOVE_META[m].per && (!f || !(b.seats[f] ?? 0))) return out(false, 'Pick a faction');
  switch (m) {
    case 'whip': return P.pc < 4 ? out(false, 'Needs 4 capital', 4) : out(true, undefined, 4);
    case 'sweeten': return timesUsed(b, `sweeten:${f}`) ? out(false, 'Already sweetened') : c.eco.cash < sweetCost(c) && c.eco.debt / c.eco.gdp > 1.5 ? out(false, 'No money for it') : out(true, undefined, 0, sweetCost(c));
    case 'deal': {
      if (timesUsed(b, `deal:${f}`)) return out(false, 'Already a deal with them');
      if ((P.ious ?? []).some((i) => i.f === f)) return out(false, 'They are still waiting on the last favour');
      if ((P.ious ?? []).length >= 2) return out(false, 'You already owe two favours');
      if (!wantOf(c, f!, b.law)) return out(false, 'There is no law left they want: nothing to repay them with');
      return out(true, undefined);
    }
    case 'twist': return P.pc < 3 ? out(false, 'Needs 3 capital', 3) : out(true, undefined, 3, 0, twistRisk(b));
    case 'water': return timesUsed(b, 'water') ? out(false, 'Already watered down') : out(true, undefined);
    case 'sunset': return timesUsed(b, 'sunset') ? out(false, 'It already has a sunset clause') : out(true, undefined);
    case 'public': return s.tick - lastUsed(b, 'public') < 2 ? out(false, 'Once every other week') : P.pc < 3 ? out(false, 'Needs 3 capital', 3) : out(true, undefined, 3);
    case 'delay': return b.delays >= 2 ? out(false, 'Delayed twice already') : out(true, undefined);
  }
}
const twistRisk = (b: Bill) => clamp(0.2 + 0.12 * b.twists, 0, 0.8);
const publicSwing = (s: GameState, c: Country, b: Bill) => clamp((approval(s, c) - 50) / 250, -0.06, 0.05) * (b.chamber === 'circle' ? 0.5 : 1);

/** What a move would do to the bill (without the luck): applied to `b` in place. */
function applyMove(s: GameState, c: Country, b: Bill, m: BillMove, f?: FactionId) {
  const add = (k: 'bonus' | 'lock', id: FactionId, v: number) => { b[k][id] = (b[k][id] ?? 0) + v; };
  switch (m) {
    case 'whip': add('bonus', f!, (isPartner(c, f!) || b.chamber === 'circle' && clout(c, f!) >= 1 ? 0.1 : 0.05) * 0.6 ** timesUsed(b, `whip:${f}`)); break;
    case 'sweeten': add('bonus', f!, 0.15); for (const x of FACTIONS) if (x.id !== f && (b.seats[x.id] ?? 0) > 0) add('bonus', x.id, -0.015); break;
    case 'deal': add('lock', f!, 0.25); break;
    case 'twist': add('bonus', f!, 0.15 * 0.7 ** timesUsed(b, `twist:${f}`)); break;
    case 'water': b.pm *= 0.75; b.nm *= 0.5; b.em *= 0.7; break;
    case 'sunset': b.nm *= 0.7; b.sunset = true; break;
    case 'public': { const v = publicSwing(s, c, b); for (const x of FACTIONS) if ((b.seats[x.id] ?? 0) > 0) add('bonus', x.id, v); break; }
    case 'delay': b.vote += 2; b.delays++; break;
  }
}
const cloneBill = (b: Bill): Bill => ({ ...b, bonus: { ...b.bonus }, lock: { ...b.lock }, used: [...b.used] });
/** The headcount a move would leave (yes seats before and after), for the buttons. */
export function previewMove(s: GameState, b: Bill, m: BillMove, f?: FactionId): { before: number; after: number; odds: number } {
  const c = s.countries[s.player];
  const x = cloneBill(b);
  applyMove(s, c, x, m, f);
  return { before: headcount(s, b).yes, after: headcount(s, x).yes, odds: passOdds(s, x) };
}

const beat = (b: Bill, s: GameState, text: string, tone: 'good' | 'bad' | 'info') => { b.beats.push({ tick: s.tick, text, tone }); if (b.beats.length > 30) b.beats.splice(0, b.beats.length - 30); };

export function actBillMove(s: GameState, m: BillMove, f?: FactionId) {
  const c = s.countries[s.player], P = c.politics;
  const b = P?.bill;
  if (!P || !b) return { ok: false, message: 'No bill is before parliament' };
  const chk = moveCheck(s, b, m, f);
  if (!chk.ok) return { ok: false, message: chk.why ?? 'Not possible' };
  if (chk.pc && !spendPC(c, chk.pc)) return { ok: false, message: `Needs ${chk.pc} capital` };
  if (chk.cash) { c.eco.cash -= chk.cash; }
  const before = Math.round(headcount(s, b).yes);
  const law = lawOf(b);
  const who = f ? factionMeta(f).short : '';
  const lead = f ? P.factions.find((x) => x.id === f)!.leader : '';
  applyMove(s, c, b, m, f);
  b.used.push({ k: MOVE_META[m].per ? `${m}:${f}` : m, tick: s.tick });
  b.moves--;
  let text = '';
  if (m === 'twist') {
    b.twists++;
    if (nextRand(s) < chk.risk!) {
      // it leaks
      for (const x of FACTIONS) if ((b.seats[x.id] ?? 0) > 0) b.bonus[x.id] = (b.bonus[x.id] ?? 0) - 0.05;
      sway(c, 'liberals', -8); sway(c, f!, -8);
      c.eco.stability = clamp(c.eco.stability - 1, 0, 100);
      s.stats.apprBoost = (s.stats.apprBoost ?? 0) - 1.5;
      logEvent(s, `📰 SCANDAL: how the government is twisting arms over the ${law.title} leaks to the press. ${lead} goes on television.`, 'danger', [c.id], true);
      text = `It leaked. The ${who} came over, but the papers have the story, and everyone else is angrier.`;
      beat(b, s, text, 'bad');
    }
  }
  if (!text) {
    const after = Math.round(headcount(s, b).yes);
    const d = after - before;
    text = {
      whip: `The whips work the ${who} benches.`,
      sweeten: `A line for the ${who} goes into the budget.`,
      deal: `A deal with ${lead} (${who}): their votes, for a favour.`,
      twist: `${lead}'s people get a quiet visit.`,
      water: 'The bill is watered down: it will do less, and fewer people fear it.',
      sunset: 'A sunset clause: in four years it expires unless renewed.',
      public: `You take the bill to the country.`,
      delay: 'The vote is pushed back two weeks.',
    }[m] + (m === 'delay' ? '' : ` ${d >= 0 ? '+' : ''}${d} vote${Math.abs(d) === 1 ? '' : 's'}.`);
    beat(b, s, text, m === 'public' && d < 0 ? 'bad' : 'good');
  }
  if (m === 'deal') {
    const w = wantOf(c, f!, b.law);
    (P.ious ??= []).push({ f: f!, since: s.tick, due: s.tick + 52, law: b.law, ...(w ? { want: w.id } : {}) });
  }
  return { ok: true, message: text };
}

/** Bring a law before parliament (or the inner circle). */
export function actIntroduceBill(s: GameState, id: string) {
  const c = s.countries[s.player], P = c.politics, law = lawById(id);
  if (!P || !law) return { ok: false, message: 'No such law' };
  if (s.legacy && s.legacy.status !== 'office') return { ok: false, message: 'You are not in power' };
  if (activeBill(s)) return { ok: false, message: `The ${lawOf(activeBill(s)!).title} is still before ${chamberName(activeBill(s)!)}` };
  if (hasLaw(c, id)) return { ok: false, message: 'Already in force' };
  if (law.excl && hasLaw(c, law.excl)) return { ok: false, message: `Repeal the ${lawById(law.excl)!.title} first` };
  const why = law.req?.(c);
  if (why) return { ok: false, message: why };
  if (s.tick - (s.stats[`lawTry:${id}`] ?? -999) < 26) return { ok: false, message: 'It was voted down recently: wait half a year' };
  const chamber: Bill['chamber'] = free(c) ? 'parliament' : 'circle';
  const cost = billCost(c, law);
  if (!spendPC(c, cost)) return { ok: false, message: `Needs ${cost} political capital (you have ${Math.floor(P.pc)})` };
  const N = chamber === 'parliament' ? 400 : 60;
  const w = P.factions.map((f) => ({ f: f.id, w: chamber === 'parliament' ? f.support : f.support * clout(c, f.id) }));
  const tw = w.reduce((t, x) => t + x.w, 0);
  const seats: Bill['seats'] = {};
  let given = 0;
  w.forEach((x, i) => { const n = i === w.length - 1 ? N - given : Math.round((N * x.w) / tw); seats[x.f] = n; given += n; });
  const L = s.legacy;
  const foe = chamber === 'parliament' ? personName(c, 'foe', (L?.term ?? 1) * 7 + s.settings.seed % 97) : L?.persona?.rival?.name ?? personName(c, 'rival', s.settings.seed % 97);
  const b: Bill = { law: id, started: s.tick, vote: s.tick + (c.gov === 'D' ? 4 : 3), status: 'open', chamber, seats, bonus: {}, lock: {}, used: [], moves: 2, pm: 1, nm: 1, em: 1, sunset: false, delays: 0, twists: 0, foe, cost, odds0: 0, beats: [] };
  P.bill = b;
  b.odds0 = headcount(s, b).yes / N;
  beat(b, s, `The ${law.title} is introduced. ${foe} leads the ${chamber === 'parliament' ? 'opposition' : 'hardliners'} against it.`, 'info');
  logEvent(s, `📜 THE BILL: the ${law.title} goes before ${chamberName(b)}. The vote is in ${b.vote - s.tick} weeks; ${foe} leads the fight against it.`, 'info', [c.id], true);
  return { ok: true, message: `The ${law.title} is before ${chamberName(b)}.` };
}
export const billCost = (c: Country, law: Law) => Math.round(lawCost(c, law, false) * (free(c) ? 1 : 0.85));

export function actCallVote(s: GameState) {
  const b = activeBill(s);
  if (!b) return { ok: false, message: 'No bill' };
  b.vote = s.tick;
  beat(b, s, 'You call the vote.', 'info');
  holdVote(s, s.countries[s.player], b);
  return { ok: true, message: 'The vote is called.' };
}
export function actWithdrawBill(s: GameState) {
  const c = s.countries[s.player], b = activeBill(s);
  if (!b) return { ok: false, message: 'No bill' };
  b.status = 'withdrawn'; b.seen = true;
  c.politics!.pc = clamp(c.politics!.pc + Math.floor(b.cost / 2), 0, 100);
  s.stats[`lawTry:${b.law}`] = s.tick - 14; // a withdrawn bill can come back in three months
  logEvent(s, `📜 The government withdraws the ${lawOf(b).title}.`, 'info', [c.id]);
  return { ok: true, message: 'Withdrawn: half the capital is back.' };
}

const FOE_LINES: Record<FactionId, string[]> = {
  labour: ['tells the unions this bill is coming for their jobs', 'meets the union bosses behind closed doors'],
  business: ['warns the business lobby what this will cost them', 'has lunch with the bankers'],
  military: ['tells the generals the government does not respect them', 'visits the barracks with cameras in tow'],
  nationalists: ['calls the bill a betrayal of the nation', 'stirs up the nationalist benches'],
  liberals: ['calls it an attack on freedom', 'rallies the campaigners against it'],
  regions: ['tours the provinces against it', 'promises the regional governors more if it fails'],
};

function holdVote(s: GameState, c: Country, b: Bill) {
  const P = c.politics!, law = lawOf(b);
  const by = FACTIONS.filter(({ id }) => (b.seats[id] ?? 0) > 0).map(({ id }) => {
    const seats = b.seats[id]!;
    const p = clamp(stanceOf(s, c, b, id) + (nextRand(s) - 0.5) * 0.12, 0, 1);
    const yes = Math.round(seats * p);
    return { f: id, yes, no: seats - yes };
  });
  const yes = by.reduce((t, x) => t + x.yes, 0), no = by.reduce((t, x) => t + x.no, 0);
  b.result = { yes, no, by };
  const passed = yes >= needOf(b);
  b.status = passed ? 'passed' : 'failed';
  const where = b.chamber === 'circle' ? 'the inner circle' : 'parliament';
  (P.bills ??= []).push({ law: b.law, tick: s.tick, passed, yes, no, odds0: b.odds0 });
  if (P.bills.length > 12) P.bills.splice(0, P.bills.length - 12);
  if (passed) {
    enactLaw(s, c, b.law, { ...(b.em !== 1 ? { em: Math.round(b.em * 100) / 100 } : {}), ...(b.pm !== 1 ? { pm: b.pm } : {}), ...(b.nm !== 1 ? { nm: Math.round(b.nm * 100) / 100 } : {}), ...(b.sunset ? { until: s.tick + 208 } : {}) });
    const against = b.odds0 < 0.5;
    s.stats.billsWon = (s.stats.billsWon ?? 0) + 1;
    if (against) { s.stats.landmarks = (s.stats.landmarks ?? 0) + 1; P.pc = clamp(P.pc + 4, 0, 100); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 1; }
    logEvent(s, `🗳 THE VOTE: the ${law.title} PASSES ${yes} to ${no}${against ? '. A landmark: it was never supposed to get through' : ''}.`, 'info', [c.id], true, against ? { big: true, prov: c.capital } : undefined);
  } else {
    s.stats.billsLost = (s.stats.billsLost ?? 0) + 1;
    s.stats[`lawTry:${b.law}`] = s.tick;
    P.pc = clamp(P.pc + Math.floor(b.cost / 3), 0, 100);
    c.eco.stability = clamp(c.eco.stability - 1, 0, 100);
    s.stats.apprBoost = (s.stats.apprBoost ?? 0) - (needOf(b) - yes > sumSeats(b) * 0.1 ? 1.5 : 0.5); // a rout hurts more than a near miss
    logEvent(s, `🗳 THE VOTE: the ${law.title} FALLS in ${where}, ${yes} to ${no}. ${b.foe} claims victory.`, 'danger', [c.id], true);
  }
}

/** Weekly: the opposition's work, wavering, the vote; favours coming due; sunset clauses running out. */
export function stepBill(s: GameState) {
  const c = s.countries[s.player], P = c?.politics;
  if (!c?.alive || !P) return;
  const inPower = !s.legacy || s.legacy.status === 'office';
  // sunset clauses
  for (const l of [...P.laws]) if (l.until !== undefined && s.tick >= l.until) {
    dropLaw(s, c, l.id, 0);
    logEvent(s, `📜 The ${lawById(l.id)?.title ?? l.id} expires: its sunset clause has run out.`, 'info', [c.id], true);
  }
  // favours owed
  if (P.ious?.length && inPower) {
    for (const i of [...P.ious]) if (s.tick >= i.due) {
      P.ious = P.ious.filter((x) => x !== i);
      sway(c, i.f, -18);
      c.eco.stability = clamp(c.eco.stability - 2, 0, 100);
      const F = P.factions.find((x) => x.id === i.f)!;
      logEvent(s, `💢 BETRAYED: ${F.leader} (${factionMeta(i.f).short}) says the government broke its word over the ${lawById(i.law)?.title ?? 'deal'}. They will not forget it.`, 'danger', [c.id], true);
    }
  }
  const b = P.bill;
  if (!b || b.status !== 'open') return;
  if (!inPower) { b.status = 'withdrawn'; b.seen = true; return; }
  if (s.tick > b.started) b.moves = Math.min(2, b.moves + 1);
  for (const k of Object.keys(b.bonus) as FactionId[]) b.bonus[k] = Math.round(b.bonus[k]! * 0.9 * 1000) / 1000;
  if (s.tick >= b.vote) { holdVote(s, c, b); return; }
  // the opposition goes after the faction that is easiest to turn
  const appr = approval(s, c);
  const O = 0.035 + 0.045 * clamp((58 - appr) / 40, 0, 1);
  const h = headcount(s, b);
  const tgt = [...h.by].filter((x) => x.p > 0.2 && x.p < 0.9).sort((x, y) => y.seats * (1 - Math.abs(y.p - 0.55) * 1.6) - x.seats * (1 - Math.abs(x.p - 0.55) * 1.6))[0];
  if (tgt) {
    const v = O * (1.6 + nextRand(s) * 0.8);
    b.bonus[tgt.f] = (b.bonus[tgt.f] ?? 0) - v;
    const lost = Math.round(tgt.seats * v);
    const lines = FOE_LINES[tgt.f];
    beat(b, s, `${b.foe} ${lines[Math.floor(nextRand(s) * lines.length)]}. −${lost} vote${lost === 1 ? '' : 's'} among the ${factionMeta(tgt.f).short}.`, 'bad');
  }
  if (b.chamber === 'parliament' && c.gov === 'D' && !b.filibuster && b.vote - s.tick >= 2 && nextRand(s) < 0.2) {
    b.filibuster = true; b.vote += 1;
    beat(b, s, `${b.foe}'s allies filibuster: the vote slips a week.`, 'bad');
  }
  if (!b.warned && b.vote - s.tick <= 1) {
    b.warned = true;
    logEvent(s, `⏳ THE VOTE IS NEXT WEEK: the ${lawOf(b).title}. ${Math.round(h.yes)} for, ${h.need} needed.`, 'info', [c.id], true);
  }
}
