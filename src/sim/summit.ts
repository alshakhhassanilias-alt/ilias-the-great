/**
 * Summits: diplomacy face to face. Treaties are still signed at the table (negotiate.ts); this is the person.
 *
 *   - Ties: with every foreign leader you have rapport (do they like you) and trust (do you keep your word), for as
 *     long as you both hold office. They move the odds at the negotiating table, pull relations along week by week,
 *     and fade a little if you never meet. A new leader starts from nothing.
 *   - A summit: you choose where (their capital honours them, yours honours you, a neutral city reassures) and what to
 *     ask for (one or two agreements). Then three rounds face to face: each round you choose how to talk (personal
 *     charm, shared interests, money on the table, plain talk from strength, honouring their nation, or giving your
 *     word). How it lands depends on who they are: a strongman respects strength, a proud nationalist cannot be bought,
 *     a merchant wants a price, a wounded nation wants an apology. They answer you, in character.
 *   - The result: what they sign depends on the table's own odds plus how the room felt; the press conference is yours.
 *   - Your word: a promise made at a summit (never to take up arms against them, no sanctions, no deals with their
 *     rival) is watched every week. Keep it and their trust grows; break it and they, and their friends, remember.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { nextRand, hash01 } from './rng';
import { logEvent } from './log';
import { addRelation, alliesOf, areAtWar, getRelation, getTreaty, sanctionLevel } from './relations';
import { applyTreaty, liftSanction } from './diplomacy';
import { fund } from './actions';
import { strength } from './military';
import { spendPC, sway } from './domestic';
import { addGrudge, grudgeScore } from './leaders';
import { GOAL_LABEL, stanceOf, styleOf, type Goal, type StyleId } from './negotiate';
import { isMajor } from './drama';
import { geoRefGet } from './geoRef';
import type { Country, CountryId, GameState } from './types';

export interface Tie { leader: string; since: number; rapport: number; trust: number; met: number; last?: number; history: { tick: number; text: string }[]; invited?: number }
export type PledgeKind = 'peace' | 'nosanc' | 'rival';
export interface Pledge { to: CountryId; leader: string; kind: PledgeKind; made: number; until: number; rival?: CountryId }
export type Venue = 'theirs' | 'yours' | 'neutral';
export type Approach = 'charm' | 'common' | 'money' | 'firm' | 'respect' | 'pledge';
export interface Summit { them: CountryId; venue: Venue; city: string; agenda: Goal[]; round: number; warmth: number; used: Approach[]; lines: { who: 'me' | 'them' | 'note'; text: string }[]; pledges: PledgeKind[]; invited?: boolean }
export interface SummitResult { signed: Goal[]; failed: Goal[]; warmth: number; rapport: number; headline: string }

export const SUMMIT_PC = 6;
export const SUMMIT_COOLDOWN = 26;
const NEUTRAL = ['Geneva', 'Vienna', 'Helsinki', 'Singapore', 'Doha', 'Reykjavík', 'Oslo', 'Muscat'];
export const PLEDGE_TEXT: Record<PledgeKind, { say: string; desc: string; years: number }> = {
  peace: { say: 'As long as I lead my country, we will never take up arms against yours.', desc: 'Never go to war with them (3 years)', years: 3 },
  nosanc: { say: 'There will be no sanctions on your people from us. You have my word.', desc: 'No sanctions on them (3 years)', years: 3 },
  rival: { say: 'We will not ally with, or arm, those who threaten you.', desc: 'No alliance or military cooperation with their rival (2 years)', years: 2 },
};
export const APPROACHES: { id: Approach; icon: string; name: string; desc: string }[] = [
  { id: 'charm', icon: '🤝', name: 'Personal charm', desc: 'A long dinner, a walk, a story about your father. Strongmen and royal courts warm to it; ideologues see through it.' },
  { id: 'common', icon: '🧭', name: 'Shared interests', desc: 'The rival you both fear, the trade you both need, the camp you share. Pragmatists and parliaments listen.' },
  { id: 'money', icon: '💰', name: 'Money on the table', desc: 'An investment fund, announced over coffee (0.1% of your GDP). Merchants and swing states love it; proud nations are insulted.' },
  { id: 'firm', icon: '🥊', name: 'Plain talk from strength', desc: 'You say what you want and what happens if you do not get it. A strongman respects it if you are the stronger; the cautious and the wounded recoil.' },
  { id: 'respect', icon: '🎖', name: 'Honour their nation', desc: 'A wreath at their memorial, words about their history; if you wronged them, an apology (4 political capital). Proud and wounded nations need it.' },
  { id: 'pledge', icon: '✋', name: 'Give your word', desc: 'A personal promise, watched every week. Everyone values it, the cautious most; but a leader who has broken promises before is not believed.' },
];

const tieKey = (s: GameState, id: CountryId) => (s.ties ??= {})[id];
/** your tie with a country's current leader (a new leader starts from nothing; the old history is kept for the record) */
export function tieOf(s: GameState, id: CountryId): Tie | null {
  const T = s.countries[id];
  if (!T?.alive || !T.leader || id === s.player) return null;
  const t = tieKey(s, id);
  if (t && t.leader === T.leader.name) return t;
  const fresh: Tie = { leader: T.leader.name, since: s.tick, rapport: 0, trust: 0, met: 0, history: [] };
  if (t) fresh.history.push({ tick: s.tick, text: `${t.leader} has gone; ${T.leader.name} leads ${T.name} now.` });
  return fresh;
}
function ensureTie(s: GameState, id: CountryId): Tie {
  const t = tieOf(s, id)!;
  (s.ties ??= {})[id] = t;
  return t;
}
const note = (t: Tie, tick: number, text: string) => { t.history.push({ tick, text }); if (t.history.length > 10) t.history.shift(); };
export const rapportWord = (v: number) => (v >= 60 ? 'close friends' : v >= 30 ? 'warm' : v >= 10 ? 'cordial' : v > -10 ? 'strangers' : v > -30 ? 'cool' : v > -60 ? 'hostile' : 'enemies');
export const trustWord = (v: number) => (v >= 50 ? 'trusts you completely' : v >= 20 ? 'trusts you' : v > -20 ? 'reserves judgement' : v > -50 ? 'doubts your word' : 'does not believe a word you say');
/** what your tie adds at the negotiating table, in the table's points */
export const tiePoints = (s: GameState, id: CountryId) => { const t = tieOf(s, id); return t ? Math.round(t.rapport / 5 + t.trust / 8) : 0; };

