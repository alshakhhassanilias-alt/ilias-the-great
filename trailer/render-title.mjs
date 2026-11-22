import { chromium } from 'playwright-core';
import fs from 'node:fs';
const DIR = process.argv[2], FRAMES = Number(process.argv[3] ?? 165);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--allow-file-access-from-files'] });
const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await pg.goto('file://' + DIR + '/title.html');
await pg.waitForFunction(() => window.ready === true);
await pg.waitForFunction(() => document.getElementById('bg').complete);
fs.mkdirSync(DIR + '/frames', { recursive: true });
for (let i = 0; i < FRAMES; i++) { await pg.evaluate((t) => window.draw(t), i / 30); await pg.locator('#c').screenshot({ path: `${DIR}/frames/${String(i).padStart(5, '0')}.png` }); }
await browser.close(); console.log('title frames', FRAMES);
