/**
 * Who sides with whom, and how that changes. Nothing about the 2024 blocs is permanent:
 *
 * - Orientation. Every country sits somewhere between the Eastern camp (−1) and the Western camp (+1). It drifts
 *   slowly toward the company it keeps (allies, partners, friends), toward whichever camp looks like the winner
 *   (bandwagoning), and toward its form of government. A dead zone and a slow rate keep the world from sloshing:
 *   realignments take years and need a push.
 * - Hostility. How far the West treats a country as an adversary. It fades as the country leans West and stays at
 *   peace with the West; it grows when it fights Western-leaning states.
 * - Organisations. NATO, the EU, the CSTO, the Arab League and BRICS are live: members leave when they no longer
 *   belong (at war with another member, relations collapsed, on the other side), organisations dissolve when too few
 *   remain, outsiders apply and are voted in, and great powers found new pacts. Defence organisations bind members
 *   with alliance treaties, so blocs on the map follow.
 * - Governments. Revolutions, juntas, emergency rule and free elections change a country's form of government, which
 *   changes who trusts it.
 */
import { stepThaw } from './turns';
import { addRec, asYou, opinionOf } from './minds';
import type { Geo } from './geo';
import { ARAB_LEAGUE, CSTO, EU, NATO } from '../data/countryData';
import {
  NAME_TO_ID, addRelation, areAtWar, ensureTreaty, getRelation, getTreaty, hostileOf, initialHostile, initialOrient, isAtWar, orientOf, orgsOf, touchOrgs, touchTreaties,
} from './relations';
import { strength } from './military';
import { isMajor } from './drama';
import { nextRand } from './rng';
import { clamp } from './util';
import { logEvent } from './log';
import { cleanName, evolveOrgs, orgName } from './blocs';
import { geoRefGet } from './geoRef';
import { neighborsOf } from './diplomacy';
import type { Country, CountryId, GameState, Org } from './types';

const BRICS = ['Brazil', 'Russia', 'India', 'China', 'South Africa', 'Iran', 'Egypt', 'Ethiopia', 'United Arab Emirates'];
const ids = (names: string[]) => names.map((n) => NAME_TO_ID[n]).filter((x) => x !== undefined);

/** The organisations of 2024. NATO's bonus sits on top of the Western camp's (+14), matching the old fixed values. */
export function initialOrgs(): Org[] {
  return ([
    { id: 1, key: 'nato', name: 'NATO', icon: '🛡', kind: 'defence', bonus: 12, members: ids(NATO), founded: 0, camp: 1 },
    { id: 2, key: 'eu', name: 'the European Union', icon: '⭐', kind: 'union', bonus: 14, members: ids(EU), founded: 0, camp: 1 },
    { id: 3, key: 'csto', name: 'the CSTO', icon: '⚔', kind: 'defence', bonus: 22, members: ids(CSTO), founded: 0, camp: -1 },
    { id: 4, key: 'arab', name: 'the Arab League', icon: '🌙', kind: 'economic', bonus: 14, members: ids(ARAB_LEAGUE), founded: 0, camp: 0 },
    { id: 5, key: 'brics', name: 'BRICS', icon: '🌐', kind: 'economic', bonus: 6, members: ids(BRICS), founded: 0, camp: 0 },
  ] as Org[]).map((o) => ({ ...o, base: o.bonus, depth: 2 / 3, history: [{ tick: 0, text: 'A founding pillar of the 2024 world order' }] }));
}

/** Older saves and new games: make sure orientation, hostility, organisations and long memory exist. */
export function ensureAlignment(s: GameState) {
  if (!s.orgs) { s.orgs = initialOrgs(); touchOrgs(s); }
  s.relHist ??= {};
  for (const c of s.countries) {
    c.orient ??= initialOrient(c.id);
    c.hostile ??= initialHostile(c.id);
  }
}

