/** Foreign-policy courses: pick a direction for your country and walk it step by step. */
import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { actAbandonCourse, actAdvanceCourse, actStartCourse, courseCost, coursesFor, currentStage, type CourseFx } from '../../sim/courses';
import { orgName } from '../../sim/blocs';
import type { Country, GameState } from '../../sim/types';

/** What a step will do, in words. */
function fxText(s: GameState, c: Country, fx: CourseFx, leaders: number[], old: number[]) {
  const out: string[] = [];
  if (fx.orient) out.push(fx.orient > 0 ? 'leans you West' : 'leans you East');
  if (fx.relTarget) out.push(`relations +${fx.relTarget} with ${leaders.slice(0, 3).map((x) => s.countries[x].name).join(', ')}`);
  if (fx.relOld) out.push(`relations ${fx.relOld} with ${old.slice(0, 2).map((x) => s.countries[x].name).join(', ')}`);
  if (fx.relNeighbors) out.push(`relations +${fx.relNeighbors} with your neighbours`);
  if (fx.hostile) out.push(fx.hostile < 0 ? 'the West stops treating you as an adversary' : 'the West starts treating you as an adversary');
  if (fx.lift) out.push('Western sanctions may be lifted');
  if (fx.treaty?.length) out.push(`${fx.treaty.join(' and ')} agreements`);
  if (fx.treatyNeighbors) out.push('trade agreements with your neighbours');
  if (fx.breakOld) out.push('you leave the old camp\'s organisations');
  if (fx.capital || fx.tfp) out.push('the economy gains');
  if (fx.energy) out.push('more energy');
  if (fx.fac) {
    const f = Object.entries(fx.fac).filter(([, v]) => v);
    if (f.length) out.push(f.map(([k, v]) => `${k} ${(v as number) > 0 ? '+' : ''}${v}`).join(', '));
  }
  if (fx.finale === 'join') out.push('apply to join (the members vote)');
  if (fx.finale?.startsWith('found')) out.push('found an organisation (you name it)');
  void c;
  return out.join(' · ');
}

export function CoursesSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const geo = store.geo;
  const cur = currentStage(s, c, geo);
  const [name, setName] = useState('');
  if (cur && c.course) {
    const k = cur.course, C = c.course;
    const finale = cur.stage.fx.finale?.startsWith('found');
    const suggestion = finale ? orgName(s, cur.stage.fx.finale === 'found-region' ? 'union' : 'economic', c.id, C.neighbors.slice(0, 3), 0, 2) : '';
    return (
      <Section title={`Course: ${k.title}`} hint={`step ${cur.i + 1} of ${k.stages.length}`}>
        <div className="card course-card">
          <div className="hint" style={{ marginBottom: 8 }}>{k.intro}</div>
          <ol className="course-steps">
            {k.stages.map((st, i) => (
              <li key={i} className={i < C.stage ? 'done' : i === C.stage ? 'now' : ''}>
                <b>{st.title}</b>
                {i === C.stage && <><div className="hint">{st.desc}</div><div className="hint course-fx">{fxText(s, c, st.fx, C.leaders, C.old)}</div></>}
                {i === C.stage && cur.running && <div className="course-bar"><i style={{ width: `${100 * (1 - (C.until - s.tick) / st.weeks)}%` }} /><span>{C.until - s.tick} weeks left</span></div>}
              </li>
            ))}
          </ol>
          {!cur.running && finale && (
            <div className="org-name-row">
              <label className="hint" htmlFor="course-org-name">Name your organisation</label>
              <input id="course-org-name" className="org-name-input" value={name} maxLength={40} placeholder={suggestion} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="btnrow" style={{ marginTop: 8 }}>
            {!cur.running && <button className="btn primary" onClick={() => store.act((g) => actAdvanceCourse(g, geo, finale ? (name.trim() || suggestion) : undefined))}>Begin: {cur.stage.title}<small>{courseCost(cur.stage, c)}</small></button>}
            <button className="btn danger" onClick={() => store.act((g) => actAbandonCourse(g))}>Abandon the course<small>reputation −2 · the partners you courted feel misled</small></button>
          </div>
        </div>
      </Section>
    );
  }
  const list = coursesFor(s, c, geo);
  return (
    <Section title="Change course" hint="a multi-step story: who you court, who you leave">
      <div className="list">
        {list.map((k) => {
          const since = s.tick - (s.stats[`courseAt:${c.id}:${k.id}`] ?? -9999);
          const wait = since < 104 ? 104 - since : 0;
          return (
            <div key={k.id} className={`card course-card ${k.ok ? '' : 'off'}`}>
              <div className="row" style={{ border: 'none', padding: 0 }}>
                <div className="grow"><b>{k.icon} {k.title}</b><div className="hint">{k.intro}</div></div>
                <button className="btn primary" disabled={!k.ok || wait > 0} onClick={() => store.act((g) => actStartCourse(g, geo, k.id))}>Set out<small>{!k.ok ? k.why : wait ? `again in ${wait} wk` : `${k.stages.length} steps · ${k.stages.reduce((t, x) => t + x.weeks, 0)} weeks · ${k.stages.reduce((t, x) => t + x.pc, 0)} PC`}</small></button>
              </div>
              <div className="course-path">{k.stages.map((st, i) => <span key={i}>{i + 1}. {st.title}</span>)}</div>
            </div>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>One course at a time. The camp you leave pushes back; factions at home react; the steps of a course add up to a real change of side over two years or so.</div>
    </Section>
  );
}
