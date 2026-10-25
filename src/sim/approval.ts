import { clamp } from './util';
import type { Country, GameState } from './types';

/**
 * The public's approval of the government (0-100), built from parts the player can see and act on.
 *
 * Voters judge a government against what is normal for their country: 1% growth is a good year in Japan and a bad one
 * in India, so growth counts against the country's own trend, and a world recession is partly forgiven. A government
 * that keeps things stable, prices calm and jobs plentiful sits a little above 50% and usually wins re-election; one
 * that delivers on its promises or a boom does better; wars, inflation, scandals and long years in power cost it.
 */
export interface ApprovalPart { key: string; label: string; v: number }
export function approvalParts(s: GameState, c: Country): ApprovalPart[] {
  const e = c.eco;
  const trend = Number.isFinite(e.baseGrowth) ? clamp(e.baseGrowth, -0.01, 0.07) : 0.02;
  const worldSlump = s.crisis && /recession|crash|depression|pandemic/.test(s.crisis.id) ? 0.5 : 1;
  const gGap = (e.growth - trend) * (e.growth < trend ? worldSlump : 1);
  const parts: ApprovalPart[] = [
    { key: 'base', label: 'Starting goodwill', v: 50 },
    { key: 'stability', label: 'Order and stability', v: clamp(0.35 * (e.stability - 60), -14, 10) },
    { key: 'growth', label: 'Growth against the country’s normal', v: clamp(300 * gGap, -12, 10) },
    { key: 'prices', label: 'Prices', v: -clamp(250 * Math.max(0, e.inflation - 0.04), 0, 20) },
    { key: 'jobs', label: 'Jobs', v: -clamp(120 * Math.max(0, e.unemployment - e.uNat - 0.015), 0, 15) },
    { key: 'war', label: 'War weariness', v: -clamp(20 * c.mil.exhaustion, 0, 20) },
    { key: 'factions', label: 'The factions (Politics tab)', v: clamp(c.politics?.appr ?? 0, -15, 12) },
  ];
  // a government without a majority looks weak
  const G = c.politics?.gov;
  if (G && (c.gov === 'D' || c.gov === 'F') && (c.politics?.factions ?? []).filter((f) => G.partners.includes(f.id)).reduce((t, f) => t + f.support, 0) < 50) parts.push({ key: 'minority', label: 'Minority government', v: -3 });
  if (c.id === s.player) {
    const L = s.legacy;
    // the wear of power: about a point a year in office, never more than eight
    let wear = L && L.status === 'office' ? Math.min(8, 1.5 * (L.term - 1) + 0.6 * ((s.tick - L.termStart) / 52)) : Math.min(6, 0.6 * (s.tick / 52));
    if (c.politics?.laws.some((l) => l.id === 'term_limits')) wear *= 0.67;
    parts.push({ key: 'wear', label: 'Years in power', v: -wear });
    const extra = s.stats.apprBoost ?? 0; // campaigns, scandals and rallies (fades)
    if (Math.abs(extra) > 0.05) parts.push({ key: 'campaign', label: 'Campaigns, rallies and scandals', v: extra });
  }
  return parts;
}
export function approval(s: GameState, c: Country): number {
  let t = 0;
  for (const p of approvalParts(s, c)) t += p.v;
  return clamp(t, 5, 95);
}
