/**
 * The minds of the world's leaders.
 *
 *   The record — what every country has done, as the world remembers it: wars it started, land it seized, promises it
 *               broke, allies it stood by, crackdowns, reforms, aid, defaults, the bomb. It fades over about a decade.
 *   The mood   — how an AI country's public feels: tired of war, tired of paying for other people's defence, angry
 *               about the economy, afraid of a neighbour, humiliated by a defeat. It decides who wins the next election
 *               (or who seizes power), and what they promised.
 *   The agenda — what a leader cares about: security, expansion, wealth, prestige, ideology; how much they believe in
 *               alliances (or want out of them); which camp they personally prefer.
 *   Judgement  — every leader looks at every other country's record through their own agenda. A security hawk next
 *               door fears a warmonger; a democrat ideologue despises a crackdown; a mercantilist hates sanctions and
 *               defaults. Judgement feeds their decisions (deals, votes, sanctions, coalitions, war) and their words.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { hash01 } from './rng';
import { alliesOf, enemiesOf, getRelation, hasAlliance, isAtWar, warsOf } from './relations';
import { cableText } from './cables';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import { initialOrientOf } from './alignment';
import type { Country, CountryId, Drive, GameState, Leader, Mood, Record_ } from './types';

// ------------------------------------------------------------------ the record
export type RecKey = keyof Record_;
const EMPTY: Record_ = { aggr: 0, conquest: 0, betray: 0, loyal: 0, sanction: 0, repress: 0, reform: 0, aid: 0, defaulted: 0, nuke: 0 };
export const recOf = (s: GameState, id: CountryId): Record_ => s.rec?.[id] ?? EMPTY;
export function addRec(s: GameState, id: CountryId, k: RecKey, v: number) {
  if (id < 0) return;
  const r = ((s.rec ??= {})[id] ??= { ...EMPTY });
  r[k] = clamp(r[k] + v, 0, 12);
  // in Legacy, what you do in office is also yours personally: it follows you out of office and back in
  const L = s.legacy;
  if (id === s.player && L && s.settings.mode === 'legacy' && L.status === 'office') { const p = (L.rec ??= { ...EMPTY }); p[k] = clamp(p[k] + v, 0, 12); }
}
/** Monthly: the world slowly forgets (half-life about nine years); the bomb is never forgotten. */
function decayRecords(s: GameState) {
  for (const r of Object.values(s.rec ?? {})) for (const k of Object.keys(r) as RecKey[]) if (k !== 'nuke') { r[k] *= 0.9936; if (r[k] < 0.02) r[k] = 0; }
  // people are remembered longer than governments
  const p = s.legacy?.rec;
  if (p) for (const k of Object.keys(p) as RecKey[]) if (k !== 'nuke') { p[k] *= 0.9968; if (p[k] < 0.02) p[k] = 0; }
}

// ------------------------------------------------------------------ the mood of AI countries
export const NO_MOOD: Mood = { weary: 0, burden: 0, pain: 0, threat: 0, shame: 0 };
export const moodOf = (c: Country): Mood => c.mood ?? NO_MOOD;

/** How heavily a country carries its alliances: what it spends, what share of the joint strength it is, what its allies pay. */
export function burdenOf(s: GameState, c: Country): number {
  const allies = alliesOf(s, c.id).map((x) => s.countries[x]).filter((x) => x?.alive);
  const mil = c.budget.military;
  let t = 0;
  if (allies.length) {
    const sum = allies.reduce((a, x) => a + strength(x), 0);
    const share = strength(c) / Math.max(1, strength(c) + sum);
    const gdp = allies.reduce((a, x) => a + x.eco.gdp, 0);
    const avg = allies.reduce((a, x) => a + x.budget.military * x.eco.gdp, 0) / Math.max(1, gdp);
    // the public resents carrying allies who are rich enough to carry themselves
    const rich = clamp(gdp / Math.max(1, c.eco.gdp), 0, 1);
    t += clamp((share - 0.4) * 1.2, 0, 0.35) * Math.min(1, allies.length / 4) * rich;
    t += clamp((mil - avg) * 16, 0, 0.35) * rich;
    t += Math.min(0.2, allies.filter((x) => isAtWar(s, x.id) && !isAtWar(s, c.id)).length * 0.07);
  }
  return clamp(t, 0, 1);
}

