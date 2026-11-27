// Roofs read from the surface model (LiDAR).
//
// A plan gives the walls of a house, seldom its roof: a hipped roof with a few slopes is long to draw. Where the
// terrain comes with a surface model (the top of what stands on the ground, roofs included, every half metre or so),
// the roof is read from it, over an outline drawn in the editor:
//   - roofPlanes() finds the slopes: groups of cells of the model that lie on one plane, grown from the flattest
//     spots, then the way each pair of neighbouring slopes meets;
//   - roofSurface() gives the roof at any point: the plane of the slope standing there. Between two slopes the
//     limit is the line where their planes cross: a ridge or a hip where the roof is the lower of the two, a valley
//     where it is the higher one;
//   - roofMesh() lays triangles over the outline, cut along its sides and along those lines, and finds its edges;
//   - buildRoofs() makes the meshes of the view, the edges closed down to the top of the walls.
// Everything is worked out in the frame of the terrain grid (x east, z south, altitudes), then set on the plan.
import * as THREE from 'three';
import { inPolygon } from './pools.js';

/** Bounds of the height correction of a roof (m). */
export const ROOF_DY = [-3, 3];
const NOT_ROOF = 1.5; // the surface model this close to the ground is not a roof (m)
const FASCIA = 0.12; // height of the edge of a roof (m)
const REACH = 2; // cells looked at around a point to tell which slopes stand there
const PARALLEL = 0.02; // two planes whose slopes differ by less than this do not cross in a line worth following
const DEPTH = 3; // slopes told apart inside one cell of the mesh
const WELD = 0.25; // triangles this close in height at one place are joined (m)
const STEEP = 2.2; // a plane steeper than this (65 degrees) is a wall or the edge of a roof, not a slope
const UPSTAND = 0.25; // a wall is carried up to the roof in steps of this length (m)
const REACH_UP = 1.5; // when the roof comes this close to its top somewhere (m)...
const LEVEL = 0.05; // ...or when it goes on from such a wall, their tops no further apart than this (m)

/** A roof of the edits, defaults filled in: { id, pts, frame, dy, c, name, hidden }. */
export function normalizeRoof(r) {
  const o = r && typeof r === 'object' ? r : {};
  const dy = Number.isFinite(o.dy) ? Math.min(ROOF_DY[1], Math.max(ROOF_DY[0], o.dy)) : 0;
  return {
    ...o,
    id: o.id || '',
    pts: Array.isArray(o.pts) ? o.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [],
    frame: o.frame === 'plan' ? 'plan' : 'grid',
    dy,
    c: typeof o.c === 'string' && /^#[0-9a-f]{6}$/i.test(o.c) ? o.c : '',
    name: typeof o.name === 'string' ? o.name : '',
    hidden: !!o.hidden,
  };
}

/**
 * Outline of the building of the map (terrain.buildings, grid frame) standing at a grid point: the one that holds it,
 * else the nearest one within 15 m. Null without one. The outline is given open (no point twice).
 */
