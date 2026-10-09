import { store } from '../../state/store';
import { Note, RelationBar, Section, Stat } from '../widgets';
import { GOV, REGION, fog, fmtMoney, fmtNum, pct, relLabel, signedPct, sizeClass } from '../format';
import { LineChart } from '../LineChart';
import { alertsFor } from '../explain';
import { getRelation, isAtWar, warsOf } from '../../sim/relations';
import { strengthIndex } from '../../sim/military';
import { popGrowthRate } from '../../sim/economy';
import { toggleFocus } from '../../sim/actions';
import { warScore } from '../../sim/war';

export function OverviewTab({ id }: { id: number }) {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[id];
  const mine = id === s.player;
  const e = c.eco;
  const rank = [...s.countries].filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((x) => x.id === id) + 1;
  const rel = getRelation(s, id, s.player);
  const rl = relLabel(rel);
  const gdp = fog(s, c, e.gdp, 'gdp');
  const alerts = mine ? alertsFor(c, s) : [];
  const pr = store.selectedProv;
  const prov = pr !== null && s.owner[pr] === id ? geo.provinces[pr] : null;
  const me = s.countries[s.player];
  const wars = warsOf(s, id);

  return (
    <>
      {mine ? (
        <Section title="Advisor alerts" hint={alerts.length ? `${alerts.length}` : 'all clear'}>
          {alerts.length === 0 ? <Note>No pressing issues. Your economy and security are stable — time to expand, invest or look abroad.</Note> : (
            <div className="list card" style={{ padding: 4 }}>
              {alerts.slice(0, 6).map((a, i) => (
                <button key={i} className="listitem" onClick={() => a.tab && store.setTab(a.tab)}>
                  <span className={`dot`} style={{ background: a.level === 'bad' ? 'var(--red)' : a.level === 'warn' ? 'var(--amber)' : 'var(--blue)' }} />
                  <span style={{ fontSize: 12.5 }}>{a.text}</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Relations with you" hint={isAtWar(s, id) ? 'AT WAR' : undefined}>
          <div className="card">
            <div className="row" style={{ border: 'none', paddingBottom: 8 }}>
              <div className="grow"><b>{rl.text}</b> <span className="faint num">({rel >= 0 ? '+' : ''}{rel.toFixed(0)})</span></div>
              <button className="btn" onClick={() => store.setTab('diplomacy')}>Diplomacy →</button>
            </div>
            <RelationBar value={rel} />
          </div>
        </Section>
      )}

      {prov && (
        <Section title="Selected region">
          <div className="card" style={{ fontSize: 13 }}>
            <div><b>{prov.territory ?? `Region of ${s.countries[s.core[prov.id]].name}`}</b>{s.core[prov.id] !== id && <span className="pill gold" style={{ marginLeft: 8 }}>Occupied · integration {(s.integ[prov.id] * 100).toFixed(0)}%</span>}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              Terrain ruggedness {(prov.terrain * 100).toFixed(0)}% (defender bonus) · {prov.coast > 0.15 ? 'coastal' : 'inland'} · {c.capital === prov.id ? 'Capital region' : `${(prov.w / c.provinces.reduce((t, q) => t + geo.provinces[q].w, 0) * 100).toFixed(0)}% of national output`}
            </div>
            {!mine && store.atWarWithPlayer(id) && (
              <button className="btn danger" style={{ marginTop: 8 }} onClick={() => store.act((g) => toggleFocus(g, g.player, prov.id), true)}>
                {me.mil.focus.includes(prov.id) ? '✓ Targeted — click to cancel' : 'Target this province'}
                <small>{me.mil.autoAdvance ? 'Generals favour it (auto-advance on)' : 'Manual offensive: your armies attack only targeted regions'}</small>
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title="Snapshot" hint={`${sizeClass(c)} · #${rank} economy`}>
        <div className="grid2">
          <Stat label="Population" value={fmtNum(e.pop)} sub={`${signedPct(popGrowthRate(c), 1)} / yr trend`} />
          <Stat label="GDP (nominal)" value={`${gdp.approx ? '≈' : ''}${fmtMoney(gdp.v)}`} sub={`${fmtMoney(e.gdp / e.pop, 0)} per person`} />
          <Stat label="Real growth" value={signedPct(e.growth)} tone={e.growth < 0 ? 'bad' : e.growth > 0.04 ? 'good' : undefined} sub={`inflation ${pct(e.inflation)}`} />
          <Stat label="Stability" value={e.stability.toFixed(0)} tone={e.stability < 35 ? 'bad' : e.stability > 60 ? 'good' : 'warn'} sub={`unemployment ${pct(e.unemployment)}`} />
          <Stat label="Public debt" value={pct(e.debt / e.gdp, 0)} sub={`of GDP · ${fmtMoney(e.debt)}`} tone={e.debt / e.gdp > 1.5 ? 'bad' : undefined} />
          <Stat label="Military power" value={fog(s, c, strengthIndex(c), 'pow').approx ? `≈${fmtNum(fog(s, c, strengthIndex(c), 'pow').v * 1000)}` : fmtNum(strengthIndex(c) * 1000)} sub={c.mil.nuclear ? '☢ nuclear-armed' : 'troop-equivalents'} />
          <Stat label="Territory" value={`${c.provinces.length}`} sub={`provinces (started with ${c.baseline.provinces})`} />
          <Stat label="Government" value={GOV[c.gov] ?? c.gov} sub={REGION[c.region]} />
        </div>
      </Section>

      {wars.length > 0 && (
        <Section title="Wars">
          <div className="list card" style={{ padding: 4 }}>
            {wars.map((w) => {
              const score = warScore(s, w, id);
              return (
                <div key={w.id} className="row" style={{ padding: '8px 6px' }}>
                  <div className="grow"><b>{w.name}</b><div className="hint">{w.attackers.map((x) => s.countries[x].name).join(', ')} vs {w.defenders.map((x) => s.countries[x].name).join(', ')}</div></div>
                  <span className={`pill ${score > 0.15 ? 'green' : score < -0.15 ? 'red' : ''}`}>{score > 0.15 ? 'winning' : score < -0.15 ? 'losing' : 'stalemate'}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Economic history" hint="GDP (nominal)">
        <div className="card">
          <LineChart endTick={s.tick} series={[{ label: 'GDP', color: 'var(--teal)', data: c.hist.gdp, fmt: (v) => fmtMoney(v) }]} />
        </div>
      </Section>
      {mine && (
        <Section title="Stability & debt">
          <div className="card">
            <LineChart endTick={s.tick} series={[{ label: 'Stability', color: 'var(--amber)', data: c.hist.stab, fmt: (v) => v.toFixed(0) }]} height={80} />
          </div>
        </Section>
      )}
      <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        {c.estimated ? 'Baseline values for this country are rough game estimates. ' : 'Baseline: approximate 2023–24 real-world figures (rounded). '}
        Everything else (capital stock, tech, infrastructure, policy detail) is game-generated.
      </p>
      {me.alive && !mine && c.provinces.length > 0 && <div className="faint" style={{ fontSize: 11.5 }}>Intel quality: yours {(me.mil.intel * 100).toFixed(0)} vs theirs {(c.mil.intel * 100).toFixed(0)} — a weaker intelligence service shows only estimates (≈).</div>}
    </>
  );
}
