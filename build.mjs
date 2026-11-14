// Bundles src/ into one self-contained page.
//   node build.mjs            -> index.html (open it in any browser, or host it)
//   node build.mjs out.html   -> also writes the body-only variant used for publishing as a Claude artifact
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('src/' + f, import.meta.url), 'utf8');
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
${read('data.js')}
${read('app.js')}</script>
`;

const shell = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>' +
  '</head><body>';

fs.writeFileSync(new URL('index.html', import.meta.url), shell + body + '</body></html>\n');
if (process.argv[2]) fs.writeFileSync(process.argv[2], body);
console.log('built', (body.length / 1024).toFixed(1) + ' KB');