/** Can you hold a summit with them now? */
export function summitWhy(s: GameState, id: CountryId): string | null {
  const T = s.countries[id], P = s.countries[s.player];
  if (!T?.alive || id === s.player) return 'No one to meet';
  if (!T.leader) return 'They have no leader to meet';
  if (areAtWar(s, s.player, id)) return 'You are at war: talk peace first';
  if (s.summit) return 'You are already at a summit';
  const t = tieOf(s, id);
  if (t?.last !== undefined && s.tick - t.last < SUMMIT_COOLDOWN && !(t.invited && t.invited >= s.tick)) return `You met ${t.leader} ${s.tick - t.last} weeks ago: again in ${SUMMIT_COOLDOWN - (s.tick - t.last)} weeks`;
  if (!(t?.invited && t.invited >= s.tick) && (P.politics?.pc ?? 0) < SUMMIT_PC) return `Needs ${SUMMIT_PC} political capital`;
  return null;
}

export function actSummitBegin(s: GameState, id: CountryId, venue: Venue, agenda: Goal[]) {
  const why = summitWhy(s, id);
  if (why) return { ok: false, message: why };
  if (!agenda.length || agenda.length > 2) return { ok: false, message: 'Choose one or two things to ask for' };
  const T = s.countries[id], P = s.countries[s.player];
  const t = ensureTie(s, id);
  const invited = !!(t.invited && t.invited >= s.tick);
  if (!invited) spendPC(P, SUMMIT_PC);
  if (venue === 'theirs' && !invited) spendPC(P, 2); // the journey and the honours
  const capName = (c: Country) => geoRefGet()?.provinces[c.capital]?.name || c.name;
  const city = venue === 'neutral' ? NEUTRAL[Math.floor(hash01('city', id, s.tick) * NEUTRAL.length)] : venue === 'theirs' ? capName(T) : capName(P);
  const st = styleOf(T, s).id;
  // where you meet sets the mood before a word is said
  let w = invited ? 1.5 : 0;
  if (venue === 'theirs') w += st === 'proud' || st === 'court' || st === 'strongman' || st === 'wounded' ? 1.5 : 0.8;
  if (venue === 'yours') w += st === 'proud' || st === 'wounded' ? -1 : 0;
  if (venue === 'neutral') w += st === 'cautious' || st === 'parliament' || st === 'swing' ? 1 : 0.3;
  s.summit = { them: id, venue, city, agenda, round: 0, warmth: w, used: [], lines: [], pledges: [], ...(invited ? { invited: true } : {}) };
  s.summit.lines.push({ who: 'note', text: `${city}. ${T.leader!.name} ${venue === 'theirs' ? 'receives you at the palace steps' : venue === 'yours' ? 'steps off the plane' : 'arrives ten minutes after you'}.` });
  s.summit.lines.push({ who: 'them', text: greeting(s, T, t, st) });
  if (invited) t.invited = undefined;
  return { ok: true, message: `🤝 The summit in ${city} begins.` };
}

