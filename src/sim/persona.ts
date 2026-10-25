/**
 * Legacy mode: you are a person, not a country.
 *
 * Your leader has an age and health (power wears you out, and nobody governs for ever), and four skills that grow
 * with what you actually do: charisma (speeches, rallies, election wins), administration (laws passed, demands met,
 * research), diplomacy (treaties, clients won abroad) and command (wars won, land held). Each skill pays off: appeal at
 * the polls, cheaper laws, easier treaties, a steadier home front in war.
 *
 * Inside your own party a rival waits: weak while you are popular, stronger every week you are not. Let them grow and
 * they challenge you for the leadership. And beyond the term-by-term promises, a career has its deeds: the things
 * history will remember you for.
 */
import { clamp } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { personName } from './leaders';
import { strength } from './military';
import { alliesOf, isAtWar } from './relations';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { sectorStanding, SECTORS } from './industry';
import { approval } from './approval';
import type { Country, GameState } from './types';

export type Skill = 'cha' | 'adm' | 'dip' | 'cmd';
export const SKILLS: { id: Skill; icon: string; name: string; how: string; pays: string }[] = [
  { id: 'cha', icon: '🎙', name: 'Charisma', how: 'speeches, rallies, election wins, high approval', pays: 'personal appeal at the polls; more political capital' },
  { id: 'adm', icon: '📋', name: 'Administration', how: 'laws passed, coalition demands met, research', pays: 'laws cost less political capital' },
  { id: 'dip', icon: '🤝', name: 'Diplomacy', how: 'treaties, allies, countries in your sphere', pays: 'treaties accepted more readily' },
  { id: 'cmd', icon: '🎖', name: 'Command', how: 'wars won, land held, crises weathered', pays: 'war support holds up better in a long war' },
];
export interface Persona {
  age: number; health: number;
  skills: Record<Skill, number>; xp: Record<Skill, number>;
  /** your rival inside the party: power 0..100 (a challenge at 100) */
  rival: { name: string; power: number; since: number; tries: number };
  /** career deeds achieved: id -> tick */
  deeds: Record<string, number>;
  /** a protégé who will carry on after you */
  heir?: string;
  /** snapshot of counters for skill experience */
  snap: Record<string, number>;
  born: number;
}
const TRAIT_SKILL: Record<string, Partial<Record<Skill, number>>> = {
  hawk: { cmd: 2 }, dove: { dip: 2 }, pragmatist: { dip: 1, adm: 1 }, nationalist: { cha: 2 }, mercantilist: { dip: 1, adm: 1 },
  ideologue: { cha: 1, adm: 1 }, paranoid: { cmd: 1, adm: 1 }, reformer: { adm: 2 }, strongman: { cmd: 1, cha: 1 }, isolationist: { cha: 1, adm: 1 },
  internationalist: { dip: 2 },
};
export function initPersona(s: GameState): Persona {
  const c = s.countries[s.player];
  const traits = s.legacy?.traits ?? s.settings.leaderTraits ?? ['pragmatist', 'reformer'];
  const skills: Record<Skill, number> = { cha: 4, adm: 4, dip: 4, cmd: 3 };
  for (const t of traits) for (const [k, v] of Object.entries(TRAIT_SKILL[t] ?? {})) skills[k as Skill] += v as number;
  const age = 46 + Math.floor(hash01('age', c.id, s.settings.seed) * 12);
  return { age, health: 88, skills, xp: { cha: 0, adm: 0, dip: 0, cmd: 0 }, rival: { name: personName(c, 'rival', s.settings.seed % 97), power: 10, since: s.tick, tries: 0 }, deeds: {}, snap: {}, born: s.tick - age * 52 };
}
export function personaOf(s: GameState): Persona | null {
  const L = s.legacy;
  if (!L || s.settings.mode !== 'legacy') return null;
  if (!L.persona) L.persona = initPersona(s);
  return L.persona;
}
const lv = (p: Persona | null, k: Skill) => (p ? p.skills[k] : 5);
/** skill effects (neutral at 5) */
export const charismaVote = (s: GameState) => { const p = personaOf(s); return p ? (p.skills.cha - 5) * 0.8 : 0; };
export const lawCostMult = (s: GameState) => { const p = personaOf(s); return p ? clamp(1 - 0.03 * (lv(p, 'adm') - 5), 0.75, 1.15) : 1; };
export const dipAccept = (s: GameState) => { const p = personaOf(s); return p ? 0.012 * (lv(p, 'dip') - 5) : 0; };
export const charismaPc = (s: GameState) => { const p = personaOf(s); return p ? 0.02 * (lv(p, 'cha') - 5) : 0; };

function gain(s: GameState, p: Persona, k: Skill, v: number) {
  p.xp[k] += v;
  const need = 60 + 25 * p.skills[k];
  if (p.xp[k] >= need && p.skills[k] < 10) {
    p.xp[k] -= need; p.skills[k]++;
    const sk = SKILLS.find((x) => x.id === k)!;
    logEvent(s, `${sk.icon} ${s.legacy!.leader}'s ${sk.name.toLowerCase()} grows to ${p.skills[k]}: ${sk.pays}.`, 'info', [s.player], true);
  }
}

