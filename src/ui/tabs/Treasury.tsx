/**
 * Government finances, explained: what comes in and goes out every year, what is in the treasury now, how long
 * it lasts, where recent one-off money went, and concrete ways to close a deficit.
 */
import { store } from '../../state/store';
import { Section, Stat } from '../widgets';
import { fmtMoney, pct } from '../format';
import { dateLabel } from '../../sim/tick';
import { budgetReport, DEFICIT_LABEL } from '../../sim/treasury';
import { revenueAnnual } from '../../sim/economy';
import { BUDGET_LIMITS, setBudget } from '../../sim/actions';
import type { Budget, Country, GameState } from '../../sim/types';

interface Fix { key: keyof Budget; label: string; to: number; effect: string }

/** Single-lever ways to close the deficit, each with its side effect. */
export function balanceFixes(s: GameState, c: Country): Fix[] {
  const B = budgetReport(s, c);
  if (B.balance >= 0) return [];
  const gap = -B.balance, e = c.eco, b = c.budget;
  const out: Fix[] = [];
  // revenue per point of a tax, measured on the real tax formula
  const perPoint = (k: 'taxVat' | 'taxIncome') => { const save = b[k]; b[k] = save + 0.01; const r = revenueAnnual(c); b[k] = save; return Math.max(1, r - revenueAnnual(c)); };
  for (const [k, label, warn] of [['taxVat', 'Raise VAT', 0.18], ['taxIncome', 'Raise income tax', 0.3]] as const) {
    const pts = gap / perPoint(k);
    const to = b[k] + pts * 0.01;
    if (to <= BUDGET_LIMITS[k][1]) out.push({ key: k, label: `${label} ${(b[k] * 100).toFixed(1)}% → ${(to * 100).toFixed(1)}%`, to, effect: to > warn ? 'high enough to slow the economy' : 'mild drag on growth; unpopular with business' });
  }
  const soc = b.social - gap / e.gdp;
  if (soc > 0.02) out.push({ key: 'social', label: `Cut public services ${(b.social * 100).toFixed(1)}% → ${(soc * 100).toFixed(1)}% of GDP`, to: soc, effect: `stability about −${Math.min(14, (30 * (gap / e.gdp)) / Math.max(0.01, e.baseSocial)).toFixed(0)}` });
  const mil = b.military - gap / e.gdp;
  if (mil > 0.005) out.push({ key: 'military', label: `Cut defence ${(b.military * 100).toFixed(1)}% → ${(mil * 100).toFixed(1)}% of GDP`, to: mil, effect: 'readiness and equipment decline; the generals object' });
  return out;
}

