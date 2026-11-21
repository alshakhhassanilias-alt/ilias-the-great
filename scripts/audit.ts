/**
 * Audit: a busy bot plays many full games (it answers every decision with a random sensible option, fights bills, builds,
 * campaigns, holds summits and, in every third game, goes to war and plans operations). Every week every country is
 * checked for broken numbers (NaN, out-of-range values, dead owners, broken event text); each game is saved, loaded
 * and played on; one game is played twice to prove it is deterministic; and the balance is printed: growth, debt,
 * stability, approval, time in office, elections, bills, operations, summits, the yearly grades and the final legacy.
 *   npm run audit -- [years] [Country,...]     MODE=sandbox|legacy (default legacy) · HAWK=1 · OUT=report.txt
 *   TRACE=1 prints every change of office, TRACE2=1 a yearly line per game.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildGeo, type RawWorld } from '../src/sim/geo';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS, type GameState, type FactionId } from '../src/sim/types';
import { NAME_TO_ID, isAtWar, areAtWar } from '../src/sim/relations';
import { eventById, resolveEvent } from '../src/sim/events';
import { LAWS, forecast, hasLaw, FACTIONS } from '../src/sim/domestic';
import { actIntroduceBill, actBillMove, activeBill, billCost, moveCheck, passOdds, previewMove as billPreview, MOVE_META, type BillMove } from '../src/sim/bill';
import { actChooseAgenda, grade } from '../src/sim/legacy';
import { approval } from '../src/sim/approval';
import { actBuildRung, actBuildStation, nextRung, TRACKS } from '../src/sim/develop';
import { actCampaign, credibility, regionPolls, ISSUES } from '../src/sim/campaign';
import { actSummitBegin, actSummitApproach, actSummitClose, summitWhy } from '../src/sim/summit';
import { actPlanOperation, activeOp, opTargets } from '../src/sim/operations';
import { actDeclareWar } from '../src/sim/actions';
import { neighborsOf } from '../src/sim/diplomacy';
import { strength } from '../src/sim/military';
import { serialize, deserialize } from '../src/sim/save';
import { setGeoRef } from '../src/sim/geoRef';

const years = Number(process.argv[2] ?? 20);
const names = (process.argv[3] ?? 'United States of America,Germany,France,Brazil,India,Japan,Poland,Turkey,Russia,China,Nigeria,Egypt,Iran,Indonesia,Mexico,Saudi Arabia').split(',');
const geo = buildGeo(JSON.parse(fs.readFileSync('src/data/generated/world.json', 'utf8')) as RawWorld);
setGeoRef(geo);
const mode = (process.env.MODE ?? 'legacy') as 'legacy' | 'sandbox';

const errors = new Map<string, { n: number; first: string }>();
const err = (k: string, detail: string) => { const e = errors.get(k); if (e) e.n++; else errors.set(k, { n: 1, first: detail }); };
const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const noTime = (t: string) => t.replace(/"savedAt":"[^"]*"/, '');
const bad = (t: string) => /undefined|NaN|\[object|Infinity|null\b/.test(t);

function check(s: GameState, where: string) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const e = c.eco as unknown as Record<string, unknown>;
    for (const k of ['gdp', 'pop', 'cash', 'debt', 'stability', 'inflation', 'unemployment', 'growth', 'tfp', 'capital', 'laborForce', 'energyCap', 'foodCap']) if (k in e && !fin(e[k])) err(`eco.${k} not finite`, `${c.name} ${where} ${e[k]}`);
    if (!(c.eco.gdp > 0)) err('gdp <= 0', `${c.name} ${where} ${c.eco.gdp}`);
    if (!(c.eco.pop > 0)) err('pop <= 0', `${c.name} ${where}`);
    if (c.eco.stability < 0 || c.eco.stability > 100) err('stability out of 0..100', `${c.name} ${where} ${c.eco.stability}`);
    if (c.eco.unemployment < 0 || c.eco.unemployment > 1) err('unemployment out of 0..1', `${c.name} ${where} ${c.eco.unemployment}`);
    if (c.eco.debt < -1e-6 * c.eco.gdp) err('negative debt', `${c.name} ${where} ${c.eco.debt}`);
    const m = c.mil as unknown as Record<string, unknown>;
    for (const k of ['troops', 'readiness', 'tech', 'supply', 'intel', 'warSupport', 'exhaustion', 'casualties']) if (k in m && !fin(m[k])) err(`mil.${k} not finite`, `${c.name} ${where} ${m[k]}`);
    if (c.mil.troops < 0) err('negative troops', `${c.name} ${where} ${c.mil.troops}`);
    if (!fin(c.reputation) || c.reputation < 0 || c.reputation > 100) err('reputation out of range', `${c.name} ${where} ${c.reputation}`);
    for (const [k, v] of Object.entries(c.budget)) if (!fin(v)) err(`budget.${k} not finite`, `${c.name} ${where}`);
  }
  for (let p = 0; p < s.owner.length; p++) { const o = s.owner[p]; if (o < 0 || o >= s.countries.length) err('owner id invalid', `${p} ${o}`); else if (!s.countries[o].alive) err('province owned by a dead country', `${p} ${s.countries[o].name} ${where}`); }
  for (const w of s.wars) for (const x of [...w.attackers, ...w.defenders]) if (!s.countries[x]?.alive) err('war with a dead side', `${where} ${s.countries[x]?.name}`);
  const c = s.countries[s.player], P = c.politics;
  if (P) {
    if (!(P.pc >= 0 && P.pc <= 100)) err('pc out of 0..100', `${where} ${P.pc}`);
    for (const f of P.factions) if (!(f.mood >= 0 && f.mood <= 100) || !fin(f.mem)) err('faction mood out of range', `${where} ${f.id} ${f.mood}`);
    const sup = P.factions.reduce((t, f) => t + f.support, 0);
    if (Math.abs(sup - 100) > 0.5) err('faction support does not sum to 100', `${where} ${sup}`);
    const ids = P.laws.map((l) => l.id);
    if (new Set(ids).size !== ids.length) err('a law in force twice', `${where} ${ids}`);
    const b = P.bill;
    if (b && b.status === 'open' && (b.moves < 0 || b.moves > 2 || b.vote < b.started)) err('bill state broken', `${where} ${JSON.stringify({ m: b.moves, v: b.vote, st: b.started })}`);
    if ((P.ious?.length ?? 0) > 2) err('more than two favours owed', where);
  }
  if ((s.operations ?? []).filter((o) => o.status === 'running' || o.status === 'preparing').length > 1) err('two operations at once', where);
  if (s.inbox.length > 8) err('inbox overflow', `${where} ${s.inbox.length}`);
  for (const it of s.inbox) {
    let def; try { def = eventById(it.id); } catch { err('inbox event missing', it.id); continue; }
    if (!def) { err('inbox event missing', it.id); continue; }
    try {
      const t = typeof def.text === 'function' ? def.text(s, c, it.data) : def.text;
      if (bad(String(t))) err('event text broken', `${it.id}: ${String(t).slice(0, 160)}`);
      for (const o of def.options) if (bad(o.label + ' ' + o.hint)) err('event option text broken', `${it.id}: ${o.label} | ${o.hint}`);
    } catch (x) { err('event text throws', `${it.id}: ${String(x).slice(0, 120)}`); }
  }
  if (s.legacy && !fin(s.legacy.score)) err('legacy score not finite', where);
}

let rng = 1;
const rnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

async function play(name: string, seed: number, hawk: boolean, yrs = years) {
  rng = seed * 7919 + 1;
  const s = createGame(geo, { ...DEFAULT_SETTINGS, seed, mode }, NAME_TO_ID[name]);
  const c = s.countries[s.player];
  const R = { name, hawk, gdp0: c.eco.gdp, events: 0, maxGap: 0, gap: 0, laws: 0, billsWon: 0, billsLost: 0, betrayed: 0, pcFull: 0, pcSum: 0, stabMin: 100, stabSum: 0, apprSum: 0, n: 0, wars: 0, opsWon: 0, opsLost: 0, summits: 0, rungs: 0, elections: { won: 0, lost: 0 }, inOffice: 0, gradeEnd: '', alive: true, debtEnd: 0, inflMax: 0, msPerTick: 0, worldG: 0, defaults: 0, coups: 0 };
  const world0 = s.countries.reduce((t, x) => t + x.baseline.gdp, 0);
  let last = 0;
  const t0 = performance.now();
  for (let w = 0; w < 52 * yrs; w++) {
    const L = s.legacy;
    const office = !L || L.status === 'office';
    // decisions: a random sensible option (so every branch gets exercised)
    for (const it of [...s.inbox]) {
      R.events++;
      const def = eventById(it.id);
      const en = def.options.map((o) => { try { return !o.enabled || o.enabled(s, c); } catch (x) { err('option.enabled throws', `${it.id} ${String(x).slice(0, 80)}`); return false; } });
      const risky = (i: number) => /declare war|risk of war|strike back|resign|step down|stand down|retire/i.test(def.options[i].label + ' ' + def.options[i].hint);
      const quit = (i: number) => /resign|step down|stand down|retire/i.test(def.options[i].label);
      const ok = en.map((v, i) => (v && !quit(i) && (hawk || !risky(i)) ? i : -1)).filter((i) => i >= 0);
      const k = ok.length ? ok[Math.floor(rnd() * ok.length)] : Math.max(0, en.indexOf(true));
      try { resolveEvent(s, geo, k, it.uid); } catch (x) { err('resolveEvent throws', `${it.id}#${k} ${String((x as Error).stack).slice(0, 200)}`); s.inbox = s.inbox.filter((y) => y.uid !== it.uid); }
    }
    if (L?.hand.length) actChooseAgenda(s, L.hand.slice(0, 3));
    const P = c.politics;
    if (P && office && c.alive) {
      // bills: one at a time, played well
      if (!activeBill(s) && w % 8 === 2) {
        const cand = LAWS.filter((l) => !hasLaw(c, l.id) && !(l.excl && hasLaw(c, l.excl)) && !l.req?.(c) && (s.stats[`lawTry:${l.id}`] ?? -999) < s.tick - 26).map((l) => ({ l, f: forecast(c, l, 0).yes })).sort((a, b) => b.f - a.f).slice(0, 5);
        const pick = cand[Math.floor(rnd() * cand.length)];
        if (pick && P.pc >= billCost(c, pick.l) + 12) actIntroduceBill(s, pick.l.id);
      }
      const b = activeBill(s);
      if (b) for (let k = 0; k < 2 && b.moves > 0 && b.status === 'open'; k++) {
        if (passOdds(s, b) > 0.9) break;
        let best: { m: BillMove; f?: FactionId; v: number } | null = null;
        for (const m of Object.keys(MOVE_META) as BillMove[]) for (const f of MOVE_META[m].per ? FACTIONS.map((x) => x.id) : [undefined]) {
          if (m === 'delay') continue;
          const ch = moveCheck(s, b, m, f);
          if (!ch.ok) continue;
          const pv = billPreview(s, b, m, f);
          const v = pv.after - pv.before - ch.pc * 0.6 - (ch.risk ?? 0) * 15 - (m === 'deal' ? 12 : 0) - (ch.cash ? 3 : 0);
          if (!best || v > best.v) best = { m, f, v };
        }
        if (!best || best.v <= 0) break;
        actBillMove(s, best.m, best.f);
      }
      // development
      if (w % 5 === 1) { const t = TRACKS[Math.floor(rnd() * TRACKS.length)].id; const nr = nextRung(c, t); if (nr.rung && !nr.why && c.eco.cash > nr.cost * 2) { const r = actBuildRung(s, t); if (r.ok) R.rungs++; } }
      if (w % 13 === 7 && c.eco.energyUnmet > 0.02) actBuildStation(s, rnd() < 0.5 ? 'renew' : 'gas');
      // summits
      if (w % 37 === 11 && !s.summit) {
        const others = s.countries.filter((x) => x.alive && x.id !== c.id && !summitWhy(s, x.id)).sort((a, z) => z.eco.gdp - a.eco.gdp).slice(0, 12);
        const t = others[Math.floor(rnd() * others.length)];
        if (t && actSummitBegin(s, t.id, 'neutral', ['trade']).ok) { actSummitApproach(s, 'charm'); actSummitApproach(s, 'common'); actSummitApproach(s, 'respect'); const r = actSummitClose(s, geo, 'friendship'); if (r.ok) R.summits++; }
      }
      // war and operations
      if (hawk && w === 52 * 3 + 10 && !isAtWar(s, c.id)) {
        const nb = neighborsOf(s, geo, c.id).filter((x) => !areAtWar(s, c.id, x) && strength(s.countries[x]) < strength(c) * 0.6).sort((a, b) => strength(s.countries[a]) - strength(s.countries[b]));
        if (nb[0] !== undefined) actDeclareWar(s, geo, c.id, nb[0]);
      }
      if (isAtWar(s, c.id) && !activeOp(s)) {
        const t = opTargets(s, geo).filter((x) => x.kind !== 'hold')[0] ?? opTargets(s, geo)[0];
        const g = (c.generals ?? []).find((x) => x.status === 'active');
        if (t && g && w % 3 === 0) actPlanOperation(s, geo, { kind: t.kind, target: t.prov, war: t.war.id, enemy: t.enemy, general: g.id, force: 'standard', prep: t.kind === 'hold' ? 0 : 4, deception: 'none', support: [] });
      }
    }
    // the campaign
    const cm = s.campaign;
    if (cm && cm.days > 0) {
      const polls = regionPolls(s, cm);
      const ri = polls.map((p, i) => ({ i, v: p.r.w * (1 - Math.abs(p.share - 50) / 50) })).sort((a, b) => b.v - a.v)[0]?.i ?? 0;
      const cr = credibility(s, c);
      const issue = [...ISSUES].sort((a, b) => cr[b.id] * cm.regions[ri].sal[b.id] - cr[a.id] * cm.regions[ri].sal[a.id])[0].id;
      try { actCampaign(s, 'rally', ri, issue); } catch (x) { err('actCampaign throws', String(x).slice(0, 120)); }
    }
    try { tick(s, geo); } catch (x) { err('tick throws', `${name} w${w} ${String((x as Error).stack).slice(0, 300)}`); break; }
    check(s, `${name} y${(w / 52).toFixed(1)}`);
    let any = false;
    for (const e of s.log) {
      if (e.seq <= last) continue;
      last = e.seq;
      if (bad(e.text)) err('log text broken', e.text.slice(0, 160));
      if (!e.countries.includes(c.id)) continue;
      any = true;
      if (/OPERATION .* SUCCEEDS/.test(e.text)) R.opsWon++;
      if (/OPERATION .* FAILS/.test(e.text)) R.opsLost++;
      if (/declared war/.test(e.text)) R.wars++;
      if (/THE VOTE: .* PASSES/.test(e.text)) R.billsWon++;
      if (/THE VOTE: .* FALLS/.test(e.text)) R.billsLost++;
      if (/BETRAYED/.test(e.text)) R.betrayed++;
      if (/ELECTION: .* wins|PARTY CONGRESS: .* wins/.test(e.text)) R.elections.won++;
      if (/ELECTION: .* loses|PALACE COUP: .*ousted|PARTY CONGRESS: .* loses/.test(e.text)) R.elections.lost++;
      if (/defaulted/.test(e.text)) R.defaults++;
      if (/COUP/.test(e.text)) R.coups++;
    }
    if (process.env.TRACE && s.legacy && s.legacy.status !== (R as any).st) { (R as any).st = s.legacy.status; console.error(`${name} y${(w / 52).toFixed(1)} -> ${s.legacy.status}  stab ${c.eco.stability.toFixed(0)} infl ${(c.eco.inflation * 100).toFixed(0)}% appr ${approval(s, c).toFixed(0)} | ${s.log.filter((e) => e.countries.includes(c.id)).slice(-3).map((e) => e.text.slice(0, 110)).join(' || ')}`); }
    if (process.env.TRACE2 && w % 52 === 0) console.error(`${name} y${w / 52} stab ${c.eco.stability.toFixed(0)} gdp ${(c.eco.gdp / R.gdp0).toFixed(2)} real ${(c.eco.realGdp / 1).toExponential(2)} infl ${(c.eco.inflation * 100).toFixed(0)} u ${(c.eco.unemployment * 100).toFixed(0)} debt ${(c.eco.debt / c.eco.gdp * 100).toFixed(0)} sanc ${(c.eco.sanctionShare * 100).toFixed(0)} provs ${c.provinces.length} occ ${(c.eco.occupation * 100).toFixed(0)} dmg ${(c.eco.damage * 100).toFixed(0)} wars ${s.wars.filter((x) => x.attackers.includes(c.id) || x.defenders.includes(c.id)).map((x) => [...x.attackers, ...x.defenders].map((i) => s.countries[i].name.slice(0, 8)).join('/')).join(';')} status ${s.legacy?.status}`);
    if (process.env.TRACE2 && w % 104 === 0 && c.eco.sanctionShare > 0.2) { const { sanctionLevel, getRelation } = await import('../src/sim/relations'); const { opinionOf } = await import('../src/sim/minds'); console.error('  sanctioned by', s.countries.filter((x) => x.alive && sanctionLevel(s, x.id, c.id) > 0).map((x) => `${x.name.slice(0, 10)}(L${sanctionLevel(s, x.id, c.id)} rel ${getRelation(s, x.id, c.id).toFixed(0)} op ${opinionOf(s, x.id, c.id).v.toFixed(0)} ideo ${x.ai?.ideology?.toFixed(2)})`).slice(0, 12).join(' ')); }
    R.gap = s.inbox.length || any ? 0 : R.gap + 1;
    R.maxGap = Math.max(R.maxGap, R.gap);
    if (P) { R.pcSum += P.pc; if (P.pc >= 99 && office) R.pcFull++; }
    R.stabMin = Math.min(R.stabMin, c.eco.stability); R.stabSum += c.eco.stability; R.apprSum += approval(s, c); R.n++;
    if (office) R.inOffice++;
    R.inflMax = Math.max(R.inflMax, c.eco.inflation);
    if (!c.alive) { R.alive = false; break; }
  }
  R.msPerTick = (performance.now() - t0) / Math.max(1, R.n);
  R.laws = c.politics?.laws.length ?? 0;
  R.debtEnd = c.eco.debt / c.eco.gdp;
  (R as any).years = (s.plan?.history ?? []).map((y) => y.grade).join('');
  R.gradeEnd = s.legacy ? `${grade(s.legacy.score)} ${Math.round(s.legacy.score)} [${Object.entries(s.legacy.parts).filter(([, v]) => Math.abs(v as number) >= 15).sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number)).map(([k, v]) => `${k} ${Math.round(v as number)}`).join(', ')}]` : '';
  R.worldG = s.countries.reduce((t, x) => t + (x.alive ? x.eco.gdp : 0), 0) / world0;
  // the save survives a round trip and the game goes on
  try {
    const txt = serialize(s);
    const s2 = deserialize(txt, geo.provinces.length);
    if (noTime(serialize(s2)) !== noTime(txt)) err('save round trip changes the game', name);
    for (let i = 0; i < 6; i++) tick(s2, geo);
  } catch (x) { err('save/load throws', `${name} ${String(x).slice(0, 160)}`); }
  return { ...R, gdpX: c.eco.gdp / R.gdp0, stabAvg: R.stabSum / R.n, apprAvg: R.apprSum / R.n, pcAvg: R.pcSum / R.n, pcFullShare: R.pcFull / R.n, officeShare: R.inOffice / R.n, state: s };
}

// determinism: the same game twice is the same game
{
  const a = (await play('Poland', 5, true, 2)).state, b = (await play('Poland', 5, true, 2)).state;
  const h = (x: GameState) => createHash('sha1').update(noTime(serialize(x))).digest('hex');
  if (h(a) !== h(b)) err('not deterministic', 'Poland seed 5, 2 years');
}
const rows: any[] = [];
for (const [i, n] of names.entries()) { const r = await play(n, 200 + i, process.env.HAWK === '1' || i % 3 === 0); rows.push({ ...r, state: undefined }); }
const f1 = (v: number) => v.toFixed(1), pc = (v: number) => `${Math.round(v * 100)}%`;
const out: string[] = [];
out.push(`MODE ${mode}  years ${years}`);
out.push('country'.padEnd(26) + 'hawk alive gdpX worldX debt stabAvg/min appr  pc  pcFull office elec W/L bills W/L betray laws events maxGap wars ops W/L summ rungs infMax grade ms/t');
for (const r of rows) out.push(`${r.name.slice(0, 25).padEnd(26)}${r.hawk ? ' H  ' : '    '} ${r.alive ? 'y' : 'N'}    ${f1(r.gdpX).padStart(4)} ${f1(r.worldG).padStart(5)} ${pc(r.debtEnd).padStart(5)} ${f1(r.stabAvg).padStart(5)}/${f1(r.stabMin).padStart(4)} ${f1(r.apprAvg).padStart(5)} ${f1(r.pcAvg).padStart(4)} ${pc(r.pcFullShare).padStart(5)} ${pc(r.officeShare).padStart(5)}  ${r.elections.won}/${r.elections.lost}     ${r.billsWon}/${r.billsLost}     ${r.betrayed}     ${r.laws}   ${r.events}   ${r.maxGap}   ${r.wars}   ${r.opsWon}/${r.opsLost}  ${r.summits}  ${r.rungs}  ${pc(r.inflMax)}  ${r.gradeEnd}  ${r.msPerTick.toFixed(1)}  years ${(r as any).years}`);
out.push('', `ERRORS (${errors.size})`);
for (const [k, v] of errors) out.push(`  ${k} x${v.n}: ${v.first}`);
fs.writeFileSync(process.env.OUT ?? '/dev/stdout', out.join('\n') + '\n');
