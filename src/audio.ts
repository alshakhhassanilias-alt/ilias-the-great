/**
 * Sound effects, synthesised in the browser (no audio files, nothing to license). A small mixing desk:
 *   voices (bells by frequency modulation, plucks, soft thumps, filtered noise, detuned pads)
 *   → two buses (game moments and interface sounds, each with its own volume)
 *   → a gentle compressor and a short synthetic room reverb → the speakers.
 * Off until the browser allows audio; volumes and switches come from the player's preferences.
 */
import { prefs, setPrefs, onPrefs } from './prefs';
let ctx: AudioContext | null = null;
let master: GainNode | null = null, fxBus: GainNode | null = null, uiBus: GainNode | null = null, wet: GainNode | null = null;
let focused = true;
export const audio = { get enabled() { return prefs.soundOn; } };
const on = () => prefs.soundOn && (focused || !prefs.muteUnfocused);
const level = () => (on() ? prefs.master : 0);
const apply = () => {
  if (!ctx || !master || !fxBus || !uiBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(level(), t, 0.02);
  fxBus.gain.setTargetAtTime(prefs.sfx, t, 0.02);
  uiBus.gain.setTargetAtTime(prefs.uiSounds ? prefs.sfx * (prefs.uiVol ?? 0.6) : 0, t, 0.02);
};
onPrefs(apply);
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => { focused = false; apply(); });
  window.addEventListener('focus', () => { focused = true; apply(); });
}

/** a short room: decaying stereo noise as the impulse of a convolver */
function room(c: AudioContext, secs = 1.4) {
  const n = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
  const cv = c.createConvolver(); cv.buffer = buf; return cv;
}
function ac(): AudioContext | null {
  if (!on() || level() <= 0) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp).connect(ctx.destination);
      const rv = room(ctx); wet = ctx.createGain(); wet.gain.value = 0.22; rv.connect(wet).connect(master);
      fxBus = ctx.createGain(); uiBus = ctx.createGain();
      for (const b of [fxBus, uiBus]) { b.connect(master); b.connect(rv); }
      apply();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

type Bus = 'fx' | 'ui';
const busOf = (b: Bus) => (b === 'ui' ? uiBus : fxBus)!;
function env(c: AudioContext, g: GainNode, t0: number, vol: number, a: number, dur: number) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}
/** a plain voice; `slide` bends the pitch, `detune` adds a second, slightly detuned oscillator (warmth) */
function tone(c: AudioContext, bus: Bus, t0: number, freq: number, dur: number, type: OscillatorType, vol: number, o2: { slide?: number; attack?: number; detune?: number; lp?: number } = {}) {
  const g = c.createGain();
  env(c, g, t0, vol, o2.attack ?? 0.012, dur);
  let dest: AudioNode = busOf(bus);
  if (o2.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o2.lp; f.connect(dest); dest = f; }
  g.connect(dest);
  for (const det of o2.detune ? [-o2.detune, o2.detune] : [0]) {
    const o = c.createOscillator();
    o.type = type; o.detune.value = det;
    o.frequency.setValueAtTime(freq, t0);
    if (o2.slide) o.frequency.exponentialRampToValueAtTime(o2.slide, t0 + dur);
    o.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
  }
}
/** a bell: frequency modulation with an inharmonic ratio, long decay */
function bell(c: AudioContext, bus: Bus, t0: number, freq: number, dur: number, vol: number, ratio = 1.41, depth = 2.2) {
  const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
  car.frequency.value = freq; mod.frequency.value = freq * ratio;
  mg.gain.setValueAtTime(freq * depth, t0); mg.gain.exponentialRampToValueAtTime(freq * 0.05, t0 + dur);
  mod.connect(mg).connect(car.frequency);
  env(c, g, t0, vol, 0.004, dur);
  car.connect(g).connect(busOf(bus));
  car.start(t0); mod.start(t0); car.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
}
/** a burst of filtered noise (paper, breath, impact, whoosh) */
function noise(c: AudioContext, bus: Bus, t0: number, dur: number, vol: number, type: BiquadFilterType = 'lowpass', freq = 600, sweep?: number) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
  env(c, g, t0, vol, Math.min(0.02, dur / 4), dur);
  src.buffer = buf; src.connect(f).connect(g).connect(busOf(bus)); src.start(t0); src.stop(t0 + dur + 0.02);
}
/** a soft low thump (a drum, a stamp, a gavel) */
const thump = (c: AudioContext, bus: Bus, t0: number, f: number, vol: number, dur = 0.22) => { tone(c, bus, t0, f, dur, 'sine', vol, { slide: f * 0.45, attack: 0.003 }); noise(c, bus, t0, 0.06, vol * 0.45, 'lowpass', 900); };
const chord = (c: AudioContext, bus: Bus, t0: number, fs: number[], dur: number, vol: number, type: OscillatorType = 'triangle') => fs.forEach((f, i) => tone(c, bus, t0 + i * 0.012, f, dur, type, vol, { detune: 6, attack: 0.03, lp: 2600 }));

