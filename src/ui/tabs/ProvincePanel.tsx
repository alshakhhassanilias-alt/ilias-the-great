import { store } from '../../state/store';
import { Section } from '../widgets';
import { fmtMoney } from '../format';
import { BDEF, BTYPES, MAX_LEVEL, canBuild, costOfBuilding, levelOf, type BType } from '../../sim/buildings';
import { actAirstrike, actBuild, toggleFocus } from '../../sim/actions';

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
  return (
    <Section title="Selected region" hint={owner.name}>
      <div className="card" style={{ fontSize: 13 }}>
        <div><b>{gp.name}</b>{core.id !== owner.id && <span className="pill gold" style={{ marginLeft: 8 }}>Occupied · integration {(s.integ[p] * 100).toFixed(0)}%</span>}</div>
        <div className="muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {core.id !== owner.id ? `Originally part of ${core.name}. ` : ''}
          Terrain {gp.terrain > 0.65 ? 'mountainous or jungle' : gp.terrain > 0.4 ? 'hilly or harsh' : 'open'} ({(gp.terrain * 100).toFixed(0)}% ruggedness: defenders get a bonus) ·
          {gp.coast > 0.15 ? ' coastal' : ' inland'} · {owner.capital === p ? 'national capital' : `${((gp.w / totalW) * 100).toFixed(0)}% of ${owner.name}'s output`}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {BTYPES.map((t) => {
            const l = lvl(t), d = BDEF[t];
            const why = mine ? canBuild(s, geo, me, p, t) : null;
            return (
              <div className="row" key={t} style={{ padding: '4px 0' }} title={d.desc}>
                <span style={{ fontSize: 18, width: 26 }} aria-hidden="true">{d.icon}</span>
                <div className="grow"><div className="lab">{d.label} <span className="faint num" style={{ letterSpacing: 2 }}>{dots(l)}</span></div><div className="hint">{d.desc}</div></div>
                {mine && <button className="btn" disabled={!!why} title={why ?? ''} onClick={() => store.act((g) => actBuild(g, store.geo, g.player, p, t))}>{why ? (l >= MAX_LEVEL ? 'Max' : '—') : `Build`}{!why && <small>{fmtMoney(costOfBuilding(me, l, t))}</small>}</button>}
              </div>
            );
          })}
        </div>
        {!mine && lvl('fort') > 0 && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>🏰 Fortified: attackers face +{lvl('fort') * 14}% defence here.</div>}
        {atWar && (
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn danger" onClick={() => store.act((g) => toggleFocus(g, g.player, p), true)}>{me.mil.focus.includes(p) ? '✓ Targeted' : 'Target this region'}<small>{me.mil.autoAdvance ? 'generals favour it' : 'manual offensive'}</small></button>
            {front && <button className="btn" onClick={() => store.act((g) => actAirstrike(g, g.player, p))}>Air strike<small>{fmtMoney(0.0015 * me.eco.gdp)}</small></button>}
          </div>
        )}
      </div>
    </Section>
  );
}
