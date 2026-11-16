(() => {
'use strict';
/* ================= setup ================= */
const D = window.WW_DATA, PLUS = window.WW_PLUS || {}, VOC = window.WW_VOCAB || [], READ = window.WW_READ || [], LISTEN = window.WW_LISTEN || [], DRILL = window.WW_DRILL || { T: '', F: '', FAM: '' };
const app = document.getElementById('app'), nav = document.getElementById('nav');
const IN_CLAUDE = !!(window.claude && window.claude.use);
const CLAUDE_URL = 'https://claude.ai/artifact/Gq2uRDQ5m5fL9SgLEG7iPZ';
const LV = ['A1', 'A2', 'B1', 'B2'], LINE = { A1: 'U1', A2: 'U2', B1: 'U3', B2: 'U4' };
const DAY = 864e5, KEY = 'wortwerk.v1', B2_HOURS = 500, HOURS_CREDIT = { A1: 110, A2: 225, B1: 340 };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dstr = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => dstr(Date.now());
const midnight = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const norm = s => String(s).toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const flat = s => norm(String(s).toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u'));
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
const ICON = {
  spk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  chk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};

/* ================= content ================= */
const STATIONS = D.stations.map((s, k) => Object.assign({}, s, { k, lesson: (PLUS[s.id] && PLUS[s.id].lesson) || '', more: (PLUS[s.id] && PLUS[s.id].items) || [] }));
const stById = id => STATIONS.find(s => s.id === id);
function parseSent(raw, id, sid) {
  const cut = raw.lastIndexOf('|'); if (cut < 0) return null;
  const g = raw.slice(0, cut), en = raw.slice(cut + 1), m = g.match(/\{([^{}]+)\}/); if (!m) return null;
  const o = m[1].split('/').map(s => s.trim()).filter(Boolean); if (o.length < 2) return null;
  return { id, sid, kind: 's', en, ans: o[0], alts: o.slice(1), pre: g.slice(0, m.index), post: g.slice(m.index + m[0].length), de: g.replace(m[0], o[0]), lvl: stById(sid).lvl };
}
const SENT_CACHE = {};
function sentsOf(st) {
  const a = [];
  st.items.forEach((r, i) => a.push(parseSent(r, st.id + '.' + i, st.id)));
  st.more.forEach((r, i) => a.push(parseSent(r, st.id + '.p' + i, st.id)));
  (S.extra[st.id] || []).forEach((r, i) => a.push(parseSent(r, st.id + '.x' + i, st.id)));
  const out = a.filter(Boolean); out.forEach(x => { SENT_CACHE[x.id] = x; }); return out;
}
function parseWord(line, p, i) {
  const f = line.split('|').map(s => s.trim()); if (f.length < 2) return null;
  const w = { id: p.id + '.' + i, pid: p.id, lvl: p.lvl, de: f[0], en: f[1], ex: f[2] || '', exEn: f[3] || '', kind: 'x' };
  const m = f[0].match(/^(der|die|das) (.+?)(?:, (.+))?$/);
  if (m && /^[A-ZÄÖÜ][\wäöüßÄÖÜé-]*( \(Pl\.\))?$/.test(m[2])) {
    let name = m[2];
    if (/\(Pl\.\)$/.test(name)) { name = name.replace(/\s*\(Pl\.\)$/, ''); w.g = 'p'; } else w.g = { der: 'r', die: 'e', das: 's' }[m[1]];
    w.kind = 'n'; w.noun = name; w.art = m[1]; w.pl = m[3] || ''; w.ans = m[1] + ' ' + name;
  } else {
    const v = f[0].match(/^(.+?) \(([^)]*,[^)]*)\)$/);
    if (v) { w.kind = 'v'; w.ans = v[1]; w.forms = v[2]; } else w.ans = f[0].replace(/\s*\([^)]*\)/g, '').trim();
    if (w.kind === 'x' && /^(sich )?[a-zäöüß]+(en|ern|eln)$/.test(w.ans) && /^to /.test(w.en)) w.kind = 'v';
  }
  return w;
}
const WORDS = [], WMAP = {}, PACKS = [];
(function buildWords() {
  const seen = new Set();
  VOC.forEach(p => {
    const pk = { id: p.id, lvl: p.lvl, t: p.t, en: p.en, tag: p.tag, words: [] };
    p.w.trim().split('\n').forEach((line, i) => {
      const w = parseWord(line, p, i); if (!w) return;
      const key = w.ans.toLowerCase(); if (seen.has(key)) return; seen.add(key);
      pk.words.push(w); WORDS.push(w); WMAP[w.id] = w;
    });
    PACKS.push(pk);
  });
})();
let MYPACK = null;
function buildMyPack() {
  MYPACK = { id: 'my', lvl: lvlNow(), t: 'Meine Wörter', en: 'Words you saved from stories', tag: 'my', words: [] };
  (S.my || []).forEach((line, i) => { const w = parseWord(line, { id: 'my', lvl: MYPACK.lvl }, i); if (w) { MYPACK.words.push(w); WMAP[w.id] = w; } });
}
const packById = id => id === 'my' ? MYPACK : PACKS.find(p => p.id === id);
function getItem(id) {
  if (WMAP[id]) return WMAP[id];
  if (SENT_CACHE[id]) return SENT_CACHE[id];
  const st = /^s\d+\./.test(id) && stById(id.split('.')[0]);
  if (st) { sentsOf(st); return SENT_CACHE[id] || null; }
  return null;
}
/* course order: per level, vocab packs and grammar stations interleaved */
const UNITS = {};
LV.forEach(l => {
  const ps = PACKS.filter(p => p.lvl === l), ss = STATIONS.filter(s => s.lvl === l), out = [];
  const n = ps.length + ss.length; let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const wantP = b >= ss.length || (a < ps.length && (a + 1) / (ps.length + 1) <= (b + 1) / (ss.length + 1));
    if (wantP) out.push({ type: 'pack', ref: ps[a++] }); else out.push({ type: 'station', ref: ss[b++] });
  }
  UNITS[l] = out;
});

/* ================= state ================= */
const fresh = () => ({ v: 2, t: 0, prof: { name: '', why: [], mins: 45, target: 0, start: 0, onboarded: false, placed: '', base: 0, credit: 0 }, it: {}, les: {}, xp: 0, streak: 0, lastDay: '', hist: {}, secs: 0, outMin: 0, out: {}, hi: { blitz: 0, verb: 0 }, read: {}, checks: {}, extra: {}, my: [], soon: [], sk: {}, set: { audio: true, sfx: true, autoplay: true, voice: 'buttery', rate: 1 }, freeze: 0, recs: {}, exams: [], badges: {}, certs: {}, heard: {}, wk: '' });
let S = fresh();
function migrate(r) {
  if (!r) return null;
  if (r.v === 2) return Object.assign(fresh(), r, { prof: Object.assign(fresh().prof, r.prof), set: Object.assign(fresh().set, r.set) });
  if (r.v === 1) {
    const n = fresh(), IVv1 = [0, 1, 2, 4, 8, 16, 35, 75, 150];
    Object.entries(r.it || {}).forEach(([id, a]) => { n.it[id] = [IVv1[a[0]] || 1, a[1], 2.5, 0, a[0], 0]; });
    Object.entries(r.hist || {}).forEach(([d, x]) => { n.hist[d] = { xp: x, s: 0, a: 0, c: 0, w: 0, g: 0 }; });
    Object.assign(n, { xp: r.xp || 0, streak: r.streak || 0, lastDay: r.lastDay || '', hi: r.hi || n.hi, extra: r.extra || {} });
    if (r.start) n.prof.start = r.start;
    STATIONS.forEach(s => { if (s.items.some((_, i) => n.it[s.id + '.' + i])) n.les[s.id] = 1; });
    return n;
  }
  return null;
}
try { const m = migrate(JSON.parse(localStorage.getItem(KEY))); if (m) S = m; } catch (e) {}
let cloudRef = null, cloudReady = false, cloudBusy = false, cloudDirty = false, cloudTimer = 0;
function save() {
  S.t = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  if (cloudReady) { clearTimeout(cloudTimer); cloudTimer = setTimeout(push, 2500); }
}
/* Cloud sync in chunks: one artifact database document holds at most 256 KiB, and a year of
   progress (4,000+ items) is larger than that. "state" holds everything except the memory records;
   those are split over it0, it1, … and only changed chunks are written. */
const CHUNK = 700;
let cloudCol = null, lastChunks = [];
function splitState() {
  const ids = Object.keys(S.it).sort(), chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) { const o = {}; ids.slice(i, i + CHUNK).forEach(id => { o[id] = S.it[id].map(v => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v); }); chunks.push(JSON.stringify(o)); }
  const rest = Object.assign({}, S, { it: undefined }); delete rest.it;
  return { head: JSON.stringify(rest), chunks };
}
async function push() {
  if (!cloudCol) return;
  if (cloudBusy) { cloudDirty = true; return; }
  cloudBusy = true;
  try {
    const { head, chunks } = splitState();
    for (let i = 0; i < chunks.length; i++) if (lastChunks[i] !== chunks[i]) { await cloudCol.doc('it' + i).set({ json: chunks[i] }); lastChunks[i] = chunks[i]; }
    await cloudCol.doc('state').set({ json: head, t: S.t, chunks: chunks.length, v: 3 });
  } catch (e) {}
  cloudBusy = false;
  if (cloudDirty) { cloudDirty = false; push(); }
}
const use = n => IN_CLAUDE ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
let AI = null, TTS = null, DICT = null, aiCtl = null;
async function initCloud() {
  const [db, user] = await Promise.all([use('db'), use('user')]);
  if (!db || !user) return;
  try {
    const id = await user.id(); if (!id) return;
    cloudCol = db.collection('data/users/' + id); cloudRef = cloudCol.doc('state');
    const snap = await cloudRef.get();
    if (snap.exists) {
      const head = snap.data(), raw = JSON.parse(head.json);
      if (head.v === 3) {
        raw.it = {};
        for (let i = 0; i < (head.chunks || 0); i++) { const c = await cloudCol.doc('it' + i).get(); if (c.exists) { lastChunks[i] = c.data().json; Object.assign(raw.it, JSON.parse(c.data().json)); } }
      }
      const r = migrate(raw);
      if (r && (r.t || 0) > (S.t || 0)) { S = r; buildMyPack(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} if (V.name === 'onb' && S.prof.onboarded) go('home'); else if (!FOCUS.includes(V.name)) render(); }
    }
    cloudReady = true; if (S.t) push();
    if (V.name === 'me') render();
  } catch (e) {}
}
use('sample').then(s => { AI = s; if (s && ['home', 'practice', 'station', 'tutor'].includes(V.name)) render(); });
let PERM = null; use('permissions').then(x => { PERM = x; });
use('tts').then(t => { TTS = t; });
let DL = null; use('downloads').then(d => { DL = d; if (d && V.name === 'me') render(); });
use('dictation').then(d => {
  DICT = d; if (!d) return;
  d.onFinal(({ text }) => micText(text));
  d.onState(({ state }) => micState(state === 'listening' || state === 'starting'));
  if (FOCUS.includes(V.name)) render();
});

/* ================= audio and mic ================= */
let voice = null;
const pickVoice = () => { try { const vs = speechSynthesis.getVoices(); voice = vs.find(v => /^de[-_]DE/i.test(v.lang) && /google|enhanced|premium|natural/i.test(v.name)) || vs.find(v => /^de/i.test(v.lang)) || null; } catch (e) {} };
if ('speechSynthesis' in window) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {} }
const canSpeak = () => !!TTS || ('speechSynthesis' in window);
const VOICES = ['buttery', 'airy', 'glassy', 'rounded'];
function noGermanVoice() { try { return 'speechSynthesis' in window && speechSynthesis.getVoices().length > 0 && !speechSynthesis.getVoices().some(v => /^de/i.test(v.lang)); } catch (e) { return false; } }
function warnOnce(key, msg) { warnOnce.done = warnOnce.done || {}; if (!warnOnce.done[key]) { warnOnce.done[key] = 1; toast(msg); } }
function browserSay(text, slow) { if (!('speechSynthesis' in window)) { warnOnce('nosynth', 'No voice available in this view. Open Wortwerk in Chrome or the Claude desktop app.'); return; } if (noGermanVoice()) warnOnce('node', 'Your device has no German voice installed, so audio may sound wrong. Add one in your system language settings.'); try { const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 0.92 * (S.set.rate || 1) * (slow ? 0.75 : 1); if (voice) u.voice = voice; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} }
function say(text, slow) {
  if (!text) return;
  const rate = (S.set.rate || 1) * (slow ? 0.75 : 1);
  if (TTS) { TTS.speak(text, { language: 'de', rate, voice: S.set.voice || 'buttery' }).catch(e => ttsFail(e, () => browserSay(text, slow))); return; }
  browserSay(text, slow);
}
function ttsFail(e, fallback) {
  const c = e && e.code;
  if (c === 'stopped' || c === 'busy') return;
  if (c === 'unavailable' || c === 'not_granted') TTS = null;
  warnOnce('tts' + c, c === 'not_granted' ? 'Claude voice is switched off for this page (Permissions menu). Using your device voice.' : c === 'rate_limited' ? 'Claude voice is busy for a moment. Using your device voice.' : 'Claude voice failed (' + (c || 'error') + '). Using your device voice.');
  fallback();
}
function sayLines(lines, slow) {
  const rate = (S.set.rate || 1) * (slow ? 0.8 : 1), main = S.set.voice || 'buttery', order = [main].concat(VOICES.filter(v => v !== main)), vmap = {};
  let k = 0; lines.forEach(l => { if (!(l.who in vmap)) vmap[l.who] = order[k++ % order.length]; });
  if (TTS) { TTS.speak(lines.map(l => ({ text: l.text, voice: vmap[l.who] })), { language: 'de', rate }).catch(e => ttsFail(e, () => browserLines(lines, rate))); return; }
  browserLines(lines, rate);
}
function browserLines(lines, rate) {
  try {
    speechSynthesis.cancel(); const vs = speechSynthesis.getVoices().filter(v => /^de/i.test(v.lang)), who = [...new Set(lines.map(l => l.who))];
    lines.forEach(l => { const u = new SpeechSynthesisUtterance(l.text), i = who.indexOf(l.who); u.lang = 'de-DE'; u.rate = 0.92 * rate; if (vs.length) u.voice = vs[i % vs.length]; u.pitch = i % 2 ? 0.8 : 1.1; speechSynthesis.speak(u); });
  } catch (e) {}
}
function stopSpeech() { try { if (TTS) TTS.stop().catch(() => {}); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} }
const SR = !IN_CLAUDE && (window.SpeechRecognition || window.webkitSpeechRecognition);
let rec = null, micFor = '';
const canMic = () => !!DICT || !!SR;
function micText(text) { const el = document.getElementById(micFor); if (el) { el.value = (el.value + ' ' + text).trim(); el.dispatchEvent(new Event('input')); } }
function micState(on) { document.querySelectorAll('.mic').forEach(b => b.classList.toggle('on', on)); }
function micToggle(target) {
  micFor = target;
  if (DICT) {
    if (DICT.active()) { DICT.stop().catch(() => {}); return; }
    DICT.start({ language: 'de' }).catch(e => { if (e && e.code === 'unavailable') { DICT = null; render(); toast('Dictation isn\'t available here.'); } else if (e && e.code === 'not_granted') toast('Microphone access is off for this page.'); });
    return;
  }
  if (!SR) return;
  if (rec) { rec.stop(); return; }
  try {
    rec = new SR(); rec.lang = 'de-DE'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) micText(ev.results[i][0].transcript); };
    rec.onend = () => { rec = null; micState(false); };
    rec.onerror = ev => { if (ev.error === 'not-allowed') toast('Allow microphone access to practise speaking.'); };
    rec.start(); micState(true);
  } catch (e) { rec = null; toast('Speech recognition isn\'t available in this browser.'); }
}
function micStop() { if (DICT && DICT.active()) DICT.stop().catch(() => {}); if (rec) { try { rec.stop(); } catch (e) {} } }
let actx = null;
function beep(ok) {
  if (!S.set.sfx) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    (ok ? [660, 990] : [200]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
      o.type = ok ? 'sine' : 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch (e) {}
}
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2800); }
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['--u1', '--u2', '--u3', '--u4', '--accent'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span'); s.className = 'cf';
    s.style.cssText = `background:var(${cols[i % 5]});--x:${(Math.random() - 0.5) * 520}px;--y:${(Math.random() - 0.3) * 520}px;--rt:${Math.random() * 720}deg`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 1050);
  }
}

/* ================= memory model (spaced repetition) ================= */
/* S.it[id] = [interval days, due ms, ease, lapses, streak of correct reviews, last seen ms] */
const rec_ = id => S.it[id];
const learned = id => !!S.it[id];
/* FSRS-4 style scheduler: r[6] = stability (days), r[7] = difficulty (1-10). Interval targets 90% recall. */
const FW = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];
const D0 = g => clamp(FW[4] - (g - 3) * FW[5], 1, 10);
function fsrsInit(r) { if (r[6] == null) { r[6] = Math.max(0.5, r[0] || 1); r[7] = clamp(11 - (r[2] || 2.5) * 3, 1, 10); } return r; }
function retr(r) { fsrsInit(r); const t = Math.max(0, (Date.now() - (r[5] || Date.now())) / DAY); return Math.pow(1 + t / (9 * r[6]), -1); }
const isWeak = r => r[3] > 0 || (r[7] || 0) > 6.5;
function learn(id, known) {
  if (S.soon && S.soon.length) S.soon = S.soon.filter(x => x !== id);
  const now = Date.now();
  S.it[id] = known ? [14, midnight() + (2 + Math.floor(Math.random() * 40)) * DAY, 2.5, 0, 2, now, 14, 4] : [1, midnight() + DAY, 2.5, 0, 1, now, FW[2], D0(3)];
}
function review(id, ok, q) {
  const r = S.it[id]; if (!r) return;
  fsrsInit(r);
  const g = !ok ? 1 : q === 'hard' ? 2 : q === 'easy' ? 4 : 3, R = retr(r), D = r[7], St = r[6];
  const nD = clamp(FW[7] * D0(3) + (1 - FW[7]) * (D - FW[6] * (g - 3)), 1, 10);
  let nS = ok ? St * (Math.exp(FW[8]) * (11 - D) * Math.pow(St, -FW[9]) * (Math.exp(FW[10] * (1 - R)) - 1) * (g === 2 ? FW[15] : 1) * (g === 4 ? FW[16] : 1) + 1)
              : FW[11] * Math.pow(D, -FW[12]) * (Math.pow(St + 1, FW[13]) - 1) * Math.exp(FW[14] * (1 - R));
  nS = clamp(nS, 0.1, 3650);
  r[6] = nS; r[7] = nD; r[5] = Date.now(); r[2] = (11 - nD) / 3;
  if (ok) { r[4]++; r[0] = clamp(Math.round(nS), 1, 365); r[1] = midnight() + r[0] * DAY; }
  else { r[3]++; r[4] = 0; r[0] = 0; r[1] = Date.now(); }
}
const strong = id => S.it[id] && S.it[id][0] >= 21;
/* skill stats: [correct, total] rolling */
function stat(sk, ok) { const a = S.sk[sk] || [0, 0]; a[0] += ok ? 1 : 0; a[1]++; if (a[1] > 400) { a[0] *= 0.75; a[1] *= 0.75; } S.sk[sk] = a; }
const SKILLS = { rec: 'Recognising words', recall: 'Producing words', art: 'Articles (der/die/das)', gram: 'Grammar choices', conj: 'Verb forms', case: 'Case & adjective endings', trans: 'Building sentences', lis: 'Listening', spk: 'Speaking' };

/* ================= progress, time, plan ================= */
function H(d) { d = d || today(); let h = S.hist[d]; if (typeof h === 'number') h = S.hist[d] = { xp: h, s: 0, a: 0, c: 0, w: 0, g: 0 }; if (!h) h = S.hist[d] = { xp: 0, s: 0, a: 0, c: 0, w: 0, g: 0 }; return h; }
const hget = d => { const h = S.hist[d]; return typeof h === 'number' ? { xp: h, s: 0, a: 0, c: 0, w: 0, g: 0 } : (h || null); };
function dayTouch() {
  const t = today();
  if (S.lastDay !== t) {
    if (S.lastDay === dstr(Date.now() - DAY)) S.streak++;
    else if (S.lastDay === dstr(Date.now() - 2 * DAY) && S.freeze > 0) { S.freeze--; S.streak++; setTimeout(() => toast('A streak freeze saved your streak.'), 400); }
    else S.streak = 1;
    if (S.streak % 7 === 0) S.freeze = Math.min(2, (S.freeze || 0) + 1);
    S.lastDay = t;
  }
  if (!S.prof.start) S.prof.start = Date.now();
  const ks = Object.keys(S.hist).sort(); while (ks.length > 120) delete S.hist[ks.shift()];
}
function addXp(n) { dayTouch(); S.xp += n; H().xp += n; }
let lastAct = 0;
function tick() { const now = Date.now(); if (lastAct && now - lastAct < 5 * 60e3) { const d = Math.min(now - lastAct, 90e3) / 1000; S.secs += d; H().s += d; } lastAct = now; }
const streakNow = () => (S.lastDay === today() || S.lastDay === dstr(Date.now() - DAY) || (S.lastDay === dstr(Date.now() - 2 * DAY) && S.freeze > 0)) ? S.streak : 0;
const minsToday = () => Math.round(((hget(today()) || {}).s || 0) / 60);
const playerLvl = () => Math.floor(Math.sqrt(S.xp / 80)) + 1;
const hoursTotal = () => S.secs / 3600 + (S.outMin || 0) / 60 + (S.prof.credit || 0);
const wordsLearned = l => WORDS.filter(w => (!l || w.lvl === l) && learned(w.id)).length;
const allSents = () => STATIONS.flatMap(sentsOf);
const stDone = st => !!S.les[st.id] && sentsOf(st).every(x => learned(x.id));
const packDone = p => p.words.every(w => learned(w.id));
function lvlFrac(l) {
  const ws = WORDS.filter(w => w.lvl === l), ss = STATIONS.filter(s => s.lvl === l).flatMap(sentsOf);
  return (ws.filter(w => learned(w.id)).length + ss.filter(x => learned(x.id)).length) / Math.max(1, ws.length + ss.length);
}
function lvlNow() { const placed = LV.indexOf(S.prof.placed); for (const [i, l] of LV.entries()) if (i > placed && (lvlFrac(l) < 0.85 || !(S.checks[l] >= 75))) return l; return 'B2'; }
function dueList() {
  const now = Date.now(), out = [];
  for (const id in S.it) if (S.it[id][1] <= now) { const x = getItem(id); if (x) out.push(x); }
  return out.sort((a, b) => retr(S.it[a.id]) - retr(S.it[b.id]));
}
function recentAcc(days) { let a = 0, c = 0; for (let i = 0; i < days; i++) { const h = hget(dstr(Date.now() - i * DAY)); if (h) { a += h.a; c += h.c; } } return a >= 20 ? c / a : null; }
function plan() {
  const now = Date.now(), start = S.prof.start || now, target = S.prof.target || start + 365 * DAY;
  const daysLeft = Math.max(7, (target - now) / DAY), span = Math.max(30, (target - start) / DAY);
  const sents = allSents(), W = WORDS.length, Sn = sents.length;
  const wl = WORDS.filter(w => learned(w.id)).length, sl = sents.filter(x => learned(x.id)).length;
  const due = Object.values(S.it).filter(r => r[1] <= now).length, acc = recentAcc(7);
  // Quality guard: struggling (low accuracy) or a big review pile means slow down new material a little, never stop it.
  let fac = acc == null ? 1 : acc < 0.6 ? 0.75 : acc < 0.75 ? 0.9 : 1;
  if (due > 250) fac *= 0.75; if (due > 500) fac *= 0.6;
  const usable = daysLeft * 0.9, mins = S.prof.mins || 45;
  const wNeed = (W - wl) / usable, sNeed = (Sn - sl) / usable;
  // What your daily minutes can hold: about 2 minutes per new item including its later reviews.
  const capW = mins * 0.42, capS = mins * 0.1;
  const newW = W - wl ? Math.round(clamp(wNeed * 1.1, 3, capW) * fac) : 0;
  const newS = Sn - sl ? Math.round(clamp(Math.max(sNeed * 1.1, 1), 1, capS) * fac) : 0;
  const needDay = Math.ceil(wNeed + sNeed), fits = wNeed * 1.1 <= capW + 0.5 && sNeed * 1.1 <= capS + 0.5;
  const needMins = [20, 30, 45, 60, 90].find(m => wNeed * 1.1 <= m * 0.42 + 0.5 && sNeed * 1.1 <= m * 0.1 + 0.5) || 90;
  const frac = (wl + sl) / (W + Sn), base = S.prof.base || 0, tFrac = clamp((now - start) / (target - start || 1), 0, 1);
  const expected = base + (1 - base) * tFrac, aheadDays = Math.round((frac - expected) * span);
  // Pace = new items per day since you started (max last 14 days). Days before your start don't count; skipped days do.
  // Today only counts once today's plan is done, so an unfinished morning doesn't drag the forecast down.
  const sinceStart = Math.floor((now - start) / DAY), win = Math.min(14, sinceStart), th = hget(today()) || {}, tN = (th.w || 0) + (th.g || 0);
  let pace = 0, pd = 0; for (let i = 1; i <= win; i++) { const h = hget(dstr(now - i * DAY)); pace += h ? (h.w || 0) + (h.g || 0) : 0; pd++; }
  if (tN >= newW + newS || !pd) { pace += tN; pd++; }
  pace = pd ? pace / pd : 0;
  const projected = pace > 0.5 && (pd >= 2 || tN >= newW + newS) ? now + ((W - wl) + (Sn - sl)) / pace * DAY : 0;
  const hrs = hoursTotal(), hrsPerDay = Math.max(0, (B2_HOURS - hrs) / daysLeft);
  const h = hget(today()) || {};
  return { daysLeft, target, wl, sl, W, Sn, due, acc, fac, newW, newS, frac, aheadDays, projected, pace, needDay, fits, needMins, hrs, hrsPerDay, doneW: h.w || 0, doneS: h.g || 0 };
}
/* Daily load limits: how much new material and review a brain can usefully take in one day. */
const revCap = () => Math.round((S.prof.mins || 45) * 2.4);
const newCap = () => { const p = plan(); return Math.max(clamp(Math.round((S.prof.mins || 45) * 0.55), 12, 50), p.newW + p.newS); };
const TIRED_MS = 3 * 3600e3; // a fatigue stop rests you for 3 hours, then you can do a second session
function dayState() {
  const h = hget(today()) || {}, mins = (h.s || 0) / 60, goal = S.prof.mins || 45, news = (h.w || 0) + (h.g || 0);
  if (h.tired && Date.now() - (h.tired > 1 ? h.tired : 0) < TIRED_MS) return { enough: true, reason: 'tired', mins, news };
  if (news >= newCap() && mins >= goal * 0.6) return { enough: true, reason: 'new', mins, news };
  if (mins >= goal * 1.15) return { enough: true, reason: 'time', mins, news };
  return { enough: false, mins, news };
}

