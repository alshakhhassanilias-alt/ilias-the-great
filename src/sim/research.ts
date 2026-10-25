/**
 * Research: the race that never ends.
 *
 * Five branches (industry, energy, digital, society, defence), each a ladder of ten named technologies from today's to
 * the late century, with a hard choice on rungs 3, 6 and 9 (take one road and the other closes). Past the tenth rung a
 * branch goes on for ever as frontier research, each level dearer than the last.
 *
 * Research points come from what you spend on education and R&D, how advanced you already are and the laws you pass;
 * a small country that invests as hard as a big one moves just as fast. Knowledge spreads: a technology half the world
 * already has costs far less than one nobody has, so being first is expensive and following is cheap.
 *
 * Every country researches (the AI by its own priorities), so the frontier keeps moving. What counts is where you stand
 * against the world: a country that out-researches the rest earns a growing productivity edge (and loses it again if it
 * falls behind); in defence, each level makes your forces hit harder and hold better than an enemy a level below.
 */
import { clamp } from './util';
import { hash01 } from './rng';
import { logEvent } from './log';
import { addRelation, alliesOf, getRelation } from './relations';
import { fund } from './actions';
import type { Country, GameState } from './types';

export type Branch = 0 | 1 | 2 | 3 | 4;
export const BRANCHES: { key: string; icon: string; name: string; short: string; frontier: string; color: string }[] = [
  { key: 'ind', icon: '🏭', name: 'Industry & Infrastructure', short: 'Industry', frontier: 'Advanced industry', color: '#d39a3c' },
  { key: 'nrg', icon: '⚡', name: 'Energy & Climate', short: 'Energy', frontier: 'Next-generation energy', color: '#4fae5a' },
  { key: 'dig', icon: '💻', name: 'Digital & AI', short: 'Digital', frontier: 'Frontier AI', color: '#4f8fd0' },
  { key: 'soc', icon: '🧬', name: 'Society & Health', short: 'Society', frontier: 'Life sciences', color: '#c16fb6' },
  { key: 'def', icon: '🛡', name: 'Defence', short: 'Defence', frontier: 'Next-generation weapons', color: '#c9533f' },
];
/** how much each branch counts toward the productivity race (defence buys strength, not growth) */
const ECON_W = [1, 0.6, 1, 0.6, 0];

/** What a technology does. One-off effects apply when it is researched; the rest last. */
export interface TechFx {
  // one-off
  energy?: number; eff?: number; food?: number; infra?: number; rep?: number; collection?: number; milTech?: number; tech?: number;
  // lasting
  stab?: number; off?: number; def?: number; cost?: number; manpower?: number; ops?: number; deter?: number; accept?: number; pc?: number; pop?: number;
}
export interface Tech { name: string; desc: string; fx: TechFx }
export interface Rung { alts: [Tech] | [Tech, Tech] }

const T = (name: string, desc: string, fx: TechFx): Tech => ({ name, desc, fx });
const one = (t: Tech): Rung => ({ alts: [t] });
const two = (a: Tech, b: Tech): Rung => ({ alts: [a, b] });

