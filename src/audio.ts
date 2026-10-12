/** Tiny synthesised sound effects (no audio files). Off until the browser allows audio; mutable from the top bar. */
let ctx: AudioContext | null = null;
export const audio = { enabled: true };
try { audio.enabled = localStorage.getItem('wo-sound') !== '0'; } catch { /* ignore */ }

function ac(): AudioContext | null {
  if (!audio.enabled) return null;
  try {
    ctx = ctx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(c: AudioContext, t0: number, dur: number, vol: number) {
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 500;
  g.gain.value = vol;
  src.buffer = buf; src.connect(f).connect(g).connect(c.destination); src.start(t0);
}

export type Sfx = 'breaking' | 'war' | 'capture' | 'lost' | 'alert' | 'success' | 'click' | 'coin' | 'drums' | 'fanfare' | 'peace' | 'boom' | 'encircle';
let lastAt = 0;
export function sfx(kind: Sfx) {
  const now = performance.now();
  if (now - lastAt < 120 && kind !== 'breaking' && kind !== 'boom') return;
  lastAt = now;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (kind) {
    case 'breaking': tone(c, t, 440, 0.12, 'square', 0.05); tone(c, t + 0.14, 440, 0.12, 'square', 0.05); tone(c, t + 0.28, 660, 0.3, 'square', 0.05); break;
    case 'war': tone(c, t, 110, 0.7, 'sawtooth', 0.09, 55); noise(c, t, 0.5, 0.25); break;
    case 'capture': tone(c, t, 330, 0.12, 'triangle', 0.1); tone(c, t + 0.1, 495, 0.12, 'triangle', 0.1); tone(c, t + 0.2, 660, 0.35, 'triangle', 0.1); break;
    case 'lost': tone(c, t, 300, 0.5, 'sawtooth', 0.07, 120); break;
    case 'alert': tone(c, t, 880, 0.1, 'sine', 0.09); tone(c, t + 0.16, 880, 0.1, 'sine', 0.09); break;
    case 'success': tone(c, t, 523, 0.15, 'triangle', 0.09); tone(c, t + 0.12, 659, 0.15, 'triangle', 0.09); tone(c, t + 0.24, 784, 0.4, 'triangle', 0.09); break;
    case 'coin': tone(c, t, 988, 0.08, 'square', 0.04); tone(c, t + 0.07, 1319, 0.2, 'square', 0.04); break;
    case 'click': tone(c, t, 600, 0.04, 'sine', 0.05); break;
    case 'drums': for (let i = 0; i < 4; i++) { tone(c, t + i * 0.32, 70, 0.28, 'sine', 0.22, 45); noise(c, t + i * 0.32, 0.12, 0.18); } tone(c, t + 1.3, 147, 0.9, 'sawtooth', 0.06, 110); break;
    case 'fanfare': tone(c, t, 392, 0.18, 'sawtooth', 0.05); tone(c, t + 0.18, 523, 0.18, 'sawtooth', 0.05); tone(c, t + 0.36, 659, 0.18, 'sawtooth', 0.05); tone(c, t + 0.54, 784, 0.7, 'sawtooth', 0.06); tone(c, t + 0.54, 523, 0.7, 'triangle', 0.06); break;
    case 'peace': tone(c, t, 523, 1.2, 'sine', 0.06); tone(c, t + 0.05, 659, 1.2, 'sine', 0.05); tone(c, t + 0.1, 784, 1.3, 'sine', 0.04); break;
    case 'boom': tone(c, t, 60 + Math.random() * 30, 0.35, 'sine', 0.05, 30); noise(c, t, 0.25, 0.05); break;
    case 'encircle': tone(c, t, 220, 0.25, 'square', 0.04); tone(c, t + 0.22, 207, 0.25, 'square', 0.04); tone(c, t + 0.44, 196, 0.6, 'square', 0.05); break;
  }
}
export function setSound(on: boolean) { audio.enabled = on; try { localStorage.setItem('wo-sound', on ? '1' : '0'); } catch { /* ignore */ } if (on) sfx('click'); }