export function buildingOutline(t, gx, gz) {
  const list = ((t && t.buildings) || []).filter((b) => b && Array.isArray(b.poly) && b.poly.length >= 3);
  let best = list.find((b) => inPolygon(b.poly, gx, gz)) || null;
  let bd = 15;
  if (!best) {
    for (const b of list) {
      const d = Math.hypot(
        b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length - gx,
        b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length - gz,
      );
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
  }
  if (!best) return null;
  const pts = best.poly.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (pts.length > 3 && a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
}

/**
 * Where a roof stands, from the surface model: (gx, gz) (grid frame) -> its altitude, null where the surface is the
 * ground or nearly so, or out of the model.
 */
export function roofAltitude(t) {
  if (!t || !Array.isArray(t.s)) return () => null;
  return (gx, gz) => {
    const i = Math.round((gx - t.origin[0]) / t.step);
    const j = Math.round((gz - t.origin[1]) / t.step);
    if (i < 0 || j < 0 || i >= t.nx || j >= t.nz) return null;
    const k = j * t.nx + i;
    return Number.isFinite(t.s[k]) && t.s[k] - t.z[k] >= NOT_ROOF ? t.s[k] : null;
  };
}

/** Plane z = a x + b y + c through points given as sums ([n, x, y, z, xx, xy, yy, xz, yz]); null when they are in line. */
function solvePlane(s) {
  const [n, x, y, z, xx, xy, yy, xz, yz] = s;
  const d = xx * (yy * n - y * y) - xy * (xy * n - y * x) + x * (xy * y - yy * x);
  if (Math.abs(d) < 1e-9) return null;
  const a = (xz * (yy * n - y * y) - xy * (yz * n - y * z) + x * (yz * y - yy * z)) / d;
  const b = (xx * (yz * n - y * z) - xz * (xy * n - y * x) + x * (xy * z - yz * x)) / d;
  const c = (xx * (yy * z - yz * y) - xy * (xy * z - yz * x) + xz * (xy * y - yy * x)) / d;
  return [a, b, c];
}
const addTo = (s, x, y, z) => {
  s[0]++;
  s[1] += x;
  s[2] += y;
  s[3] += z;
  s[4] += x * x;
  s[5] += x * y;
  s[6] += y * y;
  s[7] += x * z;
  s[8] += y * z;
};
const sums = () => [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Which of the slopes standing around a point is the roof there. `around`: their numbers (the one of the nearest cell,
 * `first`, among them), `z(k)`: the height of the plane of slope k at the point, `rel`: how two slopes meet.
 * A roof is made of bodies that bulge (their slopes meet in ridges and hips: the body is the lowest of its planes),
 * and where two bodies cross in a valley the roof is the higher one. So: down from the first slope to the lowest of
 * those it meets in a ridge, then up to a slope that crosses it in a valley and stands higher, when that one is
 * itself the lowest of its own body. Slopes that do not meet in a line are left out of it.
 */
function choose(around, first, z, rel) {
  if (around.length < 2) return first;
  const lower = (k) => around.find((l) => rel(k, l) === 'min' && z(l) < z(k) - 1e-9);
  let k = first;
  for (let l = lower(k); l !== undefined; l = lower(k)) k = l;
  for (let pass = 0; pass < 2; pass++) {
    for (const l of around) if (rel(k, l) === 'max' && z(l) > z(k) + 1e-9 && lower(l) === undefined) k = l;
  }
  return k;
}

/**
 * The slopes of the roof standing in an outline (grid frame) of a terrain with a surface model `t.s`.
 * Returns null without a surface model or without a roof there, else
 * { planes: [{ a, b, c, cells, slope (degrees), rms }], rel(k, l): 'min'|'max'|'step', win: { i0, j0, w, h, near } }
 * where a plane gives the altitude a * x + b * z + c at a grid point counted from the corner of the window (metres),
 * and `near` the plane of the nearest cell that lies on one, for every cell of the window.
 */
export function roofPlanes(t, poly) {
  if (!t || !Array.isArray(t.s) || !Array.isArray(poly) || poly.length < 3) return null;
  const step = t.step;
  const [ox, oz] = t.origin;
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - ox) / step) - REACH);
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - oz) / step) - REACH);
  const i1 = Math.min(t.nx - 1, Math.ceil((Math.max(...xs) - ox) / step) + REACH);
  const j1 = Math.min(t.nz - 1, Math.ceil((Math.max(...zs) - oz) / step) + REACH);
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  if (w < 3 || h < 3) return null;
  const S = (i, j) => t.s[(j0 + j) * t.nx + i0 + i];
  // the cells of the roof: in the outline, and well above the ground
  const zone = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j0 + j) * t.nx + i0 + i;
      if (!inPolygon(poly, ox + (i0 + i) * step, oz + (j0 + j) * step)) continue;
      if (Number.isFinite(t.s[k]) && t.s[k] - t.z[k] >= NOT_ROOF) zone[j * w + i] = 1;
    }
  }
  const seedTol = 0.05 + 0.06 * step; // how flat a spot must be to start a slope
  const tol = 0.08 + 0.2 * step; // how far a cell may stand from the plane of its slope
  const least = Math.max(6, Math.round(2.5 / (step * step))); // cells of the smallest slope kept (2.5 m2)
  const along = Math.max(2, Math.round(2 / step)); // cells two slopes share, on each side, when they meet in a line
  const X = (i) => i * step;
  const at = (p, i, j) => p[0] * X(i) + p[1] * X(j) + p[2];
  // how flat the roof is around each cell: the worst distance to the plane through its 3 x 3 neighbours
  const seeds = [];
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      if (!zone[j * w + i]) continue;
      const s = sums();
      for (let b = -1; b <= 1; b++)
        for (let a = -1; a <= 1; a++) if (zone[(j + b) * w + i + a]) addTo(s, X(i + a), X(j + b), S(i + a, j + b));
      // (seven cells at least: six may be two rows on the very edge of a roof, which any plane goes through)
      if (s[0] < 7) continue;
      const p = solvePlane(s);
      if (!p || Math.hypot(p[0], p[1]) > STEEP) continue;
      let worst = 0;
      for (let b = -1; b <= 1; b++)
        for (let a = -1; a <= 1; a++)
          if (zone[(j + b) * w + i + a]) worst = Math.max(worst, Math.abs(at(p, i + a, j + b) - S(i + a, j + b)));
      if (worst <= seedTol) seeds.push([worst, i, j, p]);
    }
  }
  seeds.sort((a, b) => a[0] - b[0]);
  const label = new Int16Array(w * h).fill(-1);
  let planes = [];
  const refit = (cells) => {
    const s = sums();
    for (const k of cells) addTo(s, X(k % w), X(Math.floor(k / w)), S(k % w, Math.floor(k / w)));
    return solvePlane(s);
  };
  for (const [, si, sj, sp] of seeds) {
    if (label[sj * w + si] >= 0) continue;
    const id = planes.length;
    let p = sp;
    const cells = [sj * w + si];
    label[sj * w + si] = id;
    let front = [sj * w + si];
    let fitted = 1;
    while (front.length) {
      const next = [];
      for (const k of front) {
        const i = k % w;
        const j = Math.floor(k / w);
        for (const [a, b] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const u = i + a;
          const v = j + b;
          if (u < 0 || v < 0 || u >= w || v >= h) continue;
          const n = v * w + u;
          if (!zone[n] || label[n] >= 0 || Math.abs(at(p, u, v) - S(u, v)) > tol) continue;
          label[n] = id;
          cells.push(n);
          next.push(n);
        }
      }
      front = next;
      // the plane is worked out again as the slope grows by half
      if (cells.length >= 6 && cells.length >= fitted * 1.5) {
        p = refit(cells) || p;
        fitted = cells.length;
      }
    }
    if (cells.length < least) {
      for (const k of cells) label[k] = -1;
      continue;
    }
    planes.push({ p: refit(cells) || p, cells });
  }
  if (!planes.length) return null;
  // cells left over (edges, a chimney): to the neighbouring slope whose plane they are closest to, when close enough
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!zone[k] || label[k] >= 0) continue;
        let best = -1;
        let bd = 2 * tol;
        for (const [a, b] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const u = i + a;
          const v = j + b;
          if (u < 0 || v < 0 || u >= w || v >= h || label[v * w + u] < 0) continue;
          const d = Math.abs(at(planes[label[v * w + u]].p, i, j) - S(i, j));
          if (d < bd) {
            bd = d;
            best = label[v * w + u];
          }
        }
        if (best >= 0) {
          label[k] = best;
          planes[best].cells.push(k);
        }
      }
    }
  }
  // two slopes on the same plane are one, side by side or not (a slope that another roof crosses is in two parts)
  const apart = (A, B) => {
    let d = 0;
    for (const k of A.cells) d += Math.abs(at(A.p, k % w, Math.floor(k / w)) - at(B.p, k % w, Math.floor(k / w)));
    for (const k of B.cells) d += Math.abs(at(A.p, k % w, Math.floor(k / w)) - at(B.p, k % w, Math.floor(k / w)));
    return d / (A.cells.length + B.cells.length);
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < planes.length && !merged; a++) {
      for (let b = a + 1; b < planes.length && !merged; b++) {
        const A = planes[a];
        const B = planes[b];
        if (Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > 0.06 || apart(A, B) > tol / 2) continue;
        A.cells.push(...B.cells);
        A.p = refit(A.cells) || A.p;
        planes.splice(b, 1);
        merged = true;
      }
    }
  }
  planes.sort((a, b) => b.cells.length - a.cells.length);
  label.fill(-1);
  planes.forEach((pl, id) => pl.cells.forEach((k) => (label[k] = id)));
  // the slope of the nearest such cell, for every cell of the window: the roof goes on to the outline with the plane
  // of the slope standing next to it, whatever the model shows on its very edge
  const near = Int16Array.from(label);
  let front = [];
  for (let k = 0; k < w * h; k++) if (near[k] >= 0) front.push(k);
  while (front.length) {
    const next = [];
    for (const k of front) {
      const i = k % w;
      const j = Math.floor(k / w);
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          const u = i + a;
          const v = j + b;
          if (u < 0 || v < 0 || u >= w || v >= h || near[v * w + u] >= 0) continue;
          near[v * w + u] = near[k];
          next.push(v * w + u);
        }
      }
    }
    front = next;
  }
  // how two neighbouring slopes meet: on the cells of each one that touch the other, is its plane under the other
  // (the roof is the lower of the two: a ridge, a hip) or over it (the higher one: a valley)? Else a step, with no
  // line to follow. Only the cells of the roof count, and only the ones side by side: a third slope standing between
  // two others says nothing of how those two meet.
  const diff = planes.map(() => planes.map(() => [0, 0]));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const A = zone[j * w + i] ? near[j * w + i] : -1;
      if (A < 0) continue;
      const seen = new Set();
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          const u = i + a;
          const v = j + b;
          if (u < 0 || v < 0 || u >= w || v >= h || !zone[v * w + u]) continue;
          const B = near[v * w + u];
          if (B >= 0 && B !== A) seen.add(B);
        }
      }
      for (const B of seen) {
        diff[A][B][0] += at(planes[A].p, i, j) - at(planes[B].p, i, j);
        diff[A][B][1]++;
      }
    }
  }
  const rel = (k, l) => {
    // (two slopes that only touch around a point, where others meet, do not meet in a line)
    if (k === l || !diff[k] || !diff[k][l] || Math.min(diff[k][l][1], diff[l][k][1]) < along) return 'step';
    if (Math.hypot(planes[k].p[0] - planes[l].p[0], planes[k].p[1] - planes[l].p[1]) < PARALLEL) return 'step';
    // each side has its say: the one that says it loudest is followed, unless the other one says the opposite as
    // clearly (one roof standing over another: a step). The cells right on the line have little to say either way.
    const dk = diff[k][l][0] / diff[k][l][1];
    const dl = diff[l][k][0] / diff[l][k][1];
    const [loud, faint] = Math.abs(dk) >= Math.abs(dl) ? [dk, dl] : [dl, dk];
    if (loud * faint < 0 && Math.abs(faint) >= tol) return 'step';
    return loud < 0 ? 'min' : loud > 0 ? 'max' : 'step';
  };
  // the limit between two slopes that meet in a line is that line: a cell goes to the slope the roof takes there among
  // those of its neighbours, as long as what was measured on that cell goes with it. Where two planes cross at a
  // small angle the line is a little away from where the slopes were grown.
  for (let pass = 0, moved = 1; moved && pass < 30; pass++) {
    moved = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (near[k] < 0) continue;
        const around = [];
        for (let b = -1; b <= 1; b++) {
          for (let a = -1; a <= 1; a++) {
            const u = i + a;
            const v = j + b;
            if (u >= 0 && v >= 0 && u < w && v < h && near[v * w + u] >= 0 && !around.includes(near[v * w + u]))
              around.push(near[v * w + u]);
          }
        }
        const to = choose(around, near[k], (l) => at(planes[l].p, i, j), rel);
        if (to === near[k]) continue;
        // (a measured cell stays with its slope when the plane of that slope goes better with what was measured)
        const was = zone[k] ? Math.abs(at(planes[near[k]].p, i, j) - S(i, j)) : Infinity;
        if (was <= 2 * tol && Math.abs(at(planes[to].p, i, j) - S(i, j)) > was + 0.03) continue;
        near[k] = to;
        moved++;
      }
    }
  }
  return {
    planes: planes.map(({ p, cells }) => {
      let e = 0;
      for (const k of cells) e += (at(p, k % w, Math.floor(k / w)) - S(k % w, Math.floor(k / w))) ** 2;
      return {
        a: p[0],
        b: p[1],
        c: p[2],
        cells: cells.length,
        slope: (Math.atan(Math.hypot(p[0], p[1])) * 180) / Math.PI,
        rms: Math.sqrt(e / cells.length),
      };
    }),
    rel,
    win: { x0: ox + i0 * step, z0: oz + j0 * step, step, w, h, near },
  };
}