export const LADDERS: Rung[][] = [
  [ // industry
    one(T('Lean Manufacturing', 'Just-in-time supply chains and fewer idle machines.', { infra: 2 })),
    one(T('Industrial Robotics', 'Robot arms on every assembly line.', { tech: 1 })),
    two(T('Smart Ports & Logistics', 'Automated ports, rail freight and customs that move in hours, not days.', { infra: 4, accept: 0.02 }),
      T('Heavy Engineering', 'Steel, shipyards and machine tools at home: build anything you need.', { infra: 2, milTech: 1.5, cost: -0.02 })),
    one(T('Additive Manufacturing', '3D-printed parts in every workshop and depot.', { cost: -0.03 })),
    one(T('Advanced Materials', 'Graphene, composites and alloys lighter and stronger than steel.', { milTech: 1, tech: 1 })),
    two(T('Autonomous Freight', 'Driverless trucks, trains and ships carry the economy.', { infra: 5, manpower: 0.02 }),
      T('Megaproject Engineering', 'Bridges, tunnels and new cities built in years, not decades.', { infra: 8, stab: 1 })),
    one(T('Nanofabrication', 'Building things atom by atom.', { tech: 2 })),
    one(T('Self-Replicating Factories', 'Factories that build the next factory.', { cost: -0.05 })),
    two(T('Orbital Manufacturing', 'Foundries in orbit make what gravity spoils.', { rep: 3, milTech: 2 }),
      T('Arcology Cities', 'Self-contained vertical cities for millions.', { stab: 2, pop: 0.001 })),
    one(T('Post-Scarcity Industry', 'Goods so cheap that want itself becomes rare.', { stab: 2, tech: 2 })),
  ],
  [ // energy
    one(T('Utility-Scale Solar', 'Solar farms by the gigawatt.', { energy: 0.04 })),
    one(T('Grid Batteries', 'Store the noon sun for the evening peak.', { eff: 0.03 })),
    two(T('Nuclear Renaissance', 'Small modular reactors, built in factories, switched on in villages.', { energy: 0.08, stab: -1 }),
      T('Renewables at Scale', 'Wind and solar everywhere, and a clean name abroad.', { energy: 0.06, rep: 2 })),
    one(T('Green Hydrogen', 'Fuel for steel mills, ships and trucks, made from water.', { energy: 0.04, eff: 0.03 })),
    one(T('Smart Grids', 'A grid that thinks: every watt where it is needed.', { eff: 0.05 })),
    two(T('Carbon Capture', 'Pull the carbon back out of the air.', { energy: 0.03, rep: 3 }),
      T('Deep Geothermal', 'Drill deep enough and the Earth is a furnace.', { energy: 0.07 })),
    one(T('Solid-State Batteries', 'Batteries that charge in minutes and last decades.', { eff: 0.05, cost: -0.02 })),
    one(T('Space-Based Solar', 'Orbital mirrors beam power down day and night.', { energy: 0.08 })),
    two(T('Fusion Power', 'A star in a bottle: energy without limit.', { energy: 0.15 }),
      T('Climate Engineering', 'Cool the planet, save the harvests, anger the neighbours.', { food: 0.08, stab: 2, rep: -2 })),
    one(T('Room-Temperature Superconductors', 'No power lost on the wire, ever.', { eff: 0.1 })),
  ],
  [ // digital
    one(T('Cloud & 5G', 'Fast networks and computing on tap.', { collection: 0.01 })),
    one(T('Big-Data Government', 'A state that knows what it collects and who owes it.', { collection: 0.015 })),
    two(T('Open AI Ecosystem', 'Open models, start-ups and talent from everywhere.', { tech: 2, rep: 1 }),
      T('Sovereign AI Stack', 'Your own chips, your own models, your own secrets.', { ops: 0.05, stab: 1 })),
    one(T('Industrial AI', 'Machine learning in every factory and office.', { tech: 2 })),
    one(T('Quantum Computing', 'Break the old codes, keep your own.', { ops: 0.08 })),
    two(T('Digital Democracy', 'Open data, e-voting and a government that answers.', { stab: 2, rep: 2, pc: 0.1 }),
      T('Surveillance State', 'Cameras, scores and silence.', { stab: 3, ops: 0.05, rep: -4 })),
    one(T('General-Purpose Robots', 'Robots that do the work of people, at home and in the fields.', { manpower: 0.05 })),
    one(T('Brain-Computer Interfaces', 'Think it, and it is done.', { tech: 3 })),
    two(T('AI Civil Service', 'A state run by tireless, honest algorithms.', { collection: 0.03, pc: 0.15 }),
      T('Autonomous Cyber-Warfare', 'Machines that attack and defend networks on their own.', { ops: 0.12, off: 0.04 })),
    one(T('Artificial General Intelligence', 'A mind that can do anything a mind can.', { tech: 5, stab: 1 })),
  ],
  [ // society
    one(T('Telemedicine', 'A doctor in every phone.', { stab: 1 })),
    one(T('mRNA Vaccines', 'A new vaccine within weeks of a new disease.', { stab: 1 })),
    two(T('Universal Digital Education', 'Every child taught by the best teachers in the world.', { tech: 2 }),
      T('Vocational Revolution', 'Apprenticeships and skills for every trade.', { manpower: 0.03, stab: 1 })),
    one(T('Gene Therapy', 'Hereditary diseases cured at the root.', { pop: 0.0005, stab: 1 })),
    one(T('Personalised Medicine', 'Treatment written for your own genome.', { stab: 1 })),
    two(T('Longevity Medicine', 'Ninety is the new sixty.', { pop: 0.001, stab: 2 }),
      T('Precision Agriculture', 'Drones, sensors and seeds that double the harvest.', { food: 0.1 })),
    one(T('Lab-Grown Food', 'Meat and grain from bioreactors.', { food: 0.08, rep: 1 })),
    one(T('Cognitive Enhancement', 'Sharper minds, safely.', { tech: 2 })),
    two(T('Universal Basic Services', 'Housing, care and transport free to all.', { stab: 4 }),
      T('Meritocratic Academies', 'The brightest found early and pushed hard.', { tech: 3, stab: -1 })),
    one(T('Ageing Reversed', 'Old age becomes a treatable condition.', { pop: 0.0015, stab: 2 })),
  ],
  [ // defence
    one(T('Precision Munitions', 'Every shell guided to its target.', { off: 0.03, milTech: 1 })),
    one(T('Drone Warfare', 'Cheap drones in every platoon.', { off: 0.03, cost: -0.02, milTech: 1 })),
    two(T('Armoured Breakthrough', 'Modern tanks and the doctrine to use them.', { off: 0.05, milTech: 1 }),
      T('Layered Air Defence', 'Missiles and guns over every city and front.', { def: 0.06, deter: -0.04, milTech: 1 })),
    one(T('Network-Centric Warfare', 'Every soldier, drone and gun sees the same battlefield.', { off: 0.03, def: 0.03, milTech: 1 })),
    one(T('Hypersonic Missiles', 'Too fast to stop.', { off: 0.04, deter: -0.05, milTech: 1 })),
    two(T('Drone Swarms', 'Thousands of drones acting as one.', { off: 0.06, cost: -0.04, milTech: 1 }),
      T('Fortress Doctrine', 'Every border a wall of sensors, mines and bunkers.', { def: 0.08, milTech: 1 })),
    one(T('Directed-Energy Weapons', 'Lasers that knock drones and missiles out of the sky.', { def: 0.05, milTech: 1 })),
    one(T('Autonomous Combat Systems', 'Machines that fight where soldiers would die.', { manpower: 0.08, cost: -0.04, milTech: 1 })),
    two(T('Space Warfare', 'Control orbit, and you see and strike everything.', { off: 0.05, def: 0.03, deter: -0.05, milTech: 1 }),
      T('Strategic Missile Shield', 'No missile gets through.', { def: 0.1, deter: -0.08, milTech: 1 })),
    one(T('Powered Infantry', 'Exoskeletons and smart armour for every soldier.', { off: 0.04, def: 0.04, milTech: 1 })),
  ],
];
export const CHOICE_TIERS = [3, 6, 9];
/** frontier research: what each level beyond the tenth rung gives */
const FRONTIER_FX: TechFx[] = [{ infra: 1 }, { energy: 0.02 }, { tech: 0.5 }, { stab: 0.3 }, { off: 0.015, def: 0.015, milTech: 0.5 }];