function greeting(s: GameState, T: Country, t: Tie, st: StyleId): string {
  const me = s.legacy?.leader ?? 'Mr President';
  if (t.met > 0 && t.rapport >= 30) return `My friend! It is good to see you again. Come, sit.`;
  if (t.trust <= -30) return `I remember what you promised last time, ${me}. Let us see what your words are worth today.`;
  if (t.met > 0 && t.rapport <= -20) return `You came. I was not sure you would. Shall we begin?`;
  switch (st) {
    case 'strongman': return 'So. You are the one everyone talks about. Sit, we will see what you are made of.';
    case 'proud': return `${T.name} welcomes you. I hope you have come as an equal, not as a buyer.`;
    case 'merchant': return 'Welcome! Coffee, then business. I always say a good deal starts with good coffee.';
    case 'cautious': return 'Thank you for coming. Forgive me if I listen more than I talk today.';
    case 'court': return 'The court is honoured by your visit. There is no hurry here; we have all afternoon.';
    case 'wounded': return 'I agreed to this meeting because my people deserve answers. I hope you brought some.';
    case 'ideologue': return 'Our systems are very different. I would like to understand what you believe.';
    case 'parliament': return 'Good to meet you. My parliament is watching this closely, so let us be productive.';
    case 'swing': return 'Everyone wants a meeting with us this year. I am glad you are one of them.';
    default: return 'Welcome. Let us see what we can do together.';
  }
}

const STYLE_W: Record<Approach, Partial<Record<StyleId, number>>> = {
  charm: { strongman: 2, court: 2.2, proud: 1, cautious: 0.6, swing: 0.6, pragmatic: 0.5, merchant: 0.3, parliament: 0.2, ideologue: -0.6, wounded: -1 },
  common: { pragmatic: 2, parliament: 1.6, cautious: 1.2, merchant: 1, swing: 0.6, court: 0.6, strongman: 0.4, ideologue: 0.5, proud: 0.4, wounded: 0 },
  money: { merchant: 3, swing: 2.6, pragmatic: 1.4, court: 1, strongman: 0.4, parliament: 0.6, cautious: 0.4, ideologue: -1, proud: -2.2, wounded: -1.2 },
  firm: { strongman: 1.5, merchant: 0.3, pragmatic: 0, parliament: -0.4, swing: -0.5, ideologue: -0.5, court: -0.8, proud: -1.2, cautious: -2, wounded: -3 },
  respect: { wounded: 3.5, proud: 3, court: 2, ideologue: 0.6, cautious: 0.6, parliament: 0.3, swing: 0.3, pragmatic: 0.2, merchant: 0, strongman: -0.4 },
  pledge: { cautious: 2.4, parliament: 1.4, wounded: 1.4, pragmatic: 1, court: 1, swing: 0.8, proud: 0.6, merchant: 0.4, ideologue: 0.6, strongman: 0.2 },
};

