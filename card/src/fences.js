// Fences: a polyline (open or closed) whose every side has its own type (wire mesh, wood, wall, hedge, or nothing for
// a gate). Sides can be cut in two so that one part is a wall and the other a mesh. Points are stored in the frame of
// the fence ('grid' = terrain grid, survives a new registration of the plan; 'plan' when there is no terrain).
import * as THREE from 'three';

// h: default height (m); color: built color; draft: color of the side in the editor overlay; thick: wall thickness (m)
export const FENCE_TYPES = {
  mesh: { h: 1.5, color: '#5f7d5c', draft: '#ff2bd6', thick: 0, opacity: 0.38, posts: '#3d4a3c' },
  wood: { h: 1.8, color: '#8a6a48', draft: '#ff9f1a', thick: 0.04, posts: '#5a4330' },
  wall: { h: 1.2, color: '#d8cfc0', draft: '#2f8fff', thick: 0.2 },
  hedge: { h: 1.8, color: '#3f6b35', draft: '#b8ff3b', thick: 0.6, bumpy: true },
  none: { h: 0, color: null, draft: '#ffffff' }, // opening: gate, passage, side closed by the house
};

const r2 = (v) => Math.round(v * 100) / 100;
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/**
 * Current model: { pts, closed, segs: [{ s, h, c? }], hidden, frame, parcels?, name? } with one `segs` entry per side.
 * Also converts the first model ({ style, h, color, open: [side index] }, always a closed parcel outline).
 */
export function normalizeFence(f) {
  const pts = (f.pts || []).map((p) => [p[0], p[1]]);
  let closed = f.closed ?? !Array.isArray(f.segs);
  if (pts.length > 2 && same(pts[0], pts[pts.length - 1])) {
    pts.pop();
    closed = true;
  }
  const n = Math.max(0, closed ? pts.length : pts.length - 1);
  let src = f.segs;
  if (!Array.isArray(src)) {
    const open = new Set(f.open || []);
    src = Array.from({ length: n }, (_, i) => ({
      s: open.has(i) ? 'none' : f.style || 'mesh',
      h: f.h || 1.5,
      ...(f.color ? { c: f.color } : {}),
    }));
  }
  const segs = Array.from({ length: n }, (_, i) => {
    const sg = src[i] || src[src.length - 1] || {};
    const s = FENCE_TYPES[sg.s] ? sg.s : 'mesh';
    return { s, h: Number.isFinite(sg.h) && sg.h > 0 ? sg.h : FENCE_TYPES[s].h, ...(sg.c ? { c: sg.c } : {}) };
  });
  const out = { pts, closed, segs, hidden: !!f.hidden, frame: f.frame || 'grid' };
  if (f.parcels || f.parcel) out.parcels = f.parcels || [f.parcel];
  if (f.name) out.name = f.name;
  return out;
}

export const sideCount = (f) => (f.closed ? f.pts.length : f.pts.length - 1);
export const sideEnds = (f, i) => [f.pts[i], f.pts[(i + 1) % f.pts.length]];

/** Nearest side of the polyline `pts` (any frame) to a point: { i, t (0..1 along the side), d (distance) }. */
export function nearestSide(pts, closed, x, z) {
  let best = { i: -1, t: 0, d: Infinity };
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.min(Math.max(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2, 0), 1);
    const d = Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az));
    if (d < best.d) best = { i, t, d };
  }
  return best;
}

/** Nearest point of `pts` to a point: { i, d }. */
export function nearestPoint(pts, x, z) {
  let best = { i: -1, d: Infinity };
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best.d) best = { i, d };
  });
  return best;
}

/** Cut side i at t (0..1): both halves keep the type of the side. False when t is too close to an end. */
export function splitSide(f, i, t) {
  const [a, b] = sideEnds(f, i);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (t * L < 0.2 || (1 - t) * L < 0.2) return false;
  f.pts.splice(i + 1, 0, [r2(a[0] + (b[0] - a[0]) * t), r2(a[1] + (b[1] - a[1]) * t)]);
  f.segs.splice(i + 1, 0, { ...f.segs[i] });
  return true;
}

/** Remove point i: the two sides around it become one (type of the side before the point). */
export function removePoint(f, i) {
  if (f.pts.length <= (f.closed ? 3 : 2)) return false;
  f.pts.splice(i, 1);
  f.segs.splice(f.closed ? i : Math.min(i, f.segs.length - 1), 1);
  return true;
}

