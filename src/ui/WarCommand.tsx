/**
 * The war room's command section: campaigns to order against the enemy, and the lands you occupy (resistance
 * and occupation policy).
 */
import { useState } from 'react';
import { store } from '../state/store';
import {
  activeCamp, BOMB_AIMS, blockadeEffect, bombEffect, campBlocked, CAMPAIGNS, cancelCampaign, launchCampaign, type BombAim, type CampKind,
} from '../sim/campaigns';
import { OCC_ORDER, OCC_POLICIES, actOccPolicy, occPolicy, occupationSummary, resistanceParts } from '../sim/occupation';
import { fmtMoney } from '../sim/util';
import type { CountryId, GameState } from '../sim/types';

const KINDS: CampKind[] = ['offensive', 'bombing', 'blockade', 'dig_in'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Campaigns({ s, foe }: { s: GameState; foe: CountryId }) {
  const geo = store.geo;
  const me = s.countries[s.player], T = s.countries[foe];
  const [aim, setAim] = useState<BombAim>('industry');
  return (
    <div className="wc-camps">
      {KINDS.map((k) => {
        const def = CAMPAIGNS[k];
        const run = activeCamp(s, me, k, k === 'dig_in' ? undefined : foe);
        const why = run ? null : campBlocked(s, geo, s.player, k, foe);
        const left = run && run.until ? run.until - s.tick : 0;
        const prog = run && run.until ? 1 - left / def.weeks : 0;
        const odds = k === 'bombing' ? bombEffect(me, T) : k === 'blockade' ? blockadeEffect(me, T) : null;
        return (
          <div className={`wc-camp${run ? ' on' : ''}`} key={k}>
            <div className="wc-camp-h"><span className="wc-ico" aria-hidden>{def.icon}</span><b>{def.label}</b>{run && <em>{run.until ? `${left} wk left` : 'in force'}</em>}</div>
            <p>{def.desc}</p>
            <ul>{def.effects.map((x) => <li key={x}>{x}</li>)}</ul>
            {odds !== null && <div className="wc-odds"><span>Expected effect</span><div className="wc-bar"><i style={{ width: pct(Math.min(1, odds / 1.3)) }} /></div><b className={odds > 0.7 ? 'good' : odds < 0.35 ? 'bad' : ''}>{odds > 0.9 ? 'Strong' : odds > 0.55 ? 'Solid' : odds > 0.3 ? 'Weak' : 'Futile'}</b></div>}
            {k === 'bombing' && !run && (
              <div className="wc-aims" role="radiogroup" aria-label="Bombing target">
                {(Object.keys(BOMB_AIMS) as BombAim[]).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={aim === a} className={`wc-aim${aim === a ? ' on' : ''}`} title={BOMB_AIMS[a].desc} onClick={() => setAim(a)}>{BOMB_AIMS[a].label}</button>
                ))}
              </div>
            )}
            {run && run.until > 0 && <div className="wr-prog"><i style={{ width: pct(prog) }} /></div>}
            {run && run.aim && <div className="hint">Target: {BOMB_AIMS[run.aim].label.toLowerCase()}</div>}
            <div className="wc-act">
              {run
                ? (k === 'blockade' || k === 'bombing' || k === 'dig_in') && <button className="btn" onClick={() => store.act((g) => cancelCampaign(g, g.player, k, run.target))}>Call off</button>
                : <button className="btn primary" disabled={!!why} title={why ?? undefined} onClick={() => store.act((g) => launchCampaign(g, geo, g.player, k, foe, aim))}>Order{k === 'offensive' ? ` · ${fmtMoney(0.0015 * me.eco.gdp)}` : ''}</button>}
              {why && <small className="faint">{why}</small>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Occupation({ s }: { s: GameState }) {
  const me = s.countries[s.player];
  const sum = occupationSummary(s, s.player);
  const pol = occPolicy(s, me);
  const geo = store.geo;
  const [open, setOpen] = useState<number | null>(null);
  if (!sum.list.length) return null;
  return (
    <>
      <h4 className="wr-h">Lands you occupy · {sum.list.length} region{sum.list.length > 1 ? 's' : ''} · resistance {pct(sum.avg)}{sum.hot ? ` · ${sum.hot} close to revolt` : ''}</h4>
      <div className="wc-pol" role="radiogroup" aria-label="Occupation policy">
        {OCC_ORDER.map((p) => {
          const P = OCC_POLICIES[p];
          return (
            <button key={p} type="button" role="radio" aria-checked={pol === p} className={`wc-polbtn${pol === p ? ' on' : ''}`} onClick={() => store.act((g) => actOccPolicy(g, p))}>
              <b><span aria-hidden>{P.icon}</span> {P.label}</b>
              <small>{P.desc}</small>
              <span className="good">{P.pros.join(' · ')}</span>
              <span className="bad">{P.cons.join(' · ')}</span>
            </button>
          );
        })}
      </div>
      <div className="wc-occ">
        {sum.list.slice(0, 10).map((x) => {
          const name = geo.provinces[x.p]?.name || `${s.countries[x.core]?.name} region`;
          return (
            <div key={x.p} className="wc-occ-row">
              <button type="button" className="wc-occ-name" onClick={() => setOpen(open === x.p ? null : x.p)} aria-expanded={open === x.p}>
                <b>{name}</b><small>from {s.countries[x.core]?.name} · integrated {pct(x.integ)}</small>
              </button>
              <div className="wc-bar res"><i style={{ width: pct(x.r) }} /></div>
              <b className={`wc-r ${x.r > 0.6 ? 'bad' : x.r < 0.3 ? 'good' : ''}`}>{pct(x.r)}</b>
              {open === x.p && (
                <div className="wc-why">{resistanceParts(s, x.p).map((r) => <span key={r.label}>{r.label} <b className={r.v > 0 ? 'bad' : 'good'}>{r.v > 0 ? '+' : '−'}{Math.round(Math.abs(r.v) * 100)}</b></span>)}</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">Resistance above about 60% can turn into an uprising that drives your garrison out. High resistance also stops a region integrating and costs you soldiers every week.</p>
    </>
  );
}

/** Command section of the war room for a war the player is fighting. */
export function WarCommand({ s, foe }: { s: GameState; foe: CountryId }) {
  return (
    <>
      <h4 className="wr-h">Campaigns against {s.countries[foe].name}</h4>
      <Campaigns s={s} foe={foe} />
      <Occupation s={s} />
    </>
  );
}
