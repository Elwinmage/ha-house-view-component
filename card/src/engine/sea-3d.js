// The sea (or any wide water: lagoon, river, polder canal) around a house: a water plane at a given level whose colour
// follows the depth above the terrain (turquoise on the shallows, deep blue off shore), foam on the shore and in
// travelling breaker lines, a sun glint, and a beach (sand, pebbles, coral sand) on the terrain around the waterline.
//
// The depth is a vertex attribute (sea level - ground height at the vertex), so the plane needs no depth texture: it is a
// grid dense over the terrain and stretched out to the horizon. A tide offset moves the level and the shoreline.
import * as THREE from 'three';

export const BEACHES = ['sand', 'pebbles', 'coral', 'rock', 'none']; // none: the ground keeps its colour (grass banks, dikes)

/** Defaults and clean-up of the `sea` block of the edits: the settings are kept when the sea is off (null when none). */
export function normalizeSea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, d, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
  return {
    on: !!raw.on,
    level: num(raw.level, 0, -500, 4000), // altitude of the water (m, same datum as the terrain)
    beach: BEACHES.includes(raw.beach) ? raw.beach : 'sand',
    waves: num(raw.waves, 0.5, 0, 1), // 0 flat calm .. 1 storm
    tide: num(raw.tide, 0, 0, 6), // amplitude (m) of the tide, 0 = none
    tideRef: Number.isFinite(+raw.tideRef) && raw.tideRef !== null && raw.tideRef !== '' ? +raw.tideRef : null, // epoch (ms) of a real high water of the place: calibrates the tide on the calendar
    clarity: num(raw.clarity, 0.5, 0, 1), // 0 murky green .. 1 tropical clear
    sound: !!raw.sound, // the sound of the surf (after a first tap: browsers keep a page silent until then)
  };
}

/** The settings of the sea when it is on, else null. */
export const activeSea = (sea) => (sea && sea.on ? sea : null);

/** Waves (0..1) of the moment: the setting, pushed up by the wind of the weather (a storm raises the sea). */
export const seaWaves = (base, wind) => Math.min(1, Math.max(0, base + 0.7 * (wind - 0.15)));

/** Where the swell travels in the plan (x east, z south), from the bearing the wind comes from (degrees, 0 = north). */
export function swellDirection(bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  return [-Math.sin(b), Math.cos(b)];
}

/** Height above the water (m) up to which the ground is beach: a coral island is green inland, a dune is sand to its top. */
const BEACH_REACH = { sand: 3.5, pebbles: 3, coral: 0.95, rock: 5 };
const BEACH_COLORS = {
  sand: { wet: [0.55, 0.47, 0.34], dry: [0.9, 0.8, 0.58] },
  pebbles: { wet: [0.32, 0.3, 0.29], dry: [0.6, 0.57, 0.52] },
  coral: { wet: [0.72, 0.68, 0.58], dry: [0.96, 0.93, 0.82] },
  rock: { wet: [0.2, 0.2, 0.21], dry: [0.42, 0.4, 0.38] },
};
const lin = (c) => c.map((v) => v ** 2.2); // colours below are as seen (sRGB), the vertex colours are linear
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tint the vertex colours of the ground around the waterline (when there is no aerial photo): wet sand at the water,
 * dry sand up to a few metres above it where the ground is gentle, the underwater ground sandy too.
 * `pos` and `nrm` are the position / normal arrays of the ground mesh, `col` its colour array (rgb per vertex).
 */
export function tintBeach(pos, nrm, col, seaY, beach, reach = BEACH_REACH[beach]) {
  const raw = BEACH_COLORS[beach];
  if (!raw) return;
  const c = { wet: lin(raw.wet), dry: lin(raw.dry) };
  for (let k = 0; k < pos.length / 3; k++) {
    const h = pos[k * 3 + 1] - seaY;
    const flat = smooth(0.55, 0.9, nrm[k * 3 + 1]); // steep ground (dunes, cliffs) keeps its own colour
    let w = h < 0 ? 1 : 1 - smooth(reach * 0.6, reach, h); // beach weight
    w *= flat;
    if (w <= 0) continue;
    const wet = 1 - smooth(0, 0.9, h); // dark and wet near the water
    for (let i = 0; i < 3; i++) {
      const target = mix(c.dry[i], c.wet[i], wet);
      col[k * 3 + i] = mix(col[k * 3 + i], target, w);
    }
  }
}

