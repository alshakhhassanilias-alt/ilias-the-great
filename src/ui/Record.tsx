/**
 * Your years: every year you have played, kept for good. The grade and its full report card, who governed, the numbers
 * as the year closed (and how they moved), the year's biggest moments and any records it set; above them the career
 * at a glance: the grade average, the best and worst years, streaks, and charts of everything that matters by year.
 */
import { useMemo, useState } from 'react';
import { store, useStoreSelect } from '../state/store';
import { GPA, GRADE_WORD, goodStreak, gpaGrade, type Grade, type YearRec } from '../sim/plan';
import { focusById } from '../sim/focus';
import { fmtMoney } from '../sim/util';

const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'F'];
const GRADE_COL: Record<Grade, string> = { S: '#ffd86b', A: '#f0c050', B: '#8fd18a', C: '#b8b1a0', D: '#e48a5c', F: '#e2563f' };
const pct = (v: number | undefined, d = 0) => (v === undefined ? '–' : `${(v * 100).toFixed(d)}%`);
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const money = (v: number | undefined) => (v === undefined ? '–' : v >= 1e4 ? `$${(v / 1000).toFixed(v >= 1e5 ? 0 : 1)}k` : `$${Math.round(v).toLocaleString('en-US')}`);

/** the longest run of years graded B or better */
function longestStreak(h: YearRec[]) { let best = 0, n = 0; for (const r of h) { n = GPA[r.grade] >= 3 ? n + 1 : 0; best = Math.max(best, n); } return best; }

export function GradeStrip({ hist, onOpen, max = 12 }: { hist: YearRec[]; onOpen?: () => void; max?: number }) {
  if (!hist.length) return null;
  const shown = hist.slice(-max);
  return (
    <button type="button" className="rec-strip" onClick={onOpen} disabled={!onOpen} title={onOpen ? 'Open your year-by-year record' : undefined}>
      {hist.length > shown.length && <small className="rec-more">+{hist.length - shown.length}</small>}
      {shown.map((h) => <span key={h.year} className={`g-${h.grade}`} title={`${h.year}: ${GRADE_WORD[h.grade]} (${h.score}/100)`}><b>{h.grade}</b><small>{String(h.year).slice(2)}</small></span>)}
      {onOpen && <em>Your years ›</em>}
    </button>
  );
}

