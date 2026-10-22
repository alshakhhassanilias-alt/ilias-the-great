/**
 * Objectives that never run out and follow the way you play. Your path is read from what you have actually done
 * (wars won and land taken, reforms or crackdowns, trade deals, aid and mediation, the road your story took), and
 * new objectives are made for it from the world as it is now: the next economy to overtake, the army to outgun, the
 * neighbour to win over or the enemy to beat. Each id carries its kind, its target and when it was set
 * ("d:overtake:12:340"), so a goal can be rebuilt from the save at any time; the starting value it is measured from
 * is kept in s.stats.
 */
import type { Goal } from './goals';
import { clamp, fmtMoney } from './util';
import { strength } from './military';
import { getRelation, getTreaty, hasAlliance, isAtWar, partnersOf, warsOf, warSideOf } from './relations';
import { recOf } from './minds';
import { orgsOf } from './relations';
import { hash01 } from './rng';
import type { Country, CountryId, GameState } from './types';

export type Path = 'conqueror' | 'strongman' | 'reformer' | 'trader' | 'peacemaker' | 'builder';
export const PATH_LABEL: Record<Path, string> = { conqueror: 'the Conqueror', strongman: 'the Strongman', reformer: 'the Reformer', trader: 'the Trader', peacemaker: 'the Peacemaker', builder: 'the Builder' };

/** Which way the player is taking the country, and the evidence. */
export function pathOf(s: GameState, c: Country): { path: Path; why: string } {
  const r = recOf(s, c.id);
  const arch = c.story?.arch;
  const wins = s.stats.warWins ?? 0, conq = s.stats[`conq:${c.id}`] ?? 0;
  const trade = partnersOf(s, c.id, 'trade').length - (s.goalBase?.trade ?? 0);
  const sc: Record<Path, number> = {
    conqueror: 2 * r.conquest + r.aggr + 1.5 * wins + 2 * conq + (arch === 'iron' ? 1 : 0),
    strongman: 2 * r.repress + (c.gov === 'A' || c.gov === 'C' ? 0.8 : 0) + (arch === 'iron' ? 0.5 : 0),
    reformer: 2 * r.reform + (arch === 'reform' ? 1.5 : 0),
    trader: Math.max(0, trade) * 0.5 + (arch === 'pragmatic' ? 1.5 : 0),
    peacemaker: 2 * r.aid + 0.8 * r.loyal + 1.2 * (s.stats.mediations ?? 0),
    builder: 1.2,
  };
  const path = (Object.keys(sc) as Path[]).sort((a, b) => sc[b] - sc[a])[0];
  const why: Record<Path, string> = {
    conqueror: wins || conq ? `you have won ${wins} war${wins === 1 ? '' : 's'} and taken land by force` : 'you chose the iron road and went to war',
    strongman: 'you rule with a firm hand at home',
    reformer: 'you chose reform: freer courts, cleaner government',
    trader: trade > 0 ? `you have signed ${trade} new trade deal${trade === 1 ? '' : 's'}` : 'you chose the pragmatic road of deals and trade',
    peacemaker: 'you send aid, keep your word and broker peace',
    builder: 'you are building up the country at home',
  };
  return { path, why: why[path] };
}

const P = (s: GameState) => s.countries[s.player];
const alive = (s: GameState) => s.countries.filter((x) => x.alive);
const name = (s: GameState, id: number) => s.countries[id]?.name ?? '?';
/** the value a goal is measured from: remembered once the goal is active (a mere candidate leaves no trace) */
const base = (s: GameState, id: string, v: () => number) => {
  const own = id.split(':').slice(0, 4).join(':');
  if (!s.goalsActive.includes(own)) return s.stats[`g0:${id}`] ?? v();
  return (s.stats[`g0:${id}`] ??= v());
};
const cash = (pct: number) => (c: Country) => { c.eco.cash += pct * c.eco.gdp; };
const rep = (n: number) => (c: Country) => { c.reputation = clamp(c.reputation + n, 0, 100); };
const both = (...fs: ((c: Country, s: GameState) => void)[]) => (c: Country, s: GameState) => { for (const f of fs) f(c, s); };

