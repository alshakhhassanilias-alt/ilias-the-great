import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import { MapGeometry } from './geometry';
import { MapRenderer } from './renderer';
import { areAtWar, getRelation } from '../sim/relations';
import { shortName } from '../sim/util';
import { toggleFocus } from '../sim/actions';
import { actArmyTarget } from '../sim/armies';
import { sfx } from '../audio';

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
  const labelRef = useRef<HTMLCanvasElement>(null);
  const battleRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendRef = useRef<MapRenderer | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const lastFocus = useRef(focusOnMount ? -1 : store.focusRequest);

  // create renderer + animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const r = new MapRenderer(canvas, overlayRef.current!, getGeom(), () => store.state, labelRef.current, battleRef.current);
    rendRef.current = r;
    (window as unknown as { __renderer?: MapRenderer }).__renderer = r;
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    const pickQuality = (): 0 | 1 | 2 => store.graphics === 'high' ? 2 : store.graphics === 'medium' ? 1 : store.graphics === 'low' ? 0 : (coarse ? 1 : 2);
    let quality = pickQuality();
    let graphics = store.graphics;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      // backing resolution: up to 2x on desktops, 1.5x on phones, 1x in low quality (far cheaper to paint)
      const cap = quality === 0 ? 1 : coarse || quality === 1 ? 1.5 : 2;
      r.quality = quality; store.quality = quality;
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, cap));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    let raf = 0;
    let lastDraw = 0;
    // automatic graphics: if frames keep coming in slow while the clock runs, step the effects down (never back up on its own)
    let lastT = 0, samples = 0, slow = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (graphics !== store.graphics) { graphics = store.graphics; quality = pickQuality(); resize(); }
      const dt = t - lastT; lastT = t;
      if (store.graphics === 'auto' && store.speed > 0 && !store.preview && dt < 1000) {
        samples++; if (dt > 42) slow++;
        if (samples >= 150) {
          if (slow / samples > 0.4 && quality > 0) { quality = (quality - 1) as 0 | 1; resize(); store.toast(quality === 1 ? 'Graphics lowered a notch for smoother play (Settings → Graphics).' : 'Graphics set to Fast to keep the game smooth (Settings → Graphics).', 'info'); }
          samples = 0; slow = 0;
        }
      }
      // distant artillery when you are zoomed in on a running battle
      if (r.battleVisible && store.sound && store.speed > 0 && r.view.k > r.fitK * 2.2 && Math.random() < 0.012) sfx('boom');
      r.step(t);
      if (r.dirty) { r.dirty = false; lastDraw = t; r.draw(); }
      // ambient animation: every frame in Beautiful (about 30 fps while the clock runs, so the simulation gets its share), ~18 fps otherwise
      else if (r.animating(store.state) && t - lastDraw > (quality === 2 ? (store.speed > 0 ? 30 : 12) : 55)) { lastDraw = t; r.draw(); }
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
    r.running = store.speed > 0 && !store.preview;
    r.selectedArmy = store.selectedArmy;
    r.dirty = true;
  }
  const lastPing = useRef(store.pingSeq);
  useEffect(() => {
    const rr = rendRef.current;
    if (rr && lastPing.current !== store.pingSeq) { lastPing.current = store.pingSeq; if (store.pingProv >= 0) rr.ping(store.pingProv, store.pingColor); }
    if (rr && store.callouts.length) { for (const c of store.callouts) rr.callout(c.prov, c.text, c.color); store.callouts = []; }
  });
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
    let dragArmy: number | null = null;
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
      // grabbing one of your armies: drag it onto a region to give it an objective
      dragArmy = !onPick && pts.size === 1 && e.button === 0 ? rendRef.current!.hitArmy(p.x, p.y) : null;
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
      if (pts.size === 1 && dragArmy !== null) {
        moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        rr.dragArmy = moved > 6 ? { id: dragArmy, x: p.x, y: p.y, prov: pick(p.x, p.y) } : null;
        rr.dirty = true;
        setTip(null);
      } else if (pts.size === 1) {
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
      if (dragArmy !== null && had) {
        const id = dragArmy; dragArmy = null;
        const rr = rendRef.current!;
        rr.dragArmy = null; rr.dirty = true;
        if (moved < 8) { store.selectArmy(store.selectedArmy === id ? null : id); return; }
        const pr = pick(p.x, p.y);
        if (pr !== null) aimArmy(id, pr);
        return;
      }
      if (had && pts.size === 0 && moved < 8 && performance.now() - start.t < 600) click(p.x, p.y);
      else if (had && pts.size === 0) rendRef.current?.releasePan();
    };
    const hover = (x: number, y: number) => {
      const rr = rendRef.current!;
      const st = store.state;
      const ah = rr.hitArmy(x, y);
      if (ah !== null && st?.armies) { const a = st.armies.find((q) => q.id === ah); if (a) { setTip({ x, y, text: a.name, sub: 'Click to select · drag onto a region to send it there' }); return; } }
      const bh = rr.hitBattle(x, y);
      if (bh && st) { rr.hoverOwner = -1; rr.dirty = true; setTip({ x, y, text: `Battle of ${store.geo.provinces[bh.prov].name}`, sub: 'Click for the battle report' }); return; }
      const pr = pick(x, y);
      if (pr === null || !st) { rr.hoverOwner = -1; setTip(null); rr.dirty = true; return; }
      const o = st.owner[pr];
      rr.hoverOwner = o;
      rr.dirty = true;
      const C = st.countries[o];
      const region = store.geo.provinces[pr].name;
      const fr = st.wars.flatMap((w) => w.fronts).filter((f) => f.prov === pr).sort((a, b) => b.progress - a.progress)[0];
      const war = areAtWar(st, o, st.player);
      const parts = [region];
      if (fr) parts.push(`⚔ ${Math.round(Math.min(1, fr.progress) * 100)}% taken by ${shortName(st.countries[fr.by].name)}`);
      else if (st.core[pr] !== o) parts.push(`occupied ${shortName(st.countries[st.core[pr]].name)} land`);
      parts.push(o === st.player ? 'your country' : war ? 'at war with you' : `relations ${Math.round(getRelation(st, o, st.player))}`);
      setTip({ x, y, text: shortName(C.name), sub: parts.join(' · ') });
    };
    const aimArmy = (id: number, pr: number) => {
      const r2 = store.act((g) => actArmyTarget(g, store.geo, id, pr));
      if (r2.ok) { const a = store.state?.armies?.find((x) => x.id === id); store.mapCallout(pr, `${a?.name.toUpperCase() ?? 'ARMY'} ${store.state?.owner[pr] === store.state?.player ? '🛡 HOLD' : '➤'}`, '#ffcf5a'); }
      store.selectedArmy = id; store.armyAim = false; store.notify();
    };
    const context = (e: MouseEvent) => {
      // right-click with an army selected: send it there
      if (store.selectedArmy === null || onPick) return;
      e.preventDefault();
      const p = rel(e as unknown as PointerEvent);
      const pr = pick(p.x, p.y);
      if (pr !== null) aimArmy(store.selectedArmy, pr);
    };
    const click = (x: number, y: number) => {
      if (store.selectedArmy !== null && store.armyAim && !onPick) { const pr = pick(x, y); if (pr !== null) aimArmy(store.selectedArmy, pr); return; }
      // battle markers take priority: open the battle report
      const bh = !onPick ? rendRef.current?.hitBattle(x, y) : null;
      if (bh) { store.openBattle({ war: bh.war, prov: bh.prov, by: bh.by }); return; }
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
    // keyboard zoom (+ / −), dispatched by the app's key handler
    const keyZoom = (e: Event) => { const r = rendRef.current; if (r) r.zoomAt(r.w / 2, r.h / 2, (e as CustomEvent<number>).detail); };
    window.addEventListener('wo-zoom', keyZoom);
    canvas.addEventListener('contextmenu', context);
    return () => {
      canvas.removeEventListener('contextmenu', context);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('wo-zoom', keyZoom);
    };
  }, [onPick]);

  void s;
  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" aria-label="World map" />
      <canvas ref={labelRef} className="map-canvas map-labels" aria-hidden="true" />
      <canvas ref={battleRef} className="map-canvas map-labels" aria-hidden="true" />
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