const nameOf = (s: GameState, id: CountryId) => s.countries[id]?.name ?? '?';
/** Where a country stood in 2024 (+1 West, −1 East, 0 neither). */
export const initialOrientOf = (c: Country) => initialOrient(c.id);
// military strength of every country, computed once per week (it is read thousands of times by the steps below)
let strCache: { st: GameState; tick: number; v: Float64Array } | null = null;
function str(s: GameState, id: CountryId): number {
  if (!strCache || strCache.st !== s || strCache.tick !== s.tick) {
    const v = new Float64Array(s.countries.length);
    for (const c of s.countries) v[c.id] = c.alive ? strength(c) : 0;
    strCache = { st: s, tick: s.tick, v };
  }
  return strCache.v[id] ?? 0;
}
const avgRelation = (s: GameState, c: CountryId, others: CountryId[]) => {
  const xs = others.filter((x) => x !== c && s.countries[x]?.alive);
  return xs.length ? xs.reduce((t, x) => t + getRelation(s, c, x), 0) / xs.length : 0;
};
const touchesPlayer = (s: GameState, o: Org, c?: CountryId) => c === s.player || o.members.includes(s.player);

// ------------------------------------------------------------------ membership
export function joinOrg(s: GameState, o: Org, c: CountryId, why = '') {
  if (o.members.includes(c)) return;
  if (o.kind === 'defence') for (const m of o.members) if (s.countries[m]?.alive && !areAtWar(s, c, m)) ensureTreaty(s, c, m).alliance = true;
  o.members.push(c);
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `${o.icon} ${nameOf(s, c)} joins ${o.name}${why ? `: ${why}` : ''}.`, 'diplo', [c, ...o.members.slice(0, 3)], touchesPlayer(s, o, c), { big: touchesPlayer(s, o, c) || o.members.length > 8 });
}
export function leaveOrg(s: GameState, o: Org, c: CountryId, why: string) {
  if (!o.members.includes(c)) return;
  o.members = o.members.filter((x) => x !== c);
  if (o.kind === 'defence') for (const m of o.members) { const t = getTreaty(s, c, m); if (t?.alliance && !bilateral(s, c, m, o)) t.alliance = false; }
  for (const m of o.members) addRelation(s, c, m, o.kind === 'economic' ? -4 : -10);
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `${o.icon} ${nameOf(s, c).toUpperCase()} LEAVES ${o.name.replace(/^the /, '').toUpperCase()}: ${why}`, 'diplo', [c, ...o.members.slice(0, 3)], true, { big: touchesPlayer(s, o, c) || o.kind === 'defence' || o.members.length > 8 });
  if (o.members.length < 3) dissolveOrg(s, o, `only ${o.members.length} member${o.members.length === 1 ? '' : 's'} left`);
}
export function dissolveOrg(s: GameState, o: Org, why: string) {
  if (o.kind === 'defence') for (let i = 0; i < o.members.length; i++) for (let j = i + 1; j < o.members.length; j++) { const t = getTreaty(s, o.members[i], o.members[j]); if (t?.alliance && !bilateral(s, o.members[i], o.members[j], o)) t.alliance = false; }
  s.orgs = (s.orgs ?? []).filter((x) => x !== o);
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `${o.icon} ${o.name.replace(/^the /, '').toUpperCase()} IS DISSOLVED: ${why}. The alliance it stood for is gone.`, 'diplo', o.members.slice(0, 4), true, { big: true });
}
/** Is a pair also allied through another defence organisation? (then leaving one does not end the alliance) */
function bilateral(s: GameState, a: CountryId, b: CountryId, except: Org) {
  return (s.orgs ?? []).some((o) => o !== except && o.kind === 'defence' && o.members.includes(a) && o.members.includes(b));
}
export function foundOrg(s: GameState, founder: CountryId, kind: Org['kind'], members: CountryId[], name?: string): Org {
  const F = s.countries[founder];
  const id = Math.max(0, ...(s.orgs ?? []).map((o) => o.id)) + 1;
  const camp = Math.sign(Math.round(orientOf(s, founder) * 2) / 2);
  const bonus = kind === 'defence' ? 14 : kind === 'union' ? 12 : 6;
  const o: Org = {
    id, key: `org${id}`, kind, founded: s.tick, founder, members: [],
    name: name ?? orgName(s, kind, founder, members, camp),
    icon: kind === 'defence' ? '🛡' : kind === 'union' ? '🤝' : '💱', bonus: Math.round(bonus * 0.84), base: bonus, depth: 0.4, camp,
    history: [{ tick: s.tick, text: `Founded by ${F.name}` }],
  };
  (s.orgs ??= []).push(o);
  for (const m of [founder, ...members]) if (!o.members.includes(m)) {
    if (kind === 'defence') for (const x of o.members) ensureTreaty(s, m, x).alliance = true;
    o.members.push(m);
  }
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `${o.icon} A NEW BLOC: ${F.name} founds ${o.name} with ${members.map((m) => nameOf(s, m)).join(', ')}.`, 'diplo', o.members.slice(0, 4), true, { big: true, prov: F.capital });
  return o;
}