// grid coordinates: dense over [lo, hi], then growing geometrically out to the horizon
export function axisCoords(lo, hi, cell, horizon = 4000) {
  const xs = [];
  const n = Math.max(2, Math.ceil((hi - lo) / cell));
  for (let i = 0; i <= n; i++) xs.push(lo + ((hi - lo) * i) / n);
  const cl = [];
  const ch = [];
  let d = cell * 2;
  for (let s = cell; s < horizon; s *= 1.7, d = s) {
    cl.unshift(lo - s);
    ch.push(hi + s);
  }
  return [...cl, ...xs, ...ch];
}

const VERT = /* glsl */ `
  attribute float depth;
  varying float vDepth;
  varying vec3 vWorld;
  uniform float uTide;
  void main() {
    vDepth = depth + uTide;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vDepth;
  varying vec3 vWorld;
  uniform float uTime, uWaves, uClarity, uDay;
  uniform vec3 uSun, uCam, uShallow, uDeep;
  uniform vec2 uDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // slope of the swell and of the chop at a point (x east, z south)
  vec2 slope(vec2 p, float t) {
    vec2 g = vec2(0.0);
    vec2 d1 = uDir;
    vec2 d2 = normalize(uDir + 0.7 * vec2(-uDir.y, uDir.x));
    vec2 d3 = normalize(uDir - 0.9 * vec2(-uDir.y, uDir.x));
    g += d1 * cos(dot(p, d1) * 0.55 - t * 1.1) * 0.55;
    g += d2 * cos(dot(p, d2) * 0.9 - t * 1.5) * 0.35;
    g += d3 * cos(dot(p, d3) * 1.9 - t * 2.3) * 0.2;
    g += (vec2(vnoise(p * 1.7 + t * 0.4), vnoise(p * 1.7 - t * 0.3 + 9.0)) - 0.5) * 0.5;
    return g * (0.05 + 0.25 * uWaves);
  }
  void main() {
    float d = vDepth;
    if (d < -0.02) discard;
    vec2 g = slope(vWorld.xz, uTime);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(uCam - vWorld);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    // colour by depth: the clearer the water, the deeper the shallows show
    float k = mix(0.9, 0.22, uClarity);
    float tdepth = 1.0 - exp(-max(d, 0.0) * k);
    vec3 col = mix(uShallow, uDeep, tdepth);
    float alpha = mix(0.18, 0.96, 1.0 - exp(-max(d, 0.0) * mix(1.6, 0.55, uClarity)));
    // sky reflection and sun glint
    vec3 sky = vec3(0.55, 0.72, 0.9) * (0.35 + 0.65 * uDay);
    col = mix(col, sky, fres * 0.65);
    vec3 R = reflect(-uSun, N);
    float glint = pow(max(dot(R, V), 0.0), 320.0) * uDay;
    col += vec3(1.0, 0.95, 0.85) * glint * 0.7;
    // foam: a wet line at the shore and breaker lines that travel in and break on the shallows
    float wob = vnoise(vWorld.xz * 0.35 + uTime * 0.1);
    float swash = 0.22 + 0.2 * sin(uTime * 0.7 + wob * 6.0);
    float shore = 1.0 - smoothstep(swash * 0.5, swash + 0.1, d);
    float ph = d * 1.7 - uTime * (0.7 + 0.5 * uWaves) + wob * 2.5;
    float band = pow(max(sin(ph * 3.14159), 0.0), 3.0) * (1.0 - smoothstep(0.5, 3.2 + 3.0 * uWaves, d)) * smoothstep(0.1, 0.5, d);
    float lace = smoothstep(0.35, 0.8, vnoise(vWorld.xz * 3.0 + uTime * 0.25));
    float foam = clamp(shore * (0.55 + 0.45 * lace) + band * uWaves * 1.8 * (0.4 + 0.6 * lace), 0.0, 1.0);
    col = mix(col, vec3(0.97, 0.99, 1.0) * (0.45 + 0.55 * uDay), foam);
    alpha = max(alpha, foam * 0.95);
    alpha *= smoothstep(-0.02, 0.05, d);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * The water. `terrain` gives { heightAt(x, z), extent: { x0, z0, x1, z1 } }; `seaY` is the water level in the scene.
 * Returns { group, mesh, material, pebbles, setTide(m), tick(time, sunDir, camera, dayLight) }.
 */
export function buildSea(terrain, seaY, cfg) {
  const { x0, z0, x1, z1 } = terrain.extent;
  const cell = Math.max(1, Math.max(x1 - x0, z1 - z0) / 140);
  const xs = axisCoords(x0, x1, cell);
  const zs = axisCoords(z0, z1, cell);
  const nx = xs.length;
  const pos = new Float32Array(nx * zs.length * 3);
  const depth = new Float32Array(nx * zs.length);
  const clampX = (x) => Math.min(x1, Math.max(x0, x));
  const clampZ = (z) => Math.min(z1, Math.max(z0, z));
  let o = 0;
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      pos.set([x, seaY, z], o * 3);
      // outside the terrain: the border depth, deeper with the distance (the open sea) when it is already water
      const edge = terrain.heightAt(clampX(x), clampZ(z));
      const beyond = Math.hypot(x - clampX(x), z - clampZ(z));
      const dd = seaY - edge;
      depth[o++] = dd > 0 ? dd + beyond * 0.03 : dd - beyond * 0.02;
    }
  }
  const idx = [];
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  geo.setIndex(idx);
  const clear = cfg.clarity;
  const uniforms = {
    uTime: { value: 0 },
    uTide: { value: 0 },
    uWaves: { value: cfg.waves },
    uDir: { value: new THREE.Vector2(1, 0.3).normalize() },
    uClarity: { value: clear },
    uDay: { value: 1 },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uCam: { value: new THREE.Vector3() },
    uShallow: { value: new THREE.Color().setRGB(mix(0.25, 0.3, clear), mix(0.5, 0.82, clear), mix(0.42, 0.78, clear)) },
    uDeep: { value: new THREE.Color().setRGB(mix(0.05, 0.02, clear), mix(0.2, 0.2, clear), mix(0.2, 0.4, clear)) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sea';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'sea';
  group.add(mesh);
  const pebbles = cfg.beach === 'pebbles' ? scatterPebbles(terrain, seaY) : null;
  if (pebbles) group.add(pebbles);

  return {
    group,
    mesh,
    material,
    pebbles,
    setTide(m) {
      uniforms.uTide.value = m;
      mesh.position.y = m;
    },
    /** `swell`: { waves (0..1), dir [x, z] } of the moment (the wind); the settings alone when absent. */
    tick(time, sunDir, camera, dayLight = 1, swell = null) {
      uniforms.uTime.value = time;
      if (swell) {
        uniforms.uWaves.value = swell.waves;
        uniforms.uDir.value.set(swell.dir[0], swell.dir[1]);
      }
      uniforms.uSun.value.copy(sunDir);
      uniforms.uCam.value.copy(camera.position);
      uniforms.uDay.value = dayLight;
    },
  };
}

/** Small stones on the strip of ground around the waterline: one instanced mesh, deterministic. */
export function scatterPebbles(terrain, seaY, max = 2600) {
  const { x0, z0, x1, z1 } = terrain.extent;
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, max);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  let n = 0;
  for (let tries = 0; tries < max * 60 && n < max; tries++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = z0 + rnd() * (z1 - z0);
    const h = terrain.heightAt(x, z) - seaY;
    if (h < -0.15 || h > 1.4) continue;
    const r = 0.04 + rnd() * rnd() * 0.16;
    e.set(rnd() * 3, rnd() * 3, rnd() * 3);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, terrain.heightAt(x, z) + r * 0.2, z), q, new THREE.Vector3(r * (1 + rnd() * 0.5), r * 0.6, r * (1 + rnd() * 0.5)));
    im.setMatrixAt(n, m);
    const g = 0.35 + rnd() * 0.45;
    c.setRGB(g, g * (0.92 + rnd() * 0.1), g * (0.85 + rnd() * 0.12));
    im.setColorAt(n, c);
    n++;
  }
  im.count = n;
  im.receiveShadow = true;
  im.name = 'pebbles';
  return im;
}
