import { useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import { fmtMoney, fmtNum, pct } from './format';
import { Segmented, Slider } from './widgets';
import { actPeace } from '../sim/actions';
import { evaluatePeace, termProvinces, warScore, type PeaceKind } from '../sim/war';
import { strength } from '../sim/military';
import { dateLabel } from '../sim/tick';
import { areAtWar, warBetween } from '../sim/relations';
import type { Difficulty, VictoryMode } from '../sim/types';

function Modal({ title, onClose, children, narrow }: { title: string; onClose: () => void; children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Drawers() {
  useStore();
  const open = store.drawer.open;
  if (!store.state || open === 'none') return null;
  const close = () => store.openDrawer('none');
  if (open === 'world') return <WorldDrawer onClose={close} />;
  if (open === 'menu') return <MenuDrawer onClose={close} />;
  if (open === 'settings') return <SettingsDrawer onClose={close} />;
  if (open === 'peace') return <PeaceDrawer onClose={close} />;
  return null;
}

// ---------------------------------------------------------------- world
function WorldDrawer({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const tab = store.drawer.worldTab;
  const [metric, setMetric] = useState<'gdp' | 'gdppc' | 'pop' | 'mil' | 'land'>('gdp');
  const [onlyImportant, setOnlyImportant] = useState(true);
  const alive = s.countries.filter((c) => c.alive);
  const val = (c: (typeof alive)[number]) => metric === 'gdp' ? c.eco.gdp : metric === 'gdppc' ? c.eco.gdp / c.eco.pop : metric === 'pop' ? c.eco.pop : metric === 'mil' ? strength(c) : c.provinces.length;
  const fmt = (v: number) => metric === 'gdp' ? fmtMoney(v) : metric === 'gdppc' ? fmtMoney(v, 1) : metric === 'pop' ? fmtNum(v) : metric === 'mil' ? fmtNum(v) : `${v}`;
  const ranked = [...alive].sort((a, b) => val(b) - val(a));
  const myRank = ranked.findIndex((c) => c.id === s.player);
  const rows = ranked.slice(0, 20);
  const worldGdp = alive.reduce((t, c) => t + c.eco.gdp, 0);
  const pick = (id: number) => { store.select(id, null, true); onClose(); };
  const news = [...s.log].reverse().filter((l) => !onlyImportant || l.important || l.countries.includes(s.player)).slice(0, 80);
  return (
    <Modal title="World overview" onClose={onClose}>
      <Segmented value={tab} onChange={(v) => store.openDrawer('world', v)} label="World tabs" options={[{ v: 'rankings', label: 'Rankings' }, { v: 'wars', label: `Wars (${s.wars.length})` }, { v: 'news', label: 'News' }]} />
      <div style={{ height: 12 }} />
      {tab === 'rankings' && (
        <>
          <Segmented value={metric} onChange={setMetric} label="Metric" options={[{ v: 'gdp', label: 'GDP' }, { v: 'gdppc', label: 'GDP/cap' }, { v: 'pop', label: 'Population' }, { v: 'mil', label: 'Military' }, { v: 'land', label: 'Territory' }]} />
          <div className="faint" style={{ fontSize: 12, margin: '8px 0' }}>World GDP {fmtMoney(worldGdp)} · your rank #{myRank + 1} of {alive.length} · your share {pct(s.countries[s.player].eco.gdp / worldGdp)}</div>
          <table className="table">
            <thead><tr><th>#</th><th>Country</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>GDP</th></tr></thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={`click ${c.id === s.player ? 'me' : ''}`} onClick={() => pick(c.id)}>
                  <td>{i + 1}</td><td><span className="dot" style={{ background: `hsl(${c.color},45%,45%)`, display: 'inline-block', marginRight: 8 }} />{c.name}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(val(c))}</td><td style={{ textAlign: 'right' }} className="muted">{fmtMoney(c.eco.gdp)}</td>
                </tr>
              ))}
              {myRank >= 20 && (<tr className="me click" onClick={() => pick(s.player)}><td>{myRank + 1}</td><td>{s.countries[s.player].name}</td><td style={{ textAlign: 'right' }}>{fmt(val(s.countries[s.player]))}</td><td /></tr>)}
            </tbody>
          </table>
        </>
      )}
      {tab === 'wars' && (
        s.wars.length === 0 ? <p className="muted">The world is at peace.</p> :
          s.wars.map((w) => (
            <div className="card" key={w.id} style={{ marginBottom: 8 }}>
              <b>{w.name}</b> <span className="faint">· since {dateLabel(w.start)}</span>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span className="bad">Attackers:</span> {w.attackers.map((x) => <button key={x} className="pill" style={{ margin: 2, cursor: 'pointer' }} onClick={() => pick(x)}>{s.countries[x].name}</button>)}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span className="good">Defenders:</span> {w.defenders.map((x) => <button key={x} className="pill" style={{ margin: 2, cursor: 'pointer' }} onClick={() => pick(x)}>{s.countries[x].name}</button>)}
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Attacker war score {(warScore(s, w, w.attackers[0]) * 100).toFixed(0)} · {fmtNum(Object.values(w.casualties).reduce((a, b) => a + b, 0))} casualties · {w.fronts.length} fronts</div>
            </div>
          ))
      )}
      {tab === 'news' && (
        <>
          <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /><span>Only major events and those involving you</span></label>
          <div className="list">
            {news.map((l) => (
              <div className="row news" key={l.seq} style={{ alignItems: 'flex-start' }}>
                <span className="t" style={{ minWidth: 78 }}>{dateLabel(l.tick)}</span><span className="grow">{l.text}</span>
              </div>
            ))}
            {news.length === 0 && <p className="muted">Nothing yet.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- menu
function MenuDrawer({ onClose }: { onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Menu" onClose={onClose} narrow>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn" onClick={() => { store.save(); onClose(); }}>💾 Save game (browser)</button>
        <button className="btn" disabled={!store.hasSave()} onClick={() => { store.load(false); onClose(); }}>📂 Load saved game</button>
        <button className="btn" disabled={!store.hasAutosave()} onClick={() => { store.load(true); onClose(); }}>↺ Load autosave</button>
        <button className="btn" onClick={() => store.exportFile()}>⬇ Export save file</button>
        <button className="btn" onClick={() => file.current?.click()}>⬆ Import save file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { store.importText(await f.text()); onClose(); } }} />
        <button className="btn" onClick={() => store.openDrawer('settings')}>⚙ Game settings</button>
        <button className="btn danger" onClick={() => { if (confirm('Quit to the main menu? Unsaved progress will be lost.')) { store.quitToMenu(); } }}>Quit to main menu</button>
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 12 }}>Autosave runs every half year of game time. Keyboard: Space = pause, 1–3 = speed, +/− zoom map.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- settings
function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const st = s.settings;
  const upd = (patch: Partial<typeof st>) => store.mutate((g) => { Object.assign(g.settings, patch); });
  return (
    <Modal title="Game settings" onClose={onClose} narrow>
      <Slider label="AI aggression" value={st.aggression} min={0.3} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => upd({ aggression: v })} hint="Scales how willing AI countries are to start wars. Applies to new decisions immediately." />
      <div className="field"><label>Difficulty</label><Segmented<Difficulty> value={st.difficulty} onChange={(v) => upd({ difficulty: v })} options={[{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }]} /></div>
      <label className="check"><input type="checkbox" checked={st.defensiveAlliances} onChange={(e) => upd({ defensiveAlliances: e.target.checked })} /><span><b>Defensive alliances</b><br /><span className="faint" style={{ fontSize: 12 }}>When off, attacked countries fight alone: a faster, more aggressive sandbox.</span></span></label>
      <label className="check"><input type="checkbox" checked={store.pauseOnWar} onChange={(e) => { store.pauseOnWar = e.target.checked; store.notify(); }} /><span><b>Pause when a war involving me starts</b></span></label>
      <div className="field"><label>Victory condition</label>
        <select value={st.victory} onChange={(e) => upd({ victory: e.target.value as VictoryMode })}>
          <option value="none">None — endless sandbox</option><option value="economic">Economic — 30% of world GDP</option>
          <option value="conquest">Conquest — 40% of world land</option><option value="hegemon">Hegemony — bloc holds 60% of world GDP</option>
        </select>
      </div>
      <button className="btn primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
    </Modal>
  );
}

// ---------------------------------------------------------------- peace
const OPTIONS: { kind: PeaceKind; label: string; desc: string }[] = [
  { kind: 'status_quo', label: 'Ceasefire on current lines', desc: 'Both sides keep the territory they hold now.' },
  { kind: 'restore', label: 'Restore pre-war borders', desc: 'All land captured in this war returns to its original owner.' },
  { kind: 'demand', label: 'Demand territory', desc: 'The enemy cedes a share of its provinces (nearest to your lines first).' },
  { kind: 'concede', label: 'Offer concessions', desc: 'You cede some provinces to buy peace.' },
  { kind: 'surrender', label: 'Demand total surrender', desc: 'The enemy is annexed entirely. Only when it is collapsing.' },
];
function PeaceDrawer({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const geo = store.geo;
  const target = store.peaceTarget;
  const [share, setShare] = useState(0.25);
  const [result, setResult] = useState<string | null>(null);
  if (target === null || !areAtWar(s, s.player, target)) return <Modal title="Peace talks" onClose={onClose} narrow><p className="muted">You are no longer at war with this country.</p></Modal>;
  const T = s.countries[target];
  const w = warBetween(s, s.player, target)!;
  const score = warScore(s, w, s.player);
  return (
    <Modal title={`Peace talks with ${T.name}`} onClose={onClose} narrow>
      <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
        <div className="row" style={{ border: 'none' }}><div className="grow">Your war score</div><div className={`val ${score > 0 ? 'good' : 'bad'}`}>{score >= 0 ? '+' : ''}{(score * 100).toFixed(0)}</div></div>
        <div className="row"><div className="grow">Their exhaustion</div><div className="val">{(T.mil.exhaustion * 100).toFixed(0)}%</div></div>
        <div className="row"><div className="grow">Your exhaustion</div><div className="val">{(s.countries[s.player].mil.exhaustion * 100).toFixed(0)}%</div></div>
      </div>
      {result && <div className="note warn" style={{ marginBottom: 10 }}>{result}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {OPTIONS.map((o) => {
          const terms = { kind: o.kind, share: o.kind === 'demand' || o.kind === 'concede' ? share : undefined };
          const ev = evaluatePeace(s, geo, s.player, target, terms);
          const tp = termProvinces(s, geo, s.player, target, terms);
          const likely = ev.willingness >= ev.required;
          return (
            <div className="card" key={o.kind}>
              <div className="row" style={{ border: 'none', padding: 0 }}>
                <div className="grow"><b>{o.label}</b><div className="hint">{o.desc}{tp ? ` (${tp.provs.length} province${tp.provs.length === 1 ? '' : 's'})` : ''}</div></div>
                <button className="btn primary" onClick={() => {
                  const r = store.act((g) => actPeace(g, geo, g.player, target, terms));
                  if (r.ok) onClose(); else setResult(r.message);
                }}>Propose</button>
              </div>
              {(o.kind === 'demand' || o.kind === 'concede') && <Slider label="Size" value={share} min={0.1} max={0.6} step={0.05} format={(v) => `${Math.round(v * 100)}% of provinces`} onChange={setShare} />}
              <div className="hint" style={{ marginTop: 4 }}>They are <b className={likely ? 'good' : 'bad'}>{likely ? 'likely to accept' : 'unlikely to accept'}</b> · {ev.reasons.slice(0, 3).join(' · ')}</div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
