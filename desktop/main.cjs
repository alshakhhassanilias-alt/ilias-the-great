/**
 * World Order desktop app (Electron). It shows the game (the same web build as the browser version), keeps
 * saves as files in the player's profile folder, writes crash reports, remembers the window, and talks to Steam.
 *
 * Folders (Windows: %APPDATA%\World Order, macOS: ~/Library/Application Support/World Order,
 * Linux: ~/.config/World Order):
 *   saves/   one .json file per save plus a small .meta.json beside it  (Steam Auto-Cloud syncs this folder)
 *   logs/    crash reports
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const steam = require('./steam.cjs');

app.setName('World Order');
// Steam must start (and hook its overlay) before any window exists
steam.init(__dirname);

if (!app.requestSingleInstanceLock()) { app.quit(); }

const dir = (sub) => { const d = path.join(app.getPath('userData'), sub); fs.mkdirSync(d, { recursive: true }); return d; };
const SAVES = () => dir('saves');
const LOGS = () => dir('logs');
/** a save name becomes a safe file name */
const fileOf = (name) => String(name).replace(/[^\p{L}\p{N} ,.()_-]+/gu, '_').replace(/^\.+/, '').slice(0, 80).trim() || 'save';

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

// ------------------------------------------------------------------ saves
ipcMain.handle('saves:list', async () => {
  const d = SAVES();
  const out = [];
  for (const f of await fsp.readdir(d)) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(d, f), 'utf8'));
      const st = await fsp.stat(path.join(d, f.replace(/\.meta\.json$/, '.json'))).catch(() => null);
      if (st) out.push({ ...meta, size: st.size });
    } catch { /* a broken meta file: skip it */ }
  }
  return out;
});
ipcMain.handle('saves:read', async (_e, name) => {
  try { return await fsp.readFile(path.join(SAVES(), `${fileOf(name)}.json`), 'utf8'); } catch { return null; }
});
ipcMain.handle('saves:write', async (_e, name, text, meta) => {
  const base = path.join(SAVES(), fileOf(name));
  await writeAtomic(`${base}.json`, text);
  await writeAtomic(`${base}.meta.json`, JSON.stringify({ ...meta, name }));
});
ipcMain.handle('saves:remove', async (_e, name) => {
  const base = path.join(SAVES(), fileOf(name));
  await fsp.rm(`${base}.json`, { force: true });
  await fsp.rm(`${base}.meta.json`, { force: true });
});
ipcMain.handle('saves:folder', () => shell.openPath(SAVES()));

// ------------------------------------------------------------------ crash reports
ipcMain.handle('crash', async (_e, text) => {
  const file = path.join(LOGS(), `crash-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  await fsp.writeFile(file, `${text}\n\nApp ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${process.arch}\n`, 'utf8');
  // keep the 20 newest
  const all = (await fsp.readdir(LOGS())).filter((f) => f.startsWith('crash-')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 20))) await fsp.rm(path.join(LOGS(), f), { force: true });
  return file;
});

// ------------------------------------------------------------------ steam
ipcMain.handle('steam:status', () => steam.status());
ipcMain.handle('steam:achieve', (_e, id) => steam.achieve(String(id)));

// ------------------------------------------------------------------ window
const STATE = () => path.join(app.getPath('userData'), 'window.json');
function readWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return { width: 1600, height: 900, maximized: true }; }
}
let win = null;
function createWindow() {
  const st = readWindowState();
  win = new BrowserWindow({
    width: st.width ?? 1600, height: st.height ?? 900, x: st.x, y: st.y,
    minWidth: 1100, minHeight: 680,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'World Order',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--wo-version=${app.getVersion()}`],
    },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const save = () => { if (!win || win.isDestroyed() || win.isFullScreen()) return; try { fs.writeFileSync(STATE(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ } };
  win.on('close', save);
  win.on('resized', save);
  win.on('moved', save);
  // links to the web open in the player's browser; the game window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
  win.webContents.on('render-process-gone', async (_e, d) => {
    const file = path.join(LOGS(), `crash-renderer-${Date.now()}.txt`);
    try { fs.writeFileSync(file, `The game window stopped: ${d.reason} (exit code ${d.exitCode})\n`); } catch { /* ignore */ }
    const r = await dialog.showMessageBox({ type: 'error', title: 'World Order', message: 'The game stopped unexpectedly.', detail: `Your autosaves are safe. A report was written to:\n${file}`, buttons: ['Restart the game', 'Quit'] });
    if (r.response === 0) win.reload(); else app.quit();
  });
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
}

ipcMain.handle('win:fullscreen', (_e, on) => { win?.setFullScreen(!!on); });
ipcMain.handle('win:isFullscreen', () => !!win?.isFullScreen());
ipcMain.handle('win:zoom', (_e, f) => { const z = Math.min(1.5, Math.max(0.7, Number(f) || 1)); win?.webContents.setZoomFactor(z); });
ipcMain.handle('app:quit', () => app.quit());

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  // no menu bar on Windows and Linux; macOS keeps the standard app menu (Quit, copy and paste)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
