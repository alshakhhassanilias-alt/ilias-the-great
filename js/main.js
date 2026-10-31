import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { Tracker } from './tracker.js';
import { boardToImage, isConvexQuad, scaleH } from './homography.js';
import { occupancyOf } from './detect.js';
import { Overlay } from './overlay.js';
import { BoardView } from './boardview.js';
import { pieceIcon } from './pieces.js';

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`itg.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`itg.${key}`, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const CORNER_LABELS = ['a1', 'h1', 'h8', 'a8'];
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SIDE_NAMES = { w: 'White', b: 'Black' };
const SAMPLE_SIDE = 640;          // longest side of the frames we analyse
const SAMPLE_EVERY_MS = 150;       // at most this often; slower phones simply process fewer frames

const chess = new Chess();
const tracker = new Tracker(chess);

let engine = null;
let engineReady = false;
let mode = 'search';              // search: looking for the board | locked: found & followed | manual: corners tapped by hand
let corners = [];                 // a1, h1, h8, a8 corners, normalized to [0,1] image coords
let Hn = null;                    // board plane -> normalized image coords
let advice = null;                // latest engine result for the current position
let adviceSeq = 0;
let lastDiffs = null;
let stream = null;
let dragging = -1;
let side = null;                  // the side the user plays: 'w' | 'b' | 'turn' (both); asked once the board is found
let lastSpoken = '';
let lastShown = '';               // the move card's last contents, to animate only real changes

const video = $('video');
const view = $('view');
const overlay = new Overlay(view);
const boardView = new BoardView($('board'), {
  chess,
  onMove: (m) => { if (tryMove(m)) manualMoveDone(); },
});
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });
const debugOn = () => $('debugBox').checked;

// ---------------------------------------------------------------- board pose

function updateHomography() {
  Hn = null;
  if (corners.length === 4 && isConvexQuad(corners)) Hn = boardToImage(corners);
  // In pixels, so "up the picture" means the same as on screen.
  tracker.setView(Hn && scaleH(Hn, video.videoWidth || 1, video.videoHeight || 1));
  $('rotateBtn').disabled = !Hn;
  $('resyncBtn').disabled = !Hn;
}

function setCorners(next) {
  corners = next;
  updateHomography();
  drawSoon();
}

function startSearch(message) {
  mode = 'search';
  vision.postMessage({ type: 'reset' });
  setCorners([]);
  if (message) toast(message);
  renderAll();
}

function startManual() {
  mode = 'manual';
  vision.postMessage({ type: 'reset' });
  setCorners([]);
  tracker.resync();
  openSheet(false);
  renderAll();
}

function eventPoint(e) {
  const rect = view.getBoundingClientRect();
  return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
}

view.addEventListener('pointerdown', (e) => {
  if (!stream) return;
  const [x, y] = eventPoint(e);
  if (mode === 'manual' && corners.length < 4) {
    setCorners([...corners, [x, y]]);
    buzz(10);
    if (corners.length === 4) {
      vision.postMessage({ type: 'manual', corners: toPixels(corners) });
      tracker.resync();
      if (!side) askSide();
    }
    renderStatus();
    return;
  }
  if (!Hn) return;
  // Grab the nearest corner handle if the pointer is close to one (within ~28 CSS px).
  const rect = view.getBoundingClientRect();
  let best = -1, bestDist = 28;
  corners.forEach(([cx, cy], i) => {
    const dist = Math.hypot((cx - x) * rect.width, (cy - y) * rect.height);
    if (dist < bestDist) { best = i; bestDist = dist; }
  });
  if (best >= 0) {
    dragging = best;
    view.setPointerCapture(e.pointerId);
  }
});

view.addEventListener('pointermove', (e) => {
  if (dragging < 0) return;
  const [x, y] = eventPoint(e);
  const next = corners.slice();
  next[dragging] = [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
  setCorners(next);
});

const endDrag = () => {
  if (dragging < 0) return;
  dragging = -1;
  sendCorners();
  tracker.resync();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

$('findBtn').addEventListener('click', () => { startSearch(); openSheet(false); });
$('manualBtn').addEventListener('click', startManual);
$('rotateBtn').addEventListener('click', () => {
  setCorners([...corners.slice(1), corners[0]]);
  sendCorners();
  tracker.resync();
  renderAll();
});
$('resyncBtn').addEventListener('click', () => { tracker.resync(); toast('Re-syncing. Keep your hands off the board for a second.'); });

// --------------------------------------------------------------------- camera

async function startCamera(deviceId, { quiet = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setBanner('This browser can\'t reach the camera here. Open the page over https://.', true);
    return;
  }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    stream = null;
    $('camEmpty').hidden = false;
    if (!quiet) toast(`Camera blocked or unavailable (${err.name}). Allow camera access and try again.`);
    renderStatus();
    return;
  }
  $('camEmpty').hidden = true;
  keepAwake();
  startSearch();
  await listCameras(stream.getVideoTracks()[0].getSettings().deviceId);
}

async function listCameras(currentId) {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const select = $('cameraSelect');
  select.replaceChildren(...devices.map((d, i) => new Option(d.label || `Camera ${i + 1}`, d.deviceId, false, d.deviceId === currentId)));
  select.hidden = devices.length < 2;
}

$('startBtn').addEventListener('click', () => startCamera());
$('cameraSelect').addEventListener('change', (e) => startCamera(e.target.value));

// Keep the screen on while playing (the phone is usually propped up, untouched).
let wakeLock = null;
async function keepAwake() {
  if (!$('awakeBox').checked || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => { if (stream) keepAwake(); });
$('awakeBox').checked = store.get('awake', true);
$('awakeBox').addEventListener('change', () => {
  store.set('awake', $('awakeBox').checked);
  if ($('awakeBox').checked) keepAwake();
  else { wakeLock?.release().catch(() => {}); wakeLock = null; }
});

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ------------------------------------------------------------------- layout

const stage = $('stage');
const cam = $('cam');

// Size the camera box to the picture's shape, as large as fits; the overlay matches it.
function fitCam() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const box = stage.getBoundingClientRect();
  const pad = innerWidth >= 900 ? 48 : 0;
  const w = Math.max(1, Math.min(box.width - pad, ((box.height - pad) * vw) / vh));
  cam.style.width = `${w}px`;
  cam.style.height = `${(w * vh) / vw}px`;
  overlay.setSize(vw, vh, vw / w);
  drawSoon();
}
new ResizeObserver(fitCam).observe(stage);
video.addEventListener('loadedmetadata', () => { updateHomography(); fitCam(); });
video.addEventListener('resize', () => { updateHomography(); fitCam(); });

// The bottom sheet (phones): its top part always shows; drag or tap the handle for the rest.
const sheet = $('sheet');
const sheetHead = $('sheetHead');
let sheetOpen = false;
function setPeek() {
  document.documentElement.style.setProperty('--peek', `${sheetHead.offsetHeight}px`);
}
new ResizeObserver(setPeek).observe(sheetHead);

function openSheet(open) {
  sheetOpen = open;
  sheet.classList.toggle('open', open);
}

{
  let startY = 0, dy = 0, active = false;
  const grabber = $('grabber');
  grabber.addEventListener('pointerdown', (e) => {
    if (innerWidth >= 900) return;
    active = true;
    startY = e.clientY;
    dy = 0;
    grabber.setPointerCapture(e.pointerId);
    sheet.classList.add('dragging');
  });
  grabber.addEventListener('pointermove', (e) => {
    if (!active) return;
    dy = e.clientY - startY;
    const closedOffset = sheet.offsetHeight - sheetHead.offsetHeight;
    const base = sheetOpen ? 0 : closedOffset;
    sheet.style.transform = `translateY(${Math.min(Math.max(base + dy, 0), closedOffset)}px)`;
  });
  const end = () => {
    if (!active) return;
    active = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (Math.abs(dy) < 6) openSheet(!sheetOpen);
    else openSheet(dy < 0);
  };
  grabber.addEventListener('pointerup', end);
  grabber.addEventListener('pointercancel', end);
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t === tab));
    for (const pane of document.querySelectorAll('.pane')) pane.hidden = pane.dataset.pane !== tab.dataset.tab;
    openSheet(true);
  });
}

// ------------------------------------------------------------------- drawing

let drawPending = false;
function drawSoon() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    drawOverlay();
  });
}

function drawOverlay() {
  if (!video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  const best = visibleAdvice();
  const m = best && legalMove(best);
  overlay.render({
    H: Hn && scaleH(Hn, w, h),
    corners: corners.map(([x, y]) => [x * w, y * h]),
    handles: mode === 'manual' || debugOn(),
    last: chess.history({ verbose: true }).at(-1) ?? null,
    best: m ? { from: m.from, to: m.to, san: m.san, knight: m.piece === 'n' } : null,
    diffs: debugOn() ? lastDiffs : null,
  });
}

// ------------------------------------------------------------------- sampling

// The heavy lifting (finding and following the board, sampling the squares) runs in a
// worker. Only one frame is in flight at a time, so a slow phone processes fewer frames
// instead of falling behind, and the page itself stays smooth.
const vision = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
let visionBusy = false;
// How frames reach the worker, cheapest first: a VideoFrame (wraps the camera frame, no
// copy), an ImageBitmap, or plain pixels read here. Each falls back to the next if it fails.
let useVideoFrames = typeof VideoFrame === 'function' && typeof OffscreenCanvas !== 'undefined';
let useBitmaps = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
let poseLost = false;

function frameSize() {
  const scale = SAMPLE_SIDE / Math.max(video.videoWidth, video.videoHeight);
  return [Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale)];
}

function toPixels(pts) {
  const [w, h] = frameSize();
  return pts.map(([x, y]) => [x * w, y * h]);
}

function sendCorners() {
  if (corners.length === 4) vision.postMessage({ type: mode === 'manual' ? 'manual' : 'corners', corners: toPixels(corners) });
}

async function sendFrame() {
  const [width, height] = frameSize();
  const msg = { type: 'frame', width, height, expected: occupancyOf(chess.board()) };
  if (useVideoFrames) {
    try {
      msg.bitmap = new VideoFrame(video);
      vision.postMessage(msg, [msg.bitmap]);
      return;
    } catch {
      useVideoFrames = false;
      delete msg.bitmap;
    }
  }
  if (useBitmaps) {
    try {
      msg.bitmap = await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
      vision.postMessage(msg, [msg.bitmap]);
      return;
    } catch {
      useBitmaps = false;       // read the pixels here instead
      delete msg.bitmap;
    }
  }
  grab.width = width;
  grab.height = height;
  gctx.drawImage(video, 0, 0, width, height);
  msg.pixels = gctx.getImageData(0, 0, width, height).data.buffer;
  vision.postMessage(msg, [msg.pixels]);
}

setInterval(() => {
  if (visionBusy || !stream || video.readyState < 2 || !video.videoWidth || dragging >= 0) return;
  if (mode === 'manual' && corners.length < 4) return;
  visionBusy = true;
  sendFrame().catch(() => { visionBusy = false; });
}, SAMPLE_EVERY_MS);

let resultTimes = [];             // when recent vision results arrived, for the diagnostics line
vision.onmessage = ({ data }) => {
  visionBusy = false;
  const now = performance.now();
  resultTimes = [...resultTimes.filter((t) => now - t < 2000), now];
  if (data.type === 'error') {
    if (data.bitmap) { if (useVideoFrames) useVideoFrames = false; else useBitmaps = false; }
    console.warn('vision:', data.message);
    return;
  }
  onPose(data);
  if (!data.sig || !Hn || dragging >= 0) return;
  const result = tracker.feed(data.sig, data.prevSig);
  if (result.d) {
    lastDiffs = result.d;
    if (debugOn()) drawSoon();
  }
  onTrackerResult(result);
};
vision.onerror = (e) => {
  visionBusy = false;
  console.warn('vision worker:', e.message);
};

function onPose(data) {
  const was = mode;
  if (mode !== 'manual') mode = data.mode;
  const lostChanged = poseLost !== !!data.lost;
  poseLost = !!data.lost;
  if (data.corners) setCorners(data.corners.map(([x, y]) => [x / data.width, y / data.height]));
  else if (mode === 'search' && corners.length) setCorners([]);
  if (data.locked) {
    buzz(20);
    if (data.margin < 0.3) toast('Board found, but I\'m not sure which way round it is. If a1 is in the wrong corner, use Rotate in Settings.');
    else toast('Board found');
    if (!side) askSide();
  } else if (was === 'locked' && mode === 'search') {
    toast('Lost sight of the board. Looking for it again…');
  }
  if (mode !== was || data.locked) renderAll();
  else if (lostChanged) renderStatus();
}

let lastState = '';
function onTrackerResult(result) {
  if (result.state === 'move') {
    buzz(25);
    const what = result.replaced ? `Changed ${result.replaced.san} to ${result.move.san}` : `Saw ${result.move.san}`;
    toast(what, { promoted: result.move.promotion ? result.move : null, alternatives: result.alternatives });
    gameChanged({ resync: false });
  } else if (result.state === 'baseline') {
    toast('Board locked in. Play on!');
  }
  if (result.state !== lastState) {
    lastState = result.state;
    renderStatus();
  }
}

// ------------------------------------------------------------------ the side

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

for (const el of document.querySelectorAll('.side-icon')) el.innerHTML = pieceIcon('k', el.dataset.icon, 26);

function askSide() {
  const prompt = $('sidePrompt');
  // The player is usually sitting where the camera is, so guess the side nearest the bottom of the picture.
  const whiteY = (corners[0][1] + corners[1][1]) / 2, blackY = (corners[2][1] + corners[3][1]) / 2;
  const guess = whiteY > blackY ? 'w' : 'b';
  prompt.querySelectorAll('button[data-side]').forEach((b) => b.classList.toggle('guess', b.dataset.side === guess));
  prompt.hidden = false;
  listenForSide();
}

function listenForSide(attempt = 0) {
  if (!Recognition || attempt > 2) return;
  try {
    recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;
    recognition.onstart = () => { $('voiceHint').hidden = false; };
    recognition.onresult = (e) => {
      const heard = [...e.results[0]].map((a) => a.transcript.toLowerCase()).join(' ');
      if (/\bwhite\b/.test(heard)) chooseSide('w');
      else if (/\bblack\b/.test(heard)) chooseSide('b');
    };
    recognition.onend = () => { if (!$('sidePrompt').hidden) listenForSide(attempt + 1); };
    recognition.start();
  } catch { /* no microphone or not allowed without a tap: the buttons still work */ }
}

function chooseSide(next) {
  side = next;
  $('sidePrompt').hidden = true;
  try { recognition?.abort(); } catch { /* already stopped */ }
  recognition = null;
  lastSpoken = '';
  buzz(15);
  say(side === 'turn' ? 'Okay, I\'ll help both sides.' : `Okay, you're playing ${SIDE_NAMES[side]}.`);
  boardView.flipped = side === 'b';     // your side at the bottom
  renderAll();
}

