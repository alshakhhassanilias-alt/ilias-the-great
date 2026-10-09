/**
 * World politics: how deals ripple through the international system.
 *  - every treaty triggers reactions from third countries (friends of the partner welcome it, its rivals condemn it)
 *  - alliances form blocs; rivals respond with counter-alliances
 *  - the World Assembly votes on resolutions (condemn, sanction, ceasefire, aid) with real consequences
 *  - global tension rises with wars and standoffs between blocs
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp } from './util';
import { logEvent } from './log';
import {
  addRelation, alliesOf, areAtWar, getRelation, isAtWar, sanctionLevel, warBetween, warsOf, areAtWar as atWar, touchTreaties,
} from './relations';
import { applyTreaty, evaluateProposal, imposeSanction } from './diplomacy';
import { makePeace } from './war';
import { strength } from './military';
import type { CountryId, GameState, Reaction, Resolution } from './types';

export interface Bloc { id: number; name: string; members: CountryId[]; gdp: number; strength: number; leader: CountryId }

// ------------------------------------------------------------------ blocs
let blocCache: { tick: number; n: number; blocs: Bloc[]; map: Map<number, number> } | null = null;
export function computeBlocs(s: GameState): { blocs: Bloc[]; of: Map<number, number> } {
  const n = Object.keys(s.treaties).length;
  if (blocCache && blocCache.tick === s.tick && blocCache.n === n) return { blocs: blocCache.blocs, of: blocCache.map };
  const adj = new Map<number, number[]>();
  for (const [k, t] of Object.entries(s.treaties)) {
    if (!t.alliance) continue;
    const [a, b] = k.split('-').map(Number);
    if (!s.countries[a]?.alive || !s.countries[b]?.alive) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  const blocs: Bloc[] = [];
  const of = new Map<number, number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const members: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const x = stack.pop()!;
      members.push(x);
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    if (members.length < 3) continue;
    members.sort((a, b) => s.countries[b].eco.gdp - s.countries[a].eco.gdp);
    const leader = members[0];
    const names = members.map((m) => s.countries[m].name);
    let name = `${s.countries[leader].name} Pact`;
    if (names.includes('United States of America') && members.length >= 8) name = 'NATO';
    else if (names.includes('Russia') && names.includes('Belarus')) name = 'CSTO';
    else if (names.includes('China') && members.length >= 3) name = 'Sino Bloc';
    const id = blocs.length;
    blocs.push({ id, name, members, leader, gdp: members.reduce((t, m) => t + s.countries[m].eco.gdp, 0), strength: members.reduce((t, m) => t + strength(s.countries[m]), 0) });
    for (const m of members) of.set(m, id);
  }
  blocs.sort((a, b) => b.gdp - a.gdp);
  const map = new Map<number, number>();
  blocs.forEach((b, i) => { b.id = i; for (const m of b.members) map.set(m, i); });
  blocCache = { tick: s.tick, n, blocs, map };
  return { blocs, of: map };
}

export function tensionIndex(s: GameState): number {
  const top = [...s.countries].filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 25);
  let hostile = 0;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) if (getRelation(s, top[i].id, top[j].id) < -45) hostile++;
  return Math.round(clamp(s.wars.length * 7 + hostile * 2.2, 0, 100));
}

// ------------------------------------------------------------------ ripples
const KIND_NAME: Record<string, string> = { trade: 'trade agreement', nap: 'non-aggression pact', alliance: 'alliance', coop: 'military cooperation', guarantee: 'security guarantee', sanction: 'sanctions', embargo: 'embargo' };

/** Third countries react to a deal between a and b. Returns the reactions (largest first). */
export function rippleTreaty(s: GameState, a: CountryId, b: CountryId, kind: string, apply = true): Reaction[] {
  const A = s.countries[a], B = s.countries[b];
  const out: Reaction[] = [];
  const military = kind === 'alliance' || kind === 'coop' || kind === 'guarantee';
  const weight = military ? 1 : kind === 'trade' ? 0.45 : kind === 'nap' ? 0.2 : 0.8;
  for (const z of s.countries) {
    if (!z.alive || z.id === a || z.id === b) continue;
    const zb = getRelation(s, z.id, b), za = getRelation(s, z.id, a);
    let d = 0, why = '';
    // rivals of one partner dislike the other for dealing with their enemy
    if (zb < -30) { d -= clamp((-zb - 20) / 6, 2, 14) * weight; why = `${B.name} is its rival`; }
    if (za < -30) { d -= clamp((-za - 20) / 6, 2, 14) * weight * 0.8; why = why || `${A.name} is its rival`; }
    // friends of a partner welcome it
    if (zb > 35 && za > -10) { d += clamp((zb - 25) / 14, 1, 5) * weight; why = `friend of ${B.name}`; }
    if (za > 35 && zb > -10) { d += clamp((za - 25) / 14, 1, 5) * weight; why = why || `friend of ${A.name}`; }
    // sanctions busting and dealing with a country we are fighting
    if (kind === 'trade' || military) {
      if (sanctionLevel(s, z.id, b) > 0) { d -= 7; why = `undermines its sanctions on ${B.name}`; }
      if (sanctionLevel(s, z.id, a) > 0) { d -= 7; why = `undermines its sanctions on ${A.name}`; }
      if (areAtWar(s, z.id, b)) { d -= military ? 14 : 9; why = `it is at war with ${B.name}`; }
      if (areAtWar(s, z.id, a)) { d -= military ? 14 : 9; why = `it is at war with ${A.name}`; }
    }
    // a military bloc next door worries neighbours that are not part of it
    if (military && (kind === 'alliance') && z.ai.caution > 0.55 && zb < 10 && za < 10) { d -= 2; why = why || 'worried by a new military bloc'; }
    if (Math.abs(d) < 1.5) continue;
    d = Math.round(d * 10) / 10;
    // blocs and allies of z are touched too, in a smaller way (they follow their leader)
    if (apply) { addRelation(s, z.id, a, d); addRelation(s, z.id, b, d * 0.35); }
    const verb = d < -9 ? 'condemns' : d < 0 ? 'is wary of' : d >= 4 ? 'welcomes' : 'notes';
    out.push({ id: z.id, delta: d, text: `${z.name} ${verb} the ${KIND_NAME[kind] ?? kind} (${why})` });
  }
  out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  // real consequences: strongly offended countries that have deals with the actors may downgrade them
  if (apply && (military || kind === 'trade')) {
    for (const r of out) {
      if (r.delta > -8) break;
      const Z = s.countries[r.id];
      if (Z.ai.ideology < 0.35 || r.id === s.player) continue;
      for (const other of [a, b]) {
        const t = s.treaties[r.id < other ? `${r.id}-${other}` : `${other}-${r.id}`];
        if (!t || nextRand(s) > 0.4) continue;
        const dropped = t.trade ? 'trade agreement' : t.coop ? 'military cooperation' : null;
        if (!dropped) continue;
        if (t.trade) t.trade = false; else t.coop = false;
        touchTreaties(s);
        logEvent(s, `${Z.name} cancels its ${dropped} with ${s.countries[other].name} in protest at the ${KIND_NAME[kind] ?? kind}.`, 'diplo', [r.id, other], other === s.player);
        break;
      }
    }
  }
  return out;
}

