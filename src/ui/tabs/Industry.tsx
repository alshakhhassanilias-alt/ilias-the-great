/**
 * Industries and world markets (Economy tab): each sector's capacity, your world rank and share, the world price and
 * its direction, and the investment programmes that build capacity.
 */
import { store } from '../../state/store';
import { Section, Meter } from '../widgets';
import { fmtMoney } from '../format';
import { fundingText } from '../../sim/treasury';
import { MAX_PROGS, SECTORS, actCancelExpansion, actExpandSector, ensureIndustry, expansionOf, exportEarnings, industryFactor, marketOf, sectorStanding } from '../../sim/industry';

const priceWord = (p: number) => (p >= 1.4 ? 'booming' : p >= 1.12 ? 'dear' : p <= 0.65 ? 'glutted' : p <= 0.88 ? 'cheap' : 'steady');
const priceTone = (p: number) => (p >= 1.12 ? 'good' : p <= 0.88 ? 'bad' : '');
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function IndustrySection({ id }: { id: number }) {
  const s = store.state!;
  const c = s.countries[id];
  const mine = id === s.player;
  const ind = ensureIndustry(c);
  const m = marketOf(s);
  const f = industryFactor(s, c);
  const earn = exportEarnings(s, c);
  const progs = ind.prog ?? [];
  return (
    <Section title="Industries & world markets" hint={`output ${f >= 1 ? '+' : '−'}${Math.abs((f - 1) * 100).toFixed(1)}% vs the world${mine ? ` · ${progs.length}/${MAX_PROGS} programmes` : ''}`}>
      {m.shock && <div className="note warn" style={{ marginBottom: 8 }}>🌐 {m.shock.text}.</div>}
      {mine && <p className="faint ind-intro">Build capacity where the world pays: a level in a booming market is worth far more than one in a glut. Every country is building too, so standing still means falling behind.{earn > 0 ? ` Mining and arms exports bring in ${fmtMoney(earn)} a year.` : ''}</p>}
      <div className="ind-grid">
        {SECTORS.map((sec) => {
          const st = sectorStanding(s, c, sec.id);
          const x = mine ? expansionOf(s, c, sec.id) : null;
          const run = progs.find((p) => p.id === sec.id);
          const built = st.lv - ind.lv0[sec.id];
          return (
            <div key={sec.id} className={`ind-card ${run ? 'run' : ''}`}>
              <div className="ind-head">
                <span className="ind-icon" aria-hidden="true">{sec.icon}</span>
                <div className="grow">
                  <b>{sec.name}</b>
                  <small>{st.rank ? <>world’s {ord(st.rank)} {sec.maker} · {(st.share * 100).toFixed(st.share < 0.01 ? 2 : 1)}% of world output</> : '—'}</small>
                </div>
                <span className="ind-lv" title="capacity level">{st.lv.toFixed(1)}</span>
              </div>
              <div className="ind-price">
                <span>World price <b className={priceTone(st.price)}>{st.price.toFixed(2)}×</b> <span className={`faint ${priceTone(st.price)}`}>{priceWord(st.price)}</span></span>
                {built > 0.05 && <span className="faint">+{built.toFixed(1)} built</span>}
              </div>
              <div className="ind-pay faint">{sec.payoff}</div>
              {mine && run && (
                <>
                  <Meter value={(s.tick - run.start) / Math.max(1, run.until - run.start)} color="var(--accent)" />
                  <div className="ind-foot"><span>Expanding · ready in {run.until - s.tick} wk</span><button className="linkbtn" onClick={() => store.act((g) => actCancelExpansion(g, sec.id))}>Cancel</button></div>
                </>
              )}
              {mine && !run && x && (
                <button className="btn sm" disabled={!!x.why} title={x.why ?? ''} onClick={() => store.act((g) => actExpandSector(g, sec.id))}>
                  Expand to {(Math.floor(st.lv) + 1).toFixed(0)}<small>{x.why ?? `${fundingText(c, x.cost)} · ${x.weeks} weeks`}</small>
                </button>
              )}
              <div className="ind-leaders faint">Leaders: {st.leaders.slice(0, 3).map((i) => s.countries[i].iso3).join(' · ')}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
