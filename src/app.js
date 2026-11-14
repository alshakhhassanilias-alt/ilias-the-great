(() => {
'use strict';
const D = window.WW_DATA;
const app = document.getElementById('app'), nav = document.getElementById('nav');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 864e5, IV = [0, 1, 2, 4, 8, 16, 35, 75, 150], PLAN_DAYS = 336, KEY = 'wortwerk.v1';
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
const dstr = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => dstr(Date.now());
const midnight = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const norm = s => String(s).toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ICON = {
  spk: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>'
};

/* ---------- state ---------- */
const fresh = () => ({ v: 1, t: 0, start: null, cur: 0, xp: 0, streak: 0, lastDay: '', dayXp: 0, goal: 100, it: {}, extra: {}, hi: { blitz: 0, verb: 0 }, hist: {}, audio: true, sfx: true });
let S = fresh();
try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.v === 1) S = Object.assign(fresh(), r); } catch (e) {}
let cloudRef = null, cloudReady = false, cloudBusy = false, cloudDirty = false, cloudTimer = 0;
function save() {
  S.t = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  if (cloudReady) { clearTimeout(cloudTimer); cloudTimer = setTimeout(push, 2500); }
}
async function push() {
  if (!cloudRef) return;
  if (cloudBusy) { cloudDirty = true; return; }
  cloudBusy = true;
  try { await cloudRef.set({ json: JSON.stringify(S), t: S.t }); } catch (e) {}
  cloudBusy = false;
  if (cloudDirty) { cloudDirty = false; push(); }
}
const use = n => (window.claude && window.claude.use) ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
let AI = null, TTS = null, DICT = null, dictFor = '', aiCtl = null;
async function initCloud() {
  const [db, user] = await Promise.all([use('db'), use('user')]);
  if (!db || !user) return;
  try {
    const id = await user.id(); if (!id) return;
    cloudRef = db.collection('data/users/' + id).doc('state');
    const snap = await cloudRef.get();
    if (snap.exists) {
      const r = JSON.parse(snap.data().json);
      if (r && r.v === 1 && (r.t || 0) > (S.t || 0)) {
        S = Object.assign(fresh(), r);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
        if (!['ride', 'blitz', 'verb', 'chat'].includes(V.name)) render();
      }
    }
    cloudReady = true;
    if (S.t) push();
    if (V.name === 'me') render();
  } catch (e) {}
}
use('sample').then(s => { AI = s; if (s && ['home', 'tutor', 'station'].includes(V.name)) render(); });
use('tts').then(t => { TTS = t; });
use('dictation').then(d => {
  DICT = d; if (!d) return;
  d.onFinal(({ text }) => { const el = document.getElementById(dictFor); if (el) { el.value = (el.value + ' ' + text).trim(); el.dispatchEvent(new Event('input')); } });
  d.onState(({ state }) => document.querySelectorAll('.mic').forEach(b => b.classList.toggle('on', state === 'listening' || state === 'starting')));
  if (['chat', 'ride'].includes(V.name)) render();
});

/* ---------- audio ---------- */
let voice = null;
const pickVoice = () => { try { voice = speechSynthesis.getVoices().find(v => /^de/i.test(v.lang)) || null; } catch (e) {} };
if ('speechSynthesis' in window) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {} }
const canSpeak = () => !!TTS || 'speechSynthesis' in window;
function browserSay(text, slow) {
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = slow ? 0.65 : 0.95; if (voice) u.voice = voice; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function say(text, slow) {
  if (TTS) { TTS.speak(text, { language: 'de', rate: slow ? 0.75 : 1 }).catch(e => { if (e && ['rate_limited', 'unavailable', 'upstream_error', 'not_granted'].includes(e.code)) { if (e.code !== 'rate_limited') TTS = null; browserSay(text, slow); } }); return; }
  if ('speechSynthesis' in window) browserSay(text, slow);
}
let actx = null;
function beep(ok) {
  if (!S.sfx) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    (ok ? [660, 990] : [200]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.09;
      o.type = ok ? 'sine' : 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch (e) {}
}
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); }
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['--u1', '--u2', '--u3', '--u4', '--accent'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span'); s.className = 'cf';
    s.style.cssText = `background:var(${cols[i % 5]});--x:${(Math.random() - 0.5) * 520}px;--y:${(Math.random() - 0.3) * 520}px;--rt:${Math.random() * 720}deg`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 1050);
  }
}

/* ---------- course model ---------- */
const byId = id => D.stations.find(s => s.id === id);
function parse(raw, id, sid) {
  const cut = raw.lastIndexOf('|'); if (cut < 0) return null;
  const g = raw.slice(0, cut), en = raw.slice(cut + 1), m = g.match(/\{([^{}]+)\}/); if (!m) return null;
  const o = m[1].split('/').map(s => s.trim()).filter(Boolean); if (o.length < 2) return null;
  return { id, sid, en, ans: o[0], alts: o.slice(1), pre: g.slice(0, m.index), post: g.slice(m.index + m[0].length), de: g.replace(m[0], o[0]) };
}
function itemsOf(st) {
  const a = st.items.map((r, i) => parse(r, st.id + '.' + i, st.id));
  (S.extra[st.id] || []).forEach((r, i) => { const p = parse(r, st.id + '.x' + i, st.id); if (p) a.push(p); });
  return a.filter(Boolean);
}
const seen = x => !!S.it[x.id];
const stDone = st => itemsOf(st).every(seen);
const stSeen = st => itemsOf(st).filter(seen).length;
function curStation() {
  const n = D.stations.length;
  for (let k = 0; k < n; k++) { const st = D.stations[(S.cur + k) % n]; if (!stDone(st)) return st; }
  return null;
}
const lvlNow = () => (curStation() || D.stations[D.stations.length - 1]).lvl;
const allItems = () => D.stations.flatMap(itemsOf);
const dueItems = () => { const now = Date.now(); return allItems().filter(x => S.it[x.id] && S.it[x.id][1] <= now).sort((a, b) => S.it[a.id][1] - S.it[b.id][1]); };
const playerLvl = () => Math.floor(Math.sqrt(S.xp / 60)) + 1;
function streakNow() { return (S.lastDay === today() || S.lastDay === dstr(Date.now() - DAY)) ? S.streak : 0; }
function addXp(n) {
  const t = today();
  if (S.lastDay !== t) { S.streak = S.lastDay === dstr(Date.now() - DAY) ? S.streak + 1 : 1; S.lastDay = t; S.dayXp = 0; }
  if (!S.start) S.start = Date.now();
  S.xp += n; S.dayXp += n; S.hist[t] = S.dayXp;
  const ks = Object.keys(S.hist).sort(); while (ks.length > 60) delete S.hist[ks.shift()];
  save();
}
const dayXp = () => S.lastDay === today() ? S.dayXp : 0;

