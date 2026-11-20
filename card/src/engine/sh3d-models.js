// 3D models of the furniture of a Sweet Home 3D plan. A .sh3d file holds the model of each piece (OBJ, with its
// material file); the importer keeps a light copy of each model (a few thousand triangles at most, one colour per
// material, no texture), normalized to the box of the piece, so that the view draws the real shapes instead of boxes.
//
// A model document (scene.models[key]):
//   { v: base64 of Uint16 x, y, z per vertex (0..65535 over the unit box: x, z from -0.5 to 0.5, y from 0 to 1),
//     i: base64 of the triangle indices (Uint16, or Uint32 when `wide`), wide?,
//     g: [{ c: '#rrggbb', a: opacity, s: first index, n: index count }] }
// A piece drawn with its model is scaled to its width, height and depth, turned and placed like its box.
import { DEFAULT_MATERIALS } from './obj-materials.js';

const Q = 65535;

/** Materials of an MTL text: { name: { color: '#rrggbb', alpha, textured } }. */
export function parseMtl(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const t = raw.trim().split(/\s+/);
    if (!t[0]) continue;
    if (t[0] === 'newmtl') cur = out[t.slice(1).join(' ')] = { color: '#cccccc', alpha: 1, textured: false };
    else if (!cur) continue;
    else if (t[0] === 'Kd' && t.length >= 4) cur.color = hexOf(t.slice(1, 4).map(Number));
    else if (t[0] === 'd') cur.alpha = Math.min(Math.max(Number(t[1]), 0), 1);
    else if (t[0] === 'Tr') cur.alpha = 1 - Math.min(Math.max(Number(t[1]), 0), 1);
    else if (t[0] === 'map_Kd') {
      cur.textured = true;
      cur.texture = t.slice(1).join(' ');
    }
  }
  return out;
}

