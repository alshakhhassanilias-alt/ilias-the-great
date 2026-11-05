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
import { shareCard } from './share';
import type { GameState } from '../sim/types';
import { FOCUS_GLYPH, Glyph } from './art/Glyphs';
import { RivalCard, rivalIds } from './tabs/Rivals';
import { BeforeAfter } from './Dynasty';
import { leaderFace } from './LookEditor';
import { snapshot } from '../sim/dynasty';
import { powerRank } from '../sim/power';
import { factionMeta } from '../sim/domestic';
import { START_YEAR } from '../sim/types';

const WEIGHTS: [RegExp, number][] = [[/declared war|WAR:|GREAT-POWER|INTERVENTION/, 10], [/defaulted/, 9], [/OVERTAKES|overtakes/, 8], [/STAR WON|PROMISE KEPT|PROMISE BROKEN/, 8], [/elect|ELECTION|vote of confidence/i, 7], [/leave your coalition|turn against the regime/, 6], [/passes parliament|signed into force|is law/, 5], [/sphere of influence/, 5], [/RESEARCH COMPLETE|first nation/, 4], [/INDUSTRY:/, 3], [/peace|armistice|ceasefire/i, 7]];
/** The year's three biggest stories about you, from the news (for the front page of the State of the Nation). */
export function yearHeadlines(s: GameState): string[] {
  const since = s.tick - 52;
  const me = s.player;
  const picked: { t: string; w: number }[] = [];
  for (const e of s.log) {
    if (e.tick < since || !e.countries.includes(me) || !e.important) continue;
    const w = WEIGHTS.find(([re]) => re.test(e.text))?.[1] ?? 0;
    if (w < 3) continue;
    const t = e.text.replace(/^[^A-Za-z0-9]+/, '').split(/(?<=[.!])\s/)[0].replace(/\.$/, '');
    if (!picked.some((p) => p.t === t)) picked.push({ t, w: w + e.tick / 1e6 });
  }
  return picked.sort((a, b) => b.w - a.w).slice(0, 3).map((p) => p.t.length > 110 ? `${p.t.slice(0, 107)}…` : p.t);
}