/* ================= picking content ================= */
function nextNewWords(n, pid) {
  const out = [];
  const add = w => { if (out.length < n && !learned(w.id) && !out.includes(w)) out.push(w); };
  if (pid) { (packById(pid) || { words: [] }).words.forEach(add); return out; }
  (S.soon || []).forEach(id => WMAP[id] && add(WMAP[id]));
  const prefer = new Set(S.prof.why.length ? whyTags() : []);
  for (const l of LV) {
    const units = UNITS[l].filter(u => u.type === 'pack' && !packDone(u.ref));
    const ordered = units.slice(0, 3).sort((a, b) => (prefer.has(b.ref.tag) ? 1 : 0) - (prefer.has(a.ref.tag) ? 1 : 0));
    for (const u of ordered) { u.ref.words.forEach(add); if (out.length >= n) return out; }
    if (out.length >= n) return out;
  }
  return out;
}
function whyTags() { const m = { work: ['work'], study: ['study', 'society'], live: ['home', 'city', 'health'], family: ['social', 'home'], travel: ['travel', 'city', 'food'], exam: ['society', 'study'] }; return S.prof.why.flatMap(k => m[k] || []); }
function nextStation() { for (const l of LV) for (const u of UNITS[l]) if (u.type === 'station' && !stDone(u.ref)) return u.ref; return null; }
function nextUnit() { for (const l of LV) for (const u of UNITS[l]) if (u.type === 'pack' ? !packDone(u.ref) : !stDone(u.ref)) return u; return null; }

/* ================= exercises ================= */
function distract(item, field, n, pool) {
  const out = [], have = new Set([norm(item[field])]);
  for (const c of shuffle(pool)) { if (out.length >= n) break; const v = c[field]; if (!v || have.has(norm(v))) continue; have.add(norm(v)); out.push(v); }
  return out;
}
function wordPool(w) { const same = WORDS.filter(x => x.lvl === w.lvl && x.kind === w.kind && x.id !== w.id); return same.length > 8 ? same : WORDS; }
function clozeOf(w) {
  if (!w.ex) return null;
  const cands = [w.noun, w.pl, w.ans, w.ans.replace(/^sich /, '')].concat(w.forms ? w.forms.split(',').map(s => s.trim().split(' ').pop()) : []).filter(c => c && c.length >= 3 && !/\s/.test(c));
  for (const c of cands) {
    const re = new RegExp('(^|[^A-Za-zÄÖÜäöüß])(' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=[^A-Za-zÄÖÜäöüß]|$)');
    const m = w.ex.match(re); if (m) { const at = m.index + m[1].length; return { pre: w.ex.slice(0, at), word: m[2], post: w.ex.slice(at + m[2].length) }; }
  }
  return null;
}
function wordEx(w, easier) {
  const r = rec_(w.id), ivl = r ? r[0] : 0, lapses = r ? r[3] : 0;
  let lvl = ivl <= 1 ? 0 : ivl <= 4 ? 1 : ivl <= 12 ? 2 : 3;
  if (lapses >= 3 || easier) lvl = Math.max(0, lvl - 1);
  if (lvl === 0) return { t: 'wMc', x: w };
  if (lvl === 1) return { t: w.kind === 'n' && w.g !== 'p' && Math.random() < 0.4 ? 'wArt' : 'wMcR', x: w };
  if (lvl >= 2 && w.kind === 'n' && w.pl && w.pl !== '-' && Math.random() < 0.25) return { t: 'wPlural', x: w };
  if (lvl === 2) return { t: 'wType', x: w };
  const opts = ['wType'];
  if (clozeOf(w)) opts.push('wCloze', 'wCloze');
  if (canSpeak()) opts.push('wListen');
  return { t: pick(opts), x: w };
}
function sentEx(x, easier) {
  const r = rec_(x.id), ivl = r ? r[0] : 0;
  let lvl = ivl <= 1 ? 0 : ivl <= 3 ? 1 : ivl <= 8 ? 2 : ivl <= 20 ? 3 : 4;
  if ((r && r[3] >= 3) || easier) lvl = Math.max(0, lvl - 1);
  let t = ['sMc', 'sBuild', 'sCloze', 'sListen', 'sWrite'][lvl];
  if (lvl === 4 && canMic() && Math.random() < 0.3) t = 'sSpeak';
  if (t === 'sListen' && !canSpeak()) t = 'sCloze';
  return { t, x };
}
const exFor = (x, easier) => x.kind === 's' ? sentEx(x, easier) : wordEx(x, easier);
function prep(e) {
  const x = e.x;
  if (e.t === 'wMc') e.opts = shuffle([x.en, ...distract(x, 'en', 3, wordPool(x))]);
  if (e.t === 'wMcR') e.opts = shuffle([x.ans, ...distract(x, 'ans', 3, wordPool(x))]);
  if (e.t === 'sMc') e.opts = shuffle([x.ans, ...x.alts.slice(0, 2)]);
  if (e.t === 'sBuild') { const tk = x.de.split(' '); e.pool = shuffle(tk.concat(x.alts.filter(a => !/\s/.test(a) && !tk.includes(a)).slice(0, 2))); e.pick = []; e.need = tk.length; }
  if (e.t === 'wCloze') { e.cz = clozeOf(x); if (!e.cz) e.t = 'wType'; }
  if (e.t === 'lesson') e.ans = e.ans || {};
  if (e.t === 'wPlural') { e.solution = 'die ' + x.pl; e.solNote = x.ans + ' → die ' + x.pl; }
  if (e.t === 'gConj') { e.solution = e.person + ' ' + e.ans[0]; e.solNote = x.ans + (x.forms ? ' (' + x.forms + ')' : ' · regular verb'); }
  if (e.t === 'gCase') { e.solution = e.prompt.replace('___', e.ans[0]); e.solNote = e.caseName + ' · ' + e.hint; }
  if (e.t === 'gAdj') { e.solution = (e.pre + e.ans[0] + e.post).trim(); e.solNote = e.caseName; }
  if (e.t === 'gTrans') { e.solution = e.ans[0]; e.solNote = e.tr.task; }
  if (e.t === 'gFix') { e.solution = e.fx.good; e.solNote = e.fx.why; }
  return e;
}
const ANSIDX = {};
WORDS.forEach(w => { const k = norm(w.ans); if (!ANSIDX[k]) ANSIDX[k] = w; });
const stripP = s => String(s).trim().replace(/[.!?,;:]+$/, '').replace(/\s+/g, ' ');
// Correct answer typed with ss for ß, ae for ä, or wrong capitals: count it, but show the exact form.
function exactNote(input, target, sentence) {
  let i = stripP(input), t = stripP(target);
  if (sentence) { i = i.charAt(0).toUpperCase() + i.slice(1); t = t.charAt(0).toUpperCase() + t.slice(1); }
  if (i === t) return '';
  if (i.toLowerCase() === t.toLowerCase()) return 'Correct. Watch the capital letters: ' + stripP(target);
  return 'Correct. Exact spelling: ' + stripP(target);
}
const tolFor = t => t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0;
const deUml = s => s.replace(/([aou])e/g, '$1');
// A one-letter slip in the middle of a long word. Never in the ending (endings carry grammar), never an umlaut.
function typoOk(x, y) {
  if (x.length < 6 || y.length < 6 || lev(x, y) !== 1 || deUml(x) === deUml(y) || ANSIDX[x]) return false;
  let p = 0; while (p < x.length && x[p] === y[p]) p++;
  let q = 0; while (q < x.length && q < y.length && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  return p >= 2 && q >= 3;
}
function checkWord(w, input) {
  const a = norm(input), t = norm(w.ans);
  if (!a) return null;
  if (a === t) return { ok: true, q: 'good', note: exactNote(input, w.ans) };
  const other = ANSIDX[a];
  if (other && other !== w) {
    const gl = z => z.toLowerCase().replace(/\(.*?\)/g, '').split(/[,;/]/).map(y => y.replace(/^to /, '').trim()).filter(Boolean), g1 = gl(w.en);
    if (gl(other.en).some(y => g1.includes(y))) return { ok: false, note: '“' + other.ans + '” means the same (' + other.en + '), but this card practises: ' + w.ans + '. If yours fits, tap “Mine was right too”.' };
    return { ok: false, note: '“' + other.ans + '” is a different word (' + other.en + '). This one is: ' + w.ans };
  }
  if (w.kind === 'n') {
    const m = a.match(/^(der|die|das) (.+)$/), body = m ? m[2] : a, raw = input.trim().replace(/^(der|die|das)\s+/i, ''), tn = norm(w.noun), close = body === tn || lev(body, tn) <= tolFor(tn) || flat(raw) === flat(w.noun);
    if (!m && close) return { ok: false, note: 'Right word, but German nouns need their article: ' + w.ans, artMiss: true };
    if (m && m[1] !== w.art && close) return { ok: false, note: 'Wrong article. It\'s ' + w.ans + '.', artMiss: true };
    if (m && m[1] === w.art) {
      if (flat(raw) === flat(w.noun)) return { ok: true, q: 'hard', note: 'Watch the umlauts: ' + w.ans };
      if (lev(body, tn) <= tolFor(tn)) return { ok: true, q: 'hard', note: 'Small typo. Correct spelling: ' + w.ans };
    }
    return { ok: false };
  }
  if (w.kind === 'v' && a === norm(w.ans.replace(/^sich /, ''))) return { ok: true, q: 'hard', note: 'Remember it\'s reflexive: ' + w.ans };
  if (flat(input) === flat(w.ans)) return { ok: true, q: 'hard', note: 'Watch the umlauts: ' + w.ans };
  if (lev(a, t) <= tolFor(t)) return { ok: true, q: 'hard', note: 'Small typo. Correct spelling: ' + w.ans };
  return { ok: false };
}
// Grammar answers (a verb form, an ending, an article, a plural): every letter matters, no typo tolerance.
function checkGram(target, input) {
  const a = norm(input), t = norm(target); if (!a) return null;
  if (a === t) return { ok: true, q: 'good', note: exactNote(input, target) };
  if (flat(input) === flat(target)) return { ok: false, note: 'So close, but the umlaut changes the grammar here. Correct: ' + target };
  if (lev(a, t) <= 2) return { ok: false, note: 'So close, but in grammar every letter counts. Correct: ' + target };
  return { ok: false };
}
// A single vocabulary word inside a sentence: allow a slip in the stem, never in the ending.
function checkClozeWord(target, input) {
  const a = norm(input), t = norm(target); if (!a) return null;
  if (a === t) return { ok: true, q: 'good', note: exactNote(input, target) };
  if (typoOk(a, t)) return { ok: true, q: 'hard', note: 'Small typo. Correct spelling: ' + target };
  return checkGram(target, input);
}
// Whole sentences: same words in the same order; a slip inside a long word is OK, a wrong ending/article/umlaut is not.
function checkSent(target, input) {
  const a = norm(input), t = norm(target); if (!a) return null;
  if (a === t) return { ok: true, q: 'good', note: exactNote(input, target, true) };
  const A = a.split(' '), T = t.split(' ');
  if (A.length === T.length) {
    let typos = 0, bad = 0;
    T.forEach((tok, i) => { if (A[i] !== tok) { if (typoOk(A[i], tok)) typos++; else bad++; } });
    if (!bad && typos <= Math.max(1, Math.floor(T.length / 8))) return { ok: true, q: 'hard', note: 'Small spelling slip. Compare: ' + stripP(target) };
    if (bad === 1 && !typos) { const i = T.findIndex((tok, k) => A[k] !== tok); return { ok: false, note: 'One word is off: you wrote “' + input.trim().split(/\s+/)[i] + '”, it should be “' + stripP(target).split(/\s+/)[i] + '”.' }; }
  }
  return { ok: false };
}
// Marks which typed words don't match the answer (for the "You wrote" line).
function diffHtml(given, target) {
  const T = norm(target).split(' ');
  return String(given).trim().split(/\s+/).map((g, i) => { const n = norm(g); return n && (T[i] === n) ? esc(g) : n && T.includes(n) ? `<span class="dmove">${esc(g)}</span>` : `<span class="dbad">${esc(g)}</span>`; }).join(' ');
}

/* ================= production drills ================= */
const TRANS = DRILL.T.trim() ? DRILL.T.trim().split('\n').map(l => { const p = l.split('|'); return { sid: p[0], from: p[1], task: p[2], ans: p.slice(3).join('|').split('||').map(z => z.trim()).filter(Boolean) }; }) : [];
const FIX = DRILL.F.trim() ? DRILL.F.trim().split('\n').map(l => { const p = l.split('|'); return { sid: p[0], bad: p[1], good: p[2], why: p[3] }; }) : [];
const FAMS = {};
DRILL.FAM.trim() && DRILL.FAM.trim().split('\n').forEach(l => { const i = l.indexOf('|'), root = l.slice(0, i), mem = l.slice(i + 1).split(';').map(z => z.split(' = ').map(y => y.trim())); const fam = { root, mem }; [root].concat(mem.map(m => m[0])).forEach(k => { FAMS[k.toLowerCase()] = fam; }); });
const familyOf = w => FAMS[(w.ans || '').toLowerCase()] || (w.noun && FAMS[w.noun.toLowerCase()]) || null;
const NOCONJ = new Set(['möchten', 'mögen', 'wissen', 'haben', 'sein', 'werden', 'tun', 'können', 'müssen', 'wollen', 'sollen', 'dürfen']);
const SEPS = /^(ab|an|auf|aus|bei|dar|durch|ein|entgegen|fern|fest|her|hin|klar|los|mit|nach|statt|stumm|teil|um|vor|weg|zu|zurück|zusammen|weiter|kennen|spazieren|sauber|frei|dazu|kaputt)/;
function conjRegular(inf, p) {
  if (!/^[a-zäöüß]+en$/.test(inf) || /(eln|ern)$/.test(inf) || NOCONJ.has(inf) || SEPS.test(inf)) return null;
  const st = inf.slice(0, -2), e = /[td]$/.test(st) || /chn$/.test(st) || /[^aeiouäöülrhmn][mn]$/.test(st), sz = /[sßzx]$/.test(st);
  return { ich: st + 'e', du: st + (e ? 'est' : sz ? 't' : 'st'), 'er/sie': st + (e ? 'et' : 't'), wir: inf, ihr: st + (e ? 'et' : 't') }[p];
}
window.__wwTest = () => ({ WORDS, checkWord, checkGram, checkSent, checkClozeWord, conjRegular, isWeakNoun, parseWord, plan, dayState, newCap, revCap, S: () => S, R: () => R, start: (k, o) => start(k, o), dstr, allSents });
const learnedVerbs = () => WORDS.filter(w => w.kind === 'v' && learned(w.id));
const WEAKN = new Set(['Mensch', 'Herr', 'Nachbar', 'Bär', 'Bauer', 'Held', 'Prinz', 'Pilot', 'Kunde', 'Junge', 'Kollege', 'Name', 'Gedanke', 'Buchstabe', 'Glaube', 'Wille', 'Friede', 'Frieden', 'Herz', 'Graf', 'Fürst', 'Narr', 'Christ', 'Automat', 'Satellit', 'Planet', 'Komet', 'Elefant', 'Affe', 'Löwe', 'Hase', 'Rabe']);
const isWeakNoun = w => WEAKN.has(w.noun) || (w.g === 'r' && w.pl && (w.pl === w.noun + 'n' || w.pl === w.noun + 'en') && /(e|ent|ant|ist|at|oge|nom|graf|graph|soph|it|et)$/.test(w.noun));
const learnedNouns = () => WORDS.filter(w => w.kind === 'n' && /^[rse]$/.test(w.g) && !isWeakNoun(w) && learned(w.id));
const TENSES = ['Präsens', 'Präteritum', 'Perfekt'];
function conjStep() {
  const vs = learnedVerbs(); if (vs.length < 4) return null;
  for (let k = 0; k < 25; k++) {
    const w = pick(vs);
    if (w.forms) {
      const f = w.forms.split(',').map(z => z.trim()); if (f.length < 3) continue;
      const i = Math.random() * 3 | 0; if (i === 1 && !S.les.s15 && !S.les.s24) continue; if (i === 2 && !S.les.s07) continue;
      return { t: 'gConj', x: w, person: 'er/sie', tense: TENSES[i], ans: [f[i]], skill: 'conj' };
    }
    const per = pick(['ich', 'du', 'er/sie', 'wir', 'ihr']), a = conjRegular(w.ans, per);
    if (a) return { t: 'gConj', x: w, person: per, tense: 'Präsens', ans: [a], skill: 'conj' };
  }
  return null;
}
const DET = { def: { n: { r: 'der', e: 'die', s: 'das' }, a: { r: 'den', e: 'die', s: 'das' }, d: { r: 'dem', e: 'der', s: 'dem' } },
  ind: { n: { r: 'ein', e: 'eine', s: 'ein' }, a: { r: 'einen', e: 'eine', s: 'ein' }, d: { r: 'einem', e: 'einer', s: 'einem' } },
  pos: { n: { r: 'mein', e: 'meine', s: 'mein' }, a: { r: 'meinen', e: 'meine', s: 'mein' }, d: { r: 'meinem', e: 'meiner', s: 'meinem' } } };
const PREPS = [['mit', 'd'], ['von', 'd'], ['für', 'a'], ['ohne', 'a'], ['gegen', 'a']];
function caseStep() {
  const ns = learnedNouns(); if (ns.length < 8 || !S.les.s02) return null;
  const ps = PREPS.filter(z => z[1] === 'a' || S.les.s09), [prep, c] = pick(ps), n = pick(ns), set = DET[pick(['def', 'ind', 'pos'])];
  return { t: 'gCase', x: n, prompt: `${prep} ___ ${n.noun}`, hint: `${set.n[n.g]} ${n.noun}`, caseName: c === 'd' ? 'Dativ' : 'Akkusativ', ans: [set[c][n.g]], skill: 'case' };
}
const ADJS = ['neu', 'alt', 'groß', 'klein', 'gut', 'schön', 'rot', 'interessant', 'kalt', 'schnell'];
const ENDS = { def: { n: { r: 'e', e: 'e', s: 'e' }, a: { r: 'en', e: 'e', s: 'e' }, d: { r: 'en', e: 'en', s: 'en' } }, ind: { n: { r: 'er', e: 'e', s: 'es' }, a: { r: 'en', e: 'e', s: 'es' }, d: { r: 'en', e: 'en', s: 'en' } } };
function adjStep() {
  const ns = learnedNouns(); if (ns.length < 8 || !S.les.s16) return null;
  const n = pick(ns), adj = pick(ADJS), c = pick(['n', 'a', 'd']), k = pick(['def', 'ind']), det = DET[k][c][n.g];
  const fr = { n: ['Das ist', '.'], a: ['Ich sehe', '.'], d: ['mit', ''] }[c];
  return { t: 'gAdj', x: n, pre: `${fr[0]} ${det} `, post: ` ${n.noun}${fr[1]}`, hint: adj, caseName: { n: 'Nominativ', a: 'Akkusativ', d: 'Dativ' }[c], ans: [adj + ENDS[k][c][n.g]], skill: 'case' };
}
const transFrom = t => ({ t: 'gTrans', x: { id: 'T:' + t.from + t.task, kind: 'g', de: t.ans[0], en: t.task }, tr: t, ans: t.ans, skill: 'trans' });
function transStep() { const ok = TRANS.concat(S.aiT || []).filter(t => S.les[t.sid]); return ok.length ? transFrom(pick(ok)) : null; }
function fixStep() {
  const ok = FIX.concat(S.aiF || []).filter(f => S.les[f.sid]); return ok.length ? fixFrom(pick(ok)) : null;
}
function fixFrom(f) {
  const b = f.bad.split(' '), g = f.good.split(' ');
  let i = 0; while (i < b.length && b[i] === g[i]) i++;
  let j = 0; while (j < b.length - i && j < g.length - i && b[b.length - 1 - j] === g[g.length - 1 - j]) j++;
  const errs = []; for (let k = i; k < b.length - j; k++) errs.push(k);
  if (!errs.length) { errs.push(Math.min(i, b.length - 1)); if (i > 0) errs.push(i - 1); }
  return { t: 'gFix', x: { id: 'F:' + f.bad, kind: 'g', de: f.good, en: f.why }, fx: f, toks: b, errs, skill: 'trans' };
}
const DRILLGEN = { conj: conjStep, case: caseStep, adj: adjStep, trans: transStep, fix: fixStep };
const DRILLSK = { conj: 'conj', case: 'case', adj: 'case', trans: 'trans', fix: 'trans' };
function drillSteps(n, type) {
  let keys = type ? [type] : Object.keys(DRILLGEN);
  const acc = k => { const a = S.sk[DRILLSK[k]]; return a && a[1] >= 6 ? a[0] / a[1] : 0.6; };
  const out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 8 && keys.length; tries++) {
    const k = type || keys.slice().sort((a, b) => acc(a) - acc(b) + (Math.random() - 0.5) * 0.5)[0];
    const st = DRILLGEN[k]();
    if (!st) { keys = keys.filter(z => z !== k); continue; }
    const key = st.t + st.x.id + (st.ans || []).join('/') + (st.person || '');
    if (seen.has(key)) continue; seen.add(key);
    out.push(Object.assign(st, { free: true, drill: true }));
  }
  return out;
}