/** What an approach would do before you try it: the expected change in the mood of the room, and anything it costs. */
export function approachValue(s: GameState, a: Approach): { v: number; cost?: string; why?: string } {
  const S = s.summit;
  if (!S) return { v: 0 };
  const T = s.countries[S.them], P = s.countries[s.player];
  const st = styleOf(T, s).id;
  const t = tieOf(s, S.them)!;
  let v = 1 + (STYLE_W[a][st] ?? 0);
  const cha = s.legacy?.persona?.skills.cha ?? 5, dip = s.legacy?.persona?.skills.dip ?? 5;
  if (a === 'charm') v += (cha - 5) * 0.35;
  if (a === 'common') {
    const theirRivalIsMine = s.countries.some((x) => x.alive && x.id !== P.id && x.id !== T.id && getRelation(s, T.id, x.id) < -40 && getRelation(s, P.id, x.id) < -30);
    const trade = !!getTreaty(s, P.id, T.id)?.trade;
    const camp = Math.sign(P.orient ?? 0) === Math.sign(T.orient ?? 0) && Math.abs(P.orient ?? 0) > 0.25 && Math.abs(T.orient ?? 0) > 0.25;
    v += (theirRivalIsMine ? 1.2 : 0) + (trade ? 0.5 : 0) + (camp ? 0.8 : 0) - (!theirRivalIsMine && !trade && !camp ? 1.2 : 0) + (dip - 5) * 0.2;
  }
  if (a === 'firm') { const r = strength(P) / Math.max(1, strength(T)); v += r > 1.5 ? 1 : r < 0.7 ? -1.5 : 0; }
  if (a === 'respect') { const g = grudgeScore(s, T.id, P.id); if (g > 10) v += 1.2; }
  if (a === 'pledge') v *= clamp(1 + t.trust / 80, 0.25, 1.4);
  if (S.used.includes(a)) v -= 2.5; // the same move twice reads as a script
  const cost = a === 'money' ? `${(0.1).toFixed(1)}% of your GDP` : a === 'respect' && grudgeScore(s, T.id, P.id) > 10 ? '4 political capital · nationalists at home grumble' : undefined;
  return { v: Math.round(v * 10) / 10, cost };
}

const REACT: Record<'up' | 'flat' | 'down', Partial<Record<StyleId, string[]>> & { any: string[] }> = {
  up: {
    any: ['He leans forward. "Now that is interesting."', 'A smile, a real one. "Go on."', 'They nod slowly. "Yes. I think we understand each other."'],
    strongman: ['He laughs and slaps the table. "Finally, someone who talks like a man of action!"'],
    merchant: ['"Now you are speaking my language." Out comes a notebook.'],
    proud: ['A pause. "You honour us. That will not be forgotten."'],
    court: ['The minister of the court whispers something; the mood in the room softens.'],
    wounded: ['A long silence. Then: "Thank you. That needed to be said."'],
    cautious: ['"That," she says quietly, "would make a real difference to us."'],
  },
  flat: { any: ['A polite nod. Nothing more.', '"I see." The interpreter has nothing to add.', 'They take a note, and move on.'] },
  down: {
    any: ['The temperature drops. An aide checks his watch.', '"Is that what you came here to say?"', 'Arms folded. The silence lasts a little too long.'],
    proud: ['"We are not for sale," she says, very quietly. The room goes cold.'],
    wounded: ['"You threaten us? Here?" He stands up, then sits back down, slowly.'],
    ideologue: ['"Charm. How very predictable." He looks at his papers.'],
    cautious: ['She flinches. You can see her advisers exchanging looks.'],
    strongman: ['He smirks. "You are weaker than I thought."'],
  },
};
/** their reaction: in their own manner when there is one, never the same words twice in one summit */
const lineFor = (s: GameState, mood: 'up' | 'flat' | 'down', st: StyleId, said: string[]) => {
  const pool = [...(REACT[mood][st] ?? []), ...REACT[mood].any].filter((x) => !said.includes(x));
  const L = pool.length ? pool : REACT[mood].any;
  return L[Math.floor(nextRand(s) * L.length)];
};
const SAY: Record<Approach, string[]> = {
  charm: ['"Tell me about your hometown. I have always wanted to see it."', '"My grandmother used to say our two peoples were cousins. I think she was right."', '"Forget the papers for a moment. How are your children?"'],
  common: ['"We both know who benefits when we quarrel. Not you, and not me."', '"Our trade is worth more than all our disagreements put together."', '"We face the same storm. Better to face it together."'],
  money: ['"We are ready to put real money into your country: ports, factories, jobs."', '"An investment fund, announced tomorrow, if we agree today."'],
  firm: ['"Let me be plain. This is what we want, and this is what happens if we cannot agree."', '"I did not come all this way for photographs."'],
  respect: ['"I laid a wreath at your memorial this morning. Your nation has suffered, and endured."', '"What was done to your people in our name was wrong. I am sorry."'],
  pledge: [],
};

