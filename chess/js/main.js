import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { Tracker } from './tracker.js';
import { applyH, boardToImage, isConvexQuad, scaleH } from './homography.js';
import { occupancyOf } from './detect.js';

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
const GLYPHS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
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
let flipped = false;
let selected = null;              // selected square on the digital board
let stream = null;
let dragging = -1;
let side = null;                  // the side the user plays: 'w' | 'b' | 'turn' (both); asked once the board is found
let lastSpoken = '';

// The camera picture is the <video> element itself (drawn by the browser, no copying);
// the grid and arrow go on a transparent canvas on top, redrawn only when they change.
const video = $('video');
const view = $('view');
const vctx = view.getContext('2d');
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });

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
    if (corners.length === 4) {
      vision.postMessage({ type: 'manual', corners: toPixels(corners) });
      tracker.resync();
      if (!side) askSide();
    }
    renderBanner();
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

$('findBtn').addEventListener('click', () => startSearch());
$('manualBtn').addEventListener('click', startManual);
$('rotateBtn').addEventListener('click', () => {
  setCorners([...corners.slice(1), corners[0]]);
  sendCorners();
  tracker.resync();
  renderAll();
});
$('resyncBtn').addEventListener('click', () => { tracker.resync(); toast('Re-syncing: keep your hands off the board for a second.'); });

// --------------------------------------------------------------------- camera

async function startCamera(deviceId, { quiet = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setBanner('This browser can\'t reach the camera here. Open the page over https:// or from localhost.', true);
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
    if (!quiet) setBanner(`Camera blocked or unavailable (${err.name}). Allow camera access and try again.`, true);
    $('startBtn').hidden = false;
    return;
  }
  $('startBtn').hidden = true;
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

// ------------------------------------------------------------------- drawing

const squarePoly = (H, f, r) => [[f, r], [f + 1, r], [f + 1, r + 1], [f, r + 1]].map(([x, y]) => applyH(H, x, y));
const squareFR = (name) => [name.charCodeAt(0) - 97, name.charCodeAt(1) - 49];

function fillPoly(ctx, pts, style) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}

function drawArrow(ctx, from, to, lw) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = lw * 4.5;
  const tip = to;
  const base = [tip[0] - ux * head, tip[1] - uy * head];
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(base[0], base[1]);
  };
  const headPath = () => {
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(base[0] - uy * head * 0.55, base[1] + ux * head * 0.55);
    ctx.lineTo(base[0] + uy * head * 0.55, base[1] - ux * head * 0.55);
    ctx.closePath();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.lineWidth = lw * 1.9;
  path(); ctx.stroke();
  headPath(); ctx.stroke();
  ctx.strokeStyle = '#4ade80';
  ctx.fillStyle = '#4ade80';
  ctx.lineWidth = lw;
  path(); ctx.stroke();
  headPath(); ctx.fill();
}

function drawOverlay(ctx, w, h) {
  const lw = Math.max(2, Math.max(w, h) / 320);
  const font = Math.round(lw * 6);
  ctx.font = `600 ${font}px system-ui, sans-serif`;

  corners.forEach(([nx, ny], i) => {
    const x = nx * w, y = ny * h;
    ctx.beginPath();
    ctx.arc(x, y, lw * 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeText(CORNER_LABELS[i], x + lw * 4, y - lw * 3);
    ctx.fillText(CORNER_LABELS[i], x + lw * 4, y - lw * 3);
  });

  if (!Hn) return;
  const H = scaleH(Hn, w, h);

  if ($('debugBox').checked && lastDiffs) {
    for (let s = 0; s < 64; s++) {
      const d = lastDiffs[s];
      if (d < 0.03) continue;
      fillPoly(ctx, squarePoly(H, s % 8, s >> 3), `rgba(239,68,68,${Math.min(0.6, d * 1.5)})`);
    }
  }

  const last = chess.history({ verbose: true }).at(-1);
  if (last) {
    for (const name of [last.from, last.to]) fillPoly(ctx, squarePoly(H, ...squareFR(name)), 'rgba(250,204,21,.22)');
  }

  ctx.lineWidth = Math.max(1, lw * 0.4);
  ctx.strokeStyle = 'rgba(255,255,255,.4)';
  for (let i = 0; i <= 8; i++) {
    for (const [a, b] of [[[i, 0], [i, 8]], [[0, i], [8, i]]]) {
      const p = applyH(H, ...a), q = applyH(H, ...b);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  }

  const best = visibleAdvice();
  if (best) {
    const [ff, fr] = squareFR(best.from);
    const [tf, tr] = squareFR(best.to);
    fillPoly(ctx, squarePoly(H, ff, fr), 'rgba(74,222,128,.28)');
    fillPoly(ctx, squarePoly(H, tf, tr), 'rgba(74,222,128,.5)');
    drawArrow(ctx, applyH(H, ff + 0.5, fr + 0.5), applyH(H, tf + 0.5, tr + 0.5), lw * 1.6);
  }
}

let drawPending = false;
function drawSoon() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    vctx.clearRect(0, 0, view.width, view.height);
    drawOverlay(vctx, view.width, view.height);
  });
}

