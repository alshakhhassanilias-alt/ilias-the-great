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
/** where the files are: next to the game, or (in the single-file build) wherever WO_MUSIC_BASE points */
const BASE = (typeof window !== 'undefined' && (window as { WO_MUSIC_BASE?: string }).WO_MUSIC_BASE) || 'music/';
class Music {
  private a: HTMLAudioElement | null = null;
  private b: HTMLAudioElement | null = null;
  private now: Track | null = null;
  private mood: Mood | null = null;
  private broken = new Set<string>();
  private unlocked = false;
  private duck = 1;
  private focus = 1;
  private fading = 0;
  private last: string | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const unlock = () => { this.unlocked = true; if (this.mood && !this.now) this.next(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('blur', () => { this.focus = prefs.muteUnfocused ? 0 : 1; this.apply(); });
    window.addEventListener('focus', () => { this.focus = 1; this.apply(); });
    onPrefs(() => { if (!prefs.musicOn || !prefs.soundOn) this.stop(); else if (this.mood && !this.now) this.next(); this.apply(); });
  }
  current() { return this.now?.title ?? null; }
  private vol() { return prefs.soundOn && prefs.musicOn ? prefs.master * prefs.music * this.duck * this.focus * 0.7 : 0; }
  private apply() { if (this.a && !this.fading) this.a.volume = Math.min(1, this.vol()); }
  /** quieter while paused or reading (optional) */
  setDuck(on: boolean) { const d = on && prefs.duck ? 0.45 : 1; if (d !== this.duck) { this.duck = d; this.apply(); } }
  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    if (!prefs.musicOn || !prefs.soundOn) return;
    if (this.now?.mood === m) return;
    this.next();
  }
  private pick(): Track | null {
    const pool = TRACKS.filter((t) => t.mood === this.mood && !this.broken.has(t.file));
    if (!pool.length) return null;
    const fresh = pool.filter((t) => t.file !== this.last);
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }
  private next() {
    if (!this.unlocked || !prefs.musicOn || !prefs.soundOn) return;
    const t = this.pick();
    if (!t) { this.stop(); return; }
    const el = new Audio(`${BASE}${t.file}`);
    el.preload = 'auto';
    el.volume = 0;
    el.addEventListener('ended', () => { if (this.a === el) { this.now = null; this.next(); } });
    el.addEventListener('error', () => { this.broken.add(t.file); if (this.a === el) { this.a = null; this.now = null; if (this.broken.size < TRACKS.length) this.next(); } });
    const old = this.a;
    this.b = old; this.a = el; this.now = t; this.last = t.file;
    el.play().then(() => this.crossfade(old, el)).catch(() => { /* not allowed yet: retried on the next gesture */ this.unlocked = false; this.a = old; this.now = null; });
  }
  private crossfade(from: HTMLAudioElement | null, to: HTMLAudioElement) {
    const start = performance.now();
    const v0 = from?.volume ?? 0;
    this.fading++;
    const stepFn = () => {
      const k = Math.min(1, (performance.now() - start) / (FADE * 1000));
      to.volume = Math.min(1, this.vol() * k);
      if (from) from.volume = Math.max(0, v0 * (1 - k));
      if (k < 1) requestAnimationFrame(stepFn);
      else { if (from) { from.pause(); from.src = ''; } this.fading--; this.apply(); }
    };
    requestAnimationFrame(stepFn);
  }
  stop() {
    for (const el of [this.a, this.b]) if (el) { el.pause(); el.src = ''; }
    this.a = this.b = null; this.now = null;
  }
}
export const music = new Music();