export function TreasurySection({ c }: { c: Country }) {
  const s = store.state!;
  const e = c.eco;
  const mine = c.id === s.player;
  const B = budgetReport(s, c);
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;
  const deficit = B.balance < 0;
  const runway = !deficit ? `With a surplus, the treasury grows by ${fmtMoney(B.balance)} a year.`
    : B.cash > 0 ? `At this deficit the treasury lasts about ${B.weeksOfCash < 104 ? `${Math.round(B.weeksOfCash)} weeks (until ${dateLabel(s.tick + Math.round(B.weeksOfCash))})` : `${(B.weeksOfCash / 52).toFixed(1)} years`}. After that, the deficit is borrowed automatically.`
    : `The treasury is empty: the deficit (${fmtMoney(-B.balance)} a year) is being borrowed, adding about ${(B.balancePct * -100).toFixed(1)} points of GDP to debt a year.`;
  const fixes = mine && deficit ? balanceFixes(s, c) : [];
  const ledger = (e.ledger ?? []).filter((x) => s.tick - x.t < 52).slice().reverse();
  return (
    <Section title="Government finances" hint="annual figures at today's settings">
      <div className="fin-grid">
        <div className="fin-col">
          <div className="fin-kicker">Every year</div>
          <Stat label="Revenue" value={`${fmtMoney(B.revenue)}/yr`} sub={`${pct(B.revenue / e.gdp)} of GDP`} tip="Taxes collected per year at the current tax rates." />
          <Stat label="Spending" value={`${fmtMoney(B.spending)}/yr`} sub={`services ${fmtMoney(B.services)} · defence ${fmtMoney(B.defence)} · interest ${fmtMoney(B.interest)}`} tip="All budget lines per year, including interest on the debt." />
          <Stat label={deficit ? 'Deficit' : 'Surplus'} value={`${sign(B.balance)}/yr`} tone={deficit ? (B.balancePct < -0.03 ? 'bad' : 'warn') : 'good'} sub={`${pct(Math.abs(B.balancePct))} of GDP · revenue − spending`} tip="Revenue minus spending, per year. A deficit is paid from the treasury, then by borrowing." />
        </div>
        <div className="fin-col">
          <div className="fin-kicker">Right now</div>
          <Stat label="Treasury (cash)" value={mine ? fmtMoney(B.cash) : '—'} tone={mine && B.cash <= 0 ? 'warn' : undefined} sub={mine ? `${pct(B.cash / e.gdp)} of GDP · pays one-off costs first` : undefined} tip="Money in hand. One-off costs (projects, recruitment, decisions) come from here; anything it cannot cover is borrowed." />
          <Stat label="Debt" value={fmtMoney(B.debt)} tone={B.debtPct > 1.5 ? 'bad' : B.debtPct > 0.9 ? 'warn' : undefined} sub={`${pct(B.debtPct, 0)} of GDP · interest ${pct(B.rate)} a year`} tip="Government bonds outstanding. Interest on them is part of spending. Above 250% of GDP nobody lends." />
          <Stat label="Interest" value={`${fmtMoney(B.interest)}/yr`} sub={`${pct(B.interest / Math.max(1, B.revenue), 0)} of revenue`} />
        </div>
      </div>
      {mine && <div className={`fin-runway ${deficit && B.cash <= 0 ? 'bad' : deficit && B.weeksOfCash < 26 ? 'warn' : ''}`}>{runway}</div>}
      {fixes.length > 0 && (
        <div className="card fin-fixes">
          <div className="fin-kicker">Ways to balance the budget (each closes the whole {fmtMoney(-B.balance)} gap on its own)</div>
          {fixes.map((f) => (
            <div className="row" key={f.key}>
              <div className="grow"><div className="lab">{f.label}</div><div className="hint">{f.effect}</div></div>
              <button className="btn sm" onClick={() => store.act((g) => setBudget(g, g.player, f.key, f.to), true)}>Apply</button>
            </div>
          ))}
          <div className="faint" style={{ fontSize: 11 }}>Smaller steps on several levers usually hurt less than one big one. Growth also closes deficits slowly: revenue rises with GDP.</div>
        </div>
      )}
      {mine && (
        <div className="card fin-ledger">
          <div className="fin-kicker">Last 12 months · one-off money{B.autoBorrowedYear > 0 ? ` · ${fmtMoney(B.autoBorrowedYear)} borrowed to cover the deficit` : ''}</div>
          {!ledger.length && <div className="faint" style={{ fontSize: 12 }}>No one-off costs or income yet. Projects, recruitment and decisions with a price will appear here.</div>}
          {ledger.slice(0, 8).map((x, i) => (
            <div className="row" key={i}>
              <div className="grow"><div className="lab">{x.what}</div><div className="hint">{dateLabel(x.t)}{x.what === DEFICIT_LABEL ? ' · this quarter' : ''}{x.borrowed > 0 && x.what !== DEFICIT_LABEL ? ` · ${fmtMoney(x.borrowed)} of it borrowed` : ''}</div></div>
              <div className={`val ${x.amount < 0 ? 'bad' : 'good'}`}>{x.what === DEFICIT_LABEL ? `+${fmtMoney(x.borrowed)} debt` : sign(x.amount)}</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
