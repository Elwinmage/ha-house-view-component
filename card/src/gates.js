// Gates set on a fence: independent objects { id, f: index of the fence, at: [x, z] (frame of the fence), w, open:
// swing1 | swing2 | slide1 | slide2, fill: full | bars | mixed, top: straight | arch, pillars, c, h, entity, flip,
// mirror, hidden }. A gate sits on the nearest side of its fence, which is opened under it when drawn (cutFence).
// The pure part (normalisation, placement on a side, cutting of the fence, leaves, state of the entity) is free of
// three.js and tested.
import * as THREE from 'three';
import { openingState } from './openings.js';
import { nearestSide, sideEnds, sideCount } from './fences.js';

export const GATE_OPEN = ['swing2', 'swing1', 'slide1', 'slide2'];
export const GATE_FILL = ['bars', 'full', 'mixed'];
export const GATE_TOP = ['straight', 'arch'];
export const GATE_DOMAINS = ['cover', 'binary_sensor'];
export const GATE_TRAVEL = 6; // seconds of a full opening

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const pick = (v, list) => (list.includes(v) ? v : list[0]);

export const GATE_SNAP = 4; // m: how far from a fence a gate may be placed

/** Gate with every field filled in; its place on the fence is found by placeGate. */
export function normalizeGate(g) {
  const raw = g || {};
  return {
    id: raw.id || '',
    f: Number.isInteger(raw.f) && raw.f >= 0 ? raw.f : 0,
    at: Array.isArray(raw.at) && Number.isFinite(raw.at[0]) && Number.isFinite(raw.at[1]) ? [raw.at[0], raw.at[1]] : [0, 0],
    w: r2(clamp(Number.isFinite(raw.w) ? raw.w : 3, 0.6, 12)),
    open: pick(raw.open, GATE_OPEN),
    fill: pick(raw.fill, GATE_FILL),
    top: pick(raw.top, GATE_TOP),
    pillars: raw.pillars !== false,
    c: /^#[0-9a-fA-F]{6}$/.test(raw.c || '') ? raw.c : '#2b2b2b',
    h: r2(clamp(Number.isFinite(raw.h) ? raw.h : 1.6, 0.6, 3)),
    entity: typeof raw.entity === 'string' ? raw.entity : '',
    flip: !!raw.flip, // opens toward the other side of the fence
    mirror: !!raw.mirror, // one-leaf gates: hinge / sliding toward the other end
    hidden: !!raw.hidden,
  };
}

/**
 * Place of a gate on fence `fe` (normalised, frame of its points): the nearest side, the position along it kept inside
 * the side and the width reduced to fit. Null when the fence has no side or the gate is farther than GATE_SNAP.
 */
export function placeGate(g, fe) {
  const n = sideCount(fe);
  if (n < 1) return null;
  const near = nearestSide(fe.pts, fe.closed, g.at[0], g.at[1]);
  if (near.i < 0 || near.d > GATE_SNAP) return null;
  const [a, b] = sideEnds(fe, near.i);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.3) return null;
  const w = Math.min(g.w, L);
  const half = w / 2 / L;
  const t = clamp(near.t, half, 1 - half);
  return { i: near.i, t, L, w, x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t };
}

/** Rise of the arch (m) for a gate of width w. */
export const archRise = (w) => Math.min(0.5, w * 0.15);

/** Height of the top of the gate at x (from the centre of the opening, -w/2..w/2). */
export function topAt(g, x) {
  if (g.top !== 'arch') return g.h;
  const u = (2 * x) / g.w;
  const rise = archRise(g.w);
  return g.h - rise + rise * (1 - u * u);
}

/**
 * Leaves of a gate: [{ x0, x1, mode: 'swing' | 'slide', pivot (swing: hinge), sign (swing: rotation turn), shift
 * (slide: travel), z (slide: offset beside the fence) }], x measured from the centre of the opening.
 */
