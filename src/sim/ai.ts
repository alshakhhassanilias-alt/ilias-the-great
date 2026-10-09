/**
 * AI countries. Each country has a personality (aggression, expansion, trade, ideology, caution) and
 * every few ticks evaluates its economy, threats, opportunities and relations *as data* — nothing is
 * scripted against the player. Decisions: fiscal & military posture, treaty proposals, sanctions,
 * war declaration (power ratio incl. logistics/terrain/allies/deterrence + desire), and peace.
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp } from './util';
import {
  alliesOf, areAtWar, enemiesOf, getRelation, hasAlliance, hasNap, hasTrade, isAtWar, partnersOf, sanctionLevel, warBetween, warsOf,
} from './relations';
import { manpower, strength } from './military';
import {
  areNeighbors, evaluateProposal, imposeSanction, liftSanction, neighborsOf, propose, applyTreaty, type Proposal,
} from './diplomacy';
import { claimStrength, declareWar, evaluatePeace, makePeace, warScore, type PeaceTerms, isCoastalCountry } from './war';
import { buildProject, demobilize, recruit } from './actions';
import { taxBurden } from './economy';
import type { Country, GameState } from './types';

const rand = (s: GameState) => nextRand(s);

function threatLevel(s: GameState, geo: Geo, c: Country): number {
  const mine = strength(c) + 0.5 * alliesOf(s, c.id).reduce((t, a) => t + strength(s.countries[a]), 0) + 1;
  let th = 0;
  const near = neighborsOf(s, geo, c.id);
  for (const o of near) {
    const rel = getRelation(s, c.id, o);
    if (rel < 10) th += Math.max(0.02, (10 - rel) / 100) * (strength(s.countries[o]) / mine);
  }
  for (const e of enemiesOf(s, c.id)) th += 0.5 * strength(s.countries[e]) / mine;
  return clamp(th, 0, 1.5);
}

function manageEconomy(s: GameState, geo: Geo, c: Country) {
  const e = c.eco, b = c.budget;
  const atWar = isAtWar(s, c.id);
  const rev = e.revenue / e.gdp;
  const spend = e.spending / e.gdp;
  const deficit = spend - rev;
  const debtRatio = e.debt / e.gdp;
  const target = debtRatio < 0.6 ? 0.03 : debtRatio < 1 ? 0.015 : debtRatio < 1.5 ? 0 : -0.01;
  const th = threatLevel(s, geo, c);
  const desiredMil = clamp((e.prev.mil0 ?? b.military) * (1 + 0.4 * Math.min(1, th)) * (0.92 + 0.16 * s.settings.aggression * c.ai.aggression) * (atWar ? 1.6 : 1), 0, 0.2);
  const step = 0.001;
  if (b.military < desiredMil - step) b.military = Math.min(desiredMil, b.military + step * (atWar ? 3 : 1));
  else if (b.military > desiredMil + step && !atWar) b.military = Math.max(desiredMil, b.military - step);

  if (deficit > target + 0.01) {
    if (!atWar && th < 0.3 && b.military > (e.prev.mil0 ?? 0) * 0.7) b.military -= 0.001;
    else if (e.stability > 45 && b.taxVat < 0.25) b.taxVat += 0.005;
    else if (e.stability > 50 && b.taxIncome < 0.45) b.taxIncome += 0.005;
    else if (b.social > e.baseSocial * 0.8) b.social -= 0.002;
  } else if (deficit < target - 0.015) {
    if (taxBurden(b) * e.collection > e.baseTaxRevenue && e.unemployment > e.uNat + 0.01) { b.taxVat = Math.max(0.05, b.taxVat - 0.004); b.taxCorporate = Math.max(0.1, b.taxCorporate - 0.004); }
    else if (b.social < e.baseSocial) b.social += 0.002;
    else if (b.infra < 0.045 && e.infra < 70) b.infra += 0.001;
    else if (b.education < 0.06) b.education += 0.001;
    else if (b.industry < 0.025) b.industry += 0.001;
  }
  if (e.energyUnmet > 0.04 && b.industry < 0.03) b.industry += 0.002;
  if (e.stability < 40 && b.social < e.baseSocial * 1.15) b.social += 0.003;
  // spend surplus cash
  if (e.cash > 0.06 * e.gdp) {
    if (e.avgRate > 0.04 && debtRatio > 0.5) { const amt = Math.min(e.cash - 0.03 * e.gdp, e.debt); e.debt -= amt; e.cash -= amt; }
    else if (e.energyUnmet > 0.02) buildProject(s, c.id, 'energy', 0.01);
    else if (e.foodUnmet > 0.02) buildProject(s, c.id, 'farms', 0.01);
    else if (e.infra < 60) buildProject(s, c.id, 'infra', 0.005);
    else buildProject(s, c.id, 'industry', 0.01);
  }
  // military manpower
  const base = e.prev.troops0 ?? c.mil.troops;
  const desiredTroops = Math.min(base * (1 + 0.5 * Math.min(1, th)) * (atWar ? 1.8 : 1), Math.max(base, e.laborForce * (atWar ? 0.12 : 0.05)));
  if (c.mil.troops < desiredTroops * 0.9 && manpower(c) > 0 && e.stability > 25) recruit(s, c.id, Math.max(50, c.mil.troops * 0.03));
  else if (!atWar && c.mil.troops > desiredTroops * 1.25) demobilize(s, c.id, c.mil.troops * 0.02);
  // manage offensive stance
  c.mil.commit = atWar ? 0.65 : 0.4;
}

function manageDiplomacy(s: GameState, geo: Geo, c: Country) {
  const near = neighborsOf(s, geo, c.id);
  const pool = new Set<number>(near);
  // add a few random significant partners
  for (let i = 0; i < 4; i++) {
    const o = Math.floor(rand(s) * s.countries.length);
    if (o !== c.id && s.countries[o].alive) pool.add(o);
  }
  const picks = [...pool].sort(() => rand(s) - 0.5).slice(0, 4);
  for (const o of picks) {
    const O = s.countries[o];
    if (!O.alive || areAtWar(s, c.id, o)) continue;
    const rel = getRelation(s, c.id, o);
    const send = (kind: Proposal, p: number) => {
      if (rand(s) > p) return;
      const ev = evaluateProposal(s, geo, c.id, o, kind);
      if (!ev.accept && o !== s.player) return;
      if (o === s.player) { if (s.offers.length < 8 && ev.score > ev.needed - 0.05) propose(s, geo, c.id, o, kind); }
      else applyTreaty(s, c.id, o, kind);
    };
    if (!hasTrade(s, c.id, o) && rel > 5 && sanctionLevel(s, c.id, o) === 0 && sanctionLevel(s, o, c.id) === 0) send('trade', 0.35 * c.ai.trade);
    if (!hasAlliance(s, c.id, o) && rel > 35 && hasTrade(s, c.id, o)) send('alliance', 0.1);
    if (hasAlliance(s, c.id, o) && rel > 40) send('coop', 0.1);
    if (!hasNap(s, c.id, o) && !hasAlliance(s, c.id, o) && near.includes(o) && rel > -30 && rel < 30) send('nap', 0.1 + 0.2 * c.ai.caution);
    // sanctions: against those we dislike, especially aggressors against our friends
    const o_wars = warsOf(s, o);
    let aggressorOfFriend = false;
    for (const w of o_wars) {
      if (w.attackers.includes(o)) for (const v of w.defenders) if (getRelation(s, c.id, v) > 30) aggressorOfFriend = true;
    }
    if (sanctionLevel(s, c.id, o) === 0 && o !== s.player || (o === s.player && sanctionLevel(s, c.id, o) === 0)) {
      const dislike = rel < -50 || (aggressorOfFriend && rel < 15);
      const cost = O.eco.gdp / Math.max(c.eco.gdp, 1) * c.eco.openness;
      if (dislike && c.ai.ideology > 0.35 && cost < 0.5 && rand(s) < 0.12 * (aggressorOfFriend ? 2 : 1)) imposeSanction(s, c.id, o, aggressorOfFriend && rel < -30 ? 2 : 1);
    } else if (sanctionLevel(s, c.id, o) > 0 && rel > 5 && rand(s) < 0.08) liftSanction(s, c.id, o);
  }
}

function considerWar(s: GameState, geo: Geo, c: Country) {
  const cap = 1 + Math.floor(c.ai.aggression * 2);
  if (warsOf(s, c.id).length >= cap) return;
  if (s.tick - c.lastWarDecl < 104) return;
  if (c.eco.stability < 35 || c.mil.exhaustion > 0.25 || c.mil.troops < 500) return;
  const near = neighborsOf(s, geo, c.id);
  const targets = new Set<number>(near);
  if (isCoastalCountry(s, geo, c) && strength(c) > 3e5) for (const o of s.countries) if (o.alive && claimStrength(c.id, o.id) > 0.3) targets.add(o.id);
  const mine = strength(c) * (0.6 + 0.4 * c.mil.readiness);
  let best: { t: number; desire: number } | null = null;
  for (const t of targets) {
    const T = s.countries[t];
    if (!T.alive || areAtWar(s, c.id, t) || hasAlliance(s, c.id, t)) continue;
    const rel = getRelation(s, c.id, t);
    const dist = geo.dist(c.capital, T.capital);
    const supply = clamp(1.1 - Math.pow(dist / (55 * (0.6 + 0.8 * (0.5 * c.eco.infra / 100 + 0.5 * c.eco.tech / 100))), 1.3) * 0.55, 0.35, 1);
    let defense = strength(T) * 1.3 * (0.6 + 0.4 * T.mil.readiness);
    const tAllies = alliesOf(s, t);
    if (s.settings.defensiveAlliances) defense += 0.6 * tAllies.filter((a) => a !== c.id).reduce((x, a) => x + strength(s.countries[a]), 0);
    if (T.mil.nuclear && !c.mil.nuclear) defense *= 4;
    const ratio = (mine * supply) / Math.max(1, defense);
    const need = 1.5 - 0.5 * Math.min(1, c.ai.aggression);
    if (ratio < need) continue;
    const claim = claimStrength(c.id, t);
    let desire = c.ai.aggression * 0.6 * s.settings.aggression + c.ai.expansion * 0.3 + claim * 0.5 + Math.max(0, -rel / 100) * 0.5
      + Math.min(0.2, (T.eco.gdp / Math.max(c.eco.gdp, 1)) * 0.1) + Math.min(0.2, (ratio - need) * 0.05)
      - c.ai.caution * 0.35 - (hasNap(s, c.id, t) ? 0.3 : 0) - (hasTrade(s, c.id, t) ? 0.12 : 0) - (c.eco.debt / c.eco.gdp > 2 ? 0.15 : 0);
    if (t === s.player) desire *= s.settings.difficulty === 'hard' ? 1.25 : s.settings.difficulty === 'easy' ? 0.7 : 1;
    if (desire > 0.62 && (!best || desire > best.desire)) best = { t, desire };
  }
  if (best && rand(s) < 0.045 * Math.min(1.6, best.desire / 0.62)) declareWar(s, geo, c.id, best.t);
}

function managePeace(s: GameState, geo: Geo, c: Country) {
  for (const e of enemiesOf(s, c.id)) {
    const w = warBetween(s, c.id, e);
    if (!w) continue;
    const E = s.countries[e];
    const score = warScore(s, w, c.id);
    const years = (s.tick - w.start) / 52;
    // decide proposed terms
    let terms: PeaceTerms | null = null;
    const myWill = evaluatePeace(s, geo, e, c.id, { kind: 'status_quo' }).willingness; // how much *I* want peace
    if (c.mil.exhaustion > 0.95 || c.provinces.length === 1 && !c.provinces.includes(c.capital)) terms = { kind: 'concede', share: 0.3 };
    else if (score > 0.35 && years > 0.3) terms = { kind: 'demand', share: clamp(score * 0.5, 0.05, 0.6) };
    else if (myWill > 0.45) terms = { kind: 'status_quo' };
    if (!terms) continue;
    if (e === s.player) {
      if (!s.offers.some((o) => o.from === c.id && o.kind === 'peace') && s.tick % 12 === 0) s.offers.push({ id: s.nextOfferId++, from: c.id, kind: 'peace', terms, tick: s.tick });
      continue;
    }
    // proposing party is c; recipient e evaluates (swap perspective for evaluatePeace)
    const ev = evaluatePeace(s, geo, c.id, e, terms);
    if (terms.kind === 'concede') {
      if (ev.accept || E.mil.exhaustion > 0.3 || rand(s) < 0.2) makePeace(s, geo, c.id, e, terms);
    } else if (ev.accept) makePeace(s, geo, c.id, e, terms);
    else if (terms.kind === 'demand' && rand(s) < 0.2) {
      const alt = evaluatePeace(s, geo, c.id, e, { kind: 'status_quo' });
      if (alt.accept) makePeace(s, geo, c.id, e, { kind: 'status_quo' });
    }
  }
}

export function stepAI(s: GameState, geo: Geo) {
  // expire stale offers
  s.offers = s.offers.filter((o) => s.tick - o.tick < 12 && s.countries[o.from].alive);
  for (const c of s.countries) {
    if (!c.alive || c.isPlayer) continue;
    const phase = (s.tick + c.id) % 4;
    if (phase !== 0) continue;
    if ((s.tick + c.id) % 8 === 0) manageEconomy(s, geo, c);
    if ((s.tick + c.id * 3) % 8 === 4) manageDiplomacy(s, geo, c);
    if ((s.tick + c.id) % 12 === 0) considerWar(s, geo, c);
    if (isAtWar(s, c.id)) managePeace(s, geo, c);
  }
  // drift relations: partners warm, rivals chill, memories fade
  for (const k of Object.keys(s.relDelta)) {
    s.relDelta[k] *= 0.992;
    if (Math.abs(s.relDelta[k]) < 0.3) delete s.relDelta[k];
  }
  void partnersOf;
}
