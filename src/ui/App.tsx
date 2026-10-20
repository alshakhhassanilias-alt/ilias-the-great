import { NegotiationTable } from './Negotiation';
import { WarRoom } from './WarRoom';
import { useEffect } from 'react';
import { store, useStoreSelect, type Tab } from '../state/store';
import { actionFor, prefs, setPrefs, type KeyAction } from '../prefs';
import { desktop, setFullscreen } from '../platform';
import { music } from '../music';
import { AskDialog } from './SystemScreens';
import { Walkthrough } from './Walkthrough';
import { MapView } from '../map/MapView';
import { TopBar } from './TopBar';
import { TimeControls } from './TimeControls';
import { SidePanel } from './SidePanel';
import { Drawers } from './Drawers';
import { BreakingBanner, Splash, YearReview, InboxTray, MapModes, NotesColumn, Offers, RippleCard, Ticker, Toasts, VictoryBanner } from './Overlays';
import { StartScreen } from './StartScreen';
import { BattleCard } from './BattleCard';
import { ArmyPanel } from './ArmyPanel';
import { AgendaDraft, HistoryBook, TermReview } from './Legacy';

const insetBottom = () => {
  if (window.innerWidth >= 900) return 0;
  const f = store.sheet === 'peek' ? 112 / window.innerHeight : store.sheet === 'half' ? 0.5 : 0.5;
  return Math.round(window.innerHeight * f);
};
const insetRight = () => (window.innerWidth >= 900 ? 440 : 0);

export function App() {
  // only the screen layout lives here; every panel subscribes to the state it shows
  useStoreSelect(() => `${store.state ? 1 : 0}|${store.preview}|${store.sheet}`);
  useEffect(() => { if (!store.state) store.startPreview(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (store.asking || e.repeat && !/^(Equal|Minus|Period)$/.test(e.code)) return;
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' && !['checkbox', 'radio', 'range'].includes((t as HTMLInputElement).type) || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA';
      if (typing && e.code !== 'Escape') return;
      const a = actionFor(e.code);
      if (!a) return;
      if (a === 'fullscreen') { e.preventDefault(); const on = !prefs.fullscreen; setPrefs({ fullscreen: on }); void setFullscreen(on); return; }
      if (!store.state) return;
      if (store.preview) { if (a === 'menu' && store.drawer.open !== 'none') store.openDrawer('none'); return; }
      e.preventDefault();
      const tabs: Partial<Record<KeyAction, Tab>> = { tabOverview: 'overview', tabPolitics: 'politics', tabGoals: 'goals', tabEconomy: 'economy', tabMilitary: 'military', tabDiplomacy: 'diplomacy' };
      const s = store.state;
      switch (a) {
        case 'pause': store.togglePause(); break;
        case 'speed1': case 'speed2': case 'speed3': case 'speed4': store.setSpeed(Number(a.slice(5))); break;
        case 'step': store.stepOnce(); break;
        case 'zoomIn': window.dispatchEvent(new CustomEvent('wo-zoom', { detail: 1.4 })); break;
        case 'zoomOut': window.dispatchEvent(new CustomEvent('wo-zoom', { detail: 1 / 1.4 })); break;
        case 'home': store.select(s.player, null, true); break;
        case 'quickSave': void store.quickSave(); break;
        case 'quickLoad': void store.quickLoad().then((ok) => { if (!ok) store.toast('No quick save yet.', 'info'); }); break;
        case 'saves': store.openDrawer('load'); break;
        case 'help': store.helpStep = 0; store.openDrawer('help'); break;
        case 'world': store.openDrawer(store.drawer.open === 'world' ? 'none' : 'world'); break;
        case 'warRoom': { const w = s.wars.find((x) => x.attackers.includes(s.player) || x.defenders.includes(s.player)); if (store.warRoom) { store.warRoom = null; store.notify(); } else if (w) store.openWarRoom(w.id); else store.toast('You are not at war.', 'info'); break; }
        case 'menu':
          if (store.drawer.open !== 'none') store.openDrawer('none');
          else if (store.warRoom) { store.warRoom = null; store.notify(); }
          else store.openDrawer('menu');
          break;
        default: { const tb = tabs[a]; if (tb) { if (store.selected === null) store.select(s.player); store.setTab(tb); } }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // music follows the state of the world; quieter while paused or a window is open
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = store.state;
      if (!s || store.preview) { music.setMood('menu'); music.setDuck(false); return; }
      const c = s.countries[s.player];
      const atWar = s.wars.some((w) => w.attackers.includes(s.player) || w.defenders.includes(s.player));
      const tense = (s.crisis && s.crisis.id !== 'boom') || c.eco.stability < 38 || s.inbox.some((x) => x.urgent);
      music.setMood(atWar ? 'war' : tense ? 'tension' : 'peace');
      music.setDuck(store.speed === 0 || store.drawer.open !== 'none');
    }, 1500);
    return () => window.clearInterval(id);
  }, []);
  // preferences that apply at start
  useEffect(() => {
    document.documentElement.classList.toggle('calm', prefs.calm);
    if (prefs.fullscreen) void setFullscreen(true);
    if (desktop && prefs.uiScale !== 1) void desktop.window.setZoom(prefs.uiScale);
  }, []);
  if (!store.state) return null;
  if (store.preview) return <><StartScreen /><Drawers /><AskDialog /></>;
  const desk = window.matchMedia?.('(min-width: 901px)').matches ?? window.innerWidth > 900;
  const bottom = window.innerWidth < 900 ? (store.sheet === 'peek' ? '112px' : store.sheet === 'half' ? '50vh' : '92vh') : '0px';
  return (
    <div className="app" style={{ ['--map-bottom' as string]: bottom }}>
      <TopBar />
      <div className="stage">
        <div className="map-area">
          <MapView insetBottom={insetBottom} insetRight={insetRight} />
          <MapModes />
          <TimeControls />
          <Ticker />
          <Toasts />
          {desk ? <NotesColumn /> : <><Offers /><RippleCard /></>}
          <InboxTray />
          <BattleCard />
          <ArmyPanel />
          <BreakingBanner />
          {!desk && <YearReview />}
          <Splash />
        </div>
        <SidePanel />
      </div>
      <Drawers />
      <VictoryBanner />
      <AgendaDraft />
      <TermReview />
      <NegotiationTable />
      <WarRoom />
      <HistoryBook />
      <Walkthrough />
      <AskDialog />
    </div>
  );
}
