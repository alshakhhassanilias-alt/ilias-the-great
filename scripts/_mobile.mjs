import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await pg.addInitScript(() => { localStorage.setItem('wo-tutorial-1', '1'); Math.random = (() => { let x = 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })(); });
await pg.goto('http://localhost:4173');
const out = process.argv[2];
await pg.waitForTimeout(800);
await pg.screenshot({ path: `${out}/m0.png` });
await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")'); await pg.click('button:has-text("Lead Poland")');
await pg.waitForSelector('.app');
await pg.evaluate(() => { const st = window.__store; for (let i = 0; i < 10; i++) st.stepOnce(); st.toasts = []; st.breaking = null; st.splash = null; st.notify(); });
await pg.click('.sheet-handle'); await pg.waitForTimeout(400);
for (const tab of ['Overview', 'Economy', 'Military']) { await pg.click(`.tabs button:has-text("${tab}")`); await pg.waitForTimeout(300); await pg.screenshot({ path: `${out}/m-${tab}.png` }); }
await b.close();