function stepMood(s: GameState, c: Country, threat: number) {
  const e = c.eco, m = (c.mood ??= { ...NO_MOOD });
  let weary = 0;
  if (isAtWar(s, c.id)) {
    const since = Math.min(...warsOf(s, c.id).map((w) => w.start));
    weary = clamp(0.2 + ((s.tick - since) / 52) * 0.22 + c.mil.exhaustion * 1.5, 0, 1);
  }
  const pain = clamp(Math.max(0, e.unemployment - e.uNat) * 6 + Math.max(0, e.inflation - 0.05) * 2.5 + Math.max(0, -e.growth) * 8 + (e.debt / e.gdp > 1.3 ? 0.12 : 0) + e.sanctionShare * 1.5 + Math.max(0, 45 - e.stability) / 100, 0, 1);
  const lost = Math.max(0, c.baseline.provinces - c.provinces.length) / Math.max(1, c.baseline.provinces);
  const shame = clamp(lost * 3 + (s.tick - (s.stats[`lostWar:${c.id}`] ?? -9999) < 156 ? 0.4 : 0), 0, 1);
  const k = 0.15;
  m.weary += ((isAtWar(s, c.id) ? weary : 0) - m.weary) * (isAtWar(s, c.id) ? k : 0.06);
  m.burden += (burdenOf(s, c) - m.burden) * k;
  m.pain += (pain - m.pain) * k;
  m.threat += (clamp(threat, 0, 1) - m.threat) * k;
  m.shame += (shame - m.shame) * (shame > m.shame ? 0.3 : 0.03);
}

// ------------------------------------------------------------------ agendas
export const DRIVES: Drive[] = ['security', 'expansion', 'wealth', 'prestige', 'ideology'];
export const DRIVE_LABEL: Record<Drive, string> = { security: 'Security', expansion: 'Expansion', wealth: 'Wealth', prestige: 'Prestige', ideology: 'Ideology' };
export const DRIVE_ICON: Record<Drive, string> = { security: '🛡', expansion: '🗺', wealth: '💰', prestige: '👑', ideology: '📜' };
const TRAIT_DRIVES: Record<string, Partial<Record<Drive, number>>> = {
  hawk: { security: 0.3, expansion: 0.5, prestige: 0.3 }, dove: { wealth: 0.5, security: 0.2, expansion: -0.3 }, pragmatist: { wealth: 0.6, ideology: -0.3 },
  nationalist: { expansion: 0.6, prestige: 0.5 }, mercantilist: { wealth: 0.9 }, ideologue: { ideology: 1.0 }, paranoid: { security: 0.8 },
  reformer: { wealth: 0.6, ideology: 0.2 }, strongman: { prestige: 0.6, expansion: 0.3, security: 0.2 }, isolationist: { wealth: 0.4, security: 0.2, prestige: -0.2 },
  internationalist: { ideology: 0.3, prestige: 0.3, security: 0.2 },
};
const TRAIT_COMMIT: Record<string, number> = { isolationist: -0.85, internationalist: 0.6, nationalist: -0.3, dove: 0.1, mercantilist: 0.1, paranoid: -0.1, ideologue: 0.15 };

