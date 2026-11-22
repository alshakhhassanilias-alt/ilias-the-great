import { useEffect, useMemo, useRef, useState } from 'react'
import { Delaunay } from 'd3-delaunay'
import { useGame } from '../store'
import { pop } from '../lib/format'

const BODY_STYLE: Record<string, { bg: [string, string]; free: string; label: string }> = {
  luna: { bg: ['#4b4f57', '#23262b'], free: '#5c6068', label: 'Regolith plains, polar ice, and lava-tube shelters' },
  mars: { bg: ['#8c3b1d', '#3b1408'], free: '#9a4a2a', label: 'Dust, ancient riverbeds and buried glaciers' },
  belt: { bg: ['#2b2a33', '#0d0c12'], free: '#3a3844', label: 'Scattered minor planets rich in metals and volatiles' },
  jovian: { bg: ['#7a5a3a', '#25190d'], free: '#866746', label: 'Ice moons inside Jupiter\'s radiation belts' },
  saturnian: { bg: ['#8c7a4c', '#2e2715'], free: '#998659', label: 'Methane lakes of Titan and the geysers of Enceladus' },
  venus: { bg: ['#c99a3a', '#4d3510'], free: '#d6ab52', label: 'Floating cities fifty kilometres above the inferno' },
  proxima: { bg: ['#6b2a4a', '#1e0a16'], free: '#7a3858', label: 'A tidally locked world around a red dwarf' },
  tau_ceti: { bg: ['#2a5a6b', '#0a1a1e'], free: '#386e80', label: 'A super-Earth twelve light-years from Sol' },
  trappist: { bg: ['#3b2a6b', '#0f0a1e'], free: '#4a3880', label: 'Seven worlds circling an ultracool dwarf' },
}

export default function PlanetMap({ body }: { body: string }) {
  const { view, setSelected, setCommand, setTab } = useGame()
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const regions = useMemo(() => Object.entries(view?.extra_geo || {}).filter(([, g]) => g.body === body).map(([id, g]) => ({ id, ...g })), [view, body])
  const pts = regions.map(r => [((r.c[0] + 180) / 360) * size.w, ((90 - r.c[1]) / 180) * size.h] as [number, number])
  const vor = useMemo(() => (pts.length >= 2 ? Delaunay.from(pts).voronoi([0, 0, size.w, size.h]) : null), [JSON.stringify(pts), size])
  const st = BODY_STYLE[body] || BODY_STYLE.mars
  const b = view?.bodies[body]
  const selR = regions.find(r => r.id === sel)
  const sp = sel ? view?.provinces?.[sel] : null
  return (
    <div ref={wrap} className="relative w-full h-full" data-testid={`planet-map-${body}`}>
      <svg width={size.w} height={size.h} className="block">
        <defs>
          <radialGradient id={`bg-${body}`} cx="40%" cy="30%" r="80%"><stop offset="0%" stopColor={st.bg[0]} /><stop offset="100%" stopColor={st.bg[1]} /></radialGradient>
          <pattern id="occ" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2,10 l12,-12" stroke="rgba(0,0,0,.5)" strokeWidth="2" /></pattern>
        </defs>
        <rect width={size.w} height={size.h} fill={`url(#bg-${body})`} />
        {vor && regions.map((r, i) => {
          const pv = view?.provinces?.[r.id]
          const owner = pv?.[0]
          const fill = owner ? view?.countries[owner]?.color || '#888' : st.free
          return (
            <g key={r.id} onClick={() => { setSel(r.id); setSelected(owner || null) }} style={{ cursor: 'pointer' }}>
              <path d={vor.renderCell(i)} fill={fill} fillOpacity={owner ? 0.82 : 0.35} stroke={sel === r.id ? 'white' : 'rgba(0,0,0,.45)'} strokeWidth={sel === r.id ? 2 : 1} />
              {pv && pv[1] && pv[1] !== pv[0] && <path d={vor.renderCell(i)} fill="url(#occ)" />}
            </g>
          )
        })}
        {regions.map((r, i) => (
          <g key={r.id + 'l'} pointerEvents="none">
            <circle cx={pts[i][0]} cy={pts[i][1]} r={3} fill="white" opacity={0.7} />
            <text x={pts[i][0]} y={pts[i][1] - 8} textAnchor="middle" fontSize={12} fill="white" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.6)', strokeWidth: 3 }} fontFamily="Cinzel, serif">{r.name}</text>
          </g>
        ))}
      </svg>
      <div className="absolute top-14 left-3 panel px-3 py-2 max-w-sm">
        <div className="h-title text-lg accent">{b?.name}</div>
        <div className="text-xs text-slate-400">{st.label}. Opened to settlement in {b?.unlocked} by {view?.countries[b?.by || '']?.name || b?.by}. Terraforming {Math.round((b?.terraform || 0) * 100)}%.</div>
      </div>
      {selR && (
        <div className="absolute top-14 right-3 panel px-3 py-2 w-64 text-sm" data-testid="planet-region">
          <div className="font-semibold">{selR.name}</div>
          {sp?.[0] ? (
            <div className="text-xs text-slate-300 mt-1 space-y-0.5">
              <div>Held by <b>{view?.countries[sp[0]]?.name}</b></div>
              <div>Settlers: {pop(sp[3])}</div>
              <div>Unrest {sp[2]}% · autonomy pressure {sp[8]}</div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 mt-1">Unclaimed.
              <button className="btn btn-primary text-xs mt-2 w-full" onClick={() => { setCommand(`Colonize ${selR.name} on ${b?.name.split(' (')[0]}`); setTab('command') }}>Order a colony expedition</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
