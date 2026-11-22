// Island mesh with seasonal vertex colouring, animated shoreline water, trees and rocks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, WORLD_SIZE, TERRAIN_RES } from '../sim/constants.js';
import { RNG, clamp, smoothstep } from '../sim/rng.js';

const col = (h) => new THREE.Color(h);
const PAL = {
  sand: col(0xd9c48f), wetSand: col(0xa8946a),
  grassSpring: col(0x6fbf4a), grassSummer: col(0x7fae3c), grassAutumn: col(0xa89a3e), grassWinter: col(0x8a9a7a),
  forest: col(0x3f7a33), forestAutumn: col(0x8a6a2a),
  rock: col(0x7c776f), rockDark: col(0x5b5852),
  snow: col(0xf2f6fb), seabed: col(0x3d5a5c),
  scorched: col(0x2c2622),
};

const waterVert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  wp.y += sin(wp.x * 0.08 + uTime * 0.9) * 0.12 + cos(wp.z * 0.07 + uTime * 0.7) * 0.12;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const waterFrag = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform float uDay;
uniform float uHalf;
varying vec3 vWorld;
#include <fog_pars_fragment>

float terrainH(vec2 xz) {
  vec2 uv = (xz + uHalf) / (uHalf * 2.0);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -14.0;
  return texture2D(uHeight, uv).r * 60.0 - 20.0;
}

