// Core artificial-life simulation. Pure JS, no DOM: runs inside a Web Worker in the
// browser and directly under Node for headless verification.
import { RNG, clamp, smoothstep } from './rng.js';
import { Terrain } from './terrain.js';
import {
  WORLD_SIZE, HALF, FOOD_RES, FOOD_CELL, DAY_TICKS, SEASON_TICKS, YEAR_TICKS,
  SEASONS, WEATHERS, BIOME, INTENT, ACTION, ACTION_LABELS, MAX_CREATURES,
  CREATURE_STRIDE, FLAG,
} from './constants.js';
import { NI, MAX_H, NO, think, intelligenceOf } from './brain.js';
import {
  randomGenome, cloneGenome, mutate, crossover, geneticDistance, dietClass,
} from './genome.js';
import { creatureName, speciesName } from './names.js';
import { updateTribes, tryFoundTribes, tribeById, recordIncident, hexToRgb } from './tribes.js';

const GRID_CELL = 8;
const GRID_N = WORLD_SIZE / GRID_CELL;
const PLANT_ENERGY = 32;
const SPECIATION_DISTANCE = 0.21;
const MATURITY = 240;
const START_TICK = Math.floor(DAY_TICKS * 0.3);

const SEASON_GROWTH = [1.15, 1.0, 0.8, 0.62];
const WEATHER_GROWTH = { Clear: 1, Cloudy: 1.05, Rain: 1.45, Storm: 1.2, Snow: 0.4, Heatwave: 0.45 };
const WEATHER_TABLE = [
  [['Clear', 0.35], ['Cloudy', 0.3], ['Rain', 0.3], ['Storm', 0.05]],
  [['Clear', 0.5], ['Cloudy', 0.15], ['Rain', 0.12], ['Storm', 0.1], ['Heatwave', 0.13]],
  [['Clear', 0.25], ['Cloudy', 0.35], ['Rain', 0.3], ['Storm', 0.1]],
  [['Clear', 0.3], ['Cloudy', 0.3], ['Snow', 0.4]],
];

export class Simulation {
  constructor({ seed = 42, population = 170 } = {}) {
    this.seed = seed;
    this.rng = new RNG(seed * 7919 + 13);
    this.terrain = new Terrain(seed);
    this.tick = START_TICK;
    this.startTick = START_TICK;
    this.creatures = [];
    this.byId = new Map();
    this.registry = new Map();
    this.nextId = 1;
    this.species = new Map();
    this.nextSpeciesId = 1;
    this.extinctions = 0;
    this.tribes = [];
    this.tribeMap = new Map();
    this.nextTribeId = 1;
    this.events = [];
    this.eventSeq = 0;
    this.meat = [];
    this.oases = [];
    this.plagues = 0;
    this.history = [];
    this.births = 0;
    this.deaths = { starved: 0, killed: 0, old: 0, plague: 0, disaster: 0 };
    this.weather = 'Clear';
    this.weatherTimer = 0;
    this.lightning = [];
    this.craters = [];
    this.totalWars = 0;
    this.totalTrades = 0;
    this.carnivoreAbsentTicks = 0;

    this.gridHead = new Int32Array(GRID_N * GRID_N);
    this.gridNext = new Int32Array(MAX_CREATURES * 2);
    this.initResources();
    this.spawnInitial(population);
    this.recordHistory();
  }

  // ---------------------------------------------------------------- world
  initResources() {
    const N = FOOD_RES * FOOD_RES;
    this.plants = new Float32Array(N);
    this.plantCap = new Float32Array(N);
    this.minerals = new Float32Array(N);
    this.mineralCap = new Float32Array(N);
    this.cellBiome = new Uint8Array(N);
    this.cellBoost = new Float32Array(N).fill(1); // tribal farming around camps
    for (let j = 0; j < FOOD_RES; j++) {
      for (let i = 0; i < FOOD_RES; i++) {
        const k = j * FOOD_RES + i;
        const x = -HALF + (i + 0.5) * FOOD_CELL;
        const z = -HALF + (j + 0.5) * FOOD_CELL;
        const b = this.terrain.biomeAt(x, z);
        this.cellBiome[k] = b;
        const cap = [0, 0, 0.18, 1.0, 0.85, 0.12, 0][b];
        this.plantCap[k] = cap * (0.75 + 0.5 * this.rng.next());
        this.plants[k] = this.plantCap[k] * this.rng.float(0.4, 1);
        const mcap = b === BIOME.ROCK ? 1 : b === BIOME.SNOW ? 0.6 : b === BIOME.SAND && this.rng.chance(0.15) ? 0.4 : 0;
        this.mineralCap[k] = mcap;
        this.minerals[k] = mcap * this.rng.next();
      }
    }
  }

  get timeOfDay() {
    return (this.tick % DAY_TICKS) / DAY_TICKS;
  }
  get day() {
    return Math.floor(this.tick / DAY_TICKS) + 1;
  }
  get yearPhase() {
    return (this.tick % YEAR_TICKS) / YEAR_TICKS;
  }
  get seasonIndex() {
    return Math.floor(this.yearPhase * 4) % 4;
  }
  get season() {
    return SEASONS[this.seasonIndex];
  }
  get sunElevation() {
    return Math.sin(2 * Math.PI * (this.timeOfDay - 0.25));
  }
  get daylight() {
    return smoothstep(-0.15, 0.3, this.sunElevation);
  }
  get warmth() {
    return Math.sin(2 * Math.PI * (this.yearPhase - 0.125));
  }

  cellIndex(x, z) {
    const i = clamp(Math.floor((x + HALF) / FOOD_CELL), 0, FOOD_RES - 1);
    const j = clamp(Math.floor((z + HALF) / FOOD_CELL), 0, FOOD_RES - 1);
    return j * FOOD_RES + i;
  }
  cellCenter(k) {
    const i = k % FOOD_RES, j = Math.floor(k / FOOD_RES);
    return [-HALF + (i + 0.5) * FOOD_CELL, -HALF + (j + 0.5) * FOOD_CELL];
  }

  updateWorld() {
    // weather: re-rolled every half day with persistence
    if (--this.weatherTimer <= 0) {
      this.weatherTimer = DAY_TICKS / 2;
      if (this.rng.chance(0.65)) {
        const table = WEATHER_TABLE[this.seasonIndex];
        let r = this.rng.next();
        let w = table[0][0];
        for (const [name, p] of table) { if ((r -= p) <= 0) { w = name; break; } }
        if (w !== this.weather) {
          this.weather = w;
          if (w === 'Storm' || w === 'Heatwave' || w === 'Snow') this.log('weather', `${w === 'Storm' ? 'A violent storm' : w === 'Snow' ? 'Snowfall' : 'A scorching heatwave'} sweeps the island`);
        }
      }
      // keep weather consistent with season
      if (this.seasonIndex !== 3 && this.weather === 'Snow') this.weather = 'Cloudy';
      if (this.seasonIndex === 3 && (this.weather === 'Rain' || this.weather === 'Heatwave')) this.weather = 'Snow';
    }
    if (this.tick % SEASON_TICKS === 0) this.log('season', `${this.season} arrives (Day ${this.day})`);

    // plants & minerals, staggered: a quarter of the grid per tick
    const growth = SEASON_GROWTH[this.seasonIndex] * WEATHER_GROWTH[this.weather];
    const winter = this.seasonIndex === 3;
    const N = FOOD_RES * FOOD_RES;
    const phase = this.tick & 3;
    const dt = 4;
    for (let k = phase; k < N; k += 4) {
      let cap = this.plantCap[k];
      if (cap > 0) {
        let p = this.plants[k];
        let g = growth;
        const boost = this.cellBoost[k];
        if (boost > 1) { g *= boost; cap *= 1 + (boost - 1) * 0.5; }
        if (this.oases.length) {
          const [cx, cz] = this.cellCenter(k);
          for (const o of this.oases) {
            const d = Math.hypot(cx - o.x, cz - o.z);
            if (d < o.r) { const f = 1 - d / o.r; cap *= 1 + 1.8 * f; g *= 1 + 3 * f; }
          }
        }
        // resilient regrowth from roots: fastest when grazed down, saturating at capacity
        p += dt * 0.0016 * g * (cap - p);
        if (winter && p > cap * 0.7) p -= dt * 0.0003;
        this.plants[k] = clamp(p, 0, cap * 1.02);
      }
      const mc = this.mineralCap[k];
      if (mc > 0 && this.minerals[k] < mc) this.minerals[k] = Math.min(mc, this.minerals[k] + dt * 0.00035);
    }
    // carcasses rot
    for (let i = this.meat.length - 1; i >= 0; i--) {
      const m = this.meat[i];
      m.amount -= 0.035;
      if (m.amount <= 0) this.meat.splice(i, 1);
    }
    for (let i = this.oases.length - 1; i >= 0; i--) {
      if (--this.oases[i].ttl <= 0) this.oases.splice(i, 1);
    }
    // lightning
    this.lightning.length = 0;
    if (this.weather === 'Storm' && this.rng.chance(0.004)) {
      const x = this.rng.float(-HALF * 0.7, HALF * 0.7), z = this.rng.float(-HALF * 0.7, HALF * 0.7);
      this.lightning.push({ x, z });
      this.forEachNear(x, z, 4, (c) => { this.kill(c, 'disaster'); });
    }
  }

