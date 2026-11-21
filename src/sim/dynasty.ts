/**
 * A legacy that outlives you. When a career ends (you retire, lose for good, your health fails, the era closes) and the
 * country still stands, the house goes on: you choose who carries it, from your own child, a protégé from the cabinet
 * or a rising star of the party, and play on as them. Each ruler's chapter is written into the history of the house:
 * the country as they found it and as they left it, what history says, the honours the nation gave them.
 *
 * Prestige is the house's reward: a great career earns a lot of it, a ruinous one little, and it buys the next ruler a
 * head start (a famous name at the polls, a party machine, a fortune, an education for power).
 */
import { clamp } from './util';
import { hash01 } from './rng';
import { logEvent } from './log';
import { personName } from './leaders';
import { strength } from './military';
import { alliesOf } from './relations';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { approval } from './approval';
import { START_YEAR, TICKS_PER_YEAR, type Country, type GameState, type LegacyState, type Look } from './types';
import type { Persona, Skill } from './persona';
import { isFemaleName } from './names';

/** the country at one moment: what a ruler found, and what they left */
export interface Snapshot { tick: number; gdp: number; gdppc: number; pop: number; power: number; econ: number; regions: number; stability: number; approval: number; debt: number; rep: number; allies: number; clients: number; techs: number; unemp: number; infl: number; army: number }
export interface Ruler {
  gen: number; name: string; title: string; origin: string; look?: Look;
  from: number; to: number; terms: number; score: number; grade: string; epithet: string;
  end: string; before: Snapshot; after: Snapshot; honours: string[]; verdict: string[]; deeds: string[]; prestige: number;
}
export interface Candidate { name: string; origin: 'child' | 'heir' | 'protege' | 'star' | 'kin'; age: number; skills: Record<Skill, number>; traits: [string, string]; look: Look; pitch: string }
export interface Dynasty {
  house: string; founded: number; gen: number; rulers: Ruler[]; prestige: number;
  /** a succession waiting for the player's choice */
  pending?: { candidates: Candidate[]; office: boolean; why: string };
  /** the dynasty is over: the country fell, or the player let it end */
  closed?: boolean;
}
export const PERKS: { id: string; label: string; desc: string; cost: number }[] = [
  { id: 'name', label: 'A famous name', desc: 'Approval +5 when they take over', cost: 15 },
  { id: 'machine', label: 'The party machine', desc: 'Political capital +25', cost: 15 },
  { id: 'loyal', label: 'A loyal party', desc: 'No rival inside the party to begin with', cost: 10 },
  { id: 'groomed', label: 'Groomed for power', desc: 'Every skill +1', cost: 25 },
  { id: 'fortune', label: 'The family fortune', desc: 'Treasury +1% of GDP', cost: 20 },
  { id: 'friends', label: 'Old friends abroad', desc: 'Relations +8 with your five closest partners', cost: 15 },
];

const gdpRank = (s: GameState, c: Country) => s.countries.filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((x) => x.id === c.id) + 1;
export function snapshot(s: GameState): Snapshot {
  const c = s.countries[s.player];
  return {
    tick: s.tick, gdp: c.eco.gdp, gdppc: c.eco.realGdp / Math.max(1, c.eco.pop), pop: c.eco.pop, power: c.alive ? powerRank(s, c.id) : 999, econ: c.alive ? gdpRank(s, c) : 999,
    regions: c.provinces.length, stability: c.eco.stability, approval: c.alive ? approval(s, c) : 0, debt: c.eco.debt / Math.max(1, c.eco.gdp), rep: c.reputation,
    allies: alliesOf(s, c.id).length, clients: clientsOf(s, c.id).length, techs: s.stats.techsDone ?? 0, unemp: c.eco.unemployment, infl: c.eco.inflation, army: strength(c),
  };
}
const yearOf = (t: number) => Math.floor(START_YEAR + t / TICKS_PER_YEAR);
/** the house's family name: the founder's surname (names in the game are written given name first) */
export function surnameOf(name: string, _region?: string) { const p = name.trim().split(/\s+/); return p[p.length - 1]; }
/** Slavic and Baltic surnames change with the person: Kowalski and Kowalska, Ivanov and Ivanova. */
export function surnameFor(sur: string, female: boolean): string {
  const M: [string, string][] = [['ski', 'ska'], ['cki', 'cka'], ['dzki', 'dzka'], ['ov', 'ova'], ['ev', 'eva'], ['in', 'ina'], ['ý', 'á'], ['as', 'ienė'], ['is', 'ytė']];
  for (const [m, f] of M) {
    if (female && sur.endsWith(m) && !sur.endsWith(f)) return sur.slice(0, -m.length) + f;
    if (!female && sur.endsWith(f)) return sur.slice(0, -f.length) + m;
  }
  return sur;
}
export function houseName(d: Dynasty, gov: string) { return gov === 'M' ? `House of ${d.house}` : `the ${d.house} dynasty`; }

