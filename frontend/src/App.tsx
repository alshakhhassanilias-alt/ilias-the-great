import { useEffect, useState } from 'react'
import MainMenu from './components/MainMenu'
import Game from './components/Game'
import { STANDALONE, onEngine } from './engine'

function readHash(): string | null {
  const m = window.location.hash.match(/^#\/c\/([\w-]+)/)
  return m ? m[1] : null
}

function EngineSplash({ text, fatal }: { text: string; fatal: boolean }) {
  return (
    <div className="h-full grid place-items-center" style={{ background: 'radial-gradient(ellipse at 30% 0%, #1b2436 0%, #07090d 60%)' }}>
      <div className="text-center px-6 max-w-lg">
        <div className="h-title text-4xl accent tracking-[.2em]">INFINITE HISTORY</div>
        <div className="font-serif italic text-slate-400 mt-2">Every empire has a history. Yours has not been written yet.</div>
        {!fatal ? (
          <>
            <div className="mx-auto mt-8 w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            <div className="mt-4 text-sm text-slate-300" data-testid="engine-status">{text}</div>
            <div className="mt-2 text-xs text-slate-500">The whole simulation runs in your browser. The first visit downloads about 14 MB.</div>
          </>
        ) : (
          <div className="mt-8 text-sm text-red-300">The simulation engine could not start in this browser: {text}</div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [cid, setCid] = useState<string | null>(readHash())
  const [engine, setEngine] = useState({ text: 'Starting…', ready: !STANDALONE, fatal: false })
  useEffect(() => {
    const h = () => setCid(readHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  useEffect(() => (STANDALONE ? onEngine(s => setEngine({ text: s.text, ready: s.ready, fatal: !!s.fatal })) : undefined), [])
  const open = (id: string) => { window.location.hash = `#/c/${id}`; setCid(id) }
  const exit = () => { window.location.hash = ''; setCid(null) }
  if (!engine.ready) return <EngineSplash text={engine.text} fatal={engine.fatal} />
  return cid ? <Game cid={cid} onExit={exit} onOpen={open} /> : <MainMenu onOpen={open} />
}
