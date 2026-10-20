"""
The World Order score: seven original pieces, written as code and rendered with engine.py.

    python3 tools/music/tracks.py            # renders every track to public/music/*.ogg
    python3 tools/music/tracks.py red-lines  # renders one

The main theme (D minor) returns in the war tracks, so the score sounds like one piece of music.
"""
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
from scipy.io import wavfile

from engine import (SR, Clock, Mix, m, rng, lp, hp, strings_note, staccato_note, brass_note, piano_note, bell_note,
                    pluck_note, flute_note, choir_note, timpani, taiko, snare, shaker, swell, boom, tick)

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'music')

# ------------------------------------------------------------------ harmony helpers
Q = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10), 'maj7': (0, 4, 7, 11), 'sus4': (0, 5, 7),
     'sus2': (0, 2, 7), 'dim': (0, 3, 6), 'add9': (0, 2, 4, 7), 'madd9': (0, 2, 3, 7), 'm9': (0, 3, 7, 10, 2)}


def pc(name):
    return m(name + '1') % 12


def parse(sym):
    bass = None
    if '/' in sym:
        sym, b = sym.split('/')
        bass = pc(b)
    i = 2 if len(sym) > 1 and sym[1] in '#b' else 1
    r = pc(sym[:i])
    pcs = [(r + x) % 12 for x in Q[sym[i:]]]
    return r, pcs, (r if bass is None else bass)


def voicing(sym, lo=55, n=4):
    _, pcs, _ = parse(sym)
    return [x for x in range(lo, lo + 36) if x % 12 in pcs][:n]


def bassnote(sym, lo=36):
    _, _, b = parse(sym)
    return lo + (b - lo) % 12


def expand(c, bar, prog):
    """prog: chord names (a whole bar each) or (name, beats) -> [(name, beat position, beats)]"""
    out, pos = [], bar * c.bpb
    for p in prog:
        sym, beats = (p, c.bpb) if isinstance(p, str) else p
        out.append((sym, pos, beats))
        pos += beats
    return out


def at(c, pos):
    return c.start + pos * c.beat


def hv(v, k=0.08):
    """humanised velocity"""
    return v * (1 + rng.uniform(-k, k))


def mel(mx, bus, c, bar, notes, inst, tr=0, pan=0.0, gain=1.0, legato=0.98, **kw):
    """a melody; notes are (name or None, beats); tr transposes in semitones"""
    pos = bar * c.bpb
    for name, beats in notes:
        if name:
            x = inst(m(name) + tr, c.d(beats) * legato, **kw)
            mx.add(bus, x, at(c, pos) + rng.uniform(0, 0.012), pan, gain)
        pos += beats
    return pos


def pad(mx, bus, c, bar, prog, inst=strings_note, lo=55, n=4, vel=0.5, gain=1.0, spread=0.6, bass=None, **kw):
    for sym, pos, beats in expand(c, bar, prog):
        notes = voicing(sym, lo, n)
        for i, x in enumerate(notes):
            p = (i / max(1, len(notes) - 1) - 0.5) * 2 * spread
            mx.add(bus, inst(x, c.d(beats), vel=hv(vel), **kw), at(c, pos), p, gain)
        if bass is not None:
            mx.add(bus, inst(bassnote(sym, bass), c.d(beats), vel=hv(vel), **kw), at(c, pos), 0, gain)


def arp(mx, bus, c, bar, prog, inst=piano_note, step=0.5, order=(0, 1, 2, 3, 2, 1), lo=55, n=4, vel=0.5, gain=1.0,
        hold=2.5, pan=0.0, bassdrop=None, **kw):
    for sym, pos, beats in expand(c, bar, prog):
        tones = voicing(sym, lo, n)
        if bassdrop is not None:
            tones = [bassnote(sym, bassdrop)] + tones
        k = 0
        while k * step < beats - 1e-6:
            x = tones[order[k % len(order)] % len(tones)]
            accent = 1.12 if (k * step) % c.bpb == 0 else 1.0
            mx.add(bus, inst(x, c.d(step * hold), vel=hv(vel * accent), **kw), at(c, pos + k * step), pan, gain)
            k += 1


def ost(mx, bus, c, bar, prog, pattern, lo=36, inst=staccato_note, vel=0.7, gain=1.0, pan=0.0, **kw):
    """a repeating figure built on each chord's bass note: pattern = [(beat, length in beats, semitones)]"""
    L = c.bpb if max(o for o, _, _ in pattern) < c.bpb else max(o + d for o, d, _ in pattern)
    for sym, pos, beats in expand(c, bar, prog):
        b = bassnote(sym, lo)
        k = 0
        while k * L < beats - 1e-6:
            for o, d, iv in pattern:
                if k * L + o < beats - 1e-6:
                    mx.add(bus, inst(b + iv, c.d(d), vel=hv(vel), **kw), at(c, pos + k * L + o), pan, gain)
            k += 1


