/**
 * The screens every PC game has: save and load slots, settings (display, sound, controls), a confirmation
 * dialog, and the pause menu.
 */
import { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store';
import { desktop, isDesktop, setFullscreen } from '../platform';
import { prefs, setPrefs, onPrefs, KEY_ACTIONS, DEFAULT_KEYS, keyName, bindKey, type KeyAction } from '../prefs';
import { Slider, Segmented } from './widgets';
import { music } from '../music';
import { sfx } from '../audio';

export function usePrefs() {
  const [, set] = useState(0);
  useEffect(() => onPrefs(() => set((x) => x + 1)), []);
  return prefs;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString();
};
const size = (n?: number) => (n ? `${(n / 1e6).toFixed(1)} MB` : '');

// ------------------------------------------------------------------ confirmation dialog
export interface Ask { title: string; text: string; ok: string; cancel?: string; danger?: boolean; resolve: (v: boolean) => void }
export function AskDialog() {
  useStore();
  const a = store.asking;
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { okRef.current?.focus(); }, [a]);
  if (!a) return null;
  const done = (v: boolean) => { store.asking = null; store.notify(); a.resolve(v); };
  return (
    <div className="scrim ask-scrim" role="presentation" onClick={() => done(false)}>
      <div className="modal narrow ask" role="alertdialog" aria-modal="true" aria-label={a.title} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }}>
        <div className="modal-head"><h2>{a.title}</h2></div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>{a.text}</p>
          <div className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => done(false)}>{a.cancel ?? 'Cancel'}</button>
            <button ref={okRef} className={`btn ${a.danger ? 'danger' : 'primary'}`} onClick={() => done(true)}>{a.ok}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ save / load
export function SaveScreen({ onClose, mode }: { onClose: () => void; mode: 'save' | 'load' }) {
  useStore();
  const [tab, setTab] = useState<'save' | 'load'>(mode);
  const inGame = !!store.state && !store.preview;
  const s = store.state;
  const [name, setName] = useState(() => (inGame && s ? `${s.countries[s.player].name}, ${new Date().toLocaleDateString()}` : ''));
  const list = store.saveList;
  useEffect(() => { void store.refreshSaves(); }, []);
  const doSave = async (slot: string) => {
    if (list.some((m) => m.name === slot) && !(await store.ask({ title: 'Overwrite save?', text: `“${slot}” already exists. Replace it with the current game?`, ok: 'Overwrite' }))) return;
    if (await store.saveAs(slot)) onClose();
  };
  const doLoad = async (slot: string) => {
    if (inGame && !(await store.ask({ title: 'Load this save?', text: 'Anything you have not saved in the current game will be lost.', ok: 'Load' }))) return;
    if (await store.loadSlot(slot)) onClose();
  };
  const doDelete = async (slot: string) => {
    if (await store.ask({ title: 'Delete save?', text: `“${slot}” will be deleted for good.`, ok: 'Delete', danger: true })) await store.deleteSlot(slot);
  };
  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="modal saves" role="dialog" aria-modal="true" aria-label="Saved games" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{tab === 'save' ? 'Save game' : 'Load game'}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {inGame && <Segmented<'save' | 'load'> value={tab} onChange={setTab} options={[{ v: 'save', label: 'Save' }, { v: 'load', label: 'Load' }]} label="Save or load" />}
          {tab === 'save' && inGame && (
            <form className="sv-new" onSubmit={(e) => { e.preventDefault(); void doSave(name); }}>
              <input id="save-name" aria-label="Save name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary" type="submit" disabled={!name.trim()}>Save</button>
            </form>
          )}
          <div className="sv-list">
            {!store.savesLoaded && <div className="faint">Reading your saves…</div>}
            {store.savesLoaded && !list.length && <div className="faint sv-empty">No saved games yet. {inGame ? 'Name one above and press Save.' : 'Start a game: it autosaves every few months of game time.'}</div>}
            {list.map((m) => (
              <div className="sv-row" key={m.name}>
                <div className="sv-flag" aria-hidden>{m.auto ? '↺' : m.name === 'Quicksave' ? '⚡' : '💾'}</div>
                <div className="sv-info">
                  <b>{m.name}</b>
                  <small>{m.country}{m.date ? ` · ${m.date}` : ''} · {m.mode === 'legacy' ? 'Legacy' : 'Sandbox'} · saved {ago(m.savedAt)}{m.size ? ` · ${size(m.size)}` : ''}</small>
                </div>
                <div className="sv-act">
                  {tab === 'save' && inGame
                    ? <button className="btn" onClick={() => void doSave(m.name)}>Overwrite</button>
                    : <button className="btn primary" onClick={() => void doLoad(m.name)}>Load</button>}
                  <button className="iconbtn" aria-label={`Delete ${m.name}`} title="Delete" onClick={() => void doDelete(m.name)}>🗑</button>
                </div>
              </div>
            ))}
          </div>
          <div className="sv-foot">
            {inGame && <button className="btn" onClick={() => store.exportFile()}>⬇ Export to a file</button>}
            <ImportButton onDone={onClose} />
            {isDesktop && <button className="btn" onClick={() => void desktop!.saves.openFolder()}>📁 Open saves folder</button>}
          </div>
          <p className="faint" style={{ fontSize: 11.5, margin: '8px 0 0' }}>
            Autosave every {prefs.autosaveMonths ? `${prefs.autosaveMonths} month${prefs.autosaveMonths > 1 ? 's' : ''} of game time` : 'never (turned off in Settings)'}, keeping the last {prefs.autosaveSlots}. Quick save {keyName(prefs.keys.quickSave)}, quick load {keyName(prefs.keys.quickLoad)}.
            {isDesktop ? ' Saves are files on your computer; with Steam Cloud on, they follow you to other PCs.' : ' In a browser, saves stay in this browser: export them to keep a copy.'}
          </p>
        </div>
      </div>
    </div>
  );
}
function ImportButton({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" onClick={() => file.current?.click()}>⬆ Import a file</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { store.importText(await f.text()); onDone(); } }} />
    </>
  );
}

