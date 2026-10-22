/**
 * The world answers you. When you go to war, are attacked, take a capital, make peace, crack down at home, reform or
 * default, the leaders who matter say what they think, in their own voice and in proportion to how they feel about
 * you and about the other side, and it moves relations. Your own press and public answer too. The player sees each
 * round of reactions as one card (desktop) and in the news.
 */
import { addRelation, alliesOf, getRelation, hasAlliance } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { warSupport } from './warsupport';
import { hash01 } from './rng';
import { geoRefGet } from './geoRef';
import { logEvent } from './log';
import type { Country, CountryId, GameState } from './types';

export type VoiceKind = 'declare' | 'attacked' | 'conquest' | 'capital' | 'besieged' | 'peace' | 'repress' | 'reform' | 'aid' | 'defaulted' | 'nuke' | 'betray' | 'intervene';
export interface Voice { cid: CountryId; tone: 'warm' | 'cold' | 'angry' | 'neutral'; text: string; delta: number }
export interface VoiceSet { seq: number; tick: number; kind: VoiceKind; icon: string; title: string; lead: string; voices: Voice[]; home: string[] }

/** how long the same kind of news waits before the world comments again (weeks) */
const COOL: Partial<Record<VoiceKind, number>> = { conquest: 10, besieged: 10, repress: 16, reform: 16, aid: 26, betray: 12 };
const ICON: Record<VoiceKind, string> = { declare: '⚔', attacked: '🛡', conquest: '🏴', capital: '🏛', besieged: '🔥', peace: '🕊', repress: '🚨', reform: '🗳', aid: '🤲', defaulted: '📉', nuke: '☢', betray: '🗡', intervene: '⚔' };

const pick = <T,>(arr: T[], ...k: (string | number)[]) => arr[Math.floor(hash01('voice', ...k) * arr.length) % arr.length];
const nm = (s: GameState, id: CountryId) => s.countries[id]?.name ?? '?';
const HAWK = new Set(['hawk', 'strongman', 'nationalist', 'paranoid']);
const hawkish = (c: Country) => (c.leader?.traits ?? []).some((t) => HAWK.has(t));
const free = (c: Country) => c.gov === 'D' || c.gov === 'F';

/** Who speaks: your rival, your closest allies, the great powers, the other side's friends and neighbours. */
function audience(s: GameState, around: CountryId[]): CountryId[] {
  const P = s.player;
  const out: CountryId[] = [];
  const add = (x: CountryId | undefined) => { if (x !== undefined && x >= 0 && x !== P && !around.includes(x) && s.countries[x]?.alive && !out.includes(x)) out.push(x); };
  add(s.rival >= 0 ? s.rival : undefined);
  for (const a of alliesOf(s, P).sort((x, y) => getRelation(s, P, y) - getRelation(s, P, x)).slice(0, 2)) add(a);
  const greats = s.countries.filter((c) => c.alive && c.id !== P).sort((a, b) => strength(b) - strength(a)).slice(0, 5);
  for (const g of greats.slice(0, 3)) add(g.id);
  const geo = geoRefGet();
  for (const t of around) {
    if (t === P) continue;
    for (const a of alliesOf(s, t).sort((x, y) => getRelation(s, t, y) - getRelation(s, t, x)).slice(0, 2)) add(a);
    if (geo) for (const n of neighborsOf(s, geo, t).slice(0, 2)) add(n);
  }
  for (const g of greats.slice(3)) add(g.id);
  return out.slice(0, 5);
}

