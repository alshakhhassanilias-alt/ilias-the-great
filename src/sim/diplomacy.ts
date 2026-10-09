/** Treaty proposals, sanctions and how other countries respond. */
import type { Geo } from './geo';
import {
  addRelation, alliesOf, areAtWar, ensureTreaty, touchTreaties, getRelation, getTreaty, isAtWar, sanctionLevel, setSanction, warsOf, enemiesOf,
} from './relations';
import { claimStrength, logEvent } from './war';
import { strength } from './military';
import { clamp } from './util';
import type { CountryId, GameState, OfferKind } from './types';

export type Proposal = 'trade' | 'nap' | 'alliance' | 'coop';
export interface Response { accept: boolean; score: number; needed: number; reasons: string[] }

export const PROPOSAL_LABEL: Record<Proposal, string> = {
  trade: 'Trade agreement', nap: 'Non-aggression pact', alliance: 'Defensive alliance', coop: 'Military cooperation',
};

export function neighborsOf(s: GameState, geo: Geo, c: CountryId): CountryId[] {
  const set = new Set<number>();
  for (const p of s.countries[c].provinces) for (const q of geo.adj[p]) { const o = s.owner[q]; if (o !== c) set.add(o); }
  return [...set].filter((x) => s.countries[x].alive);
}

/** Do `a` and `b` share a land border? */
export function areNeighbors(s: GameState, geo: Geo, a: CountryId, b: CountryId): boolean {
  for (const p of s.countries[a].provinces) for (const q of geo.adj[p]) if (s.owner[q] === b) return true;
  return false;
}

/** Enemies / rivals both countries dislike (a shared-threat measure used for alliances). */
function commonRivals(s: GameState, a: CountryId, b: CountryId): number {
  let n = 0;
  for (const x of s.countries) {
    if (!x.alive || x.id === a || x.id === b) continue;
    if (getRelation(s, a, x.id) < -35 && getRelation(s, b, x.id) < -35) n++;
  }
  return n;
}

export function evaluateProposal(s: GameState, geo: Geo, from: CountryId, to: CountryId, kind: Proposal): Response {
  const F = s.countries[from], T = s.countries[to];
  const reasons: string[] = [];
  if (areAtWar(s, from, to)) return { accept: false, score: -1, needed: 0, reasons: ['We are at war'] };
  const tr = getTreaty(s, from, to);
  if (tr?.[kind]) return { accept: false, score: 0, needed: 0, reasons: ['Already in force'] };
  if (sanctionLevel(s, from, to) > 0 || sanctionLevel(s, to, from) > 0) return { accept: false, score: -1, needed: 0, reasons: ['Sanctions are in place'] };
  const rel = getRelation(s, to, from);
  let score = rel / 100;
  reasons.push(`Relations ${rel >= 0 ? '+' : ''}${rel.toFixed(0)}`);
  let needed = 0.15;
  const ratio = strength(F) / Math.max(1, strength(T));
  const neighbors = areNeighbors(s, geo, from, to);
  switch (kind) {
    case 'trade': {
      score += 0.25 * T.ai.trade + 0.3 * clamp(F.eco.gdp / T.eco.gdp, 0, 1) * 0.5;
      if (T.ai.ideology > 0.6 && T.gov !== F.gov && (T.gov === 'A' || F.gov === 'A')) { score -= 0.1; reasons.push('Ideological distance'); }
      needed = 0.12;
      break;
    }
    case 'nap': {
      score += 0.3 * T.ai.caution - 0.45 * T.ai.aggression * s.settings.aggression;
      if (ratio > 1.5 && neighbors) { score += 0.2; reasons.push('Wants security from a stronger neighbour'); }
      if (claimStrength(to, from) > 0.3) { score -= 0.6; reasons.push('Has territorial claims on you'); }
      needed = 0.1;
      break;
    }
    case 'alliance': {
      const shared = commonRivals(s, from, to);
      score += 0.12 * shared + (ratio > 1 ? 0.1 : -0.1) + (F.reputation - 50) / 250 - 0.2 * T.ai.caution;
      if (shared) reasons.push(`${shared} shared rival(s)`);
      if (rel < 25) { score -= 0.3; reasons.push('Not yet trusted enough'); }
      needed = 0.5;
      break;
    }
    case 'coop': {
      const hasAll = tr?.alliance;
      score += (hasAll ? 0.25 : 0) + 0.1 * commonRivals(s, from, to) + (F.mil.milTech > T.mil.milTech ? 0.1 : 0);
      if (rel < 15) { score -= 0.2; }
      needed = 0.35;
      break;
    }
  }
  if (isAtWar(s, to) && kind === 'alliance') { score -= 0.15; reasons.push('Preoccupied with war'); }
  return { accept: score >= needed, score, needed, reasons };
}