/**
 * The roof at a grid point: (x, z) -> { y (altitude), k (its slope) }, null where no slope stands.
 */
export function roofSurface(model) {
  const { planes, rel, win } = model;
  const zOf = (k, u, v) => planes[k].a * u + planes[k].b * v + planes[k].c;
  return (x, z) => {
    const u = x - win.x0;
    const v = z - win.z0;
    const ci = Math.min(win.w - 1, Math.max(0, Math.round(u / win.step)));
    const cj = Math.min(win.h - 1, Math.max(0, Math.round(v / win.step)));
    let k = win.near[cj * win.w + ci];
    if (k < 0) return null;
    // the slopes standing around: the roof takes the lower of two planes that meet in a ridge, the higher of two that
    // meet in a valley
    const around = [];
    for (let b = -REACH; b <= REACH; b++) {
      for (let a = -REACH; a <= REACH; a++) {
        const i = ci + a;
        const j = cj + b;
        if (i < 0 || j < 0 || i >= win.w || j >= win.h) continue;
        const l = win.near[j * win.w + i];
        if (l >= 0 && !around.includes(l)) around.push(l);
      }
    }
    k = choose(around, k, (l) => zOf(l, u, v), rel);
    return { y: zOf(k, u, v), k };
  };
}

/** Part of a polygon on one side of a line f(x, z) = 0 (kept where f * sign >= 0). */
function clip(poly, f, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p[0], p[1]) * sign;
    const fq = f(q[0], q[1]) * sign;
    if (fp >= 0) out.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const s = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]);
    }
  }
  return out;
}
const areaOf = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return a / 2;
};