export function ensureDynasty(s: GameState): Dynasty {
  const c = s.countries[s.player];
  return (s.dynasty ??= { house: surnameFor(surnameOf(s.legacy?.leader ?? personName(c, 'me', 1), c.region), false), founded: 0, gen: 1, rulers: [], prestige: 0 });
}

/** What history says: a few lines drawn from the record, not a template. */
export function verdictLines(s: GameState, L: LegacyState, a: Snapshot, b: Snapshot): string[] {
  const c = s.countries[s.player];
  const first = L.leader.split(' ')[0];
  const out: string[] = [];
  const g = b.gdppc / Math.max(1e-9, a.gdppc) - 1;
  const yrs = Math.max(0.5, (b.tick - a.tick) / TICKS_PER_YEAR);
  const nTerms = L.terms.filter((x) => x.result !== 'returned').length;
  out.push(`${first} governed ${c.name} for ${yrs < 1 ? 'less than a year' : `${yrs.toFixed(0)} year${yrs >= 1.5 ? 's' : ''}`}${nTerms > 1 ? `, across ${nTerms} terms` : ''}.`);
  if (g > 0.25) out.push(`Under ${first}, ${c.name} became ${(g * 100).toFixed(0)}% richer per person in ${yrs.toFixed(0)} years: a generation lifted.`);
  else if (g > 0.05) out.push(`Living standards rose ${(g * 100).toFixed(0)}% over ${yrs.toFixed(0)} years: steady, unspectacular progress.`);
  else if (g < -0.05) out.push(`People were ${(-g * 100).toFixed(0)}% poorer when ${first} left than when they came. That is what most will remember.`);
  if (b.power < a.power) out.push(`${c.name} climbed from #${a.power} to #${b.power} among the world's powers.`);
  else if (b.power > a.power + 2) out.push(`${c.name} slipped from #${a.power} to #${b.power} in the world: others rose while it stood still.`);
  const dr = b.regions - a.regions;
  if (dr >= 3) out.push(`The borders moved: ${dr} regions were added by force or treaty, and neighbours have not forgotten.`);
  else if (dr <= -2) out.push(`${-dr} regions were lost on ${first}'s watch.`);
  const wars = L.wars ?? [];
  const won = wars.filter((w) => w.result === 'won').length, lost = wars.filter((w) => w.result === 'lost').length;
  if (won) out.push(`${won} war${won === 1 ? '' : 's'} won${lost ? `, ${lost} lost` : ''}${wars.length ? `: the ${wars[wars.length - 1].name} is still taught in schools` : ''}.`);
  else if (lost) out.push(`${lost} war${lost === 1 ? '' : 's'} lost: a shadow over everything else.`);
  else if (yrs > 6) out.push(`Not one war in ${yrs.toFixed(0)} years.`);
  const pr = L.promises;
  const pk = pr ? `${pr.kept} promise${pr.kept === 1 ? "" : "s"} kept` : "";
  if (pr && pr.kept + pr.broken > 0) out.push(pr.kept >= pr.broken * 2 ? `${pk}, ${pr.broken} broken: a leader who meant what they said.` : pr.broken > pr.kept ? `${pr.broken} promises broken against ${pr.kept} kept: words came easier than results.` : `${pk}, ${pr.broken} broken.`);
  if (b.debt > a.debt + 0.3) out.push(`The debt rose from ${(a.debt * 100).toFixed(0)}% to ${(b.debt * 100).toFixed(0)}% of GDP, a bill left for the next generation.`);
  else if (b.debt < a.debt - 0.15) out.push(`The public debt fell from ${(a.debt * 100).toFixed(0)}% to ${(b.debt * 100).toFixed(0)}% of GDP.`);
  if (b.stability > a.stability + 12) out.push('A divided country found its calm.');
  else if (b.stability < a.stability - 15) out.push('The country was angrier and more divided at the end than at the start.');
  // and the smaller things people remember
  if (out.length < 4 && b.allies > a.allies) out.push(`${b.allies - a.allies} new all${b.allies - a.allies === 1 ? 'y' : 'ies'} signed: ${c.name} had more friends at the end.`);
  if (out.length < 4 && b.techs > a.techs + 2) out.push(`${b.techs - a.techs} breakthroughs came out of the nation's laboratories.`);
  if (out.length < 4 && b.unemp < a.unemp - 0.015) out.push(`Unemployment fell from ${(a.unemp * 100).toFixed(1)}% to ${(b.unemp * 100).toFixed(1)}%.`);
  if (out.length < 4 && b.rep > a.rep + 6) out.push(`The country's name counted for more abroad: reputation ${a.rep.toFixed(0)} → ${b.rep.toFixed(0)}.`);
  if (out.length < 4) out.push(b.approval >= 55 ? `They left with ${b.approval.toFixed(0)}% of the country behind them.` : b.approval < 35 ? `Only ${b.approval.toFixed(0)}% approved of them at the end.` : `The country was split on them at the end (${b.approval.toFixed(0)}% approval).`);
  if (out.length < 3) out.push(yrs < 5 ? 'Too short a time for history to be sure.' : 'Quiet years: no great triumph, no great disaster.');
  return out.slice(0, 6);
}
/** what the nation gives a ruler: from a statue to a quietly removed portrait */
export function honoursFor(grade: string, L: LegacyState, s: GameState): string[] {
  const c = s.countries[s.player];
  const cap = c.alive ? `the capital` : 'exile';
  const sur = L.leader.split(' ').slice(-1)[0];
  const deeds = Object.keys(L.persona?.deeds ?? {}).length;
  const out: string[] = [];
  if (grade === 'S') out.push(`A statue of ${L.leader} stands in the main square of ${cap}`, `The national airport is renamed ${sur} International`, `${L.leader}'s face is printed on the new banknotes`);
  else if (grade === 'A') out.push(`A statue in ${cap}`, `A university bears the ${sur} name`, 'A state funeral, when the day comes');
  else if (grade === 'B') out.push(`An avenue in ${cap} is named after ${L.leader}`, 'A portrait in the hall of the parliament');
  else if (grade === 'C') out.push('A plaque on the house where they were born');
  else if (grade === 'D') out.push('A short entry in the encyclopaedia');
  else out.push(`${L.leader}'s portrait is quietly taken down from public buildings`);
  if (deeds >= 4) out.push(`${deeds} deeds written into the history books`);
  if ((L.wars ?? []).filter((w) => w.result === 'won').length >= 2) out.push('A victory arch for the wars that were won');
  return out;
}
/** prestige the house earns from a career */
export const prestigeFor = (score: number, deeds: number, terms: number) => Math.max(15, Math.round(score / 10 + deeds * 5 + terms * 4));

