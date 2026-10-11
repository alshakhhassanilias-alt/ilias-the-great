/**
 * Client-side map geometry: Path2D per province, runtime union outlines of each owner's territory
 * (so borders redraw correctly when provinces change hands), label anchors and hit-testing.
 * Geographic data (world.json) stays separate from simulation logic.
 */
import type { Geo } from '../sim/geo';
import type { GameState } from '../sim/types';

type Pt = [number, number];
type MPoly = Pt[][][];

export interface EdgePath { n: number; path: Path2D }
export interface LabelInfo { anchor: Pt; w: number; h: number; area: number }
/** A curved label baseline through a country's main landmass: v(t) = a·t² + b·t + c in the (u, n) frame around (mx, my). */
export interface LabelCurve { mx: number; my: number; ux: number; uy: number; nx: number; ny: number; t0: number; len: number; a: number; b: number; c: number; thick: number; area: number }

function toMPoly(poly: number[][][]): MPoly {
  return poly.map((rings) => rings.map((flat) => {
    const r: Pt[] = [];
    for (let i = 0; i < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10]);
    return r;
  }));
}
function pathOf(mp: MPoly): Path2D {
  const path = new Path2D();
  for (const poly of mp) for (const ring of poly) {
    ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  return path;
}

export class MapGeometry {
  readonly provPaths: Path2D[];
  /** boundary runs per province (precomputed at build time): national borders are the runs whose two sides have different owners */
  readonly edgePaths: EdgePath[][];
  private hit: CanvasRenderingContext2D;
  bounds: [number, number, number, number] = [0, 0, 1000, 450];

  constructor(public geo: Geo) {
    this.provPaths = geo.provinces.map((p) => pathOf(toMPoly(p.poly)));
    this.edgePaths = geo.provinces.map((p) => p.edges.map((e) => {
      const path = new Path2D();
      for (let i = 0; i < e.pts.length; i += 2) {
        if (i === 0) path.moveTo(e.pts[0] / 10, e.pts[1] / 10); else path.lineTo(e.pts[i] / 10, e.pts[i + 1] / 10);
      }
      return { n: e.n, path };
    }));
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    this.hit = c.getContext('2d')!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of geo.provinces) { x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1]); x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3]); }
    this.bounds = [x0, y0, x1, y1];
  }

  /** Province under a world-space point (with tolerance for tiny islands). */
  pick(wx: number, wy: number, tol: number): number | null {
    const provs = this.geo.provinces;
    for (let i = 0; i < provs.length; i++) {
      const b = provs[i].bbox;
      if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;
      if (this.hit.isPointInPath(this.provPaths[i], wx, wy, 'evenodd')) return i;
    }
    let best = -1, bd = tol;
    for (let i = 0; i < provs.length; i++) {
      const b = provs[i].bbox;
      if (wx < b[0] - tol || wx > b[2] + tol || wy < b[1] - tol || wy > b[3] + tol) continue;
      if (provs[i].area > 25) continue;
      const d = Math.hypot(provs[i].seed[0] - wx, provs[i].seed[1] - wy);
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? best : null;
  }

  /** Label placement: the largest connected landmass an owner holds. */
  labelInfo(state: GameState, owner: number): LabelInfo | null {
    const c = state.countries[owner];
    if (!c.alive || !c.provinces.length) return null;
    const provs = this.geo.provinces;
    const mine = new Set(c.provinces);
    let start = c.provinces[0];
    for (const p of c.provinces) if (provs[p].area > provs[start].area) start = p;
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const p = stack.pop()!;
      for (const q of this.geo.adj[p]) if (mine.has(q) && !seen.has(q)) { seen.add(q); stack.push(q); }
    }
    let area = 0, cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of seen) {
      const gp = provs[p];
      area += gp.area; cx += gp.seed[0] * gp.area; cy += gp.seed[1] * gp.area;
      x0 = Math.min(x0, gp.bbox[0]); y0 = Math.min(y0, gp.bbox[1]); x1 = Math.max(x1, gp.bbox[2]); y1 = Math.max(y1, gp.bbox[3]);
    }
    cx /= area; cy /= area;
    let best = start, bd = Infinity;
    for (const p of seen) { const d = Math.hypot(provs[p].seed[0] - cx, provs[p].seed[1] - cy); if (d < bd) { bd = d; best = p; } }
    return { anchor: [provs[best].seed[0], provs[best].seed[1]], w: x1 - x0, h: y1 - y0, area };
  }

  /** Provinces of the largest connected landmass an owner holds. */
  mainComponent(state: GameState, owner: number): number[] {
    const c = state.countries[owner];
    if (!c.alive || !c.provinces.length) return [];
    const provs = this.geo.provinces;
    const mine = new Set(c.provinces);
    const left = new Set(c.provinces);
    let best: number[] = [], bestA = -1;
    while (left.size) {
      const start = left.values().next().value as number;
      left.delete(start);
      const comp = [start];
      for (let i = 0; i < comp.length; i++) for (const q of this.geo.adj[comp[i]]) if (mine.has(q) && left.has(q)) { left.delete(q); comp.push(q); }
      const a = comp.reduce((s, p) => s + provs[p].area, 0);
      if (a > bestA) { bestA = a; best = comp; }
    }
    return best;
  }

  /** Fit a gently curved baseline along the long axis of a country's main landmass (for map-style labels). */
  labelCurve(state: GameState, owner: number): LabelCurve | null {
    const comp = this.mainComponent(state, owner);
    if (!comp.length) return null;
    const provs = this.geo.provinces;
    const xs: number[] = [], ys: number[] = [];
    let area = 0;
    for (const p of comp) {
      area += provs[p].area;
      const ring = provs[p].poly[0]?.[0];
      if (!ring) continue;
      const step = Math.max(2, Math.floor(ring.length / 40) * 2);
      for (let i = 0; i < ring.length; i += step) { xs.push(ring[i] / 10); ys.push(ring[i + 1] / 10); }
      xs.push(provs[p].seed[0]); ys.push(provs[p].seed[1]);
    }
    const n = xs.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // nearly round shapes read best horizontally; never set text steeper than 70 degrees
    const elong = Math.sqrt(Math.max(sxx, syy) / Math.max(1e-6, Math.min(sxx, syy)));
    if (elong < 1.35) ang *= Math.max(0, (elong - 1) / 0.35) * 0.6;
    ang = Math.max(-1.22, Math.min(1.22, ang));
    const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const ts: number[] = [], vs: number[] = [];
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; ts.push(dx * ux + dy * uy); vs.push(dx * nx + dy * ny); }
    const sorted = [...ts].sort((a, b) => a - b);
    const tmin = sorted[Math.floor(n * 0.04)], tmax = sorted[Math.floor(n * 0.96)];
    const len = Math.max(0.5, tmax - tmin);
    // spine: middle of the shape in 8 slices along the axis, then a least-squares parabola through them
    const B = 8, lo = new Array(B).fill(Infinity), hi = new Array(B).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const bi = Math.min(B - 1, Math.max(0, Math.floor(((ts[i] - tmin) / len) * B)));
      lo[bi] = Math.min(lo[bi], vs[i]); hi[bi] = Math.max(hi[bi], vs[i]);
    }
    const pt: [number, number][] = [], th: number[] = [];
    for (let bi = 0; bi < B; bi++) if (isFinite(lo[bi])) { pt.push([tmin + ((bi + 0.5) / B) * len, (lo[bi] + hi[bi]) / 2]); th.push(hi[bi] - lo[bi]); }
    let a = 0, b = 0, c = 0;
    if (pt.length >= 3) {
      // normal equations for v = a t^2 + b t + c
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
      for (const [t, v] of pt) { const t2 = t * t; s0++; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2; r0 += v; r1 += v * t; r2 += v * t2; }
      const M = [[s4, s3, s2, r2], [s3, s2, s1, r1], [s2, s1, s0, r0]];
      for (let i = 0; i < 3; i++) {
        let piv = i;
        for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
        [M[i], M[piv]] = [M[piv], M[i]];
        if (Math.abs(M[i][i]) < 1e-9) continue;
        for (let j = 0; j < 3; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let k = i; k < 4; k++) M[j][k] -= f * M[i][k]; }
      }
      a = Math.abs(M[0][0]) > 1e-9 ? M[0][3] / M[0][0] : 0;
      b = Math.abs(M[1][1]) > 1e-9 ? M[1][3] / M[1][1] : 0;
      c = Math.abs(M[2][2]) > 1e-9 ? M[2][3] / M[2][2] : 0;
      // keep the bend gentle: at most a sag of 12% of the length
      const sag = Math.abs(a) * (len / 2) ** 2;
      if (sag > len * 0.12) a *= (len * 0.12) / sag;
    }
    th.sort((x, y) => x - y);
    const thick = th.length ? th[Math.floor(th.length / 2)] : len * 0.3;
    return { mx, my, ux, uy, nx, ny, t0: (tmin + tmax) / 2, len, a, b, c, thick, area };
  }

  /** Bounding box of a country's main landmass (within reach of its capital), world coordinates. */
  focusBox(state: GameState, owner: number): [number, number, number, number] {
    const c = state.countries[owner];
    const geo = this.geo;
    const cap = geo.provinces[c.capital] ?? geo.provinces[c.provinces[0]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of c.provinces) {
      const gp = geo.provinces[p];
      if (cap && Math.hypot(gp.seed[0] - cap.seed[0], gp.seed[1] - cap.seed[1]) > 190 && c.provinces.length > 1 && p !== c.capital) continue;
      x0 = Math.min(x0, gp.bbox[0]); y0 = Math.min(y0, gp.bbox[1]); x1 = Math.max(x1, gp.bbox[2]); y1 = Math.max(y1, gp.bbox[3]);
    }
    if (!isFinite(x0)) return [0, 0, 100, 100];
    return [x0, y0, x1, y1];
  }
}
