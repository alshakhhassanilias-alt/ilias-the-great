/** The political system, and the paths to change it: step by step, with a price and a risk at each step. */
import { store } from '../../state/store';
import { Section } from '../widgets';
import { GOV_LABEL } from '../../sim/alignment';
import { GOV_MEANS, actAbandonReform, actRegimeStep, pathById, pathsFor } from '../../sim/regime';

export function RegimeSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const P = c.politics;
  if (!P || (s.legacy && s.legacy.status !== 'office')) return null;
  const R = P.reform;
  const paths = R ? [pathById(R.path)!] : pathsFor(c);
  const go = (id: string) => { const r = store.act((g) => actRegimeStep(g, id), true); store.toast(r.message, r.ok ? 'info' : 'danger'); };
  return (
    <Section title="The system" hint="change it if you dare: three steps, each a gamble">
      <div className="card regime-now">
        <b>🏛 {c.name}: {GOV_LABEL[c.gov] ?? c.gov}</b>
        <div className="hint">{GOV_MEANS[c.gov] ?? ''}</div>
      </div>
      {paths.map((p) => {
        const stage = R?.path === p.id ? R.stage : 0;
        const st = p.stages[stage];
        const wait = R?.path === p.id ? Math.max(0, R.next - s.tick) : 0;
        const risk = st.risk(s, c);
        return (
          <div className={`card regime-path ${R?.path === p.id ? 'on' : ''}`} key={p.id}>
            <div className="regime-head"><span className="regime-ic">{p.icon}</span><div className="grow"><b>{p.title}</b> <span className="faint">→ {GOV_LABEL[p.to]}</span><div className="hint">{p.pitch}</div></div></div>
            <div className="regime-steps">{p.stages.map((x, i) => <span key={i} className={i < stage ? 'done' : i === stage ? 'now' : ''} title={x.desc}>{i + 1}. {x.title}</span>)}</div>
            <div className="hint"><b>Next: {st.title}.</b> {st.desc}</div>
            <div className="hint">Costs {st.pc} political capital{st.wait ? ` · then ${st.wait} weeks before the next step` : ''}{risk ? <> · <b className="bad">risk {Math.round(risk.p * 100)}%: {risk.what}</b></> : ' · no particular risk right now'}</div>
            {R?.note && R.path === p.id && <div className="faint" style={{ fontSize: 12 }}>{R.note}</div>}
            <div className="btnrow">
              <button className="btn primary" disabled={wait > 0 || P.pc < st.pc} onClick={() => go(p.id)}>{stage === 0 ? 'Begin' : stage === p.stages.length - 1 ? 'Final step' : 'Next step'}<small>{wait > 0 ? `in ${wait} weeks` : P.pc < st.pc ? `needs ${st.pc} capital` : `${st.pc} capital`}</small></button>
              {R?.path === p.id && <button className="btn" onClick={() => store.act((g) => actAbandonReform(g), true)}>Abandon<small>capital spent is lost</small></button>}
            </div>
          </div>
        );
      })}
    </Section>
  );
}