export function actSummitApproach(s: GameState, a: Approach, pledge?: PledgeKind) {
  const S = s.summit;
  if (!S) return { ok: false, message: 'No summit under way' };
  if (S.round >= 3) return { ok: false, message: 'The talks are over: time for the press' };
  const T = s.countries[S.them], P = s.countries[s.player];
  const st = styleOf(T, s).id;
  if (a === 'pledge' && (!pledge || S.pledges.includes(pledge))) return { ok: false, message: 'Choose a promise you have not already made' };
  if (a === 'pledge' && pledge === 'peace' && areAtWar(s, P.id, S.them)) return { ok: false, message: 'Not while at war' };
  if (a === 'money') { const f = fund(s, P.id, 0.001 * P.eco.gdp, `Investment fund for ${T.name}`); if (!f.ok) return f; T.eco.capital += 0.001 * P.eco.gdp / Math.max(0.1, T.eco.price); }
  if (a === 'respect' && grudgeScore(s, T.id, P.id) > 10) { spendPC(P, 4); sway(P, 'nationalists', -3); for (const g of s.grudges?.[`${T.id}>${P.id}`] ?? []) g.w *= 0.7; }
  const val = approachValue(s, a).v;
  const d = val + (nextRand(s) - 0.5) * 2.2;
  S.warmth = clamp(S.warmth + d, -10, 10);
  S.used.push(a);
  S.round++;
  if (a === 'pledge') {
    S.pledges.push(pledge!);
    S.lines.push({ who: 'me', text: `"${PLEDGE_TEXT[pledge!].say}"` });
  } else S.lines.push({ who: 'me', text: SAY[a][Math.floor(nextRand(s) * SAY[a].length)] });
  S.lines.push({ who: 'them', text: lineFor(s, d > 1.2 ? 'up' : d < -0.3 ? 'down' : 'flat', st, S.lines.map((l) => l.text)) });
  return { ok: true, message: d > 0 ? `The room warms (+${d.toFixed(1)}).` : `The room cools (${d.toFixed(1)}).` };
}

/** The odds that each item on the agenda is signed, given how the talks went (for the screen, and for the close). */
export function agendaOdds(s: GameState, geo: Geo): { goal: Goal; p: number; blocked: string | null }[] {
  const S = s.summit;
  if (!S) return [];
  return S.agenda.map((g) => {
    const st = stanceOf(s, geo, S.them, { goal: g, give: [] });
    if (st.blocked) return { goal: g, p: 0, blocked: st.blocked };
    const base = 14 * Math.log(Math.max(0.02, st.p) / Math.max(0.02, 1 - st.p));
    const pts = base + S.warmth * 3.2 + S.pledges.length * 2;
    return { goal: g, p: clamp(1 / (1 + Math.exp(-pts / 14)), 0.03, 0.97), blocked: null };
  });
}

