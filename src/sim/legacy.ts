/**
 * Legacy mode: a political career. You govern term by term (four years). Each term you commit to an
 * agenda, face the voters (or the party elite), and your legacy score tracks how history will judge you:
 * prosperity, power, the people's mood, your standing abroad, promises kept and wars won or lost.
 *
 * Lose an election and you are not out: you lead the opposition (or plot from exile in an autocracy)
 * while a rival government runs the country, and you can win your way back. Two failed comebacks, being
 * conquered, retiring or reaching the end of the era close the book: a history page sums up your rule.
 */
import type { Geo } from './geo';
import type { Country, GameState, LegacyState, TermRecord } from './types';
import { START_YEAR, TICKS_PER_YEAR } from './types';
import { agendaById, dealHand } from './agenda';
import { approval } from './events3';
import { avgLoyalty, ensureCabinet } from './cabinet';
import { personName } from './leaders';
import { strength } from './military';
import { alliesOf, isAtWar } from './relations';
import { clamp } from './util';
import { logEvent } from './log';
import { nextRand } from './rng';
import { pushInbox } from './events';
import { forcePeaceAll } from './war';
import { geoRefGet } from './geoRef';

export const TERM = 208; // four years
export const titleFor = (gov: string) => (gov === 'D' ? 'President' : gov === 'F' ? 'Prime Minister' : gov === 'M' ? 'Sovereign' : gov === 'C' ? 'General Secretary' : 'Chairman');
export const isFree = (gov: string) => gov === 'D' || gov === 'F';
const yearOfTick = (t: number) => START_YEAR + t / TICKS_PER_YEAR;
export const legacyActive = (s: GameState) => !!s.legacy && s.settings.mode === 'legacy' && s.legacy.status !== 'ended';
export const inOffice = (s: GameState) => !s.legacy || s.settings.mode !== 'legacy' || s.legacy.status === 'office';

const gdppc = (c: Country) => c.eco.realGdp / Math.max(1, c.eco.pop);
const powerRank = (s: GameState, c: Country) => s.countries.filter((x) => x.alive).sort((a, b) => strength(b) - strength(a)).findIndex((x) => x.id === c.id) + 1;

export function initLegacy(s: GameState) {
  const c = s.countries[s.player];
  s.legacy = {
    leader: s.settings.leaderName || personName(c, 'me', 1),
    title: titleFor(c.gov),
    status: 'office', term: 1, termStart: 0, nextVote: TERM,
    agenda: [], hand: dealHand(s, c, 1), score: 0, parts: {}, terms: [],
    start: { gdppc: gdppc(c), rank: powerRank(s, c), provinces: c.provinces.length, pop: c.eco.pop, stability: c.eco.stability, tick: 0, power: strength(c), rep: c.reputation, allies: alliesOf(s, c.id).length },
    maxYear: START_YEAR + 40,
    chronicle: [{ tick: 0, text: `${s.settings.leaderName || personName(c, 'me', 1)} takes office as ${titleFor(c.gov)} of ${c.name}.` }],
  };
  delete s.stats.nextVote; // the legacy calendar replaces the generic one
}

/** Commit to agenda cards (up to three of the hand). */
export function actChooseAgenda(s: GameState, ids: string[]) {
  const L = s.legacy, c = s.countries[s.player];
  if (!L || !L.hand.length) return { ok: false, message: 'No agenda to choose' };
  const pick = ids.filter((id) => L.hand.includes(id)).slice(0, 3);
  L.agenda = pick.map((id) => ({ id, start: s.tick, base: agendaById(id).base(s, c), done: false }));
  L.hand = [];
  if (pick.length) {
    L.chronicle.push({ tick: s.tick, text: `Term ${L.term}: ${L.leader} promised ${pick.map((id) => agendaById(id).title).join(', ')}.` });
    logEvent(s, `📜 ${L.title} ${L.leader} sets out the agenda: ${pick.map((id) => agendaById(id).title).join(' · ')}.`, 'info', [s.player], true);
  }
  return { ok: true, message: pick.length ? 'The agenda is set. Deliver it before the next election.' : 'You chose to govern without promises.' };
}

