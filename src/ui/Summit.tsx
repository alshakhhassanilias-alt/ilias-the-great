/**
 * Summits on screen: the leader card (Diplomacy tab), and the summit itself: preparation (where, what to ask for), three
 * rounds face to face with the leader answering you, the press conference, and the handshake.
 */
import { useEffect, useRef, useState } from 'react';
import { store, useStoreSelect } from '../state/store';
import { Portrait, faceFor } from './art/Portrait';
import { leaderFace } from './LookEditor';
import { Emblem } from './art/Emblem';
import { sfx } from '../audio';
import { dateLabel } from '../sim/tick';
import { traitsText } from '../sim/leaders';
import { GOAL_DESC, GOAL_LABEL, stanceOf, styleOf, type Goal } from '../sim/negotiate';
import { getTreaty, sanctionLevel } from '../sim/relations';
import { APPROACHES, PLEDGE_TEXT, PRESS, SUMMIT_PC, actSummitApproach, actSummitBegin, actSummitClose, agendaOdds, approachValue, rapportWord, summitWhy, tieOf, trustWord, type Approach, type PledgeKind, type Press, type SummitResult, type Venue } from '../sim/summit';

const meter = (v: number) => `${50 + v / 2}%`;

/** Diplomacy tab: who leads them, what they think of you personally, and the way to a summit. */
export function LeaderCard({ id }: { id: number }) {
  const s = store.state!;
  const T = s.countries[id];
  if (!T.leader) return null;
  const t = tieOf(s, id)!;
  const st = styleOf(T, s);
  const why = summitWhy(s, id);
  const invited = !!(t.invited && t.invited >= s.tick);
  const promises = (s.pledges ?? []).filter((p) => p.to === id && p.leader === t.leader);
  return (
    <section className="section leader-card">
      <h3>The person <small>{T.leader.name}, in power since {dateLabel(T.leader.since)}</small></h3>
      <div className="lc-row">
        <Portrait f={faceFor(T, T.leader.name, 'leader')} size={72} title={T.leader.name} />
        <div className="lc-body">
          <b>{T.leader.name}</b>
          <small>{traitsText(T.leader)} · negotiates as <em>{st.icon} {st.name}</em></small>
          <div className="lc-meters">
            <span>Rapport <i className="lc-m"><i style={{ left: meter(t.rapport) }} /></i><em>{rapportWord(t.rapport)}</em></span>
            <span>Trust <i className="lc-m"><i style={{ left: meter(t.trust) }} /></i><em>{trustWord(t.trust)}</em></span>
          </div>
        </div>
      </div>
      {promises.length > 0 && <ul className="lc-promises">{promises.map((p, i) => <li key={i}>✋ You promised: {PLEDGE_TEXT[p.kind].desc.toLowerCase()} · until {dateLabel(p.until)}</li>)}</ul>}
      {t.history.length > 0 && <ul className="lc-history">{[...t.history].reverse().slice(0, 4).map((h, i) => <li key={i}><small>{dateLabel(h.tick)}</small>{h.text}</li>)}</ul>}
      {s.summit?.them === id ? <button className="btn primary" onClick={() => store.openSummit(id)}>🤝 Return to the summit<small>the talks in {s.summit.city} are waiting</small></button> : (
      <button className={`btn ${invited ? 'primary' : ''}`} disabled={!!why} title={why ?? ''} onClick={() => store.openSummit(id)}>
        {invited ? '✉ Accept the invitation: a summit' : '🤝 Request a summit'}
        <small>{why ?? (invited ? 'no political capital needed · they start in a good mood' : `${SUMMIT_PC} political capital · three rounds face to face`)}</small>
      </button>)}
      <p className="faint lc-note">{st.desc}</p>
    </section>
  );
}

const GOALS: Goal[] = ['trade', 'nap', 'coop', 'alliance', 'aid', 'relief'];

