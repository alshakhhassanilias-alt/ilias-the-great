import { store } from '../../state/store';
import { Meter, Note, Section } from '../widgets';
import { fmtMoney } from '../format';
import { WS_ACTIONS, WS_LABEL, actWarSupport, morale, warSupport, wsCooldownLeft } from '../../sim/warsupport';
import { depotSuggestion, supplyNet } from '../../sim/supply';
import { actBuild } from '../../sim/actions';
import { costOfBuilding, levelOf } from '../../sim/buildings';
import { warsOf } from '../../sim/relations';
import { guideLevel } from '../guides';
import { actPartisans, occupiedHomeland, partisansActive } from '../../sim/specops';
import { GTRAITS, actAssignGeneral, actRecruitGeneral, actRetireGeneral, activeGenerals, generalAt, gtrait, starText } from '../../sim/generals';

export const wsTone = (v: number) => (v < 0.3 ? 'bad' : v < 0.45 ? 'warn' : 'good');
export const supTone = (v: number) => (v < 0.55 ? 'var(--red)' : v < 0.75 ? 'var(--amber)' : 'var(--teal)');

/** War support: the meter, why it is moving, what it does, and the levers to move it. */
export function HomeFront({ id }: { id: number }) {
  const s = store.state!;
  const c = s.countries[id];
  const ws = warSupport(c);
  const parts = Object.entries(c.mil.wsParts ?? {}).filter(([k, v]) => !k.startsWith('+') && Math.abs(v) >= 0.0002).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const trend = parts.reduce((t, [, v]) => t + v, 0);
  const guide = guideLevel(s);
  const mor = morale(c);
  return (
    <Section title="Home front" hint="war support">
      <div className="card ws-card">
        <div className="ws-head">
          <div className={`ws-big ${wsTone(ws)}`}>{Math.round(ws * 100)}%</div>
          <div className="grow">
            <Meter value={ws} color={ws < 0.3 ? 'var(--red)' : ws < 0.45 ? 'var(--amber)' : 'var(--teal)'} />
            <div className="hint" style={{ marginTop: 3 }}>
              {trend > 0.0005 ? `▲ rising ${(trend * 100).toFixed(1)} pts/week` : trend < -0.0005 ? `▼ falling ${(-trend * 100).toFixed(1)} pts/week` : 'steady'} · army morale ×{mor.toFixed(2)}
            </div>
          </div>
        </div>
        {parts.length > 0 && (
          <div className="why" style={{ marginTop: 6 }}>
            {parts.slice(0, 6).map(([k, v]) => (
              <div className="why-row" key={k}><span>{WS_LABEL[k] ?? k}</span><b className={v > 0 ? 'good' : 'bad'}>{v > 0 ? '+' : ''}{(v * 100).toFixed(1)}</b></div>
            ))}
          </div>
        )}
        {ws < 0.3 && <Note tone="bad">The public has turned against the war: stability is falling and your generals' morale is low. Win a battle, run propaganda — or make peace.</Note>}
        {ws >= 0.3 && ws < 0.45 && guide !== 'none' && <Note tone="warn">Support is slipping. Below 35% stability starts to fall; below 30% protests begin.</Note>}
        {guide === 'full' && ws >= 0.45 && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Casualties and a long war wear support down; victories and defending your homeland lift it. High support means braver troops (up to +10%).</div>}
      </div>
      <div className="btnrow" style={{ marginTop: 8 }}>
        {WS_ACTIONS.map((a) => {
          const left = wsCooldownLeft(s, id, a.id);
          const cost = a.id === 'propaganda' ? ` · ${fmtMoney(0.0012 * c.eco.gdp)}` : a.id === 'bonds' ? ` · +${fmtMoney(0.005 * c.eco.gdp)}` : '';
          return (
            <button key={a.id} className="btn" disabled={left > 0 || (a.id === 'bonds' && ws < 0.35)} onClick={() => { const x = store.act((g) => actWarSupport(g, g.player, a.id)); if (x.ok) store.mapCallout(c.capital, `${a.icon} ${a.id === 'bonds' ? 'WAR BONDS' : a.id === 'censor' ? 'CENSORED' : 'PROPAGANDA'}`, a.id === 'bonds' ? '#7fe0a8' : '#ffd36a'); }}>
              {a.icon} {a.label}<small>{left > 0 ? `again in ${left} wk` : a.desc.split(' · ').slice(1).join(' · ') || a.desc}{left > 0 ? '' : cost}</small>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Supply lines: how well each offensive is supplied, encircled pockets, and where a supply hub would help. */
export function SupplyLines({ id }: { id: number }) {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[id];
  const net = supplyNet(s, geo, id);
  const fronts = warsOf(s, id).flatMap((w) => w.fronts.filter((f) => f.by === id));
  const enemyPockets: number[] = [];
  const seen = new Set<number>();
  for (const w of warsOf(s, id)) for (const e of w.attackers.includes(id) ? w.defenders : w.attackers) {
    if (seen.has(e) || !s.countries[e].alive) continue;
    seen.add(e);
    enemyPockets.push(...supplyNet(s, geo, e).pocket);
  }
  const sug = depotSuggestion(s, geo, id);
  const guide = guideLevel(s);
  const depots = c.provinces.filter((p) => levelOf(s, p, 'depot') > 0).length;
  return (
    <Section title="Supply lines" hint={`logistics ${Math.round(net.capacity * 100)}%`}>
      <div className="card">
        {fronts.length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>No offensives yet. Supplies flow from your capital, big cities, supply hubs and (while the seas are open) your ports.</div>}
        {fronts.slice(0, 6).map((f) => {
          const sup = f.sup ?? 1;
          return (
            <div className="row" key={`${f.prov}-${f.by}`} title="Supply falls the further the front is from a hub, through mountains and through freshly conquered land">
              <div className="grow">
                <div className="lab">{geo.provinces[f.prov].name}{f.amphibious ? ' (by sea)' : ''}{f.pocket ? ' · ⭕ encircled' : ''}</div>
                <Meter value={sup} color={supTone(sup)} />
              </div>
              <div className="val">{Math.round(sup * 100)}%</div>
            </div>
          );
        })}
        {net.pocket.length > 0 && <Note tone="bad">⭕ {net.pocket.length} of your regions {net.pocket.length === 1 ? 'is' : 'are'} encircled ({net.pocket.slice(0, 3).map((p) => geo.provinces[p].name).join(', ')}{net.pocket.length > 3 ? '…' : ''}): defenders fight at half strength and slowly bleed. Break through to them, or build a supply hub inside.</Note>}
        {enemyPockets.length > 0 && <Note tone="good">⭕ Enemy pockets: {enemyPockets.slice(0, 3).map((p) => geo.provinces[p].name).join(', ')}{enemyPockets.length > 3 ? ` +${enemyPockets.length - 3}` : ''}. Cut off and weak: easy targets.</Note>}
        {guide !== 'none' && fronts.length > 0 && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{guide === 'full' ? 'Tip: attack a region from two sides to cut it off; pause deep pushes until a supply hub catches up. ' : ''}{depots ? `${depots} supply hub${depots > 1 ? 's' : ''} built.` : 'No supply hubs built yet.'}</div>}
      </div>
      {occupiedHomeland(s, id).length > 0 && (
        <button className="btn danger" style={{ marginTop: 8, width: '100%' }} disabled={partisansActive(s, id)} onClick={() => { const x = store.act((g) => actPartisans(g, g.player)); if (x.ok) store.mapCallout(occupiedHomeland(s, id)[0], '🔥 PARTISANS', '#ff9a5a'); }}>
          🔥 {partisansActive(s, id) ? 'Partisans are fighting the occupier' : 'Arm the partisans'}<small>{partisansActive(s, id) ? `${(s.stats[`partisans:${id}`] ?? 0) - s.tick} weeks left · enemy supply through your land costs 2.6×` : `${fmtMoney(0.001 * c.eco.gdp)} · ${occupiedHomeland(s, id).length} occupied region(s): sabotage their supply, stop integration`}</small>
        </button>
      )}
      {sug && (
        <button className="btn primary" style={{ marginTop: 8, width: '100%' }} onClick={() => { const x = store.act((g) => actBuild(g, geo, g.player, sug.prov, 'depot')); if (x.ok) store.mapCallout(sug.prov, '📦 SUPPLY HUB', '#7fe0a8'); }}>
          📦 Build a supply hub in {geo.provinces[sug.prov].name}<small>{fmtMoney(costOfBuilding(c, levelOf(s, sug.prov, 'depot'), 'depot'))} · the push on {geo.provinces[sug.front].name} is at {Math.round(sug.supply * 100)}% supply</small>
        </button>
      )}
    </Section>
  );
}

/** The general staff: who leads which offensive, their stars and traits; recruit, reassign or retire them. */
export function HighCommand({ id }: { id: number }) {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[id];
  const gens = activeGenerals(c);
  const fronts = warsOf(s, id).flatMap((w) => w.fronts.filter((f) => f.by === id));
  const fallen = (c.generals ?? []).filter((g) => g.status === 'fallen').slice(-3);
  const guide = guideLevel(s);
  return (
    <Section title="High command" hint={`${gens.length} general${gens.length === 1 ? '' : 's'}`}>
      {gens.length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>Your general staff forms when you go to war.</div>}
      {gens.map((g) => {
        const tr = gtrait(g.trait);
        return (
          <div className="card gen-card" key={g.id}>
            <div className="gen-badge" aria-hidden="true">{g.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
            <div className="grow">
              <div className="lab"><span className="gstars">{starText(g)}</span> General {g.name}</div>
              <div className="hint">{tr.icon} {tr.title}: {tr.desc}{g.wins ? ` · ${g.wins} region${g.wins > 1 ? 's' : ''} taken` : ''}</div>
              <select value={g.front} aria-label={`Command of General ${g.name}`} onChange={(e) => store.act((st) => actAssignGeneral(st, st.player, g.id, Number(e.target.value)), true)}>
                <option value={-1}>🏠 Home defence</option>
                {fronts.map((f) => <option key={f.prov} value={f.prov}>⚔ {geo.provinces[f.prov].name}{generalAt(c, f.prov) && generalAt(c, f.prov) !== g ? ' (swap)' : ''}</option>)}
              </select>
            </div>
            <button className="btn" onClick={() => store.act((st) => actRetireGeneral(st, st.player, g.id))}>Retire</button>
          </div>
        );
      })}
      {fallen.length > 0 && <div className="faint" style={{ fontSize: 11.5, margin: '4px 0' }}>🪦 Fallen: {fallen.map((g) => `${g.name} ${starText(g)}`).join(', ')}</div>}
      <div className="btnrow" style={{ marginTop: 6 }}>
        {GTRAITS.slice(0, 4).map((t) => (
          <button key={t.id} className="btn" disabled={gens.length >= 6} onClick={() => store.act((st) => actRecruitGeneral(st, st.player, t.id))}>{t.icon} Promote a {t.title}<small>{fmtMoney(0.0005 * c.eco.gdp)}</small></button>
        ))}
      </div>
      {guide === 'full' && <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Generals earn stars by fighting (+3% each). Put your Blitz general on the main push, a Fortress general at home, and an Encircler where the enemy is cut off.</div>}
    </Section>
  );
}