/* ---------- views ---------- */
let V = { name: 'home' }, R = null, G = null, C = null, ST = null;
function cleanup() {
  if (G && G.timer) clearInterval(G.timer);
  if (aiCtl) { aiCtl.abort(); aiCtl = null; }
  if (DICT && DICT.active()) DICT.stop().catch(() => {});
}
function go(name, id) { cleanup(); V = { name, id }; render(); window.scrollTo(0, 0); }
const NAV = [['home', 'Heute'], ['map', 'Strecke'], ['games', 'Spiele'], ['tutor', 'Tutor'], ['me', 'Ich']];
function render() {
  const fn = { home, map, station, ride, done, games, blitz, verb, tutor, chat, story, me }[V.name] || home;
  const focus = ['ride', 'done', 'blitz', 'verb', 'chat', 'story'].includes(V.name);
  app.className = 'wrap' + (focus ? ' focus' : '');
  app.innerHTML = fn();
  nav.hidden = focus;
  nav.innerHTML = '<div>' + NAV.map(([k, l]) => `<button class="${(V.name === k || (k === 'map' && V.name === 'station')) ? 'on' : ''}" data-act="go" data-v="${k}">${l}</button>`).join('') + '</div>';
  const f = app.querySelector('[data-focus]'); if (f) f.focus({ preventScroll: true });
}
const header = () => `<div class="top"><div class="mark"><i>W</i>ortwerk</div><span class="sp"></span>
  <span class="chip"><b>STREAK</b>${streakNow()}</span><span class="chip"><b>LVL</b>${playerLvl()}</span></div>`;
const spk = (text, cls) => canSpeak() ? `<button class="spk ${cls || ''}" data-act="say" data-t="${esc(text)}" aria-label="Listen">${ICON.spk}</button>` : '';

function home() {
  const st = curStation(), due = dueItems().length, news = st ? Math.min(5, itemsOf(st).filter(x => !seen(x)).length) : 0;
  const mins = Math.max(1, Math.ceil((Math.min(due, 12) * 22 + news * 55) / 60));
  const goalPct = Math.min(100, dayXp() / S.goal * 100);
  const doneN = D.stations.filter(stDone).length, total = D.stations.length;
  let board;
  if (!S.start && !S.xp) {
    board = `<div class="board"><span class="lab">Einsteigen bitte</span><h1>Where do you board?</h1>
      <p style="color:var(--board-mute)">${total} stations take you from A1 to B2. Every ride mixes new sentences with the ones you are about to forget, so nothing needs writing down.</p>
      <button class="btn pri wide" data-act="board" data-v="0">Start at A1 for a quick refresh</button>
      <button class="btn wide" style="background:transparent;color:var(--board-ink);border-color:var(--board-mute)" data-act="board" data-v="6">I know A1. Start at A2</button></div>`;
  } else if (!st && !due) {
    board = `<div class="board"><span class="lab">Endstation</span><h1>Every station is done.</h1><p style="color:var(--board-mute)">Nothing is due right now. Keep sharp with the tutor or add fresh sentences to any station.</p>
      <button class="btn pri wide" data-act="go" data-v="tutor">Open the tutor</button></div>`;
  } else {
    board = `<div class="board"><span class="lab">Nächste Abfahrt</span>
      <div class="dest">${st ? `<span class="roundel ${st.lvl}">${D.levels[st.lvl]}</span><h1>${esc(st.name)}</h1>` : '<h1>Wiederholung</h1>'}</div>
      <div class="brow"><span><b>${Math.min(due, 12)}</b> to review</span><span><b>${news}</b> new</span><span>about <b>${mins} min</b></span></div>
      <button class="btn pri wide" data-act="ride" data-focus>Losfahren</button></div>`;
  }
  const days = []; for (let i = 6; i >= 0; i--) { const d = Date.now() - i * DAY, x = S.hist[dstr(d)] || 0; days.push(`<span class="${i ? '' : 'now'}"><i class="${x >= S.goal ? 'hit' : x ? 'some' : ''}"></i>${'SMTWTFS'[new Date(d).getDay()]}</span>`); }
  let plan = '';
  if (S.start) {
    const el = (Date.now() - S.start) / DAY, base = S.planBase || 0, expect = Math.min(total, base + el / PLAN_DAYS * (total - base)), diff = doneN - expect;
    const status = diff >= 0.5 ? `${Math.floor(diff + 0.5)} ahead of schedule` : diff > -1 ? 'on schedule' : `${Math.ceil(-diff)} behind schedule`;
    const arr = new Date(S.start + PLAN_DAYS * DAY).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    plan = `<div class="row"><span class="lab">Fahrplan</span><span class="sp"></span><span class="small mute">Week ${Math.min(48, Math.floor(el / 7) + 1)} of 48</span></div>
      <div class="bar seg">${['A1', 'A2', 'B1', 'B2'].map(l => { const ss = D.stations.filter(s => s.lvl === l); return `<span class="${l}" style="flex:${ss.length}"><i style="width:${ss.filter(stDone).length / ss.length * 100}%"></i></span>`; }).join('')}</div>
      <div class="row small"><b>${doneN} of ${total} stations</b><span class="mute">${status}</span><span class="sp"></span><span class="mute">B2 arrival ${arr}</span></div>`;
  }
  return header() + board + `
  <div class="card"><div class="row"><span class="lab">Today</span><span class="sp"></span><span class="num small">${dayXp()} / ${S.goal} XP</span></div>
    <div class="bar"><i style="width:${goalPct}%"></i></div><div class="week">${days.join('')}</div></div>
  ${plan ? `<div class="card">${plan}</div>` : ''}
  <div class="tiles">
    <button class="tile" data-act="go" data-v="blitz"><b>Artikel-Blitz</b><span>der, die or das? 45 seconds.</span></button>
    <button class="tile" data-act="go" data-v="verb"><b>Verb-Sprint</b><span>Strong verbs, past forms.</span></button>
    <button class="tile" data-act="go" data-v="tutor"><b>Gespräch</b><span>${AI ? 'Talk it out with the tutor.' : 'Role-play with the AI tutor.'}</span></button>
    ${st ? `<button class="tile" data-act="go" data-v="station" data-id="${st.id}"><b>Grammatik</b><span>${esc(st.sub)}</span></button>` : ''}
  </div>`;
}