export function SummitScreen({ onClose }: { onClose: () => void }) {
  useStoreSelect(() => `${store.actSeq}|${store.state?.summit?.round ?? -1}`);
  const s = store.state!;
  const geo = store.geo;
  const id = store.summitWith ?? s.summit?.them ?? -1;
  const T = s.countries[id];
  const [venue, setVenue] = useState<Venue>('theirs');
  const [agenda, setAgenda] = useState<Goal[]>([]);
  const [pledgeOpen, setPledgeOpen] = useState(false);
  const [result, setResult] = useState<SummitResult | null>(null);
  const talkRef = useRef<HTMLDivElement>(null);
  const nLines = store.state?.summit?.lines.length ?? 0;
  useEffect(() => { const el = talkRef.current; if (el) el.scrollTop = el.scrollHeight; }, [nLines]);
  if (!T?.leader) return null;
  const t = tieOf(s, id)!;
  const S = s.summit;
  const me = s.legacy?.leader ?? s.countries[s.player].leader?.name ?? 'You';
  const P = s.countries[s.player];
  const stage = (
    <div className="sm-stage">
      <div className="sm-who me"><Emblem c={P} size={34} /><Portrait f={s.legacy ? leaderFace(s) : faceFor(P, me, 'leader')} size={86} title={me} /><b>{me}</b></div>
      <div className="sm-mid">
        {S && <div className="sm-city">{S.city} · round {Math.min(3, S.round + 1)} of 3</div>}
        {S && <div className="sm-mood"><span>icy</span><i className="sm-bar"><i style={{ left: meter(S.warmth * 10) }} /></i><span>warm</span></div>}
        {!S && !result && <div className="sm-city">Preparing the summit</div>}
        {result && <div className={`sm-shake ${result.signed.length ? 'deal' : result.warmth >= 3 ? 'warm' : 'cold'}`}>{result.signed.length ? '🤝' : result.warmth >= 3 ? '🤝' : '🥶'}</div>}
      </div>
      <div className="sm-who them"><Portrait f={faceFor(T, T.leader.name, 'leader')} size={86} title={T.leader.name} /><Emblem c={T} size={34} /><b>{T.leader.name}</b></div>
    </div>
  );
  // ---- the result
  if (result) return (
    <div className="scrim sm-scrim" role="presentation"><div className="modal sm-modal" role="dialog" aria-label="Summit" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><h2>The summit with {T.name}</h2><button className="iconbtn" aria-label="Close" onClick={() => { setResult(null); onClose(); }}>✕</button></div>
      <div className="modal-body">
        {stage}
        <p className="sm-headline">{result.headline.replace(/^\S+\s/, '')}</p>
        <div className="sm-outcome">
          {result.signed.map((g) => <span key={g} className="ok">✓ {GOAL_LABEL[g]}</span>)}
          {result.failed.map((g) => <span key={g} className="no">✗ {GOAL_LABEL[g]}</span>)}
        </div>
        <p className="faint">{T.leader.name} now: {rapportWord(result.rapport)}, and {trustWord(t.trust)}. They will remember this meeting.</p>
        <button className="btn primary" onClick={() => { setResult(null); onClose(); }}>Fly home</button>
      </div>
    </div></div>
  );
  // ---- preparation
  if (!S) {
    const why = summitWhy(s, id);
    const tr = getTreaty(s, s.player, id);
    const open = GOALS.filter((g) => !(g === 'trade' && tr?.trade) && !(g === 'nap' && tr?.nap) && !(g === 'coop' && tr?.coop) && !(g === 'alliance' && tr?.alliance) && !(g === 'relief' && sanctionLevel(s, id, s.player) === 0));
    const st = styleOf(T, s);
    return (
      <div className="scrim sm-scrim" role="presentation" onClick={onClose}><div className="modal sm-modal" role="dialog" aria-label="Prepare a summit" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>A summit with {T.leader.name}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {stage}
          <p className="sm-brief">{T.leader.name} ({traitsText(T.leader)}) negotiates as <b>{st.icon} {st.name}</b>: {st.desc} You are {rapportWord(t.rapport)}{t.met ? `, and have met ${t.met} time${t.met > 1 ? 's' : ''}` : ', and have never met'}; {T.leader.name} {trustWord(t.trust)}.</p>
          <h4>Where</h4>
          <div className="sm-venues" role="radiogroup">
            {([['theirs', `Their capital`, 'Honours them: proud nations, courts and strongmen notice (+2 political capital)'], ['neutral', 'A neutral city', 'Reassures the cautious and the swing states'], ['yours', 'Your capital', 'A show of standing at home; the proud may take offence']] as [Venue, string, string][]).map(([v, n, d]) => (
              <button key={v} role="radio" aria-checked={venue === v} className={`sm-opt ${venue === v ? 'on' : ''}`} onClick={() => setVenue(v)}><b>{n}</b><small>{d}</small></button>
            ))}
          </div>
          <h4>What to ask for <small>one or two</small></h4>
          <div className="sm-agenda">
            {open.map((g) => {
              const sto = stanceOf(s, geo, id, { goal: g, give: [] });
              const on = agenda.includes(g);
              return (
                <button key={g} className={`sm-opt ${on ? 'on' : ''}`} disabled={!!sto.blocked || (!on && agenda.length >= 2)} title={sto.blocked ?? GOAL_DESC[g]} onClick={() => setAgenda(on ? agenda.filter((x) => x !== g) : [...agenda, g])}>
                  <b>{GOAL_LABEL[g]}</b><small>{sto.blocked ? `✗ ${sto.blocked}` : `at the table today: ${Math.round(sto.p * 100)}% · the talks can move it a long way`}</small>
                </button>
              );
            })}
          </div>
          <button className="btn primary sm-go" disabled={!!why || !agenda.length} title={why ?? ''} onClick={() => { const r = store.act((g) => actSummitBegin(g, id, venue, agenda)); if (r.ok) sfx('begin'); }}>
            Begin the summit<small>{why ?? (agenda.length ? 'three rounds face to face, then the press' : 'choose what to ask for')}</small>
          </button>
        </div>
      </div></div>
    );
  }
  // ---- the talks
  const odds = agendaOdds(s, geo);
  const done = S.round >= 3;
  const choose = (a: Approach, k?: PledgeKind) => { setPledgeOpen(false); const r = store.act((g) => actSummitApproach(g, a, k), true); if (r.ok) sfx(r.message.includes('warms') ? 'confirm' : 'deny'); };
  const close = (p: Press) => { const r = actSummitClose(store.state!, geo, p); store.act(() => ({ ok: r.ok, message: '' }), true); if (r.result) { setResult(r.result); sfx(r.result.signed.length ? 'fanfare' : 'stamp'); } };
  return (
    <div className="scrim sm-scrim" role="presentation"><div className="modal sm-modal" role="dialog" aria-label="Summit" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><h2>Summit in {S.city}</h2></div>
      <div className="modal-body">
        {stage}
        <div className="sm-talk" ref={talkRef}>
          {S.lines.map((l, i) => <p key={i} className={`sm-line ${l.who}`}>{l.who === 'them' ? <b>{T.leader!.name}: </b> : l.who === 'me' ? <b>You: </b> : null}{l.text}</p>)}
        </div>
        <div className="sm-odds">{odds.map((o) => <span key={o.goal}>{GOAL_LABEL[o.goal]}: <b className={o.p >= 0.6 ? 'up' : o.p < 0.35 ? 'down' : ''}>{o.blocked ? 'blocked' : `${Math.round(o.p * 100)}%`}</b></span>)}</div>
        {!done && !pledgeOpen && (
          <div className="sm-cards">
            {APPROACHES.map((a) => {
              const v = approachValue(s, a.id);
              const used = S.used.includes(a.id);
              return (
                <button key={a.id} className={`sm-card ${used ? 'used' : ''}`} onClick={() => (a.id === 'pledge' ? setPledgeOpen(true) : choose(a.id))}>
                  <span className="smc-top"><span aria-hidden>{a.icon}</span><b>{a.name}</b><em className={v.v >= 2 ? 'up' : v.v < 0.5 ? 'down' : ''}>{v.v >= 2.5 ? 'likely to land well' : v.v >= 1.2 ? 'could work' : v.v >= 0.3 ? 'a long shot' : 'likely to backfire'}</em></span>
                  <small>{a.desc}</small>
                  {(v.cost || used) && <small className="smc-cost">{used ? 'Already tried: the same move twice reads as a script.' : `Costs ${v.cost}`}</small>}
                </button>
              );
            })}
          </div>
        )}
        {!done && pledgeOpen && (
          <div className="sm-pledges">
            <h4>Give your word <small>watched every week: keep it and their trust grows; break it and they, and their friends, remember</small></h4>
            {(Object.keys(PLEDGE_TEXT) as PledgeKind[]).map((k) => <button key={k} className="sm-opt" disabled={S.pledges.includes(k)} onClick={() => choose('pledge', k)}><b>"{PLEDGE_TEXT[k].say}"</b><small>{PLEDGE_TEXT[k].desc}</small></button>)}
            <button className="linkbtn" onClick={() => setPledgeOpen(false)}>Back</button>
          </div>
        )}
        {done && (
          <div className="sm-press">
            <h4>The press conference <small>what you tell the cameras</small></h4>
            {PRESS.map((p) => <button key={p.id} className="sm-opt" onClick={() => close(p.id)}><b>"{p.say}"</b><small>{p.name}: {p.desc}</small></button>)}
          </div>
        )}
      </div>
    </div></div>
  );
}
