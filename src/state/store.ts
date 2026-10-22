/**
 * Game store: owns the GameState, the simulation clock (pause / speeds), selection, notifications and saves.
 * The simulation itself is plain TypeScript (src/sim); React only reads from here.
 */
import { breakAway, peripheryOf, unite } from '../sim/epochs';
import type { Goal } from '../sim/negotiate';
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
import { achieve, saves, type SaveMeta } from '../platform';
import type { Ask } from '../ui/SystemScreens';
import { prefs, setPrefs } from '../prefs';
import { dateLabel } from '../sim/tick';

export type Tab = 'overview' | 'politics' | 'goals' | 'economy' | 'military' | 'diplomacy';
export type MapMode = 'political' | 'blocs' | 'diplomacy' | 'wealth' | 'power' | 'stability';
/** Ticks (weeks) per real second: a year takes 52s at Slow, 26s at Normal, 13s at Fast. */
export const SPEEDS = [
  { label: 'Pause', tps: 0, hint: 'paused' },
  { label: 'Slow', tps: 1, hint: '1 week per second' },
  { label: 'Normal', tps: 2, hint: '2 weeks per second' },
  { label: 'Fast', tps: 4, hint: '4 weeks per second' },
  { label: 'Very fast', tps: 8, hint: '8 weeks per second' },
  { label: 'Centuries', tps: 60, hint: 'as fast as your computer allows: watch history unfold' },
] as const;
export const DEFAULT_SPEED = 2;

export interface Toast { id: number; text: string; kind: LogEntry['kind']; ok?: boolean }
export interface Drawer { open: 'none' | 'world' | 'settings' | 'menu' | 'peace' | 'help' | 'legacy' | 'save' | 'load'; worldTab: 'rankings' | 'blocs' | 'assembly' | 'wars' | 'news' | 'trophies' | 'history' }