/** Build what a new leader cares about from their traits, the system they rule and what the public feels. */
export function makeAgenda(s: GameState, c: Country, traits: string[], salt: number): Pick<Leader, 'agenda' | 'commit' | 'lean'> {
  const m = moodOf(c);
  const w: Record<Drive, number> = { security: 1, expansion: 0.35, wealth: 1, prestige: 0.55, ideology: 0.5 };
  for (const t of traits) for (const [d, v] of Object.entries(TRAIT_DRIVES[t] ?? {})) w[d as Drive] += v as number;
  if (c.gov === 'D' || c.gov === 'F') { w.ideology += 0.15; w.wealth += 0.2; }
  if (c.gov === 'A' || c.gov === 'C') { w.prestige += 0.2; w.ideology += c.gov === 'C' ? 0.3 : 0.1; }
  if (isMajor(s, c.id)) w.prestige += 0.3;
  w.security += m.threat * 1.0; w.wealth += m.pain * 0.8; w.expansion += m.shame * 0.8 - m.weary * 0.5; w.prestige += m.shame * 0.5;
  let sum = 0;
  for (const d of DRIVES) { w[d] = Math.max(0.05, w[d] * (0.8 + 0.4 * hash01('ag', c.id, salt, DRIVES.indexOf(d)))); sum += w[d]; }
  for (const d of DRIVES) w[d] = +(w[d] / sum).toFixed(3);
  let commit = (c.gov === 'D' || c.gov === 'F' ? 0.3 : 0) + (isMajor(s, c.id) ? 0.15 : 0) - m.burden * 0.6 - m.weary * 0.3 + m.threat * 0.4 + (hash01('cm', c.id, salt) - 0.5) * 0.3;
  for (const t of traits) commit += TRAIT_COMMIT[t] ?? 0;
  const o = c.orient ?? initialOrientOf(c);
  // centred on where the country stands: most leaders keep its place; swing states swing with their leaders
  // (the pull of the system itself, democracy West and dictatorship East, is already part of orientation)
  let lean = o + (hash01('ln', c.id, salt) - 0.5) * 0.8 * (1 - Math.abs(o) * 0.6);
  if (traits.includes('pragmatist')) lean = lean * 0.7 + o * 0.3;
  if ((c.hostile ?? 0) > 0.3) lean -= m.pain * 0.25; // hit by Western sanctions: some voices look East
  return { agenda: w, commit: +clamp(commit, -1, 1).toFixed(2), lean: +clamp(lean, -1, 1).toFixed(2) };
}

/** A leader's agenda (older saves without one get it worked out from the traits). */
export function agendaOf(s: GameState, c: Country): Record<Drive, number> {
  if (c.leader?.agenda) return c.leader.agenda;
  const a = makeAgenda(s, c, c.leader?.traits ?? [], 0).agenda!;
  if (c.leader) c.leader.agenda = a;
  return a;
}
export const commitOf = (c: Country) => c.leader?.commit ?? 0.2;
export const topDrives = (a: Record<Drive, number>) => [...DRIVES].sort((x, y) => a[y] - a[x]);
export const commitLabel = (v: number) => (v < -0.5 ? 'wants out of foreign commitments' : v < -0.15 ? 'sceptical of alliances' : v < 0.25 ? 'transactional about alliances' : v < 0.6 ? 'believes in its alliances' : 'a committed internationalist');
export const leanLabel = (v: number) => (v > 0.6 ? 'firmly pro-Western' : v > 0.25 ? 'leans West' : v < -0.6 ? 'firmly pro-Eastern' : v < -0.25 ? 'leans East' : 'keeps its distance from both camps');

/** Mood multipliers for the traits of the next leader: the public picks (or the palace installs) what the moment needs. */
export function moodTraitWeight(c: Country, trait: string): number {
  const m = moodOf(c);
  const free = c.gov === 'D' || c.gov === 'F';
  const k = free ? 1 : 0.5; // a palace listens less than an electorate
  switch (trait) {
    case 'dove': return 1 + k * (2 * m.weary - m.threat);
    case 'hawk': return 1 + k * (1.6 * m.threat + m.shame - m.weary);
    case 'paranoid': return 1 + k * m.threat;
    case 'isolationist': return 1 + k * (1.6 * m.burden + 1.2 * m.weary + 0.6 * m.pain - 1.2 * m.threat);
    case 'internationalist': return 1 + k * (1.2 * m.threat - 1.5 * m.burden);
    case 'nationalist': return 1 + k * (1.5 * m.shame + 0.6 * m.pain);
    case 'reformer': case 'mercantilist': return 1 + k * 1.2 * m.pain;
    case 'strongman': return 1 + k * (0.8 * m.pain + 0.8 * m.shame);
    default: return 1;
  }
}

