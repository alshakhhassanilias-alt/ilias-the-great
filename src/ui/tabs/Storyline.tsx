/** The national storyline: the chapter you are in, the acts behind and ahead, your road and the endings in reach. */
import { store } from '../../state/store';
import { Section } from '../widgets';
import { dateLabel } from '../../sim/tick';
import { ARCH_LABEL, ROMAN, actTitles, choiceLabel, possibleEndings, seedOf, storyChip } from '../../sim/story';
import type { Country } from '../../sim/types';

const ROAD_UNLOCKS: Record<string, string> = {
  reform: 'international arbitration with your rival, and a social contract for the economy',
  iron: 'preparing for war with your rival, and state champions in the economy',
  pragmatic: 'a deal behind closed doors with your rival, and playing the great powers for investment',
};

const ECON_WORD: Record<string, string> = { oil: 'oil and gas', minerals: 'mining', farms: 'farming', industry: 'industry', tech: 'technology', services: 'finance and trade', tourism: 'tourism', aid: 'aid and remittances' };

export function StorylinePanel() {
  const s = store.state!;
  const c: Country = s.countries[s.player];
  const st = c.story;
  const seed = seedOf(c);
  const ch = st?.ch ?? 1;
  const act = st?.act ?? 1;
  const waiting = s.inbox.some((x) => x.id.startsWith('story'));
  const titles = actTitles(c);
  const ends = possibleEndings(c);
  return (
    <Section title={`📖 ${c.name}: ${seed.ambition}`} hint={`national storyline · ${storyChip(c) || 'chapter I · act I of IV'}`}>
      <div className="card story-card">
        <p className="story-intro">{ch === 1 ? <>The question of your age: <b>{seed.text}</b>.</> : <>Chapter {ROMAN[ch - 1]}: a new trouble defines the age.</>} Every act is a decision that arrives in your inbox when events make it urgent (a crisis, a move by your rival, a shift in the world). What you choose changes the next acts and the ending.</p>
        <ol className="story-acts">
          {titles.map((t, i) => {
            const n = i + 1;
            const state = n < act ? 'done' : n === act && act <= 4 ? 'now' : 'later';
            return (
              <li key={i} className={state}>
                <b>{t}</b>
                {state === 'done' && <span className="hint">✓ {choiceLabel(c, n, st?.path[i])}</span>}
                {state === 'now' && <span className="hint">{waiting ? '⏳ waiting in your decisions' : st?.due !== undefined ? `comes when events make it urgent${st.next > s.tick ? ` (not before ${dateLabel(st.next)})` : ''}, ${dateLabel(st.due)} at the latest` : st && st.next > s.tick ? `arrives around ${dateLabel(st.next)}` : 'arrives soon'}</span>}
                {state === 'later' && n === 2 && !st?.arch && <span className="hint faint">its options depend on your road</span>}
              </li>
            );
          })}
        </ol>
        <div className="story-road">
          {st?.arch ? <>Your road: <b>{ARCH_LABEL[st.arch]}</b>. It unlocks {ROAD_UNLOCKS[st.arch]}.</> : <>Your road is not chosen yet. Act I decides it: the first answer makes you <b>the reformer</b>, the second <b>the iron hand</b>, the third <b>the pragmatist</b>.</>}
        </div>
        {act > 4 && st?.ending ? (
          <div className="story-ending">Chapter {ROMAN[ch - 1]} is written: <b>{st.ending}</b>. Chapter {ROMAN[ch]} opens around {dateLabel(st.next)}, built from where {c.name} stands by then.</div>
        ) : (
          <div className="story-ends"><span className="hint">Endings still in reach:</span>{ends.map((e) => <span key={e} className="chip-mini">{e}</span>)}</div>
        )}
        {!!st?.past?.length && (
          <div className="story-past">
            <span className="hint">Chapters written:</span>
            {st.past.map((p) => <div key={p.ch}>Chapter {ROMAN[p.ch - 1]}: <b>{p.ending}</b> <span className="faint">({ARCH_LABEL[p.arch as keyof typeof ARCH_LABEL] ?? p.arch}, {dateLabel(p.tick)})</span></div>)}
          </div>
        )}
        <div className="faint story-legend">Act I sets your road. Act II puts you against your rival ({st?.rival !== undefined && st.rival >= 0 ? s.countries[st.rival]?.name : 'your hardest neighbour'}), and your road adds a fourth option. Act III shapes the economy ({ECON_WORD[seed.econ]}). Act IV can start a change of course in Diplomacy. Letting an act lapse lets events decide for you.</div>
      </div>
    </Section>
  );
}