$('sidePrompt').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-side]');
  if (button) chooseSide(button.dataset.side);
});
$('sideSeg').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-side]');
  if (button) chooseSide(button.dataset.side);
});

function say(text) {
  if (!$('speakBox').checked || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch { /* speech not available */ }
}

// ---------------------------------------------------------------------- UI

// The status pill (top) and the hint line (bottom of the camera picture).
function status() {
  const turn = SIDE_NAMES[chess.turn()];
  if (!stream) return { tone: 'idle', pill: 'Camera off', hint: 'Allow the camera to begin.' };
  if (mode === 'search') return { tone: 'search', live: true, pill: 'Finding board', hint: 'Get all 64 squares in view and hold still for a moment.' };
  if (mode === 'manual' && corners.length < 4) {
    return { tone: 'search', live: true, pill: 'Tap corners', hint: `Tap the board's ${CORNER_LABELS[corners.length]} corner${corners.length ? '' : ' (White\'s left-hand corner)'}. Order: a1, h1, h8, a8.` };
  }
  if (!Hn) return { tone: 'warn', pill: 'Check corners', hint: 'Those corners don\'t make a proper board. Find the board again in Settings.', warn: true };
  if (poseLost) return { tone: 'warn', live: true, pill: 'Board out of view', hint: 'Keep the whole board in the picture.', warn: true };
  if (chess.isGameOver()) return { tone: 'ok', pill: 'Game over', hint: gameOverText() };
  if (lastState === 'unmatched') {
    return { tone: 'warn', pill: 'Can\'t read move', hint: 'The board changed but no legal move fits. Put the pieces back, or use "Fix a move".', warn: true };
  }
  if (lastState === 'moving' || lastState === 'settling') {
    return { tone: 'busy', live: true, pill: 'Watching', hint: 'I read the move once hands are off the board.' };
  }
  const steady = `${turn} to move.`;
  if (!side || side === 'turn') return { tone: 'ok', pill: `${turn} to move`, hint: steady, quiet: true };
  return side === chess.turn()
    ? { tone: 'ok', live: true, pill: 'Your move', hint: steady, quiet: true }
    : { tone: 'wait', pill: 'Their move', hint: steady, quiet: true };
}

function setBanner(text, warn = false, quiet = false) {
  // With "Show detection" on, also say what the vision side is doing (helps when it misbehaves).
  if (debugOn()) {
    text += ` [${mode}${poseLost ? ', losing board' : ''} · ${(resultTimes.length / 2).toFixed(1)} fps · ${lastState || '-'}]`;
    quiet = false;
  }
  const el = $('banner');
  el.textContent = text;
  el.classList.toggle('warn', warn);
  el.classList.toggle('quiet', quiet);
}

function renderStatus() {
  const s = status();
  const pill = $('pill');
  pill.className = `pill glass tone-${s.tone}${s.live ? ' live' : ''}`;
  $('pillText').textContent = s.pill;
  setBanner(s.hint, !!s.warn, !!s.quiet);
}

function gameOverText() {
  if (chess.isCheckmate()) return `Checkmate. ${SIDE_NAMES[chess.turn() === 'w' ? 'b' : 'w']} wins.`;
  if (chess.isStalemate()) return 'Draw by stalemate.';
  return 'Draw.';
}

let toastTimer = 0;
// options.promoted: a move that auto-promoted to a queen (offer the other pieces).
// options.alternatives: other moves the camera thought likely (offer them as fixes).
function toast(text, { promoted = null, alternatives = [] } = {}) {
  const el = $('toast');
  el.replaceChildren(text);
  const offer = (label, title, move) => {
    const button = document.createElement('button');
    button.className = 'chip';
    button.innerHTML = label;
    button.title = title;
    button.addEventListener('click', () => {
      chess.undo();
      chess.move(move);
      el.hidden = true;
      gameChanged({ resync: false });     // the camera already sees this position
      toast(`Fixed: ${chess.history().at(-1)}`);
    });
    el.append(button);
  };
  if (promoted) {
    el.append(' · promote to:');
    for (const piece of ['r', 'b', 'n']) offer(pieceIcon(piece, promoted.color, 18), PIECE_NAMES[piece], { from: promoted.from, to: promoted.to, promotion: piece });
  }
  if (alternatives.length) {
    el.append(' · not right?');
    for (const m of alternatives) offer(m.san, `It was ${m.san}`, { from: m.from, to: m.to, promotion: m.promotion });
  }
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, promoted || alternatives.length ? 9000 : 2600);
}

