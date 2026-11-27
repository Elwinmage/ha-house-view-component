// Outdoor steps: a path turned into a flight of steps. Its centre line is drawn like any path; the steps climb from
// the ground at its first point to the ground at its last one, in as many steps as its height calls for (or as the
// user asks). The ground is opened under the flight (terrain.js) and a retaining wall it goes through is cut
// (walls.js), so the flight digs into a bank or leans on the front of a wall, with a cheek wall on each side.
// Pure geometry: flat arrays, no three.js, no DOM, unit-tested. The meshes are made in paths.js.
import { pointAt } from './path-art.js';

/** Usual height of a step (m): the number of steps of a flight is its height divided by this. */
export const RISE = 0.16;
/** Most steps in one flight. */
export const STEPS_MAX = 120;
/** Thickness of the cheek wall on each side of a flight (m). */
export const CHEEK = 0.12;
/** How far the cheeks and the first riser go down under the ground: no gap on a slope (m). */
const SKIRT = 0.3;
/** Height of the treads over their level: no flicker where the top one meets the ground (m). */
const LIFT = 0.03;
/** A riser lower than this is not built (m). */
const FLUSH = 0.04;
/** Distance between two points of the outline of a flight along its line (m). */
const OUTLINE_STEP = 0.5;
/** How far the ground goes on under each end of a flight: no gap under the top tread nor at the foot (m). */
const UNDER = 0.1;
/**
 * The landing: how far the top tread goes on past the high end of the line, lying on the ground it arrives at (m).
 * A flight that ends on a retaining wall covers the thickness of the wall with it.
 */
export const LANDING = 0.3;

/** Length (m) of a line, the points too close to the one before left out. */
const lengthOf = (center) => {
  let L = 0;
  for (let i = 1; i < center.length; i++) L += Math.hypot(center[i][0] - center[i - 1][0], center[i][1] - center[i - 1][1]);
  return L;
};

/** Number of steps of a flight `height` m high: the one asked for, else one every 16 cm (one at least). */
export function stepCount(height, asked = null) {
  if (Number.isFinite(asked) && asked >= 1) return Math.min(STEPS_MAX, Math.round(asked));
  return Math.min(STEPS_MAX, Math.max(1, Math.round(Math.abs(height) / RISE)));
}

/**
 * What a flight comes to along a centre line (plan frame): { n (steps), height (from its first point to its last
 * one, negative when it goes down), rise (of one step), going (depth of one tread), length }, or null for a line
 * too short. `levelAt(x, z)` is what one walks on at its two ends: the ground, or the top of a terrace laid there.
 */
export function flightSize(center, levelAt, asked = null) {
  if (!center || center.length < 2) return null;
  const length = lengthOf(center);
  if (length < 0.2) return null;
  const first = center[0];
  const last = center[center.length - 1];
  const h0 = levelAt(first[0], first[1]);
  const h1 = levelAt(last[0], last[1]);
  const n = stepCount(h1 - h0, asked);
  return { n, h0, h1, height: h1 - h0, rise: (h1 - h0) / n, going: length / n, length };
}

/** A point of the centre line `run` m along it, and the points `half` m on each side: { run, a, b } (a on the right). */
function rowAt(center, run, half) {
  const at = pointAt(center, run);
  // normal of the line, on its left hand side
  const nx = -at.sin;
  const nz = at.cos;
  return { run, a: [at.x - nx * half, at.z - nz * half], b: [at.x + nx * half, at.z + nz * half], nx, nz };
}

/**
 * Outline of a flight on the ground (plan frame): its centre line widened by half its width and `margin` on each
 * side, a closed ring. The ground is cut out over it: `margin` puts the cut under the cheek walls, and the ring
 * stops `under` short of both ends of the line, the ground going on under the first riser and the top tread. A
 * negative `under` makes it longer than the line instead (see flightReach).
 */
export function flightOutline(center, width, margin = CHEEK / 2, under = UNDER) {
  if (!center || center.length < 2) return null;
  const length = lengthOf(center);
  if (length < 0.2) return null;
  const short = Math.min(under, length / 4);
  const count = Math.max(1, Math.ceil(length / OUTLINE_STEP));
  const rows = Array.from({ length: count + 1 }, (_, k) => rowAt(center, short + ((length - 2 * short) * k) / count, width / 2 + margin));
  return [...rows.map((row) => row.b), ...rows.reverse().map((row) => row.a)];
}

/**
 * All a flight takes up on the ground (plan frame): its steps, its two cheek walls and its landing, the landing
 * counted at both ends since the ground alone tells which one is the top. A retaining wall is opened over it.
 */
export const flightReach = (center, width) => flightOutline(center, width, CHEEK, -LANDING);

const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

/**
 * A flight of steps along a centre line (plan frame), `width` wide, on the ground `heightAt`: `n` level treads
 * climbing from what one walks on at its first point to what one walks on at its last one (or going down to it),
 * each tread flush with the step above at its back, a riser at its front. The top tread goes on past the high end
 * of the line as a landing. `levelAt(x, z)` gives what one walks on (the ground when it is not given: a terrace
 * stands over it). Returns
 * { n, rise, going, steps: { pos, uv } (treads and risers, 6 points a face, texture in tiles of `tile` m, its rows
 * running across the flight), cheeks: { pos } (the wall on each side: down under the ground, up to the treads or to
 * the ground beside them when it stands higher, as in a bank) }, or null for a line too short.
 */
