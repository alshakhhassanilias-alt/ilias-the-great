/* Infinite History - browser engine. Runs the Python simulation on Pyodide (WebAssembly) inside a Web Worker. */
/* global loadPyodide */
const BASE = new URL('./', self.location.href).href
let handle = null
let persistent = false
let py = null

function status(text) { postMessage({ type: 'status', text }) }

function b64bytes(t) {
  const bin = atob(t.trim())
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
async function fetchB64(url) {
  const r = await realFetch(url)
  if (!r.ok) throw new Error('Could not download ' + url)
  return b64bytes(await r.text())
}
// Archives are published as base64 text; serve them to Pyodide transparently.
const realFetch = self.fetch.bind(self)
self.fetch = (input, init) => {
  const u = input instanceof Request ? input.url : String(input)
  const m = /\/([^/?#]+\.zip)(?:[?#].*)?$/.exec(u)
  if (m) return fetchB64(u.slice(0, u.lastIndexOf('/') + 1) + m[1] + '.b64.txt').then(b => new Response(b, { headers: { 'Content-Type': 'application/zip' } }))
  return realFetch(input, init)
}

const ready = (async () => {
  status('Loading the Python runtime…')
  importScripts(BASE + 'pyodide/pyodide.js')
  py = await loadPyodide({ indexURL: BASE + 'pyodide/' })
  status('Loading the database engine…')
  await py.loadPackage('sqlite3')
  status('Unpacking the world…')
  const buf = await fetchB64(BASE + 'app.b64.txt')
  py.unpackArchive(buf, 'zip', { extractDir: '/home/pyodide' })
  py.FS.mkdirTree('/persist')
  try {
    py.FS.mount(py.FS.filesystems.IDBFS, {}, '/persist')
    await new Promise((resolve, reject) => py.FS.syncfs(true, err => (err ? reject(err) : resolve())))
    persistent = true
  } catch (e) {
    persistent = false
  }
  status('Waking the historians…')
  py.runPython(`
import os, sys
sys.path.insert(0, '/home/pyodide')
os.environ['IH_DB'] = '/persist/infinite_history.db'
os.environ['IH_FTS'] = 'fts4'
os.environ['IH_JOURNAL'] = 'DELETE'
from app.browser import handle
`)
  handle = py.globals.get('handle')
  postMessage({ type: 'ready', persistent })
})()

ready.catch(e => postMessage({ type: 'fatal', text: String(e && e.message || e) }))

let syncing = false
let syncAgain = false
function persist() {
  if (!persistent) return
  if (syncing) { syncAgain = true; return }
  syncing = true
  py.FS.syncfs(false, () => {
    syncing = false
    if (syncAgain) { syncAgain = false; persist() }
  })
}

self.onmessage = async e => {
  const { id, method, url, body } = e.data
  try {
    await ready
    const out = JSON.parse(handle(method, url, body == null ? null : JSON.stringify(body)))
    postMessage({ id, status: out.status, data: out.data })
    if (method !== 'GET') persist()
  } catch (err) {
    postMessage({ id, status: 500, data: { detail: String(err && err.message || err).slice(-800) } })
  }
}
