/**
 * One source of truth for government money. Every screen and every adviser that talks about the budget reads
 * `budgetReport`, so "revenue", "spending", "balance" (surplus or deficit), "treasury" (cash in hand) and "debt"
 * always mean the same thing and always agree with the Economy tab.
 *
 * - revenue / spending / balance are ANNUAL rates at the current policy settings ($ per year).
 * - cash is the money in the treasury right now (a stock, $).
 * - debt is the stock of government bonds ($); interest on it is part of spending.
 * - one-off costs (projects, recruitment, decisions) are paid from cash; whatever cash cannot cover is borrowed
 *   and added to debt. `fundingPreview` shows that split before you commit.
 * - when the treasury is empty, an annual deficit is covered by borrowing week by week. The ledger records it.
 */
import { fiscalNow } from './economy';
import { fmtMoney } from './util';
import type { Country, GameState, LedgerEntry } from './types';

/** Debt above this multiple of GDP and creditors stop lending. */
export const DEBT_CEILING = 2.5;

export interface BudgetReport {
  cash: number;
  revenue: number;
  spending: number;
  /** spending split: public services (social, education, infrastructure, industry, intelligence), defence, interest */
  services: number; defence: number; interest: number;
  /** revenue − spending, $ per year: positive = surplus, negative = deficit */
  balance: number; balancePct: number;
  debt: number; debtPct: number; rate: number;
  /** weeks until the treasury is empty at the current deficit (Infinity with a surplus) */
  weeksOfCash: number;
  /** last 52 weeks: borrowing that covered the deficit automatically, and one-off costs/income (net) */
  autoBorrowedYear: number; oneOffYear: number; oneOffBorrowedYear: number;
}

export function budgetReport(s: GameState, c: Country): BudgetReport {
  const e = c.eco, b = c.budget;
  const f = fiscalNow(c, s);
  const interest = e.debt * e.avgRate;
  const defence = b.military * e.gdp;
  const services = f.spending - interest - defence;
  const yr = (e.ledger ?? []).filter((x) => s.tick - x.t < 52);
  const auto = yr.filter((x) => x.what === DEFICIT_LABEL).reduce((t, x) => t + x.borrowed, 0);
  const one = yr.filter((x) => x.what !== DEFICIT_LABEL);
  return {
    cash: e.cash, revenue: f.revenue, spending: f.spending, services, defence, interest,
    balance: f.balance, balancePct: f.balance / Math.max(1, e.gdp),
    debt: e.debt, debtPct: e.debt / Math.max(1, e.gdp), rate: e.avgRate,
    weeksOfCash: f.balance >= 0 ? Infinity : e.cash / (-f.balance / 52),
    autoBorrowedYear: auto, oneOffYear: one.reduce((t, x) => t + x.amount, 0), oneOffBorrowedYear: one.reduce((t, x) => t + x.borrowed, 0),
  };
}

/** "a surplus of $12B a year" / "a deficit of $128B a year" — never confuses the two. */
export function balanceText(balance: number) {
  return balance >= 0 ? `a surplus of ${fmtMoney(balance)} a year` : `a deficit of ${fmtMoney(-balance)} a year`;
}

export interface FundingPreview { cost: number; fromCash: number; borrowed: number; debtPct: number; debtPctAfter: number; refused: boolean }
/** How a one-off cost would be paid: from the treasury first, the rest borrowed. */
export function fundingPreview(c: Country, cost: number): FundingPreview {
  const e = c.eco;
  const fromCash = Math.max(0, Math.min(cost, e.cash));
  const borrowed = Math.max(0, cost - fromCash);
  const debtPct = e.debt / Math.max(1, e.gdp), debtPctAfter = (e.debt + borrowed) / Math.max(1, e.gdp);
  return { cost, fromCash, borrowed, debtPct, debtPctAfter, refused: borrowed > 0 && debtPctAfter > DEBT_CEILING };
}
/** One line for a button or tooltip: where the money for this will come from. */
export function fundingText(c: Country, cost: number) {
  const p = fundingPreview(c, cost);
  if (p.refused) return `${fmtMoney(cost)} — creditors refuse to lend more (debt would pass ${DEBT_CEILING * 100}% of GDP)`;
  if (!p.borrowed) return `${fmtMoney(cost)} from the treasury`;
  const debt = `debt ${(p.debtPct * 100).toFixed(0)}% → ${(p.debtPctAfter * 100).toFixed(p.debtPctAfter - p.debtPct < 0.005 ? 1 : 0)}% of GDP`;
  return p.fromCash > 0 ? `${fmtMoney(p.fromCash)} from the treasury + ${fmtMoney(p.borrowed)} borrowed (${debt})` : `all ${fmtMoney(cost)} borrowed — the treasury is empty (${debt})`;
}

// ---- ledger ----
export const DEFICIT_LABEL = 'Deficit covered by borrowing';
let purpose: { what: string; borrowed: number } | null = null;

/** Run `fn` as one ledger entry named `what` (a decision, say): every cost, gain and loan inside it is netted. */
export function asPurchase<T>(s: GameState, c: Country, what: string, fn: () => T): T {
  if (!c.isPlayer || purpose) return fn();
  const before = c.eco.cash - c.eco.debt;
  purpose = { what, borrowed: 0 };
  try { return fn(); } finally {
    const p = purpose; purpose = null;
    const net = c.eco.cash - c.eco.debt - before;
    if (Math.abs(net) > 1e-6 * c.eco.gdp || p.borrowed > 0) record(s, c, what, net, p.borrowed);
  }
}

/** Record a one-off cost (amount < 0) or income (amount > 0). Inside `asPurchase`, it is folded into that entry. */
export function record(s: GameState, c: Country, what: string, amount: number, borrowed: number) {
  if (!c.isPlayer) return;
  if (purpose && what !== DEFICIT_LABEL) { purpose.borrowed += borrowed; return; }
  const L = (c.eco.ledger ??= []);
  // repeated items (weekly programme payments, automatic deficit borrowing) are merged into one line per quarter
  const same = L.slice(-6).reverse().find((x) => x.what === what && Math.floor(x.t / 13) === Math.floor(s.tick / 13));
  if (same) { same.amount += amount; same.borrowed += borrowed; return; }
  L.push({ t: s.tick, what, amount, borrowed } satisfies LedgerEntry);
  if (L.length > 40) L.splice(0, L.length - 40);
}