/** The legacy score: how history judges your rule so far. */
export function scoreParts(s: GameState): Record<string, number> {
  const L = s.legacy!, c = s.countries[s.player];
  const p = { ...L.parts };
  if (c.alive) {
    p.prosperity = 420 * Math.log(Math.max(0.2, gdppc(c) / L.start.gdppc));
    p.power = 140 * Math.log(Math.max(0.2, strength(c) / Math.max(1, L.start.power))) + 10 * (c.provinces.length - L.start.provinces);
    p.standing = 1.2 * (c.reputation - (L.start.rep ?? 50)) + 6 * (alliesOf(s, c.id).length - (L.start.allies ?? 0));
  }
  return p;
}
export const totalScore = (parts: Record<string, number>) => Object.values(parts).reduce((t, v) => t + v, 0);
export function grade(score: number) { return score >= 900 ? 'S' : score >= 600 ? 'A' : score >= 350 ? 'B' : score >= 150 ? 'C' : score >= 0 ? 'D' : 'F'; }
export const PART_LABEL: Record<string, string> = { prosperity: 'Prosperity', power: 'Power & territory', people: 'The people’s mood', standing: 'Standing abroad', agenda: 'Promises kept', wars: 'Wars', terms: 'Mandates' };

export function epithet(s: GameState): string {
  const L = s.legacy!, parts = scoreParts(s), score = totalScore(parts);
  if (score < -50) return 'the Ruinous';
  const c = s.countries[s.player];
  const wonWars = (s.warHistory ?? []).filter((r) => r.end >= L.start.tick && ((r.a === c.id && r.winner === 'a') || (r.b === c.id && r.winner === 'b'))).length;
  const gained = c.provinces.length - L.start.provinces;
  if (gained >= 6 || wonWars >= 3) return 'the Conqueror';
  const best = Object.entries(parts).filter(([k]) => k !== 'terms').sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 20) return score < 60 ? 'the Forgettable' : 'the Steady';
  return ({ prosperity: 'the Builder', power: 'the Strong', people: 'the Beloved', standing: 'the Statesman', agenda: 'the Visionary', wars: 'the Victorious' } as Record<string, string>)[best[0]] ?? 'the Steady';
}

// ------------------------------------------------------------------ the weekly step
export function stepLegacy(s: GameState, geo: Geo) {
  const L = s.legacy;
  if (!L || s.settings.mode !== 'legacy' || L.status === 'ended') return;
  const c = s.countries[s.player];
  if (!c.alive) { if (L.status === 'office') closeTerm(s, 'ended', `${c.name} falls; the government is swept away.`); endLegacy(s, `${c.name} was wiped off the map. ${L.leader}'s story ends in defeat and exile.`); return; }
  if (isAtWar(s, c.id)) s.stats[`legacyWar:${c.id}`] = s.tick;
  if (L.status === 'office') {
    // the people's mood accumulates week by week
    L.parts.people = (L.parts.people ?? 0) + ((c.eco.stability - 50) / 52) * 0.25 + ((approval(s, c) - 50) / 52) * 0.15;
    // promises: completion checks
    for (const a of L.agenda) {
      if (a.done || a.failed) continue;
      const card = agendaById(a.id);
      if (card.atTermEnd) continue;
      if (card.progress(s, c, a).value >= 1) {
        a.done = true;
        L.parts.agenda = (L.parts.agenda ?? 0) + card.points;
        L.chronicle.push({ tick: s.tick, text: `Promise kept: ${card.title}.` });
        logEvent(s, `🏅 PROMISE KEPT: ${card.title}. Your legacy grows (+${card.points}).`, 'info', [s.player], true, { big: true, prov: c.capital });
      }
    }
    // the campaign starts eight weeks before the vote
    if (s.tick === L.nextVote - 8 && !s.inbox.some((x) => x.id.startsWith('legacy_'))) pushInbox(s, isFree(c.gov) ? 'legacy_campaign' : 'legacy_loyalty', {}, 8);
    if (s.tick >= L.nextVote) holdVote(s);
    // a collapse of the state removes you from power
    if (c.eco.stability < 6 && nextRand(s) < 0.03) {
      closeTerm(s, 'removed', `${L.leader} is driven from office by mass unrest.`);
      goIntoOpposition(s, 30);
    }
  } else if (L.status === 'opposition' && L.opposition) {
    const o = L.opposition;
    // the government's failures are your opportunity
    const govApproval = approval(s, c);
    o.support = clamp(o.support + (100 - govApproval - o.support) * 0.012 + (c.eco.stability < 35 ? 0.08 : 0), 5, 85);
    if (s.tick === L.nextVote - 8 && !s.inbox.some((x) => x.id.startsWith('legacy_'))) pushInbox(s, 'legacy_comeback', {}, 8);
    if (s.tick >= L.nextVote || (c.eco.stability < 18 && s.tick - o.since > 52 && nextRand(s) < 0.02)) comebackVote(s);
  }
  if (yearOfTick(s.tick) >= L.maxYear) {
    if (L.status === 'office') closeTerm(s, 'ended', 'The era closes with you still in power.');
    endLegacy(s, `${L.maxYear}: the era ends. ${L.leader}'s place in history is decided.`);
  }
  L.score = totalScore(scoreParts(s));
  void geo;
}

