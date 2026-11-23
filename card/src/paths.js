// Drives and paths: a centre line drawn on the ground, a width and a surface (asphalt, gravel, pavers...), draped on
// the relief. The pure part (normalisation, length, strip geometry) is free of three.js and tested.
import * as THREE from 'three';
import { smoothPath } from './irrigation.js';

/**
 * Surfaces: colour of the overlay in the editor, colour of the 3D strip, roughness, how its texture is drawn.
 * `across`: the texture spans the whole width (wheel tracks), otherwise it repeats every TEX_M meters.
 */
export const PATH_SURFACES = {
  asphalt: { color: '#4b4e53', rough: 0.9, draft: '#7a7f88' },
  gravel: { color: '#bdb29c', rough: 1, draft: '#e0d3b4' },
  concrete: { color: '#bfbbb2', rough: 0.85, draft: '#d8d5cf' },
  pavers: { color: '#a3816b', rough: 0.9, draft: '#c99a7b' },
  dirt: { color: '#957650', rough: 1, draft: '#b8915f' },
  tracks: { color: '#6f8f4a', rough: 1, draft: '#8fbf5a', across: true },
};
export const PATH_DEFAULT = { w: 3, surface: 'gravel' };
export const PATH_W = [0.5, 12]; // narrowest footpath .. widest yard
const TEX_M = 2; // meters covered by one tile of a texture
const LIFT = 0.05; // height of the strip above the ground (no z-fighting with the terrain)
const EDGE_W = 0.15; // width of a kerb
const EDGE_H = 0.08; // its height above the strip

const r2 = (v) => Math.round(v * 100) / 100;

/** Current model: { id, pts (centre line, 2 points at least), frame, w, surface, edge, name?, hidden }. */
export function normalizePath(p) {
  const raw = p || {};
  const pts = (raw.pts || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => [q[0], q[1]]);
  const w = Number.isFinite(+raw.w) && raw.w !== null && raw.w !== '' ? +raw.w : PATH_DEFAULT.w;
  const out = {
    id: raw.id || '',
    pts,
    frame: raw.frame || 'grid',
    w: r2(Math.min(PATH_W[1], Math.max(PATH_W[0], w))),
    surface: PATH_SURFACES[raw.surface] ? raw.surface : PATH_DEFAULT.surface,
    edge: !!raw.edge,
    hidden: !!raw.hidden,
  };
  if (raw.name) out.name = String(raw.name);
  return out;
}

/** Length (m) of a polyline. */
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/**
 * Strip of a centre line (plan frame, already smoothed): positions, uvs and triangles, draped on `heightAt` with
 * `lift` above it; subdivided across (about every meter) so that it follows a side slope too.
 * `across`: u runs 0..1 over the width; otherwise u and v are in tiles of TEX_M meters.
 * Returns { pos, uv, idx } (flat arrays) or null when the line is too short.
 */
export function pathStrip(center, w, heightAt, { lift = LIFT, across = false, from = -0.5, to = 0.5 } = {}) {
  const P = center.filter((p, i) => i === 0 || Math.hypot(p[0] - center[i - 1][0], p[1] - center[i - 1][1]) > 1e-3);
  if (P.length < 2) return null;
  const cols = Math.max(1, Math.ceil((w * (to - from)) / 1));
  const pos = [];
  const uv = [];
  const idx = [];
  let run = 0;
  for (let i = 0; i < P.length; i++) {
    if (i) run += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // normal of the line (left hand side), the strip spreading from `from` to `to` (shares of the width)
    const nx = -(b[1] - a[1]) / L;
    const nz = (b[0] - a[0]) / L;
    for (let k = 0; k <= cols; k++) {
      const s = from + ((to - from) * k) / cols;
      const x = P[i][0] + nx * s * w;
      const z = P[i][1] + nz * s * w;
      pos.push(x, heightAt(x, z) + lift, z);
      uv.push(across ? s + 0.5 : (s * w) / TEX_M, across ? run / (TEX_M * 2) : run / TEX_M);
    }
    if (i) {
      const r0 = (i - 1) * (cols + 1);
      const r1 = i * (cols + 1);
      for (let k = 0; k < cols; k++) idx.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
    }
  }
  return { pos, uv, idx };
}

// ---------------------------------------------------------------------------- textures (browser only)

const textures = new Map();

