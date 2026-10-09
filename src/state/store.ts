/**
 * Game store: owns the GameState, the simulation clock (pause / speeds), selection, notifications and saves.
 * The simulation itself is plain TypeScript (src/sim); React only reads from here.
 */
import { useSyncExternalStore } from 'react';
import { loadGeo } from '../sim/load';
import { createGame } from '../sim/init';
import { tick as simTick } from '../sim/tick';
import { serialize, deserialize } from '../sim/save';
import { DEFAULT_SETTINGS, type CountryId, type GameState, type LogEntry, type Settings } from '../sim/types';
import { alliesOf, areAtWar } from '../sim/relations';
import { neighborsOf } from '../sim/diplomacy';
import type { ActionResult } from '../sim/actions';

export type Tab = 'overview' | 'economy' | 'military' | 'diplomacy';
export type MapMode = 'political' | 'diplomacy' | 'wealth' | 'power' | 'stability';
export const SPEEDS = [
  { label: 'Pause', tps: 0 },
  { label: 'Normal', tps: 2 },
  { label: 'Fast', tps: 6 },
  { label: 'Very fast', tps: 16 },
] as const;

export interface Toast { id: number; text: string; kind: LogEntry['kind']; ok?: boolean }
export interface Drawer { open: 'none' | 'world' | 'settings' | 'menu' | 'peace'; worldTab: 'rankings' | 'wars' | 'news' }

const SAVE_KEY = 'world-order-save-v1';
const AUTO_KEY = 'world-order-autosave-v1';

