// Emergent tribal civilization: formation, camps, hoarding, territory, wars, trade, schisms.
import { clamp } from './rng.js';
import { geneticDistance, cloneGenome } from './genome.js';
import { tribeName, TRIBE_COLORS } from './names.js';
import { FOOD_RES, FOOD_CELL, HALF } from './constants.js';

const MAX_TRIBES = 12;
const MATURITY = 240;

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function tribeById(sim, id) {
  return sim.tribeMap.get(id) || null;
}

function aliveTribes(sim) {
  return sim.tribes.filter((t) => t.alive);
}

function campSiteOk(sim, x, z, ignoreId = -1) {
  if (!sim.terrain.isLand(x, z)) return false;
  const h = sim.terrain.heightAt(x, z);
  if (h < 0.9 || h > 16 || sim.terrain.slopeAt(x, z) > 1.1) return false;
  for (const t of sim.tribes) {
    if (!t.alive || t.id === ignoreId) continue;
    if (Math.hypot(t.x - x, t.z - z) < t.radius + 14) return false;
  }
  return true;
}

function createTribe(sim, x, z, founders, parent = null) {
  const used = new Set(aliveTribes(sim).map((t) => t.color));
  const color = TRIBE_COLORS.find((c) => !used.has(c)) || sim.rng.pick(TRIBE_COLORS);
  const t = {
    id: sim.nextTribeId++,
    name: tribeName(sim.rng),
    color, rgb: hexToRgb(color),
    x, z,
    founded: sim.tick,
    alive: true, fallenTick: 0,
    members: founders.length,
    food: 4, stone: 0, buildPoints: 2, hoarded: 0,
    level: 1, shelters: 0, radius: 12,
    relations: new Map(), wars: new Set(), weariness: new Map(), warTarget: 0, atWarCount: 0,
    trades: 0, kills: 0, losses: 0,
    culture: cloneGenome(founders[0].genome),
    aggression: 0.5, sociability: 0.5,
    parent,
  };
  sim.tribes.push(t);
  sim.tribeMap.set(t.id, t);
  for (const c of founders) { c.tribeId = t.id; c.bond = 0; }
  for (const o of aliveTribes(sim)) {
    if (o === t) continue;
    const init = parent === o.id ? -0.35 : 0;
    t.relations.set(o.id, init);
    o.relations.set(t.id, init);
  }
  return t;
}

export function tryFoundTribes(sim) {
  if (aliveTribes(sim).length >= MAX_TRIBES) return;
  const used = new Set();
  for (const c of sim.creatures) {
    if (!c.alive || c.tribeId > 0 || used.has(c.id)) continue;
    const g = c.genome;
    if (c.age < MATURITY || g.sociability < 0.5 || g.brainSize < 4) { c.bond = 0; continue; }
    const group = [c];
    sim.forEachNear(c.x, c.z, 11, (o) => {
      if (o === c || o.tribeId > 0 || used.has(o.id)) return;
      if (o.genome.sociability < 0.42 || o.genome.brainSize < 3) return;
      if (o.speciesId !== c.speciesId && geneticDistance(o.genome, g) > 0.22) return;
      group.push(o);
    });
    if (group.length >= 4) c.bond++;
    else c.bond = Math.max(0, c.bond - 1);
    if (c.bond >= 4) {
      let x = 0, z = 0;
      for (const m of group) { x += m.x; z += m.z; }
      x /= group.length; z /= group.length;
      if (!campSiteOk(sim, x, z)) { c.bond = 2; continue; }
      const founders = group.slice(0, 12);
      founders.forEach((m) => used.add(m.id));
      const t = createTribe(sim, x, z, founders);
      sim.log('tribe', `The ${t.name} tribe was founded by ${founders.length} ${speciesLabel(sim, c)}`, x, z);
      if (aliveTribes(sim).length >= MAX_TRIBES) return;
    }
  }
}

function speciesLabel(sim, c) {
  const s = sim.species.get(c.speciesId);
  return s ? s.name : 'creatures';
}

