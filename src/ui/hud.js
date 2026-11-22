// Dark-glass HUD: top bar, god powers, tribes, chronicle, telemetry charts, toasts.
import { ICONS, WEATHER_ICON } from './icons.js';
import { LineChart } from './charts.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EVENT_ICON = {
  war: 'swords', peace: 'trade', trade: 'trade', tribe: 'flag', schism: 'flag', fall: 'skull', extinction: 'skull',
  species: 'dna', meteor: 'meteor', plague: 'plague', oasis: 'oasis', mutate: 'dna', abiogenesis: 'spawn',
  season: 'leaf', weather: 'cloud', disaster: 'meteor',
};
const TOAST_KINDS = new Set(['war', 'peace', 'tribe', 'schism', 'fall', 'meteor', 'plague', 'oasis', 'mutate']);

export const POWERS = [
  { id: 'meteor', label: 'Meteor', icon: 'meteor', target: true, radius: 18, color: '#ff9a4a' },
  { id: 'plague', label: 'Plague', icon: 'plague', target: true, radius: 30, color: '#9dff5a' },
  { id: 'oasis', label: 'Oasis', icon: 'oasis', target: true, radius: 16, color: '#5fe3b0' },
  { id: 'mutate', label: 'Mutate', icon: 'dna', target: false },
  { id: 'spawn', label: 'Seed Life', icon: 'spawn', target: true, radius: 6, color: '#5ef2ff' },
  { id: 'spot', label: 'Spotlight', icon: 'sparkle', target: false },
];

export class HUD {
  constructor(handlers) {
    this.h = handlers;
    this.buildTopbar();
    this.buildPowers();
    this.buildTribes();
    this.buildChronicle();
    this.buildTelemetry();
    this.center = document.getElementById('center-top');
    this.activePower = null;
    this.lastTribeKey = '';
    this.seenEvents = 0;
  }