/**
 * Triangles of the roof over an outline (grid frame), in cells of `cell` metres cut along the outline and along the
 * lines where two slopes meet. Returns { pos: [x, altitude, z, ...] (three points a triangle), slope: [the slope of
 * each triangle], edge: [[x, altitude, z], [x, altitude, z]] (the sides of the roof along the outline) }.
 */
export function roofMesh(model, poly, { cell = 0.25 } = {}) {
  const surface = roofSurface(model);
  const { planes, rel, win } = model;
  const zOf = (k, x, z) => planes[k].a * (x - win.x0) + planes[k].b * (z - win.z0) + planes[k].c;
  const pos = [];
  const slope = [];
  const sides = []; // sides of triangles along the outline, as the places of their two ends in `pos`
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / cell) * cell;
  const z0 = Math.floor(Math.min(...zs) / cell) * cell;
  const nu = Math.ceil((Math.max(...xs) - x0) / cell);
  const nv = Math.ceil((Math.max(...zs) - z0) / cell);
  // the cells the outline goes through
  const key = (u, v) => (v + 2) * (nu + 5) + u + 2;
  const onEdge = new Set();
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 4)));
    for (let k = 0; k <= n; k++) {
      const u = Math.floor((ax + ((bx - ax) * k) / n - x0) / cell);
      const v = Math.floor((az + ((bz - az) * k) / n - z0) / cell);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) onEdge.add(key(u + a, v + b));
    }
  }
  // (is a point on side i of the outline?)
  const onSide = (p, i) => {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (!L || Math.abs((p[0] - ax) * (bz - az) - (p[1] - az) * (bx - ax)) / L > 1e-6) return false;
    const s = ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / L;
    return s >= -1e-6 && s <= L + 1e-6;
  };
  const lay = (piece, boundary) => {
    if (piece.length < 3 || Math.abs(areaOf(piece)) < 1e-8) return;
    const cx = piece.reduce((s, p) => s + p[0], 0) / piece.length;
    const cz = piece.reduce((s, p) => s + p[1], 0) / piece.length;
    const mid = surface(cx, cz);
    if (!mid) return;
    // (a corner standing on another slope that does not meet this one in a line keeps its own height: a step)
    const yOf = (p) => {
      const own = surface(p[0], p[1]);
      return own && own.k !== mid.k && rel(own.k, mid.k) === 'step' ? own.y : zOf(mid.k, p[0], p[1]);
    };
    const tris = THREE.ShapeUtils.triangulateShape(
      piece.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    );
    for (const tri of tris) {
      // (turned so that its face looks up; three points in line make no triangle)
      const [a, b, c] = tri.map((n) => piece[n]);
      const turn = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (Math.abs(turn) < 1e-10) continue;
      if (turn < 0) tri.reverse();
      const base = pos.length;
      for (const n of tri) pos.push(piece[n][0], yOf(piece[n]), piece[n][1]);
      slope.push(mid.k);
      if (!boundary) continue;
      // its sides that lie along the outline are edges of the roof
      for (let e = 0; e < 3; e++) {
        const p = piece[tri[e]];
        const q = piece[tri[(e + 1) % 3]];
        if (poly.some((_, i) => onSide(p, i) && onSide(q, i))) sides.push([base + e * 3, base + ((e + 1) % 3) * 3]);
      }
    }
  };
  // a piece standing on several slopes is cut along the line where the planes of two of them cross, and so on
  const cut = (piece, boundary, depth) => {
    // (the slopes standing at its corners and in the middle of its sides: a slope may come in through a side)
    const found = [];
    piece.forEach((p, i) => {
      const q = piece[(i + 1) % piece.length];
      for (const [x, z] of [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]) {
        const s = surface(x, z);
        if (s && !found.includes(s.k)) found.push(s.k);
      }
    });
    let pair = null;
    for (let a = 0; a < found.length && !pair && depth < DEPTH; a++)
      for (let b = a + 1; b < found.length && !pair; b++) if (rel(found[a], found[b]) !== 'step') pair = [found[a], found[b]];
    if (!pair) return lay(piece, boundary);
    const f = (x, z) => zOf(pair[0], x, z) - zOf(pair[1], x, z);
    cut(clip(piece, f, 1), boundary, depth + 1);
    cut(clip(piece, f, -1), boundary, depth + 1);
  };
  for (let v = -1; v <= nv; v++) {
    for (let u = -1; u <= nu; u++) {
      const ax = x0 + u * cell;
      const az = z0 + v * cell;
      let piece = [[ax, az], [ax + cell, az], [ax + cell, az + cell], [ax, az + cell]]; // prettier-ignore
      const boundary = onEdge.has(key(u, v));
      if (boundary) {
        // the part of the outline standing in the cell
        piece = poly;
        if (areaOf(piece) < 0) piece = [...piece].reverse();
        piece = clip(piece, (x) => x - ax, 1);
        piece = clip(piece, (x) => ax + cell - x, 1);
        piece = clip(piece, (x, z) => z - az, 1);
        piece = clip(piece, (x, z) => az + cell - z, 1);
      } else if (!inPolygon(poly, ax + cell / 2, az + cell / 2)) continue;
      cut(piece, boundary, 0);
    }
  }
  // where several slopes meet in one point their planes seldom cross exactly there: the triangles around are brought
  // to one height, so that the roof has no slit (a real step between two roofs is left as it is)
  const places = new Map();
  for (let k = 0; k < pos.length; k += 3) {
    const id = `${Math.round(pos[k] * 1e4)}:${Math.round(pos[k + 2] * 1e4)}`;
    if (!places.has(id)) places.set(id, []);
    places.get(id).push(k + 1);
  }
  for (const list of places.values()) {
    const ys = list.map((k) => pos[k]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    if (hi - lo < 1e-9 || hi - lo > WELD) continue;
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const k of list) pos[k] = mean;
  }
  const edge = sides.map(([a, b]) => [
    [pos[a], pos[a + 1], pos[a + 2]],
    [pos[b], pos[b + 1], pos[b + 2]],
  ]);
  return { pos, slope, edge };
}

