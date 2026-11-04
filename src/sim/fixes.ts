/**
 * One-click fixes: for each thing the game asks of you (a coalition demand, a pledge, an idle programme) the single
 * action that delivers it, and what that action costs. The UI shows them as "Do it" buttons with the price on them.
 */
import { fmtMoney, fmtNum } from './util';
import { recruit, setBudget, type ActionResult } from './actions';
import { actPassLaw, forecast, lawById } from './domestic';
import { demandDef, type Demand } from './coalition';
import { SECTORS, actExpandSector, expansionOf, ensureIndustry, type SectorId } from './industry';
import { actSetResearch, ensureResearch } from './research';
import type { Budget, Country, GameState } from './types';

export interface DeskFix {
  label: string;
  /** what it costs, in words ("$12B", "15 capital", "+0.4% of GDP a year") */
  price?: string;
  run?: (s: GameState) => ActionResult;
  /** a tab to open instead, when no single action does it */
  tab?: 'economy' | 'military' | 'diplomacy' | 'politics' | 'research' | 'goals' | 'overview';
  /** shown instead of a button when there is nothing to click (a number that must hold) */
  note?: string;
}

const yearly = (c: Country, d: number) => `${d >= 0 ? '+' : '−'}${fmtMoney(Math.abs(d) * c.eco.gdp)} a year`;
const budgetFix = (c: Country, key: keyof Budget, target: number, what: string): DeskFix => ({
  label: `${what} to ${(target * 100).toFixed(1)}% of GDP`,
  price: key.startsWith('tax') ? `${yearly(c, target - c.budget[key])} revenue` : `${yearly(c, target - c.budget[key])} spending`,
  run: (g) => setBudget(g, g.player, key, target + (key.startsWith('tax') ? -1e-6 : 1e-6)),
});

/** The cheapest industry you can expand right now (or the one named). */
export function bestExpansion(s: GameState, c: Country, only?: SectorId): { id: SectorId; cost: number; weeks: number } | null {
  ensureIndustry(c);
  const opts = SECTORS.filter((x) => !only || x.id === only).map((x) => ({ id: x.id, ...expansionOf(s, c, x.id) })).filter((x) => !x.why).sort((a, b) => a.cost - b.cost);
  return opts[0] ?? null;
}
export function expandFix(s: GameState, c: Country, only?: SectorId): DeskFix | null {
  const x = bestExpansion(s, c, only);
  if (!x) return null;
  const sec = SECTORS.find((y) => y.id === x.id)!;
  return { label: `Expand ${sec.name.toLowerCase()}`, price: `${fmtMoney(x.cost)} · ${x.weeks} wk`, run: (g) => actExpandSector(g, x.id) };
}

export function lawFix(c: Country, id: string, short = false): DeskFix | null {
  const law = lawById(id);
  if (!law || !c.politics) return null;
  const f = forecast(c, law, 0);
  return { label: short ? 'Pass the law' : `Pass the ${law.title}`, price: `${f.cost} capital · ${Math.round(f.yes * 100)}% yes`, run: (g) => actPassLaw(g, id) };
}

/** The one action that delivers a coalition demand, or what to watch when it is a number that must hold. */
export function demandFix(s: GameState, c: Country, d: Demand): DeskFix | null {
  const def = demandDef(d.id);
  if (!def) return null;
  if (d.id.startsWith('law:')) return lawFix(c, d.id.slice(4), true);
  switch (d.id) {
    case 'social': return budgetFix(c, 'social', d.target, 'Raise public services');
    case 'infra': return budgetFix(c, 'infra', d.target, 'Raise infrastructure spending');
    case 'defence': return budgetFix(c, 'military', d.target, 'Raise defence spending');
    case 'corp_tax': return budgetFix(c, 'taxCorporate', d.target, 'Cut corporate tax');
    case 'army': {
      const n = Math.max(0, Math.ceil(d.target - c.mil.troops));
      if (n <= 0) return null;
      const cost = n * c.mil.unitCost * c.eco.price * 0.5;
      return { label: `Recruit ${fmtNum(n)} troops`, price: fmtMoney(cost), run: (g) => recruit(g, g.player, n) };
    }
    case 'defres': {
      const rs = ensureResearch(c);
      if (rs.cur === 4) return { label: 'Fund research grants', note: 'Your scientists are already working on defence: crash grants in the Research tab speed it up.', tab: 'research' };
      return { label: 'Point research at defence', price: 'free (pauses the current project)', run: (g) => { const r = actSetResearch(g, 4); return r.ok ? r : { ok: false, message: `${r.message}: open the Research tab` }; } };
    }
    case 'industry': return expandFix(s, c) ?? { label: 'Open industries', tab: 'economy' };
    case 'energy': return expandFix(s, c, 'energy') ?? { label: 'Open research (energy)', tab: 'research' };
    case 'rep': return { label: 'Send aid, sign treaties', tab: 'diplomacy' };
    case 'jobs': return { label: 'Keep it there', note: 'Must hold until the deadline: avoid tax hikes, keep investing, stay out of costly wars.' };
    case 'inflation': return { label: 'Keep it there', note: 'Must hold until the deadline: do not print money, keep the deficit in check.' };
    case 'peace': return { label: 'Keep the peace', note: 'Just start no war until the deadline.' };
  }
  return null;
}
