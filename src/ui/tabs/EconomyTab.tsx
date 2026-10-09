import { useState } from 'react';
import { store } from '../../state/store';
import { Note, Section, Segmented, Slider, Stat, MeterRow } from '../widgets';
import { fmtMoney, fmtNum, pct, signed, signedPct } from '../format';
import { LineChart } from '../LineChart';
import { drags, drivers, growthNarrative } from '../explain';
import { BUDGET_LIMITS, borrow, buildProject, printMoney, repayDebt, setBudget, type Project } from '../../sim/actions';
import { fiscalNow, revenueAnnual, taxBurden, taxFactor } from '../../sim/economy';
import type { Budget } from '../../sim/types';
import { partnersOf, sanctionLevel } from '../../sim/relations';
import { fog } from '../format';

const PRESETS = [0.0025, 0.005, 0.01, 0.02];

export function EconomyTab({ id }: { id: number }) {
  const s = store.state!;
  const c = s.countries[id];
  const e = c.eco;
  const mine = id === s.player;
  const [preset, setPreset] = useState(0.01);
  const set = (k: keyof Budget, v: number) => store.act((g) => setBudget(g, g.player, k, v), true);
  const fn = fiscalNow(c, s);
  const rev = fn.revenue, spend = fn.spending, bal = fn.balance;
  const dr = drivers(c);
  const maxAbs = Math.max(0.01, ...dr.map((d) => Math.abs(d.v)));
  const trade = e.exports - e.imports;
  const energyBal = e.energyCap / Math.max(1, e.energyDemand);
  const foodBal = e.foodCap / Math.max(1, e.foodDemand);
  const partners = partnersOf(s, id, 'trade');
  const burden = taxBurden(c.budget) * e.collection;
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const cost = (p: number) => fmtMoney(p * e.gdp);
  const proj = (k: Project, label: string, sub: string) => (
    <button key={k} className="btn" onClick={() => store.act((g) => buildProject(g, g.player, k, preset))}>
      {label}<small>{sub} · {cost(preset)}</small>
    </button>
  );
  const gdp = fog(s, c, e.gdp, 'gdp2');

  return (
    <>
      <Section title="Why is the economy moving?" hint={`growth ${signedPct(e.growth)}`}>
        <Note>{growthNarrative(c)}</Note>
        <div className="card" style={{ marginTop: 8 }}>
          <div className="explain">
            {dr.map((d) => (
              <div key={d.key} style={{ display: 'contents' }}>
                <div>
                  <div style={{ fontSize: 12.5, marginBottom: 3 }}>{d.label}</div>
                  <div className="track"><i style={{ background: d.v >= 0 ? 'var(--green)' : 'var(--red)', left: d.v >= 0 ? '50%' : `${50 - (Math.abs(d.v) / maxAbs) * 50}%`, width: `${(Math.abs(d.v) / maxAbs) * 50}%` }} /></div>
                </div>
                <div className={`num ${d.v >= 0 ? 'good' : 'bad'}`} style={{ textAlign: 'right', fontWeight: 600 }}>{signed(d.v * 100, 2)} pts</div>
              </div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Annualised contribution to real GDP growth (percentage points). Output = Technology × Capital^0.35 × Labour^0.65 × infrastructure, energy, trade, stability, tax and war factors.</div>
        </div>
        {mine && drags(c, s).length > 0 && (
          <div className="card" style={{ marginTop: 8 }}>
            {drags(c, s).map((d) => (
              <div className="row" key={d.label} title={d.tip}>
                <div className="grow"><div className="lab">{d.label}</div><div className="hint">{d.tip}</div></div>
                <div className="val bad">{d.pct.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Productive capacity" hint="the real economy">
        <div className="grid3">
          <Stat label="Workforce" value={fmtNum(e.laborForce)} sub={`${fmtNum(Math.max(0, e.laborForce * (1 - e.unemployment) - c.mil.troops * 0.9))} employed`} />
          <Stat label="Industry" value={fmtMoney(e.capital)} sub={`capital stock · ${(e.capital / e.realGdp).toFixed(1)}× GDP`} />
          <Stat label="Productivity" value={`${((e.tfp / (e.prev.tfp0 ?? e.tfp)) * 100).toFixed(0)}`} sub="index (start = 100)" />
          <Stat label="Infrastructure" value={`${e.infra.toFixed(0)}/100`} sub={e.infra < 40 ? 'holding you back' : e.infra > 65 ? 'a strength' : 'adequate'} />
          <Stat label="Technology" value={`${e.tech.toFixed(0)}/100`} sub={`military tech ${c.mil.milTech.toFixed(0)}`} />
          <Stat label="Unemployment" value={pct(e.unemployment)} sub={`normal ${pct(e.uNat)}`} tone={e.unemployment > e.uNat + 0.03 ? 'bad' : undefined} />
        </div>
      </Section>

      <Section title="Government finances" hint="per year">
        <div className="grid2">
          <Stat label="Revenue" value={fmtMoney(rev)} sub={`${pct(rev / e.gdp)} of GDP`} />
          <Stat label="Spending" value={fmtMoney(spend)} sub={`incl. interest ${fmtMoney(e.interest)}`} />
          <Stat label="Balance" value={`${bal >= 0 ? '+' : ''}${fmtMoney(bal)}`} tone={bal < 0 ? 'bad' : 'good'} sub={`${signedPct(bal / e.gdp)} of GDP`} />
          <Stat label="Treasury" value={mine ? fmtMoney(e.cash) : '—'} sub={`debt ${fmtMoney(e.debt)} (${pct(e.debt / e.gdp, 0)})`} />
        </div>
        <div className="grid3" style={{ marginTop: 8 }}>
          <Stat label="GDP" value={`${gdp.approx ? '≈' : ''}${fmtMoney(gdp.v)}`} />
          <Stat label="Interest rate" value={pct(e.avgRate)} />
          <Stat label="Tax burden" value={pct(burden, 0)} sub="of GDP" />
        </div>
      </Section>

      {mine && (
        <>
          <Section title="Taxes" hint="immediate effect on revenue">
            <div className="card">
              <Slider label="Income tax" value={c.budget.taxIncome} min={BUDGET_LIMITS.taxIncome[0]} max={BUDGET_LIMITS.taxIncome[1]} step={0.005} format={fmtPct} onChange={(v) => set('taxIncome', v)}
                hint={`Yields ≈ ${fmtMoney(0.5 * c.budget.taxIncome * e.collection * e.gdp)}/yr. Above ~30% it discourages work.`} />
              <Slider label="Corporate tax" value={c.budget.taxCorporate} min={0} max={0.6} step={0.005} format={fmtPct} onChange={(v) => set('taxCorporate', v)}
                hint={`Yields ≈ ${fmtMoney(0.2 * c.budget.taxCorporate * e.collection * e.gdp)}/yr. Above ~25% it reduces private investment.`} />
              <Slider label="Consumption tax (VAT)" value={c.budget.taxVat} min={0} max={0.35} step={0.0025} format={fmtPct} onChange={(v) => set('taxVat', v)}
                hint={`Yields ≈ ${fmtMoney(0.55 * c.budget.taxVat * e.collection * e.gdp)}/yr. Above ~18% it suppresses spending.`} />
              <div className="row"><div className="grow lab">Total burden / output drag</div><div className="val">{pct(burden, 1)} · <span className={taxFactor(c.budget, e.collection) < 0.99 ? 'bad' : 'good'}>{signed((taxFactor(c.budget, e.collection) - 1) * 100, 1)}%</span></div></div>
              <div className="faint" style={{ fontSize: 11 }}>Revenue now {fmtMoney(revenueAnnual(c))}/yr. Collection efficiency {pct(e.collection, 0)} (informal economy leaks the rest).</div>
            </div>
          </Section>

          <Section title="Government spending" hint="% of GDP">
            <div className="card">
              <Slider label="Public services & pensions" value={c.budget.social} min={0} max={0.35} step={0.0025} format={fmtPct} onChange={(v) => set('social', v)}
                hint={`${fmtMoney(c.budget.social * e.gdp)}/yr · baseline ${pct(e.baseSocial)}. Cutting it saves money but erodes stability and population health.`} />
              <Slider label="Infrastructure" value={c.budget.infra} min={0} max={0.12} step={0.0025} format={fmtPct} onChange={(v) => set('infra', v)}
                hint={`${fmtMoney(c.budget.infra * e.gdp)}/yr · quality ${e.infra.toFixed(0)}/100. Underfunding lets roads, ports and grids decay.`} />
              <Slider label="Industrial policy" value={c.budget.industry} min={0} max={0.12} step={0.0025} format={fmtPct} onChange={(v) => set('industry', v)}
                hint={`${fmtMoney(c.budget.industry * e.gdp)}/yr into factories and power capacity.`} />
              <Slider label="Education & research" value={c.budget.education} min={0} max={0.12} step={0.0025} format={fmtPct} onChange={(v) => set('education', v)}
                hint={`${fmtMoney(c.budget.education * e.gdp)}/yr · tech level ${e.tech.toFixed(0)}. Drives long-run productivity.`} />
              <div className="faint" style={{ fontSize: 11 }}>Military and intelligence budgets are on the Military tab.</div>
            </div>
          </Section>

          <Section title="Instant projects" hint="built immediately">
            <div style={{ marginBottom: 8 }}>
              <Segmented value={preset} onChange={setPreset} label="Project size"
                options={PRESETS.map((p) => ({ v: p, label: `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}% GDP` }))} />
            </div>
            <div className="btnrow">
              {proj('industry', 'Build factories', 'raises capital stock')}
              {proj('infra', 'Upgrade infrastructure', `quality ${e.infra.toFixed(0)}`)}
              {proj('energy', 'Build power plants', `supply ${(energyBal * 100).toFixed(0)}% of demand`)}
              {proj('farms', 'Expand farms & logistics', `food ${(foodBal * 100).toFixed(0)}% of demand`)}
              {proj('research', 'Fund R&D programme', `tech ${e.tech.toFixed(0)}`)}
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Paid from the treasury ({fmtMoney(e.cash)}); any shortfall is borrowed automatically.</div>
          </Section>

          <Section title="Treasury">
            <div className="btnrow">
              <button className="btn" onClick={() => store.act((g) => borrow(g, g.player, 0.02))}>Borrow 2% GDP<small>{fmtMoney(0.02 * e.gdp)} at {pct(e.avgRate)}</small></button>
              <button className="btn" disabled={e.cash <= 0 || e.debt <= 0} onClick={() => store.act((g) => repayDebt(g, g.player, 0.02))}>Repay up to 2% GDP<small>from the treasury</small></button>
              <button className="btn danger" onClick={() => store.act((g) => printMoney(g, g.player, 0.01))}>Print 1% GDP<small>inflation + unrest</small></button>
            </div>
          </Section>
        </>
      )}

      <Section title="Trade & resources" hint={`${partners.length} trade agreement${partners.length === 1 ? '' : 's'}`}>
        <div className="grid2">
          <Stat label="Exports" value={fmtMoney(e.exports)} sub={`${pct(e.exports / e.gdp, 0)} of GDP`} />
          <Stat label="Imports" value={fmtMoney(e.imports)} />
          <Stat label="Trade balance" value={`${trade >= 0 ? '+' : ''}${fmtMoney(trade)}`} tone={trade < 0 ? 'warn' : 'good'} sub={`${signedPct(trade / e.gdp)} of GDP`} />
          <Stat label="Trade access" value={pct(e.tradeIndex, 0)} sub={e.sanctionShare > 0.01 ? `sanctioned ${pct(e.sanctionShare, 0)}` : 'vs. baseline'} tone={e.tradeIndex < 0.9 ? 'bad' : e.tradeIndex > 1.05 ? 'good' : undefined} />
        </div>
        <div className="card" style={{ marginTop: 8 }}>
          <MeterRow label="Energy self-sufficiency" value={Math.min(1, energyBal)} text={`${(energyBal * 100).toFixed(0)}%`} color={energyBal >= 1 ? 'var(--green)' : energyBal > 0.6 ? 'var(--amber)' : 'var(--red)'} hint="Domestic energy production ÷ demand" />
          <MeterRow label="Food self-sufficiency" value={Math.min(1, foodBal)} text={`${(foodBal * 100).toFixed(0)}%`} color={foodBal >= 1 ? 'var(--green)' : foodBal > 0.6 ? 'var(--amber)' : 'var(--red)'} />
          <div className="faint" style={{ fontSize: 11, padding: '6px 0 0' }}>World prices — energy {s.market.priceE.toFixed(2)}×, food {s.market.priceF.toFixed(2)}×. Shortfalls are imported unless embargoed or blockaded; unmet demand cuts output.</div>
        </div>
        {partners.length > 0 && (
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Partners: {partners.slice(0, 8).map((p) => s.countries[p].name).join(', ')}{partners.length > 8 ? '…' : ''}</div>
        )}
        {s.countries.some((o) => o.alive && o.id !== id && (sanctionLevel(s, o.id, id) > 0)) && (
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Sanctioned by: {s.countries.filter((o) => o.alive && sanctionLevel(s, o.id, id) > 0).slice(0, 8).map((o) => o.name).join(', ')}</div>
        )}
      </Section>

      <Section title="Trends">
        <div className="card">
          {mine ? (
            <>
              <LineChart endTick={s.tick} series={[{ label: 'GDP', color: 'var(--teal)', data: c.hist.gdp, fmt: (v) => fmtMoney(v) }]} />
              <div style={{ height: 8 }} />
              <LineChart endTick={s.tick} series={[{ label: 'Debt / GDP', color: 'var(--red)', data: c.hist.debt.map((v) => v * 100), fmt: (v) => `${v.toFixed(0)}%` }]} height={80} />
              <div style={{ height: 8 }} />
              <LineChart endTick={s.tick} zeroLine series={[
                { label: 'Inflation', color: 'var(--amber)', data: c.hist.infl.map((v) => v * 100), fmt: (v) => `${v.toFixed(1)}%` },
                { label: 'Unemployment', color: 'var(--blue)', data: c.hist.unemp.map((v) => v * 100), fmt: (v) => `${v.toFixed(1)}%` },
              ]} height={90} />
            </>
          ) : <LineChart endTick={s.tick} series={[{ label: 'GDP', color: 'var(--teal)', data: c.hist.gdp, fmt: (v) => fmtMoney(v) }]} />}
        </div>
      </Section>
    </>
  );
}
