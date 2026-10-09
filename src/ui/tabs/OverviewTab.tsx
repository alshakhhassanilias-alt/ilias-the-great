import { store } from '../../state/store';
import { Meter, Note, RelationBar, Section, Stat } from '../widgets';
import { GOV, REGION, fog, fmtMoney, fmtNum, pct, relLabel, signedPct, sizeClass } from '../format';
import { LineChart } from '../LineChart';
import { advisor, alertsFor, briefing, sectorsOf, stabilityParts, tradeProfile } from '../explain';
import { getRelation, isAtWar, warsOf } from '../../sim/relations';
import { strengthIndex } from '../../sim/military';
import { warScore } from '../../sim/war';
import { activeGoals, GOALS } from '../../sim/goals';
import { popGrowthRate } from '../../sim/economy';
import { ProvincePanel } from './ProvincePanel';

const TIP = {
  gdp: 'Gross domestic product: the total value of everything the economy produces in a year (nominal US dollars).',
  growth: 'Real growth: how fast output grows after removing inflation.',
  stab: 'Stability 0-100. Low stability cuts output and invites coups. Open "Why is stability like this?" below.',
  debt: 'Public debt as a share of GDP. High debt raises interest costs and can end in default.',
  power: 'Military power index in troop-equivalents: combines troops, equipment quality, technology, readiness, air and naval power.',
};

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
  const advice = mine ? advisor(c, s, geo) : [];
  const brief = mine ? briefing(s, c) : null;
  const pr = store.selectedProv;
  const wars = warsOf(s, id);
  const sectors = sectorsOf(c);
  const parts = stabilityParts(c);
  const maxStab = Math.max(6, ...parts.map((p) => Math.abs(p.v)));
  const partners = tradeProfile(s, c);
  const goals = activeGoals(s);

  return (
    <>
      {mine && brief && (
        <Section title="Briefing" hint={`since ${brief.since}`}>
          <div className="card" style={{ fontSize: 13, lineHeight: 1.5 }}>{brief.lines.map((l, i) => <div key={i} className={i === 0 ? '' : 'muted'}>{l}</div>)}</div>
        </Section>
      )}

      {mine && advice.length > 0 && (
        <Section title="Your advisor recommends" hint="one tap to act">
          <div className="list" style={{ gap: 8, display: 'grid' }}>
            {advice.map((a) => (
              <div className="card advice" key={a.id}>
                <div className="advice-text"><span className={`dot`} style={{ background: a.level === 'urgent' ? 'var(--red)' : a.level === 'opportunity' ? 'var(--green)' : 'var(--amber)' }} /> {a.text}</div>
                <button className="btn" onClick={() => { const r = store.act((g) => a.run(g, geo)); void r; }}>{a.label}</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!mine && (
        <Section title="What they are up to" hint={isAtWar(s, id) ? 'AT WAR' : undefined}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{c.intent || 'Going about its business'}</div>
            <div className="row" style={{ border: 'none', paddingBottom: 8 }}>
              <div className="grow"><b>{rl.text}</b> <span className="faint num">toward you ({rel >= 0 ? '+' : ''}{rel.toFixed(0)})</span></div>
              <button className="btn" onClick={() => store.setTab('diplomacy')}>Diplomacy →</button>
            </div>
            <RelationBar value={rel} />
          </div>
        </Section>
      )}

      {pr !== null && <ProvincePanel p={pr} />}

      {mine && (
        <Section title="Objectives" hint={`${Object.keys(s.goalsDone).length}/${GOALS.length} done`}>
          <div className="card" style={{ padding: '4px 12px' }}>
            {goals.map((g) => { const p = g.progress(s, c); return (
              <div className="goal" key={g.id}>
                <b><span className="faint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', marginRight: 6 }}>{g.theme}</span>{g.title}</b><div className="hint">{g.desc}</div>
                <Meter value={p.value} color="var(--accent)" />
                <div className="meta"><span>{p.text}</span><span>{g.reward}</span></div>
              </div>); })}
            {goals.length === 0 && <div className="goal"><b>All objectives complete.</b><div className="hint">Set your own goals — or conquer the world.</div></div>}
          </div>
        </Section>
      )}

      <Section title="Snapshot" hint={`${sizeClass(c)} · #${rank} economy`}>
        <div className="grid2">
          <Stat label="Population" value={fmtNum(e.pop)} sub={`${signedPct(popGrowthRate(c), 1)} / yr trend`} />
          <Stat label="GDP (nominal)" tip={TIP.gdp} value={`${gdp.approx ? '≈' : ''}${fmtMoney(gdp.v)}`} sub={`${fmtMoney(e.gdp / e.pop, 0)} per person`} />
          <Stat label="Real growth" tip={TIP.growth} value={signedPct(e.growth)} tone={e.growth < 0 ? 'bad' : e.growth > 0.04 ? 'good' : undefined} sub={`inflation ${pct(e.inflation)}`} />
          <Stat label="Stability" tip={TIP.stab} value={e.stability.toFixed(0)} tone={e.stability < 35 ? 'bad' : e.stability > 60 ? 'good' : 'warn'} sub={`unemployment ${pct(e.unemployment)}`} />
          <Stat label="Public debt" tip={TIP.debt} value={pct(e.debt / e.gdp, 0)} sub={`of GDP · ${fmtMoney(e.debt)}`} tone={e.debt / e.gdp > 1.5 ? 'bad' : undefined} />
          <Stat label="Military power" tip={TIP.power} value={fog(s, c, strengthIndex(c), 'pow').approx ? `≈${fmtNum(fog(s, c, strengthIndex(c), 'pow').v * 1000)}` : fmtNum(strengthIndex(c) * 1000)} sub={c.mil.nuclear ? '☢ nuclear-armed' : 'troop-equivalents'} />
          <Stat label="Territory" value={`${c.provinces.length}`} sub={`regions (started with ${c.baseline.provinces})`} />
          <Stat label="Reputation" tip="How trustworthy the world thinks this country is. Broken treaties and aggression lower it; honoured deals, aid and mediation raise it." value={c.reputation.toFixed(0)} sub={GOV[c.gov] ?? c.gov} />
        </div>
      </Section>

      <Section title="Economy by sector" hint="game estimate">
        <div className="card">
          <div className="stack" role="img" aria-label="Sector shares">{sectors.map((x) => <i key={x.key} style={{ width: `${x.share * 100}%`, background: x.color }} title={`${x.label} ${(x.share * 100).toFixed(0)}%`} />)}</div>
          <div className="legend-row" style={{ marginTop: 8 }}>{sectors.map((x) => <span key={x.key}><i style={{ background: x.color }} />{x.label} {(x.share * 100).toFixed(0)}%</span>)}</div>
        </div>
      </Section>

      {mine && (
        <Section title="Why is stability like this?" hint={`${e.stability.toFixed(0)} / 100`}>
          <div className="card">
            <div className="explain">
              {parts.filter((p) => Math.abs(p.v) >= 0.4 || p.key === 'base').map((p) => p.key === 'base' ? (
                <div key={p.key} style={{ display: 'contents' }}><div style={{ fontSize: 12.5 }}>{p.label}</div><div className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{p.v.toFixed(0)}</div></div>
              ) : (
                <div key={p.key} style={{ display: 'contents' }}>
                  <div><div style={{ fontSize: 12.5, marginBottom: 3 }}>{p.label}</div>
                    <div className="track"><i style={{ background: p.v >= 0 ? 'var(--green)' : 'var(--red)', left: p.v >= 0 ? '50%' : `${50 - (Math.abs(p.v) / maxStab) * 50}%`, width: `${(Math.abs(p.v) / maxStab) * 50}%` }} /></div></div>
                  <div className={`num ${p.v >= 0 ? 'good' : 'bad'}`} style={{ textAlign: 'right', fontWeight: 600 }}>{p.v >= 0 ? '+' : ''}{p.v.toFixed(1)}</div>
                </div>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Stability drifts towards the sum of these factors. Fix the biggest red bar first.</div>
          </div>
        </Section>
      )}

      {partners.length > 0 && (
        <Section title="Main trade partners" hint="est. share of exports">
          <div className="card">
            {partners.map((p) => (
              <button key={p.id} className="listitem" style={{ padding: '6px 2px' }} onClick={() => store.select(p.id, null, true)}>
                <span className="dot" style={{ background: `hsl(${s.countries[p.id].color},45%,45%)` }} />
                <span style={{ flex: 1 }}>{s.countries[p.id].name}</span>
                <span className="faint num">{fmtMoney(p.volume)}</span>
                <span className="num" style={{ width: 44, textAlign: 'right', fontWeight: 600 }}>{(p.share * 100).toFixed(0)}%</span>
              </button>
            ))}
            {partners[0].share > 0.3 && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>⚠ Heavy reliance on {s.countries[partners[0].id].name}: if it turns hostile, it can hurt you.</div>}
          </div>
        </Section>
      )}

      {alerts.length > 0 && mine && (
        <Section title="Warnings" hint={`${alerts.length}`}>
          <div className="list card" style={{ padding: 4 }}>
            {alerts.slice(0, 6).map((a, i) => (
              <button key={i} className="listitem" onClick={() => a.tab && store.setTab(a.tab)}>
                <span className="dot" style={{ background: a.level === 'bad' ? 'var(--red)' : a.level === 'warn' ? 'var(--amber)' : 'var(--blue)' }} />
                <span style={{ fontSize: 12.5 }}>{a.text}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

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
        <div className="card"><LineChart endTick={s.tick} series={[{ label: 'GDP', color: 'var(--teal)', data: c.hist.gdp, fmt: (v) => fmtMoney(v) }]} /></div>
      </Section>
      {mine && <Section title="Stability history"><div className="card"><LineChart endTick={s.tick} series={[{ label: 'Stability', color: 'var(--amber)', data: c.hist.stab, fmt: (v) => v.toFixed(0) }]} height={80} /></div></Section>}
      <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        {c.estimated ? 'Baseline values for this country are rough game estimates. ' : 'Baseline: approximate 2023–24 real-world figures (rounded). '}
        Everything else (capital stock, tech, infrastructure, sectors, trade shares) is game-generated.
      </p>
      {!mine && <Note>Intel quality: yours {(s.countries[s.player].mil.intel * 100).toFixed(0)} vs theirs {(c.mil.intel * 100).toFixed(0)}. A weaker intelligence service shows only estimates (≈); the Diplomacy tab has operations to see the real numbers.</Note>}
    </>
  );
}
