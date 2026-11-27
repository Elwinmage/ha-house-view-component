// Manual corrections of the ground, stored in the edits file as a list of operations expressed in the
// TERRAIN GRID frame with absolute altitudes (m): they stay attached to the real world when the plan
// registration (rotation / shift / base height) is changed afterwards.
//
//   { type: 'wall',    pts: [[gx, gz]...], hi, lo, hi2?, lo2?, side: 1|-1, flat: 1.5, feather: 2, kind?, c? }
//        retaining wall: ground held flat at `hi` on the high side and at `lo` on the low side, with a vertical
//        masonry face on the line. side = +1 when the high side is to the left of the drawing direction... (see sideOf)
//        `hi` and `lo` are the altitudes at the first point, `hi2` and `lo2` at the last one (the same when they are
//        not given): the top and the foot run straight from one end to the other, along the length of the wall.
//        `kind` is the facing of the masonry (wall-art.js) and `c` a colour of the user's own.
//   { type: 'terrace', poly: [[gx, gz]...], alt, feather: 1, deck? }   flat platform; `deck` is the thickness of the
//        terrace of the garden laid on it, when there is one (terraces.js: the platform was not drawn by hand)
//   { type: 'brush',   pt: [gx, gz], r, mode: 'set' | 'add' | 'smooth', value }
//
// How they live together (compileOps):
//   - they are applied in their order: where two of them meet, the last one drawn has the last word;
//   - a wall has no hold on the ground behind another wall: what that one retains is its own;
//   - the blend around a platform stops at a wall, and a strip of a platform that goes a little past a wall (its
//     outline was drawn along the wall by hand) is left to the wall;
//   - the earth never comes up through a terrace of the garden, but on the high side of a wall standing on it.

export const WALL_T = 0.4; // masonry thickness (m)

const smooth = (t) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Falloff of a brush at distance `d` of its centre (1 at the centre, 0 at the edge). */
export const brushK = (d, r) => (d >= r ? 0 : Math.cos((d / r) * Math.PI * 0.5) ** 2);

/** Signed side of point (x,z) relative to segment a->b: +1 left (in x/z axes), -1 right. */
const sideOf = (ax, az, bx, bz, x, z) => ((bx - ax) * (z - az) - (bz - az) * (x - ax) >= 0 ? 1 : -1);

/** Altitudes of a wall at its two ends: { hi, lo, hi2, lo2 }, the last point taking those of the first by default. */
export function wallEnds(op) {
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  return { hi: op.hi, lo: op.lo, hi2: fin(op.hi2, op.hi), lo2: fin(op.lo2, op.lo) };
}

/** The wall changes height or foot along its length (else one altitude each is enough to describe it). */
export const wallSlopes = (op) => {
  const e = wallEnds(op);
  return e.hi2 !== e.hi || e.lo2 !== e.lo;
};

/** Run of every point of a polyline from its first one (m), the last value being its length. */
export function runsOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/**
 * Top and foot (scene y) of a compiled wall `w` where it is `run` meters from its first point: [top, foot]. Past
 * its ends it keeps the heights of the end.
 */
export function wallLevels(w, run) {
  const k = w.len > 0 ? Math.min(Math.max(run / w.len, 0), 1) : 0;
  return [w.hiY + (w.hi2Y - w.hiY) * k, w.loY + (w.lo2Y - w.loY) * k];
}

/**
 * Side of the point (x, z) at the bend `v` of a polyline, when that corner is the nearest point of the line: +1
 * left, -1 right, null at an end of the line or on a line folded back on itself. The line of one segment carried
 * on past the corner would say the wrong side in part of the angle the corner juts into, as soon as the line turns
 * by more than a right angle (a step back drawn by hand): the two segments tell it together, by the direction
 * half-way between their normals.
 */
