/**
 * Army groups: the player's field army split into a few big formations you command directly
 * (Guided and Hands-on military). Each army takes a share of the troops committed to offensives and
 * one order:
 *   advance  — attack towards its objective (or wherever the general sees an opening)
 *   encircle — strike where the enemy can be cut off (pincers; +25% against encircled regions)
 *   raid     — fast, cheap strikes: half the losses, wrecks the enemy's economy, slower to take ground
 *   hold     — dig in around its objective region: that region and its neighbours defend much harder
 *   defend   — guard the capital and its approaches
 * Drag an army onto the map to give it an objective. On Auto the generals do all of this themselves.
 */
import type { Geo } from './geo';
import type { Army, ArmyOrder, Country, GameState, ProvId } from './types';
import { ctl } from './modes';
import { activeGenerals } from './generals';
import { areAtWar, isAtWar } from './relations';
import { logEvent } from './log';

export const ORDERS: Record<ArmyOrder, { label: string; icon: string; desc: string; attack: boolean }> = {
  advance: { label: 'Advance', icon: '➤', desc: 'Attack towards the objective', attack: true },
  encircle: { label: 'Encircle', icon: '⭕', desc: 'Pincer attacks; +25% against cut-off regions', attack: true },
  raid: { label: 'Raid', icon: '⚡', desc: 'Half the losses, wrecks their economy, slower gains', attack: true },
  hold: { label: 'Hold', icon: '🛡', desc: 'Dig in: the objective and its neighbours defend +80%', attack: false },
  defend: { label: 'Defend capital', icon: '🏛', desc: 'Guard the capital and its approaches', attack: false },
};
const NAMES = ['1st Army', '2nd Army', '3rd Army', '4th Army', '5th Army', '6th Army'];
export const MAX_ARMIES = 6;

/** Armies are in use when the player commands the military (not on Auto). */
export const armiesActive = (s: GameState) => ctl(s, 'military') !== 'auto' && (s.armies?.length ?? 0) > 0;

export function ensureArmies(s: GameState) {
  if (s.armies && s.armies.length) return;
  const c = s.countries[s.player];
  const gens = activeGenerals(c);
  s.armies = [0, 1, 2].map((i) => ({ id: i + 1, name: NAMES[i], weight: i === 2 ? 0.6 : 1, order: (i === 2 ? 'defend' : 'advance') as ArmyOrder, target: -1, general: gens[i]?.id ?? -1, at: c.capital }));
}

export function actArmyOrder(s: GameState, id: number, order: ArmyOrder) {
  const a = s.armies?.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'No such army' };
  a.order = order;
  if (!ORDERS[order].attack && a.target >= 0 && s.owner[a.target] !== s.player && order === 'hold') a.target = -1;
  return { ok: true, message: `${a.name}: ${ORDERS[order].label.toLowerCase()}.` };
}
export function actArmyTarget(s: GameState, geo: Geo, id: number, prov: ProvId) {
  const a = s.armies?.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'No such army' };
  const owner = s.owner[prov];
  const name = geo.provinces[prov].name;
  if (prov < 0) { a.target = -1; return { ok: true, message: `${a.name} awaits orders.` }; }
  if (owner === s.player || !areAtWar(s, s.player, owner)) {
    if (owner !== s.player) return { ok: false, message: `You are not at war with ${s.countries[owner].name}.` };
    a.target = prov; a.order = 'hold';
    return { ok: true, message: `${a.name} moves to hold ${name}.` };
  }
  a.target = prov;
  if (!ORDERS[a.order].attack) a.order = 'advance';
  return { ok: true, message: `${a.name} ordered to ${a.order === 'encircle' ? 'encircle' : a.order === 'raid' ? 'raid' : 'take'} ${name}.` };
}
export function actArmyWeight(s: GameState, id: number, w: number) {
  const a = s.armies?.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'No such army' };
  a.weight = Math.max(0.2, Math.min(3, w));
  return { ok: true, message: '' };
}
export function actArmyGeneral(s: GameState, id: number, gen: number) {
  const a = s.armies?.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'No such army' };
  for (const b of s.armies!) if (b.general === gen && gen >= 0) b.general = -1;
  a.general = gen;
  return { ok: true, message: gen >= 0 ? `New commander for the ${a.name}.` : `${a.name} has no commander.` };
}
export function actRaiseArmy(s: GameState) {
  ensureArmies(s);
  if (s.armies!.length >= MAX_ARMIES) return { ok: false, message: 'At most six armies' };
  const used = new Set(s.armies!.map((a) => a.name));
  const id = Math.max(...s.armies!.map((a) => a.id)) + 1;
  s.armies!.push({ id, name: NAMES.find((n) => !used.has(n)) ?? `Army ${id}`, weight: 1, order: 'hold', target: -1, general: -1, at: s.countries[s.player].capital });
  return { ok: true, message: 'A new army is formed from the field forces.' };
}
export function actDisbandArmy(s: GameState, id: number) {
  if (!s.armies || s.armies.length <= 1) return { ok: false, message: 'You need at least one army' };
  s.armies = s.armies.filter((a) => a.id !== id);
  return { ok: true, message: 'The army is merged back into the others.' };
}

