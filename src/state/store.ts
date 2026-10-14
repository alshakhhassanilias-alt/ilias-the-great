/**
 * Game store: owns the GameState, the simulation clock (pause / speeds), selection, notifications and saves.
 * The simulation itself is plain TypeScript (src/sim); React only reads from here.
 */
import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { loadGeo } from '../sim/load';
import { createGame } from '../sim/init';
import { tick as simTick, tickSlices } from '../sim/tick';
import { setInTick } from '../sim/relations';
import { serialize, deserialize } from '../sim/save';
import { DEFAULT_SETTINGS, type CountryId, type GameState, type LogEntry, type Settings, type WarRecord } from '../sim/types';
import { alliesOf, areAtWar } from '../sim/relations';
import { neighborsOf } from '../sim/diplomacy';
import { eventById } from '../sim/events';
import { sfx, setSound, audio } from '../audio';
import type { ActionResult } from '../sim/actions';

export type Tab = 'overview' | 'goals' | 'economy' | 'military' | 'diplomacy';
export type MapMode = 'political' | 'blocs' | 'diplomacy' | 'wealth' | 'power' | 'stability';
/** Ticks (weeks) per real second. Deliberately gentle: a year takes ~1m45s at Slow, 52s at Normal. */
export const SPEEDS = [
  { label: 'Pause', tps: 0, hint: 'paused' },
  { label: 'Slow', tps: 0.5, hint: '1 week per 2 s' },
  { label: 'Normal', tps: 1, hint: '1 week per second' },
  { label: 'Fast', tps: 2.5, hint: '2-3 weeks per second' },
  { label: 'Very fast', tps: 6, hint: '6 weeks per second' },
] as const;
export const DEFAULT_SPEED = 1;

