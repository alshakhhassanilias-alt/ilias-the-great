/**
 * Design a face: the leader you play, and the heirs who follow. Every control overrides one thing a name would have
 * given (skin, hair, beard, glasses, expression); "Surprise me" rolls a new face, "From the name" clears it all.
 */
import { Portrait, faceFor, ALL_HAIR, ALL_SKIN, FACIAL, HAIR_STYLES, type FaceSpec } from './art/Portrait';
import { isFemaleName } from '../sim/names';
import type { Country, GameState, Look } from '../sim/types';

/** The player's leader as they look now: their name's face, their age, and whatever they designed. */
export function leaderFace(s: GameState): FaceSpec {
  const c = s.countries[s.player], L = s.legacy;
  const name = L?.leader ?? 'Leader';
  return faceOf(c, name, L?.look, L?.persona?.age);
}
export function faceOf(c: Pick<Country, 'id' | 'region' | 'gov' | 'color' | 'name'>, name: string, look?: Look, age?: number): FaceSpec {
  const f = faceFor(c, name, 'leader');
  if (age !== undefined) f.age = age;
  if (look) { f.look = look; if (look.female !== undefined) f.female = look.female; }
  return f;
}

const HAIR_LABEL: Record<string, string> = { short: 'Short', side: 'Side part', swept: 'Swept', receding: 'Receding', bald: 'Bald', bob: 'Bob', long: 'Long', bun: 'Bun', shoulder: 'Shoulder' };
const FACIAL_LABEL: Record<string, string> = { none: 'Clean', stubble: 'Stubble', moustache: 'Moustache', beard: 'Beard' };

export function LookEditor({ c, name, look, age, onChange, size = 120 }: { c: Country; name: string; look: Look; age?: number; onChange: (l: Look) => void; size?: number }) {
  const female = look.female ?? isFemaleName(name);
  const set = (p: Partial<Look>) => onChange({ ...look, ...p });
  const roll = () => {
    const r = () => Math.random();
    const fem = r() < 0.5;
    const styles = HAIR_STYLES[fem ? 'female' : 'male'];
    onChange({ female: fem, skin: Math.floor(r() * ALL_SKIN.length), hairColor: Math.floor(r() * 8), hair: styles[Math.floor(r() * styles.length)], facial: fem ? 'none' : FACIAL[Math.floor(r() * FACIAL.length)], glasses: r() < 0.3, smile: r() < 0.5 });
  };
  const styles = HAIR_STYLES[female ? 'female' : 'male'];
  return (
    <div className="look-ed">
      <div className="look-face"><Portrait f={faceOf(c, name, look, age)} size={size} title={name} />
        <div className="look-btns"><button type="button" className="linkbtn" onClick={roll}>🎲 Surprise me</button><button type="button" className="linkbtn" onClick={() => onChange({})}>From the name</button></div>
      </div>
      <div className="look-ctl">
        <div className="look-row"><small>Presents as</small>
          <div className="seg">{[false, true].map((fm) => <button type="button" key={String(fm)} className={female === fm ? 'on' : ''} onClick={() => set({ female: fm, hair: undefined, facial: fm ? 'none' : look.facial })}>{fm ? 'Woman' : 'Man'}</button>)}</div>
        </div>
        <div className="look-row"><small>Skin</small>
          <div className="swatches">{ALL_SKIN.map((col, i) => <button type="button" key={col} aria-label={`skin tone ${i + 1}`} className={look.skin === i ? 'on' : ''} style={{ background: col }} onClick={() => set({ skin: i })} />)}</div>
        </div>
        <div className="look-row"><small>Hair</small>
          <div className="chips">{styles.map((st) => <button type="button" key={st} className={`pill ${look.hair === st ? 'gold' : ''}`} onClick={() => set({ hair: st })}>{HAIR_LABEL[st]}</button>)}</div>
        </div>
        <div className="look-row"><small>Colour</small>
          <div className="swatches">{ALL_HAIR.map((col, i) => <button type="button" key={col} aria-label={`hair colour ${i + 1}`} className={look.hairColor === i ? 'on' : ''} style={{ background: col }} onClick={() => set({ hairColor: i })} />)}</div>
        </div>
        {!female && <div className="look-row"><small>Face</small>
          <div className="chips">{FACIAL.map((fc) => <button type="button" key={fc} className={`pill ${look.facial === fc ? 'gold' : ''}`} onClick={() => set({ facial: fc })}>{FACIAL_LABEL[fc]}</button>)}</div>
        </div>}
        <div className="look-row"><small>Details</small>
          <div className="chips">
            <button type="button" className={`pill ${look.glasses ? 'gold' : ''}`} aria-pressed={!!look.glasses} onClick={() => set({ glasses: !look.glasses })}>Glasses</button>
            <button type="button" className={`pill ${look.smile ? 'gold' : ''}`} aria-pressed={!!look.smile} onClick={() => set({ smile: !look.smile })}>{look.smile ? 'Warm smile' : 'Stern look'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
