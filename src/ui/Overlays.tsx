import { store, useStore } from '../state/store';
import { actAcceptOffer, actDeclineOffer } from '../sim/actions';
import { PROPOSAL_LABEL, type Proposal } from '../sim/diplomacy';
import { actResolveEvent } from '../sim/actions';
import { eventById } from '../sim/events';
import { useEffect, useState } from 'react';
import { dateLabel } from '../sim/tick';
import { nationalColor } from '../map/palette';
import { Emblem } from './art/Emblem';
import { strength } from '../sim/military';
import { warSupport } from '../sim/warsupport';
import { fmtNum } from './format';

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
    { v: 'political', label: 'Political' }, { v: 'blocs', label: 'Blocs' }, { v: 'diplomacy', label: 'Relations' }, { v: 'wealth', label: 'Wealth' }, { v: 'power', label: 'Power' }, { v: 'stability', label: 'Stability' },
  ];
  const gradients: Record<string, [string, string, string]> = {
    diplomacy: ['linear-gradient(90deg,#b43232,#46506a,#3cbe82)', 'hostile', 'friendly'],
    wealth: ['linear-gradient(90deg,#18285a,#1e6088,#28969a,#96be5a,#ecd660)', 'poor', 'rich (GDP/capita)'],
    power: ['linear-gradient(90deg,#1e283c,#56466e,#aa465a,#e8783c,#ffc85a)', 'weak', 'strong'],
    stability: ['linear-gradient(90deg,#aa3232,#c88232,#bebe50,#50a064,#32aa8c)', 'unstable', 'stable'],
    blocs: ['linear-gradient(90deg,#c8503c,#c89a3c,#4aa86a,#3c8cc8,#8a5cc8)', 'each colour = one alliance bloc', 'grey = non-aligned'],
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

/** Decisions wait here. They never stop the game: answer when you like, or let them lapse. */
export function InboxTray() {
  useStore();
  const s = store.state;
  if (!s || !s.inbox.length) return null;
  const c = s.countries[s.player];
  return (
    <div className="inbox" role="region" aria-label="Decisions waiting">
      {s.inbox.map((it) => {
        const def = eventById(it.id);
        const open = store.inboxOpen === it.uid;
        const left = Math.max(0, it.expires - s.tick);
        const total = Math.max(1, it.expires - it.tick);
        return (
          <div key={it.uid} className={`inbox-item ${it.urgent ? 'urgent' : ''} ${open ? 'open' : ''}`}>
            <button className="inbox-row" aria-expanded={open} onClick={() => store.openInbox(open ? null : it.uid)}>
              <span className="inbox-icon" aria-hidden="true">{def.icon}</span>
              <span className="inbox-title"><b>{def.title}</b><small>{it.urgent ? 'Urgent · ' : ''}{left} wk left</small></span>
              <span className="inbox-go">{open ? '▾' : 'Decide'}</span>
              <i className="inbox-bar" style={{ width: `${(100 * left) / total}%` }} />
            </button>
            {open && (
              <div className="inbox-body">
                <p className="event-text">{def.text(s, c, it.data)}</p>
                <div className="event-options">
                  {def.options.map((o, i) => {
                    const ok = !o.enabled || o.enabled(s, c);
                    return (
                      <button key={i} className={`btn event-opt ${i === 0 ? 'primary' : ''}`} disabled={!ok}
                        onClick={() => { store.act((g) => actResolveEvent(g, store.geo, i, it.uid)); store.inboxOpen = null; store.notify(); }}>
                        {o.label}<small>{ok ? o.hint : 'Cannot afford this'}</small>
                      </button>
                    );
                  })}
                </div>
                <button className="linkbtn" onClick={() => store.openInbox(null)}>Decide later (the game keeps running)</button>
              </div>
            )}
          </div>
        );
      })}
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

export function RippleCard() {
  useStore();
  const s = store.state;
  const r = s?.lastRipple;
  if (!s || !r || (r.a !== s.player && r.b !== s.player)) return null;
  const id = `${r.tick}:${r.a}:${r.b}:${r.kind}`;
  if (store.rippleSeen === id || s.tick - r.tick > 26) return null;
  const other = r.a === s.player ? r.b : r.a;
  const kind = ({ trade: 'trade agreement', nap: 'non-aggression pact', alliance: 'alliance', coop: 'military cooperation', guarantee: 'security guarantee', sanction: 'sanctions', embargo: 'embargo' } as Record<string, string>)[r.kind] ?? r.kind;
  return (
    <div className="ripple" role="status" aria-live="polite">
      <button className="x" aria-label="Dismiss" onClick={() => { store.rippleSeen = id; store.notify(); }}>×</button>
      <h4>How the world reacted</h4>
      <div style={{ fontSize: 13, marginBottom: 6 }}>Your {kind} with <b>{s.countries[other].name}</b>: {r.summary}.</div>
      {r.reactions.length === 0 && <div className="faint" style={{ fontSize: 12 }}>Nobody paid much attention.</div>}
      {r.reactions.slice(0, 6).map((x) => (
        <div className="rr" key={x.id}><b className={x.delta < 0 ? 'bad' : 'good'}>{x.delta > 0 ? '+' : ''}{x.delta.toFixed(0)}</b><span>{x.text}</span></div>
      ))}
    </div>
  );
}

export function BreakingBanner() {
  useStore();
  const b = store.breaking;
  if (!b) return null;
  const danger = b.kind === 'war' || b.kind === 'danger';
  return (
    <button className={`breaking ${danger ? 'hot' : ''}`} key={b.seq} onClick={() => { store.dismissBreaking(); if (b.prov !== undefined && store.state) { const o = store.state.owner[b.prov]; store.select(o, b.prov, true); } }} aria-live="assertive">
      <span className="breaking-tag">BREAKING</span>
      <span className="breaking-text"><span className="desk-only gazette">The World Order Gazette · {store.state ? dateLabel(store.state.tick) : ''}</span>{b.text}</span>
    </button>
  );
}

export function YearReview() {
  useStore();
  const s = store.state;
  const r = s?.review;
  if (!s || !r || store.reviewSeen >= r.tick || s.tick - r.tick > 30) return null;
  return (
    <div className="ripple review" role="status">
      <button className="x" aria-label="Dismiss" onClick={() => { store.reviewSeen = r.tick; store.notify(); }}>×</button>
      <h4>{r.title}</h4>
      {r.lines.map((l, i) => <div className="rr" key={i} style={{ display: 'block' }}>{l}</div>)}
    </div>
  );
}

/** The big moments: a war involving you begins (both sides at a glance), or ends (the result, the cost). */
export function Splash() {
  useStore();
  const s = store.state;
  const sp = store.splash;
  if (!s || !sp) return null;
  if (sp.kind === 'war') {
    const A = s.countries[sp.a], D = s.countries[sp.d];
    if (!A || !D) return null;
    const w = s.wars.find((x) => x.attackers.includes(sp.a) && x.defenders.includes(sp.d));
    const g = s;
    const side = (ids: number[]) => ids.filter((x) => g.countries[x]?.alive);
    const atk = side(w?.attackers ?? [sp.a]), def = side(w?.defenders ?? [sp.d]);
    const sum = (ids: number[], f: (c: (typeof g.countries)[number]) => number) => ids.reduce((t, x) => t + f(g.countries[x]), 0);
    const tA = sum(atk, (c) => c.mil.troops), tD = sum(def, (c) => c.mil.troops);
    const pA = sum(atk, (c) => strength(c)), pD = sum(def, (c) => strength(c));
    const mine = sp.a === s.player ? 'attack' : 'defend';
    const odds = pA / Math.max(1, pA + pD);
    return (
      <div className="splash war" role="alert" onClick={() => store.closeSplash()}>
        <div className="splash-kicker">{mine === 'attack' ? 'You have gone to war' : 'You are under attack'}</div>
        <div className="splash-title">WAR</div>
        <div className="splash-sides">
          <div className="sd"><span className="desk-only"><Emblem c={A} size={76} /></span><i style={{ background: nationalColor(A) }} /><b>{A.name}</b><small>{atk.length > 1 ? `+${atk.length - 1} ${atk.length > 2 ? 'allies' : 'ally'}` : 'alone'}</small></div>
          <div className="vs">⚔</div>
          <div className="sd"><span className="desk-only"><Emblem c={D} size={76} /></span><i style={{ background: nationalColor(D) }} /><b>{D.name}</b><small>{def.length > 1 ? `+${def.length - 1} ${def.length > 2 ? 'allies' : 'ally'}` : 'alone'}</small></div>
        </div>
        <div className="splash-grid">
          <span>{fmtNum(tA)}</span><label>troops</label><span>{fmtNum(tD)}</span>
          <span>{fmtNum(pA)}</span><label>power</label><span>{fmtNum(pD)}</span>
          <span>{Math.round(warSupport(A) * 100)}%</span><label>war support</label><span>{Math.round(warSupport(D) * 100)}%</span>
        </div>
        <div className="splash-bar"><i style={{ width: `${odds * 100}%`, background: nationalColor(A) }} /><i style={{ width: `${(1 - odds) * 100}%`, background: nationalColor(D) }} /></div>
        <div className="splash-sub">{odds > 0.62 ? `${A.name} has the stronger hand.` : odds < 0.38 ? `${D.name} has the stronger hand.` : 'An even fight. Supply, terrain and morale will decide it.'}</div>
        <div className="btnrow" onClick={(e) => e.stopPropagation()}>
          <button className="btn primary" onClick={() => { store.closeSplash(); store.select(s.player, null, false); store.setTab('military'); }}>To the war room</button>
          <button className="btn" onClick={() => store.closeSplash()}>Continue</button>
        </div>
      </div>
    );
  }
  const r = sp.rec;
  const meA = r.a === s.player;
  const me = meA ? r.a : r.b, them = meA ? r.b : r.a;
  const won = r.winner === 'draw' ? null : (r.winner === 'a') === meA;
  const myCas = meA ? r.casA : r.casB, theirCas = meA ? r.casB : r.casA;
  const myProvs = meA ? r.provsA : r.provsB;
  const weeks = r.end - r.start;
  const terms: Record<string, string> = { status_quo: 'Ceasefire on current lines', restore: 'Pre-war borders restored', demand: 'Territory ceded', concede: 'Concessions made', surrender: 'Total surrender' };
  return (
    <div className={`splash ${won === null ? 'draw' : won ? 'win' : 'lose'}`} role="alert" onClick={() => store.closeSplash()}>
      <div className="splash-kicker">{r.name} · {terms[r.terms] ?? 'Peace'}</div>
      <div className="desk-only splash-emblems"><Emblem c={s.countries[me]} size={60} /><span>{won === null ? '🕊' : won ? '🏆' : '🏳'}</span><Emblem c={s.countries[them]} size={60} /></div>
      <div className="splash-title">{won === null ? 'PEACE' : won ? 'VICTORY' : 'DEFEAT'}</div>
      <div className="splash-sub">{won === null ? `Neither ${s.countries[me].name} nor ${s.countries[them].name} got what it wanted.` : won ? `${s.countries[them].name} has yielded.` : `${s.countries[them].name} got the better of you.`}</div>
      <div className="splash-grid">
        <span>{weeks >= 104 ? `${(weeks / 52).toFixed(1)} yrs` : `${weeks} wks`}</span><label>duration</label><span />
        <span className="bad">{fmtNum(myCas)}</span><label>casualties</label><span>{fmtNum(theirCas)}</span>
        <span className={myProvs > 0 ? 'good' : myProvs < 0 ? 'bad' : ''}>{myProvs > 0 ? '+' : ''}{myProvs}</span><label>regions</label><span>{(meA ? r.provsB : r.provsA) > 0 ? '+' : ''}{meA ? r.provsB : r.provsA}</span>
      </div>
      <div className="splash-legend"><span>you</span><span>{s.countries[them].name}</span></div>
      <div className="btnrow" onClick={(e) => e.stopPropagation()}>
        <button className="btn primary" onClick={() => { store.closeSplash(); store.openDrawer('world', 'wars'); }}>War history</button>
        <button className="btn" onClick={() => store.closeSplash()}>Continue</button>
      </div>
    </div>
  );
}
