/**
 * National megaprojects: big, multi-year programmes that you fund week by week and that pay off with a
 * spectacular, visible result (a space station, a nuclear deterrent, a fortress belt ...).
 * The AI runs them too, so the news fills with other nations' achievements.
 */
import { addRec } from './minds';
import type { Geo } from './geo';
import { clamp, fmtMoney } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, getRelation } from './relations';
import { fund } from './actions';
import { levelOf, recount, setLevel } from './buildings';
import { isMajor } from './drama';
import type { Country, GameState, ProjectRun } from './types';

export interface ProjectDef {
  id: string; icon: string; title: string; blurb: string; perk: string;
  /** total cost as a share of GDP at the start, spread over `weeks` */
  pct: number; weeks: number;
  req?: (s: GameState, c: Country) => string | null;
  finish: (s: GameState, c: Country, geo: Geo) => string;
  /** headline when an AI finishes it (and a banner for the player's own) */
  headline: (c: Country) => string;
  big?: boolean;
}

const needTech = (n: number) => (_s: GameState, c: Country) => (c.eco.tech < n ? `Needs technology level ${n} (you have ${c.eco.tech.toFixed(0)})` : null);

export const PROJECTS: ProjectDef[] = [
  {
    id: 'space', icon: '🚀', title: 'Space Programme', pct: 0.028, weeks: 104, big: true,
    blurb: 'Rockets, satellites and a national space agency.',
    perk: 'Technology +5 · military tech +4 · intelligence +10% · reputation +6 · stability +3',
    req: needTech(35),
    finish: (_s, c) => { c.eco.tech = clamp(c.eco.tech + 5, 0, 100); c.mil.milTech += 4; c.mil.intel = clamp(c.mil.intel + 0.1, 0, 1); c.reputation = clamp(c.reputation + 6, 0, 100); c.eco.stability = clamp(c.eco.stability + 3, 0, 100); return 'Your first satellite constellation is in orbit. The nation watches the launch live.'; },
    headline: (c) => `🚀 ${c.name} launches its national space station programme into orbit`,
  },
  {
    id: 'nuclear', icon: '☢', title: 'Nuclear Deterrent', pct: 0.04, weeks: 130, big: true,
    blurb: 'Build the bomb. Nobody will dare to invade you, but the world will not forgive you quickly.',
    perk: 'Becomes a nuclear power (enemy offensives against you slow sharply) · reputation −12 · neighbours furious',
    req: (s, c) => (c.mil.nuclear ? 'You already have nuclear weapons' : c.eco.tech < 30 ? `Needs technology level 30 (you have ${c.eco.tech.toFixed(0)})` : null),
    finish: (s, c) => {
      c.mil.nuclear = true; c.reputation = clamp(c.reputation - 12, 0, 100); addRec(s, c.id, 'nuke', 1);
      for (const o of s.countries) if (o.alive && o.id !== c.id) addRelation(s, c.id, o.id, getRelation(s, c.id, o.id) < 20 ? -9 : -4);
      return 'The first test detonation shakes the desert. You are now a nuclear power.';
    },
    headline: (c) => `☢ ${c.name} announces it has successfully tested a nuclear weapon. The world reacts with alarm`,
  },
  {
    id: 'fortress', icon: '🏰', title: 'Fortress Belt', pct: 0.018, weeks: 52,
    blurb: 'Concrete, minefields and bunkers along every border region.',
    perk: 'Every border region gets +1 fortress level (max 3)',
    finish: (s, c, geo) => {
      let n = 0;
      for (const p of c.provinces) if (geo.adj[p].some((q) => s.owner[q] !== c.id)) { const lv = levelOf(s, p, 'fort'); if (lv < 3) { setLevel(s, p, 'fort', lv + 1); n++; } }
      recount(s, [c.id]);
      return `${n} border regions were fortified.`;
    },
    headline: (c) => `🏰 ${c.name} completes a vast fortification line along its borders`,
  },
  {
    id: 'cyber', icon: '🛰', title: 'Cyber Command', pct: 0.012, weeks: 52,
    blurb: 'Elite hackers and signals intelligence.',
    perk: 'Intelligence +15% (covert operations succeed far more often) · military tech +3',
    finish: (_s, c) => { c.mil.intel = clamp(c.mil.intel + 0.15, 0, 1); c.mil.milTech += 3; return 'Your cyber units are operational. Your spies see much more.'; },
    headline: (c) => `🛰 ${c.name} unveils a new cyber warfare command`,
  },
  {
    id: 'grid', icon: '⚡', title: 'National Power Grid', pct: 0.03, weeks: 104,
    blurb: 'Nuclear, wind and a modern smart grid.',
    perk: 'Energy output +12% · infrastructure +4 · stability +2',
    finish: (_s, c) => { c.eco.energyCap *= 1.12; c.eco.infra = clamp(c.eco.infra + 4, 5, 100); c.eco.stability = clamp(c.eco.stability + 2, 0, 100); return 'The new grid is switched on. Blackouts become a thing of the past.'; },
    headline: (c) => `⚡ ${c.name} inaugurates a giant new power grid`,
  },
  {
    id: 'rail', icon: '🚄', title: 'High-Speed Rail & Ports', pct: 0.03, weeks: 104,
    blurb: 'Bullet trains, deep-water ports and logistics hubs.',
    perk: 'Infrastructure +12 · productivity +1% · stability +2',
    finish: (_s, c) => { c.eco.infra = clamp(c.eco.infra + 12, 5, 100); c.eco.tfp *= 1.01; c.eco.stability = clamp(c.eco.stability + 2, 0, 100); return 'The first bullet train glides out of the capital.'; },
    headline: (c) => `🚄 ${c.name} opens its high-speed rail network`,
  },
  {
    id: 'ai', icon: '🧠', title: 'National AI Initiative', pct: 0.02, weeks: 78, big: true,
    blurb: 'Supercomputers, talent visas and a state AI lab.',
    perk: 'Productivity +2.5% · technology +5',
    req: needTech(40),
    finish: (_s, c) => { c.eco.tfp *= 1.025; c.eco.tech = clamp(c.eco.tech + 5, 0, 100); return 'Your AI lab ships its first national model. Industry is thrilled.'; },
    headline: (c) => `🧠 ${c.name} unveils a state-backed artificial intelligence lab`,
  },
  {
    id: 'carriers', icon: '🚢', title: 'Carrier Fleet', pct: 0.032, weeks: 104, big: true,
    blurb: 'A blue-water navy that can project power across oceans.',
    perk: 'Naval equipment +3% of GDP · military tech +2 · reputation +2',
    req: needTech(30),
    finish: (_s, c) => { c.mil.equipNavy += 0.03 * c.eco.gdp; c.mil.milTech += 2; c.reputation = clamp(c.reputation + 2, 0, 100); return 'Your first aircraft carrier leaves dry dock under a hail of fireworks.'; },
    headline: (c) => `🚢 ${c.name} commissions its first aircraft carrier`,
  },
  {
    id: 'education', icon: '🎓', title: 'Education Reform', pct: 0.015, weeks: 78,
    blurb: 'New universities and technical schools.',
    perk: 'Technology +4 · productivity +1.2% · stability +2',
    finish: (_s, c) => { c.eco.tech = clamp(c.eco.tech + 4, 0, 100); c.eco.tfp *= 1.012; c.eco.stability = clamp(c.eco.stability + 2, 0, 100); return 'The first graduates of the new schools enter the workforce.'; },
    headline: (c) => `🎓 ${c.name} completes a sweeping education reform`,
  },
  {
    id: 'agri', icon: '🌾', title: 'Green Revolution', pct: 0.015, weeks: 52,
    blurb: 'Irrigation, fertiliser and modern seed.',
    perk: 'Food output +10% · stability +2',
    finish: (_s, c) => { c.eco.foodCap *= 1.1; c.eco.stability = clamp(c.eco.stability + 2, 0, 100); return 'Record harvests fill the granaries.'; },
    headline: (c) => `🌾 ${c.name} announces record harvests after a farming revolution`,
  },
];

