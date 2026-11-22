/**
 * Where the game runs: in the desktop app (Electron, with saves on disk and Steam) or in a browser (saves in
 * IndexedDB). Everything platform-specific goes through here, so the game code is the same in both.
 */
export interface SaveMeta {
  /** slot name, also the file name on disk */
  name: string;
  country: string; iso3: string;
  /** in-game date, e.g. "Mar 2027" */
  date: string; tick: number;
  mode: string;
  /** real time saved (ms since 1970) */
  savedAt: number;
  auto?: boolean;
  size?: number;
}
export interface DesktopBridge {
  version: string;
  saves: {
    list(): Promise<SaveMeta[]>;
    read(name: string): Promise<string | null>;
    write(name: string, text: string, meta: SaveMeta): Promise<void>;
    remove(name: string): Promise<void>;
    openFolder(): Promise<void>;
  };
  window: { setFullscreen(on: boolean): Promise<void>; isFullscreen(): Promise<boolean>; setZoom(f: number): Promise<void>; quit(): Promise<void> };
  /** writes a crash report to the logs folder; returns its path */
  crash(text: string): Promise<string>;
  steam: { status(): Promise<{ on: boolean; user?: string; appId?: number }>; achieve(id: string): Promise<boolean> };
}
export const desktop: DesktopBridge | undefined = (globalThis as { worldOrderDesktop?: DesktopBridge }).worldOrderDesktop;
export const isDesktop = !!desktop;

// ------------------------------------------------------------------ browser saves (IndexedDB)
const DB = 'world-order', STORE = 'saves';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'name' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
interface Row { name: string; text: string; meta: SaveMeta }
const browserSaves: DesktopBridge['saves'] = {
  async list() { const rows = await tx<Row[]>('readonly', (os) => os.getAll() as IDBRequest<Row[]>); return rows.map((r) => r.meta); },
  async read(name) { const r = await tx<Row | undefined>('readonly', (os) => os.get(name) as IDBRequest<Row | undefined>); return r?.text ?? null; },
  async write(name, text, meta) { await tx('readwrite', (os) => os.put({ name, text, meta: { ...meta, size: text.length } })); },
  async remove(name) { await tx('readwrite', (os) => os.delete(name)); },
  async openFolder() { /* not in a browser */ },
};

/** Saves from older versions lived in localStorage: move them into the slot list once. */
async function migrateLegacy(saves: DesktopBridge['saves']) {
  try {
    if (localStorage.getItem('wo-saves-migrated')) return;
    for (const [key, name, auto] of [['world-order-save-v1', 'Saved game (old version)', false], ['world-order-autosave-v1', 'Autosave (old version)', true]] as const) {
      const text = localStorage.getItem(key);
      if (!text) continue;
      try {
        const s = JSON.parse(text) as { tick?: number; player?: number; countries?: { name: string; iso3: string }[]; settings?: { mode?: string } };
        const c = s.countries?.[s.player ?? 0];
        await saves.write(name, text, { name, country: c?.name ?? '?', iso3: c?.iso3 ?? '', date: '', tick: s.tick ?? 0, mode: s.settings?.mode ?? 'sandbox', savedAt: Date.now(), auto });
        localStorage.removeItem(key);
      } catch { /* not a valid save: leave it */ }
    }
    localStorage.setItem('wo-saves-migrated', '1');
  } catch { /* storage unavailable */ }
}

let migrated: Promise<void> | null = null;
/** The save store for this platform (newest first when listed). */
export const saves: DesktopBridge['saves'] = {
  async list() {
    const s = desktop?.saves ?? browserSaves;
    if (!migrated) migrated = migrateLegacy(s);
    await migrated;
    try { return (await s.list()).sort((a, b) => b.savedAt - a.savedAt); } catch { return []; }
  },
  read: (n) => (desktop?.saves ?? browserSaves).read(n),
  write: (n, t, m) => (desktop?.saves ?? browserSaves).write(n, t, m),
  remove: (n) => (desktop?.saves ?? browserSaves).remove(n),
  openFolder: () => (desktop?.saves ?? browserSaves).openFolder(),
};

/** Unlock a Steam achievement (desktop with Steam running; otherwise nothing happens). */
export function achieve(id: string) { void desktop?.steam.achieve(id).catch(() => false); }

export async function setFullscreen(on: boolean) {
  if (desktop) return desktop.window.setFullscreen(on);
  try { if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!on && document.fullscreenElement) await document.exitFullscreen(); } catch { /* not allowed */ }
}
export async function isFullscreen(): Promise<boolean> {
  if (desktop) return desktop.window.isFullscreen();
  return !!document.fullscreenElement;
}
