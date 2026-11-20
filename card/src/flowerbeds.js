// Flower beds: a drawn area planted with a chosen number of flowers whose colours follow a list of weights.
// The pure part (normalisation, colour shares, seeded placement, bloom by season) is free of three.js and tested.
import * as THREE from 'three';

export const BED_MAX = 1500; // flowers of one bed (instanced: cheap, but the placement is quadratic)
export const BED_DEFAULT_COLORS = [
  { c: '#e63946', w: 3 },
  { c: '#f4d35e', w: 2 },
  { c: '#ffffff', w: 1 },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const r2 = (v) => Math.round(v * 100) / 100;

/** Current model: { pts, frame, count, colors: [{ c, w }], h, seed, hidden, name? } (pts: closed polygon, never fewer than 3). */
export function normalizeBed(b) {
  const raw = b || {};
  const pts = (raw.pts || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]);
  const colors = (Array.isArray(raw.colors) ? raw.colors : [])
    .filter((x) => x && HEX.test(x.c || ''))
    .map((x) => ({ c: x.c.toLowerCase(), w: Number.isFinite(x.w) && x.w > 0 ? x.w : 1 }));
  const count = Number.isFinite(raw.count) ? Math.max(0, Math.min(BED_MAX, Math.round(raw.count))) : 60;
  const out = {
    pts,
    frame: raw.frame || 'grid',
    count,
    colors: colors.length ? colors : BED_DEFAULT_COLORS.map((x) => ({ ...x })),
    h: Number.isFinite(raw.h) && raw.h > 0 ? r2(raw.h) : 0.35,
    seed: Number.isFinite(raw.seed) ? Math.trunc(raw.seed) : 1,
    hidden: !!raw.hidden,
  };
  if (raw.name) out.name = raw.name;
  return out;
}

/** Shoelace area (m²) of a polygon. */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function inPolygon(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Small deterministic generator (mulberry32): the same bed is always planted the same way. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Number of flowers of each colour: the shares follow the weights (largest remainder), the total is exact. */
export function colorShares(colors, count) {
  const sum = colors.reduce((s, x) => s + x.w, 0);
  const raw = colors.map((x) => (x.w / sum) * count);
  const n = raw.map(Math.floor);
  let rest = count - n.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) n[order[k][1]]++;
  return n;
}

/**
 * Flowers of a bed: [{ x, z, c, h }] in the frame of its points. The order is shuffled: showing only the first
 * k flowers (bloom of a season) thins out every colour evenly.
 */
export function bedFlowers(raw) {
  const b = normalizeBed(raw);
  if (b.pts.length < 3 || !b.count) return [];
  const rand = rng(b.seed);
  const xs = b.pts.map((p) => p[0]);
  const zs = b.pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const spots = [];
  for (let k = 0; k < b.count; k++) {
    let best = null;
    let bestD = -1;
    for (let t = 0; t < 12 && (best === null || t < 3 || bestD < 0); t++) {
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      if (!inPolygon(b.pts, x, z)) continue;
      // best of a few candidates: the farthest from the flowers already there (an even, natural spread)
      let d = Infinity;
      for (const s of spots) d = Math.min(d, (s.x - x) ** 2 + (s.z - z) ** 2);
      if (d > bestD) {
        best = { x, z };
        bestD = d;
      }
    }
    if (!best) {
      // very thin polygon: fall back on a vertex
      const p = b.pts[k % b.pts.length];
      best = { x: p[0], z: p[1] };
    }
    spots.push(best);
  }
  const palette = [];
  colorShares(b.colors, b.count).forEach((n, i) => {
    for (let k = 0; k < n; k++) palette.push(b.colors[i].c);
  });
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  return spots.map((s, i) => ({ x: s.x, z: s.z, c: palette[i], h: b.h * (0.75 + 0.5 * rand()) }));
}

/** Share of the flowers in bloom for a season blend { from, to, t } (see seasonBlend): none in winter. */
const BLOOM = { winter: 0, spring: 0.75, summer: 1, autumn: 0.35, dry: 0.3, wet: 1 };
export function bloomAt(blend) {
  const a = BLOOM[blend.from] ?? 1;
  const b = BLOOM[blend.to] ?? 1;
  return Math.max(0, Math.min(1, a + (b - a) * blend.t));
}

/**
 * 3D beds: soil, stems and instanced flower heads. `toPlan(frameOf(bed))` is given by `anchor(bed)`.
 * Returns { group, apply(blend) } where apply shows the share of flowers in bloom.
 */
export function buildBeds(beds, anchor, heightAt) {
  const group = new THREE.Group();
  group.name = 'beds';
  const items = [];
  for (const raw of beds || []) {
    const b = normalizeBed(raw);
    if (b.hidden || b.pts.length < 3) continue;
    const toPlan = anchor(raw);
    const P = b.pts.map(([x, z]) => toPlan(x, z));
    const g = new THREE.Group();
    g.name = 'bed';
    // soil
    const tris = THREE.ShapeUtils.triangulateShape(
      P.map(([x, z]) => new THREE.Vector2(x, z)),
      [],
    );
    const pos = [];
    for (const [i, j, k] of tris) for (const n of [i, j, k]) pos.push(P[n][0], heightAt(P[n][0], P[n][1]) + 0.03, P[n][1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const soil = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1, side: THREE.DoubleSide }));
    soil.receiveShadow = true;
    g.add(soil);
    // flowers
    const flowers = bedFlowers(raw).map((f) => {
      const [x, z] = toPlan(f.x, f.z);
      return { x, z, y: heightAt(x, z), c: f.c, h: f.h };
    });
    let stems = null;
    let heads = null;
    if (flowers.length) {
      stems = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.008, 0.008, 1, 4),
        new THREE.MeshStandardMaterial({ color: '#3f7d2c', roughness: 0.9 }),
        flowers.length,
      );
      heads = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.055, 0),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }),
        flowers.length,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const col = new THREE.Color();
      flowers.forEach((f, i) => {
        stems.setMatrixAt(i, m.compose(p.set(f.x, f.y + f.h / 2, f.z), q, s.set(1, f.h, 1)));
        heads.setMatrixAt(i, m.compose(p.set(f.x, f.y + f.h, f.z), q, s.set(1, 0.7, 1)));
        heads.setColorAt(i, col.set(f.c));
      });
      stems.castShadow = heads.castShadow = false;
      g.add(stems, heads);
    }
    group.add(g);
    items.push({ stems, heads, total: flowers.length });
  }
  return {
    group,
    count: items.length,
    apply(blend) {
      const k = bloomAt(blend);
      for (const it of items) {
        const n = Math.round(it.total * k);
        if (it.stems) it.stems.count = it.heads.count = n;
      }
    },
  };
}
