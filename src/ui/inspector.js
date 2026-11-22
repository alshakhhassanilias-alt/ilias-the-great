// Creature inspector: identity, live thought, vitals, live neural network, DNA and family tree.
import { ICONS, THOUGHT_ICON } from './icons.js';
import { INPUT_LABELS, OUTPUT_LABELS, MAX_H, NI, NO, W1 } from '../sim/brain.js';
import { ACTION_LABELS } from '../sim/constants.js';

const hsl = (h, s = 62, l = 58) => `hsl(${Math.round(h * 360)} ${s}% ${l}%)`;
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DNA_FIELDS = [
  ['speed', 'Speed', 0.6, 1.8], ['size', 'Size', 0.6, 1.8], ['vision', 'Vision', 6, 26], ['diet', 'Carnivory', 0, 1],
  ['efficiency', 'Efficiency', 0, 1], ['aggression', 'Aggression', 0, 1], ['sociability', 'Sociability', 0, 1],
  ['fertility', 'Fertility', 0, 1], ['immunity', 'Immunity', 0, 1], ['brainSize', 'Brain', 1, 12],
];

export class Inspector {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers; // {onClose, onFollow, onMutate, onSelect, onSpotlight}
    this.currentId = 0;
    this.following = false;
    this.lastFamilyKey = '';
    this.renderPlaceholder({});
  }

  renderPlaceholder(summary) {
    this.currentId = 0;
    this.root.innerHTML = `
      <div class="panel-head">${ICONS.brain}<span>Mind Inspector</span></div>
      <div class="insp-scroll">
        <div class="placeholder">
          <div class="ring">${ICONS.eye}</div>
          <h3>Click any creature</h3>
          <p>Inspect its live neural network, DNA, family tree and what it is thinking right now.</p>
          <button class="btn" data-act="spot" style="width:100%;margin-top:6px">${ICONS.sparkle}<span>Spotlight a tribe member</span></button>
          <div class="stat-cards" id="obs-cards"></div>
        </div>
      </div>`;
    this.root.querySelector('[data-act="spot"]').onclick = () => this.h.onSpotlight();
    this.updateSummary(summary);
  }

  updateSummary(s) {
    const el = this.root.querySelector('#obs-cards');
    if (!el || !s) return;
    const cards = [
      ['Era', s.era ?? '—'], ['Avg generation', s.avgGen != null ? s.avgGen.toFixed(1) : '—'],
      ['Living species', s.speciesAlive ?? '—'], ['Extinctions', s.extinctions ?? '—'],
      ['In tribes', s.inTribes != null ? `${s.inTribes}` : '—'], ['Active wars', s.wars ?? '—'],
    ];
    el.innerHTML = cards.map(([k, v]) => `<div class="stat-card"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');
  }

  show(d) {
    if (!d) return;
    if (d.dead) {
      if (this.currentId !== -d.id) {
        this.currentId = -d.id;
        this.root.innerHTML = `
          <div class="panel-head">${ICONS.skull}<span>Mind Inspector</span><span class="spacer"></span>
            <button class="icon-btn" data-act="close" title="Close">${ICONS.close}</button></div>
          <div class="insp-scroll"><div class="dead-note"><b>${esc(d.name)}</b> has died (${esc(d.cause || 'unknown')}).<br/>Its genes live on in its descendants.</div>
          <button class="btn" data-act="spot">${ICONS.sparkle}<span>Spotlight another creature</span></button></div>`;
        this.root.querySelector('[data-act="close"]').onclick = () => this.h.onClose();
        this.root.querySelector('[data-act="spot"]').onclick = () => this.h.onSpotlight();
      }
      return;
    }
    if (this.currentId !== d.id) this.build(d);
    this.update(d);
  }

  build(d) {
    this.currentId = d.id;
    this.lastFamilyKey = '';
    this.root.innerHTML = `
      <div class="panel-head">${ICONS.brain}<span>Mind Inspector</span><span class="spacer"></span>
        <span class="count" data-f="idtag"></span>
        <button class="icon-btn" data-act="follow" title="Follow with camera (F)">${ICONS.eye}</button>
        <button class="icon-btn purple" data-act="mutate" title="Mutate this creature">${ICONS.dna}</button>
        <button class="icon-btn" data-act="close" title="Close (Esc)">${ICONS.close}</button></div>
      <div class="insp-scroll">
        <div class="insp-id">
          <div class="avatar" data-f="avatar"></div>
          <div><div class="insp-name" data-f="name"></div><div class="insp-sub" data-f="sub"></div></div>
        </div>
        <div class="badges" data-f="badges"></div>
        <div class="thought"><span data-f="ticon"></span><div style="min-width:0"><div class="t-label">Current thought</div><div class="t-text" data-f="thought"></div><div class="t-drive" data-f="drive"></div></div></div>
        <div class="vitals">
          <div class="vital"><div class="lbl">Energy <b data-f="e"></b></div><div class="bar"><div data-f="eb" style="background:var(--amber)"></div></div></div>
          <div class="vital"><div class="lbl">Health <b data-f="hp"></b></div><div class="bar"><div data-f="hb" style="background:var(--green)"></div></div></div>
          <div class="vital"><div class="lbl">Age <b data-f="age"></b></div><div class="bar"><div data-f="ab" style="background:var(--purple)"></div></div></div>
        </div>
        <div>
          <div class="section-title">${ICONS.brain}<span>Neural network · live</span><span class="r" data-f="iq"></span></div>
          <div class="nn-wrap"><canvas data-f="nn"></canvas></div>
        </div>
        <div>
          <div class="section-title">${ICONS.dna}<span>Genome</span><span class="r" data-f="mut"></span></div>
          <div class="dna" data-f="dna">${DNA_FIELDS.map(([k, label]) => `<div class="vital"><div class="lbl">${label} <b data-g="${k}"></b></div><div class="bar"><div data-gb="${k}"></div></div></div>`).join('')}</div>
        </div>
        <div class="family">
          <div class="section-title">${ICONS.tree}<span>Family tree</span><span class="r" data-f="kids"></span></div>
          <div data-f="tree"></div>
        </div>
      </div>`;
    this.f = {};
    this.root.querySelectorAll('[data-f]').forEach((el) => { this.f[el.dataset.f] = el; });
    this.g = {};
    this.root.querySelectorAll('[data-g]').forEach((el) => { this.g[el.dataset.g] = el; });
    this.gb = {};
    this.root.querySelectorAll('[data-gb]').forEach((el) => { this.gb[el.dataset.gb] = el; });
    this.root.querySelector('[data-act="close"]').onclick = () => this.h.onClose();
    this.followBtn = this.root.querySelector('[data-act="follow"]');
    this.followBtn.onclick = () => this.h.onFollow();
    this.root.querySelector('[data-act="mutate"]').onclick = () => this.h.onMutate();
    this.setFollowing(this.following);
  }

  setFollowing(on) {
    this.following = on;
    if (this.followBtn) {
      this.followBtn.classList.toggle('on', on);
      this.followBtn.title = on ? 'Following — click to stop (F)' : 'Follow with camera (F)';
    }
  }

  update(d) {
    const g = d.genome;
    const f = this.f;
    const col = d.tribe ? d.tribe.color : hsl(g.hue);
    f.avatar.style.background = `radial-gradient(circle at 50% 60%, ${col}, rgba(0,0,0,0.35))`;
    f.avatar.style.boxShadow = `0 0 18px ${col}55`;
    f.name.textContent = d.name;
    f.idtag.textContent = `#${d.id}`;
    f.sub.textContent = `Gen ${d.gen} · ${d.diet} · ${d.species ? d.species.name : 'unknown'}`;
    const badges = [];
    if (d.tribe) badges.push(`<span class="badge"><i style="background:${d.tribe.color}"></i>${esc(d.tribe.name)} tribe</span>`);
    else badges.push('<span class="badge"><i style="background:#5d677a"></i>No tribe</span>');
    if (d.species) badges.push(`<span class="badge">${d.species.count} of kind</span>`);
    if (d.kills) badges.push(`<span class="badge" style="color:#ff9c9c">${d.kills} kill${d.kills > 1 ? 's' : ''}</span>`);
    if (d.infected) badges.push('<span class="badge" style="color:#9dff5a">Infected</span>');
    if (d.carry > 0.3) badges.push('<span class="badge" style="color:#ffc857">Carrying</span>');
    const bh = badges.join('');
    if (f.badges.innerHTML !== bh) f.badges.innerHTML = bh;
    const label = ACTION_LABELS[d.action] || 'Thinking';
    const icon = ICONS[THOUGHT_ICON[label] || 'brain'];
    if (f.ticon.dataset.k !== label) { f.ticon.innerHTML = icon; f.ticon.dataset.k = label; }
    f.thought.textContent = d.thought;
    const drive = OUTPUT_LABELS[d.intent] || '';
    const overridden = ACTION_LABELS[d.intent] !== label;
    f.drive.textContent = overridden ? `Neural drive: ${drive} · overridden by ${label.toLowerCase()}` : `Neural drive: ${drive}`;
    f.e.textContent = pct(d.energy); f.eb.style.width = pct(d.energy);
    f.hp.textContent = pct(d.health); f.hb.style.width = pct(d.health);
    f.age.textContent = `${(d.age / 600).toFixed(1)}d`; f.ab.style.width = pct(d.age / d.lifespan);
    f.iq.textContent = `IQ ${d.iq.toFixed(0)} · ${g.brainSize} neurons`;
    f.mut.textContent = `mutation ${(g.mutationRate * 100).toFixed(0)}%`;
    for (const [k, , lo, hi] of DNA_FIELDS) {
      const v = g[k];
      this.g[k].textContent = k === 'brainSize' ? v : k === 'vision' ? v.toFixed(0) : v.toFixed(2);
      this.gb[k].style.width = pct((v - lo) / (hi - lo));
    }
    f.kids.textContent = `${d.childCount} offspring`;
    this.drawNetwork(d);
    this.drawFamily(d);
  }

  drawNetwork(d) {
    const canvas = this.f.nn;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const hidden = d.genome.brainSize;
    const xs = [62 * dpr, W / 2, W - 54 * dpr];
    const col = (n, i, top = 8 * dpr, bot = 8 * dpr) => top + ((H - top - bot) * (i + 0.5)) / n;
    const inY = (i) => col(NI, i);
    const hidY = (h) => col(MAX_H, h, 14 * dpr, 14 * dpr);
    const outY = (o) => col(NO, o, 12 * dpr, 12 * dpr);
    const w = d.weights;
    const color = (v, a) => (v >= 0 ? `rgba(94,242,255,${a})` : `rgba(255,95,170,${a})`);
    // decided output (first 8 are intents)
    let best = 0;
    for (let o = 1; o < 8; o++) if (d.outputs[o] > d.outputs[best]) best = o;

    ctx.lineCap = 'round';
    for (let h = 0; h < hidden; h++) {
      for (let i = 0; i < NI; i++) {
        const wt = w[i * MAX_H + h];
        const sig = d.inputs[i] * wt;
        const a = Math.min(0.85, Math.abs(sig) * 0.45 + 0.03);
        ctx.strokeStyle = color(sig, a);
        ctx.lineWidth = Math.min(2.6, 0.4 + Math.abs(sig) * 1.1) * dpr;
        ctx.beginPath(); ctx.moveTo(xs[0], inY(i)); ctx.lineTo(xs[1], hidY(h)); ctx.stroke();
      }
      for (let o = 0; o < NO; o++) {
        const wt = w[W1 + MAX_H + h * NO + o];
        const sig = d.hidden[h] * wt;
        const a = Math.min(0.9, Math.abs(sig) * 0.5 + 0.03);
        ctx.strokeStyle = color(sig, a);
        ctx.lineWidth = Math.min(2.8, 0.4 + Math.abs(sig) * 1.2) * dpr;
        ctx.beginPath(); ctx.moveTo(xs[1], hidY(h)); ctx.lineTo(xs[2], outY(o)); ctx.stroke();
      }
    }
    const node = (x, y, v, rad, active = true, ring = false) => {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      const a = active ? 0.25 + Math.min(1, Math.abs(v)) * 0.75 : 0.12;
      ctx.fillStyle = active ? color(v, a) : 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)';
      ctx.stroke();
      if (ring) { ctx.beginPath(); ctx.arc(x, y, rad + 3.5 * dpr, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,200,87,0.95)'; ctx.lineWidth = 1.6 * dpr; ctx.stroke(); }
    };
    ctx.font = `${8.8 * dpr}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let i = 0; i < NI; i++) {
      node(xs[0], inY(i), d.inputs[i], 3.6 * dpr);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(190,200,216,0.8)';
      ctx.fillText(INPUT_LABELS[i], xs[0] - 7 * dpr, inY(i));
    }
    for (let h = 0; h < MAX_H; h++) node(xs[1], hidY(h), d.hidden[h], 4.4 * dpr, h < hidden);
    for (let o = 0; o < NO; o++) {
      const isBest = o === best;
      node(xs[2], outY(o), d.outputs[o], 4.2 * dpr, true, isBest);
      ctx.textAlign = 'left';
      ctx.fillStyle = isBest ? '#ffc857' : 'rgba(190,200,216,0.8)';
      ctx.font = `${isBest ? 700 : 400} ${8.8 * dpr}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(OUTPUT_LABELS[o], xs[2] + 8 * dpr, outY(o));
    }
  }

  drawFamily(d) {
    const fam = d.family;
    const key = JSON.stringify([fam.self.parents.map((p) => [p.id, p.alive, (p.parents || []).map((q) => [q.id, q.alive])]), fam.children.map((c) => [c.id, c.alive])]);
    if (key === this.lastFamilyKey) return;
    this.lastFamilyKey = key;
    const W = 300, H = 124;
    const rows = { gp: 12, p: 44, s: 76, c: 110 };
    const nodes = [], edges = [];
    const add = (n, x, y, r, label) => { nodes.push({ n, x, y, r, label }); return { x, y }; };
    const self = add({ ...fam.self, alive: true }, W / 2, rows.s, 10, d.name);
    const parents = fam.self.parents;
    parents.forEach((p, i) => {
      const px = parents.length === 1 ? W / 2 : W / 2 + (i === 0 ? -70 : 70);
      const pp = add(p, px, rows.p, 8, p.name);
      edges.push([pp, self]);
      (p.parents || []).forEach((g, j) => {
        const gx = px + ((p.parents.length === 1 ? 0 : j === 0 ? -30 : 30));
        const gp = add(g, gx, rows.gp, 6, null);
        edges.push([gp, pp]);
      });
    });
    const kids = fam.children.slice(-9);
    kids.forEach((c, i) => {
      const cx = W / 2 + (i - (kids.length - 1) / 2) * 28;
      const cp = add(c, cx, rows.c, 6.5, null);
      edges.push([self, cp]);
    });
    const svgEdges = edges.map(([a, b]) => {
      const my = (a.y + b.y) / 2;
      return `<path d="M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" fill="none"/>`;
    }).join('');
    const svgNodes = nodes.map(({ n, x, y, r, label }) => {
      if (n.unknown) return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)"/>`;
      const fill = hsl(n.hue ?? 0.5, 60, 55);
      const op = n.alive ? 1 : 0.35;
      const ring = n.id === d.id ? '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 4) + '" fill="none" stroke="#5ef2ff" stroke-width="1.5"/>' : '';
      const cross = n.alive ? '' : `<path d="M${x - r * 0.5},${y - r * 0.5}L${x + r * 0.5},${y + r * 0.5}M${x + r * 0.5},${y - r * 0.5}L${x - r * 0.5},${y + r * 0.5}" stroke="rgba(10,12,18,0.8)" stroke-width="1.4"/>`;
      const text = label ? `<text x="${x + (y === rows.s ? 16 : 0)}" y="${y + (y === rows.s ? 3.5 : -11)}" text-anchor="${y === rows.s ? 'start' : 'middle'}" fill="rgba(200,210,226,0.85)" font-size="9.5" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${esc(label)}${n.alive ? '' : ' †'}</text>` : '';
      return `<g class="node" data-id="${n.alive ? n.id : ''}" opacity="${op}">${ring}<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>${cross}${text}<title>${esc(n.name || '?')} · gen ${n.gen ?? '?'}${n.alive ? '' : ' (dead)'}</title></g>`;
    }).join('');
    const extra = fam.children.length > 9 ? `<text x="${W - 4}" y="${rows.c + 4}" fill="rgba(141,152,173,0.9)" font-size="10" text-anchor="end">+${fam.children.length - 9}</text>` : '';
    const noKids = fam.children.length === 0 ? `<text x="${W / 2}" y="${rows.c + 4}" fill="rgba(141,152,173,0.6)" font-size="10" text-anchor="middle">no offspring yet</text>` : '';
    const noParents = parents.length === 0 ? `<text x="${W / 2}" y="${rows.p}" fill="rgba(141,152,173,0.6)" font-size="10" text-anchor="middle">primordial founder</text>` : '';
    this.f.tree.innerHTML = `<svg class="tree" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${svgEdges}${svgNodes}${extra}${noKids}${noParents}</svg>`;
    this.f.tree.querySelectorAll('.node').forEach((el) => {
      const id = Number(el.dataset.id);
      if (id && id !== d.id) el.addEventListener('click', () => this.h.onSelect(id));
    });
  }
}