const bump = (i, k) => (Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 0.12; // deterministic -0.12..0.12

function quad(pos, a, b, c, d) {
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/**
 * Three.js group of a fence. toPlan(x, z) converts its points to plan coordinates, heightAt(x, z) is the ground.
 * Sides are subdivided so that the fence follows the relief.
 */
export function buildFence(raw, toPlan, heightAt) {
  const f = normalizeFence(raw);
  const g = new THREE.Group();
  g.name = 'fence';
  const P = f.pts.map(([x, z]) => toPlan(x, z));
  const groups = new Map(); // type + color -> geometry being built
  for (let i = 0; i < sideCount(f); i++) {
    const sg = f.segs[i];
    if (sg.s === 'none') continue;
    const T = FENCE_TYPES[sg.s];
    const color = sg.c || T.color;
    const key = `${sg.s}|${color}`;
    if (!groups.has(key)) groups.set(key, { T, color, pos: [], posts: [] });
    const G = groups.get(key);
    const [ax, az] = P[i];
    const [bx, bz] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / (T.bumpy ? 1.2 : 2.5)));
    const nx = (-(bz - az) / L) * (T.thick / 2);
    const nz = ((bx - ax) / L) * (T.thick / 2);
    const sink = T.thick ? 0.2 : 0; // thick types are buried a little: no gap on a slope
    const at = (k) => {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const y = heightAt(x, z);
      return { x, z, y: y - sink, top: y + sg.h + (T.bumpy ? bump(i, k) : 0) };
    };
    for (let k = 0; k < n; k++) {
      const a = at(k);
      const b = at(k + 1);
      if (T.thick) {
        quad(G.pos, [a.x + nx, a.y, a.z + nz], [b.x + nx, b.y, b.z + nz], [b.x + nx, b.top, b.z + nz], [a.x + nx, a.top, a.z + nz]);
        quad(G.pos, [b.x - nx, b.y, b.z - nz], [a.x - nx, a.y, a.z - nz], [a.x - nx, a.top, a.z - nz], [b.x - nx, b.top, b.z - nz]);
        quad(G.pos, [a.x + nx, a.top, a.z + nz], [b.x + nx, b.top, b.z + nz], [b.x - nx, b.top, b.z - nz], [a.x - nx, a.top, a.z - nz]);
      } else quad(G.pos, [a.x, a.y, a.z], [b.x, b.y, b.z], [b.x, b.top, b.z], [a.x, a.top, a.z]);
      if (T.posts) G.posts.push([a.x, a.y, a.z, sg.h]);
    }
    const e0 = at(0);
    const e1 = at(n);
    if (T.posts) G.posts.push([e1.x, e1.y, e1.z, sg.h]);
    if (T.thick) {
      // end caps
      quad(
        G.pos,
        [e0.x - nx, e0.y, e0.z - nz],
        [e0.x + nx, e0.y, e0.z + nz],
        [e0.x + nx, e0.top, e0.z + nz],
        [e0.x - nx, e0.top, e0.z - nz],
      );
      quad(
        G.pos,
        [e1.x + nx, e1.y, e1.z + nz],
        [e1.x - nx, e1.y, e1.z - nz],
        [e1.x - nx, e1.top, e1.z - nz],
        [e1.x + nx, e1.top, e1.z + nz],
      );
    }
  }
  for (const { T, color, pos, posts } of groups.values()) {
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const see = T.opacity !== undefined;
    const panel = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        side: THREE.DoubleSide,
        flatShading: !!T.bumpy,
        transparent: see,
        opacity: see ? T.opacity : 1,
        depthWrite: !see,
      }),
    );
    panel.castShadow = !see;
    panel.receiveShadow = !see;
    g.add(panel);
    if (T.posts && posts.length) {
      const inst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.07, 1, 0.07),
        new THREE.MeshStandardMaterial({ color: T.posts, roughness: 0.8 }),
        posts.length,
      );
      const m = new THREE.Matrix4();
      const s = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      posts.forEach(([x, y, z, h], k) => inst.setMatrixAt(k, m.compose(p.set(x, y + (h + 0.1) / 2, z), q, s.set(1, h + 0.1, 1))));
      inst.castShadow = true;
      g.add(inst);
    }
  }
  return g;
}
