/**
 * The State of the Nation: every January the clock stops for last year's report card, your rivals, and the year
 * ahead: a national focus and one promise. Also opened by hand from the desk (a mid-year change of course costs
 * political capital).
 */
import { useEffect, useState } from 'react';
import { store, useStore } from '../state/store';
import { FOCI, focusById, type FocusId } from '../sim/focus';
import { GRADE_WORD, PLEDGE_MISS, actBeginYear, actSwitchFocus, switchCost, type Report } from '../sim/plan';
import { PLEDGE_PC, PLEDGE_APPR, activeGoals } from '../sim/goals';
import { dateLabel } from '../sim/tick';
import { Portrait, faceFor } from './art/Portrait';
import { Emblem } from './art/Emblem';
import { sfx } from '../audio';
import { FOCUS_GLYPH, Glyph } from './art/Glyphs';
import { RivalCard, rivalIds } from './tabs/Rivals';

function ReportCard({ r }: { r: Report }) {
  const max = Math.max(6, ...r.lines.map((l) => Math.abs(l.pts)));
  return (
    <div className={`sotn-report g-${r.grade}`}>
      <div className="sotn-grade" aria-label={`Grade ${r.grade}`}><b>{r.grade}</b><small>{r.score}/100</small></div>
      <div className="sotn-rtxt">
        <small className="sotn-k">{r.year} in review · {GRADE_WORD[r.grade]}</small>
        <p className="sotn-head">{r.headline}</p>
        {r.reward && <span className="sotn-reward">{r.reward}</span>}
      </div>
      <div className="sotn-lines">
        {r.lines.map((l) => (
          <div key={l.key} className="sotn-line">
            <span>{l.label}</span>
            <span className="faint">{l.text}</span>
            <span className="sotn-pt"><i className={l.pts >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(l.pts) / max) * 100}%` }} /></span>
            <b className={l.pts >= 0 ? 'good' : 'bad'}>{l.pts >= 0 ? '+' : ''}{l.pts.toFixed(0)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function YearPlanModal() {
  useStore();
  const s = store.state;
  const P = s?.plan;
  const c = s ? s.countries[s.player] : null;
  const show = !!s && !!P && !!c && !store.preview && !store.splash && ((P.pending && s.settings.yearPlan !== false) || store.planOpen)
    && !(s.legacy && s.settings.mode === 'legacy' && (s.legacy.hand.length > 0 || (s.stats.reviewTerm ?? 0) > store.termSeen));
  const [focus, setFocus] = useState<FocusId | null>(null);
  const [pledge, setPledge] = useState<string | null>(null);
  useEffect(() => { if (show && c) { setFocus(c.focus ?? null); setPledge(P?.pledge?.id ?? null); } }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { store.hold('plan', show); return () => store.hold('plan', false); }, [show]);
  // the bell for a new year, then the grade stamped on the report card
  useEffect(() => {
    if (!show) return;
    if (!s?.plan?.pending) { sfx('open'); return; }
    sfx('bell');
    const id = window.setTimeout(() => { if (s?.plan?.report) sfx('stamp'); }, 700);
    return () => window.clearTimeout(id);
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || !s || !P || !c) return null;
  const pending = P.pending;
  const goals = activeGoals(s).filter((g) => s.goalsDone[g.id] === undefined);
  const cost = pending ? 0 : switchCost(s);
  const leader = s.legacy?.leader ?? c.leader?.name;
  const rivals = rivalIds(s);
  const hist = P.history.slice(-12);
  const pledgeLocked = !pending && !!P.pledge;
  const close = () => store.openPlan(false);
  const begin = () => {
    if (pending) {
      const g = goals.find((x) => x.id === pledge);
      const r = store.act((st) => actBeginYear(st, focus, pledge, g?.title), true);
      if (r.message) store.toast(r.message, 'econ');
      sfx('begin');
      store.openPlan(false);
      if (store.speed === 0) store.setSpeed(store.lastSpeed || 1);
      return;
    }
    if (focus && focus !== c.focus) store.act((st) => actSwitchFocus(st, focus));
    if (!P.pledge && pledge) { const g = goals.find((x) => x.id === pledge); store.act((st) => actBeginYear(st, st.countries[st.player].focus ?? null, pledge, g?.title)); }
    close();
  };
  const F = focusById(focus ?? undefined);
  return (
    <div className="scrim sotn-scrim" role="presentation">
      <div className="sotn" role="dialog" aria-label="State of the Nation">
        <header className="sotn-top">
          <span className="sotn-crest"><Emblem c={c} size={58} /></span>
          <div className="grow">
            <div className="sotn-kicker">{pending ? `1 January ${P.year}` : dateLabel(s.tick)} · State of the Nation</div>
            <h2>{pending ? `${leader ? `${leader}, w` : 'W'}hat is ${P.year} for?` : `Your plan for ${P.year}`}</h2>
          </div>
          {leader && <span className="desk-only sotn-face"><Portrait f={faceFor(c, leader, 'leader')} size={64} title={leader} /></span>}
          {!pending && <button className="iconbtn" aria-label="Close" onClick={close}>✕</button>}
        </header>
        <div className="sotn-body">
          {P.report && (pending || P.report.year === P.year - 1) && <ReportCard r={P.report} />}
          {hist.length > 1 && <div className="sotn-hist" aria-label="Your record">{hist.map((h) => <span key={h.year} className={`g-${h.grade}`} title={`${h.year}: ${GRADE_WORD[h.grade]}${h.pledge === undefined ? '' : h.pledge ? ' · promise kept' : ' · promise broken'}`}><b>{h.grade}</b><small>{h.year}</small></span>)}</div>}
          {rivals.length > 0 && (
            <>
              <h3 className="sotn-h">The rivals</h3>
              <div className="sotn-rivals">{rivals.map((x) => <RivalCard key={x.id} id={x.id} role={x.role} compact />)}</div>
            </>
          )}
          <h3 className="sotn-h">The national focus <small>{pending ? 'free today · one change mid-year costs capital' : cost ? `changing course now: ${cost} political capital, once a year` : 'free for the first month'}</small></h3>
          <div className="sotn-foci" role="radiogroup" aria-label="National focus">
            {FOCI.map((f) => (
              <button key={f.id} role="radio" aria-checked={focus === f.id} className={`sotn-focus ${focus === f.id ? 'on' : ''}`} style={{ ['--fc' as string]: f.color }} onClick={() => { sfx('select', FOCI.indexOf(f)); setFocus(focus === f.id ? null : f.id); }}>
                <span className="sf-ic" aria-hidden="true"><Glyph name={FOCUS_GLYPH[f.id]} size={30} /></span>
                <b>{f.name}</b>
                <em>{f.motto}</em>
                <ul>{f.pros.map((p) => <li key={p} className="pro">{p}</li>)}{f.cons.map((p) => <li key={p} className="con">{p}</li>)}</ul>
                {c.focus === f.id && <span className="sf-cur">current</span>}
              </button>
            ))}
          </div>
          <h3 className="sotn-h">Your promise <small>keep it: +{PLEDGE_PC} capital, +{PLEDGE_APPR} approval · break it: −{PLEDGE_MISS} approval</small></h3>
          {pledgeLocked ? <div className="sotn-pledged">🤝 {P.pledge!.title}{P.pledge!.done ? ' · kept' : ''}</div> : (
            <div className="sotn-pledges" role="radiogroup" aria-label="Your promise">
              {goals.map((g) => { const pr = g.progress(s, c); return (
                <button key={g.id} role="radio" aria-checked={pledge === g.id} className={`sotn-pledge ${pledge === g.id ? 'on' : ''}`} onClick={() => { sfx('select', 5); setPledge(pledge === g.id ? null : g.id); }}>
                  <b>{g.title}</b><small>{pr.text}</small><span className="desk-bar"><i style={{ width: `${Math.round(pr.value * 100)}%` }} /></span>
                </button>); })}
              <button role="radio" aria-checked={pledge === null} className={`sotn-pledge none ${pledge === null ? 'on' : ''}`} onClick={() => setPledge(null)}><b>Promise nothing</b><small>no reward, no risk</small></button>
            </div>
          )}
        </div>
        <footer className="sotn-foot">
          <span className="faint">{F ? F.name : 'No focus'}{pledge ? ' · 1 promise' : ''}</span>
          {!pending && <button className="btn" onClick={close}>Cancel</button>}
          <button className="btn primary sotn-go" onClick={begin}>{pending ? `Begin ${P.year} ▶` : focus !== (c.focus ?? null) && cost ? `Change course (${cost} capital)` : 'Confirm'}</button>
        </footer>
      </div>
    </div>
  );
}
