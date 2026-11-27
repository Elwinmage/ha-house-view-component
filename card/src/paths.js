// Drives and paths: a centre line drawn on the ground, a width and what it is made of, draped on the relief. What
// a kind of path looks like comes from the house catalog (`paths` section) with the card's own kinds underneath:
// see path-art.js. The pure part (normalisation, length, strip geometry) is free of three.js and tested.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothPath } from './irrigation.js';
import { elementOutline, pathElements, pathKind, pathKinds, pointAt } from './path-art.js';
import { hashString, noise, shadeHex } from './surface-lib.js';
import { TEX_M, TEX_N, canvasOf, surfaceSwatch, surfaceTexture } from './surface-art.js';
import { STEPS_MAX, stairFlight } from './stairs.js';
import { WALL_T } from './engine/terrain-edit.js';

export const PATH_DEFAULT = { w: 3, surface: 'gravel' };
export const PATH_W = [0.5, 12]; // narrowest footpath .. widest yard
const THUMB_RUN = 2.6; // elements of a modular path shown on its thumbnail
const LIFT = 0.05; // height of the strip above the ground (no z-fighting with the terrain)
const EDGE_W = 0.15; // width of a kerb
const EDGE_H = 0.08; // its height above the strip
const CLEAR = WALL_T / 2 + 0.03; // how far from the line of a wall a strip stops: at the face of its masonry
const END_REACH = 1; // a path that goes less than this past a wall, at one of its ends, was drawn a little too far (m)

const r2 = (v) => Math.round(v * 100) / 100;

/** A kind of path that can be laid as a flight of steps: an unbroken surface (not elements set one by one). */
export const stairsKind = (id) => {
  const def = pathKind(id);
  return !!def && def.kind !== 'module';
};

/**
 * Current model: { id, pts (centre line, 2 points at least), frame, w, surface, edge, stairs (a flight of steps
 * between the ground at its first point and at its last one: see stairs.js), steps? (their number, when it is not
 * the one its height calls for), name?, hidden }.
 */
export function normalizePath(p) {
  const raw = p || {};
  const pts = (raw.pts || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => [q[0], q[1]]);
  const w = Number.isFinite(+raw.w) && raw.w !== null && raw.w !== '' ? +raw.w : PATH_DEFAULT.w;
  const surface = pathKind(raw.surface) ? raw.surface : PATH_DEFAULT.surface;
  const out = {
    id: raw.id || '',
    pts,
    frame: raw.frame || 'grid',
    w: r2(Math.min(PATH_W[1], Math.max(PATH_W[0], w))),
    surface,
    edge: !!raw.edge,
    stairs: !!raw.stairs && stairsKind(surface),
    hidden: !!raw.hidden,
  };
  const steps = raw.steps === null || raw.steps === '' ? NaN : +raw.steps;
  if (Number.isFinite(steps) && steps >= 1) out.steps = Math.min(STEPS_MAX, Math.round(steps));
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
 * A centre line less what goes past a wall near one of its ends: a path drawn a little too far, through a wall, ends
 * at the face of that wall instead of climbing it. `stop(ax, az, bx, bz)` tells where a move first meets a wall
 * (a share of the move, null when it meets none). A wall met further than `reach` meters from the end is one the
 * path really goes across: it is left alone.
 */
export function clipEnds(center, stop, reach = END_REACH) {
  if (!stop || center.length < 2) return center;
  let line = center;
  for (const last of [false, true]) {
    // from the end inwards: the first wall met on the way cuts off what lies before it
    const pts = last ? [...line].reverse() : [...line];
    let run = 0;
    for (let i = 0; i < pts.length - 1 && run < reach; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const t = L > 0 ? stop(bx, bz, ax, az) : null; // seen from the inside of the path
      if (t !== null && run + L * (1 - t) <= reach) {
        const keep = Math.max(0, t * L - CLEAR) / L;
        pts.splice(0, i + 1, [bx + (ax - bx) * keep, bz + (az - bz) * keep]);
        break;
      }
      run += L;
    }
    line = last ? pts.reverse() : pts;
  }
  return line;
}

/**
 * Strip of a centre line (plan frame, already smoothed): positions, uvs and triangles, draped on `heightAt` with
 * `lift` above it; subdivided across (about every meter) so that it follows a side slope too.
 * `across`: u runs 0..1 over the width; otherwise u and v are in tiles of `tile` meters.
 * `stop(ax, az, bx, bz)`: where a move first meets a retaining wall (a share of the move, null when it meets none):
 * the strip then stops at the face of the wall on each side, instead of taking the level of the ground behind it.
 * Returns { pos, uv, idx } (flat arrays) or null when the line is too short.
 */
export function pathStrip(center, w, heightAt, { lift = LIFT, across = false, from = -0.5, to = 0.5, tile = TEX_M, stop = null } = {}) {
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
    // how far the strip may go on each side of the line here: up to a wall standing across it
    const reach = (off) => {
      const t = stop && off ? stop(P[i][0], P[i][1], P[i][0] + nx * off, P[i][1] + nz * off) : null;
      return t === null ? off : Math.sign(off) * Math.max(0, Math.abs(off) * t - CLEAR);
    };
    const left = from < 0 ? reach(from * w) : 0;
    const right = to > 0 ? reach(to * w) : 0;
    for (let k = 0; k <= cols; k++) {
      const s = from + ((to - from) * k) / cols;
      const off = s < 0 ? Math.max(s * w, left) : Math.min(s * w, right);
      const x = P[i][0] + nx * off;
      const z = P[i][1] + nz * off;
      pos.push(x, heightAt(x, z) + lift, z);
      uv.push(across ? off / w + 0.5 : off / tile, across ? run / (tile * 2) : run / tile);
    }
    if (i) {
      const r0 = (i - 1) * (cols + 1);
      const r1 = i * (cols + 1);
      for (let k = 0; k < cols; k++) idx.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
    }
  }
  return { pos, uv, idx };
}