/** Would the members admit this country? One line per member, so the player can see who blocks it. */
export function applicationVotes(s: GameState, o: Org, c: CountryId): { m: CountryId; yes: boolean; why: string }[] {
  const oc = orientOf(s, c);
  return o.members.filter((m) => s.countries[m]?.alive).map((m) => {
    const r = getRelation(s, m, c);
    if (areAtWar(s, m, c)) return { m, yes: false, why: 'at war with you' };
    if (o.camp !== 0 && oc * o.camp < -0.2) return { m, yes: false, why: 'you belong to the other camp' };
    if (o.kind === 'defence' && orgsOf(s, c).some((x) => x.kind === 'defence' && x !== o)) return { m, yes: false, why: 'you are in a rival defence pact' };
    const need = o.kind === 'defence' ? 25 : o.kind === 'union' ? 30 : 10;
    // members judge the applicant's record, not only today's relations
    const op = opinionOf(s, m, c);
    const score = r + op.v * 0.6;
    const rec = Math.abs(op.v) >= 8 && op.reasons[0] ? `; ${op.v < 0 ? 'holds it against you that' : 'likes that'} you ${asYou(op.reasons[0].label)}` : '';
    return score >= need ? { m, yes: true, why: `relations ${r.toFixed(0)}${rec}` } : { m, yes: false, why: `relations ${r.toFixed(0)} (needs ${need})${rec}` };
  });
}
/** Admission rule: defence pacts and unions need near-unanimity (one in ten may abstain); economic clubs a two-thirds majority. */
export function admitted(o: Org, votes: { yes: boolean }[]) {
  const yes = votes.filter((v) => v.yes).length;
  return votes.length > 0 && yes / votes.length >= (o.kind === 'economic' ? 0.66 : 0.9);
}

/** How believable an organisation's protection is: its members' combined strength against the best it has been. */
const orgStrength = (s: GameState, o: Org) => o.members.reduce((t, m) => t + str(s, m), 0);
export function credibility(s: GameState, o: Org): number {
  const peak = s.stats[`orgPeak:${o.id}`] ?? 0;
  return peak > 0 ? clamp(orgStrength(s, o) / peak, 0, 1) : 1;
}
/** Monthly: remember each organisation's best strength; the memory fades over a couple of decades. */
function updatePeaks(s: GameState) {
  for (const o of s.orgs ?? []) { const k = `orgPeak:${o.id}`; s.stats[k] = Math.max(orgStrength(s, o), (s.stats[k] ?? 0) * 0.997); }
}
/** The weakest credibility among the camp organisations a country belongs to (1 = none or all solid). */
function campDoubt(s: GameState, c: Country) {
  let cred = 1;
  for (const o of orgsOf(s, c.id)) if (o.camp !== 0 && o.kind === 'defence') cred = Math.min(cred, credibility(s, o));
  return cred;
}

