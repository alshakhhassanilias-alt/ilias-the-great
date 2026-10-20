/**
 * The negotiating table: what the other side wants, its red lines, your leverage, the terms you can add, the odds
 * with every factor behind them, and the answer (yes, a counteroffer, or no, with reasons).
 */
import { useEffect, useState } from 'react';
import { store, useStore } from '../state/store';
import { GOAL_DESC, GOAL_LABEL, negotiate, openingLine, stanceOf, TERM_LABEL, walkAway, type Goal, type NegoResult, type Term } from '../sim/negotiate';
import { previewReactions } from '../sim/politics';
import { getRelation, getTreaty, sanctionLevel, areAtWar } from '../sim/relations';
import { traitsText } from '../sim/leaders';
import { fmtMoney } from './format';
import { Portrait, faceFor } from './art/Portrait';
import { Emblem } from './art/Emblem';
import type { Proposal } from '../sim/diplomacy';

const GOALS: Goal[] = ['trade', 'nap', 'coop', 'alliance', 'aid', 'relief'];
const oddsWord = (p: number) => (p >= 0.8 ? 'very likely' : p >= 0.6 ? 'likely' : p >= 0.4 ? 'a coin toss' : p >= 0.2 ? 'unlikely' : 'a long shot');

export function NegotiationTable() {
  useStore();
  const s = store.state;
  const n = store.nego;
  const [give, setGive] = useState<Term[]>([]);
  const [res, setRes] = useState<NegoResult | null>(null);
  useEffect(() => { setGive([]); setRes(null); }, [n?.them, n?.goal]);
  useEffect(() => { store.hold('the negotiation', !!n); return () => store.hold('the negotiation', false); }, [n]);
  if (!s || !n) return null;
  const T = s.countries[n.them], P = s.countries[s.player];
  const goal = n.goal;
  const st = stanceOf(s, store.geo, n.them, { goal, give });
  const rel = getRelation(s, n.them, s.player);
  const tr = getTreaty(s, n.them, s.player);
  const close = () => { store.nego = null; store.notify(); };
  const setGoal = (g: Goal) => { store.nego = { them: n.them, goal: g }; store.notify(); };
  const toggle = (k: Term) => setGive((g) => (g.includes(k) ? g.filter((x) => x !== k) : [...g.filter((x) => !(k.startsWith('cash') && x.startsWith('cash'))), k]));
  const offer = (counter = false) => {
    const terms = counter && st.counter ? (st.counter as Term[]) : give;
    const r = store.act((g) => negotiate(g, store.geo, n.them, { goal, give: terms }, counter), true);
    setRes(r);
    if (r.outcome === 'counter' && r.counter) setGive(r.counter);
    store.toast(r.message, r.ok ? 'diplo' : r.outcome === 'counter' ? 'info' : 'danger');
  };
  const rx = goal !== 'aid' && goal !== 'relief' ? previewReactions(s, s.player, n.them, goal as Proposal) : [];
  const neg = rx.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3), pos = rx.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const has = (g: Goal) => (g === 'aid' ? false : g === 'relief' ? sanctionLevel(s, n.them, s.player) === 0 : !!tr?.[g as Proposal]);
  const pct = Math.round(st.p * 100);
  const sorted = [...st.factors].sort((a, b) => b.pts - a.pts);
  return (
    <div className="scrim" role="presentation" onClick={close}>
      <div className="modal nego" role="dialog" aria-label={`Negotiate with ${T.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>The negotiating table</h2><button className="iconbtn" aria-label="Close" onClick={close}>✕</button></div>
        <div className="modal-body">
          <div className="nego-head">
            {T.leader ? <Portrait f={faceFor(T, T.leader.name, 'leader')} size={64} title={T.leader.name} /> : <Emblem c={T} size={56} />}
            <div className="grow">
              <b>{T.leader?.name ?? T.name}</b>
              <small>{T.name}{T.leader ? ` · ${traitsText(T.leader)}` : ''}</small>
              <small>Relations <b className={rel >= 0 ? 'good' : 'bad'}>{rel >= 0 ? '+' : ''}{rel.toFixed(0)}</b> · patience {'●'.repeat(Math.max(0, st.patience))}{'○'.repeat(Math.max(0, st.style.patience - st.patience))}{st.detente ? ' · 🕊 détente' : ''}</small>
            </div>
            <div className="nego-style" title={st.style.desc}><span>{st.style.icon}</span><b>{st.style.name}</b></div>
          </div>
          <div className="nego-quote">“{openingLine(s, T, st, rel)}”<small>{st.style.desc}</small></div>

          <div className="nego-goals" role="tablist" aria-label="What you want">
            {GOALS.map((g) => (
              <button key={g} role="tab" aria-selected={g === goal} className={`nego-chip ${g === goal ? 'on' : ''}`} disabled={areAtWar(s, n.them, s.player) || has(g)} onClick={() => setGoal(g)}>
                {GOAL_LABEL[g]}{has(g) && g !== 'relief' ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <p className="nego-desc">{GOAL_DESC[goal]}</p>

          <div className="nego-grid">
            <div>
              <h4>What {T.name} wants</h4>
              {st.interests.length === 0 && <div className="faint">Nothing in particular.</div>}
              {st.interests.slice(0, 5).map((i) => <div className="nego-want" key={i.key}><span>{i.label}</span><i style={{ width: `${Math.round(i.w * 100)}%` }} /></div>)}
              <h4>Red lines</h4>
              {st.redLines.length ? <ul className="nego-list bad">{st.redLines.map((r) => <li key={r}>{r}</li>)}</ul> : <div className="faint">None that matter here.</div>}
              <h4>Your leverage</h4>
              {st.leverage.length ? <ul className="nego-list">{st.leverage.map((l) => <li key={l.label}>{l.label}{l.pts ? ` (+${l.pts})` : ''}</li>)}</ul> : <div className="faint">Little: they do not need you.</div>}
            </div>
            <div>
              <h4>Your offer</h4>
              {st.available.map((k) => (
                <label key={k} className="check nego-term">
                  <input type="checkbox" checked={give.includes(k)} onChange={() => toggle(k)} />
                  <span><b>{TERM_LABEL[k]}</b><small>worth +{st.termValue[k] ?? 0} to them{k.startsWith('cash') ? ` · ${fmtMoney((k === 'cash1' ? 0.001 : k === 'cash3' ? 0.003 : 0.006) * P.eco.gdp)}` : ''}{(st.style.mult[k.startsWith('cash') ? 'cash' : k] ?? 1) >= 1.3 ? ' · ★ their style values this' : (st.style.mult[k.startsWith('cash') ? 'cash' : k] ?? 1) <= 0.7 ? ' · their style dislikes this' : ''}</small></span>
                </label>
              ))}
              <div className={`nego-odds ${st.blocked ? 'blocked' : st.p >= 0.6 ? 'good' : st.p >= 0.35 ? 'mid' : 'bad'}`}>
                {st.blocked ? <><b>Refused outright</b><small>{st.blocked}</small></> : <><b>{pct}%</b><small>chance they accept · {oddsWord(st.p)}</small></>}
                <div className="nego-meter"><i style={{ width: `${st.blocked ? 0 : pct}%` }} /></div>
              </div>
              <ul className="nego-factors">
                {sorted.map((f, i) => <li key={i}><span>{f.label}</span><b className={f.pts > 0 ? 'good' : f.pts < 0 ? 'bad' : ''}>{f.pts > 0 ? '+' : ''}{f.pts}</b></li>)}
              </ul>
              {st.costs.length > 0 && <div className="nego-costs"><b>It costs you:</b> {st.costs.join(' · ')}</div>}
              {(neg.length > 0 || pos.length > 0) && <div className="nego-costs"><b>World reaction:</b> {neg.map((r) => <span key={r.id} className="bad">{s.countries[r.id].name} {r.delta.toFixed(0)} </span>)}{pos.map((r) => <span key={r.id} className="good">{s.countries[r.id].name} +{r.delta.toFixed(0)} </span>)}</div>}
            </div>
          </div>

          {res && <div className={`nego-result ${res.ok ? 'good' : res.outcome === 'counter' ? 'mid' : 'bad'}`}><b>{res.message}</b>{res.why.length > 0 && <small>Why: {res.why.join(' · ')}</small>}</div>}
          {st.counter && !res?.ok && (
            <div className="nego-counter">They proposed: <b>{GOAL_LABEL[goal]}</b> if you add {(st.counter as Term[]).map((k) => TERM_LABEL[k].toLowerCase()).join(' and ')}. Accepting their own counteroffer is certain.</div>
          )}
          <div className="btnrow nego-actions">
            {st.counter && !res?.ok && <button className="btn good" onClick={() => offer(true)}>Accept their counteroffer</button>}
            <button className="btn primary" disabled={!!st.blocked || st.patience <= 0 || !!res?.ok} onClick={() => offer(false)}>Make the offer<small>{st.blocked ? 'blocked' : `${pct}% · a refusal costs patience and relations −1`}</small></button>
            <button className="btn" onClick={() => { store.mutate((g) => walkAway(g, n.them)); close(); }}>Walk away<small>no cost</small></button>
          </div>
        </div>
      </div>
    </div>
  );
}