// Match the overlay (and the box around both) to the camera picture's shape.
function fitView() {
  if (!video.videoWidth) return;
  view.width = video.videoWidth;
  view.height = video.videoHeight;
  const wrap = view.parentElement;
  wrap.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  wrap.style.maxWidth = `calc(78vh * ${video.videoWidth / video.videoHeight})`;
  updateHomography();
  drawSoon();
}
video.addEventListener('loadedmetadata', fitView);
video.addEventListener('resize', fitView);

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

vision.onmessage = ({ data }) => {
  visionBusy = false;
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
    if ($('debugBox').checked) drawSoon();
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
    if (data.margin < 0.3) toast('Board found, but I\'m not sure which way round it is. If a1 is in the wrong corner, tap Rotate.');
    else toast('Board found!');
    if (!side) askSide();
  } else if (was === 'locked' && mode === 'search') {
    toast('Lost sight of the board. Looking for it again…');
  }
  if (mode !== was || data.locked) renderAll();
  else if (lostChanged) renderBanner();
}

let lastState = '';
function onTrackerResult(result) {
  if (result.state === 'move') {
    const what = result.replaced ? `Changed ${result.replaced.san} to ${result.move.san}.` : `Saw ${result.move.san}.`;
    toast(what, { promoted: result.move.promotion ? result.move : null, alternatives: result.alternatives });
    gameChanged({ resync: false });
  } else if (result.state === 'baseline') {
    toast('Board locked in. Play on!');
  }
  if (result.state !== lastState) {
    lastState = result.state;
    renderBanner();
  }
}

// ------------------------------------------------------------------ the side

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function askSide() {
  const prompt = $('sidePrompt');
  // The player is usually sitting where the camera is, so guess the side nearest the bottom of the picture.
  const whiteY = (corners[0][1] + corners[1][1]) / 2, blackY = (corners[2][1] + corners[3][1]) / 2;
  const guess = whiteY > blackY ? 'w' : 'b';
  prompt.querySelectorAll('button[data-side]').forEach((b) => b.classList.toggle('guess', b.dataset.side === guess));
  prompt.hidden = false;
  prompt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
  $('sideSelect').value = side;
  $('sidePrompt').hidden = true;
  try { recognition?.abort(); } catch { /* already stopped */ }
  recognition = null;
  lastSpoken = '';
  say(side === 'turn' ? 'Okay, I\'ll help both sides.' : `Okay, you're playing ${SIDE_NAMES[side]}.`);
  renderAll();
}

