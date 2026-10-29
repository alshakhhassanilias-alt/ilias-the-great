import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { Tracker } from './tracker.js';
import { applyH, boardToImage, isConvexQuad, scaleH } from './homography.js';
import { sampleSignature } from './vision.js';

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
const SAMPLE_WIDTH = 640;
const SAMPLE_EVERY_MS = 150;

const chess = new Chess();
const tracker = new Tracker(chess);

let engine = null;
let engineReady = false;
let corners = store.get('corners', []);      // clicked corners, normalized to [0,1] image coords
let Hn = null;                               // board plane -> normalized image coords
let advice = null;                           // latest engine result for the current position
let adviceSeq = 0;
let lastDiffs = null;
let flipped = false;
let selected = null;                         // selected square on the digital board
let stream = null;
let dragging = -1;

const video = document.createElement('video');
video.playsInline = true;
video.muted = true;
const view = $('view');
const vctx = view.getContext('2d');
const grab = document.createElement('canvas');
const gctx = grab.getContext('2d', { willReadFrequently: true });

// ---------------------------------------------------------------- calibration

function updateHomography() {
  Hn = null;
  if (corners.length === 4 && isConvexQuad(corners)) Hn = boardToImage(corners);
  $('clearBtn').disabled = corners.length === 0;
  $('rotateBtn').disabled = corners.length < 4;
  $('resyncBtn').disabled = !Hn;
}

function setCorners(next) {
  corners = next;
  store.set('corners', corners);
  updateHomography();
  tracker.resync();
  renderBanner();
}

function eventPoint(e) {
  const rect = view.getBoundingClientRect();
  return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
}

view.addEventListener('pointerdown', (e) => {
  if (!stream) return;
  const [x, y] = eventPoint(e);
  if (corners.length < 4) {
    setCorners([...corners, [x, y]]);
    return;
  }
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
  corners = next;
  updateHomography();
});

const endDrag = () => {
  if (dragging < 0) return;
  dragging = -1;
  store.set('corners', corners);
  tracker.resync();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);

$('clearBtn').addEventListener('click', () => setCorners([]));
$('rotateBtn').addEventListener('click', () => setCorners([...corners.slice(1), corners[0]]));
$('resyncBtn').addEventListener('click', () => { tracker.resync(); toast('Re-syncing: keep your hands off the board for a second.'); });

// --------------------------------------------------------------------- camera

async function startCamera(deviceId) {
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
  } catch (err) {
    stream = null;
    setBanner(`Camera blocked or unavailable (${err.name}). Allow camera access and try again.`, true);
    return;
  }
  video.srcObject = stream;
  await video.play();
  $('startBtn').textContent = 'Restart camera';
  tracker.resync();
  await listCameras(stream.getVideoTracks()[0].getSettings().deviceId);
  renderBanner();
}