class Store {
  geo = loadGeo();
  state: GameState | null = null;
  version = 0;
  speed = 0;
  selected: CountryId | null = null;
  selectedProv: number | null = null;
  tab: Tab = 'overview';
  mapMode: MapMode = 'political';
  toasts: Toast[] = [];
  drawer: Drawer = { open: 'none', worldTab: 'rankings' };
  peaceTarget: CountryId | null = null;
  unread = 0;
  sheet: 'peek' | 'half' | 'full' = 'half';
  focusRequest = 0; // bumps when the map should pan to the selected country
  pauseOnWar = true;
  preview = true; // true while showing the start-screen world
  private listeners = new Set<() => void>();
  private lastSeq = -1;
  private toastId = 1;
  private acc = 0;
  private raf = 0;
  private last = 0;
  private notifyTimer = 0;
  private lastNotify = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  notify(force = true) {
    const now = performance.now();
    if (!force && now - this.lastNotify < 90) return;
    this.lastNotify = now;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ---- lifecycle ----
  newGame(settings: Settings, player: CountryId) {
    this.state = createGame(this.geo, settings, player);
    this.preview = false;
    this.afterLoad(player);
  }
  /** World shown behind the start screen (never simulated). */
  startPreview() {
    this.state = createGame(this.geo, { ...DEFAULT_SETTINGS }, 0);
    this.preview = true;
    this.speed = 0;
    this.selected = null;
    this.notify();
  }
  setPreviewPlayer(id: CountryId) {
    const s = this.state;
    if (!s || !this.preview) return;
    s.countries[s.player].isPlayer = false;
    s.player = id;
    s.countries[id].isPlayer = true;
    this.selected = id;
    this.notify();
  }
  private afterLoad(player: CountryId) {
    const s = this.state!;
    this.selected = player;
    this.selectedProv = null;
    this.tab = 'overview';
    this.speed = 0;
    this.toasts = [];
    this.unread = 0;
    this.lastSeq = s.logSeq - 1;
    this.focusRequest++;
    this.startLoop();
    this.notify();
  }
  quitToMenu() { this.speed = 0; this.stopLoop(); this.drawer.open = 'none'; this.startPreview(); }

  // ---- clock ----
  setSpeed(i: number) {
    this.speed = i;
    this.acc = 0;
    this.notify();
  }
  togglePause() { this.setSpeed(this.speed === 0 ? 1 : 0); }
  stepOnce() { if (this.state) { this.runTicks(1, false); this.notify(); } }
  private startLoop() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      if (!this.state || this.speed === 0 || this.state.victory?.achieved === false) return;
      this.acc += dt * SPEEDS[this.speed].tps;
      let n = 0;
      while (this.acc >= 1 && n < 12) { this.acc -= 1; n++; }
      if (n > 0) { this.runTicks(n, true); this.notify(false); }
    };
    this.raf = requestAnimationFrame(loop);
  }
  private stopLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  private runTicks(n: number, respectPause: boolean) {
    const s = this.state!;
    for (let i = 0; i < n; i++) {
      simTick(s, this.geo);
      this.processLog();
      if (respectPause && this.speed === 0) break; // an event (e.g. war against us) paused the clock
    }
    if (s.tick % 26 === 0) this.autosave();
  }
  private processLog() {
    const s = this.state!;
    for (const e of s.log) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      const mine = e.countries.includes(s.player);
      if (e.important) this.unread++;
      if (mine && e.kind !== 'info' || (e.important && this.relevant(e))) this.toast(e.text, e.kind);
      if (this.pauseOnWar && e.kind === 'war' && mine && e.countries[0] !== s.player && /declared war|joins|honours/.test(e.text) && this.speed !== 0) {
        this.speed = 0;
        this.toast('Simulation paused: a war involving your country began.', 'danger');
      }
    }
    if (s.victory && !this.victoryShown) { this.victoryShown = true; this.speed = 0; }
  }
  private victoryShown = false;
  private nearCache: { tick: number; set: Set<number> } | null = null;
  /** Is a world event close enough to the player (neighbour, ally, or a major power) to deserve a pop-up? */
  private relevant(e: LogEntry): boolean {
    const s = this.state!;
    if (!this.nearCache || this.nearCache.tick !== s.tick) {
      const set = new Set<number>(neighborsOf(s, this.geo, s.player));
      for (const a of alliesOf(s, s.player)) set.add(a);
      [...s.countries].filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 15).forEach((c) => set.add(c.id));
      this.nearCache = { tick: s.tick, set };
    }
    return e.countries.some((c) => this.nearCache!.set.has(c));
  }
  toast(text: string, kind: LogEntry['kind'] = 'info') {
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts.slice(-3), t];
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.notify(); }, 7000);
  }
  dismissToast(id: number) { this.toasts = this.toasts.filter((x) => x.id !== id); this.notify(); }

  // ---- selection / UI ----
  select(c: CountryId | null, prov: number | null = null, focus = false) {
    this.selected = c;
    this.selectedProv = prov;
    if (focus) this.focusRequest++;
    if (c !== null && this.sheet === 'peek') this.sheet = 'half';
    this.notify();
  }
  setTab(t: Tab) { this.tab = t; this.notify(); }
  setMapMode(m: MapMode) { this.mapMode = m; this.notify(); }
  setSheet(m: 'peek' | 'half' | 'full') { this.sheet = m; this.notify(); }
  openDrawer(d: Drawer['open'], worldTab?: Drawer['worldTab']) {
    this.drawer = { open: d, worldTab: worldTab ?? this.drawer.worldTab };
    if (d === 'world' && this.drawer.worldTab === 'news') this.unread = 0;
    this.notify();
  }
  openPeace(target: CountryId) { this.peaceTarget = target; this.openDrawer('peace'); }

  /** Run a player action that mutates the state, show feedback, refresh UI. */
  act<T extends ActionResult>(fn: (s: GameState) => T, quiet = false): T {
    const s = this.state!;
    const r = fn(s);
    this.processLog(); // consume events caused by the action so they don't re-trigger later
    if (!quiet && r.message) this.toast(r.message, r.ok ? 'econ' : 'danger');
    this.notify();
    return r;
  }
  mutate(fn: (s: GameState) => void) { fn(this.state!); this.notify(); }
  atWarWithPlayer(c: CountryId) { return !!this.state && areAtWar(this.state, c, this.state.player); }

  // ---- saves ----
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  hasAutosave() { try { return !!localStorage.getItem(AUTO_KEY); } catch { return false; } }
  save(): boolean {
    if (!this.state) return false;
    try { localStorage.setItem(SAVE_KEY, serialize(this.state)); this.toast('Game saved.', 'info'); return true; }
    catch { this.toast('Could not save in this browser (storage full or blocked). Use Export instead.', 'danger'); return false; }
  }
  private autosave() { if (!this.state) return; try { localStorage.setItem(AUTO_KEY, serialize(this.state)); } catch { /* ignore */ } }
  load(auto = false): boolean {
    try {
      const txt = localStorage.getItem(auto ? AUTO_KEY : SAVE_KEY);
      if (!txt) return false;
      this.state = deserialize(txt, this.geo.provinces.length);
      this.victoryShown = !!this.state.victory;
      this.preview = false;
      this.afterLoad(this.state.player);
      this.toast('Game loaded.', 'info');
      return true;
    } catch (e) { this.toast(`Load failed: ${(e as Error).message}`, 'danger'); return false; }
  }
  exportFile() {
    if (!this.state) return;
    const blob = new Blob([serialize(this.state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `world-order-${this.state.countries[this.state.player].iso3}-${this.state.tick}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  importText(text: string) {
    try {
      this.state = deserialize(text, this.geo.provinces.length);
      this.victoryShown = !!this.state.victory;
      this.preview = false;
      this.afterLoad(this.state.player);
      this.toast('Save imported.', 'info');
    } catch (e) { this.toast(`Import failed: ${(e as Error).message}`, 'danger'); }
  }
}

export const store = new Store();
// handy for debugging and automated tests
(globalThis as unknown as { __store?: Store }).__store = store;
export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS });
