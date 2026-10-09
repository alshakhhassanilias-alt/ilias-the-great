import { useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from '../map/MapView';
import { store, useStore } from '../state/store';
import { DEFAULT_SETTINGS, type Difficulty, type Settings, type StartCondition, type VictoryMode } from '../sim/types';
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
        <div className="start-title"><h1>World Order</h1><p>A living geopolitical sandbox. Choose a nation — grow its economy, forge alliances, fight wars and redraw the map. Nothing waits in real time.</p></div>
        <MapView onPick={onPick} focusOnMount={false} />
      </div>
      <div className="start-side">
        <div className="scroll">
          <div className="field">
            <label>Choose your country <span className="faint">tap the map or search</span></label>
            <input type="search" placeholder="Search 190+ countries…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search countries" />
            <div className="picklist" role="listbox" aria-label="Countries">
              {list.map((x) => (
                <button key={x.id} className="listitem" role="option" aria-selected={x.id === picked} style={x.id === picked ? { background: 'rgba(242,184,75,.12)' } : undefined} onClick={() => onPick(x.id)}>
                  <span className="dot" style={{ background: `hsl(${x.color},45%,45%)` }} /><span style={{ flex: 1 }}>{x.name}</span><span className="faint num">{fmtMoney(x.eco.gdp)}</span>
                </button>
              ))}
            </div>
          </div>
          {c && (
            <div className="card" style={{ marginBottom: 14 }}>
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
          <div className="field"><label>Difficulty</label>
            <Segmented<Difficulty> value={settings.difficulty} onChange={(v) => upd({ difficulty: v })} options={[{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }]} />
          </div>
          <div className="field"><label>Starting economic conditions</label>
            <Segmented<StartCondition> value={settings.start} onChange={(v) => upd({ start: v })} options={[{ v: 'historical', label: 'Historical' }, { v: 'crisis', label: 'Crisis' }, { v: 'prosperous', label: 'Prosperous' }]} />
            <span className="faint" style={{ fontSize: 11.5 }}>{settings.start === 'historical' ? 'Real 2024 baseline.' : settings.start === 'crisis' ? 'Debt +40%, empty treasury, higher inflation, shaky stability.' : 'Strong treasury, lower debt, confident markets.'}</span>
          </div>
          <Slider label="AI aggression" value={settings.aggression} min={0.3} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => upd({ aggression: v })} hint="How readily AI countries start wars. They never automatically target you." />
          <label className="check"><input type="checkbox" checked={settings.defensiveAlliances} onChange={(e) => upd({ defensiveAlliances: e.target.checked })} /><span><b>Defensive alliances</b><br /><span className="faint" style={{ fontSize: 12 }}>Allies may join wars to defend each other. Turn off for a faster, more aggressive sandbox.</span></span></label>
          <div className="field"><label>Victory condition</label>
            <select value={settings.victory} onChange={(e) => upd({ victory: e.target.value as VictoryMode })} aria-label="Victory condition">
              <option value="none">None — endless sandbox</option><option value="economic">Economic — 30% of world GDP</option>
              <option value="conquest">Conquest — 40% of world land</option><option value="hegemon">Hegemony — your bloc holds 60% of GDP</option>
            </select>
          </div>
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>Data: approximate 2023–24 figures for GDP, population, debt and military (rounded; game estimates where unknown). Borders: Natural Earth (public domain), subdivided into game provinces. Everything else is simulated.</p>
        </div>
        <div className="foot">
          {(store.hasSave() || store.hasAutosave()) && <button className="btn" onClick={() => { if (!store.load(false)) store.load(true); }}>Continue</button>}
          <button className="btn" onClick={() => file.current?.click()} title="Import a save file">Import</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) store.importText(await f.text()); }} />
          <button className="btn primary" disabled={picked === null} onClick={() => picked !== null && store.newGame(settings, picked)}>
            {c ? `Lead ${c.name}` : 'Choose a country'}
          </button>
        </div>
      </div>
    </div>
  );
}
