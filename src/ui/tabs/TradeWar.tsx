/**
 * Trade interface: the world economy card (business cycle, strategic goods, your bans and tariffs) and the
 * trade weapons you can turn on one country (tariffs, export bans).
 */
import { store } from '../../state/store';
import { Section } from '../widgets';
import {
  actBan, actTariff, banBite, banBlocked, bansOf, dependence, GOODS, hasBan, hasTariff, producers, recessionRisk, supplyShare, type Good,
} from '../../sim/trade';
import type { Country } from '../../sim/types';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const GOOD_ORDER: Good[] = ['chips', 'minerals', 'energy', 'food'];

/** Economy tab (your country): the business cycle and strategic goods. */
export function WorldEconomy({ c }: { c: Country }) {
  const s = store.state!;
  const r = recessionRisk(s);
  const e = c.eco, pv = e.prev;
  const price = (g: Good) => (g === 'chips' ? s.market.priceC ?? 1 : g === 'minerals' ? s.market.priceM ?? 1 : g === 'energy' ? s.market.priceE : s.market.priceF);
  const status = (g: Good): { text: string; tone: string } => {
    if (g === 'chips' || g === 'minerals') {
      const sh = supplyShare(c, g);
      const short = g === 'chips' ? pv.shC ?? 0 : pv.shM ?? 0;
      if (sh > 0) return { text: `You make ${pct(sh)} of the world's supply`, tone: 'good' };
      return short > 0.01 ? { text: `${pct(short)} short: ${g === 'chips' ? 'productivity and arms technology suffer' : 'industry suffers'}`, tone: 'bad' } : { text: 'Supplied in full', tone: '' };
    }
    const bal = g === 'energy' ? e.energyCap / Math.max(1, e.energyDemand) : e.foodCap / Math.max(1, e.foodDemand);
    const un = g === 'energy' ? e.energyUnmet : e.foodUnmet;
    if (bal >= 1) return { text: `Exporter (${pct(bal)} of your needs)`, tone: 'good' };
    return un > 0.02 ? { text: `Importer, ${pct(un)} of demand unmet`, tone: 'bad' } : { text: `Importer (you make ${pct(bal)} of what you use)`, tone: '' };
  };
  const myBans = bansOf(s).filter((b) => b.from === c.id || b.to === c.id);
  const myTariffs = Object.keys(s.tariffs ?? {}).map((k) => k.split('>').map(Number)).filter(([a, b]) => a === c.id || b === c.id);
  return (
    <Section title="World economy" hint={r.phase}>
      <div className="card we-cycle">
        <div className="we-risk">
          <span>Risk of a world recession within a year</span>
          <div className="we-bar"><i style={{ width: pct(r.risk), background: r.risk > 0.45 ? 'var(--red)' : r.risk > 0.25 ? 'var(--amber)' : 'var(--green)' }} /></div>
          <b className={r.risk > 0.45 ? 'bad' : r.risk > 0.25 ? 'warn' : 'good'}>{pct(r.risk)}</b>
        </div>
        <ul className="we-signs">
          {r.signs.map((x) => <li key={x.label} className={x.on ? 'on' : ''}><span aria-hidden>{x.on ? '⚠' : '·'}</span>{x.label}</li>)}
        </ul>
        {s.crisis?.id === 'recession' && <div className="note warn">The world is in recession: trade shrinks and debt-heavy countries are hit hardest.</div>}
      </div>
      <div className="we-goods">
        {GOOD_ORDER.map((g) => {
          const p = price(g), st = status(g);
          return (
            <div className="we-good" key={g} title={GOODS[g].desc}>
              <div className="we-good-h"><span aria-hidden>{GOODS[g].icon}</span><b>{GOODS[g].label}</b><em className={p > 1.25 ? 'bad' : p < 0.9 ? 'good' : ''}>{pct(p)}</em></div>
              <small className={st.tone}>{st.text}</small>
              {(g === 'chips' || g === 'minerals') && <small className="faint">Main makers: {producers(g).slice(0, 4).map(([id]) => s.countries[id]?.name).join(', ')}</small>}
            </div>
          );
        })}
      </div>
      {(myBans.length > 0 || myTariffs.length > 0) && (
        <div className="card we-measures">
          {myBans.map((b, i) => <div key={`b${i}`}>{GOODS[b.good].icon} {b.from === c.id ? `You ban ${GOODS[b.good].short} exports to ${s.countries[b.to].name}` : `${s.countries[b.from].name} bans ${GOODS[b.good].short} exports to you`}</div>)}
          {myTariffs.map(([a, b], i) => <div key={`t${i}`}>🧱 {a === c.id ? `Your tariffs on ${s.countries[b].name}` : `${s.countries[a].name}'s tariffs on you`}</div>)}
        </div>
      )}
    </Section>
  );
}

/** Diplomacy tab (another country): tariffs and export bans. */
export function TradeWeapons({ id }: { id: number }) {
  const s = store.state!;
  const me = s.countries[s.player], T = s.countries[id];
  const dep = dependence(s, s.player, id), theirDep = dependence(s, id, s.player);
  const myTariff = hasTariff(s, s.player, id), theirTariff = hasTariff(s, id, s.player);
  return (
    <Section title="Trade weapons" hint={`${pct(dep)} of your trade is with them`}>
      <div className="card tw-card">
        <div className="tw-row">
          <div><b>🧱 Tariffs</b><small>A little revenue and happier unions and nationalists; trade with them shrinks on both sides. {T.eco.gdp > 0.3 * me.eco.gdp ? 'They are big enough to hit back.' : 'They are probably too small to hit back.'}{theirTariff ? ' They already have tariffs on you.' : ''}</small></div>
          <button className={`btn ${myTariff ? 'primary' : ''}`} onClick={() => store.act((g) => actTariff(g, id, !myTariff))}>{myTariff ? 'Lift tariffs' : 'Impose tariffs'}<small>{pct(dep * 0.6)} of your trade with them at risk</small></button>
        </div>
        {GOOD_ORDER.map((g) => {
          const on = hasBan(s, s.player, id, g);
          const why = on ? null : banBlocked(s, s.player, id, g);
          const bite = banBite(s, s.player, id, g);
          if (why && !on) return null;
          return (
            <div className="tw-row" key={g}>
              <div><b>{GOODS[g].icon} Ban {GOODS[g].short} exports</b><small>{bite > 0.01 ? `They would lose about ${pct(bite)} of their supply.` : `They hardly buy ${GOODS[g].short} from you: little effect.`} {GOODS[g].desc} Relations −15.</small></div>
              <button className={`btn ${on ? 'primary' : 'danger'}`} onClick={() => store.act((x) => actBan(x, id, g, !on))}>{on ? 'Lift the ban' : 'Ban exports'}<small>{on ? 'resume sales' : `hurts them ${bite > 0.25 ? 'badly' : bite > 0.08 ? 'noticeably' : 'a little'}`}</small></button>
            </div>
          );
        })}
        {GOOD_ORDER.every((g) => banBlocked(s, s.player, id, g) && !hasBan(s, s.player, id, g)) && <div className="faint" style={{ fontSize: 12 }}>You make none of the strategic goods they need, so you have no export ban to use against them.</div>}
        {bansOf(s).filter((b) => b.from === id && b.to === s.player).map((b) => <div key={b.good} className="note warn">{GOODS[b.good].icon} {T.name} bans {GOODS[b.good].short} exports to you.</div>)}
        <div className="faint" style={{ fontSize: 11.5 }}>They depend on you for {pct(theirDep)} of their trade.</div>
      </div>
    </Section>
  );
}
