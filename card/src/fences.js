// Fences: a polyline (open or closed) whose every side has its own type (wire mesh, wood, wall, hedge, or nothing for
// a gate). Sides can be cut in two so that one part is a wall and the other a mesh. Points are stored in the frame of
// the fence ('grid' = terrain grid, survives a new registration of the plan; 'plan' when there is no terrain).
import * as THREE from 'three';
import { POST_SIZE, POST_SPACING, fenceKinds } from './fence-art.js';
import { copingKind, copingSizes } from './coping-art.js';
import { isHex, recolorSurface, surfaceKey, tileOf } from './surface-lib.js';
import { TEX_N, canvasOf, openTexture, openTile, strokeOpen, surfaceTexture, surfaceTile } from './surface-art.js';

// The kinds of fence (h: default height, color: built colour, draft: colour of the side in the editor overlay, thick:
// wall thickness...) are the card's own and those of the house catalog: see fence-art.js. The object is the same
// all along: the catalog fills it when it is read.
export const FENCE_TYPES = fenceKinds();

/** The kind a side is drawn with: its own, else the wire mesh, so a side is always drawn. */
export const fenceType = (id) => FENCE_TYPES[id] || FENCE_TYPES.mesh;

const KIND_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const r2 = (v) => Math.round(v * 100) / 100;
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/**
 * Current model: { pts, closed, segs: [{ s, h, c?, cap?, capc? }], hidden, frame, parcels?, name? } with one `segs`
 * entry per side: its kind, its height, a colour of the user's own, and for a wall the coping laid on it (an id of
 * coping-art.js) with a colour of its own.
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
    // a kind the card does not know is kept: it may be one of the catalog, not read yet (or removed since), and
    // the side finds it again as soon as the catalog has it; meanwhile it is drawn as a wire mesh
    const s = typeof sg.s === 'string' && KIND_ID.test(sg.s) ? sg.s : 'mesh';
    return {
      s,
      h: Number.isFinite(sg.h) && sg.h > 0 ? sg.h : fenceType(s).h,
      ...(sg.c ? { c: sg.c } : {}),
      // the coping is kept like the kind: known or not yet, on a wall or not (the side may become one again)
      ...(typeof sg.cap === 'string' && KIND_ID.test(sg.cap) ? { cap: sg.cap } : {}),
      ...(isHex(sg.capc) ? { capc: sg.capc.toLowerCase() } : {}),
    };
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

function quad(out, a, b, c, d) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** How far a thick fence is sunk in the ground: no gap on a slope (m). */
const SINK = 0.2;
/** Distance between two bumps of the top of a hedge (m). */
const BUMP_STEP = 1.2;

/**
 * The surface a side is painted with: the texture of its kind in the colour of the side, or null for a kind
 * without one (plain colour), a see-through one (its wires are another texture) and an opening.
 */
export function sideSurface(T, color) {
  if (!T || !T.surface || T.open) return null;
  return isHex(color) ? recolorSurface(T.surface, color) : T.surface;
}

/**
 * The coping laid on a side: the one it asks for (`cap`, in the colour `capc` when it has one), when its kind is a
 * wall that carries one and the coping is known. Returns { id, surface, height, overhang, drop }, or null for a
 * side left bare.
 */
export function sideCoping(sg) {
  const T = sg ? fenceType(sg.s) : null;
  const kind = T && T.cap && sg.cap ? copingKind(sg.cap) : null;
  if (!kind) return null;
  const surface = isHex(sg.capc) ? recolorSurface(kind.surface, sg.capc) : kind.surface;
  return { id: sg.cap, surface, ...copingSizes(kind) };
}

/**
 * The faces of the coping laid on one side of a wall, added to `out` ({ pos, uv }, 6 points a face): a box along
 * every step `steps` of the side ([{ x, z, top }, ...] from one end to the other, `top` the top of the wall there),
 * wider than the wall by the overhang of the coping `cap` and coming down over its faces by its drop. `half` is
 * half the thickness of the wall, `run` how far along the fence the side starts (m: the rows of the coping go on
 * from one side to the next), `past` how far the coping goes beyond each end of the side ([start, end], m: over the
 * corner it shares with the next capped side, else by its overhang).
 * A row of the texture runs along the wall, the texture starting at one edge of the coping and at its underside, as
 * on the low walls (walls.js).
 */
