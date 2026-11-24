// Pools, spas and ponds drawn in the editor: basin dug in the ground (vertical walls and flat bottom for a pool,
// sloping bottom for a pond) or standing over it on its shell (a spa), coping or pebble ring, moving water, the
// cleaning robot wandering on the bottom, the lamps of the water and the roller cover sliding over the pool.
import * as THREE from 'three';
import { polygonArea, centroidOf, robotStep, inPolygon, sideFrame, sideExtent, sidePoint, standsUp, shellOf } from '../pools.js';
import { buildPondFish } from './fish-3d.js';

const BLACK = new THREE.Color('#000000');
const COVER_SPEED = 0.3; // travel of the cover over the water, in metres per second
const ROLLER_R = 0.17; // radius of the roller the cover winds on

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

const slatTextures = new Map();
/** Tiling canvas of the slats of a cover, one per colour (shared; cloned by each cover for its own repeat). */
function slatTexture(color) {
  if (typeof document === 'undefined') return null;
  if (!slatTextures.has(color)) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 4, 16);
    g.fillStyle = shade(color, -0.4).getStyle(); // the groove between two slats
    g.fillRect(0, 14, 4, 2);
    g.fillStyle = shade(color, 0.25).getStyle(); // light caught by the top of a slat
    g.fillRect(0, 1, 4, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    slatTextures.set(color, tex);
  }
  return slatTextures.get(color);
}

/**
 * Lamps of the water: a projector sunk in the wall of a side of the outline, looking at the water, with a halo
 * around it. `list` = the lamps of the pool (see newLamp in pools.js).
 */
function buildLamps(list, poly, rim, depth) {
  const out = [];
  for (const cfg of list) {
    const inward = 0.04;
    const [x, z, f] = sidePoint(poly, cfg.side || 0, cfg.t ?? 0.5, inward);
    const under = Math.min(Math.max(cfg.depth ?? 0.6, 0.1), Math.max(depth - 0.15, 0.15));
    const color = cfg.color || '#49e0ff';
    const g = new THREE.Group();
    g.position.set(x, rim - under, z);
    g.rotation.y = Math.atan2(f.nx, f.nz); // the lens looks at the water
    const lensMat = new THREE.MeshStandardMaterial({ color: '#eef4f7', roughness: 0.25, emissive: BLACK.clone() });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), lensMat);
    const rim2 = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 20),
      new THREE.MeshStandardMaterial({ color: '#cfd6da', roughness: 0.5 }),
    );
    rim2.position.z = -0.005;
    const haloMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), haloMat);
    halo.position.z = 0.08;
    halo.renderOrder = 6;
    halo.visible = false;
    // a lens is small to aim at: an invisible disc around it takes the clicks
    const pick = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    pick.position.z = 0.02;
    g.add(rim2, lens, halo, pick);
    out.push({ cfg, group: g, lensMat, haloMat, color, pick });
  }
  return out;
}

/**
 * Roller cover of a pool: a sheet of slats growing over the water from one side of the outline, and the roller it
 * winds on (on the deck at the end of the pool, or sunk in the water). `cfg`: see newCover in pools.js.
 */
function buildCover(poly, cfg, rim) {
  const f = sideFrame(poly, cfg.side || 0);
  const e = sideExtent(poly, f);
  const width = Math.max(e.u1 - e.u0, 0.5);
  const reach = Math.max(e.v1, 0.5);
  const color = cfg.color || '#dfe4e8';
  const mid = e.u0 + width / 2;
  const g = new THREE.Group();
  g.name = 'pool-cover';
  g.position.set(f.x + f.ux * mid, rim, f.z + f.uz * mid);
  g.rotation.y = Math.atan2(f.nx, f.nz); // local +z goes toward the water, +x runs along the side
  // the sheet: a plane lying flat, growing from the side (local z from 0 to `reach`), just over the water
  const geo = new THREE.PlaneGeometry(width, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const tex = slatTexture(color);
  const map = tex ? tex.clone() : null;
  if (map) map.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness: 0.65, side: THREE.DoubleSide });
  const deck = new THREE.Mesh(geo, mat);
  deck.position.y = -0.06;
  deck.castShadow = true;
  deck.renderOrder = 6;
  g.add(deck);
  // the roller, with the wound edge of the sheet on it: turning while the cover travels
  const spin = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, width * 0.98, 16),
    new THREE.MeshStandardMaterial({ color: shade(color, -0.1), roughness: 0.6 }),
  );
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, width * 0.98, 0.07),
    new THREE.MeshStandardMaterial({ color: shade(color, -0.45), roughness: 0.8 }),
  );
  seam.position.z = ROLLER_R;
  spin.add(cyl, seam);
  const pivot = new THREE.Group();
  pivot.rotation.z = Math.PI / 2; // the axis of the roller runs along the side
  pivot.add(spin);
  const sunk = cfg.roller === 'water';
  pivot.position.set(0, sunk ? -0.32 : ROLLER_R + 0.06, sunk ? 0.45 : -0.38);
  pivot.castShadow = true;
  g.add(pivot);
  return { cfg, group: g, deck, mat, spin, roller: cyl, reach, cur: 0, to: 0 };
}