/** Build a generated goal from its id (null: the id is not a generated goal, or its target is gone). */
export function dynGoal(s: GameState, id: string): Goal | null {
  if (!id.startsWith('d:')) return null;
  const [, kind, a] = id.split(':');
  const arg = Number(a);
  const c = P(s);
  const T = s.countries[arg];
  switch (kind) {
    case 'overtake': {
      if (!T?.alive) return null;
      const r0 = base(s, id, () => c.eco.gdp / Math.max(1, T.eco.gdp));
      return { id, theme: 'economy', title: `Overtake ${T.name}`, desc: `Grow your economy past ${T.name}'s (${fmtMoney(T.eco.gdp)} today).`, reward: 'Reward: 1% of GDP · reputation +3',
        progress: (s2, c2) => { const r = c2.eco.gdp / Math.max(1, s2.countries[arg].eco.gdp); return { value: r >= 1 ? 1 : clamp((r - r0) / Math.max(0.02, 1 - r0), 0, 0.99), text: `${Math.round(r * 100)}% of ${T.name}` }; }, pay: both(cash(0.01), rep(3)) };
    }
    case 'outgun': {
      if (!T?.alive) return null;
      const r0 = base(s, id, () => strength(c) / Math.max(1, strength(T)));
      return { id, theme: 'military', title: `Outgun ${T.name}`, desc: `Build a military stronger than ${T.name}'s.`, reward: 'Reward: army equipment +6% · prestige',
        progress: (s2, c2) => { const r = strength(c2) / Math.max(1, strength(s2.countries[arg])); return { value: r >= 1 ? 1 : clamp((r - r0) / Math.max(0.02, 1 - r0), 0, 0.99), text: `${Math.round(r * 100)}% of their strength` }; }, pay: both((c2) => { c2.mil.equipArmy *= 1.06; }, rep(2)) };
    }
    case 'friend': {
      if (!T?.alive) return null;
      return { id, theme: 'politics', title: `Win over ${T.name}`, desc: `Raise relations with ${T.name} to 75.`, reward: 'Reward: reputation +4 · 0.4% of GDP',
        progress: (s2, c2) => { const r = getRelation(s2, c2.id, arg), r0 = base(s2, id, () => r); return { value: r >= 75 ? 1 : clamp((r - r0) / Math.max(5, 75 - r0), 0, 0.99), text: `relations ${Math.round(r)} / 75` }; }, pay: both(rep(4), cash(0.004)) };
    }
    case 'ally': {
      if (!T?.alive) return null;
      return { id, theme: 'politics', title: `An alliance with ${T.name}`, desc: `Sign a defensive alliance with ${T.name} (Diplomacy, or the negotiating table).`, reward: 'Reward: reputation +4 · readiness +5%',
        progress: (s2, c2) => { const on = hasAlliance(s2, c2.id, arg); const r = getRelation(s2, c2.id, arg); return { value: on ? 1 : clamp(r / 120, 0, 0.8), text: on ? 'signed' : `relations ${Math.round(r)}` }; }, pay: both(rep(4), (c2) => { c2.mil.readiness = clamp(c2.mil.readiness + 0.05, 0, 1); }) };
    }
    case 'trade': {
      if (!T?.alive) return null;
      return { id, theme: 'economy', title: `Open ${T.name}'s market`, desc: `Sign a trade agreement with ${T.name}, one of the world's big economies.`, reward: 'Reward: 0.6% of GDP',
        progress: (s2, c2) => { const on = !!getTreaty(s2, c2.id, arg)?.trade; const r = getRelation(s2, c2.id, arg); return { value: on ? 1 : clamp(r / 100, 0, 0.8), text: on ? 'signed' : `relations ${Math.round(r)}` }; }, pay: cash(0.006) };
    }
    case 'thaw': {
      if (!T?.alive) return null;
      return { id, theme: 'politics', title: `End the feud with ${T.name}`, desc: `Bring relations with ${T.name} from hostility back to zero or better.`, reward: 'Reward: stability +3 · reputation +5',
        progress: (s2, c2) => { const r = getRelation(s2, c2.id, arg), r0 = base(s2, id, () => r); return { value: r >= 0 ? 1 : clamp((r - r0) / Math.max(5, -r0), 0, 0.99), text: `relations ${Math.round(r)}` }; }, pay: both(rep(5), (c2) => { c2.eco.stability = clamp(c2.eco.stability + 3, 0, 100); }) };
    }
    case 'beat': {
      // win the current war against T: take a fifth of its regions, or its capital
      if (!T?.alive) return null;
      const need = base(s, id, () => Math.max(3, Math.ceil(T.provinces.length * 0.2)));
      const cap0 = base(s, `${id}:cap`, () => T.capital);
      return { id, theme: 'military', title: `Defeat ${T.name}`, desc: `Take ${need} of ${T.name}'s regions, or its capital.`, reward: 'Reward: war support +15% · political capital',
        progress: (s2, c2) => { const w = s2.wars.find((x) => warSideOf(x, c2.id) >= 0 && warSideOf(x, arg) >= 0 && warSideOf(x, c2.id) !== warSideOf(x, arg)); const n = w ? (w.taken?.[c2.id] ?? 0) : s2.stats[`g1:${id}`] ?? 0; if (w && s2.goalsActive.includes(id)) s2.stats[`g1:${id}`] = n; const cap = s2.owner[cap0] === c2.id; return { value: cap ? 1 : clamp(n / need, 0, 1), text: cap ? 'their capital is yours' : `${n} / ${need} regions` }; },
        pay: (c2) => { c2.mil.warSupport = clamp((c2.mil.warSupport ?? 0.6) + 0.15, 0, 1); } };
    }
    case 'reclaim': {
      return { id, theme: 'military', title: 'Take back our land', desc: 'Win back every region of your country that a foreign power holds.', reward: 'Reward: stability +6 · war support +10%',
        progress: (s2, c2) => { const held = s2.core.reduce((t, k, p) => t + (k === c2.id && s2.owner[p] !== c2.id && s2.countries[s2.owner[p]]?.alive ? 1 : 0), 0); const h0 = base(s2, id, () => Math.max(1, held)); return { value: held === 0 ? 1 : clamp(1 - held / h0, 0, 0.99), text: `${held} region${held === 1 ? '' : 's'} still occupied` }; },
        pay: (c2) => { c2.eco.stability = clamp(c2.eco.stability + 6, 0, 100); c2.mil.warSupport = clamp((c2.mil.warSupport ?? 0.6) + 0.1, 0, 1); } };
    }
    case 'capital': {
      if (!T?.alive) return null;
      const cap0 = base(s, id, () => T.capital);
      return { id, theme: 'military', title: `March on ${s.countries[arg].name}'s capital`, desc: `Take ${T.name}'s capital region. A war of conquest: the world will not like it.`, reward: 'Reward: 1.5% of GDP · prestige · the world remembers',
        progress: (s2, c2) => { const own = s2.owner[cap0] === c2.id; const at = isAtWar(s2, c2.id) && warsOf(s2, c2.id).some((w) => w.attackers.includes(arg) || w.defenders.includes(arg)); return { value: own ? 1 : at ? 0.3 : 0, text: own ? 'taken' : at ? 'at war' : 'at peace' }; }, pay: both(cash(0.015), rep(-2)) };
    }
    case 'hegemon': {
      return { id, theme: 'military', title: 'The strongest in the region', desc: `Have the strongest military in ${regionName(c.region)}.`, reward: 'Reward: reputation +5 · readiness +5%',
        progress: (s2, c2) => { const reg = alive(s2).filter((x) => x.region === c2.region).sort((x, y) => strength(y) - strength(x)); const r = reg.findIndex((x) => x.id === c2.id) + 1; return { value: r === 1 ? 1 : clamp(strength(c2) / Math.max(1, strength(reg[0])), 0, 0.99), text: `#${r} in the region` }; },
        pay: both(rep(5), (c2) => { c2.mil.readiness = clamp(c2.mil.readiness + 0.05, 0, 1); }) };
    }
    case 'rich': {
      const tgt = base(s, id, () => Math.ceil((c.eco.gdp / Math.max(1, c.eco.pop)) * 1.15 / 1000) * 1000);
      return { id, theme: 'economy', title: `A richer nation: $${(tgt / 1000).toFixed(0)}k a head`, desc: `Raise GDP per person to $${tgt.toLocaleString('en-US')}.`, reward: 'Reward: stability +4 · 0.5% of GDP',
        progress: (_s2, c2) => { const v = c2.eco.gdp / Math.max(1, c2.eco.pop); const v0 = base(s, `${id}:0`, () => v); return { value: v >= tgt ? 1 : clamp((v - v0) / Math.max(1, tgt - v0), 0, 0.99), text: `$${Math.round(v).toLocaleString('en-US')}` }; },
        pay: both(cash(0.005), (c2) => { c2.eco.stability = clamp(c2.eco.stability + 4, 0, 100); }) };
    }
    case 'tech': {
      const t0 = base(s, id, () => c.eco.tech);
      return { id, theme: 'economy', title: 'The next technological leap', desc: `Raise technology from ${t0.toFixed(0)} to ${Math.min(100, t0 + 6).toFixed(0)}.`, reward: 'Reward: 0.6% of GDP',
        progress: (_s2, c2) => ({ value: clamp((c2.eco.tech - t0) / 6, 0, 1), text: `${c2.eco.tech.toFixed(1)} / ${Math.min(100, t0 + 6).toFixed(0)}` }), pay: cash(0.006) };
    }
    case 'prestige': {
      const r0 = base(s, id, () => c.reputation);
      const tgt = Math.min(100, Math.round(r0 + 10));
      return { id, theme: 'politics', title: 'A respected nation', desc: `Raise your reputation to ${tgt}.`, reward: 'Reward: political capital · 0.4% of GDP',
        progress: (_s2, c2) => ({ value: c2.reputation >= tgt ? 1 : clamp((c2.reputation - r0) / Math.max(1, tgt - r0), 0, 0.99), text: `${c2.reputation.toFixed(0)} / ${tgt}` }), pay: cash(0.004) };
    }
    case 'order': {
      const tgt = Math.min(92, Math.round(base(s, id, () => c.eco.stability) + 10));
      return { id, theme: 'politics', title: 'Order at home', desc: `Raise stability to ${tgt}.`, reward: 'Reward: 0.5% of GDP · readiness +3%',
        progress: (_s2, c2) => ({ value: clamp(c2.eco.stability / tgt, 0, 1), text: `${c2.eco.stability.toFixed(0)} / ${tgt}` }), pay: both(cash(0.005), (c2) => { c2.mil.readiness = clamp(c2.mil.readiness + 0.03, 0, 1); }) };
    }
    case 'bloc': {
      const o = (s.orgs ?? []).find((x) => x.id === arg);
      if (!o) return null;
      const tgt = base(s, id, () => o.members.length + 2);
      return { id, theme: 'politics', title: `Grow ${o.name.replace(/^the /, 'the ')}`, desc: `Bring ${o.name} to ${tgt} members (invite friends from Diplomacy).`, reward: 'Reward: reputation +5',
        progress: (s2) => { const n = (s2.orgs ?? []).find((x) => x.id === arg)?.members.length ?? 0; return { value: clamp(n / tgt, 0, 1), text: `${n} / ${tgt} members` }; }, pay: rep(5) };
    }
  }
  return null;
}

