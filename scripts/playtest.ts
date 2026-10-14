/**
 * Automated playtests: bots with different play styles play full games and we measure what happens, so balance
 * problems show up as numbers. Usage:
 *   npx tsx scripts/playtest.ts <style> <years> [Country,Country,...]  > out.json
 * Styles: passive (answers every decision with the first option, nothing else), builder (laws and national
 * projects for the economy), politician (Legacy mode: agenda, popular laws, gives factions what they want),
 * warmonger (declares war on the weakest neighbour every two years, total war aims, weapons programmes).
 */
import fs from 'node:fs';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS, type GameState } from '../src/sim/types';
import { NAME_TO_ID, areAtWar, isAtWar } from '../src/sim/relations';
import { eventById, resolveEvent } from '../src/sim/events';
import { actPassLaw, forecast, lawById, LAWS } from '../src/sim/domestic';
import { actStartProject, blocked, pathOf } from '../src/sim/nations';
import { actStartProgramme, PROGRAMMES } from '../src/sim/wargoals';
import { actDeclareWar } from '../src/sim/actions';
import { neighborsOf } from '../src/sim/diplomacy';
import { strength } from '../src/sim/military';
import { actChooseAgenda, grade } from '../src/sim/legacy';
import { approval } from '../src/sim/approval';
import { aggOf, coalitionAgainst } from '../src/sim/coalitions';
import { setGeoRef } from '../src/sim/geoRef';

const style = (process.argv[2] ?? 'passive') as 'passive' | 'builder' | 'politician' | 'warmonger';
const years = Number(process.argv[3] ?? 10);
const countries = (process.argv[4] ?? 'Poland,United States of America,China,Russia,Brazil,Nigeria,Iran,Germany,India,Turkey').split(',');
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
setGeoRef(geo);

const ECON_LAWS = ['tech_fund', 'free_trade', 'healthcare', 'farm_aid', 'anti_graft', 'migration', 'green_deal'];
const POPULAR_LAWS = ['healthcare', 'min_wage', 'farm_aid', 'anti_graft', 'autonomy', 'foreign_aid'];