/* ================= sessions ================= */
let V = { name: 'home' }, R = null, G = null, C = null, ST = null;
const FOCUS = ['ride', 'done', 'blitz', 'verb', 'chat', 'story', 'onb', 'reader', 'dialog', 'exam', 'cards'];
function newWordBlock(ws) {
  const q = [];
  ws.forEach(w => q.push({ t: 'wIntro', x: w, isNew: true }));
  shuffle(ws).forEach(w => q.push({ t: 'wMc', x: w, isNew: true }));
  shuffle(ws).forEach(w => q.push({ t: w.kind === 'n' && w.g !== 'p' ? 'wArt' : 'wMcR', x: w, isNew: true }));
  return q;
}
const finalWord = w => ({ t: 'wType', x: w, isNew: true, final: true });
function newSentBlock(xs) { return { a: xs.map(x => ({ t: 'sMc', x, isNew: true })), b: xs.map(x => ({ t: 'sBuild', x, isNew: true, final: true })) }; }
function start(kind, opts) {
  opts = opts || {};
  let q = [], title = '';
  if (kind === 'daily') {
    const p = plan(), due = dueList(), h = H(), ds = dayState();
    const capLeft = Math.max(0, revCap() - (h.rv || 0));
    const revN = Math.min(capLeft, clamp(Math.round((S.prof.mins || 45) * 1.2), 15, 90));
    const reviews = due.slice(0, revN).map(x => exFor(x));
    const newLeft = ds.enough || opts.reviewOnly ? 0 : Math.max(0, newCap() - (h.w || 0) - (h.g || 0));
    const leftW = Math.min(newLeft, Math.max(0, p.newW - p.doneW)), leftS = Math.min(newLeft, Math.max(0, p.newS - p.doneS));
    const ws = nextNewWords(Math.min(16, leftW || (due.length < 10 && newLeft ? Math.min(5, newLeft) : 0)));
    const ws1 = ws.slice(0, 8), ws2 = ws.slice(8);
    let lesson = null, nx = [];
    const st = nextStation();
    if (st && newLeft && (leftS > 0 || !due.length)) {
      if (!S.les[st.id]) lesson = st;
      nx = sentsOf(st).filter(x => !learned(x.id)).slice(0, S.les[st.id] ? clamp(leftS, 2, 5) : 4);
    }
    const sb = newSentBlock(nx), drills = drillSteps(reviews.length + ws.length * 4 > 30 ? 3 : 5);
    q = reviews.slice(0, 6).concat(newWordBlock(ws1), reviews.slice(6, 14), lesson ? lessonSteps(lesson) : [], sb.a, ws2.length ? newWordBlock(ws2) : [], drills, reviews.slice(14, 30), ws1.map(finalWord), reviews.slice(30), ws2.map(finalWord), sb.b);
    title = 'Heute';
  } else if (kind === 'pack') {
    const pk = packById(opts.id); title = pk.t;
    const ws = nextNewWords(8, pk.id);
    if (ws.length && !opts.review) q = newWordBlock(ws).concat(ws.map(finalWord));
    else q = shuffle(pk.words.filter(w => learned(w.id))).slice(0, 15).map(w => Object.assign(exFor(w), { free: !opts.review }));
  } else if (kind === 'station') {
    const st = stById(opts.id); title = st.name;
    const fresh_ = sentsOf(st).filter(x => !learned(x.id)).slice(0, 5);
    if (!S.les[st.id] || opts.relearn) q = q.concat(lessonSteps(st));
    if (fresh_.length) { const sb = newSentBlock(fresh_); q = q.concat(sb.a, sb.b); }
    else if (S.les[st.id] && !opts.relearn) q = shuffle(sentsOf(st)).slice(0, 10).map(x => Object.assign(exFor(x), { free: true }));
  } else if (kind === 'weak') {
    title = 'Schwachstellen';
    const ids = Object.keys(S.it).filter(id => isWeak(S.it[id])).sort((a, b) => (S.it[b][3] - S.it[a][3]) || ((S.it[b][7] || 5) - (S.it[a][7] || 5))).slice(0, 14);
    const xs = ids.map(getItem).filter(Boolean);
    q = xs.map(x => exFor(x, true)).concat(shuffle(xs).map(x => exFor(x)));
  } else if (kind === 'listen') {
    title = 'Hörtraining';
    const xs = shuffle(Object.keys(S.it).map(getItem).filter(Boolean)).slice(0, 12);
    q = xs.map(x => x.kind === 's' ? { t: 'sListen', x, free: true } : (x.ex ? { t: 'cMc', free: true, x, skill: 'lis', audio: x.ex, prompt: 'What does it mean?', opts: shuffle([x.exEn, ...distract(x, 'exEn', 3, WORDS.filter(w => w.lvl === x.lvl))]), ans: x.exEn } : { t: 'wListen', x, free: true }));
  } else if (kind === 'speak') {
    title = 'Sprechtraining';
    const xs = shuffle(Object.keys(S.it).map(getItem).filter(Boolean)).slice(0, 10);
    q = xs.map(x => ({ t: 'sSpeak', x: x.kind === 's' ? x : { id: x.id, kind: 'w', de: x.ex || x.ans, en: x.exEn || x.en }, free: true }));
  } else if (kind === 'coll') { title = 'Meine Sammlung'; q = shuffle(collection(opts.filter)).slice(0, 15).map(w => ({ t: pick(['wMc', 'wMcR', 'wType', w.kind === 'n' && w.g !== 'p' ? 'wArt' : 'wType']), x: w, free: true })); }
  else if (kind === 'drill') { title = opts.title || 'Grammatik-Training'; q = opts.steps || drillSteps(12, opts.type); }
  else if (kind === 'check') { q = checkSteps(opts.lvl); title = 'Level-Check ' + opts.lvl; }
  else if (kind === 'place') { q = placeSteps(0); title = 'Einstufungstest'; }
  q = q.filter(Boolean);
  if (!q.length) { toast(kind === 'drill' ? 'Finish a grammar lesson first to unlock training.' : kind === 'weak' ? 'No weak spots yet. Keep going!' : kind === 'listen' || kind === 'speak' ? 'Learn a few words first.' : 'Nothing new here right now.'); return; }
  q.forEach(e => { e.first = true; prep(e); });
  R = { kind, opts, title, q, i: 0, combo: 0, xp: 0, ok: 0, miss: 0, nw: 0, ns: 0, fb: null, place: kind === 'place' ? { l: 0, n: 0, r: 0, passed: -1 } : null };
  lastAct = Date.now();
  go('ride'); enter();
}
function lessonSteps(st) {
  const cards = st.lesson ? st.lesson.split(/\n---\n/) : ['## ' + st.name + '\n' + st.g.join('\n')];
  return cards.map((c, i) => ({ t: 'lesson', x: { id: st.id, kind: 'L', st }, card: c, ci: i, cn: cards.length }));
}
function checkSteps(l) {
  const ws = WORDS.filter(w => w.lvl === l), xs = STATIONS.filter(s => s.lvl === l).flatMap(sentsOf);
  const q = [];
  shuffle(ws).slice(0, 8).forEach(w => q.push({ t: 'cMc', x: w, skill: 'rec', prompt: w.ans, sub: 'What does it mean?', audio: w.ans, opts: shuffle([w.en, ...distract(w, 'en', 3, ws)]), ans: w.en }));
  shuffle(ws.filter(w => w.kind === 'n' && w.g !== 'p')).slice(0, 4).forEach(w => q.push({ t: 'cMc', x: w, skill: 'art', prompt: w.noun, sub: 'Which article?', opts: ['der', 'die', 'das'], ans: w.art }));
  shuffle(xs).slice(0, 8).forEach(x => q.push({ t: 'sMc', x, check: true }));
  const lis = shuffle(xs.filter(x => !q.some(e => e.x === x))).slice(0, 4);
  lis.forEach(x => q.push(canSpeak() ? { t: 'cMc', x, skill: 'lis', audio: x.de, prompt: 'Listen. What did you hear?', opts: shuffle([x.en, ...distract(x, 'en', 3, xs)]), ans: x.en } : { t: 'sMc', x, check: true }));
  return shuffle(q).map(e => Object.assign(e, { check: true, free: true }));
}
function placeSteps(li) {
  const l = LV[li], ws = shuffle(WORDS.filter(w => w.lvl === l)), xs = shuffle(STATIONS.filter(s => s.lvl === l).flatMap(sentsOf));
  return [
    { t: 'sMc', x: xs[0] }, { t: 'cMc', x: ws[0], skill: 'rec', prompt: ws[0].ans, sub: 'What does it mean?', opts: shuffle([ws[0].en, ...distract(ws[0], 'en', 3, ws)]), ans: ws[0].en },
    { t: 'sMc', x: xs[1] }, { t: 'cMc', x: ws[1], skill: 'rec', prompt: ws[1].en, sub: 'Which is the German word?', opts: shuffle([ws[1].ans, ...distract(ws[1], 'ans', 3, ws)]), ans: ws[1].ans },
    { t: 'sMc', x: xs[2] }
  ].map(e => Object.assign(e, { check: true, free: true, place: li, idk: true }));
}
function enter() {
  const e = R.q[R.i]; if (!e) return;
  if (e.t === 'wIntro' && S.set.autoplay) say(e.x.ans);
  if (e.t === 'sListen' || e.t === 'wListen') say(e.t === 'wListen' ? e.x.ans : e.x.de);
  if (e.t === 'cMc' && e.audio && e.skill === 'lis') say(e.audio);
}
function grade(ok, given, extra) {
  const e = R.q[R.i], x = e.x; extra = extra || {};
  if (R.fb) return;
  micStop(); tick(); dayTouch();
  const h = H(); let xp = 0;
  if (e.first) { h.a++; if (ok) h.c++; if (!e.isNew && !e.free && !e.check) h.rv = (h.rv || 0) + 1; }
  if (e.first && !e.check && R.kind !== 'place') {
    R.hist = R.hist || []; R.hist.push(ok ? 1 : 0);
    const av = a => a.reduce((x, y) => x + y, 0) / a.length;
    if (!R.tiredAsked && R.hist.length >= 40) {
      const a0 = av(R.hist.slice(0, 15)), a1 = av(R.hist.slice(-15));
      if ((a1 <= a0 - 0.3 && a1 < 0.6) || a1 < 0.4) { R.tiredAsked = true; R.q.splice(R.i + 1, 0, { t: 'pause', why: 'tired', a0, a1, x: { id: 'pause' } }); }
    }
    if (!R.timeAsked && R.kind === 'daily' && minsToday() >= (S.prof.mins || 45) * 1.3) { R.timeAsked = true; R.q.splice(R.i + 1, 0, { t: 'pause', why: 'time', x: { id: 'pause' } }); }
  }
  const sk = e.skill || ({ wMc: 'rec', wMcR: 'rec', wArt: 'art', wType: 'recall', wCloze: 'recall', wListen: 'lis', sListen: 'lis', sSpeak: 'spk', wPlural: 'recall' }[e.t]) || 'gram';
  if (e.first) stat(sk, ok);
  if (extra.artMiss && e.first) stat('art', false);
  if (ok) { R.combo++; if (e.first) R.ok++; xp = e.free ? 4 : e.first ? Math.round(10 * (R.combo >= 10 ? 2 : R.combo >= 5 ? 1.5 : 1)) : 3; }
  else { R.combo = 0; if (e.first) R.miss++; }
  e.prev = S.it[x.id] ? S.it[x.id].slice() : null;
  if (!e.free && !e.check) {
    if (e.isNew) { if (ok && e.final && !learned(x.id)) { learn(x.id); if (x.kind === 's') { R.ns++; h.g++; } else { R.nw++; h.w++; } } }
    else if (e.first) review(x.id, ok, extra.q);
  }
  if (!ok && !e.check && !e.idk && e.t !== 'pause' && (e.tries || 0) < 2) { e.re = prep(Object.assign({}, e, { first: false, fbHad: true, tries: (e.tries || 0) + 1 })); if (e.re.t === 'wCloze' && !e.re.cz) e.re.t = 'wType'; R.q.splice(Math.min(R.q.length, R.i + 3), 0, e.re); }
  if (e.place != null) placeStep(ok);
  if (xp) { R.xp += xp; addXp(xp); }
  save(); beep(ok);
  R.fb = { ok, given, xp, note: extra.note, word: ok ? pick(['Richtig!', 'Genau!', 'Stark!', 'Sauber!', 'Super!', 'Top!']) : 'Not quite' };
  render();
  if (S.set.audio && !['sSpeak', 'cMc', 'gFix'].includes(e.t)) say(e.solution || (x.kind === 's' ? x.de : x.ans));
}
function placeStep(ok) {
  const p = R.place; p.n++; if (ok) p.r++;
  if (p.n === 5) {
    if (p.r >= 4) { p.passed = p.l; if (p.l < 3) { p.l++; p.n = 0; p.r = 0; const add = placeSteps(p.l); add.forEach(e => { e.first = true; prep(e); }); R.q.push(...add); } }
  }
}
function next() {
  if (!R || !R.fb) return;
  R.fb = null; R.i++;
  const e = R.q[R.i];
  if (R.kind === 'place' && R.place.n === 5 && R.place.passed < R.place.l) R.i = R.q.length;
  if (R.i >= R.q.length) return finish();
  if (e && e.t === 'wIntro') {/* nothing */}
  render(); enter(); window.scrollTo(0, 0);
}
function finish() {
  tick();
  if (R.kind === 'check') {
    const total = R.ok + R.miss, sc = total ? Math.round(R.ok / total * 100) : 0, l = R.opts.lvl;
    R.score = sc; if (!(S.checks[l] >= sc)) S.checks[l] = sc;
    if (sc >= 75) { addXp(100); R.xp += 100; confetti(); if (!S.certs[l]) S.certs[l] = { date: Date.now(), score: sc, kind: 'check' }; }
  } else if (R.kind === 'place') {
    applyPlacement(R.place.passed);
  } else { addXp(20); R.xp += 20; if (R.nw + R.ns >= 5) confetti(); }
  checkBadges(); save(); beep(true); go('done');
}
function applyPlacement(passed) {
  S.prof.placed = passed >= 0 ? LV[passed] : '';
  S.prof.credit = passed >= 0 ? HOURS_CREDIT[LV[passed]] || 0 : 0;
  for (let li = 0; li <= passed; li++) {
    const l = LV[li];
    WORDS.filter(w => w.lvl === l).forEach(w => { if (!learned(w.id)) learn(w.id, true); });
    STATIONS.filter(s => s.lvl === l).forEach(s => { S.les[s.id] = 1; sentsOf(s).forEach(x => { if (!learned(x.id)) learn(x.id, true); }); });
  }
  const sents = allSents(); S.prof.base = (Object.keys(S.it).length) / (WORDS.length + sents.length);
}

/* ================= rendering helpers ================= */
const spk = (text, cls) => canSpeak() ? `<button class="spk ${cls || ''}" data-act="say" data-t="${esc(text)}" aria-label="Listen">${ICON.spk}</button>` : '';
const artCls = w => w && w.kind === 'n' ? 'g-' + w.g : '';
function wordHead(w) { if (w.kind !== 'n') return `<span>${esc(w.ans)}</span>`; return `<span class="${artCls(w)}"><span class="art">${esc(w.art)}</span> ${esc(w.noun)}</span>`; }
function famHtml(w) {
  const f = familyOf(w); if (!f) return '';
  const self = (w.ans || '').toLowerCase(), noun = (w.noun || '').toLowerCase();
  const items = [[f.root, '']].concat(f.mem).filter(m => m[0].toLowerCase() !== self && m[0].toLowerCase() !== noun).slice(0, 6);
  return items.length ? `<div class="fam"><span class="lab">Word family</span><div class="gloss">${items.map(m => `<span><b>${esc(m[0])}</b>${m[1] ? ' ' + esc(m[1]) : ''}</span>`).join('')}</div></div>` : '';
}
function inline(s) { return esc(s).replace(/\*([^*]+)\*/g, '<b>$1</b>'); }
const UML = id => `<div class="uml">${['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'].map(c => `<button type="button" data-act="uml" data-c="${c}" data-for="${id}" tabindex="-1">${c}</button>`).join('')}
  ${canMic() ? `<button type="button" class="mic" data-act="mic" data-for="${id}" aria-label="Speak instead of typing">${ICON.mic}</button>` : ''}</div>`;
