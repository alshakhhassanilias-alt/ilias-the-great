import { useState } from 'react';
import { CoursesSection } from './Courses';
import { AlignmentSection, OrgsSection, OrientBar, orientLabel } from './Alignment';
import { GOV_LABEL } from '../../sim/alignment';
import { orgsOf } from '../../sim/relations';
import { AutopilotBanner } from '../Autopilot';
import { store } from '../../state/store';
import { Note, RelationBar, Section } from '../widgets';
import { relLabel } from '../format';
import { OPS as OPDEFS, opChance, type OpKind } from '../../sim/ops';
import { actOp } from '../../sim/actions';
import { fmtMoney } from '../format';
import { previewReactions } from '../../sim/politics';
import { actAid, actGuarantee, actMediate, actSummit, actUltimatum } from '../../sim/actions';
import { hasGuarantee, guarantorsOf } from '../../sim/relations';
import { actCancel, actDeclareWar, actSanction, actAcceptOffer, actDeclineOffer } from '../../sim/actions';
import { PROPOSAL_LABEL, type Proposal } from '../../sim/diplomacy';
import { GOAL_DESC, GOAL_LABEL, stanceOf, type Goal } from '../../sim/negotiate';
import { alliesOf, areAtWar, baseRelation, relationBreakdown, getRelation, getTreaty, partnersOf, sanctionLevel, warsOf } from '../../sim/relations';
import { grudgesOf } from '../../sim/leaders';
import { assessAttack } from '../../sim/ai';
import { claimStrength } from '../../sim/war';

const KINDS: Proposal[] = ['trade', 'nap', 'alliance', 'coop'];

