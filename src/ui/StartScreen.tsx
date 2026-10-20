import { desktop, isDesktop } from '../platform';
import { nationalColor } from '../map/palette';
import { Emblem } from './art/Emblem';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from '../map/MapView';
import { store, useStore } from '../state/store';
import { DEFAULT_SETTINGS, type Difficulty, type Settings, type StartCondition, type VictoryMode, type WorldStart } from '../sim/types';
import { ControlPicker } from './ControlPicker';
import { TRAITS, personName } from '../sim/leaders';
import { titleFor } from '../sim/legacy';
import { GOV, REGION, fmtMoney, fmtNum, pct, sizeClass } from './format';
import { Segmented, Slider, Stat } from './widgets';
import { strengthIndex } from '../sim/military';
import { NAME_TO_ID } from '../sim/relations';

const FEATURED = ['United States of America', 'China', 'Germany', 'Japan', 'India', 'United Kingdom', 'France', 'Brazil', 'Russia', 'Poland', 'Turkey', 'Nigeria', 'Israel', 'Taiwan', 'Singapore', 'Argentina'];

export function StartScreen() {
  useStore();
  const s = store.state!;
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [q, setQ] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const picked = store.selected;
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (store.selected === null) store.setPreviewPlayer(NAME_TO_ID['Germany']); }, []);
  const list = useMemo(() => {
    const all = s.countries.filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp);
    if (q.trim()) return all.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40);
    return FEATURED.map((n) => s.countries[NAME_TO_ID[n]]);
  }, [q, s]);
  const c = picked !== null ? s.countries[picked] : null;
  const upd = (p: Partial<Settings>) => setSettings((x) => ({ ...x, ...p }));
  const onPick = (country: number) => { store.setPreviewPlayer(country); store.focusRequest++; store.notify(); };
  return (
    <div className="start">
      <div className="map-area">
        <div className="start-title"><div className="desk-only start-orn">✦ A Grand Strategy of the Modern Age ✦</div><h1>World Order</h1><p>A living geopolitical sandbox. Choose a nation — grow its economy, forge alliances, fight wars and redraw the map. Nothing waits in real time.</p></div>
        <MapView onPick={onPick} focusOnMount={false} />
      </div>
      <div className="start-side">
        <div className="scroll">
          <div className="mode-cards" role="radiogroup" aria-label="Game mode">
            <button role="radio" aria-checked={settings.mode !== 'legacy'} className={`mode-card ${settings.mode !== 'legacy' ? 'on' : ''}`} onClick={() => upd({ mode: 'sandbox' })}>
              <span className="mc-icon" aria-hidden="true">🌍</span><b>Sandbox</b><small>Total freedom. Any nation, no end. You are the nation itself; your storyline is optional.</small>
            </button>
            <button role="radio" aria-checked={settings.mode === 'legacy'} className={`mode-card ${settings.mode === 'legacy' ? 'on' : ''}`} onClick={() => upd({ mode: 'legacy' })}>
              <span className="mc-icon" aria-hidden="true">📜</span><b>Legacy</b><small>You are one leader, term by term. Win elections, keep promises, survive opposition. The world judges you personally, and remembers.</small>
            </button>
          </div>
          <div className="field">
            <label>Choose your country <span className="faint">tap the map or search</span></label>
            <input type="search" placeholder="Search 190+ countries…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search countries" />
            <div className="picklist" role="listbox" aria-label="Countries">
              {list.map((x) => (
                <button key={x.id} className="listitem" role="option" aria-selected={x.id === picked} style={x.id === picked ? { background: 'rgba(242,184,75,.12)' } : undefined} onClick={() => onPick(x.id)}>
                  <span className="dot" style={{ background: nationalColor(x) }} /><span style={{ flex: 1 }}>{x.name}</span><span className="faint num">{fmtMoney(x.eco.gdp)}</span>
                </button>
              ))}
            </div>
          </div>
          {c && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="desk-only start-emblem"><Emblem c={c} size={86} /></div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><h3 style={{ margin: 0, fontSize: 19 }}>{c.name}</h3><span className="pill gold">{sizeClass(c)}</span></div>
              <div className="faint" style={{ fontSize: 12, margin: '2px 0 10px' }}>{GOV[c.gov]} · {REGION[c.region]} · baseline year 2024{c.estimated ? ' · rough estimates' : ''}</div>
              <div className="grid2">
                <Stat label="Population" value={fmtNum(c.eco.pop)} />
                <Stat label="GDP" value={fmtMoney(c.eco.gdp)} sub={`${fmtMoney(c.eco.gdp / c.eco.pop, 0)} / person`} />
                <Stat label="Debt" value={pct(c.eco.debt / c.eco.gdp, 0)} sub="of GDP" />
                <Stat label="Military" value={fmtNum(strengthIndex(c) * 1000)} sub={`${fmtNum(c.mil.troops)} troops${c.mil.nuclear ? ' · ☢' : ''}`} />
              </div>
            </div>
          )}
          {settings.mode === 'legacy' && c && (
            <div className="field"><label>Your name <span className="faint">{titleFor(c.gov)} of {c.name}</span></label>
              <input type="text" value={leaderName || personName(c, 'me', 1)} maxLength={32} onChange={(e) => setLeaderName(e.target.value)} aria-label="Your name" />
            </div>
          )}
          {settings.mode === 'legacy' && c && (
            <div className="field"><label>Your style <span className="faint">pick two · foreign leaders react to it</span></label>
              <div className="style-chips" role="group" aria-label="Your leadership style">
                {TRAITS.map((t) => {
                  const cur = settings.leaderTraits ?? ['pragmatist', 'reformer'];
                  const on = cur.includes(t.id);
                  return <button key={t.id} type="button" className={`pill style-chip ${on ? 'on' : ''}`} aria-pressed={on} title={t.desc} onClick={() => upd({ leaderTraits: on ? cur : [cur[1], t.id] as [string, string] })}>{t.icon} {t.title}</button>;
                })}
              </div>
              <span className="faint" style={{ fontSize: 11.5 }}>{(settings.leaderTraits ?? ['pragmatist', 'reformer']).map((id) => TRAITS.find((t) => t.id === id)?.desc).join(' ')}</span>
            </div>
          )}
          <div className="field"><label>How much do you want to steer? <span className="faint">change any time</span></label>
            <ControlPicker value={settings.control ?? DEFAULT_SETTINGS.control!} onChange={(v) => upd({ control: v })} />
          </div>
          <div className="field"><label>Difficulty</label>
            <Segmented<Difficulty> value={settings.difficulty} onChange={(v) => upd({ difficulty: v })} options={[{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }]} />
          </div>
          <div className="field"><label>Starting economic conditions</label>
            <Segmented<StartCondition> value={settings.start} onChange={(v) => upd({ start: v })} options={[{ v: 'historical', label: 'Historical' }, { v: 'crisis', label: 'Crisis' }, { v: 'prosperous', label: 'Prosperous' }]} />
            <span className="faint" style={{ fontSize: 11.5 }}>{settings.start === 'historical' ? 'Real 2024 baseline.' : settings.start === 'crisis' ? 'Debt +40%, empty treasury, higher inflation, shaky stability.' : 'Strong treasury, lower debt, confident markets.'}</span>
          </div>
          <Slider label="AI aggression" value={settings.aggression} min={0.3} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => upd({ aggression: v })} hint="How readily AI countries start wars. They never automatically target you." />
          <label className="check"><input type="checkbox" checked={settings.defensiveAlliances} onChange={(e) => upd({ defensiveAlliances: e.target.checked })} /><span><b>Defensive alliances</b><br /><span className="faint" style={{ fontSize: 12 }}>Allies may join wars to defend each other. Turn off for a faster, more aggressive sandbox.</span></span></label>
          {settings.mode !== 'legacy' && (
            <details className="world-opts">
              <summary>World options <span className="faint">{settings.world !== 'current' || settings.randomEvents === false || settings.nukes === false || settings.endYear ? 'customised' : 'the world as it is'}</span></summary>
              <div className="field"><label>Starting world</label>
                <Segmented<WorldStart> value={settings.world ?? 'current'} onChange={(v) => upd({ world: v, aggression: v === 'peace' ? 0.5 : v === 'coldwar' ? 1.3 : settings.aggression })} options={[{ v: 'current', label: 'As it is' }, { v: 'depression', label: 'Depression' }, { v: 'coldwar', label: 'Cold war' }, { v: 'peace', label: 'Détente' }]} />
              </div>
              <label className="check"><input type="checkbox" checked={settings.randomEvents !== false} onChange={(e) => upd({ randomEvents: e.target.checked })} /><span><b>Random events</b><br /><span className="faint" style={{ fontSize: 12 }}>Disasters, scandals, discoveries and decisions. Off for a calm, predictable world.</span></span></label>
              <label className="check"><input type="checkbox" checked={settings.storylines !== false} onChange={(e) => upd({ storylines: e.target.checked })} /><span><b>National storyline</b><br /><span className="faint" style={{ fontSize: 12 }}>Acts that arrive when events make them urgent, with branches and endings. Off for a pure sandbox (other countries keep theirs).</span></span></label>
              <label className="check"><input type="checkbox" checked={settings.nukes !== false} onChange={(e) => upd({ nukes: e.target.checked })} /><span><b>Nuclear powers</b><br /><span className="faint" style={{ fontSize: 12 }}>Off: no country has a deterrent, so even great powers can be invaded.</span></span></label>
              <div className="field"><label>Length</label>
                <Segmented<number> value={settings.endYear ?? 0} onChange={(v) => upd({ endYear: v || null })} options={[{ v: 0, label: 'Endless' }, { v: 2035, label: 'Until 2035' }, { v: 2050, label: 'Until 2050' }, { v: 2075, label: 'Until 2075' }]} />
              </div>
            </details>
          )}
          <div className="field" style={{ display: settings.mode === 'legacy' ? 'none' : undefined }}><label>Victory condition</label>
            <select value={settings.victory} onChange={(e) => upd({ victory: e.target.value as VictoryMode })} aria-label="Victory condition">
              <option value="none">None — endless sandbox</option><option value="economic">Economic — 30% of world GDP</option>
              <option value="conquest">Conquest — 40% of world land</option><option value="hegemon">Hegemony — your bloc holds 60% of GDP</option>
            </select>
          </div>
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>Data: approximate 2023–24 figures for GDP, population, debt and military (rounded; game estimates where unknown). Borders: Natural Earth (public domain), subdivided into game provinces. Everything else is simulated.</p>
        </div>
        <div className="foot">
          {store.hasSave() && <button className="btn" onClick={() => void store.continueLatest()} title={`${store.saveList[0].name} · ${store.saveList[0].country}${store.saveList[0].date ? `, ${store.saveList[0].date}` : ''}`}>Continue</button>}
          <button className="btn" onClick={() => store.openDrawer('load')}>Load game</button>
          <button className="btn" onClick={() => store.openDrawer('settings')} aria-label="Settings">⚙</button>
          {isDesktop && <button className="btn" onClick={() => void desktop!.window.quit()}>Quit</button>}
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) store.importText(await f.text()); }} />
          <button className="btn primary" disabled={picked === null} onClick={() => picked !== null && store.newGame({ ...settings, leaderName: settings.mode === 'legacy' && c ? (leaderName.trim() || personName(c, 'me', 1)) : undefined }, picked)}>
            {c ? (settings.mode === 'legacy' ? `Take office in ${c.name}` : `Lead ${c.name}`) : 'Choose a country'}
          </button>
        </div>
      </div>
    </div>
  );
}