/** Close a ruler's chapter: written into the house's history; then, if the country stands, the succession opens. */
export function closeChapter(s: GameState, epithet: string, grade: string) {
  const L = s.legacy!, c = s.countries[s.player];
  const d = ensureDynasty(s);
  const after = snapshot(s);
  const before = L.snap0 ?? { ...after, tick: L.start.tick, gdppc: L.start.gdppc, power: L.start.rank, regions: L.start.provinces, pop: L.start.pop, stability: L.start.stability, rep: L.start.rep ?? after.rep, allies: L.start.allies ?? after.allies, army: L.start.power };
  const deeds = Object.keys(L.persona?.deeds ?? {}).length;
  const terms = L.terms.filter((t) => t.result !== 'returned').length;
  const prestige = prestigeFor(L.score, deeds, terms);
  d.prestige += prestige;
  d.rulers.push({
    gen: d.gen, name: L.leader, title: L.title, origin: L.origin ?? 'founder', look: L.look, from: L.start.tick, to: s.tick, terms, score: L.score, grade, epithet, end: L.endReason ?? '',
    before, after, honours: honoursFor(grade, L, s), verdict: verdictLines(s, L, before, after), deeds: Object.keys(L.persona?.deeds ?? {}), prestige,
  });
  if (!c.alive) { d.closed = true; return; }
  d.pending = { candidates: candidates(s), office: s.stats.succOffice === 1, why: L.endReason ?? '' };
}