function renderMoves() {
  const list = $('moves');
  const history = chess.history();
  if (!history.length) {
    list.innerHTML = '<li><span class="empty">No moves yet. Play on the real board and they show up here.</span></li>';
    return;
  }
  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    const cls = (k) => `m${k === history.length - 1 ? ' latest' : ''}`;
    rows.push(`<li><span class="n">${i / 2 + 1}.</span><span class="${cls(i)}">${history[i]}</span><span class="${cls(i + 1)}">${history[i + 1] ?? ''}</span></li>`);
  }
  list.innerHTML = rows.join('');
}

// The engine's move, if we should be showing it right now.
function visibleAdvice() {
  if (!advice?.bestmove || chess.isGameOver()) return null;
  const mine = side ?? 'turn';
  if (mine !== 'turn' && mine !== chess.turn()) return null;
  return {
    from: advice.bestmove.slice(0, 2),
    to: advice.bestmove.slice(2, 4),
    promotion: advice.bestmove[4],
  };
}

function legalMove(best) {
  return chess.moves({ verbose: true }).find(
    (x) => x.from === best.from && x.to === best.to && (x.promotion ?? undefined) === best.promotion,
  );
}

function describeMove(m) {
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rook = m.flags.includes('k') ? ['h' + m.from[1], 'f' + m.from[1]] : ['a' + m.from[1], 'd' + m.from[1]];
    return `Castle: king ${m.from} → ${m.to}, rook ${rook[0]} → ${rook[1]}`;
  }
  let text = `${PIECE_NAMES[m.piece][0].toUpperCase()}${PIECE_NAMES[m.piece].slice(1)} ${m.from} → ${m.to}`;
  if (m.flags.includes('e')) text += ', takes en passant';
  else if (m.captured) text += `, takes ${PIECE_NAMES[m.captured]}`;
  if (m.promotion) text += `, becomes a ${PIECE_NAMES[m.promotion]}`;
  if (m.san.endsWith('#')) text += ' · checkmate!';
  else if (m.san.endsWith('+')) text += ' · check';
  return text;
}

