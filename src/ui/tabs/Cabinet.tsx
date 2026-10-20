import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { Portrait, faceFor } from '../art/Portrait';
import { ROLE_META, actAppoint, actCourt, candidates, canReshuffle, loyaltyLabel, ministerEffects, mtraitById } from '../../sim/cabinet';
import { ministerReport } from '../reports';
import { fmtMoney } from '../../sim/util';
import { neighborsOf } from '../../sim/diplomacy';
import type { Minister } from '../../sim/types';

/** Reports are rebuilt every other week (and when a minister changes), not on every repaint. */
const reportCache = new Map<string, ReturnType<typeof ministerReport>>();
function cachedReport(s: Parameters<typeof ministerReport>[0], c: Parameters<typeof ministerReport>[1], m: Minister, near: () => Set<number>) {
  const k = `${s.settings.seed}|${s.tick >> 1}|${m.id}|${m.role}|${m.skill}|${Math.round(m.loyalty / 5)}`;
  let r = reportCache.get(k);
  if (!r) { if (reportCache.size > 64) reportCache.clear(); r = ministerReport(s, c, m, near()); reportCache.set(k, r); }
  return r;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const loyColor = (l: number) => (l >= 55 ? 'var(--green)' : l >= 35 ? 'var(--amber)' : 'var(--red)');

export function MinisterFace({ m, size = 56 }: { m: Minister; size?: number }) {
  const c = store.state!.countries[store.state!.player];
  return <Portrait f={faceFor(c, m.name, 'minister')} size={size} title={m.name} />;
}

/** The cabinet table: each minister reports in their own words, with real numbers. */
export function CabinetSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const [open, setOpen] = useState<string | null>(null);
  const [hire, setHire] = useState<string | null>(null);
  if (!c.cabinet?.length || s.legacy?.status === 'opposition') return null;
  let nearSet: Set<number> | null = null;
  const near = () => (nearSet ??= new Set(neighborsOf(s, store.geo, c.id)));
  return (
    <Section title="Cabinet briefing" hint={`${c.cabinet.length} ministers · tap one for more`}>
      <div className="cabinet">
        {c.cabinet.map((m) => {
          const r = cachedReport(s, c, m, near);
          const t = mtraitById(m.trait);
          const meta = ROLE_META[m.role];
          const isOpen = open === m.role;
          const wait = canReshuffle(s, m.role);
          return (
            <div key={m.id} className={`minister tone-${r.tone} ${isOpen ? 'open' : ''}`}>
              <button className="min-head" onClick={() => setOpen(isOpen ? null : m.role)} aria-expanded={isOpen}>
                <span className="min-face"><MinisterFace m={m} /></span>
                <span className="min-id">
                  <small>{meta.icon} {meta.title}</small>
                  <b>{m.name}</b>
                  <span className="min-tags"><span className="pill" title={t.desc}>{t.icon} {t.title}</span><span className="min-stars" title={`Skill ${m.skill} of 5`}>{stars(m.skill)}</span></span>
                </span>
                <span className="min-loy" title={`Loyalty ${m.loyalty.toFixed(0)}`}><i style={{ width: `${m.loyalty}%`, background: loyColor(m.loyalty) }} /><em style={{ color: loyColor(m.loyalty) }}>{loyaltyLabel(m.loyalty)}</em></span>
              </button>
              <div className="min-say">
                <span className="min-open">{r.opener}</span> “{r.headline}”
              </div>
              {isOpen && (
                <div className="min-more">
                  <ul className="min-lines">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  <div className="min-eff"><b>In office since {Math.max(0, Math.round((s.tick - m.since) / 4.33))} months.</b> Effect on your country: {ministerEffects(m).join(' · ')}. <i>{t.desc}</i></div>
                  <div className="btnrow">
                    {r.go && <button className="btn primary" onClick={() => { store.setTab(r.go!); }}>{r.goLabel ?? 'Go'}</button>}
                    <button className="btn" onClick={() => store.act((g) => actCourt(g, m.id))} title="A private dinner, a medal, their pet project funded">Win them over ({fmtMoney(0.0004 * c.eco.gdp)})</button>
                    <button className="btn" disabled={wait > 0} onClick={() => setHire(hire === m.role ? null : m.role)}>{wait > 0 ? `Reshuffle in ${wait} wk` : hire === m.role ? 'Keep them' : 'Replace…'}</button>
                  </div>
                  {hire === m.role && (
                    <div className="min-cands">
                      <div className="why-title">Who could take over {meta.dept}</div>
                      {candidates(s, m.role).map((k, i) => {
                        const kt = mtraitById(k.trait);
                        return (
                          <div className="min-cand" key={i}>
                            <MinisterFace m={k} size={44} />
                            <div className="grow">
                              <b>{k.name}</b> <span className="pill" title={kt.desc}>{kt.icon} {kt.title}</span> <span className="min-stars">{stars(k.skill)}</span>
                              <div className="faint" style={{ fontSize: 11.5 }}>{ministerEffects(k).join(' · ')}</div>
                            </div>
                            <button className="btn" onClick={() => { store.act((g) => actAppoint(g, m.role, i)); setHire(null); }}>Appoint</button>
                          </div>
                        );
                      })}
                      <div className="faint" style={{ fontSize: 11.5 }}>Sacking a loyal minister unsettles the others (loyalty −4, stability −1). Sacking one caught in a scandal reassures the public.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
