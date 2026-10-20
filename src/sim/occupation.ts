/**
 * Occupation and resistance. Conquered land is not quiet land: every occupied region has a resistance level
 * (0..1) that rises while its homeland still fights, while the occupier is brutal and while partisans are
 * armed, and falls as the region is won over. Resistance
 *   - slows integration (a region at 60% resistance hardly integrates at all),
 *   - ties down troops: the occupier loses soldiers every week to ambushes and bombs,
 *   - can explode into an uprising that throws the occupier out (the region returns to its homeland).
 *
 * The occupier picks a policy:
 *   lenient  — aid, local self-rule: resistance settles low and integration is faster, but it costs money;
 *   firm     — the default: garrisons and curfews;
 *   harsh    — collective punishment: resistance drops fast, but every week of it breeds resentment that comes
 *              back later, costs reputation, kills civilians and is never forgotten by the homeland.
 * AI countries choose by their system: democracies lenient, autocracies and one-party states harsh.
 */
import type { Geo } from './geo';
import type { Country, CountryId, GameState, ProvId } from './types';
import { areAtWar, getRelation, warBetween } from './relations';
import { partisansActive } from './specops';
import { addRec } from './minds';
import { addGrudge } from './leaders';
import { logEvent } from './log';
import { hash01 } from './rng';
import { clamp } from './util';

export type OccPolicy = 'lenient' | 'firm' | 'harsh';
export const OCC_ORDER: OccPolicy[] = ['lenient', 'firm', 'harsh'];
export const OCC_POLICIES: Record<OccPolicy, { icon: string; label: string; desc: string; pros: string[]; cons: string[] }> = {
  lenient: {
    icon: '🤝', label: 'Win hearts and minds',
    desc: 'Food aid, rebuilt schools, local councils and amnesty for those who lay down their arms.',
    pros: ['Resistance settles about 12 points lower', 'Integration 50% faster'],
    cons: ['Costs about 0.4% of GDP a year for every tenth of your land that is occupied'],
  },
  firm: {
    icon: '🪖', label: 'Garrison and curfew',
    desc: 'Checkpoints, patrols and a curfew. Order, without trying to win anyone over.',
    pros: ['No extra cost'],
    cons: ['Resistance follows the war: it stays high while their homeland fights on'],
  },
  harsh: {
    icon: '⛓', label: 'Iron fist',
    desc: 'Reprisals, mass arrests and collective punishment.',
    pros: ['Resistance drops fast at first (about 20 points lower)'],
    cons: ['Every week builds resentment that pushes resistance back up', 'Integration 40% slower', 'Reputation falls and civilians die', 'Their homeland never forgets'],
  },
};

/** the occupation policy a country follows */
export function occPolicy(s: GameState, c: Country): OccPolicy {
  if (c.isPlayer) return OCC_ORDER[s.stats.occPolicy ?? 1] ?? 'firm';
  return c.gov === 'A' || c.gov === 'C' ? 'harsh' : c.gov === 'D' ? 'lenient' : 'firm';
}
export function actOccPolicy(s: GameState, p: OccPolicy) {
  const i = OCC_ORDER.indexOf(p);
  if (i < 0) return { ok: false, message: 'Unknown policy' };
  if ((s.stats.occPolicy ?? 1) === i) return { ok: false, message: 'That is already your policy' };
  s.stats.occPolicy = i;
  return { ok: true, message: `Occupation policy: ${OCC_POLICIES[p].label}.` };
}

export const resistanceAt = (s: GameState, p: ProvId) => s.resist?.[p] ?? 0;
/** conquered regions a country holds that are not yet fully integrated */
export function occupiedBy(s: GameState, cid: CountryId): ProvId[] {
  const c = s.countries[cid];
  return c ? c.provinces.filter((p) => s.core[p] !== cid && s.integ[p] < 1) : [];
}

/** What drives a region's resistance, in points (for the explanation in the interface). */
export function resistanceParts(s: GameState, p: ProvId): { label: string; v: number }[] {
  const o = s.owner[p], k = s.core[p];
  const O = s.countries[o], K = s.countries[k];
  const out: { label: string; v: number }[] = [{ label: 'Living under occupation', v: 0.3 }];
  if (!O || !K || o === k) return [];
  if (K.alive && areAtWar(s, o, k)) out.push({ label: `${K.name} is still fighting`, v: 0.25 });
  else if (K.alive) out.push({ label: `People want to return to ${K.name}`, v: 0.12 });
  if (partisansActive(s, k)) out.push({ label: 'Partisans armed from abroad', v: 0.25 });
  if (K.alive && getRelation(s, o, k) < -40) out.push({ label: 'Deep hatred between the two nations', v: 0.08 });
  out.push({ label: 'Integration so far', v: -0.45 * s.integ[p] });
  const pol = occPolicy(s, O);
  if (pol === 'lenient') out.push({ label: 'Hearts and minds', v: -0.12 });
  if (pol === 'harsh') out.push({ label: 'Iron fist (fear)', v: -0.2 });
  const r = s.resent?.[p] ?? 0;
  if (r > 0.01) out.push({ label: 'Resentment of past reprisals', v: r });
  return out;
}
const targetOf = (s: GameState, p: ProvId) => clamp(resistanceParts(s, p).reduce((t, x) => t + x.v, 0), 0, 1);

function pay(c: Country, amount: number) {
  c.eco.cash -= amount;
  if (c.eco.cash < 0) { c.eco.debt -= c.eco.cash; c.eco.cash = 0; }
}

/**
 * Weekly. Replaces the old flat integration rate: core regions are always integrated, conquered ones integrate
 * as fast as their resistance allows.
 */