  buildTopbar() {
    const el = document.getElementById('topbar');
    el.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${ICONS.logo}</div>
        <div><div class="brand-name">GENESIS</div><div class="brand-sub">Artificial Life &amp; Civilization Sandbox</div></div>
      </div>
      <div class="chips">
        <div class="chip"><span data-c="clockIcon">${ICONS.sun}</span><span class="k">Day</span><span class="v" data-c="day">1</span><span class="v" data-c="clock" style="color:var(--muted);font-weight:500">06:00</span></div>
        <div class="chip"><span>${ICONS.leaf}</span><span class="v" data-c="season">Spring</span></div>
        <div class="chip"><span data-c="wIcon">${ICONS.sun}</span><span class="v" data-c="weather">Clear</span></div>
        <div class="chip era"><span>${ICONS.sparkle}</span><span class="k">Era</span><span class="v" data-c="era">Primordial</span></div>
        <div class="chip"><span>${ICONS.people}</span><span class="k">Pop</span><span class="v" data-c="pop">0</span></div>
        <div class="chip opt"><span>${ICONS.flag}</span><span class="k">Tribes</span><span class="v" data-c="tribes">0</span></div>
        <div class="chip opt2"><span>${ICONS.brain}</span><span class="k">IQ</span><span class="v" data-c="iq">0</span></div>
      </div>
      <div class="speed" role="group" aria-label="Simulation speed">
        <button data-speed="0" title="Pause (Space)">${ICONS.pause}</button>
        <button data-speed="1" class="on" title="1x (1)">1×</button>
        <button data-speed="5" title="5x (2)">5×</button>
        <button data-speed="20" title="20x (3)">20×</button>
      </div>
      <div class="perf"><div><b data-c="fps">60</b> fps</div><div data-c="tps">0 t/s</div></div>`;
    this.c = {};
    el.querySelectorAll('[data-c]').forEach((n) => { this.c[n.dataset.c] = n; });
    this.speedBtns = [...el.querySelectorAll('[data-speed]')];
    this.speedBtns.forEach((b) => { b.onclick = () => this.h.onSpeed(Number(b.dataset.speed)); });
  }

  setSpeed(v) {
    this.speedBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === v));
  }

  buildPowers() {
    const el = document.getElementById('powers');
    el.innerHTML = `<div class="panel-head">${ICONS.bolt}<span>God Powers</span></div>
      <div class="powers-grid">${POWERS.map((p) => `<button class="power ${p.id}" data-p="${p.id}" title="${p.label}">${ICONS[p.icon]}<span>${p.label}</span></button>`).join('')}</div>`;
    this.powerBtns = {};
    el.querySelectorAll('[data-p]').forEach((b) => {
      this.powerBtns[b.dataset.p] = b;
      b.onclick = () => this.h.onPower(POWERS.find((p) => p.id === b.dataset.p));
    });
  }

  setActivePower(p) {
    this.activePower = p;
    for (const [id, b] of Object.entries(this.powerBtns)) b.classList.toggle('on', p?.id === id);
    this.renderHint();
  }

  setMutateEnabled(on) {
    this.powerBtns.mutate.disabled = !on;
    this.powerBtns.mutate.title = on ? 'Mutate the selected creature' : 'Select a creature first';
  }

  renderHint() {
    let hint = this.center.querySelector('.hint');
    if (!this.activePower) { hint?.remove(); return; }
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'hint';
      this.center.prepend(hint);
    }
    const p = this.activePower;
    const verb = { meteor: 'drop a meteor', plague: 'unleash a plague', oasis: 'grow a food oasis', spawn: 'seed primordial cells' }[p.id];
    hint.style.color = p.color;
    hint.innerHTML = `${ICONS.target}<span style="color:var(--text)">Click the island to ${verb}</span><kbd>Esc</kbd>`;
  }

  buildTribes() {
    const el = document.getElementById('tribes');
    el.innerHTML = `<div class="panel-head">${ICONS.flag}<span>Tribes</span><span class="spacer"></span><span class="count" data-t="count">0</span></div>
      <div class="tribe-list" data-t="list"></div>`;
    this.tribeList = el.querySelector('[data-t="list"]');
    this.tribeCount = el.querySelector('[data-t="count"]');
  }

  updateTribes(camps) {
    const alive = camps.filter((c) => c.alive).sort((a, b) => b.members - a.members);
    const names = new Map(camps.map((c) => [c.id, c.name]));
    const key = JSON.stringify(alive.map((c) => [c.id, c.members, c.level, c.wars, c.allies, Math.round(c.food)]));
    if (key === this.lastTribeKey) return;
    this.lastTribeKey = key;
    this.tribeCount.textContent = `${alive.length} alive`;
    if (!alive.length) {
      this.tribeList.innerHTML = '<div class="empty">No tribes yet. Social creatures with big enough brains will band together around a campfire.</div>';
      return;
    }
    this.tribeList.innerHTML = alive.map((c) => {
      const tags = [];
      if (c.wars.length) tags.push(`<span class="tag war">at war · ${esc(c.wars.map((w) => names.get(w) || '?').join(', '))}</span>`);
      else if (c.allies.length) tags.push(`<span class="tag trade">trading · ${esc(c.allies.map((w) => names.get(w) || '?').slice(0, 2).join(', '))}</span>`);
      else tags.push(`Lv ${c.level} · ${c.shelters} shelters`);
      return `<div class="tribe-row" data-id="${c.id}">
        <span class="sw" style="background:${c.color};color:${c.color}"></span>
        <div style="min-width:0"><div class="nm">${esc(c.name)}</div><div class="sub">${tags.join(' ')}</div></div>
        <div class="num">${c.members}<small>${Math.round(c.food)} food</small></div></div>`;
    }).join('');
    this.tribeList.querySelectorAll('.tribe-row').forEach((r) => { r.onclick = () => this.h.onTribe(Number(r.dataset.id)); });
  }

  buildChronicle() {
    const el = document.getElementById('chronicle');
    el.innerHTML = `<div class="panel-head">${ICONS.scroll}<span>Chronicle</span></div><div class="log" data-l="log"></div>`;
    this.log = el.querySelector('[data-l="log"]');
  }

  addEvents(events, { toast = true } = {}) {
    for (const e of events) {
      const item = document.createElement('div');
      item.className = `log-item k-${e.kind}${e.x != null ? ' clickable' : ''}`;
      item.innerHTML = `${ICONS[EVENT_ICON[e.kind] || 'sparkle']}<div><span class="when">D${e.day}</span>${esc(e.text)}</div>`;
      if (e.x != null) item.onclick = () => this.h.onLocate(e.x, e.z);
      this.log.prepend(item);
      if (toast && TOAST_KINDS.has(e.kind)) this.toast(e);
    }
    while (this.log.children.length > 80) this.log.lastChild.remove();
  }

  toast(e) {
    const existing = this.center.querySelectorAll('.toast');
    if (existing.length >= 3) existing[0].remove();
    const t = document.createElement('div');
    t.className = `toast k-${e.kind}`;
    t.innerHTML = `${ICONS[EVENT_ICON[e.kind] || 'sparkle']}<span>${esc(e.text)}</span>`;
    this.center.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 4200);
  }

  progress(remaining, total) {
    let p = this.center.querySelector('.progress');
    if (remaining <= 0) { p?.remove(); return; }
    if (!p) {
      p = document.createElement('div');
      p.className = 'progress';
      p.innerHTML = '<div style="display:flex;justify-content:space-between"><span>Fast-forwarding evolution…</span><span data-p="t" style="font-family:var(--mono);color:var(--muted)"></span></div><div class="bar"><div></div></div>';
      this.center.prepend(p);
    }
    p.querySelector('[data-p="t"]').textContent = `${total - remaining}/${total}`;
    p.querySelector('.bar > div').style.width = `${((total - remaining) / total) * 100}%`;
  }

  buildTelemetry() {
    const el = document.getElementById('telemetry');
    el.innerHTML = `
      <div class="chart"><div class="chart-head"><span class="chart-title">Population</span><span class="chart-value" data-v="pop">0</span></div>
        <canvas data-ch="pop"></canvas>
        <div class="legend"><span><i style="background:#5fe39a"></i>Herbivores</span><span><i style="background:#ffc857"></i>Omnivores</span><span><i style="background:#ff5f5f"></i>Carnivores</span></div></div>
      <div class="chart"><div class="chart-head"><span class="chart-title">Avg intelligence</span><span class="chart-value" data-v="iq" style="color:#5ef2ff">0</span></div>
        <canvas data-ch="iq"></canvas>
        <div class="legend"><span><i style="background:#5ef2ff"></i>Neural IQ</span><span data-v="gen">avg generation 0</span></div></div>
      <div class="chart"><div class="chart-head"><span class="chart-title">Species &amp; extinctions</span><span class="chart-value" data-v="sp" style="color:#b98cff">0</span></div>
        <canvas data-ch="sp"></canvas>
        <div class="legend"><span><i style="background:#b98cff"></i>Living species</span><span><i style="background:rgba(255,95,95,0.7)"></i>Extinctions</span><span><i style="background:#ffc857"></i>Tribes</span></div></div>`;
    const ch = (k) => el.querySelector(`[data-ch="${k}"]`);
    this.charts = {
      pop: new LineChart(ch('pop'), { series: [
        { key: 'total', color: 'rgba(233,238,247,0.35)', width: 1.2, dash: [3, 3] },
        { key: 'herb', color: '#5fe39a', fill: 'rgba(95,227,154,0.22)' },
        { key: 'omni', color: '#ffc857' },
        { key: 'carn', color: '#ff5f5f' },
      ] }),
      iq: new LineChart(ch('iq'), { yMin: null, series: [
        { key: 'avgIQ', color: '#5ef2ff', fill: 'rgba(94,242,255,0.2)', width: 1.8 },
      ] }),
      sp: new LineChart(ch('sp'), { series: [
        { key: 'speciesAlive', color: '#b98cff', fill: 'rgba(185,140,255,0.2)' },
        { key: 'tribes', color: '#ffc857', width: 1.4 },
      ], bars: { key: 'extDelta', color: 'rgba(255,95,95,0.55)' } }),
    };
    this.vals = {};
    el.querySelectorAll('[data-v]').forEach((n) => { this.vals[n.dataset.v] = n; });
  }

  updateHistory(history) {
    const data = history.map((h, i) => ({
      ...h,
      extDelta: i ? Math.max(0, h.extinctions - history[i - 1].extinctions) : 0,
    }));
    this.charts.pop.setData(data);
    this.charts.iq.setData(data);
    this.charts.sp.setData(data);
    const last = history[history.length - 1];
    if (last) {
      this.vals.pop.textContent = last.total;
      this.vals.iq.textContent = last.avgIQ.toFixed(1);
      this.vals.gen.textContent = `avg generation ${last.avgGen.toFixed(1)}`;
      this.vals.sp.textContent = `${last.speciesAlive} · ${last.extinctions}†`;
    }
  }

  redrawCharts() {
    for (const c of Object.values(this.charts)) c.draw();
  }

  updateTop(world, counts, fps, tps) {
    const c = this.c;
    c.day.textContent = world.day;
    const mins = Math.floor(world.timeOfDay * 24 * 60);
    c.clock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const night = world.sunElevation < -0.05;
    if (c.clockIcon.dataset.n !== String(night)) { c.clockIcon.innerHTML = night ? ICONS.moon : ICONS.sun; c.clockIcon.dataset.n = String(night); }
    c.season.textContent = world.season;
    c.weather.textContent = world.weather;
    if (c.wIcon.dataset.w !== world.weather) { c.wIcon.innerHTML = ICONS[WEATHER_ICON[world.weather]]; c.wIcon.dataset.w = world.weather; }
    c.era.textContent = world.era;
    if (counts) {
      c.pop.textContent = counts.total;
      c.tribes.textContent = counts.tribes;
      c.iq.textContent = counts.avgIQ.toFixed(1);
    }
    c.fps.textContent = Math.round(fps);
    c.fps.style.color = fps >= 55 ? 'var(--green)' : fps >= 40 ? 'var(--amber)' : 'var(--red)';
    c.tps.textContent = `${Math.round(tps)} ticks/s`;
  }
}