// ------------------------------------------------------------------ governments
export const GOV_LABEL: Record<string, string> = { D: 'democracy', F: 'flawed democracy', A: 'authoritarian regime', C: 'one-party state', M: 'monarchy', H: 'hybrid regime' };
export function changeGov(s: GameState, c: Country, gov: string, why: string) {
  if (c.gov === gov) return;
  const was = GOV_LABEL[c.gov] ?? c.gov;
  c.gov = gov;
  if (gov === 'D') addRec(s, c.id, 'reform', 1); else if (gov === 'A' || gov === 'C') addRec(s, c.id, 'repress', 0.7);
  // a freely elected government looks West; a junta or strongman looks for friends who will not lecture it
  if (gov === 'D') { c.orient = clamp((c.orient ?? 0) + 0.25, -1, 1); c.hostile = Math.max(0, (c.hostile ?? 0) - 0.25); }
  if (gov === 'A') c.orient = clamp((c.orient ?? 0) - 0.1, -1, 1);
  logEvent(s, `🏛 ${c.name.toUpperCase()}: ${why}. The ${was} becomes ${/^[aeiou]/i.test(GOV_LABEL[gov] ?? gov) ? 'an' : 'a'} ${GOV_LABEL[gov] ?? gov}.`, 'danger', [c.id], true, { big: c.isPlayer || isMajor(s, c.id), prov: c.capital });
}

// ------------------------------------------------------------------ the monthly step
/** Share of world power in the Western camp (0..1), counting only countries that clearly lean one way. */
export function westShare(s: GameState): number {
  let w = 0, e = 0;
  for (const c of s.countries) {
    if (!c.alive) continue;
    const o = c.orient ?? 0, p = str(s, c.id);
    if (o > 0.3) w += p * o; else if (o < -0.3) e += p * -o;
  }
  return w + e > 0 ? w / (w + e) : 0.5;
}

/** Where a country's orientation is heading, and why (for the UI). */
export function orientTarget(s: GameState, c: Country, share = westShare(s)): { target: number; friends: number; bandwagon: number; gov: number; lean: number } {
  let sw = 0, so = 0;
  for (const x of s.countries) {
    if (!x.alive || x.id === c.id) continue;
    const r = getRelation(s, c.id, x.id);
    const t = getTreaty(s, c.id, x.id);
    let w = clamp((r - 25) / 75, 0, 1) + (t?.alliance ? 1.5 : 0) + (t?.trade ? 0.4 : 0) + (t?.coop ? 0.4 : 0);
    if (w <= 0) continue;
    w *= 0.5 + Math.min(1.5, str(s, x.id) / Math.max(1, str(s, c.id)) * 0.2); // powerful friends pull harder
    sw += w; so += w * (x.orient ?? 0);
  }
  const o = c.orient ?? 0;
  const friends = sw > 0 ? so / sw : o;
  // bandwagoning only when one camp is clearly collapsing or clearly dominant; otherwise countries hedge
  const bandwagon = (share < 0.4 ? (share - 0.4) * 1.5 : share > 0.8 ? (share - 0.8) * 1.5 : 0) * (1 - Math.abs(o));
  const gov = c.gov === 'D' ? 0.06 : c.gov === 'A' || c.gov === 'C' ? -0.05 : 0;
  // the non-aligned keep their options open: the pull of their friends is damped; so is it when your alliance's
  // protection no longer looks believable (its leading power has collapsed)
  const doubt = campDoubt(s, c);
  const hedge = (Math.abs(o) < 0.5 ? 0.6 : 0.85) * (doubt < 0.75 ? 0.4 + doubt * 0.6 : 1);
  // the leader's own preference pulls too: a pro-Western reformer, a pro-Russian populist, a pragmatist who keeps out
  const base = hedge * friends + bandwagon + gov;
  const lean = c.isPlayer || c.leader?.lean === undefined ? 0 : (c.leader.lean - base) * 0.25 * (0.6 + (c.leader.agenda?.ideology ?? 0.15) * 2);
  return { target: clamp(base + lean, -1, 1), friends, bandwagon, gov, lean };
}

