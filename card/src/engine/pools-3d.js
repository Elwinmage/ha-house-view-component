// Pools and ponds drawn in the editor: basin dug in the ground (vertical walls and flat bottom for a pool, sloping
// bottom for a pond), coping or pebble ring, moving water, and the cleaning robot wandering on the bottom.
import * as THREE from 'three';
import { polygonArea, centroidOf, robotStep, inPolygon } from '../pools.js';

let waterNormals = null;
/** Small tiling normal map of ripples (shared; none outside a browser). */
function rippleTexture() {
  if (waterNormals !== null || typeof document === 'undefined') return waterNormals;
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const h = (x, y) =>
    Math.sin(((x + y * 0.3) / N) * Math.PI * 6) * 0.5 +
    Math.sin(((y - x * 0.4) / N) * Math.PI * 10) * 0.3 +
    Math.sin(((x * 0.7 + y) / N) * Math.PI * 14) * 0.2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const k = (y * N + x) * 4;
      img.data[k] = 128 + dx * 60;
      img.data[k + 1] = 128 + dy * 60;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  waterNormals = new THREE.CanvasTexture(c);
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  return waterNormals;
}

/** Flat shape of a polygon [[x, z]] lying at height y (ShapeGeometry is in x / -z, then laid down). */
function flatShape(poly, y, holes = []) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/** Outline pushed outward by `w` (mitred corners, limited on sharp ones). */
export function offsetOutline(poly, w) {
  const s = polygonArea(poly) > 0 ? 1 : -1;
  const n = poly.length;
  const normal = (a, b) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    return [(s * dz) / L, (-s * dx) / L];
  };
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p);
    const n2 = normal(p, poly[(i + 1) % n]);
    let mx = n1[0] + n2[0];
    let mz = n1[1] + n2[1];
    const L = Math.hypot(mx, mz) || 1;
    mx /= L;
    mz /= L;
    const k = Math.min(w / Math.max(mx * n1[0] + mz * n1[1], 0.3), w * 3);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

/** Points every `step` metres along a closed outline. */
function resample(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const shade = (hex, k) => new THREE.Color(hex).lerp(new THREE.Color(k > 0 ? '#ffffff' : '#000000'), Math.abs(k));

/** Vertical walls of a pool, from the rim down to the bottom. */
function poolWalls(poly, top, bottom) {
  const pos = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    pos.push(ax, top, az, bx, top, bz, bx, bottom, bz, ax, top, az, bx, bottom, bz, ax, bottom, az);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Sloping bottom of a pond: rings from the bank to the middle, deepest in the middle. */
function pondBasin(poly, rim, depth) {
  const P = resample(poly, 0.35);
  const [cx, cz] = centroidOf(poly);
  const R = 6;
  const pos = [];
  for (let r = 0; r <= R; r++) {
    const f = r / R;
    const y = rim - 0.05 - depth * Math.min(1, Math.sin((Math.min(1, f * 1.6) * Math.PI) / 2));
    for (const [x, z] of P) pos.push(cx + (x - cx) * (1 - f * 0.97), y, cz + (z - cz) * (1 - f * 0.97));
  }
  const n = P.length;
  const idx = [];
  for (let r = 0; r < R; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      idx.push(a, b, a + n, b, b + n, a + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cleaning robot: white body, coloured top, dark tracks. Front is +x. */
function buildCleaner(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.38), new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.5 }));
  body.position.y = 0.12;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: shade(color, -0.35), roughness: 0.5 }));
  top.position.y = 0.245;
  const trackMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.9 });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.06), trackMat);
    t.position.set(0, 0.04, s * 0.2);
    g.add(t);
  }
  g.add(body, top);
  return g;
}

/**
 * Meshes of the pools: `list` = [{ id, kind, poly (plan frame), rim (ground height), depth, color }].
 * Returns { group, items, setRobots(map id -> on), tick(dt, t) }.
 */