/** Research state of one country. lv: rungs climbed per branch; lv0: where it started; acc: points toward the next rung. */
export interface Research { lv: number[]; lv0: number[]; acc: number[]; cur: number; pick: Record<string, 0 | 1>; grants?: number; got?: number;
  /** distance to the frontier at the start (see researchFactor) */ gap0?: number;
  /** the innovator's premium: output share earned by being first to master technologies (fades) */ lead?: number;
  /** rungs mastered first in the world */ firsts?: number;
  /** bumps whenever a rung is climbed or a road chosen (effect caches key on it) */ v?: number }
export const pickKey = (b: number, tier: number) => `${b}:${tier}`;

/** The technology at rung `tier` (1-based) of a branch, for this country's choices (or the given alternative). */
export function techAt(b: number, tier: number, alt?: 0 | 1, rs?: Research): Tech {
  if (tier > 10) return { name: `${BRANCHES[b].frontier} ${tier - 10}`, desc: 'Frontier research: each level is harder than the last, and keeps you ahead of the world.', fx: FRONTIER_FX[b] };
  const rung = LADDERS[b][tier - 1];
  const a = alt ?? (rs?.pick[pickKey(b, tier)] ?? 0);
  return rung.alts[Math.min(a, rung.alts.length - 1)];
}
export const isChoice = (tier: number) => tier <= 10 && LADDERS[0][tier - 1] && CHOICE_TIERS.includes(tier);

