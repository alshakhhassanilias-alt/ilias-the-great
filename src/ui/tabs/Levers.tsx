/** Levers: ways to raise money (Economy tab) and political capital (Politics tab), each with its price. */
import { store } from '../../state/store';
import { approval } from '../../sim/approval';
import { actLever, fiscalRuleOn, leverViews, ruleTarget, setFiscalRule } from '../../sim/levers';
import { budgetReport } from '../../sim/treasury';

export function LeverList({ kind }: { kind: 'money' | 'pc' }) {
  const s = store.state!;
  const c = s.countries[s.player];
  if (!c.politics || (s.legacy && s.legacy.status !== 'office')) return null;
  const appr = approval(s, c);
  const list = leverViews(s, c, appr).filter((v) => v.kind === kind);
  return (
    <div className={`card levers levers-${kind}`}>
      <div className="fin-kicker">{kind === 'money' ? 'Raise money · each has a price, and a cooldown' : 'Build political capital · each has a price, and a cooldown'}</div>
      {list.map((v) => (
        <div className={`lever ${v.ok ? '' : 'off'}`} key={v.id}>
          <span className="lever-ic">{v.icon}</span>
          <div className="grow">
            <div className="lab">{v.title} <b className="good">{v.gain}</b></div>
            <div className="hint">{v.price}</div>
          </div>
          <button className="btn sm" disabled={!v.ok} title={v.why} onClick={() => store.act((g) => actLever(g, v.id, approval(g, g.countries[g.player])))}>{v.ok ? 'Do it' : v.wait > 0 ? `${v.wait} wk` : 'Locked'}</button>
        </div>
      ))}
    </div>
  );
}

/** The fiscal rule toggle: the finance minister keeps the deficit in check, a little every quarter. */
export function FiscalRule() {
  const s = store.state!;
  const c = s.countries[s.player];
  const on = fiscalRuleOn(s);
  const B = budgetReport(s, c);
  const t = ruleTarget(B.debtPct);
  return (
    <label className={`card fiscal-rule ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => store.act((g) => { setFiscalRule(g, e.target.checked); return { ok: true, message: e.target.checked ? 'Fiscal rule on' : 'Fiscal rule off' }; }, true)} />
      <div className="grow">
        <div className="lab">Fiscal rule {on ? <b className="good">ON</b> : <span className="faint">off</span>}</div>
        <div className="hint">Every quarter the finance minister closes up to 0.4% of GDP of the gap to a {t >= 0 ? `surplus of ${(t * 100).toFixed(1)}%` : `deficit of at most ${(-t * 100).toFixed(1)}%`} of GDP (tighter the higher the debt), half from taxes and half from public services, never past the levels that choke growth. With a big surplus they cut taxes.</div>
      </div>
    </label>
  );
}
