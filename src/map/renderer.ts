/**
 * Canvas renderer for the world map, in the style of a grand-strategy map:
 *   painted terrain (Natural Earth land cover + relief, sea-floor relief) under translucent country colours,
 *   lakes and rivers, faint region lines, lit coastlines, heavy national borders, curved serif country
 *   names, sea names, real cities and capitals, frontlines, offensive arrows and army counters.
 *
 * Smoothness: everything static is drawn into the visible "base" canvas (with a margin), which is moved with
 * a GPU-composited CSS transform while the player pans or zooms, then re-rendered crisply once the view
 * settles. Per-frame overlays (hover, selection, fronts, effects, labels) are cheap and drawn on top.
 */
import { MapGeometry, type LabelCurve } from './geometry';
import type { GameState } from '../sim/types';
import { getRelation, areAtWar, hasAlliance } from '../sim/relations';
import { strengthIndex } from '../sim/military';
import { clamp, fmtNum, shortName } from '../sim/util';
import type { MapMode } from '../state/store';
import { computeBlocs } from '../sim/politics';
import { BDEF, type BType } from '../sim/buildings';
import { airSuperiority } from '../sim/war';
import { supplyNet, supplyPath } from '../sim/supply';
import { generalAt, homeCommander, stars } from '../sim/generals';
import { Fx } from './fx';
import { Battlefield } from './battlefield';
import { nationalColor } from './palette';
import terrainUrl from '../data/generated/terrain.webp';
import features from '../data/generated/features.json';

export interface View { k: number; x: number; y: number }

interface Features {
  rivers: { r: number; pts: number[] }[];
  lakes: { r: number; rings: number[][] }[];
  cities: { n: string; x: number; y: number; pop: number; cap: number; r: number; prov: number }[];
  seas: { n: string; x: number; y: number; r: number }[];
  towns: [string, number, number, number][];
}
const FEAT = features as unknown as Features;
const TEX_W = 1000, TEX_H = 520; // the terrain texture covers the whole projected map

const lerpC = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
function ramp(stops: number[][], t: number) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return rgb(lerpC(stops[i], stops[i + 1], t - i));
}
const WEALTH = [[38, 52, 104], [36, 110, 160], [48, 166, 160], [160, 200, 96], [246, 222, 104]];
const POWER = [[46, 56, 80], [100, 82, 130], [186, 78, 100], [240, 128, 64], [255, 208, 96]];
const STAB = [[186, 56, 56], [214, 140, 56], [204, 200, 88], [88, 172, 108], [56, 182, 150]];
const REL = [[196, 56, 56], [150, 84, 92], [104, 112, 130], [72, 150, 124], [64, 204, 140]];

const LABEL_FONT = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const SEA_FONT = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
/** Short forms for long names, used on the map only when the full name would be too small to read. */
const MAP_ABBR: Record<string, string> = {
  'United States of America': 'USA', 'United Kingdom': 'UK', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'C.A.R.', 'Papua New Guinea': 'PNG',
  'Bosnia and Herz.': 'Bosnia', 'Saudi Arabia': 'Saudi', 'South Africa': 'S. Africa', 'Dominican Rep.': 'Dominican', 'Trinidad and Tobago': 'Trinidad',
  Turkmenistan: 'Turkmen.', 'Burkina Faso': 'Burkina', 'Guinea-Bissau': 'G.-Bissau', 'Sierra Leone': 'S. Leone', 'United Arab Emirates': 'UAE',
};
/** Tileable fractal value noise: fine grain that keeps land crisp when zoomed far in. */
function grainTile(size = 192): HTMLCanvasElement {
  return tile(size, (c) => {
    const img = c.createImageData(size, size);
    const oct = [[6, 0.5], [12, 0.27], [24, 0.15], [48, 0.08]] as const;
    const grids = oct.map(([n]) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453 % 1; return g; });
    const sm = (v: number) => v * v * (3 - 2 * v);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0;
      oct.forEach(([n, amp], oi) => {
        const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const g = grids[oi], at = (a: number, b: number) => Math.abs(g[((b + n) % n) * n + ((a + n) % n)]);
        v += amp * ((at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty);
      });
      const o = (y * size + x) * 4, c8 = Math.round(128 + (v - 0.5) * 150);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, c8)); img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}
const UI_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

interface Effect { prov: number; t0: number; color: string; kind: 'capture' | 'lost' | 'ping'; ox?: number; oy?: number; mine?: boolean; /** the old owner's colour, held under the sweep */ from?: string }

function tile(size: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  return c;
}
/** Points sampled along a gently rounded curve through the given points (quadratics through the midpoints). */
function smoothPts(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const out = [pts[0], pts[1]];
  let px = pts[0], py = pts[1];
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[2 * i], cy = pts[2 * i + 1];
    const ex = i === n - 2 ? pts[2 * n - 2] : (cx + pts[2 * i + 2]) / 2, ey = i === n - 2 ? pts[2 * n - 1] : (cy + pts[2 * i + 3]) / 2;
    for (let s = 1; s <= 4; s++) { const u = s / 4, v = 1 - u; out.push(v * v * px + 2 * v * u * cx + u * u * ex, v * v * py + 2 * v * u * cy + u * u * ey); }
    px = ex; py = ey;
  }
  return out;
}
function linePath(pts: number[]): Path2D {
  const p = new Path2D();
  for (let i = 0; i < pts.length; i += 2) if (i === 0) p.moveTo(pts[0], pts[1]); else p.lineTo(pts[i], pts[i + 1]);
  return p;
}
function polyline(path: Path2D, pts: number[]) {
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) path.moveTo(pts[0] / 10, pts[1] / 10); else path.lineTo(pts[i] / 10, pts[i + 1] / 10);
  }
}

export class MapRenderer {
  view: View = { k: 1, x: 0, y: 0 };
  w = 0;
  h = 0;
  dpr = 1;
  dirty = true;
  hoverOwner = -1;
  mode: MapMode = 'political';
  plain = false;
  selected: number | null = null;
  selectedProv: number | null = null;
  fitK = 1;
  minK = 1;
  maxK = 90;
  /** perf counters for debugging */
  stats: Record<string, number> = { baseMs: 0, frameMs: 0, baseRenders: 0, imageMs: 0, labelMs: 0, overlayMs: 0, syncMs: 0 };

  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private baseView: View = { k: 1, x: 0, y: 0 };
  private margin = 0;
  private baseValid = false;
  private baseHardDirty = true;
  private baseSoftDirty = false;
  private lastBase = 0;
  private lastViewChange = 0;
  private anim: { from: View; to: View; t0: number; ms: number } | null = null;
  private targetK = 1;
  private anchor: [number, number] | null = null;
  private vel = { x: 0, y: 0 };
  private inertia = false;
  private lastT = 0;

  private ownerSnap: Int32Array = new Int32Array(0);
  private integSnap: Uint8Array = new Uint8Array(0);
  private colorSnap: string[] = [];
  private effects: Effect[] = [];
  private ownersVersion = 0;
  private pathsVersion = -1;
  private coastPath = new Path2D();
  private landBorderPath = new Path2D();
  private innerPath = new Path2D();
  private stripeCache = new Map<string, CanvasPattern>();
  private fronts: CanvasPattern | null = null;
  private terrain: HTMLImageElement | null = null;
  private riverPaths: Path2D[] = [];
  private lakePath = new Path2D();
  private curves = new Map<number, { v: number; c: LabelCurve | null }>();
  private frontline: { key: string; path: Path2D } = { key: '', path: new Path2D() };
  private capCity = new Map<number, number>(); // province -> index into FEAT.cities of its national capital
  private grain: CanvasPattern | null = null;
  private landPath = new Path2D();
  private terrainCache = document.createElement('canvas');
  private terrainKey = '';
  /** terrain cache placement: zoom, translation (CSS px) and size (CSS px) */
  private tcK = 0; private tcX = 0; private tcY = 0; private tcW = 0; private tcH = 0;
  private terrainMips: (HTMLCanvasElement | HTMLImageElement)[] = [];
  private baseSel: number | null = -2;
  private baseMode = '';
  private lastTransform = '';
  /** true while a battle is visible on screen (only then does the overlay animate) */
  battleVisible = false;

  private octx: CanvasRenderingContext2D;
  private battlefield: Battlefield;