def hits(mx, bus, c, bar, bars, pattern, fn, step=0.25, pan=0.0, gain=1.0, vel=0.8, swing=0.0):
    """a drum pattern: 'X' accent, 'x' hit, 'g' ghost, '.' rest; repeated for `bars` bars"""
    per = len(pattern)
    total = int(round(bars * c.bpb / step))
    for k in range(total):
        ch = pattern[k % per]
        if ch == '.':
            continue
        v = {'X': 1.0, 'x': 0.72, 'g': 0.35}[ch] * vel
        sw = swing * c.d(step) if k % 2 else 0.0
        mx.add(bus, fn(hv(v, 0.1)), at(c, bar * c.bpb + k * step) + sw + rng.uniform(0, 0.006), pan, gain)


def roll(mx, bus, c, bar, beats, fn, step=0.125, v0=0.2, v1=0.9, pan=0.0, gain=1.0):
    k, total = 0, int(beats / step)
    while k < total:
        v = v0 + (v1 - v0) * k / max(1, total - 1)
        mx.add(bus, fn(hv(v, 0.1)), at(c, bar * c.bpb + k * step), pan, gain)
        k += 1


def riser(mx, c, bar, beats=4, vel=0.6):
    """a swell that lands on `bar`"""
    d = c.d(beats)
    mx.add('fx', swell(d, vel), at(c, bar * c.bpb) - d, 0, 1)


def hit(mx, c, bar, vel=1.0):
    mx.add('fx', boom(vel), at(c, bar * c.bpb), 0, 1)


def strings_bus(x):
    return lp(x, 7000)


def warm(x):
    return lp(hp(x, 45), 9000)


# ------------------------------------------------------------------ the main theme (shared material)
THEME_A = [('D4', 1.5), ('E4', .5), ('F4', 1), ('A4', 1), ('G4', 2), ('F4', 1), ('E4', 1),
           ('D4', 1.5), ('C4', .5), ('D4', 1), ('F4', 1), ('E4', 4)]
THEME_A2 = [('D4', 1.5), ('E4', .5), ('F4', 1), ('A4', 1), ('D5', 2), ('C5', 1), ('Bb4', 1),
            ('A4', 1.5), ('G4', .5), ('F4', 1), ('E4', 1), ('D4', 4)]
THEME_B = [('F4', 1), ('G4', 1), ('A4', 1), ('C5', 1), ('Bb4', 2), ('A4', 1), ('G4', 1),
           ('A4', 1.5), ('G4', .5), ('F4', 1), ('E4', 1), ('F4', 4),
           ('F4', 1), ('G4', 1), ('A4', 1), ('D5', 1), ('C5', 2), ('Bb4', 1), ('A4', 1),
           ('Bb4', 1.5), ('A4', .5), ('G4', 1), ('F4', 1), ('E4', 4)]
PA = ['Dm', 'Bb', 'Dm', 'A']
PA2 = ['Dm', 'Bb', ('Gm', 2), ('A7', 2), 'Dm']
PB = ['F', 'Gm', 'C', 'F', 'Bb', 'F', 'Gm', 'A']
CELLO = [(0, .45, 0), (.5, .45, 0), (1, .45, 12), (1.5, .45, 0), (2, .45, 0), (2.5, .45, 12), (3, .45, 7), (3.5, .45, 0)]