export function stairFlight(center, width, heightAt, { steps = null, tile = 2, levelAt = heightAt } = {}) {
  const size = flightSize(center, levelAt, steps);
  if (!size) return null;
  const { n, h0, h1, rise, going, length } = size;
  const half = width / 2;
  // the rows across the flight, one where each step starts; the one at the high end is set further on: the landing
  const run = (k) => (k === 0 && rise < 0 ? -LANDING : k === n && rise > 0 ? length + LANDING : k * going);
  const rows = Array.from({ length: n + 1 }, (_, k) => rowAt(center, run(k), half));
  // tread k lies between rows k and k + 1, level with the higher of its two ends
  const level = (k) => Math.max(h0 + k * rise, h0 + (k + 1) * rise) + LIFT;
  const pos = [];
  const uv = [];
  const u0 = -half / tile;
  const u1 = half / tile;
  for (let k = 0; k < n; k++) {
    const y = level(k);
    const r0 = rows[k];
    const r1 = rows[k + 1];
    quad(pos, [r0.a[0], y, r0.a[1]], [r1.a[0], y, r1.a[1]], [r1.b[0], y, r1.b[1]], [r0.b[0], y, r0.b[1]]);
    quad(uv, [u0, r0.run / tile], [u0, r1.run / tile], [u1, r1.run / tile], [u1, r0.run / tile]);
  }
  // risers: between two treads, and down to the ground at the low end of the flight
  for (let k = 0; k <= n; k++) {
    const before = k > 0 ? level(k - 1) : h0;
    const after = k < n ? level(k) : h1;
    if (Math.abs(after - before) < FLUSH) continue;
    const onGround = k === 0 || k === n;
    const low = Math.min(before, after) - (onGround ? SKIRT : 0);
    const high = Math.max(before, after);
    const r = rows[k];
    quad(pos, [r.a[0], low, r.a[1]], [r.b[0], low, r.b[1]], [r.b[0], high, r.b[1]], [r.a[0], high, r.a[1]]);
    quad(uv, [u0, low / tile], [u1, low / tile], [u1, high / tile], [u0, high / tile]);
  }
  // cheeks: a wall on each side, from under the ground up to the tread, or to the ground beside it when it is higher
  const cheeks = [];
  for (const side of [-1, 1]) {
    const inner = (row) => (side < 0 ? row.a : row.b);
    const outer = (row) => {
      const [x, z] = inner(row);
      return [x + row.nx * side * CHEEK, z + row.nz * side * CHEEK];
    };
    for (let k = 0; k < n; k++) {
      const y = level(k);
      const r0 = rows[k];
      const r1 = rows[k + 1];
      const i0 = inner(r0);
      const i1 = inner(r1);
      const o0 = outer(r0);
      const o1 = outer(r1);
      const g0 = heightAt(o0[0], o0[1]);
      const g1 = heightAt(o1[0], o1[1]);
      const t0 = Math.max(y, g0 + LIFT);
      const t1 = Math.max(y, g1 + LIFT);
      const foot = Math.min(y - Math.abs(rise), g0, g1) - SKIRT;
      quad(cheeks, [i0[0], foot, i0[1]], [i1[0], foot, i1[1]], [i1[0], t1, i1[1]], [i0[0], t0, i0[1]]); // towards the steps
      quad(cheeks, [o1[0], foot, o1[1]], [o0[0], foot, o0[1]], [o0[0], t0, o0[1]], [o1[0], t1, o1[1]]); // towards the garden
      quad(cheeks, [i0[0], t0, i0[1]], [i1[0], t1, i1[1]], [o1[0], t1, o1[1]], [o0[0], t0, o0[1]]); // its top
      // its two ends, closed where the flight starts and stops and where a step makes it jump
      quad(cheeks, [o0[0], foot, o0[1]], [i0[0], foot, i0[1]], [i0[0], t0, i0[1]], [o0[0], t0, o0[1]]);
      quad(cheeks, [i1[0], foot, i1[1]], [o1[0], foot, o1[1]], [o1[0], t1, o1[1]], [i1[0], t1, i1[1]]);
    }
  }
  // the back of the flight, under the end of its landing: nothing shows through where the ground it arrives on
  // turns out to be lower than its top step
  if (rise !== 0) {
    const top = rise > 0 ? n - 1 : 0;
    const r = rows[rise > 0 ? n : 0];
    const foot = Math.min(heightAt(r.a[0], r.a[1]), heightAt(r.b[0], r.b[1]), level(top)) - SKIRT;
    quad(cheeks, [r.b[0], foot, r.b[1]], [r.a[0], foot, r.a[1]], [r.a[0], level(top), r.a[1]], [r.b[0], level(top), r.b[1]]);
  }
  return { n, rise, going, steps: { pos, uv }, cheeks: { pos: cheeks } };
}

/**
 * Outlines of the flights among the paths (plan frame), for the terrain: `flights(paths, toPlanOf, smooth)` with
 * `toPlanOf(path)` the conversion of its points to the plan and `smooth(points)` the rounding the paths are drawn
 * with. A hidden path, a line of one point and a path that is not a flight give none. `outline(center, width)`
 * is the ring wanted: the one the ground is cut out over (flightOutline), or all the flight takes up (flightReach).
 */
export function flightOutlines(paths, toPlanOf, smooth = (points) => points, outline = flightOutline) {
  const out = [];
  for (const p of paths || []) {
    if (!p || !p.stairs || p.hidden || !Array.isArray(p.pts) || p.pts.length < 2) continue;
    const toPlan = toPlanOf(p);
    const width = Number.isFinite(+p.w) && +p.w > 0 ? +p.w : 1;
    const ring = outline(smooth(p.pts.map(([x, z]) => toPlan(x, z))), width);
    if (ring) out.push(ring);
  }
  return out;
}