export function stepAlignment(s: GameState, geo: Geo) {
  ensureAlignment(s);
  void geo;
  // orientation and hostility, a quarter of the world each week (each country monthly)
  const share = s.tick % 4 === 0 || !s.stats.westShare ? westShare(s) : s.stats.westShare;
  s.stats.westShare = share;
  // who is fighting a Western-leaning country right now (once per week, not per country)
  const fightsWest = new Set<number>();
  for (const w of s.wars) {
    const westA = w.attackers.some((x) => (s.countries[x].orient ?? 0) > 0.5), westD = w.defenders.some((x) => (s.countries[x].orient ?? 0) > 0.5);
    if (westD) for (const x of w.attackers) fightsWest.add(x);
    if (westA) for (const x of w.defenders) fightsWest.add(x);
  }
  // each country is reviewed once a quarter (a thirteenth of the world each week)
  for (const c of s.countries) {
    if (!c.alive || (s.tick + c.id) % 13 !== 0) continue;
    const o = c.orient ?? 0;
    const { target } = orientTarget(s, c, share);
    // a dead zone keeps settled countries where they are; outside it they move about 15% of the gap a year
    const gap = target - o;
    if (Math.abs(gap) > 0.25) c.orient = clamp(o + Math.sign(gap) * (Math.abs(gap) - 0.25) * 0.045, -1, 1);
    // the government's own preference moves the country too, most of all where it sits between the camps
    const L = c.leader, o2 = c.orient ?? 0;
    if (L?.turn) stepThaw(s, c);
    else if (!c.isPlayer && L?.lean !== undefined && Math.abs(L.lean - o2) > 0.15) c.orient = clamp(o2 + (L.lean - o2) * 0.035 * (0.5 + (L.agenda?.ideology ?? 0.15) * 2) * (1 - Math.abs(o2) * 0.5), -1, 1);
    // the West's view of a country: it forgives slowly if the country leans West and keeps the peace with it
    const h = c.hostile ?? 0;
    if (fightsWest.has(c.id) && (c.orient ?? 0) < 0.5) c.hostile = Math.min(1, h + 0.12);
    else if ((c.orient ?? 0) > 0.1 && h > 0) c.hostile = Math.max(0, h * 0.88 - 0.006);
  }
  if (s.tick % 4 === 3) { stepRegimes(s); updatePeaks(s); }
  if (s.tick % 13 === 7) stepOrgs(s);
  if (s.tick % 26 === 20) maybeFoundPact(s);
}

/** Unstable governments fall: revolutions, coups, emergency rule. The weaker the state, the likelier. Monthly. */
function stepRegimes(s: GameState) {
  if (s.settings.randomEvents === false) return;
  for (const c of s.countries) {
    if (!c.alive || c.isPlayer || c.eco.stability >= 32) continue;
    if (s.tick - (s.stats[`regime:${c.id}`] ?? -999) < 156) continue; // a new regime gets a few years
    const p = ((32 - c.eco.stability) / 32) * 0.012;
    if (nextRand(s) > p) continue;
    s.stats[`regime:${c.id}`] = s.tick;
    const free = c.gov === 'D' || c.gov === 'F';
    if (free) changeGov(s, c, 'A', nextRand(s) < 0.5 ? 'the army seizes power and suspends the constitution' : 'the president declares a state of emergency and rules by decree');
    else if (nextRand(s) < 0.5) changeGov(s, c, 'D', 'crowds topple the regime and free elections follow');
    else { logEvent(s, `🏛 ${c.name.toUpperCase()}: a coup replaces one strongman with another.`, 'danger', [c.id], false); c.orient = clamp((c.orient ?? 0) + (nextRand(s) - 0.5) * 0.4, -1, 1); }
    c.eco.stability = Math.max(c.eco.stability, 42);
  }
}

