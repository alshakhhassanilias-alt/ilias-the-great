/**
 * Operations on screen: the operation under way (its objective, commander, the front, the staff estimate and what has
 * happened so far) in the Military tab and on the war strip, and the planner: objective, commander, force,
 * preparation, deception and support, with the staff estimate updating as you plan.
 */
import { useState } from 'react';
import { store, useStoreSelect } from '../state/store';
import { Section, Meter } from './widgets';
import { dateLabel } from '../sim/tick';
import { fmtMoney } from './format';
import { gtrait, stars } from '../sim/generals';
import { airSuperiority } from '../sim/war';
import { FORCE, OP_KIND, actCancelOperation, actPlanOperation, activeOp, generalFit, opEstimate, opTargets, planPower, type Deception, type Force, type Plan, type Support } from '../sim/operations';
import { sfx } from '../audio';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The operation under way, or the way to plan one (Military tab, while at war). */
export function OperationsSection() {
  useStoreSelect(() => { const s = store.state; const o = s ? activeOp(s) : undefined; return `${s?.tick}|${o?.status ?? ''}|${o?.beats.length ?? 0}|${s?.operations?.length ?? 0}`; });
  const s = store.state!;
  const P = s.countries[s.player];
  const atWar = s.wars.some((w) => w.attackers.includes(P.id) || w.defenders.includes(P.id));
  const o = activeOp(s);
  const past = (s.operations ?? []).filter((x) => x.status === 'won' || x.status === 'failed').slice(-4).reverse();
  if (!atWar && !past.length) return null;
  const w = o ? s.wars.find((x) => x.id === o.war) : undefined;
  const f = o && w ? w.fronts.find((x) => x.prov === o.target && (o.kind === 'hold' ? x.by !== P.id : x.by === P.id)) : undefined;
  const g = o ? P.generals?.find((x) => x.id === o.general) : undefined;
  const place = (p: number) => store.geo.provinces[p]?.name || 'the region';
  return (
    <Section title="⚔ Operations" hint={o ? `${o.name} · ${o.status === 'preparing' ? `launch in ${o.launch - s.tick} wk` : `${Math.max(0, o.until - s.tick)} wk to the deadline`}` : atWar ? 'plan the war, do not just watch it' : 'the record'}>
      {o ? (
        <div className={`op-card ${o.status}`}>
          <div className="op-head">
            <span className="op-ic" aria-hidden>{OP_KIND[o.kind].icon}</span>
            <div className="grow"><b>{o.name}</b><small>{OP_KIND[o.kind].name}: {place(o.target)} · against {s.countries[o.enemy].name} · {g ? `${g.name} ${'★'.repeat(stars(g))} ${gtrait(g.trait).title}` : ''}</small></div>
            <span className="op-est" title="your staff's estimate when the plan was approved">{pct(o.est)}</span>
          </div>
          {o.status === 'running' && <><Meter value={o.kind === 'hold' ? 1 - (f?.progress ?? 0) : f?.progress ?? 0} color={o.kind === 'hold' ? 'var(--teal)' : 'var(--accent)'} /><div className="op-meta faint">{o.kind === 'hold' ? `The enemy has ${pct(f?.progress ?? 0)} of the way` : `${pct(f?.progress ?? 0)} of the way to the objective`} · attack ×{o.boost.toFixed(2)} · {FORCE[o.force].name.toLowerCase()}</div></>}
          {o.status === 'preparing' && <div className="op-meta faint">Preparing: {o.launch - s.tick} weeks to H-hour. The longer the wait, the likelier the enemy finds out.</div>}
          <ul className="op-beats">{[...o.beats].reverse().slice(0, 5).map((b, i) => <li key={i} className={b.tone}><small>{dateLabel(b.tick)}</small>{b.text}</li>)}</ul>
          <button className="linkbtn" onClick={() => store.act((x) => actCancelOperation(x))}>Call it off</button>
        </div>
      ) : atWar ? (
        <button className="btn primary op-plan-btn" onClick={() => store.openDrawer('operation')}>Plan an operation<small>an objective, a commander, a force, a date: and your staff's odds</small></button>
      ) : null}
      {past.length > 0 && <ul className="op-past">{past.map((x) => <li key={x.id} className={x.status}>{x.status === 'won' ? '🎖' : '💀'} <b>{x.name}</b> · {OP_KIND[x.kind].name.toLowerCase()}: {place(x.target)} · {dateLabel(x.until)}</li>)}</ul>}
    </Section>
  );
}