const QUICK = 'Quicksave';

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
  /** the clock holds while you read a decision, a menu or a dialog, so nothing lapses while your eyes are elsewhere */
  holdWhileReading = (() => { try { return localStorage.getItem('wo-hold') !== '0'; } catch { return true; } })();
  setHoldWhileReading(on: boolean) { this.holdWhileReading = on; try { localStorage.setItem('wo-hold', on ? '1' : '0'); } catch { /* storage unavailable */ } this.notify(); }
  /** pause before a decision with consequences lapses unanswered (urgent ones, or ones with a default outcome) */
  pauseBeforeLapse = true;
  private lapseWarned = new Set<number>();
  /** dialogs that hold the clock while open (negotiation, legacy dossier, ...) */
  private holds = new Set<string>();
  hold(key: string, on: boolean) { const had = this.holds.has(key); if (on) this.holds.add(key); else this.holds.delete(key); if (had !== on) this.notify(); }
  /** why the clock is held right now (null: it is not) */
  get heldBy(): string | null {
    if (!this.holdWhileReading || !this.state || this.preview) return null;
    if (this.inboxOpen !== null && this.state.inbox.some((x) => x.uid === this.inboxOpen)) return 'a decision';
    if (this.holds.size) return [...this.holds][0];
    if (this.drawer.open !== 'none') return 'the menu';
    return null;
  }
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
  /** the last round of world reactions the player has dismissed */
  voiceSeen = 0;
  bookSeen = false;
  get sound() { return audio.enabled; }
  setSound(on: boolean) { setSound(on); this.notify(); }
  inboxOpen: number | null = null;
  /** the negotiating table, when open */
  nego: { them: number; goal: Goal } | null = null;
  /** the war room, when open (a running war, or a past one from the history) */
  warRoom: { id: number; past?: boolean } | null = null;
  openWarRoom(id: number, past = false) { this.warRoom = { id, past }; this.notify(); }
  openNego(them: number, goal: Goal) { this.nego = { them, goal }; this.notify(); }
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
    // every new game is its own world: a fresh seed (unless one was chosen on purpose)
    // (a world can be replayed or shared by its seed: ?seed=12345 in the address)
    const fixed = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('seed')) : NaN;
    if (settings.seed === DEFAULT_SETTINGS.seed) settings = { ...settings, seed: Number.isFinite(fixed) && fixed > 0 ? fixed : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 };
    this.state = createGame(this.geo, settings, player);
    this.preview = false;
    this.afterLoad(player);
    // the first game starts with the walkthrough (How to play stays in the menu)
    if (prefs.walk < 0) setPrefs({ walk: 0 });
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
    this.voiceSeen = s.stats.voiceSeq ?? 0;
    this.bookSeen = false;
    this.achSent = new Set();
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
      if (this.speed === 0 || this.heldBy) { if (this.pending) { this.flushTick(); this.notify(false); } return; }
      this.acc = Math.min(3, this.acc + dt * SPEEDS[this.speed].tps);
      // run the simulation in slices within a small time budget per frame: drawing always gets its share
      const s = this.state, t0 = performance.now();
      let weeks = 0;
      while (performance.now() - t0 < (this.speed >= 5 ? this.sliceBudget + 9 : this.speed >= 4 ? this.sliceBudget + 3 : this.sliceBudget)) {
        if (!this.pending) { if (this.acc < 1) break; this.acc -= 1; this.pending = tickSlices(s, this.geo); }
        setInTick(true);
        let r: IteratorResult<void>;
        const dbg = (globalThis as { __sliceLog?: [string, number][] }).__sliceLog, ts = dbg ? performance.now() : 0;
        try { r = this.pending.next(); }
        catch (err) {
          // a bug in the simulation: pause and report it instead of failing every frame
          setInTick(false);
          this.pending = null; this.speed = 0;
          this.onSimError?.(err);
          this.toast('The simulation hit an error and paused. A report was saved; you can save your game and carry on.', 'danger');
          this.notify();
          return;
        } finally { setInTick(false); }
        if (dbg) dbg.push([(globalThis as { __simSlice?: string }).__simSlice ?? '?', performance.now() - ts]);
        if (r.done) {
          this.pending = null; weeks++;
          const tl = dbg ? performance.now() : 0;
          this.processLog();
          if (dbg) dbg.push(['processLog', performance.now() - tl]);
          const ta = dbg ? performance.now() : 0;
          if (this.autosaveDue(s.tick)) this.autosave();
          if (dbg) dbg.push(['autosave', performance.now() - ta]);
          if (this.speed === 0) break; // an event (e.g. war against us) paused the clock
        }
      }
      const tn = performance.now();
      if (weeks > 0) this.notify(false);
      const dbg = (globalThis as { __sliceLog?: [string, number][] }).__sliceLog;
      if (dbg && weeks > 0) dbg.push(['notify', performance.now() - tn]);
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
    if (this.autosaveDue(s.tick)) this.autosave();
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
      // a toast only for what really happens to you (a war, land won or lost, peace, real danger); the rest of the
      // world is in the news ticker and the News tab, not in your face
      if (!e.big && mine && e.important && (e.kind === 'war' || e.kind === 'territory' || e.kind === 'peace' || e.kind === 'danger')) this.toast(e.text, e.kind);
      if (this.pauseOnWar && e.kind === 'war' && mine && e.countries[0] !== s.player && /declared war|joins|honours/.test(e.text) && this.speed !== 0) {
        this.speed = 0;
        this.toast('Simulation paused: a war involving your country began.', 'danger');
      }
    }
    // trophies are Steam achievements in the desktop app (Steam ignores ones already unlocked)
    for (const id in s.trophies) if (s.trophies[id] > 0 && !this.achSent.has(id)) { this.achSent.add(id); achieve(`ACH_${id.toUpperCase()}`); }
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
        sfx('alert');
        if (this.speed > 2) this.speed = 2; // slow down, never stop
      }
      if (this.pauseOnDecision && this.speed !== 0) this.speed = 0;
    }
    // last chance: stop the clock two weeks before a decision with consequences lapses unanswered
    if (this.pauseBeforeLapse && !this.preview) {
      for (const it of s.inbox) {
        if (this.lapseWarned.has(it.uid) || it.expires - s.tick > 2) continue;
        const def = eventById(it.id);
        if (!it.urgent && !def.lapse) continue;
        this.lapseWarned.add(it.uid);
        if (this.speed !== 0) { this.lastSpeed = this.speed; this.speed = 0; }
        this.toast(`⏳ “${def.title}” needs your answer`, 'danger');
      }
    }
  }
  private breakTimer = 0;
  private breakPrio = 0;
  private breakAt = 0;
  /** a world-shaking event: full-width banner, sound, a ring on the map. Rate-limited so fast-forward is not a slideshow of banners. */
  private announce(e: LogEntry) {
    if (this.preview) return;
    const s = this.state!;
    const prio = e.countries.includes(s.player) || (e.kind === 'war' && this.relevant(e)) || /WORLD CRISIS/.test(e.text) ? 2 : 1;
    const now = performance.now();
    if (prio < 2) return; // world news goes to the ticker; the banner is for what concerns you
    if (prio >= 2 && this.autoSlow && this.speed > 2) { this.speed = 2; this.acc = 0; } // big news about you: ease off so you can read it
    if (this.breaking && now - this.breakAt < 5500 && prio <= this.breakPrio) return; // let the current one be read
    if (prio < 2 && now - this.breakAt < 8000) return;
    this.breaking = { seq: e.seq, text: e.text, kind: e.kind, prov: e.prov };
    this.breakPrio = prio; this.breakAt = now;
    if (e.prov !== undefined) { this.pingSeq++; this.pingProv = e.prov; this.pingColor = e.kind === 'war' || e.kind === 'danger' ? '#ff6b5a' : '#ffd36a'; }
    sfx(/TROPHY|complete!/.test(e.text) ? 'success' : e.kind === 'war' || e.kind === 'danger' ? 'war' : 'breaking');
    clearTimeout(this.breakTimer);
    this.breakTimer = window.setTimeout(() => { this.breaking = null; this.notify(); }, 5000);
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
    const now = performance.now();
    if (kind !== 'danger' && now - this.lastToast < 2500) return; // never a stream of them
    this.lastToast = now;
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts.slice(-1), t]; // at most two on screen
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== t.id); this.notify(); }, 4500);
  }
  private lastToast = 0;
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

  private achSent = new Set<string>();
  /** set by the crash module: records simulation errors */
  onSimError: ((err: unknown) => void) | null = null;

  // ---- dialogs ----
  asking: Ask | null = null;
  /** an in-game confirmation dialog (instead of the browser's confirm box) */
  ask(a: Omit<Ask, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => { if (this.asking) this.asking.resolve(false); this.asking = { ...a, resolve }; this.notify(); });
  }

  // ---- saves ----
  /** the save slots on this computer (newest first), refreshed after every save/delete */
  saveList: SaveMeta[] = [];
  savesLoaded = false;
  async refreshSaves() { this.saveList = await saves.list(); this.savesLoaded = true; this.notify(); return this.saveList; }
  hasSave() { return this.saveList.length > 0; }
  hasAutosave() { return this.saveList.some((m) => m.auto); }
  private meta(name: string, auto = false): SaveMeta {
    const s = this.state!, c = s.countries[s.player];
    return { name, country: c.name, iso3: c.iso3, date: dateLabel(s.tick), tick: s.tick, mode: s.settings.mode ?? 'sandbox', savedAt: Date.now(), auto };
  }
  /** Save into a named slot (overwrites it). */
  async saveAs(name?: string, quiet = false): Promise<boolean> {
    if (!this.state) return false;
    this.flushTick();
    const slot = (name ?? '').trim() || `${this.state.countries[this.state.player].name}, ${dateLabel(this.state.tick)}`;
    try {
      await saves.write(slot, serialize(this.state), this.meta(slot));
      if (!quiet) this.toast(`Saved: ${slot}.`, 'info');
      void this.refreshSaves();
      return true;
    } catch (e) { this.toast(`Could not save (${(e as Error).message || 'storage full or blocked'}). Use Export instead.`, 'danger'); return false; }
  }
  /** older name kept for the menu and tests */
  save(): Promise<boolean> { return this.saveAs(QUICK); }
  quickSave() { return this.saveAs(QUICK); }
  /** The snapshot is taken at the week boundary (so it is consistent); writing waits for an idle moment. Autosaves rotate through a few slots. */
  private autosave() {
    if (!this.state || prefs.autosaveMonths <= 0) return;
    let text: string;
    try { text = serialize(this.state); } catch { return; }
    const n = Math.max(1, prefs.autosaveSlots);
    const autos = this.saveList.filter((m) => m.auto && /^Autosave \d+$/.test(m.name));
    const free = Array.from({ length: n }, (_, i) => `Autosave ${i + 1}`).find((x) => !autos.some((m) => m.name === x));
    const slot = free ?? [...autos].sort((a, b) => a.savedAt - b.savedAt)[0]?.name ?? 'Autosave 1';
    const meta = this.meta(slot, true);
    const write = () => { void saves.write(slot, text, meta).then(() => this.refreshSaves()).catch(() => { /* storage full or unavailable */ }); };
    const ric = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(write, { timeout: 2000 }); else setTimeout(write, 0);
  }
  /** autosave due this week? (every N months of game time) */
  private autosaveDue(tick: number) { const m = prefs.autosaveMonths; return m > 0 && tick > 0 && tick % Math.max(4, Math.round(m * 52 / 12)) === 0; }
  async loadSlot(name: string): Promise<boolean> {
    try {
      const txt = await saves.read(name);
      if (!txt) { this.toast('That save is missing.', 'danger'); return false; }
      this.pending = null;
      this.state = deserialize(txt, this.geo.provinces.length);
      this.victoryShown = !!this.state.victory;
      this.preview = false;
      this.afterLoad(this.state.player);
      this.toast(`Loaded: ${name}.`, 'info');
      return true;
    } catch (e) { this.toast(`Load failed: ${(e as Error).message}`, 'danger'); return false; }
  }
  /** older entry point: the quick save, or the newest save of any kind */
  async load(auto = false): Promise<boolean> {
    if (!this.savesLoaded) await this.refreshSaves();
    const pick = auto ? this.saveList.find((m) => m.auto) : this.saveList.find((m) => m.name === QUICK) ?? this.saveList[0];
    return pick ? this.loadSlot(pick.name) : false;
  }
  quickLoad() { return this.saveList.some((m) => m.name === QUICK) ? this.loadSlot(QUICK) : Promise.resolve(false); }
  continueLatest() { return this.saveList[0] ? this.loadSlot(this.saveList[0].name) : Promise.resolve(false); }
  async deleteSlot(name: string) { await saves.remove(name); await this.refreshSaves(); }
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
void store.refreshSaves();
// handy for debugging and automated tests
(globalThis as unknown as { __store?: Store }).__store = store;
// (test hook: the history engine, so browser tests can stage a breakaway or a union without waiting centuries)
(globalThis as unknown as { __epochs?: unknown }).__epochs = { breakAway, unite, peripheryOf };
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
      // at the fastest speeds the panels refresh a little less often (the numbers change faster than anyone reads them)
      const gap = store.speed >= 3 ? ms * 1.6 : ms;
      if (store.lastUser || now - last >= gap) { last = now; if (timer) { clearTimeout(timer); timer = 0; } force(); }
      else if (!timer) timer = window.setTimeout(() => { timer = 0; last = performance.now(); force(); }, gap - (now - last));
    };
    const un = store.subscribe(fn);
    return () => { un(); if (timer) clearTimeout(timer); };
  }, [ms]);
  return store;
}
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS });
