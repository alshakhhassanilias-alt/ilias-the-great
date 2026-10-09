/**
 * Canvas renderer for the world map.
 *
 * Smoothness: the expensive static layer (ocean, province fills, terrain texture, occupation hatching,
 * province lines, national borders) is drawn into an off-screen "base" canvas with a margin. While the
 * player pans or zooms, that bitmap is simply re-composited with a transform (a few ms), then re-rendered
 * crisply once the view settles. Per-frame overlays (hover, selection, war fronts, armies, capture
 * effects, labels) are cheap and drawn on top every frame.
 */
import { MapGeometry } from './geometry';
import type { GameState } from '../sim/types';
import { getRelation, areAtWar, hasAlliance } from '../sim/relations';
import { strengthIndex } from '../sim/military';
import { clamp, fmtNum, shortName } from '../sim/util';
import { hash01 } from '../sim/rng';
import type { MapMode } from '../state/store';

export interface View { k: number; x: number; y: number }

const lerpC = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
function ramp(stops: number[][], t: number) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return rgb(lerpC(stops[i], stops[i + 1], t - i));
}
const WEALTH = [[24, 40, 84], [30, 96, 140], [40, 150, 150], [150, 190, 90], [236, 214, 96]];
const POWER = [[30, 40, 60], [86, 70, 110], [170, 70, 90], [232, 120, 60], [255, 200, 90]];
const STAB = [[170, 50, 50], [200, 130, 50], [190, 190, 80], [80, 160, 100], [50, 170, 140]];
const REL = [[180, 50, 50], [120, 70, 80], [70, 80, 100], [60, 130, 110], [60, 190, 130]];

interface Effect { prov: number; t0: number; color: string; kind: 'capture' | 'lost' }

