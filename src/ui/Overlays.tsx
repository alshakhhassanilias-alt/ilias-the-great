import { store, useStore } from '../state/store';
import { actAcceptOffer, actDeclineOffer } from '../sim/actions';
import { PROPOSAL_LABEL, type Proposal } from '../sim/diplomacy';
import { actResolveEvent } from '../sim/actions';
import { eventById } from '../sim/events';
import { useEffect, useState } from 'react';
import { dateLabel } from '../sim/tick';

export function Toasts() {
  useStore();
  return (
    <div className="toasts" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status" onClick={() => store.dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

export function Offers() {
  useStore();
  const s = store.state!;
  if (!s.offers.length) return null;
  return (
    <div className="offers">
      {s.offers.slice(0, 3).map((o) => (
        <div className="offer" key={o.id} role="alert">
          <b>{s.countries[o.from].name}</b> {o.kind === 'peace' ? `offers peace (${o.terms?.kind.replace('_', ' ')})` : `proposes a ${PROPOSAL_LABEL[o.kind as Proposal].toLowerCase()}`}.
          <div className="btnrow">
            <button className="btn good" onClick={() => store.act((g) => actAcceptOffer(g, store.geo, o.id))}>Accept</button>
            <button className="btn" onClick={() => store.act((g) => actDeclineOffer(g, o.id), true)}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VictoryBanner() {
  useStore();
  const v = store.state?.victory;
  if (!v) return null;
  return (
    <div className={`banner ${v.achieved ? '' : 'lose'}`} role="alert">
      <h3>{v.achieved ? 'Victory' : 'Game over'}</h3>
      <div>{v.text}</div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        {v.achieved && <button className="btn primary" onClick={() => { store.mutate((g) => { g.victory = null; g.settings.victory = 'none'; }); }}>Keep playing</button>}
        <button className="btn" onClick={() => store.quitToMenu()}>Main menu</button>
      </div>
    </div>
  );
}

export function MapModes() {
  useStore();
  const modes: { v: typeof store.mapMode; label: string }[] = [
    { v: 'political', label: 'Political' }, { v: 'diplomacy', label: 'Relations' }, { v: 'wealth', label: 'Wealth' }, { v: 'power', label: 'Power' }, { v: 'stability', label: 'Stability' },
  ];
  const gradients: Record<string, [string, string, string]> = {
    diplomacy: ['linear-gradient(90deg,#b43232,#46506a,#3cbe82)', 'hostile', 'friendly'],
    wealth: ['linear-gradient(90deg,#18285a,#1e6088,#28969a,#96be5a,#ecd660)', 'poor', 'rich (GDP/capita)'],
    power: ['linear-gradient(90deg,#1e283c,#56466e,#aa465a,#e8783c,#ffc85a)', 'weak', 'strong'],
    stability: ['linear-gradient(90deg,#aa3232,#c88232,#bebe50,#50a064,#32aa8c)', 'unstable', 'stable'],
  };
  const g = gradients[store.mapMode];
  return (
    <>
      <div className="mapmodes-top" role="group" aria-label="Map mode">
        {modes.map((m) => <button key={m.v} className={store.mapMode === m.v ? 'on' : ''} onClick={() => store.setMapMode(m.v)}>{m.label}</button>)}
      </div>
      {g && <div className="legend"><div className="ramp" style={{ background: g[0] }} /><div className="ends"><span>{g[1]}</span><span>{g[2]}</span></div></div>}
    </>
  );
}

export function EventModal() {
  useStore();
  const s = store.state;
  const pe = s?.pendingEvent;
  if (!s || !pe) return null;
  const def = eventById(pe.id);
  const c = s.countries[s.player];
  return (
    <div className="scrim" role="presentation">
      <div className="modal narrow event" role="dialog" aria-modal="true" aria-label={def.title}>
        <div className="event-head"><span className="event-icon" aria-hidden="true">{def.icon}</span><div><div className="event-kicker">{dateLabel(s.tick)} · Decision</div><h2>{def.title}</h2></div></div>
        <div className="modal-body">
          <p className="event-text">{def.text(s, c, pe.data)}</p>
          <div className="event-options">
            {def.options.map((o, i) => {
              const ok = !o.enabled || o.enabled(s, c);
              return (
                <button key={i} className={`btn event-opt ${i === 0 ? 'primary' : ''}`} disabled={!ok}
                  onClick={() => { store.act((g) => actResolveEvent(g, store.geo, i)); store.resumeAfterEvent(); }}>
                  {o.label}<small>{ok ? o.hint : 'Cannot afford this'}</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const KIND_ICON: Record<string, string> = { war: '⚔', peace: '🕊', diplo: '🤝', econ: '💰', danger: '⚠', territory: '🏴', info: '●' };
export function Ticker() {
  useStore();
  const s = store.state!;
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => x + 1), 4200); return () => clearInterval(t); }, []);
  const items = s.log.slice(-8).reverse();
  if (!items.length) return null;
  const e = items[i % items.length];
  return (
    <button className="ticker" onClick={() => store.openDrawer('world', 'news')} aria-label="Open the news feed">
      <span className="ticker-tag">NEWS</span>
      <span key={e.seq} className={`ticker-text k-${e.kind}`}><span aria-hidden="true">{KIND_ICON[e.kind] ?? '●'}</span> {e.text}</span>
      <span className="ticker-date">{dateLabel(e.tick)}</span>
    </button>
  );
}