export function leavesOf(g) {
  const h = g.w / 2;
  const d = g.flip ? -1 : 1; // side of the fence the leaves go to
  const m = g.mirror ? -1 : 1; // end of the opening the single leaf is hinged / slides toward
  switch (g.open) {
    case 'swing1':
      return [{ x0: -h, x1: h, mode: 'swing', pivot: -h * m, sign: d * m }];
    case 'slide1':
      return [{ x0: -h, x1: h, mode: 'slide', pivot: 0, shift: g.w * m, z: 0.15 * d }];
    case 'slide2':
      return [
        { x0: -h, x1: 0, mode: 'slide', pivot: 0, shift: -h, z: 0.12 * d },
        { x0: 0, x1: h, mode: 'slide', pivot: 0, shift: h, z: -0.12 * d },
      ];
    default:
      return [
        { x0: -h, x1: 0, mode: 'swing', pivot: -h, sign: d },
        { x0: 0, x1: h, mode: 'swing', pivot: h, sign: -d },
      ];
  }
}

/** Opening 0..1 of a gate from its entity: a cover (current_position or state) or a contact (on = open). */
export function gateOpenness(entity, states) {
  if (!entity || !states) return 0;
  const dom = entity.split('.')[0];
  if (!GATE_DOMAINS.includes(dom)) return 0;
  return openingState(dom === 'cover' ? { opener: entity } : { contact: entity }, states).open;
}

/**
 * Gates of the fences ready to draw: [{ key: id, g (normalised, width fitted), f, i, t, fe }] for the visible gates
 * lying on a visible fence. `normalizeFence` is the one of fences.js (passed in to keep this file light).
 */
export function gatesOf(gates, fences, normalizeFence) {
  const out = [];
  (gates || []).forEach((raw, n) => {
    const g = normalizeGate(raw);
    const fr = (fences || [])[g.f];
    if (g.hidden || !fr || fr.hidden) return;
    const fe = normalizeFence(fr);
    const p = placeGate(g, fe);
    if (p) out.push({ key: g.id || `g${n}`, g: { ...g, w: r2(p.w) }, f: g.f, i: p.i, t: p.t, fe });
  });
  return out;
}

/**
 * The fence `fe` (normalised) opened under its gates: the part of each side covered by a gate becomes a side of type
 * `none`. [{ i, t, w }] are the placements (placeGate) of the gates of this fence. Returns a new fence.
 */
export function cutFence(fe, placements) {
  if (!placements.length) return fe;
  const pts = [];
  const segs = [];
  const n = sideCount(fe);
  for (let i = 0; i < n; i++) {
    const [a, b] = sideEnds(fe, i);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cuts = placements
      .filter((p) => p.i === i)
      .map((p) => [Math.max(0, p.t - p.w / 2 / L), Math.min(1, p.t + p.w / 2 / L)])
      .sort((u, v) => u[0] - v[0]);
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let from = 0;
    let done = false;
    pts.push(a);
    for (const [c0, c1] of cuts) {
      if (c1 <= from) continue; // overlaps the previous gate
      const s0 = Math.max(c0, from);
      if (done && s0 <= from + 1e-6) {
        // touches the previous gate: one single opening
        pts[pts.length - 1] = at(c1);
        from = c1;
        continue;
      }
      done = true;
      if (s0 > from + 1e-6) {
        segs.push(fe.segs[i]);
        pts.push(at(s0));
      }
      segs.push({ s: 'none', h: 0 });
      pts.push(at(c1));
      from = c1;
    }
    segs.push(fe.segs[i]); // the rest of the side (a zero-length piece is dropped by the fence)
  }
  if (!fe.closed) pts.push(fe.pts[fe.pts.length - 1]);
  return { ...fe, pts, segs };
}

/** Position and direction (radians, around y) of a gate at t along the side a -> b (plan coordinates). */
export function gatePlacement(a, b, g) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { x: a[0] + (b[0] - a[0]) * g.t, z: a[1] + (b[1] - a[1]) * g.t, rot: -Math.atan2(b[1] - a[1], b[0] - a[0]), L };
}