export type Press = 'friendship' | 'frank' | 'firm';
export const PRESS: { id: Press; name: string; say: string; desc: string }[] = [
  { id: 'friendship', name: 'A historic friendship', say: 'Today marks the beginning of a new chapter between our peoples.', desc: 'Approval +2 if the talks went well; if they did not, it rings hollow (−2). Their rapport +5.' },
  { id: 'frank', name: 'Frank talks, real progress', say: 'We did not agree on everything. But we spoke honestly, and we will meet again.', desc: 'Reputation +1. Safe whatever happened.' },
  { id: 'firm', name: 'We gave nothing away', say: 'I came here to defend our interests, and that is exactly what I did.', desc: 'Nationalists at home +4. Their rapport −6.' },
];

export function actSummitClose(s: GameState, geo: Geo, press: Press): { ok: boolean; message: string; result?: SummitResult } {
  const S = s.summit;
  if (!S) return { ok: false, message: 'No summit under way' };
  if (S.round < 3) return { ok: false, message: 'The talks are not over yet' };
  const T = s.countries[S.them], P = s.countries[s.player];
  const t = ensureTie(s, S.them);
  const odds = agendaOdds(s, geo);
  const signed: Goal[] = [], failed: Goal[] = [];
  for (const o of odds) {
    if (!o.blocked && nextRand(s) < o.p) {
      signed.push(o.goal);
      if (o.goal === 'aid') { const amt = 0.005 * T.eco.gdp; T.eco.cash -= amt; P.eco.cash += amt; }
      else if (o.goal === 'relief') liftSanction(s, S.them, s.player);
      else applyTreaty(s, s.player, S.them, o.goal);
    } else failed.push(o.goal);
  }
  // the person: how the room felt stays with them
  const dR = S.warmth * 3 + (signed.length ? 4 : 0) + (press === 'friendship' ? 5 : press === 'firm' ? -6 : 0);
  t.rapport = clamp(t.rapport + dR, -100, 100);
  t.met++; t.last = s.tick;
  addRelation(s, S.them, s.player, S.warmth * 0.8 + signed.length * 2);
  for (const k of S.pledges) (s.pledges ??= []).push({ to: S.them, leader: t.leader, kind: k, made: s.tick, until: s.tick + 52 * PLEDGE_TEXT[k].years, ...(k === 'rival' ? { rival: rivalFor(s, S.them) } : {}) });
  // the press conference
  const good = S.warmth >= 3;
  if (press === 'friendship') s.stats.apprBoost = (s.stats.apprBoost ?? 0) + (good ? 2 : -2);
  if (press === 'frank') P.reputation = clamp(P.reputation + 1, 0, 100);
  if (press === 'firm') sway(P, 'nationalists', 4);
  const me = s.legacy?.leader ?? P.name;
  const what = signed.length ? signed.map((g) => GOAL_LABEL[g].toLowerCase()).join(' and ') : '';
  const headline = signed.length
    ? `🤝 SUMMIT IN ${S.city.toUpperCase()}: ${me} and ${t.leader} sign ${what}.${S.warmth >= 6 ? ' Aides speak of a real friendship.' : ''}`
    : S.warmth >= 3 ? `🤝 SUMMIT IN ${S.city.toUpperCase()}: warm words between ${me} and ${t.leader}, but no deal yet.`
    : `🥶 SUMMIT IN ${S.city.toUpperCase()}: ${me} and ${t.leader} part without agreement; the handshake is brief.`;
  logEvent(s, `${headline} "${PRESS.find((x) => x.id === press)!.say}"`, 'diplo', [s.player, S.them], true, { big: signed.length > 0 || isMajor(s, S.them), prov: T.capital });
  note(t, s.tick, `${S.city}: ${signed.length ? `signed ${what}` : 'no agreement'}; the room was ${S.warmth >= 5 ? 'warm' : S.warmth >= 1 ? 'cordial' : S.warmth > -3 ? 'cool' : 'icy'}${S.pledges.length ? `; you promised: ${S.pledges.map((k) => PLEDGE_TEXT[k].desc.toLowerCase()).join(', ')}` : ''}.`);
  const result: SummitResult = { signed, failed, warmth: S.warmth, rapport: t.rapport, headline };
  delete s.summit;
  return { ok: true, message: headline, result };
}