/** Why the new leader won (or took) power, in plain words. */
export function mandateOf(s: GameState, c: Country, traits: string[], threatWho: CountryId): string {
  const m = moodOf(c), free = c.gov === 'D' || c.gov === 'F';
  const e = c.eco;
  const cands: [number, string][] = [
    [m.weary, free ? 'promising to bring the soldiers home' : 'promising to end a draining war'],
    [m.burden * (traits.includes('isolationist') ? 1.4 : 0.6), 'promising to stop paying for other countries\' defence'],
    [m.pain, `on anger over the economy (unemployment ${(e.unemployment * 100).toFixed(0)}%, inflation ${(e.inflation * 100).toFixed(0)}%)`],
    [m.threat * (threatWho >= 0 ? 1 : 0), threatWho >= 0 ? `promising to stand up to ${s.countries[threatWho].name}` : ''],
    [m.shame, 'vowing to restore national pride after the defeat'],
  ];
  const best = cands.filter((x) => x[1]).sort((a, b) => b[0] - a[0])[0];
  if (best && best[0] > 0.3) return best[1];
  const BY_TRAIT: Record<string, string> = {
    reformer: 'promising reform and growth', internationalist: 'promising to work with allies', nationalist: 'promising national renewal', paranoid: 'promising to keep the country safe',
    hawk: 'promising strength abroad', dove: 'promising peace and quiet', strongman: 'promising a firm hand', ideologue: 'promising to stay true to the cause',
    mercantilist: 'promising trade and jobs', isolationist: 'promising to put the country first', pragmatist: free ? 'as the steady-hands candidate' : 'as the establishment\'s choice',
  };
  return BY_TRAIT[traits[0]] ?? (free ? 'as the steady-hands candidate' : 'as the establishment\'s choice');
}

// ------------------------------------------------------------------ judgement
export interface Reason { key: string; label: string; v: number }
/** How leader J judges country X's record, through J's own agenda. Positive: admiration; negative: contempt or fear. */
export function opinionOf(s: GameState, J: CountryId, X: CountryId): { v: number; reasons: Reason[] } {
  const r = s.rec?.[X];
  const jc = s.countries[J], xc = s.countries[X];
  const out: Reason[] = [];
  if (!jc?.alive || !xc?.alive || J === X) return { v: 0, reasons: out };
  const a = agendaOf(s, jc);
  const free = jc.gov === 'D' || jc.gov === 'F';
  const near = s.stats[`nb:${J}:${X}`] === 1;
  const hawkish = a.expansion > 0.22 || jc.leader?.traits.includes('hawk') ? 0.6 : 1;
  const add = (key: string, label: string, v: number) => { if (Math.abs(v) >= 1) out.push({ key, label, v: Math.round(v) }); };
  if (r) {
    if (r.aggr > 0.05) add('aggr', 'started wars of aggression', -r.aggr * (5 + 14 * a.security + 5 * a.ideology) * (near ? 1.5 : 1) * hawkish);
    if (r.conquest > 0.05) add('conquest', 'seized land by force', -r.conquest * (2 + 7 * a.security) * (near ? 1.4 : 1));
    if (r.betray > 0.05) add('betray', 'broke its word to partners', -r.betray * (9 + 8 * a.ideology + 4 * a.security));
    if (r.loyal > 0.05) add('loyal', 'stood by its allies in war', r.loyal * (3 + 10 * a.security));
    if (r.sanction > 0.05 && a.wealth > 0.22) add('sanction', 'uses sanctions as a weapon', -r.sanction * 14 * a.wealth);
    if (r.repress > 0.05) add('repress', free ? 'cracked down on its own people' : 'keeps order at home', free ? -r.repress * (3 + 16 * a.ideology) : r.repress * 2);
    if (r.reform > 0.05) add('reform', free ? 'reformed and opened up' : 'is spreading Western ideas', free ? r.reform * (3 + 10 * a.ideology) : jc.leader?.traits.includes('ideologue') ? -r.reform * 4 : 0);
    if (r.aid > 0.05) add('aid', 'gave aid to countries in need', r.aid * (3 + (jc.eco.gdp / Math.max(1, jc.eco.pop) < 8000 ? 6 : 0)));
    if (r.defaulted > 0.05) add('default', 'defaulted on its debts', -r.defaulted * (4 + 14 * a.wealth));
    if (r.nuke > 0.05 && xc.mil.nuclear) add('nuke', 'built the bomb', -r.nuke * (4 + 12 * a.security) * (jc.mil.nuclear ? 0.5 : 1) * (near ? 1.6 : 1));
  }
  // in Legacy the player is a person too: leaders react to your style as they react to each other's
  const style = X === s.player && s.settings.mode === 'legacy' && s.legacy?.status === 'office' ? s.legacy.traits : undefined;
  if (style && jc.leader) {
    let v = 0;
    for (const a2 of jc.leader.traits) for (const b of style) v += STYLE[`${a2}>${b}`] ?? (a2 === 'ideologue' && b === 'strongman' && free ? -6 : 0);
    if (Math.abs(v) >= 1) add('style', `is led by a ${style.map((t) => TRAIT_TITLE[t] ?? t).join(' & ')}`, clamp(v, -10, 10));
  }
  // allies who will not pay for their own defence
  if (hasAlliance(s, J, X) && xc.budget.military < Math.min(0.015, jc.budget.military * 0.6) && xc.eco.gdp > jc.eco.gdp * 0.02) add('freeride', 'free-rides on our defence', -(3 + 8 * a.security) * (commitOf(jc) < 0 ? 1.6 : 1));
  // switching sides is judged by both camps
  const oj = jc.orient ?? 0;
  const shift = (xc.orient ?? 0) - initialOrientOf(xc);
  if (Math.abs(oj) > 0.4 && Math.abs(shift) > 0.15) add('camp', shift * oj > 0 ? 'moved toward our camp' : 'turned away from our camp', Math.sign(oj) * shift * (10 + 20 * a.ideology));
  // a prestige-hungry power resents a rising peer; a wealth-minded one admires a booming partner
  if (a.prestige > 0.24 && isMajor(s, X) && isMajor(s, J) && xc.eco.growth > jc.eco.growth + 0.02) add('rise', 'is rising at our expense', -8 * a.prestige);
  out.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  const v = clamp(out.reduce((t, x) => t + x.v, 0), -45, 35);
  return { v, reasons: out.slice(0, 5) };
}