type Stance = { tone: Voice['tone']; delta: number; lines: string[] };
function stance(s: GameState, X: Country, kind: VoiceKind, T: Country | null): Stance | null {
  const P = s.countries[s.player];
  const rP = getRelation(s, X.id, P.id), rT = T ? getRelation(s, X.id, T.id) : 0;
  const ally = hasAlliance(s, X.id, P.id), allyT = T ? hasAlliance(s, X.id, T.id) : false;
  const me = X.name, you = P.name, them = T?.name ?? '';
  const hawk = hawkish(X);
  switch (kind) {
    case 'declare': case 'conquest': case 'capital': {
      const sev = kind === 'capital' ? 1.4 : kind === 'conquest' ? 0.7 : 1;
      if (allyT || rT > 40) return { tone: 'angry', delta: -Math.round(8 * sev), lines: hawk
        ? [`Hands off ${them}. ${me} will make ${you} regret every step it takes.`, `${them} is our friend. ${you} has made an enemy of ${me} today.`]
        : [`An unprovoked attack on ${them}. ${me} is recalling its ambassador from ${you}.`, `${me} condemns this aggression in the strongest terms. Our friends in ${them} are not alone.`] };
      if (rT < -30) return { tone: 'warm', delta: Math.round(4 * sev), lines: [`${them} had it coming. ${me} understands why ${you} acted.`, `We will not shed tears for ${them}. ${me} wishes ${you} a quick victory.`] };
      if (ally) return { tone: 'cold', delta: -2, lines: [`${me} stands by its allies, but this war worries us. End it quickly, ${you}.`, `We were not consulted. ${me} expects ${you} to stop at its stated aims.`] };
      if (kind === 'capital') return { tone: 'cold', delta: -4, lines: [`The fall of ${them}'s capital changes everything. ${me} calls on ${you} to stop now.`, `Tanks in a foreign capital. The world has seen this before, and it never ended well.`] };
      return { tone: 'cold', delta: -3, lines: [`${me} calls on ${you} and ${them} to return to the table.`, `Another war. ${me} will judge ${you} by what it does with its victory.`] };
    }
    case 'attacked': case 'besieged': {
      if (T && (getRelation(s, X.id, T.id) > 45 || hasAlliance(s, X.id, T.id))) return { tone: 'cold', delta: -3, lines: [`${them} has its reasons. ${me} will not take sides against it.`, `${you} should have listened to ${them}'s warnings.`] };
      if (ally || rP > 40) return { tone: 'warm', delta: kind === 'besieged' ? 6 : 4, lines: kind === 'besieged'
        ? [`${me} will not watch ${you} fall. Weapons and money are on their way.`, `Hold on. ${me} is talking to every capital that can help ${you}.`]
        : [`${me} stands with ${you}. This attack by ${them} will not go unanswered.`, `An attack on ${you} is an attack on everything we believe in. ${me} is with you.`] };
      if (rP < -30) return { tone: 'cold', delta: -1, lines: [`${you} reaps what it sowed. ${me} will not lift a finger.`, `Perhaps ${you} will learn some humility now.`] };
      return { tone: 'neutral', delta: 1, lines: [`${me} urges ${them} to halt its offensive against ${you}.`, `We call for an immediate ceasefire between ${them} and ${you}.`] };
    }
    case 'intervene': return { tone: rP > 20 ? 'warm' : 'cold', delta: rP > 20 ? 3 : -3, lines: [`${me} could not stand by any longer.`, `Enough. ${me} has acted.`] };
    case 'peace': {
      if (T && (allyT || rT > 50) && rP < 20) return { tone: 'cold', delta: -1, lines: [`A peace, but at what price for ${them}? ${me} will be watching.`] };
      return { tone: 'warm', delta: 2, lines: [`${me} welcomes the peace between ${you} and ${them}. Now comes the hard part.`, `The guns are silent. ${me} is ready to help rebuild.`, `A wise decision. ${me} salutes both governments.`] };
    }
    case 'repress':
      if (free(X)) return { tone: 'angry', delta: -4, lines: [`${me} is deeply troubled by the crackdown in ${you}. Free societies are watching.`, `Arrests of journalists and opponents have no place among friends of ${me}.`] };
      return { tone: 'neutral', delta: hawk ? 2 : 0, lines: [`Order must be kept. ${me} respects ${you}'s right to run its own affairs.`, `${me} does not lecture other nations about how to govern.`] };
    case 'reform':
      if (free(X)) return { tone: 'warm', delta: 3, lines: [`${me} applauds the reforms in ${you}. A braver, freer country.`, `${you} is moving in the right direction, and ${me} will say so.`] };
      return { tone: 'cold', delta: -1, lines: [`Reforms come and go. ${me} values stability more.`] };
    case 'aid': return rP > -20 ? { tone: 'warm', delta: 2, lines: [`${me} thanks ${you} for its generosity.`, `${you} has shown what a good neighbour looks like.`] } : null;
    case 'defaulted': return X.eco.gdp > P.eco.gdp * 0.5 ? { tone: 'cold', delta: -3, lines: [`Our banks and pension funds will remember the default of ${you}.`, `${me} expects a credible plan from ${you} before any new loan.`] } : null;
    case 'nuke': return { tone: X.mil.nuclear || rP < 0 ? 'angry' : 'cold', delta: -6, lines: [`${me} condemns ${you}'s nuclear ambitions. The world is less safe today.`, `There will be consequences for ${you}. ${me} is coordinating with its partners.`] };
    case 'betray': return { tone: 'angry', delta: -5, lines: [`${you}'s word is worth nothing. ${me} will remember.`, `How can anyone sign a treaty with ${you} again?`] };
  }
  return null;
}

