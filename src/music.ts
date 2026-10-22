/**
 * Adaptive music. Tracks are grouped by mood (menu, peace, tension, war); the game picks the mood from the
 * state of the world and the player crossfades to a track of that mood, then keeps playing tracks of the
 * same mood. Files live in /music (see public/music/README.md: replace them with your own to change the
 * score). The single-file build streams them from the repository; where a file cannot be loaded, the game simply plays
 * without it.
 */
import { prefs, onPrefs } from './prefs';

export type Mood = 'menu' | 'peace' | 'tension' | 'war';
export interface Track { file: string; title: string; mood: Mood }
export const TRACKS: Track[] = [
  { file: 'main-theme.ogg', title: 'The World Order (main theme)', mood: 'menu' },
  { file: 'quiet-capitals.ogg', title: 'Quiet Capitals', mood: 'peace' },
  { file: 'trade-winds.ogg', title: 'Trade Winds', mood: 'peace' },
  { file: 'the-long-game.ogg', title: 'The Long Game', mood: 'peace' },
  { file: 'red-lines.ogg', title: 'Red Lines', mood: 'tension' },
  { file: 'iron-and-fire.ogg', title: 'Iron and Fire', mood: 'war' },
  { file: 'the-front.ogg', title: 'The Front', mood: 'war' },
];

const FADE = 3.5;
/** a new mood has to hold this long before the music follows it (an urgent decision should not flip the score) */
const MOOD_HOLD = 12000;
/** a track plays at least this long before a calmer mood may replace it */
const MIN_PLAY = 25000;
/** where the files are: next to the game, or (in the single-file build) wherever WO_MUSIC_BASE points */
const BASE = (typeof window !== 'undefined' && (window as { WO_MUSIC_BASE?: string }).WO_MUSIC_BASE) || 'music/';

/**
 * The player keeps one track going at all times while music is on: a watchdog checks every second and starts the
 * next track whenever nothing is playing (a track ended, a file failed, the browser cancelled a play), so the music
 * never silently stops. Mood changes wait a few seconds so the score does not flip back and forth.
 */
class Music {
  private a: HTMLAudioElement | null = null;
  private fadingOut: HTMLAudioElement[] = [];
  private now: Track | null = null;
  private mood: Mood | null = null;
  private want: Mood | null = null;
  private wantSince = 0;
  private startedAt = 0;
  private broken = new Set<string>();
  private unlocked = false;
  private starting = false;
  private duck = 1;
  private focus = 1;
  private fadeIn = 1;
  private last: string | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    // browsers only allow sound after the player has interacted; any click or key unlocks it (and re-unlocks it)
    const unlock = () => { this.unlocked = true; this.check(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('blur', () => { this.focus = prefs.muteUnfocused ? 0 : 1; this.apply(); });
    window.addEventListener('focus', () => { this.focus = 1; this.apply(); });
    onPrefs(() => { if (!this.enabled()) this.stop(); this.apply(); this.check(); });
    window.setInterval(() => this.check(), 1000);
  }
  current() { return this.now?.title ?? null; }
  private enabled() { return prefs.musicOn && prefs.soundOn; }
  private vol() { return this.enabled() ? prefs.master * prefs.music * this.duck * this.focus * 0.7 : 0; }
  private apply() { if (this.a) this.a.volume = Math.min(1, this.vol() * this.fadeIn); }
  /** quieter while paused or reading (optional) */
  setDuck(on: boolean) { const d = on && prefs.duck ? 0.45 : 1; if (d !== this.duck) { this.duck = d; this.apply(); } }
  setMood(m: Mood) {
    if (m !== this.want) { this.want = m; this.wantSince = performance.now(); }
    if (this.mood === null) this.mood = m;
    this.check();
  }
  /** the watchdog: follow the mood and keep something playing */
  private check() {
    if (!this.enabled() || !this.unlocked || this.starting || !this.want) return;
    const t = performance.now();
    // follow a new mood once it has held for a while (war cannot wait); a menu change is immediate too
    if (this.want !== this.mood) {
      const urgent = this.want === 'war' || this.want === 'menu' || this.mood === 'menu';
      if (urgent || (t - this.wantSince > MOOD_HOLD && t - this.startedAt > MIN_PLAY)) { this.mood = this.want; if (this.now?.mood !== this.mood) { this.next(); return; } }
    }
    const el = this.a;
    if (!el || el.ended || el.error || (el.paused && t - this.startedAt > 4000)) this.next();
  }
  private pick(): Track | null {
    const pool = TRACKS.filter((x) => x.mood === this.mood && !this.broken.has(x.file));
    if (!pool.length) return null;
    // never the same track twice in a row: a mood with a single track borrows from the next calmer one
    const NEAR: Partial<Record<Mood, Mood>> = { tension: 'peace', war: 'tension' };
    let fresh = pool.filter((x) => x.file !== this.last);
    if (!fresh.length && NEAR[this.mood!]) fresh = TRACKS.filter((x) => x.mood === NEAR[this.mood!] && x.file !== this.last && !this.broken.has(x.file));
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }
  private next() {
    if (!this.enabled() || !this.unlocked) return;
    const tr = this.pick();
    if (!tr) { this.stop(); return; }
    const el = new Audio(`${BASE}${tr.file}`);
    el.preload = 'auto';
    el.volume = 0;
    el.addEventListener('error', () => { this.broken.add(tr.file); if (this.broken.size >= TRACKS.length) this.broken.clear(); });
    const old = this.a;
    this.a = el; this.now = tr; this.last = tr.file; this.startedAt = performance.now(); this.starting = true;
    if (old) this.fadeOut(old);
    this.fadeIn = 0;
    el.play().then(() => { this.starting = false; this.rampIn(el); }).catch((err: { name?: string }) => {
      this.starting = false;
      // only a refusal to play without a click locks the music; a cancelled or failed load is simply retried
      if (err?.name === 'NotAllowedError') this.unlocked = false;
      if (this.a === el) { this.a = null; this.now = null; }
    });
  }
  /** fades run on timers, not animation frames, so they finish in a background tab too */
  private rampIn(el: HTMLAudioElement) {
    const t0 = performance.now();
    const id = window.setInterval(() => {
      if (this.a !== el) { window.clearInterval(id); return; }
      this.fadeIn = Math.min(1, (performance.now() - t0) / (FADE * 1000));
      this.apply();
      if (this.fadeIn >= 1) window.clearInterval(id);
    }, 60);
  }
  private fadeOut(el: HTMLAudioElement) {
    this.fadingOut.push(el);
    const v0 = el.volume, t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (FADE * 1000));
      el.volume = Math.max(0, v0 * (1 - k));
      if (k >= 1) { window.clearInterval(id); el.pause(); el.removeAttribute('src'); el.load(); this.fadingOut = this.fadingOut.filter((x) => x !== el); }
    }, 60);
  }
  stop() {
    for (const el of [this.a, ...this.fadingOut]) if (el) { el.pause(); el.removeAttribute('src'); }
    this.a = null; this.fadingOut = []; this.now = null;
  }
}
export const music = new Music();