def main_theme():
    c = Clock(72)
    mx = Mix(c.t(48) + 8)
    # intro: piano alone over a low string bed
    arp(mx, 'keys', c, 0, PA, step=0.5, order=(0, 2, 1, 3, 2, 1, 0, 2), lo=50, vel=0.42)
    pad(mx, 'strings', c, 0, PA, lo=45, n=3, vel=0.3, att=1.6, bright=0.6)
    # A: the theme on the piano, strings underneath
    arp(mx, 'keys', c, 4, PA + PA2, step=0.5, order=(0, 2, 1, 3, 2, 1, 0, 2), lo=50, vel=0.32)
    mel(mx, 'keys', c, 4, THEME_A + THEME_A2, piano_note, tr=12, vel=0.62, pan=0.1)
    pad(mx, 'strings', c, 4, PA + PA2, lo=50, n=4, vel=0.34, att=1.0, bass=38, bright=0.7)
    # B: strings take the tune, cellos start to move
    mel(mx, 'strings', c, 12, THEME_B, strings_note, vel=0.62, att=0.25, pan=-0.15)
    mel(mx, 'strings', c, 12, THEME_B, strings_note, tr=12, vel=0.32, att=0.3, pan=0.25)
    ost(mx, 'low', c, 12, PB, CELLO, lo=36, vel=0.5)
    arp(mx, 'keys', c, 12, PB, step=1, order=(0, 1, 2, 3), lo=60, vel=0.25)
    pad(mx, 'strings', c, 12, PB, lo=48, n=3, vel=0.28, att=0.9, bright=0.6)
    for b in range(12, 20, 2):
        mx.add('perc', timpani(m('D2'), 0.35), c.t(b), 0)
    riser(mx, c, 20, 4, 0.5)
    # A tutti: horns with the theme, strings an octave up, timpani
    for base in (20, 36):
        prog = PA + PA2
        mel(mx, 'brass', c, base, THEME_A + THEME_A2, brass_note, vel=0.78, pan=-0.2)
        mel(mx, 'brass', c, base, THEME_A + THEME_A2, brass_note, tr=-12, vel=0.5, pan=0.2)
        mel(mx, 'strings', c, base, THEME_A + THEME_A2, strings_note, tr=12, vel=0.55, att=0.15)
        pad(mx, 'strings', c, base, prog, lo=53, n=4, vel=0.42, att=0.5, bass=38)
        ost(mx, 'low', c, base, prog, CELLO, lo=36, vel=0.62)
        hits(mx, 'perc', c, base, 8, 'X.......x...x...', lambda v: timpani(m('D2'), v), vel=0.7)
        hits(mx, 'perc', c, base, 8, 'X...............X.......x.......', lambda v: taiko(v), vel=0.55)
    hit(mx, c, 20, 0.7)
    # B with choir
    mel(mx, 'brass', c, 28, THEME_B, brass_note, vel=0.62, pan=-0.2)
    mel(mx, 'strings', c, 28, THEME_B, strings_note, tr=12, vel=0.5, att=0.2)
    pad(mx, 'choir', c, 28, PB, inst=choir_note, lo=55, n=3, vel=0.42, spread=0.8)
    ost(mx, 'low', c, 28, PB, CELLO, lo=36, vel=0.58)
    hits(mx, 'perc', c, 28, 8, 'X.......x.......', lambda v: timpani(m('F2'), v), vel=0.5)
    riser(mx, c, 36, 4, 0.7)
    hit(mx, c, 36, 0.9)
    # coda: the piano alone, ending in D major
    mel(mx, 'keys', c, 44, THEME_A[:7] + [('D4', 4), ('D4', 4)], piano_note, tr=12, vel=0.5)
    arp(mx, 'keys', c, 44, ['Dm', 'Bb'], step=0.5, order=(0, 2, 1, 3, 2, 1, 0, 2), lo=50, vel=0.28)
    pad(mx, 'strings', c, 44, ['Dm', 'Bb', 'D', 'D'], lo=50, n=4, vel=0.3, att=1.5, bass=38, bright=0.6)
    for x in voicing('D', 50, 5):
        mx.add('keys', piano_note(x, c.d(8), 0.4), c.t(46), 0)
    mx.add('keys', bell_note(m('F#5'), 4.0, 0.35), c.t(46), 0.3)
    return mx.render({'strings': (strings_bus, 0.4), 'brass': (warm, 0.32), 'keys': (None, 0.3), 'low': (warm, 0.22),
                      'perc': (None, 0.22), 'choir': (None, 0.5), 'fx': (None, 0.3)}, room=3.2, length=c.t(48) + 6)


