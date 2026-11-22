// Sky dome, sun/moon lighting, fog and day/night + weather mood.
import * as THREE from 'three';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // keep at far plane
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uCloud;
uniform float uFlash;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-y * 4.0, 0.0, 1.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 * (1.0 - uCloud) + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9996, m) * 1.4 + pow(m, 80.0) * 0.08) * uStars;
  // stars
  if (y > 0.0 && uStars > 0.01) {
    vec3 cell = floor(d * 260.0);
    float h = hash(cell);
    float star = step(0.9965, h) * (0.5 + 0.5 * hash(cell + 7.0));
    col += vec3(star) * uStars * smoothstep(0.0, 0.25, y) * (1.0 - uCloud * 0.9);
  }
  col += vec3(0.7, 0.75, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  dayTop: C(0x2f6fcf), dayHorizon: C(0xa9d3f2),
  duskTop: C(0x27356e), duskHorizon: C(0xf59a62),
  nightTop: C(0x040814), nightHorizon: C(0x13234a),
  ground: C(0x0d1d2a),
  overcastTop: C(0x6f7c8a), overcastHorizon: C(0xaab3bb),
  stormTop: C(0x2a3038), stormHorizon: C(0x4f5862),
};

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: PALETTE.ground.clone() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uStars: { value: 0 },
      uCloud: { value: 0 },
      uFlash: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3d4a2c, 0.9);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xa9d3f2, 0.0018);
    this.flash = 0;
    this.cloudiness = 0;
    this.daylight = 1;
    this._tmp = new THREE.Color();
  }

  // world: worldInfo snapshot; dt seconds
  update(world, dt) {
    const t = world.timeOfDay;
    const ang = 2 * Math.PI * (t - 0.25);
    const elev = Math.sin(ang);
    // sun travels east->west, tilted toward south
    const sunDir = new THREE.Vector3(Math.cos(ang), elev, 0.35).normalize();
    const moonDir = sunDir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.9 + 0.1;
    moonDir.normalize();
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uMoonDir.value.copy(moonDir);

    const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.32) * THREE.MathUtils.smoothstep(elev, -0.25, 0.0);
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.3, 0.02);
    this.daylight = day;

    const w = world.weather;
    const targetCloud = w === 'Storm' ? 1 : w === 'Rain' ? 0.75 : w === 'Snow' ? 0.65 : w === 'Cloudy' ? 0.45 : w === 'Heatwave' ? 0 : 0.08;
    this.cloudiness += (targetCloud - this.cloudiness) * Math.min(1, dt * 0.5);
    const cl = this.cloudiness;

    const top = this.uniforms.uTop.value;
    const hor = this.uniforms.uHorizon.value;
    top.copy(PALETTE.nightTop).lerp(PALETTE.duskTop, Math.min(1, dusk + day * 0.4)).lerp(PALETTE.dayTop, day);
    hor.copy(PALETTE.nightHorizon).lerp(PALETTE.duskHorizon, dusk).lerp(PALETTE.dayHorizon, day * (1 - dusk * 0.6));
    const grayTop = this._tmp.copy(PALETTE.overcastTop).lerp(PALETTE.stormTop, Math.max(0, cl - 0.6) * 2.5);
    top.lerp(grayTop.multiplyScalar(0.15 + 0.85 * Math.max(day, 0.05)), cl * 0.75);
    const grayHor = new THREE.Color().copy(PALETTE.overcastHorizon).lerp(PALETTE.stormHorizon, Math.max(0, cl - 0.6) * 2.5);
    hor.lerp(grayHor.multiplyScalar(0.12 + 0.88 * Math.max(day, 0.04)), cl * 0.7);
    if (w === 'Heatwave') hor.lerp(new THREE.Color(0xf2d29a), 0.25 * day);

    const sunCol = this.uniforms.uSunColor.value;
    sunCol.setRGB(1, 0.92, 0.78).lerp(new THREE.Color(1, 0.55, 0.25), dusk);
    this.uniforms.uStars.value = night;
    this.uniforms.uCloud.value = cl;

    // lighting: one shadow-casting light that is the sun by day and the moon by night
    const useSun = elev > -0.08;
    const lightDir = useSun ? sunDir : moonDir;
    this.sun.position.copy(lightDir).multiplyScalar(300);
    this.sun.target.position.set(0, 0, 0);
    if (useSun) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = (0.25 + 2.6 * day) * (1 - cl * 0.6) * THREE.MathUtils.smoothstep(elev, -0.08, 0.08);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.85 * (1 - cl * 0.5) * THREE.MathUtils.smoothstep(-elev, 0.08, 0.3);
    }
    this.hemi.color.setRGB(0.75, 0.85, 1.0).lerp(new THREE.Color(0.32, 0.42, 0.75), night);
    this.hemi.groundColor.setRGB(0.3, 0.33, 0.22).lerp(new THREE.Color(0.05, 0.06, 0.1), night);
    this.hemi.intensity = 0.35 + 0.75 * day + 0.38 * night;

    // lightning flashes
    if (w === 'Storm' && Math.random() < dt * 0.18) this.flash = 1;
    if (world.lightning && world.lightning.length) this.flash = 1.2;
    this.flash = Math.max(0, this.flash - dt * 4.5);
    const f = this.flash > 0.6 || (this.flash > 0.2 && this.flash < 0.35) ? this.flash : 0;
    this.uniforms.uFlash.value = f * 0.6;
    this.hemi.intensity += f * 2.2;

    const fogCol = this.scene.fog.color;
    fogCol.copy(hor);
    this.scene.fog.density = 0.0016 + cl * 0.0016 + (w === 'Snow' ? 0.0012 : 0) + night * 0.0006;
    return { sunDir, day, night, dusk, cloud: cl, flash: f };
  }
}