/** The three who could carry the house: blood, loyalty, or ambition. */
export function candidates(s: GameState): Candidate[] {
  const L = s.legacy!, c = s.countries[s.player], d = ensureDynasty(s);
  const p = L.persona;
  const r = (k: string) => hash01(`succ:${k}`, c.id, s.tick + d.gen * 7);
  const pick = <T,>(a: T[], x: number) => a[Math.floor(x * a.length) % a.length];
  const TR = ['hawk', 'dove', 'pragmatist', 'nationalist', 'mercantilist', 'ideologue', 'reformer', 'strongman', 'isolationist', 'internationalist'];
  const sk = (base: Partial<Record<Skill, number>>, inherit = 0): Record<Skill, number> => {
    const out = { cha: 4, adm: 4, dip: 4, cmd: 3 } as Record<Skill, number>;
    for (const k of Object.keys(out) as Skill[]) out[k] = clamp(Math.round(out[k] + (base[k] ?? 0) + (p ? inherit * (p.skills[k] - 4) : 0)), 1, 10);
    return out;
  };
  // a name nobody in the house has carried yet
  const used = new Set([...d.rulers.map((x) => x.name), L.leader]);
  const fresh = (salt: string, mk: (i: number) => string) => { for (let i = 0; i < 12; i++) { const n = mk(i); if (!used.has(n)) return n; } return mk(13); };
  const given = (salt: string, i = 0) => { const n = personName(c, `${salt}${i}`, s.tick % 997 + d.gen); const parts = n.split(/\s+/); return parts.slice(0, -1).join(' ') || parts[0]; };
  const family = (g: string) => `${g} ${surnameFor(d.house, isFemaleName(g))}`;
  const parentAge = p?.age ?? 60;
  // the face runs in the family: a child gets the parent's skin and hair (each can still be changed)
  const kin: Look = { ...(L.look ?? {}), kin: L.leader };
  delete kin.female; delete kin.hair; delete kin.facial; delete kin.glasses;
  const heirName = p?.heir;
  const out: Candidate[] = [];
  const childName = heirName ?? fresh('child', (i) => family(given('child', i)));
  const childGiven = childName.split(/\s+/)[0];
  out.push({
    name: childName, origin: heirName ? 'heir' : c.gov === 'M' ? 'kin' : 'child', age: clamp(parentAge - 26 - Math.floor(r('a1') * 6), 28, 58),
    skills: sk({ cha: 1 }, 0.4), traits: [L.traits?.[0] ?? 'pragmatist', pick(TR, r('t1'))], look: kin,
    pitch: heirName ? `The successor you named, raised at your side. They carry your name, your friends and your enemies.` : `Your ${isFemaleName(childGiven) ? 'daughter' : 'son'}: the family name, half of what you taught them, and something to prove.`,
  });
  const mins = [...(c.cabinet ?? [])].filter((x) => !used.has(x.name)).sort((a, b) => b.skill * 10 + b.loyalty / 10 - (a.skill * 10 + a.loyalty / 10));
  const m = mins[0];
  out.push({
    name: m?.name ?? personName(c, 'protege', s.tick % 991), origin: 'protege', age: clamp(44 + Math.floor(r('a2') * 14), 36, 66),
    skills: sk({ adm: 2, dip: 1, cha: -1 }, 0.2), traits: ['pragmatist', pick(TR, r('t2'))], look: {},
    pitch: m ? `Your ${m.role === 'finance' ? 'finance minister' : m.role === 'foreign' ? 'foreign minister' : m.role === 'defence' ? 'defence minister' : 'interior minister'}, loyal for years. A safe pair of hands; the voters will need convincing.` : 'Your most trusted minister: competent, loyal, not loved.',
  });
  out.push({
    name: fresh('star', (i) => personName(c, `star${i}`, s.tick % 983)), origin: 'star', age: clamp(36 + Math.floor(r('a3') * 8), 32, 48),
    skills: sk({ cha: 3, adm: -1, cmd: -1 }), traits: [pick(TR, r('t3')), pick(TR, r('t4'))].filter((x, i, a) => a.indexOf(x) === i).concat('reformer').slice(0, 2) as [string, string], look: {},
    pitch: 'The party’s rising star: young, magnetic, untested. Crowds love them; the old guard does not.',
  });
  if (c.gov === 'M') { out[1].pitch = 'A cousin of the royal line, schooled at court. ' + out[1].pitch; out[1].name = fresh('cousin', (i) => family(given('cousin', i))); out[1].origin = 'kin'; }
  return out;
}