function cornerSide(pts, v, x, z) {
  if (v <= 0 || v >= pts.length - 1) return null;
  const [vx, vz] = pts[v];
  let nx = 0;
  let nz = 0;
  for (const [[ax, az], [bx, bz]] of [[pts[v - 1], pts[v]], [pts[v], pts[v + 1]]]) { // prettier-ignore
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) return null;
    nx -= (bz - az) / L;
    nz += (bx - ax) / L;
  }
  if (Math.hypot(nx, nz) < 1e-6) return null;
  return (x - vx) * nx + (z - vz) * nz >= 0 ? 1 : -1;
}

/** Nearest point of a polyline: { d, s (side), t (0..1 along the segment), px, pz, interior }. */
export function nearestOnLine(pts, x, z) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    if (L2 < 1e-9) continue;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    const tc = Math.min(Math.max(t, 0), 1);
    const px = ax + dx * tc;
    const pz = az + dz * tc;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { d, s: sideOf(ax, az, bx, bz, x, z), t, px, pz, interior: t > 0 && t < 1, seg: i };
  }
  if (best && !best.interior) best.s = cornerSide(pts, best.t <= 0 ? best.seg : best.seg + 1, x, z) ?? best.s;
  return best;
}

/** Nearest point of a closed outline: { d, px, pz }. */
export function nearestOnRing(poly, x, z) {
  let best = { d: Infinity, px: x, pz: z };
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / L2, 0), 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz };
  }
  return best;
}

export const distToPolygon = (poly, x, z) => nearestOnRing(poly, x, z).d;

export function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Point of a compiled wall `run` meters from its first point (kept between its two ends). */
export function pointAtRun(w, run) {
  let i = 0;
  while (i < w.pts.length - 2 && w.cum[i + 1] < run) i++;
  const L = w.cum[i + 1] - w.cum[i];
  const t = L > 0 ? Math.min(Math.max((run - w.cum[i]) / L, 0), 1) : 0;
  return [w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * t, w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * t];
}

/** Shortest stretch of a wall between two of its points (m): nearer than that, the two are one point. */
const MIN_STRETCH = 0.05;
/** How far back from an end of a wall its hold on the ground is counted from, to tell what stands in between (m). */
const END_BACK = 0.5;
/** A strip of a platform that goes less than this past a wall is a slip of the hand (m), probed every SPILL_STEP. */
const SPILL = 1;
const SPILL_STEP = 0.1;
/** Flat band of a wall, in cells of the ground mesh at least: nearer the line, the mesh has no vertex of its own. */
const FLAT_CELLS = 2.9;
/**
 * A wall raises the ground of a terrace of the garden when it holds it this much above its top, at least (m): a
 * planter. Lower than that it is a kerb, or a top typed a little above the terrace it holds, and the terrace stays
 * clear.
 */
const PLANTER = 0.25;

const boxOf = (pts) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of pts) {
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], z);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], z);
  }
  return b;
};
/** The point (x, z) is further than `m` from the box [x0, z0, x1, z1]. */
const away = (b, x, z, m) => x < b[0] - m || x > b[2] + m || z < b[1] - m || z > b[3] + m;

/**
 * Compile the operations for one terrain build.
 * `toPlan(gx, gz)` maps a grid point to the plan frame, `altToY(alt)` maps an absolute altitude to scene y, `cell`
 * is the size of a cell of the ground mesh (m).
 * Returns { apply(x, z, h, raw), snap(x, z, cell), walls, crosses(ax, az, bx, bz), spills(poly, x, z),
 * meet(ax, az, bx, bz) } (all in the plan frame).
 */