export function hexOf(rgb) {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(Math.max(Number.isFinite(c) ? c : 0.8, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Geometry of an OBJ text: { verts: [x, y, z, …], tris: [a, b, c, …], mat: material name per triangle, mtllib }.
 * Polygons are cut in fans; negative (relative) indices are read.
 */
export function parseObj(text) {
  const verts = [];
  const tris = [];
  const mat = [];
  let cur = 'default';
  let mtllib = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const t = line.split(/\s+/);
    if (t[0] === 'v') verts.push(+t[1], +t[2], +t[3]);
    else if (t[0] === 'f') {
      const n = verts.length / 3;
      const idx = t.slice(1).map((s) => {
        const k = parseInt(s, 10);
        return k < 0 ? n + k : k - 1;
      });
      for (let i = 1; i + 1 < idx.length; i++) {
        tris.push(idx[0], idx[i], idx[i + 1]);
        mat.push(cur);
      }
    } else if (t[0] === 'usemtl') cur = t.slice(1).join(' ') || 'default';
    else if (t[0] === 'mtllib') mtllib = t.slice(1).join(' ');
  }
  return { verts, tris, mat, mtllib };
}

/** Colour and opacity of a material: the material file, else the default materials of the OBJ loader. */
export function materialOf(name, mtl) {
  if (mtl && mtl[name]) return mtl[name];
  const d = DEFAULT_MATERIALS[name];
  if (d) return Array.isArray(d) ? { color: d[0], alpha: d[1] } : { color: d, alpha: 1 };
  return { color: '#c8bfae', alpha: 1 };
}

/**
 * The light copy of a model: turned by `rotation` (3x3, rows), normalized to the unit box, its vertices merged on a
 * grid of `cells` per side (fewer triangles), coloured per material. `colors` = { material: '#rrggbb' } replaces
 * colours (the plan's own), `color` replaces all of them. Returns { pos (Uint16Array), idx, groups } or null.
 */
export function bakeModel(obj, mtl, { rotation = null, colors = {}, color = null, cells = 32, maxTris = 2500 } = {}) {
  const n = obj.verts.length / 3;
  if (!n || !obj.tris.length) return null;
  const r = rotation && rotation.length === 9 ? rotation : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const p = new Float64Array(n * 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [obj.verts[i * 3], obj.verts[i * 3 + 1], obj.verts[i * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const v = r[k * 3] * x + r[k * 3 + 1] * y + r[k * 3 + 2] * z;
      p[i * 3 + k] = v;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const size = hi.map((h, k) => Math.max(h - lo[k], 1e-6));
  // unit box: x, z centred, y from the bottom
  for (let i = 0; i < n; i++) {
    p[i * 3] = (p[i * 3] - lo[0]) / size[0] - 0.5;
    p[i * 3 + 1] = (p[i * 3 + 1] - lo[1]) / size[1];
    p[i * 3 + 2] = (p[i * 3 + 2] - lo[2]) / size[2] - 0.5;
  }
  // material of each triangle -> group
  const look = (name) => {
    const m = materialOf(name, mtl);
    return { color: color || colors[name] || m.color, alpha: m.alpha ?? 1 };
  };
  let grid = cells;
  for (;;) {
    const cluster = new Map();
    const remap = new Int32Array(n);
    const sums = [];
    for (let i = 0; i < n; i++) {
      const key = `${Math.round((p[i * 3] + 0.5) * grid)},${Math.round(p[i * 3 + 1] * grid)},${Math.round((p[i * 3 + 2] + 0.5) * grid)}`;
      let c = cluster.get(key);
      if (c === undefined) {
        c = sums.length;
        cluster.set(key, c);
        sums.push([0, 0, 0, 0]);
      }
      remap[i] = c;
      const s = sums[c];
      s[0] += p[i * 3];
      s[1] += p[i * 3 + 1];
      s[2] += p[i * 3 + 2];
      s[3]++;
    }
    const byGroup = new Map();
    const seen = new Set();
    let count = 0;
    for (let t = 0; t < obj.tris.length / 3; t++) {
      const a = remap[obj.tris[t * 3]];
      const b = remap[obj.tris[t * 3 + 1]];
      const c = remap[obj.tris[t * 3 + 2]];
      if (a === undefined || b === undefined || c === undefined || a === b || b === c || a === c) continue;
      const { color: col, alpha } = look(obj.mat[t]);
      if (alpha < 0.05) continue;
      const gkey = `${col}|${alpha.toFixed(2)}`;
      // the same triangle twice (both faces of a thin part merged): kept once per side
      const tkey = `${gkey}|${a},${b},${c}`;
      if (seen.has(tkey)) continue;
      seen.add(tkey);
      if (!byGroup.has(gkey)) byGroup.set(gkey, { color: col, alpha, tris: [] });
      byGroup.get(gkey).tris.push(a, b, c);
      count++;
    }
    if (count > maxTris && grid > 6) {
      grid = Math.floor(grid * 0.75);
      continue;
    }
    if (!count) return null;
    // vertices used by the kept triangles, in order
    const used = new Map();
    const pos = [];
    const idx = [];
    const groups = [];
    for (const g of byGroup.values()) {
      const s = idx.length;
      for (const c of g.tris) {
        let k = used.get(c);
        if (k === undefined) {
          k = used.size;
          used.set(c, k);
          const v = sums[c];
          pos.push(
            Math.round(Math.min(Math.max(v[0] / v[3] + 0.5, 0), 1) * Q),
            Math.round(Math.min(Math.max(v[1] / v[3], 0), 1) * Q),
            Math.round(Math.min(Math.max(v[2] / v[3] + 0.5, 0), 1) * Q),
          );
        }
        idx.push(k);
      }
      groups.push({ c: g.color, a: Math.round(g.alpha * 100) / 100, s, n: idx.length - s });
    }
    const wide = used.size > 65535;
    return { pos: Uint16Array.from(pos), idx: wide ? Uint32Array.from(idx) : Uint16Array.from(idx), groups, wide };
  }
}

const toB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b) => {
  const s = atob(b);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
};

/** The model document stored in the scene. */
export function encodeModel(baked) {
  const doc = {
    v: toB64(new Uint8Array(baked.pos.buffer, baked.pos.byteOffset, baked.pos.byteLength)),
    i: toB64(new Uint8Array(baked.idx.buffer, baked.idx.byteOffset, baked.idx.byteLength)),
    g: baked.groups,
  };
  if (baked.wide) doc.wide = true;
  return doc;
}

/**
 * A stored model, ready to draw: { pos (Float32Array, unit box), idx (Uint32Array), groups }; null when unreadable.
 */
export function decodeModel(doc) {
  try {
    const v = fromB64(doc.v);
    const q = new Uint16Array(v.buffer, 0, Math.floor(v.length / 2));
    const pos = new Float32Array(q.length);
    for (let k = 0; k < q.length; k += 3) {
      pos[k] = q[k] / Q - 0.5;
      pos[k + 1] = q[k + 1] / Q;
      pos[k + 2] = q[k + 2] / Q - 0.5;
    }
    const ib = fromB64(doc.i);
    const idx = doc.wide ? new Uint32Array(ib.buffer, 0, ib.length / 4) : Uint32Array.from(new Uint16Array(ib.buffer, 0, ib.length / 2));
    const vertsN = pos.length / 3;
    if (!Array.isArray(doc.g) || idx.some((k) => k >= vertsN)) return null;
    return { pos, idx, groups: doc.g };
  } catch {
    return null;
  }
}

/**
 * Zip entry of the model of a piece, with the material file next to it: { obj, mtl } texts and the folder of the
 * model (where its textures are), or null.
 */
export function modelFiles(files, ref, decode) {
  if (!ref) return null;
  const read = (name) => (files[name] ? decode(files[name]) : null);
  const objName = ref;
  if (!files[ref]) return null;
  const head = files[ref].subarray(0, 2);
  if (head[0] === 0x50 && head[1] === 0x4b) return null; // a model packed in a zip of its own: not read
  const obj = read(objName);
  if (!obj || !/^\s*(v|f|#|o|g|mtllib|usemtl|vn|vt|s)\b/m.test(obj)) return null;
  // the material file: mtllib of the OBJ, in the folder of the model
  const dir = objName.includes('/') ? objName.slice(0, objName.lastIndexOf('/') + 1) : '';
  const lib = (/^\s*mtllib\s+(.+)$/m.exec(obj) || [])[1];
  const mtl = lib ? read(dir + lib.trim()) : null;
  return { obj, mtl, dir };
}