def quiet_capitals():
    c = Clock(66)
    mx = Mix(c.t(40) + 8)
    A = ['F', 'C/E', 'Dm', 'Bb', 'F', 'Am', 'Bb', 'C']
    B = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', ('Csus4', 2), ('C', 2)]
    MA = [('A4', 2), ('G4', 1), ('F4', 1), ('E4', 2), ('C4', 2), ('D4', 1), ('E4', 1), ('F4', 1), ('A4', 1), ('G4', 4),
          ('A4', 2), ('C5', 1), ('A4', 1), ('G4', 2), ('E4', 2), ('F4', 1), ('G4', 1), ('A4', 1), ('Bb4', 1), ('A4', 2), ('G4', 2)]
    MB = [('F5', 2), ('E5', 1), ('D5', 1), ('D5', 2), ('C5', 2), ('C5', 1), ('A4', 1), ('C5', 1), ('F5', 1), ('E5', 4),
          ('F5', 2), ('G5', 1), ('F5', 1), ('D5', 3), ('C5', 1), ('Bb4', 1), ('A4', 1), ('G4', 1), ('Bb4', 1), ('A4', 2), ('G4', 2)]
    PAT = (0, 1, 2, 3, 2, 1, 2, 3)
    arp(mx, 'keys', c, 0, A[:4], step=0.5, order=PAT, lo=48, vel=0.4, bassdrop=36)
    arp(mx, 'keys', c, 4, A, step=0.5, order=PAT, lo=48, vel=0.3, bassdrop=36)
    mel(mx, 'keys', c, 4, MA, piano_note, tr=12, vel=0.55)
    pad(mx, 'strings', c, 8, A[4:], lo=53, n=3, vel=0.25, att=1.4, bright=0.5)
    # strings take the tune
    arp(mx, 'keys', c, 12, A, step=0.5, order=PAT, lo=48, vel=0.26, bassdrop=36)
    mel(mx, 'strings', c, 12, MA, strings_note, tr=12, vel=0.5, att=0.35)
    pad(mx, 'strings', c, 12, A, lo=48, n=3, vel=0.26, att=1.0, bass=36, bright=0.5)
    # B: flute and celesta
    arp(mx, 'keys', c, 20, B, step=1, order=(0, 1, 2, 1), lo=48, vel=0.28, bassdrop=36)
    mel(mx, 'wind', c, 20, MB, flute_note, tr=-12, vel=0.55, pan=0.2)
    pad(mx, 'strings', c, 20, B, lo=50, n=4, vel=0.3, att=1.2, bass=36, bright=0.5)
    for b in range(20, 28, 2):
        mx.add('keys', bell_note(m('C6') if b % 4 == 0 else m('A5'), 3.0, 0.25), c.t(b, 2), -0.3)
    # A again, fuller
    arp(mx, 'keys', c, 28, A, step=0.5, order=PAT, lo=48, vel=0.28, bassdrop=36)
    mel(mx, 'strings', c, 28, MA, strings_note, tr=12, vel=0.55, att=0.3)
    mel(mx, 'strings', c, 28, MA, strings_note, vel=0.35, att=0.3, pan=-0.3)
    pad(mx, 'strings', c, 28, A, lo=48, n=4, vel=0.3, att=0.9, bass=36, bright=0.55)
    mel(mx, 'keys', c, 28, [('C6', 4), ('C6', 4), ('A5', 4), ('D6', 4), ('C6', 4), ('E6', 4), ('D6', 4), ('E6', 4)],
        bell_note, vel=0.22, pan=0.4)
    # outro
    arp(mx, 'keys', c, 36, ['F', 'C/E', 'Bb', 'F'], step=0.5, order=PAT, lo=48, vel=0.26, bassdrop=36)
    mel(mx, 'keys', c, 36, MA[:7] + [('F4', 4)], piano_note, tr=12, vel=0.42)
    pad(mx, 'strings', c, 36, ['F', 'C/E', 'Bb', 'F'], lo=53, n=3, vel=0.22, att=1.4, bright=0.45)
    return mx.render({'strings': (strings_bus, 0.45), 'keys': (None, 0.35), 'wind': (None, 0.4)}, room=3.0,
                     target_db=-19, fade_in=0.2, length=c.t(40) + 6)


