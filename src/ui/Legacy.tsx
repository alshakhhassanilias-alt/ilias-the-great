/**
 * Legacy mode screens: the agenda draft, the career dossier, the newspaper after each term, the opposition
 * desk and the history book at the end.
 */
import { Portrait, faceFor } from './art/Portrait';
import { useState } from 'react';
import { store, useStore } from '../state/store';
import { AGENDA, actAgendaAction, agendaById, type AgendaCat } from '../sim/agenda';
import { OPP_ACTIONS, PART_LABEL, actChooseAgenda, actForceVote, actOpposition, actRetire, continueAsSandbox, epithet, grade, isFree, ordinal, scoreParts, totalScore, voteShare } from '../sim/legacy';
import { approval } from '../sim/events3';
import { dateLabel } from '../sim/tick';
import { fmtMoney } from './format';
import { Emblem } from './art/Emblem';
import { START_YEAR, TICKS_PER_YEAR } from '../sim/types';

const CAT_COLOR: Record<AgendaCat, string> = { economy: '#d6ab52', power: '#c8553f', diplomacy: '#5e9fd6', society: '#62c29e', territory: '#a46fd0' };
const CAT_LABEL: Record<AgendaCat, string> = { economy: 'Economy', power: 'Power', diplomacy: 'Diplomacy', society: 'Society', territory: 'Territory' };
const years = (weeks: number) => (weeks >= 52 ? `${Math.floor(weeks / 52)}y ${Math.round((weeks % 52) / 4.33)}m` : `${weeks} wk`);

/** Top-bar chip: your career at a glance. */
export function LegacyChip() {
  const s = store.state;
  const L = s?.legacy;
  if (!s || !L || s.settings.mode !== 'legacy') return null;
  const left = Math.max(0, L.nextVote - s.tick);
  const g = grade(L.score);
  return (
    <button className={`legacy-chip ${L.status}`} onClick={() => store.openDrawer('legacy')} title="Your career and legacy">
      <span className={`grade g-${g}`}>{g}</span>
      <span className="lc-txt">
        <b>{L.status === 'office' ? `Term ${L.term} · ${isFree(s.countries[s.player].gov) ? 'election' : 'congress'} in ${years(left)}` : L.status === 'opposition' ? `${isFree(s.countries[s.player].gov) ? 'In opposition' : 'In exile'} · ${L.opposition?.support.toFixed(0)}% support` : 'Career over'}</b>
        <small>Legacy {L.score.toFixed(0)}{L.status === 'office' ? ` · polls ${voteShare(s).toFixed(0)}%` : ''}</small>
      </span>
    </button>
  );
}

/** One agenda card, drawn like a campaign poster. */
function Card({ id, picked, onClick, progress }: { id: string; picked?: boolean; onClick?: () => void; progress?: { value: number; text: string; done?: boolean; failed?: boolean } }) {
  const a = agendaById(id);
  return (
    <button className={`agenda-card ${picked ? 'picked' : ''} ${progress?.done ? 'done' : ''} ${progress?.failed ? 'failed' : ''}`} style={{ ['--cat' as string]: CAT_COLOR[a.cat] }} onClick={onClick} disabled={!onClick}>
      <div className="ac-band">{CAT_LABEL[a.cat]}<span>+{a.points}</span></div>
      <div className="ac-icon" aria-hidden="true">{a.icon}</div>
      <div className="ac-title">{a.title}</div>
      <div className="ac-pitch">{a.pitch}</div>
      <div className="ac-goal">{a.goal}{a.atTermEnd ? ' (judged at the end of the term)' : ''}</div>
      {a.action && <div className="ac-action">Unlocks: {a.action.label}</div>}
      {progress && (
        <div className="ac-prog">
          <div className="bar"><i style={{ width: `${Math.round(progress.value * 100)}%`, background: progress.failed ? 'var(--red)' : progress.done ? 'var(--teal)' : 'var(--cat)' }} /></div>
          <small>{progress.done ? '✔ kept' : progress.failed ? '✘ broken' : progress.text}</small>
        </div>
      )}
      {picked && <div className="ac-seal" aria-hidden="true">✔</div>}
    </button>
  );
}

