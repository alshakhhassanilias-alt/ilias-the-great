/** Great Ambitions (great.ts): choose what the nation sets out to become, then follow it stage by stage. */
import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { GREAT, actChooseGreat, greatById, greatOpen } from '../../sim/great';
import { dateLabel } from '../../sim/tick';
import { sfx } from '../../audio';

export function GreatPanel() {
  const s = store.state!;
  const c = s.countries[s.player];
  const st = s.great;
  const [pick, setPick] = useState<string | null>(null);
  const g = st ? greatById(st.id) : undefined;
  if (st && g && st.stage < 3) {
    const stage = g.stages[st.stage];
    const pr = stage.test(s, c, st);
    return (
      <Section title={`Great ambition: ${g.title}`} hint={`stage ${st.stage + 1} of 3`}>
        <div className="great-on">
          <div className="gr-pips">{g.stages.map((x, i) => <span key={i} className={i < st.stage ? 'done' : i === st.stage ? 'now' : ''} title={x.goal}>{i < st.stage ? '★' : i + 1}</span>)}</div>
          <div className="gr-now"><span className="gr-ic" aria-hidden="true">{g.icon}</span><div className="grow"><b>{stage.goal}</b><small>{pr.text} · reward: {stage.reward} · a monument: {stage.monument}</small><div className="desk-bar"><i style={{ width: `${Math.round(pr.value * 100)}%` }} /></div></div></div>
          {st.monuments.length > 0 && <ul className="gr-mons">{st.monuments.map((m, i) => <li key={i}>🏛 {m.name}<small>{dateLabel(m.tick)}</small></li>)}</ul>}
        </div>
      </Section>
    );
  }
  if (!greatOpen(s)) return null;
  const left = GREAT.filter((x) => !st?.done.includes(x.id));
  return (
    <Section title={st?.done.length ? 'A new great ambition' : 'Choose a great ambition'} hint="decades, not years">
      <p className="faint" style={{ fontSize: 12.5, margin: '0 0 8px' }}>What will {c.name} become? Three stages each; every stage is a moment for the nation, a monument in your name and prestige for your house.{st?.done.length ? ` Fulfilled: ${st.done.map((id) => greatById(id)?.title).join(', ')}.` : ''}</p>
      <div className="great-pick">{left.map((x) => (
        <button key={x.id} className={`gr-card ${pick === x.id ? 'on' : ''}`} onClick={() => { setPick(x.id); sfx('select', 3); }}>
          <span className="gr-ic" aria-hidden="true">{x.icon}</span><b>{x.title}</b><small>{x.pitch}</small>
          <ol>{x.stages.map((y, i) => <li key={i}>{y.goal}</li>)}</ol>
        </button>
      ))}</div>
      {pick && <button className="btn primary" onClick={() => { if (store.act((g2) => actChooseGreat(g2, pick)).ok) sfx('begin'); }}>Set out: {greatById(pick)?.title} ▶</button>}
    </Section>
  );
}
