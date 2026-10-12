/**
 * Supply lines. Every country at war runs a logistics network: supplies flow from hubs (the capital, its
 * biggest cities, supply-hub buildings and, while the sea lanes are open, its coasts) along friendly land.
 *
 *   cost of a step  = distance × terrain (mountains slow convoys) × 1.8 through freshly conquered land
 *   front supply    = 1.08 − 0.5 · (path length / reach)^1.4, clamped to 25..100%, × logistics capacity
 *
 * Land that no hub can reach is ENCIRCLED (a pocket): its defenders fight at 55% and slowly bleed.
 * The network is derived from the state each tick (never saved), so it is deterministic.
 */
import type { Geo } from './geo';
import type { CountryId, Country, GameState, ProvId } from './types';
import { alliesOf, warsOf, warSideOf } from './relations';
import { levelOf } from './buildings';
import { clamp } from './util';

export interface SupplyNet {
  key: string;
  /** path cost from the nearest hub (Infinity = unreachable) */
  dist: Float64Array;
  /** previous province on the cheapest path towards a hub (-1 at a hub) */
  prev: Int32Array;
  /** hub kind per province: 0 none, 1 capital, 2 city, 3 supply hub (building), 4 coast (by sea) */
  hub: Uint8Array;
  /** own provinces no hub can reach */
  pocket: ProvId[];
  reach: number;
  /** logistics capacity 0..1 (infrastructure, tech, blockade, war footing) */
  capacity: number;
}

let ownVer = 0;
/** called whenever a province changes hands, so cached networks are rebuilt */
export const bumpSupply = () => { ownVer++; };

/** neighbours for convoys: the adjacency list plus every shared border segment (a few borders are missing from adj) */
const nbCache = new WeakMap<Geo, number[][]>();
export function neighbours(geo: Geo): number[][] {
  let nb = nbCache.get(geo);
  if (nb) return nb;
  const sets = geo.adj.map((a) => new Set(a));
  geo.provinces.forEach((gp, p) => { for (const e of gp.edges ?? []) if (e.n >= 0) { sets[p].add(e.n); sets[e.n]?.add(p); } });
  nb = sets.map((x) => [...x]);
  nbCache.set(geo, nb);
  return nb;
}

/** Home regions that are not connected by land to the main body of the country (islands without a
 *  coastline flag, exclaves, regions joined only through a neighbour): each gets its own local depot. */