export const projectById = (id: string) => PROJECTS.find((p) => p.id === id)!;
export const MAX_ACTIVE = 2;
export const runsOf = (s: GameState, cid: number) => s.projects.filter((p) => p.owner === cid);
export const doneKey = (cid: number, id: string) => `proj:${cid}:${id}`;
export const hasDone = (s: GameState, cid: number, id: string) => (s.stats[doneKey(cid, id)] ?? 0) > 0;

export function canStart(s: GameState, cid: number, id: string): string | null {
  const c = s.countries[cid], d = projectById(id);
  if (!c.alive) return 'Country no longer exists';
  if (runsOf(s, cid).some((p) => p.id === id)) return 'Already under way';
  if (hasDone(s, cid, id) && id !== 'fortress') return 'Already completed';
  if (runsOf(s, cid).length >= MAX_ACTIVE) return `You can run at most ${MAX_ACTIVE} projects at once`;
  return d.req?.(s, c) ?? null;
}

export function startProject(s: GameState, cid: number, id: string): { ok: boolean; message: string } {
  const why = canStart(s, cid, id);
  if (why) return { ok: false, message: why };
  const c = s.countries[cid], d = projectById(id);
  const run: ProjectRun = { uid: s.nextProject++, id, owner: cid, cost: d.pct * c.eco.gdp, weeks: d.weeks, done: 0, start: s.tick, stalled: false };
  s.projects.push(run);
  if (cid === s.player) logEvent(s, `${d.icon} ${d.title} launched: ${fmtMoney(run.cost)} over ${Math.round(d.weeks / 52 * 10) / 10} years.`, 'econ', [cid]);
  return { ok: true, message: `${d.title} has begun. It is funded automatically each week (${fmtMoney(run.cost / d.weeks)}/week).` };
}

