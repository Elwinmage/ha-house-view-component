// Manual corrections of the ground, stored in the edits file as a list of operations expressed in the
// TERRAIN GRID frame with absolute altitudes (m): they stay attached to the real world when the plan
// registration (rotation / shift / base height) is changed afterwards.
//
//   { type: 'wall',    pts: [[gx, gz]...], hi, lo, side: 1|-1, flat: 1.5, feather: 2 }
//        retaining wall: ground held flat at `hi` on the high side and at `lo` on the low side, with a vertical
//        masonry face on the line. side = +1 when the high side is to the left of the drawing direction... (see sideOf)
//   { type: 'terrace', poly: [[gx, gz]...], alt, feather: 1 }   flat platform
//   { type: 'brush',   pt: [gx, gz], r, mode: 'set' | 'add' | 'smooth', value }

export const WALL_T = 0.4; // masonry thickness (m)

const smooth = (t) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Signed side of point (x,z) relative to segment a->b: +1 left (in x/z axes), -1 right. */
const sideOf = (ax, az, bx, bz, x, z) => ((bx - ax) * (z - az) - (bz - az) * (x - ax) >= 0 ? 1 : -1);

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
  return best;
}

function distToPolygon(poly, x, z) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / L2, 0), 1);
    d = Math.min(d, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return d;
}

function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * Compile the operations for one terrain build.
 * `toPlan(gx, gz)` maps a grid point to the plan frame, `altToY(alt)` maps an absolute altitude to scene y.
 * Returns { apply(x, z, h, raw), snap(x, z, cell), walls } (all in the plan frame).
 */
export function compileOps(ops, toPlan, altToY) {
  const list = [];
  const walls = [];
  for (const op of ops || []) {
    if (op.type === 'wall' && op.pts && op.pts.length >= 2) {
      const c = { ...op, pts: op.pts.map(([x, z]) => toPlan(x, z)), hiY: altToY(op.hi), loY: altToY(op.lo) };
      c.flat = op.flat ?? 1.5;
      c.feather = op.feather ?? 2;
      list.push(c);
      walls.push(c);
    } else if (op.type === 'terrace' && op.poly && op.poly.length >= 3) {
      list.push({ ...op, poly: op.poly.map(([x, z]) => toPlan(x, z)), y: altToY(op.alt), feather: op.feather ?? 1 });
    } else if (op.type === 'brush' && op.pt) {
      const [cx, cz] = toPlan(op.pt[0], op.pt[1]);
      list.push({ ...op, c: [cx, cz], y: op.mode === 'set' ? altToY(op.value) : 0 });
    }
  }
  const apply = (x, z, h, raw) => {
    for (const op of list) {
      if (op.type === 'wall') {
        const q = nearestOnLine(op.pts, x, z);
        if (!q || q.d > op.flat + op.feather) continue;
        const target = q.s * op.side > 0 ? op.hiY : op.loY;
        const k = q.d <= op.flat ? 1 : 1 - smooth((q.d - op.flat) / op.feather);
        h += (target - h) * k;
      } else if (op.type === 'terrace') {
        const inside = inPoly(op.poly, x, z);
        const k = inside ? 1 : op.feather > 0 ? 1 - smooth(distToPolygon(op.poly, x, z) / op.feather) : 0;
        if (k > 0) h += (op.y - h) * k;
      } else {
        const d = Math.hypot(x - op.c[0], z - op.c[1]);
        if (d >= op.r) continue;
        const k = Math.cos((d / op.r) * Math.PI * 0.5) ** 2;
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
    return h;
  };
  // Mesh vertices closer than `cell` to a wall are moved to +/- WALL_T/2 from the line, so the sloped triangles that
  // span the two levels are enclosed by the masonry volume and the face reads as vertical.
  const snap = (x, z, cell) => {
    for (const op of walls) {
      const q = nearestOnLine(op.pts, x, z);
      if (!q || !q.interior || q.d >= cell) continue;
      const off = WALL_T / 2 + 0.02;
      if (q.d < 1e-6) return [x, z];
      return [q.px + ((x - q.px) / q.d) * off, q.pz + ((z - q.pz) / q.d) * off];
    }
    return [x, z];
  };
  return { apply, snap, walls };
}
