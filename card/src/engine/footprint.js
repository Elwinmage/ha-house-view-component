// The house in the ground.
//
// The ground of a terrain is one mesh, with a vertex every half metre or so (terrain.js). Under the house it has to
// stay below the floors, and around a level that is sunk in the ground (a basement, a house built in a slope) it has
// to stop at the outer face of the walls, straight down. A mesh that only went down under the rooms would slope from
// the garden to the pit through the walls, and show as mounds of earth along them inside the rooms.
//
// houseFootprint() describes what the house takes up on the plan, level by level: its rooms, and the walls where a
// room stands against them (a wall drawn alone in the garden holds no room and is left to the ground). It gives:
//   - floorAt(x, z): the lowest floor standing over a point, null outside the house;
//   - edge(x, z, reach): the nearest place, within `reach`, where the floor over the ground changes (the outline of
//     the house, and inside it the limit of a lower level), as a point standing just on the higher side of it;
//   - corners: the points where such a limit turns, standing just on the higher side as well.
import { inPolygon, nearestOnOutline } from '../pools.js';

const STEP = 0.2; // a wall is looked at every 20 cm to tell where a room stands against it
const ATTACH = 0.25; // how far from the face of a wall a room still makes it a wall of the house
const SAMPLE = 0.05; // the limits are kept as points every 5 cm
const OUT = 0.02; // a point "on" a limit stands this far on its higher side
const BUCKET = 1; // size of the cells of the lookup grids
const MEET = 0.1; // two limits ending this close to one another make a corner

const boxOf = (pts) => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
};

/** Corners of the part of a wall body between two distances along its line (counted from its first point). */
const wallCorners = (w, u0, u1) => {
  const h = w.half;
  return [
    [w.ax + w.ux * u0 + w.nx * h, w.az + w.uz * u0 + w.nz * h],
    [w.ax + w.ux * u1 + w.nx * h, w.az + w.uz * u1 + w.nz * h],
    [w.ax + w.ux * u1 - w.nx * h, w.az + w.uz * u1 - w.nz * h],
    [w.ax + w.ux * u0 - w.nx * h, w.az + w.uz * u0 - w.nz * h],
  ];
};

/**
 * Parts of the walls of a level that belong to the house: where a room of the level stands against the wall, on
 * either side. The body is the one that is drawn (geometry.js): half the thickness longer at an end that joins
 * another wall.
 */
function houseWalls(level, rooms) {
  const out = [];
  for (const wall of level.walls || []) {
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;
    const w = { ax: wall.a[0], az: wall.a[1], ux: dx / len, uz: dz / len, nx: -dz / len, nz: dx / len, half: wall.thickness / 2 };
    const reach = w.half + ATTACH;
    const b = boxOf([wall.a, wall.b]);
    const near = rooms.filter((r) => r.box[0] <= b[2] + reach && r.box[2] >= b[0] - reach && r.box[1] <= b[3] + reach && r.box[3] >= b[1] - reach);
    if (!near.length) continue;
    const n = Math.max(1, Math.ceil(len / STEP));
    const held = (k) => {
      const u = (len * k) / n;
      const x = w.ax + w.ux * u;
      const z = w.az + w.uz * u;
      return near.some((r) => inPolygon(r.poly, x, z) || nearestOnOutline(r.poly, x, z).d <= reach);
    };
    let from = null;
    for (let k = 0; k <= n + 1; k++) {
      const on = k <= n && held(k);
      if (on && from === null) from = k;
      if (!on && from !== null) {
        const to = k - 1;
        // (a run that reaches an end of the wall takes the end as it is drawn; elsewhere it stops half a step on)
        const u0 = from === 0 ? (wall.joinStart ? -w.half : 0) : (len * (from - 0.5)) / n;
        const u1 = to === n ? len + (wall.joinEnd ? w.half : 0) : (len * (to + 0.5)) / n;
        out.push(wallCorners(w, u0, u1));
        from = null;
      }
    }
  }
  return out;
}

