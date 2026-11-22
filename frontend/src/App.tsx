import { useEffect, useState } from 'react'
import MainMenu from './components/MainMenu'
import Game from './components/Game'

function readHash(): string | null {
  const m = window.location.hash.match(/^#\/c\/([\w-]+)/)
  return m ? m[1] : null
}

export default function App() {
  const [cid, setCid] = useState<string | null>(readHash())
  useEffect(() => {
    const h = () => setCid(readHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const open = (id: string) => { window.location.hash = `#/c/${id}` }
  const exit = () => { window.location.hash = '' }
  return cid ? <Game cid={cid} onExit={exit} onOpen={open} /> : <MainMenu onOpen={open} />
}
