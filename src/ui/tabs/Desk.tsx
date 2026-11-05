/**
 * Your desk: everything that wants you right now, in one list, most pressing first: emergencies, coalition demands
 * with their deadlines, the promise you made this year, your objectives, idle programmes and opportunities. Every item
 * has one button that does it, with the price on the button.
 */
import { greatById, greatOpen } from '../../sim/great';
import { useState } from 'react';
import { store } from '../../state/store';
import type { Tab } from '../../state/store';
import type { Geo } from '../../sim/geo';
import type { ActionResult } from '../../sim/actions';
import type { Country, GameState } from '../../sim/types';
import { Section } from '../widgets';
import { fmtMoney } from '../format';
import { advisor } from '../explain';
import { goalHelp, guideLevel } from '../guides';
import { activeGoals } from '../../sim/goals';
import { demandDef, demandProgress, ensureCoalition, isDemocracy } from '../../sim/coalition';
import { factionMeta, LAWS, forecast, hasLaw } from '../../sim/domestic';
import { challengeFix, demandFix, expandFix, lawFix } from '../../sim/fixes';
import { CHOICE_TIERS, ensureResearch, pickKey } from '../../sim/research';
import { ensureIndustry } from '../../sim/industry';
import { focusById } from '../../sim/focus';
import { playerWars } from '../../sim/warmode';
import { SCHEMES, actAnswerScheme } from '../../sim/rivals';
import { FACTION_GLYPH, Glyph } from '../art/Glyphs';

type Tone = 'urgent' | 'deadline' | 'promise' | 'goal' | 'idle' | 'chance';
interface Act { label: string; price?: string; run?: (s: GameState, geo: Geo) => ActionResult; tab?: Tab; open?: () => void; note?: string }
export interface DeskItem { key: string; tone: Tone; icon: string; title: string; sub?: string; p?: number; act?: Act; badge?: string }

/** "Build factories (1% of GDP)" → label "Build factories", price "$12B" */
export function priced(c: Country, label: string): { label: string; price?: string } {
  const once = /\s*\(([\d.]+)% of GDP\)/.exec(label);
  if (once) return { label: label.replace(once[0], ''), price: fmtMoney((Number(once[1]) / 100) * c.eco.gdp) };
  const yearly = /\s*by ([\d.]+)% of GDP/.exec(label);
  if (yearly) return { label: label.replace(yearly[0], ''), price: `${fmtMoney((Number(yearly[1]) / 100) * c.eco.gdp)} a year` };
  return { label };
}

