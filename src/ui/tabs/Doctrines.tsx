import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { fmtMoney } from '../format';
import { actSetDoctrine } from '../../sim/actions';
import { fundingText } from '../../sim/treasury';
import { DOCTRINES, REFORM_COOLDOWN, REFORM_COST, SLOT_LABEL, doctrineOf, slotOptions, type Doctrine } from '../../sim/doctrines';

const SLOTS: Doctrine['slot'][] = ['eco', 'mil', 'dip'];

/** Three standing choices that define the country. Pick a chip to read its trade-offs, then adopt it. */
export function DoctrinesSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const cur = doctrineOf(c);
  const [view, setView] = useState<Partial<Record<Doctrine['slot'], string>>>({});
  const wait = Math.max(0, REFORM_COOLDOWN - (s.tick - cur.changed));
  const cost = REFORM_COST * c.eco.gdp;
  return (
    <Section title="National doctrines" hint={wait > 0 && cur.changed > -9000 ? `next reform in ${wait} wk` : 'each has a catch'}>
      <div className="card">
        {SLOTS.map((slot) => {
          const chosen = cur[slot];
          const shown = view[slot] ?? chosen;
          const d = DOCTRINES.find((x) => x.id === shown);
          return (
            <div className="doc-slot" key={slot}>
              <div className="doc-head"><b>{SLOT_LABEL[slot]}</b><span className="faint">{chosen ? DOCTRINES.find((x) => x.id === chosen)!.title : 'not chosen'}</span></div>
              <div className="doc-chips" role="group" aria-label={SLOT_LABEL[slot]}>
                {slotOptions(slot).map((o) => (
                  <button key={o.id} className={`doc-chip ${shown === o.id ? 'on' : ''} ${chosen === o.id ? 'cur' : ''}`} onClick={() => setView({ ...view, [slot]: o.id })} title={o.title}>
                    <span aria-hidden="true">{o.icon}</span> {o.title}
                  </button>
                ))}
              </div>
              {d && (
                <div className="doc-detail">
                  {d.pros.map((p, i) => <div key={'p' + i} className="good">＋ {p}</div>)}
                  {d.cons.map((p, i) => <div key={'c' + i} className="bad">－ {p}</div>)}
                  {shown !== chosen && (
                    <button className="btn primary sm" style={{ marginTop: 6 }} disabled={wait > 0 && cur.changed > -9000}
                      onClick={() => { store.act((g) => actSetDoctrine(g, g.player, slot, d.id)); setView({ ...view, [slot]: undefined }); }}>
                      Adopt · {fundingText(c, cost)}
                    </button>
                  )}
                  {shown === chosen && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>Your current doctrine.</div>}
                </div>
              )}
            </div>
          );
        })}
        <div className="faint" style={{ fontSize: 11.5 }}>A reform costs {(REFORM_COST * 100).toFixed(1)}% of GDP and 1 stability; you can only reform once a year.</div>
      </div>
    </Section>
  );
}
