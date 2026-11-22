"""Original score for THE WORLD ORDER trailer, synthesised from scratch (no samples). 48 kHz stereo stems."""
import numpy as np, wave, sys
SR = 48000; DUR = 76.0; N = int(SR * DUR)
rng = np.random.default_rng(7)
t = np.arange(N) / SR
def write(name, x):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1: x = np.stack([x, x], 1)
    peak = np.max(np.abs(x)) or 1
    if peak > 0.98: x = x * (0.98 / peak)
    w = wave.open(name, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()
def env(a, d, s, r, length):  # ADSR in seconds -> array
    n = int(length * SR); e = np.zeros(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, n - na - nd - nr)
    e[:na] = np.linspace(0, 1, na, endpoint=False) if na else 0
    e[na:na + nd] = np.linspace(1, s, nd, endpoint=False) if nd else 0
    e[na + nd:na + nd + ns] = s
    e[na + nd + ns:] = np.linspace(s, 0, n - (na + nd + ns))
    return e
def lp1(x, fc):  # one-pole lowpass (fc can be an array)
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s = (1 - a[i]) * x[i] + a[i] * s; y[i] = s
    return y
def lp_fft(x, fc, order=4):  # zero-phase lowpass in frequency domain (static cutoff)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** (2 * order)), len(x))
def hp_fft(x, fc, order=2):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); f[0] = 1e-9
    return np.fft.irfft(X / np.sqrt(1 + (fc / f) ** (2 * order)), len(x))
def bp_fft(x, lo, hi): return lp_fft(hp_fft(x, lo), hi)
def saw(freq, length, phase=0.0):
    n = int(length * SR); ph = (phase + np.cumsum(np.broadcast_to(freq, (n,)) / SR)) % 1.0
    return 2 * ph - 1
def place(buf, x, at, gain=1.0, pan=0.0):
    i = int(at * SR); x = np.asarray(x)
    if x.ndim == 1: x = np.stack([x * np.sqrt(0.5 * (1 - pan)), x * np.sqrt(0.5 * (1 + pan))], 1) * np.sqrt(2)
    j = min(len(buf), i + len(x)); buf[i:j] += gain * x[: j - i]
NOTE = lambda m: 440.0 * 2 ** ((m - 69) / 12)  # MIDI to Hz
BEAT = 0.5  # 120 BPM

# ---------------------------------------------------------------- reverb (synthetic hall IR, stereo decorrelated)
def reverb(x, secs=2.8, pre=0.02, damp=4500):
    n = int(secs * SR); tt = np.arange(n) / SR
    out = np.zeros((len(x) + n, 2))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-6.9 * tt / secs)
        ir = lp_fft(ir, damp, 2); ir[: int(pre * SR)] = 0; ir /= np.sqrt(np.sum(ir ** 2))
        L = 1 << int(np.ceil(np.log2(len(x) + n)))
        src = x[:, ch] if x.ndim == 2 else x
        out[:, ch] = np.fft.irfft(np.fft.rfft(src, L) * np.fft.rfft(ir, L), L)[: len(x) + n]
    return out[: len(x)]

# ---------------------------------------------------------------- stems
music = np.zeros((N, 2)); drums = np.zeros((N, 2)); fx = np.zeros((N, 2))

# 1. sub drone on D (and A from the war section), swelling across the trailer; cut at the blackout (68.5-69.5)
def drone():
    d = np.zeros(N)
    for f, g in [(NOTE(26), 0.55), (NOTE(38), 0.35), (NOTE(45), 0.18)]:
        d += g * (0.6 * np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.11 * t)) + 0.4 * saw(f * 1.003, DUR))
    d = lp_fft(d, 220, 3)
    e = np.interp(t, [0, 1.5, 6, 10, 22, 38, 52.5, 53, 64.5, 68.4, 68.5, 69.5, 70.5, 76], [0, 0, 0.35, 0.5, 0.6, 0.85, 0.85, 0.45, 0.55, 1.0, 0, 0, 0.9, 0])
    return d * e
x = drone(); music += np.stack([x, x], 1) * 0.55

