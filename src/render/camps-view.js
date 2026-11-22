// Tribal camps: campfires, tents/huts, banners, stockpiles, palisades, territory and
// diplomacy arcs (war = pulsing red, trade = golden), plus floating name labels.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './resources-view.js';

// Collapse a group of static meshes into one mesh per material (keeps camp draw calls tiny).
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const m = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
  });
  while (group.children.length) group.remove(group.children[0]);
  for (const [mat, list] of buckets) {
    const merged = new THREE.Mesh(mergeGeometries(list), mat);
    merged.castShadow = true;
    merged.receiveShadow = true;
    group.add(merged);
    list.forEach((g) => g.dispose());
  }
}

const LIGHTS = 6;

export class CampsView {
  constructor(scene, terrain, labelRoot) {
    this.scene = scene;
    this.terrain = terrain;
    this.labelRoot = labelRoot;
    this.camps = new Map();
    this.arcs = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lights = [];
    for (let i = 0; i < LIGHTS; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 34, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.geo = {
      log: new THREE.CylinderGeometry(0.12, 0.14, 1.5, 6).rotateZ(Math.PI / 2),
      stone: new THREE.DodecahedronGeometry(0.22, 0),
      flame: new THREE.ConeGeometry(0.42, 1.3, 7).translate(0, 0.65, 0),
      flameInner: new THREE.ConeGeometry(0.24, 0.9, 7).translate(0, 0.45, 0),
      tent: new THREE.ConeGeometry(1.25, 2.3, 7).translate(0, 1.15, 0),
      tentDoor: new THREE.PlaneGeometry(0.55, 0.9).translate(0, 0.45, 0),
      tentBand: new THREE.CylinderGeometry(0.66, 0.7, 0.22, 7),
      tentPoles: new THREE.ConeGeometry(0.12, 0.6, 5),
      hutWall: new THREE.CylinderGeometry(1.15, 1.25, 1.2, 9).translate(0, 0.6, 0),
      hutRoof: new THREE.ConeGeometry(1.6, 1.4, 9).translate(0, 1.85, 0),
      pole: new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6).translate(0, 2.1, 0),
      flag: new THREE.PlaneGeometry(1.4, 0.85, 6, 1).translate(0.7, 0, 0),
      crate: new THREE.BoxGeometry(0.7, 0.55, 0.7).translate(0, 0.27, 0),
      post: new THREE.CylinderGeometry(0.12, 0.15, 1.8, 5).translate(0, 0.9, 0),
      totem: new THREE.CylinderGeometry(0.26, 0.34, 3.2, 8).translate(0, 1.6, 0),
      totemCap: new THREE.OctahedronGeometry(0.55, 0),
      totemBand: new THREE.CylinderGeometry(0.34, 0.34, 0.35, 8),
    };
    this.mats = {
      log: new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1, flatShading: true }),
      flame: new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      flameInner: new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      crate: new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.9 }),
      door: new THREE.MeshStandardMaterial({ color: 0x1d140e, roughness: 1, side: THREE.DoubleSide }),
      hutWall: new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: 1, flatShading: true }),
      post: new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1, flatShading: true }),
      ruin: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1, flatShading: true }),
    };
    this.time = 0;
  }

  heightAt(x, z) {
    return Math.max(0.2, this.terrain.heightAt(x, z));
  }

  sync(camps) {
    const seen = new Set();
    for (const c of camps) {
      seen.add(c.id);
      let rec = this.camps.get(c.id);
      if (!rec) { rec = this.create(c); this.camps.set(c.id, rec); this.onCampCreated?.(c); }
      this.refresh(rec, c);
    }
    for (const [id, rec] of this.camps) {
      if (!seen.has(id)) { this.group.remove(rec.group); rec.label.remove(); this.disposeGroup(rec.group); this.camps.delete(id); }
    }
    this.syncArcs(camps);
  }

  disposeGroup(g) {
    g.traverse((o) => { if (o.geometry && !Object.values(this.geo).includes(o.geometry)) o.geometry.dispose(); });
  }

  create(c) {
    const group = new THREE.Group();
    const y = this.heightAt(c.x, c.z);
    group.position.set(c.x, 0, c.z);
    const color = new THREE.Color(c.color);
    // tents are tanned hide dyed with the tribe colour; banners carry the pure colour
    const tribeMat = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xd9c4a0), 0.45), roughness: 0.85, flatShading: true });
    const accentMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
    const flagMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.15 });

    // fire pit
    const fire = new THREE.Group();
    fire.position.y = y;
    const pit = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Mesh(this.geo.stone, this.mats.stone);
      s.position.set(Math.cos(a) * 0.85, 0.08, Math.sin(a) * 0.85);
      pit.add(s);
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(this.geo.log, this.mats.log);
      l.rotation.y = (i / 3) * Math.PI;
      l.position.y = 0.15;
      pit.add(l);
    }
    fire.add(pit);
    const flame = new THREE.Mesh(this.geo.flame, this.mats.flame);
    const flameInner = new THREE.Mesh(this.geo.flameInner, this.mats.flameInner);
    flame.position.y = flameInner.position.y = 0.2;
    fire.add(flame, flameInner);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9a3a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(5, 5, 5);
    glow.position.y = 1;
    fire.add(glow);
    group.add(fire);
    group.position.set(c.x, 0, c.z);
    mergeByMaterial(pit);

    // banner pole with flag
    const banner = new THREE.Group();
    const bx = 1.8, bz = -1.6;
    banner.position.set(bx, this.heightAt(c.x + bx, c.z + bz) - y, bz);
    const pole = new THREE.Mesh(this.geo.pole, this.mats.post);
    pole.castShadow = true;
    const flag = new THREE.Mesh(this.geo.flag.clone(), flagMat);
    flag.position.y = 3.7;
    flag.castShadow = true;
    banner.add(pole, flag);
    fire.add(banner);

    // territory ribbon
    const territory = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    territory.position.set(-c.x, 0, -c.z); // ribbon built in world coordinates
    territory.renderOrder = 3;
    group.add(territory);

    const structures = new THREE.Group();
    group.add(structures);
    this.group.add(group);

    const label = document.createElement('div');
    label.className = 'tribe-label';
    label.innerHTML = `<span class="dot" style="background:${c.color}"></span><span class="name"></span><span class="meta"></span>`;
    this.labelRoot.appendChild(label);

    const light = { x: c.x, y: y + 2, z: c.z };
    return { id: c.id, group, fire, flame, flameInner, glow, flag, territory, structures, tribeMat, accentMat, flagMat, label, y, radius: -1, shelters: -1, level: -1, food: -1, alive: true, light, data: c };
  }

  buildTerritory(rec, c) {
    const seg = 120;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const idx = [];
    const w = 0.55;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      for (let s = 0; s < 2; s++) {
        const r = c.radius + (s ? w : -w);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const k = (i * 2 + s) * 3;
        pos[k] = x; pos[k + 1] = this.heightAt(x, z) + 0.25; pos[k + 2] = z;
      }
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    rec.territory.geometry.dispose();
    rec.territory.geometry = g;
  }

  buildStructures(rec, c) {
    const s = rec.structures;
    s.traverse((o) => { if (o.isMesh && o.parent === s) o.geometry.dispose(); });
    while (s.children.length) s.remove(s.children[0]);
    const ruin = !c.alive;
    const count = ruin ? Math.min(3, c.shelters) : c.shelters;
    const ringR = 5 + Math.min(c.shelters, 10) * 0.25;
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(count, 5)) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      const gy = this.heightAt(c.x + x, c.z + z);
      const hut = c.level >= 3 && i % 2 === 0;
      const g = new THREE.Group();
      g.position.set(x, gy - 0.1, z);
      g.rotation.y = -a + Math.PI / 2;
      if (hut) {
        const wall = new THREE.Mesh(this.geo.hutWall, ruin ? this.mats.ruin : this.mats.hutWall);
        const roof = new THREE.Mesh(this.geo.hutRoof, ruin ? this.mats.ruin : rec.accentMat);
        wall.castShadow = roof.castShadow = true;
        g.add(wall);
        if (!ruin) g.add(roof);
      } else {
        const tent = new THREE.Mesh(this.geo.tent, ruin ? this.mats.ruin : rec.tribeMat);
        tent.castShadow = true;
        tent.receiveShadow = true;
        if (ruin) { tent.scale.set(1, 0.35, 1); tent.rotation.z = 0.4; }
        g.add(tent);
        if (!ruin) {
          const band = new THREE.Mesh(this.geo.tentBand, rec.accentMat);
          band.position.y = 1.15;
          const tip = new THREE.Mesh(this.geo.tentPoles, this.mats.post);
          tip.position.y = 2.25;
          g.add(band, tip);
        }
        if (!ruin) {
          const door = new THREE.Mesh(this.geo.tentDoor, this.mats.door);
          door.position.set(0, 0, 1.02);
          door.rotation.x = -0.45;
          g.add(door);
        }
      }
      s.add(g);
    }
    if (ruin) { mergeByMaterial(s); return; }
    // stockpile crates proportional to hoarded food
    const crates = Math.min(6, Math.floor(c.food / 3));
    for (let i = 0; i < crates; i++) {
      const x = -2.4 + (i % 3) * 0.75, z = 1.9 + Math.floor(i / 3) * 0.75;
      const m = new THREE.Mesh(this.geo.crate, this.mats.crate);
      m.position.set(x, this.heightAt(c.x + x, c.z + z), z);
      m.rotation.y = i * 0.3;
      m.castShadow = true;
      s.add(m);
    }
    const stones = Math.min(10, Math.floor(c.stone / 1.5));
    for (let i = 0; i < stones; i++) {
      const m = new THREE.Mesh(this.geo.stone, this.mats.stone);
      const x = 2.2 + (i % 4) * 0.35, z = 1.6 + Math.floor(i / 4) * 0.35;
      m.position.set(x, this.heightAt(c.x + x, c.z + z) + 0.15 + Math.floor(i / 6) * 0.25, z);
      m.scale.setScalar(1.6);
      s.add(m);
    }
    // palisade + totem for advanced camps
    if (c.level >= 4) {
      const R = ringR + 3.2;
      const posts = 34;
      for (let i = 0; i < posts; i++) {
        if (i % 17 === 0) continue; // gates
        const a = (i / posts) * Math.PI * 2;
        const x = Math.cos(a) * R, z = Math.sin(a) * R;
        const p = new THREE.Mesh(this.geo.post, this.mats.post);
        p.position.set(x, this.heightAt(c.x + x, c.z + z) - 0.2, z);
        p.castShadow = true;
        s.add(p);
      }
    }
    if (c.level >= 2) {
      const t = new THREE.Mesh(this.geo.totem, this.mats.post);
      t.position.set(-1.8, this.heightAt(c.x - 1.8, c.z - 1.8) - 0.1, -1.8);
      t.castShadow = true;
      const cap = new THREE.Mesh(this.geo.totemCap, rec.accentMat);
      cap.position.y = 3.3;
      const band = new THREE.Mesh(this.geo.totemBand, rec.accentMat);
      band.position.y = 2.1;
      t.add(cap, band);
      s.add(t);
    }
    mergeByMaterial(s);
  }

  refresh(rec, c) {
    rec.data = c;
    if (Math.abs(rec.radius - c.radius) > 0.6) { rec.radius = c.radius; this.buildTerritory(rec, c); }
    const crates = Math.min(6, Math.floor(c.food / 3)), stones = Math.min(10, Math.floor(c.stone / 1.5));
    if (rec.shelters !== c.shelters || rec.level !== c.level || rec.alive !== c.alive || rec.crates !== crates || rec.stones !== stones) {
      rec.shelters = c.shelters; rec.level = c.level; rec.alive = c.alive; rec.crates = crates; rec.stones = stones;
      this.buildStructures(rec, c);
    }
    rec.flame.visible = rec.flameInner.visible = rec.glow.visible = c.alive;
    rec.territory.material.opacity = c.alive ? (c.wars.length ? 0.45 : 0.3) : 0.08;
    rec.label.querySelector('.name').textContent = c.name;
    const status = !c.alive ? 'ruins' : c.wars.length ? '⚔ at war' : `${c.members} members`;
    rec.label.querySelector('.meta').textContent = c.alive ? `${status} · Lv ${c.level}` : status;
    rec.label.classList.toggle('war', c.alive && c.wars.length > 0);
    rec.label.classList.toggle('dead', !c.alive);
  }

  syncArcs(camps) {
    const byId = new Map(camps.map((c) => [c.id, c]));
    const want = new Map();
    for (const a of camps) {
      if (!a.alive) continue;
      for (const bid of a.wars) if (a.id < bid && byId.get(bid)?.alive) want.set(`w${a.id}-${bid}`, ['war', a, byId.get(bid)]);
      for (const bid of a.allies) {
        const b = byId.get(bid);
        if (a.id < bid && b?.alive && !a.wars.includes(bid) && (a.trades > 0 || b.trades > 0)) want.set(`t${a.id}-${bid}`, ['trade', a, b]);
      }
    }
    for (const [key, rec] of this.arcs) {
      if (!want.has(key)) { this.group.remove(rec.mesh); rec.mesh.geometry.dispose(); this.arcs.delete(key); }
    }
    for (const [key, [kind, a, b]] of want) {
      if (this.arcs.has(key)) continue;
      const ya = this.heightAt(a.x, a.z) + 3, yb = this.heightAt(b.x, b.z) + 3;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, ya, a.z),
        new THREE.Vector3((a.x + b.x) / 2, Math.max(ya, yb) + 10 + d * 0.45, (a.z + b.z) / 2),
        new THREE.Vector3(b.x, yb, b.z),
      );
      const mat = new THREE.MeshBasicMaterial({ color: kind === 'war' ? 0xff4040 : 0xffd166, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, kind === 'war' ? 0.16 : 0.1, 6, false), mat);
      this.group.add(mesh);
      this.arcs.set(key, { mesh, kind });
    }
  }

  update(dt, time, night, camera, width, height, occluded = () => false) {
    this.time = time;
    // flicker
    for (const rec of this.camps.values()) {
      if (!rec.alive) continue;
      const f = 1 + Math.sin(time * 13 + rec.id) * 0.08 + Math.sin(time * 23.7 + rec.id * 3) * 0.06;
      rec.flame.scale.set(f, f * (1 + Math.sin(time * 9 + rec.id) * 0.12), f);
      rec.flameInner.scale.set(f, f * 1.1, f);
      rec.glow.material.opacity = 0.25 + night * 0.6;
      const gs = 3.5 + night * 4 + Math.sin(time * 7 + rec.id) * 0.3;
      rec.glow.scale.set(gs, gs, gs);
      rec.flag.rotation.y = Math.sin(time * 1.7 + rec.id) * 0.35;
      const pos = rec.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = this.geo.flag.attributes.position.getX(i);
        pos.setZ(i, Math.sin(time * 5 + x * 3 + rec.id) * 0.12 * x);
      }
      pos.needsUpdate = true;
    }
    for (const arc of this.arcs.values()) {
      arc.mesh.material.opacity = arc.kind === 'war' ? 0.4 + 0.25 * Math.sin(time * 5) : 0.3 + 0.12 * Math.sin(time * 2);
    }
    // assign point lights to camps nearest the camera (night only)
    const camPos = camera.position;
    const list = [...this.camps.values()].filter((r) => r.alive).sort((a, b) =>
      Math.hypot(a.data.x - camPos.x, a.data.z - camPos.z) - Math.hypot(b.data.x - camPos.x, b.data.z - camPos.z));
    this.lights.forEach((l, i) => {
      const r = list[i];
      if (r && night > 0.05) {
        l.position.set(r.data.x, r.y + 2.2, r.data.z);
        l.intensity = night * (55 + Math.sin(time * 11 + i) * 8);
      } else l.intensity = 0;
    });
    // labels
    const v = new THREE.Vector3();
    for (const rec of this.camps.values()) {
      v.set(rec.data.x, rec.y + 6.5, rec.data.z).project(camera);
      const dist = camera.position.distanceTo(new THREE.Vector3(rec.data.x, rec.y, rec.data.z));
      const x = (v.x * 0.5 + 0.5) * width, y = (-v.y * 0.5 + 0.5) * height;
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 420 && !occluded(x, y);
      rec.label.style.display = visible ? '' : 'none';
      if (visible) {
        rec.label.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        rec.label.style.opacity = String(Math.max(0.75, Math.min(1, 1.5 - dist / 320)));
      }
    }
  }
}