// ------------------------------------------------------------------ set-up
export function initResearch(c: Country): Research {
  const t = c.eco.tech;
  const base = clamp(Math.round((t - 22) / 17), 0, 4);
  const e = c.eco;
  const nrgBonus = e.energyCap > e.energyDemand * 1.2 ? 1 : 0;
  const def = clamp(Math.round((c.mil.milTech - 22) / 17), 0, 5);
  const lv = [base, clamp(base - 1 + nrgBonus, 0, 4), base, base, def];
  // countries that start past a choice rung pick the road most like them
  const rs: Research = { lv: [...lv], lv0: [...lv], acc: [0, 0, 0, 0, 0], cur: -1, pick: {} };
  for (let b = 0; b < 5; b++) for (const k of CHOICE_TIERS) if (lv[b] >= k) rs.pick[pickKey(b, k)] = aiAlt(c, b, k);
  return rs;
}
export function ensureResearch(c: Country): Research {
  if (!c.rs) c.rs = initResearch(c);
  return c.rs;
}

// ------------------------------------------------------------------ costs and points
/** The world's knowledge, refreshed monthly and kept in the game state (so a saved game continues exactly as it would
 *  have): for each branch, how many of the 60 largest economies hold each rung, the frontier, and the leaders. */
export interface WorldResearch { t: number; known: number[][]; frontier: number[]; leaders: number[][] }
function computeWorld(s: GameState): WorldResearch {
  const big = s.countries.filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 60);
  const known: number[][] = [], frontier = [0, 0, 0, 0, 0], leaders: number[][] = [];
  for (let b = 0; b < 5; b++) {
    const lvls = big.map((c) => ensureResearch(c).lv[b]);
    frontier[b] = Math.max(0, ...s.countries.filter((c) => c.alive).map((c) => ensureResearch(c).lv[b]));
    known[b] = [];
    for (let t = 1; t <= frontier[b] + 1; t++) known[b][t] = lvls.filter((v) => v >= t).length / Math.max(1, lvls.length);
    leaders[b] = s.countries.filter((c) => c.alive).sort((x, y) => (y.rs?.lv[b] ?? 0) - (x.rs?.lv[b] ?? 0) || y.eco.gdp - x.eco.gdp).slice(0, 3).map((c) => c.id);
  }
  return { t: s.tick, known, frontier, leaders };
}
export function worldResearch(s: GameState): WorldResearch {
  if (!s.rsw) s.rsw = computeWorld(s);
  return s.rsw;
}
const econLevel = (lv: number[]) => lv.reduce((t, v, i) => t + v * ECON_W[i], 0);

/** Research cost of the next rung of a branch for a country (in research points). Knowledge others hold is cheaper. */
export function rungCost(s: GameState, c: Country, b: number): number {
  const rs = ensureResearch(c);
  const tier = rs.lv[b] + 1;
  const base = 0.9 * Math.pow(1.2, Math.min(tier, 6) - 1) * Math.pow(1.3, Math.max(0, Math.min(tier, 10) - 6)) * Math.pow(1.25, Math.max(0, tier - 10));
  const w = worldResearch(s);
  const share = w.known[b]?.[tier] ?? 0;
  // spillovers from allies who already know it
  const allyKnows = alliesOf(s, c.id).some((a) => (s.countries[a].rs?.lv[b] ?? 0) >= tier);
  return base * (1 - 0.5 * share) * (allyKnows ? 0.85 : 1);
}