/** Take up the mantle: the chosen successor becomes the leader you play, and a new chapter begins. */
export function actSucceed(s: GameState, idx: number, opts: { name?: string; look?: Look; perks?: string[] }, make: { initLegacyFor: (s: GameState, name: string, office: boolean) => void; personaFor: (s: GameState, cand: Candidate) => Persona }) {
  const d = s.dynasty;
  const pend = d?.pending;
  if (!d || !pend) return { ok: false, message: 'No succession is open' };
  const cand = pend.candidates[idx];
  if (!cand) return { ok: false, message: 'Choose a successor' };
  const perks = (opts.perks ?? []).filter((id) => PERKS.some((p) => p.id === id));
  const cost = perks.reduce((t, id) => t + PERKS.find((p) => p.id === id)!.cost, 0);
  if (cost > d.prestige) return { ok: false, message: 'Not enough prestige' };
  d.prestige -= cost;
  const name = (opts.name ?? cand.name).trim().slice(0, 32) || cand.name;
  const prev = d.rulers[d.rulers.length - 1];
  d.gen++;
  delete d.pending;
  make.initLegacyFor(s, name, pend.office);
  const L = s.legacy!, c = s.countries[s.player];
  L.look = { ...cand.look, ...(opts.look ?? {}) };
  L.origin = cand.origin;
  L.traits = cand.traits;
  L.persona = make.personaFor(s, cand);
  const P = L.persona;
  for (const id of perks) {
    if (id === 'name') s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 5;
    if (id === 'machine' && c.politics) c.politics.pc = (c.politics.pc ?? 0) + 25;
    if (id === 'loyal') P.rival.power = 0;
    if (id === 'groomed') for (const k of Object.keys(P.skills) as Skill[]) P.skills[k] = Math.min(10, P.skills[k] + 1);
    if (id === 'fortune') c.eco.cash += 0.01 * c.eco.gdp;
  }
  const rel = { child: 'child', heir: 'chosen heir', protege: 'protégé', star: 'rising star', kin: 'kin' }[cand.origin];
  const line = `${name}, ${rel} of ${prev?.name ?? 'the founder'}, becomes the ${ordinalWord(d.gen)} of ${houseName(d, c.gov)}.`;
  L.chronicle = [{ tick: s.tick, text: line }];
  logEvent(s, `👑 SUCCESSION: ${line}`, 'info', [s.player], true, { big: true, prov: c.capital });
  return { ok: true, message: line, perks };
}
export const ordinalWord = (n: number) => ['founder', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n - 1] ?? `${n}th generation`;
/** a ruler's years, for the interface */
export const reignYears = (r: Ruler) => `${yearOf(r.from)}–${yearOf(r.to)}`;
