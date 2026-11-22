/**
 * The end of a career and the house that goes on: the verdict (the country as you found it and as you left it, what
 * history says, the honours), the succession (three candidates, a name, a face, the house's prestige to spend), the
 * history of the house, and the leader editor.
 */
import { useState } from 'react';
import { store, useStore } from '../state/store';
import { Portrait } from './art/Portrait';
import { Emblem } from './art/Emblem';
import { LookEditor, faceOf, leaderFace } from './LookEditor';
import { fmtMoney } from './format';
import { PERKS, houseName, ordinalWord, reignYears, type Ruler, type Snapshot } from '../sim/dynasty';
import { actChooseSuccessor, actEditLeader, actEndDynasty, continueAsSandbox, grade } from '../sim/legacy';
import { SKILLS } from '../sim/persona';
import { traitById } from '../sim/leaders';
import { sfx } from '../audio';
import type { GameState, Look } from '../sim/types';

type Row = { k: string; label: string; get: (x: Snapshot) => number; fmt: (v: number) => string; better: 'up' | 'down' };
const ROWS: Row[] = [
  { k: 'gdp', label: 'Economy', get: (x) => x.gdp, fmt: (v) => fmtMoney(v), better: 'up' },
  { k: 'gdppc', label: 'Income per person', get: (x) => x.gdppc, fmt: (v) => `$${Math.round(v).toLocaleString()}`, better: 'up' },
  { k: 'pop', label: 'Population', get: (x) => x.pop, fmt: (v) => `${(v / 1e6).toFixed(1)} m`, better: 'up' },
  { k: 'power', label: 'World power', get: (x) => x.power, fmt: (v) => `#${v}`, better: 'down' },
  { k: 'econ', label: 'Economy ranking', get: (x) => x.econ, fmt: (v) => `#${v}`, better: 'down' },
  { k: 'regions', label: 'Territory', get: (x) => x.regions, fmt: (v) => `${v} regions`, better: 'up' },
  { k: 'stability', label: 'Stability', get: (x) => x.stability, fmt: (v) => v.toFixed(0), better: 'up' },
  { k: 'approval', label: 'Approval', get: (x) => x.approval, fmt: (v) => `${v.toFixed(0)}%`, better: 'up' },
  { k: 'debt', label: 'Public debt', get: (x) => x.debt, fmt: (v) => `${(v * 100).toFixed(0)}% of GDP`, better: 'down' },
  { k: 'unemp', label: 'Unemployment', get: (x) => x.unemp, fmt: (v) => `${(v * 100).toFixed(1)}%`, better: 'down' },
  { k: 'rep', label: 'Reputation', get: (x) => x.rep, fmt: (v) => v.toFixed(0), better: 'up' },
  { k: 'allies', label: 'Allies', get: (x) => x.allies, fmt: (v) => `${v}`, better: 'up' },
  { k: 'clients', label: 'Client states', get: (x) => x.clients, fmt: (v) => `${v}`, better: 'up' },
  { k: 'army', label: 'Military strength', get: (x) => x.army, fmt: (v) => `${Math.round(v / 1000)}k`, better: 'up' },
];
/** The country then and now, line by line, with what got better in green. */
export function BeforeAfter({ a, b, labelA = 'When they took office', labelB = 'When they left', limit }: { a: Snapshot; b: Snapshot; labelA?: string; labelB?: string; limit?: number }) {
  const rows = ROWS.map((r) => {
    const va = r.get(a), vb = r.get(b);
    const rel = Math.abs(va) > 1e-9 ? (vb - va) / Math.abs(va) : vb - va;
    const good = r.better === 'up' ? vb > va : vb < va;
    const same = Math.abs(rel) < 0.01 && Math.abs(vb - va) < 0.5;
    return { r, va, vb, good, same, weight: Math.abs(rel) };
  });
  const list = limit ? [...rows].sort((x, y) => y.weight - x.weight).slice(0, limit) : rows;
  return (
    <table className="ba-table">
      <thead><tr><th /><th>{labelA}</th><th aria-hidden="true" /><th>{labelB}</th></tr></thead>
      <tbody>{list.map(({ r, va, vb, good, same }) => (
        <tr key={r.k} className={same ? 'ba-same' : good ? 'ba-up' : 'ba-down'}>
          <th>{r.label}</th><td>{r.fmt(va)}</td><td className="ba-arrow">{same ? '=' : good ? '▲' : '▼'}</td><td><b>{r.fmt(vb)}</b></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** The end of a career: the verdict, the country before and after, the honours, and what comes next. */
export function CareerEnd() {
  useStore();
  const s = store.state;
  const L = s?.legacy;
  const [tab, setTab] = useState<'verdict' | 'country' | 'record'>('verdict');
  if (!s || !L || L.status !== 'ended' || s.settings.mode !== 'legacy' || store.bookSeen || store.splash) return null;
  if ((s.stats.reviewTerm ?? 0) > store.termSeen) return null; // the last newspaper first
  const c = s.countries[s.player];
  const d = s.dynasty;
  const r: Ruler | undefined = d?.rulers[d.rulers.length - 1];
  const g = r?.grade ?? grade(L.score);
  const pend = d?.pending;
  const close = () => { store.bookSeen = true; store.notify(); };
  return (
    <div className="scrim legacy-scrim" role="presentation">
      <article className="career-end" role="dialog" aria-label="The verdict of history">
        <header className="ce-top">
          <div className="ce-faces"><Portrait f={leaderFace(s)} size={104} title={L.leader} /><Emblem c={c} size={70} /></div>
          <div className="grow">
            <div className="ce-kicker">{d ? `${d.gen > 1 ? `The ${ordinalWord(d.gen)} of ${houseName(d, c.gov)}` : `Founder of ${houseName(d, c.gov)}`}` : `A history of ${c.name}`}</div>
            <h2>{L.leader} <span className="ce-epithet">{r?.epithet}</span></h2>
            <div className="ce-years">{L.title} of {c.name}{r ? ` · ${reignYears(r)} · ${r.terms} term${r.terms === 1 ? '' : 's'}` : ''}</div>
            <p className="ce-end">{L.endReason}</p>
          </div>
          <div className={`ce-seal g-${g}`} onAnimationStart={() => sfx('star')}><b>{g}</b><small>{L.score.toFixed(0)} pts</small></div>
        </header>
        <nav className="ce-tabs" role="tablist">
          {([['verdict', 'The verdict'], ['country', 'The country, then and now'], ['record', 'The record']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="ce-body">
          {tab === 'verdict' && (
            <div className="ce-verdict">
              <div className="ce-col">
                <h3>What history says</h3>
                {(r?.verdict.length ? r.verdict : ['The record is too thin for history to judge.']).map((v, i) => <p key={i} style={{ animationDelay: `${0.15 + i * 0.35}s` }}>{v}</p>)}
              </div>
              <div className="ce-col">
                <h3>The nation's honours</h3>
                <ul className="ce-honours">{(r?.honours ?? []).map((h, i) => <li key={i} style={{ animationDelay: `${0.6 + i * 0.3}s` }}>{h}</li>)}</ul>
                {r && <div className="ce-prestige"><b>+{r.prestige}</b><span>prestige for the house<small>{d!.prestige} to pass on</small></span></div>}
              </div>
            </div>
          )}
          {tab === 'country' && r && <BeforeAfter a={r.before} b={r.after} />}
          {tab === 'country' && !r && <p className="faint">This career began before the record was kept.</p>}
          {tab === 'record' && (
            <ul className="hb-chron">{L.chronicle.slice(-16).map((e, i) => <li key={i}><span>{Math.floor(2024 + e.tick / 52)}</span>{e.text}</li>)}</ul>
          )}
        </div>
        <footer className="ce-foot">
          {pend ? <button className="btn primary" onClick={() => { close(); sfx('begin'); }}>Choose who carries the house on ▶<small>three candidates · {d!.prestige} prestige to spend</small></button>
            : <span className="faint">{c.alive ? '' : `${c.name} is gone. The house ends with it.`}</span>}
          <button className="btn" onClick={() => { close(); store.act((g2) => continueAsSandbox(g2)); }}>Keep playing this world<small>as a sandbox: the house ends here</small></button>
          <button className="btn" onClick={() => { close(); store.quitToMenu(); }}>Main menu</button>
        </footer>
      </article>
    </div>
  );
}

/** The succession: three who could carry the house, a name, a face, and the house's prestige to spend. */
export function Succession() {
  useStore();
  const s = store.state;
  const d = s?.dynasty;
  const [idx, setIdx] = useState(0);
  const [names, setNames] = useState<Record<number, string>>({});
  const [looks, setLooks] = useState<Record<number, Look>>({});
  const [perks, setPerks] = useState<string[]>([]);
  const [design, setDesign] = useState(false);
  if (!s || !d?.pending || !store.bookSeen || s.settings.mode !== 'legacy') return null;
  const c = s.countries[s.player];
  const P = d.pending;
  const cand = P.candidates[idx];
  const cost = perks.reduce((t, id) => t + (PERKS.find((p) => p.id === id)?.cost ?? 0), 0);
  const left = d.prestige - cost;
  const look = looks[idx] ?? cand.look;
  const name = names[idx] ?? cand.name;
  const ORIGIN: Record<string, string> = { child: 'Your child', heir: 'Your chosen heir', protege: 'Your protégé', star: 'The rising star', kin: 'Of the royal blood' };
  const go = () => {
    const r = store.act((g) => actChooseSuccessor(g, idx, { name, look, perks }), true);
    if (r.ok) { store.bookSeen = false; store.termSeen = 0; sfx('victory'); }
  };
  return (
    <div className="scrim legacy-scrim" role="presentation">
      <div className="succession" role="dialog" aria-label="The succession">
        <header className="su-top">
          <div className="su-kicker">The succession · {houseName(d, c.gov)} · generation {d.gen + 1}</div>
          <h2>Who carries the house on?</h2>
          <p className="faint">{P.office ? `The house still holds power: your successor takes office at once and faces the next ${c.gov === 'D' || c.gov === 'F' ? 'election' : 'party congress'}.` : 'The house is out of power: your successor leads the opposition and must win it back.'}</p>
        </header>
        <div className="su-cands" role="radiogroup">
          {P.candidates.map((k, i) => (
            <button key={i} role="radio" aria-checked={idx === i} className={`su-card ${idx === i ? 'on' : ''}`} onClick={() => { setIdx(i); setDesign(false); sfx('select', i + 2); }}>
              <Portrait f={faceOf(c, names[i] ?? k.name, looks[i] ?? k.look, k.age)} size={78} title={k.name} />
              <span className="su-origin">{ORIGIN[k.origin]}</span>
              <b>{names[i] ?? k.name}</b>
              <small>age {k.age} · {k.traits.map((t) => traitById(t)?.title ?? t).join(', ')}</small>
              <span className="su-skills">{SKILLS.map((sk) => <i key={sk.id} title={`${sk.name} ${k.skills[sk.id]}`}><em>{sk.icon}</em>{k.skills[sk.id]}</i>)}</span>
              <span className="su-pitch">{k.pitch}</span>
            </button>
          ))}
        </div>
        <div className="su-detail">
          <div className="su-name"><label>Name<input type="text" value={name} maxLength={32} onChange={(e) => setNames({ ...names, [idx]: e.target.value })} /></label>
            <button className="linkbtn" onClick={() => setDesign(!design)}>{design ? 'Done' : 'Change their face'}</button></div>
          {design && <LookEditor c={c} name={name} look={look} age={cand.age} size={92} onChange={(l) => setLooks({ ...looks, [idx]: l })} />}
          <h4 className="ld-sub">The house's prestige: {d.prestige} <small className="faint">earned by the rulers before · {left} left</small></h4>
          <div className="su-perks">{PERKS.map((p) => {
            const on = perks.includes(p.id);
            const can = on || p.cost <= left;
            return <button key={p.id} className={`su-perk ${on ? 'on' : ''}`} disabled={!can} aria-pressed={on} onClick={() => setPerks(on ? perks.filter((x) => x !== p.id) : [...perks, p.id])}><b>{p.label}</b><small>{p.desc}</small><span>{p.cost}</span></button>;
          })}</div>
        </div>
        <footer className="su-foot">
          <button className="btn" onClick={() => store.act((g) => actEndDynasty(g))}>Let the house end<small>keep watching the world</small></button>
          <button className="btn primary" onClick={go}>Take up the mantle as {name.split(' ')[0]} ▶</button>
        </footer>
      </div>
    </div>
  );
}

/** The history of the house: every ruler, their grade and the country they left. */
export function DynastyPanel({ s }: { s: GameState }) {
  const d = s.dynasty;
  const c = s.countries[s.player];
  const [open, setOpen] = useState<number | null>(null);
  if (!d || !d.rulers.length) return null;
  return (
    <div className="dyn-panel">
      <h4 className="ld-sub">{houseName(d, c.gov)} · {d.rulers.length + (s.legacy?.status !== 'ended' ? 1 : 0)} generation{d.rulers.length ? 's' : ''} · prestige {d.prestige}</h4>
      <ol className="dyn-list">
        {d.rulers.map((r, i) => (
          <li key={i} className={open === i ? 'open' : ''}>
            <button className="dyn-row" onClick={() => setOpen(open === i ? null : i)}>
              <Portrait f={faceOf(c, r.name, r.look)} size={40} title={r.name} />
              <span className="grow"><b>{r.name}</b> <em>{r.epithet}</em><small>{r.title} · {reignYears(r)} · {r.terms} term{r.terms === 1 ? '' : 's'}</small></span>
              <b className={`grade g-${r.grade}`}>{r.grade}</b>
            </button>
            {open === i && <div className="dyn-more">{r.verdict.slice(0, 3).map((v, j) => <p key={j}>{v}</p>)}<BeforeAfter a={r.before} b={r.after} limit={6} /></div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Rename your leader or redesign their face, at any time. */
export function LeaderEditor({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const L = s.legacy!;
  const c = s.countries[s.player];
  const [name, setName] = useState(L.leader);
  const [look, setLook] = useState<Look>(L.look ?? {});
  return (
    <div className="scrim" role="presentation" onClick={onClose}>
      <div className="modal leader-ed" role="dialog" aria-label="Your leader" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Your leader</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <label className="le-name">Name<input type="text" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></label>
          <LookEditor c={c} name={name} look={look} age={L.persona?.age} onChange={setLook} />
          <div className="btnrow"><button className="btn primary" onClick={() => { store.act((g) => actEditLeader(g, name, look)); onClose(); }}>Save</button><button className="btn" onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