export function copingFaces(out, steps, half, cap, run = 0, past = [0, 0]) {
  const a0 = steps[0];
  const a1 = steps[steps.length - 1];
  const L = Math.hypot(a1.x - a0.x, a1.z - a0.z);
  if (L < 0.05) return out;
  const dx = (a1.x - a0.x) / L;
  const dz = (a1.z - a0.z) / L;
  const wide = half + cap.overhang;
  const nx = -dz * wide;
  const nz = dx * wide;
  const tile = tileOf(cap.surface);
  const tall = (cap.height + cap.drop) / tile;
  const across = (2 * wide) / tile;
  // the ends of the side, pushed out: the coping covers the corner, or juts out past the end of the wall
  const pts = steps.map((p, k) => {
    const shift = k === 0 ? -past[0] : k === steps.length - 1 ? past[1] : 0;
    const along = Math.hypot(p.x - a0.x, p.z - a0.z) + shift;
    return { x: p.x + dx * shift, z: p.z + dz * shift, lo: p.top - cap.drop, hi: p.top + cap.height, u: (run + along) / tile };
  });
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    // the two faces, then the top
    quad(out.pos, [a.x + nx, a.lo, a.z + nz], [b.x + nx, b.lo, b.z + nz], [b.x + nx, b.hi, b.z + nz], [a.x + nx, a.hi, a.z + nz]);
    quad(out.uv, [a.u, 0], [b.u, 0], [b.u, tall], [a.u, tall]);
    quad(out.pos, [b.x - nx, b.lo, b.z - nz], [a.x - nx, a.lo, a.z - nz], [a.x - nx, a.hi, a.z - nz], [b.x - nx, b.hi, b.z - nz]);
    quad(out.uv, [b.u, 0], [a.u, 0], [a.u, tall], [b.u, tall]);
    quad(out.pos, [a.x + nx, a.hi, a.z + nz], [b.x + nx, b.hi, b.z + nz], [b.x - nx, b.hi, b.z - nz], [a.x - nx, a.hi, a.z - nz]);
    quad(out.uv, [a.u, across], [b.u, across], [b.u, 0], [a.u, 0]);
  }
  // the two ends
  const s = pts[0];
  const e = pts[pts.length - 1];
  quad(out.pos, [s.x - nx, s.lo, s.z - nz], [s.x + nx, s.lo, s.z + nz], [s.x + nx, s.hi, s.z + nz], [s.x - nx, s.hi, s.z - nz]);
  quad(out.uv, [0, 0], [across, 0], [across, tall], [0, tall]);
  quad(out.pos, [e.x + nx, e.lo, e.z + nz], [e.x - nx, e.lo, e.z - nz], [e.x - nx, e.hi, e.z - nz], [e.x + nx, e.hi, e.z + nz]);
  quad(out.uv, [across, 0], [0, 0], [0, tall], [across, tall]);
  return out;
}

/**
 * Three.js group of a fence. toPlan(x, z) converts its points to plan coordinates, heightAt(x, z) is the ground.
 * Sides are subdivided so that the fence follows the relief; a solid side carries the texture of its kind, a
 * see-through one its wires, and a wall the coping it asks for.
 */
