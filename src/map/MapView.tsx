import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import { MapGeometry } from './geometry';
import { MapRenderer } from './renderer';
import { getRelation } from '../sim/relations';
import { shortName } from '../sim/util';
import { toggleFocus } from '../sim/actions';

let geomSingleton: MapGeometry | null = null;
const getGeom = () => (geomSingleton ??= new MapGeometry(store.geo));

interface Props {
  /** interaction mode: "play" selects countries/provinces in a running game, "pick" is used on the start screen */
  onPick?: (country: number, province: number) => void;
  insetBottom?: () => number;
  insetRight?: () => number;
  /** focus the selected country when first shown (game) vs show the whole world (start screen) */
  focusOnMount?: boolean;
}

export function MapView({ onPick, insetBottom, insetRight, focusOnMount = true }: Props) {
  useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<MapRenderer | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const lastFocus = useRef(focusOnMount ? -1 : store.focusRequest);

  // create renderer + animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const r = new MapRenderer(canvas, overlayRef.current!, getGeom(), () => store.state);
    rendRef.current = r;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    let raf = 0;
    let lastDraw = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      r.step(t);
      if (r.dirty) { r.dirty = false; lastDraw = t; r.draw(); }
      else if (r.animating(store.state) && t - lastDraw > 30) { lastDraw = t; r.draw(); } // ambient animation at ~30 fps
    };
    raf = requestAnimationFrame(loop);
    (window as unknown as { __map?: MapRenderer }).__map = r;
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // sync renderer with store (runs every store notification)
  const s = store.state;
  const r = rendRef.current;
  if (r) {
    r.mode = store.mapMode;
    r.plain = store.preview;
    r.selected = store.selected;
    r.selectedProv = store.selectedProv;
    r.dirty = true;
  }
  useEffect(() => {
    const rr = rendRef.current;
    if (!rr || !store.state || store.selected === null) return;
    if (lastFocus.current === store.focusRequest) return;
    lastFocus.current = store.focusRequest;
    rr.focusBox(getGeom().focusBox(store.state, store.selected), insetBottom?.() ?? 0, insetRight?.() ?? 0);
  });

  // pointer interaction
  useEffect(() => {
    const canvas = wrapRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0, t: 0 };
    let moved = 0;
    let pinch = 0;
    let lastMove = 0;
    const rel = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const pick = (x: number, y: number) => {
      const rr = rendRef.current!;
      const [wx, wy] = rr.screenToWorld(x, y);
      return getGeom().pick(wx, wy, 7 / rr.view.k);
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.map-zoom')) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) { start = { ...p, t: performance.now() }; moved = 0; lastMove = e.timeStamp; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      const rr = rendRef.current!;
      const p = rel(e);
      const prev = pts.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') hover(p.x, p.y);
        return;
      }
      if (pts.size === 1) {
        rr.panBy(p.x - prev.x, p.y - prev.y, e.timeStamp - lastMove); lastMove = e.timeStamp;
        moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        setTip(null);
      } else if (pts.size === 2) {
        pts.set(e.pointerId, p);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) rr.zoomNow((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
        moved += 20;
      }
      pts.set(e.pointerId, p);
    };
    const up = (e: PointerEvent) => {
      const p = rel(e);
      const had = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      pinch = 0;
      if (had && pts.size === 0 && moved < 8 && performance.now() - start.t < 600) click(p.x, p.y);
      else if (had && pts.size === 0) rendRef.current?.releasePan();
    };
    const hover = (x: number, y: number) => {
      const rr = rendRef.current!;
      const st = store.state;
      const pr = pick(x, y);
      if (pr === null || !st) { rr.hoverOwner = -1; setTip(null); rr.dirty = true; return; }
      const o = st.owner[pr];
      rr.hoverOwner = o;
      rr.dirty = true;
      const C = st.countries[o];
      const sub = o === st.player ? 'Your country' : `Relations ${Math.round(getRelation(st, o, st.player))}`;
      setTip({ x, y, text: shortName(C.name), sub });
    };
    const click = (x: number, y: number) => {
      const pr = pick(x, y);
      const st = store.state;
      if (pr === null || !st) { if (!onPick) store.select(null); return; }
      const o = st.owner[pr];
      if (onPick) { onPick(o, pr); return; }
      // manual offensive targeting: clicking an enemy province toggles it as a target
      const me = st.countries[st.player];
      if (o !== st.player && store.atWarWithPlayer(o) && !me.mil.autoAdvance && store.selected === o) {
        store.act((g) => toggleFocus(g, g.player, pr), true);
        return;
      }
      store.select(o, pr);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = rel(e as unknown as PointerEvent);
      rendRef.current!.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    const leave = () => { const rr = rendRef.current!; rr.hoverOwner = -1; rr.dirty = true; setTip(null); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [onPick]);

  void s;
  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" aria-label="World map" />
      <canvas ref={overlayRef} className="map-overlay" aria-hidden="true" />
      {tip && (
        <div className="map-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.text}</b>
          <span>{tip.sub}</span>
        </div>
      )}
      <div className="map-zoom">
        <button aria-label="Zoom in" onClick={() => rendRef.current?.zoomAt((rendRef.current?.w ?? 0) / 2, (rendRef.current?.h ?? 0) / 2, 1.6)}>+</button>
        <button aria-label="Zoom out" onClick={() => rendRef.current?.zoomAt((rendRef.current?.w ?? 0) / 2, (rendRef.current?.h ?? 0) / 2, 1 / 1.6)}>−</button>
        <button aria-label="Reset view" onClick={() => { const rr = rendRef.current; if (rr) rr.focusBox([...getGeom().bounds] as [number, number, number, number], 0, 0); }}>⌂</button>
      </div>
    </div>
  );
}