export function buildPools(list) {
  const group = new THREE.Group();
  group.name = 'pools';
  const items = [];
  const tex = rippleTexture();
  for (const p of list) {
    const pond = p.kind === 'pond';
    const depth = Math.max(0.2, Math.min(p.depth || 1.5, 6));
    const bottom = p.rim - depth;
    const color = p.color || (pond ? '#3d6b4a' : '#2a9fd6');
    const g = new THREE.Group();
    g.name = `pool-${p.id}`;
    g.userData.pool = p.id;
    // basin
    const liner = new THREE.MeshStandardMaterial({ color: pond ? shade('#5a4a35', 0) : shade(color, 0.55), roughness: pond ? 1 : 0.6, side: THREE.DoubleSide });
    if (pond) g.add(new THREE.Mesh(pondBasin(p.poly, p.rim, depth), liner));
    else {
      g.add(new THREE.Mesh(poolWalls(p.poly, p.rim, bottom), liner));
      g.add(new THREE.Mesh(flatShape(p.poly, bottom), liner));
    }
    // coping (pool) or pebble ring (pond), covering the cut edge of the ground
    const band = new THREE.Mesh(
      flatShape(offsetOutline(p.poly, pond ? 0.45 : 0.32), p.rim + 0.015, [p.poly]),
      new THREE.MeshStandardMaterial({ color: pond ? '#7a7264' : '#ddd6c6', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    band.receiveShadow = true;
    g.add(band);
    // water
    const wm = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: pond ? 0.85 : 0.68,
      roughness: 0.08,
      metalness: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (tex) {
      wm.normalMap = tex.clone();
      wm.normalMap.repeat.set(0.45, 0.45);
      wm.normalScale.set(0.6, 0.6);
    }
    const water = new THREE.Mesh(flatShape(p.poly, p.rim - (pond ? 0.08 : 0.12)), wm);
    water.renderOrder = 4;
    water.name = 'water';
    g.add(water);
    // cleaning robot, parked near the first corner until it runs
    let robot = null;
    if (p.robot) {
      const [cx, cz] = centroidOf(p.poly);
      const [x0, z0] = p.poly[0];
      const park = { x: x0 + (cx - x0) * 0.15, z: z0 + (cz - z0) * 0.15, h: Math.atan2(cz - z0, cx - x0) };
      const r = buildCleaner(color);
      r.position.set(park.x, bottom + (pond ? 0.05 : 0), park.z);
      g.add(r);
      robot = { g: r, s: { ...park }, on: false, poly: p.poly, floor: bottom };
    }
    group.add(g);
    items.push({ id: p.id, g, water, wm, robot, pond, rim: p.rim, depth, poly: p.poly });
  }

  const pondFloor = (it, x, z) => {
    // the robot of a pond follows the sloping bottom (same profile as the basin)
    const [cx, cz] = centroidOf(it.poly);
    const P = it.poly;
    let far = 0;
    for (const q of P) far = Math.max(far, Math.hypot(q[0] - cx, q[1] - cz));
    const f = Math.min(1, Math.hypot(x - cx, z - cz) / (far || 1));
    const u = 1 - f;
    return it.rim - 0.05 - it.depth * Math.min(1, Math.sin((Math.min(1, u * 1.6) * Math.PI) / 2));
  };

  return {
    group,
    items,
    setRobots(map) {
      for (const it of items) if (it.robot) it.robot.on = !!(map && map[it.id]);
    },
    tick(dt, t) {
      for (const it of items) {
        if (it.wm.normalMap) it.wm.normalMap.offset.set((t * 0.02) % 1, (t * 0.013) % 1);
        it.water.position.y = Math.sin(t * 0.9 + it.rim) * 0.006;
        const R = it.robot;
        if (!R || !R.on) continue;
        const n = robotStep(R.poly, R.s, dt);
        R.s = n;
        R.g.position.x = n.x;
        R.g.position.z = n.z;
        if (it.pond && inPolygon(R.poly, n.x, n.z)) R.g.position.y = pondFloor(it, n.x, n.z);
        R.g.rotation.y = -n.h;
      }
    },
  };
}