/** the rival a "no deals with their rival" promise is about */
function rivalFor(s: GameState, id: CountryId): CountryId {
  let best = -1, bv = -35;
  for (const x of s.countries) { if (!x.alive || x.id === id || x.id === s.player) continue; const r = getRelation(s, id, x.id); if (r < bv) { bv = r; best = x.id; } }
  return best;
}

/** Weekly: ties fade a little without meetings and pull relations along; promises are watched; invitations come. */
export function stepSummits(s: GameState) {
  const P = s.countries[s.player];
  if (!P?.alive || !s.ties) return;
  for (const k of Object.keys(s.ties)) {
    const id = Number(k), T = s.countries[id], t = s.ties[id];
    if (!T?.alive || !T.leader || T.leader.name !== t.leader) continue;
    if (s.tick % 4 === id % 4) {
      t.rapport *= 0.995; // about 6% a year without contact
      if (Math.abs(t.rapport) > 5) addRelation(s, id, s.player, t.rapport * 0.006);
    }
  }
  // promises
  const keep: Pledge[] = [];
  for (const p of s.pledges ?? []) {
    const T = s.countries[p.to];
    if (!T?.alive || T.leader?.name !== p.leader) continue; // the leader you promised is gone
    const broken = p.kind === 'peace' ? areAtWar(s, s.player, p.to)
      : p.kind === 'nosanc' ? sanctionLevel(s, s.player, p.to) > 0
      : p.rival !== undefined && p.rival >= 0 && !!(getTreaty(s, s.player, p.rival)?.alliance || getTreaty(s, s.player, p.rival)?.coop);
    const t = ensureTie(s, p.to);
    if (broken) {
      t.trust = clamp(t.trust - 45, -100, 100); t.rapport = clamp(t.rapport - 30, -100, 100);
      addGrudge(s, p.to, s.player, 'broke a promise made face to face', 12);
      for (const a of alliesOf(s, p.to)) { const ta = tieOf(s, a); if (ta && s.ties?.[a]) s.ties[a].trust = clamp(s.ties[a].trust - 12, -100, 100); }
      note(t, s.tick, `You broke your word: ${PLEDGE_TEXT[p.kind].desc.toLowerCase()}.`);
      logEvent(s, `💔 ${p.leader} of ${T.name}: "${s.legacy?.leader ?? 'They'} looked me in the eye and gave me their word. It meant nothing." Trust in you collapses, in ${T.name} and among its friends.`, 'danger', [s.player, p.to], true, { big: true });
      continue;
    }
    if (s.tick >= p.until) {
      t.trust = clamp(t.trust + 20, -100, 100); t.rapport = clamp(t.rapport + 8, -100, 100);
      note(t, s.tick, `You kept your word: ${PLEDGE_TEXT[p.kind].desc.toLowerCase()}.`);
      logEvent(s, `🤝 ${p.leader} of ${T.name}: "A leader who keeps their word. Rare, these days." Their trust in you grows.`, 'diplo', [s.player, p.to], true);
      continue;
    }
    keep.push(p);
  }
  if (s.pledges) s.pledges = keep;
  // invitations: now and then a leader who likes you, or a great power, asks you to come
  if (s.tick % 13 === 7 && !s.summit && nextRand(s) < 0.35) {
    const cands = s.countries.filter((x) => x.alive && x.id !== s.player && x.leader && !areAtWar(s, s.player, x.id) && ((tieOf(s, x.id)?.rapport ?? 0) > 15 || (isMajor(s, x.id) && getRelation(s, s.player, x.id) > -10)));
    if (cands.length) {
      const T = cands[Math.floor(nextRand(s) * cands.length)];
      const t = ensureTie(s, T.id);
      if (!t.invited || t.invited < s.tick) {
        t.invited = s.tick + 13;
        logEvent(s, `✉ ${T.leader!.name} of ${T.name} invites you to a summit. Within three months it costs you no political capital, and they will be in a good mood (Diplomacy tab).`, 'diplo', [s.player, T.id], true);
      }
    }
  }
}