/** Seeded noise for the textures: the same picture every time. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tile of a surface drawn on a canvas (null outside a browser: plain colours then). */
function surfaceTexture(name) {
  if (typeof document === 'undefined') return null;
  if (textures.has(name)) return textures.get(name);
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  if (!g) return null;
  const rand = noise(name.length * 7919);
  const S = PATH_SURFACES[name];
  g.fillStyle = S.color;
  g.fillRect(0, 0, N, N);
  const speckle = (count, size, colors) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      const r = size * (0.5 + rand());
      g.beginPath();
      g.arc(rand() * N, rand() * N, r, 0, Math.PI * 2);
      g.fill();
    }
  };
  if (name === 'asphalt') speckle(2500, 0.8, ['#3e4146', '#5a5d63', '#64676c']);
  else if (name === 'gravel') speckle(3500, 1.6, ['#a99d86', '#d2c8b3', '#8f846f', '#e3dccb']);
  else if (name === 'dirt') speckle(1500, 2.2, ['#86684a', '#a5845c', '#7a5d40']);
  else if (name === 'concrete') {
    speckle(1200, 0.7, ['#b2aea5', '#cac6be']);
    g.fillStyle = '#9a968e'; // expansion joints every 2 m
    g.fillRect(0, 0, N, 2);
    g.fillRect(0, 0, 2, N);
  } else if (name === 'pavers') {
    // running bond of 20 x 10 cm bricks, a little uneven, on dark joints
    g.fillStyle = '#5e4a3d';
    g.fillRect(0, 0, N, N);
    const bw = N / 10;
    const bh = N / 20;
    for (let r = 0; r < 20; r++)
      for (let k = -1; k < 10; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        const shade = 0.88 + rand() * 0.2;
        g.fillStyle = `rgb(${Math.round(163 * shade)},${Math.round(129 * shade)},${Math.round(107 * shade)})`;
        g.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2);
      }
  } else if (name === 'tracks') {
    // grass in the middle and on the sides, two wheel tracks of earth
    speckle(1500, 1.5, ['#5f7f3d', '#7fa055', '#668a43']);
    for (const [a, b] of [
      [0.12, 0.36],
      [0.64, 0.88],
    ]) {
      g.fillStyle = '#8d7150';
      g.fillRect(a * N, 0, (b - a) * N, N);
    }
    speckle(600, 1.4, ['#76593b', '#a3865f']);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(name, tex);
  return tex;
}

// ---------------------------------------------------------------------------- 3D

function stripMesh(strip, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(strip.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(strip.uv, 2));
  geo.setIndex(strip.idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.renderOrder = 2;
  return m;
}

/**
 * 3D drives and paths: one strip per path (and its kerbs), draped on the ground. `anchor(path)` gives the
 * conversion of its frame to the plan. Returns { group, count, materials } (materials: for snow and rain).
 */
export function buildPaths(paths, anchor, heightAt) {
  const group = new THREE.Group();
  group.name = 'paths';
  const mats = new Map();
  const material = (key, make) => {
    if (!mats.has(key)) mats.set(key, make());
    return mats.get(key);
  };
  let count = 0;
  for (const raw of paths || []) {
    const p = normalizePath(raw);
    if (p.hidden || p.pts.length < 2) continue;
    const toPlan = anchor(raw);
    const center = smoothPath(
      p.pts.map(([x, z]) => toPlan(x, z)),
      0.5,
    );
    const S = PATH_SURFACES[p.surface];
    const strip = pathStrip(center, p.w, heightAt, { across: !!S.across });
    if (!strip) continue;
    const mat = material(p.surface, () => {
      const map = surfaceTexture(p.surface);
      return new THREE.MeshStandardMaterial({
        color: map ? '#ffffff' : S.color,
        map,
        roughness: S.rough,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      });
    });
    const g = new THREE.Group();
    g.name = 'path';
    g.add(stripMesh(strip, mat));
    if (p.edge) {
      const kerb = material('kerb', () => new THREE.MeshStandardMaterial({ color: '#d4d1ca', roughness: 0.8, side: THREE.DoubleSide }));
      const half = EDGE_W / p.w;
      for (const [from, to] of [
        [-0.5, -0.5 + half],
        [0.5 - half, 0.5],
      ]) {
        const k = pathStrip(center, p.w, heightAt, { lift: LIFT + EDGE_H, from, to });
        if (k) g.add(stripMesh(k, kerb));
      }
    }
    group.add(g);
    count++;
  }
  return { group, count, materials: [...mats.values()] };
}
