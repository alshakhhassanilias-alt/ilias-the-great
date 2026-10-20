/**
 * National character: the country's permanent traits and its long-running challenges, with the responses the
 * player can order.
 */
import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { fmtMoney } from '../format';
import { actChallenge, challengeById, challengesOf, localName, responseBlocked, traitsOf } from '../../sim/character';
import type { Country } from '../../sim/types';

const tone = (v: number) => (v >= 70 ? 'bad' : v >= 40 ? 'warn' : 'good');
const word = (v: number) => (v >= 80 ? 'Critical' : v >= 60 ? 'Severe' : v >= 40 ? 'Serious' : v >= 20 ? 'Contained' : v > 0 ? 'Fading' : 'Overcome');

export function CharacterSection({ c }: { c: Country }) {
  const s = store.state!;
  const mine = c.id === s.player;
  const traits = traitsOf(c);
  const ch = Object.entries(challengesOf(c)).sort((a, b) => b[1].sev - a[1].sev);
  const [open, setOpen] = useState<string | null>(null);
  if (!traits.length && !ch.length) return null;
  return (
    <Section title="National character" hint={mine ? 'what makes your country different' : undefined}>
      {traits.length > 0 && (
        <div className="nc-traits">
          {traits.map((t) => (
            <div className="nc-trait" key={t.id} title={t.effects.join(' · ')}>
              <span className="nc-ico" aria-hidden>{t.icon}</span>
              <div><b>{t.title}</b><small>{t.blurb}</small><em>{t.effects.join(' · ')}</em></div>
            </div>
          ))}
        </div>
      )}
      {ch.length > 0 && <h4 className="nc-h">{mine ? 'Your challenges' : 'Challenges'}</h4>}
      <div className="nc-chals">
        {ch.map(([id, st]) => {
          const d = challengeById(id);
          if (!d) return null;
          const sev = Math.round(st.sev);
          const isOpen = open === id;
          const working = st.until && st.until > s.tick ? st.drift : 0;
          return (
            <div className={`nc-chal ${tone(sev)}`} key={id}>
              <button type="button" className="nc-chal-h" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                <span className="nc-ico" aria-hidden>{d.icon}</span>
                <span className="nc-chal-t"><b>{d.title}</b><small>{localName(c, id) || d.desc}</small></span>
                <span className="nc-sev"><b className={tone(sev)}>{word(sev)}</b><small>{sev}/100</small></span>
              </button>
              <div className="nc-bar"><i style={{ width: `${sev}%` }} /></div>
              {isOpen && (
                <div className="nc-body">
                  <p>{d.desc}</p>
                  <div className="nc-eff"><span>At full strength:</span> {d.effects.join(' · ')}</div>
                  {working ? <div className="nc-eff good">A response is working: {working} a year until {Math.ceil(((st.until ?? 0) - s.tick) / 52 * 10) / 10} more years have passed.</div> : null}
                  {mine && (
                    <div className="nc-resps">
                      {d.responses.map((r) => {
                        const why = responseBlocked(s, c, d, r);
                        return (
                          <div className="nc-resp" key={r.id}>
                            <div><b>{r.label}</b><small>{r.desc}</small>
                              <span className="nc-fx"><b className="good">Severity {r.sev}{r.drift ? `, then ${r.drift}/yr for ${r.years ?? 3} yrs` : ''}</b> · <span className="bad">{r.side}</span></span>
                            </div>
                            <button className="btn" disabled={!!why} title={why ?? undefined} onClick={() => store.act((g) => actChallenge(g, id, r.id))}>
                              {why ? (why.startsWith('Possible') ? 'Later' : '—') : 'Do it'}
                              <small>{why ?? ([r.pc ? `${r.pc} PC` : '', r.cost > 0 ? fmtMoney(r.cost * c.eco.gdp) : r.cost < 0 ? `+${fmtMoney(-r.cost * c.eco.gdp)}` : ''].filter(Boolean).join(' · ') || 'free')}</small>
                            </button>
                          </div>
                        );
                      })}
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