/** How one leader's style strikes another (judge trait > subject trait). */
const STYLE: Record<string, number> = {
  'hawk>hawk': 3, 'dove>hawk': -5, 'hawk>dove': -3, 'dove>dove': 4, 'strongman>strongman': 4, 'strongman>reformer': -2, 'reformer>strongman': -3,
  'mercantilist>mercantilist': 4, 'mercantilist>nationalist': -3, 'pragmatist>pragmatist': 3, 'internationalist>isolationist': -5, 'isolationist>internationalist': -2,
  'internationalist>internationalist': 4, 'nationalist>nationalist': 2, 'paranoid>hawk': -3, 'reformer>reformer': 3, 'ideologue>ideologue': 2,
};
const TRAIT_TITLE: Record<string, string> = { hawk: 'Hawk', dove: 'Dove', pragmatist: 'Pragmatist', nationalist: 'Nationalist', mercantilist: 'Mercantilist', ideologue: 'Ideologue', paranoid: 'Paranoid', reformer: 'Reformer', strongman: 'Strongman', isolationist: 'Country First', internationalist: 'Internationalist' };

/** On your return to power, the leaders who feel most strongly about your record say so. */
export function rememberCables(s: GameState) {
  const L = s.legacy;
  if (!L) return;
  const you = s.countries[s.player];
  const list = s.countries.filter((c) => c.alive && !c.isPlayer && c.leader && isMajor(s, c.id)).map((c) => ({ c, v: opinionOf(s, c.id, s.player).v })).sort((a, b) => a.v - b.v);
  const critic = list[0], fan = list[list.length - 1];
  if (critic && critic.v <= -10) cableText(s, critic.c.id, `So ${L.leader} is back. ${critic.c.name} has not forgotten what ${you.name} did under your rule.`, 'cold');
  if (fan && fan.v >= 10) cableText(s, fan.c.id, `Welcome back, ${L.leader}. ${fan.c.name} remembers a partner it could count on.`, 'warm');
}