/** Vote share at an election (or loyalty at a party congress). */
export function voteShare(s: GameState): number {
  const L = s.legacy, c = s.countries[s.player];
  const kept = L ? L.agenda.filter((a) => a.done).length : 0, failed = L ? L.agenda.length - kept : 0;
  const fatigue = Math.max(0, (L?.term ?? 1) - 2) * 2.5;
  const diff = s.settings.difficulty === 'easy' ? 4 : s.settings.difficulty === 'hard' ? -4 : 0;
  const cab = c.cabinet?.length ? clamp((avgLoyalty(c) - 50) * 0.08, -3, 2) : 0; // a divided cabinet leaks against you
  // elections are fought against an opposition that grows stronger the longer you rule
  const opposition = 1.5 * Math.max(0, (L?.term ?? 1) - 1);
  return clamp(50 + (approval(s, c) - 50) * 0.6 + 3.5 * kept - 2 * failed - fatigue - opposition + diff + cab + (s.stats.campaign ?? 0), 2, 95);
}

function holdVote(s: GameState) {
  const L = s.legacy!, c = s.countries[s.player];
  // promises judged at the end of the term
  for (const a of L.agenda) {
    if (a.done || a.failed) continue;
    const card = agendaById(a.id);
    if (card.progress(s, c, a).value >= 0.999 || (card.atTermEnd && card.progress(s, c, a).value >= 0.98)) { a.done = true; L.parts.agenda = (L.parts.agenda ?? 0) + card.points; }
    else { a.failed = true; L.parts.agenda = (L.parts.agenda ?? 0) - Math.round(card.points * 0.25); }
  }
  const share = clamp(voteShare(s) + (nextRand(s) - 0.5) * 10, 1, 97);
  s.stats.campaign = 0;
  s.stats.lastVote = share;
  const free = isFree(c.gov);
  if (share >= 50) {
    L.parts.terms = (L.parts.terms ?? 0) + 25;
    closeTerm(s, 'reelected', free ? `Re-elected with ${share.toFixed(1)}% of the vote.` : `The party elite renews your mandate (${share.toFixed(0)}% loyalty).`);
    c.eco.stability = Math.min(100, c.eco.stability + (share > 60 ? 5 : 2));
    L.term++; L.termStart = s.tick; L.nextVote = s.tick + TERM;
    L.agenda = []; L.hand = dealHand(s, c, L.term);
    L.chronicle.push({ tick: s.tick, text: `${free ? 'Re-elected' : 'Confirmed in power'} for a ${ordinal(L.term)} term (${share.toFixed(0)}%).` });
    logEvent(s, `🗳 ${free ? 'ELECTION' : 'PARTY CONGRESS'}: ${L.leader} wins a ${ordinal(L.term)} term with ${share.toFixed(1)}%!`, 'info', [s.player], true, { big: true, prov: c.capital });
  } else {
    L.parts.terms = (L.parts.terms ?? 0) - 20;
    closeTerm(s, 'defeated', free ? `Defeated with ${share.toFixed(1)}% of the vote.` : `Ousted by a rival faction (${share.toFixed(0)}% loyalty).`);
    logEvent(s, `🗳 ${free ? 'ELECTION' : 'PALACE COUP'}: ${L.leader} ${free ? `loses with ${share.toFixed(1)}%` : 'is ousted by a rival faction'}. ${free ? 'You now lead the opposition.' : 'You flee into exile.'}`, 'danger', [s.player], true, { big: true, prov: c.capital });
    goIntoOpposition(s, share);
  }
}