function map() {
  const cur = curStation();
  return header() + `<div><h1>Die Strecke</h1><p class="mute">Four lines, ${D.stations.length} stations. Board anywhere.</p></div>` +
    ['A1', 'A2', 'B1', 'B2'].map(l => `<div class="linehd"><span class="roundel ${l}">${D.levels[l]}</span><h2>${l}</h2></div>
      <div class="stops ${l}">${D.stations.filter(s => s.lvl === l).map(st => { const n = itemsOf(st).length, k = stSeen(st); return `<button class="stop ${k === n ? 'done' : ''} ${cur === st ? 'cur' : ''}" data-act="go" data-v="station" data-id="${st.id}">
        <span class="t"><b>${esc(st.name)}</b><span>${esc(st.sub)}</span></span><span class="num">${k}/${n}</span></button>`; }).join('')}</div>`).join('');
}

function station() {
  const st = byId(V.id) || D.stations[0], its = itemsOf(st), learned = its.filter(seen), left = its.length - learned.length;
  const gram = st.g.map(g => '<li>' + esc(g).replace(/\*([^*]+)\*/g, '<b>$1</b>') + '</li>').join('');
  return `<button class="back" data-act="go" data-v="map">← Strecke</button>
  <div class="row"><span class="roundel ${st.lvl}">${D.levels[st.lvl]}</span><span class="lab">Station ${String(D.stations.indexOf(st) + 1).padStart(2, '0')} of ${D.stations.length}</span></div>
  <div><h1>${esc(st.name)}</h1><p class="mute">${esc(st.sub)}</p></div>
  <div class="card gram"><span class="lab">The pattern</span><ul>${gram}</ul></div>
  <button class="btn pri wide" data-act="ride" data-id="${st.id}">${left ? `Learn ${Math.min(5, left)} new sentences` : 'Practise this station'}</button>
  <div class="row">${curStation() !== st && left ? `<button class="btn sm" data-act="setcur" data-id="${st.id}">Make this my next stop</button>` : ''}
    ${AI ? `<button class="btn sm" data-act="more" data-id="${st.id}" ${V.busy ? 'disabled' : ''}>${V.busy ? 'Writing sentences…' : 'Add 8 fresh sentences'}</button>
    <button class="btn sm" data-act="story" data-id="${st.id}">Read a story with this grammar</button>` : ''}</div>
  ${learned.length ? `<div class="card"><span class="lab">Your sentences · ${learned.length} of ${its.length}</span><div>${learned.map(x => `<div class="sent"><div>${esc(x.de)}<small>${esc(x.en)}</small>
    <span class="pips">${[1, 2, 3, 4, 5, 6].map(i => `<i class="${S.it[x.id][0] >= i ? 'f' : ''}"></i>`).join('')}</span></div>${spk(x.de)}</div>`).join('')}</div></div>` : ''}`;
}

/* ---------- ride (lesson session) ---------- */
function typeFor(stage) {
  let t = stage <= 1 ? 'cloze' : stage === 2 ? 'build' : stage === 3 ? 'listen' : stage === 4 ? 'write' : stage === 5 ? (DICT ? 'speak' : 'cloze') : (stage % 2 ? 'listen' : 'write');
  if (t === 'listen' && !canSpeak()) t = 'cloze';
  return t;
}
function prep(e) {
  const x = e.x;
  if (e.type === 'mc') e.opts = shuffle([x.ans, ...x.alts.slice(0, 2)]);
  if (e.type === 'build') { const tk = x.de.split(' '); e.pool = shuffle(tk.concat(x.alts.filter(a => !/\s/.test(a) && !tk.includes(a)).slice(0, 2))); e.pick = []; e.need = tk.length; }
  return e;
}
function startRide(sid) {
  let q = [];
  if (sid) {
    const st = byId(sid), its = itemsOf(st), news = its.filter(x => !seen(x)).slice(0, 5);
    if (news.length) q = news.map(x => ({ x, type: 'mc', isNew: true })).concat(news.map(x => ({ x, type: 'build', isNew: true, last: true })));
    else q = shuffle(its).slice(0, 8).map(x => ({ x, type: typeFor(Math.max(1, S.it[x.id][0])), free: true }));
  } else {
    const due = dueItems().slice(0, 12).map(x => ({ x, type: typeFor(S.it[x.id][0]) }));
    const st = curStation(), news = st ? itemsOf(st).filter(x => !seen(x)).slice(0, 5) : [];
    q = due.slice(0, 4).concat(news.map(x => ({ x, type: 'mc', isNew: true })), due.slice(4), news.map(x => ({ x, type: 'build', isNew: true, last: true })));
  }
  if (!q.length) { toast('Nothing to ride right now. Try a game or the tutor.'); return; }
  q.forEach(e => { e.first = true; prep(e); });
  R = { q, i: 0, combo: 0, xp: 0, ok: 0, miss: 0, learned: 0, fb: null, total: q.length };
  if (!S.start) { S.start = Date.now(); save(); }
  go('ride'); enterEx();
}
function enterEx() { const e = R.q[R.i]; if (e && e.type === 'listen') say(e.x.de); }
const UML = id => `<div class="uml">${['ä', 'ö', 'ü', 'ß'].map(c => `<button type="button" data-act="uml" data-c="${c}" data-for="${id}">${c}</button>`).join('')}
  ${DICT ? `<button type="button" class="mic" data-act="mic" data-for="${id}" aria-label="Dictate" style="width:44px">${ICON.mic}</button>` : ''}</div>`;
