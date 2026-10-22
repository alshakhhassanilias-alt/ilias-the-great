export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Money is shown in the dollars of the game's first year: over centuries prices rise many times over, and
 * "$17 million trillion" says nothing. The simulation keeps working in the money of the day; only display divides
 * by the world's price level (set every week by the economy, see stepEconomiesGen).
 */
let PRICE_LEVEL = 1;
export function setPriceLevel(p: number) { PRICE_LEVEL = Number.isFinite(p) && p > 0 ? p : 1; }
export function fmtMoney(v: number, digits = 1): string {
  v /= PRICE_LEVEL;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e18) return `${s}$${(a / 1e18).toFixed(digits)} quintillion`;
  if (a >= 1e15) return `${s}$${(a / 1e15).toFixed(digits)} quadrillion`;
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
export function fmtNum(v: number, digits = 1): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e8 ? 0 : digits)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(a >= 1e5 ? 0 : digits)}K`;
  return `${s}${a.toFixed(0)}`;
}
export const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

const SHORT: Record<string, string> = {
  'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'C. African Rep.',
  'Bosnia and Herz.': 'Bosnia & Herz.', 'United Arab Emirates': 'UAE', Macedonia: 'N. Macedonia', 'St. Vin. and Gren.': 'St Vincent',
  'St. Kitts and Nevis': 'St Kitts & Nevis', 'Antigua and Barb.': 'Antigua & Barb.', 'São Tomé and Principe': 'São Tomé',
  'Trinidad and Tobago': 'Trinidad & Tobago', 'Papua New Guinea': 'Papua N. Guinea', 'Solomon Is.': 'Solomon Is.', 'Marshall Is.': 'Marshall Is.',
};
export const shortName = (n: string) => SHORT[n] ?? n;
/** The name a country's national data is filed under: its original name, even after the country is renamed. */
export const keyOf = (c: { key?: string; name: string }) => c.key ?? c.name;

/** Lower-case the first letter for use mid-sentence, leaving acronyms (LNG, BRICS) alone. */
export const lowerFirst = (t: string) => (/^[A-Z][A-Z]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
/** A grievance recorded as "imposed sanctions on it", told by the victim ("on us") or about them ("on them"). */
export const grievance = (why: string, voice: 'us' | 'them') => why.replace(/\bits\b/g, voice === 'us' ? 'our' : 'their').replace(/\bit\b/g, voice);
