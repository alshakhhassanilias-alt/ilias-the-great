import { store, useStore, type Tab } from '../state/store';
import { OverviewTab } from './tabs/OverviewTab';
import { EconomyTab } from './tabs/EconomyTab';
import { MilitaryTab } from './tabs/MilitaryTab';
import { DiplomacyTab } from './tabs/DiplomacyTab';
import { GOV, REGION, relLabel } from './format';
import { getRelation, isAtWar } from '../sim/relations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'economy', label: 'Economy' }, { id: 'military', label: 'Military' }, { id: 'diplomacy', label: 'Diplomacy' },
];

export function SidePanel() {
  useStore();
  const s = store.state!;
  const id = store.selected;
  const c = id !== null ? s.countries[id] : null;
  const order = ['peek', 'half', 'full'] as const;
  const step = (dir: 1 | -1) => store.setSheet(order[Math.max(0, Math.min(2, order.indexOf(store.sheet) + dir))]);
  const cycle = () => store.setSheet(store.sheet === 'half' ? 'full' : store.sheet === 'full' ? 'peek' : 'half');
  let y0 = 0;
  return (
    <aside className={`side ${store.sheet}`} aria-label="Country information">
      <button className="sheet-handle" aria-label="Expand or collapse panel"
        onPointerDown={(e) => { y0 = e.clientY; }}
        onPointerUp={(e) => { const dy = e.clientY - y0; if (Math.abs(dy) > 36) step(dy < 0 ? 1 : -1); else cycle(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } }}><i /></button>
      {c ? (
        <>
          <div className="side-head">
            <span className="chip" style={{ background: c.id === s.player ? 'var(--teal)' : `hsl(${c.color},45%,45%)` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{c.name}</h2>
              <div className="sub">
                {c.id === s.player ? <span className="pill gold">Your country</span> : <span className={`pill ${relLabel(getRelation(s, c.id, s.player)).cls}`}>{relLabel(getRelation(s, c.id, s.player)).text}</span>}
                <span>{GOV[c.gov]} · {REGION[c.region]}</span>
                {isAtWar(s, c.id) && <span className="pill red">⚔ at war</span>}
                {c.mil.nuclear && <span className="pill">☢</span>}
              </div>
            </div>
            {c.id !== s.player && <button className="iconbtn" title="Back to your country" aria-label="Back to your country" onClick={() => store.select(s.player, null, true)}>⌂</button>}
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={store.tab === t.id} className={store.tab === t.id ? 'on' : ''} onClick={() => { store.setTab(t.id); if (store.sheet === 'peek') store.setSheet('half'); }}>{t.label}</button>
            ))}
          </nav>
          <div className="side-body" key={`${c.id}-${store.tab}`}>
            {store.tab === 'overview' && <OverviewTab id={c.id} />}
            {store.tab === 'economy' && <EconomyTab id={c.id} />}
            {store.tab === 'military' && <MilitaryTab id={c.id} />}
            {store.tab === 'diplomacy' && <DiplomacyTab id={c.id} />}
          </div>
        </>
      ) : (
        <div className="side-body"><p className="muted">Select a country on the map to see its economy, military and diplomatic options.</p></div>
      )}
    </aside>
  );
}