export function DiplomacyTab({ id }: { id: number }) {
  const s = store.state!;
  const geo = store.geo;
  const mine = id === s.player;
  const c = s.countries[id];
  const [confirmWar, setConfirmWar] = useState(false);

  if (mine) return <OwnDiplomacy />;

  const me = s.countries[s.player];
  const rel = getRelation(s, id, s.player);
  const rl = relLabel(rel);
  const t = getTreaty(s, id, s.player);
  const atWar = areAtWar(s, id, s.player);
  const base = baseRelation(id, s.player, s);
  const treatyBonus = rel - base;
  const mySanction = sanctionLevel(s, s.player, id);
  const theirSanction = sanctionLevel(s, id, s.player);
  const as = assessAttack(s, geo, me, c);
  const wars = warsOf(s, id);
  const claim = claimStrength(id, s.player);
  const allies = alliesOf(s, id);

  return (
    <>
      <Section title="Relations" hint={rl.text}>
        <div className="card">
          <div className="row" style={{ border: 'none' }}><div className="grow"><b className="num" style={{ fontSize: 22 }}>{rel >= 0 ? '+' : ''}{rel.toFixed(0)}</b></div><span className={`pill ${rl.cls}`}>{rl.text}</span></div>
          <RelationBar value={rel} />
          <div className="why">
            <div className="why-title">Why they feel this way</div>
            {relationBreakdown(s, id, s.player).map((p, i) => (
              <div className="why-row" key={i}><span>{p.label}</span><b className={p.v < 0 ? 'bad' : 'good'}>{p.v > 0 ? '+' : ''}{p.v}</b></div>
            ))}
            {grudgesOf(s, id, s.player).slice(0, 3).map((g, i) => <div className="why-row" key={'g' + i}><span>They remember: you {g.why}</span><b className="bad">grudge</b></div>)}
            {claim > 0.3 && <div className="why-row"><span>{c.name} claims land you hold</span><b className="bad">risk of war</b></div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {t?.trade && <span className="pill green">Trade agreement</span>}
          {t?.nap && <span className="pill blue">Non-aggression</span>}
          {t?.alliance && <span className="pill gold">Alliance</span>}
          {t?.coop && <span className="pill blue">Military cooperation</span>}
          {mySanction > 0 && <span className="pill red">You {mySanction === 2 ? 'embargo' : 'sanction'} them</span>}
          {theirSanction > 0 && <span className="pill red">They {theirSanction === 2 ? 'embargo' : 'sanction'} you</span>}
          {atWar && <span className="pill red">AT WAR</span>}
          {!t?.trade && !t?.nap && !t?.alliance && !t?.coop && !atWar && !mySanction && !theirSanction && <span className="pill">No agreements</span>}
        </div>
      </Section>

      {!atWar && (
        <Section title="Agreements" hint="open talks to see what they want and bargain">
          {(() => {
            const st = stanceOf(s, geo, id, { goal: 'trade', give: [] });
            return st.interests.length > 0 && <div className="hint" style={{ marginBottom: 8 }}>{c.name} wants: {st.interests.slice(0, 3).map((i) => i.label.split(':')[0].toLowerCase()).join(', ')}{st.redLines.length ? ` · red line: ${st.redLines[0].toLowerCase()}` : ''}</div>;
          })()}
          <div className="list">
            {([...KINDS, 'aid', ...(theirSanction ? ['relief'] : [])] as Goal[]).map((k) => {
              const has = k !== 'aid' && k !== 'relief' && !!t?.[k as Proposal];
              const ev = !has ? stanceOf(s, geo, id, { goal: k, give: [] }) : null;
              return (
                <div className="card" key={k} style={{ marginBottom: 8 }}>
                  <div className="row" style={{ border: 'none', padding: 0 }}>
                    <div className="grow"><b>{GOAL_LABEL[k]}</b><div className="hint">{GOAL_DESC[k]}</div></div>
                    {has ? <button className="btn" onClick={() => store.act((g) => actCancel(g, g.player, id, k as Proposal), true)}>Cancel</button>
                      : <button className="btn primary" onClick={() => store.openNego(id, k)}>Negotiate…</button>}
                  </div>
                  {ev && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      {ev.blocked ? <b className="bad">Red line: {ev.blocked}</b> : <>As it stands: <b className={ev.p >= 0.6 ? 'good' : ev.p >= 0.35 ? '' : 'bad'}>{Math.round(ev.p * 100)}% chance</b> · {[...ev.factors].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)).slice(0, 2).map((f) => `${f.label} ${f.pts > 0 ? '+' : ''}${f.pts}`).join(' · ')}</>}
                    </div>
                  )}
                  {!has && k !== 'aid' && k !== 'relief' && (() => {
                    const rx = previewReactions(s, s.player, id, k as Proposal);
                    const neg = rx.filter((r) => r.delta < 0).slice(0, 3), pos = rx.filter((r) => r.delta > 0).slice(0, 3);
                    if (!neg.length && !pos.length) return <div className="hint" style={{ marginTop: 3 }}>World reaction: little interest.</div>;
                    return <div className="hint" style={{ marginTop: 3 }}>World reaction: {neg.length > 0 && <span className="bad">↓ {neg.map((r) => s.countries[r.id].name).join(', ')}{rx.filter((r) => r.delta < 0).length > 3 ? ` +${rx.filter((r) => r.delta < 0).length - 3}` : ''}</span>}{neg.length > 0 && pos.length > 0 ? ' · ' : ''}{pos.length > 0 && <span className="good">↑ {pos.map((r) => s.countries[r.id].name).join(', ')}</span>}</div>;
                  })()}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Their outlook">
        <div className="card" style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{c.intent || 'Going about its business'}</div>
          <OrientBar o={c.orient ?? 0} />
          <div className="hint" style={{ margin: '4px 0 6px' }}>{orientLabel(c.orient ?? 0)} · {GOV_LABEL[c.gov] ?? c.gov}{orgsOf(s, id).length ? ` · member of ${orgsOf(s, id).map((o) => o.name).join(', ')}` : ' · in no organisation'}{(c.hostile ?? 0) > 0.05 ? ` · treated as an adversary by the West (${((c.hostile ?? 0) * 100).toFixed(0)}%)` : ''}{c.course ? ` · 🧭 changing course: ${({ west: 'turning West', east: 'turning East', third: 'stepping out of the camps', region: 'building a regional bloc' } as Record<string, string>)[c.course.id]} (step ${c.course.stage + 1})` : ''}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {c.ai.aggression > 0.7 && <span className="pill red">Hawkish</span>}{c.ai.aggression < 0.2 && <span className="pill green">Pacifist</span>}
            {c.ai.expansion > 0.5 && <span className="pill red">Expansionist</span>}{c.ai.trade > 0.7 && <span className="pill blue">Mercantile</span>}
            {c.ai.ideology > 0.6 && <span className="pill gold">Ideological</span>}{c.ai.caution > 0.65 && <span className="pill">Cautious</span>}
            {c.mil.nuclear && <span className="pill red">☢ Nuclear</span>}
            {guarantorsOf(s, id).length > 0 && <span className="pill blue">Guaranteed by {guarantorsOf(s, id).slice(0, 2).map((g) => s.countries[g].name).join(', ')}</span>}
          </div>
        </div>
      </Section>

      <Section title="Statecraft" hint="shape the world around them">
        <div className="btnrow">
          <button className={`btn ${hasGuarantee(s, s.player, id) ? 'primary' : ''}`} onClick={() => store.act((g) => actGuarantee(g, g.player, id, !hasGuarantee(g, g.player, id)))}>
            {hasGuarantee(s, s.player, id) ? 'Withdraw guarantee' : 'Guarantee their security'}<small>if attacked you must decide to defend</small>
          </button>
          <button className="btn" onClick={() => store.act((g) => actAid(g, g.player, id, 0.003))}>Send aid<small>{fmtMoney(0.003 * me.eco.gdp)} · relations up</small></button>
          <button className="btn" onClick={() => store.act((g) => actSummit(g, g.player, id))}>Hold a summit<small>{fmtMoney(0.001 * me.eco.gdp)} · relations +9</small></button>
        </div>
        {!atWar && (() => {
          const odds = Math.max(0.02, Math.min(0.9, (as.ratio - 1.4) / 2.2));
          return (
            <div className="card" style={{ marginTop: 8 }}>
              <div className="lab" style={{ fontWeight: 600 }}>Coercion</div>
              <div className="hint" style={{ margin: '2px 0 8px' }}>An ultimatum can win land or money without a war, if they fear you. Odds of compliance ≈ {(odds * 100).toFixed(0)}%. Refusal costs relations and reputation.</div>
              <div className="btnrow">
                <button className="btn danger" onClick={() => { const r = store.act((g) => actUltimatum(g, geo, g.player, id, 'cede')); void r; }}>Demand a border region</button>
                <button className="btn danger" onClick={() => { const r = store.act((g) => actUltimatum(g, geo, g.player, id, 'tribute')); void r; }}>Demand tribute (1.5% GDP)</button>
              </div>
            </div>
          );
        })()}
        {wars.filter((w) => !w.attackers.includes(s.player) && !w.defenders.includes(s.player)).map((w) => (
          <button key={w.id} className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => store.act((g) => actMediate(g, geo, g.player, w.id))}>
            Offer to mediate the {w.name}<small>{fmtMoney(0.0025 * me.eco.gdp)} · succeeds more often when both sides are exhausted</small>
          </button>
        ))}
      </Section>

      <Section title="Economic pressure">
        <div className="btnrow">
          <button className={`btn ${mySanction === 1 ? 'primary' : ''}`} onClick={() => store.act((g) => actSanction(g, g.player, id, mySanction === 1 ? 0 : 1))}>
            {mySanction === 1 ? 'Lift sanctions' : 'Impose sanctions'}<small>cuts trade; hurts both</small>
          </button>
          <button className={`btn ${mySanction === 2 ? 'primary' : ''}`} onClick={() => store.act((g) => actSanction(g, g.player, id, mySanction === 2 ? 0 : 2))}>
            {mySanction === 2 ? 'Lift embargo' : 'Full embargo'}<small>stronger, costs you more</small>
          </button>
        </div>
      </Section>

      <Section title="Covert operations" hint={`your intel ${(me.mil.intel * 100).toFixed(0)} vs ${(c.mil.intel * 100).toFixed(0)}`}>
        <div className="list">
          {(Object.keys(OPDEFS) as OpKind[]).map((k) => {
            const d = OPDEFS[k];
            const left = Math.ceil((s.opCooldown[`${id}:${k}`] ?? -999) + d.cooldown - s.tick);
            return (
              <button key={k} className="btn" style={{ textAlign: 'left', marginBottom: 6 }} disabled={left > 0}
                onClick={() => { const r = store.act((g) => actOp(g, g.player, id, k), true); store.toast(r.message, r.ok ? 'diplo' : 'danger'); }}>
                {d.label}<small>{d.desc} · {fmtMoney(d.cost * me.eco.gdp)} · {Math.round(opChance(s, s.player, id, k) * 100)}% success{left > 0 ? ` · ready in ${left}w` : ''}</small>
              </button>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 11 }}>Failure exposes your agents: relations −18 and reputation −4. Better intelligence services improve the odds.</div>
      </Section>

      <Section title="Standing">
        <div className="card" style={{ fontSize: 13 }}>
          <div className="row" style={{ border: 'none' }}><div className="grow">Reputation of {c.name}</div><div className="val">{c.reputation.toFixed(0)}</div></div>
          <div className="row"><div className="grow">Allies</div><div className="val" style={{ textAlign: 'right', fontWeight: 400 }}>{allies.length ? allies.slice(0, 5).map((a) => s.countries[a].name).join(', ') + (allies.length > 5 ? ` +${allies.length - 5}` : '') : 'none'}</div></div>
          <div className="row"><div className="grow">Trade partners</div><div className="val" style={{ fontWeight: 400 }}>{partnersOf(s, id, 'trade').length}</div></div>
          {wars.length > 0 && <div className="row"><div className="grow">At war with</div><div className="val" style={{ textAlign: 'right', fontWeight: 400 }}>{wars.map((w) => w.name).join(', ')}</div></div>}
        </div>
      </Section>

      <Section title="War">
        {atWar ? (
          <button className="btn primary" style={{ width: '100%' }} onClick={() => store.openPeace(id)}>Negotiate peace</button>
        ) : confirmWar ? (
          <div className="note bad">
            <b>Declare war on {c.name}?</b>
            <div style={{ margin: '6px 0' }}>Estimated attack strength {as.ratio.toFixed(2)}× their defence{as.allies > 0 ? ' (including allies who may join)' : ''}{as.nuclear ? '; they have a nuclear deterrent' : ''}. {t?.nap || t?.alliance ? 'This breaks a treaty and hurts your reputation. ' : ''}Other nations will react and your economy will be strained.</div>
            <div className="btnrow">
              <button className="btn danger" onClick={() => { const r = store.act((g) => actDeclareWar(g, geo, g.player, id)); if (r.ok) { store.setTab('military'); } setConfirmWar(false); }}>Declare war</button>
              <button className="btn" onClick={() => setConfirmWar(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn danger" style={{ width: '100%' }} onClick={() => setConfirmWar(true)}>Declare war…<small>effective immediately</small></button>
        )}
        {!atWar && as.ratio < 0.8 && <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Their defence is currently stronger than your offence ({as.ratio.toFixed(2)}×).</div>}
      </Section>
    </>
  );
}

function OwnDiplomacy() {
  const s = store.state!;
  const me = s.countries[s.player];
  const list = (kind: 'trade' | 'nap' | 'coop') => partnersOf(s, s.player, kind);
  const allies = alliesOf(s, s.player);
  const imposed = s.countries.filter((o) => o.alive && sanctionLevel(s, s.player, o.id) > 0);
  const against = s.countries.filter((o) => o.alive && sanctionLevel(s, o.id, s.player) > 0);
  const sel = (id: number) => store.select(id, null, true);
  const chips = (ids: number[]) => ids.length ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {ids.map((x) => <button key={x} className="pill" onClick={() => sel(x)} style={{ cursor: 'pointer' }}>{s.countries[x].name}</button>)}
    </div>
  ) : <span className="faint">none</span>;
  return (
    <>
      <AutopilotBanner area="diplomacy" />
      <AlignmentSection />
      <CoursesSection />
      {s.offers.length > 0 && (
        <Section title="Pending offers">
          {s.offers.map((o) => (
            <div className="offer" key={o.id} style={{ marginBottom: 8 }}>
              <b>{s.countries[o.from].name}</b> proposes {o.kind === 'peace' ? `peace (${o.terms?.kind.replace('_', ' ')}${o.terms?.share ? `, ${(o.terms.share * 100).toFixed(0)}%` : ''})` : `a ${PROPOSAL_LABEL[o.kind as Proposal].toLowerCase()}`}.
              <div className="btnrow"><button className="btn good" onClick={() => store.act((g) => actAcceptOffer(g, geo(), o.id))}>Accept</button><button className="btn" onClick={() => store.act((g) => actDeclineOffer(g, o.id), true)}>Decline</button></div>
            </div>
          ))}
        </Section>
      )}
      <Section title="Alliances & treaties" hint={s.settings.defensiveAlliances ? 'defensive alliances ON' : 'defensive alliances OFF'}>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div><div className="hint" style={{ marginBottom: 4 }}>Allies ({allies.length})</div>{chips(allies)}</div>
          <div><div className="hint" style={{ marginBottom: 4 }}>Trade agreements ({list('trade').length})</div>{chips(list('trade'))}</div>
          <div><div className="hint" style={{ marginBottom: 4 }}>Non-aggression pacts ({list('nap').length})</div>{chips(list('nap'))}</div>
          <div><div className="hint" style={{ marginBottom: 4 }}>Military cooperation ({list('coop').length})</div>{chips(list('coop'))}</div>
        </div>
      </Section>
      <OrgsSection />
      <Section title="Sanctions">
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div><div className="hint" style={{ marginBottom: 4 }}>You sanction</div>{chips(imposed.map((x) => x.id))}</div>
          <div><div className="hint" style={{ marginBottom: 4 }}>Sanctioned by</div>{chips(against.map((x) => x.id))}</div>
        </div>
      </Section>
      <Note>Reputation: <b>{me.reputation.toFixed(0)}/100</b>. Aggression and broken treaties lower it; honouring agreements keeps it high. Select any country on the map to negotiate with it.</Note>
    </>
  );
}
const geo = () => store.geo;
