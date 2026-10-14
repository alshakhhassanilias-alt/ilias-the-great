/**
 * Procedural portraits. Every leader, minister and general gets a face, deterministic from their name:
 * skin tone and hair typical of the region, age (greying, wrinkles, receding hair), glasses, moustaches and
 * beards, a stern or easy expression, and dress that fits the role (suit and tie in the national colour,
 * a blazer and pearls, or a uniform with shoulder boards, ribbons and a peaked cap). Pure SVG, painted with
 * soft light from the upper left so it sits in the war-room look.
 */
import { memo, useId } from 'react';
import { nationalHsl } from '../../map/palette';
import type { Country } from '../../sim/types';
import { isFemaleName } from '../../sim/names';

const h = (seed: string, salt: number) => {
  let x = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
};
const pick = <T,>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];

export const isFemale = isFemaleName;

const SKIN: Record<string, string[]> = {
  EU: ['#f1d2bd', '#eac3a6', '#e3b897', '#f3d9c6'], NA: ['#f1d2bd', '#e3b897', '#c98f68', '#8d5a3c', '#eac3a6'], RU: ['#f2d6c3', '#ebc7ad', '#e2bb9c'],
  OC: ['#f1d2bd', '#e3b897', '#b47a52', '#9a6444'], LA: ['#d9a882', '#c99470', '#b47e58', '#e3b897'], ME: ['#d7a77f', '#c9966c', '#e0b590', '#bc8660'],
  AF: ['#8d5a3c', '#6f4329', '#5a341f', '#7b4a30'], SA: ['#b87f57', '#a26c47', '#c98f68', '#8f5b3b'], EA: ['#efd0b0', '#e8c49e', '#f2d7ba'], SEA: ['#d8aa82', '#c99a70', '#e2b88f'],
};
const HAIR = ['#1c1714', '#2b2019', '#3b2a1f', '#5a3e2a', '#7a5a3a', '#a07a4c', '#c8a468', '#8a3d22'];
const HAIR_BY: Record<string, number[]> = { EU: [1, 2, 3, 4, 5, 6, 7], NA: [1, 2, 3, 4, 5, 6], RU: [2, 3, 4, 5, 6], OC: [2, 3, 4, 5, 6], LA: [0, 1, 2, 3], ME: [0, 1, 2], AF: [0, 1], SA: [0, 1], EA: [0, 0, 1], SEA: [0, 1] };

export interface FaceSpec { seed: string; region: string; female: boolean; age: number; dress: 'suit' | 'uniform' | 'royal'; accent: string; cap?: boolean }

/** a face for someone from country c */
export function faceFor(c: Pick<Country, 'id' | 'region' | 'gov' | 'color' | 'name'>, name: string, role: 'leader' | 'minister' | 'general', seedAge = 0): FaceSpec {
  const r = h(name, 7 + seedAge);
  const age = role === 'general' ? 50 + Math.round(r * 16) : role === 'leader' ? 46 + Math.round(r * 28) : 36 + Math.round(r * 30);
  const [hh, ss, ll] = nationalHsl(c);
  return {
    seed: `${name}|${c.id}`, region: c.region, female: isFemale(name), age,
    dress: role === 'general' ? 'uniform' : role === 'leader' && c.gov === 'M' ? 'royal' : 'suit',
    accent: `hsl(${hh} ${Math.min(70, ss)}% ${Math.max(28, Math.min(46, ll))}%)`, cap: role === 'general' && h(name, 3) < 0.6,
  };
}