// the last house worked out: the ground is built again at every correction, the plan seldom changes
let last = { sign: null, house: null };
const signOf = (levels) =>
  JSON.stringify(
    levels.map((l) => [
      l.elevation,
      (l.rooms || []).map((r) => [r.poly, !!r.noFloor]),
      (l.walls || []).map((w) => [w.a, w.b, w.thickness, !!w.joinStart, !!w.joinEnd]),
    ]),
  );

/**
 * What the house takes up on the plan: { box, floorAt(x, z), edge(x, z, reach), corners }, or null for a plan
 * without rooms.
 * `levels` are those of the scene (scene-model.js), lowest first.
 */
export function houseFootprint(levels) {
  if (!Array.isArray(levels) || !levels.length) return null;
  const sign = signOf(levels);
  if (last.sign === sign) return last.house;
  last = { sign, house: null };
  // every part is a convex or simple polygon with the height of the floor of its level
  const parts = [];
  levels.forEach((level, li) => {
    const y = Number.isFinite(level.elevation) ? level.elevation : 0;
    const rooms = (level.rooms || [])
      // (an upper room without a floor is a void over the level below: it keeps nothing out)
      .filter((r) => Array.isArray(r.poly) && r.poly.length >= 3 && !(li > 0 && r.noFloor))
      .map((r) => ({ poly: r.poly, box: boxOf(r.poly) }));
    for (const r of rooms) parts.push({ poly: r.poly, box: r.box, y });
    for (const poly of houseWalls(level, rooms)) parts.push({ poly, box: boxOf(poly), y });
  });
  if (!parts.length) return null;
  const box = boxOf(parts.flatMap((p) => [
    [p.box[0], p.box[1]],
    [p.box[2], p.box[3]],
  ]));
  const key = (i, j) => i * 100003 + j;
  const cellOf = (v, o) => Math.floor((v - o) / BUCKET);
  const grid = new Map();
  for (const p of parts) {
    for (let i = cellOf(p.box[0], box[0]); i <= cellOf(p.box[2], box[0]); i++) {
      for (let j = cellOf(p.box[1], box[1]); j <= cellOf(p.box[3], box[1]); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
    }
  }
  const floorAt = (x, z) => {
    if (x < box[0] || x > box[2] || z < box[1] || z > box[3]) return null;
    const list = grid.get(key(cellOf(x, box[0]), cellOf(z, box[1])));
    if (!list) return null;
    let y = null;
    for (const p of list) {
      if (y !== null && p.y >= y) continue;
      if (x < p.box[0] || x > p.box[2] || z < p.box[1] || z > p.box[3]) continue;
      if (inPolygon(p.poly, x, z)) y = p.y;
    }
    return y;
  };

  // the limits: the sides of the parts where the floor is higher, or missing, on the other side
  const marks = new Map();
  const ends = []; // where a limit starts or stops along a side
  for (const p of parts) {
    let area = 0;
    for (let i = 0; i < p.poly.length; i++) {
      const [x1, z1] = p.poly[i];
      const [x2, z2] = p.poly[(i + 1) % p.poly.length];
      area += x1 * z2 - x2 * z1;
    }
    const turn = area > 0 ? 1 : -1;
    for (let i = 0; i < p.poly.length; i++) {
      const [ax, az] = p.poly[i];
      const [bx, bz] = p.poly[(i + 1) % p.poly.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      // (out of the part: on the right of a side when the outline turns counter-clockwise in x/z)
      const nx = tz * turn;
      const nz = -tx * turn;
      const n = Math.max(1, Math.ceil(len / SAMPLE));
      const half = len / n / 2;
      let run = null; // floor on the low side of the limit being followed
      const end = (k, y) => ends.push({ x: ax + tx * 2 * k * half, z: az + tz * 2 * k * half, tx, tz, nx, nz, y });
      for (let k = 0; k < n; k++) {
        const x = ax + tx * (2 * k + 1) * half;
        const z = az + tz * (2 * k + 1) * half;
        const low = floorAt(x - nx * OUT, z - nz * OUT);
        const high = low === null ? null : floorAt(x + nx * OUT, z + nz * OUT);
        if (low === null || (high !== null && high <= low + 1e-6)) {
          if (run !== null) end(k, run);
          run = null;
          continue;
        }
        if (run === null) end(k, low);
        run = low;
        const m = { x, z, tx, tz, nx, nz, half, y: low };
        const kk = key(cellOf(x, box[0]), cellOf(z, box[1]));
        if (!marks.has(kk)) marks.set(kk, []);
        marks.get(kk).push(m);
      }
      if (run !== null) end(n, run);
    }
  }
  // corners: two limits that end at the same place (where they cross when they are not in line), else a lone end
  const corners = [];
  const used = new Set();
  ends.forEach((e, i) => {
    if (used.has(i)) return;
    used.add(i);
    let j = -1;
    let bd = MEET;
    ends.forEach((f, k) => {
      const d = Math.hypot(f.x - e.x, f.z - e.z);
      if (!used.has(k) && d < bd) {
        bd = d;
        j = k;
      }
    });
    const f = j < 0 ? e : ends[j];
    used.add(j);
    let x = (e.x + f.x) / 2;
    let z = (e.z + f.z) / 2;
    const cross = e.tx * f.tz - e.tz * f.tx;
    if (Math.abs(cross) > 0.2) {
      const s = ((f.x - e.x) * f.tz - (f.z - e.z) * f.tx) / cross;
      x = e.x + e.tx * s;
      z = e.z + e.tz * s;
    }
    // the point that stands OUT away from both limits, on their higher side
    const k = 1 + e.nx * f.nx + e.nz * f.nz;
    if (k < 0.2) return;
    const c = { x: x + ((e.nx + f.nx) * OUT) / k, z: z + ((e.nz + f.nz) * OUT) / k, y: Math.min(e.y, f.y) };
    const over = floorAt(c.x, c.z);
    if (over === null || over > c.y + 1e-6) corners.push(c);
  });
  const edge = (x, z, reach) => {
    if (x < box[0] - reach || x > box[2] + reach || z < box[1] - reach || z > box[3] + reach) return null;
    const span = Math.ceil(reach / BUCKET);
    const ci = cellOf(x, box[0]);
    const cj = cellOf(z, box[1]);
    let best = null;
    let bd = reach * reach;
    for (let i = ci - span; i <= ci + span; i++) {
      for (let j = cj - span; j <= cj + span; j++) {
        const list = marks.get(key(i, j));
        if (!list) continue;
        for (const m of list) {
          const d = (x - m.x) * (x - m.x) + (z - m.z) * (z - m.z);
          if (d < bd) {
            bd = d;
            best = m;
          }
        }
      }
    }
    if (!best) return null;
    // along its side, the mark stands for half a step on each side of its point
    const s = Math.max(-best.half, Math.min(best.half, (x - best.x) * best.tx + (z - best.z) * best.tz));
    return { x: best.x + best.tx * s + best.nx * OUT, z: best.z + best.tz * s + best.nz * OUT, y: best.y };
  };
  last.house = { box, floorAt, edge, corners };
  return last.house;
}

/** A closed line with fewer points: those further than `tol` from the line through their neighbours are kept. */
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  // (Douglas-Peucker on the two halves between its first point and the one furthest from it)
  let far = 0;
  pts.forEach((p, i) => {
    if (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  });
  const half = (line) => {
    const [a, b] = [line[0], line[line.length - 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let worst = 0;
    let at = -1;
    for (let i = 1; i < line.length - 1; i++) {
      const d = Math.abs((line[i][0] - a[0]) * (b[1] - a[1]) - (line[i][1] - a[1]) * (b[0] - a[0])) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    return worst <= tol ? [a] : [...half(line.slice(0, at + 1)), ...half(line.slice(at))];
  };
  return [...half(pts.slice(0, far + 1)), ...half([...pts.slice(far), pts[0]])];
}

/**
 * Outline of the largest block of what `covered(x, z)` holds inside a box [x0, z0, x1, z1], drawn in cells of `R`
 * metres: the edge of the block followed along the sides of its cells (a point at every cell), null when nothing is
 * covered. What stands apart from the block is left out.
 */
function blockOutline(box, R, covered) {
  const x0 = box[0] - 2 * R;
  const z0 = box[1] - 2 * R;
  const w = Math.ceil((box[2] - box[0]) / R) + 4;
  const h = Math.ceil((box[3] - box[1]) / R) + 4;
  const part = new Int32Array(w * h); // 0: not covered, else the number of its block
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (covered(x0 + (i + 0.5) * R, z0 + (j + 0.5) * R)) part[j * w + i] = -1;
  let best = 0;
  let size = 0;
  let pieces = 0;
  for (let k = 0; k < w * h; k++) {
    if (part[k] !== -1) continue;
    pieces++;
    let n = 0;
    const stack = [k];
    part[k] = pieces;
    while (stack.length) {
      const c = stack.pop();
      n++;
      for (const d of [1, -1, w, -w]) {
        const e = c + d;
        if (e >= 0 && e < w * h && part[e] === -1 && (Math.abs(d) !== 1 || Math.floor(e / w) === Math.floor(c / w))) {
          part[e] = pieces;
          stack.push(e);
        }
      }
    }
    if (n > size) {
      size = n;
      best = pieces;
    }
  }
  if (!best) return null;
  const inside = (i, j) => i >= 0 && j >= 0 && i < w && j < h && part[j * w + i] === best;
  // its edge, followed along the sides of the cells with the block on the right
  let start = 0;
  while (part[start] !== best) start++;
  const sx = start % w;
  const sy = Math.floor(start / w);
  let [x, y, dx, dy] = [sx, sy, 1, 0];
  const line = [];
  for (let guard = 0; guard < 8 * w * h; guard++) {
    // the cells ahead of the point, on the left and on the right of the way followed
    const left = dx === 1 ? [x, y - 1] : dx === -1 ? [x - 1, y] : dy === 1 ? [x, y] : [x - 1, y - 1];
    const right = dx === 1 ? [x, y] : dx === -1 ? [x - 1, y - 1] : dy === 1 ? [x - 1, y] : [x, y - 1];
    if (inside(...left)) [dx, dy] = [dy, -dx];
    else if (!inside(...right)) [dx, dy] = [-dy, dx];
    if (line.length && x === sx && y === sy && dx === 1 && dy === 0) break; // back where it started
    line.push([x0 + x * R, z0 + y * R]);
    x += dx;
    y += dy;
  }
  return line;
}

/**
 * Outline of what several outlines cover together, as a closed line of points (given open); null when they cover
 * nothing. Its corners are those of the outlines given, where one stands within reach. What stands apart from the
 * largest block is left out.
 */
export function unionOutline(polys) {
  const list = (polys || []).filter((p) => Array.isArray(p) && p.length >= 3);
  if (!list.length) return null;
  const all = list.flat();
  const R = 0.05;
  const line = blockOutline(boxOf(all), R, (x, z) => list.some((p) => inPolygon(p, x, z)));
  if (!line) return null;
  let pts = simplify(line, 1.5 * R).map((p) => {
    let to = p;
    let bd = 0.12;
    for (const c of all) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (d < bd) {
        bd = d;
        to = c;
      }
    }
    return [Math.round(to[0] * 100) / 100, Math.round(to[1] * 100) / 100];
  });
  pts = pts.filter((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]) > 1e-6);
  // (the cells blunt a sharp corner: the point they leave beside it, on the side that runs to it, is no corner)
  for (let k = 0; k < pts.length && pts.length > 3; ) {
    const m = pts.length;
    if (toSegment(pts[k], pts[(k + m - 1) % m], pts[(k + 1) % m]) < 1.2 * R) pts.splice(k, 1);
    else k++;
  }
  return pts.length >= 3 ? pts : null;
}

const MOUTH = 8; // widest recess of the walls a roof is taken to span (m)
const DEEP = 0.5; // a recess shallower than this is left to the eaves (m)
const SHARE = 0.8; // part of a recess the roof has to stand over for the recess to be closed
const BEHIND = 1; // the roof of the house is read this far behind the walls of a recess (m)
const DROP = 1; // the roof over a recess stands within this of the roof behind its walls (m)...
const SLOPE = 0.6; // ...plus this for each metre it runs away from them (a slope of 31 degrees)
const STRAIGHT = 0.03; // a point this close to the line between its neighbours is no corner (m)

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  return a / 2;
};
const crossing = (a, b, c, d) => {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};
const toSegment = (p, a, b) => {
  const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - (b[0] - a[0]) * u, p[1] - a[1] - (b[1] - a[1]) * u);
};

/**
 * Is a recess of the walls under the roof? `pocket` is its outline (the two ends of its mouth first and last, its
 * walls in between), `turn` the way the outline of the house turns. The roof has to stand over most of it, at about
 * the height it has behind the walls: a canopy or a car standing in the recess, a tree spreading over it are not the
 * roof.
 */
function roofed(pocket, turn, surfaceAt) {
  // the roof of the house, just behind the walls of the recess
  const behind = [];
  for (let k = 0; k + 1 < pocket.length; k++) {
    const [p, q] = [pocket[k], pocket[k + 1]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-6) continue;
    const y = surfaceAt((p[0] + q[0]) / 2 - ((q[1] - p[1]) / len) * turn * BEHIND, (p[1] + q[1]) / 2 + ((q[0] - p[0]) / len) * turn * BEHIND);
    if (y !== null) behind.push(y);
  }
  if (!behind.length) return false;
  behind.sort((a, b) => a - b);
  const ref = behind[Math.floor(behind.length / 2)];
  const xs = pocket.map((p) => p[0]);
  const zs = pocket.map((p) => p[1]);
  const G = 0.25;
  let all = 0;
  let under = 0;
  for (let z = Math.min(...zs) + G / 2; z < Math.max(...zs); z += G) {
    for (let x = Math.min(...xs) + G / 2; x < Math.max(...xs); x += G) {
      if (!inPolygon(pocket, x, z)) continue;
      all++;
      const y = surfaceAt(x, z);
      if (y === null) continue;
      let away = Infinity;
      for (let k = 0; k + 1 < pocket.length; k++) away = Math.min(away, toSegment([x, z], pocket[k], pocket[k + 1]));
      if (Math.abs(y - ref) <= DROP + SLOPE * away) under++;
    }
  }
  return all >= 3 && under >= SHARE * all;
}

/**
 * An outline of walls with its covered recesses closed. An entrance set back in a facade, a porch, a loggia stand
 * under the roof although the walls go around them: followed as it is, the outline would leave a hole in the roof
 * over each. A recess is a stretch of the outline that a straight line between two of its points leaves outside the
 * house; it is closed, the line taking its place, when `surfaceAt(x, z)` (altitude of the roof at a point, null where
 * no roof stands) shows the roof over it. The largest recess under the roof goes first, with whatever it holds.
 */
export function closeCovered(pts, surfaceAt) {
  let line = pts.slice();
  for (let guard = 0; guard < 64 && line.length > 3; guard++) {
    const n = line.length;
    const turn = signedArea(line) > 0 ? 1 : -1;
    let best = null;
    for (let i = 0; i < n; i++) {
      for (let len = 2; len <= n - 2; len++) {
        const a = line[i];
        const b = line[(i + len) % n];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L > MOUTH || L < 1e-6) continue;
        // its walls all stand on the side of the house, somewhere deep enough
        let deep = 0;
        let ok = true;
        for (let k = 1; k < len && ok; k++) {
          const p = line[(i + k) % n];
          const d = (((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L) * turn;
          if (d < -1e-9) ok = false;
          deep = Math.max(deep, d);
        }
        if (!ok || deep < DEEP) continue;
        // the line across its mouth meets no other side of the outline
        for (let k = len; k < n && ok; k++) {
          const c = line[(i + k) % n];
          const d = line[(i + k + 1) % n];
          if (c !== a && c !== b && d !== a && d !== b && crossing(a, b, c, d)) ok = false;
        }
        if (!ok) continue;
        const pocket = [];
        for (let k = 0; k <= len; k++) pocket.push(line[(i + k) % n]);
        const area = Math.abs(signedArea(pocket));
        if ((best && area <= best.area) || !roofed(pocket, turn, surfaceAt)) continue;
        best = { i, len, area };
      }
    }
    if (!best) break;
    const [a, b] = [line[best.i], line[(best.i + best.len) % n]];
    line = line.filter((_, k) => {
      const off = (k - best.i + n) % n;
      return off === 0 || off >= best.len;
    });
    // the two ends of the mouth are no corners any more when the facade runs straight through them
    for (const end of [a, b]) {
      const k = line.indexOf(end);
      const m = line.length;
      if (m > 3 && toSegment(end, line[(k + m - 1) % m], line[(k + 1) % m]) < STRAIGHT) line.splice(k, 1);
    }
  }
  return line;
}

/**
 * Outline of the house on the plan: the outer face of its walls, all levels together, as a closed line of points
 * (given open), pushed out by `overhang` metres (the eaves of a roof). Null for a plan without rooms.
 * What the house takes up is drawn in cells of 5 cm and its edge followed, then straightened: the corners are those
 * of the walls where one stands within reach. With `surfaceAt` (altitude of the roof at a point of the plan, null
 * where none stands), the recesses of the walls that are under the roof are closed (closeCovered).
 */
export function houseOutline(levels, overhang = 0, surfaceAt = null) {
  // (two walls that meet without being joined leave a nick of half their thickness at their corner: here every wall
  // goes on to the corner, as the roof does)
  const joined = Array.isArray(levels) ? levels.map((l) => ({ ...l, walls: (l.walls || []).map((w) => ({ ...w, joinStart: true, joinEnd: true })) })) : levels;
  const house = houseFootprint(joined);
  if (!house) return null;
  const R = 0.05;
  const line = blockOutline(house.box, R, (x, z) => house.floorAt(x, z) !== null);
  if (!line) return null;
  let pts = simplify(line, 1.5 * R);
  // (a corner of the walls within 12 cm is the corner meant)
  pts = pts.map((p) => {
    let to = p;
    let bd = 0.12;
    for (const c of house.corners) {
      const d = Math.hypot(c.x - p[0], c.z - p[1]);
      if (d < bd) {
        bd = d;
        to = [c.x, c.z];
      }
    }
    return to;
  });
  pts = pts.filter((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]) > 1e-6);
  if (pts.length < 3) return null;
  if (surfaceAt) pts = closeCovered(pts, surfaceAt);
  // pushed out: every side by the overhang, the corners where the sides moved so cross
  let area = 0;
  pts.forEach((p, i) => (area += p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1]));
  const turn = area > 0 ? 1 : -1;
  const out = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [((b[1] - a[1]) / len) * turn, (-(b[0] - a[0]) / len) * turn];
  };
  const pushed = pts.map((p, i) => {
    const n1 = out(pts[(i + pts.length - 1) % pts.length], p);
    const n2 = out(p, pts[(i + 1) % pts.length]);
    const k = Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + ((n1[0] + n2[0]) * overhang) / k, p[1] + ((n1[1] + n2[1]) * overhang) / k];
  });
  return pushed.map(([px, pz]) => [Math.round(px * 100) / 100, Math.round(pz * 100) / 100]);
}