  /** `base` is the visible map canvas (moved with a CSS transform while the view changes); `overlay` sits on top. */
  /** labels live on their own canvas so a conquest (which repaints colours and borders) does not have to redraw every name */
  private labels: HTMLCanvasElement | null;
  private lctx: CanvasRenderingContext2D | null = null;
  private labelView: View = { k: 1, x: 0, y: 0 };
  private labelsStale = false;
  private lastLabels = 0;
  private labelTransform = '';
  constructor(base: HTMLCanvasElement, private overlay: HTMLCanvasElement, public geom: MapGeometry, private getState: () => GameState | null, labels: HTMLCanvasElement | null = null, battle: HTMLCanvasElement | null = null) {
    this.base = base;
    if (battle) { this.battleCanvas = battle; this.battleDom = true; }
    this.labels = labels;
    this.lctx = labels?.getContext('2d') ?? null;
    this.bctx = base.getContext('2d', { alpha: false })!;
    this.ctx = this.bctx;
    this.octx = overlay.getContext('2d')!;
    this.battlefield = new Battlefield(geom);
    const ft = tile(10, (c) => {
      c.strokeStyle = 'rgba(255,70,50,0.85)'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(-2, 12); c.lineTo(12, -2); c.moveTo(-2, 7); c.lineTo(7, -2); c.moveTo(3, 12); c.lineTo(12, 3); c.stroke();
    });
    this.fronts = this.ctx.createPattern(ft, 'repeat');
    this.grain = this.ctx.createPattern(grainTile(), 'repeat');
    for (const pp of geom.provPaths) this.landPath.addPath(pp);
    // painted terrain texture (decoded asynchronously; the map draws plain colours until it arrives)
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        // pre-scaled copies (1000 / 2000 px wide plus the full 4000 px) so zoomed-out views sample far fewer pixels
        const mips: (HTMLCanvasElement | HTMLImageElement)[] = [];
        for (const wpx of [1000, 2000, img.width]) {
          const c = document.createElement('canvas');
          c.width = wpx; c.height = Math.round((wpx * img.height) / img.width);
          const g = c.getContext('2d')!;
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, c.width, c.height);
          mips.push(c);
        }
        this.terrainMips = mips;
        this.terrain = img; this.baseSoftDirty = true; this.baseHardDirty = true; this.dirty = true;
      };
      img.src = terrainUrl;
    }
    // rivers grouped by importance so they can appear progressively as you zoom in
    const groups = [new Path2D(), new Path2D(), new Path2D()];
    for (const r of FEAT.rivers) polyline(groups[r.r <= 2 ? 0 : r.r <= 4 ? 1 : 2], r.pts);
    this.riverPaths = groups;
    for (const l of FEAT.lakes) for (const ring of l.rings) { polyline(this.lakePath, ring); this.lakePath.closePath(); }
    FEAT.cities.forEach((c, i) => { if (c.cap === 2 && c.prov >= 0 && !this.capCity.has(c.prov)) this.capCity.set(c.prov, i); });
    // web fonts load lazily: redraw labels once they are ready
    if (typeof document !== 'undefined' && document.fonts) {
      void Promise.all([document.fonts.load(`600 20px ${LABEL_FONT}`), document.fonts.load(`italic 600 20px ${SEA_FONT}`)]).then(() => { this.dirty = true; }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ view control
  resize(w: number, h: number, dpr: number) {
    const first = this.w === 0;
    this.w = w; this.h = h; this.dpr = dpr;
    this.margin = Math.round(Math.max(w, h) * 0.12);
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.base.width = Math.round((w + 2 * this.margin) * dpr);
    this.base.height = Math.round((h + 2 * this.margin) * dpr);
    this.base.style.width = `${w + 2 * this.margin}px`;
    this.base.style.height = `${h + 2 * this.margin}px`;
    if (this.labels) {
      this.labels.width = this.base.width; this.labels.height = this.base.height;
      this.labels.style.width = this.base.style.width; this.labels.style.height = this.base.style.height;
    }
    const [x0, y0, x1, y1] = this.geom.bounds;
    this.fitK = Math.min(w / (x1 - x0 + 20), h / (y1 - y0 + 20));
    this.minK = this.fitK * 0.85;
    if (first) { this.fitWorld(); this.targetK = this.view.k; } else this.constrain();
    this.baseValid = false;
    this.dirty = true;
  }
  fitWorld() {
    const [x0, y0, x1, y1] = this.geom.bounds;
    const k = this.fitK;
    this.view = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
    this.targetK = k;
    this.dirty = true;
  }
  constrain() {
    const [x0, y0, x1, y1] = this.geom.bounds;
    const v = this.view;
    v.k = clamp(v.k, this.minK, this.maxK);
    const m = 0.25;
    v.x = clamp(v.x, this.w * m - x1 * v.k, this.w * (1 - m) - x0 * v.k);
    v.y = clamp(v.y, this.h * m - y1 * v.k, this.h * (1 - m) - y0 * v.k);
  }
  screenToWorld(sx: number, sy: number): [number, number] { return [(sx - this.view.x) / this.view.k, (sy - this.view.y) / this.view.k]; }

  /** Smooth (eased) zoom around a screen point, used by wheel and buttons. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.targetK = clamp(this.targetK * factor, this.minK, this.maxK);
    this.anchor = [sx, sy];
    this.anim = null; this.inertia = false;
    this.dirty = true;
  }
  /** Immediate zoom (pinch gesture). */
  zoomNow(sx: number, sy: number, factor: number) {
    const v = this.view;
    const nk = clamp(v.k * factor, this.minK, this.maxK);
    const f = nk / v.k;
    v.x = sx - (sx - v.x) * f; v.y = sy - (sy - v.y) * f; v.k = nk;
    this.targetK = nk;
    this.constrain(); this.anim = null; this.inertia = false; this.touchView();
  }
  panBy(dx: number, dy: number, dt = 16) {
    this.view.x += dx; this.view.y += dy;
    this.vel = { x: this.vel.x * 0.6 + (dx / Math.max(dt, 4)) * 0.4, y: this.vel.y * 0.6 + (dy / Math.max(dt, 4)) * 0.4 };
    this.constrain(); this.anim = null; this.inertia = false; this.touchView();
  }
  releasePan() {
    if (Math.hypot(this.vel.x, this.vel.y) > 0.15) this.inertia = true;
    else this.vel = { x: 0, y: 0 };
  }
  private touchView() { this.lastViewChange = performance.now(); this.dirty = true; }

  focusBox(box: [number, number, number, number], insetBottom = 0, insetRight = 0, animate = true) {
    const [x0, y0, x1, y1] = box;
    const availW = Math.max(100, this.w - insetRight), availH = Math.max(100, this.h - insetBottom);
    const bw = Math.max(x1 - x0, 6), bh = Math.max(y1 - y0, 6);
    const k = clamp(Math.min(availW / (bw * 1.7), availH / (bh * 1.7)), this.fitK, 26);
    const to: View = { k, x: availW / 2 - ((x0 + x1) / 2) * k, y: availH / 2 - ((y0 + y1) / 2) * k };
    this.targetK = k; this.anchor = null; this.inertia = false;
    if (animate) this.anim = { from: { ...this.view }, to, t0: performance.now(), ms: 820 };
    else { this.view = to; this.anim = null; }
    this.touchView();
  }

  /** advance animations by one frame */
  step(now: number) {
    const dt = Math.min(0.05, Math.max(0.001, (now - (this.lastT || now)) / 1000));
    this.lastT = now;
    if (this.anim) {
      const a = this.anim;
      const t = clamp((now - a.t0) / a.ms, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const k = Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e);
      const cx0 = (this.w / 2 - a.from.x) / a.from.k, cy0 = (this.h / 2 - a.from.y) / a.from.k;
      const cx1 = (this.w / 2 - a.to.x) / a.to.k, cy1 = (this.h / 2 - a.to.y) / a.to.k;
      this.view = { k, x: this.w / 2 - (cx0 + (cx1 - cx0) * e) * k, y: this.h / 2 - (cy0 + (cy1 - cy0) * e) * k };
      if (t >= 1) this.anim = null;
      this.touchView();
    } else if (Math.abs(this.targetK - this.view.k) > this.view.k * 0.002) {
      const v = this.view;
      const [ax, ay] = this.anchor ?? [this.w / 2, this.h / 2];
      const wx = (ax - v.x) / v.k, wy = (ay - v.y) / v.k;
      v.k += (this.targetK - v.k) * (1 - Math.exp(-dt * 10));
      v.x = ax - wx * v.k; v.y = ay - wy * v.k;
      this.constrain(); this.touchView();
    }
    if (this.inertia) {
      this.view.x += this.vel.x * dt * 1000; this.view.y += this.vel.y * dt * 1000;
      const d = Math.exp(-dt * 3.4);
      this.vel.x *= d; this.vel.y *= d;
      this.constrain(); this.touchView();
      if (Math.hypot(this.vel.x, this.vel.y) < 0.03) this.inertia = false;
    }
  }

  // ------------------------------------------------------------------ colours
  /** draw attention to a province (breaking news) */
  /** floating words over a region ("CAPTURED", "ENCIRCLED" ...) */
  private callouts: { prov: number; text: string; color: string; t0: number }[] = [];
  callout(prov: number, text: string, color = '#ffd36a') {
    this.callouts.push({ prov, text, color, t0: performance.now() });
    if (this.callouts.length > 10) this.callouts.splice(0, this.callouts.length - 10);
    this.dirty = true;
  }
  ping(prov: number, color = '#ffd36a') { this.effects.push({ prov, t0: performance.now(), color, kind: 'ping' }); this.dirty = true; }
  private colorFor(state: GameState, c: number): string {
    const C = state.countries[c];
    const P = state.player;
    switch (this.mode) {
      case 'blocs': {
        const { blocs, of } = computeBlocs(state);
        const b = of.get(c);
        return b === undefined ? 'hsl(215,8%,46%)' : `hsl(${(b * 67 + 20) % 360},62%,${c === blocs[b].leader ? 50 : 42}%)`;
      }
      case 'diplomacy': return c === P ? 'hsl(45,90%,52%)' : ramp(REL, (getRelation(state, c, P) + 100) / 200);
      case 'wealth': return ramp(WEALTH, (Math.log10(Math.max(300, C.eco.gdp / Math.max(C.eco.pop, 1))) - 2.5) / 2.3);
      case 'power': return ramp(POWER, (Math.log10(Math.max(2, strengthIndex(C))) - 0.3) / 3.6);
      case 'stability': return ramp(STAB, C.eco.stability / 100);
      default:
        // every country keeps its own colour, the player included (enemies and allies are marked with outlines)
        return nationalColor(C);
    }
  }
  private stripeFor(color: string): CanvasPattern {
    let p = this.stripeCache.get(color);
    if (!p) {
      const t = tile(12, (c) => {
        c.strokeStyle = color; c.lineWidth = 3.4;
        c.beginPath(); c.moveTo(-2, 14); c.lineTo(14, -2); c.moveTo(-2, 2); c.lineTo(2, -2); c.moveTo(10, 14); c.lineTo(14, 10); c.stroke();
      });
      p = this.ctx.createPattern(t, 'repeat')!;
      this.stripeCache.set(color, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ state sync
  /** Detect ownership / colour changes since the last frame; spawn capture effects. */
  private sync(state: GameState) {
    const n = state.owner.length;
    if (this.ownerSnap.length !== n) { this.ownerSnap = Int32Array.from(state.owner); this.integSnap = new Uint8Array(n); this.baseHardDirty = true; this.ownersVersion++; }
    let changed = false;
    const now = performance.now();
    for (let p = 0; p < n; p++) {
      if (this.ownerSnap[p] !== state.owner[p]) {
        const prev = this.ownerSnap[p];
        this.ownerSnap[p] = state.owner[p];
        changed = true;
        this.dirtyProvs.add(p);
        if (this.geomVisible(p)) {
          // the new colour sweeps in from the side the attack came from
          const geo = this.geom.geo;
          const src = geo.adj[p].find((q) => state.owner[q] === state.owner[p]);
          const o = geo.provinces[src ?? p].seed;
          this.effects.push({ prov: p, t0: now, color: this.colorFor(state, state.owner[p]), from: prev >= 0 ? this.colorFor(state, prev) : undefined, kind: prev === state.player ? 'lost' : 'capture', ox: o[0], oy: o[1], mine: state.owner[p] === state.player || prev === state.player });
          if (this.quality === 2) { const sd = geo.provinces[p].seed; this.fx.capture(sd[0], sd[1], this.colorFor(state, state.owner[p]), now); }
        }
      }
      if (state.owner[p] !== state.core[p]) {
        const b = Math.floor(state.integ[p] * 6);
        if (this.integSnap[p] !== b + 1) { this.integSnap[p] = b + 1; changed = true; this.dirtyProvs.add(p); }
      } else if (this.integSnap[p] !== 0) { this.integSnap[p] = 0; changed = true; this.dirtyProvs.add(p); }
    }
    if (changed) { this.baseHardDirty = true; this.ownersVersion++; }
    let colorChanged = this.colorSnap.length !== state.countries.length;
    const cols: string[] = new Array(state.countries.length);
    for (const c of state.countries) {
      if (!c.alive) { cols[c.id] = ''; continue; }
      cols[c.id] = this.colorFor(state, c.id);
      if (!colorChanged && this.colorSnap[c.id] !== cols[c.id]) colorChanged = true;
    }
    if (colorChanged) { this.colorSnap = cols; this.baseSoftDirty = true; }
    if (this.effects.length > 40) this.effects.splice(0, this.effects.length - 40);
  }
  private geomVisible(p: number) {
    const b = this.geom.geo.provinces[p].bbox;
    const { k, x, y } = this.view;
    return b[2] * k + x > 0 && b[0] * k + x < this.w && b[3] * k + y > 0 && b[1] * k + y < this.h;
  }
  markDirty() { this.baseSoftDirty = true; this.dirty = true; }

  // ------------------------------------------------------------------ frame
  draw() {
    const t0 = performance.now();
    const state = this.getState();
    if (!state || !this.w) return;
    const ts = performance.now();
    this.sync(state);
    this.stats.syncMs = performance.now() - ts;

    const v = this.view, bv = this.baseView;
    const f = v.k / bv.k;
    const ox = v.x - bv.x * f, oy = v.y - bv.y * f;
    const bw = (this.base.width / this.dpr) * f, bh = (this.base.height / this.dpr) * f;
    const covered = this.baseValid && ox <= 0 && oy <= 0 && ox + bw >= this.w && oy + bh >= this.h;
    const idle = t0 - this.lastViewChange > 130;
    const moved = Math.abs(f - 1) > 0.001 || Math.abs(ox + this.margin) > 0.5 || Math.abs(oy + this.margin) > 0.5;
    const farScale = f < 0.7 || f > 1.45;
    let render = false, ownersOnly = false;
    // while dragging, an uncovered edge is refilled at most ~8 times a second (a thin dark strip for a moment beats a stutter)
    const refill = !covered && (idle || t0 - this.lastBase > 120);
    if (!covered && !refill) this.dirty = true;
    // the selection is drawn on the overlay: picking a country no longer redraws the whole map (only the plain modes,
    // where the player's outline depends on the selection, still need the base layer)
    const selChanged = this.plain && this.baseSel !== this.selected;
    if (this.baseSel !== this.selected && !this.plain) { this.baseSel = this.selected; this.labelsStale = true; this.labelsNow = true; }
    if (!this.baseValid || selChanged || this.baseMode !== this.mode) render = true;
    else if (this.baseHardDirty) {
      // territory changed: batch redraws (at most ~3 a second) unless the view also needs one
      if (refill) render = true;
      else if (covered && t0 - this.lastBase > 320) { if (!this.repaintDirty(state)) { render = true; ownersOnly = true; } } else this.dirty = true;
    }
    else if (refill || (farScale && t0 - this.lastBase > 90)) render = true;
    else if (idle && moved) render = true;
    else if (this.baseSoftDirty && t0 - this.lastBase > 450 && idle) render = true;
    // while the view moves, names are just carried along by the CSS transform and redrawn once it settles
    // a change of map mode (or selection) cross-fades instead of snapping
    if (render && this.baseValid && this.quality >= 1 && this.baseMode !== this.mode) this.ghostBase(380);
    if (render) this.renderBase(state, !ownersOnly && (!this.baseValid || this.lastLabels === 0 || selChanged));
    else if (this.labelsStale && this.lctx && (this.labelsNow || (idle && (t0 - this.lastLabels > 1800 || t0 - this.lastViewChange < 600)))) {
      // names follow conquered land a moment later, in their own frame, so the war never stutters on text
      this.renderLabels(state);
    }
    if (this.labels) {
      const lv = this.labelView, f3 = v.k / lv.k;
      const tf = `translate3d(${(v.x - lv.x * f3).toFixed(2)}px, ${(v.y - lv.y * f3).toFixed(2)}px, 0) scale(${f3.toFixed(5)})`;
      if (tf !== this.labelTransform) { this.labelTransform = tf; this.labels.style.transform = tf; }
    }

    {
      const f2 = v.k / this.baseView.k;
      const ox2 = v.x - this.baseView.x * f2, oy2 = v.y - this.baseView.y * f2;
      const tf = `translate3d(${ox2.toFixed(2)}px, ${oy2.toFixed(2)}px, 0) scale(${f2.toFixed(5)})`;
      if (tf !== this.lastTransform) { this.lastTransform = tf; this.base.style.transform = tf; }
    }

    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);
    o.setTransform(this.dpr * v.k, 0, 0, this.dpr * v.k, this.dpr * v.x, this.dpr * v.y);
    const tc = performance.now();
    this.drawOverlays(o, state);
    this.stats.overlayMs = performance.now() - tc;
    this.stats.frameMs = performance.now() - t0;
  }

  /** Copy the current base layer into a short-lived canvas on top of it and fade it out. */
  private ghostBase(ms: number) {
    const b = this.base, parent = b.parentElement;
    if (!parent || !b.width || !b.height) return;
    const g = document.createElement('canvas');
    g.width = b.width; g.height = b.height;
    g.className = b.className;
    g.style.cssText = b.style.cssText;
    g.style.pointerEvents = 'none';
    g.style.willChange = 'opacity';
    const gc = g.getContext('2d');
    if (!gc) return;
    gc.drawImage(b, 0, 0);
    parent.insertBefore(g, b.nextSibling);
    requestAnimationFrame(() => { g.style.transition = `opacity ${ms}ms ease`; g.style.opacity = '0'; });
    setTimeout(() => g.remove(), ms + 80);
  }

  /** Whether another frame is needed even if nothing was touched (animations running). */
  animating(state: GameState | null) {
    return !!state && (this.battleVisible || this.labelsStale || this.callouts.length > 0 || this.fx.count > 0 || !!this.dragArmy || (this.selectedArmy !== null && this.running) || this.battlePending || this.effects.length > 0 || !!this.anim || this.inertia || Math.abs(this.targetK - this.view.k) > this.view.k * 0.002);
  }

  // ------------------------------------------------------------------ base layer
  private renderLabels(state: GameState) {
    const lc = this.lctx!;
    const tl = performance.now();
    const m = this.margin, dpr = this.dpr;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, this.labels!.width, this.labels!.height);
    lc.setTransform(dpr, 0, 0, dpr, dpr * m, dpr * m);
    this.drawSelection(lc, state);
    this.drawLabels(lc, state);
    this.labelsNow = false;
    this.labelView = { k: this.view.k, x: this.view.x + m, y: this.view.y + m };
    this.labelsStale = false;
    this.lastLabels = performance.now();
    this.stats.labelMs = this.lastLabels - tl;
    this.stats.labelRenders = (this.stats.labelRenders ?? 0) + 1;
  }

  private renderBase(state: GameState, withLabels = true) {
    const t0 = performance.now();
    const ctx = this.bctx;
    const { k, x, y } = this.view;
    const m = this.margin, dpr = this.dpr;
    this.baseView = { k, x: x + m, y: y + m };
    const geo = this.geom.geo;
    const nP = geo.provinces.length;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.base.width, H = this.base.height;
    ctx.fillStyle = '#03070c';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + m), dpr * (y + m));
    const vx0 = -(x + m) / k, vy0 = -(y + m) / k, vx1 = (W / dpr - (x + m)) / k, vy1 = (H / dpr - (y + m)) / k;
    const vis = (p: number) => { const b = geo.provinces[p].bbox; return !(b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1); };
    const zoomIn = k / this.fitK; // 1 = whole world

    // 1. painted terrain (or a plain ocean while the texture loads). The terrain only depends on the view, so it is
    //    rendered into a larger cache (an extra border all round, at most one cache pixel per CSS pixel) and simply
    //    copied with an offset while you pan; it is redrawn only when you zoom or pan beyond the cached border.
    const ti = performance.now();
    const Wc = W / dpr, Hc = H / dpr; // base canvas size in CSS px
    const tsc = Math.min(1, dpr);
    const pad = Math.round(Math.max(this.w, this.h) * 0.35);
    const T = this.terrainCache;
    let sx0 = this.tcX - (x + m), sy0 = this.tcY - (y + m);
    const tkey = `${!!this.terrain}|${Wc}|${Hc}|${tsc}`;
    if (this.terrainKey !== tkey || this.tcK !== k || sx0 < 0 || sy0 < 0 || sx0 + Wc > this.tcW || sy0 + Hc > this.tcH) {
      this.terrainKey = tkey;
      this.tcK = k; this.tcW = Wc + 2 * pad; this.tcH = Hc + 2 * pad;
      this.tcX = x + m + pad; this.tcY = y + m + pad;
      sx0 = pad; sy0 = pad;
      const cw = Math.ceil(this.tcW * tsc), ch = Math.ceil(this.tcH * tsc);
      if (T.width !== cw || T.height !== ch) { T.width = cw; T.height = ch; }
      const t2 = T.getContext('2d', { alpha: false })!;
      t2.setTransform(1, 0, 0, 1, 0, 0);
      t2.fillStyle = '#03070c'; t2.fillRect(0, 0, cw, ch);
      t2.setTransform(tsc * k, 0, 0, tsc * k, tsc * this.tcX, tsc * this.tcY);
      const cx0 = -this.tcX / k, cy0 = -this.tcY / k, cx1 = (this.tcW - this.tcX) / k, cy1 = (this.tcH - this.tcY) / k;
      if (this.terrain) {
        t2.imageSmoothingEnabled = true;
        t2.imageSmoothingQuality = 'low';
        // pick the smallest pre-scaled copy that still has enough detail, and copy only the part in view
        const need = k * tsc; // cache pixels per map unit
        const lvl = this.terrainMips.find((c) => c.width / TEX_W >= need * 0.9) ?? this.terrainMips[this.terrainMips.length - 1];
        const s = lvl.width / TEX_W;
        const ax0 = clamp(cx0, 0, TEX_W), ay0 = clamp(cy0, 0, TEX_H), ax1 = clamp(cx1, 0, TEX_W), ay1 = clamp(cy1, 0, TEX_H);
        if (ax1 > ax0 && ay1 > ay0) t2.drawImage(lvl, ax0 * s, ay0 * s, (ax1 - ax0) * s, (ay1 - ay0) * s, ax0, ay0, ax1 - ax0, ay1 - ay0);
        if (this.grain && zoomIn > 2.2 && this.quality === 2) {
          this.grain.setTransform(new DOMMatrix().scale(0.9 / 192));
          t2.globalCompositeOperation = 'soft-light';
          t2.globalAlpha = clamp((zoomIn - 2.2) / 8, 0, 0.32);
          t2.fillStyle = this.grain;
          t2.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0); // a plain rectangle: far cheaper than the land outline, and soft-light barely touches the dark sea
          t2.globalCompositeOperation = 'source-over';
          t2.globalAlpha = 1;
        }
      } else {
        t2.fillStyle = '#0b1b2b';
        t2.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(T, sx0 * tsc, sy0 * tsc, Wc * tsc, Hc * tsc, 0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + m), dpr * (y + m));
    this.stats.imageMs = performance.now() - ti;

    // combined edge paths (rebuilt only when ownership changes)
    if (this.pathsVersion !== this.ownersVersion) {
      this.pathsVersion = this.ownersVersion;
      const coastP = new Path2D(), landP = new Path2D(), innerP = new Path2D();
      const own = state.owner;
      for (let p = 0; p < nP; p++) {
        for (const e of this.geom.edgePaths[p]) {
          if (e.n < 0) coastP.addPath(e.path);
          else if (own[e.n] === own[p]) innerP.addPath(e.path);
          else landP.addPath(e.path);
        }
      }
      this.coastPath = coastP; this.landBorderPath = landP; this.innerPath = innerP;
    }
    const provs: number[] = [];
    for (let p = 0; p < nP; p++) if (vis(p)) provs.push(p);
    const P = state.player;
    const showSides = !this.plain && this.mode === 'political';
    const sp = showSides ? this.sidePaths(state) : null;
    this.paintMap(ctx, state, k, zoomIn, provs, {
      inner: this.innerPath, coast: this.coastPath, land: this.landBorderPath, ally: sp?.ally ?? null, enemy: sp?.enemy ?? null,
      player: (!this.plain || this.selected === P) && state.countries[P]?.alive ? this.outlinePath(state, P) : null,
      front: state.wars.length ? this.frontlinePath(state) : null,
    });
    this.dirtyProvs.clear();
    this.baseSideKey = this.sideKey(state);
    this.baseTerrainOff = [sx0 * tsc, sy0 * tsc, Wc * tsc, Hc * tsc];
    this.baseSel = this.selected;
    this.baseMode = this.mode;

    // 8. labels (country names, seas, cities): on their own layer when there is one, otherwise into the base
    if (this.lctx) {
      if (withLabels) this.renderLabels(state); else this.labelsStale = true;
    } else {
      const tl = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, dpr * m, dpr * m);
      this.drawLabels(ctx, state);
      this.stats.labelMs = performance.now() - tl;
    }

    this.baseValid = true;
    this.baseHardDirty = false;
    this.baseSoftDirty = false;
    this.lastBase = performance.now();
    this.stats.baseMs = this.lastBase - t0;
    this.stats.baseRenders++;
  }

  /**
   * Steps 2–7b of the base layer, shared by the full redraw and the dirty-rectangle repaint: country colours,
   * occupation hatching, lakes and rivers, region lines, coasts, borders, allies/enemies, your realm, frontlines.
   */
  private paintMap(ctx: CanvasRenderingContext2D, state: GameState, k: number, zoomIn: number, provs: number[], paths: { inner: Path2D; coast: Path2D; land: Path2D; ally: Path2D | null; enemy: Path2D | null; player: Path2D | null; front: Path2D | null }) {
    // 2. translucent country colours over the terrain (data map modes are more opaque so they read clearly)
    const colors = this.colorSnap;
    const political = this.mode === 'political';
    ctx.globalAlpha = political ? (this.terrain ? 0.64 : 0.9) : 0.84;
    for (const p of provs) {
      ctx.fillStyle = colors[state.owner[p]] || '#555';
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    ctx.globalAlpha = 1;

    // 3. occupied land: hatched with the original owner's colour until it is integrated
    for (const p of provs) {
      if (state.owner[p] === state.core[p]) continue;
      const core = state.core[p];
      if (!state.countries[core].alive) continue;
      const pat = this.stripeFor(this.plain ? colors[core] : (core === state.player ? 'rgba(40,210,180,0.95)' : colors[core]));
      pat.setTransform(new DOMMatrix().scale(1 / k));
      ctx.globalAlpha = 0.16 + 0.5 * (1 - state.integ[p]);
      ctx.fillStyle = pat;
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    ctx.globalAlpha = 1;

    // 4. lakes and rivers
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = '#12304a';
    ctx.fill(this.lakePath, 'evenodd');
    ctx.strokeStyle = 'rgba(150,200,230,0.35)'; ctx.lineWidth = 0.6 / k; ctx.stroke(this.lakePath);
    const riverCol = 'rgba(86,150,200,0.92)';
    ctx.strokeStyle = riverCol;
    ctx.lineWidth = Math.min(2.2, 0.9 + zoomIn * 0.12) / k; ctx.stroke(this.riverPaths[0]);
    if (zoomIn > 1.7) { ctx.globalAlpha = clamp((zoomIn - 1.7) / 1.2, 0, 1); ctx.lineWidth = Math.min(1.6, 0.6 + zoomIn * 0.08) / k; ctx.stroke(this.riverPaths[1]); }
    if (zoomIn > 3.5) { ctx.globalAlpha = clamp((zoomIn - 3.5) / 2, 0, 1); ctx.lineWidth = Math.min(1.2, 0.5 + zoomIn * 0.05) / k; ctx.stroke(this.riverPaths[2]); }
    ctx.globalAlpha = 1;

    // 5. faint region lines (fade in as you zoom)
    const innerA = clamp(0.1 + (zoomIn - 1) * 0.08, 0.1, 0.42);
    ctx.strokeStyle = `rgba(28,20,12,${innerA})`; ctx.lineWidth = 0.75 / k;
    ctx.setLineDash([2.2 / k, 1.6 / k]);
    ctx.stroke(paths.inner);
    ctx.setLineDash([]);

    // 6. coastlines: soft light rim, then a crisp dark edge
    ctx.strokeStyle = 'rgba(190,225,240,0.16)'; ctx.lineWidth = 3.4 / k; ctx.stroke(paths.coast);
    ctx.strokeStyle = 'rgba(14,20,26,0.85)'; ctx.lineWidth = 1 / k; ctx.stroke(paths.coast);

    // 7. national borders: a heavy dark band with a pale stitch, like a printed atlas
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(12,8,4,0.35)'; ctx.lineWidth = 4.2 / k; ctx.stroke(paths.land);
    ctx.strokeStyle = 'rgba(18,12,8,0.92)'; ctx.lineWidth = 1.8 / k; ctx.stroke(paths.land);
    ctx.strokeStyle = 'rgba(255,238,210,0.42)'; ctx.lineWidth = 0.6 / k;
    ctx.setLineDash([3 / k, 2.4 / k]); ctx.stroke(paths.land); ctx.setLineDash([]);

    // 7b. outlines: allies (blue) and enemies (red) of the player, the player's realm (gold), and frontlines where
    //     warring sides meet; all static, so they live in the cached layer (no per-frame cost)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (paths.ally) { ctx.strokeStyle = 'rgba(110,180,255,0.6)'; ctx.lineWidth = 1 / k; ctx.stroke(paths.ally); }
    if (paths.enemy) { ctx.strokeStyle = 'rgba(255,70,50,0.85)'; ctx.lineWidth = 1.5 / k; ctx.stroke(paths.enemy); }
    if (paths.player) {
      ctx.strokeStyle = 'rgba(255,200,80,0.28)'; ctx.lineWidth = 5 / k; ctx.stroke(paths.player);
      ctx.strokeStyle = 'rgba(255,214,120,0.95)'; ctx.lineWidth = 1.7 / k; ctx.stroke(paths.player);
    }
    if (paths.front) {
      ctx.strokeStyle = 'rgba(255,60,40,0.3)'; ctx.lineWidth = 6 / k; ctx.stroke(paths.front);
      ctx.strokeStyle = 'rgba(205,30,24,0.95)'; ctx.lineWidth = 2.2 / k; ctx.stroke(paths.front);
      ctx.strokeStyle = 'rgba(255,230,200,0.85)'; ctx.lineWidth = 0.7 / k;
      ctx.setLineDash([1.5 / k, 2.5 / k]); ctx.stroke(paths.front); ctx.setLineDash([]);
    }
  }

  /** Who the player is at war with and allied to (if this changes, every outline on the map changes: full redraw). */
  private sideKey(state: GameState) {
    const P = state.player, en: number[] = [], al: number[] = [];
    for (const c of state.countries) {
      if (!c.alive || c.id === P) continue;
      if (areAtWar(state, c.id, P)) en.push(c.id); else if (hasAlliance(state, c.id, P)) al.push(c.id);
    }
    return `${en.join(',')}|${al.join(',')}|${state.wars.map((w) => `${w.id}:${w.attackers.join(',')}/${w.defenders.join(',')}`).join(';')}`;
  }
  private dirtyProvs = new Set<number>();
  private baseSideKey = '';
  private baseTerrainOff: [number, number, number, number] = [0, 0, 0, 0];

  /**
   * Land changed hands: repaint only the rectangle around the changed regions (in the coordinates the base layer was
   * drawn in), with border paths built just for that patch. Returns false when a full redraw is needed instead
   * (a change of alliances or wars recolours outlines everywhere; a patch bigger than half the map is not worth it).
   */
  private repaintDirty(state: GameState): boolean {
    if (!this.dirtyProvs.size || this.sideKey(state) !== this.baseSideKey || !this.baseValid) return false;
    const geo = this.geom.geo, bv = this.baseView, k = bv.k, dpr = this.dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (p: number) => { const b = geo.provinces[p].bbox; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); };
    // every border run of a changed region lies on its own outline, so its own box (plus line widths) is enough
    for (const p of this.dirtyProvs) grow(p);
    const padW = 7 / k; x0 -= padW; y0 -= padW; x1 += padW; y1 += padW;
    // to canvas pixels
    const W = this.base.width, H = this.base.height;
    const px0 = Math.max(0, Math.floor(dpr * (x0 * k + bv.x))), py0 = Math.max(0, Math.floor(dpr * (y0 * k + bv.y)));
    const px1 = Math.min(W, Math.ceil(dpr * (x1 * k + bv.x))), py1 = Math.min(H, Math.ceil(dpr * (y1 * k + bv.y)));
    this.dirtyProvs.clear();
    if (px1 <= px0 || py1 <= py0) { this.baseHardDirty = false; this.lastBase = performance.now(); return true; } // off-screen: nothing to repaint
    if ((px1 - px0) * (py1 - py0) > 0.5 * W * H) return false;
    const t0 = performance.now();
    const ctx = this.bctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(px0, py0, px1 - px0, py1 - py0); ctx.clip();
    ctx.fillStyle = '#03070c'; ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    const [sx, sy, sw, sh] = this.baseTerrainOff;
    ctx.imageSmoothingEnabled = true;
    if (sw > 0) ctx.drawImage(this.terrainCache, sx, sy, sw, sh, 0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * bv.x, dpr * bv.y);
    // the provinces under the patch, and their border runs classified with today's owners
    const wx0 = (px0 / dpr - bv.x) / k, wy0 = (py0 / dpr - bv.y) / k, wx1 = (px1 / dpr - bv.x) / k, wy1 = (py1 / dpr - bv.y) / k;
    const provs: number[] = [];
    for (let p = 0; p < geo.provinces.length; p++) { const b = geo.provinces[p].bbox; if (!(b[2] < wx0 || b[0] > wx1 || b[3] < wy0 || b[1] > wy1)) provs.push(p); }
    const own = state.owner, P = state.player;
    const inner = new Path2D(), coast = new Path2D(), land = new Path2D(), ally = new Path2D(), enemy = new Path2D(), player = new Path2D(), front = new Path2D();
    const showSides = !this.plain && this.mode === 'political';
    const en = new Set<number>(), al = new Set<number>();
    if (showSides) for (const c of state.countries) { if (!c.alive || c.id === P) continue; if (areAtWar(state, c.id, P)) en.add(c.id); else if (hasAlliance(state, c.id, P)) al.add(c.id); }
    const sides = state.wars.map((w) => [new Set(w.attackers), new Set(w.defenders)] as const);
    const showPlayer = (!this.plain || this.selected === P) && state.countries[P]?.alive;
    const outlineOf = (S: Set<number> | number, a: number, b: number) => { const has = (c: number) => (typeof S === 'number' ? c === S : S.has(c)); return (has(a) && (b < 0 || own[b] !== a)) || (b >= 0 && has(own[b]) && own[b] !== a); };
    for (const p of provs) {
      const a = own[p];
      for (const e of this.geom.edgePaths[p]) {
        if (e.n < 0) coast.addPath(e.path); else if (own[e.n] === a) inner.addPath(e.path); else land.addPath(e.path);
        if (showSides && outlineOf(al, a, e.n)) ally.addPath(e.path);
        if (showSides && outlineOf(en, a, e.n)) enemy.addPath(e.path);
        if (showPlayer && outlineOf(P, a, e.n)) player.addPath(e.path);
        if (e.n >= 0 && own[e.n] !== a) { const b = own[e.n]; if (sides.some(([A, D]) => (A.has(a) && D.has(b)) || (D.has(a) && A.has(b)))) front.addPath(e.path); }
      }
    }
    this.paintMap(ctx, state, k, k / this.fitK, provs, { inner, coast, land, ally: showSides ? ally : null, enemy: showSides ? enemy : null, player: showPlayer ? player : null, front: state.wars.length ? front : null });
    ctx.restore();
    this.labelsStale = true;
    this.baseHardDirty = false;
    this.lastBase = performance.now();
    this.stats.patchMs = this.lastBase - t0;
    this.stats.patches = (this.stats.patches ?? 0) + 1;
    return true;
  }

  // ------------------------------------------------------------------ overlays
  private outline(ctx: CanvasRenderingContext2D, state: GameState, c: number) { ctx.stroke(this.outlinePath(state, c)); }
  /** A country's whole outline as one path (border runs can be stored on either side of a border). */
  private outlinePath(state: GameState, c: number, into = new Path2D()): Path2D {
    const geo = this.geom.geo, owner = state.owner;
    const seen = new Set<number>();
    for (const p of state.countries[c].provinces) {
      for (const e of this.geom.edgePaths[p]) if (e.n < 0 || owner[e.n] !== c) into.addPath(e.path);
      for (const q of geo.adj[p]) {
        if (owner[q] === c || seen.has(q)) continue;
        seen.add(q);
        for (const e of this.geom.edgePaths[q]) if (e.n === p) into.addPath(e.path);
      }
    }
    return into;
  }
  private sides: { key: string; enemy: Path2D; ally: Path2D } = { key: '', enemy: new Path2D(), ally: new Path2D() };
  private sidePaths(state: GameState) {
    const P = state.player, en: number[] = [], al: number[] = [];
    for (const c of state.countries) {
      if (!c.alive || c.id === P) continue;
      if (areAtWar(state, c.id, P)) en.push(c.id); else if (hasAlliance(state, c.id, P)) al.push(c.id);
    }
    const key = `${this.ownersVersion}|${en.join(',')}|${al.join(',')}`;
    if (this.sides.key !== key) {
      const enemy = new Path2D(), ally = new Path2D();
      for (const c of en) this.outlinePath(state, c, enemy);
      for (const c of al) this.outlinePath(state, c, ally);
      this.sides = { key, enemy, ally };
    }
    return this.sides;
  }
  /** Lines where two warring sides meet (rebuilt only when ownership or the set of wars changes). */
  private frontlinePath(state: GameState): Path2D {
    const key = `${this.ownersVersion}|${state.wars.map((w) => `${w.id}:${w.attackers.join(',')}/${w.defenders.join(',')}`).join(';')}`;
    if (this.frontline.key === key) return this.frontline.path;
    const path = new Path2D();
    const geo = this.geom.geo, owner = state.owner;
    for (const w of state.wars) {
      const A = new Set(w.attackers), D = new Set(w.defenders);
      for (const a of w.attackers) for (const p of state.countries[a]?.provinces ?? []) {
        for (const e of this.geom.edgePaths[p]) if (e.n >= 0 && D.has(owner[e.n])) path.addPath(e.path);
        for (const q of geo.adj[p]) if (D.has(owner[q])) for (const e of this.geom.edgePaths[q]) if (e.n === p) path.addPath(e.path);
      }
      void A;
    }
    this.frontline = { key, path };
    return path;
  }

  /** The selected country: a soft wash and a crisp outline. Drawn on the name layer, once per selection (it pans and
   *  zooms with the map like the names), so picking a country never redraws the whole map. */
  private drawSelection(ctx: CanvasRenderingContext2D, state: GameState) {
    const c = this.selected;
    if (c === null || c === state.player || this.plain || !state.countries[c]?.alive) return;
    const k = this.view.k;
    const sel = this.selectionPath(state, c);
    ctx.fillStyle = 'rgba(255,250,235,0.08)'; ctx.fill(sel.fill, 'evenodd');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 5 / k; ctx.stroke(sel.outline);
    ctx.strokeStyle = 'rgba(255,255,255,0.98)'; ctx.lineWidth = 1.9 / k; ctx.stroke(sel.outline);
  }
  private labelsNow = false;
  private selCache: { key: string; fill: Path2D; outline: Path2D } = { key: '', fill: new Path2D(), outline: new Path2D() };
  private selectionPath(state: GameState, c: number) {
    const key = `${c}|${this.ownersVersion}`;
    if (this.selCache.key !== key) {
      const fill = new Path2D();
      for (const p of state.countries[c].provinces) fill.addPath(this.geom.provPaths[p]);
      this.selCache = { key, fill, outline: this.outlinePath(state, c) };
    }
    return this.selCache;
  }
  private drawOverlays(ctx: CanvasRenderingContext2D, state: GameState) {
    const { k } = this.view;
    const now = performance.now();
    const geo = this.geom.geo;
    const P = state.player;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const fill = (c: number, style: string) => {
      ctx.fillStyle = style;
      for (const p of state.countries[c].provinces) ctx.fill(this.geom.provPaths[p], 'evenodd');
    };

    if (this.hoverOwner >= 0 && this.hoverOwner !== this.selected && state.countries[this.hoverOwner]?.alive) {
      fill(this.hoverOwner, 'rgba(255,250,235,0.12)');
      ctx.strokeStyle = 'rgba(255,250,235,0.8)'; ctx.lineWidth = 1.3 / k; this.outline(ctx, state, this.hoverOwner);
    }
    if (!this.lctx) this.drawSelection(ctx, state); // (no name layer: the selection is drawn with the overlay)
    if (this.selectedProv !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.8 / k; ctx.stroke(this.geom.provPaths[this.selectedProv]);
    }

    // capture / loss effects and breaking-news rings
    this.effects = this.effects.filter((e) => now - e.t0 < (e.kind === 'ping' ? 3600 : 2800));
    const flags: { x: number; y: number; color: string; a: number; rise: number; lost: boolean }[] = [];
    for (const e of this.effects) {
      const gp = geo.provinces[e.prov];
      if (e.kind === 'ping') {
        for (let i = 0; i < 3; i++) {
          const tt = ((now - e.t0) / 3600) * 1.6 - i * 0.22;
          if (tt <= 0 || tt >= 1) continue;
          ctx.globalAlpha = (1 - tt) * 0.9;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = (3.2 - 2 * tt) / k;
          ctx.beginPath(); ctx.arc(gp.seed[0], gp.seed[1], (6 + tt * 70) / k, 0, 6.283); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const t = (now - e.t0) / 2800;
      const path = this.geom.provPaths[e.prov];
      const bb = gp.bbox;
      const ox = e.ox ?? gp.seed[0], oy = e.oy ?? gp.seed[1];
      const R = Math.max(Math.hypot(bb[2] - ox, bb[3] - oy), Math.hypot(bb[0] - ox, bb[1] - oy), Math.hypot(bb[2] - ox, bb[1] - oy), Math.hypot(bb[0] - ox, bb[3] - oy));
      // the sweep takes about a second; a smooth ease-in-out reads as an advance, not a pop
      const sweep = Math.min(1, t / 0.4), ease = sweep < 0.5 ? 2 * sweep * sweep : 1 - Math.pow(-2 * sweep + 2, 2) / 2;
      // 1. the old owner's colour holds the region while the conqueror's sweeps across it from the attack side,
      // behind a bright leading edge (the base map underneath has already changed hands)
      ctx.save();
      ctx.clip(path, 'evenodd');
      if (e.from && sweep < 1) {
        // about as opaque as the base map's own colours, so the terrain still shows through
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = e.from; ctx.fill(path, 'evenodd');
      }
      ctx.globalAlpha = t < 0.4 ? 0.85 : 0.85 * Math.max(0, 1 - (t - 0.4) / 0.45);
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(ox, oy, R * ease + 0.01, 0, 6.283); ctx.fill();
      if (sweep < 1) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = e.kind === 'lost' ? '#ff8a7a' : '#fff1c2'; ctx.lineWidth = 3 / k;
        ctx.stroke();
      }
      ctx.restore();
      // 2. the new border glows, then settles
      const glow = Math.max(0, 1 - t);
      ctx.globalAlpha = glow * 0.55;
      ctx.strokeStyle = e.kind === 'lost' ? '#ff4a3a' : e.mine ? '#ffc94a' : '#fff6d8';
      ctx.lineWidth = 6 / k; ctx.stroke(path);
      ctx.globalAlpha = glow;
      ctx.lineWidth = 1.6 / k; ctx.strokeStyle = e.kind === 'lost' ? '#ffb0a4' : '#fffbe8'; ctx.stroke(path);
      ctx.globalAlpha = 1;
      if (e.mine) flags.push({ x: gp.seed[0] * k + this.view.x, y: gp.seed[1] * k + this.view.y, color: e.color, a: t > 0.8 ? (1 - t) / 0.2 : 1, rise: Math.min(1, t / 0.25), lost: e.kind === 'lost' });
    }
    // flags planted on regions you take (a torn one on regions you lose), and floating callouts
    if (flags.length || this.callouts.length) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const fl of flags) {
        const h = 22 * (1 - Math.pow(1 - fl.rise, 3));
        ctx.globalAlpha = fl.a;
        ctx.strokeStyle = 'rgba(20,12,6,0.95)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x, fl.y - h); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(fl.x, fl.y, 5, 2, 0, 0, 6.283); ctx.fill();
        if (h > 12) {
          const wave = Math.sin(now / 160) * 1.5;
          ctx.fillStyle = fl.color; ctx.strokeStyle = 'rgba(20,12,6,0.9)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(fl.x, fl.y - h); ctx.lineTo(fl.x + 13, fl.y - h + 1 + wave); ctx.lineTo(fl.x + (fl.lost ? 9 : 13), fl.y - h + 8 + wave); ctx.lineTo(fl.x, fl.y - h + 8); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      this.callouts = this.callouts.filter((c) => now - c.t0 < 3400);
      const seenAt = new Map<number, number>();
      for (const c of this.callouts) {
        const gp = geo.provinces[c.prov];
        const n = seenAt.get(c.prov) ?? 0; seenAt.set(c.prov, n + 1);
        const tt = (now - c.t0) / 3400;
        const pop = tt < 0.08 ? 0.6 + 0.4 * (tt / 0.08) + 0.12 * Math.sin((tt / 0.08) * Math.PI) : 1;
        const sx = gp.seed[0] * k + this.view.x, sy = gp.seed[1] * k + this.view.y - 30 - 26 * tt - n * 24;
        if (sx < -80 || sx > this.w + 80 || sy < -30 || sy > this.h + 30) continue;
        ctx.globalAlpha = tt > 0.7 ? (1 - tt) / 0.3 : 1;
        ctx.font = `900 ${Math.round(13 * pop)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(c.text).width + 18 * pop;
        ctx.fillStyle = 'rgba(12,8,4,0.86)';
        ctx.beginPath(); ctx.roundRect(sx - w / 2, sy - 11 * pop, w, 22 * pop, 5); ctx.fill();
        ctx.strokeStyle = c.color; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = c.color; ctx.fillText(c.text, sx, sy + 0.5);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // battles: cells falling to the attacker, the live frontline, artillery, aircraft, army counters
    this.drawBattles(ctx, state, now);
    // the player's army groups (on top of everything, they are what you command)
    this.drawArmies(ctx, state, now);
  }

  // ------------------------------------------------------------------ army groups
  selectedArmy: number | null = null;
  /** while dragging an army: the pointer position and the region under it */
  dragArmy: { id: number; x: number; y: number; prov: number | null } | null = null;
  armyHits: { id: number; x: number; y: number }[] = [];
  hitArmy(sx: number, sy: number) {
    let best: number | null = null, bd = 22 * 22;
    for (const a of this.armyHits) { const d = (a.x - sx) ** 2 + (a.y - sy) ** 2; if (d < bd) { bd = d; best = a.id; } }
    return best;
  }
  private drawArmies(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    this.armyHits = [];
    const armies = state.armies;
    if (!armies?.length || (state.settings.control?.military ?? 'hands') === 'auto') return;
    const geo = this.geom.geo, V = this.view, P = state.player;
    const col = this.colorSnap[P] || '#c33';
    const ORDER_COL: Record<string, string> = { advance: '#ffcf5a', encircle: '#ff9a3c', raid: '#c58cff', hold: '#7fc1ff', defend: '#7fc1ff' };
    const ORDER_ICON: Record<string, string> = { advance: '➤', encircle: '⭕', raid: '⚡', hold: '🛡', defend: '🏛' };
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const byAt = new Map<number, number>();
    armies.forEach((a, i) => {
      const at = a.at >= 0 ? a.at : state.countries[P].capital;
      const n = byAt.get(at) ?? 0; byAt.set(at, n + 1);
      const sd = geo.provinces[at].seed;
      const sx = sd[0] * V.k + V.x + n * 34 - 10, sy = sd[1] * V.k + V.y - 26 - (n % 2) * 6;
      const sel = this.selectedArmy === a.id;
      const oc = ORDER_COL[a.order] ?? '#fff';
      // objective: a dashed arrow towards the target region
      const tgt = this.dragArmy?.id === a.id ? null : a.target;
      if (tgt !== null && tgt >= 0) {
        const td = geo.provinces[tgt].seed;
        const tx = td[0] * V.k + V.x, ty = td[1] * V.k + V.y;
        ctx.save();
        ctx.strokeStyle = 'rgba(10,6,2,0.75)'; ctx.lineWidth = sel ? 5 : 4; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = oc; ctx.lineWidth = sel ? 2.6 : 1.8; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -(now / 40) % 12;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([]);
        const ang = Math.atan2(ty - sy, tx - sx);
        ctx.fillStyle = oc; ctx.strokeStyle = 'rgba(10,6,2,0.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 12 * Math.cos(ang - 0.45), ty - 12 * Math.sin(ang - 0.45)); ctx.lineTo(tx - 12 * Math.cos(ang + 0.45), ty - 12 * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, ty, 9 + 2 * Math.sin(now / 200), 0, 6.283); ctx.strokeStyle = oc; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      // the token: a banner in the national colour with the army's number, its order and its general's stars
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return; // an army without a valid position this frame
      const w = 30, h = 36;
      ctx.save();
      if (sel) { ctx.shadowColor = oc; ctx.shadowBlur = 16; }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.ellipse(sx, sy + h / 2 + 4, 15, 4, 0, 0, 6.283); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - w / 2, sy - h / 2); ctx.lineTo(sx + w / 2, sy - h / 2); ctx.lineTo(sx + w / 2, sy + h / 2 - 9); ctx.lineTo(sx, sy + h / 2); ctx.lineTo(sx - w / 2, sy + h / 2 - 9); ctx.closePath();
      const g = ctx.createLinearGradient(sx, sy - h / 2, sx, sy + h / 2);
      g.addColorStop(0, '#fff6dc'); g.addColorStop(0.12, col); g.addColorStop(1, '#1d140a');
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = sel ? 2.4 : 1.6; ctx.strokeStyle = sel ? '#fff3c4' : '#d6ab52'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(10,6,2,0.9)'; ctx.stroke();
      ctx.fillStyle = '#fff8e6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 13px ${LABEL_FONT}`; ctx.fillText(ROMAN[i] ?? String(i + 1), sx, sy - 6);
      ctx.font = `12px ${UI_FONT}`; ctx.fillText(ORDER_ICON[a.order] ?? '', sx, sy + 8);
      const gen = state.countries[P].generals?.find((x) => x.id === a.general && x.status === 'active');
      if (gen) { const st = '★'.repeat(Math.min(5, 1 + Math.floor(gen.xp / 25))); ctx.font = `700 8px ${UI_FONT}`; ctx.fillStyle = '#ffcf5a'; ctx.fillText(st, sx, sy - h / 2 - 5); }
      ctx.restore();
      this.armyHits.push({ id: a.id, x: sx, y: sy });
    });
    // dragging: a live line to the region under the pointer
    const d = this.dragArmy;
    if (d) {
      const hit = this.armyHits.find((x) => x.id === d.id);
      if (hit) {
        const enemy = d.prov !== null && state.owner[d.prov] !== P;
        const c2 = enemy ? '#ffcf5a' : '#7fc1ff';
        if (d.prov !== null) {
          ctx.setTransform(this.dpr * V.k, 0, 0, this.dpr * V.k, this.dpr * V.x, this.dpr * V.y);
          ctx.fillStyle = enemy ? 'rgba(255,200,80,0.22)' : 'rgba(120,190,255,0.2)';
          ctx.fill(this.geom.provPaths[d.prov], 'evenodd');
          ctx.strokeStyle = c2; ctx.lineWidth = 2 / V.k; ctx.stroke(this.geom.provPaths[d.prov]);
          ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
        ctx.strokeStyle = c2; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
        ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(d.x, d.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = `700 12px ${UI_FONT}`; ctx.fillStyle = c2; ctx.textAlign = 'left';
        ctx.fillText(d.prov === null ? '' : enemy ? `Attack ${geo.provinces[d.prov].name}` : `Hold ${geo.provinces[d.prov].name}`, d.x + 12, d.y - 10);
      }
    }
    ctx.restore();
  }

  /** Battle markers drawn this frame, in screen coordinates, so a click can open the battle report. */
  battleHits: { x: number; y: number; war: number; prov: number; by: number }[] = [];
  hitBattle(sx: number, sy: number) {
    let best: { x: number; y: number; war: number; prov: number; by: number } | null = null, bd = 18 * 18;
    for (const b of this.battleHits) { const d = (b.x - sx) ** 2 + (b.y - sy) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }
  private particles: { x: number; y: number; t0: number; kind: 'flash' | 'smoke'; s: number }[] = [];
  /** high-quality effects (Beautiful graphics) */
  private fx = new Fx();
  private lastFxT = 0;
  private lastCounterT = 0;
  private unitPos = new Map<string, [number, number]>();
  private garrisonCache = new Map<number, { key: string; list: { prov: number; troops: number }[] }>();
  /** Where a country keeps the troops not committed to offensives: its capital and the borders facing hostile neighbours. */
  private garrisonsOf(state: GameState, cid: number) {
    const C = state.countries[cid];
    const key = `${this.ownersVersion}|${Math.round(C.mil.troops / 5000)}|${state.wars.length}|${Math.floor(state.tick / 8)}`;
    const hit = this.garrisonCache.get(cid);
    if (hit && hit.key === key) return hit.list;
    const geo = this.geom.geo, owner = state.owner;
    const atWar = state.wars.some((w) => w.attackers.includes(cid) || w.defenders.includes(cid));
    const idle = C.mil.troops * (atWar ? 1 - C.mil.commit * 0.8 : 1);
    const threat = new Map<number, number>();
    for (const p of C.provinces) {
      let v = 0;
      for (const q of geo.adj[p]) {
        const o = owner[q];
        if (o === cid) continue;
        v += areAtWar(state, cid, o) ? 3 : getRelation(state, cid, o) < -20 ? 1 : 0;
      }
      if (v > 0) threat.set(p, v);
    }
    const borders = [...threat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p]) => p);
    const spots = [C.capital, ...borders.filter((p) => p !== C.capital)];
    const wts = spots.map((p, i) => (i === 0 ? 1 : 1.2 + 0.3 * (threat.get(p) ?? 0)));
    const sum = wts.reduce((a, b) => a + b, 0) || 1;
    const list = spots.map((p, i) => ({ prov: p, troops: (idle * wts[i]) / sum })).filter((g) => g.troops > 2000);
    this.garrisonCache.set(cid, { key, list });
    return list;
  }

  /**
   * Static part of the battles (captured cells, frontlines, arrows) plus the positions of markers and counters:
   * rebuilt only when a week passes or the view moves; each frame then just copies it and animates on top.
   */
  private renderBattleLayer(state: GameState) {
    const { k, x: vx, y: vy } = this.view;
    const geo = this.geom.geo;
    const P = state.player;
    const t = 0;
    const bc = this.battleCanvas;
    if (bc.width !== this.overlay.width || bc.height !== this.overlay.height) { bc.width = this.overlay.width; bc.height = this.overlay.height; bc.style.width = `${this.w}px`; bc.style.height = `${this.h}px`; }
    const ctx = bc.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bc.width, bc.height);
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * vx, this.dpr * vy);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const fronts: { segs: number[]; bx: number; by: number; size: number; heat: number; path?: Path2D }[] = [];
    const planes: { x0: number; y0: number; x1: number; y1: number; color: string; seed: number }[] = [];
    const markers: { x: number; y: number; war: number; prov: number; by: number; mine: boolean; heat: number }[] = [];
    const counters: { key: string; x: number; y: number; color: string; troops: number; org: number; armor: boolean; enemy: boolean; mine: boolean; gen?: number }[] = [];
    const supplies: { pts: number[]; sup: number; mine: boolean }[] = [];
    const pockets: { x: number; y: number; n: number; mine: boolean }[] = [];
    const arrows: { sx: number; sy: number; cx: number; cy: number; hx: number; hy: number; mine: boolean }[] = [];
    const myWar = (w: { attackers: number[]; defenders: number[] }) => w.attackers.includes(P) || w.defenders.includes(P);
    const armiesOn = !!state.armies?.length && (state.settings.control?.military ?? 'hands') !== 'auto';

    // encircled pockets: cut-off land, hatched and ringed in orange
    {
      const seenC = new Set<number>();
      for (const w of state.wars) for (const cid of [...w.attackers, ...w.defenders]) {
        if (seenC.has(cid) || !state.countries[cid]?.alive) continue;
        seenC.add(cid);
        const pk = supplyNet(state, geo, cid).pocket;
        if (!pk.length) continue;
        const ring = new Path2D();
        let cx = 0, cy = 0, n = 0;
        for (const p of pk) { if (!this.geomVisible(p)) continue; ring.addPath(this.geom.provPaths[p]); const sd = geo.provinces[p].seed; cx += sd[0]; cy += sd[1]; n++; }
        if (!n) continue;
        const pat = this.stripeFor('rgba(255,150,40,0.9)');
        pat.setTransform(new DOMMatrix().scale(1 / k));
        ctx.globalAlpha = 0.32; ctx.fillStyle = pat; ctx.fill(ring, 'evenodd'); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(20,10,4,0.7)'; ctx.lineWidth = 3.2 / k; ctx.stroke(ring);
        ctx.strokeStyle = 'rgba(255,160,50,0.95)'; ctx.lineWidth = 1.5 / k; ctx.setLineDash([4 / k, 3 / k]); ctx.stroke(ring); ctx.setLineDash([]);
        pockets.push({ x: cx / n, y: cy / n, n: pk.length, mine: cid === P });
      }
    }

    // supply lines of the player's offensives (and of the enemies attacking it): hub → front, coloured by how well supplied
    for (const w of state.wars) {
      if (!myWar(w)) continue;
      for (const fr of w.fronts) {
        if (fr.amphibious || fr.from === undefined || fr.from < 0 || !this.geomVisible(fr.prov)) continue;
        const mine = fr.by === P || (w.attackers.includes(P) ? w.attackers : w.defenders).includes(fr.by);
        if (!mine && state.owner[fr.prov] !== P) continue;
        const chain = supplyPath(supplyNet(state, geo, fr.by), fr.from, 40);
        if (!chain.length) continue;
        const pts: number[] = [];
        for (let i = chain.length - 1; i >= 0; i--) { const sd = geo.provinces[chain[i]].seed; pts.push(sd[0], sd[1]); }
        const tg = geo.provinces[fr.prov].seed, last = geo.provinces[fr.from].seed;
        pts.push(last[0] + (tg[0] - last[0]) * 0.35, last[1] + (tg[1] - last[1]) * 0.35);
        supplies.push({ pts: smoothPts(pts), sup: fr.sup ?? 1, mine });
      }
    }
    for (const sl of supplies) {
      const path = linePath(sl.pts);
      const col = sl.sup < 0.55 ? '232,70,52' : sl.sup < 0.75 ? '240,180,60' : '110,215,140';
      ctx.strokeStyle = 'rgba(12,8,4,0.6)'; ctx.lineWidth = (sl.mine ? 4 : 3) / k; ctx.stroke(path);
      ctx.strokeStyle = `rgba(${col},${sl.mine ? 0.95 : 0.6})`; ctx.lineWidth = (sl.mine ? 1.9 : 1.2) / k;
      ctx.setLineDash([5 / k, 3.5 / k]); ctx.stroke(path); ctx.setLineDash([]);
      // the hub it starts from: a small crate
      const hx = sl.pts[0], hy = sl.pts[1], r = (sl.mine ? 4.2 : 3.2) / k;
      ctx.fillStyle = 'rgba(12,8,4,0.85)'; ctx.fillRect(hx - r - 1 / k, hy - r - 1 / k, 2 * r + 2 / k, 2 * r + 2 / k);
      ctx.fillStyle = `rgb(${col})`; ctx.fillRect(hx - r, hy - r, 2 * r, 2 * r);
      ctx.strokeStyle = 'rgba(12,8,4,0.8)'; ctx.lineWidth = 0.8 / k;
      ctx.beginPath(); ctx.moveTo(hx - r, hy - r); ctx.lineTo(hx + r, hy + r); ctx.moveTo(hx + r, hy - r); ctx.lineTo(hx - r, hy + r); ctx.stroke();
    }

    for (const w of state.wars) {
      for (const fr of w.fronts) {
        if (!this.geomVisible(fr.prov)) continue;
        const defender = state.owner[fr.prov];
        if (!state.countries[defender]?.alive || !state.countries[fr.by]?.alive) continue;
        const side = w.attackers.includes(fr.by) ? w.attackers : w.defenders;
        let src: number | null = null;
        for (const q of geo.adj[fr.prov]) if (state.owner[q] === fr.by) { src = q; break; }
        if (src === null) for (const q of geo.adj[fr.prov]) if (side.includes(state.owner[q])) { src = q; break; }
        const airOp = src === null ? state.countries[fr.by].mil.ops?.find((o) => o.prov === fr.prov && o.kind === 'airborne' && o.until > state.tick) : undefined;
        if (src === null && (fr.amphibious || airOp)) {
          let bd = 1e9;
          for (const q of state.countries[fr.by].provinces) { const d = geo.dist(q, fr.prov); if (d < bd && (airOp || geo.provinces[q].coast > 0.15)) { bd = d; src = q; } }
        }
        const cells = this.battlefield.cells(fr.prov);
        const ord = this.battlefield.order(state, fr.prov, side, src, this.ownersVersion);
        const prog = Math.max(0, Math.min(1, fr.progress));
        const nOcc = Math.min(cells.n, Math.round(prog * cells.n));
        const occ = new Uint8Array(cells.n);
        for (let i = 0; i < nOcc; i++) occ[ord[i]] = 1;
        const mine = fr.by === P;
        const atkCol = this.colorSnap[fr.by] || '#888';

        ctx.save();
        ctx.clip(this.geom.provPaths[fr.prov], 'evenodd');
        // contested ground: a faint red wash over the whole region
        ctx.fillStyle = 'rgba(255,60,40,0.08)';
        ctx.fill(this.geom.provPaths[fr.prov], 'evenodd');
        // ground taken so far, in the attacker's colour with occupation hatching
        if (nOcc > 0) {
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = atkCol;
          for (let i = 0; i < cells.n; i++) if (occ[i]) ctx.fill(cells.paths[i]);
          const pat = this.stripeFor('rgba(20,12,6,0.55)');
          pat.setTransform(new DOMMatrix().scale(1 / k));
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = pat;
          for (let i = 0; i < cells.n; i++) if (occ[i]) ctx.fill(cells.paths[i]);
          ctx.globalAlpha = 1;
        }
        // the live frontline between taken and untaken cells
        const seg = new Path2D();
        let fx = 0, fy = 0, fn = 0;
        const frontSegs: number[] = [];
        if (nOcc > 0 && nOcc < cells.n) {
          for (const [i, j, x1, y1, x2, y2] of cells.edges) {
            if (occ[i] === occ[j]) continue;
            seg.moveTo(x1, y1); seg.lineTo(x2, y2);
            fx += (x1 + x2) / 2; fy += (y1 + y2) / 2; fn++;
            frontSegs.push(x1, y1, x2, y2);
          }
        }
        if (fn) {
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(255,70,40,0.35)'; ctx.lineWidth = 6 / k; ctx.stroke(seg);
          ctx.strokeStyle = 'rgba(214,32,24,1)'; ctx.lineWidth = 2.4 / k; ctx.stroke(seg);
          ctx.strokeStyle = 'rgba(255,236,200,0.9)'; ctx.lineWidth = 0.8 / k;
          ctx.setLineDash([2 / k, 3 / k]); ctx.lineDashOffset = -t * 8 / k; ctx.stroke(seg); ctx.setLineDash([]);
        }
        ctx.restore();

        // where the fighting is: on the moving frontline, or at the region's edge before the first cell falls
        let bx: number, by: number;
        const tgt = geo.provinces[fr.prov].seed;
        if (fn) { bx = fx / fn; by = fy / fn; }
        else if (src !== null) { const s0 = geo.provinces[src].seed; bx = s0[0] + (tgt[0] - s0[0]) * 0.55; by = s0[1] + (tgt[1] - s0[1]) * 0.55; }
        else { bx = tgt[0]; by = tgt[1]; }

        const intensity = Math.min(1, ((fr.atk ?? 0) + (fr.def ?? 0)) / 60000 + 0.25);
        fronts.push({ segs: frontSegs, bx, by, size: cells.size, heat: intensity, path: fn ? seg : undefined });

        // the offensive's arrow, from the attacker's ground to the fighting
        if (src !== null) {
          const s0 = geo.provinces[src].seed;
          const ar = this.drawArrow(ctx, s0[0], s0[1], bx, by, fr.amphibious || !!airOp, airOp ? [150, 205, 255] : mine ? [255, 196, 64] : [235, 60, 44], k, t, prog);
          if (ar) arrows.push({ ...ar, mine });
          if (airOp) {
            // parachutes drifting down over the drop zone
            for (let i = 0; i < 3; i++) {
              const px = tgt[0] + (i - 1) * 7 / k, py = tgt[1] - (8 + (i % 2) * 5) / k, r2 = 3.6 / k;
              ctx.fillStyle = 'rgba(235,245,255,0.95)'; ctx.strokeStyle = 'rgba(20,30,40,0.9)'; ctx.lineWidth = 0.7 / k;
              ctx.beginPath(); ctx.arc(px, py, r2, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(px - r2, py); ctx.lineTo(px, py + 5 / k); ctx.lineTo(px + r2, py); ctx.stroke();
            }
          }
        }
        // aircraft over the front when one side owns the sky
        const air = airSuperiority(state.countries[fr.by], state.countries[defender]);
        if (Math.abs(air) > 0.25 && src !== null) {
          const s0 = geo.provinces[src].seed;
          const owner = air > 0 ? fr.by : defender;
          const [ax0, ay0, ax1, ay1] = air > 0 ? [s0[0], s0[1], tgt[0], tgt[1]] : [tgt[0], tgt[1], s0[0], s0[1]];
          planes.push({ x0: ax0, y0: ay0, x1: ax1, y1: ay1, color: this.colorSnap[owner] || '#ccc', seed: fr.prov * 0.137 });
        }

        // army counters: attacker behind its front, defender in front of it
        const dx = tgt[0] - bx, dy = tgt[1] - by, dl = Math.hypot(dx, dy) || 1;
        const off = Math.max(cells.size * 0.9, 22 / k);
        const atk = state.countries[fr.by], def = state.countries[defender];
        const gA = generalAt(atk, fr.prov);
        // with army groups in command, the player's own formations are the banners, not counters
        if (!(fr.by === P && armiesOn)) counters.push({ gen: gA ? stars(gA) : 0, key: `a${w.id}:${fr.prov}:${fr.by}`, x: bx - (dx / dl) * off, y: by - (dy / dl) * off, color: atkCol, troops: fr.atk ?? 0, org: atk.mil.readiness * (1 - atk.mil.exhaustion), armor: atk.mil.equipArmy / Math.max(1, atk.mil.troops) > 140000, enemy: fr.by !== P && !side.includes(P), mine });
        const gD = homeCommander(def);
        counters.push({ gen: gD ? stars(gD) : 0, key: `d${w.id}:${fr.prov}`, x: bx + (dx / dl) * off, y: by + (dy / dl) * off, color: this.colorSnap[defender] || '#888', troops: fr.def ?? 0, org: def.mil.readiness * (1 - def.mil.exhaustion), armor: def.mil.equipArmy / Math.max(1, def.mil.troops) > 140000, enemy: defender !== P && side.includes(P), mine: defender === P });
        markers.push({ x: bx, y: by, war: w.id, prov: fr.prov, by: fr.by, mine: mine || defender === P, heat: intensity });
      }
    }

    // garrisons: the player's armies (and its enemies') holding the capital and the most threatened borders
    if (k > this.fitK * (this.w < 600 ? 3.4 : 2.2)) {
      const who = new Set<number>([P]);
      for (const w of state.wars) if (w.attackers.includes(P) || w.defenders.includes(P)) for (const x of [...w.attackers, ...w.defenders]) who.add(x);
      for (const cid of who) {
        const C = state.countries[cid];
        if (!C?.alive || !C.provinces.length) continue;
        if (cid === P && armiesOn) continue;
        for (const g of this.garrisonsOf(state, cid)) {
          const gp = geo.provinces[g.prov];
          if (!this.geomVisible(g.prov)) continue;
          counters.push({ key: `g${cid}:${g.prov}`, x: gp.seed[0], y: gp.seed[1], color: this.colorSnap[cid] || '#888', troops: g.troops, org: C.mil.readiness * (1 - C.mil.exhaustion), armor: C.mil.equipArmy / Math.max(1, C.mil.troops) > 140000, enemy: cid !== P && areAtWar(state, cid, P), mine: cid === P });
        }
      }
    }
    this.battleData = { fronts, planes, markers, counters, supplies, pockets, arrows };
  }

  private battleCanvas: HTMLCanvasElement = document.createElement('canvas');
  private battleDom = false;
  private battleTransform = '';
  /** 2 = full effects, 1 = lighter (fewer particles, slower ambient animation), 0 = still battles (slow devices) */
  quality: 0 | 1 | 2 = 2;
  private battleKey = '';
  private lastBattle = 0;
  private battleView: View = { k: 0, x: 0, y: 0 };
  private battlePending = false;
  private battleData: {
    fronts: { segs: number[]; bx: number; by: number; size: number; heat: number; path?: Path2D }[];
    planes: { x0: number; y0: number; x1: number; y1: number; color: string; seed: number }[];
    markers: { x: number; y: number; war: number; prov: number; by: number; mine: boolean; heat: number }[];
    counters: { key: string; x: number; y: number; color: string; troops: number; org: number; armor: boolean; enemy: boolean; mine: boolean; gen?: number }[];
    supplies: { pts: number[]; sup: number; mine: boolean }[];
    pockets: { x: number; y: number; n: number; mine: boolean }[];
    arrows?: { sx: number; sy: number; cx: number; cy: number; hx: number; hy: number; mine: boolean }[];
  } = { fronts: [], planes: [], markers: [], counters: [], supplies: [], pockets: [] };
  /** set by the map view: battles only animate while the clock runs */
  running = false;

  private drawBattles(ctx: CanvasRenderingContext2D, state: GameState, now: number) {
    const { k } = this.view;
    const t = now / 1000;
    // the battle layer is rebuilt when a week passes; while the view moves it is just shifted and scaled (rebuilt once you stop)
    const key = `${state.tick}|${this.ownersVersion}|${this.overlay.width}|${this.overlay.height}|${state.wars.length}|${this.mode}|${this.quality}`;
    const bv0 = this.battleView;
    const viewChanged = bv0.k !== k || bv0.x !== this.view.x || bv0.y !== this.view.y;
    const moving = now - this.lastViewChange < 130;
    this.battlePending = viewChanged && moving && this.battleData.fronts.length > 0; // keep drawing until the crisp rebuild
    // at high speed weeks fly by several times a second: rebuild at most ~2-3 times a second (the view settling always rebuilds)
    const gap = this.quality === 2 ? 330 : this.quality === 1 ? 500 : 900;
    const due = key !== this.battleKey && (now - this.lastBattle > gap || key.split('|')[1] !== this.battleKey.split('|')[1]);
    if (due || (viewChanged && !moving)) {
      this.battleKey = key; this.battleView = { ...this.view }; this.lastBattle = now;
      this.renderBattleLayer(state);
      this.paintBattleScreen();
    } else if (key !== this.battleKey) this.dirty = true;
    const { fronts, planes, markers, supplies, pockets } = this.battleData;
    this.battleVisible = fronts.length > 0 && this.running && this.quality > 0;
    // the battle layer is its own canvas, moved with a CSS transform: nothing to copy per frame
    const bv = this.battleView, f = k / bv.k;
    if (this.battleDom) {
      const show = fronts.length > 0 || pockets.length > 0;
      const tf = show ? `translate3d(${(this.view.x - bv.x * f).toFixed(2)}px, ${(this.view.y - bv.y * f).toFixed(2)}px, 0) scale(${f.toFixed(5)})` : 'none';
      if (tf !== this.battleTransform) { this.battleTransform = tf; this.battleCanvas.style.transform = tf; this.battleCanvas.style.visibility = show ? 'visible' : 'hidden'; }
    } else if (fronts.length || pockets.length) {
      ctx.save();
      ctx.setTransform(f, 0, 0, f, (this.view.x - bv.x * f) * this.dpr, (this.view.y - bv.y * f) * this.dpr);
      ctx.drawImage(this.battleCanvas, 0, 0);
      ctx.restore();
    }
    const V = this.view;
    this.battleHits = markers.map((m) => ({ x: m.x * V.k + V.x, y: m.y * V.k + V.y, war: m.war, prov: m.prov, by: m.by }));
    if (this.quality === 0) return; // low quality: a still picture of the war, no ambient animation
    if (this.quality === 2) {
      // Beautiful: soft shell bursts, sparks, rings and drifting smoke; contrails; pulses down the arrows
      const dt = Math.min(0.1, Math.max(0, (now - (this.lastFxT || now)) / 1000));
      this.lastFxT = now;
      if (this.running) for (const fr of fronts) {
        const rate = 3.2 * fr.heat; // shells per second on this front
        if (Math.random() >= 1 - Math.exp(-rate * dt)) continue;
        let px = fr.bx, py = fr.by;
        if (fr.segs.length) { const i = Math.floor(Math.random() * (fr.segs.length / 4)) * 4; const u = Math.random(); px = fr.segs[i] + (fr.segs[i + 2] - fr.segs[i]) * u; py = fr.segs[i + 1] + (fr.segs[i + 3] - fr.segs[i + 1]) * u; }
        const jit = fr.size * 0.7;
        this.fx.shell(px + (Math.random() - 0.5) * jit, py + (Math.random() - 0.5) * jit, now, 0.75 + 0.5 * fr.heat);
      }
      for (const a of this.battleData.arrows ?? []) this.fx.arrowPulse(ctx, a, k, this.running ? t : 0);
      this.fx.draw(ctx, k, now);
      for (const pl of planes) {
        const speed = 0.35;
        const at = (back: number): [number, number] => { const ph = ((((t - back) * speed + pl.seed) % 1) + 1) % 1; return [pl.x0 + (pl.x1 - pl.x0) * ph * 1.3, pl.y0 + (pl.y1 - pl.y0) * ph * 1.3 - 4 / k]; };
        const ph = ((t * speed + pl.seed) % 1);
        this.fx.plane(ctx, at, Math.atan2(pl.y1 - pl.y0, pl.x1 - pl.x0), pl.color, k, Math.sin(ph * Math.PI), now);
        // bombs fall where the aircraft cross the target
        if (this.running && ph > 0.7 && ph < 0.78 && Math.random() < 0.25) { const [bx2, by2] = at(0.15); this.fx.shell(bx2, by2, now, 0.6); }
      }
    } else {
    // artillery: flashes and smoke along the lines (only while time runs)
    const rate = 0.06;
    if (this.running) for (const fr of fronts) {
      if (Math.random() >= rate * fr.heat || this.particles.length >= 30) continue;
      let px = fr.bx, py = fr.by;
      if (fr.segs.length) { const i = Math.floor(Math.random() * (fr.segs.length / 4)) * 4; const u = Math.random(); px = fr.segs[i] + (fr.segs[i + 2] - fr.segs[i]) * u; py = fr.segs[i + 1] + (fr.segs[i + 3] - fr.segs[i + 1]) * u; }
      const jit = fr.size * 0.6;
      px += (Math.random() - 0.5) * jit; py += (Math.random() - 0.5) * jit;
      this.particles.push({ x: px, y: py, t0: now, kind: 'flash', s: 0.7 + Math.random() * 0.8 });
      this.particles.push({ x: px, y: py, t0: now + 80, kind: 'smoke', s: 0.8 + Math.random() });
    }
    for (const pl of planes) {
      const ph = ((t * 0.35 + pl.seed) % 1);
      this.drawPlane(ctx, pl.x0 + (pl.x1 - pl.x0) * ph * 1.3, pl.y0 + (pl.y1 - pl.y0) * ph * 1.3 - 4 / k, Math.atan2(pl.y1 - pl.y0, pl.x1 - pl.x0), pl.color, k, Math.sin(ph * Math.PI));
    }
    }
    // the frontline crackles: sparks of light run along it while the battle goes on
    if (this.quality === 2 && this.running) {
      ctx.setLineDash([2.5 / k, 10 / k]); ctx.lineDashOffset = -(t * 22) / k;
      ctx.strokeStyle = 'rgba(255,236,190,0.85)'; ctx.lineWidth = 1.3 / k; ctx.lineCap = 'round';
      for (const fr of fronts) if (fr.path) ctx.stroke(fr.path);
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // convoys rolling along the supply lines towards the front
    for (const sl of supplies) {
      if (!sl.mine) continue;
      const n = sl.pts.length / 2 - 1;
      if (n < 1) continue;
      for (let d = 0; d < 2; d++) {
        const u = (((this.running ? t : 0) * 0.18 + d * 0.5 + sl.pts[0] * 0.01) % 1) * n;
        const i = Math.min(n - 1, Math.floor(u)), f2 = u - i;
        const x = sl.pts[2 * i] + (sl.pts[2 * i + 2] - sl.pts[2 * i]) * f2, y = sl.pts[2 * i + 1] + (sl.pts[2 * i + 3] - sl.pts[2 * i + 1]) * f2;
        ctx.fillStyle = 'rgba(12,8,4,0.85)'; ctx.beginPath(); ctx.arc(x, y, 2.6 / k, 0, 6.283); ctx.fill();
        ctx.fillStyle = sl.sup < 0.55 ? '#ff8a70' : sl.sup < 0.75 ? '#ffd27a' : '#c8ffd8'; ctx.beginPath(); ctx.arc(x, y, 1.6 / k, 0, 6.283); ctx.fill();
      }
    }
    // particles (world units, constant screen size)
    this.particles = this.particles.filter((p) => now - p.t0 < (p.kind === 'flash' ? 380 : 1400));
    for (const p of this.particles) {
      const a = (now - p.t0) / (p.kind === 'flash' ? 380 : 1400);
      if (a < 0) continue;
      if (p.kind === 'flash') {
        ctx.fillStyle = `rgba(255,${(200 - a * 120) | 0},${(90 - a * 80) | 0},${0.95 * (1 - a)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, ((1.5 + a * 4) * p.s) / k, 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = `rgba(60,55,50,${0.35 * (1 - a)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y - (a * 6) / k, ((2 + a * 6) * p.s) / k, 0, 6.283); ctx.fill();
      }
    }
    // a pulsing ring around each battle marker (the marker itself is part of the battle layer)
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.quality === 2 && k > this.fitK * 1.5) {
      // Beautiful: army counters glide to their new positions as the front moves
      const { counters } = this.battleData;
      const seen = new Set<string>();
      const taken: [number, number, number, number][] = this.battleHits.map((m) => [m.x - 12, m.y - 12, m.x + 12, m.y + 12]);
      const overlaps = (r: [number, number, number, number]) => taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
      const ease = 1 - Math.pow(0.0015, Math.min(0.1, (now - (this.lastCounterT || now)) / 1000));
      this.lastCounterT = now;
      for (const c of [...counters].sort((a, b) => Number(b.mine) - Number(a.mine) || b.troops - a.troops).slice(0, this.w < 600 ? 12 : 28)) {
        seen.add(c.key);
        let pos = this.unitPos.get(c.key);
        if (!pos) { pos = [c.x, c.y]; this.unitPos.set(c.key, pos); }
        pos[0] += (c.x - pos[0]) * ease; pos[1] += (c.y - pos[1]) * ease;
        let sx = pos[0] * V.k + V.x, sy = pos[1] * V.k + V.y;
        for (let tries = 0; tries < 6; tries++) {
          const r: [number, number, number, number] = [sx - 16, sy - 9, sx + 16, sy + 13];
          if (!overlaps(r)) break;
          sy += tries % 2 === 0 ? 24 * (tries + 1) : -24 * (tries + 1);
        }
        taken.push([sx - 16, sy - 9, sx + 16, sy + 13]);
        this.blitCounter(ctx, sx, sy, c, k);
      }
      for (const key of [...this.unitPos.keys()]) if (!seen.has(key)) this.unitPos.delete(key);
    }
    for (const m of this.battleHits) {
      const src = markers.find((x) => x.prov === m.prov && x.by === m.by);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + m.x * 0.05);
      ctx.strokeStyle = `rgba(255,${src?.mine ? 200 : 90},${src?.mine ? 80 : 50},${0.25 + 0.45 * pulse * (src?.heat ?? 0.5)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 11.5 + 4 * pulse, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
  }

  /** Screen-space parts of the battle layer (army counters, pocket labels, battle markers), drawn once per rebuild. */
  private paintBattleScreen() {
    const { counters, markers, pockets } = this.battleData;
    const ctx = this.battleCanvas.getContext('2d')!;
    const V = this.battleView, k = V.k;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const showCounters = k > this.fitK * 1.5;
    // keep counters readable: the biggest armies first, never more than ~28, nudged so they do not overlap
    const taken: [number, number, number, number][] = markers.map((m) => { const sx = m.x * V.k + V.x, sy = m.y * V.k + V.y; return [sx - 12, sy - 12, sx + 12, sy + 12]; });
    const overlaps = (r: [number, number, number, number]) => taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const cap = this.quality === 0 ? 8 : this.w < 600 ? 12 : 28;
    if (showCounters && this.quality < 2) for (const c of [...counters].sort((a, b) => Number(b.mine) - Number(a.mine) || b.troops - a.troops).slice(0, cap)) {
      let sx = c.x * V.k + V.x, sy = c.y * V.k + V.y;
      for (let tries = 0; tries < 6; tries++) {
        const r: [number, number, number, number] = [sx - 16, sy - 9, sx + 16, sy + 13];
        if (!overlaps(r)) break;
        sy += tries % 2 === 0 ? 24 * (tries + 1) : -24 * (tries + 1);
      }
      taken.push([sx - 16, sy - 9, sx + 16, sy + 13]);
      this.blitCounter(ctx, sx, sy, c, k);
    }
    for (const pk of pockets) {
      const sx = pk.x * V.k + V.x, sy = pk.y * V.k + V.y;
      if (sx < -40 || sy < -20 || sx > this.w + 40 || sy > this.h + 20) continue;
      const label = pk.n > 1 ? `ENCIRCLED ×${pk.n}` : 'ENCIRCLED';
      ctx.font = `800 9.5px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(16,8,2,0.88)'; ctx.fillRect(sx - tw / 2, sy - 8, tw, 16);
      ctx.strokeStyle = pk.mine ? '#ff6a4a' : '#ffa032'; ctx.lineWidth = 1.2; ctx.strokeRect(sx - tw / 2, sy - 8, tw, 16);
      ctx.fillStyle = '#ffc070'; ctx.fillText(label, sx, sy + 0.5);
    }
    for (const m of markers) this.drawBattleMarker(ctx, m.x * V.k + V.x, m.y * V.k + V.y, m.mine, m.heat, 0);
    ctx.restore();
  }

  /** Crossed swords in a ring: "a battle is being fought here" (click for the report). */
  private drawBattleMarker(ctx: CanvasRenderingContext2D, x: number, y: number, mine: boolean, heat: number, t: number) {
    ctx.fillStyle = `rgba(255,90,40,${0.22 + 0.15 * heat})`;
    ctx.beginPath(); ctx.arc(x, y, 12.5, 0, 6.283); ctx.fill();
    void t;
    ctx.fillStyle = 'rgba(16,10,6,0.92)';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = mine ? '#ffcf5a' : '#ff6a4a';
    ctx.stroke();
    ctx.strokeStyle = '#f4ead4'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 4.5, y - 4.5); ctx.lineTo(x + 4.5, y + 4.5); ctx.moveTo(x + 4.5, y - 4.5); ctx.lineTo(x - 4.5, y + 4.5); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - 5.5, y + 2.5); ctx.lineTo(x - 2.5, y + 5.5); ctx.moveTo(x + 5.5, y + 2.5); ctx.lineTo(x + 2.5, y + 5.5); ctx.stroke();
  }

  private drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, color: string, k: number, alpha: number) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1 / k, 1 / k);
    ctx.globalAlpha = 0.25 + 0.75 * alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(1.5, 6, 6, 1.6, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(12,8,4,0.9)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(1, -1); ctx.lineTo(-1, -6.5); ctx.lineTo(-3, -6.5); ctx.lineTo(-2, -1); ctx.lineTo(-6, -1); ctx.lineTo(-7.5, -3.2); ctx.lineTo(-8.5, -3.2);
    ctx.lineTo(-7.5, 0); ctx.lineTo(-8.5, 3.2); ctx.lineTo(-7.5, 3.2); ctx.lineTo(-6, 1); ctx.lineTo(-2, 1); ctx.lineTo(-3, 6.5); ctx.lineTo(-1, 6.5); ctx.lineTo(1, 1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** A broad, tapered offensive arrow along a gentle curve, with marching light inside it. */
  private drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, amphibious: boolean, col: number[], k: number, t: number, progress: number) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return null;
    const bend = (amphibious ? 0.22 : 0.1) * L;
    const cx = (x0 + x1) / 2 + (-dy / L) * bend, cy = (y0 + y1) / 2 + (dx / L) * bend;
    const sx = x0 + dx * 0.12, sy = y0 + dy * 0.12; // start a little inside the source region
    const N = 14, headAt = 0.78;
    const q = (u: number): [number, number] => [(1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * x1, (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * y1];
    const qd = (u: number): [number, number] => [2 * (1 - u) * (cx - sx) + 2 * u * (x1 - cx), 2 * (1 - u) * (cy - sy) + 2 * u * (y1 - cy)];
    const wpx = Math.min(5, 2.2 + L * k * 0.012);
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * headAt;
      const [px, py] = q(u), [tx, ty] = qd(u);
      const tl = Math.hypot(tx, ty) || 1;
      const hw = ((wpx * (0.55 + 0.45 * (u / headAt))) / k);
      left.push([px - (ty / tl) * hw, py + (tx / tl) * hw]);
      right.push([px + (ty / tl) * hw, py - (tx / tl) * hw]);
    }
    const [hx, hy] = q(headAt), [htx, hty] = qd(headAt);
    const htl = Math.hypot(htx, hty) || 1;
    const hw = (wpx * 2.1) / k;
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(hx - (hty / htl) * hw, hy + (htx / htl) * hw);
    ctx.lineTo(x1, y1);
    ctx.lineTo(hx + (hty / htl) * hw, hy - (htx / htl) * hw);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    if (this.quality === 2 && [sx, sy, x1, y1].every(Number.isFinite)) {
      // painted like a staff map: a dark casing, a colour that strengthens towards the head, a lit edge
      const g = ctx.createLinearGradient(sx, sy, x1, y1);
      const a = 0.62 + 0.28 * Math.min(1, progress);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.12)`);
      g.addColorStop(0.45, `rgba(${col[0]},${col[1]},${col[2]},${(a * 0.8).toFixed(2)})`);
      g.addColorStop(1, `rgba(${Math.min(255, col[0] + 20)},${Math.min(255, col[1] + 20)},${Math.min(255, col[2] + 20)},${a.toFixed(2)})`);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(16,8,4,0.9)'; ctx.lineWidth = 1.5 / k; ctx.stroke();
      ctx.strokeStyle = `rgba(255,245,220,0.35)`; ctx.lineWidth = 0.6 / k; ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + 0.25 * Math.min(1, progress)})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,10,6,0.75)'; ctx.lineWidth = 0.8 / k; ctx.stroke();
    }
    // marching light
    ctx.strokeStyle = 'rgba(255,250,230,0.75)'; ctx.lineWidth = 0.9 / k;
    ctx.setLineDash([3 / k, 5 / k]); ctx.lineDashOffset = -t * 16 / k;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(cx, cy, hx, hy); ctx.stroke();
    ctx.setLineDash([]);
    return { sx, sy, cx, cy, hx, hy };
  }

  private counterSprites = new Map<string, HTMLCanvasElement>();
  /** Counters are drawn once into small sprites (keyed by everything they show) and then just copied each frame. */
  private blitCounter(ctx: CanvasRenderingContext2D, sx: number, sy: number, c: { color: string; troops: number; org: number; armor: boolean; enemy: boolean; mine: boolean; gen?: number }, k: number) {
    const showLabel = k > this.fitK * 5 && c.troops > 0;
    const divs = Math.max(1, Math.round(c.troops / 10000));
    const key = `${c.gen ?? 0}|${c.color}|${divs}|${c.armor ? 1 : 0}|${Math.round(Math.max(0, Math.min(1, c.org)) * 29)}|${c.mine ? 1 : 0}${c.enemy ? 1 : 0}|${showLabel ? fmtNum(c.troops, 0) : ''}|${this.dpr}`;
    let sp = this.counterSprites.get(key);
    const W = 48, H = 52, ox = 24, oy = 22; // sprite box around the counter's centre (room for the shadow and the troop label)
    if (!sp) {
      if (this.counterSprites.size > 240) this.counterSprites.clear();
      sp = document.createElement('canvas');
      sp.width = Math.ceil(W * this.dpr); sp.height = Math.ceil(H * this.dpr);
      const g = sp.getContext('2d')!;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawCounter(g, ox, oy, c, showLabel ? Infinity : 0);
      this.counterSprites.set(key, sp);
    }
    ctx.drawImage(sp, Math.round((sx - ox) * this.dpr) / this.dpr, Math.round((sy - oy) * this.dpr) / this.dpr, W, H);
  }

  /**
   * NATO-style army counter in the country's colour: infantry (crossed box) or armour (oval), the number of
   * divisions (10,000 troops each), and a strength bar (readiness x morale). Screen coordinates.
   */
  private drawCounter(ctx: CanvasRenderingContext2D, sx: number, sy: number, c: { color: string; troops: number; org: number; armor: boolean; enemy: boolean; mine: boolean; gen?: number }, k: number) {
    const w = 30, h = 16;
    const x0 = sx - w / 2, y0 = sy - h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x0 + 2, y0 + 2, w, h + 5);
    ctx.fillStyle = c.color; ctx.fillRect(x0, y0, w, h);
    // division count panel on the left
    const divs = Math.max(1, Math.round(c.troops / 10000));
    ctx.fillStyle = 'rgba(12,8,4,0.82)'; ctx.fillRect(x0, y0, 12, h);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${divs > 99 ? 7.5 : 9}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(divs), x0 + 6, y0 + h / 2 + 0.5);
    // unit symbol
    const ix = x0 + 14, iw = 13, ih = 9, iy = y0 + (h - ih) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.1;
    ctx.strokeRect(ix, iy, iw, ih);
    ctx.beginPath();
    if (c.armor) ctx.ellipse(ix + iw / 2, iy + ih / 2, iw / 2 - 2.2, ih / 2 - 1.6, 0, 0, 6.283);
    else { ctx.moveTo(ix, iy); ctx.lineTo(ix + iw, iy + ih); ctx.moveTo(ix + iw, iy); ctx.lineTo(ix, iy + ih); }
    ctx.stroke();
    // strength bar
    const org = Math.max(0, Math.min(1, c.org));
    ctx.fillStyle = 'rgba(12,8,4,0.85)'; ctx.fillRect(x0, y0 + h, w, 4);
    ctx.fillStyle = org > 0.6 ? '#5fd17a' : org > 0.35 ? '#e8c14a' : '#e8553f'; ctx.fillRect(x0 + 0.5, y0 + h + 0.5, (w - 1) * org, 3);
    ctx.strokeStyle = c.mine ? '#ffd56a' : c.enemy ? 'rgba(255,90,70,0.95)' : 'rgba(12,8,4,0.95)'; ctx.lineWidth = c.mine || c.enemy ? 1.6 : 1.2;
    ctx.strokeRect(x0, y0, w, h + 4);
    if (c.gen) {
      // the commanding general's stars, on a small tab above the counter
      const st = '★'.repeat(c.gen);
      ctx.font = `700 8px ${UI_FONT}`;
      const tw = ctx.measureText(st).width + 6;
      ctx.fillStyle = 'rgba(12,8,4,0.9)'; ctx.fillRect(sx - tw / 2, y0 - 9, tw, 9);
      ctx.fillStyle = '#ffcf5a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st, sx, y0 - 4.2);
    }
    if (k > this.fitK * 5 && c.troops) {
      const label = fmtNum(c.troops, 0);
      ctx.font = `700 9px ${UI_FONT}`;
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(10,8,6,0.85)'; ctx.fillRect(sx - tw / 2, y0 + h + 6, tw, 11);
      ctx.fillStyle = '#fff'; ctx.fillText(label, sx, y0 + h + 12);
    }
  }

  // ------------------------------------------------------------------ screen-space finishing
  private curveFor(state: GameState, c: number): LabelCurve | null {
    // keyed on this country's own territory, so a conquest elsewhere does not recompute every label
    const pv = state.countries[c].provinces;
    let sig = pv.length;
    for (let i = 0; i < pv.length; i++) sig = (sig * 31 + pv[i]) | 0;
    const hit = this.curves.get(c);
    if (hit && hit.v === sig) return hit.c;
    const cv = this.geom.labelCurve(state, c);
    this.curves.set(c, { v: sig, c: cv });
    return cv;
  }

  // ------------------------------------------------------------------ labels
  private drawLabels(ctx: CanvasRenderingContext2D, state: GameState) {
    const { k, x, y } = this.view;
    // drawn into the base layer, which extends `margin` px beyond the visible area on every side
    const m = this.margin, W = this.w + m, H = this.h + m;
    const geo = this.geom.geo;
    const zoomIn = k / this.fitK;
    const placed: [number, number, number, number][] = [];
    const free = (r: [number, number, number, number]) => !placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // country names: big, spaced, curved along each country's main landmass
    const order = state.countries.filter((c) => c.alive).map((c) => ({ c, cv: this.curveFor(state, c.id) })).filter((o) => o.cv).sort((a, b) => b.cv!.area - a.cv!.area);
    for (const { c, cv } of order) {
      const lc = cv!;
      const lenPx = lc.len * k * 0.86;
      const thickPx = lc.thick * k;
      // font size from the available length, limited by the shape's thickness; long names fall back to a short form
      const sizeFor = (nm: string) => Math.min(lenPx / (nm.length * 0.95 + 0.4), thickPx * 0.62, 64);
      let name = shortName(c.name).toUpperCase();
      const abbr = MAP_ABBR[c.name]?.toUpperCase();
      if (abbr && sizeFor(name) < 13 && sizeFor(abbr) > sizeFor(name) * 1.25) name = abbr;
      const n = name.length;
      let fs = sizeFor(name);
      const isP = c.id === state.player;
      if (isP || c.id === this.selected) fs = Math.max(fs, Math.min(12, lenPx / (n * 0.8)));
      if (fs < 7.5) continue;
      const cxs = (lc.mx + lc.ux * lc.t0 + lc.nx * (lc.a * lc.t0 * lc.t0 + lc.b * lc.t0 + lc.c)) * k + x;
      const cys = (lc.my + lc.uy * lc.t0 + lc.ny * (lc.a * lc.t0 * lc.t0 + lc.b * lc.t0 + lc.c)) * k + y;
      if (cxs < -m - lenPx || cys < -m - lenPx || cxs > W + lenPx || cys > H + lenPx) continue;
      ctx.font = `600 ${fs.toFixed(1)}px ${LABEL_FONT}`;
      const widths = [...name].map((ch) => ctx.measureText(ch).width);
      const raw = widths.reduce((s, v) => s + v, 0);
      // stretch the letters across the country, as an atlas would
      const spacing = n > 1 ? clamp((lenPx - raw) / (n - 1), fs * 0.06, fs * 1.1) : 0;
      const total = raw + spacing * (n - 1);
      // glyph positions along the curve (in world units relative to t0)
      const glyphs: { x: number; y: number; a: number; ch: string }[] = [];
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      let s = -total / 2;
      for (let i = 0; i < n; i++) {
        const mid = s + widths[i] / 2;
        const tw = lc.t0 + mid / k;
        const v = lc.a * tw * tw + lc.b * tw + lc.c;
        const gx = (lc.mx + lc.ux * tw + lc.nx * v) * k + x;
        const gy = (lc.my + lc.uy * tw + lc.ny * v) * k + y;
        const slope = 2 * lc.a * tw + lc.b;
        const ang = Math.atan2(lc.uy, lc.ux) + Math.atan(slope);
        glyphs.push({ x: gx, y: gy, a: ang, ch: name[i] });
        bx0 = Math.min(bx0, gx - fs * 0.5); by0 = Math.min(by0, gy - fs * 0.6); bx1 = Math.max(bx1, gx + fs * 0.5); by1 = Math.max(by1, gy + fs * 0.6);
        s += widths[i] + spacing;
      }
      const rect: [number, number, number, number] = [bx0, by0, bx1, by1];
      if (!free(rect)) continue;
      placed.push(rect);
      const alpha = clamp((fs - 7.5) / 4, 0, 1);
      ctx.globalAlpha = alpha * (zoomIn > 9 ? clamp(1 - (zoomIn - 9) / 6, 0.35, 1) : 1);
      ctx.lineWidth = Math.max(1.6, fs * 0.09);
      for (const g of glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y); ctx.rotate(g.a);
        ctx.strokeStyle = isP ? 'rgba(255,214,120,0.6)' : 'rgba(255,248,230,0.22)';
        ctx.strokeText(g.ch, 0, 0);
        ctx.fillStyle = isP ? 'rgba(48,28,4,0.95)' : 'rgba(16,11,6,0.9)';
        ctx.fillText(g.ch, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // seas and oceans (after country names, so they never push a country label off the map)
    for (const s of FEAT.seas) {
      const minZoom = s.r === 0 ? 0 : s.r === 1 ? 1.5 : s.r === 2 ? 3 : 5;
      if (zoomIn < minZoom) continue;
      const sx = (s.x / 10) * k + x, sy = (s.y / 10) * k + y;
      if (sx < -m - 100 || sy < -m - 20 || sx > W + 100 || sy > H + 20) continue;
      const ocean = s.r === 0;
      const fs = ocean ? clamp(9 + zoomIn * 2, 10, 19) : clamp(9 + zoomIn * 0.9, 10, 17);
      // oceans: capitals on two lines ("NORTH ATLANTIC / OCEAN") so they stay out at sea
      const lines = ocean ? s.n.toUpperCase().replace(/ OCEAN$/, '\nOCEAN').split('\n') : [s.n];
      ctx.font = `italic 600 ${fs.toFixed(1)}px ${SEA_FONT}`;
      const spacing = ocean ? fs * clamp(0.18 + zoomIn * 0.06, 0.2, 0.5) : fs * 0.1;
      const tw = Math.max(...lines.map((l) => this.spacedWidth(ctx, l, spacing)));
      const lh = fs * 1.05;
      const rect: [number, number, number, number] = [sx - tw / 2, sy - (lh * lines.length) / 2, sx + tw / 2, sy + (lh * lines.length) / 2];
      if (!free(rect)) continue;
      placed.push(rect);
      ctx.fillStyle = 'rgba(160,198,226,0.6)';
      lines.forEach((l, i) => this.spacedText(ctx, l, sx, sy + (i - (lines.length - 1) / 2) * lh, spacing, false));
    }

    // cities: national capitals early, big cities next, towns when zoomed in
    const capOf = new Map<number, number>();
    for (const c of state.countries) if (c.alive) capOf.set(c.capital, c.id);
    ctx.textAlign = 'left';
    for (let i = 0; i < FEAT.cities.length; i++) {
      const ct = FEAT.cities[i];
      if (ct.prov < 0) continue;
      const isCap = capOf.has(ct.prov) && this.capCity.get(ct.prov) === i;
      const need = isCap ? 2.1 : ct.r <= 1 ? 3 : ct.r <= 3 ? 5 : ct.r <= 5 ? 9 : 14;
      if (zoomIn < need) continue;
      const sx = (ct.x / 10) * k + x, sy = (ct.y / 10) * k + y;
      if (sx < -m - 40 || sy < -m - 10 || sx > W + 40 || sy > H + 10) continue;
      const fs = isCap ? 12 : ct.r <= 3 ? 11 : 10;
      ctx.font = `${isCap ? 700 : 600} ${fs}px ${UI_FONT}`;
      const tw = ctx.measureText(ct.n).width;
      const rect: [number, number, number, number] = [sx - 5, sy - fs / 2 - 1, sx + 8 + tw, sy + fs / 2 + 1];
      if (!free(rect)) continue;
      placed.push(rect);
      if (isCap) this.drawStar(ctx, sx, sy, 5, state.owner[ct.prov] === state.player ? '#ffd56a' : '#fff4d6');
      else {
        ctx.fillStyle = 'rgba(20,14,8,0.9)'; ctx.beginPath(); ctx.arc(sx, sy, 2.9, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#f4ead4'; ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, 6.283); ctx.fill();
      }
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,8,6,0.78)';
      ctx.strokeText(ct.n, sx + 7, sy);
      ctx.fillStyle = state.owner[ct.prov] === state.player ? '#ffe7a8' : 'rgba(250,244,230,0.94)';
      ctx.fillText(ct.n, sx + 7, sy);
    }
    // towns when zoomed far in
    if (zoomIn > 8) {
      ctx.font = `600 9.5px ${UI_FONT}`;
      for (const [nm, tx10, ty10, prov] of FEAT.towns) {
        const sx = (tx10 / 10) * k + x, sy = (ty10 / 10) * k + y;
        if (sx < -m - 30 || sy < -m - 10 || sx > W + 30 || sy > H + 10) continue;
        const tw = ctx.measureText(nm).width;
        const rect: [number, number, number, number] = [sx - 4, sy - 6, sx + 7 + tw, sy + 6];
        if (!free(rect)) continue;
        placed.push(rect);
        ctx.fillStyle = 'rgba(20,14,8,0.85)'; ctx.beginPath(); ctx.arc(sx, sy, 2.1, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(240,232,214,0.95)'; ctx.beginPath(); ctx.arc(sx, sy, 1.2, 0, 6.283); ctx.fill();
        ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(10,8,6,0.7)'; ctx.strokeText(nm, sx + 6, sy);
        ctx.fillStyle = state.owner[prov] === state.player ? 'rgba(255,231,168,0.9)' : 'rgba(236,228,210,0.85)';
        ctx.fillText(nm, sx + 6, sy);
      }
    }
    // capitals that moved (or have no city in the data) still get a star
    if (zoomIn > 2.1) {
      for (const c of state.countries) {
        if (!c.alive || this.capCity.has(c.capital)) continue;
        const gp = geo.provinces[c.capital];
        if (!gp) continue;
        const sx = gp.seed[0] * k + x, sy = gp.seed[1] * k + y;
        if (sx < -m || sx > W || sy < -m || sy > H) continue;
        this.drawStar(ctx, sx, sy, 4.5, c.id === state.player ? '#ffd56a' : '#fff4d6');
      }
    }
    ctx.textAlign = 'center';

    // buildings (only when zoomed in)
    if (zoomIn > 4) {
      ctx.font = `12px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
      const slot: Record<number, number> = {};
      for (const key of Object.keys(state.bld)) {
        const lv = state.bld[key];
        if (!lv) continue;
        const [ps, t] = key.split(':');
        const p = Number(ps);
        const gp = geo.provinces[p];
        const sx = gp.seed[0] * k + x, sy = gp.seed[1] * k + y;
        if (sx < -m || sx > W || sy < -m || sy > H) continue;
        const i = (slot[p] = (slot[p] ?? 0) + 1) - 1;
        ctx.fillStyle = state.owner[p] === state.player ? 'rgba(255,230,160,1)' : 'rgba(255,255,255,0.92)';
        ctx.fillText(`${BDEF[t as BType].icon}${lv > 1 ? lv : ''}`, sx - 14 + i * 17, sy + 14);
      }
    }
  }

  private spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
    return ctx.measureText(text).width + spacing * Math.max(0, text.length - 1);
  }
  private spacedText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, spacing: number, stroke: boolean) {
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((s, v) => s + v, 0) + spacing * (text.length - 1);
    let sx = cx - total / 2;
    const align = ctx.textAlign;
    ctx.textAlign = 'left';
    [...text].forEach((ch, i) => {
      if (stroke) ctx.strokeText(ch, sx, cy);
      ctx.fillText(ch, sx, cy);
      sx += widths[i] + spacing;
    });
    ctx.textAlign = align;
  }
  private drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 === 0 ? r : r * 0.45;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(14,10,6,0.9)'; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
  }
}