void main() {
  float h = terrainH(vWorld.xz);
  float depth = clamp(-h, 0.0, 16.0);
  vec2 q = vWorld.xz;
  float t = uTime;
  vec3 n = normalize(vec3(
    sin(q.x * 0.35 + t * 1.3) * 0.08 + sin(q.x * 0.9 + q.y * 0.4 + t * 2.1) * 0.05 + sin(q.y * 1.7 - t * 1.7) * 0.02,
    1.0,
    cos(q.y * 0.31 + t * 1.1) * 0.08 + cos(q.y * 0.8 - q.x * 0.5 + t * 1.9) * 0.05 + cos(q.x * 1.5 + t * 1.6) * 0.02));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 deep = vec3(0.015, 0.11, 0.2);
  vec3 shallow = vec3(0.08, 0.52, 0.55);
  vec3 c = mix(shallow, deep, smoothstep(0.0, 9.0, depth));
  float diffuse = 0.45 + 0.55 * max(dot(n, uSunDir), 0.0);
  c *= diffuse * (0.18 + 0.82 * uDay);
  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);
  c = mix(c, uSky, fres * 0.65);
  vec3 hv = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, hv), 0.0), 180.0);
  c += uSunColor * spec * 1.6 * smoothstep(-0.05, 0.1, uSunDir.y);
  // animated shoreline foam
  float foamBand = smoothstep(1.4, 0.0, depth);
  float waves = 0.5 + 0.5 * sin(depth * 9.0 - t * 2.4 + sin(q.x * 0.3) * 2.0);
  c += vec3(0.85, 0.95, 1.0) * foamBand * (0.35 + 0.45 * waves) * (0.25 + 0.75 * uDay);
  float alpha = mix(0.6, 0.94, smoothstep(0.0, 3.5, depth));
  gl_FragColor = vec4(c, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function cameraFade(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fadeWp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fadeWp = instanceMatrix * fadeWp;
      #endif
      vFadeWorld = (modelMatrix * fadeWp).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float fadeK = smoothstep(4.0, 11.0, distance(vFadeWorld, cameraPosition));
      float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (fadeK < 0.999 && fadeK < dither) discard;`);
}

export class TerrainView {
  constructor(scene, terrain, seed) {
    this.scene = scene;
    this.terrain = terrain;
    this.rng = new RNG(seed * 31 + 5);
    this.seasonBlend = -1;
    this.scorch = new Float32Array(TERRAIN_RES * TERRAIN_RES);
    this.buildMesh();
    this.buildWater();
    this.buildTrees();
    this.buildRocks();
  }

  buildMesh() {
    const R = TERRAIN_RES;
    const t = this.terrain;
    const pos = new Float32Array(R * R * 3);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const k = j * R + i;
        pos[k * 3] = -HALF + i * t.cell;
        pos[k * 3 + 1] = t.heights[k];
        pos[k * 3 + 2] = -HALF + j * t.cell;
      }
    }
    const idx = [];
    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < R - 1; i++) {
        const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(R * R * 3), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.noise = new Float32Array(R * R);
    for (let k = 0; k < R * R; k++) this.noise[k] = this.rng.next();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.scene.add(this.mesh);

    // ocean floor skirt beyond the island grid
    const skirt = new THREE.Mesh(new THREE.RingGeometry(HALF * 1.38, 1600, 64, 1), new THREE.MeshStandardMaterial({ color: PAL.seabed, roughness: 1 }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -14;
    this.scene.add(skirt);
    const skirtInner = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4), skirt.material);
    skirtInner.rotation.x = -Math.PI / 2;
    skirtInner.position.y = -14.2;
    this.scene.add(skirtInner);

    // height texture for water depth shading
    this.heightTex = new THREE.DataTexture(new Uint8Array(R * R * 4), R, R, THREE.RGBAFormat);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.updateHeightTexture();
  }

  updateHeightTexture() {
    const d = this.heightTex.image.data;
    const h = this.terrain.heights;
    for (let k = 0; k < h.length; k++) d[k * 4] = clamp(Math.round(((h[k] + 20) / 60) * 255), 0, 255);
    this.heightTex.needsUpdate = true;
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(1600, 1600, 160, 160);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeight: { value: null },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.6, 0.8, 1) },
        uDay: { value: 1 },
        uHalf: { value: HALF },
      },
    ]);
    this.waterUniforms.uHeight.value = this.heightTex;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, vertexShader: waterVert, fragmentShader: waterFrag,
      transparent: true, fog: true, depthWrite: false,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0.05;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
  }

  // seasonal palette: yearPhase 0..1 (0 = start of spring)
  colorize(yearPhase, force = false) {
    const blend = Math.round(yearPhase * 200) / 200;
    if (!force && blend === this.seasonBlend) return;
    // recolouring 26k vertices is the priciest main-thread job: cap it at ~2x per second
    const now = performance.now();
    if (!force && now - (this.lastColorize || 0) < 600) return;
    this.lastColorize = now;
    this.seasonBlend = blend;
    const s = yearPhase * 4; // 0..4
    const grass = new THREE.Color();
    const forest = new THREE.Color();
    // smooth seasonal interpolation
    const seq = [PAL.grassSpring, PAL.grassSummer, PAL.grassAutumn, PAL.grassWinter, PAL.grassSpring];
    const i0 = Math.floor(s) % 4, f = s - Math.floor(s);
    const ease = smoothstep(0.55, 1, f);
    grass.copy(seq[i0]).lerp(seq[i0 + 1], ease);
    const fseq = [PAL.forest, PAL.forest, PAL.forestAutumn, PAL.forest.clone().lerp(PAL.grassWinter, 0.5), PAL.forest];
    forest.copy(fseq[i0]).lerp(fseq[i0 + 1], ease);
    // snowline drops in winter
    const winterAmt = i0 === 3 ? smoothstep(0, 0.25, f) * (1 - smoothstep(0.75, 1, f)) : i0 === 2 ? smoothstep(0.7, 1, f) * 0.6 : 0;
    const snowLine = 22 - winterAmt * 14;

    const R = TERRAIN_RES;
    const t = this.terrain;
    const colors = this.mesh.geometry.attributes.color;
    const normals = this.mesh.geometry.attributes.normal;
    const c = new THREE.Color();
    for (let k = 0; k < R * R; k++) {
      const h = t.heights[k];
      const m = t.moisture[k];
      const ny = normals.getY(k);
      const n = this.noise[k];
      if (h < -0.4) c.copy(PAL.seabed).lerp(PAL.wetSand, smoothstep(-6, -0.4, h));
      else if (h < 1.3) c.copy(PAL.wetSand).lerp(PAL.sand, smoothstep(-0.4, 0.6, h));
      else {
        c.copy(PAL.sand).lerp(grass, smoothstep(1.2, 2.2, h));
        if (m > 0.02) c.lerp(forest, smoothstep(0.02, 0.2, m) * smoothstep(1.6, 3, h) * (1 - smoothstep(11, 14, h)));
        c.lerp(PAL.rock, smoothstep(10, 15, h));
        c.lerp(PAL.rockDark, smoothstep(0.82, 0.62, ny) * 0.9);
        const snow = smoothstep(snowLine - 1.5, snowLine + 1.5, h + n * 2) * smoothstep(0.55, 0.8, ny);
        c.lerp(PAL.snow, snow);
        if (winterAmt > 0.3 && h < snowLine) c.lerp(PAL.snow, (winterAmt - 0.3) * 0.45 * smoothstep(0.7, 0.95, ny) * (0.5 + n * 0.5));
      }
      const v = 0.92 + n * 0.16;
      c.multiplyScalar(v);
      if (this.scorch[k] > 0) c.lerp(PAL.scorched, this.scorch[k]);
      colors.setXYZ(k, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
    this.updateTreeColors(i0, ease);
  }

  applyCrater(x, z, radius, depth) {
    const { i0, i1, j0, j1 } = this.terrain.applyCrater(x, z, radius, depth);
    const R = TERRAIN_RES;
    const pos = this.mesh.geometry.attributes.position;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * R + i;
        pos.setY(k, this.terrain.heights[k]);
        const d = Math.hypot(-HALF + i * this.terrain.cell - x, -HALF + j * this.terrain.cell - z) / radius;
        this.scorch[k] = Math.max(this.scorch[k], clamp(1.3 - d * 0.65, 0, 0.9));
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.updateHeightTexture();
    // knock down trees in the blast
    this.blastTrees(x, z, radius * 1.7);
    this.colorize(this.lastYearPhase ?? 0, true);
  }

  buildTrees() {
    const t = this.terrain;
    const pines = [], leafy = [];
    for (let n = 0; n < 9000 && pines.length + leafy.length < 1500; n++) {
      const x = this.rng.float(-HALF, HALF), z = this.rng.float(-HALF, HALF);
      const h = t.heightAt(x, z);
      if (h < 1.8 || h > 17) continue;
      const m = t.moistureAt(x, z);
      const slope = t.slopeAt(x, z);
      if (slope > 1.0) continue;
      const forest = m > 0.06 && h < 13;
      if (!forest && !(this.rng.chance(0.06) && h < 10)) continue;
      const s = this.rng.float(0.7, 1.35);
      const rec = { x, z, y: h - 0.2, s, rot: this.rng.float(0, Math.PI * 2), hue: this.rng.next(), alive: true };
      if (h > 8.5 || (m > 0.25 && this.rng.chance(0.5))) pines.push(rec); else leafy.push(rec);
    }
    this.pines = pines; this.leafy = leafy;

    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6);
    trunkGeo.translate(0, 0.7, 0);
    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(1.1, 2.0, 7).translate(0, 1.9, 0),
      new THREE.ConeGeometry(0.85, 1.7, 7).translate(0, 2.7, 0),
      new THREE.ConeGeometry(0.55, 1.3, 7).translate(0, 3.4, 0),
    ]);
    const leafGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(1.05, 1).translate(0, 2.1, 0),
      new THREE.IcosahedronGeometry(0.75, 1).translate(0.55, 2.6, 0.2),
      new THREE.IcosahedronGeometry(0.7, 1).translate(-0.45, 2.5, -0.3),
    ]);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1 });
    const folMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    // dithered fade for trees right in front of the camera so close-ups are never blocked
    for (const m of [trunkMat, folMat]) m.onBeforeCompile = cameraFade;
    const all = pines.length + leafy.length;
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all);
    this.pineMesh = new THREE.InstancedMesh(pineGeo, folMat, Math.max(1, pines.length));
    this.leafMesh = new THREE.InstancedMesh(leafGeo, folMat, Math.max(1, leafy.length));
    for (const m of [this.trunks, this.pineMesh, this.leafMesh]) { m.castShadow = true; m.receiveShadow = true; }
    this.writeTreeMatrices();
    this.scene.add(this.trunks, this.pineMesh, this.leafMesh);
  }

  writeTreeMatrices() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let ti = 0;
    const put = (arr, mesh) => {
      arr.forEach((r, i) => {
        q.setFromAxisAngle(up, r.rot);
        p.set(r.x, r.y, r.z);
        const sc = r.alive ? r.s : 0.0001;
        s.set(sc, sc * (mesh === this.pineMesh ? 1.15 : 1), sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        this.trunks.setMatrixAt(ti++, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    put(this.pines, this.pineMesh);
    put(this.leafy, this.leafMesh);
    this.trunks.instanceMatrix.needsUpdate = true;
  }

  clearTrees(x, z, r) {
    let any = false;
    for (const t of [...this.pines, ...this.leafy]) {
      if (t.alive && Math.hypot(t.x - x, t.z - z) < r) { t.alive = false; any = true; }
    }
    if (any) this.writeTreeMatrices();
  }

  blastTrees(x, z, r) {
    let any = false;
    for (const t of [...this.pines, ...this.leafy]) {
      if (t.alive && Math.hypot(t.x - x, t.z - z) < r) { t.alive = false; any = true; }
      else if (Math.hypot(t.x - x, t.z - z) < r * 2) t.y = this.terrain.heightAt(t.x, t.z) - 0.2;
    }
    if (any) this.writeTreeMatrices();
  }

  updateTreeColors(season, ease) {
    const c = new THREE.Color();
    const pine = col(0x2f5d34), pineSnow = col(0xd8e4e8);
    const leafSeason = [col(0x7ccf4f), col(0x4f9a3a), null, col(0x9a8f78)];
    const autumn = [col(0xe0892f), col(0xc9452b), col(0xe8c33a), col(0x9c6b2d)];
    const pick = (si, r) => (si === 2 ? autumn[Math.floor(r.hue * 4)] : leafSeason[si]);
    this.pines.forEach((r, i) => {
      const snow = (season === 3 ? 1 - Math.max(0, ease) : season === 2 ? ease : 0) * (0.35 + 0.3 * r.hue);
      c.copy(pine).multiplyScalar(0.85 + 0.3 * r.hue).lerp(pineSnow, snow);
      this.pineMesh.setColorAt(i, c);
    });
    this.leafy.forEach((r, i) => {
      const a = pick(season, r), b = pick((season + 1) % 4, r);
      c.copy(a).lerp(b, ease).multiplyScalar(0.85 + 0.3 * r.hue);
      this.leafMesh.setColorAt(i, c);
    });
    if (this.pineMesh.instanceColor) this.pineMesh.instanceColor.needsUpdate = true;
    if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
  }

  buildRocks() {
    const t = this.terrain;
    const rocks = [];
    for (let n = 0; n < 6000 && rocks.length < 420; n++) {
      const x = this.rng.float(-HALF, HALF), z = this.rng.float(-HALF, HALF);
      const h = t.heightAt(x, z);
      if (h < 0.4) continue;
      const slope = t.slopeAt(x, z);
      if (h > 11 || slope > 0.9 || (h < 1.4 && this.rng.chance(0.08))) rocks.push({ x, z, y: h, s: this.rng.float(0.4, 1.6) * (h > 11 ? 1.4 : 0.7) });
    }
    const geo = new THREE.DodecahedronGeometry(0.8, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, rocks.length);
    const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion();
    rocks.forEach((r, i) => {
      e.set(this.rng.next() * 3, this.rng.next() * 3, this.rng.next() * 3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(r.x, r.y - 0.2, r.z), q, new THREE.Vector3(r.s, r.s * 0.7, r.s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color().setHSL(0.08, 0.06, 0.38 + this.rng.next() * 0.18));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  update(time, env, skyColor, yearPhase) {
    this.lastYearPhase = yearPhase;
    const u = this.waterUniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(env.sunDir);
    u.uDay.value = Math.max(0.12, env.day);
    u.uSky.value.copy(skyColor);
    this.colorize(yearPhase);
  }
}