/** The agenda draft at the start of every term. */
export function AgendaDraft() {
  useStore();
  const s = store.state;
  const L = s?.legacy;
  const [sel, setSel] = useState<string[]>([]);
  if (!s || !L || s.settings.mode !== 'legacy' || L.status !== 'office' || !L.hand.length || store.splash) return null;
  if ((s.stats.reviewTerm ?? 0) > store.termSeen) return null; // read the newspaper first
  const c = s.countries[s.player];
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 3 ? x : [...x, id]));
  return (
    <div className="scrim legacy-scrim" role="presentation">
      <div className="agenda-draft" role="dialog" aria-label="Choose your agenda">
        <div className="ad-kicker">{L.term === 1 ? `${dateLabel(s.tick)} · Inauguration` : `${ordinal(L.term)} term · ${dateLabel(s.tick)}`}</div>
        <div className="ad-who"><Portrait f={faceFor(c, L.leader, 'leader')} size={64} title={L.leader} /><h2>{L.term === 1 ? `${L.title} ${L.leader}, what will you promise ${c.name}?` : 'A new term. A new agenda.'}</h2></div>
        <p className="ad-sub">Choose up to three promises. Keep them before the next {isFree(c.gov) ? 'election' : 'party congress'} and your legacy grows and voters reward you. Break them and they remember.</p>
        <div className="ad-cards">{L.hand.map((id) => <Card key={id} id={id} picked={sel.includes(id)} onClick={() => toggle(id)} />)}</div>
        <div className="ad-foot">
          <span className="faint">{sel.length} / 3 chosen</span>
          <button className="btn" onClick={() => { store.act((g) => actChooseAgenda(g, [])); setSel([]); }}>Govern without promises</button>
          <button className="btn primary" disabled={!sel.length} onClick={() => { store.act((g) => actChooseAgenda(g, sel)); setSel([]); if (store.speed === 0) store.setSpeed(store.lastSpeed || 1); }}>Swear to this agenda</button>
        </div>
      </div>
    </div>
  );
}

/** The newspaper after each term. */
export function TermReview() {
  useStore();
  const s = store.state;
  const L = s?.legacy;
  if (!s || !L || s.settings.mode !== 'legacy' || store.splash) return null;
  const n = s.stats.reviewTerm ?? 0;
  if (!n || store.termSeen >= n) return null;
  const t = L.terms[n - 1];
  if (!t) return null;
  const c = s.countries[s.player];
  const close = () => { store.termSeen = n; store.notify(); };
  return (
    <div className="scrim legacy-scrim" role="presentation" onClick={close}>
      <article className="gazette-page" onClick={(e) => e.stopPropagation()}>
        <header className="gz-mast"><span>{dateLabel(t.end)}</span><b>The {c.name} Herald</b><span>Term {t.term}</span></header>
        <h2 className="gz-head">{t.headline}</h2>
        <div className="gz-body">
          <div className="gz-col">{t.lines.map((l, i) => <p key={i} className={i === 0 ? 'lead' : ''}>{l}</p>)}</div>
          <aside className="gz-side"><span className="gz-photo"><Portrait f={faceFor(c, L.leader, 'leader')} size={110} title={L.leader} /><small>{L.title} {L.leader}</small></span><div className="gz-grade">Legacy<br /><b className={`grade g-${grade(t.score)}`}>{grade(t.score)}</b><small>{t.score.toFixed(0)} points</small></div></aside>
        </div>
        <button className="btn primary" onClick={close}>{L.status === 'opposition' ? (isFree(c.gov) ? 'Lead the opposition' : 'Go into exile') : L.status === 'ended' ? 'Read the history books' : 'Begin the new term'}</button>
      </article>
    </div>
  );
}