function ride() {
  const e = R.q[R.i], x = e.x, fb = R.fb, dis = fb ? 'disabled' : '';
  const label = { mc: 'Pick the missing word', build: 'Build the sentence', cloze: 'Type the missing word', listen: 'Type what you hear', write: 'Say it in German', speak: 'Read it aloud' }[e.type];
  let body = '';
  const gapS = `<p class="de">${esc(x.pre)}<span class="gap ${fb && !fb.ok ? 'bad' : ''}">${fb ? esc(x.ans) : '&nbsp;'}</span>${esc(x.post)}</p><p class="en">${esc(x.en)}</p>`;
  if (e.type === 'mc') body = gapS + `<div class="opts h">${e.opts.map((o, i) => `<button class="opt ${fb ? (o === x.ans ? 'ok' : o === fb.given ? 'no' : '') : ''}" data-act="mc" data-v="${esc(o)}" ${dis}><kbd>${i + 1}</kbd>${esc(o)}</button>`).join('')}</div>`;
  else if (e.type === 'cloze') body = gapS + `<input class="inp" id="ans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Missing word" ${dis} ${fb ? `value="${esc(fb.given)}"` : 'data-focus'}>` + (fb ? '' : UML('ans'));
  else if (e.type === 'build') body = `<p class="prompt">${esc(x.en)}</p><div class="slot">${e.pick.map((pi, k) => `<button class="tk" data-act="unpick" data-k="${k}" ${dis}>${esc(e.pool[pi])}</button>`).join('')}</div>
    <div class="pool">${e.pool.map((t, i) => `<button class="tk ${e.pick.includes(i) ? 'used' : ''}" data-act="pick" data-k="${i}" ${dis}>${esc(t)}</button>`).join('')}</div>`;
  else if (e.type === 'listen') body = `<div class="row"><button class="bigplay" data-act="say" data-t="${esc(x.de)}" aria-label="Play">${ICON.spk}</button><button class="btn sm" data-act="say" data-slow="1" data-t="${esc(x.de)}">Slower</button></div>
    <input class="inp" id="ans" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Was hörst du?" ${dis} ${fb ? `value="${esc(fb.given)}"` : 'data-focus'}>` + (fb ? '' : UML('ans'));
  else if (e.type === 'write') body = `<p class="prompt">${esc(x.en)}</p><textarea class="inp" id="ans" rows="2" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Auf Deutsch…" ${dis} ${fb ? '' : 'data-focus'}>${fb ? esc(fb.given) : ''}</textarea>` + (fb ? '' : UML('ans'));
  else body = `<p class="de">${esc(x.de)}</p><p class="en">${esc(x.en)}</p><div class="row">${spk(x.de)}<span class="small mute">Listen first, then tap the mic and say it.</span></div>
    <input class="inp" id="ans" autocomplete="off" placeholder="Your words appear here" ${dis} ${fb ? `value="${esc(fb.given)}"` : ''}>` + (fb ? '' : UML('ans'));
  let foot;
  if (!fb) foot = e.type === 'mc' ? '' : `<button class="btn pri wide" data-act="check" ${e.type === 'build' && e.pick.length < e.need ? 'disabled' : ''}>Check</button>${e.type === 'speak' ? '<button class="btn ghost wide" data-act="skip">I can\'t speak right now</button>' : ''}`;
  else foot = `<div class="fb ${fb.ok ? '' : 'no'}"><div class="row"><h3>${fb.ok ? esc(fb.word) : 'Not quite'}</h3><span class="sp"></span>${fb.xp ? `<span class="num small">+${fb.xp} XP</span>` : ''}${spk(x.de)}</div>
      <p class="ans">${esc(x.de)}</p><p class="small mute">${esc(x.en)}</p>
      ${fb.why ? `<div class="why">${esc(fb.why)}</div>` : ''}
      ${!fb.ok ? `<div class="row">${AI && !fb.why ? '<button class="btn sm" data-act="why">Why?</button>' : ''}${['write', 'speak', 'listen'].includes(e.type) && e.first ? '<button class="btn sm" data-act="override">Mine was right too</button>' : ''}</div>` : ''}
      <button class="btn pri wide" data-act="next" data-focus>Weiter</button></div>`;
  return `<div class="ridebar"><button class="x" data-act="quit" aria-label="End ride">✕</button><div class="bar"><i style="width:${R.i / R.q.length * 100}%"></i></div>${R.combo >= 3 ? `<span class="combo">${R.combo}× COMBO</span>` : ''}</div>
    <div class="ex"><span class="lab">${label}${e.isNew ? ' · new' : ''}</span>${body}${foot}</div>`;
}
function check() {
  if (R.fb) return;
  const e = R.q[R.i], x = e.x, el = document.getElementById('ans'), given = el ? el.value.trim() : '';
  let ok;
  if (e.type === 'cloze') { if (!given) return; ok = norm(given) === norm(x.ans) || norm(given) === norm(x.de); }
  else if (e.type === 'build') { const s = e.pick.map(i => e.pool[i]).join(' '); ok = s === x.de; grade(ok, s); return; }
  else if (e.type === 'speak') { if (!given) { toast('Tap the mic and read the sentence.'); return; } const g = norm(given).split(' '), w = norm(x.de).split(' '); ok = w.filter(t => g.includes(t)).length / w.length >= 0.7; }
  else { if (!given) return; ok = norm(given) === norm(x.de); }
  grade(ok, given);
}
function grade(ok, given) {
  const e = R.q[R.i], x = e.x; let xp = 0;
  if (DICT && DICT.active()) DICT.stop().catch(() => {});
  e.prev = S.it[x.id] ? S.it[x.id].slice() : null;
  if (ok) { R.combo++; if (e.first) R.ok++; xp = e.free ? 5 : e.first ? Math.round(10 * (R.combo >= 10 ? 2 : R.combo >= 5 ? 1.5 : 1)) : 4; }
  else { R.combo = 0; if (e.first) R.miss++; }
  if (!e.free) {
    if (e.isNew) { if (ok && e.last) { S.it[x.id] = [1, midnight() + DAY]; R.learned++; } }
    else if (e.first) {
      const st = S.it[x.id][0];
      S.it[x.id] = ok ? [Math.min(8, st + 1), midnight() + IV[Math.min(8, st + 1)] * DAY] : [Math.max(1, st - 1), Date.now()];
    }
  }
  if (!ok) { e.re = prep(Object.assign({}, e, { first: false })); R.q.splice(Math.min(R.q.length, R.i + 3), 0, e.re); }
  if (xp) { R.xp += xp; addXp(xp); } else save();
  beep(ok);
  R.fb = { ok, given, xp, word: pick(['Richtig!', 'Genau!', 'Stark!', 'Sauber!', 'Läuft!', 'Top!']) };
  render();
  if (S.audio && e.type !== 'speak') say(x.de);
}
function nextEx() {
  if (!R || !R.fb) return;
  R.fb = null; R.i++;
  if (R.i >= R.q.length) { addXp(20); R.xp += 20; beep(true); go('done'); confetti(); return; }
  render(); enterEx(); window.scrollTo(0, 0);
}
function done() {
  const acc = R.ok + R.miss ? Math.round(R.ok / (R.ok + R.miss) * 100) : 100, more = dueItems().length || (curStation() ? 1 : 0);
  return `<div class="ex center" style="padding-top:40px"><span class="lab">Fahrt beendet</span><div class="hero-n">+${R.xp} XP</div>
    <div class="stats" style="width:100%"><div class="stat"><b>${acc}%</b><span>first-try accuracy</span></div><div class="stat"><b>${R.learned}</b><span>new sentences</span></div><div class="stat"><b>${streakNow()}</b><span>day streak</span></div></div>
    <p class="mute">${dayXp() >= S.goal ? 'Daily goal reached. Anything more is a bonus.' : `${S.goal - dayXp()} XP to go for today's goal.`}</p>
    ${more ? '<button class="btn pri wide" data-act="ride" data-focus>Noch eine Fahrt</button>' : ''}
    <div class="row" style="width:100%"><button class="btn" style="flex:1" data-act="go" data-v="blitz">Artikel-Blitz</button><button class="btn" style="flex:1" data-act="go" data-v="home">Home</button></div></div>`;
}

/* ---------- games ---------- */
const NOUNS = ['r', 'e', 's'].flatMap(g => D.nouns[g].split(',').map(s => { const i = s.indexOf(' '); return { g, de: s.slice(0, i), en: s.slice(i + 1) }; }));
const VERBS = D.verbs.split(';').map(s => { const [inf, pr, pf, en] = s.split('|'); return { inf, pr, pf, en }; });
const ART = { r: 'der', e: 'die', s: 'das' };
function tip(n) {
  if (/(ung|heit|keit|schaft|ion|tät)$/.test(n.de)) return 'Nouns ending in -' + n.de.match(/(ung|heit|keit|schaft|ion|tät)$/)[0] + ' are always die.';
  if (/(chen|lein)$/.test(n.de)) return 'Diminutives on -chen are always das.';
  if (/(tag|Sommer|Winter|Regen|Schnee|Wind)$/.test(n.de)) return 'Days, seasons and weather are mostly der.';
  return '';
}
function games() {
  return header() + `<div><h1>Spiele</h1><p class="mute">Two minutes each. They drill the things German never lets you guess.</p></div>
  <div class="tiles"><button class="tile" data-act="go" data-v="blitz"><b>Artikel-Blitz</b><span>der, die or das against the clock</span><span class="num">Best ${S.hi.blitz}</span></button>
  <button class="tile" data-act="go" data-v="verb"><b>Verb-Sprint</b><span>Type the past forms of 40 strong verbs</span><span class="num">Best ${S.hi.verb}/10</span></button></div>`;
}
function blitz() {
  if (!G || G.kind !== 'blitz') G = { kind: 'blitz', state: 'idle' };
  if (G.state === 'idle') return `<button class="back" data-act="go" data-v="games">← Spiele</button><div class="ex center" style="padding-top:30px"><h1>Artikel-Blitz</h1>
    <p class="mute">45 seconds. Tap the right article, or press 1, 2, 3.</p><p class="num">Best ${S.hi.blitz}</p><button class="btn pri wide" data-act="bstart" data-focus>Start</button></div>`;
  if (G.state === 'over') return `<div class="ex center" style="padding-top:40px"><span class="lab">Zeit um</span><div class="hero-n">${G.score}</div><p class="mute">${G.score >= S.hi.blitz && G.score ? 'New personal best.' : 'Best ' + S.hi.blitz}  ·  +${G.xp} XP</p>
    ${G.missed.length ? `<div class="card" style="width:100%;text-align:left"><span class="lab">Look at these again</span><div>${G.missed.map(n => `<div class="sent"><div><b class="${n.g}-c">${ART[n.g]}</b> ${esc(n.de)}<small>${esc(n.en)}</small></div></div>`).join('')}</div></div>` : ''}
    <button class="btn pri wide" data-act="bstart" data-focus>Nochmal</button><button class="btn wide" data-act="go" data-v="home">Home</button></div>`;
  const n = G.cur;
  return `<div class="ridebar"><button class="x" data-act="go" data-v="games" aria-label="Quit">✕</button><div class="bar"><i id="tbar" style="width:${G.left / 45 * 100}%"></i></div><span class="combo num">${G.score}</span></div>
    <div class="ex center" style="padding-top:36px"><div class="noun">${esc(n.de)}</div><p class="en">${esc(n.en)}</p>
    <p class="flash ${G.flash ? G.flash.c : ''}">${G.flash ? esc(G.flash.t) : '&nbsp;'}</p>
    <div class="g3">${['r', 'e', 's'].map(g => `<button class="${g}" data-act="bans" data-v="${g}">${ART[g]}</button>`).join('')}</div></div>`;
}
function bstart() {
  if (G && G.timer) clearInterval(G.timer);
  G = { kind: 'blitz', state: 'play', score: 0, left: 45, deck: shuffle(NOUNS), missed: [], flash: null };
  G.cur = G.deck.pop();
  G.timer = setInterval(() => {
    G.left -= 0.1; const b = document.getElementById('tbar'); if (b) b.style.width = Math.max(0, G.left / 45 * 100) + '%';
    if (G.left <= 0) { clearInterval(G.timer); G.timer = 0; G.state = 'over'; G.xp = Math.min(60, G.score * 2); if (G.score > S.hi.blitz) { S.hi.blitz = G.score; confetti(); } if (G.xp) addXp(G.xp); else save(); render(); }
  }, 100);
  render();
}
function bans(g) {
  if (!G || G.state !== 'play') return;
  const n = G.cur, ok = g === n.g;
  if (ok) G.score++; else if (!G.missed.includes(n)) G.missed.push(n);
  G.flash = ok ? { c: 'ok', t: ART[n.g] + ' ' + n.de } : { c: 'no', t: (ART[n.g] + ' ' + n.de + '. ' + tip(n)).trim().replace(/\.$/, m => tip(n) ? m : '') };
  beep(ok); if (!G.deck.length) G.deck = shuffle(NOUNS); G.cur = G.deck.pop(); render();
}
function verb() {
  if (!G || G.kind !== 'verb') G = { kind: 'verb', state: 'idle' };
  if (G.state === 'idle') return `<button class="back" data-act="go" data-v="games">← Spiele</button><div class="ex center" style="padding-top:30px"><h1>Verb-Sprint</h1>
    <p class="mute">Ten strong verbs. Type the form for er/sie, for example <b>ging</b> or <b>ist gegangen</b>.</p><p class="num">Best ${S.hi.verb}/10</p><button class="btn pri wide" data-act="vstart" data-focus>Start</button></div>`;
  if (G.state === 'over') return `<div class="ex center" style="padding-top:40px"><span class="lab">Geschafft</span><div class="hero-n">${G.score}/10</div><p class="mute">+${G.score * 5} XP</p>
    <button class="btn pri wide" data-act="vstart" data-focus>Nochmal</button><button class="btn wide" data-act="go" data-v="home">Home</button></div>`;
  const q = G.qs[G.i], fb = G.fb;
  return `<div class="ridebar"><button class="x" data-act="go" data-v="games" aria-label="Quit">✕</button><div class="bar"><i style="width:${G.i * 10}%"></i></div><span class="combo num">${G.score}</span></div>
    <div class="ex"><span class="lab">${q.form === 'pr' ? 'Präteritum · er/sie' : 'Perfekt · er/sie'}</span><div class="noun">${esc(q.v.inf)}</div><p class="en">to ${esc(q.v.en)}</p>
    <input class="inp" id="ans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${q.form === 'pr' ? 'er …' : 'er hat / ist …'}" ${fb ? `disabled value="${esc(fb.given)}"` : 'data-focus'}>
    ${fb ? `<div class="fb ${fb.ok ? '' : 'no'}"><h3>${fb.ok ? 'Richtig!' : 'Not quite'}</h3><p class="ans">${esc(q.v.inf)} · ${esc(q.v.pr)} · ${esc(q.v.pf)}</p><button class="btn pri wide" data-act="vnext" data-focus>Weiter</button></div>` : UML('ans') + '<button class="btn pri wide" data-act="vcheck">Check</button>'}</div>`;
}
function vcheck() {
  const q = G.qs[G.i], given = document.getElementById('ans').value.trim(); if (!given || G.fb) return;
  const ok = norm(given) === norm(q.v[q.form]);
  if (ok) G.score++; beep(ok); G.fb = { ok, given }; render();
}
function vnext() {
  G.fb = null; G.i++;
  if (G.i >= 10) { G.state = 'over'; if (G.score > S.hi.verb) S.hi.verb = G.score; if (G.score) addXp(G.score * 5); else save(); if (G.score >= 8) confetti(); }
  render();
}

/* ---------- AI tutor ---------- */
const aiErr = e => ({ not_granted: 'The tutor is switched off for this page. Allow it in the page\'s Permissions menu.', rate_limited: 'Too many requests. Give it a moment and try again.', cancelled: '' }[e && e.code] ?? 'The tutor didn\'t answer. Try again.');
function tutor() {
  const L = lvlNow();
  return header() + `<div><h1>Tutor</h1><p class="mute">Real conversation at your level (${L}), with every message corrected.</p></div>` +
    (AI ? '' : '<div class="card"><b>The tutor needs Claude.</b><span class="mute small">Open Wortwerk from your Claude artifacts to chat, get stories and extra sentences. Lessons and games work everywhere.</span></div>') +
    `<div class="tiles">${D.scenes.map(s => `<button class="tile" data-act="chat" data-id="${s.id}" ${AI ? '' : 'disabled'}><b>${esc(s.t)}</b><span>${esc(s.en)}</span>${s.lvl ? `<span class="roundel ${s.lvl}" style="align-self:flex-start;margin-top:4px">${s.lvl}</span>` : ''}</button>`).join('')}</div>
    <button class="btn wide" data-act="story" ${AI ? '' : 'disabled'}>Write me a story to read</button>`;
}
function startChat(id) {
  const sc = D.scenes.find(s => s.id === id), L = sc.lvl && 'A1A2B1B2'.indexOf(sc.lvl) > 'A1A2B1B2'.indexOf(lvlNow()) ? sc.lvl : lvlNow();
  const rules = `You are part of a German learning app. ${sc.p}
Learner level: ${L} (CEFR). Stay strictly at that level in vocabulary and grammar.
Rules for EVERY reply:
1. Write your in-role reply ONLY in German, ${sc.write ? 'as described' : '1 to 3 short sentences, and end with a question or prompt that keeps the conversation going'}.
2. Then a line containing exactly ### and after it feedback in English on the learner's LAST message: ${sc.write ? 'list every mistake as "wrong → right (short reason)", then give the fully corrected text.' : 'if it had mistakes, give the corrected German sentence and a one-line reason; if it was correct write "Perfekt ✓" and, when useful, one more natural way to say it.'}
3. No markdown, no translations of your own reply.
Begin now with your first in-role line. For this first message leave out the ### part.`;
  C = { sc, turns: [{ role: 'user', content: rules }], busy: false, err: '' };
  go('chat'); ask();
}
async function ask() {
  C.busy = true; C.err = ''; render();
  aiCtl = new AbortController();
  try {
    const { text } = await AI(C.turns, { cache: false, signal: aiCtl.signal, onText: ({ text }) => { const el = document.getElementById('live'); if (el) el.textContent = text.split('###')[0].trim() || '…'; } });
    C.turns.push({ role: 'assistant', content: text });
    if (C.turns.length > 3) addXp(6);
  } catch (e) { C.err = aiErr(e); if (C.turns[C.turns.length - 1].role === 'user' && C.turns.length > 1) C.draft = C.turns.pop().content; }
  C.busy = false;
  if (V.name === 'chat') { render(); window.scrollTo(0, document.body.scrollHeight); }
}
function chat() {
  let h = '';
  C.turns.forEach((t, i) => {
    if (i === 0) return;
    if (t.role === 'user') h += `<div class="msg me">${esc(t.content)}</div>`;
    else { const [de, note] = t.content.split('###'); if (note && note.trim()) h += `<div class="note">${esc(note.trim())}</div>`; h += `<div class="msg them">${esc(de.trim())}</div><div class="msgact">${spk(de.trim())}${t.tr ? '' : `<button class="btn sm" data-act="tr" data-i="${i}">Translate</button>`}</div>${t.tr ? `<div class="small mute">${esc(t.tr)}</div>` : ''}`; }
  });
  if (C.busy) h += '<div class="msg them" id="live">…</div>';
  return `<div class="ridebar"><button class="x" data-act="go" data-v="tutor" aria-label="Leave">✕</button><div><b>${esc(C.sc.t)}</b><div class="small mute">${esc(C.sc.en)}</div></div></div>
    <div class="msgs">${h}</div>${C.err ? `<p class="small" style="color:var(--bad)">${esc(C.err)}</p>` : ''}
    <div class="send"><textarea class="inp" id="msg" rows="2" placeholder="Schreib auf Deutsch…" ${C.busy ? 'disabled' : 'data-focus'}>${esc(C.draft || '')}</textarea>
    <div class="row">${UML('msg')}<span class="sp"></span><button class="btn pri" data-act="send" ${C.busy ? 'disabled' : ''}>Senden</button></div></div>`;
}
function send() {
  const el = document.getElementById('msg'), v = el.value.trim(); if (!v || C.busy) return;
  if (DICT && DICT.active()) DICT.stop().catch(() => {});
  C.draft = ''; C.turns.push({ role: 'user', content: v }); ask();
}
async function translate(i) {
  const t = C.turns[i]; if (!t || t.tr) return; t.tr = '…'; render();
  try { t.tr = (await AI('Translate this German into natural English. Output only the translation.\n\n' + t.content.split('###')[0], { modelTier: 'quick' })).text.trim(); } catch (e) { t.tr = ''; toast(aiErr(e)); }
  if (V.name === 'chat') render();
}
async function why() {
  const e = R.q[R.i], fb = R.fb; if (!fb || fb.why) return; fb.why = 'Thinking…'; render();
  try {
    fb.why = (await AI(`A German learner (level ${byId(e.x.sid).lvl}) got an exercise wrong.\nCorrect sentence: ${e.x.de}\nMeaning: ${e.x.en}\nTested word: ${e.x.ans}\nLearner's answer: ${fb.given || '(blank)'}\nExplain in at most 2 short English sentences why the correct version is right and what rule the learner should remember. Plain text, no markdown.`, { modelTier: 'quick' })).text.trim();
  } catch (err) { fb.why = ''; toast(aiErr(err)); }
  if (V.name === 'ride' && R.fb === fb) render();
}
async function more(sid) {
  const st = byId(sid); if (V.busy) return; V.busy = true; render();
  try {
    const have = itemsOf(st).map(x => x.de);
    const out = await AI.json(`Create 8 new practice sentences for a German course.
Level: ${st.lvl}. Grammar focus: ${st.name} (${st.sub}).
Rules of this unit:\n- ${st.g.join('\n- ').replace(/\*/g, '')}
Return ONLY a JSON array of 8 objects {"de": string, "en": string}.
In "de", wrap exactly ONE word (the one that tests the grammar focus) in braces together with two wrong alternatives, correct one first: {right/wrong1/wrong2}. The wrong alternatives must be clearly, unambiguously incorrect in that sentence. Natural everyday sentences, 5 to 12 words, vocabulary suitable for ${st.lvl}, each on a different topic. No pipe characters.
Examples of the format:\n${st.items.slice(0, 2).map(r => { const c = r.lastIndexOf('|'); return JSON.stringify({ de: r.slice(0, c), en: r.slice(c + 1) }); }).join('\n')}
Do not repeat these sentences:\n${have.join('\n')}`);
    const good = (Array.isArray(out) ? out : []).filter(o => o && typeof o.de === 'string' && typeof o.en === 'string' && !/\|/.test(o.de + o.en)).map(o => o.de.trim() + '|' + o.en.trim()).filter(r => { const p = parse(r, 'x', sid); return p && !have.includes(p.de); });
    if (!good.length) throw { code: 'empty' };
    S.extra[sid] = (S.extra[sid] || []).concat(good).slice(0, 48); save(); toast(good.length + ' new sentences added to this station.');
  } catch (e) { toast(aiErr(e)); }
  if (V.name === 'station') { V.busy = false; render(); }
}
async function startStory(sid) {
  const st = sid ? byId(sid) : (curStation() || D.stations[D.stations.length - 1]), L = st.lvl, words = { A1: 90, A2: 130, B1: 180, B2: 240 }[L];
  ST = { st, busy: true, data: null, err: '', ans: {} }; go('story');
  aiCtl = new AbortController();
  try {
    const d = await AI.json(`Write an engaging short story in German for a learner at CEFR level ${L}, about ${words} words, with a small twist or joke at the end. Use the grammar "${st.name} (${st.sub})" several times, naturally. Seed for variety: ${Math.random().toString(36).slice(2, 7)}.
Return ONLY JSON: {"title": string, "text": string (paragraphs separated by \\n\\n), "glossary": [6 objects {"de","en"} for the hardest words], "questions": [3 objects {"q": question in German, "options": [3 short German answers], "answer": index of the correct option}]}`, { signal: aiCtl.signal, cache: false });
    if (!d || !d.text || !Array.isArray(d.questions)) throw { code: 'empty' };
    ST.data = d;
  } catch (e) { ST.err = aiErr(e) || 'Stopped.'; }
  ST.busy = false; if (V.name === 'story') render();
}
function story() {
  const back = '<button class="back" data-act="go" data-v="tutor">← Tutor</button>';
  if (ST.busy) return back + `<div class="ex center" style="padding-top:60px"><div class="spin"></div><p class="mute">Writing a ${ST.st.lvl} story around “${esc(ST.st.name)}”. This takes up to a minute.</p></div>`;
  if (ST.err) return back + `<div class="card"><b>${esc(ST.err)}</b><button class="btn" data-act="story" data-id="${ST.st.id}">Try again</button></div>`;
  const d = ST.data, paras = String(d.text).split(/\n\n+/);
  return back + `<span class="lab">${ST.st.lvl} · Lesestück</span><h1>${esc(d.title)}</h1>
    ${paras.map(p => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><p class="story" style="flex:1;min-width:0">${esc(p)}</p>${spk(p)}</div>`).join('')}
    ${Array.isArray(d.glossary) ? `<div class="gloss">${d.glossary.map(g => `<span><b>${esc(g.de)}</b> ${esc(g.en)}</span>`).join('')}</div>` : ''}
    ${d.questions.slice(0, 3).map((q, qi) => `<div class="card"><b>${esc(q.q)}</b><div class="opts">${(q.options || []).map((o, oi) => { const a = ST.ans[qi]; return `<button class="opt ${a != null ? (oi === q.answer ? 'ok' : oi === a ? 'no' : '') : ''}" data-act="sq" data-q="${qi}" data-o="${oi}" ${a != null ? 'disabled' : ''}>${esc(o)}</button>`; }).join('')}</div></div>`).join('')}
    <button class="btn pri wide" data-act="story" data-id="${ST.st.id}">Another story</button>`;
}

/* ---------- profile ---------- */
function me() {
  const its = allItems().filter(seen), strong = its.filter(x => S.it[x.id][0] >= 5).length;
  const bars = []; let mx = S.goal; for (let i = 13; i >= 0; i--) mx = Math.max(mx, S.hist[dstr(Date.now() - i * DAY)] || 0);
  for (let i = 13; i >= 0; i--) { const x = S.hist[dstr(Date.now() - i * DAY)] || 0; bars.push(`<i class="${x >= S.goal ? 'hit' : x ? 'some' : ''}" style="height:${Math.max(3, x / mx * 100)}%" title="${x} XP"></i>`); }
  const seg = (key, opts) => `<div class="seg-ctl">${opts.map(([v, l]) => `<button class="${S[key] === v ? 'on' : ''}" data-act="set" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return header() + `<h1>Ich</h1>
  <div class="stats four"><div class="stat"><b>${S.xp}</b><span>total XP</span></div><div class="stat"><b>${its.length}</b><span>sentences learned</span></div><div class="stat"><b>${strong}</b><span>in long-term memory</span></div><div class="stat"><b>${D.stations.filter(stDone).length}/${D.stations.length}</b><span>stations</span></div></div>
  <div class="card"><span class="lab">Last 14 days</span><div class="chart">${bars.join('')}</div></div>
  <div class="card"><span class="lab">Settings</span>
    <div class="row"><span>Daily goal</span><span class="sp"></span>${seg('goal', [[60, '10 min'], [100, '20 min'], [160, '30 min']])}</div>
    <div class="row"><span>Read answers aloud</span><span class="sp"></span>${seg('audio', [[true, 'On'], [false, 'Off']])}</div>
    <div class="row"><span>Sound effects</span><span class="sp"></span>${seg('sfx', [[true, 'On'], [false, 'Off']])}</div>
    <p class="small mute">${cloudReady ? 'Progress is saved to your Claude account and follows you across devices.' : 'Progress is saved in this browser.'}</p></div>
  <div class="card"><span class="lab">Start over</span>${V.confirm ? `<p>This erases all XP, streaks and learned sentences.</p><div class="row"><button class="btn sm" style="color:var(--bad)" data-act="reset">Yes, erase everything</button><button class="btn sm" data-act="unconfirm">Keep my progress</button></div>` : '<button class="btn sm" data-act="confirm" style="align-self:flex-start">Reset progress</button>'}</div>`;
}

/* ---------- events ---------- */
const acts = {
  go: el => go(el.dataset.v, el.dataset.id),
  board: el => { S.cur = +el.dataset.v; S.planBase = S.cur; S.start = Date.now(); save(); startRide(); },
  ride: el => startRide(el.dataset.id),
  setcur: el => { S.cur = D.stations.indexOf(byId(el.dataset.id)); save(); toast('Route updated.'); render(); },
  say: el => say(el.dataset.t, !!el.dataset.slow),
  mc: el => grade(el.dataset.v === R.q[R.i].x.ans, el.dataset.v),
  pick: el => { const e = R.q[R.i]; e.pick.push(+el.dataset.k); render(); },
  unpick: el => { const e = R.q[R.i]; e.pick.splice(+el.dataset.k, 1); render(); },
  check, next: nextEx, why,
  skip: () => { R.fb = { ok: true, given: '', xp: 0, word: 'Skipped' }; render(); },
  override: () => {
    const e = R.q[R.i], x = e.x, i = R.q.indexOf(e.re); if (i > -1) R.q.splice(i, 1);
    if (!e.free && !e.isNew && e.prev) { const st = Math.min(8, e.prev[0] + 1); S.it[x.id] = [st, midnight() + IV[st] * DAY]; }
    if (e.isNew && e.last && !e.free) { S.it[x.id] = [1, midnight() + DAY]; R.learned++; }
    R.miss--; R.ok++; R.xp += 10; addXp(10); R.fb.ok = true; R.fb.xp = 10; R.fb.word = 'Counted'; render();
  },
  quit: () => go('home'),
  uml: el => { const t = document.getElementById(el.dataset.for); if (!t) return; const s = t.selectionStart ?? t.value.length, e2 = t.selectionEnd ?? s; t.value = t.value.slice(0, s) + el.dataset.c + t.value.slice(e2); t.focus(); t.setSelectionRange(s + 1, s + 1); },
  mic: el => {
    if (!DICT) return;
    if (DICT.active()) { DICT.stop().catch(() => {}); return; }
    dictFor = el.dataset.for;
    DICT.start({ language: 'de' }).catch(e => { if (e && e.code === 'unavailable') { DICT = null; render(); toast('Dictation isn\'t available here.'); } else if (e && e.code === 'not_granted') toast('Microphone access is off for this page.'); });
  },
  bstart, bans: el => bans(el.dataset.v), vstart: () => { G = { kind: 'verb', state: 'play', i: 0, score: 0, fb: null, qs: shuffle(VERBS).slice(0, 10).map(v => ({ v, form: Math.random() < 0.5 ? 'pr' : 'pf' })) }; render(); },
  vcheck, vnext,
  chat: el => startChat(el.dataset.id), send, tr: el => translate(+el.dataset.i),
  more: el => more(el.dataset.id), story: el => startStory(el.dataset.id),
  sq: el => { const q = +el.dataset.q, o = +el.dataset.o; if (ST.ans[q] != null) return; ST.ans[q] = o; const ok = o === ST.data.questions[q].answer; beep(ok); if (ok) addXp(8); render(); },
  set: el => { const k = el.dataset.k, v = el.dataset.v; S[k] = k === 'goal' ? +v : v === 'true'; save(); render(); },
  confirm: () => { V.confirm = true; render(); }, unconfirm: () => { V.confirm = false; render(); },
  reset: () => { S = fresh(); save(); if (cloudReady) push(); go('home'); toast('Progress erased.'); }
};
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = acts[el.dataset.act]; if (f) f(el);
});
document.addEventListener('keydown', ev => {
  const inField = /^(INPUT|TEXTAREA)$/.test(ev.target.tagName);
  if (ev.key === 'Enter' && !ev.shiftKey) {
    if (V.name === 'ride') { ev.preventDefault(); if (R.fb) nextEx(); else if (R.q[R.i].type !== 'mc') { const b = app.querySelector('[data-act="check"]'); if (b && !b.disabled) check(); } }
    else if (V.name === 'verb' && G && G.state === 'play') { ev.preventDefault(); if (G.fb) vnext(); else vcheck(); }
    else if (V.name === 'chat' && inField) { ev.preventDefault(); send(); }
    return;
  }
  if (inField) return;
  const n = '123'.indexOf(ev.key);
  if (n > -1) {
    if (V.name === 'ride' && !R.fb && R.q[R.i].type === 'mc') { const o = R.q[R.i].opts[n]; if (o) grade(o === R.q[R.i].x.ans, o); }
    else if (V.name === 'blitz') bans('res'[n]);
  }
});
render();
initCloud();
})();