/** What a roof read from the model comes to: { planes, slope (degrees, mean by area), rise (m, ridge over the edges) }. */
export function roofInfo(model, mesh) {
  if (!model || !mesh || !mesh.pos.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 1; k < mesh.pos.length; k += 3) {
    lo = Math.min(lo, mesh.pos[k]);
    hi = Math.max(hi, mesh.pos[k]);
  }
  const used = new Set(mesh.slope);
  const cells = [...used].reduce((s, k) => s + model.planes[k].cells, 0);
  return {
    planes: used.size,
    slope: [...used].reduce((s, k) => s + model.planes[k].slope * model.planes[k].cells, 0) / cells,
    rise: hi - lo,
  };
}

/**
 * The walls of the plan that carry a roof: its outer walls, level by level, on which no wall of a higher level
 * stands. Returns [{ a, b, thickness, top (height of their top), joinStart, joinEnd }] on the plan.
 */
export function topWalls(levels) {
  const out = [];
  (levels || []).forEach((level, li) => {
    for (const w of level.walls || []) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (!w.exterior || len < 0.02) continue;
      const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      // (a wall of a level above over its middle: this one stops under a floor, not under the roof)
      const under = levels.slice(li + 1).some((up) =>
        (up.walls || []).some((v) => {
          const dx = v.b[0] - v.a[0];
          const dz = v.b[1] - v.a[1];
          const l2 = dx * dx + dz * dz;
          if (!l2) return false;
          const s = ((mid[0] - v.a[0]) * dx + (mid[1] - v.a[1]) * dz) / l2;
          return s >= 0 && s <= 1 && Math.hypot(mid[0] - v.a[0] - dx * s, mid[1] - v.a[1] - dz * s) <= (v.thickness + w.thickness) / 2;
        }),
      );
      if (!under)
        out.push({
          a: w.a,
          b: w.b,
          thickness: w.thickness,
          top: (level.elevation || 0) + w.height,
          joinStart: !!w.joinStart,
          joinEnd: !!w.joinEnd,
        });
    }
  });
  return out;
}

