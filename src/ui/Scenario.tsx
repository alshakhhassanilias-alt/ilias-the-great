/**
 * Scenarios in the interface: the picker on the start screen, the chip in the top bar, the goals panel and the
 * final result (stars, score, your best).
 */
import { store, useStore } from '../state/store';
import { SCENARIOS, scenarioById, scenarioGoals, scenarioPlayer, type Scenario } from '../sim/scenarios';
import { Emblem } from './art/Emblem';
import { Section } from './widgets';

const BEST = (id: string) => `wo-scen-best:${id}`;
export function bestOf(id: string): { stars: number; score: number } | null {
  try { const v = localStorage.getItem(BEST(id)); return v ? JSON.parse(v) as { stars: number; score: number } : null; } catch { return null; }
}
function saveBest(id: string, stars: number, score: number) {
  const b = bestOf(id);
  if (b && (b.stars > stars || (b.stars === stars && b.score >= score))) return false;
  try { localStorage.setItem(BEST(id), JSON.stringify({ stars, score })); } catch { /* storage unavailable */ }
  return true;
}
const Stars = ({ n, of = 3, big }: { n: number; of?: number; big?: boolean }) => (
  <span className={`stars ${big ? 'big' : ''}`} aria-label={`${n} of ${of} stars`}>{Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'on' : ''}>★</i>)}</span>
);

/** Start screen: the scenario cards. */
export function ScenarioPicker({ value, onPick }: { value?: string; onPick: (sc: Scenario) => void }) {
  const s = store.state!;
  return (
    <div className="scen-list" role="radiogroup" aria-label="Scenarios">
      {SCENARIOS.map((sc) => {
        const c = s.countries[scenarioPlayer(sc)];
        const b = bestOf(sc.id);
        return (
          <button key={sc.id} role="radio" aria-checked={value === sc.id} className={`scen-card ${value === sc.id ? 'on' : ''} d-${sc.difficulty}`} onClick={() => onPick(sc)}>
            <span className="scen-art" aria-hidden="true">{c ? <Emblem c={c} size={44} crest={false} /> : null}<span className="scen-ic">{sc.icon}</span></span>
            <span className="scen-txt">
              <b>{sc.title}</b>
              <small>{sc.country} · {sc.year} · {sc.years} years · <em>{sc.difficulty}</em></small>
              <span className="scen-pitch">{sc.pitch}</span>
            </span>
            <span className="scen-best">{b ? <><Stars n={b.stars} /><small>best {b.score}</small></> : <small className="faint">not played</small>}</span>
          </button>
        );
      })}
    </div>
  );
}
export function ScenarioBrief({ id }: { id: string }) {
  const sc = scenarioById(id);
  if (!sc) return null;
  return (
    <div className="card scen-brief">
      <div className="scen-brief-h">{sc.icon} <b>{sc.title}</b></div>
      <p>{sc.brief}</p>
      <ol>{sc.goals.map((g, i) => <li key={i}><span className="stars"><i className="on">★</i></span> {g.label}{g.kind === 'end' ? ' (judged on the last day)' : g.kind === 'hold' ? '' : ''}</li>)}</ol>
      <small className="faint">The first goal decides victory; the other two are extra stars. Win all three early and the scenario ends in triumph.</small>
    </div>
  );
}

/** Top bar: time left and stars. */
export function ScenarioChip() {
  const s = store.state;
  const st = s?.scen;
  const sc = scenarioById(st?.id);
  if (!s || !st || !sc) return null;
  const left = Math.max(0, st.until - s.tick);
  const won = scenarioGoals(s).filter((g) => g.won).length;
  return (
    <button className="scen-chip" title={`${sc.title}: ${sc.goals.map((g) => g.label).join(' · ')}`} onClick={() => { if (st.done) { store.scenResultOpen = true; store.scenClosed = -1; store.notify(); } else { store.select(s.player, null, false); store.setTab('goals'); } }}>
      <span aria-hidden="true">{sc.icon}</span>
      <span className="scen-chip-t"><b>{st.done ? (st.done.won ? 'Victory' : 'Defeat') : left >= 52 ? `${Math.floor(left / 52)}y ${Math.round((left % 52) / 4.33)}m left` : `${Math.round(left / 4.33)} months left`}</b><Stars n={st.done ? st.done.stars : won} /></span>
    </button>
  );
}

/** Goals tab (and Overview): the scenario's three goals, live. */
export function ScenarioPanel() {
  const s = store.state!;
  const st = s.scen;
  const sc = scenarioById(st?.id);
  if (!st || !sc) return null;
  const gs = scenarioGoals(s);
  const left = Math.max(0, st.until - s.tick);
  const frac = 1 - left / Math.max(1, st.until - st.start);
  return (
    <Section title={`${sc.icon} ${sc.title}`} hint={st.done ? (st.done.won ? 'victory' : 'defeat') : `${(left / 52).toFixed(1)} years left`}>
      <div className="scen-panel">
        <div className="scen-clock"><i style={{ width: `${Math.round(frac * 100)}%` }} /></div>
        {gs.map((g) => (
          <div key={g.i} className={`scen-goal ${g.won ? 'won' : ''}`}>
            <span className="scen-star" aria-hidden="true">{g.won ? '★' : '☆'}</span>
            <div className="grow">
              <b>{g.g.label}</b>
              <small>{g.locked ? 'won' : g.g.kind === 'hold' ? `${g.text} · held ${g.streak} of ${g.g.weeks} weeks` : g.g.kind === 'end' ? `${g.text} · judged on the last day` : g.text}</small>
              <div className="desk-bar"><i style={{ width: `${Math.round(Math.min(1, g.v) * 100)}%` }} /></div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

let recorded: { id: string; tick: number; rec: boolean } | null = null;
/** The end: stars, the score, your best. */
export function ScenarioResult() {
  useStore();
  const s = store.state;
  const st = s?.scen;
  const sc = scenarioById(st?.id);
  const open = !!st?.done && (store.scenResultOpen || store.scenSeen) && !store.preview;
  if (!s || !st?.done || !sc || !open || store.scenClosed === st.done.tick) return null;
  const d = st.done;
  if (recorded?.tick !== d.tick || recorded.id !== sc.id) recorded = { id: sc.id, tick: d.tick, rec: saveBest(sc.id, d.stars, d.score) };
  const record = recorded.rec;
  const c = s.countries[s.player];
  const close = () => { store.scenClosed = d.tick; store.scenResultOpen = false; store.notify(); };
  return (
    <div className="scrim sotn-scrim" role="presentation">
      <div className={`scen-result ${d.won ? 'win' : 'lose'}`} role="dialog" aria-label="Scenario result">
        <div className="sr-kicker">{sc.icon} {sc.title}</div>
        <div className="sr-emb"><Emblem c={c} size={92} /></div>
        <h2>{d.won ? 'Victory' : 'Defeat'}</h2>
        <Stars n={d.stars} big />
        <p className="sr-why">{d.why}</p>
        <div className="sr-goals">{sc.goals.map((g, i) => <div key={i} className={st.stars[i] || (i < d.stars && d.won) ? 'won' : ''}>{st.stars[i] ? '★' : '☆'} {g.label}</div>)}</div>
        <div className="sr-score"><small>Score</small><b>{d.score.toLocaleString()}</b>{record && <em>new best!</em>}</div>
        <div className="sr-btns">
          <button className="btn" onClick={() => { close(); store.quitToMenu(); }}>Main menu</button>
          <button className="btn primary" onClick={close}>Keep playing</button>
        </div>
      </div>
    </div>
  );
}