def trade_winds():
    c = Clock(84)
    mx = Mix(c.t(56) + 8)
    A = ['G', 'D/F#', 'Em', 'C', 'G', 'Bm', 'C', 'D']
    B = ['C', 'D', 'Bm', 'Em', 'Am', 'D', 'G', 'G']
    MA = [('D5', 1), ('B4', .5), ('G4', .5), ('A4', 1), ('B4', 1), ('A4', 2), ('F#4', 1), ('D4', 1),
          ('E4', 1), ('G4', 1), ('B4', 1), ('A4', .5), ('G4', .5), ('G4', 2), ('E4', 2),
          ('D5', 1), ('B4', .5), ('G4', .5), ('A4', 1), ('B4', 1), ('D5', 2), ('B4', 1), ('F#4', 1),
          ('E5', 1), ('D5', 1), ('C5', 1), ('B4', 1), ('A4', 4)]
    MB = [('E5', 1.5), ('D5', .5), ('C5', 1), ('E5', 1), ('D5', 2), ('A4', 2), ('B4', 1.5), ('A4', .5), ('G4', 1), ('F#4', 1),
          ('E4', 4), ('C5', 1.5), ('B4', .5), ('A4', 1), ('C5', 1), ('D5', 2), ('F#4', 1), ('A4', 1), ('G4', 4), (None, 4)]
    HARP = (0, 1, 2, 3, 4, 3, 2, 1)
    PIZZ = [(0, .5, 0), (1.5, .5, 7), (2, .5, 0), (3, .5, 12)]

    def band(bar, prog, harp=0.32, pizz=0.5, shake=True):
        arp(mx, 'harp', c, bar, prog, inst=pluck_note, step=0.5, order=HARP, lo=55, n=5, vel=harp, hold=4)
        if pizz:
            ost(mx, 'low', c, bar, prog, PIZZ, lo=36, inst=lambda n_, d, vel: pluck_note(n_, 0.8, vel, bright=0.3), vel=pizz)
        if shake:
            hits(mx, 'perc', c, bar, len(prog), 'xgxg', lambda v: shaker(v), step=0.5, vel=0.5, pan=0.3)

    band(0, A[:4], pizz=0, shake=False)
    band(4, A)
    mel(mx, 'wind', c, 4, MA, flute_note, vel=0.62, pan=0.15)
    band(12, A)
    mel(mx, 'strings', c, 12, MA, strings_note, vel=0.5, att=0.2)
    pad(mx, 'strings', c, 12, A, lo=48, n=3, vel=0.22, att=0.8, bright=0.6)
    band(20, B)
    mel(mx, 'wind', c, 20, MB, flute_note, vel=0.62, pan=0.15)
    pad(mx, 'strings', c, 20, B, lo=52, n=3, vel=0.25, att=0.8, bright=0.6)
    hits(mx, 'perc', c, 20, 8, 'x.......', lambda v: taiko(v * 0.5, f0=90, dur=0.8), step=0.5, vel=0.5)
    band(28, A)
    mel(mx, 'wind', c, 28, MA, flute_note, tr=12, vel=0.45, pan=0.25)
    mel(mx, 'keys', c, 28, MA, bell_note, vel=0.3, pan=-0.25)
    band(36, B)
    mel(mx, 'strings', c, 36, MB, strings_note, vel=0.55, att=0.2)
    mel(mx, 'strings', c, 36, MB, strings_note, tr=-12, vel=0.35, att=0.2)
    pad(mx, 'strings', c, 36, B, lo=52, n=3, vel=0.25, att=0.8, bright=0.6)
    band(44, A)
    mel(mx, 'wind', c, 44, MA, flute_note, vel=0.62, pan=0.15)
    mel(mx, 'strings', c, 44, MA, strings_note, tr=-12, vel=0.4, att=0.2)
    pad(mx, 'strings', c, 44, A, lo=48, n=4, vel=0.25, att=0.8, bass=36, bright=0.6)
    band(52, ['G', 'C', 'D', 'G'], pizz=0.35, shake=False)
    mx.add('keys', bell_note(m('G5'), 4, 0.3), c.t(55), 0)
    return mx.render({'strings': (strings_bus, 0.4), 'harp': (None, 0.3), 'low': (None, 0.2), 'wind': (None, 0.35),
                      'perc': (None, 0.12), 'keys': (None, 0.35)}, room=2.4, target_db=-18, length=c.t(56) + 5)


def long_game():
    c = Clock(60)
    mx = Mix(c.t(40) + 8)
    A = ['Am', 'Fmaj7', 'C', 'G', 'Am', 'Fmaj7', 'Dm7', ('Esus4', 2), ('E', 2)]
    PAT = (0, 2, 3, 1, 3, 2, 0, 3)
    M = [('E5', 3), ('D5', 1), ('C5', 4), ('G4', 2), ('A4', 1), ('B4', 1), ('B4', 4),
         ('E5', 2), ('G5', 2), ('A5', 3), ('G5', 1), ('F5', 2), ('E5', 1), ('D5', 1), ('E5', 4)]
    for b in (0, 8, 16, 24, 32):
        arp(mx, 'keys', c, b, A, step=0.5, order=PAT, lo=57, n=4, vel=0.34 if b in (0, 32) else 0.3)
    hits(mx, 'perc', c, 0, 40, 'x', lambda v: tick(v), step=1, vel=0.35, pan=-0.2)
    hits(mx, 'perc', c, 8, 32, '.g', lambda v: tick(v), step=0.5, vel=0.3, pan=0.25)
    pad(mx, 'strings', c, 8, A, lo=48, n=3, vel=0.22, att=2.0, bright=0.4)
    pad(mx, 'strings', c, 16, A + A, lo=50, n=4, vel=0.26, att=1.6, bass=33, bright=0.45)
    mel(mx, 'keys', c, 16, M, piano_note, tr=12, vel=0.4, pan=0.2)
    mel(mx, 'strings', c, 24, M, strings_note, vel=0.38, att=0.8, pan=-0.2)
    pad(mx, 'choir', c, 24, A, inst=choir_note, lo=57, n=3, vel=0.22, att=1.5)
    for b in range(16, 32, 4):
        mx.add('keys', bell_note(m('E6'), 3, 0.18), c.t(b, 3), 0.4)
    pad(mx, 'strings', c, 32, A, lo=48, n=3, vel=0.18, att=2.0, bright=0.4)
    for x in voicing('Am', 45, 5):
        mx.add('keys', piano_note(x, 6, 0.35), c.t(40) - 0.01, 0)
    return mx.render({'strings': (strings_bus, 0.5), 'keys': (None, 0.35), 'perc': (lambda x: hp(x, 1500), 0.25),
                      'choir': (None, 0.5)}, room=3.4, target_db=-20, length=c.t(40) + 6)


