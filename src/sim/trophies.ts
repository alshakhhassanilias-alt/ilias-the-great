/** Trophies and the end-of-year review: small, frequent rewards that make time passing feel like progress. */
import type { Geo } from './geo';
import { logEvent } from './log';
import { alliesOf } from './relations';
import { strengthIndex } from './military';
import { hasDone, PROJECTS, doneKey } from './projects';
import type { Country, GameState } from './types';

export interface Trophy { id: string; icon: string; title: string; desc: string; check: (s: GameState, c: Country, ctx: Ctx) => boolean }
interface Ctx { gdpRank: number; milRank: number; worldGdp: number }

export const TROPHIES: Trophy[] = [
  { id: 'first_conquest', icon: '🏴', title: 'First conquest', desc: 'Capture land from another country.', check: (s, c) => c.provinces.length > c.baseline.provinces && s.tick > 4 },
  { id: 'empire', icon: '👑', title: 'Empire', desc: 'Double the number of regions you started with.', check: (_s, c) => c.provinces.length >= c.baseline.provinces * 2 && c.baseline.provinces >= 2 },
  { id: 'annexer', icon: '☠', title: 'Wiped off the map', desc: 'Annex a whole country.', check: (s, c) => (s.stats[`conq:${c.id}`] ?? 0) > 0 },
  { id: 'top10', icon: '📈', title: 'Top ten economy', desc: 'Reach the ten largest economies.', check: (_s, _c, x) => x.gdpRank <= 10 },
  { id: 'top3', icon: '🥉', title: 'Economic giant', desc: 'Reach the top three economies.', check: (_s, _c, x) => x.gdpRank <= 3 },
  { id: 'number1', icon: '🥇', title: 'World number one', desc: 'Become the largest economy on Earth.', check: (_s, _c, x) => x.gdpRank === 1 },
  { id: 'trillion', icon: '💰', title: 'Trillion-dollar club', desc: 'Reach $1 trillion GDP.', check: (_s, c) => c.eco.gdp >= 1e12 },
  { id: 'debtfree', icon: '🧾', title: 'Clean books', desc: 'Get public debt below 10% of GDP after the first year.', check: (s, c) => s.tick > 52 && c.eco.debt < 0.1 * c.eco.gdp },
  { id: 'nuclear', icon: '☢', title: 'Nuclear club', desc: 'Become a nuclear power.', check: (s, c) => c.mil.nuclear && s.stats[`nuke0:${c.id}`] === 0 },
  { id: 'spacepower', icon: '🚀', title: 'Space pioneer', desc: 'Complete the Space Programme.', check: (s, c) => hasDone(s, c.id, 'space') },
  { id: 'builder', icon: '🏗', title: 'Master builder', desc: 'Complete three megaprojects.', check: (s, c) => PROJECTS.filter((p) => (s.stats[doneKey(c.id, p.id)] ?? 0) > 0).length >= 3 },
  { id: 'network', icon: '🕸', title: 'Network of friends', desc: 'Have ten allies.', check: (s, c) => alliesOf(s, c.id).length >= 10 },
  { id: 'strongest', icon: '🛡', title: 'Mightiest army', desc: 'Have the strongest military in the world.', check: (_s, _c, x) => x.milRank === 1 },
  { id: 'decade', icon: '⏳', title: 'A decade in power', desc: 'Rule for ten years.', check: (s) => s.tick >= 520 },
  { id: 'quarter', icon: '🏛', title: 'A generation', desc: 'Rule for twenty-five years.', check: (s) => s.tick >= 1300 },
  { id: 'giant', icon: '🌆', title: 'Hundred million', desc: 'Govern a hundred million people.', check: (_s, c) => c.eco.pop >= 1e8 },
  { id: 'survivor', icon: '🔥', title: 'Survivor', desc: 'Be at war for a full year and come through with a stable country.', check: (s, c) => s.stats.lastWar !== undefined && s.wars.some((w) => (w.attackers.includes(c.id) || w.defenders.includes(c.id)) && s.tick - w.start >= 52) && c.eco.stability > 45 },
  { id: 'victors_peace', icon: '💰', title: "Victor's peace", desc: 'Make a defeated enemy pay reparations.', check: (s, c) => !!s.peaceDeals?.some((d) => d.kind === 'rep' && d.a === c.id) },
  { id: 'integrated', icon: '🤝', title: 'Hearts and minds', desc: 'Fully integrate a region you conquered.', check: (s, c) => c.provinces.some((p) => s.core[p] !== c.id && s.integ[p] >= 1) },
  { id: 'problem_solved', icon: '🧩', title: 'Problem solved', desc: 'Overcome one of your national challenges.', check: (_s, c) => Object.values(c.chal ?? {}).some((x) => x.sev <= 0.5) },
  { id: 'economic_war', icon: '🧱', title: 'Economic warfare', desc: 'Put an export ban on a rival.', check: (s, c) => !!s.bans?.some((b) => b.from === c.id) },
  { id: 'blockade', icon: '⚓', title: 'Rule the waves', desc: 'Blockade an enemy\'s ports.', check: (_s, c) => !!c.mil.camps?.some((x) => x.kind === 'blockade') },
  { id: 'reconciled', icon: '🕊', title: 'No enemy is forever', desc: 'Sign a treaty of friendship with a former rival.', check: (s) => Object.values(s.nego ?? {}).some((n) => n.track?.stage === 5) },
  { id: 'liberator', icon: '✊', title: 'Liberator', desc: 'See a conquered country reborn.', check: (s) => s.log.some((e) => /INDEPENDENCE/.test(e.text)) },
];