export function buildFence(raw, toPlan, heightAt) {
  const f = normalizeFence(raw);
  const g = new THREE.Group();
  g.name = 'fence';
  const P = f.pts.map(([x, z]) => toPlan(x, z));
  const groups = new Map(); // type + color -> geometry being built
  const caps = new Map(); // coping + its surface -> { cap, pos, uv }
  const sides = sideCount(f);
  const laid = f.segs.map((sg) => sideCoping(sg)); // what caps each side, null for a bare one
  // the side before and the side after a side, -1 at the ends of an open fence
  const next = (i) => (i + 1 < sides ? i + 1 : f.closed ? 0 : -1);
  const prev = (i) => (i > 0 ? i - 1 : f.closed ? sides - 1 : -1);
  let run = 0; // meters of fence before the side being built
  for (let i = 0; i < sides; i++) {
    const sg = f.segs[i];
    const from = run;
    run += Math.hypot(P[(i + 1) % P.length][0] - P[i][0], P[(i + 1) % P.length][1] - P[i][1]);
    if (sg.s === 'none') continue;
    const T = fenceType(sg.s);
    const color = sg.c || T.color;
    const key = `${sg.s}|${color}`;
    if (!groups.has(key)) groups.set(key, { T, id: sg.s, color, S: sideSurface(T, color), pos: [], uv: [], posts: [] });
    const G = groups.get(key);
    const [ax, az] = P[i];
    const [bx, bz] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const step = T.bumpy ? BUMP_STEP : T.posts ? T.postSpacing || POST_SPACING : POST_SPACING;
    const n = Math.max(1, Math.ceil(L / step));
    const nx = (-(bz - az) / L) * (T.thick / 2);
    const nz = ((bx - ax) / L) * (T.thick / 2);
    const sink = T.thick ? SINK : 0; // thick types are buried a little: no gap on a slope
    // texture: `tile` meters a tile along the side; up the side in meters too, but for bars, drawn once over the
    // whole height (their rails sit at a share of it)
    const tile = T.open ? openTile(T.open) : tileOf(G.S);
    const whole = !!T.open && T.open.pattern === 'bars';
    const up = (h) => (whole ? h / sg.h : h / tile);
    const at = (k) => {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const y = heightAt(x, z);
      return { x, z, y: y - sink, top: y + sg.h + (T.bumpy ? bump(i, k) : 0), u: (L * k) / n / tile, v0: up(-sink), v1: up(sg.h) };
    };
    const half = T.thick / 2 / tile;
    const cap = laid[i];
    if (cap) {
      const key = `${cap.id}|${surfaceKey(cap.surface)}`;
      if (!caps.has(key)) caps.set(key, { cap, pos: [], uv: [] });
      const wide = T.thick / 2 + cap.overhang;
      // over the corner shared with a capped side, else past the end of the wall by the overhang
      const past = [prev(i), next(i)].map((j) => (j >= 0 && j !== i && laid[j] ? wide : cap.overhang));
      const steps = Array.from({ length: n + 1 }, (_, k) => at(k));
      copingFaces(caps.get(key), steps, T.thick / 2, cap, from, past);
    }
    for (let k = 0; k < n; k++) {
      const a = at(k);
      const b = at(k + 1);
      if (T.thick) {
        quad(G.pos, [a.x + nx, a.y, a.z + nz], [b.x + nx, b.y, b.z + nz], [b.x + nx, b.top, b.z + nz], [a.x + nx, a.top, a.z + nz]);
        quad(G.uv, [a.u, a.v0], [b.u, b.v0], [b.u, b.v1], [a.u, a.v1]);
        quad(G.pos, [b.x - nx, b.y, b.z - nz], [a.x - nx, a.y, a.z - nz], [a.x - nx, a.top, a.z - nz], [b.x - nx, b.top, b.z - nz]);
        quad(G.uv, [b.u, b.v0], [a.u, a.v0], [a.u, a.v1], [b.u, b.v1]);
        quad(G.pos, [a.x + nx, a.top, a.z + nz], [b.x + nx, b.top, b.z + nz], [b.x - nx, b.top, b.z - nz], [a.x - nx, a.top, a.z - nz]);
        quad(G.uv, [a.u, half], [b.u, half], [b.u, -half], [a.u, -half]);
      } else {
        quad(G.pos, [a.x, a.y, a.z], [b.x, b.y, b.z], [b.x, b.top, b.z], [a.x, a.top, a.z]);
        quad(G.uv, [a.u, a.v0], [b.u, b.v0], [b.u, b.v1], [a.u, a.v1]);
      }
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
      quad(G.uv, [-half, e0.v0], [half, e0.v0], [half, e0.v1], [-half, e0.v1]);
      quad(
        G.pos,
        [e1.x + nx, e1.y, e1.z + nz],
        [e1.x - nx, e1.y, e1.z - nz],
        [e1.x - nx, e1.top, e1.z - nz],
        [e1.x + nx, e1.top, e1.z + nz],
      );
      quad(G.uv, [half, e1.v0], [-half, e1.v0], [-half, e1.v1], [half, e1.v1]);
    }
  }
  for (const { T, id, color, S, pos, uv, posts } of groups.values()) {
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const see = T.opacity !== undefined;
    // wires drawn on nothing for a see-through fence, the painted surface of a solid one; without a browser (or
    // for a kind that has neither) the plain colour, tinted when see-through
    const map = T.open ? openTexture(T.open, color) : S ? surfaceTexture(S, `fence:${id}`) : null;
    const wires = !!T.open && !!map;
    const panel = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: map ? '#ffffff' : color,
        map,
        roughness: S && Number.isFinite(S.roughness) ? S.roughness : 0.9,
        side: THREE.DoubleSide,
        flatShading: !!T.bumpy,
        transparent: see,
        opacity: see && !wires ? T.opacity : 1,
        alphaTest: wires ? 0.04 : 0,
        depthWrite: !see,
      }),
    );
    panel.castShadow = !see;
    panel.receiveShadow = !see;
    g.add(panel);
    if (T.posts && posts.length) {
      const side = T.postSize || POST_SIZE;
      const inst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(side, 1, side),
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
  for (const { cap, pos, uv } of caps.values()) {
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const S = cap.surface;
    const map = surfaceTexture(S, `coping:${cap.id}`);
    const coping = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: map ? '#ffffff' : S.color,
        map,
        roughness: Number.isFinite(S.roughness) ? S.roughness : 0.9,
        side: THREE.DoubleSide,
      }),
    );
    coping.name = 'fence-coping';
    coping.castShadow = true;
    coping.receiveShadow = true;
    g.add(coping);
  }
  return g;
}

