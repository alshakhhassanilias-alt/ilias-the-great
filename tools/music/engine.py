"""
A small orchestral synthesiser for the World Order score (no samples: every sound is generated).

Instruments render into named buses (strings, brass, keys, perc, ...); each bus has its own filtering and a
reverb send, then everything is mixed, gently compressed and normalised. Times are in seconds.
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
rng = np.random.default_rng(1)


def hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def m(name):
    """'D4' -> 62, 'Bb3' -> 58, 'F#5' -> 78"""
    base = NAMES[name[0]]
    i = 1
    while i < len(name) and name[i] in '#b':
        base += 1 if name[i] == '#' else -1
        i += 1
    return base + 12 * (int(name[i:]) + 1)


def ms(names):
    return [m(x) for x in names.split()]


# ------------------------------------------------------------------ oscillators
def _blep(ph, dt):
    out = np.zeros_like(ph)
    a = ph < dt
    t = ph[a] / dt[a] if np.ndim(dt) else ph[a] / dt
    out[a] = t + t - t * t - 1
    b = ph > 1 - (dt if not np.ndim(dt) else dt)
    if np.ndim(dt):
        t2 = (ph[b] - 1) / dt[b]
    else:
        t2 = (ph[b] - 1) / dt
    out[b] = t2 * t2 + t2 + t2 + 1
    return out


def saw(freq, n, phase0=0.0):
    """band-limited sawtooth (polyBLEP); freq may be an array (vibrato)"""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    return 2 * ph - 1 - _blep(ph, dt)


def square(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    ph2 = (ph + 0.5) % 1.0
    return np.where(ph < 0.5, 1.0, -1.0) + _blep(ph, dt) - _blep(ph2, dt)


def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.sin(2 * np.pi * (phase0 + np.cumsum(f) / SR))


def adsr(n, a, d, s, r, hold=None):
    """attack/decay/sustain/release envelope over n samples; the release starts at `hold` seconds (default: end - r)"""
    t = np.arange(n) / SR
    total = n / SR
    rel = (hold if hold is not None else max(0.0, total - r))
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    dmask = (t >= a) & (t < a + d)
    e = np.where(dmask, 1 - (1 - s) * (t - a) / max(d, 1e-4), e)
    e = np.where(t >= a + d, s, e)
    e = np.where(t < a, t / max(a, 1e-4), e)
    after = t >= rel
    e = np.where(after, e * np.clip(1 - (t - rel) / max(r, 1e-4), 0, 1), e)
    return e


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, min(hi, SR * 0.45)], 'band', fs=SR, output='sos'), x)


def vibrato(f, n, rate=5.2, cents=7, delay=0.35):
    t = np.arange(n) / SR
    depth = np.clip((t - delay) / 0.6, 0, 1) * cents
    return f * 2 ** (depth * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6)) / 1200)


# ------------------------------------------------------------------ the mix
class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 4
        self.buses = {}
        self.sends = {}

    def bus(self, name):
        if name not in self.buses:
            self.buses[name] = np.zeros((self.n, 2))
        return self.buses[name]

    def add(self, name, x, t, pan=0.0, gain=1.0):
        """add a mono signal at time t (s); pan −1 left … +1 right (constant power)"""
        b = self.bus(name)
        i = int(t * SR)
        if i >= self.n:
            return
        x = x[: self.n - i] * gain
        a = (pan + 1) * np.pi / 4
        b[i:i + len(x), 0] += x * np.cos(a)
        b[i:i + len(x), 1] += x * np.sin(a)

    def render(self, fx, reverb=0.25, room=2.8, target_db=-17.0, fade_in=0.0, fade_out=4.0, length=None):
        """fx: bus -> (function on a stereo array, reverb send)"""
        out = np.zeros((self.n, 2))
        send = np.zeros((self.n, 2))
        for name, b in self.buses.items():
            fn, rv = fx.get(name, (None, reverb))
            y = b if fn is None else np.stack([fn(b[:, 0]), fn(b[:, 1])], 1)
            out += y
            send += y * rv
        ir = impulse(room)
        wet = np.stack([fftconvolve(send[:, 0], ir[:, 0])[: self.n], fftconvolve(send[:, 1], ir[:, 1])[: self.n]], 1)
        out = out + wet
        out = hp(out.T, 28).T
        out = compress(out)
        if length:
            out = out[: int(length * SR)]
        # trim the silent tail
        if fade_in:
            k = int(fade_in * SR)
            out[:k] *= np.linspace(0, 1, k)[:, None]
        k = int(fade_out * SR)
        out[-k:] *= np.linspace(1, 0, k)[:, None] ** 1.5
        rms = np.sqrt(np.mean(out ** 2) + 1e-12)
        out *= 10 ** (target_db / 20) / rms
        peak = np.max(np.abs(out))
        if peak > 0.97:
            out = np.tanh(out / peak * 1.25) / np.tanh(1.25) * 0.97
        return out


def impulse(seconds):
    """a stereo hall impulse response: exponentially decaying noise that darkens as it fades"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        noise = rng.standard_normal(n)
        dark = lp(noise, 2600) * np.exp(-t * 2.0)
        bright = noise * np.exp(-t * 9.0)
        ir = (0.65 * dark + 0.35 * bright) * np.exp(-t * 6.9 / seconds)
        ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        out.append(ir / np.sqrt(np.sum(ir ** 2)) * 0.9)
    return np.stack(out, 1)


