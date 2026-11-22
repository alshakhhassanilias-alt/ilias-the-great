import { useEffect, useState } from 'react'
import { GameProvider, useGame } from '../store'
import { eraClass } from '../lib/format'
import TopBar from './TopBar'
import WorldMap from './WorldMap'
import NationPanel from './NationPanel'
import CommandPanel from './CommandPanel'
import MissionsPanel from './MissionsPanel'
import DiplomacyPanel from './DiplomacyPanel'
import AdvisorPanel from './AdvisorPanel'
import ChroniclePanel from './ChroniclePanel'
import NewspaperPanel from './NewspaperPanel'
import TechPanel from './TechPanel'
import IntelPanel from './IntelPanel'
import TimelinePanel from './TimelinePanel'
import SavesPanel from './SavesPanel'
import BriefingModal from './BriefingModal'
import { BusyOverlay, DecisionModal, EventPopup, Ticker, Toasts } from './Overlays'

const TABS = [
  ['command', 'Command'], ['missions', 'Missions'], ['diplomacy', 'Diplomacy'], ['advisor', 'Advisor'], ['chronicle', 'Chronicle'],
  ['newspaper', 'Press'], ['tech', 'Technology'], ['intel', 'World'], ['timeline', 'Timeline'], ['saves', 'Saves'],
] as const

function Layout({ onExit, onOpen }: { onExit: () => void; onOpen: (id: string) => void }) {
  const { view, loading, tab, setTab } = useGame()
  const [snapMap, setSnapMap] = useState<any>(null)
  const [briefing, setBriefing] = useState(false)
  useEffect(() => {
    if (view && view.meta.year === view.meta.start_year && view.meta.month === view.meta.start_month && !sessionStorageGet(`briefed-${view.id}`)) {
      setBriefing(true)
      sessionStorageSet(`briefed-${view.id}`)
    }
  }, [view?.id])
  useEffect(() => {
    if (view) document.body.className = eraClass(view.meta.year, view.meta.era)
  }, [view?.meta.year, view?.meta.era])
  if (loading || !view) return <div className="h-full grid place-items-center text-slate-400 h-title text-xl">Opening the archives…</div>
  const activeMissions = view.missions.filter(m => m.status === 'active').length
  return (
    <div className="h-full flex flex-col">
      <TopBar onExit={onExit} />
      <div className="flex-1 flex min-h-0">
        <div className="w-[300px] shrink-0 border-r border-ink-700 bg-ink-900/90 min-h-0">
          <NationPanel />
        </div>
        <div className="flex-1 relative min-w-0">
          <WorldMap provincesOverride={snapMap?.provinces} countriesOverride={snapMap?.countries} />
          {snapMap && <div className="absolute top-3 left-1/2 -translate-x-1/2 panel px-4 py-1.5 h-title accent z-20">The world in {snapMap.year}</div>}
          <button className="absolute top-3 left-3 btn btn-ghost text-xs z-10" onClick={() => setBriefing(true)} data-testid="open-briefing">Briefing</button>
        </div>
        <div className="w-[420px] shrink-0 border-l border-ink-700 bg-ink-900/90 flex flex-col min-h-0">
          <div className="flex overflow-x-auto border-b border-ink-700 shrink-0">
            {TABS.map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
                {label}{id === 'missions' && activeMissions ? <span className="ml-1 chip">{activeMissions}</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {tab === 'command' && <CommandPanel />}
            {tab === 'missions' && <MissionsPanel />}
            {tab === 'diplomacy' && <DiplomacyPanel />}
            {tab === 'advisor' && <AdvisorPanel />}
            {tab === 'chronicle' && <ChroniclePanel />}
            {tab === 'newspaper' && <NewspaperPanel />}
            {tab === 'tech' && <TechPanel />}
            {tab === 'intel' && <IntelPanel />}
            {tab === 'timeline' && <TimelinePanel onViewSnapshot={setSnapMap} />}
            {tab === 'saves' && <SavesPanel onOpen={onOpen} />}
          </div>
        </div>
      </div>
      <Ticker />
      <EventPopup />
      <DecisionModal />
      <BusyOverlay />
      <Toasts />
      {briefing && <BriefingModal onClose={() => setBriefing(false)} />}
    </div>
  )
}

function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k) } catch { return null } }
function sessionStorageSet(k: string) { try { sessionStorage.setItem(k, '1') } catch { /* ignore */ } }

export default function Game({ cid, onExit, onOpen }: { cid: string; onExit: () => void; onOpen: (id: string) => void }) {
  return (
    <GameProvider key={cid} cid={cid}>
      <Layout onExit={onExit} onOpen={onOpen} />
    </GameProvider>
  )
}