/** a small chart of one number, one point per year, coloured by that year's grade; a line where the leader changed */
function YearChart({ hist, label, get, fmt, invert, ref0 }: { hist: YearRec[]; label: string; get: (r: YearRec) => number | undefined; fmt: (v: number) => string; invert?: boolean; ref0?: boolean }) {
  const pts = hist.map((r, i) => ({ i, r, v: get(r) })).filter((p): p is { i: number; r: YearRec; v: number } => p.v !== undefined && Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const W = 220, H = 74, pl = 4, pr = 4, pt = 8, pb = 6;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (ref0) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const n = hist.length;
  const x = (i: number) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
  const y = (v: number) => { const f = (v - lo) / (hi - lo); return pt + (invert ? f : 1 - f) * (H - pt - pb); };
  const last = pts[pts.length - 1], first = pts[0];
  const better = invert ? last.v < first.v : last.v > first.v;
  const changes = hist.map((r, i) => (i > 0 && r.leader && hist[i - 1].leader && r.leader !== hist[i - 1].leader ? i : -1)).filter((i) => i > 0);
  return (
    <figure className="rec-chart">
      <figcaption><span>{label}</span><b className={better ? 'up' : 'down'}>{fmt(last.v)}</b></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} by year`}>
        {ref0 && lo < 0 && hi > 0 && <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} className="rc-zero" />}
        {changes.map((i) => <line key={i} x1={x(i - 0.5)} x2={x(i - 0.5)} y1={pt - 4} y2={H} className="rc-heir" />)}
        <polyline className="rc-line" points={pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
        {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={n > 30 ? 1.8 : 2.6} fill={GRADE_COL[p.r.grade]}><title>{`${p.r.year}: ${fmt(p.v)}`}</title></circle>)}
      </svg>
      <div className="rc-ends"><small>{hist[0].year}</small><small>{fmt(first.v)} → {fmt(last.v)}</small><small>{hist[n - 1].year}</small></div>
    </figure>
  );
}

function YearCard({ r, prev, open, onToggle }: { r: YearRec; prev?: YearRec; open: boolean; onToggle: () => void }) {
  const d = (k: keyof YearRec) => (prev && typeof r[k] === 'number' && typeof prev[k] === 'number' ? (r[k] as number) - (prev[k] as number) : undefined);
  const F = focusById(r.focus);
  const cells: { k: string; v: string; dv?: number; fmt?: (v: number) => string; good?: boolean }[] = [
    { k: 'Income per head', v: money(r.gdppc), dv: d('gdppc') !== undefined && prev?.gdppc ? (d('gdppc')! / prev.gdppc) : undefined, fmt: (v) => `${sgn(v * 100)}%`, good: true },
    { k: r.growthRank ? `Growth · #${r.growthRank} of ${r.growthOf}` : 'Growth', v: r.growth === undefined ? '–' : `${sgn(r.growth * 100)}%` },
    { k: 'Approval', v: r.appr === undefined ? '–' : `${r.appr.toFixed(0)}%`, dv: d('appr'), fmt: (v) => sgn(v, 0), good: true },
    { k: 'Stability', v: r.stab === undefined ? '–' : r.stab.toFixed(0), dv: d('stab'), fmt: (v) => sgn(v, 0), good: true },
    { k: 'World rank', v: r.rank === undefined ? '–' : `#${r.rank}`, dv: d('rank'), fmt: (v) => (v === 0 ? '=' : v < 0 ? `▲${-v}` : `▼${v}`), good: false },
    { k: 'Debt', v: pct(r.debt), dv: d('debt'), fmt: (v) => `${sgn(v * 100, 0)} pts`, good: false },
  ];
  return (
    <li className={`rec-year g-${r.grade} ${open ? 'open' : ''}`}>
      <button type="button" className="ry-head" onClick={onToggle} aria-expanded={open}>
        <span className={`grade g-${r.grade}`}>{r.grade}</span>
        <span className="ry-title">
          <b>{r.year}</b>
          <small>{GRADE_WORD[r.grade]} · {r.score}/100{r.leader ? ` · ${r.leader}${r.term ? `, term ${r.term}` : ''}${r.office === false ? ' (out of office)' : ''}` : ''}</small>
        </span>
        {r.records?.length ? <span className="ry-rec" title={r.records.join(' · ')}>🏅 {r.records.length > 1 ? `${r.records.length} records` : 'record'}</span> : null}
        <span className="ry-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {r.headline && <p className="ry-headline">{r.headline}</p>}
      {r.gdppc !== undefined && (
        <div className="ry-stats">
          {cells.map((c) => {
            const up = c.dv === undefined || Math.abs(c.dv) < 1e-9 ? 0 : c.dv > 0 ? 1 : -1;
            const cls = up === 0 ? '' : (up > 0) === (c.good !== false) ? 'up' : 'down';
            return <span key={c.k}><small>{c.k}</small><b>{c.v}</b>{c.dv !== undefined && c.fmt ? <em className={cls}>{c.fmt(c.dv)}</em> : null}</span>;
          })}
        </div>
      )}
      {open && (
        <div className="ry-more">
          {r.records?.length ? <ul className="ry-records">{r.records.map((x) => <li key={x}>🏅 {x}</li>)}</ul> : null}
          {r.moments?.length ? <><h4>What happened</h4><ul className="ry-moments">{r.moments.map((m, i) => <li key={i}>{m}</li>)}</ul></> : null}
          {r.lines?.length ? (
            <>
              <h4>The report card</h4>
              <table className="ry-card"><tbody>{r.lines.map((l) => <tr key={l.key}><th>{l.label}</th><td>{l.text}</td><td className={l.pts > 0.5 ? 'up' : l.pts < -0.5 ? 'down' : ''}>{l.pts > 0 ? '+' : ''}{l.pts}</td></tr>)}</tbody></table>
            </>
          ) : null}
          <p className="ry-foot">
            {F ? <span>{F.icon} A year of {F.name.toLowerCase()}</span> : <span>No national focus</span>}
            {r.pledge !== undefined && <span>{r.pledge ? '🤝 Promise kept' : '💔 Promise broken'}{r.pledgeTitle ? `: ${r.pledgeTitle}` : ''}</span>}
            {r.wars ? <span>⚔ At war ({r.wars})</span> : null}
            {r.gdp !== undefined && <span>Economy {fmtMoney(r.gdp)}</span>}
            {r.pop !== undefined && <span>{(r.pop / 1e6).toFixed(r.pop > 1e8 ? 0 : 1)}m people</span>}
            {r.unemp !== undefined && <span>Unemployment {pct(r.unemp, 1)}</span>}
            {r.infl !== undefined && <span>Inflation {pct(r.infl, 1)}</span>}
          </p>
        </div>
      )}
    </li>
  );
}

