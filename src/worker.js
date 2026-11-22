// Simulation Web Worker: owns the Simulation and streams compact snapshots to the renderer
// so the main thread only interpolates and draws (keeps rendering locked at display rate).
import { Simulation } from './sim/simulation.js';
import { TICKS_PER_SECOND } from './sim/constants.js';

let sim = null;
let speed = 1;
let paused = false;
let selected = 0;
let lastEventSeq = 0;
let accumulator = 0;
let lastTime = 0;
let tickRate = 0;
let ticksThisSecond = 0;
let rateTimer = 0;
let lastResources = 0;
let lastHistTick = -1;
let fastForwardJob = null;

const FRAME_MS = 1000 / 30;     // snapshot rate to the main thread
const BUDGET_MS = 22;           // max sim time per loop iteration

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function sendInit() {
  post({
    type: 'init',
    seed: sim.seed,
    world: sim.worldInfo(),
  });
}

function sendFrame(force = false) {
  const creatures = sim.frameBuffer();
  const newEvents = sim.events.filter((e) => e.seq > lastEventSeq);
  if (newEvents.length) lastEventSeq = newEvents[newEvents.length - 1].seq;
  sim.lastCounts = sim.counts();
  const msg = {
    type: 'frame',
    world: sim.worldInfo(),
    creatures,
    camps: sim.campSnapshot(),
    counts: sim.lastCounts,
    events: newEvents,
    tickRate,
    speed,
    paused,
    inspect: selected ? sim.inspect(selected) : null,
  };
  const transfer = [creatures.buffer];
  const now = performance.now();
  if (force || now - lastResources > 400) {
    lastResources = now;
    const r = sim.resourceBuffers();
    msg.resources = r;
    transfer.push(r.plants.buffer, r.minerals.buffer, r.meat.buffer);
  }
  const histTick = sim.history[sim.history.length - 1]?.tick ?? 0;
  if (force || histTick !== lastHistTick) {
    lastHistTick = histTick;
    msg.history = sim.history;
  }
  post(msg, transfer);
}

function loop() {
  const now = performance.now();
  const dt = Math.min(250, now - lastTime);
  lastTime = now;
  const start = now;

  if (fastForwardJob) {
    // run as fast as possible within the budget, then report progress
    while (fastForwardJob.remaining > 0 && performance.now() - start < 40) {
      sim.step();
      fastForwardJob.remaining--;
      ticksThisSecond++;
    }
    if (fastForwardJob.remaining <= 0) {
      const job = fastForwardJob;
      fastForwardJob = null;
      sendFrame(true);
      post({ type: 'fastForwardDone', id: job.id, tick: sim.tick });
    } else {
      post({ type: 'fastForwardProgress', remaining: fastForwardJob.remaining, total: fastForwardJob.total });
      sendFrame(false);
    }
  } else if (!paused) {
    accumulator += (dt / 1000) * TICKS_PER_SECOND * speed;
    let steps = 0;
    while (accumulator >= 1 && performance.now() - start < BUDGET_MS) {
      sim.step();
      accumulator -= 1;
      steps++;
    }
    ticksThisSecond += steps;
    if (accumulator > TICKS_PER_SECOND * speed * 0.5) accumulator = 0; // can't keep up: drop backlog
    sendFrame(false);
  } else {
    sendFrame(false);
  }

  rateTimer += dt;
  if (rateTimer >= 1000) {
    tickRate = (ticksThisSecond * 1000) / rateTimer;
    ticksThisSecond = 0;
    rateTimer = 0;
  }
  const elapsed = performance.now() - start;
  setTimeout(loop, Math.max(0, FRAME_MS - elapsed));
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      sim = new Simulation({ seed: m.seed ?? 42, population: m.population ?? 170 });
      sendInit();
      lastTime = performance.now();
      sendFrame(true);
      loop();
      break;
    case 'speed':
      speed = m.value;
      paused = false;
      break;
    case 'pause':
      paused = m.value;
      break;
    case 'select':
      selected = m.id || 0;
      break;
    case 'meteor': {
      const r = sim.meteor(m.x, m.z);
      post({ type: 'crater', ...r });
      sendFrame(true);
      break;
    }
    case 'plague':
      sim.plague(m.x ?? null, m.z ?? null);
      break;
    case 'oasis':
      sim.oasis(m.x, m.z);
      sendFrame(true);
      break;
    case 'mutate':
      sim.mutateCreature(m.id);
      break;
    case 'spawn':
      sim.spawn(m.x, m.z, m.n ?? 10);
      break;
    case 'fastForward':
      fastForwardJob = { id: m.id, remaining: m.ticks, total: m.ticks };
      break;
    case 'jumpTime': {
      // advance until the requested time of day (used for showcase/screenshot modes)
      let guard = 2000;
      while (Math.abs(sim.timeOfDay - m.timeOfDay) > 0.003 && guard-- > 0) sim.step();
      sendFrame(true);
      break;
    }
    default:
      break;
  }
};
