import { extrasText } from '../sim/peaceterms';
import { previewLapse } from '../sim/events';
import { FOLLOW_UPS } from '../sim/events7';
import { costHint, hintCost } from '../sim/eventkit';
import { balanceText, budgetReport, fundingText } from '../sim/treasury';
import { fmtMoney as fmtM, pct } from './format';
import type { Country } from '../sim/types';
import { store, useStore } from '../state/store';
import { actAcceptOffer, actDeclineOffer } from '../sim/actions';
import { PROPOSAL_LABEL, type Proposal } from '../sim/diplomacy';
import { actResolveEvent } from '../sim/actions';
import { eventById } from '../sim/events';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { dateLabel } from '../sim/tick';
import { nationalColor } from '../map/palette';
import { Emblem } from './art/Emblem';
import { strength } from '../sim/military';
import { warSupport } from '../sim/warsupport';
import { fmtNum } from './format';
import { Portrait, faceFor } from './art/Portrait';
import { previewReactions } from '../sim/politics';
import { actReplyCable } from '../sim/cables';
import { traitsText } from '../sim/leaders';
import { adviceOf, presenterOf, roleTitle } from '../sim/cabinet';
import { isMajor } from '../sim/drama';
import { placeLabel } from '../sim/places';
import { storyChip } from '../sim/story';
import type { GameState, InboxItem } from '../sim/types';

const DOMESTIC = new Set(['strike', 'disaster', 'quake', 'flood', 'refugees', 'separatists', 'pandemic', 'housing', 'harvest', 'famine', 'oil_province', 'deposit', 'mutiny', 'cyber_blackout', 'olympics', 'world_cup', 'bank_run', 'brain_drain', 'investment', 'tech_giant', 'free_zone', 'coup_plot', 'coup', 'scandal', 'pension', 'green_transition']);
/** Where a domestic event is happening: the region it names, or one of yours picked for it. */
function placeOf(s: GameState, it: InboxItem): string | null {
  const geo = store.geo;
  const p = it.data?.p;
  if (typeof p === 'number' && p >= 0 && geo.provinces[p]) return placeLabel(p);
  if (!DOMESTIC.has(it.id)) return null;
  const mine = s.countries[s.player].provinces;
  if (!mine.length) return null;
  // big cities are where strikes, crashes and riots happen; disasters can strike anywhere
  const pool = /quake|flood|harvest|famine|disaster|deposit|oil_province/.test(it.id) ? mine : [...mine].sort((a, b) => geo.provinces[b].w - geo.provinces[a].w).slice(0, 4);
  return placeLabel(pool[(it.uid * 7) % pool.length]);
}