def compress(x, thresh_db=-18, ratio=2.5, att=0.02, rel=0.25):
    level = np.sqrt(lp(np.mean(x ** 2, 1), 8, 1).clip(1e-12))
    db = 20 * np.log10(level)
    over = np.maximum(0, db - thresh_db)
    gain_db = -over * (1 - 1 / ratio)
    # smooth the gain (attack/release approximated by a one-pole filter on the gain curve)
    g = lp(gain_db, 3, 1)
    return x * (10 ** (g / 20))[:, None]


# ------------------------------------------------------------------ instruments (each returns a mono array)
def strings_note(n_, dur, vel=0.7, att=0.5, rel=1.2, bright=1.0):
    n = int((dur + rel) * SR)
    f = hz(n_)
    x = np.zeros(n)
    for c in (-8, 0, 7):
        x += saw(vibrato(f * 2 ** (c / 1200), n, rate=5.0 + rng.uniform(-0.4, 0.4)), n, rng.uniform())
    x = lp(x, 1800 * bright + 4 * f, 2)
    return x * adsr(n, att, 0.3, 0.85, rel, hold=dur) * vel * 0.18


def staccato_note(n_, dur=0.22, vel=0.8, cutoff=1100):
    n = int((dur + 0.15) * SR)
    f = hz(n_)
    x = saw(f, n, rng.uniform()) + 0.6 * saw(f * 1.004, n, rng.uniform())
    x = lp(x, cutoff, 2)
    return x * adsr(n, 0.008, 0.12, 0.45, 0.12, hold=dur) * vel * 0.3


def brass_note(n_, dur, vel=0.7, rel=0.35):
    n = int((dur + rel) * SR)
    f = hz(n_)
    fv = vibrato(f, n, rate=5.4, cents=8, delay=0.4)
    raw = 0.7 * saw(fv, n) + 0.3 * square(fv * 1.002, n)
    dark = lp(raw, 500 + 1.5 * f, 2)
    bright = lp(raw, 2400 + 3 * f, 2)
    t = np.arange(n) / SR
    open_ = np.clip(t / 0.25, 0, 1) * (0.55 + 0.45 * vel)
    x = dark * (1 - open_) + bright * open_
    return x * adsr(n, 0.06, 0.2, 0.85, rel, hold=dur) * vel * 0.25


def piano_note(n_, dur, vel=0.6):
    f = hz(n_)
    t1 = 2.6 + 6.0 * np.clip((72 - n_) / 36, 0, 1)
    n = int(min(t1 * 1.4, dur + 0.6) * SR) + int(0.3 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    B = 0.00035
    for k in range(1, 14):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > SR * 0.45:
            break
        amp = (1 / k ** 1.25) * (0.4 + 0.6 * vel ** (0.5 + k * 0.08))
        x += amp * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6)) * np.exp(-t * (1 + 0.55 * k) / t1)
    hammer = lp(rng.standard_normal(n) * np.exp(-t * 60), 2500) * 0.06 * vel
    x = x + hammer
    off = np.clip(1 - (t - dur) / 0.25, 0, 1)
    x *= off * np.clip(t / 0.002, 0, 1)
    return x * vel * 0.28


def bell_note(n_, dur=2.5, vel=0.5):
    f = hz(n_)
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for r, a, d in ((1, 1, 1.6), (2.76, 0.4, 3.5), (5.4, 0.22, 6), (8.93, 0.1, 9)):
        if f * r < SR * 0.45:
            x += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d)
    return x * np.clip(t / 0.003, 0, 1) * vel * 0.2


