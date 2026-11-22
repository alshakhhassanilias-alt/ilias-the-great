// Genesis — main thread: renderer, camera, input and HUD. The simulation runs in a worker.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Terrain } from './sim/terrain.js';
import { FLAG } from './sim/constants.js';
import { Environment } from './render/environment.js';
import { TerrainView } from './render/terrain-view.js';
import { CreaturesView } from './render/creatures-view.js';
import { ResourcesView } from './render/resources-view.js';
import { CampsView } from './render/camps-view.js';
import { WeatherView } from './render/weather-view.js';
import { Effects } from './render/effects.js';
import { HUD } from './ui/hud.js';
import { Inspector } from './ui/inspector.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed')) || 42;
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e)));

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 3000);
camera.position.set(150, 135, 185);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 6;
controls.maxDistance = 420;
controls.maxPolarAngle = Math.PI * 0.47;
controls.zoomSpeed = 1.1;

// ---------------------------------------------------------------- world views
const terrain = new Terrain(SEED);
const env = new Environment(scene);
const terrainView = new TerrainView(scene, terrain, SEED);
const resources = new ResourcesView(scene, terrain, SEED);
const creatures = new CreaturesView(scene, terrain);
const labelsRoot = document.getElementById('labels');
const camps = new CampsView(scene, terrain, labelsRoot);
camps.onCampCreated = (c) => terrainView.clearTrees(c.x, c.z, 11);
const weather = new WeatherView(scene);
const effects = new Effects(scene, terrain);

const bubble = document.createElement('div');
bubble.className = 'thought-bubble';
bubble.style.display = 'none';
labelsRoot.appendChild(bubble);

// ---------------------------------------------------------------- state
const state = {
  world: null, counts: null, camps: [], speed: 1, paused: false, selected: 0, follow: false,
  inspect: null, tickRate: 0, history: [], ready: false, ffJobs: new Map(), ffSeq: 0,
  targeting: null, hoverPoint: null, lastFrameAt: 0, framesSeen: 0,
};

// ---------------------------------------------------------------- worker
let pendingFrame = null;
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onerror = (e) => errors.push(`worker: ${e.message}`);
worker.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      state.world = m.world;
      break;
    case 'frame':
      // coalesce: if several snapshots arrive between paints, keep the newest but don't lose events
      if (pendingFrame) {
        m.events = pendingFrame.events.concat(m.events);
        m.resources ||= pendingFrame.resources;
        m.history ||= pendingFrame.history;
      }
      pendingFrame = m;
      break;
    case 'crater':
      terrainView.applyCrater(m.x, m.z, m.radius, m.depth);
      resources.refreshHeights();
      break;
    case 'fastForwardProgress':
      hud.progress(m.remaining, m.total);
      break;
    case 'fastForwardDone': {
      hud.progress(0, 1);
      const job = state.ffJobs.get(m.id);
      if (job) { state.ffJobs.delete(m.id); job(m.tick); }
      break;
    }
    default: break;
  }
};

function onFrame(m) {
  state.world = m.world;
  state.counts = m.counts;
  state.tickRate = m.tickRate;
  state.camps = m.camps;
  state.framesSeen++;
  creatures.ingest(m.creatures);
  camps.sync(m.camps);
  if (m.resources) { resources.setSeason(m.world.seasonIndex); resources.ingest(m.resources); }
  if (m.history) { state.history = m.history; hud.updateHistory(m.history); }
  if (m.events.length) hud.addEvents(m.events, { toast: state.ready });
  hud.updateTribes(m.camps);
  state.inspect = m.inspect;
  if (state.selected) {
    if (m.inspect) inspector.show(m.inspect);
    if (m.inspect?.dead) { creatures.selectedId = 0; setFollow(false); }
  } else if (performance.now() - (state.summaryAt || 0) > 500) {
    state.summaryAt = performance.now();
    inspector.updateSummary({ ...m.counts, era: m.world.era });
  }
  if (!state.ready) {
    state.ready = true;
    document.getElementById('loader').classList.add('done');
  }
}

// ---------------------------------------------------------------- HUD wiring
const hud = new HUD({
  onSpeed: (v) => setSpeed(v),
  onPower: (p) => usePower(p),
  onTribe: (id) => focusTribe(id),
  onLocate: (x, z) => focusPoint(x, z, 55),
});
const inspector = new Inspector(document.getElementById('inspector'), {
  onClose: () => select(0),
  onFollow: () => setFollow(!state.follow),
  onMutate: () => mutateSelected(),
  onSelect: (id) => select(id),
  onSpotlight: () => spotlight(),
});
hud.setMutateEnabled(false);

function setSpeed(v) {
  if (v === 0) {
    state.paused = !state.paused;
    worker.postMessage({ type: 'pause', value: state.paused });
    hud.setSpeed(state.paused ? 0 : state.speed);
    return;
  }
  state.speed = v;
  state.paused = false;
  worker.postMessage({ type: 'speed', value: v });
  hud.setSpeed(v);
}