function ReportCard({ r }: { r: Report }) {
  const max = Math.max(6, ...r.lines.map((l) => Math.abs(l.pts)));
  return (
    <div className={`sotn-report g-${r.grade}`}>
      <div className="sotn-grade" aria-label={`Grade ${r.grade}`}><b>{r.grade}</b><small>{r.score}/100</small></div>
      <div className="sotn-rtxt">
        <small className="sotn-k">{r.year} in review · {GRADE_WORD[r.grade]}</small>
        <p className="sotn-head">{r.headline}</p>
        {r.reward && <span className="sotn-reward">{r.reward}</span>}
        <button className="linkbtn sotn-share" onClick={() => { const s = store.state!; const c = s.countries[s.player]; void shareCard({ kicker: `${r.year} in review`, title: c.name, big: `GRADE ${r.grade}`, lines: [r.headline, `${r.score}/100`], foot: 'WORLD ORDER · STATE OF THE NATION' }, `world-order-${r.year}`, `${c.name}, ${r.year}: grade ${r.grade} in World Order`).then((x) => store.toast(x === 'failed' ? 'Could not make the card' : x === 'shared' ? 'Shared' : 'Year card saved', x === 'failed' ? 'danger' : 'info')); }}>Share this year</button>
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

/**
 * Every year something different: on a round anniversary the country then and now; otherwise, in turn, the power race
 * (who rose, who fell), the people (every faction's mood) and what has changed since you took office.
 */
function YearFeature({ s }: { s: GameState }) {
  const P = s.plan!, c = s.countries[s.player];
  const L = s.legacy && s.settings.mode === 'legacy' ? s.legacy : null;
  const from = L?.snap0 ?? P.snap0;
  if (!from) return null;
  const now = snapshot(s);
  const yrs = Math.round((s.tick - from.tick) / 52);
  const who = L ? 'you took office' : 'the game began';
  const year0 = Math.floor(START_YEAR + from.tick / 52);
  const kind = yrs > 0 && yrs % 5 === 0 ? 'anniv' : (['race', 'people', 'then'] as const)[P.year % 3];
  // a line that is always there: then and now in three numbers
  const strip = (
    <div className="yf-strip">
      <span>Since {who} ({year0}):</span>
      <b className={now.power < from.power ? 'good' : now.power > from.power ? 'bad' : ''}>power #{from.power} → #{now.power}</b>
      <b className={now.gdppc >= from.gdppc ? 'good' : 'bad'}>income {now.gdppc >= from.gdppc ? '+' : ''}{((now.gdppc / Math.max(1, from.gdppc) - 1) * 100).toFixed(0)}%</b>
      <b className={now.regions >= from.regions ? '' : 'bad'}>{now.regions - from.regions >= 0 ? '+' : ''}{now.regions - from.regions} regions</b>
    </div>
  );
  if (kind === 'anniv') return (
    <div className="yf yf-anniv">{strip}
      <h3 className="sotn-h">{['', 'Five', 'Ten', 'Fifteen', 'Twenty', 'Twenty-five', 'Thirty', 'Thirty-five', 'Forty'][yrs / 5] ?? yrs} years since {who}</h3>
      <BeforeAfter a={from} b={now} labelA={String(year0)} labelB="Today" limit={8} />
    </div>
  );
  if (kind === 'race') {
    const top = P.top ?? [], prev = P.topPrev ?? [];
    const mine = top.includes(c.id) ? top : [...top.slice(0, 9), c.id];
    return (
      <div className="yf">{strip}
        <h3 className="sotn-h">The race for world power <small>last year's moves</small></h3>
        <ol className="yf-race">{mine.map((id, i) => {
          const was = prev.indexOf(id);
          const mv = was < 0 ? 'new' : was - top.indexOf(id);
          return <li key={id} className={id === c.id ? 'me' : ''}><span className="yf-n">#{top.includes(id) ? i + 1 : powerRank(s, id)}</span><Emblem c={s.countries[id]} size={18} crest={false} /><span className="grow">{s.countries[id].name}</span><span className={`yf-mv ${typeof mv === 'number' ? (mv > 0 ? 'good' : mv < 0 ? 'bad' : '') : 'good'}`}>{mv === 'new' ? 'new' : mv === 0 ? '=' : mv > 0 ? `▲${mv}` : `▼${-mv}`}</span></li>;
        })}</ol>
      </div>
    );
  }
  if (kind === 'people' && c.politics) return (
    <div className="yf">{strip}
      <h3 className="sotn-h">The people <small>how every part of the country feels about you</small></h3>
      <div className="yf-people">{c.politics.factions.map((f) => { const m = factionMeta(f.id); return (
        <div key={f.id} className="yf-fac"><span>{m.icon} {m.short}<small>{Math.round(f.support * 100)}% of the people</small></span><div className="bar"><i style={{ width: `${Math.max(3, f.mood)}%`, background: f.mood > 60 ? 'var(--green)' : f.mood > 35 ? 'var(--amber)' : 'var(--red)' }} /></div><b>{f.mood.toFixed(0)}</b></div>); })}</div>
    </div>
  );
  return (
    <div className="yf">{strip}
      <h3 className="sotn-h">Then and now <small>the biggest changes since {who}</small></h3>
      <BeforeAfter a={from} b={now} labelA={String(year0)} labelB="Today" limit={5} />
    </div>
  );
}

export function YearPlanModal() {
  useStore();
  const s = store.state;
  const P = s?.plan;
  const c = s ? s.countries[s.player] : null;
  const show = !!s && !!P && !!c && !store.preview && !store.splash && !(s.warx && Object.values(s.warx).some((x) => x.council)) && ((P.pending && s.settings.yearPlan !== false) || store.planOpen)
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
          {leader && <span className="desk-only sotn-face"><Portrait f={s.legacy && s.settings.mode === 'legacy' ? leaderFace(s) : faceFor(c, leader, 'leader')} size={64} title={leader} /></span>}
          {!pending && <button className="iconbtn" aria-label="Close" onClick={close}>✕</button>}
        </header>
        <div className="sotn-body">
          {pending && (() => { const hs = yearHeadlines(s); return hs.length > 0 && (
            <div className="sotn-news"><div className="sn-mast">The {c.name} Herald · {P.year - 1} in headlines</div>{hs.map((h, i) => <p key={i} className={i === 0 ? 'lead' : ''}>{h}</p>)}</div>); })()}
          {P.report && (pending || P.report.year === P.year - 1) && <ReportCard r={P.report} />}
          {pending && <YearFeature s={s} />}
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
