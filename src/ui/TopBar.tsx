import { store, useStoreThrottled } from '../state/store';
import { fmtMoney, pct, signedPct } from './format';
import { fiscalNow } from '../sim/economy';
import { warSupport } from '../sim/warsupport';
import { isAtWar } from '../sim/relations';
import { LegacyChip } from './Legacy';
import { Tween, DeltaPop } from './Tween';

export function TopBar() {
  useStoreThrottled(300);
  const s = store.state!;
  const c = s.countries[s.player];
  const e = c.eco;
  const fn = fiscalNow(c, s);
  const bal = fn.balance / e.gdp;
  return (
    <header className="topbar">
      <div className="brand" aria-label="World Order">
        <svg width="26" height="26" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0d1b2a" stroke="#f2b84b" strokeWidth="2" /><path d="M2 16h28M16 2c6 5 6 23 0 28M16 2c-6 5-6 23 0 28" fill="none" stroke="#f2b84b" strokeWidth="1.4" /></svg>
        <span>World Order</span>
      </div>
      <LegacyChip />
      <div className="kpis" role="list">
        {c.politics && (!s.legacy || s.legacy.status === 'office') && <button className="kpi kpi-btn hide-m pc-kpi" role="listitem" title="Political capital: spend it on laws, reforms and crisis responses. Click for politics." onClick={() => { store.select(s.player, null, false); store.setTab('politics'); }}><label>Political capital</label><b className={c.politics.pc < 15 ? 'warn' : 'good'}><Tween value={c.politics.pc} format={(v) => Math.floor(v).toString()} /><DeltaPop value={Math.floor(c.politics.pc)} min={2} fmt={(d) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}`} /></b><small>{c.politics.arc ? '⚠ crisis' : c.politics.unrest && s.tick < c.politics.unrest.until ? '🔥 unrest' : `${c.politics.laws.length} laws`}</small></button>}
        <div className="kpi" role="listitem" title={`Treasury: cash in hand now. Below it, the annual budget balance (revenue − spending): ${fn.balance >= 0 ? 'a surplus' : 'a deficit'} of ${fmtMoney(Math.abs(fn.balance))} a year.${fn.balance < 0 ? ' A deficit drains the treasury, then is borrowed.' : ''}`}><label>Treasury</label><b className={e.cash <= 0 ? 'warn' : ''}><Tween value={e.cash} format={(v) => fmtMoney(v)} /><DeltaPop value={e.cash} min={0.0015 * e.gdp} fmt={(d) => `${d > 0 ? '+' : '−'}${fmtMoney(Math.abs(d))}`} /></b><small className={bal < 0 ? 'bad' : 'good'}>{bal >= 0 ? 'surplus ' : 'deficit '}{fmtMoney(Math.abs(fn.balance))}/yr</small></div>
        <div className={`kpi ${isAtWar(s, c.id) ? "hide-s" : ""}`} role="listitem"><label>GDP</label><b><Tween value={e.gdp} format={(v) => fmtMoney(v)} /></b><small className={e.growth < 0 ? 'bad' : ''}>{signedPct(e.growth)} real</small></div>
        <div className="kpi hide-m" role="listitem"><label>GDP / capita</label><b><Tween value={e.gdp / e.pop} format={(v) => fmtMoney(v, 1)} /></b><small>{c.name.length > 14 ? c.iso3 : c.name}</small></div>
        <div className="kpi hide-s" role="listitem"><label>Debt</label><b className={e.debt / e.gdp > 1.5 ? 'bad' : ''}><Tween value={e.debt / e.gdp} format={(v) => pct(v, 0)} /></b><small>of GDP</small></div>
        <div className="kpi hide-m" role="listitem"><label>Inflation</label><b className={e.inflation > 0.08 ? 'bad' : ''}><Tween value={e.inflation} format={(v) => pct(v)} /></b><small>jobless {pct(e.unemployment)}</small></div>
        {isAtWar(s, c.id) && (() => {
          const ws = warSupport(c);
          const trend = Object.entries(c.mil.wsParts ?? {}).filter(([k]) => !k.startsWith('+')).reduce((t, [, v]) => t + v, 0);
          return (
            <button className="kpi kpi-btn ws-kpi" role="listitem" title="War support: public backing for the war. Click for the home front." onClick={() => { store.select(s.player, null, false); store.setTab('military'); }}>
              <label>War support</label><b className={ws < 0.3 ? 'bad' : ws < 0.45 ? 'warn' : 'good'}>{Math.round(ws * 100)}%</b><small className={trend < -0.0005 ? 'bad' : trend > 0.0005 ? 'good' : ''}>{trend > 0.0005 ? '▲ rising' : trend < -0.0005 ? '▼ falling' : 'steady'}</small>
            </button>
          );
        })()}
        <div className="kpi hide-s" role="listitem"><label>Stability</label><b className={e.stability < 35 ? 'bad' : e.stability > 60 ? 'good' : 'warn'}><Tween value={e.stability} format={(v) => v.toFixed(0)} /><DeltaPop value={Math.round(e.stability)} min={2} fmt={(d) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}`} /></b><small>{s.wars.some((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id)) ? '⚔ at war' : 'at peace'}</small></div>
      </div>
      <div className="topbtns">
        <button className="iconbtn" aria-label="World rankings, wars and news" onClick={() => store.openDrawer('world')}>🌍<span className="hide-m"> World</span>{store.unread > 0 && <span className="badge">{Math.min(store.unread, 99)}</span>}</button>
        <button className="iconbtn" aria-label={store.sound ? 'Mute sound' : 'Turn sound on'} aria-pressed={store.sound} onClick={() => store.setSound(!store.sound)}>{store.sound ? '🔊' : '🔇'}</button>
        <button className="iconbtn" aria-label="Menu" onClick={() => store.openDrawer('menu')}>☰</button>
      </div>
    </header>
  );
}
