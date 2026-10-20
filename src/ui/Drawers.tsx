import { nationalColor } from '../map/palette';
import { TROPHIES } from '../sim/trophies';
import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import { fmtMoney, fmtNum, pct } from './format';
import { Segmented, Slider } from './widgets';
import { actPeace } from '../sim/actions';
import { evaluatePeace, termProvinces, warScore, type PeaceKind } from '../sim/war';
import { EXTRA_ORDER, PEACE_EXTRAS, extraBlocked, extraCost, type PeaceExtra } from '../sim/peaceterms';
import { strength } from '../sim/military';
import { dateLabel } from '../sim/tick';
import { areAtWar, warBetween } from '../sim/relations';
import type { Difficulty, VictoryMode } from '../sim/types';
import { computeBlocs, RES_LABEL, tensionIndex } from '../sim/politics';
import { HelpModal } from './Help';
import { LegacyDossier } from './Legacy';
import { ControlPicker } from './ControlPicker';
import { setControl } from '../sim/modes';
import { Meter } from './widgets';
import { ControlSettings, DisplaySettings, SaveScreen, SoundSettings } from './SystemScreens';
import { desktop, isDesktop } from '../platform';
import { keyName, prefs, setPrefs } from '../prefs';

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
  if (open === 'save' || open === 'load') return <SaveScreen mode={open} onClose={close} />;
  if (store.preview && open === 'settings') return <SettingsDrawer onClose={close} />;
  if (store.preview && open !== 'help') return null;
  if (open === 'world') return <WorldDrawer onClose={close} />;
  if (open === 'menu') return <MenuDrawer onClose={close} />;
  if (open === 'settings') return <SettingsDrawer onClose={close} />;
  if (open === 'peace') return <PeaceDrawer onClose={close} />;
  if (open === 'help') return <HelpModal onClose={close} />;
  if (open === 'legacy' && store.state.legacy) return <LegacyDossier onClose={close} />;
  return null;
}

