/**
 * When something breaks: errors are collected (and written to a crash log in the desktop app), the simulation
 * pauses instead of failing every frame, and a crash screen lets the player save a rescue copy, carry on, or
 * go back to the menu.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { store } from '../state/store';
import { desktop, saves } from '../platform';
import { serialize } from '../sim/save';
import { dateLabel } from '../sim/tick';

export interface ErrRecord { at: number; where: string; message: string; stack?: string }
export const errorLog: ErrRecord[] = [];
const VERSION = (import.meta as { env?: { VITE_VERSION?: string } }).env?.VITE_VERSION ?? 'dev';

export function report(where: string, err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const rec: ErrRecord = { at: Date.now(), where, message: e.message, stack: e.stack };
  errorLog.push(rec);
  if (errorLog.length > 30) errorLog.shift();
  const text = reportText();
  void desktop?.crash(text).catch(() => '');
  return text;
}
export function reportText(): string {
  const s = store.state;
  const head = [
    `World Order ${desktop?.version ?? VERSION} · ${navigator.userAgent}`,
    s ? `Game: ${s.countries[s.player]?.name} · ${dateLabel(s.tick)} (week ${s.tick}) · seed ${s.settings.seed} · mode ${s.settings.mode ?? 'sandbox'}` : 'No game running',
    `Time: ${new Date().toISOString()}`,
  ];
  return [...head, '', ...errorLog.slice(-8).map((r) => `[${new Date(r.at).toISOString()}] ${r.where}: ${r.message}\n${r.stack ?? ''}`)].join('\n');
}
/** Save the game in its own slot, whatever state it is in. */
export async function rescueSave(): Promise<boolean> {
  const s = store.state;
  if (!s || store.preview) return false;
  try {
    const c = s.countries[s.player];
    const name = 'Rescue save';
    await saves.write(name, serialize(s), { name, country: c.name, iso3: c.iso3, date: dateLabel(s.tick), tick: s.tick, mode: s.settings.mode ?? 'sandbox', savedAt: Date.now() });
    void store.refreshSaves();
    return true;
  } catch { return false; }
}

if (typeof window !== 'undefined') {
  store.onSimError = (e) => { report('simulation', e); };
  window.addEventListener('error', (e) => { if (e.error) report('window', e.error); });
  window.addEventListener('unhandledrejection', (e) => report('promise', e.reason));
}

interface S { err: Error | null; saved: boolean | null; copied: boolean }
export class CrashGuard extends Component<{ children: ReactNode }, S> {
  state: S = { err: null, saved: null, copied: false };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) { report(`interface${info.componentStack ? `\n${info.componentStack.split('\n').slice(0, 6).join('\n')}` : ''}`, err); store.setSpeed(0); }
  render() {
    const { err, saved, copied } = this.state;
    if (!err) return this.props.children;
    const inGame = !!store.state && !store.preview;
    return (
      <div className="crash" role="alertdialog" aria-label="Something went wrong">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>The game hit an error and paused. Your world is still in memory: save a rescue copy first, then try to carry on.</p>
          <pre>{err.message}</pre>
          <div className="btnrow">
            {inGame && <button className="btn primary" onClick={async () => this.setState({ saved: await rescueSave() })}>💾 Save a rescue copy</button>}
            <button className="btn" onClick={() => this.setState({ err: null, saved: null })}>Try to carry on</button>
            <button className="btn" onClick={() => { store.openDrawer('none'); store.warRoom = null; this.setState({ err: null }); store.quitToMenu(); }}>Back to the main menu</button>
            <button className="btn" onClick={() => { void navigator.clipboard?.writeText(reportText()).then(() => this.setState({ copied: true })).catch(() => this.setState({ copied: false })); }}>{copied ? 'Copied' : 'Copy the error report'}</button>
          </div>
          {saved === true && <p className="good">Saved as “Rescue save”. Load it from the main menu if carrying on does not work.</p>}
          {saved === false && <p className="bad">The rescue save failed. Try Export in the menu once the game runs again.</p>}
          {desktop && <p className="faint">A crash report was written to the game's logs folder. Sending it with a description of what you were doing helps fix the problem.</p>}
        </div>
      </div>
    );
  }
}