# 2. string-like pads: detuned saws, slow attack, darker in the quiet sections. Dm - Bb - F - C (i VI III VII)
CHORDS = {'Dm': [50, 53, 57, 62], 'Bb': [46, 50, 53, 58], 'F': [45, 53, 57, 60], 'C': [48, 52, 55, 60], 'Gm': [43, 50, 55, 58], 'A': [45, 49, 52, 57], 'D': [50, 54, 57, 62]}
def pad(chord, start, length, gain, bright):
    seg = np.zeros((int(length * SR), 2))
    for m in CHORDS[chord]:
        for k, det in enumerate([-0.11, -0.04, 0.0, 0.05, 0.12]):
            f = NOTE(m) * 2 ** (det / 12) * (1 + 0.0025 * np.sin(2 * np.pi * (4.8 + k * 0.3) * np.arange(len(seg)) / SR))
            v = saw(f, length, rng.random())
            pan = (k - 2) / 2.5
            seg[:, 0] += v * np.sqrt(0.5 * (1 - pan)); seg[:, 1] += v * np.sqrt(0.5 * (1 + pan))
    for ch in range(2): seg[:, ch] = lp_fft(seg[:, ch], bright, 2)
    seg *= env(min(1.6, length * 0.35), 0.3, 0.9, min(1.2, length * 0.3), length)[:, None]
    place(music, seg * gain / 14, start)
prog = ['Dm', 'Bb', 'F', 'C']
# THE WORLD: one sustained, dark chord
pad('Dm', 2.0, 8.6, 0.6, 900)
# BALANCE OF POWER: the progression, 3 s per chord
for i in range(4): pad(prog[i], 10.0 + i * 3.0, 3.4, 0.75, 1200 + i * 150)
# THE WORLD CHANGES: 2 s per chord, brighter, more urgent
for i in range(8): pad(prog[i % 4], 22.0 + i * 2.0, 2.3, 0.85, 1700 + i * 120)
# WORLD AT WAR: full, bright
for i in range(7): pad(['Dm', 'Bb', 'F', 'C', 'Gm', 'Bb', 'A'][i], 38.0 + i * 2.14, 2.4, 1.05, 2600)
# YOUR WORLD: soft, sparse
for i, ch in enumerate(['Dm', 'Bb', 'F', 'A']): pad(ch, 53.0 + i * 3.0, 3.3, 0.5, 800)
# REVEAL build
pad('Gm', 65.0, 1.8, 0.9, 2000); pad('A', 66.8, 1.75, 1.1, 3000)
# title: a wide D major (picardy) chord, slow bloom and long tail
pad('D', 69.5, 6.4, 0.9, 1500)

# 3. the pulse: staccato low strings on D, eighths from 22 s, sixteenths in the war; silent in the quiet section
def pluck(f, length=0.22, bright=1800):
    n = int(length * SR); tt = np.arange(n) / SR
    v = (saw(f, length) + 0.6 * saw(f * 2.002, length)) * np.exp(-tt * 14)
    return lp_fft(v, bright, 2)
pulse_notes = {22.0: 38, 38.0: 38}
for t0 in np.arange(16.0, 22.0, BEAT):  # first hint: quarter notes, quiet
    place(music, pluck(NOTE(38), 0.25, 900), t0, 0.18)
for t0 in np.arange(22.0, 38.0, BEAT / 2):
    k = int(round((t0 - 22) / (BEAT / 2)))
    note = [38, 38, 38, 41, 38, 38, 45, 43][k % 8]
    place(music, pluck(NOTE(note), 0.2, 1500 + (t0 - 22) * 60), t0, 0.22 + 0.25 * (t0 - 22) / 16, pan=0.2 if k % 2 else -0.2)
for t0 in np.arange(38.0, 52.9, BEAT / 4):
    k = int(round((t0 - 38) / (BEAT / 4)))
    note = [38, 38, 50, 38, 41, 38, 45, 38][k % 8]
    place(music, pluck(NOTE(note), 0.14, 2600), t0, 0.32, pan=0.3 if k % 2 else -0.3)
for t0 in np.arange(65.0, 68.4, BEAT / 4):
    place(music, pluck(NOTE(38), 0.12, 3000), t0, 0.2 + 0.3 * (t0 - 65) / 3.4, pan=0.25 if int(t0 * 8) % 2 else -0.25)

