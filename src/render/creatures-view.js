// Instanced creature rendering with smooth interpolation between worker snapshots.
import * as THREE from 'three';
import { CREATURE_STRIDE, FLAG } from '../sim/constants.js';

const MAX = 600;
const UP = new THREE.Vector3(0, 1, 0);

export class CreaturesView {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.state = new Map(); // id -> interpolated state
    this.order = [];        // ids in instance order

    const bodyGeo = new THREE.SphereGeometry(0.5, 18, 14);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
    bodyMat.onBeforeCompile = (shader) => {
      // soft rim light so creatures pop against the terrain
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float rim = pow(1.0 - max(dot(normalize(vViewPosition), normal), 0.0), 2.5);
         totalEmissiveRadiance += diffuseColor.rgb * rim * 0.3;`,
      );
    };
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX);
    this.body.castShadow = true;
    this.body.receiveShadow = false;
    this.body.frustumCulled = false;

    const eyeGeo = new THREE.SphereGeometry(0.5, 10, 8);
    this.eyes = new THREE.InstancedMesh(eyeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x222222 }), MAX * 2);
    this.pupils = new THREE.InstancedMesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0x0a0d14 }), MAX * 2);
    const crestGeo = new THREE.ConeGeometry(0.5, 1, 5);
    crestGeo.translate(0, 0.5, 0);
    this.crest = new THREE.InstancedMesh(crestGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), MAX * 2);
    const packGeo = new THREE.BoxGeometry(0.5, 0.35, 0.55);
    this.packs = new THREE.InstancedMesh(packGeo, new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }), MAX);
    for (const m of [this.eyes, this.pupils, this.crest, this.packs]) { m.frustumCulled = false; }
    this.crest.castShadow = true;
    scene.add(this.body, this.eyes, this.pupils, this.crest, this.packs);

    // selection ring
    const ringGeo = new THREE.RingGeometry(0.9, 1.08, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x5ef2ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    scene.add(this.ring);
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x5ef2ff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.beam.visible = false;
    scene.add(this.beam);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.selectedId = 0;
    this.count = 0;
  }

  ingest(buf) {
    const n = buf.length / CREATURE_STRIDE;
    const seen = new Set();
    this.order.length = 0;
    for (let i = 0; i < n; i++) {
      const o = i * CREATURE_STRIDE;
      const id = buf[o];
      seen.add(id);
      this.order.push(id);
      let s = this.state.get(id);
      const x = buf[o + 1], z = buf[o + 2];
      if (!s) {
        s = { x, z, heading: buf[o + 3], phase: Math.random() * 6, born: performance.now(), size: buf[o + 4] };
        this.state.set(id, s);
      }
      s.tx = x; s.tz = z; s.th = buf[o + 3];
      s.tsize = buf[o + 4];
      s.r = buf[o + 5]; s.g = buf[o + 6]; s.b = buf[o + 7];
      s.flags = buf[o + 8];
      s.action = buf[o + 9];
      s.speed = buf[o + 10];
      s.brain = buf[o + 11];
      // teleport if the jump is large (fast-forward / respawn)
      if (Math.hypot(x - s.x, z - s.z) > 12) { s.x = x; s.z = z; }
    }
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id);
  }

  get(id) {
    return this.state.get(id);
  }

  positionOf(id, out = new THREE.Vector3()) {
    const s = this.state.get(id);
    if (!s) return null;
    return out.set(s.x, s.y ?? this.terrain.heightAt(s.x, s.z), s.z);
  }

  update(dt, time, speedMul) {
    const k = 1 - Math.exp(-dt * (10 + speedMul * 2));
    const m = this._m, q = this._q, p = this._p, sc = this._s, c = this._c;
    let i = 0, ei = 0, ci = 0, pi = 0;
    for (const id of this.order) {
      const s = this.state.get(id);
      if (!s) continue;
      const dx = s.tx - s.x, dz = s.tz - s.z;
      s.x += dx * k; s.z += dz * k;
      let dh = s.th - s.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      s.heading += dh * Math.min(1, k * 1.2);
      s.size += (s.tsize - s.size) * k;
      const moved = Math.hypot(dx, dz) * k;
      s.phase += moved * 2.4 + dt * 1.5;
      const size = s.size * 1.3;
      const flags = s.flags;
      const sleeping = flags & FLAG.SLEEP;
      const ground = this.terrain.heightAt(s.x, s.z);
      const hop = sleeping ? 0 : Math.abs(Math.sin(s.phase)) * 0.22 * size * Math.min(1, s.speed * 1.5 + 0.15);
      const breathe = 1 + Math.sin(time * 2.2 + id) * 0.035;
      const y = ground + size * 0.36 + hop;
      s.y = y;
      const yaw = -s.heading;
      q.setFromAxisAngle(UP, yaw);
      const carn = flags & FLAG.CARNIVORE;
      const elong = carn ? 1.28 : 1.12;
      const squash = sleeping ? 0.6 : 1 - hop * 0.15;
      p.set(s.x, y, s.z);
      sc.set(size * elong * breathe, size * 0.82 * squash * breathe, size * 0.95 * breathe);
      m.compose(p, q, sc);
      this.body.setMatrixAt(i, m);
      c.setRGB(s.r, s.g, s.b, THREE.SRGBColorSpace);
      if (flags & FLAG.INFECTED) c.lerp(this._c2 ||= new THREE.Color(0x7dff3a), 0.45 + 0.25 * Math.sin(time * 6 + id));
      if (flags & FLAG.ATTACK) c.lerp(this._c3 ||= new THREE.Color(0xff3020), 0.55);
      this.body.setColorAt(i, c);

      // eyes grow with brain size: tiny-eyed primordial cells -> big-eyed thinkers
      const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
      const eyeR = size * (0.09 + Math.min(12, s.brain) * 0.012);
      const fwd = size * 0.44 * elong;
      for (const side of [-1, 1]) {
        const lx = fwd * 0.82, lz = side * size * 0.2;
        const ex = s.x + ch * lx - sh * lz;
        const ez = s.z + sh * lx + ch * lz;
        const ey = y + size * 0.2;
        p.set(ex, ey, ez);
        sc.set(eyeR, sleeping ? eyeR * 0.15 : eyeR, eyeR);
        m.compose(p, q, sc);
        this.eyes.setMatrixAt(ei, m);
        p.set(ex + ch * eyeR * 0.55, ey + eyeR * 0.05, ez + sh * eyeR * 0.55);
        const pr = eyeR * 0.55;
        sc.set(pr, sleeping ? pr * 0.1 : pr, pr);
        m.compose(p, q, sc);
        this.pupils.setMatrixAt(ei, m);
        ei++;
      }
      // dorsal spikes for meat eaters, a small crest for omnivores
      if (carn || flags & FLAG.OMNIVORE) {
        const n = carn ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const off = (j - (n - 1) / 2) * size * 0.32;
          p.set(s.x + ch * off, y + size * 0.3, s.z + sh * off);
          const h = carn ? size * 0.42 : size * 0.26;
          sc.set(size * 0.22, h, size * 0.22);
          m.compose(p, q, sc);
          this.crest.setMatrixAt(ci, m);
          c.setRGB(s.r * 0.55, s.g * 0.4, s.b * 0.4, THREE.SRGBColorSpace);
          if (carn) c.lerp(this._c4 ||= new THREE.Color(0x7a1a14), 0.5);
          this.crest.setColorAt(ci, c);
          ci++;
        }
      }
      if (flags & FLAG.CARRY) {
        p.set(s.x - ch * size * 0.25, y + size * 0.45, s.z - sh * size * 0.25);
        sc.set(size, size, size);
        m.compose(p, q, sc);
        this.packs.setMatrixAt(pi++, m);
      }
      i++;
    }
    this.count = i;
    this.body.count = i;
    this.eyes.count = ei;
    this.pupils.count = ei;
    this.crest.count = ci;
    this.packs.count = pi;
    for (const mesh of [this.body, this.eyes, this.pupils, this.crest, this.packs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // selection marker
    const sel = this.selectedId ? this.state.get(this.selectedId) : null;
    this.ring.visible = this.beam.visible = !!sel;
    if (sel) {
      const g = this.terrain.heightAt(sel.x, sel.z);
      const pulse = 1 + Math.sin(time * 4) * 0.08;
      this.ring.position.set(sel.x, g + 0.12, sel.z);
      this.ring.scale.setScalar(Math.max(1.1, sel.size * 1.3) * pulse);
      this.beam.position.set(sel.x, sel.y + sel.size * 0.6, sel.z);
      this.beam.scale.set(1, 6, 1);
    }
  }

  // screen-space picking (robust for small, hopping creatures)
  pick(camera, ndcX, ndcY, width, height) {
    let best = 0, bestD = 26 * 26;
    const v = new THREE.Vector3();
    for (const [id, s] of this.state) {
      v.set(s.x, s.y ?? 0, s.z).project(camera);
      if (v.z > 1) continue;
      const dx = (v.x - ndcX) * width * 0.5, dy = (v.y - ndcY) * height * 0.5;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }
}