const exclaveCache = new WeakMap<Geo, Map<CountryId, ProvId[]>>();
function exclaveHubs(s: GameState, geo: Geo, cid: CountryId): ProvId[] {
  let m = exclaveCache.get(geo);
  if (!m) { m = new Map(); exclaveCache.set(geo, m); }
  const hit = m.get(cid);
  if (hit) return hit;
  const nb = neighbours(geo);
  const homes: ProvId[] = [];
  for (let p = 0; p < s.core.length; p++) if (s.core[p] === cid) homes.push(p);
  const set = new Set(homes), seen = new Set<ProvId>();
  const comps: ProvId[][] = [];
  for (const p0 of homes) {
    if (seen.has(p0)) continue;
    const comp = [p0]; seen.add(p0);
    for (let i = 0; i < comp.length; i++) for (const q of nb[comp[i]]) if (set.has(q) && !seen.has(q)) { seen.add(q); comp.push(q); }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const out = comps.slice(1).map((comp) => comp.reduce((best, q) => (geo.provinces[q].w > geo.provinces[best].w ? q : best), comp[0]));
  m.set(cid, out);
  return out;
}

const caches = new WeakMap<GameState, Map<number, SupplyNet>>();

export function supplyReach(c: Country): number {
  return 55 * (0.6 + 0.8 * (0.5 * c.eco.infra / 100 + 0.5 * c.eco.tech / 100));
}

export function supplyCapacity(c: Country): number {
  return clamp(c.mil.supply * (1 - 0.5 * c.eco.blockade) * (c.mil.warEconomy ? 1.1 : 1), 0.15, 1);
}

/** Countries whose land c's convoys may use: itself, allies and co-belligerents. */
function friendlySet(s: GameState, cid: CountryId): Set<CountryId> {
  const out = new Set<CountryId>([cid]);
  for (const a of alliesOf(s, cid)) out.add(a);
  for (const w of warsOf(s, cid)) for (const x of warSideOf(w, cid) === 0 ? w.attackers : w.defenders) out.add(x);
  return out;
}

/** Minimal binary heap keyed by cost. */
class Heap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v; const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export const stepCost = (s: GameState, geo: Geo, p: ProvId, q: ProvId) =>
  geo.dist(p, q) * (1 + 0.6 * geo.provinces[q].terrain) * (s.core[q] !== s.owner[q] ? ((s.stats[`partisans:${s.core[q]}`] ?? -1) > s.tick ? 2.6 : s.integ[q] < 0.5 ? 1.8 : 1) : 1);

export function supplyNet(s: GameState, geo: Geo, cid: CountryId): SupplyNet {
  const key = `${s.tick}|${ownVer}|${s.wars.length}`;
  let cache = caches.get(s);
  if (!cache) { cache = new Map(); caches.set(s, cache); }
  const hit = cache.get(cid);
  if (hit && hit.key === key) return hit;
  const c = s.countries[cid];
  const n = geo.provinces.length;
  const friends = friendlySet(s, cid);
  const nb = neighbours(geo);
  const ok = (p: ProvId) => friends.has(s.owner[p]);
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const hub = new Uint8Array(n);
  const reach = supplyReach(c);
  const heap = new Heap();
  const seed = (p: ProvId, d: number, kind: number) => { if (d < dist[p]) { dist[p] = d; hub[p] = kind; prev[p] = -1; heap.push(d, p); } };

  // 1. which of its own provinces are still connected to the capital over friendly land?
  const linked = new Uint8Array(n);
  if (c.alive && s.owner[c.capital] === cid) {
    const stack = [c.capital]; linked[c.capital] = 1;
    while (stack.length) { const p = stack.pop()!; for (const q of nb[p]) if (!linked[q] && ok(q)) { linked[q] = 1; stack.push(q); } }
  }
  // 2. hubs: capital, the biggest connected home cities, supply-hub buildings, and coasts while the sea lanes are open
  if (linked[c.capital]) seed(c.capital, 0, 1);
  const homes = c.provinces.filter((p) => linked[p] && s.core[p] === cid && s.integ[p] >= 0.6);
  const nCities = Math.min(6, Math.ceil(c.provinces.length / 6));
  homes.sort((a, b) => geo.provinces[b].w - geo.provinces[a].w);
  for (const p of homes.slice(0, nCities)) seed(p, reach * 0.12, 2);
  for (const p of exclaveHubs(s, geo, cid)) if (s.owner[p] === cid && s.integ[p] >= 0.5) seed(p, reach * 0.2, 2);
  for (const p of c.provinces) {
    const lv = levelOf(s, p, 'depot');
    if (lv && (linked[p] || c.eco.blockade < 0.45)) seed(p, -reach * 0.12 * lv, 3);
  }
  if (c.eco.blockade < 0.45) {
    // by sea: home ports cheaply, freshly taken beachheads at a higher cost
    for (const p of c.provinces) if (geo.provinces[p].coast > 0.15) seed(p, reach * ((s.integ[p] >= 0.5 ? 0.3 : 0.55) + 0.5 * c.eco.blockade) - 0.08 * reach * levelOf(s, p, 'port'), 4);
  }
  // 3. cheapest paths over friendly land (Dijkstra)
  while (heap.size) {
    const [d, p] = heap.pop();
    if (d > dist[p]) continue;
    for (const q of nb[p]) {
      if (!ok(q)) continue;
      const nd = d + stepCost(s, geo, p, q);
      if (nd < dist[q]) { dist[q] = nd; prev[q] = p; hub[q] = 0; heap.push(nd, q); }
    }
  }
  // a pocket is cut-off land that touches the enemy (a remote island or exclave far from the war is not "encircled")
  const enemies = new Set<CountryId>();
  for (const w of warsOf(s, cid)) for (const x of warSideOf(w, cid) === 0 ? w.defenders : w.attackers) enemies.add(x);
  const cut = c.provinces.filter((p) => dist[p] === Infinity);
  const pocket: ProvId[] = [];
  if (cut.length && enemies.size) {
    const cutSet = new Set(cut), done = new Set<ProvId>();
    for (const p0 of cut) {
      if (done.has(p0)) continue;
      const comp = [p0]; done.add(p0);
      let touches = false;
      for (let i = 0; i < comp.length; i++) for (const q of nb[comp[i]]) {
        if (cutSet.has(q) && !done.has(q)) { done.add(q); comp.push(q); }
        if (enemies.has(s.owner[q])) touches = true;
      }
      if (touches) pocket.push(...comp);
    }
  }
  const net: SupplyNet = { key, dist, prev, hub, pocket, reach, capacity: supplyCapacity(c) };
  cache.set(cid, net);
  return net;
}

/** Distance-only supply factor for a path of this cost. */
export const supplyFromCost = (d: number, reach: number) => clamp(1.08 - 0.5 * Math.pow(Math.max(0, d) / reach, 1.4), 0.25, 1);

/** Supply of a land attack from c's network into province q (0 if no friendly neighbour). Also returns the province it is launched from. */
export function landSupply(s: GameState, geo: Geo, net: SupplyNet, q: ProvId): { supply: number; from: ProvId; cost: number } {
  let best = Infinity, from = -1;
  for (const p of geo.adj[q]) {
    if (net.dist[p] === Infinity) continue;
    const d = net.dist[p] + 0.5 * geo.dist(p, q);
    if (d < best) { best = d; from = p; }
  }
  if (from < 0) return { supply: 0.3, from: -1, cost: Infinity };
  return { supply: supplyFromCost(best, net.reach) * (0.72 + 0.28 * net.capacity), from, cost: best };
}

/** The chain of provinces from p back to its hub (for drawing supply lines). */
export function supplyPath(net: SupplyNet, p: ProvId, max = 60): ProvId[] {
  const out: ProvId[] = [];
  let cur = p;
  while (cur >= 0 && out.length < max) { out.push(cur); cur = net.prev[cur]; }
  return out;
}

export function isPocket(s: GameState, geo: Geo, p: ProvId): boolean {
  const o = s.owner[p];
  const c = s.countries[o];
  if (!c?.alive || !warsOf(s, o).length) return false;
  return supplyNet(s, geo, o).dist[p] === Infinity;
}

/** Where a new supply hub would help most: behind the player's worst-supplied land offensive. */
export function depotSuggestion(s: GameState, geo: Geo, cid: CountryId): { prov: ProvId; front: ProvId; supply: number } | null {
  let best: { prov: ProvId; front: ProvId; supply: number } | null = null;
  for (const w of warsOf(s, cid)) for (const f of w.fronts) {
    if (f.by !== cid || f.amphibious || f.from === undefined || f.from < 0 || (f.sup ?? 1) > 0.8) continue;
    // build it in the owned launch province (or the nearest owned one along the supply path)
    const net = supplyNet(s, geo, cid);
    const at = supplyPath(net, f.from).find((p) => s.owner[p] === cid && levelOf(s, p, 'depot') < 3);
    if (at === undefined) continue;
    if (!best || (f.sup ?? 1) < best.supply) best = { prov: at, front: f.prov, supply: f.sup ?? 1 };
  }
  return best;
}