function select(id) {
  state.selected = id;
  creatures.selectedId = id;
  worker.postMessage({ type: 'select', id });
  hud.setMutateEnabled(!!id);
  if (!id) {
    setFollow(false);
    inspector.renderPlaceholder({ ...state.counts, era: state.world?.era });
    bubble.style.display = 'none';
  }
}

function setFollow(on) {
  state.follow = on && !!state.selected;
  inspector.setFollowing(state.follow);
}

function mutateSelected() {
  if (!state.selected) return;
  worker.postMessage({ type: 'mutate', id: state.selected });
  const id = state.selected;
  effects.helix((v) => creatures.positionOf(id, v));
}

function usePower(p) {
  if (p.id === 'mutate') { mutateSelected(); return; }
  if (p.id === 'spot') { spotlight(); return; }
  if (state.targeting?.id === p.id) { cancelTargeting(); return; }
  state.targeting = p;
  canvas.classList.add('targeting');
  hud.setActivePower(p);
}

function cancelTargeting() {
  state.targeting = null;
  canvas.classList.remove('targeting');
  effects.hideReticle();
  hud.setActivePower(null);
}

function applyPower(p, point) {
  const { x, z } = point;
  if (p.id === 'meteor') {
    return effects.meteor(x, z).then(() => worker.postMessage({ type: 'meteor', x, z }));
  } else if (p.id === 'plague') {
    worker.postMessage({ type: 'plague', x, z });
    effects.burst(x, z, 0x9dff5a, 30, 8, 320, 3.2);
  } else if (p.id === 'oasis') {
    worker.postMessage({ type: 'oasis', x, z });
    effects.burst(x, z, 0x7dffb0, 16, 12, 260, 2.8);
  } else if (p.id === 'spawn') {
    worker.postMessage({ type: 'spawn', x, z, n: 10 });
    effects.burst(x, z, 0x5ef2ff, 6, 6, 120, 2);
  }
}

function spotlight() {
  // prefer a tribe member doing something interesting
  const ids = [];
  for (const [id, s] of creatures.state) if (s.flags & FLAG.TRIBE) ids.push(id);
  const pool = ids.length ? ids : [...creatures.state.keys()];
  if (!pool.length) return;
  const id = pool[Math.floor(Math.random() * pool.length)];
  select(id);
  const s = creatures.get(id);
  if (s) focusPoint(s.x, s.z, 24);
  setFollow(true);
}

// ---------------------------------------------------------------- camera helpers
let camTween = null;
function focusPoint(x, z, dist = 40, dir = null) {
  const y = Math.max(0, terrain.heightAt(x, z));
  const target = new THREE.Vector3(x, y + 1, z);
  const d = dir || camera.position.clone().sub(controls.target).normalize();
  if (d.y < 0.35) { d.y = 0.45; d.normalize(); }
  const pos = target.clone().add(d.multiplyScalar(dist));
  pos.y = Math.max(pos.y, terrain.heightAt(pos.x, pos.z) + 4);
  camTween = { t: 0, dur: 1.1, fromT: controls.target.clone(), toT: target, fromP: camera.position.clone(), toP: pos };
}
function focusTribe(id) {
  const c = state.camps.find((t) => t.id === id);
  if (c) { setFollow(false); focusPoint(c.x, c.z, 30 + c.radius * 0.8); }
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function groundPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(terrainView.mesh, false)[0];
  return hit ? hit.point : null;
}
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointermove', (e) => {
  if (state.targeting) {
    const p = groundPoint(e.clientX, e.clientY);
    state.hoverPoint = p;
    effects.showReticle(p, state.targeting.color, state.targeting.radius);
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6 || e.button !== 0) return;
  if (state.targeting) {
    const p = groundPoint(e.clientX, e.clientY);
    if (p && p.y > -1) {
      applyPower(state.targeting, p);
      if (!e.shiftKey) cancelTargeting();
    }
    return;
  }
  const r = canvas.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const id = creatures.pick(camera, nx, ny, r.width, r.height);
  if (id) select(id);
});
canvas.addEventListener('contextmenu', (e) => { if (state.targeting) { e.preventDefault(); cancelTargeting(); } });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') { if (state.targeting) cancelTargeting(); else select(0); }
  else if (e.key === ' ') { e.preventDefault(); setSpeed(0); }
  else if (e.key === '1') setSpeed(1);
  else if (e.key === '2') setSpeed(5);
  else if (e.key === '3') setSpeed(20);
  else if (e.key.toLowerCase() === 'f' && state.selected) setFollow(!state.follow);
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hud.redrawCharts();
});