function play(name: string, seed: number) {
  const s: GameState = createGame(geo, { ...DEFAULT_SETTINGS, seed, mode: style === 'politician' ? 'legacy' : 'sandbox' }, NAME_TO_ID[name]);
  const c = s.countries[s.player];
  const r = { country: name, style, seed, stab: [] as number[], growth: [] as number[], appr: [] as number[], pc: [] as number[], minMood: 100, events: 0, arcs: new Set<string>(), laws: 0, lawFails: 0, projects: 0, wars: 0, warsWon: 0, warsLost: 0, coalitionVsMe: 0, maxAgg: 0, coups: 0, defaults: 0, resignations: 0, elections: { won: 0, lost: 0 }, grade: '', removed: 0, gdp0: c.eco.gdp, gdp1: 0, debt1: 0, unrest: 0 };
  let last = 0;
  for (let w = 0; w < 52 * years; w++) {
    // decisions
    for (const it of [...s.inbox]) {
      r.events++;
      if (it.id.startsWith('arc_')) r.arcs.add(it.id.split('_')[1]);
      if (it.id === 'fac_unrest') r.unrest++;
      if (process.env.DEBUG && /war|arc_|ultimatum|ally/.test(it.id)) console.error(s.tick, 'INBOX', it.id, JSON.stringify(it.data));
      const def = eventById(it.id);
      const en = def.options.map((o) => !o.enabled || o.enabled(s, c));
      // a sensible player avoids starting wars by accident: skip escalating options unless warlike
      const risky = (i: number) => /declare war|risk of war|strike back|refuse and dig in/i.test(def.options[i].label + ' ' + def.options[i].hint);
      let k = 0;
      if (style !== 'warmonger') { const safe = def.options.findIndex((_, i) => en[i] && !risky(i)); if (safe >= 0) k = safe; }
      if (style === 'warmonger' && it.id === 'war_goal') k = 1;
      if (style === 'politician' && it.id === 'fac_demand') k = 0;
      if (!en[k]) k = Math.max(0, en.indexOf(true));
      resolveEvent(s, geo, k, it.uid);
    }
    if (s.legacy?.hand.length) actChooseAgenda(s, s.legacy.hand.slice(0, 3));
    const P = c.politics;
    // laws and projects
    if (P && style !== 'passive' && w % 6 === 3) {
      const list = style === 'politician' ? POPULAR_LAWS : style === 'warmonger' ? ['conscription', 'war_powers', 'border_wall', 'police'] : ECON_LAWS;
      const law = list.find((id) => !P.laws.some((l) => l.id === id) && !(lawById(id)!.excl && P.laws.some((l) => l.id === lawById(id)!.excl)));
      if (law) { const fc = forecast(c, lawById(law)!, 0); const whip = fc.yes < 0.56 ? 10 : 0; if (P.pc >= fc.cost + whip + 8) { const res = actPassLaw(s, law, whip); if (res.ok) r.laws++; else if (/Defeated/.test(res.message)) r.lawFails++; } }
      if (!c.nat?.active) {
        const open = pathOf(c).nodes.filter((n) => !blocked(s, c, n));
        const pick = style === 'warmonger' ? open.find((n) => n.fx.army || n.fx.cb || n.fx.eff?.off) ?? open[0] : open.find((n) => n.fx.eff?.tfp || n.fx.capital || n.fx.stab) ?? open[0];
        if (pick && P.pc >= pick.pc + 10) actStartProject(s, pick.id);
      }
    }
    if (style === 'warmonger' && w % 104 === 60 && !isAtWar(s, c.id)) {
      const nb = neighborsOf(s, geo, c.id).filter((x) => !areAtWar(s, c.id, x)).sort((a, b) => strength(s.countries[a]) - strength(s.countries[b]));
      if (nb[0] !== undefined) { actDeclareWar(s, geo, c.id, nb[0]); }
    }
    if (style === 'warmonger' && w % 30 === 5) for (const p of PROGRAMMES) if (!c.progs?.some((x) => x.id === p.id)) { actStartProgramme(s, p.id); break; }
    tick(s, geo);
    // measure
    for (const e of s.log) {
      if (e.seq <= last) continue;
      last = e.seq;
      if (process.env.DEBUG && e.countries.includes(c.id) && /declared war|captured|peace|COALITION|joins|eliminat|ultimatum|standoff|border|demand/i.test(e.text)) console.error(s.tick, e.text.slice(0, 170));
      if (/COUP: General|overthrown in a military coup/.test(e.text)) r.coups++;
      if (e.countries.includes(c.id) && /defaulted/.test(e.text)) r.defaults++;
      if (/resigns|quits|is dismissed|walked out/.test(e.text) && e.countries[0] === c.id) r.resignations++;
      if (/NATIONAL PROJECT COMPLETE/.test(e.text)) r.projects++;
      if (/WAR AIMS ACHIEVED/.test(e.text)) r.warsWon++;
      if (/WAR AIMS FAILED/.test(e.text)) r.warsLost++;
      if (/declared war/.test(e.text) && e.countries.includes(c.id)) r.wars++;
      if (/wins a .* term|ELECTION: .* wins/.test(e.text)) r.elections.won++;
      if (/ELECTION: .* loses|PALACE COUP/.test(e.text)) r.elections.lost++;
      if (/driven from office|overthrown/.test(e.text)) r.removed++;
    }
    if (coalitionAgainst(s, c.id)) r.coalitionVsMe++;
    r.maxAgg = Math.max(r.maxAgg, aggOf(s, c.id));
    if (w % 13 === 0) {
      r.stab.push(c.eco.stability); r.growth.push(c.eco.growth); r.appr.push(approval(s, c)); r.pc.push(P?.pc ?? 0);
      for (const f of P?.factions ?? []) r.minMood = Math.min(r.minMood, f.mood);
    }
    if (!c.alive) break;
  }
  r.gdp1 = c.eco.gdp; r.debt1 = c.eco.debt / c.eco.gdp;
  if (s.legacy) r.grade = grade(s.legacy.score);
  return { ...r, arcs: [...r.arcs], laws_in_force: c.politics?.laws.map((l) => l.id) ?? [], alive: c.alive, coalitionWeeks: r.coalitionVsMe };
}

const out = countries.map((n, i) => play(n, Number(process.env.SEEDBASE ?? 100) + i));
process.stdout.write(JSON.stringify(out));
void LAWS;
