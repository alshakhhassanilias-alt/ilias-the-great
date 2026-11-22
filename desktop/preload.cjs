/**
 * The bridge between the game (a web page) and the desktop app. Only these calls are exposed; the page has no
 * other access to the computer.
 */
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('worldOrderDesktop', {
  version: (process.argv.find((a) => a.startsWith('--wo-version=')) || '').slice(13),
  saves: {
    list: () => call('saves:list'),
    read: (name) => call('saves:read', name),
    write: (name, text, meta) => call('saves:write', name, text, meta),
    remove: (name) => call('saves:remove', name),
    openFolder: () => call('saves:folder'),
  },
  window: {
    setFullscreen: (on) => call('win:fullscreen', on),
    isFullscreen: () => call('win:isFullscreen'),
    setZoom: (f) => call('win:zoom', f),
    quit: () => call('app:quit'),
  },
  crash: (text) => call('crash', text),
  steam: {
    status: () => call('steam:status'),
    achieve: (id) => call('steam:achieve', id),
  },
});