function tile(size: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  return c;
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
  private lastView: View = { k: 0, x: 0, y: 0 };
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
  private borderPath = new Path2D();
  private innerPath = new Path2D();
  private noise: CanvasPattern | null = null;
  private stripe: CanvasPattern | null = null;
  private stripeCache = new Map<string, CanvasPattern>();
  private fronts: CanvasPattern | null = null;

  private octx: CanvasRenderingContext2D;
  private compositeDirty = true;
  private lastComposite: View = { k: 0, x: 0, y: 0 };
  private lastSel: [number | null, number | null, string] = [null, null, ''];

  /** `base` is the visible map canvas (moved with a CSS transform while the view changes); `overlay` sits on top. */
  constructor(base: HTMLCanvasElement, private overlay: HTMLCanvasElement, public geom: MapGeometry, private getState: () => GameState | null) {
    this.base = base;
    this.bctx = base.getContext('2d', { alpha: false })!;
    this.ctx = this.bctx;
    this.octx = overlay.getContext('2d')!;
    // terrain texture: sparse dark specks and short strokes
    const nt = tile(96, (c) => {
      for (let i = 0; i < 90; i++) {
        c.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.4})`;
        const x = Math.random() * 96, y = Math.random() * 96;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3 + Math.random() * 4, y - 3 - Math.random() * 3); c.lineTo(x + 6 + Math.random() * 3, y); c.closePath(); c.fill();
      }
    });
    this.noise = this.ctx.createPattern(nt, 'repeat');
    const ft = tile(10, (c) => {
      c.strokeStyle = 'rgba(255,90,80,0.8)'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(-2, 12); c.lineTo(12, -2); c.moveTo(-2, 7); c.lineTo(7, -2); c.moveTo(3, 12); c.lineTo(12, 3); c.stroke();
    });
    this.fronts = this.ctx.createPattern(ft, 'repeat');
  }

  // ------------------------------------------------------------------ view control
  resize(w: number, h: number, dpr: number) {
    const first = this.w === 0;
    this.w = w; this.h = h; this.dpr = dpr;
    this.margin = Math.round(Math.max(w, h) * 0.16);
    this.overlay.width = Math.round(w * dpr);
    this.overlay.height = Math.round(h * dpr);
    this.base.width = Math.round((w + 2 * this.margin) * dpr);
    this.base.height = Math.round((h + 2 * this.margin) * dpr);
    this.base.style.width = `${w + 2 * this.margin}px`;
    this.base.style.height = `${h + 2 * this.margin}px`;
    this.compositeDirty = true;
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
    if (animate) this.anim = { from: { ...this.view }, to, t0: performance.now(), ms: 650 };
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
      v.k += (this.targetK - v.k) * (1 - Math.exp(-dt * 13));
      v.x = ax - wx * v.k; v.y = ay - wy * v.k;
      this.constrain(); this.touchView();
    }
    if (this.inertia) {
      this.view.x += this.vel.x * dt * 1000; this.view.y += this.vel.y * dt * 1000;
      const d = Math.exp(-dt * 4.5);
      this.vel.x *= d; this.vel.y *= d;
      this.constrain(); this.touchView();
      if (Math.hypot(this.vel.x, this.vel.y) < 0.03) this.inertia = false;
    }
  }

  // ------------------------------------------------------------------ colours
  private colorFor(state: GameState, c: number): string {
    const C = state.countries[c];
    const P = state.player;
    switch (this.mode) {
      case 'diplomacy': return c === P ? 'hsl(45,85%,48%)' : ramp(REL, (getRelation(state, c, P) + 100) / 200);
      case 'wealth': return ramp(WEALTH, (Math.log10(Math.max(300, C.eco.gdp / Math.max(C.eco.pop, 1))) - 2.5) / 2.3);
      case 'power': return ramp(POWER, (Math.log10(Math.max(2, strengthIndex(C))) - 0.3) / 3.6);
      case 'stability': return ramp(STAB, C.eco.stability / 100);
      default:
        if (c === P && !this.plain) return 'hsl(172,58%,36%)';
        if (!this.plain && areAtWar(state, c, P)) return 'hsl(2,58%,38%)';
        if (!this.plain && hasAlliance(state, c, P)) return 'hsl(205,50%,42%)';
        return `hsl(${C.color},30%,${33 + (C.id % 3) * 2}%)`;
    }
  }
  private stripeFor(color: string): CanvasPattern {
    let p = this.stripeCache.get(color);
    if (!p) {
      const t = tile(12, (c) => {
        c.strokeStyle = color; c.lineWidth = 4;
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
        if (this.geomVisible(p)) this.effects.push({ prov: p, t0: now, color: this.colorFor(state, state.owner[p]), kind: state.owner[p] === state.player ? 'capture' : prev === state.player ? 'lost' : 'capture' });
      }
      if (state.owner[p] !== state.core[p]) {
        const b = Math.floor(state.integ[p] * 6);
        if (this.integSnap[p] !== b + 1) { this.integSnap[p] = b + 1; changed = true; }
      } else if (this.integSnap[p] !== 0) { this.integSnap[p] = 0; changed = true; }
    }
    if (changed) { this.baseHardDirty = true; this.ownersVersion++; }
    // colours (mode-dependent): soft dirty, throttled
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

    // --- decide whether the base layer needs re-rendering
    const v = this.view, bv = this.baseView;
    const f = v.k / bv.k;
    const ox = v.x - bv.x * f, oy = v.y - bv.y * f;
    const bw = (this.base.width / this.dpr) * f, bh = (this.base.height / this.dpr) * f;
    const covered = this.baseValid && ox <= 0 && oy <= 0 && ox + bw >= this.w && oy + bh >= this.h;
    const idle = t0 - this.lastViewChange > 130;
    const moved = Math.abs(f - 1) > 0.001 || Math.abs(ox + this.margin) > 0.5 || Math.abs(oy + this.margin) > 0.5;
    const farScale = f < 0.7 || f > 1.45;
    let render = false;
    if (!this.baseValid || this.baseHardDirty) render = true;
    else if (!covered || (farScale && t0 - this.lastBase > 90)) render = true;
    else if (idle && moved) render = true;
    else if (this.baseSoftDirty && t0 - this.lastBase > 450 && idle) render = true;
    if (render) { this.renderBase(state); this.compositeDirty = true; }

    // --- move the (visible) map canvas with a GPU-composited CSS transform
    {
      const f2 = v.k / this.baseView.k;
      const ox2 = v.x - this.baseView.x * f2, oy2 = v.y - this.baseView.y * f2;
      this.base.style.transform = `translate3d(${ox2.toFixed(2)}px, ${oy2.toFixed(2)}px, 0) scale(${f2.toFixed(5)})`;
    }
    this.lastComposite = { ...v };
    this.compositeDirty = false;

    // --- overlay (hover, selection, war fronts, effects): cheap, redrawn every frame
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);
    o.setTransform(this.dpr * v.k, 0, 0, this.dpr * v.k, this.dpr * v.x, this.dpr * v.y);
    const tc = performance.now();
    this.drawOverlays(o, state);
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawLabels(o, state);
    this.stats.overlayMs = performance.now() - tc;
    this.stats.frameMs = performance.now() - t0;
  }

  /** Whether another frame is needed even if nothing was touched (animations running). */
  animating(state: GameState | null) {
    return !!state && (state.wars.length > 0 || this.effects.length > 0 || !!this.anim || this.inertia || Math.abs(this.targetK - this.view.k) > this.view.k * 0.002);
  }

  // ------------------------------------------------------------------ base layer
  private renderBase(state: GameState) {
    const t0 = performance.now();
    const ctx = this.bctx;
    const { k, x, y } = this.view;
    const m = this.margin, dpr = this.dpr;
    this.baseView = { k, x: x + m, y: y + m };
    const geo = this.geom.geo;
    const nP = geo.provinces.length;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = this.base.width, H = this.base.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1c2e'); g.addColorStop(1, '#06111c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + m), dpr * (y + m));

    // visible world rectangle (including margin)
    const vx0 = -(x + m) / k, vy0 = -(y + m) / k, vx1 = (W / dpr - (x + m)) / k, vy1 = (H / dpr - (y + m)) / k;
    const vis = (p: number) => { const b = geo.provinces[p].bbox; return !(b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1); };

    // graticule
    ctx.strokeStyle = 'rgba(120,170,220,0.055)'; ctx.lineWidth = 1 / k;
    const [bx0, by0, bx1, by1] = this.geom.bounds;
    ctx.beginPath();
    for (let gx = Math.ceil(bx0 / 50) * 50; gx < bx1; gx += 50) { ctx.moveTo(gx, by0 - 20); ctx.lineTo(gx, by1 + 20); }
    for (let gy = Math.ceil(by0 / 50) * 50; gy < by1; gy += 50) { ctx.moveTo(bx0 - 20, gy); ctx.lineTo(bx1 + 20, gy); }
    ctx.stroke();

    // combined edge paths (rebuilt only when ownership changes)
    if (this.pathsVersion !== this.ownersVersion) {
      this.pathsVersion = this.ownersVersion;
      const coastP = new Path2D(), borderP = new Path2D(), innerP = new Path2D();
      const own = state.owner;
      for (let p = 0; p < nP; p++) {
        for (const e of this.geom.edgePaths[p]) {
          if (e.n < 0) { coastP.addPath(e.path); borderP.addPath(e.path); }
          else if (own[e.n] === own[p]) innerP.addPath(e.path);
          else borderP.addPath(e.path);
        }
      }
      this.coastPath = coastP; this.borderPath = borderP; this.innerPath = innerP;
    }
    // shallow-water glow around all coastlines
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(75,160,220,0.14)'; ctx.lineWidth = 7 / k; ctx.stroke(this.coastPath);

    // province fills (+ subtle per-province shade so subdivisions read)
    const colors = this.colorSnap;
    for (let p = 0; p < nP; p++) {
      if (!vis(p)) continue;
      const o = state.owner[p];
      ctx.fillStyle = colors[o] || '#333';
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    // light/dark shading per province
    for (let p = 0; p < nP; p++) {
      if (!vis(p)) continue;
      const h = hash01('shade', p);
      ctx.fillStyle = h > 0.5 ? `rgba(255,255,255,${(h - 0.5) * 0.10})` : `rgba(0,0,0,${(0.5 - h) * 0.16})`;
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    // terrain texture (rugged provinces look hillier)
    if (this.noise) {
      this.noise.setTransform(new DOMMatrix().scale(1 / k * 0.9));
      ctx.fillStyle = this.noise;
      for (let p = 0; p < nP; p++) {
        if (!vis(p)) continue;
        const t = geo.provinces[p].terrain;
        if (t < 0.3) continue;
        ctx.globalAlpha = 0.10 + 0.5 * (t - 0.3);
        ctx.fill(this.geom.provPaths[p], 'evenodd');
      }
      ctx.globalAlpha = 1;
    }
    // occupied provinces: hatched with the original owner's colour until integrated
    for (let p = 0; p < nP; p++) {
      if (state.owner[p] === state.core[p] || !vis(p)) continue;
      const core = state.core[p];
      if (!state.countries[core].alive) continue;
      const pat = this.stripeFor(this.plain ? colors[core] : (core === state.player ? 'rgba(40,200,170,0.9)' : colors[core]));
      pat.setTransform(new DOMMatrix().scale(1 / k));
      ctx.globalAlpha = 0.18 + 0.55 * (1 - state.integ[p]);
      ctx.fillStyle = pat;
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    ctx.globalAlpha = 1;

    // internal province boundaries, then coasts and national borders
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6,14,24,0.34)'; ctx.lineWidth = 0.9 / k; ctx.stroke(this.innerPath);
    ctx.lineJoin = 'bevel';
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 4 / k; ctx.stroke(this.borderPath);
    ctx.strokeStyle = 'rgba(2,8,16,0.95)'; ctx.lineWidth = 1.7 / k; ctx.stroke(this.borderPath);
    ctx.strokeStyle = 'rgba(225,235,245,0.40)'; ctx.lineWidth = 0.6 / k; ctx.stroke(this.borderPath);
    this.baseValid = true;
    this.baseHardDirty = false;
    this.baseSoftDirty = false;
    this.lastBase = performance.now();
    this.stats.baseMs = this.lastBase - t0;
    this.stats.baseRenders++;
  }

  // ------------------------------------------------------------------ overlays
  private drawOverlays(ctx: CanvasRenderingContext2D, state: GameState) {
    const { k } = this.view;
    const now = performance.now();
    const geo = this.geom.geo;
    const P = state.player;
    const owner = state.owner;
    const fill = (c: number, style: string) => {
      ctx.fillStyle = style;
      for (const p of state.countries[c].provinces) ctx.fill(this.geom.provPaths[p], 'evenodd');
    };
    const stroke = (c: number, style: string, wpx: number) => {
      ctx.strokeStyle = style; ctx.lineWidth = wpx / k; ctx.lineJoin = 'round';
      const seen = new Set<number>();
      for (const p of state.countries[c].provinces) {
        for (const e of this.geom.edgePaths[p]) if (e.n < 0 || owner[e.n] !== c) ctx.stroke(e.path);
        for (const q of geo.adj[p]) {
          if (owner[q] === c || seen.has(q)) continue;
          seen.add(q);
          for (const e of this.geom.edgePaths[q]) if (e.n === p) ctx.stroke(e.path); // border runs stored on the neighbour's side
        }
      }
    };

    // player + hover + selection
    if (!this.plain || this.selected === P) stroke(P, 'rgba(255,205,90,0.95)', 1.9);
    if (this.hoverOwner >= 0 && this.hoverOwner !== this.selected) { fill(this.hoverOwner, 'rgba(255,255,255,0.10)'); stroke(this.hoverOwner, 'rgba(255,255,255,0.75)', 1.4); }
    if (this.selected !== null) {
      fill(this.selected, 'rgba(120,210,255,0.10)');
      if (this.selected !== P) {
        ctx.save(); ctx.shadowColor = 'rgba(120,220,255,0.95)'; ctx.shadowBlur = 10;
        stroke(this.selected, 'rgba(150,230,255,1)', 2.2);
        ctx.restore();
      }
    }
    if (this.selectedProv !== null) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 260);
      ctx.strokeStyle = `rgba(255,255,255,${pulse})`; ctx.lineWidth = 1.8 / k; ctx.stroke(this.geom.provPaths[this.selectedProv]);
    }

    // capture / loss effects
    this.effects = this.effects.filter((e) => now - e.t0 < 1800);
    for (const e of this.effects) {
      const t = (now - e.t0) / 1800;
      const gp = geo.provinces[e.prov];
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.fillStyle = e.kind === 'lost' ? '#ff5a4a' : '#ffffff';
      ctx.fill(this.geom.provPaths[e.prov], 'evenodd');
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = e.kind === 'lost' ? '#ff8a7a' : '#ffe9a8';
      ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(gp.seed[0], gp.seed[1], (3 + t * 22), 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // war fronts: contested provinces, arrows, army stacks, progress bars
    if (state.wars.length) {
      ctx.lineCap = 'round';
      const t = now / 1000;
      for (const w of state.wars) {
        for (const fr of w.fronts) {
          const target = geo.provinces[fr.prov];
          if (!this.geomVisible(fr.prov)) continue;
          ctx.save();
          ctx.globalAlpha = 0.22 + 0.5 * Math.min(1, fr.progress);
          ctx.fillStyle = this.fronts ?? 'rgba(255,80,60,.5)';
          if (this.fronts) this.fronts.setTransform(new DOMMatrix().translate(0, 0).scale(1 / k));
          ctx.fill(this.geom.provPaths[fr.prov], 'evenodd');
          ctx.restore();
          const side = w.attackers.includes(fr.by) ? w.attackers : w.defenders;
          let src: number | null = null;
          for (const q of geo.adj[fr.prov]) if (state.owner[q] === fr.by) { src = q; break; }
          if (src === null) for (const q of geo.adj[fr.prov]) if (side.includes(state.owner[q])) { src = q; break; }
          if (src === null && fr.amphibious) {
            let bd = 1e9;
            for (const q of state.countries[fr.by].provinces) { const d = geo.dist(q, fr.prov); if (d < bd && geo.provinces[q].coast > 0.15) { bd = d; src = q; } }
          }
          if (src === null) continue;
          const [x0, y0] = geo.provinces[src].seed, [x1, y1] = target.seed;
          const mine = fr.by === P;
          const col = mine ? '255,215,90' : '255,90,70';
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - (fr.amphibious ? Math.hypot(x1 - x0, y1 - y0) * 0.16 : 0);
          // arrow body
          ctx.strokeStyle = `rgba(${col},0.95)`;
          ctx.lineWidth = 2.2 / k;
          ctx.setLineDash([5 / k, 3.5 / k]); ctx.lineDashOffset = -t * 14 / k;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
          ctx.setLineDash([]);
          const ang = Math.atan2(y1 - my, x1 - mx), ah = 6 / k;
          ctx.fillStyle = `rgba(${col},0.95)`;
          ctx.beginPath(); ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - ah * Math.cos(ang - 0.45), y1 - ah * Math.sin(ang - 0.45));
          ctx.lineTo(x1 - ah * Math.cos(ang + 0.45), y1 - ah * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
          // battle pulse at the target
          const pr = ((t * 1.3) % 1);
          ctx.strokeStyle = `rgba(255,120,80,${0.8 * (1 - pr)})`; ctx.lineWidth = 1.6 / k;
          ctx.beginPath(); ctx.arc(x1, y1, (2 + pr * 9) / k * Math.min(k, 6) / Math.min(k, 6) * 1, 0, 6.283); ctx.stroke();
          // army stacks + progress bar (only when zoomed in enough to be legible)
          if (k > this.fitK * 1.8) {
            const s = Math.min(1, 9 / k) * 1; // icon size in world units shrinks with zoom, stays ~9px on screen
            this.drawStack(ctx, x0, y0, s, fr.atk, mine ? '#f2b84b' : '#ff6252', k);
            this.drawStack(ctx, x1, y1, s, fr.def, '#5eaaff', k);
            const bw = 22 / k, bh = 3.2 / k;
            ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x1 - bw / 2, y1 - 14 / k, bw, bh);
            ctx.fillStyle = mine ? '#f2b84b' : '#ff6252'; ctx.fillRect(x1 - bw / 2, y1 - 14 / k, bw * Math.min(1, fr.progress), bh);
          }
        }
      }
    }
  }

  private drawStack(ctx: CanvasRenderingContext2D, x: number, y: number, _s: number, troops: number | undefined, color: string, k: number) {
    const r = 5 / k;
    ctx.fillStyle = 'rgba(5,12,22,0.85)';
    ctx.beginPath(); ctx.arc(x, y, r + 1 / k, 0, 6.283); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x - r * 0.7, y - r * 0.6); ctx.lineTo(x + r * 0.7, y - r * 0.6); ctx.lineTo(x + r * 0.7, y + r * 0.1); ctx.lineTo(x, y + r * 0.85); ctx.lineTo(x - r * 0.7, y + r * 0.1); ctx.closePath(); ctx.fill();
    if (troops && k > this.fitK * 3) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const sx = x * this.view.k + this.view.x, sy = y * this.view.k + this.view.y;
      ctx.font = '700 10px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,12,22,0.9)'; ctx.strokeText(fmtNum(troops, 0), sx, sy + 8);
      ctx.fillStyle = '#fff'; ctx.fillText(fmtNum(troops, 0), sx, sy + 8);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ labels
  private drawLabels(ctx: CanvasRenderingContext2D, state: GameState) {
    const { k, x, y } = this.view;
    const geo = this.geom.geo;
    const placed: [number, number, number, number][] = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const list: { c: number; o: { anchor: [number, number]; w: number; h: number; area: number } }[] = [];
    for (const c of state.countries) {
      if (!c.alive) continue;
      const o = this.geom.labelInfo(state, c.id);
      if (o) list.push({ c: c.id, o });
    }
    list.sort((a, b) => b.o.area - a.o.area);
    for (const { c, o } of list) {
      const C = state.countries[c];
      const name = shortName(C.name);
      const wpx = o.w * k, hpx = o.h * k;
      let fs = Math.min(wpx / (name.length * 0.58), hpx * 0.5, 26);
      if (c === this.selected || c === state.player) fs = Math.max(fs, Math.min(13, wpx / (name.length * 0.5)));
      if (fs < 6.5) continue;
      const sx = o.anchor[0] * k + x, sy = o.anchor[1] * k + y;
      if (sx < -60 || sy < -20 || sx > this.w + 60 || sy > this.h + 20) continue;
      const tw = name.length * fs * 0.58;
      const rect: [number, number, number, number] = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
      if (placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
      placed.push(rect);
      ctx.font = `${c === state.player ? 700 : 600} ${fs.toFixed(1)}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 5);
      ctx.strokeStyle = 'rgba(5,12,22,0.8)';
      ctx.strokeText(name, sx, sy);
      ctx.fillStyle = c === state.player ? '#ffe39a' : 'rgba(240,246,252,0.92)';
      ctx.fillText(name, sx, sy);
    }
    // province names when zoomed far in (collision-aware, never over country names)
    if (k > this.fitK * 7) {
      ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
      for (const gp of geo.provinces) {
        const sx = gp.seed[0] * k + x, sy = gp.seed[1] * k + y + 11;
        if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
        if (gp.area * k * k < 5200) continue;
        const cn = state.countries[gp.country0].name;
        const label = gp.name.replace(`${cn} `, '').replace(` ${cn}`, '') || gp.name;
        const tw = label.length * 5.6;
        const rect: [number, number, number, number] = [sx - tw / 2, sy - 6, sx + tw / 2, sy + 6];
        if (placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
        placed.push(rect);
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(5,12,22,0.7)';
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle = state.owner[gp.id] === state.player ? 'rgba(255,230,160,0.9)' : 'rgba(225,235,245,0.62)';
        ctx.fillText(label, sx, sy);
      }
    }
    // capitals
    if (k > this.fitK * 3.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const c of state.countries) {
        if (!c.alive) continue;
        const gp = geo.provinces[c.capital];
        if (!gp) continue;
        const sx = gp.seed[0] * k + x, sy = gp.seed[1] * k + y;
        if (sx < 0 || sx > this.w || sy < 0 || sy > this.h) continue;
        ctx.beginPath(); ctx.arc(sx, sy, 2.6, 0, 6.283); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
}