export type Sfx =
  | 'breaking' | 'war' | 'capture' | 'lost' | 'alert' | 'success' | 'click' | 'coin' | 'drums' | 'fanfare' | 'peace' | 'boom' | 'encircle'
  // interface
  | 'tick' | 'tab' | 'fold' | 'select' | 'open' | 'confirm' | 'deny'
  // the year, promises, rivals, scenarios
  | 'bell' | 'stamp' | 'begin' | 'promise' | 'broken' | 'overtake' | 'slip' | 'rival' | 'star' | 'victory' | 'defeat' | 'law' | 'met' | 'walkout';
const UI = new Set<Sfx>(['tick', 'tab', 'fold', 'select', 'open', 'confirm', 'deny', 'click']);
const GAP: Partial<Record<Sfx, number>> = { boom: 60, tab: 60, fold: 60, select: 50, tick: 80 };
const last: Partial<Record<Sfx, number>> = {};
/** C major pentatonic, for pitched interface sounds that never clash */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

export function sfx(kind: Sfx, n = 0) {
  const now = performance.now();
  if (now - (last[kind] ?? -1e9) < (GAP[kind] ?? 140)) return;
  last[kind] = now;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.01;
  const ui: Bus = UI.has(kind) ? 'ui' : 'fx';
  switch (kind) {
    // ---- the classics, remade with the new voices
    case 'breaking': bell(c, 'fx', t, 880, 0.5, 0.06, 2, 1.2); bell(c, 'fx', t + 0.16, 880, 0.5, 0.06, 2, 1.2); bell(c, 'fx', t + 0.32, 1318.5, 0.9, 0.07, 2, 1.2); break;
    case 'war': thump(c, 'fx', t, 70, 0.4, 0.6); tone(c, 'fx', t, 110, 1.1, 'sawtooth', 0.07, { slide: 55, lp: 900, detune: 8 }); noise(c, 'fx', t, 0.8, 0.18, 'lowpass', 400, 120); break;
    case 'capture': chord(c, 'fx', t, [392, 493.9], 0.25, 0.07); chord(c, 'fx', t + 0.18, [523.25, 659.25, 783.99], 0.7, 0.07); break;
    case 'lost': tone(c, 'fx', t, 330, 0.8, 'sawtooth', 0.06, { slide: 140, lp: 1200, detune: 10 }); thump(c, 'fx', t + 0.05, 60, 0.25); break;
    case 'alert': bell(c, 'fx', t, 1046.5, 0.35, 0.07, 3.01, 0.8); bell(c, 'fx', t + 0.18, 1046.5, 0.45, 0.07, 3.01, 0.8); break;
    case 'success': chord(c, 'fx', t, [523.25, 659.25], 0.3, 0.07); chord(c, 'fx', t + 0.14, [659.25, 783.99, 1046.5], 0.8, 0.07); break;
    case 'coin': bell(c, 'fx', t, 1567.98, 0.25, 0.05, 2.76, 0.9); bell(c, 'fx', t + 0.07, 2093, 0.45, 0.05, 2.76, 0.9); break;
    case 'click': tone(c, 'ui', t, 900, 0.05, 'sine', 0.05, { slide: 600 }); break;
    case 'drums': for (let i = 0; i < 4; i++) thump(c, 'fx', t + i * 0.32, 72, 0.32, 0.3); tone(c, 'fx', t + 1.3, 147, 1.1, 'sawtooth', 0.05, { slide: 110, lp: 800, detune: 9 }); break;
    case 'fanfare': [392, 523.25, 659.25].forEach((f, i) => tone(c, 'fx', t + i * 0.16, f, 0.2, 'sawtooth', 0.045, { lp: 2200, detune: 7 })); chord(c, 'fx', t + 0.48, [523.25, 659.25, 783.99], 1.2, 0.06, 'sawtooth'); break;
    case 'peace': chord(c, 'fx', t, [261.63, 392, 523.25, 659.25], 2, 0.05, 'sine'); bell(c, 'fx', t + 0.3, 1046.5, 1.6, 0.03, 1.5, 0.6); break;
    case 'boom': thump(c, 'fx', t, 55 + Math.random() * 30, 0.08, 0.4); noise(c, 'fx', t, 0.3, 0.05, 'lowpass', 300); break;
    case 'encircle': [220, 207.65, 196].forEach((f, i) => tone(c, 'fx', t + i * 0.22, f, i === 2 ? 0.7 : 0.25, 'square', 0.06, { lp: 1400 })); thump(c, 'fx', t + 0.44, 65, 0.2); break;
    // ---- interface: soft, short, quiet
    case 'tick': tone(c, 'ui', t, 1760, 0.06, 'sine', 0.04); tone(c, 'ui', t + 0.05, 2637, 0.09, 'sine', 0.03); break;
    case 'tab': noise(c, 'ui', t, 0.05, 0.05, 'bandpass', 2800, 1800); tone(c, 'ui', t, 660, 0.05, 'triangle', 0.025); break;
    case 'fold': noise(c, 'ui', t, 0.04, 0.04, 'highpass', 2500); tone(c, 'ui', t, 480, 0.06, 'triangle', 0.03, { slide: 620 }); break;
    case 'select': tone(c, 'ui', t, PENTA[Math.abs(n) % PENTA.length], 0.18, 'triangle', 0.05, { attack: 0.004 }); tone(c, 'ui', t, PENTA[Math.abs(n) % PENTA.length] * 2, 0.12, 'sine', 0.02); break;
    case 'open': noise(c, 'ui', t, 0.25, 0.16, 'bandpass', 500, 2400); tone(c, 'ui', t + 0.05, 392, 0.2, 'sine', 0.03, { slide: 587 }); break;
    case 'confirm': tone(c, 'ui', t, 783.99, 0.1, 'triangle', 0.05); tone(c, 'ui', t + 0.07, 1046.5, 0.18, 'triangle', 0.05); break;
    case 'deny': tone(c, 'ui', t, 220, 0.14, 'square', 0.03, { lp: 900 }); tone(c, 'ui', t + 0.11, 185, 0.2, 'square', 0.03, { lp: 900 }); break;
    // ---- the year
    case 'bell': bell(c, 'fx', t, 196, 3.2, 0.09, 1.41, 3); bell(c, 'fx', t + 0.02, 392, 2.6, 0.04, 2.01, 1.5); bell(c, 'fx', t + 1.1, 261.63, 2.6, 0.05, 1.41, 2.4); break;
    case 'stamp': thump(c, 'fx', t, 95, 0.45, 0.25); noise(c, 'fx', t, 0.12, 0.12, 'bandpass', 1200); break;
    case 'begin': chord(c, 'fx', t, [392, 493.88, 587.33], 0.35, 0.06, 'sawtooth'); chord(c, 'fx', t + 0.3, [523.25, 659.25, 783.99, 1046.5], 1.4, 0.06, 'sawtooth'); thump(c, 'fx', t + 0.3, 80, 0.3); break;
    case 'promise': chord(c, 'fx', t, [349.23, 440, 523.25], 0.5, 0.06); chord(c, 'fx', t + 0.35, [392, 493.88, 587.33, 783.99], 1.4, 0.06); bell(c, 'fx', t + 0.35, 1567.98, 1.2, 0.03, 2, 0.7); break;
    case 'broken': chord(c, 'fx', t, [329.63, 392, 493.88], 0.5, 0.05); chord(c, 'fx', t + 0.4, [293.66, 349.23, 440], 1.3, 0.05); break;
    case 'overtake': noise(c, 'fx', t, 0.5, 0.16, 'bandpass', 400, 3200); [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, 'fx', t + 0.25 + i * 0.08, f, 0.4, 'triangle', 0.09)); bell(c, 'fx', t + 0.6, 2093, 0.8, 0.03, 2, 0.6); break;
    case 'slip': noise(c, 'fx', t, 0.5, 0.1, 'bandpass', 2400, 300); tone(c, 'fx', t + 0.2, 392, 0.7, 'triangle', 0.08, { slide: 261.63 }); break;
    case 'rival': tone(c, 'fx', t, 98, 1.4, 'sawtooth', 0.05, { lp: 600, detune: 12 }); bell(c, 'fx', t + 0.1, 233.08, 1.4, 0.04, 1.41, 2); break;
    case 'star': [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(c, 'fx', t + i * 0.07, f, 0.8, 0.07, 2, 0.8)); chord(c, 'fx', t + 0.28, [523.25, 659.25, 783.99], 0.9, 0.03, 'sine'); break;
    case 'victory': chord(c, 'fx', t, [261.63, 329.63, 392], 0.45, 0.06, 'sawtooth'); chord(c, 'fx', t + 0.42, [349.23, 440, 523.25], 0.45, 0.06, 'sawtooth'); chord(c, 'fx', t + 0.84, [392, 493.88, 587.33, 783.99], 2.2, 0.07, 'sawtooth'); thump(c, 'fx', t + 0.84, 70, 0.4, 0.5); break;
    case 'defeat': chord(c, 'fx', t, [220, 261.63, 329.63], 1.2, 0.05, 'sawtooth'); chord(c, 'fx', t + 1, [207.65, 246.94, 311.13], 2.2, 0.05, 'sawtooth'); thump(c, 'fx', t, 55, 0.35, 0.8); break;
    case 'law': thump(c, 'fx', t, 180, 0.3, 0.12); thump(c, 'fx', t + 0.16, 180, 0.35, 0.14); bell(c, 'fx', t + 0.32, 659.25, 0.8, 0.03, 1.5, 0.6); break;
    case 'met': chord(c, 'fx', t, [587.33, 739.99, 880], 0.6, 0.05); break;
    case 'walkout': thump(c, 'fx', t, 90, 0.3, 0.3); tone(c, 'fx', t + 0.05, 293.66, 0.7, 'sawtooth', 0.04, { slide: 196, lp: 1000 }); break;
  }
  void ui;
}
export function setSound(onOff: boolean) { setPrefs({ soundOn: onOff }); if (onOff) sfx('click'); }
/** (a debugging and testing aid: play any effect from the console) */
if (typeof window !== 'undefined') (window as unknown as { __sfx?: typeof sfx }).__sfx = sfx;
