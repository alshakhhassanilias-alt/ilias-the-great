/**
 * The Research tab: five ladders of technologies, the world race on each, and what you can do to move faster.
 */
import { useState } from 'react';
import { store } from '../../state/store';
import { Section, Meter, Slider, Note } from '../widgets';
import { fmtMoney, fmtPct } from '../format';
import { setBudget } from '../../sim/actions';
import { nextRand } from '../../sim/rng';
import {
  BRANCHES, CHOICE_TIERS, GRANT_COOLDOWN, SPY_COOLDOWN, actEspionage, actResearchGrant, actSetResearch, branchStanding, ensureResearch,
  espionageTarget, fxText, isChoice, pickKey, researchFactor, researchPoints, rungCost, techAt,
} from '../../sim/research';

const BRANCH_NOTE = ['each rung closed on the frontier: output +1.6%', 'each rung closed on the frontier: output +1%', 'each rung closed on the frontier: output +1.6%', 'each rung closed on the frontier: output +1%', 'each rung: stronger forces'];
const months = (weeks: number) => (weeks > 104 ? `${(weeks / 52).toFixed(1)} years` : `${Math.max(1, Math.round(weeks / 4.33))} month${Math.round(weeks / 4.33) === 1 ? '' : 's'}`);

export function ResearchTab() {
  const s = store.state!;
  const c = s.countries[s.player];
  const rs = ensureResearch(c);
  const rp = researchPoints(s, c);
  const f = researchFactor(s, c);
  const [open, setOpen] = useState<number>(rs.cur >= 0 ? rs.cur : -2);
  const cur = rs.cur;
  const curTier = cur >= 0 ? rs.lv[cur] + 1 : 0;
  const curCost = cur >= 0 ? rungCost(s, c, cur) : 0;
  const eta = cur >= 0 ? Math.max(0, (curCost - rs.acc[cur]) / Math.max(0.01, rp.v)) * 52 : 0;
  const grantWait = Math.max(0, GRANT_COOLDOWN - (s.tick - (rs.grants ?? -999)));
  const spyWait = Math.max(0, SPY_COOLDOWN - (s.tick - (s.stats.spyAt ?? -999)));
  const spy = espionageTarget(s, c);
  return (
    <>
      <Section title="Research" hint={`${rp.v.toFixed(2)} points a year · ${rs.got ?? 0} breakthroughs so far${rs.firsts ? ` · ${rs.firsts} world first${rs.firsts > 1 ? 's' : ''}` : ''}`}>
        <div className="rs-top">
          <div className="rs-edge">
            <small>Your research edge</small>
            <b className={f >= 1.005 ? 'good' : f <= 0.995 ? 'bad' : ''}>{f >= 1 ? '+' : '−'}{Math.abs((f - 1) * 100).toFixed(1)}% output</b>
            <span className="faint">{f >= 1.005 ? 'You have gained on the world’s frontier since you began.' : f <= 0.995 ? 'The world is pulling ahead of you.' : 'You are keeping pace with the world.'}{rs.lead ? ` Innovator's premium +${(rs.lead * 100).toFixed(1)}% (fades).` : ''}</span>
          </div>
          {cur >= 0 ? (
            <div className="rs-now">
              <small>{BRANCHES[cur].icon} Now researching · rung {curTier}</small>
              <b>{techAt(cur, curTier, undefined, rs).name}</b>
              <Meter value={rs.acc[cur] / curCost} color={BRANCHES[cur].color} />
              <span className="faint">{Math.round((100 * rs.acc[cur]) / curCost)}% · about {months(eta)} at this pace</span>
            </div>
          ) : (
            <Note tone="warn">Choose what your scientists work on below. Until you do, the ministry spreads the work where it sees fit.</Note>
          )}
        </div>
        <ul className="rs-parts">
          {rp.parts.map((p, i) => <li key={i}><span>{p.label}</span><b className={p.v >= 0 ? '' : 'bad'}>{p.v >= 0 ? '+' : '−'}{Math.abs(p.v).toFixed(2)}</b></li>)}
        </ul>
        <Slider label="Education & research budget" value={c.budget.education} min={0} max={0.12} step={0.0025} format={fmtPct}
          onChange={(v) => store.act((g) => setBudget(g, g.player, 'education', v))}
          hint={`${fmtMoney(c.budget.education * c.eco.gdp)} a year. The main lever: research points rise with it (with diminishing returns), and so does the bill.`} />
        <div className="btnrow">
          <button className="btn" disabled={grantWait > 0 || cur < 0} onClick={() => store.act((g) => actResearchGrant(g))}>Crash research grants<small>{cur < 0 ? 'choose a research first' : grantWait ? `again in ${grantWait} wk` : `${fmtMoney(0.003 * c.eco.gdp)} · a quarter of the current rung`}</small></button>
          <button className="btn" disabled={spyWait > 0 || !spy} onClick={() => store.act((g) => actEspionage(g, nextRand(g)))}>Industrial espionage<small>{!spy ? (cur < 0 ? 'choose a research first' : 'nobody has it yet') : spyWait ? `agents lie low ${spyWait} wk` : `10 political capital · steal from ${s.countries[spy.id].name} · ${Math.round(spy.p * 100)}% odds · caught: relations −20`}</small></button>
        </div>
      </Section>

      {BRANCHES.map((br, b) => {
        const st = branchStanding(s, c, b);
        const lv = rs.lv[b];
        const isOpen = open === b || (open === -2 && b === 0);
        const next = lv + 1;
        const needPick = isChoice(next) && rs.pick[pickKey(b, next)] === undefined;
        const behind = st.frontier - lv;
        return (
          <section className={`section rs-branch ${cur === b ? 'on' : ''}`} key={br.key} style={{ ['--bc' as string]: br.color }}>
            <button className="rs-bhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : b)}>
              <span className="rs-bicon" aria-hidden="true">{br.icon}</span>
              <span className="grow">
                <b>{br.name}</b>
                <small>Rung {lv}{lv > 10 ? ` (frontier ${lv - 10})` : ''} · world #{st.rank} · {behind > 0 ? <span className="bad">{behind} behind the frontier</span> : <span className="good">at the frontier</span>} · leaders: {st.leaders.map((id) => s.countries[id].iso3).join(', ')}{BRANCH_NOTE[b] ? <> · {BRANCH_NOTE[b]}</> : null}</small>
              </span>
              <span className="rs-lv" aria-hidden="true">{lv}</span>
            </button>
            {cur !== b && !needPick && <button className="btn sm rs-go" onClick={() => store.act((g) => actSetResearch(g, b))}>Research {techAt(b, next, undefined, rs).name}</button>}
            {needPick && (
              <div className="rs-choice">
                <small>Rung {next} is a choice: take one road and the other closes for good.</small>
                {[0, 1].map((a) => {
                  const t = techAt(b, next, a as 0 | 1);
                  return (
                    <button key={a} className="rs-alt" onClick={() => store.act((g) => actSetResearch(g, b, a as 0 | 1))}>
                      <b>{t.name}</b><span>{t.desc}</span><small>{fxText(t.fx).join(' · ')}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {isOpen && (
              <ol className="rs-ladder">
                {Array.from({ length: Math.max(10, lv + 2) }, (_, i) => i + 1).map((t) => {
                  const done = t <= lv, here = t === next;
                  const choice = t <= 10 && CHOICE_TIERS.includes(t);
                  const picked = rs.pick[pickKey(b, t)];
                  const tech = choice && picked === undefined ? null : techAt(b, t, undefined, rs);
                  return (
                    <li key={t} className={`${done ? 'done' : ''} ${here ? 'next' : ''} ${t > next ? 'later' : ''}`}>
                      <span className="rs-n">{done ? '✓' : t}</span>
                      <div className="grow">
                        {tech ? <b>{tech.name}{choice ? <em className="faint"> · chosen road</em> : null}</b>
                          : <b>{techAt(b, t, 0).name} <span className="faint">or</span> {techAt(b, t, 1).name}</b>}
                        {tech && <small>{tech.desc} <span className="rs-fx">{fxText(tech.fx).join(' · ')}</span></small>}
                        {here && cur === b && <Meter value={rs.acc[b] / curCost} color={br.color} />}
                      </div>
                    </li>
                  );
                })}
                {lv >= 10 && <li className="later"><span className="rs-n">∞</span><div className="grow"><b>{br.frontier}</b><small>Beyond the tenth rung research goes on for ever, each level dearer than the last.</small></div></li>}
              </ol>
            )}
          </section>
        );
      })}
    </>
  );
}