function leaf(g, spec) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: g.c, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  const lx = (x) => x - spec.pivot;
  const solidTop = g.fill === 'mixed' ? Math.min(g.h * 0.5, g.h - 0.2) : null;
  const step = 0.1;
  const span = spec.x1 - spec.x0;
  const cols = Math.max(1, Math.ceil(span / step));
  // solid part: columns following the profile of the top
  if (g.fill !== 'bars') {
    const pos = [];
    for (let k = 0; k < cols; k++) {
      const xa = spec.x0 + (span * k) / cols;
      const xb = spec.x0 + (span * (k + 1)) / cols;
      const ta = solidTop ?? topAt(g, xa) - 0.05;
      const tb = solidTop ?? topAt(g, xb) - 0.05;
      pos.push(lx(xa), 0.12, 0, lx(xb), 0.12, 0, lx(xb), tb, 0, lx(xa), 0.12, 0, lx(xb), tb, 0, lx(xa), ta, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    grp.add(m);
  }
  // bars (all the height, or above the solid part)
  if (g.fill !== 'full') {
    const bars = Math.max(2, Math.round(span / 0.12));
    for (let k = 0; k <= bars; k++) {
      const x = spec.x0 + (span * k) / bars;
      const y0 = solidTop ?? 0.12;
      const hb = Math.max(0.05, topAt(g, x) - y0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, hb, 0.025), mat);
      bar.position.set(lx(x), y0 + hb / 2, 0);
      bar.castShadow = true;
      grp.add(bar);
    }
  }
  // rails: along the top (following the profile), at the bottom and at the join of the solid part
  const rail = (xa, xb, ya, yb) => {
    const len = Math.hypot(xb - xa, yb - ya);
    const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.045, 0.045), mat);
    r.position.set(lx((xa + xb) / 2), (ya + yb) / 2, 0);
    r.rotation.z = Math.atan2(yb - ya, xb - xa);
    grp.add(r);
  };
  const seg = Math.max(1, Math.ceil(span / 0.4));
  for (let k = 0; k < seg; k++) {
    const xa = spec.x0 + (span * k) / seg;
    const xb = spec.x0 + (span * (k + 1)) / seg;
    rail(xa, xb, topAt(g, xa) - 0.03, topAt(g, xb) - 0.03);
  }
  rail(spec.x0, spec.x1, 0.12, 0.12);
  if (solidTop !== null) rail(spec.x0, spec.x1, solidTop, solidTop);
  return grp;
}

/**
 * 3D gates. `anchor(fence)` -> toPlan, `heightAt` the ground. Returns { group, count, keys, set(map), tick(dt) }:
 * set({ key: 0..1 }) gives the target opening of each gate, tick(dt) moves them (GATE_TRAVEL s for the whole way) and
 * returns true while one is moving.
 */
export function buildGates(gates, fences, anchor, heightAt, normalizeFence) {
  const group = new THREE.Group();
  group.name = 'gates';
  const items = [];
  for (const { key, g, i, t, fe } of gatesOf(gates, fences, normalizeFence)) {
    const toPlan = anchor(fences[g.f]);
    const a = toPlan(...fe.pts[i]);
    const b = toPlan(...fe.pts[(i + 1) % fe.pts.length]);
    const p = gatePlacement(a, b, { t });
    const root = new THREE.Group();
    root.name = 'gate';
    root.position.set(p.x, heightAt(p.x, p.z), p.z);
    root.rotation.y = p.rot;
    const mat = new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.9 });
    if (g.pillars) {
      for (const s of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.3, g.h + 0.25, 0.3), mat);
        pil.position.set(s * (g.w / 2 + 0.15), (g.h + 0.25) / 2 - 0.05, 0);
        pil.castShadow = true;
        root.add(pil);
      }
    }
    const leaves = leavesOf(g).map((spec) => {
      const node = leaf(g, spec);
      node.position.set(spec.pivot, 0, spec.z || 0);
      root.add(node);
      return { node, spec };
    });
    group.add(root);
    items.push({ key, leaves, cur: 0, target: 0 });
  }
  const place = (it) => {
    for (const { node, spec } of it.leaves) {
      if (spec.mode === 'swing') node.rotation.y = spec.sign * it.cur * (Math.PI / 2);
      else node.position.x = spec.shift * it.cur;
    }
  };
  return {
    group,
    count: items.length,
    keys: items.map((it) => it.key),
    /** Current opening of a gate (0..1), null when it does not exist. */
    openOf(key) {
      const it = items.find((x) => x.key === key);
      return it ? it.cur : null;
    },
    set(map) {
      for (const it of items) it.target = clamp((map && map[it.key]) || 0, 0, 1);
    },
    tick(dt) {
      let busy = false;
      for (const it of items) {
        const d = it.target - it.cur;
        if (Math.abs(d) < 1e-4) {
          if (it.cur !== it.target) {
            it.cur = it.target;
            place(it);
          }
          continue;
        }
        it.cur += Math.sign(d) * Math.min(Math.abs(d), dt / GATE_TRAVEL);
        place(it);
        busy = true;
      }
      return busy;
    },
  };
}