export interface RpPart { label: string; v: number }
/** Research points a year, with the reasons. */
export function researchPoints(s: GameState, c: Country): { v: number; parts: RpPart[] } {
  const b = c.budget, e = c.eco;
  const edu = clamp(Math.pow(Math.max(0.005, b.education) / 0.05, 0.8), 0.25, 2.2);
  const parts: RpPart[] = [{ label: `Education & R&D budget (${(b.education * 100).toFixed(1)}% of GDP)`, v: edu }];
  parts.push({ label: `How advanced you already are (technology ${e.tech.toFixed(0)})`, v: (0.5 + e.tech / 100) * edu - edu });
  let mult = 1;
  const laws = c.politics?.laws ?? [];
  if (laws.some((l) => l.id === 'tech_fund')) { mult += 0.15; parts.push({ label: 'National Technology Fund', v: 0 }); }
  if (laws.some((l) => l.id === 'open_migration')) { mult += 0.06; parts.push({ label: 'Open labour migration', v: 0 }); }
  const friends = alliesOf(s, c.id).filter((a) => (s.countries[a].rs?.lv[2] ?? 0) > (c.rs?.lv[2] ?? 0)).length;
  if (friends) { mult += Math.min(0.2, 0.025 * friends); parts.push({ label: `Knowledge from ${friends} more advanced all${friends > 1 ? 'ies' : 'y'}`, v: 0 }); }
  if (e.stability < 40) { mult -= 0.2; parts.push({ label: 'Turmoil at home', v: 0 }); }
  if (c.mil.exhaustion > 0.3) { mult -= 0.15; parts.push({ label: 'War drains the laboratories', v: 0 }); }
  const raw = (0.5 + e.tech / 100) * edu;
  const v = Math.max(0.05, raw * mult);
  // the multipliers, shown as points
  for (const p of parts) if (p.v === 0) p.v = NaN;
  const mPart = v - raw;
  return { v, parts: [...parts.filter((p) => !Number.isNaN(p.v)), ...(Math.abs(mPart) > 0.005 ? [{ label: 'Laws, allies and circumstances', v: mPart }] : [])] };
}

// ------------------------------------------------------------------ effects
const lastingKeys = ['stab', 'off', 'def', 'cost', 'manpower', 'ops', 'deter', 'accept', 'pc', 'pop'] as const;
export type Lasting = Record<(typeof lastingKeys)[number], number>;
const lastingCache = new WeakMap<object, { key: string; v: Lasting }>();
/** The lasting effects of everything researched since the start (the starting rungs are already in the calibration). */
export function researchLasting(c: Country): Lasting {
  const rs = c.rs;
  const zero: Lasting = { stab: 0, off: 0, def: 0, cost: 0, manpower: 0, ops: 0, deter: 0, accept: 0, pc: 0, pop: 0 };
  if (!rs) return zero;
  const key = `${rs.v ?? 0}|${rs.lv[0]}${rs.lv[4]}`;
  const hit = lastingCache.get(c);
  if (hit && hit.key === key) return hit.v;
  const v = { ...zero };
  for (let b = 0; b < 5; b++) for (let t = rs.lv0[b] + 1; t <= rs.lv[b]; t++) {
    const fx = techAt(b, t, undefined, rs).fx;
    for (const k of lastingKeys) v[k] += fx[k] ?? 0;
  }
  // stability from research has diminishing returns (a century of frontier medicine does not make a paradise)
  v.stab = v.stab > 0 ? 8 * (1 - Math.exp(-v.stab / 8)) : v.stab;
  lastingCache.set(c, { key, v });
  return v;
}
export const researchKey = (c: Country) => (c.rs ? c.rs.v ?? 0 : -1);

function applyOneOff(c: Country, fx: TechFx) {
  const e = c.eco;
  if (fx.energy) e.energyCap *= 1 + fx.energy;
  if (fx.eff) e.prev.eInt *= 1 - fx.eff;
  if (fx.food) e.foodCap *= 1 + fx.food;
  if (fx.infra) e.infra = clamp(e.infra + fx.infra, 5, 100);
  if (fx.rep) c.reputation = clamp(c.reputation + fx.rep, 0, 100);
  if (fx.collection) e.collection = clamp(e.collection + fx.collection, 0.3, 1);
  if (fx.milTech) c.mil.milTech = clamp(c.mil.milTech + fx.milTech, 0, 140);
  if (fx.tech) e.tech = clamp(e.tech + fx.tech, 5, 100);
  if (fx.pop) e.popGrowthMod += fx.pop;
}

