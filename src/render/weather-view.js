// Clouds, rain, snow and lightning bolts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './resources-view.js';

const RAIN = 5000;
const SNOW = 3500;
const BOX = { x: 180, y: 90, z: 180 };

export class WeatherView {
  constructor(scene) {
    this.scene = scene;
    // clouds: soft puffy clusters
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, flatShading: true });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 30; i++) {
      const parts = [];
      const n = 5 + Math.floor(Math.random() * 5);
      for (let j = 0; j < n; j++) {
        const g = new THREE.IcosahedronGeometry(4 + Math.random() * 5, 1);
        g.translate((j - n / 2) * 4.5 + Math.random() * 3, Math.random() * 3, Math.random() * 6 - 3);
        parts.push(g);
      }
      const geo = mergeGeometries(parts);
      geo.scale(1, 0.55, 1);
      const m = new THREE.Mesh(geo, cloudMat);
      m.position.set(Math.random() * 520 - 260, 62 + Math.random() * 25, Math.random() * 520 - 260);
      m.rotation.y = Math.random() * Math.PI;
      m.userData.speed = 0.6 + Math.random() * 0.8;
      m.userData.threshold = i / 30;
      m.castShadow = true;
      scene.add(m);
      this.clouds.push(m);
    }

    // rain streaks
    const rpos = new Float32Array(RAIN * 6);
    this.rainSeeds = new Float32Array(RAIN * 3);
    for (let i = 0; i < RAIN; i++) {
      this.rainSeeds[i * 3] = Math.random() * BOX.x - BOX.x / 2;
      this.rainSeeds[i * 3 + 1] = Math.random() * BOX.y;
      this.rainSeeds[i * 3 + 2] = Math.random() * BOX.z - BOX.z / 2;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // snow flakes
    const spos = new Float32Array(SNOW * 3);
    this.snowSeeds = new Float32Array(SNOW * 4);
    for (let i = 0; i < SNOW; i++) {
      this.snowSeeds[i * 4] = Math.random() * BOX.x - BOX.x / 2;
      this.snowSeeds[i * 4 + 1] = Math.random() * BOX.y;
      this.snowSeeds[i * 4 + 2] = Math.random() * BOX.z - BOX.z / 2;
      this.snowSeeds[i * 4 + 3] = Math.random() * 6.28;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false }));
    this.snow.frustumCulled = false;
    scene.add(this.snow);

    // lightning bolt
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0 }));
    this.bolt.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);
    this.boltLife = 0;
    this.rainAmt = 0;
    this.snowAmt = 0;
    this.cover = 0;
  }

  strike(x, z, ground) {
    const pos = this.bolt.geometry.attributes.position;
    let cx = x + (Math.random() - 0.5) * 20, cz = z + (Math.random() - 0.5) * 20;
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const y = 80 * (1 - t) + ground * t;
      cx += (x - cx) * 0.25 + (Math.random() - 0.5) * 4;
      cz += (z - cz) * 0.25 + (Math.random() - 0.5) * 4;
      pos.setXYZ(i, i === 15 ? x : cx, y, i === 15 ? z : cz);
    }
    pos.needsUpdate = true;
    this.boltLife = 0.35;
  }

  update(dt, time, world, env, center, terrain) {
    const w = world.weather;
    const rainT = w === 'Rain' ? 0.7 : w === 'Storm' ? 1 : 0;
    const snowT = w === 'Snow' ? 1 : 0;
    this.rainAmt += (rainT - this.rainAmt) * Math.min(1, dt * 0.6);
    this.snowAmt += (snowT - this.snowAmt) * Math.min(1, dt * 0.6);
    const coverT = w === 'Clear' || w === 'Heatwave' ? 0.2 : w === 'Cloudy' ? 0.75 : 1;
    this.cover += (coverT - this.cover) * Math.min(1, dt * 0.4);

    const wind = w === 'Storm' ? 6 : 2;
    const dark = w === 'Storm' ? 0.35 : w === 'Rain' ? 0.55 : w === 'Snow' ? 0.8 : 1;
    this.cloudMat.color.setRGB(dark, dark, dark * 1.04);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * wind * dt;
      if (c.position.x > 300) c.position.x = -300;
      c.visible = c.userData.threshold < this.cover;
    }

    // rain
    const rp = this.rain.geometry.attributes.position;
    const rainVisible = this.rainAmt > 0.02;
    this.rain.visible = rainVisible;
    if (rainVisible) {
      const fall = 70, len = 1.6;
      const slant = wind * 0.12;
      for (let i = 0; i < RAIN; i++) {
        let y = (this.rainSeeds[i * 3 + 1] - time * fall) % BOX.y;
        if (y < 0) y += BOX.y;
        const x = center.x + this.rainSeeds[i * 3];
        const z = center.z + this.rainSeeds[i * 3 + 2];
        const yy = y - 10 + center.y;
        rp.setXYZ(i * 2, x, yy, z);
        rp.setXYZ(i * 2 + 1, x - slant * len, yy - len, z);
      }
      rp.needsUpdate = true;
      this.rain.material.opacity = 0.42 * this.rainAmt;
    }
    // snow
    const sp = this.snow.geometry.attributes.position;
    const snowVisible = this.snowAmt > 0.02;
    this.snow.visible = snowVisible;
    if (snowVisible) {
      for (let i = 0; i < SNOW; i++) {
        let y = (this.snowSeeds[i * 4 + 1] - time * 4.5) % BOX.y;
        if (y < 0) y += BOX.y;
        const ph = this.snowSeeds[i * 4 + 3];
        sp.setXYZ(i,
          center.x + this.snowSeeds[i * 4] + Math.sin(time * 0.8 + ph) * 1.5,
          y - 10 + center.y,
          center.z + this.snowSeeds[i * 4 + 2] + Math.cos(time * 0.6 + ph) * 1.5);
      }
      sp.needsUpdate = true;
      this.snow.material.opacity = 0.9 * this.snowAmt;
    }

    // lightning
    if (world.lightning && world.lightning.length) {
      const l = world.lightning[0];
      this.strike(l.x, l.z, terrain.heightAt(l.x, l.z));
    } else if (env.flash > 0.9 && this.boltLife <= 0) {
      const x = center.x + (Math.random() - 0.5) * 150, z = center.z + (Math.random() - 0.5) * 150;
      this.strike(x, z, Math.max(0, terrain.heightAt(x, z)));
    }
    this.boltLife -= dt;
    this.bolt.material.opacity = this.boltLife > 0 ? Math.min(1, this.boltLife * 4) : 0;
    this.bolt.visible = this.boltLife > 0;
  }
}