export function RecordPanel({ onClose }: { onClose: () => void }) {
  useStoreSelect(() => store.state?.plan?.history.length ?? 0);
  const s = store.state!;
  const c = s.countries[s.player];
  const hist = s.plan?.history ?? [];
  const leaders = useMemo(() => [...new Set(hist.map((h) => h.leader).filter((x): x is string => !!x))], [hist.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [who, setWho] = useState<string>('all');
  // the latest year is open until you choose another
  const [open, setOpen] = useState<number | 'latest' | null>('latest');
  const [showAll, setShowAll] = useState(false);
  const H = who === 'all' ? hist : hist.filter((h) => h.leader === who);
  const gpa = H.length ? H.reduce((t, h) => t + GPA[h.grade], 0) / H.length : 0;
  const best = H.length ? H.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const worst = H.length ? H.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const counts = GRADES.map((g) => H.filter((h) => h.grade === g).length);
  const withNums = H.filter((h) => h.gdppc !== undefined);
  const firstN = withNums[0], lastN = withNums[withNums.length - 1];
  const list = [...H].reverse();
  const shown = showAll ? list : list.slice(0, 15);
  return (
    <div className="scrim rec-scrim" role="presentation" onClick={onClose}>
      <div className="modal rec-modal" role="dialog" aria-label="Your years" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>📜 Your years <small>{c.name}{s.dynasty && s.settings.mode === 'legacy' ? ` · the House of ${s.dynasty.house}` : ''}</small></h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {!hist.length ? <p className="muted">Your first year is still under way. On 1 January it is graded, and from then on every year is kept here: its grade and report card, the numbers, and what happened.</p> : (
            <>
              {leaders.length > 1 && (
                <div className="seg rec-who" role="tablist" aria-label="Whose years">
                  <button type="button" className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone</button>
                  {leaders.map((l) => <button type="button" key={l} className={who === l ? 'on' : ''} onClick={() => setWho(l)}>{l}</button>)}
                </div>
              )}
              <div className="rec-summary">
                <div className="rs-gpa"><span className={`grade big g-${gpaGrade(gpa)}`}>{gpaGrade(gpa)}</span><small>grade average<br /><b>{gpa.toFixed(2)}</b> over {H.length} year{H.length === 1 ? '' : 's'}</small></div>
                <div className="rs-facts">
                  {best && <span><small>Best year</small><b>{best.year}</b><em className={`g-${best.grade}`}>{best.grade} · {best.score}</em></span>}
                  {worst && H.length > 1 && <span><small>Worst year</small><b>{worst.year}</b><em className={`g-${worst.grade}`}>{worst.grade} · {worst.score}</em></span>}
                  <span><small>Good years in a row</small><b>{goodStreak(H)}</b><em>best run {longestStreak(H)}</em></span>
                  {H.some((h) => h.growthRank) && <span><small>Best world growth rank</small><b>#{Math.min(...H.filter((h) => h.growthRank).map((h) => h.growthRank!))}</b><em>{H.filter((h) => (h.growthRank ?? 99) <= 10).length}× in the world top ten</em></span>}
                  <span><small>Records set</small><b>{H.reduce((t, h) => t + (h.records?.length ?? 0), 0)}</b><em>{H.filter((h) => h.pledge).length} promises kept</em></span>
                  {firstN && lastN && firstN !== lastN && firstN.gdppc && lastN.gdppc && <span><small>Income per head</small><b>{sgn((lastN.gdppc / firstN.gdppc - 1) * 100, 0)}%</b><em>{money(firstN.gdppc)} → {money(lastN.gdppc)}</em></span>}
                  {firstN?.rank && lastN?.rank && firstN !== lastN && <span><small>World rank</small><b>#{firstN.rank} → #{lastN.rank}</b><em>{lastN.rank < firstN.rank ? `up ${firstN.rank - lastN.rank}` : lastN.rank > firstN.rank ? `down ${lastN.rank - firstN.rank}` : 'held'}</em></span>}
                </div>
                <div className="rs-dist" aria-label="Grades">
                  {GRADES.map((g, i) => <span key={g} className={`g-${g}`}><i style={{ height: `${H.length ? Math.max(counts[i] ? 8 : 0, (100 * counts[i]) / Math.max(...counts)) : 0}%`, background: GRADE_COL[g] }} /><b>{g}</b><small>{counts[i]}</small></span>)}
                </div>
              </div>
              <GradeStrip hist={H} max={60} />
              {withNums.length >= 2 && (
                <div className="rec-charts">
                  <YearChart hist={H} label="Income per head" get={(r) => r.gdppc} fmt={money} />
                  <YearChart hist={H} label="Growth" get={(r) => r.growth} fmt={(v) => `${sgn(v * 100)}%`} ref0 />
                  <YearChart hist={H} label="Approval" get={(r) => r.appr} fmt={(v) => `${v.toFixed(0)}%`} />
                  <YearChart hist={H} label="Stability" get={(r) => r.stab} fmt={(v) => v.toFixed(0)} />
                  <YearChart hist={H} label="World rank" get={(r) => r.rank} fmt={(v) => `#${Math.round(v)}`} invert />
                  <YearChart hist={H} label="Public debt" get={(r) => r.debt} fmt={(v) => `${(v * 100).toFixed(0)}%`} invert />
                  <YearChart hist={H} label="World growth rank" get={(r) => r.growthRank} fmt={(v) => `#${Math.round(v)}`} invert />
                  <YearChart hist={H} label="Year score" get={(r) => r.score} fmt={(v) => `${Math.round(v)}`} />
                  <YearChart hist={H} label="Army" get={(r) => r.troops} fmt={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : `${Math.round(v / 1000)}k`)} />
                </div>
              )}
              <ol className="rec-years">
                {shown.map((r) => { const i = H.indexOf(r); return <YearCard key={r.year} r={r} prev={i > 0 ? H[i - 1] : undefined} open={open === 'latest' ? r === list[0] : open === r.year} onToggle={() => setOpen((open === 'latest' ? r === list[0] : open === r.year) ? null : r.year)} />; })}
              </ol>
              {list.length > shown.length && <button className="btn" onClick={() => setShowAll(true)}>Show all {list.length} years</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
