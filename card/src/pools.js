// Pools and ponds drawn on the ground (top view): outline, colour, depth and a cleaning robot. Pure helpers, no
// three / HA knowledge: polygon tests, outline of a rectangle, the wandering of the robot on the bottom.

export const POOL_KINDS = {
  pool: { color: '#2a9fd6', depth: 1.5 },
  pond: { color: '#3d6b4a', depth: 0.8 },
};

/** Point inside polygon [[x, z], ...] (even-odd rule). */
export function inPolygon(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Closest point of the outline of a closed polygon: { d, px, pz }. */
export function nearestOnOutline(poly, x, z) {
  let best = { d: Infinity, px: x, pz: z };
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz };
  }
  return best;
}

/** Signed area (positive: counter-clockwise in x/z). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function centroidOf(poly) {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** Rectangle from two opposite corners (axis aligned in the frame of the points). */
export function rectFromCorners(a, b) {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

/** Defaults of a pool or pond of kind `kind`. */
export function newPool(kind, id) {
  const k = POOL_KINDS[kind] ? kind : 'pool';
  return { id, kind: k, shape: 'rect', pts: [], color: POOL_KINDS[k].color, depth: POOL_KINDS[k].depth, robot: '' };
}

/** Islands of a pond with a usable outline: [{ pts, frame }] (same rule as a pool). */
export function islandsOf(p) {
  return (p && Array.isArray(p.islands) ? p.islands : []).filter((i) => poolValid(i));
}

/** A usable pool: at least 3 points and a positive area. */
export function poolValid(p) {
  return !!p && Array.isArray(p.pts) && p.pts.length >= 3 && Math.abs(polygonArea(p.pts)) > 0.05;
}

/**
 * One step of the cleaning robot wandering on the bottom: it goes straight and turns when the wall is near.
 * `r` = { x, z, h (heading, rad) }; `rand()` in [0, 1). Returns the new state.
 */
export function robotStep(poly, r, dt, speed = 0.35, margin = 0.3, rand = Math.random) {
  const tryAt = (h) => {
    const x = r.x + Math.cos(h) * speed * dt;
    const z = r.z + Math.sin(h) * speed * dt;
    return inPolygon(poly, x, z) && nearestOnOutline(poly, x, z).d >= margin ? { x, z, h } : null;
  };
  const ahead = tryAt(r.h);
  if (ahead) return ahead;
  // at the wall: a new direction, roughly back toward the middle
  for (let i = 0; i < 12; i++) {
    const h = r.h + Math.PI * (0.5 + rand());
    const n = tryAt(h);
    if (n) return n;
  }
  // stuck against the wall (or parked too close to it): back toward the middle
  const [cx, cz] = centroidOf(poly);
  const h = Math.atan2(cz - r.z, cx - r.x);
  return { x: r.x + Math.cos(h) * speed * dt, z: r.z + Math.sin(h) * speed * dt, h };
}