export function recordIncident(sim, attackerTribe, victimTribe, amount, death) {
  const a = tribeById(sim, attackerTribe), v = tribeById(sim, victimTribe);
  if (!a || !v) return;
  a.relations.set(v.id, clamp((a.relations.get(v.id) ?? 0) - amount * 0.6, -1, 1));
  v.relations.set(a.id, clamp((v.relations.get(a.id) ?? 0) - amount, -1, 1));
  if (death) {
    a.kills++; v.losses++;
    if (v.wars.has(a.id)) v.weariness.set(a.id, (v.weariness.get(a.id) ?? 0) + 0.12);
    if (a.wars.has(v.id)) a.weariness.set(v.id, (a.weariness.get(v.id) ?? 0) + 0.03);
  }
}

function declareWar(sim, a, b) {
  a.wars.add(b.id); b.wars.add(a.id);
  a.weariness.set(b.id, 0); b.weariness.set(a.id, 0);
  sim.totalWars++;
  sim.log('war', `WAR! The ${a.name} declared war on the ${b.name}`, (a.x + b.x) / 2, (a.z + b.z) / 2);
}

function makePeace(sim, a, b, reason) {
  a.wars.delete(b.id); b.wars.delete(a.id);
  a.relations.set(b.id, -0.05); b.relations.set(a.id, -0.05);
  a.peaceTick = sim.tick; b.peaceTick = sim.tick;
  sim.log('peace', `${a.name} and ${b.name} ${reason}`, (a.x + b.x) / 2, (a.z + b.z) / 2);
}

