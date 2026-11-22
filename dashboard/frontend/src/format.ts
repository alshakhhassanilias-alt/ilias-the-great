export const DASH = "—";

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function toNum(v: unknown): number | null {
  if (isNum(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const moneyFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money with 2 decimals and thousands separators, e.g. "$12,345.67" / "-$12.00". */
export function fmtMoney(v: unknown, opts: { sign?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return DASH;
  const s = moneyFmt.format(Math.abs(n));
  const sign = n < 0 ? "-" : opts.sign && n > 0 ? "+" : "";
  return `${sign}$${s}`;
}

/** Plain number with fixed decimals and separators. */
export function fmtNum(v: unknown, decimals = 2): string {
  const n = toNum(v);
  if (n === null) return DASH;
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Price: adaptive precision for small-priced assets. */
export function fmtPrice(v: unknown): string {
  const n = toNum(v);
  if (n === null) return DASH;
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d });
}

export function fmtQty(v: unknown): string {
  const n = toNum(v);
  if (n === null) return DASH;
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Fraction -> percent with 2 decimals (0.0123 -> "1.23%"). */
export function fmtPct(v: unknown, opts: { sign?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return DASH;
  const p = n * 100;
  const sign = opts.sign && p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

export function fmtInt(v: unknown): string {
  const n = toNum(v);
  if (n === null) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtTime(v: unknown): string {
  if (typeof v !== "string" || !v) return DASH;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function fmtAge(seconds: unknown): string {
  const n = toNum(seconds);
  if (n === null) return DASH;
  if (n < 120) return `${n.toFixed(1)} s`;
  if (n < 7200) return `${(n / 60).toFixed(1)} min`;
  return `${(n / 3600).toFixed(1)} h`;
}

export function pnlClass(v: unknown): string {
  const n = toNum(v);
  if (n === null || n === 0) return "";
  return n > 0 ? "pos" : "neg";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