export function Toasts() {
  useStore();
  return (
    <div className="toasts" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${/^(Objective complete|🤝 THE |🏆)/.test(t.text) ? ' toast-win' : ''}`} role="status" onClick={() => store.dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

const KIND_GIVES: Record<string, string[]> = {
  trade: ['Both economies grow: more exports, cheaper imports', 'Relations +6 now, and they keep improving'],
  nap: ['Neither of you may attack the other without a heavy reputation penalty', 'Relations +6'],
  alliance: ['Mutual defence: if either of you is attacked, the other is called to war', 'Relations +12 · their rivals will dislike you'],
  coop: ['Joint exercises and technology sharing', 'Relations +6 · a step toward an alliance'],
};
export function Offers() {
  useStore();
  const s = store.state!;
  return (
    <div className="offers">
      <CableCard />
      {s.offers.slice(0, 2).map((o) => <OfferCard key={o.id} o={o} />)}
    </div>
  );
}

function OfferCard({ o }: { o: GameState['offers'][number] }) {
  const s = store.state!;
  const C = s.countries[o.from];
  const quote = (s.cables ?? []).filter((x) => x.from === o.from).slice(-1)[0];
  // who would react, and how: recomputed monthly, not on every repaint
  const react = useMemo(() => (o.kind !== 'peace' ? previewReactions(s, o.from, s.player, o.kind).filter((x) => x.id !== s.player).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3) : []), [o.id, o.kind, s.tick >> 2]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="offer" role="alert">
      <div className="offer-top">
        {C.leader && <Portrait f={faceFor(C, C.leader.name, 'leader')} size={52} title={C.leader.name} />}
        <div className="grow">
          <small className="faint">{C.leader ? `${C.leader.name} · ${C.name}` : C.name}</small>
          <div><b>{o.kind === 'peace' ? `Offers peace: ${({ status_quo: 'ceasefire on current lines', restore: 'pre-war borders', demand: 'they want territory', concede: 'they give concessions', surrender: 'their surrender' } as Record<string, string>)[o.terms?.kind ?? ''] ?? o.terms?.kind}${o.terms?.extras?.length ? `, plus ${extrasText(o.terms.extras)}` : ''}` : `Proposes a ${PROPOSAL_LABEL[o.kind as Proposal].toLowerCase()}`}</b></div>
        </div>
      </div>
      {quote && s.tick - quote.tick < 30 && <div className="offer-quote">“{quote.text}”</div>}
      {o.kind !== 'peace' && <ul className="offer-gives">{(KIND_GIVES[o.kind] ?? []).map((g, i) => <li key={i}>{g}</li>)}</ul>}
      {react.length > 0 && <div className="offer-react">{react.map((r) => <span key={r.id} className={r.delta < 0 ? 'bad' : 'good'}>{s.countries[r.id]?.name} {r.delta > 0 ? '+' : ''}{r.delta.toFixed(0)}</span>)}</div>}
      <div className="btnrow">
        <button className="btn good" onClick={() => store.act((g) => actAcceptOffer(g, store.geo, o.id))}>Accept</button>
        <button className="btn" onClick={() => store.act((g) => actDeclineOffer(g, o.id), true)}>Decline</button>
      </div>
    </div>
  );
}

/** the newest unread message, unless it is the covering note of an offer (the offer card already quotes it) */
const cableNow = (s: GameState) => [...(s.cables ?? [])].reverse().find((x) => x.seq > store.cableSeen && s.tick - x.tick < 10 && !s.offers.some((o) => o.from === x.from && o.tick === x.tick));
const rippleNow = (s: GameState) => { const r = s.lastRipple; return r && (r.a === s.player || r.b === s.player) && store.rippleSeen !== `${r.tick}:${r.a}:${r.b}:${r.kind}` && s.tick - r.tick <= 26; };
const reviewNow = (s: GameState) => !!s.review && store.reviewSeen < s.review.tick && s.tick - s.review.tick <= 30;

/**
 * Desktop: every notice that is not a decision (offers, cables, how the world reacted, the year in review) in one
 * column on the right, most actionable first. Two are shown; the rest wait behind "+N more", so fast play never
 * buries the map or the decision tray.
 */
export function NotesColumn() {
  useStore();
  const s = store.state!;
  const [all, setAll] = useState(false);
  const cards: { key: string; el: ReactElement }[] = [
    ...s.offers.map((o) => ({ key: `o${o.id}`, el: <OfferCard o={o} /> })),
    ...(cableNow(s) ? [{ key: 'cable', el: <CableCard /> }] : []),
    ...(rippleNow(s) ? [{ key: 'ripple', el: <RippleCard /> }] : []),
    ...(reviewNow(s) ? [{ key: 'review', el: <YearReview /> }] : []),
  ];
  if (!cards.length) return null;
  const shown = all ? cards : cards.slice(0, 2);
  return (
    <div className="notes-col" role="region" aria-label="Notices">
      {shown.map((x) => <div key={x.key} className="note-slot">{x.el}</div>)}
      {cards.length > 2 && <button className="notes-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+${cards.length - 2} more notice${cards.length > 3 ? 's' : ''}`}</button>}
    </div>
  );
}