function lessonHtml(card, e, readOnly) {
  let html = '', qi = 0, rows = [];
  const flush = () => { if (rows.length) { html += `<div class="tbl"><table>${rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')}</table></div>`; rows = []; } };
  card.split('\n').forEach(line => {
    line = line.trim(); if (!line) return;
    if (line.startsWith('|')) { rows.push(line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())); return; }
    flush();
    if (line.startsWith('## ')) html += `<h2>${inline(line.slice(3))}</h2>`;
    else if (line.startsWith('> ')) { const [de, en] = line.slice(2).split(' = '); const plain = de.replace(/\*/g, ''); html += `<div class="exl">${spk(plain)}<div><div class="de2">${inline(de)}</div>${en ? `<div class="mute small">${esc(en)}</div>` : ''}</div></div>`; }
    else if (line.startsWith('! ')) html += `<div class="tip"><span class="lab">Tipp</span><p>${inline(line.slice(2))}</p></div>`;
    else if (line.startsWith('? ')) {
      const parts = line.slice(2).split(' = '), q = parts[0], en = parts[1], m = q.match(/\{([^}]+)\}/);
      if (!m) { html += `<p>${inline(q)}</p>`; return; }
      const opts = m[1].split('/'), right = opts[0], i = qi++;
      const a = e ? e.ans[i] : (readOnly ? right : null);
      let order = opts;
      if (e) { e.ord = e.ord || {}; e.ord[i] = e.ord[i] || shuffle(opts); order = e.ord[i]; }
      const gap = a != null ? `<span class="gap ${a === right ? '' : 'bad'}">${esc(right)}</span>` : '<span class="gap">&nbsp;</span>';
      html += `<div class="qcheck">${readOnly ? '' : '<span class="lab">Check</span>'}<p class="de2">${esc(q.slice(0, m.index))}${gap}${esc(q.slice(m.index + m[0].length))}</p>${en ? `<p class="mute small">${esc(en)}</p>` : ''}
        ${readOnly ? '' : `<div class="opts h">${order.map(o => `<button class="opt ${a != null ? (o === right ? 'ok' : o === a ? 'no' : '') : ''}" data-act="lq" data-q="${i}" data-v="${esc(o)}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`}</div>`;
    }
    else html += `<p>${inline(line)}</p>`;
  });
  flush();
  return { html, n: qi };
}

/* ================= views ================= */
function go(name, id, extra) { cleanup(); V = Object.assign({ name, id }, extra || {}); render(); window.scrollTo(0, 0); }
function cleanup() { if (G && G.timer) { clearInterval(G.timer); G.timer = 0; } if (aiCtl) { aiCtl.abort(); aiCtl = null; } micStop(); stopSpeech(); }
const NAV = [['home', 'Heute'], ['course', 'Kurs'], ['words', 'Wörter'], ['practice', 'Üben'], ['me', 'Ich']];
const NAVOF = { station: 'course', pack: 'course', method: 'me', tutor: 'practice', read: 'practice', hoeren: 'practice', cert: 'me' };
function render() {
  if (!S.prof.onboarded && !['onb', 'ride', 'done', 'method'].includes(V.name)) V = { name: 'onb', step: 0 };
  const fn = VIEWS[V.name] || VIEWS.home;
  app.className = 'wrap' + (FOCUS.includes(V.name) ? ' focus' : '');
  app.innerHTML = fn();
  nav.hidden = FOCUS.includes(V.name);
  const cur = NAVOF[V.name] || V.name;
  nav.innerHTML = '<div>' + NAV.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-act="go" data-v="${k}">${l}</button>`).join('') + '</div>';
  const f = app.querySelector('[data-focus]'); if (f) f.focus({ preventScroll: true });
}
const header = () => `<div class="top"><div class="mark"><i>W</i>ortwerk</div><span class="sp"></span>
  <span class="chip" title="Days in a row"><b>STREAK</b>${streakNow()}</span><span class="chip" title="Player level"><b>LVL</b>${playerLvl()}</span></div>`;

const VIEWS = {};
/* ---------- onboarding ---------- */
VIEWS.onb = () => {
  const st = V.step || 0, p = S.prof;
  const dots = `<div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i <= st ? 'on' : ''}"></i>`).join('')}</div>`;
  if (st === 0) return dots + `<div class="board"><span class="lab">Willkommen</span><h1>From A1 to B2, one stop at a time.</h1>
    <p class="bmute">Wortwerk teaches every word and every grammar rule before it asks you anything. Then it brings each one back just before you would forget it, until it sticks for good.</p></div>
    <div class="card"><span class="lab">What's inside</span><div class="facts">
      <div><b class="num">${WORDS.length.toLocaleString()}</b><span>words, each with gender, plural, audio and an example</span></div>
      <div><b class="num">${STATIONS.length}</b><span>grammar lessons, explained step by step</span></div>
      <div><b class="num">${allSents().length}</b><span>practice sentences</span></div>
      <div><b class="num">4</b><span>level checks: A1, A2, B1, B2</span></div></div></div>
    <button class="btn pri wide" data-act="onb" data-v="1" data-focus>Set up my plan</button>
    <button class="btn ghost wide" data-act="go" data-v="method">How does this work?</button>`;
  if (st === 1) {
    const opts = [['work', 'For my job'], ['study', 'To study'], ['live', 'Living in a German-speaking country'], ['family', 'Partner or family'], ['travel', 'Travel'], ['exam', 'An exam (Goethe, telc, TestDaF)']];
    return dots + `<h1>Why are you learning German?</h1><p class="mute">Pick any. Wortwerk puts the words you'll need first.</p>
      <div class="pickl">${opts.map(([k, l]) => `<button class="pk ${p.why.includes(k) ? 'on' : ''}" data-act="whypick" data-v="${k}"><span class="box">${ICON.chk}</span>${l}</button>`).join('')}</div>
      <button class="btn pri wide" data-act="onb" data-v="2">Next</button>`;
  }
  if (st === 2) return dots + `<h1>Where are you now?</h1><p class="mute">The placement test takes about four minutes and skips what you already know.</p>
    <div class="pickl">
      <button class="pk big" data-act="lvlpick" data-v="new"><b>Brand new</b><span>Start at the very first stop.</span></button>
      <button class="pk big" data-act="lvlpick" data-v="test"><b>I know some German</b><span>Take the placement test and start at the right level.</span></button></div>`;
  const mins = p.mins || 45, months = V.months || 12, tgt = Date.now() + months * 30.4 * DAY;
  const appH = Math.round(mins / 60 * months * 30.4), outH = Math.round(Math.max(0, 90 - mins) / 60 * months * 30.4);
  const totalH = appH + (p.credit || 0);
  return dots + `<h1>Your daily commitment</h1><p class="mute">Be honest. A plan you keep beats a plan you abandon.</p>
    <div class="card"><span class="lab">Minutes per day in Wortwerk</span><div class="seg-ctl wide">${[20, 30, 45, 60, 90].map(m => `<button class="${mins === m ? 'on' : ''}" data-act="mins" data-v="${m}">${m}</button>`).join('')}</div>
    <span class="lab">Reach B2 in</span><div class="seg-ctl wide">${[6, 9, 12, 18, 24].map(m => `<button class="${months === m ? 'on' : ''}" data-act="months" data-v="${m}">${m} mo</button>`).join('')}</div></div>
    <div class="card ${totalH + outH >= 450 ? 'goodc' : 'warnc'}"><span class="lab">The honest maths</span>
      <p>Reaching B2 takes roughly <b>450–600 hours</b> of learning in total. That's the estimate German course providers give: 600–800 lessons of 45 minutes.</p>
      <p>Your plan: <b>${appH} h</b> in Wortwerk${p.credit ? ` + about <b>${p.credit} h</b> you've already done` : ''}${outH ? `, plus <b>${outH} h</b> if you add ${90 - mins} min a day of German series, podcasts or conversation` : ''}.</p>
      <p><b>${totalH + outH >= 450 ? 'That reaches the B2 range.' : 'That is not enough for B2 in this time. Add minutes or give yourself more months.'}</b></p></div>
    <button class="btn pri wide" data-act="onbdone" data-v="${Math.round(tgt)}">Start my plan · B2 by ${fmtDate(tgt)}</button>`;
};
/* ---------- home ---------- */
VIEWS.home = () => {
  const p = plan(), mt = minsToday(), goal = S.prof.mins || 45, unit = nextUnit();
  const revDue = Math.min(p.due, 40), wLeft = Math.max(0, p.newW - p.doneW), sLeft = Math.max(0, p.newS - p.doneS);
  const st = nextStation(), lessonPending = st && !S.les[st.id];
  const allDone = !revDue && !wLeft && !sLeft;
  const hello = (S.prof.name ? 'Hallo ' + esc(S.prof.name) : ['Guten Morgen', 'Guten Tag', 'Guten Abend'][new Date().getHours() < 11 ? 0 : new Date().getHours() < 18 ? 1 : 2]);
  const status = p.aheadDays >= 3 ? `<span class="pill good">${p.aheadDays} days ahead</span>` : p.aheadDays <= -3 ? `<span class="pill warn">${-p.aheadDays} days behind</span>` : '<span class="pill">On schedule</span>';
  const ck = (done, label, sub, act) => `<li class="${done ? 'done' : ''} ${act ? 'tap' : ''}" ${act || ''}><span class="box">${ICON.chk}</span><div><b>${label}</b><span>${sub}</span></div></li>`;
  const days = []; for (let i = 6; i >= 0; i--) { const d = Date.now() - i * DAY, h = hget(dstr(d)), m = h ? h.s / 60 : 0; days.push(`<span class="${i ? '' : 'now'}"><i class="${m >= goal ? 'hit' : m >= 3 ? 'some' : ''}"></i>${'SMTWTFS'[new Date(d).getDay()]}</span>`); }
  const ds = dayState(), wk = weekCard();
  const restBoard = ds.enough ? `<div class="board rest"><span class="lab">Feierabend · genug für heute</span><h1>${ds.reason === 'tired' ? 'Time to let it settle.' : ds.reason === 'new' ? 'Your brain is full, in a good way.' : 'Daily goal smashed.'}</h1>
    <p class="bmute">${ds.reason === 'tired' ? 'Your accuracy dropped during the last session, a sign of fatigue. Stopping now protects what you learned.' : ds.reason === 'new' ? `You took in ${ds.news} new words and sentences today. More new material now would mostly push out what you just learned. Sleep turns today's work into long-term memory.` : `You practised ${Math.round(ds.mins)} minutes today, more than your goal. Memory consolidates between sessions, so tomorrow's session is worth more than another round now.`}</p>
    <p class="bmute">Finish your German day with something relaxed and real:</p>
    ${p.due ? `<button class="btn wide ghostb" data-act="daily" data-v="rev">Only quick reviews (${Math.min(p.due, Math.max(0, revCap() - ((hget(today()) || {}).rv || 0)))})</button>` : ''}</div>` : '';
  return header() + wk + (restBoard ? restBoard + recCard() : '') + `<div class="board" ${restBoard ? 'hidden' : ''}><span class="lab">${hello}</span>
    <div class="dest">${unit ? `<span class="roundel ${unit.ref.lvl}">${LINE[unit.ref.lvl]}</span><h1>${esc(unit.type === 'pack' ? unit.ref.t : unit.ref.name)}</h1>` : '<h1>Endstation B2</h1>'}</div>
    <div class="brow"><span><b>${revDue}</b> reviews</span><span><b>${Math.min(16, wLeft)}</b> new words</span><span><b>${lessonPending ? 'lesson' : Math.min(5, sLeft)}</b>${lessonPending ? '' : ' sentences'}</span></div>
    <div class="tbar"><i style="width:${Math.min(100, mt / goal * 100)}%"></i></div>
    <div class="brow"><span><b>${mt}</b> of ${goal} min today</span></div>
    <button class="btn pri wide" data-act="daily" data-focus>${allDone ? 'Extra round' : mt ? 'Weiterfahren' : 'Losfahren'}</button></div>
  <div class="card"><div class="row"><span class="lab">Today's plan</span><span class="sp"></span>${status}</div>
    <ul class="ck">${ck(!revDue, revDue ? `Review ${revDue} items` : 'Reviews done', 'Before you forget them')}
    ${ck(!wLeft, wLeft ? `Learn ${wLeft} new words` : `${p.doneW} new words learned`, p.fac < 0.8 ? 'Fewer today so your reviews can catch up' : p.fac > 1.05 ? 'More today: your accuracy is high' : 'Taught first, then practised')}
    ${ck(!sLeft && !lessonPending, lessonPending ? 'Grammar lesson: ' + esc(st.name) : sLeft ? `Learn ${sLeft} new sentences` : 'Grammar done', st ? esc(st.sub) : 'All stations complete')}
    ${(() => { const nd = nextDialog(), nr = nextRead(), lr = (hget(today()) || {}).lr; return ck(!!lr, lr ? 'Listening or reading done' : nd ? 'Hören: ' + esc(nd.t) : nr ? 'Lesen: ' + esc(nr.t) : 'Hören oder Lesen', 'One dialogue or text, about 5 minutes', lr ? '' : nd ? `data-act="go" data-v="dialog" data-id="${nd.id}"` : nr ? `data-act="go" data-v="reader" data-id="${nr.id}"` : 'data-act="go" data-v="hoeren"'); })()}
    ${ck((S.out[today()] || 0) >= 15, 'Listen to real German', 'A podcast, series or video. Log it below.')}</ul></div>
  <div class="card"><div class="row"><span class="lab">This week</span><span class="sp"></span><span class="small mute">${Math.round(p.hrs)} h of ~${B2_HOURS} h to B2</span></div>
    <div class="week">${days.join('')}</div>
    <div class="row small"><span class="mute">Logged outside Wortwerk today: <b class="num">${S.out[today()] || 0} min</b></span><span class="sp"></span>${[15, 30].map(m => `<button class="btn sm" data-act="logout" data-v="${m}">+${m} min</button>`).join('')}</div></div>
  <div class="tiles">
    <button class="tile" data-act="weak"><b>Schwachstellen</b><span>Train the items you get wrong most.</span></button>
    ${nextRead() ? `<button class="tile" data-act="go" data-v="reader" data-id="${nextRead().id}"><b>Lesen</b><span>${esc(nextRead().t)} · ${nextRead().lvl}</span></button>` : ''}
    ${nextDialog() ? `<button class="tile" data-act="go" data-v="dialog" data-id="${nextDialog().id}"><b>Hören</b><span>${esc(nextDialog().t)} · ${nextDialog().lvl}</span></button>` : ''}
    <button class="tile" data-act="drill"><b>Grammatik-Training</b><span>Verb forms, endings, rewriting, error hunting.</span></button>
    <button class="tile" data-act="go" data-v="practice"><b>Üben</b><span>Tutor, speaking, exams, games.</span></button>
  </div>${!restBoard && mt >= goal * 0.8 ? recCard() : ''}`;
};
/* ---------- course ---------- */
VIEWS.course = () => {
  const cur = nextUnit();
  return header() + `<div><h1>Die Strecke</h1><p class="mute">Four lines from A1 to B2. Word packs and grammar stations alternate, and each line ends with a level check.</p></div>` +
    LV.map(l => `<div class="linehd"><span class="roundel ${l}">${LINE[l]}</span><h2>${l}</h2><span class="sp"></span><span class="small mute num">${Math.round(lvlFrac(l) * 100)}%</span></div>
      <div class="stops ${l}">${UNITS[l].map(u => {
        const isP = u.type === 'pack', r = u.ref, tot = isP ? r.words.length : sentsOf(r).length, k = isP ? r.words.filter(w => learned(w.id)).length : sentsOf(r).filter(x => learned(x.id)).length;
        const done = isP ? k === tot : stDone(r);
        return `<button class="stop ${isP ? 'small' : ''} ${done ? 'done' : ''} ${cur && cur.ref === r ? 'cur' : ''}" data-act="go" data-v="${isP ? 'pack' : 'station'}" data-id="${r.id}">
          <span class="t"><span class="kind">${isP ? 'Wörter' : 'Grammatik'}</span><b>${esc(isP ? r.t : r.name)}</b><span>${esc(isP ? r.en : r.sub)}</span></span><span class="num">${k}/${tot}</span></button>`;
      }).join('')}
      <button class="stop check ${S.checks[l] >= 75 ? 'done' : ''}" data-act="lcheck" data-v="${l}"><span class="t"><span class="kind">Prüfung</span><b>Level-Check ${l}</b><span>${S.checks[l] != null ? 'Best ' + S.checks[l] + '%' + (S.checks[l] >= 75 ? ' · passed' : ' · 75% to pass') : '24 questions · 75% to pass'}</span></span></button></div>`).join('') +
    (MYPACK.words.length ? `<div class="linehd"><h2>Meine Wörter</h2></div><button class="tile" data-act="go" data-v="pack" data-id="my"><b>${MYPACK.words.length} saved words</b><span>From your stories</span></button>` : '');
};
VIEWS.station = () => {
  const st = stById(V.id) || STATIONS[0], xs = sentsOf(st), done = xs.filter(x => learned(x.id)), left = xs.length - done.length;
  const cards = (st.lesson ? st.lesson.split(/\n---\n/) : []).map(c => lessonHtml(c, null, true).html);
  return `<button class="back" data-act="go" data-v="course">← Strecke</button>
  <div class="row"><span class="roundel ${st.lvl}">${LINE[st.lvl]}</span><span class="lab">Grammatik · ${st.lvl}</span></div>
  <div><h1>${esc(st.name)}</h1><p class="mute">${esc(st.sub)}</p></div>
  <button class="btn pri wide" data-act="station" data-id="${st.id}">${!S.les[st.id] ? 'Start the lesson' : left ? `Learn ${Math.min(5, left)} new sentences` : 'Practise this station'}</button>
  <div class="row">${S.les[st.id] ? `<button class="btn sm" data-act="relearn" data-id="${st.id}">Take the lesson again</button>` : ''}
    ${AI ? `<button class="btn sm" data-act="more" data-id="${st.id}" ${V.busy ? 'disabled' : ''}>${V.busy ? 'Writing sentences…' : 'Add 8 fresh sentences'}</button><button class="btn sm" data-act="story" data-id="${st.id}">Read a story with this grammar</button>` : ''}</div>
  <div class="card lessonc"><span class="lab">Spickzettel · cheat sheet</span>${cards.length ? cards.join('<hr>') : '<ul>' + st.g.map(g => '<li>' + inline(g) + '</li>').join('') + '</ul>'}</div>
  ${done.length ? `<div class="card"><span class="lab">Your sentences · ${done.length} of ${xs.length}</span><div>${done.map(x => `<div class="sent"><div>${esc(x.de)}<small>${esc(x.en)}</small>${pips(x.id)}</div>${spk(x.de)}</div>`).join('')}</div></div>` : ''}`;
};
const pips = id => { const r = S.it[id], n = r ? clamp(Math.round(Math.log2(r[0] + 1)), 0, 7) : 0; return `<span class="pips" title="Memory strength">${[1, 2, 3, 4, 5, 6, 7].map(i => `<i class="${n >= i ? 'f' : ''}"></i>`).join('')}</span>`; };
function wordRow(w, open) {
  const r = S.it[w.id], state = !r ? 'new' : r[0] >= 21 ? 'strong' : 'learning';
  return `<div class="wrow ${open ? 'open' : ''}"><button class="wbtn" data-act="wopen" data-id="${w.id}"><span class="wde">${wordHead(w)}</span><span class="wen">${esc(w.en)}</span><span class="pill ${state === 'strong' ? 'good' : state === 'learning' ? '' : 'ghost'}">${state === 'new' ? 'new' : state === 'strong' ? 'strong' : 'learning'}</span></button>
    ${open ? `<div class="wdet">${famHtml(w)}${w.pl ? `<p class="small"><span class="lab">Plural</span> die ${esc(w.pl)}</p>` : ''}${w.forms ? `<p class="small"><span class="lab">Forms</span> ${esc(w.forms)}</p>` : ''}
      ${w.ex ? `<div class="exl">${spk(w.ex)}<div><div class="de2">${esc(w.ex)}</div><div class="mute small">${esc(w.exEn)}</div></div></div>` : ''}
      <div class="row">${spk(w.ans)}${!r ? `<button class="btn sm" data-act="soon" data-id="${w.id}">${S.soon.includes(w.id) ? 'In your next session' : 'Learn this next'}</button>` : pips(w.id)}</div></div>` : ''}</div>`;
}
VIEWS.pack = () => {
  const pk = packById(V.id) || PACKS[0], k = pk.words.filter(w => learned(w.id)).length;
  return `<button class="back" data-act="go" data-v="${V.from || 'course'}">← ${V.from === 'words' ? 'Wörter' : 'Strecke'}</button>
  <div class="row"><span class="roundel ${pk.lvl}">${LINE[pk.lvl] || ''}</span><span class="lab">Wörter · ${pk.lvl}</span></div>
  <div><h1>${esc(pk.t)}</h1><p class="mute">${esc(pk.en)} · ${k} of ${pk.words.length} learned</p></div>
  <div class="bar"><i style="width:${k / Math.max(1, pk.words.length) * 100}%"></i></div>
  ${k < pk.words.length ? `<button class="btn pri wide" data-act="pack" data-id="${pk.id}">Learn ${Math.min(8, pk.words.length - k)} new words</button>` : ''}
  ${k ? `<button class="btn wide" data-act="packrev" data-id="${pk.id}">Review this pack</button>` : ''}
  <div class="wlist">${pk.words.map(w => wordRow(w, V.open === w.id)).join('')}</div>`;
};
/* ---------- words ---------- */
const mastered = w => { const r = S.it[w.id]; return !!r && r[0] >= 21 && r[4] > 0; };
function collection(filter) { return WORDS.concat(MYPACK.words).filter(w => S.it[w.id] && (filter === 'all' || mastered(w))); }
function collectionView() {
  const sure = collection('sure'), all = collection('all');
  const f = V.cf || (sure.length >= 15 ? 'sure' : 'all'), q = (V.cq || '').trim().toLowerCase(), sort = V.cs || 'new';
  let list = f === 'sure' ? sure : all;
  if (q) list = list.filter(w => flat(w.de).includes(flat(q)) || w.en.toLowerCase().includes(q));
  list = list.slice().sort(sort === 'az' ? (a, b) => (a.noun || a.ans).localeCompare(b.noun || b.ans, 'de') : sort === 'lvl' ? (a, b) => LV.indexOf(a.lvl) - LV.indexOf(b.lvl) || a.ans.localeCompare(b.ans, 'de') : (a, b) => (S.it[b.id][5] || 0) - (S.it[a.id][5] || 0));
  const by = l => all.filter(w => w.lvl === l).length;
  return `<div class="stats"><div class="stat"><b>${sure.length}</b><span>words you know for sure</span></div><div class="stat"><b>${all.length}</b><span>words learned in total</span></div></div>
    <p class="small mute">"For sure" means you've recalled the word correctly over at least three weeks, so the app is confident it's in long-term memory. ${LV.map(l => `${l}: ${by(l)}`).join(' · ')}</p>
    <div class="row"><div class="seg-ctl"><button class="${f === 'sure' ? 'on' : ''}" data-act="cfilt" data-v="sure">Sicher · ${sure.length}</button><button class="${f === 'all' ? 'on' : ''}" data-act="cfilt" data-v="all">Alle gelernten · ${all.length}</button></div>
      <div class="seg-ctl"><button class="${sort === 'new' ? 'on' : ''}" data-act="csort" data-v="new">Recent</button><button class="${sort === 'az' ? 'on' : ''}" data-act="csort" data-v="az">A–Z</button><button class="${sort === 'lvl' ? 'on' : ''}" data-act="csort" data-v="lvl">Level</button></div></div>
    ${list.length ? `<div class="row"><button class="btn pri" style="flex:1" data-act="cards">Flip through cards</button><button class="btn" style="flex:1" data-act="cquiz">Mini-quiz</button></div>` : ''}
    <input class="inp" id="csearch" type="search" placeholder="Search your words" value="${esc(V.cq || '')}" autocomplete="off" spellcheck="false">
    ${list.length ? `<div class="wlist">${list.slice(0, 200).map(w => wordRow(w, V.open === w.id)).join('')}</div>${list.length > 200 ? `<p class="small mute">Showing 200 of ${list.length}. Search to find the rest.</p>` : ''}`
      : `<div class="card"><b>${f === 'sure' ? 'No words here yet.' : 'No words learned yet.'}</b><p class="small mute">${f === 'sure' ? 'A word moves here once you\'ve got it right across about three weeks of reviews. Keep doing your daily rides. Meanwhile, "Alle gelernten" shows everything you\'ve learned so far.' : 'Start your first daily ride on the Heute tab.'}</p></div>`}`;
}
VIEWS.cards = () => {
  const K = V.k; if (!K || !K.ids.length) return '<button class="back" data-act="go" data-v="words">← Wörter</button><p>No cards.</p>';
  const w = WMAP[K.ids[K.i]]; if (!w) return '';
  return `<div class="ridebar"><button class="x" data-act="cardsclose" aria-label="Close">✕</button><div class="bar"><i style="width:${(K.i + 1) / K.ids.length * 100}%"></i></div><span class="combo num">${K.i + 1}/${K.ids.length}</span></div>
    <div class="ex"><span class="lab">Meine Sammlung</span>
    <button class="wcard flip ${artCls(w)}" data-act="cflip"><div class="row"><div class="big">${wordHead(w)}</div><span class="sp"></span></div>
      ${K.show ? `${w.pl ? `<p class="small"><span class="lab">Plural</span> die ${esc(w.pl)}</p>` : ''}${w.forms ? `<p class="small"><span class="lab">Forms</span> ${esc(w.forms)}</p>` : ''}<p class="mean">${esc(w.en)}</p>${w.ex ? `<div class="exl"><div><div class="de2">${esc(w.ex)}</div><div class="mute small">${esc(w.exEn)}</div></div></div>` : ''}` : '<p class="small mute">Say the meaning out loud, then tap the card.</p>'}</button>
    <div class="row">${spk(w.ans, 'lg')}${w.ex ? `<button class="btn sm" data-act="say" data-t="${esc(w.ex)}">Example</button>` : ''}<span class="sp"></span><span class="small mute">${pips(w.id)}</span></div>
    <div class="row"><button class="btn" style="flex:1" data-act="cprev" ${K.i ? '' : 'disabled'}>← Back</button><button class="btn pri" style="flex:2" data-act="cnext">${K.show ? (K.i + 1 < K.ids.length ? 'Next →' : 'Done') : 'Show'}</button></div>
    <button class="btn ghost wide" data-act="cshuffle">Shuffle</button></div>`;
};
VIEWS.words = () => {
  if (V.tab === 'mine') return header() + `<h1>Wörter</h1><div class="seg-ctl wide"><button data-act="wtab" data-v="all">Alle Wörter</button><button class="on" data-act="wtab" data-v="mine">Meine Sammlung</button></div>` + collectionView();
  const q = (V.q || '').trim(), fl = V.lvl || '';
  const total = WORDS.length, l = WORDS.filter(w => learned(w.id)).length, s = WORDS.filter(w => strong(w.id)).length;
  let list = '';
  if (q) {
    const nq = flat(q), hits = WORDS.concat(MYPACK.words).filter(w => flat(w.de).includes(nq) || w.en.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
    list = hits.length ? `<div class="wlist">${hits.map(w => wordRow(w, V.open === w.id)).join('')}</div>` : `<p class="mute">No word matches "${esc(q)}".</p>`;
  } else {
    list = PACKS.concat(MYPACK.words.length ? [MYPACK] : []).filter(p => !fl || p.lvl === fl).map(p => { const k = p.words.filter(w => learned(w.id)).length; return `<button class="prow" data-act="go" data-v="pack" data-id="${p.id}" data-from="words"><span class="roundel ${p.lvl}">${p.lvl}</span><span class="t"><b>${esc(p.t)}</b><span>${esc(p.en)}</span></span><span class="pbar"><i style="width:${k / Math.max(1, p.words.length) * 100}%"></i></span><span class="num small">${k}/${p.words.length}</span></button>`; }).join('');
  }
  return header() + `<h1>Wörter</h1><div class="seg-ctl wide"><button class="on" data-act="wtab" data-v="all">Alle Wörter</button><button data-act="wtab" data-v="mine">Meine Sammlung · ${collection('sure').length}</button></div>
  <div class="stats"><div class="stat"><b>${l}</b><span>learned</span></div><div class="stat"><b>${s}</b><span>in long-term memory</span></div><div class="stat"><b>${total}</b><span>in the course</span></div></div>
  <input class="inp" id="wsearch" type="search" placeholder="Search German or English" value="${esc(q)}" autocomplete="off" spellcheck="false">
  ${q ? '' : `<div class="seg-ctl">${['', ...LV].map(x => `<button class="${fl === x ? 'on' : ''}" data-act="wlvl" data-v="${x}">${x || 'All'}</button>`).join('')}</div>`}
  <div id="wres">${list}</div>`;
};
/* ---------- practice ---------- */
VIEWS.practice = () => {
  const weak = Object.values(S.it).filter(isWeak).length, n = Object.keys(S.it).length, anyLesson = Object.keys(S.les).length;
  return header() + `<div><h1>Üben</h1><p class="mute">Extra practice on top of your daily ride. Everything uses only what you've already learned.</p></div>
  <div class="linehd"><h2>Grammatik im Einsatz</h2></div>
  <div class="tiles">
    <button class="tile" data-act="drill" ${anyLesson ? '' : 'disabled'}><b>Mixed training</b><span>Focuses on your weakest grammar skill</span></button>
    <button class="tile" data-act="drill" data-v="conj" ${anyLesson ? '' : 'disabled'}><b>Verbformen</b><span>Conjugate: du fährst, er ging, ist gekommen</span></button>
    <button class="tile" data-act="drill" data-v="case" ${S.les.s02 ? '' : 'disabled'}><b>Artikel & Fälle</b><span>mit dem, für einen, von meiner</span></button>
    <button class="tile" data-act="drill" data-v="adj" ${S.les.s16 ? '' : 'disabled'}><b>Adjektivendungen</b><span>ein neues Auto, mit dem alten Mann</span></button>
    <button class="tile" data-act="drill" data-v="trans" ${anyLesson ? '' : 'disabled'}><b>Sätze umbauen</b><span>Change tense, join, make passive</span></button>
    <button class="tile" data-act="drill" data-v="fix" ${anyLesson ? '' : 'disabled'}><b>Fehler finden</b><span>Spot the mistake in a sentence</span></button>
    ${AI ? `<button class="tile" data-act="gendrills" ${anyLesson && !V.busy ? '' : 'disabled'}><b>${V.busy ? 'Claude is writing…' : 'Fresh from Claude'}</b><span>New rewriting and error-hunting exercises for your grammar. ${(S.aiT || []).length + (S.aiF || []).length} so far</span></button>` : ''}
  </div>
  <div class="linehd"><h2>Hören, Lesen, Sprechen</h2></div>
  <div class="tiles">
    <button class="tile" data-act="go" data-v="hoeren"><b>Hören</b><span>${LISTEN.length} dialogues with different voices. ${Object.keys(S.heard).length} done</span></button>
    <button class="tile" data-act="go" data-v="read"><b>Lesen</b><span>${READ.length} graded texts. ${Object.keys(S.read).length} read</span></button>
    ${AI ? `<button class="tile" data-act="chat" data-id="frei" data-v="voice"><b>Sprechen mit dem Tutor</b><span>${canMic() ? 'Speak, hear the answer, get corrected' : 'Mic not available here: you can type, and still hear answers'}</span></button>` : ''}
    <button class="tile" data-act="listen" ${n && canSpeak() ? '' : 'disabled'}><b>Hör-Drill</b><span>Your own words and sentences, spoken</span></button>
    <button class="tile" data-act="speak" ${n && canMic() ? '' : 'disabled'}><b>Vorlesen</b><span>${canMic() ? 'Read aloud, get checked' : 'Needs speech recognition'}</span></button>
    <button class="tile" data-act="weak" ${weak ? '' : 'disabled'}><b>Schwachstellen</b><span>${weak} items you've struggled with</span></button>
  </div>
  <div class="linehd"><h2>Prüfungstraining</h2></div>
  <p class="mute small">A mini mock exam in the Goethe format: reading, listening, writing and speaking, about 50 minutes. Claude writes a new exam each time and grades your writing and speaking.</p>
  <div class="tiles">${['A2', 'B1', 'B2'].map(l => { const last = S.exams.filter(x => x.lvl === l).slice(-1)[0]; return `<button class="tile" data-act="exam" data-v="${l}" ${AI ? '' : 'disabled'}><b>Mock exam ${l}</b><span>${last ? `Last: ${last.total}/100 ${last.pass ? '· passed' : ''}` : 'Not taken yet'}</span></button>`; }).join('')}</div>
  <div class="linehd"><h2>KI-Tutor: Rollenspiele</h2></div>
  ${AI ? `<p class="mute small">Real conversations at your level (${lvlNow()}), with every message corrected. Switch on voice inside the chat to speak instead of type.</p><div class="tiles">${D.scenes.map(sc => `<button class="tile" data-act="chat" data-id="${sc.id}"><b>${esc(sc.t)}</b><span>${esc(sc.en)}</span>${sc.lvl ? `<span class="roundel ${sc.lvl}" style="align-self:flex-start;margin-top:4px">${sc.lvl}</span>` : ''}</button>`).join('')}</div>
    <button class="btn wide" data-act="story">Write me a story to read</button>`
    : IN_CLAUDE ? `<div class="card warnc"><b>The tutor isn't available in this view.</b><p class="small">Check Ich → Status. It usually works in a browser tab at claude.ai or in the Claude desktop app.</p><button class="btn sm" data-act="go" data-v="me">Open status</button></div>` : `<div class="card"><b>The tutor runs inside Claude.</b><p class="mute small">Open the Claude version of Wortwerk to use conversations, exams and stories.</p><a class="btn sm" href="${CLAUDE_URL}" target="_blank" rel="noopener">Open Wortwerk in Claude</a></div>`}
  <div class="linehd"><h2>Spiele</h2></div>
  <div class="tiles">
    <button class="tile" data-act="go" data-v="blitz"><b>Artikel-Blitz</b><span>der, die or das? 45 seconds. Best ${S.hi.blitz}</span></button>
    <button class="tile" data-act="go" data-v="verb"><b>Verb-Sprint</b><span>Past forms of strong verbs. Best ${S.hi.verb}/10</span></button>
  </div>`;
};
/* ---------- me ---------- */
VIEWS.me = () => {
  const p = plan(), lv = lvlNow(), fr = lvlFrac(lv);
  const skills = Object.entries(SKILLS).map(([k, l]) => { const a = S.sk[k]; const v = a && a[1] >= 8 ? a[0] / a[1] : null; return { k, l, v }; });
  const known = skills.filter(s => s.v != null), weakest = known.length ? known.reduce((a, b) => a.v < b.v ? a : b) : null;
  const hard = Object.keys(S.it).filter(id => S.it[id][3] > 0).sort((a, b) => S.it[b][3] - S.it[a][3]).slice(0, 8).map(getItem).filter(Boolean);
  const bars = []; let mx = S.prof.mins || 45;
  for (let i = 13; i >= 0; i--) { const h = hget(dstr(Date.now() - i * DAY)); mx = Math.max(mx, h ? h.s / 60 : 0); }
  for (let i = 13; i >= 0; i--) { const h = hget(dstr(Date.now() - i * DAY)), m = h ? h.s / 60 : 0; bars.push(`<i class="${m >= (S.prof.mins || 45) ? 'hit' : m >= 3 ? 'some' : ''}" style="height:${Math.max(3, m / mx * 100)}%" title="${Math.round(m)} min"></i>`); }
  const seg = (key, opts, obj) => `<div class="seg-ctl">${opts.map(([v, l]) => `<button class="${(obj || S.set)[key] === v ? 'on' : ''}" data-act="${obj ? 'pset' : 'set'}" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return header() + `<h1>Dein Weg zu B2</h1>
  <div class="board"><span class="lab">You are working on</span><div class="dest"><span class="roundel ${lv}">${LINE[lv]}</span><h1>${lv} · ${Math.round(fr * 100)}%</h1></div>
    <div class="bar seg">${LV.map(l => `<span class="${l}"><i style="width:${lvlFrac(l) * 100}%"></i></span>`).join('')}</div>
    <div class="brow"><span>B2 target <b>${fmtDate(p.target)}</b></span><span>${p.projected ? `at your pace <b>${fmtDate(p.projected)}</b>` : 'forecast after your first full day'}</span></div>${!p.fits ? `<p class="bmute small" style="margin:8px 0 0">B2 by ${fmtDate(p.target)} needs about <b>${p.needDay} new items a day</b>. ${S.prof.mins || 45} minutes can't hold that. <button class="btn sm" data-act="mins" data-v="${p.needMins}">Switch to ${p.needMins} min/day</button> or move your target in Ich.</p>` : p.projected && p.pace ? `<p class="bmute small" style="margin:8px 0 0">Needed: <b>${p.needDay}</b> new items/day · you: <b>${Math.round(p.pace * 10) / 10}</b>/day${p.pace < p.needDay * 0.9 ? ' · finish the daily plan to catch up' : ' ✓'}</p>` : ''}</div>
  ${statusCard()}
  <div class="card"><div class="row"><span class="lab">Learning hours</span><span class="sp"></span><span class="num small">${p.hrs.toFixed(1)} / ~${B2_HOURS} h</span></div>
    <div class="bar"><i style="width:${Math.min(100, p.hrs / B2_HOURS * 100)}%"></i></div>
    <p class="small mute">${(S.secs / 3600).toFixed(1)} h in Wortwerk · ${((S.outMin || 0) / 60).toFixed(1)} h logged outside${S.prof.credit ? ` · ${S.prof.credit} h credited from your placement` : ''}. To stay on track you need about <b>${Math.round(p.hrsPerDay * 60)} min a day</b> in total.</p>
    <div class="row">${[15, 30, 60].map(m => `<button class="btn sm" data-act="logout" data-v="${m}">Log +${m} min outside</button>`).join('')}</div></div>
  <div class="stats four"><div class="stat"><b>${p.wl}</b><span>words learned</span></div><div class="stat"><b>${WORDS.filter(w => strong(w.id)).length}</b><span>words in long-term memory</span></div><div class="stat"><b>${STATIONS.filter(stDone).length}/${STATIONS.length}</b><span>grammar stations</span></div><div class="stat"><b>${LV.filter(l => S.checks[l] >= 75).length}/4</b><span>level checks passed</span></div></div>
  <div class="card"><div class="row"><span class="lab">Your skills</span><span class="sp"></span>${weakest ? `<span class="small mute">Weakest: ${esc(weakest.l)}</span>` : ''}</div>
    ${skills.map(s => `<div class="skill"><span>${esc(s.l)}</span><span class="pbar"><i class="${s.v == null ? '' : s.v < 0.7 ? 'lo' : s.v < 0.85 ? 'mid' : 'hi'}" style="width:${s.v == null ? 0 : s.v * 100}%"></i></span><span class="num small">${s.v == null ? '–' : Math.round(s.v * 100) + '%'}</span></div>`).join('')}
    ${hard.length ? `<span class="lab">Hardest for you</span><div class="gloss">${hard.map(x => `<span>${esc(x.kind === 's' ? x.de : x.ans)}</span>`).join('')}</div><button class="btn sm" data-act="weak" style="align-self:flex-start">Train weak spots</button>` : ''}</div>
  <div class="card"><span class="lab">Minutes per day · last 14 days</span><div class="chart">${bars.join('')}</div></div>
  <div class="card"><span class="lab">Level checks</span><div class="tiles">${LV.map(l => `<button class="tile" data-act="lcheck" data-v="${l}"><b>${l}</b><span>${S.checks[l] != null ? 'Best ' + S.checks[l] + '%' + (S.checks[l] >= 75 ? ' · passed' : '') : 'Not taken yet'}</span></button>`).join('')}</div></div>
  <div class="card"><span class="lab">Abzeichen · ${Object.keys(S.badges).length}/${BADGES.length}</span><div class="badges">${BADGES.map(([id, t]) => `<span class="badge ${S.badges[id] ? 'on' : ''}" title="${S.badges[id] ? 'Earned ' + fmtDate(S.badges[id]) : 'Not yet'}">${esc(t)}</span>`).join('')}</div>
    <p class="small mute">Streak freezes: <b>${S.freeze || 0}</b> (you earn one for every 7-day streak; it saves your streak if you miss a single day).</p></div>
  ${Object.keys(S.certs).length ? `<div class="card"><span class="lab">Zertifikate</span><div class="tiles">${Object.keys(S.certs).sort().map(l => `<button class="tile" data-act="go" data-v="cert" data-id="${l}"><b>${l}</b><span>${S.certs[l].kind === 'exam' ? 'Mock exam ' + S.certs[l].score + '/100' : 'Level check ' + S.certs[l].score + '%'}</span></button>`).join('')}</div></div>` : ''}
  ${S.exams.length ? `<div class="card"><span class="lab">Mock exams</span>${S.exams.slice(-5).reverse().map(z => `<div class="row small"><span class="roundel ${z.lvl}">${z.lvl}</span><span>${fmtDate(z.date)}</span><span class="sp"></span><span class="num">${z.parts.join(' · ')}</span><span class="pill ${z.pass ? 'good' : 'warn'}">${z.total}/100</span></div>`).join('')}</div>` : ''}
  <button class="btn wide" data-act="go" data-v="method">Why this method works</button>
  <div class="card"><span class="lab">Settings</span>
    <div class="row"><span>Minutes per day</span><span class="sp"></span>${seg('mins', [[20, '20'], [30, '30'], [45, '45'], [60, '60'], [90, '90']], S.prof)}</div>
    <div class="row"><span>B2 target date</span><span class="sp"></span><input class="inp sm" id="tdate" type="date" value="${dstr(p.target)}"></div>
    <div class="row"><span>Voice</span><span class="sp"></span>${seg('voice', [['buttery', 'Buttery'], ['airy', 'Airy'], ['glassy', 'Glassy'], ['rounded', 'Rounded']])}</div>
    <div class="row"><span>Speaking speed</span><span class="sp"></span>${seg('rate', [[0.85, 'Slower'], [1, 'Normal'], [1.15, 'Faster']])}<button class="btn sm" data-act="say" data-t="Hallo! So klinge ich. Gefällt dir meine Stimme?">Test</button></div>
    <div class="row"><span>Read answers aloud</span><span class="sp"></span>${seg('audio', [[true, 'On'], [false, 'Off']])}</div>
    <div class="row"><span>Play new words automatically</span><span class="sp"></span>${seg('autoplay', [[true, 'On'], [false, 'Off']])}</div>
    <div class="row"><span>Sound effects</span><span class="sp"></span>${seg('sfx', [[true, 'On'], [false, 'Off']])}</div>
    <p class="small mute">${cloudReady ? 'Progress is saved to your Claude account and follows you across devices.' : 'Progress is saved on this device. Make a backup now and then.'}</p></div>
  <div class="card"><span class="lab">Backup</span><p class="small mute">Copy this code somewhere safe, or paste one here to restore progress on another device.</p>
    <div class="row"><button class="btn sm" data-act="export">Copy backup code</button>${IN_CLAUDE && !DL ? '' : '<button class="btn sm" data-act="dl">Download file</button>'}</div>
    <textarea class="inp" id="imp" rows="2" placeholder="Paste a backup code to restore"></textarea><button class="btn sm" data-act="import" style="align-self:flex-start">Restore</button></div>
  <div class="card"><span class="lab">Start over</span>${V.confirm ? `<p>This erases all progress, words and settings.</p><div class="row"><button class="btn sm danger" data-act="reset">Yes, erase everything</button><button class="btn sm" data-act="unconfirm">Keep my progress</button></div>` : '<button class="btn sm" data-act="confirm" style="align-self:flex-start">Reset progress</button>'}</div>`;
};
async function loadCaps() {
  const st = async n => { try { return PERM ? await PERM.state(n) : 'unknown'; } catch (e) { return 'unknown'; } };
  V.caps = { inClaude: IN_CLAUDE, ai: AI ? await st('sample') : 'unavailable', tts: TTS ? 'granted' : 'unavailable', mic: DICT ? await st('dictation') : 'unavailable',
    device: 'speechSynthesis' in window, deVoice: (() => { try { return speechSynthesis.getVoices().some(v => /^de/i.test(v.lang)); } catch (e) { return false; } })() };
  if (V.name === 'me') render();
}
function statusCard() {
  const c = V.caps;
  if (!c) { if (!V.capsBusy) { V.capsBusy = 1; setTimeout(loadCaps, 0); } return `<div class="card"><span class="lab">Status</span><p class="small mute">Checking…</p></div>`; }
  const row = (name, state, ok, msg) => `<div class="strow"><span class="dot ${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'no'}"></span><div><b>${name}</b><span>${msg}</span></div><span class="pill ${ok === true ? 'good' : ok === 'warn' ? '' : 'warn'}">${state}</span></div>`;
  const aiRow = !c.inClaude ? row('Claude tutor', 'off', false, 'Only works in the Claude version of Wortwerk.')
    : c.ai === 'granted' ? row('Claude tutor', 'ready', true, 'Conversations, exams, stories and fresh exercises work.')
    : c.ai === 'prompt' ? row('Claude tutor', 'ask', 'warn', 'You\'ll be asked to allow it the first time you use the tutor. Tap Allow.')
    : c.ai === 'denied' ? row('Claude tutor', 'blocked', false, 'You declined it. Tap "Fix permissions" and switch Claude on.')
    : row('Claude tutor', 'not here', false, 'Not available in this view. Open Wortwerk in a browser tab at claude.ai or the Claude desktop app.');
  const ttsRow = c.tts === 'granted' ? row('Claude voice', 'ready', true, 'High-quality German voice.')
    : c.device && c.deVoice ? row('Voice', 'device', 'warn', 'Claude\'s voice isn\'t offered in this view (phone apps, Safari, pop-out windows). Your device\'s German voice is used instead.')
    : c.device ? row('Voice', 'no German', false, 'No Claude voice here and your device has no German voice installed. Add German in your system\'s text-to-speech settings, or open Wortwerk in Chrome or the desktop app.')
    : row('Voice', 'none', false, 'This view can\'t play speech. Open Wortwerk in Chrome or the Claude desktop app.');
  const micRow = c.mic === 'granted' || c.mic === 'prompt' ? row('Microphone', c.mic === 'granted' ? 'ready' : 'ask', c.mic === 'granted' ? true : 'warn', c.mic === 'granted' ? 'Speaking practice and voice chat work.' : 'You\'ll be asked the first time you tap the mic.')
    : c.mic === 'denied' ? row('Microphone', 'blocked', false, 'Tap "Fix permissions" and allow dictation.')
    : row('Microphone', 'not here', false, 'Dictation only works in Chrome or Edge at claude.ai, or the main window of the Claude desktop app. Not in the phone apps or Safari.');
  return `<div class="card"><div class="row"><span class="lab">Status: what works on this device</span><span class="sp"></span><button class="btn sm ghost" data-act="recheck">Recheck</button></div>
    ${aiRow}${ttsRow}${micRow}
    <div class="row">${PERM ? '<button class="btn sm" data-act="perms">Fix permissions</button>' : ''}<button class="btn sm" data-act="say" data-t="Hallo! Kannst du mich hören?">Test voice</button>${AI ? '<button class="btn sm" data-act="testai">Test tutor</button>' : ''}</div>
    ${V.aiTest ? `<p class="small">${esc(V.aiTest)}</p>` : ''}</div>`;
}
VIEWS.method = () => `<button class="back" data-act="go" data-v="${S.prof.onboarded ? 'me' : 'onb'}">← Back</button>
  <h1>Why this works, and what it takes</h1>
  <div class="card"><span class="lab">1 · Teach, then test</span><p>Every word arrives as a teaching card with its gender, plural, audio and an example sentence. Every grammar station starts with a short lesson and quick checks. You are only tested on what you've been taught.</p></div>
  <div class="card"><span class="lab">2 · Active recall</span><p>You don't re-read: you choose, build, type, listen and speak the answer. Pulling an answer from memory strengthens it far more than looking at it again. This "testing effect" is one of the best-replicated results in learning research (Roediger &amp; Karpicke, 2006).</p></div>
  <div class="card"><span class="lab">3 · Spaced repetition</span><p>Each item comes back right before you'd forget it: after 1 day, 3 days, a week, a month, and so on. Spaced practice beats cramming by a wide margin in hundreds of studies (Cepeda et al., 2006). Items you miss come back sooner and in an easier format.</p></div>
  <div class="card"><span class="lab">4 · From easy to hard</span><p>Each item climbs a ladder: recognise it, pick it, build it, type it, hear it, say it. The app moves you up only when you get it right, and down when you struggle.</p></div>
  <div class="card"><span class="lab">5 · Real language</span><p>Words come with sentences, grammar comes with whole sentences, and the tutor in the Claude version makes you use everything in conversation. Comprehension grows from lots of understandable input. So add German podcasts, series and conversation, and log them here.</p></div>
  <div class="card warnc"><span class="lab">The honest part</span><p>No app can promise fluency. B2 takes roughly <b>450–600 hours</b> of learning in total; course providers estimate 600–800 lessons of 45 minutes. In one year that's about 1.3 to 1.6 hours a day.</p>
    <p>Wortwerk covers the core: ${WORDS.length.toLocaleString()} words, all B2 grammar, reading, listening and writing practice. It can't replace hearing and speaking with real people. Do ~45–60 minutes here and ~30–45 minutes of German you enjoy, every day.</p>
    <p><b>What you can count on:</b> you'll always know where you stand. The hours meter, your daily on-track status and a level check at the end of every line show whether you're really progressing. If you fall behind, Wortwerk tells you by how much and adjusts your daily load.</p></div>`;

/* ---------- ride ---------- */
VIEWS.ride = () => {
  const e = R.q[R.i], x = e.x, fb = R.fb, dis = fb ? 'disabled' : '';
  const prog = R.kind === 'place' ? Math.min(95, (R.place.l * 5 + R.place.n) / 20 * 100) : R.i / R.q.length * 100;
  const top = `<div class="ridebar"><button class="x" data-act="quit" aria-label="End session">✕</button><div class="bar"><i style="width:${prog}%"></i></div>${R.combo >= 3 ? `<span class="combo">${R.combo}×</span>` : ''}</div>`;
  if (e.t === 'wIntro') {
    return top + `<div class="ex"><span class="lab">Neues Wort · ${x.lvl}</span>
      <div class="wcard ${artCls(x)}"><div class="row"><div class="big">${wordHead(x)}</div><span class="sp"></span>${spk(x.ans, 'lg')}</div>
        ${x.pl ? `<p class="small"><span class="lab">Plural</span> die ${esc(x.pl)}</p>` : x.g === 'p' ? '<p class="small"><span class="lab">Plural only</span></p>' : ''}
        ${x.forms ? `<p class="small"><span class="lab">Forms</span> ${esc(x.forms)}</p>` : ''}
        <p class="mean">${esc(x.en)}</p>
        ${x.ex ? `<div class="exl">${spk(x.ex)}<div><div class="de2">${esc(x.ex)}</div><div class="mute small">${esc(x.exEn)}</div></div></div>` : ''}
        ${famHtml(x)}
        ${x.kind === 'n' && x.g !== 'p' ? `<p class="small mute">Colour = gender: <span class="g-r">blue der</span>, <span class="g-e">red die</span>, <span class="g-s">green das</span>.</p>` : ''}</div>
      <button class="btn pri wide" data-act="introok" data-focus>Got it</button>
      <button class="btn ghost wide" data-act="known">I already know this word</button></div>`;
  }
  if (e.t === 'pause') {
    const tired = e.why === 'tired';
    return top + `<div class="ex"><span class="lab">${tired ? 'Kurze Pause' : 'Genug für heute?'}</span>
      <div class="card warnc"><h2>${tired ? 'Your accuracy is dropping' : 'You\'re past your daily goal'}</h2>
      <p>${tired ? `First-try accuracy fell from <b>${Math.round(e.a0 * 100)}%</b> at the start of this session to <b>${Math.round(e.a1 * 100)}%</b> now. That's a classic sign of mental fatigue. New material learned now tends to be forgotten, and mistakes get practised in.` : `You've practised <b>${minsToday()} minutes</b> today. Memory consolidates between sessions and during sleep, so another round now adds less than tomorrow's session will.`}</p>
      <p><b>Best move:</b> stop here and switch to relaxed German input instead.</p></div>
      <button class="btn pri wide" data-act="tiredstop" data-focus>Finish for today</button>
      <button class="btn ghost wide" data-act="tiredgo">Keep going anyway</button></div>`;
  }
  if (e.t === 'lesson') {
    const L = lessonHtml(e.card, e), all = Object.keys(e.ans).length >= L.n;
    return top + `<div class="ex"><span class="lab">${esc(x.st.name)} · ${e.ci + 1} / ${e.cn}</span><div class="lessonc">${L.html}</div>
      <button class="btn pri wide" data-act="lnext" ${all ? 'data-focus' : 'disabled'}>${all ? (e.ci + 1 === e.cn ? 'Now practise it' : 'Weiter') : 'Answer the check to continue'}</button></div>`;
  }
  let label = '', body = '';
  const gapS = `<p class="de">${esc(x.pre)}<span class="gap ${fb && !fb.ok ? 'bad' : ''}">${fb ? esc(x.ans) : '&nbsp;'}</span>${esc(x.post)}</p><p class="en">${esc(x.en)}</p>`;
  const opts = (list, right) => `<div class="opts ${list.length === 3 ? 'h' : ''}">${list.map((o, i) => `<button class="opt ${fb ? (o === right ? 'ok' : o === fb.given ? 'no' : '') : ''}" data-act="mc" data-v="${esc(o)}" ${dis}><kbd>${i + 1}</kbd>${esc(o)}</button>`).join('')}</div>`;
  const inp = (ph, area) => area ? `<textarea class="inp" id="ans" rows="2" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${ph}" ${dis} ${fb ? '' : 'data-focus'}>${fb ? esc(fb.given) : ''}</textarea>` : `<input class="inp" id="ans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ph}" ${dis} ${fb ? `value="${esc(fb.given)}"` : 'data-focus'}>`;
  switch (e.t) {
    case 'wMc': label = 'What does it mean?'; body = `<div class="row"><p class="de big2">${wordHead(x)}</p>${spk(x.ans)}</div>` + opts(e.opts, x.en); break;
    case 'wMcR': label = 'Pick the German word'; body = `<p class="prompt">${esc(x.en)}</p>` + opts(e.opts, x.ans); break;
    case 'wArt': label = 'Which article?'; body = `<p class="noun">${esc(x.noun)}</p><p class="en">${esc(x.en)}</p><div class="g3">${['der', 'die', 'das'].map((a, i) => `<button class="${'res'[i]} ${fb ? (a === x.art ? 'ok' : a === fb.given ? 'no' : 'dim') : ''}" data-act="mc" data-v="${a}" ${dis}>${a}</button>`).join('')}</div>`; break;
    case 'wType': label = 'Write it in German'; body = `<p class="prompt">${esc(x.en)}</p>${x.kind === 'n' ? '<p class="small mute">Include the article: der, die or das.</p>' : ''}` + inp(x.kind === 'n' ? 'der / die / das …' : 'Auf Deutsch…') + (fb ? '' : UML('ans')); break;
    case 'wCloze': label = 'Complete the sentence'; body = `<p class="de">${esc(e.cz.pre)}<span class="gap ${fb && !fb.ok ? 'bad' : ''}">${fb ? esc(e.cz.word) : '&nbsp;'}</span>${esc(e.cz.post)}</p><p class="en">${esc(x.exEn)}</p><p class="small mute">Hint: ${esc(x.en)}</p>` + inp('Missing word') + (fb ? '' : UML('ans')); break;
    case 'wListen': label = 'Write what you hear'; body = `<div class="row"><button class="bigplay" data-act="say" data-t="${esc(x.ans)}" aria-label="Play">${ICON.spk}</button><button class="btn sm" data-act="say" data-slow="1" data-t="${esc(x.ans)}">Slower</button></div>` + inp('Was hörst du?') + (fb ? '' : UML('ans')); break;
    case 'sMc': label = R.kind === 'place' || e.check ? 'Choose the right word' : 'Pick the missing word'; body = gapS + opts(e.opts, x.ans); break;
    case 'sBuild': label = 'Build the sentence'; body = `<p class="prompt">${esc(x.en)}</p><div class="slot">${e.pick.map((pi, k) => `<button class="tk" data-act="unpick" data-k="${k}" ${dis}>${esc(e.pool[pi])}</button>`).join('')}</div>
      <div class="pool">${e.pool.map((t, i) => `<button class="tk ${e.pick.includes(i) ? 'used' : ''}" data-act="pick" data-k="${i}" ${dis}>${esc(t)}</button>`).join('')}</div>`; break;
    case 'sCloze': label = 'Type the missing word'; body = gapS + inp('Missing word') + (fb ? '' : UML('ans')); break;
    case 'sListen': label = 'Write what you hear'; body = `<div class="row"><button class="bigplay" data-act="say" data-t="${esc(x.de)}" aria-label="Play">${ICON.spk}</button><button class="btn sm" data-act="say" data-slow="1" data-t="${esc(x.de)}">Slower</button></div>` + inp('Was hörst du?', true) + (fb ? '' : UML('ans')); break;
    case 'sWrite': label = 'Say it in German'; body = `<p class="prompt">${esc(x.en)}</p>` + inp('Auf Deutsch…', true) + (fb ? '' : UML('ans')); break;
    case 'sSpeak': label = 'Read it aloud'; body = `<p class="de">${esc(x.de)}</p><p class="en">${esc(x.en)}</p><div class="row">${spk(x.de)}<span class="small mute">Listen first, then tap the mic and say it.</span></div>
      <input class="inp" id="ans" autocomplete="off" placeholder="Your words appear here" ${dis} ${fb ? `value="${esc(fb.given)}"` : ''}>` + (fb ? '' : `<button class="btn mic wide" data-act="mic" data-for="ans">${ICON.mic} Tap and speak</button>`); break;
    case 'wPlural': label = 'What is the plural?'; body = `<p class="big2">${wordHead(x)}</p><p class="en">${esc(x.en)}</p>` + inp('die …') + (fb ? '' : UML('ans')); break;
    case 'gConj': label = 'Verbform · ' + e.tense; body = `<p class="noun">${esc(x.ans)}</p><p class="en">${esc(e.person)} · ${esc(e.tense)} · ${esc(/^to /.test(x.en) ? x.en : "to " + x.en)}</p>` + inp(e.person + ' …') + (fb ? '' : UML('ans')); break;
    case 'gCase': { label = 'Article · ' + e.caseName; const [a, b] = e.prompt.split('___'); body = `<p class="de">${esc(a)}<span class="gap ${fb && !fb.ok ? 'bad' : ''}">${fb ? esc(e.ans[0]) : '&nbsp;'}</span>${esc(b)}</p><p class="small mute">from: ${esc(e.hint)}</p>` + inp('Article') + (fb ? '' : UML('ans')); break; }
    case 'gAdj': label = 'Adjective ending · ' + e.caseName; body = `<p class="de">${esc(e.pre)}<span class="gap ${fb && !fb.ok ? 'bad' : ''}">${fb ? esc(e.ans[0]) : '&nbsp;'}</span>${esc(e.post)}</p><p class="small mute">adjective: ${esc(e.hint)}</p>` + inp(e.hint + '…') + (fb ? '' : UML('ans')); break;
    case 'gTrans': label = 'Rewrite the sentence'; body = `<p class="de">${esc(e.tr.from)}</p><p class="task">${esc(e.tr.task)}</p>` + inp('Neuer Satz…', true) + (fb ? '' : UML('ans')); break;
    case 'gFix': label = 'Find the mistake'; body = `<p class="small mute">One word (or word order) is wrong. Tap it.</p><div class="pool fix">${e.toks.map((t, i) => `<button class="tk ${fb ? (e.errs.includes(i) ? 'okk' : i === fb.tap ? 'nok' : '') : ''}" data-act="fixtap" data-k="${i}" ${dis}>${esc(t)}</button>`).join('')}</div>`; break;
    case 'cMc': label = e.sub || e.prompt; body = (e.audio && e.skill === 'lis' ? `<div class="row"><button class="bigplay" data-act="say" data-t="${esc(e.audio)}" aria-label="Play">${ICON.spk}</button><button class="btn sm" data-act="say" data-slow="1" data-t="${esc(e.audio)}">Slower</button></div>` : `<div class="row"><p class="de big2">${esc(e.prompt)}</p>${e.audio ? spk(e.audio) : ''}</div>`) + opts(e.opts, e.ans); break;
  }
  const isMc = ['wMc', 'wMcR', 'wArt', 'sMc', 'cMc', 'gFix'].includes(e.t);
  let foot = '';
  if (!fb) foot = isMc ? (e.idk ? '<button class="btn ghost wide" data-act="idk">I don\'t know</button>' : '') : `<button class="btn pri wide" data-act="check" ${e.t === 'sBuild' && e.pick.length < e.need ? 'disabled' : ''}>Check</button>${['sSpeak'].includes(e.t) ? '<button class="btn ghost wide" data-act="skip">I can\'t speak right now</button>' : ''}`;
  else {
    const showDe = x.kind === 's' ? x.de : x.kind === 'w' ? x.de : x.ans;
    const quiet = e.check || R.kind === 'place';
    foot = `<div class="fb ${fb.ok ? '' : 'no'}"><div class="row"><h3>${esc(fb.word)}</h3><span class="sp"></span>${fb.xp ? `<span class="num small">+${fb.xp} XP</span>` : ''}${quiet ? '' : spk(showDe)}</div>
      ${quiet ? '' : e.solution ? `<p class="ans">${esc(e.solution)}</p>${e.solNote ? `<p class="small mute">${esc(e.solNote)}</p>` : ''}` : `<p class="ans">${x.kind === 'n' || x.kind === 'v' || x.kind === 'x' ? wordHead(x) : esc(showDe)}</p><p class="small mute">${esc(x.en)}</p>`}
      ${!quiet && !e.solution && x.ex && x.kind !== 's' ? `<p class="small"><span class="de2">${esc(x.ex)}</span><br><span class="mute">${esc(x.exEn)}</span></p>` : ''}
      ${!quiet && fb.given && fb.given !== 'skip' && (!fb.ok || fb.note) && !isMc && e.t !== 'sBuild' && e.t !== 'sSpeak' ? `<p class="small yw"><span class="mute">You wrote:</span> ${diffHtml(fb.given, e.solution || (x.kind === 's' ? x.de : x.ans))}</p>` : ''}
      ${fb.note ? `<div class="why">${esc(fb.note)}</div>` : ''}${fb.why ? `<div class="why">${esc(fb.why)}</div>` : ''}
      ${!fb.ok && !quiet ? `<div class="row">${AI && x.kind === 's' && !fb.why ? '<button class="btn sm" data-act="why">Why?</button>' : ''}${['wType', 'wCloze', 'wListen', 'sCloze', 'sWrite', 'sSpeak', 'sListen', 'wPlural', 'gConj', 'gTrans'].includes(e.t) && e.first ? '<button class="btn sm" data-act="override">Mine was right too</button>' : ''}</div>` : ''}
      <button class="btn pri wide" data-act="next" data-focus>Weiter</button></div>`;
  }
  return top + `<div class="ex"><span class="lab">${esc(label)}${e.isNew && !e.final ? ' · new' : ''}</span>${body}${foot}</div>`;
};
VIEWS.done = () => {
  if (R.kind === 'place') {
    const p = R.place.passed, lvl = p >= 0 ? LV[p] : null;
    return `<div class="ex center" style="padding-top:30px"><span class="lab">Einstufung</span><div class="hero-n">${lvl ? lvl + ' ✓' : 'A1'}</div>
      <p>${lvl ? `You already know ${lvl}${p > 0 ? ' and everything below it' : ''}. Those words and sentences are marked as known and will come back occasionally to confirm. You start on the <b>${LV[p + 1] || 'B2'}</b> line.` : 'You\'ll start at the first stop. Every word and rule will be taught from scratch.'}</p>
      <button class="btn pri wide" data-act="onb" data-v="3" data-focus>Continue</button></div>`;
  }
  if (R.kind === 'check') {
    const pass = R.score >= 75, l = R.opts.lvl;
    return `<div class="ex center" style="padding-top:30px"><span class="lab">Level-Check ${l}</span><div class="hero-n">${R.score}%</div>
      <p>${pass ? `Passed. You've shown solid ${l} knowledge.` : `75% passes. Keep riding the ${l} line and try again; your weak spots are now prioritised.`}</p>
      <div class="stats" style="width:100%"><div class="stat"><b>${R.ok}</b><span>correct</span></div><div class="stat"><b>${R.miss}</b><span>missed</span></div></div>
      <button class="btn pri wide" data-act="go" data-v="home" data-focus>Home</button>${pass ? '' : '<button class="btn wide" data-act="weak">Train weak spots</button>'}</div>`;
  }
  const acc = R.ok + R.miss ? Math.round(R.ok / (R.ok + R.miss) * 100) : 100, p = plan(), mt = minsToday(), goal = S.prof.mins || 45;
  const tomorrow = Object.values(S.it).filter(r => r[1] <= midnight() + 2 * DAY).length;
  return `<div class="ex center" style="padding-top:30px"><span class="lab">Fahrt beendet</span><div class="hero-n">+${R.xp} XP</div>
    <div class="stats" style="width:100%"><div class="stat"><b>${acc}%</b><span>first-try accuracy</span></div><div class="stat"><b>${R.nw}</b><span>new words</span></div><div class="stat"><b>${R.ns}</b><span>new sentences</span></div><div class="stat"><b>${mt}</b><span>min today</span></div></div>
    <p class="mute">${mt >= goal ? 'Daily goal reached. Anything more is a bonus.' : `${goal - mt} more minutes to reach today's goal.`} ${tomorrow} reviews are lined up for tomorrow.</p>
    ${dayState().enough ? `<div class="card warnc" style="width:100%;text-align:left"><span class="lab">Genug für heute</span><p>${dayState().reason === 'tired' ? 'You stopped when your accuracy dropped. Good call: rest now protects what you learned.' : 'That\'s a full day of learning. More new material now would mostly be forgotten; tomorrow\'s session will be worth more.'}</p></div><div style="width:100%;text-align:left">${recCard()}</div>` : (mt < goal || p.due ? '<button class="btn pri wide" data-act="daily" data-focus>Noch eine Fahrt</button>' : '')}
    <div class="row" style="width:100%"><button class="btn" style="flex:1" data-act="go" data-v="practice">Üben</button><button class="btn" style="flex:1" data-act="go" data-v="home">Home</button></div></div>`;
};

/* ---------- reading ---------- */
function nextRead() { const l = LV.indexOf(lvlNow()); return READ.find(r => S.read[r.id] == null && LV.indexOf(r.lvl) <= l) || null; }
VIEWS.read = () => header() + `<div><h1>Lesen</h1><p class="mute">Short texts written for each level. Read, listen, answer three questions, and save new words to learn.</p></div>` +
  LV.map(l => `<div class="linehd"><span class="roundel ${l}">${LINE[l]}</span><h2>${l}</h2></div>` + READ.filter(r => r.lvl === l).map(r => `<button class="prow" data-act="go" data-v="reader" data-id="${r.id}"><span class="t"><b>${esc(r.t)}</b><span>${r.text.split(/\s+/).length} words · ${r.gl.length} key words</span></span>${S.read[r.id] != null ? `<span class="pill ${S.read[r.id] === 3 ? 'good' : ''}">${S.read[r.id]}/3</span>` : '<span class="pill ghost">new</span>'}</button>`).join('')).join('');
VIEWS.reader = () => {
  const r = READ.find(x => x.id === V.id) || READ[0]; V.ans = V.ans || {}; V.t0 = V.t0 || Date.now();
  const paras = r.text.split(/\n\n+/), done = Object.keys(V.ans).length === r.q.length;
  const score = r.q.filter((q, i) => V.ans[i] === q[2]).length;
  return `<div class="ridebar"><button class="x" data-act="go" data-v="read" aria-label="Close">✕</button><span class="lab">${r.lvl} · Lesestück</span></div>
    <h1>${esc(r.t)}</h1>
    ${canSpeak() ? `<button class="btn sm" data-act="say" data-t="${esc(r.text.replace(/\n+/g, ' '))}" style="align-self:flex-start">${ICON.spk} Read it to me</button>` : ''}
    ${paras.map(p => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><p class="story" style="flex:1;min-width:0">${esc(p)}</p>${spk(p)}</div>`).join('')}
    <div class="card"><span class="lab">Key words</span><div class="gloss">${r.gl.map(g => `<span><b>${esc(g[0])}</b> ${esc(g[1])}</span>`).join('')}</div>
      <button class="btn sm" data-act="readsave" data-id="${r.id}" style="align-self:flex-start" ${r.gl.every(g => S.my.some(l => l.split('|')[0] === g[0])) ? 'disabled' : ''}>${r.gl.every(g => S.my.some(l => l.split('|')[0] === g[0])) ? 'Saved to Meine Wörter' : 'Save these words to learn'}</button></div>
    ${r.q.map((q, qi) => { const a = V.ans[qi]; return `<div class="card"><b>${qi + 1}. ${esc(q[0])}</b><div class="opts">${q[1].map((o, oi) => `<button class="opt ${a != null ? (oi === q[2] ? 'ok' : oi === a ? 'no' : '') : ''}" data-act="rq" data-q="${qi}" data-o="${oi}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div></div>`; }).join('')}
    ${done ? `<div class="fb ${score === r.q.length ? '' : 'no'}"><h3>${score} of ${r.q.length} right</h3><p class="small">${score === r.q.length ? 'You understood the whole text.' : 'Read the text again and look for the answers.'}</p>${nextRead() ? `<button class="btn pri wide" data-act="go" data-v="reader" data-id="${nextRead().id}">Next text</button>` : ''}<button class="btn wide" data-act="go" data-v="read">All texts</button></div>` : ''}`;
};

/* ---------- end-of-day recommendations ---------- */
const RECS = [
  { t: 'Easy German', type: 'Video', lv: 'A2 B1 B2', url: 'https://www.youtube.com/@EasyGerman', d: 'Street interviews with German and English subtitles. Pick any episode whose topic sounds fun.', m: 15 },
  { t: 'Nicos Weg (DW)', type: 'Video course', lv: 'A1 A2 B1', url: 'https://learngerman.dw.com', d: 'A drama series made for learners, one short episode at a time.', m: 15 },
  { t: 'Extr@ auf Deutsch', type: 'Sitcom', lv: 'A1 A2', q: 'Extr@ auf Deutsch', d: 'A silly sitcom made for learners. Slow, clear and funny.', m: 20 },
  { t: 'nachrichtenleicht', type: 'News', lv: 'A2 B1', url: 'https://www.nachrichtenleicht.de', d: 'This week\'s news in simple German, with audio.', m: 10 },
  { t: 'Langsam gesprochene Nachrichten (DW)', type: 'Podcast', lv: 'B1 B2', url: 'https://learngerman.dw.com', d: 'Real news read slowly, with the transcript.', m: 10 },
  { t: 'Slow German', type: 'Podcast', lv: 'A2 B1', url: 'https://slowgerman.com', d: 'Calm episodes about life and culture in Germany, spoken slowly.', m: 15 },
  { t: 'logo! Kindernachrichten (ZDF)', type: 'News video', lv: 'B1', q: 'logo! Nachrichten ZDF', d: 'Children\'s news: real events in clear, simple German.', m: 10 },
  { t: 'Tagesschau in 100 Sekunden', type: 'News video', lv: 'B2', url: 'https://www.tagesschau.de', d: 'Germany\'s main news in 100 seconds. Watch it twice.', m: 5 },
  { t: 'Türkisch für Anfänger', type: 'Series', lv: 'B1 B2', q: 'Türkisch für Anfänger Serie', d: 'Comedy about a German-Turkish patchwork family. Everyday German.', m: 25 },
  { t: 'How to Sell Drugs Online (Fast)', type: 'Series', lv: 'B1 B2', q: 'How to Sell Drugs Online (Fast)', d: 'Teen comedy-drama full of real colloquial German. Use German subtitles.', m: 30 },
  { t: 'Dark', type: 'Series', lv: 'B2', q: 'Dark Netflix', d: 'A gripping mystery. Watch in German with German subtitles.', m: 50 },
  { t: 'Babylon Berlin', type: 'Series', lv: 'B2', q: 'Babylon Berlin', d: 'Crime drama in 1920s Berlin. Harder, but rewarding.', m: 45 },
  { t: 'Leichte Lektüren (Klett)', type: 'Book', lv: 'A1 A2 B1', q: 'Leichte Lektüren Deutsch als Fremdsprache', d: 'Short graded crime stories. Read one chapter tonight.', m: 20 },
  { t: 'Der kleine Prinz', type: 'Book', lv: 'A2 B1', q: 'Der kleine Prinz Deutsch', d: 'You probably know the story already, which makes the German much easier.', m: 20 },
  { t: 'Emil und die Detektive', type: 'Book', lv: 'B1', q: 'Emil und die Detektive Kästner', d: 'Erich Kästner\'s classic: simple language and a real page-turner.', m: 20 },
  { t: 'Tschick', type: 'Book', lv: 'B2', q: 'Tschick Herrndorf', d: 'A modern road novel told by a teenager. Fresh, funny language.', m: 25 },
  { t: 'Momo', type: 'Book', lv: 'B2', q: 'Momo Michael Ende', d: 'Michael Ende\'s novel about time thieves. A beautiful read.', m: 25 },
  { t: 'Talk to a real person', type: 'Speaking', lv: 'A1 A2 B1 B2', q: 'Tandem Sprachpartner', d: 'Fifteen minutes with a tandem partner, neighbour or colleague. Try to use three words you learned today.', m: 15 }
];
function recPicks() {
  const lv = lvlNow(), pool = RECS.filter(r => r.lv.split(' ').includes(lv)), seed = Math.floor(Date.now() / DAY);
  const types = ['Video', 'Video course', 'Sitcom', 'Series', 'News video'];
  const watch = pool.filter(r => types.includes(r.type)), other = pool.filter(r => !types.includes(r.type));
  return [watch[seed % Math.max(1, watch.length)], other[seed % Math.max(1, other.length)]].filter(Boolean);
}
function recCard() {
  const t = today(), ai = S.recs[t];
  const item = r => `<div class="rec"><div class="row"><span class="pill">${esc(r.type)}</span><span class="small mute">~${r.m} min</span></div><b>${esc(r.t)}</b><p class="small">${esc(r.d)}</p>${r.url ? `<a class="btn sm" href="${r.url}" target="_blank" rel="noopener">Open</a>` : `<p class="small mute">Search for: <b>${esc(r.q)}</b></p>`}</div>`;
  return `<div class="card recc"><span class="lab">Deutsch für heute Abend</span>
    <div class="recs">${recPicks().map(item).join('')}</div>
    ${AI ? (ai ? `<div class="rec ai"><span class="pill good">Your topic tonight</span><b>${esc(ai.topic)}</b><p class="small">${esc(ai.why)}</p>
        <p class="small"><span class="lab">Watch</span> ${esc(ai.watch)}<br><span class="mute">YouTube search: </span><b>${esc(ai.search)}</b></p>
        <p class="small"><span class="lab">Listen for</span> ${(ai.words || []).map(esc).join(', ')}</p>
        <p class="small"><span class="lab">Mini task</span> ${esc(ai.task)}</p></div>`
      : `<button class="btn sm" data-act="recai" ${V.recBusy ? 'disabled' : ''} style="align-self:flex-start">${V.recBusy ? 'Planning…' : 'Plan my German evening (Claude)'}</button>`) : ''}
    <div class="row"><span class="small mute">Did something in German? Log it:</span><span class="sp"></span>${[15, 30].map(m => `<button class="btn sm" data-act="logout" data-v="${m}">+${m} min</button>`).join('')}</div></div>`;
}
async function recAI() {
  if (!AI || V.recBusy) return; V.recBusy = true; render();
  const h = hget(today()) || {}, todays = Object.keys(S.it).filter(id => S.it[id][5] > midnight()).map(getItem).filter(z => z && z.kind !== 's').slice(0, 30).map(w => w.ans);
  const st = nextStation();
  try {
    const r = await AI.json(`A German learner at level ${lvlNow()} has finished their study session for today${S.prof.why.length ? ' (learning for: ' + S.prof.why.join(', ') + ')' : ''}. Words practised today: ${todays.join(', ') || 'various'}. Current grammar focus: ${st ? st.name + ' (' + st.sub + ')' : 'review'}.
Suggest ONE relaxed, enjoyable activity in real German for the evening (15-30 minutes) on a concrete topic that reuses today's words. Return ONLY JSON:
{"topic": short German topic title, "why": one English sentence on why it fits today, "watch": English description of what kind of video/podcast to look for, "search": a German YouTube search query (3-6 words), "words": [4 German words from today's list to listen for], "task": one short speaking or writing mini task in English (e.g. tell someone 3 sentences about it)}`, { modelTier: 'quick' });
    if (r && r.topic) { S.recs = { [today()]: r }; save(); }
  } catch (e) { toast(aiErr(e) || 'Try again later.'); }
  V.recBusy = false; render();
}

/* ---------- listening dialogues ---------- */
const allDialogs = () => (S.aiL || []).concat(LISTEN);
const parseDialog = d => d.d.split('\n').map(l => { const m = l.match(/^([A-Z]): (.*)$/); return m ? { who: m[1], text: m[2] } : null; }).filter(Boolean);
function nextDialog() { const l = LV.indexOf(lvlNow()); return allDialogs().find(d => S.heard[d.id] == null && LV.indexOf(d.lvl) <= l) || null; }
VIEWS.hoeren = () => header() + `<div><h1>Hören</h1><p class="mute">Real-life conversations read by different voices. Listen without the text first, answer, then check the transcript.</p></div>` +
  (AI ? `<div class="card"><div class="row"><span class="lab">Von Claude, für dich</span><span class="sp"></span><button class="btn sm pri" data-act="gendialog" ${V.busy ? 'disabled' : ''}>${V.busy ? 'Writing…' : 'New dialogue'}</button></div>
    <p class="small mute">A fresh conversation at your level (${lvlNow()}) that reuses words you're learning. Unlimited.</p>
    ${(S.aiL || []).slice(0, 8).map(d => `<button class="prow" data-act="go" data-v="dialog" data-id="${d.id}"><span class="t"><b>${esc(d.t)}</b><span>${d.lvl} · ${d.q.length} questions</span></span>${S.heard[d.id] != null ? `<span class="pill ${S.heard[d.id] === d.q.length ? 'good' : ''}">${S.heard[d.id]}/${d.q.length}</span>` : '<span class="pill ghost">new</span>'}</button>`).join('')}</div>` : '') +
  LV.map(l => `<div class="linehd"><span class="roundel ${l}">${LINE[l]}</span><h2>${l}</h2></div>` + LISTEN.filter(d => d.lvl === l).map(d => `<button class="prow" data-act="go" data-v="dialog" data-id="${d.id}"><span class="t"><b>${esc(d.t)}</b><span>${parseDialog(d).length} lines · ${d.q.length} questions</span></span>${S.heard[d.id] != null ? `<span class="pill ${S.heard[d.id] === d.q.length ? 'good' : ''}">${S.heard[d.id]}/${d.q.length}</span>` : '<span class="pill ghost">new</span>'}</button>`).join('')).join('');
VIEWS.dialog = () => {
  const d = allDialogs().find(x => x.id === V.id) || LISTEN[0], lines = parseDialog(d); V.ans = V.ans || {}; V.t0 = V.t0 || Date.now();
  const done = Object.keys(V.ans).length === d.q.length, score = d.q.filter((q, i) => V.ans[i] === q[2]).length;
  const who = [...new Set(lines.map(l => l.who))];
  return `<div class="ridebar"><button class="x" data-act="go" data-v="hoeren" aria-label="Close">✕</button><span class="lab">${d.lvl} · Hören</span></div>
    <h1>${esc(d.t)}</h1><p class="mute small">Listen at least once before you read the questions. You can replay as often as you like.</p>
    <div class="row"><button class="bigplay" data-act="dplay" aria-label="Play">${ICON.spk}</button><button class="btn sm" data-act="dplay" data-slow="1">Slower</button><button class="btn sm" data-act="dstop">Stop</button></div>
    ${d.q.map((q, qi) => { const a = V.ans[qi]; return `<div class="card"><b>${qi + 1}. ${esc(q[0])}</b><div class="opts">${q[1].map((o, oi) => `<button class="opt ${a != null ? (oi === q[2] ? 'ok' : oi === a ? 'no' : '') : ''}" data-act="dq" data-q="${qi}" data-o="${oi}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div></div>`; }).join('')}
    ${done || V.tx ? `<div class="card"><span class="lab">Transkript</span>${lines.map(l => `<div class="dline"><span class="who w${who.indexOf(l.who)}">${l.who}</span><p>${esc(l.text)}</p>${spk(l.text)}</div>`).join('')}</div>` : '<button class="btn sm" data-act="dtx" style="align-self:flex-start">Show transcript (counts as a hint)</button>'}
    ${done ? `<div class="fb ${score === d.q.length ? '' : 'no'}"><h3>${score} of ${d.q.length} right</h3><p class="small">${score === d.q.length ? 'You understood the whole conversation.' : 'Listen again while reading the transcript, then try a new one.'}</p>${nextDialog() ? `<button class="btn pri wide" data-act="go" data-v="dialog" data-id="${nextDialog().id}">Next dialogue</button>` : ''}<button class="btn wide" data-act="go" data-v="hoeren">All dialogues</button></div>` : ''}`;
};

async function genDialog() {
  if (!AI || V.busy) return; V.busy = true; render();
  const lv = lvlNow(), words = shuffle(WORDS.filter(w => learned(w.id) && w.lvl === lv)).slice(0, 25).map(w => w.ans);
  try {
    const d = await AI.json(`Write a realistic German listening dialogue for a learner at CEFR level ${lv}: 8 to 12 lines between two people (A and B) in an everyday situation${S.prof.why.length ? ' relevant to someone learning German for: ' + S.prof.why.join(', ') : ''}. Natural spoken German, level-appropriate. Reuse several of these words: ${words.join(', ')}. Seed ${Math.random().toString(36).slice(2, 7)}.
Return ONLY JSON: {"title": short German title, "lines": [{"who": "A" or "B", "text": string}], "questions": [3 objects {"q": German question testing understanding (not word matching), "options": [3 short German answers], "answer": index 0-2}]}`, { cache: false });
    const ok = d && d.title && Array.isArray(d.lines) && d.lines.length >= 4 && d.lines.every(l => l && /^[AB]$/.test(l.who) && l.text) && Array.isArray(d.questions) && d.questions.length >= 2 && d.questions.every(q => q && q.q && Array.isArray(q.options) && q.options[q.answer] != null);
    if (!ok) throw { code: 'bad' };
    const item = { id: 'ai' + Date.now().toString(36), lvl: lv, t: String(d.title), d: d.lines.map(l => l.who + ': ' + String(l.text).replace(/\n/g, ' ')).join('\n'), q: d.questions.slice(0, 4).map(q => [String(q.q), q.options.map(String), q.answer]) };
    S.aiL = [item].concat(S.aiL || []).slice(0, 30); save();
    V.busy = false; go('dialog', item.id); return;
  } catch (e) { toast(e && e.code === 'bad' ? 'Claude\'s dialogue came back incomplete. Try again.' : aiErr(e) || 'Try again.'); }
  V.busy = false; render();
}
async function genDrills() {
  if (!AI || V.busy) return;
  const done = STATIONS.filter(st => S.les[st.id]); if (!done.length) { toast('Finish a grammar lesson first.'); return; }
  V.busy = true; render();
  const topics = shuffle(done.slice(-3).concat(shuffle(done).slice(0, 2))).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
  const words = shuffle(WORDS.filter(w => learned(w.id))).slice(0, 40).map(w => w.ans);
  try {
    const d = await AI.json(`Create German grammar exercises for a learner at level ${lvlNow()}. Topics (id: name, description):
${topics.map(t => `${t.id}: ${t.name} (${t.sub}). Rules: ${t.g.join(' / ').replace(/\*/g, '')}`).join('\n')}
Return ONLY JSON {"trans": [...], "fix": [...]}:
- "trans": 3 items per topic: {"sid": topic id, "from": a natural German sentence of 5-12 words, "task": a short English instruction to transform it so it practises the topic (e.g. "Put it in the Perfekt.", "Join with weil."), "answers": [the correct transformed sentence, plus 1 other fully correct version if one exists]}
- "fix": 2 items per topic: {"sid": topic id, "bad": a sentence with exactly ONE mistake about the topic, "good": the same sentence corrected (change as few words as possible), "why": one short English explanation}
Prefer words the learner knows: ${words.join(', ')}. Answers must be unambiguous.`, { cache: false });
    const sids = new Set(topics.map(t => t.id));
    const tr = (d && Array.isArray(d.trans) ? d.trans : []).filter(x => x && sids.has(x.sid) && x.from && x.task && Array.isArray(x.answers) && x.answers[0]).map(x => ({ sid: x.sid, from: String(x.from), task: String(x.task), ans: x.answers.map(String).filter(Boolean).slice(0, 3) }));
    const fx = (d && Array.isArray(d.fix) ? d.fix : []).filter(x => x && sids.has(x.sid) && x.bad && x.good && x.bad !== x.good && x.why).filter(x => { const b = String(x.bad).split(' '), g = String(x.good).split(' '); let i = 0; while (i < b.length && b[i] === g[i]) i++; let j = 0; while (j < b.length - i && j < g.length - i && b[b.length - 1 - j] === g[g.length - 1 - j]) j++; return b.length - i - j <= 3 && Math.abs(b.length - g.length) <= 1; }).map(x => ({ sid: x.sid, bad: String(x.bad), good: String(x.good), why: String(x.why) }));
    if (!tr.length && !fx.length) throw { code: 'bad' };
    S.aiT = tr.concat(S.aiT || []).slice(0, 300); S.aiF = fx.concat(S.aiF || []).slice(0, 300); save();
    toast(`${tr.length + fx.length} new exercises from Claude.`);
    V.busy = false;
    const steps = shuffle(tr.map(transFrom).concat(fx.map(fixFrom))).slice(0, 12).map(st => Object.assign(st, { free: true, drill: true }));
    start('drill', { steps, title: 'Frisch von Claude' });
    return;
  } catch (e) { toast(e && e.code === 'bad' ? 'Claude\'s exercises came back incomplete. Try again.' : aiErr(e) || 'Try again.'); }
  V.busy = false; render();
}

/* ---------- mock exam ---------- */
let EX = null;
const EXSPEC = { A2: [160, 40], B1: [240, 80], B2: [340, 150] };
const EXSTAGES = ['lesen', 'hoeren', 'schreiben', 'sprechen'];
async function startExam(lvl) {
  EX = { lvl, stage: 'intro', data: null, err: '', ans: { r: {}, h: {} }, write: '', speak: ['', ''], plays: 0, t0: 0 };
  go('exam');
}
async function genExam() {
  EX.stage = 'gen'; EX.err = ''; render();
  aiCtl = new AbortController();
  const sp = EXSPEC[EX.lvl];
  try {
    const d = await AI.json(`Write a short mock exam modelled on the Goethe-Zertifikat ${EX.lvl} for a German learner. All content in German. Return ONLY JSON:
{"lesen":{"title":string,"text":string (an authentic-style article, blog post or ad text, about ${sp[0]} words, paragraphs separated by \\n\\n),"questions":[5 objects {"q":string,"options":[3 strings],"answer":index 0-2}]},
"hoeren":{"title":string,"lines":[10 to 14 objects {"who":"A" or "B","text":string}] (a realistic conversation, phone call or radio interview),"questions":[5 objects {"q":string,"options":[3 strings],"answer":index 0-2}]},
"schreiben":{"task":string (a realistic writing task such as an email or forum post, listing 3 points the learner must cover)},
"sprechen":{"tasks":[2 strings: first a short presentation prompt, second a question asking for an opinion with reasons]}}
Level ${EX.lvl} vocabulary and grammar. Everyday topics${S.prof.why.length ? ' that suit someone learning German for: ' + S.prof.why.join(', ') : ''}. Questions must test real understanding, not word matching; wrong options must be plausible but clearly wrong. Seed ${Math.random().toString(36).slice(2, 7)}.`, { signal: aiCtl.signal, cache: false, modelTier: 'default' });
    const okQ = qs => Array.isArray(qs) && qs.length >= 3 && qs.every(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.options[q.answer] != null);
    if (!d || !d.lesen || !d.lesen.text || !okQ(d.lesen.questions) || !d.hoeren || !Array.isArray(d.hoeren.lines) || !okQ(d.hoeren.questions) || !d.schreiben || !d.sprechen || !Array.isArray(d.sprechen.tasks)) throw { code: 'bad' };
    EX.data = d; EX.stage = 'lesen'; EX.t0 = Date.now(); EX.st0 = Date.now();
  } catch (e) { EX.err = e && e.code === 'cancelled' ? 'Stopped.' : e && e.code === 'bad' ? 'The exam came back incomplete. Try again.' : aiErr(e); EX.stage = 'intro'; }
  if (V.name === 'exam') render();
}
async function gradeExam() {
  EX.stage = 'grading'; render();
  const wc = (EX.write.trim().match(/\S+/g) || []).length;
  try {
    const g = await AI.json(`You are a strict but fair Goethe examiner. Grade a German ${EX.lvl} mock exam.
WRITING task: ${EX.data.schreiben.task}
Learner's text (${wc} words, target about ${EXSPEC[EX.lvl][1]}): <<<${EX.write}>>>
SPEAKING task 1: ${EX.data.sprechen.tasks[0]}
Learner's answer (transcribed): <<<${EX.speak[0]}>>>
SPEAKING task 2: ${EX.data.sprechen.tasks[1]}
Learner's answer (transcribed): <<<${EX.speak[1]}>>>
Use the ${EX.lvl} standard: task fulfilment, coherence, range of vocabulary and structures, accuracy. 15/25 means just passing ${EX.lvl}. Score 0 for an empty or non-German answer. For speaking, ignore transcription punctuation.
Return ONLY JSON: {"schreiben":{"score": integer 0-25,"strengths": English 1-2 sentences,"improve": English 2-3 concrete points,"corrected": the learner's text fully corrected in German},"sprechen":{"score": integer 0-25,"feedback": English 2-3 sentences,"model": a model answer to task 2 in German at ${EX.lvl} level, 3-5 sentences}}`, { cache: false, modelTier: 'default' });
    if (!g || !g.schreiben || !g.sprechen) throw { code: 'bad' };
    EX.grade = g;
    const rq = EX.data.lesen.questions, hq = EX.data.hoeren.questions;
    const pr = Math.round(rq.filter((q, i) => EX.ans.r[i] === q.answer).length / rq.length * 25), ph = Math.round(hq.filter((q, i) => EX.ans.h[i] === q.answer).length / hq.length * 25);
    const pw = clamp(Math.round(+g.schreiben.score || 0), 0, 25), ps = clamp(Math.round(+g.sprechen.score || 0), 0, 25), total = pr + ph + pw + ps;
    const pass = [pr, ph, pw, ps].every(x => x >= 15);
    EX.res = { lesen: pr, hoeren: ph, schreiben: pw, sprechen: ps, total, pass };
    S.exams.push({ lvl: EX.lvl, date: Date.now(), total, pass, parts: [pr, ph, pw, ps] }); S.exams = S.exams.slice(-30);
    if (pass) { S.certs[EX.lvl] = { date: Date.now(), score: total, kind: 'exam' }; confetti(); }
    const sec = Math.min(Date.now() - EX.t0, 75 * 60e3) / 1000; dayTouch(); S.secs += sec; H().s += sec; addXp(pass ? 150 : 60);
    checkBadges(); save(); EX.stage = 'result';
  } catch (e) { EX.err = aiErr(e) || 'Grading failed. Try again.'; EX.stage = 'sprechen'; }
  if (V.name === 'exam') render();
}
VIEWS.exam = () => {
  const x = EX; if (!x) return '';
  const close = `<div class="ridebar"><button class="x" data-act="go" data-v="practice" aria-label="Leave exam">✕</button><span class="lab">Mock exam ${x.lvl}${x.stage !== 'intro' && x.stage !== 'gen' && x.stage !== 'result' ? ' · ' + (EXSTAGES.indexOf(x.stage) + 1) + '/4' : ''}</span></div>`;
  const mins = t => Math.floor((Date.now() - t) / 60000);
  if (x.stage === 'intro') return close + `<h1>Mini-Prüfung ${x.lvl}</h1><p class="mute">Modelled on the Goethe-Zertifikat ${x.lvl}, shorter. Each part counts 25 points; you pass with 60% in every part, like the real exam. This is practice, not an official result.</p>
    <div class="card"><ul class="ck">${[['Lesen', 'one text, 5 questions · ~12 min'], ['Hören', 'one conversation, played twice · ~8 min'], ['Schreiben', `email or post, ~${EXSPEC[x.lvl][1]} words · ~20 min`], ['Sprechen', 'two short spoken answers · ~8 min']].map(([a, b]) => `<li><span class="box">${ICON.chk}</span><div><b>${a}</b><span>${b}</span></div></li>`).join('')}</ul></div>
    ${x.err ? `<p class="small" style="color:var(--bad)">${esc(x.err)}</p>` : ''}<button class="btn pri wide" data-act="exgen" data-focus>Start · Claude writes your exam</button>`;
  if (x.stage === 'gen') return close + `<div class="ex center" style="padding-top:60px"><div class="spin"></div><p class="mute">Claude is writing a fresh ${x.lvl} exam. This takes up to a minute.</p></div>`;
  if (x.stage === 'grading') return close + `<div class="ex center" style="padding-top:60px"><div class="spin"></div><p class="mute">Grading your writing and speaking like a Goethe examiner…</p></div>`;
  const d = x.data, qs = (part, list) => list.map((q, qi) => { const a = x.ans[part][qi], show = x.stage === 'result'; return `<div class="card"><b>${qi + 1}. ${esc(q.q)}</b><div class="opts">${q.options.map((o, oi) => `<button class="opt ${a === oi && !show ? 'sel' : ''} ${show ? (oi === q.answer ? 'ok' : oi === a ? 'no' : '') : ''}" data-act="exq" data-p="${part}" data-q="${qi}" data-o="${oi}" ${show ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div></div>`; }).join('');
  if (x.stage === 'lesen') return close + `<span class="lab">Teil 1 · Lesen · ${mins(x.st0)} min</span><h2>${esc(d.lesen.title)}</h2>${String(d.lesen.text).split(/\n\n+/).map(p => `<p class="story">${esc(p)}</p>`).join('')}
    ${qs('r', d.lesen.questions)}<button class="btn pri wide" data-act="exnext" ${Object.keys(x.ans.r).length < d.lesen.questions.length ? 'disabled' : ''}>Weiter zu Teil 2: Hören</button>`;
  if (x.stage === 'hoeren') return close + `<span class="lab">Teil 2 · Hören · ${mins(x.st0)} min</span><h2>${esc(d.hoeren.title)}</h2><p class="mute small">You may play the recording twice. Read the questions first.</p>
    <div class="row"><button class="bigplay" data-act="explay" ${x.plays >= 2 ? 'disabled' : ''} aria-label="Play">${ICON.spk}</button><span class="small mute">${2 - x.plays} plays left</span><button class="btn sm" data-act="dstop">Stop</button></div>
    ${qs('h', d.hoeren.questions)}<button class="btn pri wide" data-act="exnext" ${Object.keys(x.ans.h).length < d.hoeren.questions.length ? 'disabled' : ''}>Weiter zu Teil 3: Schreiben</button>`;
  if (x.stage === 'schreiben') return close + `<span class="lab">Teil 3 · Schreiben · ${mins(x.st0)} min</span><div class="card"><p>${esc(d.schreiben.task)}</p><p class="small mute">About ${EXSPEC[x.lvl][1]} words.</p></div>
    <textarea class="inp" id="exw" rows="10" placeholder="Schreiben Sie hier…">${esc(x.write)}</textarea><div class="row">${UML('exw')}<span class="sp"></span><span class="small mute" id="wc">${(x.write.trim().match(/\S+/g) || []).length} words</span></div>
    <button class="btn pri wide" data-act="exnext">Weiter zu Teil 4: Sprechen</button>`;
  if (x.stage === 'sprechen') return close + `<span class="lab">Teil 4 · Sprechen · ${mins(x.st0)} min</span><p class="mute small">${canMic() ? 'Tap the mic and speak your answer (about a minute each). You can fix transcription mistakes before submitting.' : 'Type what you would say.'}</p>
    ${d.sprechen.tasks.slice(0, 2).map((t, i) => `<div class="card"><b>Aufgabe ${i + 1}</b><p>${esc(t)}</p><textarea class="inp" id="exs${i}" rows="5" placeholder="Ihre Antwort…">${esc(x.speak[i])}</textarea>${canMic() ? `<button class="btn mic wide" data-act="mic" data-for="exs${i}">${ICON.mic} Tap to speak / stop</button>` : ''}</div>`).join('')}
    ${x.err ? `<p class="small" style="color:var(--bad)">${esc(x.err)}</p>` : ''}<button class="btn pri wide" data-act="exsubmit">Submit exam for grading</button>`;
  const r = x.res, g = x.grade, bar = (lab, v) => `<div class="skill"><span>${lab}</span><span class="pbar"><i class="${v >= 15 ? 'hi' : v >= 10 ? 'mid' : 'lo'}" style="width:${v / 25 * 100}%"></i></span><span class="num small">${v}/25</span></div>`;
  return close + `<div class="ex center" style="padding-top:10px"><span class="lab">Ergebnis</span><div class="hero-n">${r.total}/100</div><p><b>${r.pass ? `Bestanden. That's ${x.lvl} level in all four skills.` : 'Not passed yet. Every part needs 15/25.'}</b></p></div>
    <div class="card">${bar('Lesen', r.lesen)}${bar('Hören', r.hoeren)}${bar('Schreiben', r.schreiben)}${bar('Sprechen', r.sprechen)}</div>
    ${r.pass ? `<button class="btn pri wide" data-act="go" data-v="cert" data-id="${x.lvl}">View your certificate</button>` : ''}
    <div class="card"><span class="lab">Schreiben · feedback</span><p class="small">${esc(g.schreiben.strengths)}</p><p class="small"><b>Improve:</b> ${esc(g.schreiben.improve)}</p><span class="lab">Corrected version</span><p class="story">${esc(g.schreiben.corrected)}</p></div>
    <div class="card"><span class="lab">Sprechen · feedback</span><p class="small">${esc(g.sprechen.feedback)}</p><span class="lab">Model answer</span><p class="story">${esc(g.sprechen.model)}</p>${spk(g.sprechen.model)}</div>
    <div class="linehd"><h2>Lesen: answers</h2></div>${qs('r', d.lesen.questions)}
    <div class="linehd"><h2>Hören: transcript</h2></div><div class="card">${d.hoeren.lines.map(l => `<div class="dline"><span class="who w${l.who === 'A' ? 0 : 1}">${esc(l.who)}</span><p>${esc(l.text)}</p></div>`).join('')}</div>${qs('h', d.hoeren.questions)}
    <button class="btn wide" data-act="go" data-v="practice">Back to Üben</button>`;
};

/* ---------- badges, weekly summary, certificates ---------- */
const BADGES = [
  ['w100', '100 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 100], ['w500', '500 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 500],
  ['w1000', '1.000 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 1000], ['w2000', '2.000 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 2000],
  ['w3000', '3.000 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 3000], ['w4000', '4.000 Wörter', () => WORDS.filter(w => learned(w.id)).length >= 4000],
  ['s7', '7 Tage am Stück', () => S.streak >= 7], ['s30', '30 Tage am Stück', () => S.streak >= 30], ['s100', '100 Tage am Stück', () => S.streak >= 100],
  ['h25', '25 Stunden', () => hoursTotal() >= 25], ['h100', '100 Stunden', () => hoursTotal() >= 100], ['h250', '250 Stunden', () => hoursTotal() >= 250], ['h500', '500 Stunden', () => hoursTotal() >= 500],
  ['gA1', 'A1 geschafft', () => S.checks.A1 >= 75], ['gA2', 'A2 geschafft', () => S.checks.A2 >= 75], ['gB1', 'B1 geschafft', () => S.checks.B1 >= 75], ['gB2', 'B2 geschafft', () => S.checks.B2 >= 75],
  ['exam', 'Prüfung bestanden', () => S.exams.some(z => z.pass)], ['read10', '10 Texte gelesen', () => Object.keys(S.read).length >= 10], ['hear10', '10 Dialoge verstanden', () => Object.keys(S.heard).length >= 10],
  ['gram10', 'Alle A1-Lektionen', () => STATIONS.filter(z => z.lvl === 'A1').every(z => S.les[z.id])]
];
function checkBadges() { const got = []; BADGES.forEach(([id, t, f]) => { try { if (!S.badges[id] && f()) { S.badges[id] = Date.now(); got.push(t); } } catch (e) {} }); if (got.length) { setTimeout(() => { toast('Neues Abzeichen: ' + got.join(', ')); confetti(); }, 600); } }
const weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
function weekCard() {
  const key = dstr(weekStart(Date.now())); if (S.wk === key) return '';
  const st = weekStart(Date.now()) - 7 * DAY; let m = 0, w = 0, g = 0, a = 0, c = 0, days = 0;
  for (let i = 0; i < 7; i++) { const h = hget(dstr(st + i * DAY + 12 * 3600e3)); if (h) { m += h.s / 60; w += h.w || 0; g += h.g || 0; a += h.a; c += h.c; if (h.s > 120) days++; } }
  if (m < 1) return '';
  return `<div class="card goodc"><div class="row"><span class="lab">Deine letzte Woche</span><span class="sp"></span><button class="btn sm ghost" data-act="weekok">Got it</button></div>
    <div class="stats"><div class="stat"><b>${Math.round(m)}</b><span>minutes</span></div><div class="stat"><b>${w}</b><span>new words</span></div><div class="stat"><b>${g}</b><span>new sentences</span></div><div class="stat"><b>${a ? Math.round(c / a * 100) + '%' : '–'}</b><span>accuracy</span></div></div>
    <p class="small">${days >= 6 ? 'Almost every day. That consistency is exactly what makes words stick.' : days >= 4 ? `${days} active days. Aim for one more this week; short daily sessions beat long rare ones.` : `${days} active days. Try 15 minutes on the days you'd normally skip: frequency matters more than length.`}</p></div>`;
}
VIEWS.cert = () => {
  const l = V.id, c = S.certs[l]; if (!c) return '<button class="back" data-act="go" data-v="me">← Ich</button><p>No certificate yet.</p>';
  return `<button class="back" data-act="go" data-v="me">← Ich</button>
  <div class="cert"><span class="lab">Wortwerk · Zertifikat</span><div class="cl">${l}</div><h1>${esc(S.prof.name || 'Wortwerk-Lernende*r')}</h1>
    <p>hat das Niveau <b>${l}</b> des Gemeinsamen Europäischen Referenzrahmens in Wortwerk nachgewiesen.</p>
    <p class="small">${c.kind === 'exam' ? `Mini-Prüfung (Lesen, Hören, Schreiben, Sprechen): ${c.score}/100` : `Level-Check: ${c.score}%`} · ${fmtDate(c.date)}</p>
    <p class="small mute">A personal milestone, not an official certificate. For an official one, take the Goethe or telc exam.</p></div>`;
};

/* ---------- games ---------- */
const NOUNS = WORDS.filter(w => w.kind === 'n' && w.g !== 'p');
const VERBS = D.verbs.split(';').map(s => { const [inf, pr, pf, en] = s.split('|'); return { inf, pr, pf, en }; });
function tip(n) {
  const m = n.noun.match(/(ung|heit|keit|schaft|ion|tät)$/); if (m) return 'Nouns ending in -' + m[0] + ' are always die.';
  if (/(chen|lein)$/.test(n.noun)) return 'Nouns on -chen and -lein are always das.';
  if (/(ment|um)$/.test(n.noun) && n.g === 's') return 'Nouns on -ment and -um are usually das.';
  return '';
}
VIEWS.blitz = () => {
  if (!G || G.kind !== 'blitz') G = { kind: 'blitz', state: 'idle' };
  const pool = NOUNS.filter(w => learned(w.id));
  if (G.state === 'idle') return `<button class="back" data-act="go" data-v="practice">← Üben</button><div class="ex center" style="padding-top:30px"><h1>Artikel-Blitz</h1>
    <p class="mute">45 seconds. Tap the right article, or press 1, 2, 3. ${pool.length >= 20 ? `Uses the ${pool.length} nouns you've learned.` : 'Learn 20 nouns to play with your own words; until then it uses the A1 nouns.'}</p><p class="num">Best ${S.hi.blitz}</p><button class="btn pri wide" data-act="bstart" data-focus>Start</button></div>`;
  if (G.state === 'over') return `<div class="ex center" style="padding-top:40px"><span class="lab">Zeit um</span><div class="hero-n">${G.score}</div><p class="mute">${G.score >= S.hi.blitz && G.score ? 'New personal best.' : 'Best ' + S.hi.blitz} · +${G.xp} XP</p>
    ${G.missed.length ? `<div class="card" style="width:100%;text-align:left"><span class="lab">Look at these again</span><div>${G.missed.map(n => `<div class="sent"><div><span class="${artCls(n)}"><b>${n.art}</b> ${esc(n.noun)}</span><small>${esc(n.en)}</small></div></div>`).join('')}</div></div>` : ''}
    <button class="btn pri wide" data-act="bstart" data-focus>Nochmal</button><button class="btn wide" data-act="go" data-v="practice">Üben</button></div>`;
  const n = G.cur;
  return `<div class="ridebar"><button class="x" data-act="go" data-v="practice" aria-label="Quit">✕</button><div class="bar"><i id="tbar" style="width:${G.left / 45 * 100}%"></i></div><span class="combo num">${G.score}</span></div>
    <div class="ex center" style="padding-top:36px"><div class="noun">${esc(n.noun)}</div><p class="en">${esc(n.en)}</p>
    <p class="flash ${G.flash ? G.flash.c : ''}">${G.flash ? esc(G.flash.t) : '&nbsp;'}</p>
    <div class="g3">${['der', 'die', 'das'].map((a, i) => `<button class="${'res'[i]}" data-act="bans" data-v="${a}">${a}</button>`).join('')}</div></div>`;
};
function bstart() {
  if (G && G.timer) clearInterval(G.timer);
  const mine = NOUNS.filter(w => learned(w.id)), pool = mine.length >= 20 ? mine : NOUNS.filter(w => w.lvl === 'A1');
  G = { kind: 'blitz', state: 'play', score: 0, left: 45, pool, deck: shuffle(pool), missed: [], flash: null };
  G.cur = G.deck.pop();
  G.timer = setInterval(() => {
    G.left -= 0.1; const b = document.getElementById('tbar'); if (b) b.style.width = Math.max(0, G.left / 45 * 100) + '%';
    if (G.left <= 0) { clearInterval(G.timer); G.timer = 0; G.state = 'over'; G.xp = Math.min(60, G.score * 2); if (G.score > S.hi.blitz) { S.hi.blitz = G.score; confetti(); } if (G.xp) addXp(G.xp); save(); render(); }
  }, 100);
  render();
}
function bans(a) {
  if (!G || G.state !== 'play') return;
  tick();
  const n = G.cur, ok = a === n.art; stat('art', ok);
  if (ok) G.score++; else if (!G.missed.includes(n)) G.missed.push(n);
  G.flash = ok ? { c: 'ok', t: n.art + ' ' + n.noun } : { c: 'no', t: (n.art + ' ' + n.noun + '. ' + tip(n)).trim() };
  beep(ok); if (!G.deck.length) G.deck = shuffle(G.pool); G.cur = G.deck.pop(); render();
}
VIEWS.verb = () => {
  if (!G || G.kind !== 'verb') G = { kind: 'verb', state: 'idle' };
  if (G.state === 'idle') return `<button class="back" data-act="go" data-v="practice">← Üben</button><div class="ex center" style="padding-top:30px"><h1>Verb-Sprint</h1>
    <p class="mute">Ten strong verbs. Type the form for er/sie, for example <b>ging</b> or <b>ist gegangen</b>.</p><p class="num">Best ${S.hi.verb}/10</p><button class="btn pri wide" data-act="vstart" data-focus>Start</button></div>`;
  if (G.state === 'over') return `<div class="ex center" style="padding-top:40px"><span class="lab">Geschafft</span><div class="hero-n">${G.score}/10</div><p class="mute">+${G.score * 5} XP</p>
    <button class="btn pri wide" data-act="vstart" data-focus>Nochmal</button><button class="btn wide" data-act="go" data-v="practice">Üben</button></div>`;
  const q = G.qs[G.i], fb = G.fb;
  return `<div class="ridebar"><button class="x" data-act="go" data-v="practice" aria-label="Quit">✕</button><div class="bar"><i style="width:${G.i * 10}%"></i></div><span class="combo num">${G.score}</span></div>
    <div class="ex"><span class="lab">${q.form === 'pr' ? 'Präteritum · er/sie' : 'Perfekt · er/sie'}</span><div class="noun">${esc(q.v.inf)}</div><p class="en">to ${esc(q.v.en)}</p>
    <input class="inp" id="ans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${q.form === 'pr' ? 'er …' : 'er hat / ist …'}" ${fb ? `disabled value="${esc(fb.given)}"` : 'data-focus'}>
    ${fb ? `<div class="fb ${fb.ok ? '' : 'no'}"><h3>${fb.ok ? 'Richtig!' : 'Not quite'}</h3><p class="ans">${esc(q.v.inf)} · ${esc(q.v.pr)} · ${esc(q.v.pf)}</p><button class="btn pri wide" data-act="vnext" data-focus>Weiter</button></div>` : UML('ans') + '<button class="btn pri wide" data-act="vcheck">Check</button>'}</div>`;
};
function vcheck() { const q = G.qs[G.i], given = document.getElementById('ans').value.trim(); if (!given || G.fb) return; tick(); const ok = norm(given) === norm(q.v[q.form]); stat('recall', ok); if (ok) G.score++; beep(ok); G.fb = { ok, given }; render(); }
function vnext() { G.fb = null; G.i++; if (G.i >= 10) { G.state = 'over'; if (G.score > S.hi.verb) S.hi.verb = G.score; if (G.score) addXp(G.score * 5); save(); if (G.score >= 8) confetti(); } render(); }

/* ---------- AI tutor (Claude version) ---------- */
const AIMSG = {
  not_granted: 'Claude isn\'t allowed on this page yet. Open Ich → Status and tap "Fix permissions", or allow Claude in the page\'s Permissions menu.',
  sampling_disabled: 'Claude isn\'t available for this account or in this view.',
  capability_disabled: 'The tutor can\'t run in this view. Open Wortwerk in a browser tab at claude.ai or in the Claude desktop app.',
  not_declared: 'This version of the page can\'t use Claude. Reload it.',
  session_expired: 'Your Claude session expired. Reload the page and sign in again.',
  rate_limited: 'Too many requests right now. Wait a minute and try again.',
  refused: 'Claude declined that request. Try rephrasing it.',
  empty_completion: 'Claude returned an empty answer. Try again.',
  invalid_json: 'Claude\'s answer came back malformed. Try again.',
  queue_overflow: 'Too many requests at once. Wait a moment and try again.',
  cancelled: ''
};
const aiErr = e => { const c = e && e.code; return c in AIMSG ? AIMSG[c] : 'The tutor didn\'t answer' + (c ? ' (' + c + ')' : '') + '. Try again.'; };
function knownWordsSample() { return shuffle(WORDS.filter(w => learned(w.id))).slice(0, 60).map(w => w.ans).join(', '); }
function startChat(id, voiceMode) {
  const sc = D.scenes.find(s => s.id === id), L = sc.lvl && LV.indexOf(sc.lvl) > LV.indexOf(lvlNow()) ? sc.lvl : lvlNow();
  const why = S.prof.why.length ? ' The learner is learning German for: ' + S.prof.why.join(', ') + '.' : '';
  const rules = `You are part of a German learning app. ${sc.p}
Learner level: ${L} (CEFR).${why} Stay strictly at that level in vocabulary and grammar. Words the learner already knows include: ${knownWordsSample()}.
Rules for EVERY reply:
1. Write your in-role reply ONLY in German, ${sc.write ? 'as described' : '1 to 3 short sentences, and end with a question or prompt that keeps the conversation going'}.
2. Then a line containing exactly ### and after it feedback in English on the learner's LAST message: ${sc.write ? 'list every mistake as "wrong → right (short reason)", then give the fully corrected text.' : 'if it had mistakes, give the corrected German sentence and a one-line reason; if it was correct write "Perfekt ✓" and, when useful, one more natural way to say it.'}
3. No markdown, no translations of your own reply.
Begin now with your first in-role line. For this first message leave out the ### part.`;
  C = { sc, turns: [{ role: 'user', content: rules }], busy: false, err: '', voice: !!voiceMode && canMic(), speakReplies: !!voiceMode };
  go('chat'); ask();
}
async function ask() {
  C.busy = true; C.err = ''; render();
  aiCtl = new AbortController();
  try {
    const { text } = await AI(C.turns, { cache: false, signal: aiCtl.signal, onText: ({ text }) => { const el = document.getElementById('live'); if (el) el.textContent = text.split('###')[0].trim() || '…'; } });
    C.turns.push({ role: 'assistant', content: text });
    if ((C.voice || C.speakReplies) && V.name === 'chat') say(text.split('###')[0].trim());
    if (C.turns.length > 3) { addXp(6); save(); }
  } catch (e) { C.err = aiErr(e); if (C.turns[C.turns.length - 1].role === 'user' && C.turns.length > 1) C.draft = C.turns.pop().content; }
  C.busy = false;
  if (V.name === 'chat') { render(); window.scrollTo(0, document.body.scrollHeight); }
}
VIEWS.chat = () => {
  let h = '';
  C.turns.forEach((t, i) => {
    if (i === 0) return;
    if (t.role === 'user') h += `<div class="msg me">${esc(t.content)}</div>`;
    else { const [de, note] = t.content.split('###'); if (note && note.trim()) h += `<div class="note">${esc(note.trim())}</div>`; h += `<div class="msg them">${esc(de.trim())}</div><div class="msgact">${spk(de.trim())}${t.tr ? '' : `<button class="btn sm" data-act="tr" data-i="${i}">Translate</button>`}</div>${t.tr ? `<div class="small mute">${esc(t.tr)}</div>` : ''}`; }
  });
  if (C.busy) h += '<div class="msg them" id="live">…</div>';
  return `<div class="ridebar"><button class="x" data-act="go" data-v="practice" aria-label="Leave">✕</button><div style="flex:1;min-width:0"><b>${esc(C.sc.t)}</b><div class="small mute">${esc(C.sc.en)}</div></div>${canMic() ? `<button class="btn sm ${C.voice ? 'pri' : ''}" data-act="voice">${ICON.mic} ${C.voice ? 'Voice on' : 'Voice off'}</button>` : `<button class="btn sm" data-act="nomic">${ICON.mic} Voice?</button>`}</div>
    <div class="msgs">${h}</div>${C.err ? `<div class="card warnc"><p class="small">${esc(C.err)}</p><div class="row"><button class="btn sm" data-act="retry">Try again</button><button class="btn sm" data-act="go" data-v="me">Check status</button></div></div>` : ''}
    <div class="send"><textarea class="inp" id="msg" rows="2" placeholder="Schreib auf Deutsch…" ${C.busy ? 'disabled' : 'data-focus'}>${esc(C.draft || '')}</textarea>
    ${C.voice ? `<button class="btn pri wide mic vtalk" data-act="vtalk" ${C.busy ? 'disabled' : ''}>${ICON.mic} <span>Tap, speak, tap again to send</span></button>` : ''}
    <div class="row">${UML('msg')}<span class="sp"></span><button class="btn ${C.voice ? '' : 'pri'}" data-act="send" ${C.busy ? 'disabled' : ''}>Senden</button></div></div>`;
};
function send() { const el = document.getElementById('msg'), v = el.value.trim(); if (!v || C.busy) return; micStop(); tick(); C.draft = ''; C.turns.push({ role: 'user', content: v }); ask(); }
async function translate(i) {
  const t = C.turns[i]; if (!t || t.tr) return; t.tr = '…'; render();
  try { t.tr = (await AI('Translate this German into natural English. Output only the translation.\n\n' + t.content.split('###')[0], { modelTier: 'quick' })).text.trim(); } catch (e) { t.tr = ''; toast(aiErr(e)); }
  if (V.name === 'chat') render();
}
async function why() {
  const e = R.q[R.i], fb = R.fb; if (!fb || fb.why) return; fb.why = 'Thinking…'; render();
  try { fb.why = (await AI(`A German learner (level ${e.x.lvl}) got an exercise wrong.\nCorrect sentence: ${e.x.de}\nMeaning: ${e.x.en}\nTested word: ${e.x.ans}\nLearner's answer: ${fb.given || '(blank)'}\nExplain in at most 2 short English sentences why the correct version is right and what rule to remember. Plain text, no markdown.`, { modelTier: 'quick' })).text.trim(); }
  catch (err) { fb.why = ''; toast(aiErr(err)); }
  if (V.name === 'ride' && R.fb === fb) render();
}
async function more(sid) {
  const st = stById(sid); if (V.busy) return; V.busy = true; render();
  try {
    const have = sentsOf(st).map(x => x.de);
    const out = await AI.json(`Create 8 new practice sentences for a German course.
Level: ${st.lvl}. Grammar focus: ${st.name} (${st.sub}).
Rules of this unit:\n- ${st.g.join('\n- ').replace(/\*/g, '')}
Return ONLY a JSON array of 8 objects {"de": string, "en": string}.
In "de", wrap exactly ONE word (the one that tests the grammar focus) in braces together with two wrong alternatives, correct one first: {right/wrong1/wrong2}. The wrong alternatives must be clearly incorrect in that sentence. Natural everyday sentences, 5 to 12 words, vocabulary suitable for ${st.lvl}, each on a different topic. No pipe characters.
Do not repeat these sentences:\n${have.join('\n')}`);
    const good = (Array.isArray(out) ? out : []).filter(o => o && typeof o.de === 'string' && typeof o.en === 'string' && !/\|/.test(o.de + o.en)).map(o => o.de.trim() + '|' + o.en.trim()).filter(r => { const p = parseSent(r, 'x', sid); return p && !have.includes(p.de); });
    if (!good.length) throw { code: 'empty' };
    S.extra[sid] = (S.extra[sid] || []).concat(good).slice(0, 48); save(); toast(good.length + ' new sentences added to this station.');
  } catch (e) { toast(aiErr(e)); }
  if (V.name === 'station') { V.busy = false; render(); }
}
async function startStory(sid) {
  const st = sid ? stById(sid) : (nextStation() || STATIONS[STATIONS.length - 1]), L = st.lvl, words = { A1: 90, A2: 130, B1: 180, B2: 240 }[L];
  ST = { st, busy: true, data: null, err: '', ans: {}, added: false }; go('story');
  aiCtl = new AbortController();
  try {
    const d = await AI.json(`Write an engaging short story in German for a learner at CEFR level ${L}, about ${words} words, with a small twist or joke at the end. Use the grammar "${st.name} (${st.sub})" several times, naturally. Reuse many of these words the learner knows: ${knownWordsSample()}. Seed: ${Math.random().toString(36).slice(2, 7)}.
Return ONLY JSON: {"title": string, "text": string (paragraphs separated by \\n\\n), "glossary": [8 objects {"de": the word in dictionary form with article for nouns (e.g. "der Bahnhof"), "en": English, "ex": the sentence from the story where it appears, "exEn": English translation of that sentence}], "questions": [3 objects {"q": question in German, "options": [3 short German answers], "answer": index of the correct option}]}`, { signal: aiCtl.signal, cache: false });
    if (!d || !d.text || !Array.isArray(d.questions)) throw { code: 'empty' };
    ST.data = d;
  } catch (e) { ST.err = aiErr(e) || 'Stopped.'; }
  ST.busy = false; if (V.name === 'story') render();
}
VIEWS.story = () => {
  const back = '<button class="back" data-act="go" data-v="practice">← Üben</button>';
  if (ST.busy) return back + `<div class="ex center" style="padding-top:60px"><div class="spin"></div><p class="mute">Writing a ${ST.st.lvl} story around “${esc(ST.st.name)}”. This takes up to a minute.</p></div>`;
  if (ST.err) return back + `<div class="card"><b>${esc(ST.err)}</b><button class="btn" data-act="story" data-id="${ST.st.id}">Try again</button></div>`;
  const d = ST.data, paras = String(d.text).split(/\n\n+/), gl = Array.isArray(d.glossary) ? d.glossary.filter(g => g && g.de && g.en) : [];
  return back + `<span class="lab">${ST.st.lvl} · Lesestück</span><h1>${esc(d.title)}</h1>
    ${paras.map(p => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><p class="story" style="flex:1;min-width:0">${esc(p)}</p>${spk(p)}</div>`).join('')}
    ${gl.length ? `<div class="card"><span class="lab">New words</span><div class="gloss">${gl.map(g => `<span><b>${esc(g.de)}</b> ${esc(g.en)}</span>`).join('')}</div><button class="btn sm" data-act="addgl" ${ST.added ? 'disabled' : ''} style="align-self:flex-start">${ST.added ? 'Saved to Meine Wörter' : 'Save these words to learn'}</button></div>` : ''}
    ${d.questions.slice(0, 3).map((q, qi) => `<div class="card"><b>${esc(q.q)}</b><div class="opts">${(q.options || []).map((o, oi) => { const a = ST.ans[qi]; return `<button class="opt ${a != null ? (oi === q.answer ? 'ok' : oi === a ? 'no' : '') : ''}" data-act="sq" data-q="${qi}" data-o="${oi}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`; }).join('')}</div></div>`).join('')}
    <button class="btn pri wide" data-act="story" data-id="${ST.st.id}">Another story</button>`;
};

/* ================= events ================= */
function onbDone(tgt) {
  S.prof.target = +tgt; S.prof.onboarded = true; if (!S.prof.start) S.prof.start = Date.now();
  save(); go('home');
}
const acts = {
  go: el => go(el.dataset.v, el.dataset.id, el.dataset.from ? { from: el.dataset.from } : null),
  onb: el => { V = { name: 'onb', step: +el.dataset.v, months: V.months }; render(); window.scrollTo(0, 0); },
  whypick: el => { const k = el.dataset.v, a = S.prof.why; const i = a.indexOf(k); if (i > -1) a.splice(i, 1); else a.push(k); save(); render(); },
  lvlpick: el => { if (el.dataset.v === 'test') { S.prof.onboarded = false; start('place'); } else { V = { name: 'onb', step: 3 }; render(); } },
  mins: el => { S.prof.mins = +el.dataset.v; save(); render(); },
  months: el => { V.months = +el.dataset.v; render(); },
  onbdone: el => onbDone(el.dataset.v),
  daily: el => start('daily', { reviewOnly: !!(el && el.dataset && el.dataset.v === 'rev') }),
  station: el => start('station', { id: el.dataset.id }),
  relearn: el => start('station', { id: el.dataset.id, relearn: true }),
  pack: el => start('pack', { id: el.dataset.id }),
  packrev: el => start('pack', { id: el.dataset.id, review: true }),
  weak: () => start('weak'), listen: () => start('listen'), speak: () => start('speak'),
  lcheck: el => start('check', { lvl: el.dataset.v }),
  say: el => say(el.dataset.t, !!el.dataset.slow),
  introok: () => { tick(); R.fb = { ok: true }; next(); },
  known: () => {
    const w = R.q[R.i].x; learn(w.id, true);
    R.q = R.q.filter((e, i) => i <= R.i || e.x !== w); save(); R.fb = { ok: true }; next();
  },
  lq: el => {
    const e = R.q[R.i], qi = +el.dataset.q, v = el.dataset.v; if (e.ans[qi] != null) return;
    tick(); e.ans[qi] = v; const right = e.card.split('\n').filter(l => l.trim().startsWith('? '))[qi].match(/\{([^/}]+)/)[1];
    const ok = v === right; stat('gram', ok); dayTouch(); const h = H(); h.a++; if (ok) h.c++; if (ok) addXp(3); beep(ok); save(); render();
  },
  lnext: () => { const e = R.q[R.i]; tick(); if (e.ci + 1 === e.cn) { S.les[e.x.id] = 1; save(); } R.fb = { ok: true }; next(); },
  mc: el => { const e = R.q[R.i], v = el.dataset.v, right = e.t === 'cMc' ? e.ans : e.t === 'wMc' ? e.x.en : e.t === 'wArt' ? e.x.art : e.x.ans; grade(v === right, v); },
  idk: () => grade(false, ''),
  pick: el => { R.q[R.i].pick.push(+el.dataset.k); render(); },
  unpick: el => { R.q[R.i].pick.splice(+el.dataset.k, 1); render(); },
  check: () => doCheck(),
  next, why,
  skip: () => { R.fb = { ok: true, given: '', xp: 0, word: 'Skipped' }; render(); },
  override: () => {
    const e = R.q[R.i], x = e.x, i = R.q.indexOf(e.re); if (i > -1) R.q.splice(i, 1);
    if (!e.free && !e.isNew && e.prev) { S.it[x.id] = e.prev; review(x.id, true, 'hard'); }
    if (e.isNew && e.final && !e.free && !learned(x.id)) { learn(x.id); if (x.kind === 's') R.ns++; else R.nw++; }
    R.miss--; R.ok++; R.xp += 10; addXp(10); R.fb.ok = true; R.fb.xp = 10; R.fb.word = 'Counted'; save(); render();
  },
  quit: () => { tick(); save(); go(R && R.kind === 'place' ? 'onb' : 'home', null, R && R.kind === 'place' ? { step: 2 } : null); },
  uml: el => { const t = document.getElementById(el.dataset.for); if (!t) return; const s = t.selectionStart ?? t.value.length, e2 = t.selectionEnd ?? s; t.value = t.value.slice(0, s) + el.dataset.c + t.value.slice(e2); t.focus(); t.setSelectionRange(s + 1, s + 1); },
  mic: el => micToggle(el.dataset.for),
  bstart, bans: el => bans(el.dataset.v),
  vstart: () => { G = { kind: 'verb', state: 'play', i: 0, score: 0, fb: null, qs: shuffle(VERBS).slice(0, 10).map(v => ({ v, form: Math.random() < 0.5 ? 'pr' : 'pf' })) }; render(); },
  vcheck, vnext,
  chat: el => startChat(el.dataset.id, el.dataset.v === 'voice'), send,
  nomic: () => toast('Speaking needs the microphone, which works in Chrome or Edge at claude.ai or the Claude desktop app\'s main window. Check Ich → Status.'),
  retry: () => { if (C && !C.busy) { if (C.draft) { C.turns.push({ role: 'user', content: C.draft }); C.draft = ''; } ask(); } },
  voice: () => { C.voice = !C.voice; if (!C.voice) { micStop(); stopSpeech(); } render(); },
  vtalk: () => {
    if (C.busy) return;
    const on = (DICT && DICT.active()) || rec;
    if (!on) { stopSpeech(); micToggle('msg'); return; }
    if (DICT && DICT.active()) { DICT.stop().then(() => setTimeout(send, 60)).catch(() => send()); }
    else if (rec) { rec.onend = () => { rec = null; micState(false); send(); }; try { rec.stop(); } catch (e) { send(); } }
  },
  recai: () => recAI(),
  recheck: () => { V.caps = null; V.capsBusy = 0; V.aiTest = ''; render(); },
  perms: () => { if (!PERM) return; PERM.manage().then(() => { V.caps = null; V.capsBusy = 0; render(); }).catch(() => toast('Open the page\'s Permissions menu (top of the artifact) and allow Claude, voice and dictation.')); },
  testai: async () => { V.aiTest = 'Asking Claude…'; render(); try { const r = await AI('Antworte mit genau einem kurzen deutschen Satz: Begrüße einen Deutschlernenden.', { modelTier: 'quick', cache: false }); V.aiTest = 'Tutor works ✓ Claude said: ' + r.text.trim(); } catch (e) { V.aiTest = 'Tutor problem: ' + aiErr(e); } V.caps = null; V.capsBusy = 0; render(); },
  gendialog: () => genDialog(),
  gendrills: () => genDrills(),
  weekok: () => { S.wk = dstr(weekStart(Date.now())); save(); render(); },
  dplay: el => { const d = allDialogs().find(z => z.id === V.id); if (d) sayLines(parseDialog(d), !!el.dataset.slow); },
  dstop: () => stopSpeech(),
  dtx: () => { V.tx = true; render(); },
  dq: el => {
    const d = allDialogs().find(z => z.id === V.id), qi = +el.dataset.q, o = +el.dataset.o; if (V.ans[qi] != null) return;
    V.ans[qi] = o; const ok = o === d.q[qi][2]; beep(ok); if (!V.tx) stat('lis', ok); dayTouch(); const h = H(); h.a++; if (ok) { h.c++; addXp(8); }
    if (Object.keys(V.ans).length === d.q.length) { const sec = Math.min(Date.now() - V.t0, 12 * 60e3) / 1000; S.secs += sec; h.s += sec; S.heard[d.id] = Math.max(S.heard[d.id] || 0, d.q.filter((q, i) => V.ans[i] === q[2]).length); h.lr = 1; checkBadges(); }
    save(); render();
  },
  exam: el => startExam(el.dataset.v),
  exgen: () => genExam(),
  exq: el => { if (!EX || EX.stage === 'result') return; EX.ans[el.dataset.p][+el.dataset.q] = +el.dataset.o; render(); },
  exnext: () => { const i = EXSTAGES.indexOf(EX.stage); if (EX.stage === 'schreiben') { const t = document.getElementById('exw'); if (t) EX.write = t.value; } stopSpeech(); micStop(); EX.stage = EXSTAGES[i + 1]; EX.st0 = Date.now(); render(); window.scrollTo(0, 0); },
  explay: () => { if (EX.plays >= 2) return; EX.plays++; sayLines(EX.data.hoeren.lines.map(l => ({ who: l.who === 'B' ? 'B' : 'A', text: String(l.text) }))); render(); },
  exsubmit: () => { micStop(); [0, 1].forEach(i => { const t = document.getElementById('exs' + i); if (t) EX.speak[i] = t.value; }); gradeExam(); }, tr: el => translate(+el.dataset.i),
  more: el => more(el.dataset.id), story: el => startStory(el.dataset.id),
  sq: el => { const q = +el.dataset.q, o = +el.dataset.o; if (ST.ans[q] != null) return; ST.ans[q] = o; const ok = o === ST.data.questions[q].answer; beep(ok); stat('rec', ok); if (ok) addXp(8); save(); render(); },
  addgl: () => {
    const gl = (ST.data.glossary || []).filter(g => g && g.de && g.en);
    gl.forEach(g => { const line = [g.de, g.en, g.ex || '', g.exEn || ''].map(s => String(s).replace(/\|/g, '/').replace(/\n/g, ' ')).join('|'); if (!S.my.some(l => l.split('|')[0] === line.split('|')[0])) S.my.push(line); });
    buildMyPack(); MYPACK.words.forEach(w => { if (!learned(w.id) && !S.soon.includes(w.id)) S.soon.push(w.id); });
    ST.added = true; save(); toast('Saved. They\'ll appear in your next sessions.'); render();
  },
  rq: el => {
    const r = READ.find(x => x.id === V.id), qi = +el.dataset.q, o = +el.dataset.o; if (V.ans[qi] != null) return;
    V.ans[qi] = o; const ok = o === r.q[qi][2]; beep(ok); stat('rec', ok); dayTouch(); const h = H(); h.a++; if (ok) { h.c++; addXp(8); }
    if (Object.keys(V.ans).length === r.q.length) { const sec = Math.min(Date.now() - V.t0, 12 * 60e3) / 1000; S.secs += sec; h.s += sec; S.read[r.id] = Math.max(S.read[r.id] || 0, r.q.filter((q, i) => V.ans[i] === q[2]).length); h.lr = 1; }
    save(); render();
  },
  readsave: el => {
    const r = READ.find(x => x.id === el.dataset.id);
    r.gl.forEach(g => { if (!S.my.some(l => l.split('|')[0] === g[0])) { const sent = r.text.split(/(?<=[.!?“])\s+/).find(s => s.includes(g[0].replace(/^(der|die|das) /, ''))) || ''; S.my.push([g[0], g[1], sent.replace(/\n/g, ' ').replace(/\|/g, '/'), ''].join('|')); } });
    buildMyPack(); MYPACK.words.forEach(w => { if (!learned(w.id) && !S.soon.includes(w.id)) S.soon.push(w.id); });
    save(); toast('Saved. They\'ll appear in your next sessions.'); render();
  },
  fixtap: el => { const e = R.q[R.i]; if (R.fb) return; const k = +el.dataset.k; grade(e.errs.includes(k), e.toks[k], { note: '' }); if (R.fb) { R.fb.tap = k; render(); } },
  tiredstop: () => { const h = H(); if (R.q[R.i].why === 'tired') h.tired = Date.now(); save(); finish(); },
  tiredgo: () => { R.fb = { ok: true }; next(); },
  drill: el => start('drill', { type: el.dataset.v || '' }),
  wtab: el => { V.tab = el.dataset.v; V.open = null; render(); },
  cfilt: el => { V.cf = el.dataset.v; render(); },
  csort: el => { V.cs = el.dataset.v; render(); },
  cards: () => { const f = V.cf || (collection('sure').length >= 15 ? 'sure' : 'all'); const ids = shuffle(collection(f)).map(w => w.id); go('cards', null, { k: { ids, i: 0, show: false }, back: { tab: 'mine', cf: V.cf, cs: V.cs } }); },
  cflip: () => { V.k.show = !V.k.show; if (V.k.show && S.set.autoplay) say(WMAP[V.k.ids[V.k.i]].ans); tick(); render(); },
  cnext: () => { const K = V.k; if (!K.show) { acts.cflip(); return; } if (K.i + 1 < K.ids.length) { K.i++; K.show = false; render(); } else acts.cardsclose(); },
  cprev: () => { const K = V.k; if (K.i) { K.i--; K.show = false; render(); } },
  cshuffle: () => { V.k.ids = shuffle(V.k.ids); V.k.i = 0; V.k.show = false; render(); },
  cardsclose: () => { tick(); save(); const b = V.back || {}; go('words', null, { tab: 'mine', cf: b.cf, cs: b.cs }); },
  cquiz: () => start('coll', { filter: V.cf || (collection('sure').length >= 15 ? 'sure' : 'all') }),
  wopen: el => { V.open = V.open === el.dataset.id ? null : el.dataset.id; render(); },
  wlvl: el => { V.lvl = el.dataset.v; render(); },
  soon: el => { const id = el.dataset.id; if (!S.soon.includes(id)) S.soon.unshift(id); S.soon = S.soon.slice(0, 40); save(); toast('It\'ll be taught in your next session.'); render(); },
  logout: el => { const m = +el.dataset.v; dayTouch(); S.outMin = (S.outMin || 0) + m; S.out[today()] = (S.out[today()] || 0) + m; save(); toast(`Logged ${m} minutes of German outside the app.`); render(); },
  set: el => { const k = el.dataset.k, v = el.dataset.v; S.set[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; save(); render(); if (k === 'voice' || k === 'rate') say('Hallo! So klinge ich.'); },
  pset: el => { S.prof[el.dataset.k] = +el.dataset.v; save(); render(); },
  export: async () => { const code = backupCode(); try { await navigator.clipboard.writeText(code); toast('Backup code copied.'); } catch (e) { const t = document.getElementById('imp'); t.value = code; t.select(); toast('Select and copy the code in the box.'); } },
  dl: async () => {
    if (DL) { try { await DL.save({ filename: 'wortwerk-backup-' + today() + '.json', data: JSON.stringify(S) }); toast('Backup saved.'); } catch (e) { toast(e && e.code === 'declined' ? 'Download cancelled.' : 'Download isn\'t available here. Use "Copy backup code" instead.'); } return; }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' })); a.download = 'wortwerk-backup-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { toast('Download isn\'t available here. Use the backup code.'); } },
  import: () => {
    const raw = document.getElementById('imp').value.trim(); if (!raw) return;
    try { let txt = raw; if (!raw.startsWith('{')) txt = decodeURIComponent(escape(atob(raw))); const m = migrate(JSON.parse(txt)); if (!m) throw 0; S = m; buildMyPack(); save(); if (cloudReady) push(); toast('Progress restored.'); go('home'); }
    catch (e) { toast('That backup code isn\'t valid. Copy the whole code and try again.'); }
  },
  confirm: () => { V.confirm = true; render(); }, unconfirm: () => { V.confirm = false; render(); },
  reset: () => { S = fresh(); buildMyPack(); save(); if (cloudReady) push(); go('onb', null, { step: 0 }); toast('Progress erased.'); }
};
function backupCode() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
function doCheck() {
  if (!R || R.fb) return;
  const e = R.q[R.i], x = e.x, el = document.getElementById('ans'), given = el ? el.value.trim() : '';
  let r;
  if (e.t === 'sBuild') { const s = e.pick.map(i => e.pool[i]).join(' '); return grade(s === x.de, s); }
  const anyOf = (list, g, fn) => { let best = null; for (const a of list) { const rr = (fn || checkSent)(a, g); if (rr && rr.ok) return rr; if (rr && rr.note && !best) best = rr; } return best || { ok: false }; };
  if (['wPlural', 'gConj', 'gCase', 'gAdj', 'gTrans'].includes(e.t) && !given) return;
  if (e.t === 'wPlural') r = anyOf(['die ' + x.pl], /^die /i.test(given) ? given : 'die ' + given, checkGram);
  else if (e.t === 'gConj') r = anyOf(e.ans, given.replace(/^(ich|du|er\/sie|er|sie|es|wir|ihr)\s+/i, ''), checkGram);
  else if (e.t === 'gCase' || e.t === 'gAdj') r = checkGram(e.ans[0], given.split(/\s+/)[0]);
  else if (e.t === 'gTrans') r = anyOf(e.ans, given);
  else if (e.t === 'wType' || e.t === 'wListen') r = checkWord(x, given);
  else if (e.t === 'wCloze') { r = checkClozeWord(e.cz.word, given); }
  else if (e.t === 'sCloze') { r = checkGram(x.ans, given); if (r && !r.ok) { const r2 = checkSent(x.de, given); if (r2 && r2.ok) r = r2; } }
  else if (e.t === 'sSpeak') { if (!given) { toast('Tap the mic and read the sentence.'); return; } const g = norm(given).split(' '), w = norm(x.de).split(' '); r = { ok: w.filter(t => g.includes(t)).length / w.length >= 0.7, q: 'good' }; }
  else r = checkSent(x.de, given);
  if (!r) return;
  grade(r.ok, given, r);
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = acts[el.dataset.act]; if (f) { ev.preventDefault(); f(el); }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'csearch') { V.cq = ev.target.value; const pos = ev.target.selectionStart; render(); const s2 = document.getElementById('csearch'); if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) {} } return; }
  if (EX && ev.target.id === 'exw') { EX.write = ev.target.value; const c = document.getElementById('wc'); if (c) c.textContent = (EX.write.trim().match(/\S+/g) || []).length + ' words'; return; }
  if (EX && /^exs[01]$/.test(ev.target.id)) { EX.speak[+ev.target.id.slice(3)] = ev.target.value; return; }
  if (ev.target.id === 'wsearch') { V.q = ev.target.value; V.open = null; const pos = ev.target.selectionStart; render(); const s = document.getElementById('wsearch'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} } }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'tdate') { const t = new Date(ev.target.value + 'T12:00').getTime(); if (t > Date.now()) { S.prof.target = t; save(); render(); toast('Target updated. Your daily plan adjusts automatically.'); } }
});
document.addEventListener('keydown', ev => {
  const inField = /^(INPUT|TEXTAREA)$/.test(ev.target.tagName);
  if (ev.key === 'Enter' && !ev.shiftKey) {
    if (V.name === 'ride' && R) {
      const e = R.q[R.i];
      if (R.fb) { ev.preventDefault(); next(); }
      else if (e.t === 'wIntro') { ev.preventDefault(); acts.introok(); }
      else if (e.t === 'lesson') { const b = app.querySelector('[data-act="lnext"]'); if (b && !b.disabled) { ev.preventDefault(); acts.lnext(); } }
      else if (!['wMc', 'wMcR', 'wArt', 'sMc', 'cMc'].includes(e.t)) { ev.preventDefault(); const b = app.querySelector('[data-act="check"]'); if (b && !b.disabled) doCheck(); }
    } else if (V.name === 'verb' && G && G.state === 'play') { ev.preventDefault(); if (G.fb) vnext(); else vcheck(); }
    else if (V.name === 'chat' && inField) { ev.preventDefault(); send(); }
    return;
  }
  if (inField) return;
  const n = '1234'.indexOf(ev.key);
  if (n > -1 && V.name === 'ride' && R && !R.fb) {
    const e = R.q[R.i]; const list = e.t === 'wArt' ? ['der', 'die', 'das'] : e.opts;
    if (list && list[n] != null && ['wMc', 'wMcR', 'wArt', 'sMc', 'cMc'].includes(e.t)) acts.mc({ dataset: { v: list[n] } });
  } else if (n > -1 && n < 3 && V.name === 'blitz') bans(['der', 'die', 'das'][n]);
});
buildMyPack();
window.addEventListener('pagehide', () => { if (FOCUS.includes(V.name)) { tick(); save(); } });
render();
initCloud();
if (!IN_CLAUDE && 'serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
