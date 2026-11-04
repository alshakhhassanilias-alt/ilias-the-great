/**
 * Build: everything the country can build, in one place, one view at a time: industries (months, lasting capacity
 * on world markets), megaprojects (years, a national transformation) and quick investments (paid and built at once).
 */
import { useState, type ReactNode } from 'react';
import { IndustrySection } from './Industry';
import { ProjectsSection } from './Projects';
import { Glyph } from '../art/Glyphs';
import { sfx } from '../../audio';

type View = 'ind' | 'mega' | 'quick';
const VIEWS: { id: View; label: string; icon: string; sub: string }[] = [
  { id: 'ind', label: 'Industries', icon: 'factory', sub: 'months · lasting' },
  { id: 'mega', label: 'Megaprojects', icon: 'crown', sub: 'years · transformative' },
  { id: 'quick', label: 'Quick investments', icon: 'coin', sub: 'at once' },
];
const read = (): View => { try { const v = localStorage.getItem('wo-build') as View | null; return v && VIEWS.some((x) => x.id === v) ? v : 'ind'; } catch { return 'ind'; } };

export function BuildHub({ id, quick }: { id: number; quick: ReactNode }) {
  const [view, setView] = useState<View>(read);
  const pick = (v: View) => { sfx('tab'); setView(v); try { localStorage.setItem('wo-build', v); } catch { /* storage unavailable */ } };
  return (
    <>
      <div className="build-tabs" role="tablist" aria-label="What to build">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => pick(v.id)}>
            <Glyph name={v.icon} size={18} /><span><b>{v.label}</b><small>{v.sub}</small></span>
          </button>
        ))}
      </div>
      {view === 'ind' && <IndustrySection id={id} />}
      {view === 'mega' && <ProjectsSection />}
      {view === 'quick' && quick}
    </>
  );
}
