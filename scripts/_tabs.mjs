import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.addInitScript(() => { localStorage.setItem('wo-tutorial-1', '1'); });
await pg.goto('http://localhost:4173');
const out = process.env.OUT ?? '/tmp/claude-0/scratch';
await pg.screenshot({ path: `${out}/t0.png` });
await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")'); await pg.click('button:has-text("Lead Poland")');
await pg.waitForSelector('.app');
await pg.evaluate(() => { const st = window.__store; for (let i = 0; i < 20; i++) st.stepOnce(); st.toasts = []; st.breaking = null; st.notify(); });
for (const tab of ['Overview', 'Goals', 'Economy', 'Military', 'Diplomacy']) {
  await pg.click(`.tabs button:has-text("${tab}")`); await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${out}/t-${tab}.png` });
}
await b.close();
