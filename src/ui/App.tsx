import { useEffect } from 'react';
import { store, useStore } from '../state/store';
import { MapView } from '../map/MapView';
import { TopBar } from './TopBar';
import { TimeControls } from './TimeControls';
import { SidePanel } from './SidePanel';
import { Drawers } from './Drawers';
import { EventModal, MapModes, Offers, Ticker, Toasts, VictoryBanner } from './Overlays';
import { StartScreen } from './StartScreen';

const insetBottom = () => {
  if (window.innerWidth >= 900) return 0;
  const f = store.sheet === 'peek' ? 112 / window.innerHeight : store.sheet === 'half' ? 0.5 : 0.5;
  return Math.round(window.innerHeight * f);
};
const insetRight = () => (window.innerWidth >= 900 ? 440 : 0);

export function App() {
  useStore();
  useEffect(() => { if (!store.state) store.startPreview(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!store.state || store.preview || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); store.togglePause(); }
      else if (e.key >= '1' && e.key <= '3') store.setSpeed(Number(e.key));
      else if (e.key === 'Escape') store.openDrawer('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!store.state) return null;
  if (store.preview) return <StartScreen />;
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
          <Offers />
        </div>
        <SidePanel />
      </div>
      <Drawers />
      <VictoryBanner />
      <EventModal />
    </div>
  );
}