function stepOrgs(s: GameState) {
  for (const o of [...(s.orgs ?? [])]) {
    if (!s.orgs?.includes(o)) continue;
    o.members = o.members.filter((m) => s.countries[m]?.alive);
    // departures: a member that no longer belongs (the player decides for itself)
    for (const m of [...o.members]) {
      if (m === s.player || !s.orgs.includes(o)) continue;
      const others = o.members.filter((x) => x !== m);
      const atWar = others.find((x) => areAtWar(s, m, x));
      const r = avgRelation(s, m, others), om = orientOf(s, m);
      const cred = o.kind === 'defence' ? credibility(s, o) : 1;
      const why = atWar !== undefined ? `it is at war with ${nameOf(s, atWar)}, a fellow member` : o.camp !== 0 && om * o.camp < -0.35 ? 'it has drifted into the other camp' : r < (o.kind === 'economic' ? -20 : -5) ? 'relations with the other members have collapsed'
        : cred < 0.65 && r < 30 && nextRand(s) < (0.65 - cred) ? 'it no longer believes the alliance can protect it' : '';
      if (why && nextRand(s) < 0.35) leaveOrg(s, o, m, why);
    }
    if (!s.orgs.includes(o)) continue;
    if (o.members.length < 3) { dissolveOrg(s, o, 'too few members'); continue; }
    // applications: the best-placed outsider may apply (rarely); the members vote
    if (nextRand(s) > 0.15) continue;
    const need = o.kind === 'defence' ? 55 : o.kind === 'union' ? 60 : 40;
    const regions = new Map<string, number>();
    for (const m of o.members) regions.set(s.countries[m].region, (regions.get(s.countries[m].region) ?? 0) + 1);
    const cands = s.countries.filter((c) => c.alive && !c.isPlayer && !o.members.includes(c.id)
      && (o.camp === 0 || (c.orient ?? 0) * o.camp > 0.2)
      // unions and pacts are regional: most members, or at least a fifth, share the applicant's region
      && (regions.get(c.region) ?? 0) >= o.members.length * (o.kind === 'union' ? 0.5 : 0.2)
      && (o.kind !== 'economic' || orgsOf(s, c.id).filter((x) => x.kind === 'economic').length < 2)
      // nothing to gain from a club whose members it is already bound to more closely
      && !(o.kind !== 'defence' && orgsOf(s, c.id).some((x) => x !== o && x.kind !== 'defence' && o.members.filter((m) => x.members.includes(m)).length >= o.members.length / 2))
      // nobody joins a defence pact without a reason to: a hostile, dangerous neighbour or rival
      && (o.kind !== 'defence' || (threatened(s, c) && !isAtWar(s, c.id)))
      && !(o.kind === 'defence' && orgsOf(s, c.id).some((x) => x.kind === 'defence'))
      && !o.members.some((m) => areAtWar(s, c.id, m)))
      .map((c) => ({ c, r: avgRelation(s, c.id, o.members) })).filter((x) => x.r >= need).sort((a, b) => b.r - a.r);
    const pick = cands[0];
    if (pick && admitted(o, applicationVotes(s, o, pick.c.id))) joinOrg(s, o, pick.c.id, 'the members voted it in');
  }
  evolveOrgs(s);
}

/** Countries with a long tradition of military neutrality: they join a defence pact only if attacked. */
const NEUTRAL = new Set(ids(['Switzerland', 'Austria', 'Ireland', 'Malta', 'Liechtenstein', 'Costa Rica', 'Turkmenistan', 'Mongolia']));
/** Does a hostile power at least half its strength sit on its border? (the reason to seek an alliance) */
export function threatened(s: GameState, c: Country, geo = geoRefGet()): boolean {
  if (NEUTRAL.has(c.id) && !isAtWar(s, c.id)) return false;
  if (!geo) return false;
  const me = strength(c);
  return neighborsOf(s, geo, c.id).some((x) => getRelation(s, c.id, x) < -35 && strength(s.countries[x]) > me * 0.5);
}