function PortraitImpl({ f, size = 64, title }: { f: FaceSpec; size?: number; title?: string }) {
  const uid = useId().replace(/:/g, '');
  const R = (i: number) => h(f.seed, i);
  const skin = pick(SKIN[f.region] ?? SKIN.EU, R(1));
  const grey = f.age > 62 ? 1 : f.age > 52 ? 0.55 : f.age > 46 ? 0.2 : 0;
  const baseHair = HAIR[pick(HAIR_BY[f.region] ?? HAIR_BY.EU, R(2))];
  const hair = grey >= 1 && R(3) < 0.7 ? (R(4) < 0.5 ? '#c9c4bc' : '#9d968c') : grey > 0.5 && R(3) < 0.5 ? '#7d756c' : baseHair;
  const jaw = 15.5 + R(5) * 3.2; // half-width of the jaw
  const chinY = 69 + R(6) * 3;
  const glasses = R(7) < (f.age > 55 ? 0.42 : 0.2);
  const smile = R(8) < 0.45;
  const male = !f.female;
  const facial = male ? (f.region === 'ME' || f.region === 'SA' ? pick(['beard', 'moustache', 'beard', 'none'], R(9)) : pick(['none', 'none', 'none', 'moustache', 'stubble', 'beard'], R(9))) : 'none';
  const style = male ? (f.age > 58 && R(10) < 0.45 ? 'receding' : R(10) < 0.08 ? 'bald' : pick(['side', 'short', 'swept', 'side'], R(11))) : pick(['bob', 'long', 'bun', 'shoulder', 'bob'], R(11));
  const suit = f.dress === 'uniform' ? pick(['#4a5130', '#3c4636', '#2a3550', '#4b4a3a'], R(12)) : pick(['#22262e', '#1f2733', '#2b2a2e', '#33302c', '#1b2230'], R(12));
  const shirt = f.dress === 'uniform' ? '#c9c2a6' : '#eeeae2';
  const brow = hair === '#c9c4bc' ? '#8c8478' : hair;
  const lip = f.female ? '#a8505a' : '#9a6a5a';
  const eyeY = 47, cx = 50;
  const ew = 3.4; // eye half-width
  const headTop = 24 + R(13) * 2;
  const head = `M${cx - jaw - 1.5} 46 C${cx - jaw - 1.5} ${headTop + 6} ${cx - 9} ${headTop} ${cx} ${headTop} C${cx + 9} ${headTop} ${cx + jaw + 1.5} ${headTop + 6} ${cx + jaw + 1.5} 46 C${cx + jaw + 1} 58 ${cx + jaw - 4} 66 ${cx + 6} ${chinY} Q${cx} ${chinY + 2.4} ${cx - 6} ${chinY} C${cx - jaw + 4} 66 ${cx - jaw - 1} 58 ${cx - jaw - 1.5} 46 Z`;
  const L = cx - jaw - 2, Rr = cx + jaw + 2;

  // hair pieces: behind the head (long styles) and the front cap
  const back = !male && (style === 'long' || style === 'shoulder')
    ? <path d={`M${L - 2} 44 C${L - 4} 26 ${cx - 12} 19 ${cx} 19 C${cx + 12} 19 ${Rr + 4} 26 ${Rr + 2} 44 L${Rr + 3} ${style === 'long' ? 86 : 72} C${Rr - 4} ${style === 'long' ? 90 : 76} ${L + 4} ${style === 'long' ? 90 : 76} ${L - 3} ${style === 'long' ? 86 : 72} Z`} fill={hair} />
    : !male && style === 'bun' ? <circle cx={cx} cy={headTop - 3} r={7} fill={hair} /> : null;
  let front: string | null = null;
  if (style === 'bald') front = null;
  else if (style === 'receding') front = `M${L} 44 C${L - 1} 34 ${L + 2} 30 ${L + 4} 30 L${L + 5} 40 Z M${Rr} 44 C${Rr + 1} 34 ${Rr - 2} 30 ${Rr - 4} 30 L${Rr - 5} 40 Z`;
  else if (male) {
    const part = style === 'side' ? cx - 6 : cx;
    const fringe = style === 'swept' ? headTop + 9 : headTop + 7;
    front = `M${L} 46 C${L - 1.5} ${headTop + 2} ${cx - 10} ${headTop - 4} ${cx} ${headTop - 4} C${cx + 10} ${headTop - 4} ${Rr + 1.5} ${headTop + 2} ${Rr} 46 C${Rr - 1} 40 ${Rr - 3} ${fringe + 2} ${Rr - 6} ${fringe} Q${part + 4} ${fringe - 4} ${part} ${fringe - 1} Q${cx - 10} ${fringe + 1} ${L + 3} ${fringe + 4} C${L + 1.5} 38 ${L + 1} 42 ${L} 46 Z`;
  } else {
    const fr = style === 'bob' ? headTop + 9 : headTop + 8;
    front = `M${L - 1} ${style === 'bob' ? 62 : 52} C${L - 3} ${headTop} ${cx - 10} ${headTop - 5} ${cx} ${headTop - 5} C${cx + 10} ${headTop - 5} ${Rr + 3} ${headTop} ${Rr + 1} ${style === 'bob' ? 62 : 52} C${Rr - 1} 52 ${Rr - 2} 44 ${Rr - 3} ${fr + 6} Q${cx + 6} ${fr - 2} ${cx - 3} ${fr} Q${L + 6} ${fr + 2} ${L + 3} ${fr + 8} C${L + 2} 44 ${L + 1} 52 ${L - 1} ${style === 'bob' ? 62 : 52} Z`;
  }
  const accent = f.accent;
  return (
    <svg className="portrait" viewBox="12 10 76 80" width={size} height={size} role="img" aria-label={title ?? 'portrait'}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`bg${uid}`} cx="35%" cy="30%" r="85%"><stop offset="0" stopColor="#6b5a45" /><stop offset="0.6" stopColor="#3a3027" /><stop offset="1" stopColor="#1d1813" /></radialGradient>
        <radialGradient id={`sh${uid}`} cx="36%" cy="34%" r="75%"><stop offset="0.35" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#2a160c" stopOpacity="0.42" /></radialGradient>
        <linearGradient id={`cl${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.14" /><stop offset="0.6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.35" /></linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#bg${uid})`} />
      {/* a flag-coloured glow behind the sitter */}
      <circle cx="50" cy="44" r="38" fill={accent} opacity="0.16" />
      {back}
      {/* body */}
      <path d="M6 100 C8 86 24 78 50 78 C76 78 92 86 94 100 Z" fill={suit} />
      {f.dress !== 'uniform' && !f.female && <>
        <path d="M41 78 L50 96 L59 78 Z" fill={shirt} />
        <path d="M48.3 80.5 L51.7 80.5 L53 89 L50 99 L47 89 Z" fill={accent} />
        <path d="M48.3 80.5 L51.7 80.5 L50.9 83 L49.1 83 Z" fill="#000" opacity="0.25" />
        <path d="M39 79 L48 97 L44 100 L34 83 Z M61 79 L52 97 L56 100 L66 83 Z" fill="#000" opacity="0.22" />
      </>}
      {f.dress !== 'uniform' && f.female && <>
        <path d="M42 78 Q50 90 58 78 Z" fill={pick(['#e9e2d6', accent, '#d9c7b0'], R(14))} />
        <path d="M38 79 L47 96 L42 100 L32 84 Z M62 79 L53 96 L58 100 L68 84 Z" fill="#000" opacity="0.2" />
        {R(15) < 0.6 && <path d="M42.5 80 Q50 88 57.5 80" fill="none" stroke="#f3eee2" strokeWidth="1.4" strokeDasharray="0.1 2.2" strokeLinecap="round" />}
      </>}
      {f.dress === 'uniform' && <>
        <path d="M42 78 L50 88 L58 78 Z" fill={shirt} />
        <path d="M48.6 80 L51.4 80 L52.2 87 L50 92 L47.8 87 Z" fill="#2a2a24" />
        <path d="M40 78 L50 92 L45 96 L35 82 Z M60 78 L50 92 L55 96 L65 82 Z" fill="#000" opacity="0.18" />
        <rect x="38.5" y="80" width="4" height="3" rx="0.6" fill="#a8322c" /><rect x="57.5" y="80" width="4" height="3" rx="0.6" fill="#a8322c" />
        <path d="M12 88 L28 82 L30 86 L14 92 Z M88 88 L72 82 L70 86 L86 92 Z" fill="#c9a24a" />
        {[0, 1, 2].map((i) => <rect key={i} x={26 + i * 4.2} y={89} width={3.8} height={2.4} fill={pick(['#a8322c', '#2e5d9a', '#d8b04a', '#3e7a46', '#f1ece0'], R(20 + i))} />)}
        {[0, 1].map((i) => <rect key={i} x={28 + i * 4.2} y={92} width={3.8} height={2.4} fill={pick(['#2e5d9a', '#d8b04a', '#a8322c', '#f1ece0'], R(24 + i))} />)}
      </>}
      {f.dress === 'royal' && <path d="M27 82 L33 80 L72 100 L62 100 Z" fill={accent} opacity="0.95" />}
      <path d="M6 100 C8 86 24 78 50 78 C76 78 92 86 94 100 Z" fill={`url(#cl${uid})`} />
      {/* neck */}
      <path d={`M${cx - 7.5} 60 L${cx - 7} 80 Q${cx} 84 ${cx + 7} 80 L${cx + 7.5} 60 Z`} fill={skin} />
      <path d={`M${cx - 7.5} 64 Q${cx} 72 ${cx + 7.5} 64 L${cx + 7.5} 70 Q${cx} 76 ${cx - 7.5} 70 Z`} fill="#000" opacity="0.16" />
      {/* ears */}
      <ellipse cx={L + 0.5} cy={48} rx={2.6} ry={4.4} fill={skin} /><ellipse cx={Rr - 0.5} cy={48} rx={2.6} ry={4.4} fill={skin} />
      <ellipse cx={Rr - 0.5} cy={48} rx={2.6} ry={4.4} fill="#000" opacity="0.12" />
      {/* face */}
      <path d={head} fill={skin} />
      <path d={head} fill={`url(#sh${uid})`} />
      {/* cheeks */}
      <ellipse cx={cx - 9} cy={57} rx={4} ry={2.5} fill="#c8604a" opacity={f.female ? 0.16 : 0.08} />
      <ellipse cx={cx + 9} cy={57} rx={4} ry={2.5} fill="#c8604a" opacity={f.female ? 0.16 : 0.08} />
      {facial === 'stubble' && <path d={`M${cx - jaw + 1} 56 C${cx - jaw + 3} 64 ${cx - 6} ${chinY} ${cx} ${chinY + 1} C${cx + 6} ${chinY} ${cx + jaw - 3} 64 ${cx + jaw - 1} 56 C${cx + 6} 62 ${cx - 6} 62 ${cx - jaw + 1} 56 Z`} fill={hair} opacity="0.22" />}
      {facial === 'beard' && <path d={`M${cx - jaw} 52 C${cx - jaw + 1} 66 ${cx - 7} ${chinY + 4} ${cx} ${chinY + 4.5} C${cx + 7} ${chinY + 4} ${cx + jaw - 1} 66 ${cx + jaw} 52 C${cx + jaw - 3} 58 ${cx + 6} 60.5 ${cx + 4} 64 Q${cx} 66 ${cx - 4} 64 C${cx - 6} 60.5 ${cx - jaw + 3} 58 ${cx - jaw} 52 Z`} fill={hair} opacity="0.92" />}
      {/* eyes */}
      {[-1, 1].map((sd) => {
        const ex = cx + sd * 7.2;
        return (
          <g key={sd}>
            <path d={`M${ex - ew} ${eyeY} Q${ex} ${eyeY - 2.6} ${ex + ew} ${eyeY} Q${ex} ${eyeY + 1.9} ${ex - ew} ${eyeY} Z`} fill="#f4efe6" />
            <circle cx={ex + sd * 0.2} cy={eyeY - 0.1} r={1.55} fill={pick(['#3a2a1e', '#2a2018', '#4a6a7a', '#5a4a2a'], R(30))} />
            <circle cx={ex + sd * 0.2 - 0.5} cy={eyeY - 0.6} r={0.45} fill="#fff" opacity="0.8" />
            <path d={`M${ex - ew - 0.3} ${eyeY + 0.1} Q${ex} ${eyeY - 3} ${ex + ew + 0.3} ${eyeY + 0.1}`} fill="none" stroke="#2a1a12" strokeWidth={f.female ? 1.1 : 0.8} strokeLinecap="round" />
            {f.age > 50 && <path d={`M${ex - ew + 0.5} ${eyeY + 2.3} Q${ex} ${eyeY + 3.4} ${ex + ew - 0.5} ${eyeY + 2.3}`} fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="0.6" />}
            <path d={`M${ex - ew - 0.8} ${eyeY - 3.6 - (smile ? 0 : sd * 0.0)} Q${ex} ${eyeY - (smile ? 5.6 : 4.9)} ${ex + ew + 0.8} ${eyeY - 3.6 + (smile ? 0 : 0.5)}`} fill="none" stroke={brow} strokeWidth={male ? 1.7 + R(31) * 0.7 : 1.1} strokeLinecap="round" />
          </g>
        );
      })}
      {/* nose and mouth */}
      <path d={`M${cx - 0.6} ${eyeY + 1} C${cx - 1.4} ${eyeY + 6} ${cx - 3} ${eyeY + 9} ${cx - 2.6} ${eyeY + 10.5} Q${cx} ${eyeY + 11.8} ${cx + 2.6} ${eyeY + 10.5}`} fill="none" stroke="#5a3424" strokeOpacity="0.55" strokeWidth="0.9" strokeLinecap="round" />
      <path d={`M${cx + 0.8} ${eyeY + 1} C${cx + 1.6} ${eyeY + 5} ${cx + 3} ${eyeY + 8} ${cx + 3} ${eyeY + 9.4}`} fill="none" stroke="#000" strokeOpacity="0.1" strokeWidth="1.6" />
      {facial === 'moustache' || facial === 'beard'
        ? <path d={`M${cx - 6.5} ${eyeY + 15.4} Q${cx - 3} ${eyeY + 12.4} ${cx} ${eyeY + 13.4} Q${cx + 3} ${eyeY + 12.4} ${cx + 6.5} ${eyeY + 15.4} Q${cx} ${eyeY + 14.6} ${cx - 6.5} ${eyeY + 15.4} Z`} fill={hair} />
        : null}
      <path d={smile ? `M${cx - 5} ${eyeY + 16} Q${cx} ${eyeY + 19.4} ${cx + 5} ${eyeY + 16}` : `M${cx - 4.6} ${eyeY + 16.6} Q${cx} ${eyeY + 17.4} ${cx + 4.6} ${eyeY + 16.4}`} fill="none" stroke={lip} strokeWidth={f.female ? 1.6 : 1.1} strokeLinecap="round" />
      {f.age > 55 && <>
        <path d={`M${cx - 6} ${eyeY + 9} Q${cx - 8} ${eyeY + 14} ${cx - 6.5} ${eyeY + 18}`} fill="none" stroke="#000" strokeOpacity="0.13" strokeWidth="0.7" />
        <path d={`M${cx + 6} ${eyeY + 9} Q${cx + 8} ${eyeY + 14} ${cx + 6.5} ${eyeY + 18}`} fill="none" stroke="#000" strokeOpacity="0.13" strokeWidth="0.7" />
        <path d={`M${cx - 7} ${headTop + 9} Q${cx} ${headTop + 7.5} ${cx + 7} ${headTop + 9} M${cx - 6} ${headTop + 11.5} Q${cx} ${headTop + 10} ${cx + 6} ${headTop + 11.5}`} fill="none" stroke="#000" strokeOpacity="0.1" strokeWidth="0.6" />
      </>}
      {/* hair */}
      {front && <path d={front} fill={hair} />}
      {front && <path d={front} fill="#fff" opacity="0.07" transform="translate(-0.8 -0.8)" />}
      {/* glasses */}
      {glasses && <g fill="none" stroke={pick(['#1a1a1a', '#6a5232', '#b8a070'], R(32))} strokeWidth="0.9">
        <rect x={cx - 7.2 - 5} y={eyeY - 3.6} width="10" height="7" rx="2.6" /><rect x={cx + 7.2 - 5} y={eyeY - 3.6} width="10" height="7" rx="2.6" />
        <path d={`M${cx - 2.2} ${eyeY - 0.8} Q${cx} ${eyeY - 2} ${cx + 2.2} ${eyeY - 0.8} M${cx - 12.2} ${eyeY - 1} L${L + 0.5} ${eyeY - 2} M${cx + 12.2} ${eyeY - 1} L${Rr - 0.5} ${eyeY - 2}`} />
      </g>}
      {/* peaked cap */}
      {f.cap && <g>
        <path d={`M${L - 2} ${headTop + 9} C${L - 3} ${headTop - 6} ${Rr + 3} ${headTop - 6} ${Rr + 2} ${headTop + 9} Z`} fill={suit} />
        <path d={`M${L - 2} ${headTop + 9} C${L - 3} ${headTop - 6} ${Rr + 3} ${headTop - 6} ${Rr + 2} ${headTop + 9} Z`} fill={`url(#cl${uid})`} />
        <rect x={L - 1.5} y={headTop + 6} width={Rr - L + 3} height={3.2} fill="#c9a24a" />
        <path d={`M${L - 1} ${headTop + 9.2} Q${cx} ${headTop + 15} ${Rr + 1} ${headTop + 9.2} Q${cx} ${headTop + 12} ${L - 1} ${headTop + 9.2} Z`} fill="#141414" />
        <circle cx={cx} cy={headTop + 2} r={2.6} fill="#d8b04a" />
      </g>}
      {/* vignette */}
      <rect x="12" y="10" width="76" height="80" fill="none" stroke="#000" strokeOpacity="0.3" strokeWidth="5" />
    </svg>
  );
}
export const Portrait = memo(PortraitImpl);