/** Removed from office by force (a coup, a revolt): the term ends and you go into opposition or exile. */
export function overthrow(s: GameState, why: string) {
  const L = s.legacy;
  if (!L || L.status !== 'office') return false;
  closeTerm(s, 'removed', why);
  goIntoOpposition(s, 25);
  return true;
}

function goIntoOpposition(s: GameState, share: number) {
  const L = s.legacy!, c = s.countries[s.player];
  L.status = 'opposition';
  L.opposition = { support: clamp(share, 15, 49), since: s.tick, attempts: L.opposition?.attempts ?? 0, gov: personName(c, 'gov', s.tick) };
  L.agenda = []; L.hand = [];
  L.nextVote = s.tick + TERM;
  L.chronicle.push({ tick: s.tick, text: `${L.leader} loses power; ${L.opposition.gov} forms a government.` });
  // the new government seeks peace in wars the public no longer backs
  if (isAtWar(s, c.id) && (c.mil.warSupport ?? 0.6) < 0.5) {
    const geo = geoRefGet();
    forcePeaceAll(s, geo, c.id);
    logEvent(s, `🕊 The new government of ${L.opposition.gov} signs ceasefires on every front.`, 'peace', [c.id], true);
  }
  s.inbox = s.inbox.filter((x) => !x.urgent);
}

function comebackVote(s: GameState) {
  const L = s.legacy!, c = s.countries[s.player], o = L.opposition!;
  const free = isFree(c.gov);
  const share = clamp(o.support + (nextRand(s) - 0.5) * 12 + (s.stats.campaign ?? 0), 1, 97);
  s.stats.campaign = 0;
  if (share >= 50) {
    L.status = 'office'; L.term++; L.termStart = s.tick; L.nextVote = s.tick + TERM;
    c.cabinet = undefined; ensureCabinet(s, L.term); // a new government, new faces
    s.stats[`termGdp:${L.term}`] = gdppc(c);
    L.agenda = []; L.hand = dealHand(s, c, L.term + 100);
    L.parts.terms = (L.parts.terms ?? 0) + 40;
    L.terms.push({ term: L.term - 1, start: o.since, end: s.tick, score: 0, headline: free ? 'THE COMEBACK' : 'RETURN FROM EXILE', lines: [`${L.leader} returns to power with ${share.toFixed(1)}%.`, `${o.gov}'s government falls after ${((s.tick - o.since) / 52).toFixed(1)} years.`], result: 'returned' });
    L.chronicle.push({ tick: s.tick, text: free ? `The comeback: ${L.leader} wins back power (${share.toFixed(0)}%).` : `${L.leader} returns from exile and seizes power.` });
    logEvent(s, `🔥 ${free ? 'THE COMEBACK' : 'RETURN FROM EXILE'}: ${L.leader} is back in power${free ? ` with ${share.toFixed(1)}% of the vote` : ''}!`, 'info', [s.player], true, { big: true, prov: c.capital });
    L.opposition = undefined;
  } else {
    o.attempts++;
    if (o.attempts >= 2) {
      endLegacy(s, free ? `After a second defeat at the polls (${share.toFixed(1)}%), ${L.leader} retires from politics.` : `The second attempt to return fails; ${L.leader} dies in exile.`);
      return;
    }
    o.since = s.tick; L.nextVote = s.tick + TERM;
    o.support = clamp(share - 4, 12, 45);
    L.chronicle.push({ tick: s.tick, text: `Comeback attempt fails (${share.toFixed(0)}%).` });
    logEvent(s, `🗳 ${free ? 'ELECTION' : 'FAILED COUP'}: ${L.leader}'s comeback falls short (${share.toFixed(1)}%). One last chance remains.`, 'danger', [s.player], true, { big: true, prov: c.capital });
  }
}