export function stepOccupation(s: GameState, geo: Geo) {
  const R = (s.resist ??= {}), RS = (s.resent ??= {});
  const cost = new Map<CountryId, number>();
  const losses = new Map<CountryId, number>();
  for (let p = 0; p < s.owner.length; p++) {
    const o = s.owner[p], k = s.core[p];
    if (o === k || k < 0) { if (s.integ[p] < 1) s.integ[p] = Math.min(1, s.integ[p] + 0.02); if (R[p] !== undefined) delete R[p]; if (RS[p] !== undefined) delete RS[p]; continue; }
    if (s.integ[p] >= 1) { if (R[p] !== undefined) delete R[p]; continue; }
    const O = s.countries[o];
    if (!O?.alive) continue;
    const pol = occPolicy(s, O);
    let r = R[p] ?? (0.25 + (s.countries[k]?.alive ? 0.15 : 0));
    if (pol === 'harsh') RS[p] = Math.min(0.32, (RS[p] ?? 0) + 0.004);
    else if (RS[p] !== undefined) { RS[p] *= pol === 'lenient' ? 0.97 : 0.99; if (RS[p] < 0.005) delete RS[p]; }
    const target = targetOf(s, p);
    r += (target - r) * (pol === 'harsh' ? 0.08 : 0.04);
    R[p] = Math.round(clamp(r, 0, 1) * 1000) / 1000;
    // integration: the region comes round as fast as its resistance lets it
    const mult = pol === 'lenient' ? 1.5 : pol === 'harsh' ? 0.6 : 1;
    s.integ[p] = clamp(s.integ[p] + 0.004 * mult * clamp(1 - 1.4 * r, 0, 1), 0, 1);
    // garrison losses and the cost of the policy
    const w = geo.provinces[p].w;
    losses.set(o, (losses.get(o) ?? 0) + r * r * (60 + 40 * w));
    if (pol === 'lenient') cost.set(o, (cost.get(o) ?? 0) + w);
    if (pol === 'harsh' && hash01('reprisal', p, s.tick) < 0.02 * r) {
      addRec(s, o, 'repress', 0.15);
      O.reputation = Math.max(0, O.reputation - 0.4);
      addGrudge(s, k, o, 'carried out reprisals against its people', 4);
      const w = warBetween(s, o, k);
      if (w) (w.civ ??= {})[k] = (w.civ[k] ?? 0) + 60 + 300 * r;
    }
    // an uprising: the region rises against the occupier
    if (r > 0.62 && hash01('rising', p, s.tick) < 0.1 * (r - 0.55)) uprising(s, geo, p, O);
  }
  for (const [cid, l] of losses) {
    const c = s.countries[cid];
    const loss = Math.min(l, c.mil.troops * 0.002);
    if (loss < 1) continue;
    c.mil.troops -= loss; c.mil.casualties += loss;
    const w = s.wars.find((x) => x.attackers.includes(cid) || x.defenders.includes(cid));
    if (w) w.casualties[cid] = (w.casualties[cid] ?? 0) + loss;
  }
  for (const [cid, wsum] of cost) {
    const c = s.countries[cid];
    const tot = c.provinces.reduce((t, q) => t + geo.provinces[q].w, 0) || 1;
    pay(c, 0.004 * (wsum / tot) * 10 * c.eco.gdp / 52);
  }
}

/** A region rises up: it returns to its homeland if that country still exists and borders it; otherwise the rising is crushed at a cost. */
function uprising(s: GameState, geo: Geo, p: ProvId, O: Country) {
  const k = s.core[p], K = s.countries[k];
  const name = geo.provinces[p].name || `a region of ${K?.name ?? 'the old country'}`;
  const R = s.resist!;
  const linked = K?.alive && geo.adj[p].some((q) => s.owner[q] === k);
  const strong = O.mil.troops > 40000 && hash01('crush', p, s.tick) < 0.55;
  if (linked && !strong) {
    transfer(s, geo, p, k);
    delete R[p];
    O.eco.stability = Math.max(0, O.eco.stability - 3);
    logEvent(s, `✊ UPRISING in ${name}: the people drive out ${O.name}'s garrison and the region returns to ${K.name}.`, 'territory', [k, O.id], true, { big: O.isPlayer || K.isPlayer, prov: p });
    return;
  }
  // crushed
  const dead = 400 + 1600 * R[p];
  O.mil.troops = Math.max(0, O.mil.troops - dead * 0.4); O.mil.casualties += dead * 0.4;
  const w = warBetween(s, O.id, k);
  if (w) { (w.civ ??= {})[k] = (w.civ[k] ?? 0) + dead; }
  R[p] = 0.45;
  O.reputation = Math.max(0, O.reputation - 2);
  addGrudge(s, k, O.id, 'crushed an uprising in its land', 8);
  logEvent(s, `🔥 Uprising in ${name} against ${O.name}: it is crushed after days of street fighting.`, 'war', [O.id, k], O.isPlayer || K?.isPlayer, { prov: p });
}

let transfer: (s: GameState, geo: Geo, p: ProvId, to: CountryId) => void = () => {};
/** war.ts registers its province transfer here (keeps the import graph acyclic) */
export function setTransfer(fn: typeof transfer) { transfer = fn; }

/** The occupation summary for a country (interface). */
export function occupationSummary(s: GameState, cid: CountryId) {
  const provs = occupiedBy(s, cid);
  const list = provs.map((p) => ({ p, r: resistanceAt(s, p), integ: s.integ[p], core: s.core[p] })).sort((a, b) => b.r - a.r);
  const avg = list.length ? list.reduce((t, x) => t + x.r, 0) / list.length : 0;
  return { list, avg, hot: list.filter((x) => x.r > 0.6).length };
}