  // ---------------------------------------------------------------- population
  spawnInitial(count) {
    // founding populations: distinct "primordial" lineages scattered over the island
    const founders = [
      { diet: 0.08, sociability: 0.75, aggression: 0.15, size: 0.9, n: 0.2 },
      { diet: 0.12, sociability: 0.68, aggression: 0.3, size: 1.1, n: 0.16 },
      { diet: 0.18, sociability: 0.35, aggression: 0.2, size: 0.8, n: 0.15 },
      { diet: 0.05, sociability: 0.25, aggression: 0.1, size: 1.3, n: 0.12 },
      { diet: 0.48, sociability: 0.72, aggression: 0.5, size: 1.0, n: 0.13 },
      { diet: 0.5, sociability: 0.4, aggression: 0.45, size: 1.15, n: 0.08 },
      { diet: 0.85, sociability: 0.3, aggression: 0.75, size: 1.25, n: 0.08 },
      { diet: 0.9, sociability: 0.6, aggression: 0.7, size: 1.1, n: 0.08 },
    ];
    for (const f of founders) {
      const [cx, cz] = this.randomLand(HALF * 0.75);
      const hue = this.rng.next();
      const base = randomGenome(this.rng, { hue, diet: f.diet, sociability: f.sociability, aggression: f.aggression, size: f.size, brainSize: 3 });
      const n = Math.max(3, Math.round(count * f.n));
      const species = this.newSpecies(base, null);
      for (let i = 0; i < n; i++) {
        const g = cloneGenome(base);
        g.weights = randomGenome(this.rng).weights; // each cell has its own random wiring
        g.diet = clamp(f.diet + this.rng.gauss() * 0.04, 0, 1);
        g.sociability = clamp(f.sociability + this.rng.gauss() * 0.06, 0, 1);
        g.aggression = clamp(f.aggression + this.rng.gauss() * 0.06, 0, 1);
        g.size = clamp(f.size + this.rng.gauss() * 0.06, 0.6, 1.8);
        g.brainSize = this.rng.int(2, 4);
        g.hue = (hue + this.rng.gauss() * 0.01 + 1) % 1;
        const [x, z] = this.landNear(cx, cz, 14);
        const c = this.addCreature(g, x, z, { gen: 0, speciesId: species.id });
        c.age = this.rng.int(0, 400);
        c.energy = c.maxEnergy * this.rng.float(0.45, 0.75);
      }
    }
  }

  randomLand(maxR = HALF * 0.85) {
    for (let t = 0; t < 500; t++) {
      const x = this.rng.float(-maxR, maxR), z = this.rng.float(-maxR, maxR);
      const h = this.terrain.heightAt(x, z);
      if (h > 1.5 && h < 12) return [x, z];
    }
    return [0, 0];
  }

  landNear(cx, cz, r) {
    for (let t = 0; t < 60; t++) {
      const x = cx + this.rng.float(-r, r), z = cz + this.rng.float(-r, r);
      if (this.terrain.isLand(x, z)) return [x, z];
    }
    return this.randomLand();
  }

  newSpecies(genome, parentSpeciesId) {
    const s = {
      id: this.nextSpeciesId++,
      name: speciesName(this.rng),
      proto: cloneGenome(genome),
      hue: genome.hue,
      diet: dietClass(genome.diet),
      count: 0,
      peak: 0,
      born: this.tick,
      extinct: null,
      parent: parentSpeciesId,
    };
    this.species.set(s.id, s);
    return s;
  }

  addCreature(genome, x, z, { gen = 0, parents = [], speciesId = null, tribeId = -1, energy = null } = {}) {
    const g = genome;
    const id = this.nextId++;
    const maxEnergy = 55 + 55 * g.size;
    const c = {
      id,
      name: creatureName(this.rng),
      genome: g,
      x, z,
      heading: this.rng.float(0, Math.PI * 2),
      speed: 0,
      energy: energy ?? maxEnergy * 0.6,
      maxEnergy,
      health: 1,
      age: 0,
      lifespan: Math.round(2200 + 1400 * this.rng.next() + 500 * g.efficiency),
      gen,
      parents,
      speciesId,
      tribeId,
      intent: INTENT.WANDER,
      action: ACTION.WANDER,
      thought: 'Drifting',
      reproCooldown: 160,
      carryFood: 0,
      carryStone: 0,
      infected: 0,
      immuneTicks: 0,
      targetId: 0,
      tx: x, tz: z,
      hasTarget: false,
      foodDir: 0,
      foodScore: 0,
      threatX: 0, threatZ: 0, threatD: 0,
      kinX: 0, kinZ: 0, kinN: 0,
      mateId: 0,
      enemyId: 0,
      intruderId: 0,
      lastAttacker: 0,
      attackFlash: 0,
      inputs: new Float32Array(NI),
      hidden: new Float32Array(MAX_H),
      outputs: new Float32Array(NO),
      iq: intelligenceOf(g.weights, g.brainSize),
      bond: 0,
      kills: 0,
      huntRest: 0, chaseId: 0, chaseTicks: 0,
      childCount: 0,
      trade: null,
      alive: true,
      sleeping: false,
      bornTick: this.tick,
    };
    this.creatures.push(c);
    this.byId.set(id, c);
    // species assignment / speciation
    let sp = speciesId != null ? this.species.get(speciesId) : null;
    if (!sp || geneticDistance(g, sp.proto) > SPECIATION_DISTANCE) {
      const parentSp = sp ? sp.id : null;
      sp = this.newSpecies(g, parentSp);
      if (parentSp && this.rng.chance(1)) {
        const ps = this.species.get(parentSp);
        if (ps && sp.id % 3 === 0) this.log('species', `New species ${sp.name} branched from ${ps.name}`);
      }
    }
    c.speciesId = sp.id;
    sp.count++;
    sp.peak = Math.max(sp.peak, sp.count);
    // genealogy
    this.registry.set(id, {
      id, name: c.name, gen, parents: parents.slice(), children: [], alive: true,
      diet: g.diet, hue: g.hue, born: this.tick, died: null, cause: null, speciesId: sp.id,
    });
    for (const pid of parents) {
      const pr = this.registry.get(pid);
      if (pr && pr.children.length < 60) pr.children.push(id);
    }
    if (this.registry.size > 9000) this.pruneRegistry();
    return c;
  }

  pruneRegistry() {
    let removed = 0;
    for (const [id, r] of this.registry) {
      if (!r.alive) { this.registry.delete(id); if (++removed > 2500) break; }
    }
  }