// ---------------------------------------------------------------------------- thumbnails (browser only)

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
  const def = pathKind(id);
  if (!def) return null;
  // a surface: its own tile, painted from the entry (a kind changed in the catalog is painted again)
  if (def.kind !== 'module') return surfaceSwatch(def.surface, id);
  if (swatches.has(id)) return swatches.get(id);
  const made = canvasOf();
  if (!made) return null;
  paintModule(made.g, def, noise(hashString(id)));
  const url = made.c.toDataURL('image/png');
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

/** Faces given as flat arrays (6 points a face, see stairs.js) as a mesh that casts its shadow. */
function facesMesh(faces, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.pos, 3));
  if (faces.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(faces.uv, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
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
 * ground; a path laid as a flight of steps is built of treads, risers and a cheek wall on each side instead.
 * `anchor(path)` gives the conversion of its frame to the plan, `levelAt` what one walks on where a flight starts
 * and arrives (the top of a terrace; the ground when it is not given), `wallAt` where a move on the ground first
 * meets a retaining wall (terrain.js): a path stops at the walls it was drawn up to, a flight of steps goes
 * through them. Returns { group, count, materials } (materials: for snow and rain).
 */
export function buildPaths(paths, anchor, heightAt, { levelAt = heightAt, wallAt = null } = {}) {
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
    const drawn = smoothPath(
      p.pts.map(([x, z]) => toPlan(x, z)),
      0.5,
    );
    // (a flight of steps is what goes through a wall: it keeps its whole line)
    const stop = p.stairs ? null : wallAt;
    const center = clipEnds(drawn, stop);
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
      const flight = p.stairs ? stairFlight(center, p.w, heightAt, { steps: p.steps, tile, levelAt }) : null;
      const strip = p.stairs ? null : pathStrip(center, p.w, heightAt, { across: !!S.wheels, tile, stop });
      if (!strip && !flight) continue;
      const mat = material(p.surface, () => {
        const map = surfaceTexture(S, p.surface);
        return new THREE.MeshStandardMaterial({
          color: map ? '#ffffff' : S.color,
          map,
          roughness: Number.isFinite(S.roughness) ? S.roughness : 0.9,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -3,
        });
      });
      if (flight) {
        g.name = 'stairs';
        g.add(facesMesh(flight.steps, mat));
        // the cheek walls: the colour of the steps, darker
        const cheek = material(
          `cheek:${S.color}`,
          () => new THREE.MeshStandardMaterial({ color: shadeHex(S.color, 0.72), roughness: 0.95, side: THREE.DoubleSide }),
        );
        g.add(facesMesh(flight.cheeks, cheek));
        group.add(g);
        count++;
        continue;
      }
      g.add(stripMesh(strip, mat));
      if (p.edge) {
        const kerb = material('kerb', () => new THREE.MeshStandardMaterial({ color: '#d4d1ca', roughness: 0.8, side: THREE.DoubleSide }));
        const half = EDGE_W / p.w;
        for (const [from, to] of [
          [-0.5, -0.5 + half],
          [0.5 - half, 0.5],
        ]) {
          const k = pathStrip(center, p.w, heightAt, { lift: LIFT + EDGE_H, from, to, tile, stop });
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
