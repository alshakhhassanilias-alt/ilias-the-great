/**
 * Alliances have lives: they get names, deepen while their members get on and fray when they do not, add a
 * mutual-defence clause when a common threat appears, merge with like-minded blocs, and split when members fall out.
 */
import { START_YEAR } from './types';
import type { Region } from '../data/countryData';
import { COUNTRY_BASE } from '../data/countryData';
import { ensureTreaty, getRelation, areAtWar, orgsOf, touchOrgs, touchTreaties } from './relations';
import { hash01, nextRand } from './rng';
import { clamp } from './util';
import { logEvent } from './log';
import { placeName } from './places';
import { strength } from './military';
import { foundOrg, threatened } from './alignment';
import type { CountryId, GameState, Org } from './types';

// ------------------------------------------------------------------ names
const R_ADJ: Record<Region, string[]> = {
  NA: ['North American', 'Atlantic'], LA: ['Latin American', 'Pan-American'], EU: ['European', 'Continental'],
  RU: ['Eurasian', 'Continental'], ME: ['Middle Eastern', 'Regional'], AF: ['African', 'Pan-African'],
  SA: ['South Asian', 'Indian Ocean'], EA: ['East Asian', 'Pacific'], SEA: ['Southeast Asian', 'Indo-Pacific'], OC: ['Pacific', 'Oceanian'],
};
const R_NOUN: Record<Region, string> = {
  NA: 'North America', LA: 'the Americas', EU: 'Europe', RU: 'Eurasia', ME: 'the Gulf', AF: 'Africa', SA: 'South Asia', EA: 'East Asia', SEA: 'Southeast Asia', OC: 'the Pacific',
};
const CAMP_ADJ: Record<string, string[]> = { '1': ['Atlantic', 'Free Nations\''], '-1': ['Continental', 'Eurasian'], '0': ['Non-Aligned', 'Southern', 'Independent'] };
const PATTERNS: Record<Org['kind'], string[]> = {
  defence: ['the {City} Pact', 'the Treaty of {City}', 'the {Adj} Defence Community', 'the {Adj} Alliance', 'the {Adj} Security Compact', 'the Organisation for the Security of {Noun}'],
  union: ['the {Adj} Union', 'the {City} Union', 'the Community of {Noun}', 'the {Adj} Commonwealth', 'the {Adj} Concord'],
  economic: ['the {City} Economic Forum', 'the {Adj} Economic Community', 'the {Adj} Trade Bloc', 'the {City} Accord', 'the {Adj} Partnership', 'the {Noun} Development Council'],
};
/** The region most members belong to (null when it is a cross-regional grouping). */
function mainRegion(members: CountryId[], founder?: CountryId): Region | null {
  // a bloc is named after its founder's region if a good share of it comes from there
  if (founder !== undefined) {
    const fr = COUNTRY_BASE[founder]?.region as Region;
    const all = [founder, ...members.filter((m) => m !== founder)];
    if (fr && all.filter((m) => COUNTRY_BASE[m]?.region === fr).length >= all.length * 0.4) return fr;
    const other = mainRegion(all);
    return other && all.filter((m) => COUNTRY_BASE[m]?.region === other).length >= all.length * 0.8 ? other : null;
  }
  const n = new Map<Region, number>();
  for (const m of members) { const r = COUNTRY_BASE[m]?.region as Region; if (r) n.set(r, (n.get(r) ?? 0) + 1); }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= members.length * 0.6 ? best[0] : null;
}
/** A fresh, realistic name for a new organisation, never one already in use. */
export function orgName(s: GameState, kind: Org['kind'], founder: CountryId, members: CountryId[], camp: number, salt = 0): string {
  const region = mainRegion(members, founder);
  const city = placeName(s.countries[founder].capital);
  const adjs = region ? R_ADJ[region] : CAMP_ADJ[String(camp)] ?? CAMP_ADJ['0'];
  const noun = region ? R_NOUN[region] : camp > 0 ? 'the Free World' : camp < 0 ? 'Eurasia' : 'the Global South';
  const used = new Set((s.orgs ?? []).map((o) => o.name.toLowerCase()));
  const pats = PATTERNS[kind];
  const start = Math.floor(hash01('orgname', founder, s.tick + salt, s.settings.seed) * pats.length);
  for (let i = 0; i < pats.length * adjs.length; i++) {
    const p = pats[(start + i) % pats.length];
    const adj = adjs[(Math.floor(i / pats.length) + start) % adjs.length];
    const name = p.replace('{City}', city).replace('{Adj}', adj).replace('{Noun}', noun).replace(/\bthe the\b/gi, 'the').replace(/of the the/gi, 'of the');
    if (!used.has(name.toLowerCase())) return name;
  }
  return `the ${city} ${kind === 'defence' ? 'Pact' : kind === 'union' ? 'Union' : 'Forum'} ${START_YEAR + Math.floor(s.tick / 52)}`;
}
/** Clean a name a player typed. */
export function cleanName(raw: string): string | null {
  const t = raw.replace(/[<>{}]/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 3 && t.length <= 40 ? t : null;
}

// ------------------------------------------------------------------ the life of an organisation
export const note = (s: GameState, o: Org, text: string) => { (o.history ??= []).push({ tick: s.tick, text }); if (o.history.length > 12) o.history.shift(); };
/** Average relation between members (sampled for big organisations). */
export function cohesion(s: GameState, o: Org): number {
  const m = o.members.filter((x) => s.countries[x]?.alive).slice(0, 14);
  let t = 0, n = 0;
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { t += getRelation(s, m[i], m[j]); n++; }
  return n ? t / n : 0;
}
export const depthLabel = (d: number) => (d > 0.85 ? 'deeply integrated' : d > 0.6 ? 'solid' : d > 0.35 ? 'loose' : 'fraying');
const effBonus = (o: Org) => Math.round((o.base ?? o.bonus) * (0.6 + 0.6 * (o.depth ?? 2 / 3)));

/** Turn a club into an alliance: members are now bound to defend each other. */
export function upgradeToDefence(s: GameState, o: Org, why: string) {
  const old = o.name;
  o.kind = 'defence';
  o.base = Math.max(o.base ?? o.bonus, 14);
  o.icon = '🛡';
  if (/Economic Forum|Trade Bloc|Partnership|Development Council|Accord|Economic Community/.test(o.name)) o.name = orgName(s, 'defence', o.founder ?? o.members[0], o.members, o.camp, 7);
  for (let i = 0; i < o.members.length; i++) for (let j = i + 1; j < o.members.length; j++) if (!areAtWar(s, o.members[i], o.members[j])) ensureTreaty(s, o.members[i], o.members[j]).alliance = true;
  o.bonus = effBonus(o);
  note(s, o, `${old} added a mutual-defence clause${o.name !== old ? ` and became ${o.name}` : ''}: ${why}`);
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `🛡 ${old.replace(/^the /, '').toUpperCase()} BECOMES AN ALLIANCE: ${why}.${o.name !== old ? ` It is now ${o.name}.` : ''}`, 'diplo', o.members.slice(0, 4), true, { big: o.members.includes(s.player) || o.members.length >= 4 });
}
/** Two like-minded organisations become one. A much bigger one simply absorbs the smaller and keeps its name. */
export function mergeOrgs(s: GameState, a: Org, b: Org): Org {
  // the historic organisations (NATO, the EU ...) absorb newcomers and keep their names, whatever the numbers
  const hist = (o: Org) => o.founded === 0 && o.founder === undefined;
  const [big, small] = hist(a) !== hist(b) ? (hist(a) ? [a, b] : [b, a]) : a.members.length >= b.members.length ? [a, b] : [b, a];
  if (hist(big) || big.members.length >= small.members.length * 2.5) {
    const added = small.members.filter((m) => !big.members.includes(m));
    if (big.kind === 'defence') for (const m of added) for (const x of big.members) if (!areAtWar(s, m, x)) ensureTreaty(s, m, x).alliance = true;
    big.members.push(...added);
    s.orgs = (s.orgs ?? []).filter((o) => o !== small);
    note(s, big, `Absorbed ${small.name} (${added.length} new members)`);
    touchOrgs(s); touchTreaties(s);
    logEvent(s, `🤝 ${small.name.replace(/^the /, 'The ')} is wound up: its members join ${big.name}.`, 'diplo', small.members.slice(0, 4), true, { big: true });
    return big;
  }
  const members = [...new Set([...a.members, ...b.members])];
  const lead = [...members].sort((x, y) => strength(s.countries[y]) - strength(s.countries[x]))[0];
  const kind = a.kind;
  const name = orgName(s, kind, lead, members, a.camp, 3);
  s.orgs = (s.orgs ?? []).filter((o) => o !== a && o !== b);
  const id = Math.max(0, ...s.orgs.map((o) => o.id), a.id, b.id) + 1;
  const o: Org = {
    id, key: `org${id}`, name, kind, icon: a.icon, camp: a.camp, founded: s.tick, founder: lead, members,
    base: Math.max(a.base ?? a.bonus, b.base ?? b.bonus), depth: ((a.depth ?? 0.67) + (b.depth ?? 0.67)) / 2, bonus: 0,
    history: [{ tick: s.tick, text: `Formed from the merger of ${a.name} and ${b.name}` }],
  };
  o.bonus = effBonus(o);
  if (kind === 'defence') for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (!areAtWar(s, members[i], members[j])) ensureTreaty(s, members[i], members[j]).alliance = true;
  s.orgs.push(o);
  touchOrgs(s); touchTreaties(s);
  logEvent(s, `🤝 A MERGER: ${a.name} and ${b.name} unite as ${name}, ${members.length} countries strong.`, 'diplo', members.slice(0, 4), true, { big: true });
  return o;
}

