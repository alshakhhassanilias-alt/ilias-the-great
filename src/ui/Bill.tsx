/**
 * The bill on screen: a banner over the map while a law is being fought through parliament (or the inner circle), the
 * whip's room (the headcount, every faction's benches, the moves with what each would do before you make it, the
 * opposition's work), and vote night: the roll call, faction by faction, and the verdict.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { store, useStoreSelect } from '../state/store';
import { factionMeta, lawById, leanOf, moodLabel, moodColor } from '../sim/domestic';
import { MOVE_META, actBillMove, actCallVote, actWithdrawBill, activeBill, chamberName, headcount, moveCheck, passOdds, previewMove, wantOf, type Bill, type BillMove } from '../sim/bill';
import { dateLabel } from '../sim/tick';
import { fmtMoney } from './format';
import { Portrait, faceFor } from './art/Portrait';
import { sfx } from '../audio';
import type { FactionId } from '../sim/types';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function BillBanner() {
  const key = useStoreSelect(() => { const s = store.state; const b = s && !store.preview ? activeBill(s) : undefined; return b ? `${s!.tick}|${b.moves}|${Math.round(headcount(s!, b).yes)}|${store.actSeq}` : ''; });
  if (!key) return null;
  const s = store.state!, b = activeBill(s)!;
  const h = headcount(s, b);
  const law = lawById(b.law)!;
  const ahead = h.yes >= h.need;
  return (
    <button className={`bill-banner ${b.moves > 0 ? 'ready' : ''} ${ahead ? 'ahead' : 'behind'}`} onClick={() => store.openDrawer('bill')}>
      <span className="bb-k">{law.icon} {law.title}</span>
      <span className="bb-count"><b>{Math.round(h.yes)}</b><small>/ {h.need} needed</small></span>
      <span className="bb-when">vote in {Math.max(0, b.vote - s.tick)} wk</span>
      <span className="cb-days">{Array.from({ length: 2 }, (_, i) => <i key={i} className={i < b.moves ? 'on' : ''} />)}</span>
      <span className="cb-go">Whip's room ›</span>
    </button>
  );
}

/** The chamber in a half circle: every member, coloured by faction, bright if they vote (or lean) yes. */
function Chamber({ b, yesBy, lit }: { b: Bill; yesBy: Partial<Record<FactionId, number>>; lit?: number }) {
  const total = Object.values(b.seats).reduce((t, v) => t + (v ?? 0), 0);
  const rows = total > 200 ? 9 : 5;
  const radii = Array.from({ length: rows }, (_, r) => 40 + r * (rows > 5 ? 6.6 : 11));
  const tot = radii.reduce((t, r) => t + r, 0);
  const pts: { x: number; y: number; a: number }[] = [];
  let made = 0;
  radii.forEach((r, ri) => {
    const n = ri === rows - 1 ? total - made : Math.round((total * r) / tot);
    made += n;
    for (let i = 0; i < n; i++) { const a = Math.PI - (Math.PI * (i + 0.5)) / n; pts.push({ x: 100 + r * Math.cos(a), y: 104 - r * Math.sin(a), a }); }
  });
  pts.sort((p, q) => q.a - p.a);
  const order: FactionId[] = ['labour', 'liberals', 'regions', 'business', 'nationalists', 'military'];
  const out: ReactElement[] = [];
  let k = 0;
  const rad = rows > 5 ? 2.2 : 3.6;
  for (const id of order) {
    const n = b.seats[id] ?? 0;
    const yes = Math.round(yesBy[id] ?? 0);
    for (let i = 0; i < n && k < pts.length; i++, k++) {
      const p = pts[k], on = i < yes && (lit === undefined || k < lit);
      out.push(<circle key={k} cx={p.x} cy={p.y} r={rad} fill={on ? factionMeta(id).color : 'rgba(30,24,22,.92)'} stroke={on ? 'rgba(0,0,0,.35)' : factionMeta(id).color} strokeWidth={on ? 0.4 : 0.7} />);
    }
  }
  return <svg className="bill-chamber" viewBox="0 0 200 108" role="img" aria-label={chamberName(b)}>{out}<line x1="100" y1="30" x2="100" y2="106" stroke="rgba(255,255,255,.22)" strokeDasharray="2 3" /></svg>;
}

