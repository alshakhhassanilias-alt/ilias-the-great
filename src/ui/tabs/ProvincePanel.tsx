import { store } from '../../state/store';
import { Section } from '../widgets';
import { fmtMoney, fmtNum } from '../format';
import { supplyFromCost, supplyNet } from '../../sim/supply';
import { isAtWar } from '../../sim/relations';
import { dateLabel } from '../../sim/tick';
import { BDEF, BTYPES, MAX_LEVEL, canBuild, costOfBuilding, levelOf, type BType } from '../../sim/buildings';
import { actAirstrike, actBuild, toggleFocus } from '../../sim/actions';
import { activeOp, actLaunchOp, canLaunch, opCost } from '../../sim/specops';
import { OCC_POLICIES, occPolicy, resistanceAt, resistanceParts } from '../../sim/occupation';

export function ProvincePanel({ p }: { p: number }) {
  const s = store.state!;
  const geo = store.geo;
  const gp = geo.provinces[p];
  const owner = s.countries[s.owner[p]];
  const core = s.countries[s.core[p]];
  const me = s.countries[s.player];
  const mine = owner.id === s.player;
  const totalW = owner.provinces.reduce((t, q) => t + geo.provinces[q].w, 0) || 1;
  const front = s.wars.flatMap((w) => w.fronts).find((f) => f.prov === p && f.by === s.player);
  const atWar = !mine && store.atWarWithPlayer(owner.id);
  const lvl = (t: BType) => levelOf(s, p, t);
  const dots = (n: number) => '●'.repeat(n) + '○'.repeat(MAX_LEVEL - n);
  // how well supplied this region is for its owner (only meaningful in wartime)
  const sup = isAtWar(s, owner.id) ? (() => { const net = supplyNet(s, geo, owner.id); return { pocket: net.dist[p] === Infinity, v: supplyFromCost(net.dist[p], net.reach) * (0.72 + 0.28 * net.capacity) }; })() : null;
  return (
    <Section title="Selected region" hint={owner.name}>
      <div className="card" style={{ fontSize: 13 }}>
        <div><b>{gp.name}</b>{core.id !== owner.id && <span className="pill gold" style={{ marginLeft: 8 }}>Occupied · integration {(s.integ[p] * 100).toFixed(0)}%</span>}</div>
        <div className="muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {core.id !== owner.id ? `Originally part of ${core.name}. ` : ''}
          Terrain {gp.terrain > 0.65 ? 'mountainous or jungle' : gp.terrain > 0.4 ? 'hilly or harsh' : 'open'} ({(gp.terrain * 100).toFixed(0)}% ruggedness: defenders get a bonus) ·
          {gp.coast > 0.15 ? ' coastal' : ' inland'} · {owner.capital === p ? 'national capital' : `${((gp.w / totalW) * 100).toFixed(0)}% of ${owner.name}'s output`}
        </div>
        <div className="prov-facts">
          <div><label>People</label><b>{fmtNum(owner.eco.pop * (gp.w / totalW))}</b></div>
          <div><label>Output</label><b>{fmtMoney(owner.eco.gdp * (gp.w / totalW))}</b></div>
          <div><label>Supply</label><b className={sup === null ? '' : sup.pocket ? 'bad' : sup.v < 0.55 ? 'bad' : sup.v < 0.75 ? 'warn' : 'good'}>{sup === null ? 'peace' : sup.pocket ? '⭕ cut off' : `${Math.round(sup.v * 100)}%`}</b></div>
          <div><label>Changed hands</label><b>{s.stats[`flips:${p}`] ?? 0}×</b></div>
        </div>
        {s.stats[`held:${p}`] !== undefined && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Held by {owner.name} since {dateLabel(s.stats[`held:${p}`])}.</div>}
        {core.id !== owner.id && s.integ[p] < 1 && (() => {
          const r = resistanceAt(s, p);
          return (
            <div className="prov-res">
              <div className="row" style={{ border: 'none', padding: '6px 0 2px' }}><div className="grow"><b>Resistance</b> <span className="faint">({OCC_POLICIES[occPolicy(s, owner)].label.toLowerCase()})</span></div><b className={r > 0.6 ? 'bad' : r < 0.3 ? 'good' : 'warn'}>{Math.round(r * 100)}%</b></div>
              <div className="wc-bar res"><i style={{ width: `${Math.round(r * 100)}%` }} /></div>
              <div className="hint" style={{ marginTop: 4 }}>{resistanceParts(s, p).map((x) => `${x.label} ${x.v > 0 ? '+' : '−'}${Math.round(Math.abs(x.v) * 100)}`).join(' · ')}</div>
            </div>
          );
        })()}
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {BTYPES.map((t) => {
            const l = lvl(t), d = BDEF[t];
            const why = mine ? canBuild(s, geo, me, p, t) : null;
            return (
              <div className="row" key={t} style={{ padding: '4px 0' }} title={d.desc}>
                <span style={{ fontSize: 18, width: 26 }} aria-hidden="true">{d.icon}</span>
                <div className="grow"><div className="lab">{d.label} <span className="faint num" style={{ letterSpacing: 2 }}>{dots(l)}</span></div><div className="hint">{d.desc}</div></div>
                {mine && <button className="btn" disabled={!!why} title={why ?? ''} onClick={() => { const x = store.act((g) => actBuild(g, store.geo, g.player, p, t)); if (x.ok) store.mapCallout(p, `${d.icon} ${d.label.toUpperCase()} ${'●'.repeat(l + 1)}`, '#ffd36a'); }}>{why ? (l >= MAX_LEVEL ? 'Max' : '—') : `Build`}{!why && <small>{fmtMoney(costOfBuilding(me, l, t))}</small>}</button>}
              </div>
            );
          })}
        </div>
        {!mine && lvl('fort') > 0 && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>🏰 Fortified: attackers face +{lvl('fort') * 14}% defence here.</div>}
        {atWar && (
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn danger" onClick={() => store.act((g) => toggleFocus(g, g.player, p), true)}>{me.mil.focus.includes(p) ? '✓ Targeted' : 'Target this region'}<small>{me.mil.autoAdvance ? 'generals favour it' : 'manual offensive'}</small></button>
            {front && <button className="btn" onClick={() => { const r = store.act((g) => actAirstrike(g, g.player, p)); if (r?.ok) store.mapCallout(p, '✈ AIR STRIKE', '#9fd4ff'); }}>Air strike<small>{fmtMoney(0.0015 * me.eco.gdp)}</small></button>}
          </div>
        )}
        {atWar && (() => {
          const nav = canLaunch(s, geo, s.player, p, 'naval'), air = canLaunch(s, geo, s.player, p, 'airborne');
          const op = activeOp(s, me, p);
          return (
            <div className="btnrow" style={{ marginTop: 8 }}>
              {op ? <div className="note">{op.kind === 'naval' ? '⚓ Naval invasion' : '🪂 Airborne assault'} under way · {op.until - s.tick} weeks left</div> : <>
                {gp.coast > 0.15 && <button className="btn" disabled={!!nav} title={nav ?? ''} onClick={() => { const r = store.act((g) => actLaunchOp(g, geo, g.player, p, 'naval')); if (r?.ok) store.mapCallout(p, '⚓ LANDING', '#9fd4ff'); }}>⚓ Naval invasion<small>{nav ?? `${fmtMoney(opCost(me, 'naval'))} · new front from the sea`}</small></button>}
                <button className="btn" disabled={!!air} title={air ?? ''} onClick={() => { const r = store.act((g) => actLaunchOp(g, geo, g.player, p, 'airborne')); if (r?.ok) store.mapCallout(p, '🪂 AIRBORNE', '#9fd4ff'); }}>🪂 Airborne assault<small>{air ?? `${fmtMoney(opCost(me, 'airborne'))} · drop behind the lines`}</small></button>
              </>}
            </div>
          );
        })()}
      </div>
    </Section>
  );
}