export function updateTribes(sim) {
  const lists = new Map();
  for (const t of sim.tribes) if (t.alive) lists.set(t.id, []);
  for (const c of sim.creatures) {
    if (c.tribeId > 0) {
      const l = lists.get(c.tribeId);
      if (l) l.push(c); else c.tribeId = -1;
    }
  }

  for (const t of sim.tribes) {
    if (!t.alive) continue;
    const members = lists.get(t.id);
    if (!members) continue; // founded during this update (schism)
    t.members = members.length;
    if (members.length === 0) {
      t.alive = false;
      t.fallenTick = sim.tick;
      for (const o of sim.tribes) { o.wars.delete(t.id); o.relations.delete(t.id); }
      sim.log('fall', `The ${t.name} tribe has fallen — its camp lies in ruins`, t.x, t.z);
      continue;
    }
    // culture = average temperament of members
    let agg = 0, soc = 0;
    for (const m of members) { agg += m.genome.aggression; soc += m.genome.sociability; }
    t.aggression = agg / members.length;
    t.sociability = soc / members.length;

    // exile members whose sociability mutated away
    for (const m of members) {
      if (m.genome.sociability < 0.22 && sim.rng.chance(0.05)) { m.tribeId = -1; t.members--; }
    }

    // recruitment of like-minded wanderers into the territory
    sim.forEachNear(t.x, t.z, t.radius, (o) => {
      if (o.tribeId > 0 || o.age < MATURITY) return;
      if (o.genome.sociability > 0.42 && o.genome.brainSize >= 3 && geneticDistance(o.genome, t.culture) < 0.3 && sim.rng.chance(0.25)) {
        o.tribeId = t.id; t.members++;
      }
    });

    // economy & construction
    t.food *= 0.9975;
    t.level = clamp(1 + Math.floor(t.buildPoints / 12), 1, 6);
    t.shelters = clamp(Math.floor(t.buildPoints / 4), 0, 10);
    t.radius = 11 + Math.sqrt(t.members) * 2.6 + t.level * 1.4;

    // schism: large tribes split, creating rivals
    if (t.members > 26 && sim.tick - t.founded > 900 && aliveTribes(sim).length < MAX_TRIBES && sim.rng.chance(0.08)) {
      schism(sim, t, members);
    }
  }

  // farming: established camps tend the land around them, boosting plant growth
  sim.cellBoost.fill(1);
  for (const t of sim.tribes) {
    if (!t.alive) continue;
    const r = t.radius * 0.85;
    const amt = 1 + 0.25 * (1 + Math.min(t.level, 5)) * Math.min(1, t.members / 5);
    const N = FOOD_RES;
    const i0 = Math.max(0, Math.floor((t.x - r + HALF) / FOOD_CELL)), i1 = Math.min(N - 1, Math.floor((t.x + r + HALF) / FOOD_CELL));
    const j0 = Math.max(0, Math.floor((t.z - r + HALF) / FOOD_CELL)), j1 = Math.min(N - 1, Math.floor((t.z + r + HALF) / FOOD_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = -HALF + (i + 0.5) * FOOD_CELL, cz = -HALF + (j + 0.5) * FOOD_CELL;
      if (Math.hypot(cx - t.x, cz - t.z) > r) continue;
      const k = j * N + i;
      if (sim.plantCap[k] > 0.05) sim.cellBoost[k] = Math.max(sim.cellBoost[k], amt);
    }
  }

  // diplomacy
  const alive = aliveTribes(sim);
  for (let i = 0; i < alive.length; i++) {
    const a = alive[i];
    a.atWarCount = a.wars.size;
    if (a.wars.size && (!a.warTarget || !a.wars.has(a.warTarget))) a.warTarget = [...a.wars][0];
    if (!a.wars.size) a.warTarget = 0;
    for (let j = i + 1; j < alive.length; j++) {
      const b = alive[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      let rel = a.relations.get(b.id) ?? 0;
      const base = 0.45 * (a.sociability + b.sociability) / 2 - 0.55 * (a.aggression + b.aggression) / 2 + 0.08;
      const overlap = a.radius + b.radius + 22 - dist;
      if (overlap > 0) rel -= 0.006 * (overlap / 10) * (0.4 + (a.aggression + b.aggression));
      if (sim.seasonIndex === 3) rel -= 0.003 * (a.aggression + b.aggression);
      rel += (base - rel) * 0.012;
      rel = clamp(rel, -1, 1);
      a.relations.set(b.id, rel); b.relations.set(a.id, rel);

      const atWar = a.wars.has(b.id);
      if (!atWar && rel < -0.45 && a.members >= 3 && b.members >= 3 && sim.tick - (a.peaceTick || -9999) > 900 && sim.tick - (b.peaceTick || -9999) > 900) {
        if (a.aggression >= b.aggression) declareWar(sim, a, b); else declareWar(sim, b, a);
      } else if (atWar) {
        const wa = (a.weariness.get(b.id) ?? 0) + 0.004;
        const wb = (b.weariness.get(a.id) ?? 0) + 0.004;
        a.weariness.set(b.id, wa); b.weariness.set(a.id, wb);
        if (a.members < 3 || b.members < 3) makePeace(sim, a, b, 'ended their war — one side was all but wiped out');
        else if (Math.max(wa, wb) > 1 && sim.rng.chance(0.3)) makePeace(sim, a, b, 'signed a peace treaty, exhausted by war');
      } else if (rel > 0.05 && dist < 130 && sim.tick - (a.lastTrade?.[b.id] ?? -9999) > 240) {
        // trade caravans: send a member carrying surplus to the partner camp
        a.lastTrade ??= {};
        a.lastTrade[b.id] = sim.tick;
        const [from, to] = a.food >= b.food ? [a, b] : [b, a];
        if (from.food > 0.4 || from.stone > 1.5) dispatchTrader(sim, from, to, lists.get(from.id));
      }
    }
  }
}

function dispatchTrader(sim, from, to, members) {
  if (!members) return;
  let best = null, bd = 1e9;
  for (const m of members) {
    if (m.trade || m.energy < m.maxEnergy * 0.5 || m.age < MATURITY) continue;
    const d = Math.hypot(m.x - from.x, m.z - from.z);
    if (d < bd) { bd = d; best = m; }
  }
  if (best) {
    best.trade = { partner: to.id, stage: 0 };
    best.carryFood = Math.min(from.food * 0.2, 2);
  }
}

function schism(sim, t, members) {
  // find a new camp site 28-50 units away
  for (let tries = 0; tries < 30; tries++) {
    const a = sim.rng.float(0, Math.PI * 2);
    const d = sim.rng.float(28, 50);
    const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
    if (!campSiteOk(sim, x, z, t.id)) continue;
    // the most aggressive / genetically divergent faction breaks away
    const sorted = members.slice().sort((p, q) => (q.genome.aggression + geneticDistance(q.genome, t.culture)) - (p.genome.aggression + geneticDistance(p.genome, t.culture)));
    const faction = sorted.slice(0, Math.floor(members.length * 0.45));
    const nt = createTribe(sim, x, z, faction, t.id);
    nt.food = t.food * 0.3; t.food *= 0.7;
    nt.culture = cloneGenome(faction[0].genome);
    nt.relations.set(t.id, -0.35); t.relations.set(nt.id, -0.35);
    for (const m of faction) { m.trade = null; }
    t.members -= faction.length;
    sim.log('schism', `A schism! ${faction.length} rebels left the ${t.name} to found the ${nt.name}`, x, z);
    return;
  }
}