// ---------------------------------------------------------------------------- thumbnails (browser only)

/** Meters of fence across a thumbnail, and the tallest fence it holds. */
const THUMB_RUN = 2.6;
/** Bumps along the top of a hedge on its thumbnail, and how deep they are (m). */
const THUMB_BUMPS = 9;
const THUMB_BUMP = 0.12;
/** What stands behind a see-through fence on its thumbnail. */
const THUMB_BACKDROP = '#dfe6d6';

const thumbs = new Map();

/**
 * A run of fence seen from the front as an image address (data URL) for the palette: its panel at its usual height
 * (wires, painted surface or clipped foliage) between its posts, as the previews of the catalog draw it. Null
 * outside a browser, and for the side left open.
 */
export function fenceThumb(id) {
  const T = FENCE_TYPES[id];
  if (!T || !T.color) return null;
  const key = `${id}|${JSON.stringify(T)}`;
  if (thumbs.has(key)) return thumbs.get(key);
  const made = canvasOf();
  if (!made) return null;
  const { c, g } = made;
  const px = (TEX_N * 0.9) / THUMB_RUN;
  const w = THUMB_RUN * px;
  const h = Math.max(2, Math.min(T.h, THUMB_RUN) * px);
  const left = (TEX_N - w) / 2;
  const foot = TEX_N * 0.95;
  const top = foot - h;
  if (T.open) {
    // wires and bars are dark and thin: a pale ground behind them, so they read on a dark panel
    g.fillStyle = THUMB_BACKDROP;
    g.fillRect(0, 0, TEX_N, TEX_N);
  }
  g.save();
  g.translate(left, top);
  if (T.open) strokeOpen(g, T.open, T.color, w, h, px);
  else {
    if (T.bumpy) {
      // clipped foliage: an uneven top (the same every time)
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, THUMB_BUMP * px);
      for (let k = 0; k <= THUMB_BUMPS; k++) g.lineTo((w * k) / THUMB_BUMPS, (0.5 + bump(k, 3) / 0.24) * THUMB_BUMP * px);
      g.lineTo(w, THUMB_BUMP * px);
      g.lineTo(w, h);
      g.closePath();
      g.clip();
    }
    const S = sideSurface(T, null);
    const tile = S ? surfaceTile(S, `fence:${id}`) : null;
    if (tile) {
      const k = (tileOf(S) * px) / TEX_N;
      g.scale(k, k);
      g.fillStyle = g.createPattern(tile, 'repeat');
      g.fillRect(0, 0, w / k, h / k);
    } else {
      g.globalAlpha = T.opacity !== undefined ? Math.max(0.35, T.opacity) : 1;
      g.fillStyle = T.color;
      g.fillRect(0, 0, w, h);
    }
  }
  g.restore();
  if (T.posts) {
    const side = Math.max(3, (T.postSize || POST_SIZE) * px);
    const spacing = (T.postSpacing || POST_SPACING) * px;
    g.fillStyle = T.posts;
    for (let x = left; x < left + w - side; x += spacing) g.fillRect(x, top - side * 0.4, side, h + side * 0.4);
    g.fillRect(left + w - side, top - side * 0.4, side, h + side * 0.4);
  }
  const url = c.toDataURL('image/png');
  thumbs.set(key, url);
  return url;
}