/** How far behind the world's frontier a country stands, weighted by what counts for the economy (0 = at the frontier). */
function frontierGap(s: GameState, lv: number[]): number {
  const w = worldResearch(s);
  let g = 0;
  for (let b = 0; b < 5; b++) g += ECON_W[b] * Math.min(0, lv[b] - (w.frontier[b] ?? 0));
  return g;
}
/**
 * The productivity edge (or lag) from research: closing the distance to the world's frontier since the start lifts
 * output, falling further behind lowers it, and being the first to master a technology pays an innovator's premium
 * that fades over a few years. An output multiplier.
 */
export function researchFactor(s: GameState, c: Country): number {
  const rs = c.rs;
  if (!rs) return 1;
  const gap0 = rs.gap0 ?? frontierGap(s, rs.lv0); // set once, in the simulation (stepResearch)
  return clamp(Math.exp(0.016 * (frontierGap(s, rs.lv) - gap0)) * (1 + (rs.lead ?? 0)), 0.85, 1.25);
}

/** Describe a technology's effects in words. */
export function fxText(fx: TechFx, b?: number): string[] {
  const out: string[] = [];
  const pc = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(v * 100 % 1 ? 1 : 0)}%`;
  if (b !== undefined && ECON_W[b] > 0) out.push(`Output ${ECON_W[b] === 1 ? '+1.6%' : '+1%'} for each rung you close on the frontier`);
  if (fx.energy) out.push(`Energy output ${pc(fx.energy)}`);
  if (fx.eff) out.push(`Energy needed ${pc(-fx.eff)}`);
  if (fx.food) out.push(`Food output ${pc(fx.food)}`);
  if (fx.infra) out.push(`Infrastructure +${fx.infra}`);
  if (fx.rep) out.push(`Reputation ${fx.rep > 0 ? '+' : '−'}${Math.abs(fx.rep)}`);
  if (fx.collection) out.push(`Tax collection ${pc(fx.collection)}`);
  if (fx.tech) out.push(`Technology +${fx.tech}`);
  if (fx.milTech) out.push(`Military technology +${fx.milTech}`);
  if (fx.stab) out.push(`Stability ${fx.stab > 0 ? '+' : '−'}${Math.abs(fx.stab)}`);
  if (fx.off) out.push(`Attack ${pc(fx.off)}`);
  if (fx.def) out.push(`Defence ${pc(fx.def)}`);
  if (fx.cost) out.push(`Army costs ${pc(fx.cost)}`);
  if (fx.manpower) out.push(`Manpower ${pc(fx.manpower)}`);
  if (fx.ops) out.push(`Covert operations ${pc(fx.ops)}`);
  if (fx.deter) out.push(`Enemies' appetite to attack ${pc(fx.deter)}`);
  if (fx.accept) out.push(`Treaties accepted more readily`);
  if (fx.pc) out.push(`Political capital +${fx.pc.toFixed(2)} a week`);
  if (fx.pop) out.push(`Population growth +${(fx.pop * 100).toFixed(2)}% a year`);
  return out;
}

// ------------------------------------------------------------------ the AI's choices
function aiAlt(c: Country, b: number, tier: number): 0 | 1 {
  const agg = c.ai?.aggression ?? 0.5, auto = c.gov === 'A' || c.gov === 'C' || c.gov === 'M';
  if (b === 2 && tier === 6) return auto ? 1 : 0; // digital democracy or a surveillance state
  if (b === 4) return agg > 0.75 ? 0 : 1; // attack or defence
  if (b === 1 && tier === 3) return (hash01('nuc', c.id) < 0.5 ? 0 : 1);
  return hash01('alt', c.id, b * 10 + tier) < 0.5 ? 0 : 1;
}
/** Which branch an AI country pushes now (weighted by its needs and temperament). */
function aiBranch(s: GameState, c: Country): number {
  const rs = c.rs!, e = c.eco;
  const w = [1 + (c.ai?.trade ?? 0.5) * 0.6, 0.8 + (e.energyCap < e.energyDemand ? 0.6 : 0), 1 + e.tech / 120, 0.8 + (e.stability < 50 ? 0.4 : 0), 0.5 + (c.ai?.aggression ?? 0.5) * 0.8];
  // lagging branches catch up (cheap knowledge), so nobody neglects a branch for ever
  const mean = rs.lv.reduce((t, v) => t + v, 0) / 5;
  let best = 0, bv = -1;
  for (let b = 0; b < 5; b++) {
    const v = w[b] * (1 + 0.35 * (mean - rs.lv[b])) * (0.8 + 0.4 * hash01('rb', c.id, b, Math.floor(s.tick / 52)));
    if (v > bv) { bv = v; best = b; }
  }
  return best;
}