def red_lines():
    c = Clock(90)
    mx = Mix(c.t(60) + 8)
    A = ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Db', 'Ab', 'G']
    PULSE = [(i * 0.5, 0.3, 0) for i in range(8)]
    for b in range(0, 56, 8):
        ost(mx, 'low', c, b, A, PULSE, lo=36, vel=0.5 if b < 16 else 0.62, cutoff=700)
        if b >= 16:
            ost(mx, 'low', c, b, A, [(i * 0.5, 0.3, 12) for i in range(8)], lo=36, vel=0.35, cutoff=1400, pan=0.3)
    pad(mx, 'strings', c, 0, A * 7, lo=55, n=3, vel=0.22, att=1.5, bright=0.5)
    pad(mx, 'strings', c, 0, ['Cm'] * 8, lo=74, n=1, vel=0.12, att=3, bright=0.4)   # a high held note
    hits(mx, 'perc', c, 8, 48, 'xggxggxgxggxggxg', lambda v: tick(v), vel=0.35, pan=0.2)
    MOTIF = [('G5', 1.5), ('Ab5', 2.5), (None, 4), ('G5', 1.5), ('F5', 1), ('Eb5', 1.5), (None, 4)]
    for b in (8, 12, 40, 44, 48, 52):
        mel(mx, 'keys', c, b, MOTIF, piano_note, tr=-12, vel=0.42, pan=-0.2)
    for start in (16, 40):
        riser(mx, c, start, 4, 0.55)
        hit(mx, c, start, 0.8)
        pad(mx, 'brass', c, start, A * 2, inst=brass_note, lo=43, n=3, vel=0.42)
        hits(mx, 'perc', c, start, 16, 'X.......X..x....', lambda v: taiko(v), vel=0.55)
    hits(mx, 'perc', c, 32, 8, 'X.x.............', lambda v: taiko(v * 0.6, f0=50), vel=0.6)   # a heartbeat
    mel(mx, 'keys', c, 32, [('C6', 4), ('Bb5', 4), ('Ab5', 4), ('G5', 4)] * 2, bell_note, vel=0.25, pan=0.3)
    ost(mx, 'strings', c, 40, A * 2, [(i * 0.25, 0.2, iv) for i, iv in enumerate((24, 27, 31, 27) * 4)], lo=36, vel=0.25,
        cutoff=2400, pan=-0.3)
    riser(mx, c, 56, 4, 0.6)
    hit(mx, c, 56, 0.9)
    pad(mx, 'strings', c, 56, [('Cm', 16)], lo=48, n=3, vel=0.28, att=0.4, bass=36, bright=0.5)
    return mx.render({'strings': (strings_bus, 0.4), 'low': (None, 0.2), 'perc': (None, 0.2), 'keys': (None, 0.4),
                      'brass': (warm, 0.35), 'fx': (None, 0.35)}, room=3.0, target_db=-18, length=c.t(60) + 5)