function homeLines(s: GameState, kind: VoiceKind, T: Country | null): string[] {
  const P = s.countries[s.player];
  const paper = `${['The', 'The', 'The'][0]} ${pick(['Herald', 'Courier', 'Daily', 'Tribune', 'Post', 'Times'], P.id)}`;
  const sup = Math.round(warSupport(P) * 100);
  switch (kind) {
    case 'declare': return [`📊 Poll: ${sup}% of ${P.name} back the war against ${T?.name}.`, sup > 55 ? '📰 Flags on every balcony; the nationalists are jubilant.' : '📰 Students march in the capital: "Not in our name."'];
    case 'attacked': return [`📰 ${paper}: "WE WILL DEFEND EVERY STREET."`, '📊 Volunteers queue outside recruitment offices.'];
    case 'conquest': case 'capital': return [`📰 ${paper}: "${kind === 'capital' ? `${T?.name.toUpperCase()}'S CAPITAL IS OURS` : 'OUR FLAG FLIES OVER ' + (T?.name ?? '').toUpperCase() + ' LAND'}"`, `📊 War support: ${sup}%.`];
    case 'besieged': return [`📰 ${paper}: "THE ENEMY ADVANCES"`, `📊 War support: ${sup}%. Families flee toward the west of the country.`];
    case 'peace': return [`📰 ${paper}: "PEACE"`, '📊 Crowds celebrate in the capital; the hardliners call it a betrayal.'];
    case 'repress': return [`📰 The opposition press: "A dark day for our democracy."`, '📊 The liberals are furious; the security services are pleased.'];
    case 'reform': return [`📰 ${paper}: "A NEW START"`, '📊 Markets rally; the liberals cheer, the old guard grumbles.'];
    case 'defaulted': return [`📰 ${paper}: "BANKRUPT"`, '📊 Queues at the banks; savings lose value overnight.'];
    case 'nuke': return [`📰 ${paper}: "WE HAVE THE BOMB"`];
    default: return [];
  }
}

const TITLE: Record<VoiceKind, (s: GameState, T: Country | null) => string> = {
  declare: (s, T) => `The world reacts: ${s.countries[s.player].name} goes to war with ${T?.name}`,
  attacked: (s, T) => `The world reacts: ${T?.name} attacks you`,
  conquest: (_s, T) => `The world reacts: your army takes ${T?.name}'s land`,
  capital: (_s, T) => `The world reacts: ${T?.name}'s capital falls to you`,
  besieged: (_s, T) => `The world reacts: ${T?.name} is winning against you`,
  peace: (_s, T) => `The world reacts: peace with ${T?.name}`,
  repress: () => 'The world reacts to your crackdown',
  reform: () => 'The world reacts to your reforms',
  aid: () => 'The world reacts to your aid',
  defaulted: () => 'The world reacts to your default',
  nuke: () => 'The world reacts to your nuclear programme',
  betray: (_s, T) => `The world reacts: you broke your word to ${T?.name}`,
  intervene: (_s, T) => `${T?.name} enters the war`,
};

/** Let the world comment on something the player did or suffered (`t`: the other country involved, if any). */
export function voicesOn(s: GameState, kind: VoiceKind, t = -1, lead = ''): VoiceSet | null {
  const P = s.countries[s.player];
  if (!P?.alive) return null;
  const cool = COOL[kind] ?? 0;
  const key = `voice:${kind}${t >= 0 ? `:${t}` : ''}`;
  if (cool && s.tick - (s.stats[key] ?? -999) < cool) return null;
  s.stats[key] = s.tick;
  const T = t >= 0 ? s.countries[t] ?? null : null;
  const voices: Voice[] = [];
  for (const x of audience(s, t >= 0 ? [t] : [])) {
    const X = s.countries[x];
    const st = stance(s, X, kind, T);
    if (!st) continue;
    const text = pick(st.lines, x, s.tick, kind);
    voices.push({ cid: x, tone: st.tone, text, delta: st.delta });
    if (st.delta) addRelation(s, x, s.player, st.delta);
  }
  if (!voices.length && kind !== 'intervene') return null;
  s.stats.voiceSeq = (s.stats.voiceSeq ?? 0) + 1;
  const set: VoiceSet = { seq: s.stats.voiceSeq, tick: s.tick, kind, icon: ICON[kind], title: TITLE[kind](s, T), lead, voices, home: homeLines(s, kind, T) };
  (s.voices ??= []).push(set);
  if (s.voices.length > 12) s.voices.splice(0, s.voices.length - 12);
  const angry = voices.filter((v) => v.tone === 'angry').map((v) => nm(s, v.cid)), warm = voices.filter((v) => v.tone === 'warm').map((v) => nm(s, v.cid));
  if (angry.length || warm.length) logEvent(s, `${ICON[kind]} ${[warm.length ? `${warm.join(', ')} ${warm.length === 1 ? 'backs' : 'back'} you` : '', angry.length ? `${angry.join(', ')} ${angry.length === 1 ? 'condemns' : 'condemn'} you` : ''].filter(Boolean).join('; ')}.`, 'diplo', [s.player, ...voices.map((v) => v.cid)], true);
  return set;
}