/** Quarterly: depth, upgrades, mergers and schisms. Organisations with the player in them only change with its consent. */
export function evolveOrgs(s: GameState) {
  for (const o of [...(s.orgs ?? [])]) {
    if (!s.orgs?.includes(o) || o.members.length < 3) continue;
    o.base ??= o.bonus;
    o.depth ??= 2 / 3;
    const coh = cohesion(s, o);
    const d0 = o.depth;
    o.depth = clamp(o.depth + (coh > 40 ? 0.02 : coh < 15 ? -0.03 : 0), 0, 1);
    if (Math.abs(o.depth - d0) > 1e-9) {
      const b = effBonus(o);
      if (b !== o.bonus) { o.bonus = b; touchOrgs(s); }
      if (d0 >= 0.35 && o.depth < 0.35) { note(s, o, 'Its members have drifted apart'); logEvent(s, `${o.icon} ${o.name.replace(/^the /, 'The ')} is fraying: its members no longer agree on much.`, 'diplo', o.members.slice(0, 3), o.members.includes(s.player)); }
      if (d0 <= 0.85 && o.depth > 0.85) note(s, o, 'Its members are now deeply integrated');
    }
    const withPlayer = o.members.includes(s.player);
    // a common threat turns a club into an alliance
    if (!withPlayer && o.kind !== 'defence' && coh > 40 && !o.members.some((m) => orgsOf(s, m).some((x) => x !== o && x.kind === 'defence')) && nextRand(s) < 0.25) {
      const threat = s.countries.find((x) => x.alive && !o.members.includes(x.id) && o.members.filter((m) => getRelation(s, m, x.id) < -35 && strength(x) > strength(s.countries[m]) * 0.5).length >= o.members.length / 2);
      if (threat) { upgradeToDefence(s, o, `its members feel threatened by ${threat.name}`); continue; }
    }
    // a bloc whose members have fallen out splits
    if (o.members.length >= 6 && coh < 15 && nextRand(s) < 0.3) {
      const avg = (m: CountryId, xs: CountryId[]) => { const ys = xs.filter((x) => x !== m); return ys.reduce((t, x) => t + getRelation(s, m, x), 0) / Math.max(1, ys.length); };
      const splitter = [...o.members].filter((m) => m !== s.player).sort((a, b) => avg(a, o.members) - avg(b, o.members))[0];
      if (splitter !== undefined) {
        const faction = o.members.filter((m) => m !== s.player && (m === splitter || getRelation(s, m, splitter) > 30));
        const rest = o.members.filter((m) => !faction.includes(m));
        if (faction.length >= 3 && rest.length >= 3 && faction.every((m) => avg(m, rest) < 10)) {
          o.members = rest;
          if (o.kind === 'defence') for (const a of faction) for (const b of rest) { const t = s.treaties[a < b ? `${a}-${b}` : `${b}-${a}`]; if (t) t.alliance = false; }
          touchOrgs(s); touchTreaties(s);
          note(s, o, `${faction.length} members walked out, led by ${s.countries[splitter].name}`);
          const n = foundOrg(s, splitter, o.kind, faction.filter((m) => m !== splitter), orgName(s, o.kind, splitter, faction, o.camp, 11));
          note(s, n, `Founded by members who walked out of ${o.name}`);
          logEvent(s, `💥 SCHISM: ${s.countries[splitter].name} leads ${faction.length - 1} other members out of ${o.name}. They form ${n.name}.`, 'diplo', faction.slice(0, 4), true, { big: true });
          continue;
        }
      }
    }
  }
  // like-minded organisations of the same kind may merge (never the player's without its consent)
  const list = s.orgs ?? [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.kind !== b.kind || a.camp !== b.camp || a.members.includes(s.player) || b.members.includes(s.player)) continue;
    if (a.members.length + b.members.length > 45 || a.founded === 0 && b.founded === 0) continue;
    // blocs merge with neighbours, not across the world
    if (mainRegion(a.members) !== mainRegion(b.members)) continue;
    let t = 0, n = 0;
    for (const x of a.members.slice(0, 8)) for (const y of b.members.slice(0, 8)) if (x !== y) { t += getRelation(s, x, y); n++; }
    if (n && t / n > 45 && nextRand(s) < 0.12) { mergeOrgs(s, a, b); return; }
  }
}

