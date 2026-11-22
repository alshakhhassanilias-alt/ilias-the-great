import { useEffect, useMemo, useRef, useState } from 'react'
import { geoContains, geoGraticule10, geoNaturalEarth1, geoOrthographic, geoPath, geoBounds } from 'd3-geo'
import { useGame, type MapMode } from '../store'
import { borderMesh, loadNames, loadTopology, provinceName, type ProvFeature } from '../lib/geo'
import { hatchColor, makeContext, provinceColor } from '../lib/mapcolors'
import { money, pop } from '../lib/format'
import PlanetMap from './PlanetMap'

const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Political' }, { id: 'diplomatic', label: 'Diplomatic' }, { id: 'war', label: 'Wars & Fronts' },
  { id: 'economy', label: 'Economy' }, { id: 'unrest', label: 'Unrest' }, { id: 'integration', label: 'Integration' },
  { id: 'ideology', label: 'Ideology' }, { id: 'population', label: 'Population' },
]

interface Hover { pid: string; x: number; y: number }

export default function WorldMap({ provincesOverride, countriesOverride, compact }: { provincesOverride?: any; countriesOverride?: any; compact?: boolean }) {
  const g = useGame()
  const { view, mapMode, setMapMode, selected, setSelected, setSelProvince } = g
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [topo, setTopo] = useState<{ topo: any; features: ProvFeature[] } | null>(null)
  const [globe, setGlobe] = useState(false)
  const [planet, setPlanet] = useState('earth')
  const [hover, setHover] = useState<Hover | null>(null)
  const tr = useRef({ k: 1, x: 0, y: 0 })
  const rot = useRef<[number, number]>([-10, -25])
  const gscale = useRef(1)
  const drag = useRef<{ x: number; y: number; moved: boolean; tx: number; ty: number; r: [number, number] } | null>(null)
  const raf = useRef(0)

  useEffect(() => { Promise.all([loadTopology(), loadNames()]).then(([t]) => setTopo(t)) }, [])
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const provinces = provincesOverride || view?.provinces || {}
  const fakeView = useMemo(() => {
    if (!view) return null
    if (!provincesOverride) return view
    return { ...view, provinces: provincesOverride, countries: { ...view.countries, ...(countriesOverride || {}) } }
  }, [view, provincesOverride, countriesOverride])
  const ctxColors = useMemo(() => (fakeView ? makeContext(fakeView as any) : null), [fakeView])

  const proj = useMemo(() => geoNaturalEarth1().fitExtent([[8, 8], [size.w - 8, size.h - 8]], { type: 'Sphere' } as any), [size])
  const pre = useMemo(() => {
    if (!topo) return null
    const path = geoPath(proj)
    const paths = topo.features.map(f => new Path2D(path(f as any) || ''))
    const bounds = topo.features.map(f => path.bounds(f as any))
    const areas = topo.features.map(f => path.area(f as any))
    const cents = topo.features.map(f => path.centroid(f as any))
    const gbounds = topo.features.map(f => geoBounds(f as any))
    const sphere = new Path2D(path({ type: 'Sphere' } as any) || '')
    const grat = new Path2D(path(geoGraticule10()) || '')
    return { paths, bounds, areas, cents, sphere, grat, gbounds }
  }, [topo, proj])

  const ownerOf = (id: string) => provinces[id]?.[0] ?? null
  const ownersKey = useMemo(() => Object.keys(provinces).map(k => provinces[k][0]).join(','), [provinces])
  const borders = useMemo(() => {
    if (!topo || !pre) return null
    const m = borderMesh(topo.topo, ownerOf)
    return { geo: m, path2d: new Path2D(geoPath(proj)(m) || '') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topo, pre, ownersKey, proj])

  const labels = useMemo(() => {
    if (!topo || !pre || !fakeView) return []
    const groups: Record<string, Record<string, { a: number; x: number; y: number }>> = {}
    topo.features.forEach((f, i) => {
      const pv = provinces[f.id]
      if (!pv || !pv[0] || pv[6] !== 'earth') return
      const code = f.id.slice(0, 3)
      const a = pre.areas[i]
      const g2 = ((groups[pv[0]] ||= {})[code] ||= { a: 0, x: 0, y: 0 })
      g2.a += a; g2.x += pre.cents[i][0] * a; g2.y += pre.cents[i][1] * a
    })
    const out: { tag: string; name: string; x: number; y: number; area: number }[] = []
    for (const [tag, codes] of Object.entries(groups)) {
      const c = (fakeView.countries as any)[tag]
      const capCode = c?.capital ? String(c.capital).slice(0, 3) : null
      const best = (capCode && codes[capCode]) || Object.values(codes).sort((a, b) => b.a - a.a)[0]
      const total = best.a
      if (!c || best.a <= 0) continue
      out.push({ tag, name: c.name, x: best.x / best.a, y: best.y / best.a, area: Math.max(best.a, total * 0.4) })
    }
    return out.sort((a, b) => b.area - a.area)
  }, [topo, pre, fakeView, provinces, ownersKey])

  const patterns = useRef<Record<string, CanvasPattern>>({})
  function hatch(ctx: CanvasRenderingContext2D, color: string) {
    if (patterns.current[color]) return patterns.current[color]
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const x = c.getContext('2d')!
    x.strokeStyle = color
    x.lineWidth = 2.5
    x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.stroke()
    x.beginPath(); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke()
    x.beginPath(); x.moveTo(-2, 2); x.lineTo(2, -2); x.stroke()
    const p = ctx.createPattern(c, 'repeat')!
    patterns.current[color] = p
    return p
  }

  function draw() {
    const cv = canvasRef.current
    if (!cv || !pre || !topo || !ctxColors) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== size.w * dpr || cv.height !== size.h * dpr) { cv.width = size.w * dpr; cv.height = size.h * dpr }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    const css = getComputedStyle(document.body)
    const sea = css.getPropertyValue('--sea').trim() || '#0b1a2b'
    const sea2 = css.getPropertyValue('--sea2').trim() || '#10263d'
    const accent = css.getPropertyValue('--accent').trim() || '#d4a63f'
    const sel = selected
    if (globe) {
      const r = Math.min(size.w, size.h) / 2.15 * gscale.current
      const p = geoOrthographic().scale(r).translate([size.w / 2, size.h / 2]).rotate([rot.current[0], rot.current[1], 0]).clipAngle(90)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const path = geoPath(p, ctx)
      const grd = ctx.createRadialGradient(size.w / 2 - r * 0.3, size.h / 2 - r * 0.3, r * 0.1, size.w / 2, size.h / 2, r)
      grd.addColorStop(0, sea2); grd.addColorStop(1, sea)
      ctx.beginPath(); path({ type: 'Sphere' } as any); ctx.fillStyle = grd; ctx.fill()
      ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 0.5; ctx.stroke()
      topo.features.forEach(f => {
        const pv = provinces[f.id]
        ctx.beginPath(); path(f as any)
        ctx.fillStyle = provinceColor(mapMode, pv, ctxColors); ctx.fill()
        if (pv && pv[1] && pv[1] !== pv[0]) { ctx.fillStyle = hatch(ctx, hatchColor(pv[1], ctxColors)); ctx.fill() }
      })
      if (borders) { ctx.beginPath(); path(borders.geo as any); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.8; ctx.stroke() }
      if (sel) {
        ctx.beginPath()
        topo.features.forEach(f => { if (provinces[f.id]?.[0] === sel) path(f as any) })
        ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.stroke()
      }
      ctx.beginPath(); path({ type: 'Sphere' } as any); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.stroke()
      return
    }
    const { k, x, y } = tr.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, size.w, size.h)
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y)
    const grd = ctx.createLinearGradient(0, 0, 0, size.h)
    grd.addColorStop(0, sea2); grd.addColorStop(1, sea)
    ctx.fillStyle = grd; ctx.fill(pre.sphere)
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 0.6 / k; ctx.stroke(pre.grat)
    const vx0 = -x / k, vy0 = -y / k, vx1 = (size.w - x) / k, vy1 = (size.h - y) / k
    topo.features.forEach((f, i) => {
      const b = pre.bounds[i]
      if (b[1][0] < vx0 || b[0][0] > vx1 || b[1][1] < vy0 || b[0][1] > vy1) return
      const pv = provinces[f.id]
      ctx.fillStyle = provinceColor(mapMode, pv, ctxColors)
      ctx.fill(pre.paths[i])
      if (pv && pv[1] && pv[1] !== pv[0]) {
        const pat = hatch(ctx, hatchColor(pv[1], ctxColors))
        pat.setTransform(new DOMMatrix().scale(1 / k))
        ctx.fillStyle = pat; ctx.fill(pre.paths[i])
      }
    })
    if (k > 2.2) {
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.4 / k
      topo.features.forEach((_, i) => ctx.stroke(pre.paths[i]))
    }
    if (borders) { ctx.strokeStyle = 'rgba(8,10,14,.75)'; ctx.lineWidth = 1.1 / k; ctx.stroke(borders.path2d) }
    if (sel) {
      ctx.strokeStyle = accent; ctx.lineWidth = 2 / k
      topo.features.forEach((f, i) => { if (provinces[f.id]?.[0] === sel) ctx.stroke(pre.paths[i]) })
    }
    if (hover) {
      const i = topo.features.findIndex(f => f.id === hover.pid)
      if (i >= 0) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5 / k; ctx.stroke(pre.paths[i]) }
    }
    // labels in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const placed: [number, number, number, number][] = []
    for (const l of labels) {
      const fs = Math.min(30, Math.sqrt(l.area) * k * 0.16)
      if (fs < 8.5) continue
      const sx = x + l.x * k, sy = y + l.y * k
      if (sx < -50 || sy < -20 || sx > size.w + 50 || sy > size.h + 20) continue
      const text = l.name.toUpperCase()
      ctx.font = `600 ${fs}px Cinzel, Georgia, serif`
      const wdt = ctx.measureText(text).width
      if (wdt > Math.sqrt(l.area) * k * 2.6) continue
      const box: [number, number, number, number] = [sx - wdt / 2, sy - fs / 2, sx + wdt / 2, sy + fs / 2]
      if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue
      placed.push(box)
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(text, sx, sy)
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(text, sx, sy)
    }
  }

  useEffect(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(draw)
  })

  function pick(mx: number, my: number): string | null {
    if (!topo || !pre) return null
    if (globe) {
      const r = Math.min(size.w, size.h) / 2.15 * gscale.current
      const p = geoOrthographic().scale(r).translate([size.w / 2, size.h / 2]).rotate([rot.current[0], rot.current[1], 0]).clipAngle(90)
      const ll = p.invert!([mx, my])
      if (!ll) return null
      for (let i = 0; i < topo.features.length; i++) {
        const b = pre.gbounds[i]
        const inLon = b[0][0] <= b[1][0] ? ll[0] >= b[0][0] && ll[0] <= b[1][0] : ll[0] >= b[0][0] || ll[0] <= b[1][0]
        if (!inLon || ll[1] < b[0][1] || ll[1] > b[1][1]) continue
        if (geoContains(topo.features[i] as any, ll)) return topo.features[i].id
      }
      return null
    }
    const { k, x, y } = tr.current
    const px = (mx - x) / k, py = (my - y) / k
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (let i = 0; i < topo.features.length; i++) {
      const b = pre.bounds[i]
      if (px < b[0][0] || px > b[1][0] || py < b[0][1] || py > b[1][1]) continue
      if (ctx.isPointInPath(pre.paths[i], px, py)) return topo.features[i].id
    }
    return null
  }

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: false, tx: tr.current.x, ty: tr.current.y, r: [...rot.current] as [number, number] }
  }
  function onMove(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
      if (d.moved) {
        if (globe) { rot.current = [d.r[0] + dx * 0.3 / gscale.current, Math.max(-85, Math.min(85, d.r[1] - dy * 0.3 / gscale.current))] }
        else { tr.current.x = d.tx + dx; tr.current.y = d.ty + dy; clampT() }
        setHover(null)
        raf.current = requestAnimationFrame(draw)
        return
      }
    }
    const pid = pick(e.clientX - rect.left, e.clientY - rect.top)
    setHover(pid ? { pid, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
  }
  function onUp(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      const rect = canvasRef.current!.getBoundingClientRect()
      const pid = pick(e.clientX - rect.left, e.clientY - rect.top)
      if (pid) {
        setSelProvince(pid)
        const owner = provinces[pid]?.[0]
        setSelected(owner || null)
      } else { setSelected(null); setSelProvince(null) }
    }
  }
  function clampT() {
    const t = tr.current
    t.k = Math.max(1, Math.min(40, t.k))
    t.x = Math.min(size.w * 0.5, Math.max(size.w * 0.5 - size.w * t.k, t.x))
    t.y = Math.min(size.h * 0.5, Math.max(size.h * 0.5 - size.h * t.k, t.y))
  }
  function zoomAt(f: number, mx = size.w / 2, my = size.h / 2) {
    if (globe) { gscale.current = Math.max(0.6, Math.min(12, gscale.current * f)); raf.current = requestAnimationFrame(draw); return }
    const t = tr.current
    const nk = Math.max(1, Math.min(40, t.k * f))
    t.x = mx - (mx - t.x) * (nk / t.k)
    t.y = my - (my - t.y) * (nk / t.k)
    t.k = nk
    clampT()
    raf.current = requestAnimationFrame(draw)
  }
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    cv.addEventListener('wheel', wheel, { passive: false })
    return () => cv.removeEventListener('wheel', wheel)
  })

  const bodies = view ? Object.values(view.bodies) : []
  const hp = hover ? provinces[hover.pid] : null
  const hf = hover && topo ? topo.features.find(f => f.id === hover.pid) : null
  const pname = (pid: string) => provinceName(pid, view?.extra_geo)

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden select-none" data-testid="world-map">
      {planet === 'earth' ? (
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h, cursor: drag.current?.moved ? 'grabbing' : 'crosshair' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} />
      ) : (
        <PlanetMap body={planet} />
      )}
      {!topo && planet === 'earth' && <div className="absolute inset-0 grid place-items-center text-slate-400">Loading world map…</div>}
      {hover && hp && planet === 'earth' && (
        <div className="absolute pointer-events-none panel px-3 py-2 text-xs z-20" style={{ left: Math.min(hover.x + 14, size.w - 230), top: Math.min(hover.y + 14, size.h - 130), width: 216 }}>
          <div className="font-semibold text-slate-100">{pname(hover.pid)}</div>
          <div className="text-slate-400">{hp[0] ? view?.countries[hp[0]]?.name ?? hp[0] : 'Unclaimed'}{hp[1] && hp[1] !== hp[0] ? <span className="text-red-400"> · occupied by {view?.countries[hp[1]]?.name ?? hp[1]}</span> : null}</div>
          <div className="grid grid-cols-2 gap-x-2 mt-1 text-slate-300">
            <span>Pop {pop(hp[3])}</span><span>GDP/cap ${Math.round(hp[4]).toLocaleString()}</span>
            <span>Unrest {hp[2]}%</span><span>Integration {hp[5]}%</span>
          </div>
          {!hp[7] && hp[0] && <div className="text-amber-400 mt-0.5">Not a core province</div>}
          {hf ? null : null}
        </div>
      )}
      {!compact && (
        <>
          <div className="absolute left-3 bottom-3 flex flex-wrap gap-1 max-w-[62%] z-10">
            {planet === 'earth' && MODES.map(m => (
              <button key={m.id} data-testid={`mode-${m.id}`} onClick={() => setMapMode(m.id)} className={`btn text-xs py-1 ${mapMode === m.id ? 'btn-primary' : 'btn-ghost'}`}>{m.label}</button>
            ))}
          </div>
          <div className="absolute right-3 top-3 flex gap-1 items-center z-10">
            <button className={`btn text-xs py-1 ${planet === 'earth' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlanet('earth')}>Earth</button>
            {bodies.length > 0 && (
              <select className="input py-1 text-xs" value={planet === 'earth' ? '' : planet} onChange={e => setPlanet(e.target.value || 'earth')} data-testid="planet-select">
                <option value="">Other worlds ({bodies.length})…</option>
                {bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
          {planet === 'earth' && (
            <div className="absolute right-3 bottom-3 flex gap-1 z-10">
              <button className="btn btn-ghost text-xs py-1 whitespace-nowrap" data-testid="globe-toggle" onClick={() => setGlobe(gl => !gl)}>{globe ? '2D Map' : '3D Globe'}</button>
              <button className="btn btn-ghost text-xs py-1 w-8" onClick={() => zoomAt(1.4)}>+</button>
              <button className="btn btn-ghost text-xs py-1 w-8" onClick={() => zoomAt(1 / 1.4)}>−</button>
              <button className="btn btn-ghost text-xs py-1" onClick={() => { tr.current = { k: 1, x: 0, y: 0 }; gscale.current = 1; raf.current = requestAnimationFrame(draw) }}>Reset</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