// ------------------------------------------------------------------ settings: display, sound, controls
export function DisplaySettings() {
  const p = usePrefs();
  return (
    <div className="pref-grid">
      <label className="check"><input id="pref-fullscreen" type="checkbox" checked={p.fullscreen} onChange={(e) => { setPrefs({ fullscreen: e.target.checked }); void setFullscreen(e.target.checked); }} /><span><b>Fullscreen</b><small>Also {keyName(p.keys.fullscreen)}.</small></span></label>
      {isDesktop
        ? <Slider label="Interface size" value={p.uiScale} min={0.8} max={1.3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => { setPrefs({ uiScale: v }); void desktop!.window.setZoom(v); }} hint="Makes all text and panels bigger or smaller. Useful on large or 4K screens." />
        : <div className="faint" style={{ fontSize: 12 }}>Interface size: use your browser's zoom (Ctrl + and Ctrl −).</div>}
      <div className="field"><label>Map graphics</label><Segmented<'auto' | 'high' | 'medium' | 'low'> value={store.graphics} onChange={(v) => store.setGraphics(v)} options={[{ v: 'auto', label: 'Auto' }, { v: 'high', label: 'Beautiful' }, { v: 'medium', label: 'Balanced' }, { v: 'low', label: 'Fast' }]} />
        <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Auto starts high and lowers the effects by itself if your computer struggles.</div></div>
      <label className="check"><input id="pref-calm" type="checkbox" checked={p.calm} onChange={(e) => { setPrefs({ calm: e.target.checked }); document.documentElement.classList.toggle('calm', e.target.checked); }} /><span><b>Fewer animations</b><small>Panels and numbers change without sliding or fading.</small></span></label>
      <div className="field"><label>Autosave</label>
        <Segmented<number> value={p.autosaveMonths} onChange={(v) => setPrefs({ autosaveMonths: v })} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Monthly' }, { v: 3, label: '3 months' }, { v: 6, label: '6 months' }, { v: 12, label: 'Yearly' }]} label="Autosave interval" />
        <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Of game time. The last {p.autosaveSlots} autosaves are kept.</div>
      </div>
    </div>
  );
}

export function SoundSettings() {
  const p = usePrefs();
  const track = music.current();
  return (
    <div className="pref-grid">
      <label className="check"><input id="pref-sound" type="checkbox" checked={p.soundOn} onChange={(e) => { setPrefs({ soundOn: e.target.checked }); if (e.target.checked) sfx('click'); }} /><span><b>Sound</b><small>All sound on or off.</small></span></label>
      <Slider label="Master volume" value={p.master} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPrefs({ master: v })} />
      <label className="check"><input id="pref-music" type="checkbox" checked={p.musicOn} onChange={(e) => setPrefs({ musicOn: e.target.checked })} /><span><b>Music</b><small>{track ? `Now playing: ${track}` : 'The score changes with the state of the world: calm in peace, tense in a crisis, driving in war.'}</small></span></label>
      <Slider label="Music volume" value={p.music} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPrefs({ music: v })} />
      <Slider label="Effects volume" value={p.sfx} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => { setPrefs({ sfx: v }); sfx('click'); }} />
      <label className="check"><input id="pref-duck" type="checkbox" checked={p.duck} onChange={(e) => setPrefs({ duck: e.target.checked })} /><span><b>Quieter music while paused</b></span></label>
      <label className="check"><input id="pref-mute" type="checkbox" checked={p.muteUnfocused} onChange={(e) => setPrefs({ muteUnfocused: e.target.checked })} /><span><b>Mute when the game is in the background</b></span></label>
    </div>
  );
}

export function ControlSettings() {
  const p = usePrefs();
  const [wait, setWait] = useState<KeyAction | null>(null);
  useEffect(() => {
    if (!wait) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code !== 'Escape' || wait === 'menu') bindKey(wait, e.code);
      setWait(null);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [wait]);
  const groups = [...new Set(KEY_ACTIONS.map((a) => a.group))];
  return (
    <div>
      {groups.map((g) => (
        <div key={g} className="kb-group">
          <h4>{g}</h4>
          {KEY_ACTIONS.filter((a) => a.group === g).map((a) => (
            <div className="kb-row" key={a.id}>
              <span>{a.label}</span>
              <button className={`kb-key${wait === a.id ? ' wait' : ''}`} onClick={() => setWait(wait === a.id ? null : a.id)} aria-label={`Key for ${a.label}: ${keyName(p.keys[a.id])}. Press to change.`}>{wait === a.id ? 'Press a key…' : keyName(p.keys[a.id])}</button>
            </div>
          ))}
        </div>
      ))}
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => setPrefs({ keys: { ...DEFAULT_KEYS } })}>Restore default keys</button>
      </div>
      <p className="faint" style={{ fontSize: 11.5 }}>Mouse: drag to pan, wheel to zoom, click a country or region to select it. The numeric keypad also sets the speed.</p>
    </div>
  );
}