export function compileOps(ops, toPlan, altToY, { cell = 0 } = {}) {
  const list = [];
  const walls = [];
  const decks = [];
  for (const op of ops || []) {
    if (op.type === 'wall' && op.pts && op.pts.length >= 2) {
      const e = wallEnds(op);
      // two points on top of each other (a double click, a point dragged onto the next one) are one point: a
      // stretch of no length has no direction, and the sides of the wall could not be told around it
      const pts = [];
      for (const [x, z] of op.pts) {
        const p = toPlan(x, z);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STRETCH) pts.push(p);
      }
      if (pts.length < 2) continue;
      const w = { ...op, pts, hiY: altToY(e.hi), loY: altToY(e.lo), hi2Y: altToY(e.hi2), lo2Y: altToY(e.lo2) };
      w.cum = runsOf(w.pts);
      w.len = w.cum[w.cum.length - 1];
      // nearer than a few cells the mesh only has the vertices moved onto the faces of the wall (see `snap`): a
      // narrower flat band would be drawn as a slope starting right at the wall, in teeth along a slanted one
      const flat = op.flat ?? 1.5;
      w.flat = flat > 0 ? Math.max(flat, FLAT_CELLS * cell) : 0;
      w.feather = op.feather ?? 2;
      w.reach = w.flat + w.feather;
      w.box = boxOf(w.pts);
      list.push(w);
      walls.push(w);
    } else if (op.type === 'terrace' && op.poly && op.poly.length >= 3) {
      const t = { ...op, poly: op.poly.map(([x, z]) => toPlan(x, z)), y: altToY(op.alt), feather: op.feather ?? 1 };
      t.box = boxOf(t.poly);
      list.push(t);
      if (op.deck > 0) decks.push(t);
    } else if (op.type === 'brush' && op.pt) {
      const [cx, cz] = toPlan(op.pt[0], op.pt[1]);
      list.push({ ...op, c: [cx, cz], y: op.mode === 'set' ? altToY(op.value) : 0 });
    }
  }
  const side = (px, pz, qx, qz, x, z) => (qx - px) * (z - pz) - (qz - pz) * (x - px);
  // Where the segment e0 -> e1 goes across p -> q, as a share of its length; null when it does not.
  const crossAt = ([ax, az], [bx, bz], [px, pz], [qx, qz]) => {
    const det = (bx - ax) * (qz - pz) - (bz - az) * (qx - px);
    if (Math.abs(det) < 1e-12) return null;
    const t = ((px - ax) * (qz - pz) - (pz - az) * (qx - px)) / det;
    const u = ((px - ax) * (bz - az) - (pz - az) * (bx - ax)) / det;
    return t > 0 && t < 1 && u > 0 && u < 1 ? t : null;
  };
  // What a wall hides from the others (`screened`): its line, less the stub of an end drawn a little too far, through
  // the wall it meets. On the far side of that wall the stub is no wall at all: the ground there is the other's.
  for (const w of walls) {
    const line = w.pts.map((p) => [...p]);
    for (const [end, next] of [[0, 1], [line.length - 1, line.length - 2]]) { // prettier-ignore
      const L = Math.hypot(w.pts[next][0] - w.pts[end][0], w.pts[next][1] - w.pts[end][1]);
      let nearest = null;
      for (const o of walls) {
        if (o === w) continue;
        for (let i = 0; i < o.pts.length - 1; i++) {
          const t = crossAt(w.pts[end], w.pts[next], o.pts[i], o.pts[i + 1]);
          if (t !== null && t * L <= END_BACK && (nearest === null || t < nearest)) nearest = t;
        }
      }
      if (nearest !== null)
        line[end] = [
          w.pts[end][0] + (w.pts[next][0] - w.pts[end][0]) * nearest,
          w.pts[end][1] + (w.pts[next][1] - w.pts[end][1]) * nearest,
        ];
    }
    w.screen = line;
  }
  // The move from (ax, az) to (bx, bz) goes across the line of a wall (`skip` left out); with `hides`, across what
  // a wall hides from the others only.
  const cut = (ax, az, bx, bz, skip = null, hides = false) => {
    for (const w of walls) {
      if (w === skip) continue;
      const b = w.box;
      if (Math.max(ax, bx) < b[0] || Math.min(ax, bx) > b[2] || Math.max(az, bz) < b[1] || Math.min(az, bz) > b[3]) continue;
      const line = hides ? w.screen : w.pts;
      for (let i = 0; i < line.length - 1; i++) {
        const [px, pz] = line[i];
        const [qx, qz] = line[i + 1];
        if (side(px, pz, qx, qz, ax, az) * side(px, pz, qx, qz, bx, bz) < 0 && side(ax, az, bx, bz, px, pz) * side(ax, az, bx, bz, qx, qz) < 0)
          return true;
      }
    }
    return false;
  };
  /** Run of the nearest point `q` of a wall, and whether the point it was asked for lies past one of its two ends. */
  const runOf = (w, q) => w.cum[q.seg] + Math.min(Math.max(q.t, 0), 1) * (w.cum[q.seg + 1] - w.cum[q.seg]);
  const pastEnd = (w, q) => (q.seg === 0 && q.t <= 0) || (q.seg === w.pts.length - 2 && q.t >= 1);
  // Another wall stands between the point (x, z) and the wall `w`, nearest at `q`: what lies behind that other wall
  // is its own ground, `w` has no hold on it. The hold of `w` is counted from a little back from its ends, so that a
  // wall drawn slightly short of the one it meets, or slightly too far, still starts from its own side of it.
  const screened = (w, q, x, z) => {
    if (walls.length < 2) return false;
    const back = Math.min(END_BACK, w.len / 2);
    const run = runOf(w, q);
    const r = Math.min(Math.max(run, back), w.len - back);
    const [ox, oz] = r === run ? [q.px, q.pz] : pointAtRun(w, r);
    return cut(x, z, ox, oz, w, true);
  };
  // How far a platform goes from a point of a wall along a direction, up to SPILL (m).
  const reachOf = (poly, px, pz, nx, nz) => {
    const most = Math.round(SPILL / SPILL_STEP);
    let n = 0;
    while (n < most && inPoly(poly, px + nx * (n + 1) * SPILL_STEP, pz + nz * (n + 1) * SPILL_STEP)) n++;
    return n * SPILL_STEP;
  };
  // The point (x, z) of a platform (its outline `poly`) is in a strip that goes a little past a wall, the platform
  // itself lying on the other side: its outline was drawn along the wall by hand. The wall keeps its ground there.
  const spills = (poly, x, z) => {
    for (const w of walls) {
      if (away(w.box, x, z, SPILL)) continue;
      const q = nearestOnLine(w.pts, x, z);
      if (!q || q.d >= SPILL || q.d < 1e-6 || pastEnd(w, q)) continue;
      const nx = (x - q.px) / q.d;
      const nz = (z - q.pz) / q.d;
      const here = reachOf(poly, q.px, q.pz, nx, nz);
      // (a platform that goes on, or that only starts further from the wall, is not a strip along it)
      if (here > SPILL - 1e-9 || here < q.d - SPILL_STEP) continue;
      if (reachOf(poly, q.px, q.pz, -nx, -nz) > here) return true;
    }
    return false;
  };
  // The blend around a platform, towards its nearest point `n`, does not go over a wall, nor start from a strip of
  // the platform that a wall keeps.
  const walled = (t, n, x, z) => {
    if (!walls.length) return false;
    if (n.d < 1e-6) return cut(x, z, n.px, n.pz);
    // (a few centimeters into the platform: a wall right on its outline is in between too)
    const ix = n.px + ((n.px - x) / n.d) * 0.05;
    const iz = n.pz + ((n.pz - z) / n.d) * 0.05;
    return cut(x, z, ix, iz) || (inPoly(t.poly, ix, iz) && spills(t.poly, ix, iz));
  };
  // The high side of a wall holds the ground clearly above a terrace of the garden at (x, z): a planter standing on
  // it, a retaining wall it was drawn across. Past the ends of the wall there is nothing to hold it.
  const raised = (t, x, z) =>
    walls.some((w) => {
      if (away(w.box, x, z, w.reach)) return false;
      const q = nearestOnLine(w.pts, x, z);
      if (!q || q.d > w.reach || pastEnd(w, q) || q.s * w.side <= 0) return false;
      return wallLevels(w, runOf(w, q))[0] > t.y + t.deck + PLANTER && !screened(w, q, x, z);
    });
  const apply = (x, z, h, raw) => {
    for (const op of list) {
      if (op.type === 'wall') {
        if (away(op.box, x, z, op.reach)) continue;
        const q = nearestOnLine(op.pts, x, z);
        if (!q || q.d > op.reach || screened(op, q, x, z)) continue;
        // the top and the foot where the wall is nearest: they may differ from one end of it to the other
        const [hiY, loY] = wallLevels(op, runOf(op, q));
        const target = q.s * op.side > 0 ? hiY : loY;
        const k = q.d <= op.flat ? 1 : 1 - smooth((q.d - op.flat) / op.feather);
        h += (target - h) * k;
      } else if (op.type === 'terrace') {
        if (away(op.box, x, z, op.feather)) continue;
        let k = 0;
        if (inPoly(op.poly, x, z)) k = spills(op.poly, x, z) ? 0 : 1;
        else if (op.feather > 0) {
          const n = nearestOnRing(op.poly, x, z);
          if (n.d < op.feather && !walled(op, n, x, z)) k = 1 - smooth(n.d / op.feather);
        }
        if (k > 0) h += (op.y - h) * k;
      } else {
        const d = Math.hypot(x - op.c[0], z - op.c[1]);
        if (d >= op.r) continue;
        const k = brushK(d, op.r);
        if (op.mode === 'set') h += (op.y - h) * k;
        else if (op.mode === 'add') h += op.value * k;
        else {
          let m = h;
          let n = 1;
          for (let a = 0; a < 8; a++) {
            m += raw(x + Math.cos((a * Math.PI) / 4) * op.r * 0.6, z + Math.sin((a * Math.PI) / 4) * op.r * 0.6);
            n++;
          }
          h += (m / n - h) * k * (op.value ?? 1);
        }
      }
    }
    // a terrace of the garden lies on the ground it levelled: nothing drawn after it brings the earth up through
    // it (the end of a wall, a foot typed a little too high), but the high side of a wall standing there
    for (const t of decks) {
      if (h <= t.y || away(t.box, x, z, 0) || !inPoly(t.poly, x, z) || raised(t, x, z)) continue;
      h = t.y;
    }
    return h;
  };
  // Mesh vertices close to a wall are moved to +/- WALL_T/2 from the line, so the sloped triangles that span the
  // two levels are enclosed by the masonry volume and the face reads as vertical. "Close" is the diagonal of a
  // cell: every corner of a cell the wall crosses is then moved, whatever the direction of the wall, and no
  // triangle is left climbing from the foot to the top in front of the face (the teeth a slanted wall had).
  // Where walls meet, a vertex goes to the nearest one it can reach without going across another: on the other
  // side it would take the other level, and draw a heap of earth over the wall, or a hole behind it. Around a bend
  // of the line it is moved the same way, towards the corner; past the two ends there is no masonry to hide a slope
  // in, and it stays.
  const snap = (x, z, cell) => {
    const reach = cell * Math.SQRT2;
    const near = [];
    for (const w of walls) {
      if (away(w.box, x, z, reach)) continue;
      const q = nearestOnLine(w.pts, x, z);
      if (q && q.d < reach && !pastEnd(w, q)) near.push(q);
    }
    near.sort((a, b) => a.d - b.d);
    const off = WALL_T / 2 + 0.02;
    for (const q of near) {
      if (q.d < 1e-6) return [x, z];
      const sx = q.px + ((x - q.px) / q.d) * off;
      const sz = q.pz + ((z - q.pz) / q.d) * off;
      if (!cut(x, z, sx, sz)) return [sx, sz];
    }
    return [x, z];
  };
  // A move from (ax, az) to (bx, bz) goes across the line of a wall: the ground on one side must not be pulled to
  // the other one (a vertex moved onto the outline of a pool or of a flight of steps would take the wrong level).
  const crosses = (ax, az, bx, bz) => cut(ax, az, bx, bz);
  // Where that move first meets the line of a wall, as a share of the move (0..1); null when it meets none. What
  // is laid on the ground stops there: the strip of a path drawn up to a wall does not climb it.
  const meet = (ax, az, bx, bz) => {
    let first = null;
    for (const w of walls) {
      const b = w.box;
      if (Math.max(ax, bx) < b[0] || Math.min(ax, bx) > b[2] || Math.max(az, bz) < b[1] || Math.min(az, bz) > b[3]) continue;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const t = crossAt([ax, az], [bx, bz], w.pts[i], w.pts[i + 1]);
        if (t !== null && (first === null || t < first)) first = t;
      }
    }
    return first;
  };
  return { apply, snap, walls, crosses, spills, meet };
}

