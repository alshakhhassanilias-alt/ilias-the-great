/**
 * Leaders, long-term goals and long memories: what makes one country behave differently from another.
 * Leaders are fictional (generated names); their traits shift the country's AI personality while they rule.
 */
import { backlashDue, crisisOf, stepDebtCrisis, turningLeader } from './turns';
import { changeGov } from './alignment';
import { cable } from './cables';
import type { Geo } from './geo';
import { clamp } from './util';
import { nationalName } from './names';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { claimStrength } from './war';
import { alliesOf, getRelation, isAtWar } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import { makeAgenda, mandateOf, moodOf, moodTraitWeight } from './minds';
import { choosePlan, pursuePlan, mainThreatOf } from './plans';
import type { Country, Grudge, GameState, Leader } from './types';

type Dl = Leader['applied'];
export interface Trait { id: string; title: string; icon: string; desc: string; d: Dl }
export const TRAITS: Trait[] = [
  { id: 'hawk', title: 'Hawk', icon: '🦅', desc: 'Quick to threaten and to fight.', d: { aggression: 0.25, expansion: 0.1, caution: -0.15 } },
  { id: 'dove', title: 'Dove', icon: '🕊', desc: 'Prefers talks to tanks.', d: { aggression: -0.2, caution: 0.15 } },
  { id: 'pragmatist', title: 'Pragmatist', icon: '🧮', desc: 'Does deals with anyone who pays.', d: { trade: 0.1, ideology: -0.15 } },
  { id: 'nationalist', title: 'Nationalist', icon: '🚩', desc: 'Obsessed with lost land and national pride.', d: { expansion: 0.2, ideology: 0.1, trade: -0.1 } },
  { id: 'mercantilist', title: 'Mercantilist', icon: '💱', desc: 'Wants trade deals, not wars.', d: { trade: 0.25, aggression: -0.05 } },
  { id: 'ideologue', title: 'Ideologue', icon: '📜', desc: 'Judges every country by its political system.', d: { ideology: 0.3 } },
  { id: 'paranoid', title: 'Paranoid', icon: '👁', desc: 'Sees plots everywhere and arms accordingly.', d: { caution: 0.2, aggression: 0.1, trade: -0.1 } },
  { id: 'reformer', title: 'Reformer', icon: '🛠', desc: 'Focused on the economy at home.', d: { trade: 0.1, caution: 0.05, aggression: -0.05 } },
  { id: 'strongman', title: 'Strongman', icon: '🥊', desc: 'Rules by force and projects power abroad.', d: { aggression: 0.1, expansion: 0.1 } },
  { id: 'isolationist', title: 'Country First', icon: '🏠', desc: 'Wants out of foreign wars and alliances that cost more than they give.', d: { aggression: -0.05, caution: 0.1, trade: -0.05 } },
  { id: 'internationalist', title: 'Internationalist', icon: '🌐', desc: 'Believes in alliances, institutions and standing by friends.', d: { trade: 0.05, ideology: 0.05 } },
];
export const traitById = (id: string) => TRAITS.find((t) => t.id === id)!;

/** a fictional person's name typical of the country (deterministic for the same salt) */
export const personName = (c: Country, salt: string, n: number) =>
  nationalName(c, hash01(`${salt}g`, c.id, n), hash01(`${salt}f`, c.id, n), hash01(`${salt}l`, c.id, n), salt === 'gen' ? 'general' : 'politician');
