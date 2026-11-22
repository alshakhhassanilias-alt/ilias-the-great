// Procedural island terrain shared (deterministically) by the sim worker and the renderer.
import { createNoise2D, fbm, ridged } from './noise.js';
import { clamp, smoothstep } from './rng.js';
import { WORLD_SIZE, HALF, TERRAIN_RES, BIOME } from './constants.js';

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.res = TERRAIN_RES;
    this.cell = WORLD_SIZE / (TERRAIN_RES - 1);
    this.heights = new Float32Array(TERRAIN_RES * TERRAIN_RES);
    this.moisture = new Float32Array(TERRAIN_RES * TERRAIN_RES);
    this.craters = [];
    this.generate();
  }

  generate() {
    const n1 = createNoise2D(this.seed);
    const n2 = createNoise2D(this.seed + 101);
    const n3 = createNoise2D(this.seed + 202);
    const n4 = createNoise2D(this.seed + 303);
    const R = this.res;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const x = -HALF + i * this.cell;
        const z = -HALF + j * this.cell;
        // domain-warped radial island mask
        const wx = x + fbm(n2, x * 0.008, z * 0.008, 3) * 30;
        const wz = z + fbm(n2, x * 0.008 + 50, z * 0.008 + 50, 3) * 30;
        const d = Math.sqrt(wx * wx + wz * wz) / HALF;
        const island = 1 - smoothstep(0.5, 0.97, d);
        const base = fbm(n1, x * 0.011, z * 0.011, 5) * 0.5 + 0.5; // 0..1
        let h = (base * 0.7 + 0.45) * island; // 0..1.15
        // mountain spine
        const ridge = ridged(n3, x * 0.014, z * 0.014, 4);
        const mountainMask = smoothstep(0.5, 0.85, h) * smoothstep(0.65, 0.15, d);
        let height = (h - 0.36) * 22 + ridge * mountainMask * 26;
        if (island < 0.02) height = Math.min(height, -6);
        // gentle beaches
        if (height > -1 && height < 1.6) height = height * 0.75;
        const k = j * R + i;
        this.heights[k] = clamp(height, -14, 40);
        this.moisture[k] = fbm(n4, x * 0.02, z * 0.02, 3);
      }
    }
  }

  idx(i, j) {
    return clamp(j, 0, this.res - 1) * this.res + clamp(i, 0, this.res - 1);
  }

  heightAt(x, z) {
    const fx = (x + HALF) / this.cell;
    const fz = (z + HALF) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h00 = this.heights[this.idx(i, j)];
    const h10 = this.heights[this.idx(i + 1, j)];
    const h01 = this.heights[this.idx(i, j + 1)];
    const h11 = this.heights[this.idx(i + 1, j + 1)];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  moistureAt(x, z) {
    const i = Math.round((x + HALF) / this.cell);
    const j = Math.round((z + HALF) / this.cell);
    return this.moisture[this.idx(i, j)];
  }

  slopeAt(x, z) {
    const e = 1.2;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  biomeAt(x, z) {
    return biomeFor(this.heightAt(x, z), this.moistureAt(x, z), this.slopeAt(x, z));
  }

  isLand(x, z) {
    if (x < -HALF + 2 || x > HALF - 2 || z < -HALF + 2 || z > HALF - 2) return false;
    return this.heightAt(x, z) > 0.35;
  }

  // Meteor crater: bowl with raised rim. Deterministic so both threads stay in sync.
  applyCrater(cx, cz, radius, depth) {
    this.craters.push({ cx, cz, radius, depth });
    const R = this.res;
    const r2 = radius * 1.6;
    const i0 = Math.max(0, Math.floor((cx - r2 + HALF) / this.cell));
    const i1 = Math.min(R - 1, Math.ceil((cx + r2 + HALF) / this.cell));
    const j0 = Math.max(0, Math.floor((cz - r2 + HALF) / this.cell));
    const j1 = Math.min(R - 1, Math.ceil((cz + r2 + HALF) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * this.cell, z = -HALF + j * this.cell;
        const d = Math.hypot(x - cx, z - cz) / radius;
        if (d > 1.6) continue;
        let dh;
        if (d < 1) dh = -depth * (1 - d * d);
        else dh = depth * 0.35 * Math.cos(((d - 1) / 0.6) * Math.PI * 0.5) ** 2;
        const k = j * R + i;
        // never punch below the sea floor too hard; keep it a dry crater if on land
        const h = this.heights[k] + dh;
        this.heights[k] = Math.max(h, Math.min(this.heights[k], 0.6));
      }
    }
    return { i0, i1, j0, j1 };
  }
}

export function biomeFor(h, m, slope = 0) {
  if (h < -1.5) return BIOME.DEEP;
  if (h < 0.2) return BIOME.SHALLOW;
  if (h < 1.3) return BIOME.SAND;
  if (h > 21) return BIOME.SNOW;
  if (h > 12.5 || slope > 1.25) return BIOME.ROCK;
  if (m > 0.08 && h > 1.8) return BIOME.FOREST;
  return BIOME.GRASS;
}
