"""Final mix: score stems + narration + radio. The narration ducks the score; the score drops for the pause in the war section."""
import wave, numpy as np
SR = 48000; DUR = 75.6; N = int(SR * DUR); t = np.arange(N) / SR
def rd(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2).astype(float) / 32768; return x
def place(bus, x, at, g):
    a = int(at * SR); n = min(len(x), N - a); bus[a:a + n] += x[:n] * g
score = sum(rd(f'audio/{s}.wav')[:N] for s in ('music', 'drums', 'fx'))
vo = np.zeros((N, 2)); radio = np.zeros((N, 2))
for k, at in {'n1': 4.0, 'n2': 11.0, 'n3': 15.6, 'n4': 45.6, 'n5': 49.75, 'n6': 54.0, 'n7': 58.4, 'n8': 61.6}.items():
    place(vo, rd(f'vo/{k}.wav'), at, 2.0)          # +6 dB
place(radio, rd('vo/r1.wav'), 0.2, 1.1); place(radio, rd('vo/r3.wav'), 34.6, 0.9)
# sidechain: smoothed narration envelope -> up to 9 dB of score reduction (fast attack, slow release)
lvl = np.abs(vo).max(1); env = np.zeros(N); a_att, a_rel = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.5 * SR)); e = 0.0
for i in range(0, N, 48):                         # 1 ms control rate
    v = lvl[i:i + 48].max(); e = a_att * e + (1 - a_att) * v if v > e else a_rel * e + (1 - a_rel) * v; env[i:i + 48] = e
duck = 10 ** (-6 * np.clip(env / 0.05, 0, 1) / 20)
# arrangement automation: the pause before "Or change it forever", and the radio sitting under the static intro
auto = np.interp(t, [0, 45.2, 45.6, 48.4, 48.7, 49.45, 49.5, 52.4, 53.0, 76], [1, 1, 0.42, 0.42, 0.12, 0.12, 0.75, 0.75, 1, 1])
mix = score * (duck * auto)[:, None] + vo + radio
pk = np.max(np.abs(mix)); print('peak', pk)
np.save('audio/mix_raw.npy', mix.astype(np.float32))  # float, unclipped; mastered by master.sh
db = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
for k, at, d in [('n1', 4, 3.6), ('n4', 45.6, 2.5), ('n5', 49.75, 2.3), ('n8', 61.6, 3)]:
    a, b = int(at * SR), int((at + d) * SR); print(k, 'vo %.1f' % db(vo[a:b]), 'score %.1f' % db((score * (duck * auto)[:, None])[a:b]))
