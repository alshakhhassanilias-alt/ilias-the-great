import { store, useStore } from '../state/store';
import { ORDERS, MAX_ARMIES, actArmyGeneral, actArmyOrder, actArmyTarget, actArmyWeight, actDisbandArmy, actRaiseArmy, ensureArmies } from '../sim/armies';
import { activeGenerals, gtrait, starText } from '../sim/generals';
import { ctl } from '../sim/modes';
import { fmtNum } from './format';
import { Section } from './widgets';
import type { ArmyOrder } from '../sim/types';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const troopsOf = (id: number) => {
  const s = store.state!, c = s.countries[s.player];
  const armies = s.armies ?? [];
  const total = armies.reduce((t, a) => t + a.weight, 0) || 1;
  const a = armies.find((x) => x.id === id);
  return a ? (c.mil.troops * a.weight) / total : 0;
};

/** The selected army's orders, floating over the map. */
export function ArmyPanel() {
  useStore();
  const s = store.state;
  if (!s || store.selectedArmy === null || ctl(s, 'military') === 'auto') return null;
  const i = s.armies?.findIndex((a) => a.id === store.selectedArmy) ?? -1;
  const a = i >= 0 ? s.armies![i] : null;
  if (!a) return null;
  const c = s.countries[s.player];
  const geo = store.geo;
  const gens = activeGenerals(c);
  const gen = gens.find((g) => g.id === a.general);
  return (
    <div className="army-panel" role="dialog" aria-label={a.name}>
      <button className="x" aria-label="Close" onClick={() => store.selectArmy(null)}>×</button>
      <div className="ap-title"><span className="ap-badge">{ROMAN[i]}</span><div><b>{a.name}</b><small>≈ {fmtNum(troopsOf(a.id))} troops</small></div></div>
      <label className="ap-row">Commander
        <select value={a.general} onChange={(e) => store.act((g) => actArmyGeneral(g, a.id, Number(e.target.value)), true)}>
          <option value={-1}>— none —</option>
          {gens.map((g) => <option key={g.id} value={g.id}>{starText(g)} {g.name} · {gtrait(g.trait).title}</option>)}
        </select>
      </label>
      {gen && <div className="faint" style={{ fontSize: 11.5, marginTop: -2 }}>{gtrait(gen.trait).icon} {gtrait(gen.trait).desc}</div>}
      <label className="ap-row">Strength
        <input type="range" min={0.2} max={3} step={0.1} value={a.weight} onChange={(e) => store.act((g) => actArmyWeight(g, a.id, Number(e.target.value)), true)} />
      </label>
      <div className="ap-orders">
        {(Object.keys(ORDERS) as ArmyOrder[]).map((o) => (
          <button key={o} className={`btn ${a.order === o ? 'primary' : ''}`} title={ORDERS[o].desc} onClick={() => store.act((g) => actArmyOrder(g, a.id, o), true)}>
            <span aria-hidden="true">{ORDERS[o].icon}</span>{ORDERS[o].label}
          </button>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>{ORDERS[a.order].desc}</div>
      <div className="ap-obj">
        <span>Objective: <b>{a.target >= 0 ? geo.provinces[a.target].name : a.order === 'defend' ? 'the capital' : 'general’s choice'}</b></span>
        <button className={`btn ${store.armyAim ? 'primary' : ''}`} onClick={() => { store.armyAim = !store.armyAim; store.notify(); }}>{store.armyAim ? 'Click a region…' : 'Pick on map'}</button>
        {a.target >= 0 && <button className="btn" onClick={() => store.act((g) => actArmyTarget(g, geo, a.id, -1), true)}>Clear</button>}
      </div>
      <div className="ap-tip">Drag the banner onto a region, or right-click a region, to send this army there.</div>
    </div>
  );
}

/** Military tab: all army groups at a glance. */
export function ArmyGroups() {
  const s = store.state!;
  if (ctl(s, 'military') === 'auto') return null;
  const armies = s.armies ?? [];
  const geo = store.geo;
  return (
    <Section title="Army groups" hint="drag them on the map">
      {armies.length === 0 && <button className="btn primary" style={{ width: '100%' }} onClick={() => store.act((g) => { ensureArmies(g); return { ok: true, message: 'Your field forces are organised into three armies.' }; })}>Form army groups<small>three armies you command directly</small></button>}
      {armies.map((a, i) => (
        <button key={a.id} className={`army-row ${store.selectedArmy === a.id ? 'on' : ''}`} onClick={() => store.selectArmy(a.id)}>
          <span className="ap-badge sm">{ROMAN[i]}</span>
          <span className="grow"><b>{a.name}</b><small>{ORDERS[a.order].icon} {ORDERS[a.order].label}{a.target >= 0 ? ` → ${geo.provinces[a.target].name}` : ''} · ≈ {fmtNum(troopsOf(a.id))}</small></span>
        </button>
      ))}
      {armies.length > 0 && (
        <div className="btnrow" style={{ marginTop: 6 }}>
          <button className="btn" disabled={armies.length >= MAX_ARMIES} onClick={() => store.act((g) => actRaiseArmy(g))}>Raise a new army<small>split the field forces further</small></button>
          {store.selectedArmy !== null && <button className="btn" onClick={() => { store.act((g) => actDisbandArmy(g, store.selectedArmy!)); store.selectArmy(null); }}>Disband selected<small>merge it into the others</small></button>}
        </div>
      )}
    </Section>
  );
}