export function applyTreaty(s: GameState, a: CountryId, b: CountryId, kind: Proposal) {
  const t = ensureTreaty(s, a, b);
  t[kind] = true;
  addRelation(s, a, b, kind === 'alliance' ? 12 : 6);
  logEvent(s, `${s.countries[a].name} and ${s.countries[b].name} signed a ${PROPOSAL_LABEL[kind].toLowerCase()}.`, 'diplo', [a, b], a === s.player || b === s.player);
}

/** Propose a treaty. AI recipients answer immediately. */
export function propose(s: GameState, geo: Geo, from: CountryId, to: CountryId, kind: Proposal): Response {
  if (to === s.player) {
    // delivered as an offer to the player (AI → player)
    const key = `${from}:${kind}`;
    const last = s.offerLog[key];
    if (!s.offers.some((o) => o.from === from && o.kind === kind) && (last === undefined || s.tick - last > 104)) {
      s.offers.push({ id: s.nextOfferId++, from, kind: kind as OfferKind, tick: s.tick });
      s.offerLog[key] = s.tick;
    }
    return { accept: false, score: 0, needed: 0, reasons: ['Offer sent'] };
  }
  const r = evaluateProposal(s, geo, from, to, kind);
  if (r.accept) applyTreaty(s, from, to, kind);
  else addRelation(s, from, to, -1);
  return r;
}

export function cancelTreaty(s: GameState, a: CountryId, b: CountryId, kind: Proposal) {
  const t = getTreaty(s, a, b);
  if (!t || !t[kind]) return;
  t[kind] = false;
  touchTreaties(s);
  addRelation(s, a, b, kind === 'alliance' ? -20 : -10);
  const A = s.countries[a];
  A.reputation = clamp(A.reputation - (kind === 'nap' || kind === 'alliance' ? 4 : 1), 0, 100);
  logEvent(s, `${A.name} cancelled its ${PROPOSAL_LABEL[kind].toLowerCase()} with ${s.countries[b].name}.`, 'diplo', [a, b], a === s.player || b === s.player);
}

export function imposeSanction(s: GameState, from: CountryId, to: CountryId, level: 1 | 2) {
  if (sanctionLevel(s, from, to) >= level) return;
  setSanction(s, from, to, level);
  const t = getTreaty(s, from, to);
  if (t) t.trade = false;
  addRelation(s, from, to, level === 2 ? -25 : -12);
  logEvent(s, `${s.countries[from].name} ${level === 2 ? 'imposed a full embargo on' : 'imposed sanctions on'} ${s.countries[to].name}.`, 'diplo', [from, to], from === s.player || to === s.player);
}
export function liftSanction(s: GameState, from: CountryId, to: CountryId) {
  if (sanctionLevel(s, from, to) === 0) return;
  setSanction(s, from, to, 0);
  addRelation(s, from, to, 8);
  logEvent(s, `${s.countries[from].name} lifted its sanctions on ${s.countries[to].name}.`, 'diplo', [from, to], from === s.player || to === s.player);
}

export function acceptOffer(s: GameState, geo: Geo, offerId: number, makePeaceFn: (a: number, b: number, terms: { kind: string; share?: number }) => void) {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o) return false;
  s.offers = s.offers.filter((x) => x.id !== offerId);
  if (o.kind === 'peace') makePeaceFn(o.from, s.player, o.terms ?? { kind: 'status_quo' });
  else if (s.countries[o.from].alive && !areAtWar(s, o.from, s.player)) applyTreaty(s, o.from, s.player, o.kind as Proposal);
  void geo;
  return true;
}
export function declineOffer(s: GameState, offerId: number) {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o) return;
  s.offers = s.offers.filter((x) => x.id !== offerId);
  if (o.kind !== 'peace') addRelation(s, o.from, s.player, -1);
}
export { alliesOf, warsOf, enemiesOf };