/** Opposition / exile actions. */
export const OPP_ACTIONS: { id: string; label: string; exile: string; desc: string; cd: number; gain: number }[] = [
  { id: 'rally', label: 'Hold mass rallies', exile: 'Smuggle in pamphlets', desc: 'Support +3', cd: 6, gain: 3 },
  { id: 'expose', label: 'Expose the government', exile: 'Leak regime secrets', desc: 'Support + more the worse the economy · stability −2', cd: 12, gain: 0 },
  { id: 'coalition', label: 'Build a coalition', exile: 'Win over the generals', desc: 'Support +6', cd: 26, gain: 6 },
  { id: 'abroad', label: 'Win friends abroad', exile: 'Secure foreign backing', desc: 'Support +2 · your next vote +3', cd: 20, gain: 2 },
];
export function actOpposition(s: GameState, id: string) {
  const L = s.legacy, c = s.countries[s.player];
  if (!L || L.status !== 'opposition' || !L.opposition) return { ok: false, message: 'You are in power' };
  const a = OPP_ACTIONS.find((x) => x.id === id)!;
  const key = `opp:${id}`;
  if ((s.stats[key] ?? -999) + a.cd > s.tick) return { ok: false, message: `Again in ${(s.stats[key] ?? 0) + a.cd - s.tick} weeks` };
  s.stats[key] = s.tick;
  let gain = a.gain;
  if (id === 'expose') { gain = clamp(2 + (50 - approval(s, c)) * 0.15, 1, 8); c.eco.stability = Math.max(0, c.eco.stability - 2); }
  if (id === 'abroad') s.stats.campaign = (s.stats.campaign ?? 0) + 3;
  L.opposition.support = clamp(L.opposition.support + gain, 5, 85);
  return { ok: true, message: `Support for you rises to ${L.opposition.support.toFixed(0)}%.` };
}

/** Bring the next vote forward (no-confidence motion / uprising) when the government is weak. */
export function actForceVote(s: GameState) {
  const L = s.legacy, c = s.countries[s.player];
  if (!L?.opposition) return { ok: false, message: 'Only in opposition' };
  if (L.opposition.support < 52 || approval(s, c) > 45) return { ok: false, message: 'Needs 52% support and a government below 45% approval' };
  L.nextVote = Math.min(L.nextVote, s.tick + 6);
  logEvent(s, `⚡ ${isFree(c.gov) ? 'No-confidence vote passes: snap elections in six weeks!' : 'The streets rise: the regime totters.'}`, 'danger', [s.player], true, { big: true, prov: c.capital });
  return { ok: true, message: 'The decisive vote comes in six weeks.' };
}

export function actRetire(s: GameState) {
  const L = s.legacy;
  if (!L || L.status === 'ended') return { ok: false, message: 'No career to end' };
  if (L.status === 'office') closeTerm(s, 'retired', `${L.leader} steps down at a time of their choosing.`);
  endLegacy(s, `${L.leader} retires from public life.`);
  return { ok: true, message: 'The history books are written.' };
}

