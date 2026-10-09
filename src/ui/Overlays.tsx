import { store, useStore } from '../state/store';
import { actAcceptOffer, actDeclineOffer } from '../sim/actions';
import { PROPOSAL_LABEL, type Proposal } from '../sim/diplomacy';

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