export function stepTrophies(s: GameState, _geo: Geo) {
  if (s.tick % 4 !== 2) return;
  const c = s.countries[s.player];
  if (!c.alive) return;
  const alive = s.countries.filter((x) => x.alive);
  const ctx: Ctx = {
    gdpRank: alive.filter((x) => x.eco.gdp > c.eco.gdp).length + 1,
    milRank: alive.filter((x) => strengthIndex(x) > strengthIndex(c)).length + 1,
    worldGdp: alive.reduce((t, x) => t + x.eco.gdp, 0),
  };
  if (s.stats[`nuke0:${c.id}`] === undefined) s.stats[`nuke0:${c.id}`] = c.mil.nuclear ? 1 : 0; // already nuclear at the start does not count
  for (const t of TROPHIES) {
    if (s.trophies[t.id] !== undefined) continue;
    if (t.check(s, c, ctx)) {
      if (s.tick <= 6) { s.trophies[t.id] = -1; continue; } // already true at the start: marked, no fanfare
      s.trophies[t.id] = s.tick;
      logEvent(s, `🏆 TROPHY UNLOCKED: ${t.title}. ${t.desc}`, 'info', [s.player], true, { big: true });
    }
  }
}

/** Once a year: a short summary of how the year went. */
export function stepReview(s: GameState, _geo: Geo) {
  if (s.tick === 0 || s.tick % 52 !== 0) return;
  const c = s.countries[s.player];
  if (!c.alive) return;
  const alive = s.countries.filter((x) => x.alive);
  const rank = alive.filter((x) => x.eco.gdp > c.eco.gdp).length + 1;
  const hist = c.hist.gdp, g0 = hist[Math.max(0, hist.length - 14)] ?? c.eco.gdp;
  const lines: string[] = [];
  lines.push(`Economy: ${(100 * (c.eco.gdp / g0 - 1)).toFixed(1)}% nominal growth, rank #${rank} of ${alive.length}.`);
  const terr = c.provinces.length - c.baseline.provinces;
  lines.push(terr === 0 ? 'Territory unchanged.' : `Territory: ${terr > 0 ? '+' : ''}${terr} regions compared with the start.`);
  lines.push(`At home: stability ${c.eco.stability.toFixed(0)}, inflation ${(100 * c.eco.inflation).toFixed(1)}%, debt ${(100 * c.eco.debt / c.eco.gdp).toFixed(0)}% of GDP.`);
  const headlines = s.log.filter((e) => e.big && e.tick > s.tick - 52 && !/TROPHY/.test(e.text)).slice(-3);
  for (const h of headlines) lines.push(`${h.text}`);
  const year = 2024 + Math.floor(s.tick / 52) - 1;
  s.review = { tick: s.tick, title: `${year} in review`, lines };
}