// ------------------------------------------------------------------ judgement in words: leaders tell the player
const JUDGE_LINES: Record<string, { bad: string[]; good: string[] }> = {
  aggr: { bad: ['We have watched {you} start war after war. {me} will not be next.', 'Every capital in the region is asking who {you} will attack next. So are we.'], good: [] },
  conquest: { bad: ['Borders changed by force do not stay changed. {me} will not recognise what {you} took.'], good: [] },
  betray: { bad: ['{you} broke its word before. Why should {me} believe it now?', 'A signature from {you} is worth less than the paper it is printed on.'], good: [] },
  loyal: { bad: [], good: ['{you} stood by its allies when it counted. {me} noticed.', 'When the guns started, {you} kept its promise. That is rare.'] },
  sanction: { bad: ['{you} reaches for sanctions every time it disagrees. Our businesses are tired of it.'], good: [] },
  repress: { bad: ['The images from your streets have reached our parliament. {me} cannot look away.', '{you} treats its own people as enemies. We will say so publicly.'], good: ['{me} respects a government that keeps order.'] },
  reform: { bad: ['{you} imports foreign ideas and calls it reform. We are watching.'], good: ['{me} welcomes the reforms in {you}. You will find us a willing partner.'] },
  aid: { bad: [], good: ['The aid from {you} saved lives. {me} will not forget it.'] },
  default: { bad: ['{you} walked away from its debts. Our banks will remember for a generation.'], good: [] },
  nuke: { bad: ['{you} now has the bomb. {me} has had to redraw every plan we had.'], good: [] },
  camp: { bad: ['{you} has turned its back on old friends. {me} takes note.'], good: ['{me} welcomes {you} to our side of the table.'] },
  rise: { bad: ['{you} grows fast. Some in {me} say too fast.'], good: [] },
  style: { bad: ['{me} does not care for the way {you} is led these days.'], good: ['{me} likes the way {you} is led. We speak the same language.'] },
  freeride: { bad: ['{me} spends on its army so that {you} does not have to. That has to change.', 'Our taxpayers ask why they pay for the defence of {you}. I have no good answer.'], good: [] },
};
export function judgeLine(key: string, good: boolean, me: string, you: string, salt: number): string | null {
  const L = JUDGE_LINES[key];
  const pool = good ? L?.good : L?.bad;
  if (!pool?.length) return null;
  return pool[Math.floor(hash01('jl', salt, key.length) * pool.length)].replaceAll('{me}', me).replaceAll('{you}', you);
}

// ------------------------------------------------------------------ the monthly step
export function stepMinds(s: GameState, geo: Geo, threatOf: (c: Country) => number) {
  if (s.tick % 4 === 1) decayRecords(s);
  for (const c of s.countries) {
    if (!c.alive || c.isPlayer || (s.tick + c.id) % 4 !== 1) continue;
    stepMood(s, c, threatOf(c));
  }
  // leaders who matter to the player say what they think of its record when their judgement shifts
  if (s.tick % 4 === 3) judgeThePlayer(s, geo);
  // neighbourhood cache for judgement (refreshed yearly; borders move slowly)
  if (s.tick % 52 === 1 || s.stats.nbCache === undefined) {
    for (const k of Object.keys(s.stats)) if (k.startsWith('nb:')) delete s.stats[k];
    for (const c of s.countries) if (c.alive && (c.isPlayer || isMajor(s, c.id) || neighborsOf(s, geo, s.player).includes(c.id))) for (const n of neighborsOf(s, geo, c.id)) { s.stats[`nb:${c.id}:${n}`] = 1; s.stats[`nb:${n}:${c.id}`] = 1; }
    s.stats.nbCache = 1;
  }
}

function judgeThePlayer(s: GameState, geo: Geo) {
  const P = s.player;
  if (!s.countries[P]?.alive) return;
  const watchers = new Set<CountryId>(neighborsOf(s, geo, P));
  for (const c of s.countries) if (c.alive && isMajor(s, c.id)) watchers.add(c.id);
  if (s.rival >= 0) watchers.add(s.rival);
  let spoke = false;
  for (const J of watchers) {
    const jc = s.countries[J];
    if (!jc?.alive || jc.isPlayer || !jc.leader) continue;
    const op = opinionOf(s, J, P);
    const k = `op:${J}`;
    const prev = s.stats[k];
    s.stats[k] = op.v;
    if (prev === undefined || spoke || Math.abs(op.v - prev) < 8 || s.tick - (s.stats[`opSaid:${J}`] ?? -999) < 26) continue;
    const up = op.v > prev;
    const r = op.reasons.find((x) => (x.v > 0) === up);
    if (!r) continue;
    const line = judgeLine(r.key, up, jc.name, s.countries[P].name, s.tick + J);
    if (!line) continue;
    cableText(s, J, line, up ? 'warm' : 'cold');
    s.stats[`opSaid:${J}`] = s.tick;
    spoke = true;
  }
}

/** Who is fighting whom right now is part of what a leader fears. */
export const atWarWith = (s: GameState, a: CountryId, b: CountryId) => enemiesOf(s, a).includes(b);
void getRelation;
/** A reason, addressed to the country itself: "it broke its word" → "you broke your word". */
export const asYou = (label: string) => label.replace(/^uses /, 'use ').replace(/^keeps /, 'keep ').replace(/^is /, 'are ').replace(/\bits\b/g, 'your');