// ------------------------------------------------------------------ deeds
export interface Deed { id: string; icon: string; title: string; pts: number; test: (s: GameState, c: Country) => boolean; hint: (s: GameState, c: Country) => string }
const gdppc = (c: Country) => c.eco.realGdp / Math.max(1, c.eco.pop);
export const DEEDS: Deed[] = [
  { id: 'richer25', icon: '📈', title: 'A richer country: living standards +25%', pts: 60, test: (s, c) => gdppc(c) >= 1.25 * (s.legacy?.start.gdppc ?? Infinity), hint: (s, c) => `${((gdppc(c) / (s.legacy?.start.gdppc ?? 1) - 1) * 100).toFixed(0)}% so far` },
  { id: 'richer60', icon: '💎', title: 'An economic miracle: living standards +60%', pts: 90, test: (s, c) => gdppc(c) >= 1.6 * (s.legacy?.start.gdppc ?? Infinity), hint: (s, c) => `${((gdppc(c) / (s.legacy?.start.gdppc ?? 1) - 1) * 100).toFixed(0)}% so far` },
  { id: 'top10', icon: '🏆', title: 'Lead the country into the world’s top 10', pts: 70, test: (s, c) => powerRank(s, c.id) <= 10, hint: (s, c) => `#${powerRank(s, c.id)} now` },
  { id: 'top3', icon: '👑', title: 'A great power: the world’s top 3', pts: 120, test: (s, c) => powerRank(s, c.id) <= 3, hint: (s, c) => `#${powerRank(s, c.id)} now` },
  { id: 'sphere3', icon: '🌐', title: 'A sphere of influence: three client states', pts: 60, test: (s, c) => clientsOf(s, c.id).length >= 3, hint: (s, c) => `${clientsOf(s, c.id).length} now` },
  { id: 'tech10', icon: '🔬', title: 'Ten breakthroughs in office', pts: 50, test: (s) => (s.stats.techsDone ?? 0) >= 10, hint: (s) => `${s.stats.techsDone ?? 0} so far` },
  { id: 'industry3', icon: '🏭', title: 'A top-3 world producer in an industry', pts: 60, test: (s, c) => SECTORS.some((x) => { const st = sectorStanding(s, c, x.id); return st.rank > 0 && st.rank <= 3; }), hint: (s, c) => { const best = SECTORS.map((x) => sectorStanding(s, c, x.id).rank).filter((r) => r > 0).sort((a, b) => a - b)[0]; return best ? `best rank #${best}` : '—'; } },
  { id: 'laws6', icon: '⚖', title: 'A reforming government: six laws on the books', pts: 40, test: (_s, c) => (c.politics?.laws.length ?? 0) >= 6, hint: (_s, c) => `${c.politics?.laws.length ?? 0} in force` },
  { id: 'threeTerms', icon: '🗳', title: 'Win three mandates', pts: 80, test: (s) => (s.legacy?.terms.filter((t) => t.result === 'reelected' || t.result === 'returned').length ?? 0) >= 2 && (s.legacy?.status === 'office'), hint: (s) => `${(s.legacy?.terms.filter((t) => t.result === 'reelected' || t.result === 'returned').length ?? 0) + 1} so far` },
  { id: 'warWon', icon: '⚔', title: 'Win a war', pts: 40, test: (s) => (s.legacy?.wars ?? []).some((w) => w.result === 'won'), hint: (s) => `${(s.legacy?.wars ?? []).filter((w) => w.result === 'won').length} won` },
  { id: 'peace8', icon: '🕊', title: 'Eight years of peace in office', pts: 50, test: (s) => s.tick - (s.stats[`legacyWar:${s.player}`] ?? s.legacy?.start.tick ?? 0) >= 416 && s.tick - (s.legacy?.start.tick ?? 0) >= 416, hint: (s) => `${((s.tick - Math.max(s.stats[`legacyWar:${s.player}`] ?? 0, s.legacy?.start.tick ?? 0)) / 52).toFixed(1)} years` },
  { id: 'allies12', icon: '🤝', title: 'A web of alliances: twelve allies', pts: 40, test: (s, c) => alliesOf(s, c.id).length >= 12 && alliesOf(s, c.id).length > (s.legacy?.start.allies ?? 0), hint: (s, c) => `${alliesOf(s, c.id).length} allies` },
  { id: 'stronger50', icon: '🛡', title: 'Armed forces half as strong again', pts: 40, test: (s, c) => strength(c) >= 1.5 * (s.legacy?.start.power ?? Infinity), hint: (s, c) => `${((strength(c) / (s.legacy?.start.power ?? 1) - 1) * 100).toFixed(0)}% so far` },
  { id: 'beloved', icon: '❤', title: 'Beloved: win an election with over 60%', pts: 40, test: (s) => (s.stats.lastVote ?? 0) > 60 && s.legacy?.status === 'office' && (s.legacy?.terms.at(-1)?.result === 'reelected'), hint: (s) => (s.stats.lastVote ? `last vote ${s.stats.lastVote.toFixed(0)}%` : 'no election yet') },
];

