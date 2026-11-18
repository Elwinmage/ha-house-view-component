// Outline of several adjacent cadastral parcels (one property made of several parcels):
// the shared borders cancel out, what remains is chained into closed loops.
// Cadastral parcels share their borders, but not always the same vertices (one side may have an extra point),
// so every edge is first split at the vertices of the other parcels lying on it.

const TOL = 0.05; // meters: points closer than this are the same point

function signedArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, z1] = r[i];
    const [x2, z2] = r[(i + 1) % r.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

/** Open ring (no repeated closing point), oriented with a positive signed area. */
function normRing(poly) {
  const r = poly.map((p) => [p[0], p[1]]);
  if (r.length > 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < TOL) r.pop();
  return signedArea(r) < 0 ? r.reverse() : r;
}

/** Union outline of polygons [[x, z]...]: list of closed loops (outer borders only), largest first. */
export function unionOutline(polys, tol = TOL) {
  // the same parcel given twice would leave its own outline in the result: keep one copy of each ring
  const seen = new Set();
  const rings = polys
    .map(normRing)
    .filter((r) => r.length >= 3)
    .filter((r) => {
      const sig = r
        .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .sort()
        .join(';');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  // canonical points: everything within `tol` collapses on the first point seen
  const pts = [];
  const key = (p) => {
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) < tol) return i;
    pts.push([p[0], p[1]]);
    return pts.length - 1;
  };
  for (const r of rings) for (const p of r) key(p);
  const all = pts.slice();
  // directed edges, split at the points lying on them
  const count = new Map(); // "a>b" -> number of times
  const add = (a, b) => {
    if (a === b) return;
    const k = `${a}>${b}`;
    count.set(k, (count.get(k) || 0) + 1);
  };
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const on = [];
      for (const p of all) {
        const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L2 || 1);
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const d = Math.hypot(a[0] + t * (b[0] - a[0]) - p[0], a[1] + t * (b[1] - a[1]) - p[1]);
        if (d < tol) on.push([t, p]);
      }
      on.sort((u, v) => u[0] - v[0]);
      let prev = key(a);
      for (const [, p] of on) {
        const k = key(p);
        add(prev, k);
        prev = k;
      }
      add(prev, key(b));
    }
  }
  // a border shared by two selected parcels is walked once in each direction: it cancels out
  const out = new Map(); // start -> [ends]
  for (const [k, n] of count) {
    const [a, b] = k.split('>').map(Number);
    const rev = count.get(`${b}>${a}`) || 0;
    for (let i = 0; i < n - rev; i++) {
      if (!out.has(a)) out.set(a, []);
      out.get(a).push(b);
    }
  }
  // chain the remaining edges into loops
  const loops = [];
  for (const start of [...out.keys()]) {
    while (out.get(start) && out.get(start).length) {
      const loop = [start];
      let cur = out.get(start).pop();
      let guard = 0;
      while (cur !== start && guard++ < 100000) {
        loop.push(cur);
        const nx = out.get(cur);
        if (!nx || !nx.length) break; // open chain (bad data): dropped below
        cur = nx.pop();
      }
      if (cur === start && loop.length >= 3) loops.push(loop.map((i) => pts[i]));
    }
  }
  return loops
    .map((l) => ({ l, a: signedArea(l) }))
    .filter((x) => x.a > 0) // holes (negative) are not fenced
    .sort((u, v) => v.a - u.a)
    .map((x) => x.l);
}

/** Point in polygon (even-odd). */
export function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