def pluck_note(n_, dur=1.4, vel=0.6, bright=1.0):
    f = hz(n_)
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for k in range(1, 10):
        if f * k > SR * 0.45:
            break
        x += (1 / k ** (1.6 - 0.4 * bright)) * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (2.2 + 1.3 * k))
    return x * np.clip(t / 0.002, 0, 1) * vel * 0.3


def flute_note(n_, dur, vel=0.6):
    n = int((dur + 0.3) * SR)
    f = vibrato(hz(n_), n, rate=5.0, cents=10, delay=0.25)
    x = sine(f, n) + 0.18 * sine(2 * f, n) + 0.06 * sine(3 * f, n)
    breath = bp(rng.standard_normal(n), 1500, 6000) * 0.04
    return (x + breath) * adsr(n, 0.08, 0.1, 0.9, 0.25, hold=dur) * vel * 0.22


def choir_note(n_, dur, vel=0.6, att=0.8):
    n = int((dur + 1.4) * SR)
    f = hz(n_)
    x = np.zeros(n)
    for c in (-10, -3, 4, 11):
        x += saw(vibrato(f * 2 ** (c / 1200), n, rate=4.6, cents=12, delay=0.2), n, rng.uniform())
    # "ah" formants
    y = 1.0 * bp(x, 650, 900) + 0.6 * bp(x, 1050, 1350) + 0.25 * bp(x, 2500, 2900)
    return y * adsr(n, att, 0.4, 0.9, 1.3, hold=dur) * vel * 0.3


def timpani(n_, vel=0.8, dur=2.2):
    f = hz(n_)
    n = int(dur * SR)
    t = np.arange(n) / SR
    fp = f * (1 + 0.03 * np.exp(-t * 18))
    x = np.zeros(n)
    for r, a, d in ((1, 1, 1.8), (1.5, 0.5, 2.6), (1.99, 0.3, 3.4), (2.44, 0.18, 4.4)):
        x += a * np.sin(2 * np.pi * np.cumsum(fp * r) / SR) * np.exp(-t * d)
    x += lp(rng.standard_normal(n) * np.exp(-t * 35), 1200) * 0.5
    return x * vel * 0.45


def taiko(vel=0.9, f0=58, dur=1.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 1.2 * np.exp(-t * 28))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    x += lp(rng.standard_normal(n) * np.exp(-t * 26), 900) * 0.7
    return np.tanh(x * 1.6) * vel * 0.55


def snare(vel=0.6, dur=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 1400, 7500) * np.exp(-t * 18)
    x += np.sin(2 * np.pi * 185 * t) * np.exp(-t * 40) * 0.6
    return x * vel * 0.3


def shaker(vel=0.3, dur=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 6000) * np.exp(-t * 40) * vel * 0.2


def swell(dur=3.0, vel=0.5):
    """reverse-cymbal / noise riser"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 3500) * (t / dur) ** 2.5
    return x * vel * 0.25


def boom(vel=1.0, dur=3.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 46 * (1 + 0.8 * np.exp(-t * 10))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.4)
    x += lp(rng.standard_normal(n) * np.exp(-t * 8), 500) * 0.4
    return np.tanh(x * 1.4) * vel * 0.6


def tick(vel=0.3):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return bp(rng.standard_normal(n), 2500, 9000) * np.exp(-t * 120) * vel * 0.4


# ------------------------------------------------------------------ helpers for writing music
class Clock:
    def __init__(self, bpm, beats_per_bar=4, start=0.0):
        self.beat = 60.0 / bpm
        self.bpb = beats_per_bar
        self.start = start

    def t(self, bar, beat=0.0):
        """time of bar (from 0) and beat (from 0) in seconds"""
        return self.start + (bar * self.bpb + beat) * self.beat

    def d(self, beats):
        return beats * self.beat


def melody(mix, bus, clock, bar, notes, inst, pan=0.0, gain=1.0, **kw):
    """notes: list of (note name or None for rest, beats); returns the bar after the phrase"""
    pos = 0.0
    for name, beats in notes:
        if name:
            x = inst(m(name), clock.d(beats) * 0.98, **kw)
            mix.add(bus, x, clock.t(bar, pos), pan, gain)
        pos += beats
    return bar + pos / clock.bpb


def chord(mix, bus, clock, bar, beats, names, inst, spread=0.6, gain=1.0, **kw):
    ns = names.split() if isinstance(names, str) else names
    for i, name in enumerate(ns):
        pan = (i / max(1, len(ns) - 1) - 0.5) * 2 * spread
        mix.add(bus, inst(m(name), clock.d(beats), **kw), clock.t(bar), pan, gain)