// ---------------------------------------------------------------- render loop
const clock = new THREE.Clock();
// screen rects of HUD panels: world-space labels hide when they would sit underneath a panel
let panelRects = [], panelRectsAt = 0;
function occluded(x, y) {
  const now = performance.now();
  if (now - panelRectsAt > 500) {
    panelRectsAt = now;
    panelRects = [...document.querySelectorAll('#hud .panel, #center-top > *')].map((el) => el.getBoundingClientRect());
  }
  return panelRects.some((r) => x > r.left - 40 && x < r.right + 40 && y > r.top - 6 && y < r.bottom + 24);
}
let fps = 60, fpsAcc = 0, fpsFrames = 0;
const tmpV = new THREE.Vector3();
const skyColor = new THREE.Color();
const perf = { js: 0, render: 0, samples: [] };
function frame() {
  requestAnimationFrame(frame);
  const tStart = performance.now();
  if (pendingFrame) { const m = pendingFrame; pendingFrame = null; onFrame(m); }
  const rawDt = clock.getDelta();
  const dt = Math.min(0.1, rawDt);
  const time = clock.elapsedTime;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  if (state.world) {
    const envState = env.update(state.world, dt);
    skyColor.copy(env.uniforms.uHorizon.value).lerp(env.uniforms.uTop.value, 0.4);
    terrainView.update(time, envState, skyColor, state.world.yearPhase);
    resources.update(time);
    creatures.update(dt, time, state.paused ? 0 : state.speed);
    weather.update(dt, time, state.world, envState, controls.target, terrain);
    camps.update(dt, time, envState.night, camera, canvas.clientWidth, canvas.clientHeight, occluded);
    hud.updateTop(state.world, state.counts, fps, state.tickRate);
  }

  if (camTween) {
    camTween.t += Math.min(rawDt, 0.5);
    const k = Math.min(1, camTween.t / camTween.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
    camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
    if (k >= 1) camTween = null;
  } else if (state.follow && state.selected) {
    const p = creatures.positionOf(state.selected, tmpV);
    if (p) {
      const delta = p.clone().sub(controls.target);
      delta.y = (p.y + 1) - controls.target.y;
      const f = 1 - Math.exp(-dt * 4);
      controls.target.addScaledVector(delta, f);
      camera.position.addScaledVector(delta, f);
    }
  }
  controls.update();
  // keep the camera above the terrain
  const gh = terrain.heightAt(camera.position.x, camera.position.z);
  if (camera.position.y < gh + 2.5) camera.position.y = gh + 2.5;
  effects.update(Math.min(rawDt, 0.25), camera);

  // thought bubble above the selected creature
  if (state.selected && state.inspect && !state.inspect.dead) {
    const p = creatures.positionOf(state.selected, tmpV);
    if (p) {
      const s = creatures.get(state.selected);
      p.y += (s?.size || 1) * 1.1 + 1.2;
      p.project(camera);
      const bx = (p.x * 0.5 + 0.5) * canvas.clientWidth, by = (-p.y * 0.5 + 0.5) * canvas.clientHeight;
      if (p.z < 1 && !occluded(bx, by)) {
        bubble.style.display = '';
        if (bubble.textContent !== state.inspect.thought) bubble.textContent = state.inspect.thought;
        bubble.style.transform = `translate(-50%, -100%) translate(${((p.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(1)}px)`;
      } else bubble.style.display = 'none';
    }
  } else bubble.style.display = 'none';

  const tRender = performance.now();
  renderer.render(scene, camera);
  const tEnd = performance.now();
  perf.js = tRender - tStart;
  perf.render = tEnd - tRender;
  perf.samples.push(tEnd - tStart);
  if (perf.samples.length > 240) perf.samples.shift();
}

worker.postMessage({ type: 'start', seed: SEED });
frame();

// ---------------------------------------------------------------- automation / debug API
window.__genesis = {
  THREE, scene, camera, controls, renderer, effects, perf,
  views: { env, terrainView, resources, creatures, camps, weather, hud, inspector },
  get drawCalls() { return renderer.info.render.calls; },
  errors,
  get state() { return { ...state, world: state.world, counts: state.counts }; },
  fastForward(ticks) {
    return new Promise((resolve) => {
      const id = ++state.ffSeq;
      state.ffJobs.set(id, resolve);
      worker.postMessage({ type: 'fastForward', ticks, id });
    });
  },
  setSpeed,
  pause(on) { state.paused = on; worker.postMessage({ type: 'pause', value: on }); hud.setSpeed(on ? 0 : state.speed); },
  waitFrames(n = 2) { return new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
  select,
  spotlight,
  focusPoint,
  focusTribe,
  lookAt(x, z, dist, dir = [0.6, 0.55, 0.6]) {
    camTween = null;
    const y = Math.max(0, terrain.heightAt(x, z));
    const d = new THREE.Vector3(...dir).normalize();
    controls.target.set(x, y + 1, z);
    camera.position.copy(controls.target).addScaledVector(d, dist);
    controls.update();
  },
  setView(pos, target) { camTween = null; camera.position.set(...pos); controls.target.set(...target); controls.update(); },
  tribeMember(tribeId) {
    const t = state.camps.find((c) => c.id === tribeId);
    if (!t) return 0;
    let best = 0, bd = 1e9;
    for (const [id, s] of creatures.state) {
      if (!(s.flags & FLAG.TRIBE)) continue;
      const d = Math.hypot(s.x - t.x, s.z - t.z);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  },
  jumpToTime(t) { worker.postMessage({ type: 'jumpTime', timeOfDay: t }); },
  power(id, x, z) { return applyPower({ id }, { x, z }); },
  get webgl() { const gl = renderer.getContext(); return { version: gl.getParameter(gl.VERSION), lost: gl.isContextLost() }; },
};
