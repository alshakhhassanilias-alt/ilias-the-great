'use strict';
// Inlines CSS + JS into one self-contained HTML file: dist/waiter-pad.html
// (handy for hosting anywhere as a single file). The multi-file version in the
// repo root is the one to host for offline use (it has the service worker).
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '\n</script>');
// Manifest / icons / service worker need separate files; drop them in the bundle.
html = html.replace(/<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n?/g, '');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'waiter-pad.html'), html);
console.log('dist/waiter-pad.html', (html.length / 1024).toFixed(0) + ' KB');

// Variant for hosting as a claude.ai Artifact: the host supplies the document
// skeleton, so strip doctype/html/head/body and the metas it already sets.
let art = html
  .replace(/<!doctype html>\n?/i, '').replace(/<\/?html[^>]*>\n?/g, '').replace(/<\/?head>\n?/g, '').replace(/<\/?body>\n?/g, '')
  .replace(/<meta (charset|name="viewport")[^>]*>\n?/g, '');
const title = art.match(/<title>.*?<\/title>\n?/)[0];
art = title + art.replace(title, '');
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), art);
console.log('dist/artifact.html', (art.length / 1024).toFixed(0) + ' KB');