/** Great powers outside any defence pact may build one with their friends, especially against a shared rival. */
function maybeFoundPact(s: GameState) {
  if ((s.orgs ?? []).length >= 12 || nextRand(s) > 0.25) return;
  const inDefence = (id: CountryId) => orgsOf(s, id).some((o) => o.kind === 'defence');
  const bigs = s.countries.filter((c) => c.alive && !c.isPlayer && !inDefence(c.id) && !isAtWar(s, c.id)).sort((a, b) => strength(b) - strength(a)).slice(0, 20);
  for (const F of bigs) {
    const friends = s.countries.filter((x) => x.alive && x.id !== F.id && !x.isPlayer && !inDefence(x.id) && !NEUTRAL.has(x.id) && getRelation(s, F.id, x.id) > 50 && strength(x) < strength(F) && x.eco.gdp > F.eco.gdp * 0.03)
      .sort((a, b) => getRelation(s, F.id, b.id) - getRelation(s, F.id, a.id)).slice(0, 4);
    if (friends.length < 2) continue;
    // a shared threat makes it a defence pact among neighbours in the same region; otherwise an economic forum
    const threat = s.countries.find((x) => x.alive && x.id !== F.id && getRelation(s, F.id, x.id) < -40 && friends.filter((f) => getRelation(s, f.id, x.id) < -20).length >= 2);
    const local = friends.filter((f) => f.region === F.region);
    const kind: Org['kind'] = threat && local.length >= 2 ? 'defence' : 'economic';
    if (kind === 'defence') { friends.length = 0; friends.push(...local); }
    // no second club with the same friends
    if (kind === 'economic' && (s.orgs ?? []).some((o) => o.members.includes(F.id) && o.kind === 'economic' && friends.filter((f) => o.members.includes(f.id)).length >= friends.length / 2)) continue;
    foundOrg(s, F.id, kind, friends.map((f) => f.id));
    return;
  }
}

// ------------------------------------------------------------------ player actions
export const REALIGN_PC = 20;
export type Lean = 'west' | 'east' | 'neutral';
/** Re-orient foreign policy: a speech, a state visit, a vote at the Assembly. Slow, costly at home, and it shows. */
export function actRealign(s: GameState, lean: Lean) {
  const c = s.countries[s.player];
  const P = c.politics;
  const key = 'realignAt';
  if (s.tick - (s.stats[key] ?? -999) < 52) return { ok: false, message: `Another change of course this soon would not be believed (again in ${52 - (s.tick - (s.stats[key] ?? 0))} weeks)` };
  if (P && P.pc < REALIGN_PC) return { ok: false, message: `A change of course needs ${REALIGN_PC} political capital` };
  const o = c.orient ?? 0;
  const to = lean === 'west' ? 1 : lean === 'east' ? -1 : 0;
  if (Math.abs(to - o) < 0.05) return { ok: false, message: 'That is already where you stand' };
  if (P) P.pc -= REALIGN_PC;
  s.stats[key] = s.tick;
  c.orient = clamp(o + Math.sign(to - o) * Math.min(0.15, Math.abs(to - o)), -1, 1);
  if (lean === 'west') c.hostile = Math.max(0, (c.hostile ?? 0) - 0.08);
  // turning away from your old camp has enemies at home: the generals and security services who built it
  if (Math.sign(to - o) !== Math.sign(initialOrient(c.id)) && initialOrient(c.id) !== 0 && !s.scheduled.some((x) => x.id === 'old_guard') && nextRand(s) < 0.45)
    s.scheduled.push({ tick: s.tick + 16 + Math.floor(nextRand(s) * 20), id: 'old_guard', data: { t: s.tick, dir: Math.sign(to - o) } });
  for (const x of s.countries) {
    if (!x.alive || x.id === c.id) continue;
    const xo = x.orient ?? 0;
    if (Math.abs(xo) < 0.3) continue;
    addRelation(s, c.id, x.id, lean === 'neutral' ? (Math.sign(xo) === Math.sign(o) ? -3 : 3) : Math.sign(xo) === Math.sign(to) ? 5 : -5);
  }
  return { ok: true, message: lean === 'west' ? 'You turn toward the West. Western capitals take note; your old friends do too.' : lean === 'east' ? 'You turn toward the East. Moscow and Beijing welcome it; the West is alarmed.' : 'You declare a non-aligned course: friends with all, allied with none.' };
}

