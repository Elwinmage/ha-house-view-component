// Moving what is drawn on the ground (fences, pools, paths, gates, ground corrections): the points of an object
// become handles, with one more for the object itself. Pure helpers only — the interaction (a drag with the orbit
// controls held back, or a grab and a drop with two clicks on a touch screen) lives in engine.js and editors.js.

/** Handle of the object itself: every point moves together. */
export const WHOLE = -1;

/** How far from a handle (screen pixels) a press still takes it. */
export const GRAB_PX = 18;

/** Middle of the box around the points, where the handle of the whole object sits (null without a point). */
export function middleOf(pts) {
  if (!pts || !pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

/**
 * Handles of an outline: one per point, and the one of the whole object last (`whole`, and at least two points —
 * a single point is already the object). Plan coordinates, as the points are given.
 */
export function handlesOf(pts, whole = true) {
  const out = (pts || []).map(([x, z], i) => ({ i, x, z }));
  const m = whole && out.length > 1 ? middleOf(pts) : null;
  if (m) out.push({ i: WHOLE, x: m[0], z: m[1] });
  return out;
}

/**
 * Handle under a point of the screen, or null: `at(handle)` gives its screen position ([sx, sy], null when it is
 * out of the view). A point handle wins over the one of the whole object, which sits in the middle and would
 * otherwise cover the points of a small object.
 */
export function nearestHandle(handles, at, sx, sy, max = GRAB_PX) {
  const nearest = (list) => {
    let best = null;
    for (const h of list) {
      const p = at(h);
      if (!p) continue;
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      if (d <= max && (!best || d < best.d)) best = { h, d };
    }
    return best;
  };
  const hit = nearest((handles || []).filter((h) => h.i !== WHOLE)) || nearest((handles || []).filter((h) => h.i === WHOLE));
  return hit ? hit.h : null;
}

/** Every point moved by (dx, dz). */
export function offsetPts(pts, dx, dz) {
  return (pts || []).map(([x, z]) => [x + dx, z + dz]);
}

/** Point `i` moved to (x, z), the others kept as they are. */
export function setPt(pts, i, x, z) {
  return (pts || []).map((p, k) => (k === i ? [x, z] : [p[0], p[1]]));
}

/**
 * The points after a handle is moved to (x, z): one point for a point handle, the whole object for WHOLE, which is
 * offset by how far the handle itself travelled (`from`: where it was taken).
 */
export function movedPts(pts, handle, x, z, from) {
  if (!handle) return pts;
  if (handle.i !== WHOLE) return setPt(pts, handle.i, x, z);
  const [fx, fz] = from || [handle.x, handle.z];
  return offsetPts(pts, x - fx, z - fz);
}