// ------------------------------------------------------------------ the weekly step
function complete(s: GameState, c: Country, b: number) {
  const rs = c.rs!;
  const tier = rs.lv[b] + 1;
  if (isChoice(tier) && rs.pick[pickKey(b, tier)] === undefined) rs.pick[pickKey(b, tier)] = aiAlt(c, b, tier);
  rs.lv[b] = tier;
  rs.got = (rs.got ?? 0) + 1;
  rs.v = (rs.v ?? 0) + 1;
  const tech = techAt(b, tier, undefined, rs);
  applyOneOff(c, tech.fx);
  const w = worldResearch(s);
  const first = tier > (w.frontier[b] ?? 0);
  if (first) {
    w.frontier[b] = tier;
    rs.lead = Math.min(0.08, (rs.lead ?? 0) + 0.012 * ECON_W[b]);
    rs.firsts = (rs.firsts ?? 0) + 1;
  }
  if (c.id === s.player) {
    logEvent(s, `${BRANCHES[b].icon} RESEARCH COMPLETE: ${tech.name}${first ? ' — the first nation on Earth to master it' : ''}. ${fxText(tech.fx).slice(0, 3).join(' · ')}.`, 'econ', [c.id], true, first ? { big: true, prov: c.capital } : undefined);
    s.stats.techsDone = (s.stats.techsDone ?? 0) + 1;
  } else if (first && tier >= 5 && c.eco.gdp > 5e11) {
    logEvent(s, `${BRANCHES[b].icon} ${c.name} is the first nation to master ${tech.name}.`, 'econ', [c.id], tier >= 8);
  }
}

export function stepResearch(s: GameState) {
  if (s.tick % 4 === 0 || !s.rsw) s.rsw = computeWorld(s);
  for (const c of s.countries) {
    if (c.alive && c.rs && c.rs.gap0 === undefined) c.rs.gap0 = frontierGap(s, c.rs.lv0);
  }
  for (const c of s.countries) {
    if (!c.alive) continue;
    const rs = ensureResearch(c);
    const player = c.id === s.player;
    if (!player && s.tick % 4 !== c.id % 4) continue;
    if (s.tick % 4 === c.id % 4) {
      if (rs.lead) rs.lead = rs.lead < 0.0005 ? 0 : rs.lead * Math.pow(0.85, 4 / 52); // the premium fades by about 15% a year
      c.eco.prev.rsF = researchFactor(s, c);
    }
    const weeks = player ? 1 : 4;
    const rp = researchPoints(s, c).v * weeks / 52;
    let b = player ? rs.cur : aiBranch(s, c);
    if (player && b < 0) b = aiBranch(s, c); // nothing chosen: the ministry picks (the Research tab says so)
    rs.acc[b] += rp;
    const cost = rungCost(s, c, b);
    if (rs.acc[b] >= cost) {
      rs.acc[b] -= cost;
      complete(s, c, b);
      if (player) {
        // keep going on the same branch unless the next rung is a choice the player must make
        if (isChoice(rs.lv[b] + 1) && rs.pick[pickKey(b, rs.lv[b] + 1)] === undefined) rs.cur = -1;
      }
    }
  }
}