  kill(c, cause, killer = null) {
    if (!c.alive) return;
    c.alive = false;
    c.health = 0;
    this.deaths[cause] = (this.deaths[cause] || 0) + 1;
    const meatAmt = 14 + c.genome.size * 32 + c.energy * 0.2;
    if (cause !== 'disaster') this.meat.push({ x: c.x, z: c.z, amount: meatAmt, max: meatAmt });
    const r = this.registry.get(c.id);
    if (r) { r.alive = false; r.died = this.tick; r.cause = cause; }
    const sp = this.species.get(c.speciesId);
    if (sp) {
      sp.count--;
      if (sp.count <= 0 && sp.extinct == null) {
        sp.extinct = this.tick;
        this.extinctions++;
        if (sp.peak >= 6) this.log('extinction', `${sp.name} (${sp.diet}) went extinct`);
      }
    }
    if (killer && c.tribeId > 0 && killer.tribeId > 0 && c.tribeId !== killer.tribeId) {
      recordIncident(this, killer.tribeId, c.tribeId, 0.18, true);
    }
  }

  // ---------------------------------------------------------------- spatial grid
  rebuildGrid() {
    this.gridHead.fill(-1);
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const gi = clamp(Math.floor((c.x + HALF) / GRID_CELL), 0, GRID_N - 1);
      const gj = clamp(Math.floor((c.z + HALF) / GRID_CELL), 0, GRID_N - 1);
      const g = gj * GRID_N + gi;
      this.gridNext[i] = this.gridHead[g];
      this.gridHead[g] = i;
    }
  }

  forEachNear(x, z, r, fn) {
    const cs = this.creatures;
    const i0 = clamp(Math.floor((x - r + HALF) / GRID_CELL), 0, GRID_N - 1);
    const i1 = clamp(Math.floor((x + r + HALF) / GRID_CELL), 0, GRID_N - 1);
    const j0 = clamp(Math.floor((z - r + HALF) / GRID_CELL), 0, GRID_N - 1);
    const j1 = clamp(Math.floor((z + r + HALF) / GRID_CELL), 0, GRID_N - 1);
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let k = this.gridHead[j * GRID_N + i];
        while (k !== -1) {
          const o = cs[k];
          if (o && o.alive) {
            const dx = o.x - x, dz = o.z - z;
            const d2 = dx * dx + dz * dz;
            if (d2 <= r2) fn(o, d2);
          }
          k = this.gridNext[k];
        }
      }
    }
  }

  // ---------------------------------------------------------------- main step
  step() {
    this.tick++;
    this.updateWorld();
    this.rebuildGrid();
    this.newborns = [];
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.alive) this.updateCreature(c);
    }
    // compact
    let w = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.alive) cs[w++] = c;
      else this.byId.delete(c.id);
    }
    cs.length = w;
    for (const nb of this.newborns) if (cs.length < MAX_CREATURES) cs.push(nb); else this.byId.delete(nb.id);

    if (this.tick % 20 === 0) {
      tryFoundTribes(this);
      updateTribes(this);
    }
    if (this.tick % 50 === 0) this.recordHistory();
    this.safeguards();
  }

  safeguards() {
    // Abiogenesis: if life nearly collapses, primordial cells re-emerge in the shallows.
    if (this.creatures.length < 24 && this.tick % 100 === 0) {
      const [cx, cz] = this.randomLand();
      const base = randomGenome(this.rng);
      for (let i = 0; i < 12; i++) {
        const g = cloneGenome(base);
        g.weights = randomGenome(this.rng).weights;
        g.diet = this.rng.float(0, 0.4);
        const [x, z] = this.landNear(cx, cz, 10);
        this.addCreature(g, x, z, { gen: 0 });
      }
      this.log('abiogenesis', 'Primordial cells spontaneously emerge from the tidepools');
    }
    // Niche pressure: a long-empty predator niche gets re-filled by a mutant lineage.
    let carn = 0;
    for (const c of this.creatures) if (c.genome.diet > 0.64) carn++;
    this.carnivoreAbsentTicks = carn < 2 ? this.carnivoreAbsentTicks + 1 : 0;
    if (this.carnivoreAbsentTicks > 1500 && this.creatures.length > 120) {
      this.carnivoreAbsentTicks = 0;
      const cand = this.creatures.filter((c) => c.genome.diet > 0.3 && c.age > MATURITY).slice(0, 4);
      const pool = cand.length ? cand : this.creatures.slice(0, 4);
      for (const p of pool) {
        const g = mutate(cloneGenome(p.genome), this.rng, 2);
        g.diet = this.rng.float(0.72, 0.95);
        g.aggression = Math.max(g.aggression, 0.6);
        const [x, z] = this.landNear(p.x, p.z, 4);
        this.addCreature(g, x, z, { gen: p.gen + 1, parents: [p.id], speciesId: null, energy: 90 });
      }
      this.log('species', 'An empty predator niche is filled — a carnivorous lineage emerges');
    }
  }

  // ---------------------------------------------------------------- creature AI
  updateCreature(c) {
    const g = c.genome;
    c.age++;
    if (c.reproCooldown > 0) c.reproCooldown--;
    if (c.attackFlash > 0) c.attackFlash--;
    if (c.immuneTicks > 0) c.immuneTicks--;
    if (c.huntRest > 0) c.huntRest--;

    if ((this.tick + c.id) % 3 === 0) {
      this.sense(c);
      think(g.weights, g.brainSize, c.inputs, c.hidden, c.outputs);
      this.decide(c);
    }
    this.act(c);
    this.metabolize(c);
  }

  plantFactor(diet) {
    return clamp(1.15 - 1.3 * diet, 0, 1);
  }
  meatFactor(diet) {
    return clamp(1.3 * diet - 0.15, 0, 1);
  }

  sense(c) {
    const g = c.genome;
    const night = 1 - this.daylight;
    const vision = g.vision * (1 - 0.35 * night) * (this.weather === 'Storm' || this.weather === 'Snow' ? 0.8 : 1);
    const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
    let threat = 0, threatD = 1e9, prey = null, preyD = 1e9, mate = null, mateD = 1e9;
    let predN = 0;
    let kinN = 0, kinX = 0, kinZ = 0, enemy = null, enemyD = 1e9, intruder = null, intruderD = 1e9;
    const myPower = g.size * (0.5 + g.aggression);
    const ready = this.readyToBreed(c);

    this.forEachNear(c.x, c.z, vision, (o, d2) => {
      if (o === c) return;
      const og = o.genome;
      const d = Math.sqrt(d2);
      const sameTribe = tribe && o.tribeId === c.tribeId;
      const sameSpecies = o.speciesId === c.speciesId;
      // infection spread
      if (c.infected > 0 && d < 2.6 && o.infected === 0 && o.immuneTicks === 0 && this.rng.chance(0.05 * (1 - og.immunity * 0.85))) {
        o.infected = 420;
      }
      if (og.diet > 0.6) predN++;
      if (sameTribe || sameSpecies) {
        kinN++; kinX += o.x; kinZ += o.z;
      }
      // threats: predators bigger than me that are not my kin, or enemy warriors
      const atWar = tribe && o.tribeId > 0 && tribe.wars.has(o.tribeId);
      if (!sameTribe && ((og.diet > 0.55 && !sameSpecies && og.size * (0.5 + og.aggression) > myPower * 0.85) || atWar)) {
        if (d < threatD) { threatD = d; threat = 1 - d / vision; c.threatX = o.x; c.threatZ = o.z; }
      }
      // prey
      if (g.diet > 0.36 && !sameTribe && !sameSpecies && og.size < g.size * 1.35) {
        const score = d / (0.6 + og.size);
        if (score < preyD) { preyD = score; prey = o; }
      }
      if (ready && sameSpecies && d < mateD && this.readyToBreed(o)) { mateD = d; mate = o; }
      if (atWar && d < enemyD) { enemyD = d; enemy = o; }
      if (tribe && !sameTribe && d < intruderD) {
        const dc = Math.hypot(o.x - tribe.x, o.z - tribe.z);
        if (dc < tribe.radius && (o.tribeId > 0 || og.diet > 0.6)) { intruderD = d; intruder = o; }
      }
    });

    // food scent: sample plant cells in several directions (bigger brains sample more)
    const pf = this.plantFactor(g.diet);
    const samples = 3 + Math.min(6, g.brainSize >> 1);
    let best = 0, bestDir = c.heading;
    if (pf > 0.05) {
      const here = this.plants[this.cellIndex(c.x, c.z)] * pf;
      best = here * 1.1;
      bestDir = c.heading;
      // remembered foraging spot (spatial memory keeps creatures from dithering)
      let fx = c.x, fz = c.z;
      if (c.foodX !== undefined) {
        const v = this.plants[this.cellIndex(c.foodX, c.foodZ)] * pf * 1.15;
        if (v > best) { best = v; fx = c.foodX; fz = c.foodZ; }
      }
      for (let s = 0; s < samples; s++) {
        const a = c.heading + ((s / samples) * 2 - 1) * Math.PI + this.rng.float(-0.3, 0.3);
        const dist = vision * (0.3 + 0.6 * this.rng.next());
        const sx = c.x + Math.cos(a) * dist, sz = c.z + Math.sin(a) * dist;
        if (!this.terrain.isLand(sx, sz)) continue;
        const v = this.plants[this.cellIndex(sx, sz)] * pf;
        if (v > best * 1.1) { best = v; fx = sx; fz = sz; }
      }
      c.foodX = fx; c.foodZ = fz;
      if (fx !== c.x || fz !== c.z) bestDir = Math.atan2(fz - c.z, fx - c.x);
    }
    // carrion
    const mf = this.meatFactor(g.diet);
    c.meatTarget = null;
    if (mf > 0.05) {
      let md = vision * vision;
      for (const m of this.meat) {
        const dx = m.x - c.x, dz = m.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < md) { md = d2; c.meatTarget = m; }
      }
      if (c.meatTarget) {
        const v = mf * (1 - Math.sqrt(md) / vision) * 1.2;
        if (v > best) { best = v; bestDir = Math.atan2(c.meatTarget.z - c.z, c.meatTarget.x - c.x); }
      }
    }
    c.foodScore = best;
    c.foodDir = bestDir;
    c.threatD = threatD;
    c.preyId = prey ? prey.id : 0;
    c.mateId = mate ? mate.id : 0;
    c.enemyId = enemy ? enemy.id : 0;
    c.intruderId = intruder ? intruder.id : 0;
    c.kinN = kinN;
    c.predN = predN;
    if (kinN) { c.kinX = kinX / kinN; c.kinZ = kinZ / kinN; }

    const inp = c.inputs;
    inp[0] = c.energy / c.maxEnergy;
    inp[1] = c.health;
    inp[2] = clamp(best, 0, 1);
    inp[3] = clamp(threat, 0, 1);
    inp[4] = prey ? clamp(1 - Math.hypot(prey.x - c.x, prey.z - c.z) / vision, 0, 1) : 0;
    inp[5] = clamp(kinN / 6, 0, 1);
    inp[6] = enemy || intruder ? 1 : 0;
    inp[7] = tribe ? 1 : 0;
    inp[8] = tribe ? clamp(Math.hypot(tribe.x - c.x, tribe.z - c.z) / 60, 0, 1) : 0;
    inp[9] = clamp((c.carryFood + c.carryStone) / 3, 0, 1);
    inp[10] = this.daylight;
    inp[11] = this.warmth;
    inp[12] = 1;
    inp[13] = c.outputs[9];
  }

  readyToBreed(c) {
    // breeding season: harsh winters raise the bar unless sheltered by a tribe
    const winterBar = this.warmth < -0.5 && c.tribeId <= 0 ? 0.12 : c.tribeId > 0 ? -0.1 : 0;
    const crowdOk = c.tribeId > 0 ? c.kinN <= 26 : c.kinN <= 11;
    // density-dependent fertility: plant-eaters only breed when local pasture can feed young
    if (c.genome.diet < 0.6 && c.foodScore < 0.3 && c.tribeId <= 0) return false;
    // predators are territorial: crowded hunting grounds suppress breeding
    if (c.genome.diet > 0.6 && c.predN > 2) return false;
    const predatorBar = c.genome.diet > 0.6 ? 0.08 : 0;
    return c.age > MATURITY && c.reproCooldown <= 0 && crowdOk && c.energy > c.maxEnergy * (0.6 + winterBar + predatorBar + 0.25 * (1 - c.genome.fertility)) && c.health > 0.5;
  }

  decide(c) {
    const g = c.genome;
    const out = c.outputs;
    const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
    let best = -2, intent = INTENT.WANDER;
    for (let o = 0; o < 8; o++) {
      let v = out[o];
      if (o === INTENT.HUNT && (g.diet < 0.36 || c.energy > c.maxEnergy * 0.72 || c.huntRest > 0)) continue;
      if ((o === INTENT.GATHER || o === INTENT.BUILD) && !tribe) continue;
      if (o === INTENT.FLEE && c.threatD > 1e8) v -= 0.6;
      if (v > best) { best = v; intent = o; }
    }
    c.intent = intent;
    let action = intent;
    // a meat-eater's foraging drive means stalking prey when no carrion is around
    if (action === ACTION.FORAGE && g.diet > 0.5 && !c.meatTarget && c.preyId && c.energy < c.maxEnergy * 0.72 && c.huntRest <= 0) action = ACTION.HUNT;
    // herd alarm: prey in a group bolt as soon as one of them spots a nearby predator
    if (c.threatD < 4 + c.kinN * 0.8 && g.diet < 0.6 && c.kinN >= 2) action = ACTION.FLEE;

    // civilization layer: situational overrides on top of the neural drive
    if (tribe) {
      const ratio = c.energy / c.maxEnergy;
      if (c.trade) action = ACTION.TRADE;
      else if (c.enemyId && g.aggression > 0.3 && c.health > 0.35 && intent !== INTENT.FLEE) action = ACTION.WAR;
      else if (c.intruderId && g.aggression > 0.4 && c.health > 0.45 && intent !== INTENT.FLEE) action = ACTION.DEFEND;
      else if (ratio < 0.38 && tribe.food > 2 && Math.hypot(tribe.x - c.x, tribe.z - c.z) < 45) action = ACTION.EAT_STORE;
      else if (intent === INTENT.FORAGE && ratio > (this.seasonIndex === 2 ? 0.5 : 0.68) && g.diet < 0.6) action = ACTION.HOARD;
      else if (tribe.atWarCount > 0 && intent === INTENT.WANDER && g.aggression > 0.55 && c.health > 0.7 && ratio > 0.5) action = ACTION.WAR;
      if ((c.carryFood >= 2.5 || c.carryStone >= 2) && action !== ACTION.FLEE && action !== ACTION.WAR) action = ACTION.BUILD;
      // hunger override: civic duties wait until bellies are full
      if (ratio < 0.5 && (action === ACTION.GATHER || action === ACTION.BUILD || action === ACTION.SOCIAL || action === ACTION.WANDER || (action === ACTION.REST && this.daylight > 0.5))) {
        action = tribe.food > 1 && Math.hypot(tribe.x - c.x, tribe.z - c.z) < 30 ? ACTION.EAT_STORE : g.diet > 0.6 && c.preyId ? ACTION.HUNT : ACTION.FORAGE;
      }
    }
    const calm = action !== ACTION.FLEE && action !== ACTION.WAR && action !== ACTION.DEFEND && action !== ACTION.HUNT && action !== ACTION.TRADE;
    if (c.mateId && calm && (intent === INTENT.SOCIAL || intent === INTENT.REST || intent === INTENT.WANDER || g.sociability > 0.5)) action = ACTION.MATE;
    if (c.energy > c.maxEnergy * 0.95 && action === ACTION.FORAGE) action = c.mateId ? ACTION.MATE : ACTION.WANDER;
    c.action = action;
  }

  steerTo(c, tx, tz, speedFrac) {
    const desired = Math.atan2(tz - c.z, tx - c.x);
    this.turnTo(c, desired, 0.3);
    c.speed = speedFrac;
  }

  turnTo(c, desired, rate) {
    let d = desired - c.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    c.heading += clamp(d, -rate, rate);
  }

  act(c) {
    const g = c.genome;
    const out = c.outputs;
    const speedOut = 0.45 + 0.55 * (out[8] * 0.5 + 0.5);
    const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
    c.sleeping = false;
    let thought = ACTION_LABELS[c.action];
    const cellK = this.cellIndex(c.x, c.z);

    switch (c.action) {
      case ACTION.FORAGE: {
        const pf = this.plantFactor(g.diet);
        if (c.meatTarget && this.meatFactor(g.diet) > pf && c.meatTarget.amount > 0) {
          const m = c.meatTarget;
          const d = Math.hypot(m.x - c.x, m.z - c.z);
          if (d < 1.2 + g.size * 0.5) { c.speed = 0; this.eatMeat(c, m); thought = 'Scavenging carrion'; }
          else { this.steerTo(c, m.x, m.z, speedOut); thought = 'Following the scent of carrion'; }
        } else if (this.plants[cellK] * pf > 0.08 && (c.foodScore < 0.3 || this.plants[cellK] * pf > c.foodScore * 0.6)) {
          c.speed = 0.12; this.wobble(c, 0.2); this.grazeAt(c, cellK, false); thought = 'Grazing';
        } else if (c.foodX !== undefined && c.foodScore > 0.08) {
          this.steerTo(c, c.foodX, c.foodZ, speedOut * 0.85); thought = 'Heading to pasture';
        } else {
          this.turnTo(c, c.foodDir, 0.25); c.speed = speedOut * 0.8; thought = 'Searching for food';
        }
        break;
      }
      case ACTION.HUNT: {
        const p = c.preyId ? this.byId.get(c.preyId) : null;
        if (p && p.alive && c.chaseId === p.id && ++c.chaseTicks > 70) {
          // exhausted: predators can only sprint so long before giving up
          c.huntRest = 140; c.chaseTicks = 0; c.preyId = 0; c.action = ACTION.REST; c.speed = 0; thought = 'Exhausted from the chase';
          break;
        }
        if (p && p.alive && c.chaseId !== p.id) { c.chaseId = p.id; c.chaseTicks = 0; }
        if (p && p.alive) {
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          this.steerTo(c, p.x + Math.cos(p.heading) * 1.5, p.z + Math.sin(p.heading) * 1.5, 1 + 0.3 * g.diet);
          if (d < (g.size + p.genome.size) * 0.75 + 0.4) this.attack(c, p);
          thought = `Hunting ${p.name}`;
        } else if (c.meatTarget) {
          const m = c.meatTarget;
          if (Math.hypot(m.x - c.x, m.z - c.z) < 1.5 + g.size * 0.5) { c.speed = 0; this.eatMeat(c, m); thought = 'Devouring a kill'; }
          else { this.steerTo(c, m.x, m.z, speedOut); thought = 'Tracking prey'; }
        } else { this.wobble(c, 0.25); c.speed = speedOut * 0.85; thought = 'Prowling'; }
        break;
      }
      case ACTION.FLEE: {
        if (c.threatD < 1e8) {
          const away = Math.atan2(c.z - c.threatZ, c.x - c.threatX);
          this.turnTo(c, away, 0.45); c.speed = 1; thought = 'Fleeing a predator';
        } else { c.speed = 0.5; this.wobble(c, 0.2); thought = 'Nervously watching'; }
        break;
      }
      case ACTION.SOCIAL: {
        if (tribe) {
          const dc = Math.hypot(tribe.x - c.x, tribe.z - c.z);
          if (dc > tribe.radius * 0.5) { this.steerTo(c, tribe.x, tribe.z, speedOut * 0.8); thought = `Returning to ${tribe.name}`; }
          else { this.wobble(c, 0.35); c.speed = 0.25; thought = 'Gathering by the campfire'; }
        } else if (c.kinN > 0) {
          const d = Math.hypot(c.kinX - c.x, c.kinZ - c.z);
          if (d > 3) this.steerTo(c, c.kinX, c.kinZ, speedOut * 0.7); else { this.wobble(c, 0.3); c.speed = 0.2; }
          thought = 'Seeking companions';
        } else { this.wobble(c, 0.2); c.speed = 0.5; thought = 'Lonely, searching for kin'; }
        break;
      }
      case ACTION.GATHER: {
        if (c.carryStone >= 2) { c.action = ACTION.BUILD; break; }
        const mk = this.findMineral(c);
        if (mk >= 0) {
          const [mx, mz] = this.cellCenter(mk);
          if (mk === cellK || Math.hypot(mx - c.x, mz - c.z) < 2) {
            c.speed = 0.05;
            const take = Math.min(this.minerals[mk], 0.025);
            this.minerals[mk] -= take; c.carryStone += take * 2;
            thought = 'Quarrying stone';
          } else { this.steerTo(c, mx, mz, speedOut); thought = 'Seeking stone'; }
        } else { this.wobble(c, 0.25); c.speed = speedOut * 0.7; thought = 'Prospecting'; }
        break;
      }
      case ACTION.BUILD: {
        if (!tribe) { c.action = ACTION.WANDER; break; }
        const d = Math.hypot(tribe.x - c.x, tribe.z - c.z);
        if (d < 3.5) {
          c.speed = 0.05;
          if (c.carryStone > 0) { tribe.stone += c.carryStone; tribe.buildPoints += c.carryStone * 1.4; c.carryStone = 0; }
          if (c.carryFood > 0) { tribe.food += c.carryFood; tribe.hoarded += c.carryFood; c.carryFood = 0; }
          thought = c.carryStone === 0 && tribe.buildPoints > 4 ? 'Building shelters' : 'Tending the camp';
          tribe.buildPoints += 0.01 * (1 + c.genome.brainSize / 6);
        } else { this.steerTo(c, tribe.x, tribe.z, speedOut); thought = c.carryFood + c.carryStone > 0 ? 'Hauling supplies home' : 'Heading to camp'; }
        break;
      }
      case ACTION.HOARD: {
        if (this.plants[cellK] > 0.15) {
          c.speed = 0.1;
          this.grazeAt(c, cellK, true);
          thought = 'Hoarding food for winter';
        } else { this.turnTo(c, c.foodDir, 0.25); c.speed = speedOut * 0.8; thought = 'Gathering provisions'; }
        break;
      }
      case ACTION.EAT_STORE: {
        if (!tribe) break;
        const d = Math.hypot(tribe.x - c.x, tribe.z - c.z);
        if (d < 4 && tribe.food > 0) {
          c.speed = 0;
          const take = Math.min(tribe.food, 0.12);
          tribe.food -= take;
          c.energy = Math.min(c.maxEnergy, c.energy + take * PLANT_ENERGY * (0.6 + 0.4 * this.plantFactor(g.diet) + 0.4 * this.meatFactor(g.diet)));
          thought = 'Feasting from the stores';
        } else { this.steerTo(c, tribe.x, tribe.z, speedOut); thought = 'Hungry, heading to the stores'; }
        break;
      }
      case ACTION.REST: {
        c.speed = 0;
        c.sleeping = this.daylight < 0.35;
        thought = c.sleeping ? 'Sleeping' : 'Resting';
        break;
      }
      case ACTION.MATE: {
        const m = c.mateId ? this.byId.get(c.mateId) : null;
        if (m && m.alive && this.readyToBreed(m) && this.readyToBreed(c)) {
          const d = Math.hypot(m.x - c.x, m.z - c.z);
          if (d < 2.2) { this.reproduce(c, m); thought = 'Mating'; } else { this.steerTo(c, m.x, m.z, speedOut); thought = `Courting ${m.name}`; }
        } else { c.action = ACTION.WANDER; c.speed = 0.4; }
        break;
      }
      case ACTION.WAR: {
        const e = c.enemyId ? this.byId.get(c.enemyId) : null;
        if (e && e.alive) {
          const d = Math.hypot(e.x - c.x, e.z - c.z);
          this.steerTo(c, e.x, e.z, 1);
          if (d < (g.size + e.genome.size) * 0.75 + 0.5) this.attack(c, e);
          const et = tribeById(this, e.tribeId);
          thought = `Fighting the ${et ? et.name : 'enemy'}`;
        } else if (tribe) {
          // raid: march on the nearest enemy camp and steal supplies
          const foe = tribe.warTarget ? tribeById(this, tribe.warTarget) : null;
          if (foe && foe.alive) {
            const d = Math.hypot(foe.x - c.x, foe.z - c.z);
            if (d < 3.5) {
              const steal = Math.min(foe.food, 0.3);
              foe.food -= steal; c.carryFood += steal;
              if (c.carryFood > 1.5) c.action = ACTION.BUILD;
              thought = `Raiding ${foe.name}'s stores`;
            } else { this.steerTo(c, foe.x, foe.z, speedOut); thought = `Marching on ${foe.name}`; }
          } else { c.action = ACTION.WANDER; }
        }
        break;
      }
      case ACTION.DEFEND: {
        const e = c.intruderId ? this.byId.get(c.intruderId) : null;
        if (e && e.alive) {
          const d = Math.hypot(e.x - c.x, e.z - c.z);
          this.steerTo(c, e.x, e.z, 1);
          if (d < (g.size + e.genome.size) * 0.75 + 0.5) this.attack(c, e, 0.6);
          thought = 'Defending territory';
        } else c.action = ACTION.SOCIAL;
        break;
      }
      case ACTION.TRADE: {
        const t = c.trade;
        const partner = t ? tribeById(this, t.partner) : null;
        if (!partner || !partner.alive || !tribe) { c.trade = null; c.action = ACTION.WANDER; break; }
        const dest = t.stage === 0 ? partner : tribe;
        const d = Math.hypot(dest.x - c.x, dest.z - c.z);
        if (d < 3.5) {
          if (t.stage === 0) { t.stage = 1; this.completeTrade(tribe, partner, c); }
          else { c.trade = null; c.action = ACTION.SOCIAL; }
        } else this.steerTo(c, dest.x, dest.z, speedOut * 0.9);
        thought = t.stage === 0 ? `Trading with ${partner.name}` : 'Returning from trade';
        break;
      }
      default: {
        // wander: neural "memory" output biases turning to create individual gait patterns
        this.wobble(c, 0.18 + 0.12 * out[9]);
        c.speed = speedOut * 0.6;
        thought = 'Wandering';
        if (tribe && Math.hypot(tribe.x - c.x, tribe.z - c.z) > tribe.radius * 1.4) {
          this.steerTo(c, tribe.x, tribe.z, speedOut * 0.6); thought = 'Wandering home';
        }
      }
    }
    // passive grazing when hungry and standing on food (cells absorb nutrients)
    if (c.action !== ACTION.FORAGE && c.action !== ACTION.HOARD && c.action !== ACTION.FLEE && c.energy < c.maxEnergy * 0.5) {
      if (this.plants[cellK] > 0.1 && this.plantFactor(g.diet) > 0.2) this.grazeAt(c, cellK, false, 0.5);
    }
    // combat retaliation
    if (c.lastAttacker) {
      const a = this.byId.get(c.lastAttacker);
      if (a && a.alive && g.aggression > 0.45 && c.action !== ACTION.FLEE && Math.hypot(a.x - c.x, a.z - c.z) < (g.size + a.genome.size) * 0.8 + 0.5) {
        this.attack(c, a, 0.7);
      }
      c.lastAttacker = 0;
    }
    c.thought = thought;
    this.move(c);
  }

  wobble(c, amt) {
    c.heading += this.rng.gauss() * amt;
  }

  findMineral(c) {
    const ci = clamp(Math.floor((c.x + HALF) / FOOD_CELL), 0, FOOD_RES - 1);
    const cj = clamp(Math.floor((c.z + HALF) / FOOD_CELL), 0, FOOD_RES - 1);
    const R = Math.min(8, Math.ceil(c.genome.vision / FOOD_CELL) + 2);
    let best = -1, bestS = 0;
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= FOOD_RES || j >= FOOD_RES) continue;
        const k = j * FOOD_RES + i;
        const m = this.minerals[k];
        if (m < 0.08) continue;
        const s = m / (1 + Math.hypot(di, dj));
        if (s > bestS) { bestS = s; best = k; }
      }
    }
    return best;
  }

  grazeAt(c, k, hoard, mult = 1) {
    const g = c.genome;
    const bite = Math.min(this.plants[k], 0.06 * g.size * mult);
    if (bite <= 0) return;
    this.plants[k] -= bite;
    if (hoard) {
      c.carryFood += bite * 1.8; // gathering techniques: tribes harvest more than they could eat
      c.energy = Math.min(c.maxEnergy, c.energy + bite * PLANT_ENERGY * 0.3 * this.plantFactor(g.diet));
    } else {
      c.energy = Math.min(c.maxEnergy, c.energy + bite * PLANT_ENERGY * this.plantFactor(g.diet) * (0.75 + 0.4 * g.efficiency + 0.025 * g.brainSize));
    }
  }

  eatMeat(c, m) {
    const g = c.genome;
    const bite = Math.min(m.amount, 1.4 * g.size);
    m.amount -= bite;
    c.energy = Math.min(c.maxEnergy, c.energy + bite * this.meatFactor(g.diet) * (0.8 + 0.4 * g.efficiency));
    if (m.amount <= 0) {
      const i = this.meat.indexOf(m);
      if (i >= 0) this.meat.splice(i, 1);
    }
  }

  attack(c, t, mult = 1) {
    const g = c.genome, tg = t.genome;
    const dmg = 0.045 * mult * g.size * (0.55 + g.aggression) * (0.5 + 0.95 * g.diet) * (0.8 + g.brainSize * 0.03) / Math.sqrt(tg.size);
    t.health -= dmg / (1 + 0.07 * Math.min(t.kinN, 8));
    t.lastAttacker = c.id;
    c.attackFlash = 5;
    c.energy -= 0.05;
    if (t.health <= 0) {
      this.kill(t, 'killed', c);
      c.kills++;
      // eat the fresh kill immediately
      const m = this.meat[this.meat.length - 1];
      if (m && this.meatFactor(g.diet) > 0.1) this.eatMeat(c, m);
    }
  }

  move(c) {
    const g = c.genome;
    if (c.speed <= 0.001) return;
    const slope = this.terrain.slopeAt(c.x, c.z);
    const h = this.terrain.heightAt(c.x, c.z);
    let terrainF = 1 / (1 + slope * 0.7);
    if (h > 21) terrainF *= 0.6;
    if (this.weather === 'Snow' && h > 8) terrainF *= 0.8;
    const young = c.age < MATURITY ? 0.75 : 1;
    const v = 0.26 * g.speed * (1 - 0.18 * g.efficiency) * terrainF * c.speed * young * (c.infected ? 0.7 : 1);
    let nx = c.x + Math.cos(c.heading) * v;
    let nz = c.z + Math.sin(c.heading) * v;
    if (!this.terrain.isLand(nx, nz)) {
      // turn away from the shoreline toward the island interior
      const toCenter = Math.atan2(-c.z, -c.x);
      c.heading = toCenter + this.rng.float(-1, 1);
      return;
    }
    c.x = nx; c.z = nz;
    c.moved = v;
  }

  metabolize(c) {
    const g = c.genome;
    const moveFrac = c.speed;
    const sizeCost = 0.035 + 0.032 * Math.pow(g.size, 1.5);
    const moveCost = 0.07 * g.size * g.speed * g.speed * moveFrac * moveFrac;
    const senseCost = 0.0028 * g.vision;
    const brainCost = 0.0045 * g.brainSize;
    let cost = (sizeCost + moveCost + senseCost + brainCost) * (1.28 - 0.5 * g.efficiency);
    if (c.action === ACTION.REST) cost *= this.warmth < -0.3 ? 0.35 : 0.55; // winter rest = hibernation
    // torpor: starving bodies slow their metabolism (smooths famine crashes)
    cost *= 0.55 + 0.45 * Math.min(1, c.energy / (c.maxEnergy * 0.45));
    // cold: winter / snow is harsh, especially for small bodies; shelters protect
    const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
    let cold = Math.max(0, -this.warmth) * 0.22 + (this.weather === 'Snow' ? 0.1 : 0);
    if (tribe && tribe.shelters > 0 && Math.hypot(tribe.x - c.x, tribe.z - c.z) < tribe.radius) cold *= 0.25;
    cost *= 1 + cold / g.size;
    if (this.weather === 'Heatwave') cost *= 1 + 0.15 * g.size;
    if (c.infected > 0) {
      c.infected--;
      cost += 0.06;
      c.health -= 0.0022 * (1 - g.immunity * 0.8);
      if (c.infected === 0) c.immuneTicks = 2400;
    }
    c.energy -= cost;
    if (c.energy > c.maxEnergy * 0.3 && c.health < 1) c.health = Math.min(1, c.health + (c.action === ACTION.REST ? 0.004 : 0.0012));
    if (c.energy <= 0) { c.energy = 0; c.health -= 0.012; }

    // asexual budding when very well fed (cells), sexual reproduction otherwise
    if (this.creatures.length + this.newborns.length < MAX_CREATURES - 30 && this.readyToBreed(c)) {
      const wellFed = c.energy > c.maxEnergy * (0.82 + 0.1 * (1 - g.fertility));
      if ((wellFed && (!c.mateId || g.sociability < 0.3)) || (!c.mateId && this.rng.chance(0.006))) this.reproduce(c, null);
    }

    if (c.health <= 0) this.kill(c, c.infected > 0 && c.energy > 0 ? 'plague' : c.energy <= 0 ? 'starved' : 'killed');
    else if (c.age > c.lifespan) this.kill(c, 'old');
  }

  reproduce(a, b) {
    if (this.creatures.length + this.newborns.length >= MAX_CREATURES - 10) return;
    let g;
    if (b) g = mutate(crossover(a.genome, b.genome, this.rng), this.rng);
    else g = mutate(cloneGenome(a.genome), this.rng);
    const share = b ? 0.3 : 0.42;
    let energy = a.energy * share;
    a.energy -= a.energy * share;
    if (b) { energy += b.energy * share; b.energy -= b.energy * share; b.reproCooldown = 260; b.childCount++; }
    a.reproCooldown = Math.round(280 - 120 * a.genome.fertility);
    a.childCount++;
    const [x, z] = [a.x + this.rng.float(-1, 1), a.z + this.rng.float(-1, 1)];
    const gen = Math.max(a.gen, b ? b.gen : 0) + 1;
    // communal child-rearing: the tribe feeds its newborns from the stores
    const tribe = a.tribeId > 0 ? tribeById(this, a.tribeId) : null;
    if (tribe && tribe.food > 1.5) { const share2 = Math.min(tribe.food - 1, 2.5); tribe.food -= share2; energy += share2 * PLANT_ENERGY * 0.8; }
    const child = this.addCreatureDeferred(g, this.terrain.isLand(x, z) ? x : a.x, this.terrain.isLand(x, z) ? z : a.z, {
      gen, parents: b ? [a.id, b.id] : [a.id], speciesId: a.speciesId, energy,
      tribeId: a.tribeId > 0 ? a.tribeId : -1,
    });
    child.heading = a.heading;
    this.births++;
  }

  addCreatureDeferred(g, x, z, opts) {
    const c = this.addCreature(g, x, z, opts);
    // addCreature pushed it into the live list; move it to newborns so the update loop stays stable
    this.creatures.pop();
    this.newborns.push(c);
    return c;
  }

  completeTrade(from, to, trader) {
    // exchange surpluses: food-rich camp trades food for stone, and vice versa
    const give = Math.min(from.food * 0.25, 6);
    const get = Math.min(to.stone * 0.25, 4);
    from.food -= give; to.food += give;
    to.stone -= get; from.stone += get; from.buildPoints += get;
    trader.carryFood = 0;
    const rel = from.relations.get(to.id) ?? 0;
    from.relations.set(to.id, clamp(rel + 0.1, -1, 1));
    to.relations.set(from.id, clamp((to.relations.get(from.id) ?? 0) + 0.1, -1, 1));
    from.trades++; to.trades++;
    this.totalTrades++;
    if (from.trades % 3 === 1) this.log('trade', `${from.name} traded ${give.toFixed(1)} food for ${get.toFixed(1)} stone with ${to.name}`, to.x, to.z);
  }

  // ---------------------------------------------------------------- god powers
  meteor(x, z) {
    const radius = 9;
    this.terrain.applyCrater(x, z, radius, 5);
    this.craters.push({ x, z, radius, depth: 5, tick: this.tick });
    let killed = 0;
    this.forEachNear(x, z, radius * 2, (c, d2) => {
      const d = Math.sqrt(d2);
      if (d < radius * 1.1) { this.kill(c, 'disaster'); killed++; }
      else { c.health -= 0.5 * (1 - d / (radius * 2)); c.heading = Math.atan2(c.z - z, c.x - x); if (c.health <= 0) { this.kill(c, 'disaster'); killed++; } }
    });
    for (let k = 0; k < this.plants.length; k++) {
      const [cx, cz] = this.cellCenter(k);
      const d = Math.hypot(cx - x, cz - z);
      if (d < radius * 2.2) this.plants[k] *= d / (radius * 2.2) * 0.3;
      if (d < radius * 0.8) { this.mineralCap[k] = Math.max(this.mineralCap[k], 1.2); this.minerals[k] = 1.2; }
    }
    for (const t of this.tribes) {
      if (t.alive && Math.hypot(t.x - x, t.z - z) < radius * 1.8) {
        t.buildPoints *= 0.2; t.food *= 0.3;
        this.log('disaster', `The meteor devastated the camp of ${t.name}`, t.x, t.z);
      }
    }
    this.log('meteor', `A meteor struck the island — ${killed} creatures perished`, x, z);
    return { x, z, radius, depth: 5, killed };
  }

  plague(x, z) {
    let n = 0;
    const r = 30;
    const targets = [];
    if (x != null) this.forEachNear(x, z, r, (c) => targets.push(c));
    else targets.push(...this.creatures);
    for (const c of targets) {
      if (this.rng.chance(x != null ? 0.6 : 0.2) && c.immuneTicks === 0) { c.infected = 420; n++; }
    }
    this.plagues++;
    this.log('plague', `A plague breaks out — ${n} creatures infected`, x, z);
    return n;
  }

  oasis(x, z) {
    const o = { x, z, r: 16, ttl: 4000 };
    this.oases.push(o);
    for (let k = 0; k < this.plants.length; k++) {
      const [cx, cz] = this.cellCenter(k);
      const d = Math.hypot(cx - x, cz - z);
      if (d < o.r && this.terrain.isLand(cx, cz)) {
        if (this.plantCap[k] < 0.5) this.plantCap[k] = 0.6;
        this.plants[k] = this.plantCap[k] * (1.5 + (1 - d / o.r));
      }
    }
    this.log('oasis', 'A lush food oasis blooms', x, z);
  }

  mutateCreature(id) {
    const c = this.byId.get(id);
    if (!c) return false;
    mutate(c.genome, this.rng, 4);
    c.genome.brainSize = clamp(c.genome.brainSize + this.rng.int(0, 3), 1, MAX_H);
    c.iq = intelligenceOf(c.genome.weights, c.genome.brainSize);
    c.maxEnergy = 55 + 55 * c.genome.size;
    c.energy = Math.min(c.energy, c.maxEnergy);
    const r = this.registry.get(id);
    if (r) { r.diet = c.genome.diet; r.hue = c.genome.hue; }
    this.log('mutate', `${c.name} was struck by divine mutation`, c.x, c.z);
    return true;
  }

  spawn(x, z, n = 10) {
    const base = randomGenome(this.rng);
    for (let i = 0; i < n; i++) {
      const g = cloneGenome(base);
      g.weights = randomGenome(this.rng).weights;
      const [px, pz] = this.landNear(x, z, 6);
      this.addCreature(g, px, pz);
    }
    this.log('abiogenesis', `${n} primordial cells were seeded`, x, z);
  }

  // ---------------------------------------------------------------- telemetry
  log(kind, text, x = null, z = null) {
    this.events.push({ seq: ++this.eventSeq, tick: this.tick, day: this.day, kind, text, x, z });
    if (this.events.length > 200) this.events.shift();
  }

  counts() {
    let herb = 0, omni = 0, carn = 0, iq = 0, gen = 0, social = 0;
    for (const c of this.creatures) {
      const d = c.genome.diet;
      if (d < 0.36) herb++; else if (d > 0.64) carn++; else omni++;
      iq += c.iq; gen += c.gen;
      if (c.tribeId > 0) social++;
    }
    const n = this.creatures.length || 1;
    let speciesAlive = 0;
    for (const s of this.species.values()) if (s.count > 0) speciesAlive++;
    const tribes = this.tribes.filter((t) => t.alive);
    let wars = 0;
    for (const t of tribes) wars += t.wars.size;
    return {
      total: this.creatures.length, herb, omni, carn,
      avgIQ: iq / n, avgGen: gen / n, inTribes: social,
      speciesAlive, extinctions: this.extinctions,
      tribes: tribes.length, wars: wars / 2,
    };
  }

  recordHistory() {
    const c = this.counts();
    this.history.push({ tick: this.tick, ...c });
    if (this.history.length > 400) this.history.shift();
  }

  get era() {
    const c = this.lastCounts || this.counts();
    if (c.wars > 0) return 'Age of War';
    if (c.tribes >= 3) return 'Tribal Age';
    if (c.tribes > 0) return 'Dawn of Tribes';
    if (c.avgIQ > 62) return 'Age of Instinct';
    return 'Primordial';
  }

  // ---------------------------------------------------------------- snapshots
  frameBuffer() {
    const cs = this.creatures;
    const buf = new Float32Array(cs.length * CREATURE_STRIDE);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const o = i * CREATURE_STRIDE;
      const g = c.genome;
      let r, gg, b;
      const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
      if (tribe) [r, gg, b] = tribe.rgb;
      else [r, gg, b] = hslToRgb(g.hue, 0.55 + 0.25 * g.diet, 0.52);
      let flags = 0;
      if (c.infected > 0) flags |= FLAG.INFECTED;
      if (g.diet > 0.64) flags |= FLAG.CARNIVORE; else if (g.diet >= 0.36) flags |= FLAG.OMNIVORE;
      if (tribe) flags |= FLAG.TRIBE;
      if (c.carryFood + c.carryStone > 0.3) flags |= FLAG.CARRY;
      if (c.attackFlash > 0) flags |= FLAG.ATTACK;
      if (c.age < MATURITY) flags |= FLAG.YOUNG;
      if (c.sleeping) flags |= FLAG.SLEEP;
      buf[o] = c.id;
      buf[o + 1] = c.x;
      buf[o + 2] = c.z;
      buf[o + 3] = c.heading;
      buf[o + 4] = g.size * (c.age < MATURITY ? 0.55 + 0.45 * (c.age / MATURITY) : 1);
      buf[o + 5] = r; buf[o + 6] = gg; buf[o + 7] = b;
      buf[o + 8] = flags;
      buf[o + 9] = c.action;
      buf[o + 10] = c.speed;
      buf[o + 11] = g.brainSize;
    }
    return buf;
  }

  resourceBuffers() {
    const N = FOOD_RES * FOOD_RES;
    const plants = new Uint8Array(N);
    const minerals = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      plants[k] = Math.min(255, Math.round((this.plants[k] / 1.6) * 255));
      minerals[k] = Math.min(255, Math.round((this.minerals[k] / 1.2) * 255));
    }
    const meat = new Float32Array(this.meat.length * 3);
    this.meat.forEach((m, i) => { meat[i * 3] = m.x; meat[i * 3 + 1] = m.z; meat[i * 3 + 2] = m.amount / m.max; });
    return { plants, minerals, meat, oases: this.oases.map((o) => ({ x: o.x, z: o.z, r: o.r, ttl: o.ttl })) };
  }

  campSnapshot() {
    return this.tribes.filter((t) => t.alive || this.tick - t.fallenTick < 1200).map((t) => ({
      id: t.id, name: t.name, color: t.color, x: t.x, z: t.z, radius: t.radius,
      level: t.level, shelters: t.shelters, members: t.members, food: t.food, stone: t.stone,
      alive: t.alive, wars: [...t.wars], allies: [...t.relations].filter(([, v]) => v > 0.2).map(([k]) => k),
      warTarget: t.warTarget, trades: t.trades, kills: t.kills, founded: t.founded, hoarded: t.hoarded,
      relations: Object.fromEntries(t.relations), age: this.tick - t.founded,
    }));
  }

  worldInfo() {
    return {
      tick: this.tick, elapsed: this.tick - this.startTick, day: this.day, timeOfDay: this.timeOfDay,
      season: this.season, seasonIndex: this.seasonIndex, yearPhase: this.yearPhase,
      weather: this.weather, daylight: this.daylight, sunElevation: this.sunElevation, warmth: this.warmth,
      era: this.era, lightning: this.lightning.slice(),
    };
  }

  inspect(id) {
    const c = this.byId.get(id);
    if (!c) {
      const r = this.registry.get(id);
      return r ? { id, dead: true, name: r.name, cause: r.cause, died: r.died } : null;
    }
    const g = c.genome;
    const fam = (pid, depth) => {
      const r = this.registry.get(pid);
      if (!r) return { id: pid, unknown: true };
      return {
        id: r.id, name: r.name, gen: r.gen, alive: r.alive, diet: r.diet, hue: r.hue, cause: r.cause,
        parents: depth > 0 ? r.parents.map((p) => fam(p, depth - 1)) : [],
      };
    };
    const reg = this.registry.get(id);
    const children = (reg ? reg.children : []).map((cid) => {
      const r = this.registry.get(cid);
      return r ? { id: r.id, name: r.name, alive: r.alive, gen: r.gen, diet: r.diet, hue: r.hue } : { id: cid, unknown: true };
    });
    const sp = this.species.get(c.speciesId);
    const tribe = c.tribeId > 0 ? tribeById(this, c.tribeId) : null;
    return {
      id: c.id, name: c.name, gen: c.gen, age: c.age, lifespan: c.lifespan,
      energy: c.energy / c.maxEnergy, health: c.health, x: c.x, z: c.z,
      action: c.action, intent: c.intent, thought: c.thought,
      diet: dietClass(g.diet), kills: c.kills, childCount: c.childCount, iq: c.iq,
      infected: c.infected > 0, carry: c.carryFood + c.carryStone,
      genome: {
        speed: g.speed, size: g.size, vision: g.vision, diet: g.diet, efficiency: g.efficiency,
        aggression: g.aggression, sociability: g.sociability, fertility: g.fertility,
        immunity: g.immunity, brainSize: g.brainSize, mutationRate: g.mutationRate, hue: g.hue,
      },
      species: sp ? { id: sp.id, name: sp.name, count: sp.count } : null,
      tribe: tribe ? { id: tribe.id, name: tribe.name, color: tribe.color } : null,
      inputs: Array.from(c.inputs),
      hidden: Array.from(c.hidden),
      outputs: Array.from(c.outputs),
      weights: Array.from(g.weights),
      family: { self: fam(id, 2), children },
    };
  }
}

export function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
export { hexToRgb };