export function deskItems(s: GameState, c: Country, geo: Geo, opts: { missionShown?: boolean } = {}): DeskItem[] {
  const out: DeskItem[] = [];
  const gl = guideLevel(s);
  const adv = advisor(c, s, geo);
  for (const a of adv.filter((x) => x.level === 'urgent')) out.push({ key: `adv:${a.id}`, tone: 'urgent', icon: 'alert', title: a.text, act: { ...priced(c, a.label), run: a.run } });
  // a war of yours comes first, the bigger the war the higher (warmode.ts)
  for (const { w, x } of playerWars(s)) {
    if (x.council) out.push({ key: `council:${w.id}`, tone: 'urgent', icon: 'sword', title: `The war council for the ${w.name} is waiting`, sub: `${x.label}: set the war aim, mobilisation and strategy.`, act: { label: 'Convene', open: () => store.notify() } });
    else if (x.tier >= 2) out.push({ key: `war:${w.id}`, tone: 'urgent', icon: 'sword', title: `${x.label}: ${w.name}`, sub: `Week ${s.tick - w.start + 1} · ${(c.mob ?? 0) === 0 && x.tier >= 3 ? 'the country is still on a peacetime footing' : 'the war room has the fronts, the toll and the options'}`, badge: `tier ${x.tier}`, act: { label: 'War room', open: () => store.openWarRoom(w.id) } });
  }
  // the nemesis's latest scheme (rivals.ts)
  const sch = s.rivals?.scheme;
  if (sch && !sch.answered && s.tick - sch.tick < 13 && s.countries[sch.by]?.alive) out.push({ key: 'scheme', tone: 'urgent', icon: 'eye', title: `${SCHEMES[sch.id].title} by ${s.countries[sch.by].name}`, sub: 'Your nemesis is working against you. Answer it, or let it go.', act: { label: SCHEMES[sch.id].answer, price: '8 capital', run: (g) => actAnswerScheme(g) } });
  // the State of the Nation
  const P = s.plan;
  // a great ambition to choose, or the next stage of the one under way (great.ts)
  if (greatOpen(s) && !s.great) out.push({ key: 'great', tone: 'chance', icon: 'star', title: 'Choose a great ambition for the decades ahead', sub: 'Three stages each: a moment for the nation, a monument in your name, prestige for your house.', act: { label: 'Choose', tab: 'goals' } });
  else if (s.great && s.great.stage < 3) { const g = greatById(s.great.id); const st = g?.stages[s.great.stage]; if (g && st) { const pr = st.test(s, c, s.great); if (pr.value >= 0.6) out.push({ key: 'great', tone: 'goal', icon: 'star', title: `${g.title} · stage ${s.great.stage + 1}: ${st.goal}`, sub: `${pr.text} · then ${st.monument} is raised`, p: pr.value, act: { label: 'Goals', tab: 'goals' } }); } }
  if (P?.pending) out.push({ key: 'plan', tone: 'urgent', icon: 'clipboard', title: `The State of the Nation ${P.year} is waiting`, sub: 'Last year’s report card, this year’s focus and your promise.', act: { label: 'Open', open: () => store.openPlan() } });
  else if (P && !c.focus) out.push({ key: 'focus', tone: 'promise', icon: 'compass', title: `Declare what ${P.year} is for`, sub: 'Pick a national focus and make one promise: real bonuses, real trade-offs.', act: { label: 'Plan the year', open: () => store.openPlan() } });
  // coalition demands, soonest deadline first
  const G = c.politics ? ensureCoalition(s, c) : null;
  for (const d of [...(G?.demands ?? [])].sort((a, b) => a.due - b.due)) {
    const def = demandDef(d.id);
    if (!def) continue;
    const fx = demandFix(s, c, d);
    const wk = Math.max(0, d.due - s.tick);
    out.push({ key: `dem:${d.id}`, tone: 'deadline', icon: FACTION_GLYPH[d.f] ?? 'hourglass', title: def.text(d, c), sub: `${factionMeta(d.f).name} · ${isDemocracy(c) ? 'coalition partner' : 'pillar of the regime'} · ${wk} wk left`, p: demandProgress(s, c, d), badge: wk < 13 ? 'due soon' : undefined,
      act: fx ? { label: fx.label, price: fx.price, run: fx.run ? (g) => fx.run!(g) : undefined, tab: fx.tab, note: fx.note } : undefined });
  }
  // objectives (the pledged one first)
  // (the other objectives are on the mission card above, with their own buttons)
  const goals = activeGoals(s).filter((g) => s.goalsDone[g.id] === undefined && (!opts.missionShown || (P?.pledge?.id === g.id && !P.pledge.done)));
  for (const g of goals) {
    const pr = g.progress(s, c);
    const h = gl !== 'none' ? goalHelp(g.id, s, c, geo) : { how: '' };
    const pledged = P?.pledge?.id === g.id && !P.pledge.done;
    out.push({ key: `goal:${g.id}`, tone: pledged ? 'promise' : 'goal', icon: pledged ? 'handshake' : 'target', title: g.title, sub: pledged ? `Your promise for ${P!.year} · ${pr.text}` : pr.text, p: pr.value, badge: pledged ? 'promised' : undefined,
      act: h.fix ? { ...priced(c, h.fix.label), run: h.fix.run, tab: h.fix.tab, open: h.fix.open } : { label: 'Details', tab: 'goals' } });
  }
  // the worst national challenge (an inflation spiral, an insurgency...) and the strongest response within reach
  const ch = challengeFix(s, c);
  if (ch) out.push({ key: 'chal', tone: ch.sev >= 70 ? 'urgent' : 'chance', icon: 'alert', title: `Tackle the ${ch.title}`, sub: `Severity ${Math.round(ch.sev)} of 100 · ${ch.why}`, p: 1 - ch.sev / 100, act: { label: ch.fix.label, price: ch.fix.price, run: (g) => ch.fix.run!(g) } });
  // idle programmes
  const rs = c.rs ? ensureResearch(c) : null;
  if (rs && rs.cur < 0 && rs.lv.some((lv, b) => CHOICE_TIERS.includes(lv + 1) && rs.pick[pickKey(b, lv + 1)] === undefined))
    out.push({ key: 'rs', tone: 'idle', icon: 'flask', title: 'Your scientists are waiting for a decision', sub: 'An either-or technology needs your choice; until then the ministry picks the safe road.', act: { label: 'Choose', tab: 'research' } });
  const ind = c.ind ? ensureIndustry(c) : null;
  if (ind && !(ind.prog?.length) && c.eco.cash > 0.004 * c.eco.gdp) {
    const fx = expandFix(s, c);
    if (fx) out.push({ key: 'ind', tone: 'idle', icon: 'factory', title: 'No industry is being expanded', sub: 'Each level adds output, jobs and exports for good.', act: { label: fx.label, price: fx.price, run: (g) => fx.run!(g) } });
  }
  // political capital piling up: the law most likely to pass
  const pc = c.politics?.pc ?? 0;
  if (pc >= 60) {
    const best = LAWS.filter((l) => !hasLaw(c, l.id) && !(l.excl && hasLaw(c, l.excl)) && !l.req?.(c)).map((l) => ({ l, f: forecast(c, l, 0) })).filter((x) => x.f.cost <= pc && x.f.yes >= 0.6).sort((a, b) => b.f.yes - a.f.yes)[0];
    const fx = best ? lawFix(c, best.l.id) : null;
    if (fx) out.push({ key: 'law', tone: 'chance', icon: 'law', title: `${Math.floor(pc)} political capital to spend`, sub: 'Capital stops growing at 100: use it.', act: { label: fx.label, price: fx.price, run: (g) => fx.run!(g) } });
  }
  for (const a of adv.filter((x) => x.level !== 'urgent')) out.push({ key: `adv:${a.id}`, tone: a.level === 'opportunity' ? 'chance' : 'idle', icon: a.level === 'opportunity' ? 'sparkle' : 'bulb', title: a.text, act: { ...priced(c, a.label), run: a.run } });
  return out;
}