const leaderName = (c: Country, gen: number) => nationalName(c, hash01('lg', c.id, gen), hash01('lf', c.id, gen), hash01('ll', c.id, gen));
const traitWeights = (gov: string): number[] => TRAITS.map((t) => {
  const base = 1;
  if (gov === 'D') return base * ({ dove: 1.6, pragmatist: 1.5, reformer: 1.6, mercantilist: 1.3, hawk: 0.6, strongman: 0.2, paranoid: 0.5 } as Record<string, number>)[t.id]! || base;
  if (gov === 'A' || gov === 'C') return base * ({ strongman: 2, paranoid: 1.6, nationalist: 1.4, hawk: 1.3, ideologue: 1.4, dove: 0.4, reformer: 0.5 } as Record<string, number>)[t.id]! || base;
  return base;
});
function pickTraits(c: Country, gen: number): [string, string] {
  // the public picks (or the palace installs) what the moment seems to need
  const w = traitWeights(c.gov).map((x, i) => Math.max(0.05, x * moodTraitWeight(c, TRAITS[i].id)));
  if (w.length > 1) w[TRAITS.findIndex((t) => t.id === 'internationalist')] *= 0.6;
  const pick = (skip: string) => {
    const ws = TRAITS.map((t, i) => (t.id === skip ? 0 : w[i]));
    let r = hash01('lt', c.id, gen * 3 + (skip ? 1 : 0)) * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return TRAITS[i].id; }
    return TRAITS[0].id;
  };
  const a = pick('');
  let b = pick(a);
  if ((a === 'isolationist' && b === 'internationalist') || (a === 'internationalist' && b === 'isolationist') || (a === 'dove' && b === 'hawk') || (a === 'hawk' && b === 'dove')) b = 'pragmatist';
  return [a, b];
}
function applyTraits(c: Country, ids: [string, string]): Dl {
  const sum: Dl = {};
  for (const id of ids) for (const [k, v] of Object.entries(traitById(id).d)) (sum as Record<string, number>)[k] = ((sum as Record<string, number>)[k] ?? 0) + (v as number);
  for (const [k, v] of Object.entries(sum)) { const kk = k as keyof Country['ai']; c.ai[kk] = clamp(c.ai[kk] + (v as number), kk === 'aggression' ? 0.02 : 0, kk === 'aggression' ? 1.4 : 1); }
  return sum;
}
function removeTraits(c: Country) {
  const old = c.leader?.applied;
  if (!old) return;
  for (const [k, v] of Object.entries(old)) { const kk = k as keyof Country['ai']; c.ai[kk] = clamp(c.ai[kk] - (v as number), kk === 'aggression' ? 0.02 : 0, kk === 'aggression' ? 1.4 : 1); }
}
export function crownLeader(s: GameState, c: Country, gen: number, threatWho = -1) {
  removeTraits(c);
  let traits = pickTraits(c, gen);
  // the leaders of 2024 were not elected on a mood that has not happened yet
  for (let k = 1; s.tick === 0 && traits.includes('isolationist') && k < 20; k++) traits = pickTraits(c, gen + k * 7919);
  c.leader = { name: leaderName(c, gen), traits, since: s.tick, applied: applyTraits(c, traits), ...makeAgenda(s, c, traits, gen), mandate: mandateOf(s, c, traits, threatWho) };
}
export const traitsText = (l: Leader) => l.traits.map((t) => traitById(t).title).join(' & ');

// ------------------------------------------------------------------ grudges
export function addGrudge(s: GameState, victim: number, offender: number, why: string, w: number) {
  if (victim === offender) return;
  s.grudges ??= {};
  const k = `${victim}>${offender}`;
  const list = (s.grudges[k] ??= []);
  const same = list.find((g) => g.why === why && s.tick - g.tick < 52);
  if (same) { same.w = Math.min(60, same.w + w * 0.5); return; }
  list.push({ tick: s.tick, why, w });
  if (list.length > 8) list.sort((a, b) => b.w - a.w).length = 8;
}
export const grudgesOf = (s: GameState, victim: number, offender: number): Grudge[] => (s.grudges?.[`${victim}>${offender}`] ?? []);
export const grudgeScore = (s: GameState, victim: number, offender: number) => grudgesOf(s, victim, offender).reduce((t, g) => t + g.w, 0);
function decayGrudges(s: GameState) {
  if (!s.grudges) return;
  for (const k of Object.keys(s.grudges)) {
    const list = s.grudges[k];
    for (const g of list) g.w *= 0.9985; // half-life about nine years
    s.grudges[k] = list.filter((g) => g.w > 1.5);
    if (!s.grudges[k].length) delete s.grudges[k];
  }
}

/** Give every AI country its first leader and aim (done when the game is created, so the first week has no spike). */
export function initLeaders(s: GameState, geo: Geo) {
  for (const c of s.countries) if (c.alive && c.id !== s.player && !c.leader) { crownLeader(s, c, Math.round(hash01('gen0', c.id, s.settings.seed) * 1e6)); c.goal = choosePlan(s, geo, c); }
}

