// Regrowing food bushes, mineral crystals, carrion and divine oases.
import * as THREE from 'three';
import { FOOD_RES, FOOD_CELL, HALF } from '../sim/constants.js';
import { RNG } from '../sim/rng.js';

export class ResourcesView {
  constructor(scene, terrain, seed) {
    this.scene = scene;
    this.terrain = terrain;
    const rng = new RNG(seed * 13 + 3);
    // 2 bushes per land cell, 1 crystal cluster per rocky cell
    this.bushes = [];
    this.crystals = [];
    for (let j = 0; j < FOOD_RES; j++) {
      for (let i = 0; i < FOOD_RES; i++) {
        const k = j * FOOD_RES + i;
        const cx = -HALF + (i + 0.5) * FOOD_CELL, cz = -HALF + (j + 0.5) * FOOD_CELL;
        if (!terrain.isLand(cx, cz)) continue;
        const h = terrain.heightAt(cx, cz);
        for (let b = 0; b < 2; b++) {
          const x = cx + rng.float(-1.7, 1.7), z = cz + rng.float(-1.7, 1.7);
          if (!terrain.isLand(x, z)) continue;
          this.bushes.push({ k, x, z, rot: rng.float(0, 6.28), s: rng.float(0.75, 1.2), tone: rng.next(), berry: rng.chance(0.55) });
        }
        if (h > 10 || h < 1.3) this.crystals.push({ k, x: cx + rng.float(-1.2, 1.2), z: cz + rng.float(-1.2, 1.2), rot: rng.float(0, 6.28), tone: rng.next() });
      }
    }
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
    bushGeo.scale(1, 0.75, 1);
    bushGeo.translate(0, 0.3, 0);
    this.bushMesh = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), this.bushes.length);
    this.bushMesh.receiveShadow = true;
    const berryGeo = new THREE.SphereGeometry(0.11, 6, 5);
    this.berryMesh = new THREE.InstancedMesh(berryGeo, new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.35, emissive: 0x3a0510 }), this.bushes.length * 3);
    const crystalGeo = new THREE.OctahedronGeometry(0.4, 0);
    crystalGeo.scale(0.7, 1.9, 0.7);
    crystalGeo.translate(0, 0.55, 0);
    this.crystalMesh = new THREE.InstancedMesh(crystalGeo, new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.3, emissive: 0x3a1a6a, emissiveIntensity: 0.6, flatShading: true }), Math.max(1, this.crystals.length * 3));
    const meatGeo = new THREE.DodecahedronGeometry(0.32, 0);
    this.meatMesh = new THREE.InstancedMesh(meatGeo, new THREE.MeshStandardMaterial({ color: 0x9a2f24, roughness: 0.6, flatShading: true }), 600);
    this.boneMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0xeee6d2 }), 600);
    for (const m of [this.bushMesh, this.berryMesh, this.crystalMesh, this.meatMesh, this.boneMesh]) { m.frustumCulled = false; m.castShadow = m !== this.berryMesh; }
    scene.add(this.bushMesh, this.berryMesh, this.crystalMesh, this.meatMesh, this.boneMesh);

    // oasis glow rings + sparkles
    this.oasisGroup = new THREE.Group();
    scene.add(this.oasisGroup);
    this.oasisMeshes = [];
    this.season = 0;
    this._m = new THREE.Matrix4();
  }

  setSeason(si) {
    this.season = si;
  }

  ingest(res) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const lush = [new THREE.Color(0x5fd05a), new THREE.Color(0x4cbb48), new THREE.Color(0xb59a34), new THREE.Color(0x7c8f6a)][this.season];
    const dry = new THREE.Color(0x8a7a45);
    let bi = 0, be = 0;
    for (const b of this.bushes) {
      const amt = res.plants[b.k] / 255 * 1.6; // 0..1.6
      if (amt < 0.06) continue;
      const sc = b.s * Math.min(1.5, 0.25 + amt * 0.85);
      const y = this.terrain.heightAt(b.x, b.z) - 0.05;
      q.setFromAxisAngle(up, b.rot);
      p.set(b.x, y, b.z);
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      this.bushMesh.setMatrixAt(bi, m);
      c.copy(dry).lerp(lush, Math.min(1, amt)).multiplyScalar(0.8 + b.tone * 0.35);
      this.bushMesh.setColorAt(bi, c);
      bi++;
      if (b.berry && amt > 0.55 && this.season < 3) {
        for (let n = 0; n < 3; n++) {
          const a = b.rot + n * 2.1;
          p.set(b.x + Math.cos(a) * 0.38 * sc, y + 0.42 * sc + (n % 2) * 0.12 * sc, b.z + Math.sin(a) * 0.38 * sc);
          s.setScalar(sc);
          m.compose(p, q, s);
          this.berryMesh.setMatrixAt(be++, m);
        }
      }
    }
    this.bushMesh.count = bi;
    this.berryMesh.count = be;
    let ci = 0;
    for (const cr of this.crystals) {
      const amt = res.minerals[cr.k] / 255 * 1.2;
      if (amt < 0.05) continue;
      const y = this.terrain.heightAt(cr.x, cr.z) - 0.15;
      for (let n = 0; n < 3; n++) {
        if (amt < 0.25 * n) break;
        const a = cr.rot + n * 2.3;
        q.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0.0, Math.sin(a)), n === 0 ? 0 : 0.45);
        p.set(cr.x + Math.cos(a) * 0.35 * n, y, cr.z + Math.sin(a) * 0.35 * n);
        const sc = (0.45 + amt * 0.7) * (n === 0 ? 1 : 0.65);
        s.setScalar(sc);
        m.compose(p, q, s);
        this.crystalMesh.setMatrixAt(ci, m);
        c.setHSL(0.72 + cr.tone * 0.14, 0.75, 0.62);
        this.crystalMesh.setColorAt(ci, c);
        ci++;
      }
    }
    this.crystalMesh.count = ci;
    const nMeat = Math.min(600, res.meat.length / 3);
    for (let i = 0; i < nMeat; i++) {
      const x = res.meat[i * 3], z = res.meat[i * 3 + 1], a = res.meat[i * 3 + 2];
      const y = this.terrain.heightAt(x, z);
      q.setFromAxisAngle(up, i * 1.7);
      p.set(x, y + 0.15, z);
      s.setScalar(0.6 + a * 0.9);
      m.compose(p, q, s);
      this.meatMesh.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(Math.cos(i), 0, Math.sin(i)), Math.PI / 2);
      p.set(x + 0.2, y + 0.12, z);
      s.setScalar(1);
      m.compose(p, q, s);
      this.boneMesh.setMatrixAt(i, m);
    }
    this.meatMesh.count = nMeat;
    this.boneMesh.count = nMeat;
    for (const mesh of [this.bushMesh, this.berryMesh, this.crystalMesh, this.meatMesh, this.boneMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.syncOases(res.oases);
  }

  syncOases(oases) {
    while (this.oasisMeshes.length > oases.length) {
      const o = this.oasisMeshes.pop();
      this.oasisGroup.remove(o.group);
    }
    oases.forEach((o, i) => {
      let rec = this.oasisMeshes[i];
      if (!rec || rec.x !== o.x || rec.z !== o.z) {
        if (rec) this.oasisGroup.remove(rec.group);
        rec = this.makeOasis(o);
        this.oasisMeshes[i] = rec;
      }
      rec.ttl = o.ttl;
    });
  }

  makeOasis(o) {
    const group = new THREE.Group();
    const pts = [];
    const seg = 96;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = o.x + Math.cos(a) * o.r, z = o.z + Math.sin(a) * o.r;
      pts.push(new THREE.Vector3(x, Math.max(0.2, this.terrain.heightAt(x, z)) + 0.35, z));
    }
    const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.12, 5, true), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(ring);
    const n = 140;
    const pos = new Float32Array(n * 3);
    const seeds = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * o.r;
      const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
      seeds.push({ x, z, base: this.terrain.heightAt(x, z), off: Math.random() * 6 });
      pos[i * 3] = x; pos[i * 3 + 2] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb8ffd0, size: 0.45, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture() }));
    group.add(sparks);
    this.oasisGroup.add(group);
    return { x: o.x, z: o.z, group, sparks, seeds, ring, ttl: o.ttl };
  }

  update(time) {
    for (const rec of this.oasisMeshes) {
      const pos = rec.sparks.geometry.attributes.position;
      rec.seeds.forEach((s, i) => {
        pos.setY(i, s.base + ((time * 0.8 + s.off) % 6));
      });
      pos.needsUpdate = true;
      const fade = Math.min(1, rec.ttl / 400);
      rec.ring.material.opacity = (0.45 + 0.25 * Math.sin(time * 2.5)) * fade;
      rec.sparks.material.opacity = 0.85 * fade;
    }
  }
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  _glow.colorSpace = THREE.SRGBColorSpace;
  return _glow;
}