export function BillRoom({ onClose }: { onClose: () => void }) {
  useStoreSelect(() => { const s = store.state, b = s?.countries[s.player]?.politics?.bill; return `${s?.tick}|${b?.status}|${b?.moves}|${b?.beats.length}|${store.actSeq}`; });
  const s = store.state!;
  const c = s.countries[s.player];
  const P = c.politics;
  const b = P?.bill;
  const [sel, setSel] = useState<FactionId | null>(null);
  const head = (t: string) => <div className="modal-head"><h2>{t}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>;
  if (!P || !b) return <div className="scrim" role="presentation" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>{head('📜 The whip\'s room')}<div className="modal-body"><p className="muted">No bill is before parliament. Pick a law in Politics → Laws and introduce it.</p></div></div></div>;
  if (b.status !== 'open') return <VoteNight b={b} onClose={() => { b.seen = true; onClose(); }} />;
  const law = lawById(b.law)!;
  const h = headcount(s, b);
  const odds = passOdds(s, b);
  const weeks = Math.max(0, b.vote - s.tick);
  const go = (m: BillMove, f?: FactionId) => { const r = store.act((g) => actBillMove(g, m, f)); if (r.ok) sfx(m === 'twist' ? 'drums' : 'stamp'); };
  const gain = (m: BillMove, f?: FactionId) => { const pv = previewMove(s, b, m, f); const d = Math.round(pv.after - pv.before); return d; };
  const btn = (m: BillMove, f?: FactionId) => {
    const ch = moveCheck(s, b, m, f);
    const d = ch.ok ? gain(m, f) : 0;
    const price = [ch.pc ? `${ch.pc} capital` : '', ch.cash ? fmtMoney(ch.cash) : '', m === 'deal' ? 'a favour owed' : '', ch.risk !== undefined ? `${pct(ch.risk)} it leaks` : ''].filter(Boolean).join(' · ');
    return (
      <button key={m} className={`bill-move ${ch.ok ? '' : 'off'}`} disabled={!ch.ok} title={MOVE_META[m].desc} onClick={() => go(m, f)}>
        <span className="bm-top"><span aria-hidden>{MOVE_META[m].icon}</span><b>{MOVE_META[m].name}</b>{ch.ok && m !== 'delay' && <em className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d >= 0 ? '+' : ''}{d}</em>}</span>
        <small>{ch.ok ? (price || 'free') : ch.why}</small>
      </button>
    );
  };
  const S = sel && (b.seats[sel] ?? 0) > 0 ? sel : null;
  const opp = b.chamber === 'circle' ? 'the hardliners' : 'the opposition';
  return (
    <div className="scrim bill-scrim" role="presentation" onClick={onClose}>
      <div className="modal bill-modal" role="dialog" aria-label="The whip's room" onClick={(e) => e.stopPropagation()}>
        {head(`📜 The ${law.title}`)}
        <div className="modal-body">
          <div className="bill-top">
            <div className="bt-count">
              <div className="bt-num"><b className={h.yes >= h.need ? 'up' : 'down'}>{Math.round(h.yes)}</b><span>for</span><b className="foe">{Math.round(h.no)}</b><span>against</span></div>
              <div className="bt-bar"><i style={{ width: pct(h.yes / h.total) }} /><u style={{ left: pct(h.need / h.total) }} /></div>
              <div className="bt-meta faint">{h.need} needed of {h.total} · {chamberName(b)} · vote {weeks ? `in ${weeks} week${weeks > 1 ? 's' : ''} (${dateLabel(b.vote)})` : 'this week'} · as things stand <b className={odds >= 0.5 ? 'up' : 'down'}>{pct(odds)}</b> it passes</div>
            </div>
            <div className="bt-foe"><Portrait f={faceFor(c, b.foe, 'leader')} size={48} title={b.foe} /><div><small>Against it</small><b>{b.foe}</b><span className="faint">leads {opp}</span></div></div>
          </div>
          <Chamber b={b} yesBy={Object.fromEntries(h.by.map((x) => [x.f, x.yes]))} />
          <div className="bill-moves-left">Moves this week {Array.from({ length: 2 }, (_, i) => <i key={i} className={`pip ${i < b.moves ? 'on' : ''}`} />)}<span className="faint">{b.moves ? 'one more comes each week' : 'next week brings another'}</span></div>

          <h4>The benches <small>pick a faction to work on</small></h4>
          <div className="bill-facs">
            {h.by.map((x) => {
              const F = P.factions.find((y) => y.id === x.f)!;
              const lean = leanOf(law, x.f, b);
              const iou = P.ious?.find((i) => i.f === x.f);
              const partner = P.gov?.partners.includes(x.f);
              return (
                <button key={x.f} className={`bill-fac ${S === x.f ? 'on' : ''}`} style={{ ['--fc' as string]: factionMeta(x.f).color }} onClick={() => { setSel(x.f); sfx('select'); }}>
                  <Portrait f={faceFor(c, F.leader, x.f === 'military' ? 'general' : 'minister')} size={36} title={F.leader} />
                  <span className="bf-main"><b>{factionMeta(x.f).short}</b><small>{F.leader} · {x.seats} seats{partner ? ' · in government' : ''}{iou ? ' · owed a favour' : ''}</small></span>
                  <span className="bf-lean"><em className={lean > 0 ? 'up' : lean < 0 ? 'down' : ''}>{lean > 0 ? 'likes it' : lean < 0 ? 'hates it' : 'indifferent'}</em><small style={{ color: moodColor(F.mood) }}>{moodLabel(F.mood)}</small></span>
                  <span className="bf-bar"><i style={{ width: pct(x.p) }} /><u /></span>
                  <span className={`bf-num ${x.p >= 0.5 ? 'up' : 'down'}`}>{Math.round(x.yes)}<small>/{x.seats}</small></span>
                </button>
              );
            })}
          </div>
          {S && (
            <div className="bill-row">
              <div className="bill-row-k">Work on the {factionMeta(S).short}{(() => { const w = wantOf(c, S, b.law); return w ? <small>a deal will be repaid with a law they want, like the {w.title}</small> : <small>there is no law left they want: no deal is possible</small>; })()}</div>
              <div className="bill-move-grid">{(['whip', 'sweeten', 'deal', 'twist'] as BillMove[]).map((m) => btn(m, S))}</div>
            </div>
          )}
          <div className="bill-row">
            <div className="bill-row-k">The bill itself</div>
            <div className="bill-move-grid">{(['water', 'sunset', 'public', 'delay'] as BillMove[]).map((m) => btn(m))}</div>
          </div>
          {(P.ious?.length ?? 0) > 0 && <div className="bill-ious faint">Favours owed: {P.ious!.map((i) => `${factionMeta(i.f).short} (by ${dateLabel(i.due)}${i.want ? `, e.g. the ${lawById(i.want)?.title}` : ''})`).join(' · ')}</div>}
          <ul className="bill-beats">{[...b.beats].reverse().slice(0, 8).map((x, i) => <li key={i} className={x.tone}><small>{dateLabel(x.tick)}</small>{x.text}</li>)}</ul>
          <div className="btnrow bill-end">
            <button className="btn primary" onClick={() => { store.act((g) => actCallVote(g)); sfx('drums'); }}>Call the vote now<small>{pct(odds)} it passes as things stand</small></button>
            <button className="btn" onClick={() => { store.act((g) => actWithdrawBill(g)); onClose(); }}>Withdraw it<small>half the capital back ({Math.floor(b.cost / 2)})</small></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vote night: the roll call, faction by faction, then the verdict. */
function VoteNight({ b, onClose }: { b: Bill; onClose: () => void }) {
  const r = b.result;
  const law = lawById(b.law)!;
  const [t, setT] = useState(0);
  const calm = typeof document !== 'undefined' && document.documentElement.classList.contains('calm');
  useEffect(() => {
    if (!r || calm) { setT(1); return; }
    let raf = 0; const t0 = performance.now();
    const step = () => { const v = Math.min(1, (performance.now() - t0) / 3800); setT(v); if (v < 1) raf = requestAnimationFrame(step); else sfx(b.status === 'passed' ? 'law' : 'defeat'); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [r, calm, b.status]);
  if (!r) return null;
  const total = r.yes + r.no;
  const need = Math.floor(total / 2) + 1;
  // the count comes in faction by faction
  const shown = r.by.map((x, i) => { const k = Math.max(0, Math.min(1, t * r.by.length * 1.15 - i)); return { ...x, ys: Math.round(x.yes * k), ns: Math.round(x.no * k) }; });
  const ys = shown.reduce((a, x) => a + x.ys, 0), ns = shown.reduce((a, x) => a + x.ns, 0);
  const done = t >= 1;
  const passed = b.status === 'passed';
  const yesBy = Object.fromEntries(shown.map((x) => [x.f, x.ys]));
  return (
    <div className="scrim bill-scrim" role="presentation">
      <div className={`modal bill-modal vote-night ${done ? (passed ? 'won' : 'lost') : ''}`} role="dialog" aria-label="The vote">
        <div className="modal-head"><h2>🗳 The vote: the {law.title}</h2></div>
        <div className="modal-body">
          <div className="vn-count"><div className="vn-side yes"><b>{ys}</b><span>Aye</span></div><div className="vn-need">{need} to pass</div><div className="vn-side no"><b>{ns}</b><span>No</span></div></div>
          <Chamber b={b} yesBy={yesBy} />
          <div className="vn-rows">{shown.map((x) => <div key={x.f} className="vn-row" style={{ ['--fc' as string]: factionMeta(x.f).color }}><b>{factionMeta(x.f).short}</b><span className="vn-bar"><i className="y" style={{ width: pct(x.ys / Math.max(1, x.yes + x.no)) }} /><i className="n" style={{ width: pct(x.ns / Math.max(1, x.yes + x.no)) }} /></span><span className="vn-n">{x.ys}–{x.ns}</span></div>)}</div>
          {done && (
            <div className={`vn-verdict ${passed ? 'won' : 'lost'}`}>
              <b>{passed ? (b.odds0 < 0.5 ? 'A LANDMARK LAW' : 'IT PASSES') : 'DEFEATED'}</b>
              <span>{passed ? `${r.yes} to ${r.no}. The ${law.title} is law${b.em < 1 ? ' (as amended)' : ''}${b.sunset ? ', for four years' : ''}.${b.odds0 < 0.5 ? ' Nobody thought you could do it.' : ''}` : `${r.yes} to ${r.no}. ${b.foe} claims victory. A third of the capital comes back; the law cannot return for half a year.`}</span>
              <button className="btn primary" onClick={onClose}>{passed ? 'On to the next fight' : 'Back to work'}</button>
            </div>
          )}
          {!done && <button className="linkbtn vn-skip" onClick={() => setT(1)}>Skip the count</button>}
        </div>
      </div>
    </div>
  );
}