// ------------------------------------------------------------------ player proposals
/** Who would vote for turning this organisation into a mutual-defence alliance? */
export function defenceClauseVotes(s: GameState, o: Org) {
  return o.members.filter((m) => m !== s.player && s.countries[m]?.alive).map((m) => {
    const other = orgsOf(s, m).find((x) => x !== o && x.kind === 'defence');
    if (other) return { m, yes: false, why: `already in ${other.name}` };
    const r = getRelation(s, m, s.player);
    const t = threatened(s, s.countries[m]);
    return r > 45 || (t && r > 25) ? { m, yes: true, why: t ? 'feels threatened' : `relations ${r.toFixed(0)}` } : { m, yes: false, why: `relations ${r.toFixed(0)}${t ? '' : ', feels safe'}` };
  });
}
export function actProposeDefence(s: GameState, orgId: number) {
  const o = s.orgs?.find((x) => x.id === orgId);
  if (!o || !o.members.includes(s.player)) return { ok: false, message: 'Not a member' };
  if (o.kind === 'defence') return { ok: false, message: 'It is already a defence alliance' };
  if (orgsOf(s, s.player).some((x) => x !== o && x.kind === 'defence')) return { ok: false, message: 'Leave your other defence pact first' };
  const key = `orgDef:${o.id}`;
  if (s.tick - (s.stats[key] ?? -999) < 52) return { ok: false, message: `The members will not discuss it again for ${52 - (s.tick - (s.stats[key] ?? 0))} weeks` };
  s.stats[key] = s.tick;
  const v = defenceClauseVotes(s, o);
  if (v.length && v.filter((x) => x.yes).length / v.length >= 0.75) { upgradeToDefence(s, o, `${s.countries[s.player].name} persuaded the members`); return { ok: true, message: `${o.name} is now a mutual-defence alliance.` }; }
  return { ok: false, message: `Voted down: ${v.filter((x) => !x.yes).slice(0, 3).map((x) => `${s.countries[x.m].name} (${x.why})`).join(', ')}.` };
}
export function actRenameOrg(s: GameState, orgId: number, raw: string) {
  const o = s.orgs?.find((x) => x.id === orgId);
  if (!o || o.founder !== s.player) return { ok: false, message: 'Only its founder can rename it' };
  const name = cleanName(raw);
  if (!name) return { ok: false, message: 'A name needs 3 to 40 characters' };
  if ((s.orgs ?? []).some((x) => x !== o && x.name.toLowerCase() === name.toLowerCase())) return { ok: false, message: 'That name is taken' };
  note(s, o, `Renamed from ${o.name} to ${name}`);
  o.name = name;
  return { ok: true, message: `It is now called ${name}.` };
}