$('sidePrompt').addEventListener('click', (e) => {
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

function setBanner(text, warn = false) {
  $('banner').textContent = text;
  $('banner').classList.toggle('warn', warn);
}

function renderBanner() {
  if (!stream) return setBanner('Allow the camera to begin, or tap Start camera.');
  if (mode === 'search') return setBanner('Looking for a chessboard… Get the whole board in view and hold still.');
  if (mode === 'manual' && corners.length < 4) {
    return setBanner(`Tap the board's corners: a1 (White's left corner), h1, h8, a8. Next: ${CORNER_LABELS[corners.length]}`);
  }
  if (!Hn) return setBanner('Those corners don\'t make a proper four-sided board. Find the board again.', true);
  if (poseLost) return setBanner('Can\'t see the board well. Keep all of it in view…', true);
  if (chess.isGameOver()) return setBanner(gameOverText());
  const status = {
    init: 'Watching the board…',
    moving: 'Hands or camera moving. I read the move once the board is still.',
    settling: 'Hands or camera moving. I read the move once the board is still.',
    baseline: 'Board locked in.',
    steady: `${SIDE_NAMES[chess.turn()]} to move.`,
    move: `${SIDE_NAMES[chess.turn()]} to move.`,
    unmatched: 'The board changed but I can\'t match it to a legal move. Put the pieces back, or fix it with Undo / typing the move.',
  }[lastState] ?? '';
  setBanner(status, lastState === 'unmatched');
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
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', () => {
      chess.undo();
      chess.move(move);
      el.hidden = true;
      gameChanged({ resync: false });     // the camera already sees this position
      toast(`Fixed: ${chess.history().at(-1)}.`);
    });
    el.append(button);
  };
  if (promoted) {
    el.append(' Promoted to a queen. Change: ');
    for (const piece of ['r', 'b', 'n']) offer(GLYPHS[piece], PIECE_NAMES[piece], { from: promoted.from, to: promoted.to, promotion: piece });
  }
  if (alternatives.length) {
    el.append(' Not right? ');
    for (const m of alternatives) offer(m.san, `It was ${m.san}`, { from: m.from, to: m.to, promotion: m.promotion });
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, promoted || alternatives.length ? 12000 : 3500);
}

function renderBoard() {
  const board = $('board');
  const cells = [];
  const last = chess.history({ verbose: true }).at(-1);
  const best = visibleAdvice();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const f = flipped ? 7 - col : col;
      const r = flipped ? row : 7 - row;
      const name = 'abcdefgh'[f] + (r + 1);
      const cell = document.createElement('div');
      cell.className = 'sq ' + ((f + r) % 2 === 0 ? 'dark' : 'light');
      if (last && (last.from === name || last.to === name)) cell.classList.add('last');
      if (selected === name) cell.classList.add('sel');
      if (best && best.from === name) cell.classList.add('best-from');
      if (best && best.to === name) cell.classList.add('best-to');
      const piece = chess.get(name);
      if (piece) {
        const span = document.createElement('span');
        span.className = `pc ${piece.color}`;
        span.textContent = GLYPHS[piece.type];
        cell.append(span);
      }
      cell.dataset.sq = name;
      cells.push(cell);
    }
  }
  board.replaceChildren(...cells);
}

$('board').addEventListener('click', (e) => {
  const name = e.target.closest('.sq')?.dataset.sq;
  if (!name) return;
  if (selected && selected !== name) {
    const move = tryMove({ from: selected, to: name, promotion: 'q' });
    selected = null;
    if (move) return manualMoveDone();
  }
  const piece = chess.get(name);
  selected = piece && piece.color === chess.turn() && selected !== name ? name : null;
  renderBoard();
});

function renderMoves() {
  const history = chess.history();
  const parts = [];
  for (let i = 0; i < history.length; i += 2) {
    parts.push(`<b>${i / 2 + 1}.</b> ${history[i]}${history[i + 1] ? ' ' + history[i + 1] : ''}`);
  }
  $('moves').innerHTML = parts.join('  ');
  $('moves').scrollTop = $('moves').scrollHeight;
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
  const opponent = m.color === 'w' ? 'black' : 'white';
  let text;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rook = m.flags.includes('k') ? ['h' + m.from[1], 'f' + m.from[1]] : ['a' + m.from[1], 'd' + m.from[1]];
    text = `Castle ${m.flags.includes('k') ? 'kingside' : 'queenside'}: king ${m.from} → ${m.to}, then rook ${rook[0]} → ${rook[1]}.`;
  } else {
    text = `Move your ${PIECE_NAMES[m.piece]} ${m.from} → ${m.to}`;
    if (m.flags.includes('e')) text += `, taking the pawn on ${m.to[0] + m.from[1]} (en passant)`;
    else if (m.captured) text += `, taking the ${opponent} ${PIECE_NAMES[m.captured]}`;
    if (m.promotion) text += ` and promote to a ${PIECE_NAMES[m.promotion]}`;
    text += '.';
  }
  const suffix = m.san.endsWith('#') ? ' Checkmate!' : m.san.endsWith('+') ? ' Check.' : '';
  return text + suffix;
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