export function cancelProject(s: GameState, cid: number, uid: number): { ok: boolean; message: string } {
  const r = s.projects.find((p) => p.uid === uid && p.owner === cid);
  if (!r) return { ok: false, message: 'No such project' };
  s.projects = s.projects.filter((p) => p !== r);
  return { ok: true, message: `${projectById(r.id).title} cancelled. The ${fmtMoney((r.done / r.weeks) * r.cost)} already spent is lost.` };
}

/** One week of funding and progress for every programme; AI countries start new ones now and then. */
export function stepProjects(s: GameState, geo: Geo) {
  for (const r of [...s.projects]) {
    const c = s.countries[r.owner];
    if (!c.alive) { s.projects = s.projects.filter((p) => p !== r); continue; }
    const weekly = r.cost / r.weeks;
    const isPlayer = r.owner === s.player;
    let paid = false;
    if (isPlayer) paid = fund(s, r.owner, weekly, projectById(r.id).title).ok;
    else if (c.eco.cash >= weekly * 2) { c.eco.cash -= weekly; paid = true; }
    if (!paid) {
      if (!r.stalled && isPlayer) logEvent(s, `${projectById(r.id).icon} ${projectById(r.id).title} is stalled: the treasury cannot pay.`, 'danger', [r.owner]);
      r.stalled = true;
      continue;
    }
    r.stalled = false;
    r.done++;
    if (r.done >= r.weeks) {
      const d = projectById(r.id);
      s.projects = s.projects.filter((p) => p !== r);
      s.stats[doneKey(r.owner, r.id)] = (s.stats[doneKey(r.owner, r.id)] ?? 0) + 1;
      const msg = d.finish(s, c, geo);
      if (isPlayer) logEvent(s, `${d.icon} ${d.title} complete! ${msg}`, 'econ', [r.owner], true, { big: true, prov: c.capital });
      else logEvent(s, `${d.headline(c)}.`, 'econ', [r.owner], false, d.big && isMajor(s, r.owner) ? { big: true, prov: c.capital } : undefined);
    }
  }
  // AI countries start programmes now and then
  if (s.tick % 6 === 3 && s.tick > 20) {
    for (const c of s.countries) {
      if (!c.alive || c.id === s.player || c.eco.gdp < 6e10 || runsOf(s, c.id).length >= 1) continue;
      if (nextRand(s) > 0.012 + c.eco.gdp / 5e13) continue;
      const opts = PROJECTS.filter((d) => !canStart(s, c.id, d.id) && d.id !== 'nuclear' && c.eco.cash > (d.pct * c.eco.gdp) / 6); // the bomb is a decision (plans.ts), not a lottery
      if (!opts.length) continue;
      const d = opts[Math.floor(nextRand(s) * opts.length)];
      startProject(s, c.id, d.id);
    }
  }
}