function spokenMove(m) {
  if (m.flags.includes('k')) return 'Castle kingside.';
  if (m.flags.includes('q')) return 'Castle queenside.';
  let text = `${PIECE_NAMES[m.piece]}, ${m.from} to ${m.to}`;
  if (m.captured) text += `, taking the ${PIECE_NAMES[m.captured]}`;
  if (m.promotion) text += `, promote to ${PIECE_NAMES[m.promotion]}`;
  if (m.san.endsWith('#')) text += '. Checkmate!';
  else if (m.san.endsWith('+')) text += ', check';
  return text;
}

// The big card: the move to play (or what we're waiting for), and the evaluation bar.
function renderMoveCard() {
  const card = $('moveCard');
  let kicker, main, detail, icon = '', mine = false, thinking = false, waiting = false;
  const best = visibleAdvice();
  const m = best && legalMove(best);
  if (chess.isGameOver()) {
    kicker = 'Game over'; main = gameOverText(); detail = 'Start a new game from the Coach tab.';
  } else if (!engineReady) {
    kicker = 'Starting'; main = 'Loading the engine…'; detail = ''; thinking = true;
  } else if (m) {
    mine = !!side && side !== 'turn';
    kicker = mine ? 'Your best move' : `Best move for ${SIDE_NAMES[m.color]}`;
    main = m.san;
    detail = describeMove(m);
    icon = pieceIcon(m.piece, m.color, 50);
    if (mine && advice.bestmove !== lastSpoken) {
      lastSpoken = advice.bestmove;
      say(spokenMove(m));
      buzz([15, 60, 15]);
    }
  } else if (advice) {
    kicker = 'Waiting'; main = `${SIDE_NAMES[chess.turn()]} to move`; detail = 'I\'ll show your reply as soon as they move.'; waiting = true;
  } else {
    kicker = 'Thinking'; main = 'Thinking…'; detail = ''; thinking = true;
  }

  const key = `${kicker}|${main}|${detail}`;
  if (key !== lastShown) {
    $('moveKicker').textContent = kicker;
    $('adviceText').textContent = main;
    $('moveDetail').textContent = detail;
    $('movePiece').innerHTML = icon;
    $('movePiece').classList.toggle('waiting', waiting || thinking);
    card.classList.toggle('mine', mine);
    card.classList.toggle('thinking', thinking && engineReady);
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    lastShown = key;
  }

  // evaluation: White's share of the bar, from the engine score (or the mate)
  let share = 0.5, label = '';
  if (advice?.mate != null) {
    share = advice.mate > 0 ? 1 : 0;
    label = `M${Math.abs(advice.mate)}`;
  } else if (advice?.cp != null) {
    share = 1 / (1 + Math.pow(10, -advice.cp / 400));
    label = `${advice.cp >= 0 ? '+' : ''}${(advice.cp / 100).toFixed(1)}`;
  }
  $('evalFill').style.width = `${(share * 100).toFixed(1)}%`;
  $('evalText').textContent = label;
}

