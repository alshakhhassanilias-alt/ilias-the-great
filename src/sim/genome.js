// Genetic DNA: physical / behavioural traits + neural weights. Mutation & crossover.
import { clamp } from './rng.js';
import { randomWeights, WEIGHT_COUNT, MAX_H } from './brain.js';

// [name, min, max, mutationScale]
export const TRAITS = [
  ['speed', 0.6, 1.8, 0.08],
  ['size', 0.6, 1.8, 0.08],
  ['vision', 6, 26, 1.5],
  ['diet', 0, 1, 0.06],
  ['efficiency', 0, 1, 0.06],
  ['aggression', 0, 1, 0.07],
  ['sociability', 0, 1, 0.07],
  ['fertility', 0, 1, 0.06],
  ['immunity', 0, 1, 0.05],
  ['hue', 0, 1, 0.02],
  ['mutationRate', 0.03, 0.3, 0.015],
];
export const TRAIT_NAMES = TRAITS.map((t) => t[0]);

export function randomGenome(rng, template = {}) {
  const g = {};
  for (const [name, min, max] of TRAITS) g[name] = template[name] ?? rng.float(min, max);
  g.brainSize = template.brainSize ?? rng.int(2, 4);
  g.weights = randomWeights(rng);
  return g;
}

export function cloneGenome(g) {
  const c = { ...g };
  c.weights = new Float32Array(g.weights);
  return c;
}

export function mutate(g, rng, strength = 1) {
  const rate = g.mutationRate * strength;
  for (const [name, min, max, scale] of TRAITS) {
    if (rng.chance(Math.min(0.9, rate * 2.2))) {
      if (name === 'hue') g.hue = (g.hue + rng.gauss() * scale * strength + 1) % 1;
      else g[name] = clamp(g[name] + rng.gauss() * scale * strength * (max - min) * 0.6, min, max);
    }
  }
  if (rng.chance(rate * 0.9)) g.brainSize = clamp(g.brainSize + (rng.chance(0.62) ? 1 : -1), 1, MAX_H);
  const w = g.weights;
  for (let i = 0; i < WEIGHT_COUNT; i++) {
    if (rng.next() < rate) w[i] = clamp(w[i] + rng.gauss() * 0.45 * strength, -4, 4);
  }
  return g;
}

export function crossover(a, b, rng) {
  const c = {};
  for (const [name] of TRAITS) {
    const t = rng.next();
    c[name] = name === 'hue' ? (rng.chance(0.5) ? a.hue : b.hue) : a[name] * t + b[name] * (1 - t);
  }
  c.brainSize = rng.chance(0.5) ? a.brainSize : b.brainSize;
  c.weights = new Float32Array(WEIGHT_COUNT);
  // uniform crossover by hidden-neuron blocks keeps functional units intact
  const cut = rng.int(0, WEIGHT_COUNT);
  for (let i = 0; i < WEIGHT_COUNT; i++) c.weights[i] = i < cut ? a.weights[i] : b.weights[i];
  return c;
}

// Normalised trait distance (ignores neural weights) — used for speciation & tribe kinship.
export function geneticDistance(a, b) {
  let d = 0;
  d += Math.abs(a.speed - b.speed) / 1.2;
  d += Math.abs(a.size - b.size) / 1.2;
  d += Math.abs(a.vision - b.vision) / 20;
  d += Math.abs(a.diet - b.diet) * 2.2;
  d += Math.abs(a.aggression - b.aggression);
  d += Math.abs(a.sociability - b.sociability);
  d += Math.abs(a.efficiency - b.efficiency) * 0.5;
  d += Math.abs(a.brainSize - b.brainSize) / 8;
  const dh = Math.abs(a.hue - b.hue);
  d += Math.min(dh, 1 - dh) * 2;
  return d / 6;
}

export function dietClass(diet) {
  return diet < 0.36 ? 'herbivore' : diet > 0.64 ? 'carnivore' : 'omnivore';
}
