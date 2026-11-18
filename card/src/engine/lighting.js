// "Light volume" system: instead of real 3D lights, every room gets one additive
// overlay mesh (floor + inner wall faces). A fragment shader sums that room's lights
// (max MAX_LIGHTS), so cost does not grow with the number of lights in the house
// and a light never leaks into a neighboring room.
import * as THREE from 'three';
import { insetPolygon, locateOnEdge, signedArea } from './geometry.js';

export const MAX_LIGHTS = 8;

const VERT = /* glsl */ `
attribute vec3 aAlbedo;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vAlb;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normal;
  vAlb = aAlbedo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
#define MAX_LIGHTS ${MAX_LIGHTS}
uniform vec3 uLPos[MAX_LIGHTS];
uniform vec3 uLCol[MAX_LIGHTS];
uniform float uLRad[MAX_LIGHTS];
uniform int uCount;
uniform float uGlow;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vAlb;
void main() {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uCount) break;
    vec3 d = uLPos[i] - vPos;
    float dist = length(d);
    float att = clamp(1.0 - dist / uLRad[i], 0.0, 1.0);
    att *= att;
    float lam = 0.35 + 0.65 * max(dot(vN, d / max(dist, 1e-3)), 0.0);
    acc += uLCol[i] * att * lam;
  }
  gl_FragColor = vec4(acc * vAlb * uGlow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uLPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uLCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()) },
      uLRad: { value: new Array(MAX_LIGHTS).fill(1) },
      uCount: { value: 0 },
      uGlow: { value: 1 },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// Geometry accumulator (positions, normals, albedo)
class Acc {
  constructor() {
    this.p = [];
    this.n = [];
    this.a = [];
  }
  tri(a, b, c, n, alb) {
    for (const v of [a, b, c]) {
      this.p.push(...v);
      this.n.push(...n);
      this.a.push(alb.r, alb.g, alb.b);
    }
  }
  quad(a, b, c, d, n, alb) {
    this.tri(a, b, c, n, alb);
    this.tri(a, c, d, n, alb);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aAlbedo', new THREE.Float32BufferAttribute(this.a, 3));
    return g;
  }
}

/** Horizontal polygon (with optional holes) at height y, normal up. */
function horizontal(acc, contour, holes, y, alb) {
  const toV = (p) => new THREE.Vector2(p[0], p[1]);
  const c = contour.map(toV);
  const h = holes.map((hole) => hole.map(toV));
  const all = [...c, ...h.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(c, h);
  for (const [i, j, k] of tris) {
    acc.tri([all[i].x, y, all[i].y], [all[j].x, y, all[j].y], [all[k].x, y, all[k].y], [0, 1, 0], alb);
  }
}

/** Cut a wall face (length L, height H) around door/window openings -> list of rects [u0,v0,u1,v1]. */
function faceRects(L, H, ops) {
  const rects = [];
  let cur = 0;
  for (const o of [...ops].sort((a, b) => a.u0 - b.u0)) {
    if (o.u0 > cur) rects.push([cur, 0, o.u0, H]);
    if (o.sill > 0.001) rects.push([o.u0, 0, o.u1, o.sill]);
    const top = o.sill + o.height;
    if (top < H) rects.push([o.u0, top, o.u1, H]);
    cur = Math.max(cur, o.u1);
  }
  if (cur < L) rects.push([cur, 0, L, H]);
  return rects;
}

export class LightSystem {
  constructor() {
    this.volumes = new Map(); // roomId -> { mesh, material, level }
    this.roomState = new Map(); // roomId -> { color: Color, level: number }
    this.wallAlbedo = new THREE.Color('#f2efe9');
  }

  /** Floor + inner wall faces of a room, clipped around openings. */
  addRoom(room, level, openings) {
    const acc = new Acc();
    const floorAlb = new THREE.Color(room.floor);
    const inset = insetPolygon(room.poly, room.inset ?? 0.1);
    horizontal(acc, inset, [], level.elevation + 0.004, floorAlb);

    const n = inset.length;
    const sgn = signedArea(inset) > 0 ? 1 : -1; // left normal is inward for positive area
    for (let i = 0; i < n; i++) {
      const a = inset[i];
      const b = inset[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      const nx = -uz * sgn;
      const nz = ux * sgn;
      const ops = [];
      for (const o of openings) {
        if (o.level !== level.id) continue;
        const loc = locateOnEdge(a, b, o.at, 0.3);
        if (!loc) continue;
        ops.push({ u0: Math.max(0, loc.t - o.width / 2), u1: Math.min(L, loc.t + o.width / 2), sill: o.sill, height: o.height });
      }
      for (const [u0, v0, u1, v1] of faceRects(L, level.height, ops)) {
        if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) continue;
        const e = level.elevation;
        const off = 0.004;
        const P = (u, v) => [a[0] + ux * u + nx * off, e + v, a[1] + uz * u + nz * off];
        acc.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), [nx, 0, nz], this.wallAlbedo);
      }
    }
    this._register(room.id, acc, level.id);
  }

  /** Outdoor volume: ground (with the house footprint cut out) + deck + path tops. */
  addOutdoor(plot, houseRect, extras) {
    const acc = new Acc();
    const grass = new THREE.Color('#6aa84f');
    const p = 40;
    const contour = [
      [plot.x0 - p, plot.z0 - p],
      [plot.x1 + p, plot.z0 - p],
      [plot.x1 + p, plot.z1 + p],
      [plot.x0 - p, plot.z1 + p],
    ];
    const hole = [
      [houseRect.x0 - 0.15, houseRect.z0 - 0.15],
      [houseRect.x0 - 0.15, houseRect.z1 + 0.15],
      [houseRect.x1 + 0.15, houseRect.z1 + 0.15],
      [houseRect.x1 + 0.15, houseRect.z0 - 0.15],
    ];
    horizontal(acc, contour, [hole], 0.006, grass);
    for (const ex of extras) {
      const alb = new THREE.Color(ex.color);
      horizontal(acc, ex.rect, [], ex.y, alb);
    }
    this._register('outdoor', acc, 'outdoor');
  }

  _register(id, acc, levelId) {
    const material = makeMaterial();
    const mesh = new THREE.Mesh(acc.geometry(), material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = `lightvol-${id}`;
    this.volumes.set(id, { mesh, material, level: levelId });
  }

  /** Update uniforms from the light list. Returns per-room aggregated color/level. */
  setLights(lights, gain = 1.6) {
    const byRoom = new Map();
    for (const l of lights) {
      if (!l.on || l.room === 'pool') continue;
      if (!byRoom.has(l.room)) byRoom.set(l.room, []);
      byRoom.get(l.room).push(l);
    }
    for (const [id, vol] of this.volumes) {
      const list = (byRoom.get(id) || []).slice(0, MAX_LIGHTS);
      const u = vol.material.uniforms;
      u.uCount.value = list.length;
      vol.mesh.userData.hasLights = list.length > 0;
      const agg = new THREE.Color(0, 0, 0);
      let total = 0;
      list.forEach((l, i) => {
        const c = new THREE.Color(l.color);
        u.uLPos.value[i].set(l.pos[0], l.pos[1], l.pos[2]);
        const g = id === 'outdoor' ? gain * 0.45 : gain;
        u.uLCol.value[i].set(c.r * l.brightness * g, c.g * l.brightness * g, c.b * l.brightness * g);
        u.uLRad.value[i] = l.radius;
        agg.r += c.r * l.brightness;
        agg.g += c.g * l.brightness;
        agg.b += c.b * l.brightness;
        total += l.brightness;
      });
      if (total > 0) agg.multiplyScalar(1 / total);
      this.roomState.set(id, { color: agg, level: Math.min(total, 1.6) });
    }
    return this.roomState;
  }

  setGlow(value) {
    for (const v of this.volumes.values()) v.material.uniforms.uGlow.value = value;
  }

  /** Show only volumes whose level is visible and that actually have lights. */
  updateVisibility(levelVisible) {
    for (const v of this.volumes.values()) {
      const lv = v.level === 'outdoor' ? true : levelVisible[v.level];
      v.mesh.visible = !!(lv && v.mesh.userData.hasLights);
    }
  }
}