/** Do two walls touch: an end of one within the thickness of the other? */
function wallsMeet(w, v) {
  const reach = (w.thickness + v.thickness) / 2 + 0.05;
  const near = (p, a, b) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * s, p[1] - a[1] - dz * s) <= reach;
  };
  return near(w.a, v.a, v.b) || near(w.b, v.a, v.b) || near(v.a, w.a, w.b) || near(v.b, w.a, w.b);
}

/**
 * Roofs of the edits read from the surface model of the terrain `t`.
 * opts: toGrid(roof) and toPlan(x, z) between the frames, altToY (altitude -> height of the view), walls (those of
 * the plan that carry a roof, see topWalls), material(roof) for its slopes, edgeMaterial for its sides and for the
 * walls carried up to it.
 * A roof stands where it was measured, the walls of the plan where they were drawn: seldom at the same height. Under
 * the roof the walls are carried up to it, so that it never floats over them; `seat` is the height correction that
 * would bring it down (or up) onto the highest of them.
 * Returns { group, info: [per roof: { planes, slope, rise, seat } or null when nothing could be read], outlines:
 * [those of the roofs set in the view, on the plan] }.
 */
export function buildRoofs(roofs, t, { toGrid, toPlan, altToY, walls = [], material, edgeMaterial }) {
  const group = new THREE.Group();
  group.name = 'roofs-read';
  const info = [];
  const outlines = []; // of the roofs set in the view, on the plan
  for (const raw of roofs || []) {
    const r = normalizeRoof(raw);
    const conv = toGrid(r);
    const poly = r.pts.map(([x, z]) => conv(x, z));
    const model = r.pts.length >= 3 ? roofPlanes(t, poly) : null;
    const mesh = model ? roofMesh(model, poly) : null;
    const about = roofInfo(model, mesh);
    info.push(about);
    if (!about) continue;
    // the roof over a point of the plan, before its height correction (null out of its outline)
    const surface = roofSurface(model);
    const planToGrid = toGrid({ frame: 'plan' });
    const over = (x, z) => {
      const [gx, gz] = planToGrid(x, z);
      const here = inPolygon(poly, gx, gz) ? surface(gx, gz) : null;
      return here ? altToY(here.y) : null;
    };
    // the two faces of the walls under it, in steps of 25 cm: [x, z, top of the wall, roof] or null out of the roof
    const under = []; // { w, both: its two faces, least: how close the roof comes over it, most: how far it stands in it }
    about.seat = null;
    for (const w of walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const ux = (w.b[0] - w.a[0]) / len;
      const uz = (w.b[1] - w.a[1]) / len;
      // (as it is drawn: half its thickness longer at an end that joins another wall)
      const from = w.joinStart ? -w.thickness / 2 : 0;
      const to = len + (w.joinEnd ? w.thickness / 2 : 0);
      const n = Math.max(1, Math.ceil((to - from) / UPSTAND));
      const both = [];
      let least = Infinity; // how close the roof comes over the wall
      let most = -Infinity;
      for (const side of [1, -1]) {
        const face = [];
        for (let k = 0; k <= n; k++) {
          const d = from + ((to - from) * k) / n;
          const x = w.a[0] + ux * d - uz * (w.thickness / 2) * side;
          const z = w.a[1] + uz * d + ux * (w.thickness / 2) * side;
          const y = over(x, z);
          if (y !== null) {
            least = Math.min(least, y - w.top);
            most = Math.max(most, w.top - y);
          }
          face.push(y === null ? null : [x, z, w.top, y]);
        }
        both.push(face);
      }
      if (Number.isFinite(least)) under.push({ w, both, least, most });
    }
    // The walls that carry the roof: those it comes close to somewhere (a wall the roof stays far above all along
    // does not carry it: a low wall under a porch, a wall of the garden), and the walls of the same height that go on
    // from one of them. A door set back in a facade, the back of a porch stand further under the slope than the walls
    // along the eaves: the roof is higher over them, and they would leave a gap under it.
    const carrying = new Set(under.filter((u) => u.least <= REACH_UP));
    for (let grew = true; grew;) {
      grew = false;
      for (const u of under) {
        if (carrying.has(u)) continue;
        for (const v of carrying) {
          if (Math.abs(v.w.top - u.w.top) > LEVEL || !wallsMeet(u.w, v.w)) continue;
          carrying.add(u);
          grew = true;
          break;
        }
      }
    }
    const faces = [];
    for (const u of carrying) {
      about.seat = Math.max(about.seat ?? -Infinity, u.most);
      faces.push(...u.both);
    }
    if (about.seat !== null) about.seat = Math.round(about.seat * 100) / 100;
    if (!mesh.pos.length || r.hidden) continue;
    outlines.push(poly.map(([x, z]) => toPlan(x, z)));
    const P = new Float32Array(mesh.pos.length);
    for (let k = 0; k < mesh.pos.length; k += 3) {
      const [x, z] = toPlan(mesh.pos[k], mesh.pos[k + 2]);
      P[k] = x;
      P[k + 1] = altToY(mesh.pos[k + 1]) + r.dy;
      P[k + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.computeVertexNormals(); // (not indexed: every triangle keeps the normal of its slope)
    const top = new THREE.Mesh(geo, material(r));
    top.castShadow = true;
    top.receiveShadow = true;
    top.name = `roof-read-${r.id}`;
    group.add(top);
    // its sides: a fascia along the edge of the slopes
    const E = [];
    for (const [p, q] of mesh.edge) {
      const [px, pz] = toPlan(p[0], p[2]);
      const [qx, qz] = toPlan(q[0], q[2]);
      const py = altToY(p[1]) + r.dy;
      const qy = altToY(q[1]) + r.dy;
      E.push(px, py, pz, qx, qy, qz, qx, qy - FASCIA, qz, px, py, pz, qx, qy - FASCIA, qz, px, py - FASCIA, pz);
    }
    // the walls of the plan carried up to it, where they stop short of it (their two faces; the roof closes the top)
    for (const face of faces) {
      for (let k = 0; k < face.length - 1; k++) {
        const [p, q] = [face[k], face[k + 1]];
        if (!p || !q) continue;
        const pt = p[3] + r.dy - 0.01;
        const qt = q[3] + r.dy - 0.01;
        if (pt <= p[2] && qt <= q[2]) continue;
        E.push(
          p[0],
          p[2],
          p[1],
          q[0],
          q[2],
          q[1],
          q[0],
          Math.max(qt, q[2]),
          q[1],
          p[0],
          p[2],
          p[1],
          q[0],
          Math.max(qt, q[2]),
          q[1],
          p[0],
          Math.max(pt, p[2]),
          p[1],
        );
      }
    }
    if (E.length) {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(E, 3));
      eg.computeVertexNormals();
      const sides = new THREE.Mesh(eg, edgeMaterial);
      sides.castShadow = true;
      sides.name = `roof-read-sides-${r.id}`;
      group.add(sides);
    }
  }
  return { group, info, outlines };
}

/**
 * The roof of the plan (scene-model.js) without what stands under the roofs read from the model: the slabs of a flat
 * roof whose middle is in one of their outlines, a roof of two slopes when its middle is. Null when nothing is left.
 */
export function uncoveredRoof(spec, outlines) {
  if (!spec || !outlines || !outlines.length) return spec || null;
  const under = (x, z) => outlines.some((poly) => inPolygon(poly, x, z));
  if (spec.type === 'flat') {
    const polys = spec.polys.filter((p) => !under(p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length));
    return polys.length ? { ...spec, polys } : null;
  }
  return spec.fp && under((spec.fp.x0 + spec.fp.x1) / 2, (spec.fp.z0 + spec.fp.z1) / 2) ? null : spec;
}