function renderBoard() {
  const best = visibleAdvice();
  const m = best && legalMove(best);
  boardView.render({ best: m ? { from: m.from, to: m.to, knight: m.piece === 'n' } : null });
}

function renderSettings() {
  for (const b of $('sideSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.side === (side ?? 'turn')));
  $('soundBtn').setAttribute('aria-pressed', String($('speakBox').checked));
}

function renderAll() {
  drawSoon();
  renderMoveCard();
  renderBoard();
  renderMoves();
  renderStatus();
  renderSettings();
}

// ------------------------------------------------------------------- engine

async function refreshAdvice() {
  if (!engineReady || chess.isGameOver()) return;
  const seq = ++adviceSeq;
  const result = await engine.analyse(chess.fen(), +$('timeRange').value);
  if (!result || seq !== adviceSeq) return;
  advice = result;
  renderAll();
}

function gameChanged({ resync }) {
  if (resync) tracker.resync();
  advice = null;
  renderAll();
  refreshAdvice();
}

async function startEngine() {
  try {
    engine = new Engine('vendor/stockfish-17.1-lite-single-03e3232.js');
    await engine.init();
    engine.setSkill(+$('skillRange').value);
    engineReady = true;
    renderAll();
    refreshAdvice();
  } catch (err) {
    $('adviceText').textContent = 'The chess engine failed to load.';
    console.error(err);
  }
}

// --------------------------------------------------------- manual corrections

function tryMove(input) {
  try { return chess.move(input); } catch { return null; }
}

function manualMoveDone() {
  gameChanged({ resync: true });
  toast('Move played. Make sure the real board matches.');
}

$('fixBtn').addEventListener('click', () => {
  const form = $('moveForm');
  form.hidden = !form.hidden;
  if (!form.hidden) { openSheet(true); $('moveInput').focus(); }
});

$('moveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('moveInput');
  const text = input.value.trim();
  if (!text) return;
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(text);
  const move = uci ? tryMove({ from: uci[1], to: uci[2], promotion: uci[3] ?? 'q' }) : tryMove(text);
  if (!move) return toast(`"${text}" isn't a legal move here.`);
  input.value = '';
  $('moveForm').hidden = true;
  manualMoveDone();
});

$('fenForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fen = $('fenInput').value.trim();
  if (!fen) return;
  try {
    chess.load(fen);
  } catch {
    return toast('That FEN doesn\'t look valid.');
  }
  $('fenInput').value = '';
  gameChanged({ resync: true });
});

