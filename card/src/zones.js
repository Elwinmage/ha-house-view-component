// Clickable zones of the plan: a media player or an aquarium (reeftank), on a piece of furniture of the plan or on a
// rectangle laid on a floor or a wall. A tap on the zone opens the player, or the view of the aquarium.
//
// Zone: { id, kind: 'media' | 'aquarium', entity (media), aquarium (id), name, level, thumb (aquarium picture on it),
//         shape: 'rect' | 'box',
//         rect: { c: [x, y, z] centre, n: [nx, ny, nz] facing (up for a floor), rot (degrees, floor only), w, h },
//         box:  { at: [x, z], rot (radians, as the plan), size: [w, h, d], y0 (bottom) } }
// Units: meters, plan frame (x right, z down the plan, y up).

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** True for a rectangle laid on a floor (facing up). */
export const onFloor = (rect) => Math.abs(rect.n[1]) > 0.5;

/**
 * Axes of a rectangle: u (its width, left to right as seen from the front) and v (its height, upwards on a wall,
 * toward the top of the plan on a floor when not turned). u × v = n: the picture is seen from the front.
 */
export function rectAxes(rect) {
  if (onFloor(rect)) {
    const r = ((rect.rot || 0) * Math.PI) / 180;
    return { u: [Math.cos(r), 0, Math.sin(r)], v: [Math.sin(r), 0, -Math.cos(r)] };
  }
  const len = Math.hypot(rect.n[0], rect.n[2]) || 1;
  const nx = rect.n[0] / len;
  const nz = rect.n[2] / len;
  return { u: [nz, 0, -nx], v: [0, 1, 0] };
}

/** Corners of a rectangle: top-left, top-right, bottom-right, bottom-left (as seen from the front). */
export function rectCorners(rect) {
  const { u, v } = rectAxes(rect);
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  return [
    add(add(rect.c, u, -hw), v, hh),
    add(add(rect.c, u, hw), v, hh),
    add(add(rect.c, u, hw), v, -hh),
    add(add(rect.c, u, -hw), v, -hh),
  ];
}

/**
 * Rectangle of `w` x `h` meters centred on a tapped point (engine.pickPoint): on the wall when the tap found one
 * (`hit.normal`, horizontal), else on the floor. Slightly off the surface, so that it is drawn over it.
 */
export function rectAt(hit, w, h) {
  const p = [hit.point.x, hit.point.y, hit.point.z];
  if (hit.normal) {
    const n = [hit.normal[0], 0, hit.normal[1]];
    return { c: add(p, n, 0.02), n, rot: 0, w, h };
  }
  return { c: add(p, [0, 1, 0], 0.02), n: [0, 1, 0], rot: 0, w, h };
}

/**
 * Size of an aquarium on a rectangle, from its dimensions in cm ({ length, width, height }): its front on a wall
 * (length x height), its top on a floor (length x width). null without dimensions.
 */
export function aquariumSize(dims, floor) {
  if (!dims || !(dims.length > 0)) return null;
  const other = floor ? dims.width : dims.height;
  if (!(other > 0)) return null;
  return [dims.length / 100, other / 100];
}

/**
 * New size of a rectangle keeping the ratio `ratio` (width / height): the side changed in `patch` ({ w } or { h })
 * drives the other one. Without a ratio, the patch is applied as is.
 */
export function keepRatio(rect, patch, ratio) {
  if (!(ratio > 0)) return { ...rect, ...patch };
  if (patch.w !== undefined) return { ...rect, ...patch, w: patch.w, h: patch.w / ratio };
  if (patch.h !== undefined) return { ...rect, ...patch, h: patch.h, w: patch.h * ratio };
  return { ...rect, ...patch };
}

/** Box of a fit inside a box: the largest W x H of ratio `ratio` (width / height) inside `bw` x `bh`. */
export function fitRatio(bw, bh, ratio) {
  if (!(ratio > 0) || !(bw > 0) || !(bh > 0)) return [bw, bh];
  return bw / bh > ratio ? [bh * ratio, bh] : [bw, bw / ratio];
}

/** Box of a piece of furniture of the plan, standing on level elevation `base`. */
export function boxOf(item, base) {
  return { at: [...item.at], rot: item.rot || 0, size: [...item.size], y0: base + (item.elevation || 0) };
}

/** Distance along the ray (origin o, direction d) to a box, or null when it misses (slab test in the box frame). */
export function rayBox(o, d, box) {
  // the box turns by -rot around y (as the plan draws it): bring the ray into its frame
  const c = Math.cos(box.rot);
  const s = Math.sin(box.rot);
  const toLocal = (x, z) => [x * c + z * s, -x * s + z * c]; // inverse of the turn the mesh gets: Ry(-rot)
  const [ox, oz] = toLocal(o[0] - box.at[0], o[2] - box.at[1]);
  const [dx, dz] = toLocal(d[0], d[2]);
  const lo = [-box.size[0] / 2, box.y0, -box.size[2] / 2];
  const hi = [box.size[0] / 2, box.y0 + box.size[1], box.size[2] / 2];
  const O = [ox, o[1], oz];
  const D = [dx, d[1], dz];
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(D[i]) < 1e-12) {
      if (O[i] < lo[i] || O[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - O[i]) / D[i];
    let t2 = (hi[i] - O[i]) / D[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(tmin, 0);
}

/**
 * Nearest piece of furniture along a ray: { item, box, t } or null.
 * items: [{ item, base }] (piece of the plan and the elevation of its level).
 */
export function pickFurniture(o, d, items) {
  let best = null;
  for (const { item, base } of items) {
    const box = boxOf(item, base);
    const t = rayBox(o, d, box);
    if (t !== null && (!best || t < best.t)) best = { item, box, t };
  }
  return best;
}

/**
 * CSS matrix3d that lays an element of `W` x `H` pixels (transform-origin 0 0) on the screen quad `q`
 * (its top-left, top-right, bottom-right and bottom-left corners, in pixels). null when the quad is degenerate.
 */
export function quadMatrix(W, H, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a, b, d, e, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    [a, b, d, e, g, h] = [x1 - x0, x3 - x0, y1 - y0, y3 - y0, 0, 0];
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
  }
  const m = [a / W, d / W, 0, g / W, b / H, e / H, 0, h / H, 0, 0, 1, 0, x0, y0, 0, 1];
  if (!m.every(Number.isFinite)) return null;
  return `matrix3d(${m.map((x) => +x.toPrecision(8)).join(',')})`;
}

/** Screen position of point (X, Y) of the element under a matrix built by quadMatrix (for the tests). */
export function applyQuad(matrix, X, Y) {
  const m = matrix.slice(9, -1).split(',').map(Number);
  const w = m[3] * X + m[7] * Y + m[15];
  return [(m[0] * X + m[4] * Y + m[12]) / w, (m[1] * X + m[5] * Y + m[13]) / w];
}
