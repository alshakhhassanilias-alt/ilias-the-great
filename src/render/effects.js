// God-power visual effects: meteor fall + impact, plague mist, oasis bloom, mutation burst,
// and the ground targeting reticle.
import * as THREE from 'three';
import { glowTexture } from './resources-view.js';

export class Effects {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.active = [];
    this.shake = 0;

    const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Group();
    const r1 = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    const r2 = new THREE.Mesh(ringGeo, r1.material);
    r2.scale.setScalar(0.35);
    this.reticle.add(r1, r2);
    this.reticle.visible = false;
    this.reticle.renderOrder = 6;
    scene.add(this.reticle);
  }

  showReticle(point, color, radius) {
    if (!point) { this.reticle.visible = false; return; }
    this.reticle.visible = true;
    this.reticle.position.set(point.x, Math.max(0.3, point.y) + 0.3, point.z);
    this.reticle.scale.setScalar(radius);
    this.reticle.children[0].material.color.set(color);
  }

  hideReticle() {
    this.reticle.visible = false;
  }

  // returns a promise resolved at impact
  meteor(x, z) {
    return new Promise((resolve) => {
      const ground = Math.max(0, this.terrain.heightAt(x, z));
      const start = new THREE.Vector3(x + 90, ground + 170, z - 60);
      const end = new THREE.Vector3(x, ground, z);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff6a20, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.setScalar(16);
      rock.add(halo);
      this.scene.add(rock);
      const trailN = 60;
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trailN * 3), 3));
      const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff8a3a, size: 5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail.frustumCulled = false;
      this.scene.add(trail);
      const history = [];
      this.active.push({
        t: 0, dur: 1.35,
        update: (e, dt) => {
          const k = Math.min(1, e.t / e.dur);
          const kk = k * k;
          rock.position.lerpVectors(start, end, kk);
          rock.rotation.x += dt * 6;
          history.unshift(rock.position.clone());
          if (history.length > trailN) history.pop();
          const p = trailGeo.attributes.position;
          for (let i = 0; i < trailN; i++) {
            const h = history[Math.min(i, history.length - 1)];
            p.setXYZ(i, h.x + (Math.random() - 0.5) * i * 0.08, h.y, h.z + (Math.random() - 0.5) * i * 0.08);
          }
          p.needsUpdate = true;
          if (k >= 1) {
            this.scene.remove(rock, trail);
            rock.geometry.dispose(); trailGeo.dispose();
            this.explosion(x, ground, z);
            resolve();
            return false;
          }
          return true;
        },
      });
    });
  }

  explosion(x, y, z) {
    this.shake = 1.2;
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(x, y, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(x, y + 0.5, z);
    const light = new THREE.PointLight(0xff8a3a, 4000, 120, 1.5);
    light.position.set(x, y + 6, z);
    const n = 260;
    const debrisGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y + 1; pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 30;
      vel.push(new THREE.Vector3(Math.cos(a) * s, 15 + Math.random() * 35, Math.sin(a) * s));
    }
    debrisGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const debris = new THREE.Points(debrisGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xff7a30, size: 2.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    debris.frustumCulled = false;
    const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x554b44, transparent: true, opacity: 0, depthWrite: false }));
    smoke.position.set(x, y + 8, z);
    this.scene.add(flash, ring, light, debris, smoke);
    this.active.push({
      t: 0, dur: 3.2,
      update: (e, dt) => {
        const k = e.t / e.dur;
        flash.scale.setScalar(4 + k * 40);
        flash.material.opacity = Math.max(0, 1 - k * 3);
        ring.scale.setScalar(2 + k * 70);
        ring.material.opacity = Math.max(0, 1 - k * 1.6);
        light.intensity = Math.max(0, 4000 * (1 - k * 2.5));
        const p = debrisGeo.attributes.position;
        for (let i = 0; i < n; i++) {
          const v = vel[i];
          v.y -= 40 * dt;
          let px = p.getX(i) + v.x * dt, py = p.getY(i) + v.y * dt, pz = p.getZ(i) + v.z * dt;
          const g = this.terrain.heightAt(px, pz);
          if (py < g) { py = g; v.set(0, 0, 0); }
          p.setXYZ(i, px, py, pz);
        }
        p.needsUpdate = true;
        debris.material.opacity = Math.max(0, 1 - k * 1.1);
        smoke.material.opacity = Math.min(0.55, k * 2) * (1 - k);
        smoke.scale.setScalar(10 + k * 40);
        smoke.position.y = y + 8 + k * 20;
        if (k >= 1) {
          this.scene.remove(flash, ring, light, debris, smoke);
          flash.geometry.dispose(); ring.geometry.dispose(); debrisGeo.dispose();
          return false;
        }
        return true;
      },
    });
  }

  burst(x, z, color, radius = 30, rise = 10, count = 220, dur = 2.6) {
    const y0 = Math.max(0.3, this.terrain.heightAt(x, z));
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      seeds.push({ px, pz, base: Math.max(0.2, this.terrain.heightAt(px, pz)), sp: 0.5 + Math.random() });
      pos[i * 3] = px; pos[i * 3 + 2] = pz;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color, size: 0.9, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(x, y0 + 0.6, z);
    this.scene.add(pts, ring);
    this.active.push({
      t: 0, dur,
      update: (e) => {
        const k = e.t / e.dur;
        const p = geo.attributes.position;
        seeds.forEach((s, i) => p.setY(i, s.base + k * rise * s.sp + Math.sin(k * 10 + i) * 0.3));
        p.needsUpdate = true;
        pts.material.opacity = Math.sin(Math.PI * Math.min(1, k)) * 0.7;
        ring.scale.setScalar(1 + k * radius);
        ring.material.opacity = Math.max(0, 1 - k);
        if (k >= 1) { this.scene.remove(pts, ring); geo.dispose(); ring.geometry.dispose(); return false; }
        return true;
      },
    });
  }

  helix(getPos, color = 0xd17aff) {
    const n = 90;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color, size: 1.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    const tmp = new THREE.Vector3();
    this.active.push({
      t: 0, dur: 2.2,
      update: (e) => {
        const k = e.t / e.dur;
        const c = getPos(tmp);
        if (c) {
          const p = geo.attributes.position;
          for (let i = 0; i < n; i++) {
            const a = i * 0.35 + e.t * 6 + (i % 2) * Math.PI;
            const r = 1.4 * (1 - k * 0.5);
            p.setXYZ(i, c.x + Math.cos(a) * r, c.y + (i / n) * 5 * (0.4 + k), c.z + Math.sin(a) * r);
          }
          p.needsUpdate = true;
        }
        pts.material.opacity = Math.sin(Math.PI * Math.min(1, k));
        if (k >= 1) { this.scene.remove(pts); geo.dispose(); return false; }
        return true;
      },
    });
  }

  update(dt, camera) {
    // effects may spawn new effects (meteor -> explosion), so rebuild the list rather than filter in place
    const list = this.active;
    this.active = [];
    for (const e of list) { e.t += dt; if (e.update(e, dt)) this.active.push(e); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.4);
      const s = this.shake * this.shake * 1.6;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }
    if (this.reticle.visible) this.reticle.rotation.y += dt * 1.5;
  }
}