export interface Toast { id: number; text: string; kind: LogEntry['kind']; ok?: boolean }
export interface Drawer { open: 'none' | 'world' | 'settings' | 'menu' | 'peace' | 'help' | 'legacy'; worldTab: 'rankings' | 'blocs' | 'assembly' | 'wars' | 'news' | 'trophies' }

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
  pauseOnDecision = false;
  /** graphics: auto adapts to the device (drops effects if frames get slow) */
  graphics: 'auto' | 'high' | 'medium' | 'low' = (() => { try { return (localStorage.getItem('wo-graphics') as 'auto' | 'high' | 'medium' | 'low') || 'auto'; } catch { return 'auto'; } })();
  /** quality currently in use (0 low, 1 medium, 2 high), set by the map view */
  quality: 0 | 1 | 2 = 2;
  setGraphics(g: 'auto' | 'high' | 'medium' | 'low') {
    this.graphics = g;
    try { localStorage.setItem('wo-graphics', g); } catch { /* storage unavailable */ }
    this.notify();
  }
  autoSlow = true;
  reviewSeen = 0;
  /** the battle whose report card is open */
  battle: { war: number; prov: number; by: number } | null = null;
  openBattle(b: { war: number; prov: number; by: number } | null) { this.battle = b; this.notify(); }
  breaking: { seq: number; text: string; kind: LogEntry['kind']; prov?: number } | null = null;
  pingSeq = 0; pingProv = -1; pingColor = '#ffd36a';
  /** a dramatic full-width card: a war involving you begins, or one ends (with its result) */
  splash: { kind: 'war'; a: number; d: number } | { kind: 'peace'; rec: WarRecord } | null = null;
  private splashTimer = 0;
  showSplash(sp: NonNullable<Store['splash']>) {
    this.splash = sp;
    clearTimeout(this.splashTimer);
    this.splashTimer = window.setTimeout(() => { this.splash = null; this.notify(); }, sp.kind === 'war' ? 8000 : 10000);
    sfx(sp.kind === 'war' ? 'drums' : sp.rec.winner === 'draw' ? 'peace' : (sp.rec.winner === 'a') === (sp.rec.a === this.state?.player) ? 'fanfare' : 'lost');
  }
  closeSplash() { this.splash = null; clearTimeout(this.splashTimer); this.notify(); }
  /** floating words over the map ("CAPTURED", "ENCIRCLED" ...), handed to the map renderer */
  callouts: { prov: number; text: string; color: string }[] = [];
  private lastHist = 0;
  /** army group selected on the map (and whether the next map click sets its objective) */
  selectedArmy: number | null = null;
  armyAim = false;
  selectArmy(id: number | null) { this.selectedArmy = id; this.armyAim = false; this.notify(); }
  /** Legacy: newest term newspaper already read, and whether the history book was closed */
  termSeen = 0;
  cableSeen = 0;
  bookSeen = false;
  get sound() { return audio.enabled; }
  setSound(on: boolean) { setSound(on); this.notify(); }
  inboxOpen: number | null = null;
  private lastInboxUid = 0;
  rippleSeen = '';
  helpStep = 0;
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
  /** true when the latest notification came from the player (click, key), false when it came from the clock */
  lastUser = true;
  notify(force = true, user = force) {
    const now = performance.now();
    if (!force && now - this.lastNotify < 90) {
      // throttled: make sure the latest state still gets rendered shortly afterwards
      if (!this.notifyTimer) this.notifyTimer = window.setTimeout(() => { this.notifyTimer = 0; this.notify(true, false); }, 100);
      return;
    }
    this.lastUser = user;
    this.lastNotify = now;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ---- lifecycle ----
  newGame(settings: Settings, player: CountryId) {
    this.pending = null;
    this.state = createGame(this.geo, settings, player);
    this.preview = false;
    this.afterLoad(player);
    try { if (!localStorage.getItem('wo-tutorial-1')) { this.helpStep = 0; this.drawer = { open: 'help', worldTab: this.drawer.worldTab }; localStorage.setItem('wo-tutorial-1', '1'); } } catch { /* storage unavailable */ }
  }
  /** World shown behind the start screen (never simulated). */
  startPreview() {
    this.pending = null;
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
    this.lastInboxUid = s.nextInbox - 1;
    this.lastHist = s.warHistory?.length ?? 0;
    this.termSeen = s.stats.reviewTerm ?? 0;
    this.cableSeen = s.stats.cableSeq ?? 0;
    this.bookSeen = false;
    this.splash = null; this.callouts = [];
    this.focusRequest++;
    this.startLoop();
    this.notify();
  }
  quitToMenu() { this.speed = 0; this.stopLoop(); this.drawer.open = 'none'; this.startPreview(); }

  // ---- clock ----
  setSpeed(i: number) {
    if (i > 0) this.lastSpeed = i;
    this.speed = i;
    this.acc = 0;
    this.notify();
  }
  lastSpeed = DEFAULT_SPEED;
  togglePause() { if (this.speed === 0) this.setSpeed(this.lastSpeed || DEFAULT_SPEED); else { this.lastSpeed = this.speed; this.setSpeed(0); } }
  stepOnce() { if (this.state) { this.flushTick(); this.runTicks(1, false); this.notify(); } }
  private startLoop() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (t - this.last) / 1000);
      this.last = t;
      if (!this.state || this.state.victory?.achieved === false) return;
      if (this.speed === 0) { if (this.pending) { this.flushTick(); this.notify(false); } return; }
      this.acc = Math.min(3, this.acc + dt * SPEEDS[this.speed].tps);
      // run the simulation in slices within a small time budget per frame: drawing always gets its share
      const s = this.state, t0 = performance.now();
      let weeks = 0;
      while (performance.now() - t0 < this.sliceBudget) {
        if (!this.pending) { if (this.acc < 1) break; this.acc -= 1; this.pending = tickSlices(s, this.geo); }
        setInTick(true);
        let r: IteratorResult<void>;
        try { r = this.pending.next(); } finally { setInTick(false); }
        if (r.done) {
          this.pending = null; weeks++;
          this.processLog();
          if (s.tick % 52 === 0) this.autosave();
          if (this.speed === 0) break; // an event (e.g. war against us) paused the clock
        }
      }
      if (weeks > 0) this.notify(false);
    };
    this.raf = requestAnimationFrame(loop);
  }
  /** the week being simulated right now (in slices), if any */
  private pending: Generator<void> | null = null;
  /** milliseconds of simulation per frame */
  sliceBudget = 7;
  /** finish the week in progress at once (before saving, stepping or changing games) */
  flushTick() {
    if (!this.pending) return;
    setInTick(true);
    try { while (!this.pending.next().done) { /* finish */ } } finally { setInTick(false); }
    this.pending = null;
    this.processLog();
  }
  private stopLoop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  private runTicks(n: number, respectPause: boolean) {
    const s = this.state!;
    for (let i = 0; i < n; i++) {
      simTick(s, this.geo);
      this.processLog();
      if (respectPause && this.speed === 0) break; // an event (e.g. war against us) paused the clock
    }
    if (s.tick % 52 === 0) this.autosave();
  }
  private processLog() {
    const s = this.state!;
    for (const e of s.log) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      const mine = e.countries.includes(s.player);
      if (e.important) this.unread++;
      if (e.big) this.announce(e);
      if (!this.preview && mine && e.kind === 'war' && /declared war on/.test(e.text)) this.showSplash({ kind: 'war', a: e.countries[0], d: e.countries[1] });
      if (!this.preview && e.prov !== undefined && (mine || e.big)) {
        const tag = /captured it from/.test(e.text) ? (e.countries[0] === s.player ? 'CAPTURED' : e.countries[1] === s.player ? 'LOST' : '') : (/^\S*\s?([A-Z][A-Z ]{3,}[A-Z]):/.exec(e.text)?.[1] ?? (/at the gates/.test(e.text) ? 'AT THE GATES' : ''));
        if (tag) this.callouts.push({ prov: e.prov, text: tag, color: tag === 'LOST' || (e.kind === 'danger' || e.kind === 'war') && !(mine && e.countries[0] === s.player) ? '#ff7a64' : '#ffd36a' });
        if (this.callouts.length > 12) this.callouts.splice(0, this.callouts.length - 12);
      }
      else if (mine && !this.preview) {
        if (e.kind === 'war' && /declared war/.test(e.text) && e.countries[0] !== s.player) sfx('war');
        else if (e.kind === 'territory' && /captured/.test(e.text)) sfx(e.countries[0] === s.player ? 'capture' : 'lost');
      }
      if (!e.big && (mine && e.kind !== 'info' || (e.important && this.relevant(e)))) this.toast(e.text, e.kind);
      if (this.pauseOnWar && e.kind === 'war' && mine && e.countries[0] !== s.player && /declared war|joins|honours/.test(e.text) && this.speed !== 0) {
        this.speed = 0;
        this.toast('Simulation paused: a war involving your country began.', 'danger');
      }
    }
    const hist = s.warHistory ?? [];
    if (this.lastHist > hist.length) this.lastHist = hist.length;
    while (this.lastHist < hist.length) {
      const rec = hist[this.lastHist++];
      if (!this.preview && (rec.a === s.player || rec.b === s.player)) this.showSplash({ kind: 'peace', rec });
    }
    // Legacy: the agenda draft and the newspaper are big moments: the clock stops for them
    const L = s.legacy;
    if (L && s.settings.mode === 'legacy' && !this.preview && this.speed !== 0 && ((L.status === 'office' && L.hand.length > 0) || (s.stats.reviewTerm ?? 0) > this.termSeen || (L.status === 'ended' && !this.bookSeen))) { this.lastSpeed = this.speed || this.lastSpeed; this.speed = 0; }
    if (s.victory && !this.victoryShown) { this.victoryShown = true; this.speed = 0; }
    for (const it of s.inbox) {
      if (it.uid <= this.lastInboxUid) continue;
      this.lastInboxUid = it.uid;
      if (it.urgent) {
        this.toast(`${eventById(it.id).icon} ${eventById(it.id).title}: needs an answer`, 'danger');
        sfx('alert');
        if (this.speed > 2) this.speed = 2; // slow down, never stop
      }
      if (this.pauseOnDecision && this.speed !== 0) this.speed = 0;
    }
  }
  private breakTimer = 0;
  private breakPrio = 0;
  private breakAt = 0;
  /** a world-shaking event: full-width banner, sound, a ring on the map. Rate-limited so fast-forward is not a slideshow of banners. */
  private announce(e: LogEntry) {
    if (this.preview) return;
    const s = this.state!;
    const prio = e.countries.includes(s.player) || this.relevant(e) || /TROPHY|WORLD |complete!/.test(e.text) ? 2 : 1;
    const now = performance.now();
    if (prio < 2 && this.speed >= 3) return; // background world news only when time is not racing
    if (prio >= 2 && this.autoSlow && this.speed > 2) { this.speed = 2; this.acc = 0; } // big news about you: ease off so you can read it
    if (this.breaking && now - this.breakAt < 5500 && prio <= this.breakPrio) return; // let the current one be read
    if (prio < 2 && now - this.breakAt < 8000) return;
    this.breaking = { seq: e.seq, text: e.text, kind: e.kind, prov: e.prov };
    this.breakPrio = prio; this.breakAt = now;
    if (e.prov !== undefined) { this.pingSeq++; this.pingProv = e.prov; this.pingColor = e.kind === 'war' || e.kind === 'danger' ? '#ff6b5a' : '#ffd36a'; }
    sfx(/TROPHY|complete!/.test(e.text) ? 'success' : e.kind === 'war' || e.kind === 'danger' ? 'war' : 'breaking');
    clearTimeout(this.breakTimer);
    this.breakTimer = window.setTimeout(() => { this.breaking = null; this.notify(); }, 9000);
  }
  dismissBreaking() { this.breaking = null; this.notify(); }
  private victoryShown = false;
  openInbox(uid: number | null) { this.inboxOpen = uid; this.notify(); }
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
    if (this.toasts.some((x) => x.text === text)) return; // no duplicates
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts.slice(-2), t]; // at most three on screen
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.notify(); }, 5500);
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
  /** float a word over a region on the map (feedback for a player action) */
  mapCallout(prov: number, text: string, color = '#ffd36a') { if (prov >= 0) { this.callouts.push({ prov, text, color }); this.notify(); } }
  atWarWithPlayer(c: CountryId) { return !!this.state && areAtWar(this.state, c, this.state.player); }

  // ---- saves ----
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  hasAutosave() { try { return !!localStorage.getItem(AUTO_KEY); } catch { return false; } }
  save(): boolean {
    if (!this.state) return false;
    this.flushTick();
    try { localStorage.setItem(SAVE_KEY, serialize(this.state)); this.toast('Game saved.', 'info'); return true; }
    catch { this.toast('Could not save in this browser (storage full or blocked). Use Export instead.', 'danger'); return false; }
  }
  private autosave() { if (!this.state) return; try { localStorage.setItem(AUTO_KEY, serialize(this.state)); } catch { /* ignore */ } }
  load(auto = false): boolean {
    try {
      const txt = localStorage.getItem(auto ? AUTO_KEY : SAVE_KEY);
      if (!txt) return false;
      this.pending = null;
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
    this.flushTick();
    const blob = new Blob([serialize(this.state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `world-order-${this.state.countries[this.state.player].iso3}-${this.state.tick}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  importText(text: string) {
    try {
      this.pending = null;
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
/** Re-render only when the selected (primitive) value changes. */
export function useStoreSelect<T extends string | number | boolean | null>(sel: () => T): T {
  return useSyncExternalStore(store.subscribe, sel);
}
/**
 * For heavy panels: re-render immediately after player actions, but at most every `ms` while the clock runs,
 * so a busy simulation never makes the interface stutter.
 */
export function useStoreThrottled(ms: number) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let last = 0, timer = 0;
    const fn = () => {
      const now = performance.now();
      if (store.lastUser || now - last >= ms) { last = now; if (timer) { clearTimeout(timer); timer = 0; } force(); }
      else if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); force(); }, ms - (now - last));
    };
    const un = store.subscribe(fn);
    return () => { un(); if (timer) clearTimeout(timer); };
  }, [ms]);
  return store;
}
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS });
