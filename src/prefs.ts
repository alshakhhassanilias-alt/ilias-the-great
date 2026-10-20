/**
 * Player preferences (not part of a saved game): volume, music, display, autosave and key bindings.
 * Kept in localStorage, which the desktop app keeps in its own profile folder.
 */
export type KeyAction =
  | 'pause' | 'speed1' | 'speed2' | 'speed3' | 'speed4' | 'step'
  | 'zoomIn' | 'zoomOut' | 'home'
  | 'quickSave' | 'quickLoad' | 'saves' | 'menu'
  | 'tabOverview' | 'tabPolitics' | 'tabGoals' | 'tabEconomy' | 'tabMilitary' | 'tabDiplomacy'
  | 'world' | 'warRoom' | 'help' | 'fullscreen';

export const KEY_ACTIONS: { id: KeyAction; label: string; group: string }[] = [
  { id: 'pause', label: 'Pause / resume', group: 'Time' },
  { id: 'speed1', label: 'Slow', group: 'Time' },
  { id: 'speed2', label: 'Normal', group: 'Time' },
  { id: 'speed3', label: 'Fast', group: 'Time' },
  { id: 'speed4', label: 'Very fast', group: 'Time' },
  { id: 'step', label: 'Advance one week', group: 'Time' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Map' },
  { id: 'zoomOut', label: 'Zoom out', group: 'Map' },
  { id: 'home', label: 'Centre on your country', group: 'Map' },
  { id: 'tabOverview', label: 'Overview tab', group: 'Panels' },
  { id: 'tabPolitics', label: 'Politics tab', group: 'Panels' },
  { id: 'tabGoals', label: 'Goals tab', group: 'Panels' },
  { id: 'tabEconomy', label: 'Economy tab', group: 'Panels' },
  { id: 'tabMilitary', label: 'Military tab', group: 'Panels' },
  { id: 'tabDiplomacy', label: 'Diplomacy tab', group: 'Panels' },
  { id: 'world', label: 'World view', group: 'Panels' },
  { id: 'warRoom', label: 'War room (your current war)', group: 'Panels' },
  { id: 'quickSave', label: 'Quick save', group: 'Game' },
  { id: 'quickLoad', label: 'Quick load', group: 'Game' },
  { id: 'saves', label: 'Save / load screen', group: 'Game' },
  { id: 'menu', label: 'Close window / open menu', group: 'Game' },
  { id: 'help', label: 'How to play', group: 'Game' },
  { id: 'fullscreen', label: 'Fullscreen', group: 'Game' },
];

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  pause: 'Space', speed1: 'Digit1', speed2: 'Digit2', speed3: 'Digit3', speed4: 'Digit4', step: 'Period',
  zoomIn: 'Equal', zoomOut: 'Minus', home: 'KeyH',
  quickSave: 'F5', quickLoad: 'F9', saves: 'KeyL', menu: 'Escape',
  tabOverview: 'KeyQ', tabPolitics: 'KeyP', tabGoals: 'KeyG', tabEconomy: 'KeyE', tabMilitary: 'KeyM', tabDiplomacy: 'KeyD',
  world: 'KeyW', warRoom: 'KeyR', help: 'F1', fullscreen: 'F11',
};

export interface Prefs {
  master: number; music: number; sfx: number;
  musicOn: boolean; soundOn: boolean;
  /** quieter music while the game is paused or a window is open */
  duck: boolean;
  /** mute when the window loses focus */
  muteUnfocused: boolean;
  /** interface size (desktop app): 0.8 … 1.3 */
  uiScale: number;
  fullscreen: boolean;
  /** autosave every N months of game time (0 = off) */
  autosaveMonths: number;
  /** autosave slots kept in rotation */
  autosaveSlots: number;
  keys: Record<KeyAction, string>;
  /** edge of the screen scrolls the map */
  edgeScroll: boolean;
  /** fewer animations */
  calm: boolean;
  /** the first-game walkthrough: -1 not started, n = step reached, 99 done or skipped */
  walk: number;
}
export const DEFAULT_PREFS: Prefs = {
  master: 0.8, music: 0.55, sfx: 0.8, musicOn: true, soundOn: true, duck: true, muteUnfocused: false,
  uiScale: 1, fullscreen: false, autosaveMonths: 6, autosaveSlots: 3, keys: { ...DEFAULT_KEYS }, edgeScroll: false, calm: false, walk: -1,
};

const KEY = 'wo-prefs';
function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    const p = { ...DEFAULT_PREFS, ...raw, keys: { ...DEFAULT_KEYS, ...(raw.keys ?? {}) } };
    // the old sound switch
    if (raw.soundOn === undefined && localStorage.getItem('wo-sound') === '0') p.soundOn = false;
    // players of older versions have already seen the old tutorial
    if (raw.walk === undefined && localStorage.getItem('wo-tutorial-1')) p.walk = 99;
    return p;
  } catch { return { ...DEFAULT_PREFS, keys: { ...DEFAULT_KEYS } }; }
}
export const prefs: Prefs = read();
const subs = new Set<() => void>();
export function setPrefs(patch: Partial<Prefs>) {
  Object.assign(prefs, patch);
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  subs.forEach((f) => f());
}
export function onPrefs(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** A readable name for a key code ("KeyQ" → "Q", "Digit1" → "1"). */
export function keyName(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return ({ Space: 'Space', Escape: 'Esc', Equal: '+ / =', Minus: '−', Period: '.', Comma: ',', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Tab: 'Tab', Enter: 'Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', Delete: 'Del', Backspace: 'Backspace' } as Record<string, string>)[code] ?? code;
}
/** The action bound to a key code, if any. */
export function actionFor(code: string): KeyAction | null {
  for (const a of Object.keys(prefs.keys) as KeyAction[]) if (prefs.keys[a] === code) return a;
  // the numeric keypad mirrors the speed keys
  const m = /^Numpad([1-4])$/.exec(code);
  if (m) return `speed${m[1]}` as KeyAction;
  if (code === 'NumpadAdd') return 'zoomIn';
  if (code === 'NumpadSubtract') return 'zoomOut';
  return null;
}
export function bindKey(a: KeyAction, code: string) {
  const keys = { ...prefs.keys };
  // a key does one thing: take it away from whatever had it
  for (const k of Object.keys(keys) as KeyAction[]) if (keys[k] === code) keys[k] = '';
  keys[a] = code;
  setPrefs({ keys });
}