function renderAdvice() {
  const text = $('adviceText');
  const evalEl = $('evalText');
  const hud = $('hud');
  hud.hidden = true;
  if (chess.isGameOver()) {
    text.textContent = gameOverText();
    evalEl.textContent = '';
    return;
  }
  if (!engineReady) {
    text.textContent = 'Loading the engine…';
    evalEl.textContent = '';
    return;
  }
  const best = visibleAdvice();
  const m = best && legalMove(best);
  if (m) {
    text.innerHTML = `<span class="san">${m.san}</span><br>${describeMove(m)}`;
    if (Hn) {
      hud.innerHTML = `<span class="san">${m.san}</span> ${describeMove(m)}`;
      hud.hidden = false;
    }
    if (side && side !== 'turn' && advice.bestmove !== lastSpoken) {
      lastSpoken = advice.bestmove;
      say(spokenMove(m));
    }
  } else if (advice) {
    text.textContent = `Waiting for ${SIDE_NAMES[chess.turn()]} to move…`;
    if (Hn && side) {
      hud.textContent = `Waiting for ${SIDE_NAMES[chess.turn()]}'s move…`;
      hud.hidden = false;
    }
  } else {
    text.textContent = 'Thinking…';
  }

  if (!advice) { evalEl.textContent = ''; return; }
  const score = advice.mate != null
    ? `Mate in ${Math.abs(advice.mate)} for ${advice.mate > 0 ? 'White' : 'Black'}`
    : advice.cp != null ? `${advice.cp >= 0 ? '+' : ''}${(advice.cp / 100).toFixed(2)} (White's view)` : '';
  evalEl.textContent = `${score}${advice.depth ? ` · depth ${advice.depth}` : ''}`;
}

function renderAll() {
  drawSoon();
  renderBoard();
  renderMoves();
  renderAdvice();
  renderBanner();
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
  selected = null;
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

$('moveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('moveInput');
  const text = input.value.trim();
  if (!text) return;
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(text);
  const move = uci ? tryMove({ from: uci[1], to: uci[2], promotion: uci[3] ?? 'q' }) : tryMove(text);
  if (!move) return toast(`"${text}" isn't a legal move here.`);
  input.value = '';
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
});

$('flipBtn').addEventListener('click', () => {
  flipped = !flipped;
  renderBoard();
});

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

bindRange('skillRange', 'skillOut', 'skill', (v) => (v === 20 ? 'max' : `${v}/20`), (v) => {
  if (engineReady) { engine.setSkill(v); refreshAdvice(); }
});
bindRange('timeRange', 'timeOut', 'time', (v) => `${(v / 1000).toFixed(1)}s`, () => {});
bindRange('sensRange', 'sensOut', 'sens', (v) => `${v}/9`, (v) => {
  tracker.params.minChange = sensitivityToMinChange(v);
});

$('sideSelect').value = 'turn';
$('sideSelect').addEventListener('change', () => chooseSide($('sideSelect').value));

$('speakBox').checked = store.get('speak', true);
$('speakBox').addEventListener('change', () => store.set('speak', $('speakBox').checked));

// --------------------------------------------------------------------- boot

updateHomography();
renderAll();
$('debugBox').addEventListener('change', drawSoon);
startEngine();
// Open the camera straight away, but only once the page has loaded: a playing camera
// stream otherwise keeps the page "loading" forever (spinner never stops on phones).
if (document.readyState === 'complete') startCamera(undefined, { quiet: true });
else window.addEventListener('load', () => startCamera(undefined, { quiet: true }), { once: true });