# 4. drums: taiko-like low hits, toms and a dry rim, building section by section
def taiko(pitch=58, length=1.2, snap=0.4):
    n = int(length * SR); tt = np.arange(n) / SR
    f = pitch * (1 + 1.6 * np.exp(-tt * 28))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 4.2)
    skin = lp_fft(rng.standard_normal(n) * np.exp(-tt * 38), 1800, 2) * snap
    return np.tanh(1.6 * (body + skin))
def tom(pitch=110): return taiko(pitch, 0.6, 0.6) * 0.7
def rim():
    n = int(0.12 * SR); tt = np.arange(n) / SR
    return bp_fft(rng.standard_normal(n), 900, 5200) * np.exp(-tt * 60) * 0.6
for t0 in [10.0, 13.0, 16.0, 19.0]: place(drums, taiko(52, 1.6), t0, 0.55)
for t0 in np.arange(22.0, 38.0, BEAT):
    b = int(round((t0 - 22) / BEAT))
    place(drums, taiko(56, 1.0), t0, 0.35 + 0.35 * (t0 - 22) / 16 if b % 2 == 0 else 0.25)
    if b % 4 == 3: place(drums, tom(120), t0 + BEAT / 2, 0.35, pan=0.4)
    if t0 >= 30: place(drums, rim(), t0 + BEAT / 2, 0.4, pan=-0.3)
for t0 in np.arange(34.0, 38.0, BEAT / 4): place(drums, tom(95 + (t0 - 34) * 12), t0, 0.12 + 0.35 * (t0 - 34) / 4, pan=np.sin(t0 * 5) * 0.5)
for t0 in np.arange(38.0, 52.9, BEAT):
    b = int(round((t0 - 38) / BEAT))
    place(drums, taiko(50, 1.3), t0, 0.85 if b % 4 == 0 else 0.55)
    place(drums, tom(130 if b % 2 else 98), t0 + BEAT / 2, 0.45, pan=0.35 if b % 2 else -0.35)
    place(drums, rim(), t0 + BEAT * 0.75, 0.45)
    if b % 8 == 7: [place(drums, tom(150 - j * 12), t0 + j * BEAT / 4, 0.4, pan=0.5 - j * 0.3) for j in range(4)]
for t0 in np.arange(65.0, 68.4, BEAT / 2): place(drums, taiko(54, 0.8), t0, 0.35 + 0.5 * (t0 - 65) / 3.4)
for t0 in np.arange(67.4, 68.4, BEAT / 8): place(drums, tom(140), t0, 0.35, pan=np.sin(t0 * 31) * 0.6)

# 5. braams: huge low brass hits on the big cuts
def braam(length=3.5, root=26):
    n = int(length * SR); tt = np.arange(n) / SR
    v = np.zeros(n)
    for m, g in [(root, 1.0), (root + 12, 0.8), (root + 19, 0.5), (root + 24, 0.35)]:
        for det in (-0.07, 0.0, 0.08): v += g * saw(NOTE(m) * 2 ** (det / 12), length, rng.random())
    cut = 180 + 2600 * np.exp(-tt * 1.6) * np.minimum(1, tt * 25)
    v = lp1(v, cut)
    v = np.tanh(1.4 * v / 3) * np.exp(-tt * 0.85) * np.minimum(1, tt * 40)
    return v
for at, g in [(22.0, 0.55), (38.0, 0.9), (45.5, 0.6), (69.5, 1.0)]: place(music, braam(4.5 if at == 69.5 else 3.2), at, g)

# 6. sub impacts and booms
def impact(length=3.0, f0=48):
    n = int(length * SR); tt = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(f0 * (0.6 + 0.4 * np.exp(-tt * 3))) / SR) * np.exp(-tt * 1.6)
    crack = lp_fft(rng.standard_normal(n) * np.exp(-tt * 9), 3500, 2) * 0.5
    return np.tanh(1.8 * (sub + crack))
for at, g in [(10.0, 0.7), (22.0, 0.6), (38.0, 1.0), (53.0, 0.45), (65.0, 0.5), (49.5, 0.55), (69.5, 1.0)]: place(fx, impact(3.5 if at in (38.0, 69.5) else 2.6), at, g)