// ------------------------------------------------------------------ the weekly step
export function stepPersona(s: GameState) {
  const p = personaOf(s);
  const L = s.legacy;
  if (!p || !L || L.status === 'ended') return;
  const c = s.countries[s.player];
  // a year older
  if (s.tick % 52 === 0 && s.tick > 0) p.age++;
  // health drifts toward what age and the job allow; power wears you out, war and crisis more
  if (s.tick % 4 === 0) {
    const stress = (L.status === 'office' ? 4 : 0) + (isAtWar(s, c.id) ? 5 : 0) + (c.eco.stability < 35 ? 4 : 0);
    const target = clamp(96 - Math.max(0, p.age - 52) * 1.6 - stress, 5, 95);
    p.health = clamp(p.health + (target - p.health) * 0.05 + (nextRand(s) - 0.5) * 1.5, 0, 100);
    if (p.health < 12 && nextRand(s) < 0.25) {
      const heirLine = p.heir ? ` ${p.heir} takes up the cause.` : '';
      if (L.status === 'office') L.chronicle.push({ tick: s.tick, text: `${L.leader}'s health fails at ${p.age}.` });
      s.stats.healthEnd = 1; // legacy.ts closes the career
      L.endReason = `${L.leader}'s health gives out at the age of ${p.age}.${heirLine}`;
      return;
    }
  }
  if (L.status !== 'office') return;
  // skills grow with what you do (weekly signals against last week's counters)
  const P = c.politics;
  const counters: Record<string, number> = {
    laws: P?.laws.length ?? 0, kept: P?.gov?.kept ?? 0, techs: s.stats.techsDone ?? 0, allies: alliesOf(s, c.id).length,
    clients: s.tick % 4 === 0 ? clientsOf(s, c.id).length : p.snap.clients ?? 0, wars: (L.wars ?? []).filter((w) => w.result === 'won').length,
    speech: s.stats['lever:speech'] ?? -1, terms: L.terms.filter((t) => t.result === 'reelected' || t.result === 'returned').length, provs: c.provinces.length,
  };
  const d = (k: string) => Math.max(0, counters[k] - (p.snap[k] ?? counters[k]));
  gain(s, p, 'adm', 14 * d('laws') + 10 * d('kept') + 4 * d('techs'));
  gain(s, p, 'dip', 8 * d('allies') + 18 * d('clients'));
  gain(s, p, 'cmd', 40 * d('wars') + 4 * d('provs') + (isAtWar(s, c.id) ? 0.3 : 0));
  gain(s, p, 'cha', (counters.speech !== (p.snap.speech ?? counters.speech) ? 6 : 0) + 40 * d('terms') + (approvalNow(s, c) > 55 ? 0.35 : 0));
  p.snap = counters;
  // command steadies the home front in war
  if (isAtWar(s, c.id) && c.mil.warSupport !== undefined) c.mil.warSupport = clamp(c.mil.warSupport + 0.0004 * (p.skills.cmd - 5), 0, 1);
  // the rival inside the party: grows while you are unpopular, fades while you are not
  const appr = approvalNow(s, c);
  p.rival.power = clamp(p.rival.power + (appr < 45 ? (45 - appr) * 0.05 : -(appr - 45) * 0.03) + (L.term >= 3 ? 0.08 : 0), 0, 100);
  if (p.rival.power >= 100 && !s.inbox.some((x) => x.id === 'legacy_challenge')) {
    s.stats.challengeDue = 1; // legacy.ts puts the challenge on your desk
    p.rival.power = 85;
  }
  // deeds
  if (s.tick % 4 === 1) for (const dd of DEEDS) {
    if (p.deeds[dd.id] !== undefined) continue;
    if (!dd.test(s, c)) continue;
    p.deeds[dd.id] = s.tick;
    L.parts.deeds = (L.parts.deeds ?? 0) + dd.pts;
    L.chronicle.push({ tick: s.tick, text: `${dd.icon} ${dd.title}.` });
    logEvent(s, `${dd.icon} A DEED FOR THE HISTORY BOOKS: ${dd.title}. Legacy +${dd.pts}.`, 'info', [s.player], true, { big: true, prov: c.capital });
  }
}
const approvalNow = (s: GameState, c: Country) => approval(s, c);

/** Name a protégé who will carry on after you (once). */
export function actNameHeir(s: GameState) {
  const p = personaOf(s), L = s.legacy;
  if (!p || !L) return { ok: false, message: 'Only in Legacy' };
  if (p.heir) return { ok: false, message: `${p.heir} is already your chosen successor` };
  const c = s.countries[s.player];
  p.heir = personName(c, 'heir', s.tick % 101);
  p.rival.power = clamp(p.rival.power + 10, 0, 100); // the rival does not like it
  L.chronicle.push({ tick: s.tick, text: `${L.leader} names ${p.heir} as successor.` });
  return { ok: true, message: `${p.heir} is your chosen successor. Retire while popular and they may win the next election for you (legacy +80). Your party rival is not pleased.` };
}
