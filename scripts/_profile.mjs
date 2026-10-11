import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.addInitScript(() => { localStorage.setItem('wo-tutorial-1', '1'); });
await pg.goto('http://localhost:4173');
await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")'); await pg.click('button:has-text("Lead Poland")');
await pg.waitForSelector('.app');
await pg.evaluate(() => { const s = window.__store.state; s.lastEventTick = 1e9; const id = s.countries.findIndex((c) => c.name === 'Belarus'); window.__store.select(id, null, false); });
await pg.click('.tabs button:has-text("Diplomacy")');
await pg.click('button:has-text("Declare war")'); await pg.click('.btnrow button:has-text("Declare war")');
await pg.evaluate(() => window.__store.select(window.__store.state.player, null, false));
await pg.click('.tabs button:has-text("Overview")');
const cdp = await pg.context().newCDPSession(pg);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await pg.click('button[aria-label="Very fast"]');
await cdp.send('Profiler.start');
const mode = process.argv[2] || 'war';
if (mode === 'pan') { for (let i = 0; i < 60; i++) { await pg.mouse.move(400 + (i % 20) * 12, 400 + (i%7)*5); if (i === 0) await pg.mouse.down(); await pg.waitForTimeout(40);} await pg.mouse.up(); }
else await pg.waitForTimeout(6000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + t / 1000); }
// inclusive time
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const incl = new Map();
for (const [id, t] of counts) { const seen = new Set(); let cur = id; while (cur !== undefined) { const n = byId.get(cur); const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`; if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + t / 1000); } cur = parent.get(cur); } }
console.log('SELF'); [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(v.toFixed(0).padStart(6), k));
console.log('INCL'); [...incl].sort((a, b) => b[1] - a[1]).slice(0, 45).forEach(([k, v]) => console.log(v.toFixed(0).padStart(6), k));
await b.close();