# 7. risers and whooshes into the big cuts
def riser(length, f_start=200, f_end=4000):
    n = int(length * SR); tt = np.arange(n) / SR; k = tt / length
    noise = rng.standard_normal(n)
    v = np.zeros(n)
    bands = np.geomspace(f_start, f_end, 18)
    for i in range(len(bands) - 1):  # crude moving band-pass: crossfade fixed bands
        b = bp_fft(noise, bands[i], bands[i + 1])
        centre = (i + 0.5) / (len(bands) - 1)
        v += b * np.exp(-((k - centre) * 6) ** 2)
    tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (3 * k ** 2)) / SR) * 0.25 * k
    return (v * 1.6 + tone) * k ** 1.5
for at, length in [(7.5, 2.5), (19.5, 2.5), (34.0, 4.0), (65.0, 3.45)]: place(fx, riser(length), at, 0.55)
def whoosh(length=0.7):
    n = int(length * SR); tt = np.arange(n) / SR
    return bp_fft(rng.standard_normal(n), 300, 3000) * np.sin(np.pi * tt / length) ** 2
for at in [24.3, 26.3, 28.8, 30.8, 33.3, 35.3, 39.8, 41.3, 42.8, 45.3, 47.3, 61.3, 66.0, 67.0, 67.9]: place(fx, whoosh(0.6), at, 0.18, pan=np.sin(at * 3) * 0.6)

# 8. "YOUR WORLD": a sparse piano-like motif, and a clock tick for the decision
def piano(m, length=3.0):
    n = int(length * SR); tt = np.arange(n) / SR; f = NOTE(m); v = np.zeros(n)
    for h, g in enumerate([1, 0.5, 0.33, 0.22, 0.12, 0.08], start=1): v += g * np.sin(2 * np.pi * f * h * (1 + 0.0004 * h * h) * tt) * np.exp(-tt * (1.2 + 0.7 * h))
    return v * np.minimum(1, tt * 400) * 0.5
for at, m in [(53.4, 74), (54.9, 72), (56.4, 69), (57.9, 77), (59.9, 74), (61.4, 69), (62.9, 65), (63.6, 62)]: place(music, piano(m), at, 0.42, pan=0.2)
def tick():
    n = int(0.03 * SR); return bp_fft(rng.standard_normal(n), 2000, 7000) * np.exp(-np.arange(n) / SR * 200)
for at in np.arange(59.0, 65.0, 0.5): place(fx, tick(), at, 0.1)

# 9. the radio: static and squelch under the opening, before the music arrives
stat = bp_fft(rng.standard_normal(N), 1200, 5200) * 0.06 * np.interp(t, [0, 0.8, 2.0, 9.0, 10.5], [0, 0.6, 1.0, 0.4, 0])
fx += np.stack([stat, stat * 0.9], 1)
for at in [1.0, 4.95, 6.0]:
    n = int(0.09 * SR); place(fx, bp_fft(rng.standard_normal(n), 800, 4000) * 0.5, at, 0.4)

# ---------------------------------------------------------------- reverb, gaps, master
wet_m = reverb(music, 3.2, 0.03, 5000); wet_d = reverb(drums, 2.2, 0.015, 3500); wet_f = reverb(fx, 2.5, 0.02, 4000)
music_out = music * 0.75 + wet_m * 0.55
drums_out = drums * 0.85 + wet_d * 0.35
fx_out = fx * 0.8 + wet_f * 0.3
# the blackout before the title: true silence (only the reverb tail of the last hit dies away)
gate = np.interp(t, [0, 68.45, 68.55, 69.45, 69.5, 76], [1, 1, 0, 0, 1, 1])
for x in (music_out, drums_out, fx_out): x *= gate[:, None]
fade = np.interp(t, [0, 74.0, 75.6, 76], [1, 1, 0, 0])
for x in (music_out, drums_out, fx_out): x *= fade[:, None]
write('audio/music.wav', music_out); write('audio/drums.wav', drums_out); write('audio/fx.wav', fx_out)
print('ok')