/** Reactions to sanctions: friends of the target resent the imposer, its rivals approve. */
export function rippleSanction(s: GameState, from: CountryId, to: CountryId, level: number): Reaction[] {
  const out: Reaction[] = [];
  for (const z of s.countries) {
    if (!z.alive || z.id === from || z.id === to) continue;
    const zt = getRelation(s, z.id, to), zf = getRelation(s, z.id, from);
    let d = 0;
    if (zt > 35 && zf < 60) d -= clamp((zt - 25) / 12, 1, 6) * (level === 2 ? 1.4 : 1);
    if (zt < -30 && zf > -20) d += clamp((-zt - 20) / 14, 1, 4);
    if (Math.abs(d) < 1.5) continue;
    d = Math.round(d * 10) / 10;
    addRelation(s, z.id, from, d);
    out.push({ id: z.id, delta: d, text: `${z.name} ${d < 0 ? 'protests' : 'applauds'} the ${level === 2 ? 'embargo' : 'sanctions'} on ${s.countries[to].name}` });
  }
  out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return out;
}

export function recordRipple(s: GameState, a: CountryId, b: CountryId, kind: string, reactions: Reaction[]) {
  const neg = reactions.filter((r) => r.delta < 0), pos = reactions.filter((r) => r.delta > 0);
  const nm = (r: Reaction) => s.countries[r.id].name;
  const parts: string[] = [];
  if (neg.length) parts.push(`${neg.slice(0, 2).map(nm).join(' and ')}${neg.length > 2 ? ` +${neg.length - 2}` : ''} objected`);
  if (pos.length) parts.push(`${pos.slice(0, 2).map(nm).join(' and ')}${pos.length > 2 ? ` +${pos.length - 2}` : ''} approved`);
  const summary = parts.join('; ') || 'The world barely noticed';
  s.lastRipple = { tick: s.tick, a, b, kind, reactions: reactions.slice(0, 8), summary };
  const involvesPlayer = a === s.player || b === s.player;
  if (involvesPlayer || reactions.length > 5) logEvent(s, `${s.countries[a].name}–${s.countries[b].name} ${KIND_NAME[kind] ?? kind}: ${summary}.`, 'diplo', [a, b], involvesPlayer);
}