function closeTerm(s: GameState, result: TermRecord['result'], line: string) {
  const L = s.legacy!, c = s.countries[s.player];
  const prev = L.terms.filter((t) => t.result !== 'returned').at(-1);
  const startGdp = s.stats[`termGdp:${L.term}`] ?? L.start.gdppc;
  const growth = gdppc(c) / startGdp - 1;
  const kept = L.agenda.filter((a) => a.done).map((a) => agendaById(a.id).title);
  const failed = L.agenda.filter((a) => a.failed).map((a) => agendaById(a.id).title);
  const wars = (s.warHistory ?? []).filter((r) => r.end >= L.termStart && (r.a === c.id || r.b === c.id));
  const score = totalScore(scoreParts(s));
  const share = s.stats.lastVote ?? 50, free = isFree(c.gov), surname = L.leader.split(' ').slice(-1)[0].toUpperCase();
  const headline = result === 'reelected'
    ? (!free ? `THE PARTY CLOSES RANKS BEHIND ${surname}` : share > 62 ? `A LANDSLIDE FOR ${surname}` : isAtWar(s, c.id) ? 'THE NATION STANDS BY ITS WAR LEADER' : growth > 0.08 ? 'FOUR MORE YEARS OF BOOM' : share < 53 ? `${surname} SCRAPES THROUGH` : 'THE VOTERS SAY: CARRY ON')
    : result === 'defeated' ? (!free ? `PALACE COUP: ${surname} FLEES` : share < 35 ? `A CRUSHING DEFEAT FOR ${surname}` : 'THE PEOPLE HAVE SPOKEN')
    : result === 'removed' ? 'GOVERNMENT FALLS AMID CHAOS' : result === 'retired' ? 'A FAREWELL TO POWER' : 'AN ERA ENDS';
  const lines = [
    line,
    `Living standards ${growth >= 0 ? 'rose' : 'fell'} ${Math.abs(growth * 100).toFixed(1)}% over the term.`,
    kept.length ? `Promises kept: ${kept.join(', ')}.` : 'No promises were kept.',
    ...(failed.length ? [`Broken promises: ${failed.join(', ')}.`] : []),
    ...(wars.length ? [`Wars ended: ${wars.map((w) => `${w.name} (${(w.a === c.id ? w.winner === 'a' : w.winner === 'b') ? 'won' : w.winner === 'draw' ? 'draw' : 'lost'})`).join(', ')}.`] : []),
    `Legacy score: ${score.toFixed(0)} (${grade(score)})${prev ? `, ${score - prev.score >= 0 ? '+' : ''}${(score - prev.score).toFixed(0)} this term` : ''}.`,
  ];
  L.terms.push({ term: L.term, start: L.termStart, end: s.tick, score, headline, lines, result });
  s.stats[`termGdp:${L.term + 1}`] = gdppc(c);
  s.stats.reviewTerm = L.terms.length; // the UI shows the newspaper for the newest term
}

export function endLegacy(s: GameState, reason: string) {
  const L = s.legacy!;
  if (L.status === 'ended') return;
  // wars count once, at the end
  const c = s.countries[s.player];
  let w = 0;
  for (const r of s.warHistory ?? []) if (r.end >= L.start.tick && (r.a === c.id || r.b === c.id)) { const won = r.a === c.id ? r.winner === 'a' : r.winner === 'b'; w += r.winner === 'draw' ? 0 : won ? 45 : -45; }
  L.parts.wars = w;
  L.parts = scoreParts(s);
  L.score = totalScore(L.parts);
  L.status = 'ended';
  L.endReason = reason;
  L.chronicle.push({ tick: s.tick, text: reason });
  logEvent(s, `📖 THE HISTORY BOOKS: ${reason}`, 'info', [s.player], true, { big: true });
}

/** After the end, keep playing the same world as a sandbox. */
export function continueAsSandbox(s: GameState) {
  s.settings.mode = 'sandbox';
  return { ok: true, message: 'The world goes on. You keep playing in Sandbox mode.' };
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
export { ordinal };
export type { LegacyState };