/** Your career dossier (opened from the top-bar chip). */
export function LegacyDossier({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const L = s.legacy!;
  const c = s.countries[s.player];
  const parts = scoreParts(s);
  const score = totalScore(parts);
  const [confirm, setConfirm] = useState(false);
  const yearsIn = (s.tick - L.start.tick) / TICKS_PER_YEAR;
  return (
    <div className="scrim" role="presentation" onClick={onClose}>
      <div className="modal legacy-modal" role="dialog" aria-label="Your legacy" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Your Legacy</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="ld-head">
            <Portrait f={faceFor(c, L.leader, 'leader')} size={84} title={L.leader} />
            <Emblem c={c} size={70} />
            <div className="grow">
              <div className="ld-kicker">{L.status === 'office' ? `${ordinal(L.term)} term · ${yearsIn.toFixed(1)} years` : L.status === 'opposition' ? (isFree(c.gov) ? 'Leader of the opposition' : 'In exile') : 'The career is over'}</div>
              <h3>{L.title} {L.leader}</h3>
              <div className="ld-epithet">“{L.leader.split(' ')[0]} {epithet(s)}”, so far</div>
            </div>
            <div className="ld-grade"><b className={`grade big g-${grade(score)}`}>{grade(score)}</b><small>{score.toFixed(0)} pts</small></div>
          </div>
          <div className="ld-parts">
            {Object.entries(PART_LABEL).map(([k, label]) => {
              const v = parts[k] ?? 0;
              return <div className="ld-part" key={k}><span>{label}</span><div className="bar mid"><i style={{ left: v >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(v) / 8)}%`, width: `${Math.min(50, Math.abs(v) / 8)}%`, background: v >= 0 ? 'var(--teal)' : 'var(--red)' }} /></div><b className={v >= 0 ? 'good' : 'bad'}>{v >= 0 ? '+' : ''}{v.toFixed(0)}</b></div>;
            })}
          </div>
          {L.status === 'office' && (
            <>
              <h4 className="ld-sub">This term's promises · {isFree(c.gov) ? 'election' : 'congress'} {dateLabel(L.nextVote)} · polls {voteShare(s).toFixed(0)}%</h4>
              {L.agenda.length === 0 && <p className="faint">You govern without an agenda this term.</p>}
              <div className="ld-agenda">
                {L.agenda.map((a) => {
                  const card = agendaById(a.id);
                  const pr = card.progress(s, c, a);
                  const launched = !!s.stats[`agact:${a.id}:${L.term}`];
                  return (
                    <div key={a.id} className="ld-card">
                      <Card id={a.id} progress={{ ...pr, done: a.done, failed: a.failed }} />
                      {card.action && !a.done && <button className="btn" disabled={launched} onClick={() => store.act((g) => actAgendaAction(g, a.id))}>{launched ? 'Launched' : card.action.label}<small>{launched ? 'once per term' : `${fmtMoney(card.action.cost * c.eco.gdp)} · ${card.action.desc}`}</small></button>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {L.status === 'opposition' && <OppositionDesk />}
          <h4 className="ld-sub">Career</h4>
          <div className="ld-terms">
            {L.terms.map((t, i) => <div key={i} className={`ld-term r-${t.result}`}><b>{t.result === 'returned' ? '↩' : `T${t.term}`}</b><span>{t.headline}</span><small>{dateLabel(t.start)} – {dateLabel(t.end)}</small></div>)}
            {L.status === 'office' && <div className="ld-term r-now"><b>T{L.term}</b><span>In office</span><small>since {dateLabel(L.termStart)}</small></div>}
          </div>
          <h4 className="ld-sub">Chronicle</h4>
          <ul className="ld-chron">{[...L.chronicle].reverse().slice(0, 14).map((e, i) => <li key={i}><span>{dateLabel(e.tick)}</span>{e.text}</li>)}</ul>
          {L.status !== 'ended' && (
            <div className="btnrow" style={{ marginTop: 12 }}>
              {!confirm ? <button className="btn danger" onClick={() => setConfirm(true)}>Retire from politics<small>end your career now and see the history books</small></button>
                : <button className="btn danger" onClick={() => { store.act((g) => actRetire(g)); onClose(); }}>Yes, step down for good<small>this cannot be undone</small></button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Opposition (or exile) actions while a rival government runs the country. */
export function OppositionDesk() {
  const s = store.state!;
  const L = s.legacy!;
  const c = s.countries[s.player];
  const o = L.opposition!;
  const free = isFree(c.gov);
  return (
    <div className="opp-desk">
      <div className="opp-top">
        <div><small>{free ? 'Your support' : 'Your backing'}</small><b>{o.support.toFixed(0)}%</b></div>
        <div><small>Government approval</small><b>{approval(s, c).toFixed(0)}%</b></div>
        <div><small>{free ? 'Next election' : 'Next chance'}</small><b>{years(Math.max(0, L.nextVote - s.tick))}</b></div>
        <div><small>Chances left</small><b>{2 - o.attempts}</b></div>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }}>{free ? `${o.gov}'s government runs ${c.name} now. Every failure of theirs is your opportunity. Build support above 50% before the vote.` : `${o.gov} rules ${c.name}. From exile, you gather allies for the day you return.`}</p>
      <div className="btnrow">
        {OPP_ACTIONS.map((a) => {
          const left = Math.max(0, (s.stats[`opp:${a.id}`] ?? -999) + a.cd - s.tick);
          return <button key={a.id} className="btn" disabled={left > 0} onClick={() => store.act((g) => actOpposition(g, a.id))}>{free ? a.label : a.exile}<small>{left ? `again in ${left} wk` : a.desc}</small></button>;
        })}
        <button className="btn danger" onClick={() => store.act((g) => actForceVote(g))}>{free ? 'Call a no-confidence vote' : 'Call the people to the streets'}<small>needs 52% support and an unpopular government</small></button>
      </div>
      <button className="linkbtn" onClick={() => store.setSpeed(4)}>Fast-forward towards the vote</button>
    </div>
  );
}

/** The end: how history remembers you. */
export function HistoryBook() {
  useStore();
  const s = store.state;
  const L = s?.legacy;
  if (!s || !L || L.status !== 'ended' || s.settings.mode !== 'legacy' || store.bookSeen || store.splash) return null;
  if ((s.stats.reviewTerm ?? 0) > store.termSeen) return null; // the last newspaper first
  const c = s.countries[s.player];
  const g = grade(L.score);
  const from = START_YEAR + L.start.tick / TICKS_PER_YEAR, to = START_YEAR + s.tick / TICKS_PER_YEAR;
  const inOffice = L.terms.filter((t) => t.result !== 'returned').reduce((t, x) => t + (x.end - x.start), 0) / TICKS_PER_YEAR;
  const kept = Object.values(L.parts).length;
  void kept;
  return (
    <div className="scrim legacy-scrim" role="presentation">
      <article className="history-book" role="dialog" aria-label="The history books">
        <div className="hb-page hb-left">
          <div className="hb-kicker">A History of {c.name}</div>
          <div className="hb-faces"><Portrait f={faceFor(c, L.leader, 'leader')} size={110} title={L.leader} /><Emblem c={c} size={96} /></div>
          <h2>{L.leader}</h2>
          <div className="hb-epithet">{epithet(s)}</div>
          <div className="hb-years">{L.title} · {Math.floor(from)}–{Math.floor(to)}</div>
          <div className={`hb-seal g-${g}`}><b>{g}</b><small>{L.score.toFixed(0)}</small></div>
          <p className="hb-verdict">{verdict(g, L.leader)}</p>
        </div>
        <div className="hb-page hb-right">
          <h3>The Record</h3>
          <div className="hb-stats">
            <div><b>{inOffice.toFixed(1)}</b><small>years in power</small></div>
            <div><b>{L.terms.filter((t) => t.result !== 'returned').length}</b><small>terms</small></div>
            <div><b>{c.alive ? c.provinces.length - L.start.provinces : -L.start.provinces}</b><small>regions gained</small></div>
            <div><b>{(s.warHistory ?? []).filter((r) => r.end >= L.start.tick && (r.a === c.id || r.b === c.id)).length}</b><small>wars fought</small></div>
          </div>
          <div className="hb-parts">{Object.entries(PART_LABEL).map(([k, label]) => <div key={k}><span>{label}</span><b className={(L.parts[k] ?? 0) >= 0 ? 'good' : 'bad'}>{(L.parts[k] ?? 0) >= 0 ? '+' : ''}{(L.parts[k] ?? 0).toFixed(0)}</b></div>)}</div>
          <h3>Chronicle</h3>
          <ul className="hb-chron">{L.chronicle.slice(-12).map((e, i) => <li key={i}><span>{dateLabel(e.tick)}</span>{e.text}</li>)}</ul>
          <p className="hb-end">{L.endReason}</p>
          <div className="btnrow">
            <button className="btn primary" onClick={() => { store.bookSeen = true; store.act((g2) => continueAsSandbox(g2)); }}>Keep playing this world<small>as a sandbox, without the career</small></button>
            <button className="btn" onClick={() => { store.bookSeen = true; store.quitToMenu(); }}>Main menu</button>
          </div>
        </div>
      </article>
    </div>
  );
}

function verdict(g: string, name: string) {
  const n = name.split(' ')[0];
  return ({
    S: `Historians rank ${n} among the great leaders of the age. Schools will be named after them.`,
    A: `${n} left the country stronger and prouder than they found it. A distinguished career.`,
    B: `A capable leader with real achievements, and some regrets.`,
    C: `${n} kept the ship afloat, but few will remember the voyage.`,
    D: `A troubled tenure. ${n}'s promises outweighed the results.`,
    F: `A cautionary tale taught in every school: how not to govern.`,
  } as Record<string, string>)[g] ?? '';
}

export const AGENDA_COUNT = AGENDA.length;