// ---------------------------------------------------------------- world
function WorldDrawer({ onClose }: { onClose: () => void }) {
  const s = store.state!;
  const tab = store.drawer.worldTab;
  const [metric, setMetric] = useState<'gdp' | 'gdppc' | 'pop' | 'mil' | 'land'>('gdp');
  const [onlyImportant, setOnlyImportant] = useState(true);
  const [newsKind, setNewsKind] = useState<'all' | 'you' | 'war' | 'diplo' | 'econ'>('all');
  const alive = s.countries.filter((c) => c.alive);
  const val = (c: (typeof alive)[number]) => metric === 'gdp' ? c.eco.gdp : metric === 'gdppc' ? c.eco.gdp / c.eco.pop : metric === 'pop' ? c.eco.pop : metric === 'mil' ? strength(c) : c.provinces.length;
  const fmt = (v: number) => metric === 'gdp' ? fmtMoney(v) : metric === 'gdppc' ? fmtMoney(v, 1) : metric === 'pop' ? fmtNum(v) : metric === 'mil' ? fmtNum(v) : `${v}`;
  const ranked = [...alive].sort((a, b) => val(b) - val(a));
  const myRank = ranked.findIndex((c) => c.id === s.player);
  const rows = ranked.slice(0, 20);
  const worldGdp = alive.reduce((t, c) => t + c.eco.gdp, 0);
  const pick = (id: number) => { store.select(id, null, true); onClose(); };
  const news = [...s.log].reverse()
    .filter((l) => !onlyImportant || l.important || l.countries.includes(s.player))
    .filter((l) => newsKind === 'all' || (newsKind === 'you' ? l.countries.includes(s.player) : newsKind === 'war' ? l.kind === 'war' || l.kind === 'territory' || l.kind === 'danger' : newsKind === 'diplo' ? l.kind === 'diplo' || l.kind === 'peace' : l.kind === 'econ'))
    .slice(0, 120);
  return (
    <Modal title="World overview" onClose={onClose}>
      <Segmented value={tab} onChange={(v) => store.openDrawer('world', v)} label="World tabs" options={[{ v: 'rankings', label: 'Rankings' }, { v: 'blocs', label: 'Blocs' }, { v: 'assembly', label: 'Assembly' }, { v: 'wars', label: `Wars (${s.wars.length})` }, { v: 'trophies', label: `Trophies ${Object.keys(s.trophies).length}/${TROPHIES.length}` }, { v: 'news', label: 'News' }]} />
      <div style={{ height: 12 }} />
      {tab === 'rankings' && (
        <>
          <Segmented value={metric} onChange={setMetric} label="Metric" options={[{ v: 'gdp', label: 'GDP' }, { v: 'gdppc', label: 'GDP/cap' }, { v: 'pop', label: 'Population' }, { v: 'mil', label: 'Military' }, { v: 'land', label: 'Territory' }]} />
          <div className="faint" style={{ fontSize: 12, margin: '8px 0' }}>World GDP {fmtMoney(worldGdp)} · your rank #{myRank + 1} of {alive.length} · your share {pct(s.countries[s.player].eco.gdp / worldGdp)}</div>
          <table className="table">
            <thead><tr><th>#</th><th>Country</th><th style={{ textAlign: 'right' }}>{({ gdp: 'GDP', gdppc: 'GDP per person', pop: 'Population', mil: 'Strength', land: 'Provinces' } as Record<string, string>)[metric]}</th><th style={{ textAlign: 'right' }}>{metric === 'gdp' ? 'World share' : 'GDP'}</th></tr></thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={`click ${c.id === s.player ? 'me' : ''}`} onClick={() => pick(c.id)}>
                  <td>{i + 1}</td><td><span className="dot" style={{ background: nationalColor(c), display: 'inline-block', marginRight: 8 }} />{c.name}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(val(c))}</td><td style={{ textAlign: 'right' }} className="muted">{metric === 'gdp' ? pct(c.eco.gdp / worldGdp) : fmtMoney(c.eco.gdp)}</td>
                </tr>
              ))}
              {myRank >= 20 && (<tr className="me click" onClick={() => pick(s.player)}><td>{myRank + 1}</td><td>{s.countries[s.player].name}</td><td style={{ textAlign: 'right' }}>{fmt(val(s.countries[s.player]))}</td><td /></tr>)}
            </tbody>
          </table>
        </>
      )}
      {tab === 'blocs' && (() => {
        const { blocs } = computeBlocs(s);
        const tension = tensionIndex(s);
        const inBloc = new Set(blocs.flatMap((b) => b.members));
        return (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row" style={{ border: 'none', padding: 0 }}><div className="grow"><b>Global tension</b><div className="hint">Rises with wars and standoffs between the great powers; falls with peace and diplomacy.</div></div><div className={`val ${tension > 55 ? 'bad' : tension > 30 ? 'warn' : 'good'}`}>{tension}/100</div></div>
              <Meter value={tension / 100} color={tension > 55 ? 'var(--red)' : tension > 30 ? 'var(--amber)' : 'var(--green)'} />
            </div>
            {blocs.length === 0 && <p className="muted">No alliance blocs exist yet.</p>}
            {blocs.map((b) => (
              <div className="card" key={b.id} style={{ marginBottom: 8 }}>
                <div className="row" style={{ border: 'none', padding: 0 }}>
                  <span className="dot" style={{ background: `hsl(${(b.id * 67 + 20) % 360},55%,48%)` }} />
                  <div className="grow"><b>{b.name}</b> <span className="faint">· {b.members.length} members · {fmtMoney(b.gdp)} · power {fmtNum(b.strength / 1000 * 1000)}</span></div>
                  {b.members.includes(s.player) && <span className="pill gold">Your bloc</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {b.members.map((m) => <button key={m} className="pill" style={{ cursor: 'pointer' }} onClick={() => pick(m)}>{m === b.leader ? '★ ' : ''}{s.countries[m].name}</button>)}
                </div>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 12 }}>{s.countries.filter((c) => c.alive && !inBloc.has(c.id)).length} countries belong to no bloc. Switch the map to "Blocs" to see the alignments. Signing an alliance changes how everyone treats you; rivals of your partner will push back.</div>
          </>
        );
      })()}
      {tab === 'trophies' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {TROPHIES.map((x) => {
            const at = s.trophies[x.id];
            const got = at !== undefined;
            return (
              <div className="card trophy" key={x.id} style={{ opacity: got ? 1 : 0.5, display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 26, filter: got ? 'none' : 'grayscale(1)' }}>{x.icon}</span>
                <div className="grow"><b>{x.title}</b><div className="hint">{x.desc}</div></div>
                <span className="faint" style={{ fontSize: 11 }}>{got ? (at < 0 ? 'from the start' : dateLabel(at)) : 'locked'}</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'assembly' && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Twice a year the World Assembly votes on a resolution (condemn an aggressor, sanction a rogue state, demand a ceasefire, send aid). Your vote shifts relations with both camps, and passed resolutions have real effects.</p>
          {s.resolutions.length === 0 && <p className="muted">No votes yet.</p>}
          {[...s.resolutions].reverse().map((r) => (
            <div className="card" key={r.id} style={{ marginBottom: 8 }}>
              <div className="row" style={{ border: 'none', padding: 0 }}>
                <div className="grow"><b>{RES_LABEL[r.kind]} {s.countries[r.target].name}</b><div className="hint">{dateLabel(r.tick)}{r.victim >= 0 ? ` · victim: ${s.countries[r.victim].name}` : ''}</div></div>
                <span className={`pill ${r.passed ? 'green' : r.passed === false ? 'red' : ''}`}>{r.passed === null ? 'pending' : r.passed ? `passed ${r.yes}–${r.no}` : `failed ${r.yes}–${r.no}`}</span>
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'wars' && (s.warHistory?.length ?? 0) > 0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="why-title">Past wars</div>
          {[...(s.warHistory ?? [])].reverse().slice(0, 15).map((r, i) => {
            const A = s.countries[r.a], B = s.countries[r.b];
            const mine = r.a === s.player || r.b === s.player;
            const won = r.winner === 'draw' ? null : (r.winner === 'a') === (r.a === s.player);
            return (
              <div className="row" key={`${r.id}-${i}`} style={{ fontSize: 12.5, cursor: 'pointer' }} onClick={() => store.openWarRoom(r.id, true)}>
                <div className="grow"><b>{A.name} vs {B.name}</b>{mine && <span className={`pill ${won === null ? '' : won ? 'good' : 'bad'}`} style={{ marginLeft: 6 }}>{won === null ? 'draw' : won ? 'won' : 'lost'}</span>}
                  <div className="hint">{dateLabel(r.start)} – {dateLabel(r.end)} · {r.winner === 'draw' ? 'no clear winner' : `${(r.winner === 'a' ? A : B).name} prevailed`} · {fmtNum(r.casA + r.casB)} casualties · regions {r.provsA >= 0 ? '+' : ''}{r.provsA} / {r.provsB >= 0 ? '+' : ''}{r.provsB}</div></div>
              </div>
            );
          })}
        </div>
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
              <button className="btn sm" style={{ marginTop: 6 }} onClick={() => store.openWarRoom(w.id)}>⚔ Open the war room</button>
            </div>
          ))
      )}
      {tab === 'news' && (
        <>
          <Segmented value={newsKind} onChange={setNewsKind} label="News filter" options={[{ v: 'all', label: 'All' }, { v: 'you', label: 'You' }, { v: 'war', label: 'War' }, { v: 'diplo', label: 'Diplomacy' }, { v: 'econ', label: 'Economy' }]} />
          <label className="check" style={{ padding: '8px 0' }}><input type="checkbox" checked={onlyImportant} onChange={(e) => setOnlyImportant(e.target.checked)} /><span>Only major events and those involving you</span></label>
          <div className="list">
            {news.map((l) => (
              <div className={`row news k-${l.kind}`} key={l.seq} style={{ alignItems: 'flex-start', cursor: l.prov !== undefined ? 'pointer' : undefined }}
                onClick={() => { if (l.prov !== undefined) { store.select(s.owner[l.prov], l.prov, true); onClose(); } }}>
                <span className="t" style={{ minWidth: 78 }}>{dateLabel(l.tick)}</span><span className="grow">{l.text}{l.prov !== undefined && <span className="faint"> · show on map</span>}</span>
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
/** which build this is (and whether Steam is connected): what a tester quotes in a bug report */
function BuildLine() {
  const [steam, setSteam] = useState<string>('');
  useEffect(() => {
    void desktop?.steam.status().then((s) => setSteam(s.on ? `Steam: ${s.user ?? 'connected'}` : 'Steam not running')).catch(() => setSteam(''));
  }, []);
  return <p className="pause-build">World Order {desktop?.version ?? 'web'}{steam ? ` · ${steam}` : ''}</p>;
}
function MenuDrawer({ onClose }: { onClose: () => void }) {
  const quit = async () => { if (await store.ask({ title: 'Quit to the main menu?', text: 'Anything you have not saved will be lost (your last autosave stays).', ok: 'Quit to menu' })) store.quitToMenu(); };
  const exit = async () => { if (await store.ask({ title: 'Quit the game?', text: 'Anything you have not saved will be lost (your last autosave stays).', ok: 'Quit to desktop', danger: true })) void desktop?.window.quit(); };
  return (
    <Modal title="Paused" onClose={onClose} narrow>
      <div className="pause-menu">
        <button className="btn primary" onClick={onClose}>▶ Resume</button>
        <button className="btn" onClick={() => store.openDrawer('save')}>💾 Save game<small>{keyName(prefs.keys.quickSave)} quick save</small></button>
        <button className="btn" onClick={() => store.openDrawer('load')}>📂 Load game<small>{keyName(prefs.keys.quickLoad)} quick load</small></button>
        <button className="btn" onClick={() => store.openDrawer('settings')}>⚙ Settings<small>game, display, sound, controls</small></button>
        <button className="btn" onClick={() => { store.helpStep = 0; store.openDrawer('help'); }}>❓ How to play</button>
        <button className="btn" onClick={() => { setPrefs({ walk: 0 }); onClose(); }}>🧭 Replay the walkthrough</button>
        <button className="btn" onClick={() => void quit()}>Quit to main menu</button>
        {isDesktop && <button className="btn danger" onClick={() => void exit()}>Quit to desktop</button>}
      </div>
      <BuildLine />
    </Modal>
  );
}

// ---------------------------------------------------------------- settings
function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'game' | 'display' | 'sound' | 'controls'>(store.preview ? 'display' : 'game');
  const tabs = [...(store.preview ? [] : [{ v: 'game' as const, label: 'Game' }]), { v: 'display' as const, label: 'Display' }, { v: 'sound' as const, label: 'Sound' }, { v: 'controls' as const, label: 'Controls' }];
  return (
    <Modal title="Settings" onClose={onClose} narrow>
      <div className="set-tabs"><Segmented<typeof tab> value={tab} onChange={setTab} options={tabs} label="Settings section" /></div>
      {tab === 'game' && <GameSettings />}
      {tab === 'display' && <DisplaySettings />}
      {tab === 'sound' && <SoundSettings />}
      {tab === 'controls' && <ControlSettings />}
      <button className="btn primary" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>Done</button>
    </Modal>
  );
}
function GameSettings() {
  const s = store.state!;
  const st = s.settings;
  const upd = (patch: Partial<typeof st>) => store.mutate((g) => { Object.assign(g.settings, patch); });
  return (
    <>
      <Slider label="AI aggression" value={st.aggression} min={0.3} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => upd({ aggression: v })} hint="Scales how willing AI countries are to start wars. Applies to new decisions immediately." />
      <div className="field"><label>Difficulty</label><Segmented<Difficulty> value={st.difficulty} onChange={(v) => upd({ difficulty: v })} options={[{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }]} /></div>
      <label className="check"><input type="checkbox" checked={st.defensiveAlliances} onChange={(e) => upd({ defensiveAlliances: e.target.checked })} /><span><b>Defensive alliances</b><br /><span className="faint" style={{ fontSize: 12 }}>When off, attacked countries fight alone: a faster, more aggressive sandbox.</span></span></label>
      <div className="field"><label>How much do you steer?</label>
        <ControlPicker compact value={s.settings.control ?? { economy: 'hands', military: 'hands', diplomacy: 'hands' }} onChange={(v) => store.act((g) => { for (const k of ['economy', 'military', 'diplomacy'] as const) if (v[k] !== (g.settings.control?.[k] ?? 'hands')) setControl(g, k, v[k]); return { ok: true, message: '' }; }, true)} />
      </div>
      <label className="check"><input type="checkbox" checked={store.autoSlow} onChange={(e) => { store.autoSlow = e.target.checked; store.notify(); }} /><span><b>Slow down on big news about me</b><small>Fast-forward drops to Normal when something major happens to you</small></span></label>
      <label className="check"><input type="checkbox" checked={store.holdWhileReading} onChange={(e) => store.setHoldWhileReading(e.target.checked)} /><span><b>Hold the clock while I read</b><small>On by default: time stops while a decision, a menu or a negotiation is open, so nothing lapses behind your back</small></span></label>
      <label className="check"><input type="checkbox" checked={store.pauseBeforeLapse} onChange={(e) => { store.pauseBeforeLapse = e.target.checked; store.notify(); }} /><span><b>Pause before a decision lapses</b><small>On by default: two weeks before an urgent decision (or one with a default outcome) runs out, the game stops and tells you</small></span></label>
      <label className="check"><input type="checkbox" checked={store.pauseOnDecision} onChange={(e) => { store.pauseOnDecision = e.target.checked; store.notify(); }} /><span><b>Pause whenever a decision arrives</b><small>Off by default: new decisions wait in the inbox while the game runs</small></span></label>
      <label className="check"><input type="checkbox" checked={store.pauseOnWar} onChange={(e) => { store.pauseOnWar = e.target.checked; store.notify(); }} /><span><b>Pause when a war involving me starts</b></span></label>
      <div className="field"><label>Victory condition</label>
        <select value={st.victory} onChange={(e) => upd({ victory: e.target.value as VictoryMode })}>
          <option value="none">None — endless sandbox</option><option value="economic">Economic — 30% of world GDP</option>
          <option value="conquest">Conquest — 40% of world land</option><option value="hegemon">Hegemony — bloc holds 60% of world GDP</option>
        </select>
      </div>
    </>
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
  const [kind, setKind] = useState<PeaceKind>('status_quo');
  const [share, setShare] = useState(0.25);
  const [extras, setExtras] = useState<PeaceExtra[]>([]);
  const [result, setResult] = useState<string | null>(null);
  if (target === null || !areAtWar(s, s.player, target)) return <Modal title="Peace talks" onClose={onClose} narrow><p className="muted">You are no longer at war with this country.</p></Modal>;
  const T = s.countries[target];
  const w = warBetween(s, s.player, target)!;
  const score = warScore(s, w, s.player);
  const canDemand = kind !== 'concede';
  const terms = { kind, share: kind === 'demand' || kind === 'concede' ? share : undefined, extras: canDemand ? extras : [] };
  const ev = evaluatePeace(s, geo, s.player, target, terms);
  const tp = termProvinces(s, geo, s.player, target, terms);
  const likely = ev.willingness >= ev.required;
  const scale = Math.max(1.2, ev.required + 0.2, ev.willingness + 0.2);
  const toggle = (x: PeaceExtra) => setExtras((xs) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]));
  return (
    <Modal title={`Peace conference with ${T.name}`} onClose={onClose} narrow>
      <div className="pc-stats">
        <div><span>Your war score</span><b className={score > 0 ? 'good' : 'bad'}>{score >= 0 ? '+' : ''}{(score * 100).toFixed(0)}</b></div>
        <div><span>Their exhaustion</span><b>{(T.mil.exhaustion * 100).toFixed(0)}%</b></div>
        <div><span>Your exhaustion</span><b>{(s.countries[s.player].mil.exhaustion * 100).toFixed(0)}%</b></div>
      </div>
      <h4 className="pc-h">Borders</h4>
      <div className="pc-kinds" role="radiogroup" aria-label="Territorial settlement">
        {OPTIONS.map((o) => (
          <button key={o.kind} type="button" role="radio" aria-checked={kind === o.kind} className={`pc-kind${kind === o.kind ? ' on' : ''}`} onClick={() => setKind(o.kind)}>
            <b>{o.label}</b><small>{o.desc}</small>
          </button>
        ))}
      </div>
      {(kind === 'demand' || kind === 'concede') && <Slider label="How much" value={share} min={0.1} max={0.6} step={0.05} format={(v) => `${Math.round(v * 100)}% of provinces${tp ? ` (${tp.provs.length})` : ''}`} onChange={setShare} />}
      <h4 className="pc-h">Further demands</h4>
      <div className="pc-extras">
        {EXTRA_ORDER.map((x) => {
          const X = PEACE_EXTRAS[x];
          const why = canDemand ? extraBlocked(s, x, s.player, target) : 'Not when you are the one conceding';
          const on = extras.includes(x) && !why;
          return (
            <label key={x} className={`pc-extra${on ? ' on' : ''}${why ? ' off' : ''}`} title={why ?? undefined}>
              <input type="checkbox" checked={on} disabled={!!why} onChange={() => toggle(x)} />
              <span><b><span aria-hidden>{X.icon}</span> {X.label}</b><small>{why ?? X.desc}</small></span>
              {!why && <em>+{Math.round(extraCost(s, x, target) * 100)}</em>}
            </label>
          );
        })}
      </div>
      <div className="pc-meter" aria-label="Their willingness against what you ask">
        <div className="pc-meter-row"><span>Their willingness</span><div className="pc-track"><i className="will" style={{ width: `${Math.max(0, Math.min(100, (ev.willingness / scale) * 100))}%` }} /></div><b>{Math.round(ev.willingness * 100)}</b></div>
        <div className="pc-meter-row"><span>What you ask</span><div className="pc-track"><i className="req" style={{ width: `${Math.max(0, Math.min(100, (ev.required / scale) * 100))}%` }} /></div><b>{Number.isFinite(ev.required) ? Math.round(ev.required * 100) : '∞'}</b></div>
        <p className="hint">They are <b className={likely ? 'good' : 'bad'}>{likely ? 'likely to accept' : 'likely to refuse'}</b>. {ev.reasons.slice(0, 5).join(' · ')}</p>
      </div>
      {result && <div className="note warn" style={{ margin: '8px 0' }}>{result}</div>}
      <button className="btn primary" style={{ width: '100%' }} onClick={() => {
        const r = store.act((g) => actPeace(g, geo, g.player, target, terms));
        if (r.ok) onClose(); else setResult(r.message);
      }}>Propose these terms</button>
    </Modal>
  );
}