/** A message from a foreign leader. Reply warmly or firmly, or ignore it. */
export function CableCard() {
  useStore();
  const s = store.state;
  if (!s?.cables?.length) return null;
  const cb = cableNow(s);
  if (!cb) return null;
  const C = s.countries[cb.from];
  const close = () => { store.cableSeen = cb.seq; store.notify(); };
  return (
    <div className={`cable mood-${cb.mood}`} role="status" aria-live="polite">
      <button className="x" aria-label="Dismiss" onClick={close}>×</button>
      <div className="cable-head">
        {C.leader ? <Portrait f={faceFor(C, C.leader.name, 'leader')} size={58} title={C.leader.name} /> : <Emblem c={C} size={50} />}
        <div>
          <small>📨 Diplomatic cable · {dateLabel(cb.tick)}</small>
          <b>{C.leader?.name ?? C.name}</b>
          <span className="faint">{C.gov === 'M' ? 'Monarch' : C.gov === 'D' || C.gov === 'F' ? 'Head of government' : 'Ruler'} of {C.name}{C.leader ? ` · ${traitsText(C.leader)}` : ''}</span>
        </div>
      </div>
      <p className="cable-text">“{cb.text}”</p>
      <div className="btnrow">
        <button className="btn" onClick={() => { store.act((g) => actReplyCable(g, cb.seq, 'warm')); close(); }}>Reply warmly <small>relations +4</small></button>
        <button className="btn" onClick={() => { store.act((g) => actReplyCable(g, cb.seq, 'firm')); close(); }}>Reply firmly <small>stability +1 · relations −4</small></button>
      </div>
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

const lapseMemo = new Map<string, { text: string; fx: string[] }>();
function lapseOf(uid: number) {
  const s = store.state!, key = `${uid}:${s.tick}`;
  let v = lapseMemo.get(key);
  if (!v) { v = previewLapse(s, store.geo, uid); lapseMemo.clear(); lapseMemo.set(key, v); }
  return v;
}
/** "Costs 0.5% of GDP" → where the money would come from */
function optionFunding(c: Country, hint: string) {
  const cost = hintCost(c, hint);
  if (cost) return `one-off: ${fundingText(c, cost)}`;
  // a lasting budget change: say it is per year and what it does to the balance
  const r = /(spending|budget|Revenue)[^·]*?([+−-])([\d.]+)% of GDP/i.exec(hint);
  if (r) {
    const s = store.state!, amt = (Number(r[3]) / 100) * c.eco.gdp * (r[2] === '+' ? 1 : -1);
    const bal = budgetReport(s, c).balance + (/revenue/i.test(r[1]) ? amt : -amt);
    return `every year: ${amt > 0 ? '+' : '−'}${fmtM(Math.abs(amt))} ${/revenue/i.test(r[1]) ? 'revenue' : 'spending'} → ${balanceText(bal)}`;
  }
  const d = /Debt \+([\d.]+)% of GDP/.exec(hint);
  return d ? `adds ${fmtM((Number(d[1]) / 100) * c.eco.gdp)} to debt (${pct((c.eco.debt + (Number(d[1]) / 100) * c.eco.gdp) / c.eco.gdp)} of GDP), with interest every year` : null;
}

/** Decisions wait here, most urgent first. While one is open the clock holds (unless switched off in the menu). */
export function InboxTray() {
  useStore();
  const s = store.state;
  if (!s || !s.inbox.length) return null;
  const c = s.countries[s.player];
  const items = [...s.inbox].sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.expires - b.expires);
  return (
    <div className="inbox" role="region" aria-label="Decisions waiting">
      {items.length > 1 && <div className="inbox-head">{items.length} decisions waiting · most urgent first</div>}
      {items.map((it) => {
        const def = eventById(it.id);
        const open = store.inboxOpen === it.uid;
        const left = Math.max(0, it.expires - s.tick);
        const total = Math.max(1, it.expires - it.tick);
        return (
          <div key={it.uid} className={`inbox-item ${it.urgent ? 'urgent' : ''} ${open ? 'open' : ''}`}>
            <button className="inbox-row" aria-expanded={open} onClick={() => store.openInbox(open ? null : it.uid)}>
              <span className="inbox-icon" aria-hidden="true">{def.icon}</span>
              <span className="inbox-title"><b>{def.title}</b><small className={left <= 3 ? 'soon' : ''}>{it.urgent ? 'Urgent · ' : ''}{left <= 0 ? 'lapses now' : `${left} wk left · lapses ${dateLabel(it.expires)}`}</small></span>
              <span className="inbox-go">{open ? '▾' : 'Decide'}</span>
              <i className="inbox-bar" style={{ width: `${(100 * left) / total}%` }} />
            </button>
            {open && (() => {
              const who = presenterOf(s, it.id, it.data);
              const sp = def.speaker?.(s, c, it.data) ?? null;
              const en = def.options.map((o) => !o.enabled || o.enabled(s, c));
              const adv = who && !it.id.startsWith('min_') ? adviceOf(who, def.options, en, c) : null;
              const place = placeOf(s, it);
              const spC = sp ? s.countries[sp.cid] : c;
              return (
              <div className="inbox-body">
                {(() => { const f = FOLLOW_UPS.find((x) => x.next === it.id); return f && it.data.t !== undefined ? <div className="arc-chip conseq">↩ A consequence of how you handled “{eventById(f.after).title}” ({dateLabel(it.data.t)})</div> : null; })()}
                {it.id.startsWith('story') && c.story && <div className="arc-chip story-chip">📖 {storyChip(c)}<span className="arc-steps">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= c.story!.act ? 'on' : ''} />)}</span></div>}
                {def.arc && <div className="arc-chip">⚠ {def.arc.title} · stage {def.arc.stage} of {def.arc.of}<span className="arc-steps">{Array.from({ length: def.arc.of }, (_, i) => <i key={i} className={i < def.arc!.stage ? 'on' : ''} />)}</span></div>}
                {(sp || who) && (
                  <div className="presenter">
                    <Portrait f={faceFor(spC, sp ? sp.name : who!.name, sp ? sp.kind : 'minister')} size={46} title={sp ? sp.name : who!.name} />
                    <div><small>{sp && sp.cid !== s.player ? 'A message from' : it.id === 'min_scandal' || it.id === 'min_revolt' ? 'About' : sp ? 'From' : 'On your desk from'}</small><b>{sp ? sp.name : who!.name}</b><span className="faint">{sp ? sp.role : roleTitle(who!.role)}</span></div>
                    {place && <span className="place-chip" title="Where it is happening">📍 {place}</span>}
                  </div>
                )}
                <p className="event-text">{def.text(s, c, it.data)}</p>
                {adv && <div className="advice-line">💬 <b>{who!.name.split(' ')[0]}</b> recommends <i>{def.options[adv.idx].label}</i>: {adv.why}.</div>}
                <div className="event-options">
                  {def.options.map((o, i) => {
                    const ok = en[i];
                    return (
                      <button key={i} className={`btn event-opt ${i === 0 ? 'primary' : ''} ${adv?.idx === i ? 'advised' : ''}`} disabled={!ok}
                        onClick={() => { store.act((g) => actResolveEvent(g, store.geo, i, it.uid)); store.inboxOpen = null; store.notify(); }}>
                        {o.label}<small>{ok ? costHint(c, o.hint) : (o.why?.(s, c) ?? 'Cannot afford this')}</small>{ok && optionFunding(c, o.hint) && <small className="opt-fund">💰 {optionFunding(c, o.hint)}</small>}
                      </button>
                    );
                  })}
                </div>
                {(() => { const lp = lapseOf(it.uid); return <div className="lapse-line"><b>If you let it lapse ({dateLabel(it.expires)}):</b> {lp.text}{lp.fx.length > 0 && <span className="lapse-fx"> {lp.fx.join(' · ')}</span>}</div>; })()}
                <button className="linkbtn" onClick={() => store.openInbox(null)}>Decide later{store.holdWhileReading ? ' (the clock is held while this is open)' : ' (the game keeps running)'}</button>
              </div>
              );
            })()}
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
  const items = s.log.filter((e) => e.countries.includes(s.player) || e.big || e.important || ((e.kind === 'war' || e.kind === 'territory' || e.kind === 'peace') && e.countries.some((x) => isMajor(s, x)))).slice(-8).reverse();
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
          <div className="sd"><span className="desk-only splash-faces"><Emblem c={A} size={76} />{(() => { const n = A.id === s.player ? s.legacy?.leader : A.leader?.name; return n ? <Portrait f={faceFor(A, n, 'leader')} size={64} title={n} /> : null; })()}</span><i style={{ background: nationalColor(A) }} /><b>{A.name}</b><small>{atk.length > 1 ? `+${atk.length - 1} ${atk.length > 2 ? 'allies' : 'ally'}` : 'alone'}</small></div>
          <div className="vs">⚔</div>
          <div className="sd"><span className="desk-only splash-faces">{(() => { const n = D.id === s.player ? s.legacy?.leader : D.leader?.name; return n ? <Portrait f={faceFor(D, n, 'leader')} size={64} title={n} /> : null; })()}<Emblem c={D} size={76} /></span><i style={{ background: nationalColor(D) }} /><b>{D.name}</b><small>{def.length > 1 ? `+${def.length - 1} ${def.length > 2 ? 'allies' : 'ally'}` : 'alone'}</small></div>
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