const REGION: Record<string, string> = { EU: 'Europe', RU: 'Eurasia', ME: 'the Middle East', AF: 'Africa', SA: 'South Asia', EA: 'East Asia', SEA: 'Southeast Asia', LA: 'Latin America', NA: 'North America', OC: 'Oceania' };
const regionName = (r: string) => REGION[r] ?? 'your region';

/** Generated objectives that fit the player's path right now, best first: [id, weight]. */
export function dynCandidates(s: GameState): [string, number][] {
  const c = P(s);
  const { path } = pathOf(s, c);
  const t = s.tick;
  const out: [string, number][] = [];
  const W = (k: string, byPath: Partial<Record<Path, number>>, dflt = 1) => byPath[path] ?? dflt;
  const all = alive(s).filter((x) => x.id !== c.id);
  // the next economy and the next army above you
  const econ = [...alive(s)].sort((a, b) => b.eco.gdp - a.eco.gdp);
  const ei = econ.findIndex((x) => x.id === c.id);
  if (ei > 0) out.push([`d:overtake:${econ[ei - 1].id}:${t}`, W('overtake', { trader: 3, builder: 3, reformer: 2 }, 1.2)]);
  const army = [...alive(s)].sort((a, b) => strength(b) - strength(a));
  const ai = army.findIndex((x) => x.id === c.id);
  if (ai > 0 && strength(army[ai - 1]) < strength(c) * 2.5) out.push([`d:outgun:${army[ai - 1].id}:${t}`, W('outgun', { conqueror: 3, strongman: 3 }, 1)]);
  // friends to make: big powers you are lukewarm with; allies-in-waiting; markets to open; feuds to end
  const bigs = all.filter((x) => strength(x) > 0 || x.eco.gdp > 0).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, 25);
  const warm = bigs.filter((x) => { const r = getRelation(s, c.id, x.id); return r > -15 && r < 50 && !isAtWar(s, x.id); });
  if (warm.length) out.push([`d:friend:${warm[Math.floor(hash01('gf', t, c.id) * Math.min(5, warm.length))].id}:${t}`, W('friend', { peacemaker: 3, trader: 2, reformer: 2 }, 1)]);
  const ally = all.filter((x) => getRelation(s, c.id, x.id) > 45 && !hasAlliance(s, c.id, x.id) && strength(x) > strength(c) * 0.2 && !isAtWar(s, x.id)).sort((a, b) => strength(b) - strength(a))[0];
  if (ally) out.push([`d:ally:${ally.id}:${t}`, W('ally', { trader: 2, conqueror: 2, strongman: 1.5 }, 1.2)]);
  const mkt = bigs.find((x) => !getTreaty(s, c.id, x.id)?.trade && getRelation(s, c.id, x.id) > 0 && !isAtWar(s, x.id));
  if (mkt) out.push([`d:trade:${mkt.id}:${t}`, W('trade', { trader: 3.5, builder: 2 }, 1)]);
  const foe = all.filter((x) => getRelation(s, c.id, x.id) < -30 && !isAtWar(s, c.id)).sort((a, b) => strength(b) - strength(a))[0];
  if (foe) out.push([`d:thaw:${foe.id}:${t}`, W('thaw', { peacemaker: 3.5, reformer: 1.5, trader: 1.5, conqueror: 0.3, strongman: 0.4 }, 1)]);
  // war: beat the enemy, take back what was lost
  for (const w of warsOf(s, c.id)) {
    const side = warSideOf(w, c.id);
    const e = (side === 0 ? w.defenders : w.attackers)[0];
    if (e !== undefined) out.push([`d:beat:${e}:${t}`, 4]);
  }
  if (s.core.some((k, p) => k === c.id && s.owner[p] !== c.id && s.countries[s.owner[p]]?.alive)) out.push([`d:reclaim:0:${t}`, 4.5]);
  // conquerors look for the next prize: a hostile neighbour they could beat
  if (path === 'conqueror' || path === 'strongman') {
    const prey = all.filter((x) => getRelation(s, c.id, x.id) < -35 && strength(x) < strength(c) * 0.7 && !hasAlliance(s, c.id, x.id)).sort((a, b) => getRelation(s, c.id, a.id) - getRelation(s, c.id, b.id))[0];
    if (prey) out.push([`d:capital:${prey.id}:${t}`, path === 'conqueror' ? 2.5 : 1]);
    out.push([`d:hegemon:0:${t}`, 2]);
  }
  out.push([`d:rich:0:${t}`, W('rich', { builder: 3, reformer: 2.5, trader: 2 }, 1)]);
  out.push([`d:tech:0:${t}`, W('tech', { builder: 2.5, reformer: 2 }, 1)]);
  out.push([`d:prestige:0:${t}`, W('prestige', { reformer: 2.5, peacemaker: 2.5 }, 0.8)]);
  if (c.eco.stability < 82) out.push([`d:order:0:${t}`, W('order', { strongman: 3 }, 1)]);
  const mine = orgsOf(s, c.id).find((o) => o.founder === c.id);
  if (mine) out.push([`d:bloc:${mine.id}:${t}`, W('bloc', { trader: 2, peacemaker: 2, conqueror: 1.5 }, 1.2)]);
  return out;
}
/** The kind of a generated goal id (so the list never holds two of the same kind or target at once). */
export const dynKey = (id: string) => id.split(':').slice(0, 3).join(':');
export const dynKind = (id: string) => id.split(':')[1];
void ((x: CountryId) => x);
