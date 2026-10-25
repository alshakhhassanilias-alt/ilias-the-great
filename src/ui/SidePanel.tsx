import { START_YEAR, type Country, type GameState } from '../sim/types';
import { PoliticsTab } from './tabs/PoliticsTab';
import { nationalColor } from '../map/palette';
import { store, useStoreThrottled, type Tab } from '../state/store';
import { OverviewTab } from './tabs/OverviewTab';
import { GoalsTab } from './tabs/GoalsTab';
import { ResearchTab } from './tabs/ResearchTab';
import { EconomyTab } from './tabs/EconomyTab';
import { MilitaryTab } from './tabs/MilitaryTab';
import { DiplomacyTab } from './tabs/DiplomacyTab';
import { GOV, REGION, relLabel } from './format';
import { getRelation, isAtWar } from '../sim/relations';
import { Emblem } from './art/Emblem';
import { Portrait, faceFor } from './art/Portrait';
import { TAB_ICONS } from './art/Icons';
import { traitById } from '../sim/leaders';
import { OppositionDesk } from './Legacy';
import { isFree } from '../sim/legacy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'politics', label: 'Politics' }, { id: 'goals', label: 'Goals' }, { id: 'research', label: 'Research' }, { id: 'economy', label: 'Economy' }, { id: 'military', label: 'Military' }, { id: 'diplomacy', label: 'Diplomacy' },
];

/** "Founded 2087, breaking away from Brazil" · "Restored in 2140" · "Formerly Poland" */
function originLine(s: GameState, c: Country): string {
  const year = (t: number) => Math.floor(START_YEAR + t / 52);
  const o = c.origin;
  if (o) {
    const from = s.countries[o.from]?.name ?? 'its old masters';
    if (o.how === 'revival') return `Restored in ${year(o.tick)}, breaking free from ${from}`;
    if (o.how === 'union') return `United in ${year(o.tick)}`;
    return `Founded in ${year(o.tick)}, breaking away from ${from}`;
  }
  if (c.key && c.key !== c.name) return `Formerly ${c.key}`;
  return '';
}
export function SidePanel() {
  useStoreThrottled(450);
  const s = store.state!;
  const id = store.selected;
  const c = id !== null ? s.countries[id] : null;
  const opposition = s.settings.mode === 'legacy' && s.legacy?.status === 'opposition';
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
          <div className="side-head" style={{ ['--nat' as string]: nationalColor(c) }}>
            <span className="chip" style={{ background: nationalColor(c) }} />
            <span className="desk-only head-emblem"><Emblem c={c} size={64} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="desk-only head-kicker">{c.id === s.player ? 'Your nation' : 'Intelligence dossier'}</div>
              <h2>{c.name}</h2>
              <div className="sub">
                {c.id === s.player ? <span className="pill gold">Your country</span> : <span className={`pill ${relLabel(getRelation(s, c.id, s.player)).cls}`}>{relLabel(getRelation(s, c.id, s.player)).text}</span>}
                <span>{GOV[c.gov]} · {REGION[c.region]}</span>
                {isAtWar(s, c.id) && <span className="pill red">⚔ at war</span>}
                {c.mil.nuclear && <span className="pill">☢</span>}
              </div>
              {originLine(s, c) && <div className="head-origin">{originLine(s, c)}</div>}
              {c.leader && c.id !== s.player && <div className="desk-only head-leader">Led by <b>{c.leader.name}</b> · {c.leader.traits.map((x) => traitById(x).title).join(', ')}</div>}
            </div>
            {(() => { const nm = c.id === s.player ? s.legacy?.leader : c.leader?.name; return nm ? <span className="desk-only head-portrait" title={nm}><Portrait f={faceFor(c, nm, 'leader')} size={58} /></span> : null; })()}
            {c.id !== s.player && <button className="iconbtn" title="Back to your country" aria-label="Back to your country" onClick={() => store.select(s.player, null, true)}>⌂</button>}
          </div>
          <nav className="tabs" role="tablist">
            {TABS.filter((t) => (t.id !== 'goals' && t.id !== 'politics' && t.id !== 'research') || c.id === s.player).map((t) => (
              <button key={t.id} role="tab" aria-selected={store.tab === t.id} className={store.tab === t.id ? 'on' : ''} onClick={() => { store.setTab(t.id); if (store.sheet === 'peek') store.setSheet('half'); }}>{(() => { const Ic = TAB_ICONS[t.id]; return <span className="desk-only tab-ic"><Ic /></span>; })()}{t.label}</button>
            ))}
          </nav>
          <div className={`side-body ${opposition ? 'locked' : ''}`} key={`${c.id}-${store.tab}`}>
            {opposition && c.id === s.player && <div className="opp-wrap"><div className="note warn" style={{ marginBottom: 8 }}>{isFree(c.gov) ? `You lead the opposition. ${s.legacy!.opposition!.gov}'s government runs ${c.name}; you can watch, campaign and wait for the vote.` : `You are in exile. ${s.legacy!.opposition!.gov} rules ${c.name}.`}</div><OppositionDesk /></div>}
            {opposition && c.id !== s.player && <div className="opp-wrap"><div className="note warn" style={{ marginBottom: 8 }}>Out of power, you can only watch the world.</div></div>}
            {(store.tab === 'overview' || ((store.tab === 'goals' || store.tab === 'politics' || store.tab === 'research') && c.id !== s.player)) && <OverviewTab id={c.id} />}
            {store.tab === 'research' && c.id === s.player && <ResearchTab />}
            {store.tab === 'politics' && c.id === s.player && <PoliticsTab />}
            {store.tab === 'goals' && c.id === s.player && <GoalsTab />}
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