$('undoBtn').addEventListener('click', () => {
  if (chess.undo()) gameChanged({ resync: true });
});

$('resetBtn').addEventListener('click', () => {
  chess.reset();
  gameChanged({ resync: true });
  toast('New game');
});

$('flipBtn').addEventListener('click', () => boardView.flip());

// ------------------------------------------------------------------ settings

function bindRange(id, outId, key, format, apply) {
  const input = $(id);
  input.value = store.get(key, input.value);
  const show = () => { $(outId).textContent = format(+input.value); };
  show();
  input.addEventListener('input', show);
  input.addEventListener('change', () => { store.set(key, +input.value); apply(+input.value); });
  apply(+input.value);
}

const sensitivityToMinChange = (s) => 0.13 * Math.pow(0.85, s - 1);

bindRange('skillRange', 'skillOut', 'skill', (v) => (v === 20 ? 'Max' : `${v} / 20`), (v) => {
  if (engineReady) { engine.setSkill(v); refreshAdvice(); }
});
bindRange('timeRange', 'timeOut', 'time', (v) => `${(v / 1000).toFixed(1)} s`, () => {});
bindRange('sensRange', 'sensOut', 'sens', (v) => `${v} / 9`, (v) => {
  tracker.params.minChange = sensitivityToMinChange(v);
});

$('speakBox').checked = store.get('speak', true);
$('speakBox').addEventListener('change', () => { store.set('speak', $('speakBox').checked); renderSettings(); });
$('soundBtn').addEventListener('click', () => {
  $('speakBox').checked = !$('speakBox').checked;
  store.set('speak', $('speakBox').checked);
  if (!$('speakBox').checked) speechSynthesis?.cancel();
  renderSettings();
});

$('debugBox').addEventListener('change', () => { drawSoon(); renderStatus(); });
setInterval(() => { if (debugOn()) renderStatus(); }, 1000);

// --------------------------------------------------------------------- boot

updateHomography();
setPeek();
fitCam();
renderAll();
startEngine();
// Open the camera straight away, but only once the page has loaded: a playing camera
// stream otherwise keeps the page "loading" forever (spinner never stops on phones).
if (document.readyState === 'complete') startCamera(undefined, { quiet: true });
else window.addEventListener('load', () => startCamera(undefined, { quiet: true }), { once: true });