// ------------------------------------------------------------------ counter-blocs
export function stepPolitics(s: GameState, geo: Geo) {
  if (s.tick % 6 !== 0) return;
  const { blocs } = computeBlocs(s);
  for (const bloc of blocs.slice(0, 4)) {
    if (nextRand(s) > 0.3) continue;
    const hostile = s.countries.filter((z) => z.alive && !bloc.members.includes(z.id) && z.id !== s.player && z.eco.gdp > bloc.gdp * 0.01 &&
      bloc.members.reduce((t, m) => t + getRelation(s, z.id, m), 0) / bloc.members.length < -22);
    if (!hostile.length) continue;
    hostile.sort((x, y) => y.eco.gdp - x.eco.gdp);
    const z = hostile[0];
    const q = s.countries.find((c) => c.alive && c.id !== z.id && !bloc.members.includes(c.id) && c.id !== s.player && getRelation(s, z.id, c.id) > 18 && !s.treaties[z.id < c.id ? `${z.id}-${c.id}` : `${c.id}-${z.id}`]?.alliance &&
      bloc.members.reduce((t, m) => t + getRelation(s, c.id, m), 0) / bloc.members.length < 5);
    if (!q) continue;
    const ev = evaluateProposal(s, geo, z.id, q.id, 'alliance');
    if (ev.accept || ev.score > ev.needed - 0.2) {
      applyTreaty(s, z.id, q.id, 'alliance', true);
      logEvent(s, `Counter-bloc: ${z.name} and ${q.name} sign a defence pact in response to the ${bloc.name}.`, 'diplo', [z.id, q.id], true);
    }
  }
}

// ------------------------------------------------------------------ world assembly
export const RES_LABEL: Record<Resolution['kind'], string> = { condemn: 'Condemn', sanction: 'Impose sanctions on', ceasefire: 'Demand a ceasefire in', aid: 'Send emergency aid to' };

export function voteOf(s: GameState, z: CountryId, r: Resolution): 'yes' | 'no' | 'abstain' {
  const Z = s.countries[z];
  const rt = getRelation(s, z, r.target);
  const rv = r.victim >= 0 ? getRelation(s, z, r.victim) : 0;
  switch (r.kind) {
    case 'condemn': return rt < 5 || rv > 30 ? 'yes' : rt > 40 || alliesOf(s, z).includes(r.target) ? 'no' : 'abstain';
    case 'sanction': return rt < -15 && Z.ai.ideology > 0.3 ? 'yes' : rt > 25 ? 'no' : 'abstain';
    case 'ceasefire': return Z.ai.caution > 0.4 && rt > -25 ? 'yes' : rt > 45 ? 'no' : 'abstain';
    case 'aid': return rt > -30 && Z.eco.gdp / Z.eco.pop > 4000 ? 'yes' : rt < -50 ? 'no' : 'abstain';
  }
}
export function tally(s: GameState, r: Resolution, playerVote?: 'yes' | 'no' | 'abstain', bonusYes = 0) {
  let yes = bonusYes, no = 0, abstain = 0;
  for (const z of s.countries) {
    if (!z.alive || z.id === r.target) continue;
    const v = z.id === s.player ? (playerVote ?? voteOf(s, z.id, r)) : voteOf(s, z.id, r);
    if (v === 'yes') yes++; else if (v === 'no') no++; else abstain++;
  }
  return { yes, no, abstain };
}

