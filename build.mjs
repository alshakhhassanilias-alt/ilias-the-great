// Bundles src/ into the installable website (index.html + sw.js + manifest) and, optionally,
// the body-only page used for the Claude-hosted version.
//   node build.mjs                 -> index.html, sw.js, manifest.webmanifest
//   node build.mjs artifact.html   -> also writes the Claude artifact page
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('.', import.meta.url);
const read = f => fs.readFileSync(new URL('src/' + f, root), 'utf8');
const scripts = ['data.js', 'content/grammar-plus.js', 'content/vocab-a1.js', 'content/vocab-a2.js', 'content/vocab-b1.js', 'content/vocab-b2.js', 'content/vocab-extra-a.js', 'content/vocab-extra-b.js', 'content/vocab-extra-c.js', 'content/reading.js', 'app.js'].map(read).join('\n');
const fonts = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..900&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

const body = `<title>Wortwerk</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts}">
<style>
${read('styles.css')}</style>
<main id="app" class="wrap"></main>
<nav id="nav" aria-label="Sections"></nav>
<div id="toast" role="status"></div>
<script>
${scripts}</script>
`;
const version = crypto.createHash('sha1').update(body).digest('hex').slice(0, 10);

const head = '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="description" content="Learn German from A1 to B2: every word and rule taught first, then practised with spaced repetition.">' +
  '<meta name="theme-color" content="#10131A"><meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Wortwerk">' +
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
  '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icons/icon-192.png">' +
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>' +
  '</head><body>';
fs.writeFileSync(new URL('index.html', root), head + body + '</body></html>\n');

fs.writeFileSync(new URL('manifest.webmanifest', root), JSON.stringify({
  name: 'Wortwerk: German A1 to B2', short_name: 'Wortwerk', start_url: './', scope: './', display: 'standalone',
  background_color: '#10131A', theme_color: '#10131A', lang: 'de', orientation: 'portrait',
  description: 'Learn German from A1 to B2 with taught lessons, 2,500+ words and spaced repetition.',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2) + '\n');

fs.writeFileSync(new URL('sw.js', root), `// Offline support for Wortwerk. Version ${version}
const CACHE = 'wortwerk-${version}';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('wortwerk-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === location.origin || /fonts\\.(googleapis|gstatic)\\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
`);
fs.writeFileSync(new URL('.nojekyll', root), '');
if (process.argv[2]) fs.writeFileSync(process.argv[2], body);
console.log('built', (body.length / 1024).toFixed(0) + ' KB', 'version', version);