/**
 * Outline of one correction in the GRID frame, for the editor overlay: the line of a wall, the ring of a terrace,
 * the circle of a brush. Returns { pts, closed, fill } (fill = the shape covers a surface, worth tinting).
 */
export function opOutline(op, seg = 36) {
  if (!op) return null;
  if (op.type === 'wall') return op.pts && op.pts.length >= 2 ? { pts: op.pts.map((p) => [...p]), closed: false, fill: false } : null;
  if (op.type === 'terrace') return op.poly && op.poly.length >= 3 ? { pts: op.poly.map((p) => [...p]), closed: true, fill: true } : null;
  if (op.type === 'brush' && op.pt) {
    const r = op.r || 1;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([op.pt[0] + Math.cos(a) * r, op.pt[1] + Math.sin(a) * r]);
    }
    return { pts, closed: true, fill: true };
  }
  return null;
}

/** Centre of a correction in the GRID frame (average of its points), null when it has none. */
export function opCenter(op) {
  if (!op) return null;
  if (op.type === 'brush') return op.pt ? [...op.pt] : null;
  const pts = op.type === 'wall' ? op.pts : op.poly;
  if (!pts || !pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

/** Area of a closed ring (m²), used to tell a small correction from a wide one. */
const polyArea = (poly) =>
  Math.abs(
    poly.reduce((a, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2,
  );

/**
 * Index of the correction under a GRID point, -1 when there is none: only the area each correction really acts on
 * counts (its blend included), and the narrowest one wins, so a brush or a wall dropped inside a terrace stays
 * reachable; between two of the same width the last one drawn takes it. With `shown(op, i)`, only the corrections
 * it keeps are looked at (the ones the overlay shows).
 */
export function opAt(ops, gx, gz, shown = null) {
  let best = -1;
  let score = Infinity;
  (ops || []).forEach((op, i) => {
    if (shown && !shown(op, i)) return;
    let d = Infinity; // distance to the correction (0 inside a shape)
    let reach = 0; // how far from it a click still counts
    let extent = 0; // half-width of the correction, to compare two of them
    if (op.type === 'wall' && op.pts && op.pts.length >= 2) {
      const q = nearestOnLine(op.pts, gx, gz);
      if (!q) return;
      d = q.d;
      reach = (op.flat ?? 1.5) + (op.feather ?? 2);
      extent = reach;
    } else if (op.type === 'terrace' && op.poly && op.poly.length >= 3) {
      d = inPoly(op.poly, gx, gz) ? 0 : distToPolygon(op.poly, gx, gz);
      reach = op.feather ?? 1;
      extent = Math.sqrt(polyArea(op.poly)) / 2;
    } else if (op.type === 'brush' && op.pt) {
      d = Math.hypot(gx - op.pt[0], gz - op.pt[1]);
      reach = op.r || 1;
      extent = reach;
    } else return;
    if (d > reach) return;
    const s = extent * 1000 + d;
    if (s <= score) {
      score = s;
      best = i;
    }
  });
  return best;
}