// ------------------------------------------------------------------ the weekly step
export function stepLeaders(s: GameState, geo: Geo) {
  for (const _ of stepLeadersGen(s, geo)) { /* run to completion */ }
}
/** The same, in slices (a few dozen governments at a time) so the browser can draw in between. */
export function* stepLeadersGen(s: GameState, geo: Geo): Generator<void> {
  let n = 0;
  if (s.tick % 4 === 3) decayGrudges(s);
  for (const c of s.countries) {
    if (!c.alive || c.id === s.player) continue;
    if (++n % 20 === 0) yield;
    if (!c.leader) { crownLeader(s, c, Math.round(hash01('gen0', c.id, s.settings.seed) * 1e6)); c.goal = choosePlan(s, geo, c); }
    // a long-term plan, worked on every month and reconsidered twice a year
    if ((s.tick + c.id) % 4 === 2) { pursuePlan(s, geo, c); stepDebtCrisis(s, c); if (backlashDue(s, c)) backlash(s, geo, c); }
    if ((s.tick + c.id) % 26 === 5) { const g = choosePlan(s, geo, c); if (g !== c.goal) c.goal = g; }
    // succession, once a year per country
    if ((s.tick + c.id * 7) % 52 !== 11) continue;
    const years = (s.tick - c.leader!.since) / 52;
    const free = c.gov === 'D' || c.gov === 'F';
    const turmoil = c.eco.stability < 18;
    // voters punish a government for a bad economy, an endless war or a humiliation
    const m = moodOf(c), anger = Math.max(m.pain, m.weary, m.shame);
    // a regime in crisis cracks: it changes faces sooner, and under a deep crisis it may fall outright
    const cr = crisisOf(c, s);
    const p = turmoil ? 0.55 : free ? (years < 4 ? 0 : Math.min(0.75, (0.12 * (years - 3)) * (0.6 + anger * 1.4))) : (years < 8 ? 0.01 + anger * 0.02 : Math.min(0.3, 0.04 * (years - 7))) + cr * 0.22;
    if (nextRand(s) >= p) continue;
    const old = c.leader;
    const gen = Math.round(hash01('gen', c.id, s.tick, s.settings.seed) * 1e6);
    const fell = !free && cr > 0.55 && nextRand(s) < cr * 0.35;
    if (fell) { changeGov(s, c, 'F', 'mass protests force the regime to share power'); s.stats[`regime:${c.id}`] = s.tick; }
    crownLeader(s, c, gen, mainThreatOf(s, geo, c).who);
    const turned = turningLeader(s, c, gen);
    // a new face is a chance for a fresh start: grudges soften, hostility cools a little
    for (const k of Object.keys(s.grudges ?? {})) if (k.startsWith(`${c.id}>`)) for (const g of s.grudges[k]) g.w *= 0.6;
    c.goal = choosePlan(s, geo, c, true);
    const how = fell ? 'as the old regime falls' : turmoil ? 'after a collapse of the government' : free ? 'after an election' : old && years > 15 ? 'after the old ruler’s death' : 'in a palace shake-up';
    logEvent(s, `🆕 ${c.name}: ${c.leader!.name} (${traitsText(c.leader!)}) takes over ${how}, ${c.leader!.mandate}. Aim: ${c.goal.text.charAt(0).toLowerCase() + c.goal.text.slice(1)}.`, 'diplo', [c.id], isMajor(s, c.id) || isAtWar(s, c.id));
    if (turned) logEvent(s, `🔓 ${c.name.toUpperCase()} TURNS: ${c.leader!.name} breaks with the old line, ${c.leader!.mandate}.`, 'diplo', [c.id], true, isMajor(s, c.id) ? { big: true, prov: c.capital } : undefined);
    if (isMajor(s, c.id) || neighborsOf(s, geo, s.player).includes(c.id)) cable(s, c.id, 'new_leader');
  }
}

/** The old guard strikes back against a leader who turned: a coup restores the old order and the old line. */
function backlash(s: GameState, geo: Geo, c: Country) {
  const from = c.leader!.turn!.from, ousted = c.leader!.name;
  s.stats[`turnAt:${c.id}`] = s.tick;
  if (c.gov !== 'A' && c.gov !== 'C') changeGov(s, c, 'A', 'the security services seize power');
  s.stats[`regime:${c.id}`] = s.tick;
  crownLeader(s, c, Math.round(hash01('hard', c.id, s.tick, s.settings.seed) * 1e6));
  c.leader!.lean = from; c.leader!.mandate = 'promising to restore the old order';
  c.goal = choosePlan(s, geo, c, true);
  logEvent(s, `🪖 HARDLINERS STRIKE BACK in ${c.name}: ${ousted} is ousted and the opening is over. ${c.leader!.name} promises to restore the old order.`, 'danger', [c.id], true, isMajor(s, c.id) ? { big: true, prov: c.capital } : undefined);
}