async function listCameras(currentId) {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const select = $('cameraSelect');
  select.replaceChildren(...devices.map((d, i) => {
    const option = new Option(d.label || `Camera ${i + 1}`, d.deviceId, false, d.deviceId === currentId);
    return option;
  }));
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
  const lw = Math.max(2, w / 320);
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

function frame() {
  if (video.readyState >= 2 && video.videoWidth) {
    if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
      view.width = video.videoWidth;
      view.height = video.videoHeight;
    }
    vctx.drawImage(video, 0, 0, view.width, view.height);
    drawOverlay(vctx, view.width, view.height);
  } else {
    vctx.fillStyle = '#000';
    vctx.fillRect(0, 0, view.width, view.height);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- sampling

setInterval(() => {
  if (!Hn || video.readyState < 2 || !video.videoWidth || dragging >= 0) return;
  grab.width = SAMPLE_WIDTH;
  grab.height = Math.round((SAMPLE_WIDTH * video.videoHeight) / video.videoWidth);
  gctx.drawImage(video, 0, 0, grab.width, grab.height);
  const img = gctx.getImageData(0, 0, grab.width, grab.height);
  const result = tracker.feed(sampleSignature(img, scaleH(Hn, grab.width, grab.height)));
  if (result.d) lastDiffs = result.d;
  onTrackerResult(result);
}, SAMPLE_EVERY_MS);

let lastState = '';
function onTrackerResult(result) {
  if (result.state === 'move') {
    toast(`Saw ${result.move.san}`, result.move.promotion ? result.move : null);
    gameChanged({ resync: false });
  } else if (result.state === 'baseline') {
    toast('Board locked in. Play on!');
  }
  if (result.state !== lastState) {
    lastState = result.state;
    renderBanner();
  }
}

// ---------------------------------------------------------------------- UI

function setBanner(text, warn = false) {
  $('banner').textContent = text;
  $('banner').classList.toggle('warn', warn);
}

function renderBanner() {
  if (!stream) return setBanner('Start the camera to begin.');
  if (corners.length < 4) {
    return setBanner(`Click the board's corners: a1 (White's left corner), h1, h8, a8. Next: ${CORNER_LABELS[corners.length]}`);
  }
  if (!Hn) return setBanner('Those corners don\'t make a proper four-sided board. Re-pick them.', true);
  if (chess.isGameOver()) return setBanner(gameOverText());
  const status = {
    init: 'Starting up…',
    moving: 'Watching the board…',
    settling: 'Watching the board…',
    baseline: 'Board locked in.',
    steady: `${chess.turn() === 'w' ? 'White' : 'Black'} to move.`,
    move: `${chess.turn() === 'w' ? 'White' : 'Black'} to move.`,
    unmatched: 'The board changed but I can\'t match it to a legal move. Put the pieces back, or fix it with Undo / typing the move.',
  }[lastState] ?? '';
  setBanner(status, lastState === 'unmatched');
}

function gameOverText() {
  if (chess.isCheckmate()) return `Checkmate. ${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (chess.isStalemate()) return 'Draw by stalemate.';
  return 'Draw.';
}

let toastTimer = 0;
function toast(text, promotedMove = null) {
  const el = $('toast');
  el.replaceChildren(text);
  if (promotedMove) {
    el.append(' Promoted to a queen. Change: ');
    for (const piece of ['q', 'r', 'b', 'n']) {
      const button = document.createElement('button');
      button.textContent = GLYPHS[piece];
      button.title = PIECE_NAMES[piece];
      button.addEventListener('click', () => {
        chess.undo();
        chess.move({ from: promotedMove.from, to: promotedMove.to, promotion: piece });
        el.hidden = true;
        gameChanged({ resync: false });
      });
      el.append(button);
    }
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, promotedMove ? 15000 : 3500);
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
  const side = $('adviseSelect').value;
  if (side !== 'turn' && side !== chess.turn()) return null;
  return {
    from: advice.bestmove.slice(0, 2),
    to: advice.bestmove.slice(2, 4),
    promotion: advice.bestmove[4],
  };
}

function describeMove(best) {
  const m = chess.moves({ verbose: true }).find(
    (x) => x.from === best.from && x.to === best.to && (x.promotion ?? undefined) === best.promotion,
  );
  if (!m) return best.from + best.to;
  const side = m.color === 'w' ? 'white' : 'black';
  let text;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rook = m.flags.includes('k')
      ? ['h' + m.from[1], 'f' + m.from[1]]
      : ['a' + m.from[1], 'd' + m.from[1]];
    text = `Castle ${m.flags.includes('k') ? 'kingside' : 'queenside'}: king ${m.from} → ${m.to}, then rook ${rook[0]} → ${rook[1]}.`;
  } else {
    text = `Move your ${PIECE_NAMES[m.piece]} ${m.from} → ${m.to}`;
    if (m.flags.includes('e')) text += `, taking the pawn on ${m.to[0] + m.from[1]} (en passant)`;
    else if (m.captured) text += `, taking the ${side === 'white' ? 'black' : 'white'} ${PIECE_NAMES[m.captured]}`;
    if (m.promotion) text += ` and promote to a ${PIECE_NAMES[m.promotion]}`;
    text += '.';
  }
  const suffix = m.san.endsWith('#') ? ' Checkmate!' : m.san.endsWith('+') ? ' Check.' : '';
  return `<span class="san">${m.san}</span><br>${text}${suffix}`;
}

function renderAdvice() {
  const text = $('adviceText');
  const evalEl = $('evalText');
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
  if (best) text.innerHTML = describeMove(best);
  else if (advice) text.textContent = `Waiting for ${chess.turn() === 'w' ? 'White' : 'Black'} to move…`;
  else text.textContent = 'Thinking…';

  if (!advice) { evalEl.textContent = ''; return; }
  const score = advice.mate != null
    ? `Mate in ${Math.abs(advice.mate)} for ${advice.mate > 0 ? 'White' : 'Black'}`
    : advice.cp != null ? `${advice.cp >= 0 ? '+' : ''}${(advice.cp / 100).toFixed(2)} (White's view)` : '';
  evalEl.textContent = `${score}${advice.depth ? ` · depth ${advice.depth}` : ''}`;
}

function renderAll() {
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

$('adviseSelect').value = store.get('advise', 'turn');
$('adviseSelect').addEventListener('change', () => {
  store.set('advise', $('adviseSelect').value);
  renderAll();
});

// --------------------------------------------------------------------- boot

updateHomography();
renderAll();
requestAnimationFrame(frame);
startEngine();
