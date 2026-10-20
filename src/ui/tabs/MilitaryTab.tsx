import { GOALS_META, PROGRAMMES, actMissileStrike, actStartProgramme, goalOf, hasProg } from '../../sim/wargoals';
import { nationalColor } from '../../map/palette';
import { store } from '../../state/store';
import { AutopilotBanner } from '../Autopilot';
import { ArmyGroups } from '../ArmyPanel';
import { ctl } from '../../sim/modes';
import { Meter, Note, Section, Slider, Stat, MeterRow } from '../widgets';
import { fmtMoney, fmtNum, fog, pct } from '../format';
import { actAirstrike, actCallAllies, actTotalMobilization, actWarEconomy, BUDGET_LIMITS, buyEquipment, demobilize, recruit, setAutoAdvance, setBudget, setCommit } from '../../sim/actions';
import { airPower, equipRatio, inventory, landPower, manpower, navalPower, strength, strengthIndex, techMult } from '../../sim/military';
import { areAtWar, enemiesOf, isAtWar, warsOf } from '../../sim/relations';
import { assessAttack } from '../../sim/ai';
import { warScore } from '../../sim/war';
import type { Budget } from '../../sim/types';
import { HighCommand, HomeFront, SupplyLines, supTone } from './HomeFront';
import { warSupport } from '../../sim/warsupport';
import { fundingText } from '../../sim/treasury';
import { dateLabel } from '../../sim/tick';

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
        Recruit +{fmtNum(n)}<small>{fundingText(c, cost)} · instant</small>
      </button>
    );
  };
  const equipBtn = (kind: 'army' | 'air' | 'navy', label: string) => (
    <button key={kind} className="btn" onClick={() => store.act((g) => buyEquipment(g, g.player, kind, 0.0025))}>
      {label}<small>{fmtMoney(0.0025 * e.gdp)} · instant</small>
    </button>
  );

  const milCtl = ctl(s, 'military');
  return (
    <>
      {mine && <AutopilotBanner area="military" />}
      <Section title="Forces" hint={`#${rank} in the world`}>
        <div className="grid2">
          <Stat label="Active troops" value={f(m.troops, 'troops')} sub={mine ? `manpower pool ${fmtNum(mpool)}` : undefined} />
          <Stat label="Power index" value={f(total * 1000, 'idx')} sub={m.nuclear ? '☢ nuclear deterrent' : 'troop-equivalents'} />
          <Stat label="Army" value={f(landIdx * 1000, 'land')} sub={`equipment ${equipRatio(m).toFixed(1)}× benchmark`} />
          <Stat label="Air · Navy" value={`${f(airIdx * 1000, 'air')} · ${f(navIdx * 1000, 'nav')}`} sub={`tech ×${techMult(m).toFixed(2)}`} />
        </div>
        {(() => {
          const inv = inventory(m);
          const it = (icon: string, n: number, label: string) => <div className="inv"><span aria-hidden="true">{icon}</span><b>{f(n, `inv${label}`)}</b><small>{label}</small></div>;
          return <div className="inv-row">{it('🛡', inv.tanks, 'tanks')}{it('💥', inv.artillery, 'guns')}{it('✈', inv.jets, 'jets')}{it('🚁', inv.helicopters, 'helicopters')}{it('⚓', inv.warships, 'warships')}{it('🌊', inv.submarines, 'submarines')}</div>;
        })()}
        <div className="card" style={{ marginTop: 8 }}>
          <MeterRow label="Readiness" value={m.readiness} color={m.readiness < 0.5 ? 'var(--red)' : 'var(--teal)'} hint="Training and maintenance funding. Low readiness cuts combat power." />
          <MeterRow label="Logistics" value={m.supply} hint="Infrastructure & tech: how well supply lines carry ammunition, fuel and food to the front. Blockades cut it." />
          <MeterRow label="Intelligence" value={m.intel} color="var(--blue)" hint="Better intel reveals enemy numbers and gives a combat edge." />
          {isAtWar(s, id) && <MeterRow label="War support" value={warSupport(c)} color={warSupport(c) < 0.3 ? 'var(--red)' : warSupport(c) < 0.45 ? 'var(--amber)' : 'var(--teal)'} hint="Public backing for the war: morale in battle, stability and willingness to keep fighting." />}
          <MeterRow label="War exhaustion" value={m.exhaustion} color={m.exhaustion > 0.6 ? 'var(--red)' : 'var(--amber)'} text={`${(m.exhaustion * 100).toFixed(0)}%`} hint="Rises with casualties, lost territory and damage; forces peace at the extreme." />
        </div>
        {s.wars.filter((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id)).map((w) => <button key={w.id} className="btn sm wr-open" onClick={() => store.openWarRoom(w.id)}>⚔ {w.name}: open the war room</button>)}
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Lifetime casualties: {fmtNum(m.casualties)}. Strength also depends on terrain, distance to the front (supply), air and naval superiority, and economic staying power — not just troop count.</div>
      </Section>

      {mine && milCtl === 'hands' && (
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

      {mine && (s.peaceDeals ?? []).some((d) => d.a === id || d.b === id) && (
        <Section title="Peace treaty obligations">
          <div className="card" style={{ fontSize: 12.5, display: 'grid', gap: 6 }}>
            {(s.peaceDeals ?? []).filter((d) => d.a === id || d.b === id).map((d, i) => {
              const other = s.countries[d.a === id ? d.b : d.a].name;
              const yrs = ((d.until - s.tick) / 52).toFixed(1);
              const text = d.kind === 'rep'
                ? (d.a === id ? `💰 ${other} pays you reparations: about ${fmtMoney((d.share ?? 0.02) * s.countries[d.b].eco.gdp)} a year (${fmtMoney(d.paid ?? 0)} so far)` : `💰 You pay reparations to ${other}: about ${fmtMoney((d.share ?? 0.02) * e.gdp)} a year`)
                : (d.a === id ? `🚫 ${other} is demilitarised: its defence budget is capped and it cannot attack you` : `🚫 You are demilitarised by ${other}: defence budget capped at 1.2% of GDP, and you cannot attack them`);
              return <div key={i} className="row" style={{ padding: 0, border: 'none' }}><div className="grow">{text}</div><span className="faint num">{yrs} yrs left</span></div>;
            })}
          </div>
        </Section>
      )}
      {mine && wars.length > 0 && <HomeFront id={id} />}
      {mine && wars.length > 0 && <SupplyLines id={id} />}
      {mine && <ArmyGroups />}
      {mine && <Programmes />}
      {mine && (wars.length > 0 || (c.generals?.length ?? 0) > 0) && <HighCommand id={id} />}
      {mine && wars.length > 0 && (() => {
        const diary = [...s.log].reverse().filter((l) => l.countries.includes(id) && (l.kind === 'territory' || l.kind === 'war')).slice(0, 8);
        return diary.length > 0 && (
          <Section title="War diary" hint="latest first">
            <div className="card diary">
              {diary.map((l) => <div key={l.seq} className={`diary-row ${/captured it from/.test(l.text) ? (l.countries[0] === id ? 'good' : 'bad') : ''}`}><span className="faint">{dateLabel(l.tick)}</span> {l.text}</div>)}
            </div>
          </Section>
        );
      })()}

      {mine && wars.length > 0 && (
        <Section title="Active offensives" hint="click a region on the map to inspect it">
          {wars.flatMap((w) => w.fronts.filter((f) => f.by === id)).length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>No offensives under way yet. Your forces advance from your border into enemy regions.</div>}
          {wars.flatMap((w) => w.fronts.filter((f) => f.by === id).map((f) => ({ f, w }))).map(({ f, w }) => {
            const gp = geo.provinces[f.prov];
            return (
              <div className="card" key={`${f.prov}-${f.by}`} style={{ marginBottom: 8 }}>
                <div className="row" style={{ border: 'none', padding: 0 }}>
                  <div className="grow"><b>{gp.name}</b><div className="hint">{f.amphibious ? 'Amphibious landing · ' : ''}{s.countries[s.owner[f.prov]].name} · you {f.atk ? fmtNum(f.atk) : '…'} vs {f.def ? fmtNum(f.def) : '…'} defenders</div></div>
                  <button className="btn" onClick={() => store.openBattle({ war: w.id, prov: f.prov, by: f.by })}>Report<small>odds & modifiers</small></button>
                  <button className="btn" onClick={() => store.act((g) => actAirstrike(g, g.player, f.prov))}>Air strike<small>{fmtMoney(0.0015 * e.gdp)}</small></button>
                </div>
                <div style={{ marginTop: 6 }}><Meter value={Math.min(1, f.progress)} color="var(--accent)" /></div>
                <div className="hint" style={{ marginTop: 2 }}>
                  {Math.round(Math.min(1, f.progress) * 100)}% · {f.rate && f.rate > 0.0005 ? `about ${Math.ceil((1 - Math.min(1, f.progress)) / f.rate)} weeks to capture at this pace` : f.rate !== undefined && f.rate < -0.0005 ? 'the attack is failing' : 'stalled'}
                  {f.atk && f.def ? ` · odds ${(f.atk / Math.max(1, f.def)).toFixed(1)}:1` : ''}
                  {(f.la || f.ld) ? ` · losses so far: yours ${fmtNum(f.la ?? 0)}, theirs ${fmtNum(f.ld ?? 0)}` : ''}
                  {f.sup !== undefined && <> · <span style={{ color: supTone(f.sup) }}>supply {Math.round(f.sup * 100)}%</span></>}
                  {f.pocket && ' · ⭕ defenders encircled'}
                </div>
              </div>
            );
          })}
          <div className="btnrow" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => store.act((g) => actCallAllies(g, g.player))}>Call allies to war<small>they may decline</small></button>
            <button className="btn danger" onClick={() => store.act((g) => actTotalMobilization(g, g.player))}>Total mobilisation<small>recruit 50% of manpower + war economy</small></button>
            <button className={`btn ${m.warEconomy ? 'primary' : ''}`} onClick={() => store.act((g) => actWarEconomy(g, g.player, !m.warEconomy))}>{m.warEconomy ? 'War economy ON' : 'Switch to war economy'}<small>+60% armament output · unrest & inflation</small></button>
          </div>
        </Section>
      )}

      {mine && wars.length > 0 && milCtl !== 'auto' && (
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
                {(() => { const g = goalOf(s, w); return g ? <div className="war-goal">{GOALS_META[g].icon} <b>War aim: {GOALS_META[g].title}</b> <span className="faint">· success = {GOALS_META[g].success}</span></div> : null; })()}
                {enemies.map((x) => (
                  <div className="row" key={x}>
                    <span className="dot" style={{ background: nationalColor(s.countries[x]) }} />
                    <button className="grow" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0 }} onClick={() => store.select(x, null, true)}>{s.countries[x].name}<div className="hint">exhaustion {(s.countries[x].mil.exhaustion * 100).toFixed(0)}% · war support {Math.round(warSupport(s.countries[x]) * 100)}% · {s.countries[x].provinces.length} provinces</div></button>
                    {areAtWar(s, id, x) && hasProg(me, 'missiles') && <button className="btn" onClick={() => store.act((g) => actMissileStrike(g, x))}>🚀 Missile strike</button>}
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

/** Weapons programmes: long projects that change how your forces fight. */
function Programmes() {
  const s = store.state!;
  const c = s.countries[s.player];
  const running = (c.progs ?? []).filter((p) => !p.done).length;
  return (
    <Section title="Weapons programmes" hint={`${(c.progs ?? []).filter((p) => p.done).length} operational · 2 at a time`}>
      <div className="progs">
        {PROGRAMMES.map((p) => {
          const st = c.progs?.find((x) => x.id === p.id);
          return (
            <div className={`prog ${st?.done ? 'done' : st ? 'running' : ''}`} key={p.id}>
              <span className="prog-ic">{p.icon}</span>
              <div className="grow">
                <b>{p.title}</b> <span className="faint">{p.plain}</span>
                <div className="faint" style={{ fontSize: 11.5 }}>{p.desc}</div>
                {st && !st.done && <div className="path-prog"><i style={{ width: `${Math.min(100, 100 * (1 - (st.until - s.tick) / p.weeks))}%` }} /></div>}
              </div>
              {st?.done ? <span className="good" style={{ fontSize: 12 }}>✓ operational</span> : st ? <span className="faint" style={{ fontSize: 12 }}>{st.until - s.tick} wk</span>
                : <button className="btn" disabled={running >= 2} onClick={() => store.act((g) => actStartProgramme(g, p.id))}>{fundingText(c, p.cost * c.eco.gdp)} · {p.weeks} wk</button>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