/** The sheet of a cover over `cur` (0..1) of the pool: its length, the size of its slats and whether it shows. */
function applyCover(C) {
  const len = Math.max(C.cur * C.reach, 0.001);
  C.deck.scale.z = len;
  C.deck.visible = C.cur > 0.004;
  if (C.mat.map) C.mat.map.repeat.set(1, Math.max(1, len / 0.09));
}

/** Lamps and water of a pool lit by `s` = { on, color, level, lamps } (see poolLight in pools.js). */
function applyPoolLight(it, s, glow) {
  const on = !!(s && s.on);
  const k = on ? Math.min(s.level, 1) * (0.3 + 0.7 * glow) : 0;
  it.lit = on;
  it.wm.emissive.copy(on ? new THREE.Color(s.color).multiplyScalar(0.45 * k) : BLACK);
  it.wm.emissiveIntensity = 1;
  if (it.linerMat) it.linerMat.emissive.copy(on ? new THREE.Color(s.color).multiplyScalar(0.3 * k) : BLACK);
  for (const lamp of it.lamps) {
    const st = (s && s.lamps && s.lamps[lamp.cfg.id]) || { on: false };
    lamp.lensMat.emissive.copy(st.on ? new THREE.Color(st.color || lamp.color) : BLACK);
    lamp.lensMat.emissiveIntensity = st.on ? 0.8 + (st.level || 0) : 0;
    lamp.haloMat.color.set(st.color || lamp.color);
    lamp.haloMat.opacity = st.on ? Math.min(0.5, 0.18 + 0.28 * (st.level || 0)) * (0.45 + 0.55 * glow) : 0;
    lamp.haloMat.visible = !!st.on;
  }
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
    // a basin standing over the ground (a spa, an above-ground pool): the ground is cut under it as for any
    // basin, but its rim is raised and the shell that holds the water is seen all around, down to the ground
    const up = standsUp(p);
    const rim = p.rim + up;
    const bottom = rim - depth;
    const color = p.color || (pond ? '#3d6b4a' : '#2a9fd6');
    const g = new THREE.Group();
    g.name = `pool-${p.id}`;
    g.userData.pool = p.id;
    // basin
    const liner = new THREE.MeshStandardMaterial({ color: pond ? shade('#5a4a35', 0) : shade(color, 0.55), roughness: pond ? 1 : 0.6, side: THREE.DoubleSide });
    if (pond) g.add(new THREE.Mesh(pondBasin(p.poly, rim, depth), liner));
    else {
      g.add(new THREE.Mesh(poolWalls(p.poly, rim, bottom), liner));
      g.add(new THREE.Mesh(flatShape(p.poly, bottom), liner));
    }
    // coping (pool) or pebble ring (pond), covering the cut edge of the ground
    const edge = offsetOutline(p.poly, pond ? 0.45 : 0.32);
    // shell of a basin that stands over the ground: it rises right under the coping, which would otherwise hang
    // in the air, and is sunk a little in the ground so that no gap shows where the ground was cut. Outside it
    // wears its own colour, the water and the liner keeping the one of the basin.
    const shell = shellOf(p);
    if (up > 0.01)
      g.add(
        new THREE.Mesh(
          poolWalls(edge, rim + 0.015, p.rim - 0.15),
          new THREE.MeshStandardMaterial({ color: shell, roughness: 0.85, side: THREE.DoubleSide }),
        ),
      );
    const band = new THREE.Mesh(
      flatShape(edge, rim + 0.015, [p.poly]),
      new THREE.MeshStandardMaterial({
        // the coping is the top of the shell when there is one, and the edge of the ground otherwise
        color: up > 0.01 ? shell : pond ? '#7a7264' : '#ddd6c6',
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    band.receiveShadow = true;
    g.add(band);
    // islands (outlines in the plan frame): banks down to the bottom, a pebble ring in the water, and their ground
    // when there is no terrain (with a terrain, the ground of the island is part of it)
    const islands = (p.islands || []).filter((i) => i.length >= 3);
    for (const isl of islands) {
      g.add(new THREE.Mesh(poolWalls(isl, rim + 0.02, bottom), liner));
      const ring = new THREE.Mesh(
        flatShape(offsetOutline(isl, 0.3), rim - 0.03, [isl]),
        new THREE.MeshStandardMaterial({ color: '#7a7264', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }),
      );
      ring.renderOrder = 5;
      g.add(ring);
      if (p.flat) g.add(new THREE.Mesh(flatShape(isl, rim + 0.02), new THREE.MeshStandardMaterial({ color: '#6aa84f', roughness: 1 })));
    }
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
    const water = new THREE.Mesh(flatShape(p.poly, rim - (pond ? 0.08 : 0.12), islands), wm);
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
    // lamps of the water: their colour tints the water and the basin (see applyPoolLight). A lamp with no entity
    // yet is drawn all the same, unlit: it is placed in the editor before it is linked.
    const lamps = buildLamps((p.lights || []).filter(Boolean), p.poly, rim, depth);
    for (const l of lamps) g.add(l.group);
    // roller cover: drawn as soon as there is one, linked to an entity or not (it is placed before it is linked)
    const cover = p.cover ? buildCover(p.poly, p.cover, rim) : null;
    if (cover) {
      // the view toggles the cover when its sheet or its roller is clicked
      cover.deck.userData.pool = p.id;
      cover.roller.userData.pool = p.id;
      applyCover(cover);
      g.add(cover.group);
    }
    group.add(g);
    items.push({
      id: p.id,
      g,
      water,
      wm,
      linerMat: liner,
      robot,
      lamps,
      cover,
      lit: false,
      pond,
      rim,
      depth,
      poly: p.poly,
      islands,
      color,
      fishList: p.fishList || [],
    });
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

  // fish of the ponds, swimming over the sloping bottom (a pool: over its flat bottom)
  for (const it of items) {
    if (!it.fishList.length) continue;
    const floorAt = it.pond ? (x, z) => pondFloor(it, x, z) : () => it.rim - it.depth;
    it.fish = buildPondFish(it.fishList, { poly: it.poly, islands: it.islands, rim: it.rim, depth: it.depth, color: it.color }, floorAt);
    it.g.add(it.fish.group);
  }

  let glow = 1;
  return {
    group,
    items,
    setRobots(map) {
      for (const it of items) if (it.robot) it.robot.on = !!(map && map[it.id]);
    },
    /**
     * Lamps of each pool: `map` = { poolId: { on, color, level, lamps } } (see poolLight in pools.js). `g` (0..1)
     * is how much the night lets a light show, as for the lights of the house.
     */
    setLights(map, g = 1) {
      glow = g;
      for (const it of items) applyPoolLight(it, map && map[it.id], glow);
    },
    /**
     * Covers of each pool: `map` = { poolId: { closed, moving } } (see coverClosed in pools.js). With `snap`, the
     * cover jumps to its place instead of travelling (when the world has just been built).
     */
    setCovers(map, snap = false) {
      for (const it of items) {
        const s = map && map[it.id];
        if (!it.cover || !s) continue;
        it.cover.to = s.closed;
        if (snap) {
          it.cover.cur = s.closed;
          applyCover(it.cover);
        }
      }
    },
    /** What a click can take hold of on a lamp: [{ pool, lamp, mesh }]. */
    lampMeshes() {
      const out = [];
      for (const it of items) for (const l of it.lamps) out.push({ pool: it.id, lamp: l.cfg.id, mesh: l.pick });
      return out;
    },
    /** How far the cover of a pool is drawn over the water (0..1), or null when it has none. */
    coverAt(id) {
      const it = items.find((o) => o.id === id);
      return it && it.cover ? it.cover.cur : null;
    },
    /**
     * What a click can toggle on a cover: [{ pool, mesh }] — its roller, always there, and its sheet while it shows
     * (rolled up, the sheet is not drawn, so only the roller answers).
     */
    coverMeshes() {
      const out = [];
      for (const it of items) {
        if (!it.cover) continue;
        out.push({ pool: it.id, mesh: it.cover.roller });
        if (it.cover.deck.visible) out.push({ pool: it.id, mesh: it.cover.deck });
      }
      return out;
    },
    /** `cold`: the water is cold, the fish stay down and move little. */
    tick(dt, t, cold = false) {
      for (const it of items) {
        if (it.fish) it.fish.tick(dt, t, cold);
        if (it.wm.normalMap) it.wm.normalMap.offset.set((t * 0.02) % 1, (t * 0.013) % 1);
        it.water.position.y = Math.sin(t * 0.9 + it.rim) * 0.006;
        // lit water: the glow breathes a little, as the ripples pass over the lamps
        if (it.lit) {
          it.wm.emissiveIntensity = 0.92 + 0.08 * Math.sin(t * 1.7 + it.rim);
          for (const l of it.lamps) l.group.scale.setScalar(1 + 0.03 * Math.sin(t * 2.3 + l.cfg.t));
        }
        // the cover travels toward its place, the roller turning with it
        const C = it.cover;
        if (C) {
          const d = C.to - C.cur;
          if (Math.abs(d) > 1e-3) {
            const step = Math.sign(d) * Math.min(Math.abs(d), (COVER_SPEED / C.reach) * dt);
            C.cur = Math.min(Math.max(C.cur + step, 0), 1);
            C.spin.rotation.y += (step * C.reach) / ROLLER_R;
            applyCover(C);
          }
        }
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