export function actApplyOrg(s: GameState, orgId: number) {
  const o = s.orgs?.find((x) => x.id === orgId);
  if (!o) return { ok: false, message: 'No such organisation' };
  if (o.members.includes(s.player)) return { ok: false, message: 'Already a member' };
  const key = `orgApply:${o.id}`;
  if (s.tick - (s.stats[key] ?? -999) < 52) return { ok: false, message: `The members will not reconsider for ${52 - (s.tick - (s.stats[key] ?? 0))} weeks` };
  s.stats[key] = s.tick;
  const votes = applicationVotes(s, o, s.player);
  if (admitted(o, votes)) { joinOrg(s, o, s.player, 'its application was accepted'); return { ok: true, message: `Welcome to ${o.name}.` }; }
  const no = votes.filter((v) => !v.yes);
  for (const v of no) addRelation(s, s.player, v.m, -2);
  return { ok: false, message: `Rejected: ${no.slice(0, 3).map((v) => `${nameOf(s, v.m)} (${v.why})`).join(', ')}${no.length > 3 ? ` and ${no.length - 3} more` : ''} voted no.` };
}
export function actLeaveOrg(s: GameState, orgId: number) {
  const o = s.orgs?.find((x) => x.id === orgId);
  if (!o || !o.members.includes(s.player)) return { ok: false, message: 'Not a member' };
  leaveOrg(s, o, s.player, 'the government has decided to go its own way');
  s.countries[s.player].reputation = clamp(s.countries[s.player].reputation - (o.kind === 'defence' ? 5 : 2), 0, 100);
  return { ok: true, message: `You have left ${o.name}.` };
}
export const FOUND_PC = 15;
/** Who would join a new organisation of yours? */
export function foundingAnswers(s: GameState, kind: Org['kind'], invitees: CountryId[]) {
  return invitees.map((m) => {
    const r = getRelation(s, s.player, m), x = s.countries[m];
    if (!x?.alive) return { m, yes: false, why: 'gone' };
    if (areAtWar(s, s.player, m)) return { m, yes: false, why: 'at war with you' };
    if (kind === 'defence' && orgsOf(s, m).some((o) => o.kind === 'defence')) return { m, yes: false, why: `already in ${orgsOf(s, m).find((o) => o.kind === 'defence')!.name}` };
    if (Math.abs((x.orient ?? 0) - orientOf(s, s.player)) > 1.2) return { m, yes: false, why: 'the other camp' };
    const need = kind === 'defence' ? 45 : kind === 'union' ? 40 : 25;
    return r >= need ? { m, yes: true, why: `relations ${r.toFixed(0)}` } : { m, yes: false, why: `relations ${r.toFixed(0)} (needs ${need})` };
  });
}
export function actFoundOrg(s: GameState, kind: Org['kind'], invitees: CountryId[], name?: string) {
  const c = s.countries[s.player];
  if (c.politics && c.politics.pc < FOUND_PC) return { ok: false, message: `Founding an organisation needs ${FOUND_PC} political capital` };
  if (kind === 'defence' && orgsOf(s, s.player).some((o) => o.kind === 'defence')) return { ok: false, message: 'Leave your current defence pact first' };
  const yes = foundingAnswers(s, kind, invitees).filter((a) => a.yes).map((a) => a.m);
  if (yes.length < 2) return { ok: false, message: 'At least two countries must agree to join' };
  const clean = name ? cleanName(name) : null;
  if (name && !clean) return { ok: false, message: 'A name needs 3 to 40 characters' };
  if (clean && (s.orgs ?? []).some((x) => x.name.toLowerCase() === clean.toLowerCase())) return { ok: false, message: 'That name is already taken' };
  if (c.politics) c.politics.pc -= FOUND_PC;
  const o = foundOrg(s, s.player, kind, yes, clean ?? undefined);
  return { ok: true, message: `${o.name} is born, with ${yes.length} founding partners.` };
}

/** Does this world still look like 2024? (for the UI and tests) */
export function alignmentSummary(s: GameState) {
  const west = s.countries.filter((c) => c.alive && (c.orient ?? 0) > 0.3).length, east = s.countries.filter((c) => c.alive && (c.orient ?? 0) < -0.3).length;
  return { west, east, neutral: s.countries.filter((c) => c.alive).length - west - east, westShare: westShare(s), orgs: (s.orgs ?? []).map((o) => `${o.name} (${o.members.length})`) };
}
export { hostileOf };