const TONE_LABEL: Record<Tone, string> = { urgent: 'Urgent', deadline: 'Deadline', promise: 'Promise', goal: 'Objective', idle: 'Idle', chance: 'Opportunity' };

let deskCache: { key: string; s: GameState; items: DeskItem[] } | null = null;
export function DeskSection() {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[s.player];
  const [all, setAll] = useState(false);
  // the desk is costly to build (the advisor, law forecasts): once a week, and again after anything you do
  const key = `${s.tick}|${store.actSeq}|${s.player}|${c.focus ?? ''}|${s.plan?.pending ? 1 : 0}`;
  if (deskCache?.key !== key || deskCache.s !== s) deskCache = { key, s, items: deskItems(s, c, geo, { missionShown: true }) };
  const items = deskCache.items;
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  const F = focusById(c.focus);
  const doIt = (a: Act, ev?: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const el = ev?.currentTarget as HTMLElement | undefined;
    const box = el?.getBoundingClientRect();
    const at = box ? { x: box.left + box.width / 2, y: box.top } : { x: ev?.clientX ?? 0, y: ev?.clientY ?? 0 };
    if (a.run) {
      const r = store.act((g) => a.run!(g, geo));
      if (r.ok) { store.deskActs++; store.pop(a.price && /\$/.test(a.price) ? `−${a.price.split(' ')[0]}` : '✓ Done', at.x, at.y, 'gold'); }
      else store.pop('✕ Not now', at.x, at.y, 'bad');
    }
    else if (a.open) { store.deskActs++; a.open(); }
    else if (a.tab) { store.deskActs++; store.select(s.player, null, false); store.setTab(a.tab); }
  };
  return (
    <Section title="Your desk" hint={`${items.length} thing${items.length === 1 ? '' : 's'} want you${F ? ` · ${F.name}` : ''}`}>
      <div className="desk">
        {shown.map((it) => (
          <div key={it.key} className={`desk-item t-${it.tone}`}>
            <span className="desk-ic" aria-hidden="true"><Glyph name={it.icon} size={19} /></span>
            <div className="desk-txt">
              <div className="desk-kind">{TONE_LABEL[it.tone]}{it.badge ? <em>{it.badge}</em> : null}</div>
              <div className="desk-title">{it.title}</div>
              {it.sub && <div className="desk-sub">{it.sub}</div>}
              {it.p !== undefined && <div className="desk-bar"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, it.p)) * 100)}%` }} /></div>}
            </div>
            {it.act && (it.act.note && !it.act.run && !it.act.tab ? <div className="desk-note">{it.act.note}</div> : (
              <button className="desk-do" title={it.act.note} onClick={(e) => doIt(it.act!, e)}>
                <b>{it.act.label}</b>{it.act.price ? <small>{it.act.price}</small> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      {items.length > 5 && <button className="linkbtn desk-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </Section>
  );
}
