// Drives and paths: a centre line drawn on the ground, a width and what it is made of, draped on the relief. What
// a kind of path looks like comes from the house catalog (`paths` section) with the card's own kinds underneath:
// see path-art.js. The pure part (normalisation, length, strip geometry) is free of three.js and tested.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothPath } from './irrigation.js';
import { elementOutline, pathElements, pathKind, pathKinds, pointAt, shadeHex } from './path-art.js';

export const PATH_DEFAULT = { w: 3, surface: 'gravel' };
export const PATH_W = [0.5, 12]; // narrowest footpath .. widest yard
const TEX_N = 256; // side of a texture tile, in pixels
const TEX_M = 2; // meters covered by one tile when the kind does not say
const THUMB_RUN = 2.6; // elements of a modular path shown on its thumbnail
const GRAIN_SPREAD = 0.17; // how strongly `grain` lightens and darkens the pixels of a surface
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
    surface: pathKind(raw.surface) ? raw.surface : PATH_DEFAULT.surface,
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
 * `across`: u runs 0..1 over the width; otherwise u and v are in tiles of `tile` meters.
 * Returns { pos, uv, idx } (flat arrays) or null when the line is too short.
 */
export function pathStrip(center, w, heightAt, { lift = LIFT, across = false, from = -0.5, to = 0.5, tile = TEX_M } = {}) {
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
      uv.push(across ? s + 0.5 : (s * w) / tile, across ? run / (tile * 2) : run / tile);
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

/** A number from a text, so that a kind or a path keeps the same look. */
function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Seeded noise for the textures: the same picture every time. */
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Grains, chippings or pebbles of a surface, scattered over the whole tile or over one band of it. */
function paintSpeckles(g, speckles, px, rand, { x = 0, w = TEX_N } = {}) {
  for (const grain of speckles || []) {
    const stretch = grain.stretch > 1 ? grain.stretch : 1;
    const radius = Math.max(0.6, (grain.size * px) / 2);
    const count = Math.round((grain.amount * w * TEX_N) / (Math.PI * radius * radius));
    g.fillStyle = grain.color;
    for (let i = 0; i < count; i++) {
      const cx = x + rand() * w;
      const cy = rand() * TEX_N;
      const r = (radius * (0.6 + rand() * 0.8)) / Math.sqrt(stretch);
      g.beginPath();
      if (stretch === 1) g.arc(cx, cy, r, 0, Math.PI * 2);
      else g.ellipse(cx, cy, r * stretch, r, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** The units of a laid surface (pavers, slabs, boards) over their bed of mortar. */
function paintJoints(g, joints, color, px, rand) {
  g.fillStyle = joints.color;
  g.fillRect(0, 0, TEX_N, TEX_N);
  const along = joints.cell[0] * px;
  const across = joints.cell[1] * px;
  const gap = Math.max(1, (joints.width > 0 ? joints.width : 0.015) * px);
  const stagger = (joints.stagger || 0) * across;
  const spread = Number.isFinite(joints.shade) ? joints.shade : 0.08;
  for (let row = 0, y = -along; y < TEX_N; row++, y += along)
    for (let x = -across + (row % 2) * stagger; x < TEX_N; x += across) {
      g.fillStyle = shadeHex(color, 1 + (rand() * 2 - 1) * spread);
      g.fillRect(x + gap / 2, y + gap / 2, across - gap, along - gap);
    }
}

/** Two tracks worn by wheels across the width, the surface showing between and beside them. */
function paintWheels(g, wheels, px, rand) {
  const bands = (wheels.bands || [])
    .map(([low, high]) => [Math.round(low * TEX_N), Math.round(high * TEX_N)])
    .filter(([x0, x1]) => x1 > x0);
  for (const [x0, x1] of bands) {
    g.fillStyle = wheels.color;
    g.fillRect(x0, 0, x1 - x0, TEX_N);
  }
  for (const [x0, x1] of bands) {
    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, TEX_N);
    g.clip();
    paintSpeckles(g, wheels.speckles, px, rand, { x: x0, w: x1 - x0 });
    g.restore();
  }
}

/** The speckled noise over the base colour of a surface (skipped where the pixels cannot be read back). */
function paintGrain(g, grain, rand) {
  const image = typeof g.getImageData === 'function' ? g.getImageData(0, 0, TEX_N, TEX_N) : null;
  const data = image && image.data;
  if (!data || !data.length) return;
  for (let i = 0; i < data.length; i += 4) {
    const factor = 1 + (rand() * 2 - 1) * grain * GRAIN_SPREAD;
    data[i] = Math.min(255, data[i] * factor);
    data[i + 1] = Math.min(255, data[i + 1] * factor);
    data[i + 2] = Math.min(255, data[i + 2] * factor);
  }
  g.putImageData(image, 0, 0);
}

/** A square of surface, painted from the numbers of its entry alone: base, units, grains, ruts, then the noise. */
function paintSurface(g, S, px, rand) {
  g.fillStyle = S.color;
  g.fillRect(0, 0, TEX_N, TEX_N);
  if (S.joints) paintJoints(g, S.joints, S.color, px, rand);
  paintSpeckles(g, S.speckles, px, rand);
  if (S.wheels) paintWheels(g, S.wheels, px, rand);
  if (S.grain > 0) paintGrain(g, S.grain, rand);
}

/** A canvas of TEX_N pixels a side, or null outside a browser. */
function square() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = TEX_N;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

/**
 * Tile of a surface drawn on a canvas from the numbers of its entry, so a kind added to the catalog looks like
 * itself without a line of code here (null outside a browser: plain colours then).
 */
function surfaceTexture(id, S) {
  if (textures.has(id)) return textures.get(id);
  const made = square();
  if (!made) return null;
  const { c, g } = made;
  paintSurface(g, S, TEX_N / (S.tile > 0 ? S.tile : TEX_M), noise(hashString(id)));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(id, tex);
  return tex;
}

const swatches = new Map();

/** The elements of a modular path, drawn flat on a canvas: the same framing as the preview of its entry. */
function paintModule(g, def, rand) {
  const across = def.width && def.width.default > 0 ? def.width.default : 1.5;
  const module = def.module;
  const pitch = module.size[0] + (Number.isFinite(module.gap) ? module.gap : 0.2);
  const px = TEX_N / (THUMB_RUN * pitch);
  const strip = Math.min(across * px, TEX_N * 0.86);
  for (const element of pathElements(module, TEX_N / px, strip / px, rand)) {
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    g.fillStyle = element.color;
    g.beginPath();
    elementOutline(element.shape, element.a, element.c, rand).forEach(([along, side], k) => {
      const x = TEX_N / 2 + (along * sin + side * cos + element.side) * px;
      const y = (element.d + along * cos - side * sin) * px;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    g.fill();
  }
}

/**
 * A square of a kind of path, as an image address (data URL) for an <img> in the lists: the very texture the view
 * lays, so the picker shows what will be drawn. Null outside a browser (and in the tests).
 */
export function pathThumb(id) {
  if (swatches.has(id)) return swatches.get(id);
  const def = pathKind(id);
  const made = def && square();
  if (!made) return null;
  const { c, g } = made;
  const rand = noise(hashString(id));
  if (def.kind === 'module') paintModule(g, def, rand);
  else paintSurface(g, def.surface, TEX_N / (def.surface.tile > 0 ? def.surface.tile : TEX_M), rand);
  const url = c.toDataURL('image/png');
  swatches.set(id, url);
  return url;
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

/** One modular element standing on the ground: its outline extruded, turned and put in place. */
function elementGeometry(element, at, heightAt, thickness, rand) {
  const outline = elementOutline(element.shape, element.a, element.c, rand);
  const shape = new THREE.Shape(outline.map(([along, across]) => new THREE.Vector2(along, across)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // drawn flat (along, across), stood up: along x, thickness up, across z
  geo.rotateY(-(Math.atan2(at.sin, at.cos) + element.angle));
  const x = at.x - at.sin * element.side;
  const z = at.z + at.cos * element.side;
  geo.translate(x, heightAt(x, z) + LIFT, z);
  const color = new THREE.Color(element.color);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/**
 * Elements set one after another along the centre line, the ground showing between them (stepping stones,
 * sleepers, log rounds): one merged mesh for the whole path, a colour per element. Null when nothing fits.
 */
export function modulePath(def, center, width, heightAt, seed) {
  const rand = noise(hashString(seed));
  const thickness = def.thickness > 0 ? def.thickness : 0.06;
  const parts = [];
  for (const element of pathElements(def, pathLength(center), width, rand)) {
    const at = pointAt(center, element.d);
    if (at) parts.push(elementGeometry(element, at, heightAt, thickness, rand));
  }
  if (!parts.length) return null;
  const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (!geo) return null;
  geo.computeVertexNormals();
  return geo;
}

/**
 * 3D drives and paths: one strip per path (and its kerbs), or its elements one after another, draped on the
 * ground. `anchor(path)` gives the conversion of its frame to the plan. Returns { group, count, materials }
 * (materials: for snow and rain).
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
    const def = pathKind(p.surface);
    if (!def) continue;
    const toPlan = anchor(raw);
    const center = smoothPath(
      p.pts.map(([x, z]) => toPlan(x, z)),
      0.5,
    );
    const g = new THREE.Group();
    g.name = 'path';
    if (def.kind === 'module') {
      const geo = modulePath(def.module, center, p.w, heightAt, `${p.surface}:${p.id}`);
      if (!geo) continue;
      const mat = material(
        `module:${p.surface}`,
        () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: def.module.roughness > 0 ? def.module.roughness : 0.9 }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    } else {
      const S = def.surface;
      const tile = S.tile > 0 ? S.tile : TEX_M;
      const strip = pathStrip(center, p.w, heightAt, { across: !!S.wheels, tile });
      if (!strip) continue;
      const mat = material(p.surface, () => {
        const map = surfaceTexture(p.surface, S);
        return new THREE.MeshStandardMaterial({
          color: map ? '#ffffff' : S.color,
          map,
          roughness: Number.isFinite(S.roughness) ? S.roughness : 0.9,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -3,
        });
      });
      g.add(stripMesh(strip, mat));
      if (p.edge) {
        const kerb = material('kerb', () => new THREE.MeshStandardMaterial({ color: '#d4d1ca', roughness: 0.8, side: THREE.DoubleSide }));
        const half = EDGE_W / p.w;
        for (const [from, to] of [
          [-0.5, -0.5 + half],
          [0.5 - half, 0.5],
        ]) {
          const k = pathStrip(center, p.w, heightAt, { lift: LIFT + EDGE_H, from, to, tile });
          if (k) g.add(stripMesh(k, kerb));
        }
      }
    }
    group.add(g);
    count++;
  }
  return { group, count, materials: [...mats.values()] };
}

/** Every kind a path may be given, for the editor: the catalog over the kinds the card knows. */
export { pathKind, pathKinds };