// ------------------------------------------------------------------ player actions
export function actSetResearch(s: GameState, b: number, alt?: 0 | 1) {
  const c = s.countries[s.player];
  const rs = ensureResearch(c);
  if (b < 0 || b > 4) return { ok: false, message: 'Unknown branch' };
  const tier = rs.lv[b] + 1;
  if (isChoice(tier)) {
    if (alt === undefined && rs.pick[pickKey(b, tier)] === undefined) return { ok: false, message: 'Choose one of the two roads first' };
    if (alt !== undefined) { rs.pick[pickKey(b, tier)] = alt; rs.v = (rs.v ?? 0) + 1; }
  }
  rs.cur = b;
  return { ok: true, message: `Your scientists turn to ${techAt(b, tier, undefined, rs).name}.` };
}

/** A research grant: money for points, once a quarter. */
export const GRANT_COOLDOWN = 13;
export function actResearchGrant(s: GameState) {
  const c = s.countries[s.player];
  const rs = ensureResearch(c);
  if (s.tick - (rs.grants ?? -999) < GRANT_COOLDOWN) return { ok: false, message: `Again in ${GRANT_COOLDOWN - (s.tick - (rs.grants ?? 0))} weeks` };
  const b = rs.cur >= 0 ? rs.cur : 0;
  const f = fund(s, c.id, 0.003 * c.eco.gdp, 'Research grants');
  if (!f.ok) return f;
  rs.grants = s.tick;
  rs.acc[b] += 0.25 * rungCost(s, c, b);
  return { ok: true, message: `Crash grants for ${techAt(b, rs.lv[b] + 1, undefined, rs).name}: a quarter of the way there. ${f.message}` };
}

/** Who you could steal the current technology from, and the odds. */
export function espionageTarget(s: GameState, c: Country): { id: number; p: number } | null {
  const rs = ensureResearch(c);
  const b = rs.cur;
  if (b < 0) return null;
  const tier = rs.lv[b] + 1;
  const cands = s.countries.filter((x) => x.alive && x.id !== c.id && (x.rs?.lv[b] ?? 0) >= tier);
  if (!cands.length) return null;
  const t = cands.sort((a, b2) => getRelation(s, c.id, a.id) - getRelation(s, c.id, b2.id))[0];
  const p = clamp(0.35 + 0.5 * (c.mil.intel - t.mil.intel), 0.15, 0.8);
  return { id: t.id, p };
}
export const SPY_COOLDOWN = 52;
export function actEspionage(s: GameState, roll: number) {
  const c = s.countries[s.player];
  const rs = ensureResearch(c);
  if (s.tick - (s.stats.spyAt ?? -999) < SPY_COOLDOWN) return { ok: false, message: `Your agents lie low for ${SPY_COOLDOWN - (s.tick - (s.stats.spyAt ?? 0))} more weeks` };
  const tg = espionageTarget(s, c);
  if (!tg) return { ok: false, message: 'Nobody has this technology yet: there is nothing to steal' };
  if (c.politics && c.politics.pc < 10) return { ok: false, message: 'Needs 10 political capital' };
  if (c.politics) c.politics.pc -= 10;
  s.stats.spyAt = s.tick;
  const T2 = s.countries[tg.id];
  if (roll < tg.p) {
    rs.acc[rs.cur] += 0.6 * rungCost(s, c, rs.cur);
    return { ok: true, message: `Your agents copied ${T2.name}'s blueprints: most of the way to ${techAt(rs.cur, rs.lv[rs.cur] + 1, undefined, rs).name}.` };
  }
  addRelation(s, c.id, T2.id, -20);
  c.reputation = clamp(c.reputation - 3, 0, 100);
  logEvent(s, `🕵 Your spies were caught stealing technology from ${T2.name}. Relations −20, reputation −3.`, 'danger', [c.id, T2.id], true);
  return { ok: false, message: `Caught in ${T2.name}. A diplomatic scandal.` };
}

/** Your standing in a branch: rank among all countries and how far behind the frontier. */
export function branchStanding(s: GameState, c: Country, b: number) {
  const lv = ensureResearch(c).lv[b];
  const w = worldResearch(s);
  const rank = 1 + s.countries.filter((x) => x.alive && (x.rs?.lv[b] ?? 0) > lv).length;
  return { lv, frontier: w.frontier[b], rank, leaders: w.leaders[b] ?? [] };
}