export function finalizeResolution(s: GameState, geo: Geo, r: Resolution, playerVote?: 'yes' | 'no' | 'abstain', bonusYes = 0): boolean {
  const t = tally(s, r, playerVote, bonusYes);
  r.yes = t.yes; r.no = t.no;
  r.passed = t.yes > t.no && t.yes >= (t.yes + t.no + t.abstain) * 0.3;
  const T = s.countries[r.target];
  const victim = r.victim >= 0 ? s.countries[r.victim] : null;
  const tag = `The World Assembly ${r.passed ? 'adopted' : 'rejected'} a resolution to ${RES_LABEL[r.kind].toLowerCase()} ${T.name} (${t.yes}–${t.no}).`;
  logEvent(s, tag, 'diplo', [r.target], true);
  if (r.passed) {
    const yesVoters = s.countries.filter((z) => z.alive && z.id !== r.target && (z.id === s.player ? (playerVote ?? voteOf(s, z.id, r)) : voteOf(s, z.id, r)) === 'yes');
    switch (r.kind) {
      case 'condemn':
        for (const z of yesVoters) addRelation(s, z.id, r.target, -6);
        T.reputation = clamp(T.reputation - 8, 0, 100); T.eco.stability = Math.max(0, T.eco.stability - 2);
        break;
      case 'sanction':
        yesVoters.sort((x, y) => y.eco.gdp - x.eco.gdp).slice(0, 10).forEach((z) => { if (z.id !== s.player) imposeSanction(s, z.id, r.target, 1); });
        break;
      case 'ceasefire': {
        for (const w of warsOf(s, r.target)) for (const c of [...w.attackers, ...w.defenders]) s.countries[c].mil.exhaustion = Math.min(1, s.countries[c].mil.exhaustion + 0.06);
        if (victim && warBetween(s, r.target, victim.id) && T.mil.exhaustion > 0.35 && victim.mil.exhaustion > 0.35 && r.target !== s.player && victim.id !== s.player) makePeace(s, geo, r.target, victim.id, { kind: 'status_quo' });
        break;
      }
      case 'aid':
        for (const z of yesVoters.sort((x, y) => y.eco.gdp - x.eco.gdp).slice(0, 8)) { T.eco.cash += 0.002 * z.eco.gdp; addRelation(s, z.id, r.target, 5); }
        T.eco.stability = Math.min(100, T.eco.stability + 3);
        break;
    }
  }
  return !!r.passed;
}

/** Create a new resolution about the most pressing situation, or null. */
export function proposeResolution(s: GameState): Resolution | null {
  const mk = (kind: Resolution['kind'], target: number, victim: number): Resolution => ({ id: s.nextResolution++, kind, target, victim, tick: s.tick, yes: 0, no: 0, passed: null });
  // aggression: the lowest-reputation attacker in an active war
  const wars = [...s.wars].filter((w) => w.attackers.length && w.defenders.length);
  if (wars.length) {
    const w = wars[Math.floor(nextRand(s) * wars.length)];
    const att = w.attackers[0], def = w.defenders[0];
    const kind = nextRand(s) < 0.45 ? 'condemn' : nextRand(s) < 0.5 ? 'ceasefire' : 'sanction';
    if (s.countries[att].alive && s.countries[def].alive) return mk(kind, kind === 'ceasefire' ? att : att, def);
  }
  const hungry = s.countries.filter((c) => c.alive && c.eco.foodUnmet > 0.08).sort((a, b) => b.eco.foodUnmet - a.eco.foodUnmet)[0];
  if (hungry) return mk('aid', hungry.id, -1);
  const rogue = s.countries.filter((c) => c.alive && c.reputation < 40 && c.eco.gdp > 1e11).sort((a, b) => a.reputation - b.reputation)[0];
  if (rogue) return mk('sanction', rogue.id, -1);
  return null;
}
void atWar; void isAtWar;

/** What would the world think? (no changes are made) */
export const previewReactions = (s: GameState, a: CountryId, b: CountryId, kind: string) => rippleTreaty(s, a, b, kind, false);