export function OperationPlanner({ onClose }: { onClose: () => void }) {
  useStoreSelect(() => `${store.state?.tick}|${store.actSeq}`);
  const s = store.state!;
  const geo = store.geo;
  const P = s.countries[s.player];
  const targets = opTargets(s, geo);
  const gens = (P.generals ?? []).filter((g) => g.status === 'active');
  const [ti, setTi] = useState(0);
  const [gid, setGid] = useState<number>(gens[0]?.id ?? -1);
  const [force, setForce] = useState<Force>('standard');
  const [prep, setPrep] = useState(4);
  const [dec, setDec] = useState<Deception>('none');
  const [sup, setSup] = useState<Support[]>([]);
  const t = targets[ti] ?? targets[0];
  const close = (
    <div className="modal-head"><h2>⚔ Plan an operation</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
  );
  if (!t || !gens.length) return (
    <div className="scrim" role="presentation" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}>{close}<div className="modal-body"><p className="muted">{!gens.length ? 'You have no commanders yet.' : 'No objective is within reach on any of your fronts right now.'}</p></div></div></div>
  );
  const plan: Plan = { kind: t.kind, target: t.prov, war: t.war.id, enemy: t.enemy, general: gid, force, prep: t.kind === 'hold' ? Math.min(prep, 0) : prep, deception: dec, support: sup };
  const pp = planPower(s, plan);
  const est = opEstimate(s, geo, plan);
  const air = airSuperiority(P, s.countries[t.enemy]);
  const go = () => { const r = store.act((g) => actPlanOperation(g, geo, plan)); if (r.ok) { sfx('drums'); onClose(); } };
  return (
    <div className="scrim op-scrim" role="presentation" onClick={onClose}>
      <div className="modal op-modal" role="dialog" aria-label="Plan an operation" onClick={(e) => e.stopPropagation()}>
        {close}
        <div className="modal-body">
          <h4>1 · The objective</h4>
          <div className="op-grid">
            {targets.map((x, i) => (
              <button key={x.prov} className={`op-opt ${ti === i ? 'on' : ''}`} onClick={() => setTi(i)}>
                <span className="oo-top"><span aria-hidden>{OP_KIND[x.kind].icon}</span><b>{x.name}</b><em>{OP_KIND[x.kind].name}</em></span>
                <small>{x.kind === 'hold' ? `${s.countries[x.enemy].name} has ${pct(x.progress)} of the way` : `held by ${s.countries[x.enemy].name}${x.progress > 0 ? ` · your front: ${pct(x.progress)}` : ''}`}</small>
              </button>
            ))}
          </div>
          <p className="faint op-desc">{OP_KIND[t.kind].desc} About {OP_KIND[t.kind].weeks} weeks once launched.</p>
          <h4>2 · The commander</h4>
          <div className="op-grid">
            {gens.map((g) => { const fit = generalFit(g, t.kind); return (
              <button key={g.id} className={`op-opt ${gid === g.id ? 'on' : ''}`} onClick={() => setGid(g.id)}>
                <span className="oo-top"><b>{g.name}</b><em>×{fit.mult.toFixed(2)}</em></span><small>{fit.why}{g.wins ? ` · ${g.wins} victor${g.wins > 1 ? 'ies' : 'y'}` : ''}</small>
              </button>); })}
          </div>
          <h4>3 · The force</h4>
          <div className="op-row">{(Object.keys(FORCE) as Force[]).map((k) => <button key={k} className={`op-opt ${force === k ? 'on' : ''}`} onClick={() => setForce(k)}><b>{FORCE[k].name}</b><small>{FORCE[k].desc}</small></button>)}</div>
          {t.kind !== 'hold' && <>
            <h4>4 · When</h4>
            <div className="op-row">{[0, 4, 8].map((w) => { const lk = planPower(s, { ...plan, prep: w }).leak; return <button key={w} className={`op-opt ${prep === w ? 'on' : ''}`} onClick={() => setPrep(w)}><b>{w === 0 ? 'Now' : `In ${w} weeks`}</b><small>{w === 0 ? 'Surprise of speed; no preparation' : `+${Math.round(5.5 * w)}% from preparation · ${pct(lk)} chance they find out`}</small></button>; })}</div>
            <h4>5 · Deception</h4>
            <div className="op-row">
              <button className={`op-opt ${dec === 'none' ? 'on' : ''}`} onClick={() => setDec('none')}><b>None</b><small>Straight at them</small></button>
              <button className={`op-opt ${dec === 'feint' ? 'on' : ''}`} onClick={() => setDec('feint')}><b>A feint elsewhere</b><small>Surprise up, leaks halved · {fmtMoney(0.0005 * P.eco.gdp)}</small></button>
              <button className={`op-opt ${dec === 'radio' ? 'on' : ''}`} onClick={() => setDec('radio')}><b>Radio deception</b><small>{P.mil.intel >= 0.45 ? 'Your intelligence services can pull it off' : 'Your intelligence services are not good enough: little effect'}</small></button>
            </div>
          </>}
          <h4>{t.kind === 'hold' ? '4' : '6'} · Support</h4>
          <div className="op-row">
            <button className={`op-opt ${sup.includes('air') ? 'on' : ''}`} onClick={() => setSup(sup.includes('air') ? sup.filter((x) => x !== 'air') : [...sup, 'air'])}><b>Air cover</b><small>{air > 0 ? `You own the sky (${Math.round(air * 100)}): a real edge` : 'They own the sky: it will cost you planes for little'}</small></button>
            <button className={`op-opt ${sup.includes('guns') ? 'on' : ''}`} onClick={() => setSup(sup.includes('guns') ? sup.filter((x) => x !== 'guns') : [...sup, 'guns'])}><b>A barrage</b><small>+12% · {fmtMoney(0.0005 * P.eco.gdp)} of shells</small></button>
          </div>
          <div className="op-est-box">
            <div><small>Your staff estimate</small><b>{pct(est.lo)}–{pct(est.hi)}</b><em>{est.hi - est.lo > 0.3 ? 'your intelligence is thin: a wide guess' : 'a confident estimate'}</em></div>
            <div className="op-est-bar"><i style={{ left: pct(est.lo), width: pct(est.hi - est.lo) }} /><u style={{ left: pct(est.p) }} /></div>
            <div className="op-est-meta faint">Attack ×{pp.mult.toFixed(2)} on the objective{pp.cost > 0 ? ` · ${fmtMoney(pp.cost)}` : ''}{pp.notes.length ? ` · ${pp.notes.join(' · ')}` : ''}</div>
          </div>
          <button className="btn primary op-go" onClick={go}>{plan.prep ? `Approve: launch in ${plan.prep} weeks` : 'Launch now'}<small>one operation at a time · a crisis will come to your desk once it is under way</small></button>
        </div>
      </div>
    </div>
  );
}
