/**
 * Procedural coats of arms. Every country gets its own heraldic shield, deterministic from its id: a shield
 * shape, a division of the field in its national colour and a heraldic metal, a charge in the centre, and a
 * crest that reflects its government (laurel, crown, star, wings). Pure SVG, no image files.
 */
import { memo, type ReactElement } from 'react';
import { nationalHsl } from '../../map/palette';
import type { Country } from '../../sim/types';

const h = (seed: number, salt: number) => {
  let x = (seed * 374761393 + salt * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
};
const pick = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

const METALS = ['#e2be63', '#ece6d6']; // or, argent
const TINCTURES = ['#9e2b25', '#24477e', '#2d6438', '#1c1915', '#5b376b']; // gules, azure, vert, sable, purpure

const SHIELDS = [
  // heater
  'M8 6 H92 V52 C92 82 70 102 50 114 C30 102 8 82 8 52 Z',
  // French (square, pointed)
  'M8 6 H92 V82 C92 96 76 100 64 104 L50 114 L36 104 C24 100 8 96 8 82 Z',
  // Iberian (round bottom)
  'M8 6 H92 V64 C92 92 72 112 50 112 C28 112 8 92 8 64 Z',
  // Polish / scalloped top
  'M8 10 Q29 0 50 8 Q71 0 92 10 V56 C92 86 70 104 50 114 C30 104 8 86 8 56 Z',
];

function star(cx: number, cy: number, r: number, n = 5) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * 0.42 : r;
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)} `;
  }
  return `${d}Z`;
}
const CHARGES: Record<string, (c: string, o: string) => ReactElement> = {
  star: (c, o) => <path d={star(50, 56, 20)} fill={c} stroke={o} strokeWidth="1.6" strokeLinejoin="round" />,
  sun: (c, o) => (
    <g fill={c} stroke={o} strokeWidth="1.4">
      {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <path key={i} d={`M${50 + 13 * Math.cos(a - 0.16)} ${56 + 13 * Math.sin(a - 0.16)} L${50 + 25 * Math.cos(a)} ${56 + 25 * Math.sin(a)} L${50 + 13 * Math.cos(a + 0.16)} ${56 + 13 * Math.sin(a + 0.16)} Z`} />; })}
      <circle cx="50" cy="56" r="12" />
    </g>
  ),
  crescent: (c, o) => <path d="M60 36 A22 22 0 1 0 60 76 A17 17 0 1 1 60 36 Z" fill={c} stroke={o} strokeWidth="1.6" />,
  tower: (c, o) => <path d="M34 78 V46 H38 V40 H43 V46 H47 V40 H53 V46 H57 V40 H62 V46 H66 V78 Z M46 78 V66 Q50 60 54 66 V78 Z" fill={c} stroke={o} strokeWidth="1.5" fillRule="evenodd" />,
  eagle: (c, o) => (
    <path d="M50 34 C46 34 44 38 45 42 L40 44 C33 36 22 34 14 38 C20 42 24 48 30 52 C24 52 20 56 18 60 C26 60 32 58 38 56 L42 62 L38 76 L46 70 L50 80 L54 70 L62 76 L58 62 L62 56 C68 58 74 60 82 60 C80 56 76 52 70 52 C76 48 80 42 86 38 C78 34 67 36 60 44 L55 42 C56 38 54 34 50 34 Z"
      fill={c} stroke={o} strokeWidth="1.5" strokeLinejoin="round" />
  ),
  crown: (c, o) => <path d="M30 70 L26 42 L39 54 L50 36 L61 54 L74 42 L70 70 Z M30 74 H70 V80 H30 Z" fill={c} stroke={o} strokeWidth="1.6" strokeLinejoin="round" />,
  anchor: (c, o) => <path d="M50 34 a5 5 0 1 1 -0.1 0 M47 42 H53 V48 H60 V52 H53 V76 C60 75 66 70 68 63 L64 64 L70 56 L74 66 L71 64 C68 74 60 80 50 80 C40 80 32 74 29 64 L26 66 L30 56 L36 64 L32 63 C34 70 40 75 47 76 V52 H40 V48 H47 Z" fill={c} stroke={o} strokeWidth="1.3" />,
  key: (c, o) => <path d="M50 30 a10 10 0 1 1 -0.1 0 Z M50 36 a4 4 0 1 0 0.1 0 Z M47 49 H53 V70 H60 V75 H53 V80 H47 Z" fill={c} stroke={o} strokeWidth="1.4" fillRule="evenodd" />,
  mountain: (c, o) => <path d="M22 78 L42 44 L50 56 L60 38 L80 78 Z" fill={c} stroke={o} strokeWidth="1.6" strokeLinejoin="round" />,
};
const CHARGE_KEYS = Object.keys(CHARGES);

function field(kind: number, a: string, b: string) {
  switch (kind) {
    case 0: return null; // plain
    case 1: return <rect x="50" y="0" width="50" height="120" fill={b} />; // per pale
    case 2: return <rect x="0" y="0" width="100" height="44" fill={b} />; // chief
    case 3: return <path d="M0 0 H100 V120 Z" fill={b} />; // per bend
    case 4: return <><rect x="50" y="0" width="50" height="60" fill={b} /><rect x="0" y="60" width="50" height="60" fill={b} /></>; // quarterly
    case 5: return <path d="M0 96 L50 50 L100 96 V82 L50 36 L0 82 Z" fill={b} />; // chevron
    case 6: return <><rect x="0" y="40" width="100" height="16" fill={b} /><rect x="0" y="72" width="100" height="16" fill={b} /></>; // bars
    case 7: return <path d="M0 0 L14 0 L100 106 V120 L86 120 L0 14 Z M86 0 H100 V14 L14 120 H0 V106 Z" fill={b} />; // saltire
    default: return <rect x="0" y="0" width="100" height="120" fill="none" stroke={b} strokeWidth="14" />; // bordure
  }
  void a;
}

function Crest({ gov, metal }: { gov: string; metal: string }) {
  if (gov === 'M') return <path d="M34 4 L31 -12 L41 -4 L50 -16 L59 -4 L69 -12 L66 4 Z" fill={metal} stroke="#2a1d08" strokeWidth="1.2" strokeLinejoin="round" />;
  if (gov === 'C') return <path d={star(50, -7, 9)} fill="#c8302a" stroke="#f0d27a" strokeWidth="1.2" />;
  if (gov === 'A') return <path d="M50 -2 C44 -10 32 -14 20 -10 C28 -7 34 -4 38 1 Z M50 -2 C56 -10 68 -14 80 -10 C72 -7 66 -4 62 1 Z" fill={metal} stroke="#2a1d08" strokeWidth="1" />;
  // democracies and hybrids: a laurel
  return (
    <g fill="#6d8a4a" stroke="#2a3418" strokeWidth="0.8">
      {Array.from({ length: 5 }, (_, i) => <ellipse key={`l${i}`} cx={34 - i * 3} cy={0 - i * 2.2} rx="4.4" ry="1.8" transform={`rotate(${-30 - i * 8} ${34 - i * 3} ${0 - i * 2.2})`} />)}
      {Array.from({ length: 5 }, (_, i) => <ellipse key={`r${i}`} cx={66 + i * 3} cy={0 - i * 2.2} rx="4.4" ry="1.8" transform={`rotate(${30 + i * 8} ${66 + i * 3} ${0 - i * 2.2})`} />)}
    </g>
  );
}

/** A country's coat of arms. `size` is the rendered height in px. */
export const Emblem = memo(function Emblem({ c, size = 56, crest = true }: { c: Pick<Country, 'id' | 'name' | 'color' | 'gov'>; size?: number; crest?: boolean }) {
  const [hh, ss, ll] = nationalHsl(c);
  const primary = `hsl(${hh},${Math.min(70, ss + 6)}%,${Math.max(26, Math.min(46, ll - 6))}%)`;
  const r = (k: number) => h(c.id + 1, k);
  const metal = pick(METALS, r(1));
  const tinct = pick(TINCTURES, r(2));
  // heraldry: a metal next to a colour; a light national colour gets a dark tincture instead
  const second = ll > 62 ? tinct : metal;
  const shape = pick(SHIELDS, r(3));
  const div = Math.floor(r(4) * 9);
  const charge = CHARGES[pick(CHARGE_KEYS, r(5))];
  const chargeFill = div === 0 || div === 2 || div === 8 ? second : r(6) > 0.5 ? second : primary;
  const outline = '#1b1206';
  const uid = `em${c.id}`;
  const vb = crest ? '-6 -22 112 140' : '-6 -4 112 122';
  return (
    <svg className="emblem" width={(size * (crest ? 112 : 112)) / (crest ? 140 : 122)} height={size} viewBox={vb} aria-hidden="true">
      <defs>
        <clipPath id={`${uid}c`}><path d={shape} /></clipPath>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dc93" />
          <stop offset="0.5" stopColor="#b8862f" />
          <stop offset="1" stopColor="#6d4a14" />
        </linearGradient>
      </defs>
      {crest && <Crest gov={c.gov} metal={metal === '#ece6d6' ? '#e2be63' : metal} />}
      <g clipPath={`url(#${uid}c)`}>
        <rect x="0" y="0" width="100" height="120" fill={primary} />
        {field(div, primary, second)}
        {charge(chargeFill === primary ? second : chargeFill, outline)}
        <rect x="0" y="0" width="100" height="120" fill={`url(#${uid}g)`} />
      </g>
      <path d={shape} fill="none" stroke={`url(#${uid}b)`} strokeWidth="5" />
      <path d={shape} fill="none" stroke={outline} strokeWidth="1.2" />
    </svg>
  );
});
