import { store } from '../../state/store';
import { Note, Section, Slider, Stat, MeterRow } from '../widgets';
import { fmtMoney, fmtNum, fog, pct } from '../format';
import { BUDGET_LIMITS, buyEquipment, demobilize, recruit, setAutoAdvance, setBudget, setCommit } from '../../sim/actions';
import { airPower, equipRatio, landPower, manpower, navalPower, strength, strengthIndex, techMult } from '../../sim/military';
import { areAtWar, enemiesOf, isAtWar, warsOf } from '../../sim/relations';
import { assessAttack } from '../../sim/ai';
import { warScore } from '../../sim/war';
import type { Budget } from '../../sim/types';

export function MilitaryTab({ id }: { id: number }) {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[id];
  const m = c.mil, e = c.eco;
  const mine = id === s.player;
  const me = s.countries[s.player];
  const ready = 0.4 + 0.6 * m.readiness;
  const landIdx = (landPower(m) * ready) / 1000;
  const airIdx = (0.8 * airPower(m)) / 1e9;
  const navIdx = (0.4 * navalPower(m)) / 1e9;
  const total = strengthIndex(c);
  const set = (k: keyof Budget, v: number) => store.act((g) => setBudget(g, g.player, k, v), true);
  const rank = [...s.countries].filter((x) => x.alive).sort((a, b) => strength(b) - strength(a)).findIndex((x) => x.id === id) + 1;
  const f = (v: number, key: string) => { const r = fog(s, c, v, key); return `${r.approx ? '≈' : ''}${fmtNum(r.v)}`; };
  const mix = c.budget.milArmy + c.budget.milAir + c.budget.milNavy || 1;
  const upkeep = m.upkeep, budget = c.budget.military * e.gdp;
  const wars = warsOf(s, id);
  const mpool = manpower(c);
  const recruitBtn = (frac: number) => {
    const n = Math.max(1000, Math.round(m.troops * frac / 1000) * 1000);
    const cost = n * m.unitCost * e.price * 0.5;
    return (
      <button key={frac} className="btn" disabled={mpool < 1} onClick={() => store.act((g) => recruit(g, g.player, n))}>
        Recruit +{fmtNum(n)}<small>{fmtMoney(cost)} · instant</small>
      </button>
    );
  };
  const equipBtn = (kind: 'army' | 'air' | 'navy', label: string) => (
    <button key={kind} className="btn" onClick={() => store.act((g) => buyEquipment(g, g.player, kind, 0.0025))}>
      {label}<small>{fmtMoney(0.0025 * e.gdp)} · instant</small>
    </button>
  );

  return (
    <>
      <Section title="Forces" hint={`#${rank} in the world`}>
        <div className="grid2">
          <Stat label="Active troops" value={f(m.troops, 'troops')} sub={mine ? `manpower pool ${fmtNum(mpool)}` : undefined} />
          <Stat label="Power index" value={f(total * 1000, 'idx')} sub={m.nuclear ? '☢ nuclear deterrent' : 'troop-equivalents'} />
          <Stat label="Army" value={f(landIdx * 1000, 'land')} sub={`equipment ${equipRatio(m).toFixed(1)}× benchmark`} />
          <Stat label="Air · Navy" value={`${f(airIdx * 1000, 'air')} · ${f(navIdx * 1000, 'nav')}`} sub={`tech ×${techMult(m).toFixed(2)}`} />
        </div>
        <div className="card" style={{ marginTop: 8 }}>
          <MeterRow label="Readiness" value={m.readiness} color={m.readiness < 0.5 ? 'var(--red)' : 'var(--teal)'} hint="Training and maintenance funding. Low readiness cuts combat power." />
          <MeterRow label="Logistics" value={m.supply} hint="Infrastructure & tech: how far armies can operate from friendly land." />
          <MeterRow label="Intelligence" value={m.intel} color="var(--blue)" hint="Better intel reveals enemy numbers and gives a combat edge." />
          <MeterRow label="War exhaustion" value={m.exhaustion} color={m.exhaustion > 0.6 ? 'var(--red)' : 'var(--amber)'} text={`${(m.exhaustion * 100).toFixed(0)}%`} hint="Rises with casualties, lost territory and damage; forces peace at the extreme." />
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Lifetime casualties: {fmtNum(m.casualties)}. Strength also depends on terrain, distance to the front (supply), air and naval superiority, and economic staying power — not just troop count.</div>
      </Section>

      {mine && (
        <>
          <Section title="Military budget" hint="% of GDP">
            <div className="card">
              <Slider label="Defence spending" value={c.budget.military} min={BUDGET_LIMITS.military[0]} max={BUDGET_LIMITS.military[1]} step={0.0025} format={(v) => pct(v)} onChange={(v) => set('military', v)}
                tone={budget < upkeep ? 'var(--red)' : undefined}
                hint={`${fmtMoney(budget)}/yr. Upkeep (pay + maintenance) ${fmtMoney(upkeep)}; procurement ${fmtMoney(m.procurement)}.`} />
              {budget < upkeep && <Note tone="bad">Budget does not cover upkeep: readiness and equipment will decay.</Note>}
              <Slider label="Intelligence services" value={c.budget.intel} min={0} max={0.015} step={0.0005} format={(v) => pct(v, 2)} onChange={(v) => set('intel', v)} hint={`${fmtMoney(c.budget.intel * e.gdp)}/yr on top of defence spending.`} />
              <div className="faint" style={{ fontSize: 12, padding: '4px 0 0' }}>Procurement mix (of spending above upkeep)</div>
              <Slider label="Army" value={c.budget.milArmy} min={0} max={1} step={0.05} format={() => pct(c.budget.milArmy / mix, 0)} onChange={(v) => set('milArmy', v)} />
              <Slider label="Air force" value={c.budget.milAir} min={0} max={1} step={0.05} format={() => pct(c.budget.milAir / mix, 0)} onChange={(v) => set('milAir', v)} />
              <Slider label="Navy" value={c.budget.milNavy} min={0} max={1} step={0.05} format={() => pct(c.budget.milNavy / mix, 0)} onChange={(v) => set('milNavy', v)} />
            </div>
          </Section>

          <Section title="Raise & equip forces" hint="effects are immediate">
            <div className="btnrow">
              {[0.05, 0.1, 0.25].map(recruitBtn)}
              <button className="btn" onClick={() => store.act((g) => demobilize(g, g.player, Math.max(1000, m.troops * 0.1)))}>Demobilise 10%<small>save pay, return workers</small></button>
            </div>
            <div className="btnrow" style={{ marginTop: 8 }}>
              {equipBtn('army', 'Buy army equipment')}
              {equipBtn('air', 'Buy aircraft')}
              {equipBtn('navy', 'Buy warships')}
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Recruits come from your manpower pool and leave the civilian workforce, so mobilising costs output. Equipment per soldier determines army quality.</div>
          </Section>
        </>
      )}

      {mine && wars.length > 0 && (
        <Section title="Operations">
          <div className="card">
            <Slider label="Offensive commitment" value={m.commit} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => store.act((g) => setCommit(g, g.player, v), true)}
              hint="Share of the army sent on offensive operations. The rest defends; committing more leaves your own front thinner." />
            <label className="check">
              <input type="checkbox" checked={m.autoAdvance} onChange={(e2) => store.act((g) => setAutoAdvance(g, g.player, e2.target.checked), true)} />
              <span>Generals choose targets automatically<br /><span className="faint" style={{ fontSize: 11.5 }}>Turn off to direct the offensive: select the enemy on the map, then click their regions to mark targets ({m.focus.length} marked).</span></span>
            </label>
          </div>
          {wars.map((w) => {
            const score = warScore(s, w, id);
            const enemies = enemiesOf(s, id).filter((x) => w.attackers.includes(x) || w.defenders.includes(x));
            return (
              <div className="card" key={w.id} style={{ marginTop: 8 }}>
                <div className="row" style={{ border: 'none' }}>
                  <div className="grow"><b>{w.name}</b><div className="hint">Year {((s.tick - w.start) / 52).toFixed(1)} · {w.fronts.length} active fronts · war score {score >= 0 ? '+' : ''}{(score * 100).toFixed(0)}</div></div>
                </div>
                {enemies.map((x) => (
                  <div className="row" key={x}>
                    <span className="dot" style={{ background: `hsl(${s.countries[x].color},40%,45%)` }} />
                    <button className="grow" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }} onClick={() => store.select(x, null, true)}>{s.countries[x].name}<div className="hint">exhaustion {(s.countries[x].mil.exhaustion * 100).toFixed(0)}% · {s.countries[x].provinces.length} provinces</div></button>
                    {areAtWar(s, id, x) && <button className="btn" onClick={() => store.openPeace(x)}>Negotiate peace</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </Section>
      )}

      {!mine && me.alive && (() => {
        const atWar = areAtWar(s, id, s.player);
        const a = assessAttack(s, geo, me, c);
        const inv = assessAttack(s, geo, c, me);
        return (
          <Section title="If it came to war">
            <div className="card">
              <div className="row" style={{ border: 'none' }}>
                <div className="grow"><div className="lab">Your attack</div><div className="hint">your forces × supply {pct(a.supply, 0)} vs their defence{a.allies > 0 ? ` incl. allies` : ''}{a.nuclear ? ' · nuclear deterrent ×4' : ''}</div></div>
                <div className={`val ${a.ratio > 1.4 ? 'good' : a.ratio < 0.9 ? 'bad' : 'warn'}`}>{a.ratio.toFixed(2)}×</div>
              </div>
              <div className="row">
                <div className="grow"><div className="lab">Their attack on you</div><div className="hint">supply {pct(inv.supply, 0)} · your defence incl. allies</div></div>
                <div className={`val ${inv.ratio > 1.4 ? 'bad' : inv.ratio < 0.9 ? 'good' : 'warn'}`}>{inv.ratio.toFixed(2)}×</div>
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Ratios above ~1.4 suggest a favourable offensive. Distance, readiness and alliances change the odds; terrain strengthens the defender.</div>
            </div>
            {atWar && <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => store.openPeace(id)}>Negotiate peace</button>}
          </Section>
        );
      })()}
      {!mine && isAtWar(s, id) && <div className="faint" style={{ fontSize: 12 }}>This country is currently fighting {enemiesOf(s, id).map((x) => s.countries[x].name).join(', ')}.</div>}
    </>
  );
}
