import { store, useStore } from '../state/store';
import { battleReport } from '../sim/battle';
import { actAirstrike, actBuild, actCallAllies, toggleFocus } from '../sim/actions';
import { fmtMoney, fmtNum } from './format';
import { nationalColor } from '../map/palette';
import { levelOf } from '../sim/buildings';

/** The report for one battle: who fights, the odds, everything that tips the balance, and what you can do. */
export function BattleCard() {
  useStore();
  const s = store.state;
  const b = store.battle;
  if (!s || !b) return null;
  const r = battleReport(s, store.geo, b.war, b.prov, b.by);
  if (!r) return null;
  const A = s.countries[r.attacker], D = s.countries[r.defender];
  const me = s.countries[s.player];
  const pct = Math.round(r.progress * 100);
  const total = Math.max(1, r.atkTroops + r.defTroops);
  return (
    <div className="battle-card" role="dialog" aria-label={r.name}>
      <button className="x" aria-label="Close" onClick={() => store.openBattle(null)}>×</button>
      <div className="bc-kicker">⚔ Battle report</div>
      <h3>{r.name}</h3>
      <div className="bc-sides">
        <div><i style={{ background: nationalColor(A) }} /><b>{A.name}</b><small>attacking · {fmtNum(r.atkTroops)} troops</small></div>
        <div className="vs">vs</div>
        <div><i style={{ background: nationalColor(D) }} /><b>{D.name}</b><small>defending · {fmtNum(r.defTroops)} troops</small></div>
      </div>
      <div className="bc-forces" title="Share of troops committed to this battle">
        <span style={{ width: `${(100 * r.atkTroops) / total}%`, background: nationalColor(A) }} />
        <span style={{ width: `${(100 * r.defTroops) / total}%`, background: nationalColor(D) }} />
      </div>
      <div className="bc-row"><span>Ground taken</span><b>{pct}%</b></div>
      <div className="bar"><i style={{ width: `${pct}%`, background: 'var(--red)' }} /></div>
      <div className="bc-row"><span>Situation</span><b className={r.trend === 'advancing' ? 'bad' : r.trend === 'pushed back' ? 'good' : ''}>{r.trend === 'advancing' ? `attacker advancing${r.etaWeeks ? ` · falls in ~${r.etaWeeks} wk` : ''}` : r.trend === 'pushed back' ? 'attack is being pushed back' : 'stalemate'}</b></div>
      <div className="bc-row"><span>Odds (troops)</span><b>{r.odds.toFixed(1)} : 1</b></div>
      <div className="bc-row"><span>Attacker supply</span><b style={{ color: r.supply < 0.55 ? 'var(--red)' : r.supply < 0.75 ? 'var(--amber)' : undefined }}>{Math.round(r.supply * 100)}%{r.pocket ? ' · defenders encircled ⭕' : ''}</b></div>
      <div className="bc-row"><span>War support</span><b>{Math.round(r.wsA * 100)}% vs {Math.round(r.wsD * 100)}%</b></div>
      <div className="bc-row"><span>Losses so far</span><b>{fmtNum(r.lossesAtk)} / {fmtNum(r.lossesDef)}</b></div>
      {r.mods.length > 0 && (
        <div className="bc-mods">
          <div className="why-title">What tips the balance</div>
          {r.mods.map((m, i) => (
            <div className="why-row" key={i}><span>{m.label}</span><b className={m.favours === 'attacker' ? 'atk' : 'def'}>+{m.pct}% {m.favours}</b></div>
          ))}
        </div>
      )}
      {r.role === 'attacker' && (
        <div className="btnrow">
          <button className="btn primary" onClick={() => store.act((g) => actAirstrike(g, g.player, r.prov))}>Air strike<small>{fmtMoney(0.0015 * me.eco.gdp)} · pushes the attack on</small></button>
          <button className="btn" onClick={() => store.act((g) => { if (!g.countries[g.player].mil.focus.includes(r.prov)) return toggleFocus(g, g.player, r.prov); return { ok: true, message: 'Already a priority target' }; })}>Make it a priority<small>generals send more troops here</small></button>
        </div>
      )}
      {r.role === 'defender' && (
        <div className="btnrow">
          <button className="btn primary" disabled={levelOf(s, r.prov, 'fort') >= 3} onClick={() => store.act((g) => actBuild(g, store.geo, g.player, r.prov, 'fort'))}>Dig in: fortress +1<small>+14% defence here</small></button>
          <button className="btn" onClick={() => store.act((g) => actCallAllies(g, g.player))}>Call allies<small>they may answer</small></button>
        </div>
      )}
      {r.role !== 'observer' && <button className="linkbtn" onClick={() => { store.openBattle(null); store.openPeace(r.role === 'attacker' ? r.defender : r.attacker); }}>Negotiate peace instead</button>}
      {r.role === 'observer' && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>You are not part of this war.</div>}
    </div>
  );
}
