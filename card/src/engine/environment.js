// Sun, sky, weather and surface state (wet / snow) for the scene.
import * as THREE from 'three';
import { grassColor } from './catalog.js';

const DEG = Math.PI / 180;
const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Sun elevation (rad) and unit direction toward the sun in world axes (x east, z south). */
export function sunPosition(doy, hour, latDeg, northOffsetDeg = 0) {
  const lat = latDeg * DEG;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const H = (hour - 12) * 15 * DEG;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.min(1, Math.max(-1, sinEl)));
  // azimuth measured from the south, positive toward the west
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + northOffsetDeg * DEG;
  const ce = Math.cos(el);
  const dir = new THREE.Vector3(-Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
  return { elevation: el, dir };
}

export const WEATHER_PRESETS = {
  clear: { label: 'Dégagé', cloud: 0.05, precip: 0, precipType: 'none', wind: 0.15, fog: 0, temp: 18, lightning: false },
  cloudy: { label: 'Nuageux', cloud: 0.75, precip: 0, precipType: 'none', wind: 0.3, fog: 0, temp: 14, lightning: false },
  rain: { label: 'Pluie', cloud: 0.92, precip: 0.6, precipType: 'rain', wind: 0.35, fog: 0.004, temp: 11, lightning: false },
  storm: { label: 'Orage', cloud: 1, precip: 1, precipType: 'rain', wind: 0.9, fog: 0.006, temp: 16, lightning: true },
  snow: { label: 'Neige', cloud: 0.85, precip: 0.55, precipType: 'snow', wind: 0.15, fog: 0.006, temp: -2, lightning: false },
  fog: { label: 'Brouillard', cloud: 0.6, precip: 0, precipType: 'none', wind: 0.05, fog: 0.012, temp: 8, lightning: false },
};

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform float uWind;
attribute float aEnd;
attribute float aSeed;
varying float vEnd;
void main() {
  float speed = 16.0 + 6.0 * aSeed;
  float y = mod(position.y * uBox.y - uTime * speed, uBox.y);
  vec3 slant = vec3(uWind * 0.25, 0.0, uWind * 0.1);
  vec3 p = uCenter + vec3((position.x - 0.5) * uBox.x, y, (position.z - 0.5) * uBox.z);
  p += slant * (uBox.y - y);
  vec3 up = normalize(vec3(-slant.x, 1.0, -slant.z));
  p += up * aEnd * 0.9;
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vEnd;
void main() { gl_FragColor = vec4(uColor, uAlpha * (1.0 - vEnd * 0.7)); }
`;

const SNOW_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform float uWind;
uniform float uPx; // pixels per world unit
attribute float aSeed;
void main() {
  float speed = 1.1 + 1.2 * aSeed;
  float y = mod(position.y * uBox.y - uTime * speed, uBox.y);
  float sway = sin(uTime * 0.9 + aSeed * 40.0) * 0.5;
  vec3 p = uCenter + vec3((position.x - 0.5) * uBox.x + sway + uWind * (uBox.y - y) * 0.2, y, (position.z - 0.5) * uBox.z + sway * 0.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_PointSize = max(2.0, 0.09 * uPx * (0.7 + aSeed * 0.6));
}
`;
const SNOW_FRAG = /* glsl */ `
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.9);
}
`;

export class Environment {
  constructor(scene, renderer, site) {
    this.scene = scene;
    this.renderer = renderer;
    this.site = site;
    this.state = { hour: 18.2, doy: 275, weather: 'clear', ...WEATHER_PRESETS.clear };
    this.snowCover = 0;
    this.wetness = 0;
    this.surfaces = []; // { material, base, snow, wet, key }
    this.time = 0;
    this.flash = 0;
    this.nextFlash = 3;
    this.glow = 1;
    this.night = 1;

    const center = new THREE.Vector3(...site.center);
    this.center = center;

    this.hemi = new THREE.HemisphereLight('#bcd8ff', '#5b5a48', 0.6);
    this.ambient = new THREE.AmbientLight('#ffffff', 0.05);
    this.moon = new THREE.DirectionalLight('#7f9cff', 0.3);
    this.moon.position.set(-18, 40, 14).add(center);
    this.moon.target.position.copy(center);
    this.sun = new THREE.DirectionalLight('#fff4e6', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.copy(center);
    scene.add(this.hemi, this.ambient, this.moon, this.moon.target, this.sun, this.sun.target);

    scene.background = new THREE.Color('#9ed3f7');
    scene.fog = new THREE.FogExp2('#9ed3f7', 0);

    this._buildParticles();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.elevationDeg = 30;
    this.applyState();
  }

  /** Re-center sun shadows and particles on a new site (called when a scene is loaded). */
  setSite(site) {
    this.site = site;
    const center = new THREE.Vector3(...site.center);
    this.center.copy(center);
    this.sun.target.position.copy(center);
    this.moon.position.set(-18, 40, 14).add(center);
    this.moon.target.position.copy(center);
    const plot = site.plot;
    const half = Math.max(25, 0.62 * Math.max(plot.x1 - plot.x0, plot.z1 - plot.z0));
    const sc = this.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.far = 120 + half * 2;
    sc.updateProjectionMatrix();
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    const c0 = new THREE.Vector3(center.x, 0, center.z);
    this.rainMat.uniforms.uCenter.value.copy(c0);
    this.snowMat.uniforms.uCenter.value.copy(c0);
    this.surfaces = [];
    this.applyState();
  }

  registerSurface(entry) {
    if (!entry.base) entry.base = entry.material.color.clone();
    this.surfaces.push(entry);
    return entry;
  }

  setState(partial) {
    Object.assign(this.state, partial);
    this.applyState();
  }

  setWeather(name) {
    const p = WEATHER_PRESETS[name];
    if (!p) return;
    this.setState({ weather: name, ...p });
  }

  // ---------------------------------------------------------------- particles

  _buildParticles() {
    const box = new THREE.Vector3(56, 24, 56);
    const center = this.center.clone();
    center.y = 0;

    // rain: line segments animated in the vertex shader
    const NR = 9000;
    const rp = new Float32Array(NR * 2 * 3);
    const re = new Float32Array(NR * 2);
    const rs = new Float32Array(NR * 2);
    for (let i = 0; i < NR; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      const s = Math.random();
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        rp[o] = x;
        rp[o + 1] = y;
        rp[o + 2] = z;
        re[i * 2 + k] = k;
        rs[i * 2 + k] = s;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 1));
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uCenter: { value: center },
        uWind: { value: 0 },
        uColor: { value: new THREE.Color('#c8dcff') },
        uAlpha: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainCount = NR;
    this.scene.add(this.rain);

    // snow: points
    const NS = 7000;
    const sp = new Float32Array(NS * 3);
    const ss = new Float32Array(NS);
    for (let i = 0; i < NS; i++) {
      sp[i * 3] = Math.random();
      sp[i * 3 + 1] = Math.random();
      sp[i * 3 + 2] = Math.random();
      ss[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uCenter: { value: center },
        uWind: { value: 0 },
        uPx: { value: 30 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.snowCount = NS;
    this.scene.add(this.snow);
  }

  // ---------------------------------------------------------------- state -> lighting

  applyState() {
    const s = this.state;
    const sp = sunPosition(s.doy, s.hour, this.site.latitude, this.site.northOffsetDeg);
    this.sunDir.copy(sp.dir);
    const elDeg = sp.elevation / DEG;
    this.elevationDeg = elDeg;
    const cloud = s.cloud;

    const day = smooth(-4, 10, elDeg);
    const effDay = day * (1 - 0.35 * cloud);
    this.night = 1 - effDay;
    this.glow = 0.08 + 0.92 * Math.pow(this.night, 1.4);

    // sun
    const sunUp = elDeg > 0.5;
    this.sun.visible = sunUp;
    this.sun.castShadow = sunUp;
    this.sun.position.copy(this.center).addScaledVector(sp.dir, 70);
    this.sun.intensity = 3.2 * smooth(0, 14, elDeg) * (1 - 0.82 * cloud);
    this.sun.color.set('#ff9a55').lerp(new THREE.Color('#fff4e6'), smooth(0, 22, elDeg));
    if ('intensity' in this.sun.shadow) this.sun.shadow.intensity = 1 - 0.92 * cloud;

    // sky color
    const night = new THREE.Color('#0a0f20');
    const dayC = new THREE.Color('#9ed3f7');
    const sky = night.clone().lerp(dayC, day);
    const tw = Math.exp(-Math.pow((elDeg - 1) / 6, 2));
    sky.lerp(new THREE.Color('#e0885f'), tw * 0.65 * (1 - cloud * 0.6));
    const grey = new THREE.Color('#14181f').lerp(new THREE.Color('#b8c0c9'), day);
    sky.lerp(grey, cloud * 0.8);
    this.sky = sky;

    this.hemi.color.copy(sky).lerp(new THREE.Color('#ffffff'), 0.35);
    this.hemi.groundColor.set('#5b5a48');
    this._hemiBase = 0.34 + 0.62 * day * (1 - 0.15 * cloud);
    this.moon.intensity = 0.7 * (1 - day);
    this.ambient.intensity = 0.04 + 0.1 * (1 - day);

    this.scene.fog.color.copy(sky);
    this.scene.fog.density = s.fog;

    // weather particles
    this.rain.visible = s.precipType === 'rain' && s.precip > 0.02;
    this.snow.visible = s.precipType === 'snow' && s.precip > 0.02;
    this.rain.geometry.setDrawRange(0, Math.floor(this.rainCount * Math.min(1, s.precip)) * 2);
    this.snow.geometry.setDrawRange(0, Math.floor(this.snowCount * Math.min(1, s.precip * 1.4)));
    this.rainMat.uniforms.uWind.value = s.wind;
    this.snowMat.uniforms.uWind.value = s.wind;
    this.rainMat.uniforms.uAlpha.value = 0.25 + 0.4 * (0.4 + 0.6 * day);

    // grass follows the season
    for (const e of this.surfaces) if (e.key === 'grass') grassColor(s.doy, e.base);
  }

  // ---------------------------------------------------------------- per-frame

  update(dt, camera, viewportHeightPx) {
    this.time += dt;
    const s = this.state;

    // surface dynamics: snow accumulates when it snows, melts above 0 °C; ground gets wet under rain
    if (s.precipType === 'snow' && s.precip > 0.02) this.snowCover = Math.min(1, this.snowCover + dt * 0.08 * s.precip);
    else if (s.temp > 0) this.snowCover = Math.max(0, this.snowCover - dt * 0.004 * s.temp);
    if (s.precipType === 'rain' && s.precip > 0.02) this.wetness = Math.min(1, this.wetness + dt * 0.25 * s.precip);
    else this.wetness = Math.max(0, this.wetness - dt * 0.02);

    // lightning
    let flashBoost = 0;
    if (s.lightning) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 2.5 + Math.random() * 6;
      }
      this.flash = Math.max(0, this.flash - dt * 6);
      flashBoost = this.flash * (Math.random() > 0.3 ? 1 : 0.4);
    }
    this.hemi.intensity = this._hemiBase + flashBoost * 2.2;

    // particles
    this.rainMat.uniforms.uTime.value = this.time;
    this.snowMat.uniforms.uTime.value = this.time;
    const frustumH = (camera.top - camera.bottom) / camera.zoom;
    this.snowMat.uniforms.uPx.value = viewportHeightPx / frustumH;

    // surfaces
    const wetC = new THREE.Color('#2e3a2c');
    const snowC = new THREE.Color('#f2f6fb');
    const c = new THREE.Color();
    for (const e of this.surfaces) {
      c.copy(e.base);
      if (e.wet) c.lerp(wetC, this.wetness * e.wet * 0.5);
      if (e.snow) c.lerp(snowC, this.snowCover * e.snow);
      e.material.color.copy(c);
    }
    const bg = this.scene.background;
    bg.copy(this.sky);
    if (flashBoost) bg.lerp(new THREE.Color('#dfe8ff'), flashBoost * 0.6);
    this.scene.fog.color.copy(bg);
  }
}