def iron_and_fire():
    c = Clock(120)
    mx = Mix(c.t(80) + 8)
    DRIVE = [(i * 0.25, 0.2, iv) for i, iv in enumerate((0, 0, 12, 0, 3 + 12, 0, 7, 0, 0, 0, 12, 0, 7 + 12, 0, 10, 0))]
    TAIKO = 'X..xX...X..xX.x.'
    SNARE = '....X.......X..g'
    # the theme at war tempo: every note value doubled so it keeps its shape
    def wide(ph):
        return [(n_, d * 2) for n_, d in ph]
    PROG = ['Dm', 'Dm', 'Bb', 'Bb', 'Dm', 'Dm', 'A', 'A', 'Dm', 'Dm', 'Bb', 'Bb', ('Gm', 4), ('A7', 4), 'Dm', 'Dm']
    PROG_B = ['F', 'F', 'Gm', 'Gm', 'C', 'C', 'F', 'F', 'Bb', 'Bb', 'F', 'F', 'Gm', 'Gm', 'A', 'A']
    # intro: the string figure alone, then drums
    ost(mx, 'low', c, 0, ['Dm'] * 4 + ['Bb', 'Bb', 'A', 'A'], DRIVE, lo=38, vel=0.55, cutoff=1300)
    hits(mx, 'perc', c, 4, 4, TAIKO, lambda v: taiko(v), vel=0.6)
    riser(mx, c, 8, 4, 0.6)
    for b in range(8, 72, 16):
        prog = PROG_B if b in (56,) else PROG
        ost(mx, 'low', c, b, prog, DRIVE, lo=38, vel=0.62, cutoff=1400)
        hits(mx, 'perc', c, b, 16, TAIKO, lambda v: taiko(v), vel=0.8)
        if b != 40:
            hits(mx, 'perc', c, b, 16, SNARE, lambda v: snare(v), vel=0.55, pan=0.15)
        pad(mx, 'brass', c, b, prog, inst=brass_note, lo=46, n=3, vel=0.45, bass=None)
        hit(mx, c, b, 0.8)
    # bars 8-23: low brass and timpani only; 24-39: horns sing the theme
    mel(mx, 'brass', c, 24, wide(THEME_A + THEME_A2), brass_note, vel=0.85, pan=-0.15)
    mel(mx, 'brass', c, 24, wide(THEME_A + THEME_A2), brass_note, tr=-12, vel=0.55, pan=0.15)
    pad(mx, 'strings', c, 24, PROG, lo=55, n=3, vel=0.32, att=0.3)
    # 40-55: the break: choir and drums, then everything
    pad(mx, 'choir', c, 40, PROG[:8], inst=choir_note, lo=55, n=3, vel=0.5)
    mel(mx, 'strings', c, 48, wide(THEME_A2), strings_note, tr=12, vel=0.55, att=0.15)
    mel(mx, 'brass', c, 48, wide(THEME_A2), brass_note, vel=0.75)
    roll(mx, 'perc', c, 54, 8, lambda v: snare(v), step=0.125, v0=0.15, v1=0.8)
    riser(mx, c, 56, 8, 0.7)
    # 56-71: theme B, tutti
    mel(mx, 'brass', c, 56, wide(THEME_B), brass_note, vel=0.85, pan=-0.15)
    mel(mx, 'strings', c, 56, wide(THEME_B), strings_note, tr=12, vel=0.58, att=0.12)
    pad(mx, 'choir', c, 56, PROG_B, inst=choir_note, lo=55, n=3, vel=0.42)
    hits(mx, 'perc', c, 56, 16, 'X...............', lambda v: timpani(m('D2'), v), vel=0.8)
    # 72-79: the ending
    ost(mx, 'low', c, 72, ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm'], DRIVE, lo=38, vel=0.65, cutoff=1500)
    hits(mx, 'perc', c, 72, 6, TAIKO, lambda v: taiko(v), vel=0.85)
    mel(mx, 'brass', c, 72, [('D4', 4), ('F4', 4), ('Bb4', 4), ('A4', 4), ('D5', 8)], brass_note, vel=0.85)
    pad(mx, 'strings', c, 72, ['Dm', 'Dm', 'Bb', 'A', ('Dm', 8)], lo=50, n=4, vel=0.4, att=0.2, bass=38)
    for k, v in ((0, 1.0), (1.5, 0.8), (3, 1.0)):
        mx.add('perc', taiko(v), c.t(78, k), 0)
    mx.add('perc', timpani(m('D2'), 1.0, 3.5), c.t(78, 3), 0)
    hit(mx, c, 78, 1.0)
    return mx.render({'strings': (strings_bus, 0.35), 'brass': (warm, 0.3), 'low': (warm, 0.18), 'perc': (None, 0.18),
                      'choir': (None, 0.45), 'fx': (None, 0.3)}, room=2.6, target_db=-16, length=c.t(80) + 4)


def the_front():
    c = Clock(104)
    mx = Mix(c.t(68) + 8)
    A = ['Em', 'G', 'C', 'B', 'Em', 'G', ('Am', 2), ('B7', 2), 'Em']
    B = ['C', 'D', ('G', 2), ('Em', 2), 'B', 'C', 'D', ('Am', 2), ('B', 2), 'Em']
    MA = [('E4', 2), ('F#4', 1), ('G4', 1), ('B4', 3), ('A4', 1), ('G4', 2), ('F#4', 1), ('E4', 1), ('F#4', 4),
          ('E4', 2), ('F#4', 1), ('G4', 1), ('B4', 2), ('D5', 1), ('C5', 1), ('B4', 1.5), ('A4', .5), ('G4', 1), ('F#4', 1), ('E4', 4)]
    MB = [('G4', 2), ('A4', 1), ('B4', 1), ('C5', 2), ('B4', 1), ('A4', 1), ('B4', 2), ('G4', 1), ('E4', 1), ('F#4', 4),
          ('G4', 2), ('A4', 1), ('B4', 1), ('C5', 2), ('B4', 1), ('A4', 1), ('G4', 1.5), ('F#4', .5), ('E4', 1), ('D#4', 1), ('E4', 4)]
    MARCH = 'X.xxX.x.X.xxXgxx'
    TIMP = [(0, m('E2')), (2, m('B1'))]

    def drums(bar, bars, vel=0.55, timp=True):
        hits(mx, 'perc', c, bar, bars, MARCH, lambda v: snare(v), vel=vel, pan=0.12)
        if timp:
            for b in range(bar, bar + bars):
                for beat, n_ in TIMP:
                    mx.add('perc', timpani(n_, hv(0.5)), c.t(b, beat), -0.1)

    drums(0, 4, 0.45, timp=False)
    drums(4, 56)
    pad(mx, 'strings', c, 4, A, lo=40, n=3, vel=0.3, att=1.0, bright=0.5)
    mel(mx, 'brass', c, 4, [('B3', 3), ('E4', 1), ('E4', 4), ('D4', 2), ('B3', 2), ('B3', 4)] * 2, brass_note, vel=0.5,
        pan=-0.3)
    for base in (12, 20):
        mel(mx, 'strings', c, base, MA, strings_note, tr=12 if base == 20 else 0, vel=0.58, att=0.2)
        pad(mx, 'choir', c, base, A, inst=choir_note, lo=52, n=3, vel=0.35)
        pad(mx, 'strings', c, base, A, lo=47, n=3, vel=0.25, att=0.8, bass=28, bright=0.5)
    mel(mx, 'strings', c, 20, MA, strings_note, vel=0.4, att=0.2, pan=-0.3)
    # B: the choir carries the tune
    mel(mx, 'choir', c, 28, MB, choir_note, vel=0.5, att=0.3)
    pad(mx, 'strings', c, 28, B, lo=47, n=4, vel=0.3, att=0.6, bass=28, bright=0.5)
    riser(mx, c, 36, 4, 0.6)
    hit(mx, c, 36, 0.8)
    for base in (36, 44):
        mel(mx, 'brass', c, base, MA, brass_note, vel=0.8, pan=-0.15)
        mel(mx, 'strings', c, base, MA, strings_note, tr=12, vel=0.55, att=0.12)
        pad(mx, 'brass', c, base, A, inst=brass_note, lo=43, n=3, vel=0.38)
        pad(mx, 'choir', c, base, A, inst=choir_note, lo=55, n=3, vel=0.38)
        hits(mx, 'perc', c, base, 8, 'X.......X.......', lambda v: taiko(v), vel=0.6)
    mel(mx, 'brass', c, 52, MB, brass_note, vel=0.72)
    mel(mx, 'strings', c, 52, MB, strings_note, tr=12, vel=0.5, att=0.15)
    pad(mx, 'choir', c, 52, B, inst=choir_note, lo=55, n=3, vel=0.4)
    # the column marches off
    drums(60, 8, 0.4, timp=False)
    pad(mx, 'strings', c, 60, ['Em', 'C', 'Am', 'B', ('Em', 16)], lo=47, n=3, vel=0.25, att=1.2, bright=0.45)
    mel(mx, 'brass', c, 60, [('E4', 2), ('F#4', 1), ('G4', 1), ('B4', 4), ('A4', 2), ('G4', 2), ('F#4', 4), ('E4', 16)],
        brass_note, vel=0.4)
    out = mx.render({'strings': (strings_bus, 0.4), 'brass': (warm, 0.3), 'perc': (None, 0.18), 'choir': (None, 0.5),
                     'fx': (None, 0.3)}, room=2.8, target_db=-18, length=c.t(68) + 3, fade_out=12)
    return out


TRACKS = {'main-theme': main_theme, 'quiet-capitals': quiet_capitals, 'trade-winds': trade_winds,
          'the-long-game': long_game, 'red-lines': red_lines, 'iron-and-fire': iron_and_fire, 'the-front': the_front}


def render(name):
    y = TRACKS[name]()
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, f'{name}.wav')
    wavfile.write(wav, SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))
    ogg = os.path.join(OUT, f'{name}.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '3', ogg], check=True)
    os.remove(wav)
    peak = 20 * np.log10(np.max(np.abs(y)) + 1e-9)
    rms = 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
    return f'{name}: {len(y) / SR:.0f} s, peak {peak:.1f} dB, rms {rms:.1f} dB, {os.path.getsize(ogg) / 1e6:.1f} MB'


if __name__ == '__main__':
    names = sys.argv[1:] or list(TRACKS)
    with Pool(min(4, len(names))) as p:
        for line in p.imap_unordered(render, names):
            print(line, flush=True)