export interface ArmyStrike { army: Army; prov: ProvId; supply: number; amphibious: boolean; from: ProvId; share: number }

/**
 * The player's offensives, army by army (replaces the generals' choice). `cands` are the attack candidates
 * for this war, `off` the troops committed to offensives.
 */
export function armyStrikes(s: GameState, geo: Geo, c: Country, cands: { prov: ProvId; amphibious: boolean; supply: number; score: number; from: ProvId }[], off: number, scoreOf: (p: ProvId) => number): ArmyStrike[] {
  const armies = s.armies ?? [];
  const attackers = armies.filter((a) => ORDERS[a.order].attack);
  const totalW = armies.reduce((t, a) => t + a.weight, 0) || 1;
  const attackW = attackers.reduce((t, a) => t + a.weight, 0);
  if (!attackers.length || !cands.length) return [];
  const pool = off * (0.55 + 0.45 * (attackW / totalW)); // armies held back still lend some weight to the push
  const taken = new Set<ProvId>();
  const out: ArmyStrike[] = [];
  for (const a of attackers) {
    let best = cands[0], bv = -Infinity;
    for (const x of cands) {
      let v: number;
      if (a.target >= 0 && s.owner[a.target] !== c.id) {
        const d = x.prov === a.target ? 0 : geo.dist(x.prov, a.target);
        v = -d + (x.prov === a.target ? 50 : 0);
      } else v = scoreOf(x.prov) * 10 - (taken.has(x.prov) ? 6 : 0);
      if (a.order === 'encircle') { let sides = 0; for (const n of geo.adj[x.prov]) if (s.owner[n] === c.id) sides++; v += sides * 6; }
      if (v > bv) { bv = v; best = x; }
    }
    taken.add(best.prov);
    a.at = best.from >= 0 ? best.from : a.at;
    out.push({ army: a, prov: best.prov, supply: best.supply, amphibious: best.amphibious, from: best.from, share: (pool * a.weight) / attackW * (a.order === 'raid' ? 0.6 : 1) });
  }
  return out;
}

/** Extra defence for regions guarded by a holding or defending army. */
export function holdBonus(s: GameState, geo: Geo, p: ProvId): number {
  if (!s.armies || !armiesActive(s) || s.owner[p] !== s.player) return 1;
  const total = s.armies.reduce((t, a) => t + a.weight, 0) || 1;
  let b = 1;
  const cap = s.countries[s.player].capital;
  for (const a of s.armies) {
    if (a.order !== 'hold' && a.order !== 'defend') continue;
    const center = a.order === 'defend' ? cap : a.target >= 0 ? a.target : a.at;
    if (center < 0) continue;
    if (p === center || geo.adj[center].includes(p)) b += 0.8 * (a.weight / total) * 3;
  }
  return Math.min(2.6, b);
}

/** Weekly upkeep: positions, objectives reached, generals put in charge. */
export function stepArmies(s: GameState, geo: Geo) {
  if (!s.armies) { if (ctl(s, 'military') !== 'auto' && isAtWar(s, s.player)) ensureArmies(s); return; }
  const c = s.countries[s.player];
  for (const a of s.armies) {
    if (a.general >= 0 && !c.generals?.some((g) => g.id === a.general && g.status === 'active')) a.general = -1;
    if (a.target >= 0 && ORDERS[a.order].attack && s.owner[a.target] === c.id) {
      logEvent(s, `🎯 ${a.name} has taken its objective, ${geo.provinces[a.target].name}.`, 'territory', [c.id], true, { prov: a.target });
      a.at = a.target; a.target = -1;
    }
    if (!ORDERS[a.order].attack) a.at = a.order === 'defend' ? c.capital : a.target >= 0 ? a.target : a.at;
    if (s.owner[a.at] !== c.id) a.at = c.capital;
  }
  // unassigned generals take the armies without commanders
  const free = activeGenerals(c).filter((g) => !s.armies!.some((a) => a.general === g.id));
  for (const a of s.armies) if (a.general < 0 && free.length) a.general = free.shift()!.id;
}
