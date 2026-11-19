// Procedural geometry derived from the generic scene format: explicit walls with
// openings, floor slabs, roofs, and the outdoor site (ground, pool, deck, fence).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { openingKey } from '../openings.js';

const EPS = 1e-4;

// ---------------------------------------------------------------- polygon utils

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

/** Offset a simple polygon inward by d (miter joins). Works for either winding. */
export function insetPolygon(poly, d) {
  if (Math.abs(d) < 1e-9) return poly.map((p) => [...p]);
  const sign = signedArea(poly) > 0 ? 1 : -1;
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const d1 = norm2([p1[0] - p0[0], p1[1] - p0[1]]);
    const d2 = norm2([p2[0] - p1[0], p2[1] - p1[1]]);
    // inward normal = left normal for a positive area, right normal otherwise
    const n1 = [-d1[1] * sign, d1[0] * sign];
    const n2 = [-d2[1] * sign, d2[0] * sign];
    const a1 = [p1[0] + n1[0] * d, p1[1] + n1[1] * d];
    const a2 = [p1[0] + n2[0] * d, p1[1] + n2[1] * d];
    const cr = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cr) < 1e-9) {
      out.push(a1);
    } else {
      const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / cr;
      out.push([a1[0] + d1[0] * t, a1[1] + d1[1] * t]);
    }
  }
  return out;
}

function norm2(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export function centroid(poly) {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Position of point `at` along edge A->B, or null when it is not on the edge.
 * Returns { t, perp, dir, len }.
 */
export function locateOnEdge(a, b, at, tol = 0.12) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uz = dz / len;
  const rx = at[0] - a[0];
  const rz = at[1] - a[1];
  const t = rx * ux + rz * uz;
  const perp = Math.abs(rx * -uz + rz * ux);
  if (perp > tol || t <= 0 || t >= len) return null;
  return { t, perp, dir: [ux, uz], len };
}

// ---------------------------------------------------------------- derived walls (demo scene)

/**
 * Split every room edge at the vertices of the other rooms (T-junctions), then
 * dedupe shared edges. An edge used by one room only is an exterior wall.
 */
export function buildWallSegments(rooms) {
  const verts = rooms.flatMap((r) => r.poly);
  const map = new Map();
  const key = (a, b) => {
    const k1 = `${a[0].toFixed(3)},${a[1].toFixed(3)}`;
    const k2 = `${b[0].toFixed(3)},${b[1].toFixed(3)}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };
  for (const room of rooms) {
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const a = room.poly[i];
      const b = room.poly[(i + 1) % n];
      const pts = [{ t: 0, p: a }];
      for (const v of verts) {
        const loc = locateOnEdge(a, b, v, EPS * 5);
        if (loc && loc.t > EPS && loc.t < loc.len - EPS) pts.push({ t: loc.t, p: v });
      }
      pts.push({ t: Math.hypot(b[0] - a[0], b[1] - a[1]), p: b });
      pts.sort((p, q) => p.t - q.t);
      for (let j = 0; j < pts.length - 1; j++) {
        if (pts[j + 1].t - pts[j].t < EPS * 5) continue; // duplicate vertex shared by several rooms
        const sa = pts[j].p;
        const sb = pts[j + 1].p;
        const k = key(sa, sb);
        const e = map.get(k);
        if (e) e.rooms.push(room.id);
        else map.set(k, { a: sa, b: sb, rooms: [room.id] });
      }
    }
  }
  return [...map.values()].map((s) => ({ ...s, exterior: s.rooms.length === 1 }));
}

// ---------------------------------------------------------------- walls

export function stripToBasic(g) {
  // mergeGeometries needs identical attribute sets and index state
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) {
    if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  }
  out.clearGroups();
  return out;
}

const isCut = (o) => o.sill <= 0.001; // door-like: notch from the floor

/**
 * Build the walls of one level from level.walls = [{a, b, thickness, height, exterior,
 * joinStart, joinEnd}]. Openings reference their wall through `_wall` (index).
 * Walls are merged into 2 meshes (exterior/interior); a slab strip under each wall
 * keeps the floor closed where rooms stop at the wall faces.
 */
export function buildLevelWalls(level, openings, mats) {
  const exteriorGeos = [];
  const interiorGeos = [];
  const frameGeos = [];
  const panes = [];
  const metas = []; // every opening: moving parts and editor picking

  level.walls.forEach((wall, wi) => {
    const T = wall.thickness;
    const H = wall.height;
    const dx = wall.b[0] - wall.a[0];
    const dz = wall.b[1] - wall.a[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    const ux = dx / L;
    const uz = dz / L;
    const e0 = wall.joinStart ? T / 2 : 0;
    const e1 = wall.joinEnd ? T / 2 : 0;
    const W = L + e0 + e1;
    const rotY = -Math.atan2(dz, dx);

    const ops = [];
    for (const o of openings) {
      if (o.level !== level.id || o._wall !== wi) continue;
      const t = (o.at[0] - wall.a[0]) * ux + (o.at[1] - wall.a[1]) * uz;
      const h = Math.min(o.height, H - 0.05 - o.sill);
      if (h < 0.2) continue;
      const u0 = Math.max(0.04, t - o.width / 2 + e0);
      const u1 = Math.min(W - 0.04, t + o.width / 2 + e0);
      if (u1 - u0 < 0.2) continue;
      ops.push({ o, t, u0, u1, h });
    }
    ops.sort((p, q) => p.u0 - q.u0);
    for (let i = ops.length - 1; i > 0; i--) if (ops[i].u0 < ops[i - 1].u1) ops.splice(i, 1); // overlapping openings

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (const p of ops.filter((p) => isCut(p.o))) {
      shape.lineTo(p.u0, 0);
      shape.lineTo(p.u0, p.h);
      shape.lineTo(p.u1, p.h);
      shape.lineTo(p.u1, 0);
    }
    shape.lineTo(W, 0);
    shape.lineTo(W, H);
    shape.lineTo(0, H);
    shape.lineTo(0, 0);
    for (const p of ops.filter((p) => !isCut(p.o))) {
      const hole = new THREE.Path();
      hole.moveTo(p.u0, p.o.sill);
      hole.lineTo(p.u0, p.o.sill + p.h);
      hole.lineTo(p.u1, p.o.sill + p.h);
      hole.lineTo(p.u1, p.o.sill);
      shape.holes.push(hole);
    }

    const m = new THREE.Matrix4()
      .makeTranslation(wall.a[0] - ux * e0, level.elevation, wall.a[1] - uz * e0)
      .multiply(new THREE.Matrix4().makeRotationY(rotY));

    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
    geo.translate(0, 0, -T / 2);
    geo.applyMatrix4(m);
    (wall.exterior ? exteriorGeos : interiorGeos).push(geo);

    // slab strip under the wall (top just below the floor level to avoid z-fighting)
    const ft = level.floorThickness;
    const slab = new THREE.BoxGeometry(W, ft, T).toNonIndexed();
    slab.translate(W / 2, -ft / 2 - 0.002, 0);
    slab.applyMatrix4(m);
    (wall.exterior ? exteriorGeos : interiorGeos).push(slab);

    // frames + panes for every opening on this wall
    for (const p of ops) {
      const o = p.o;
      const cx = wall.a[0] + ux * p.t;
      const cz = wall.a[1] + uz * p.t;
      const out = outwardDir(level, o.room, [cx, cz], [ux, uz]);
      metas.push({
        key: openingKey(o),
        o,
        type: o.type,
        room: o.room || null,
        level: level.id,
        exterior: wall.exterior,
        width: o.width,
        height: p.h,
        sill: o.sill,
        thickness: T,
        center: [cx, level.elevation + o.sill + p.h / 2, cz],
        rotY,
        side: out[0] * -uz + out[1] * ux > 0 ? 1 : -1, // +1: the local z of the opening points outward
      });
      const ft2 = 0.06; // frame bar thickness
      const bars = [
        [o.width, ft2, 0, o.sill + p.h - ft2 / 2],
        [ft2, p.h, -o.width / 2 + ft2 / 2, o.sill + p.h / 2],
        [ft2, p.h, o.width / 2 - ft2 / 2, o.sill + p.h / 2],
      ];
      if (o.sill > 0) bars.push([o.width, ft2, 0, o.sill + ft2 / 2]);
      for (const [bw, bh, bx, by] of bars) {
        const g = new THREE.BoxGeometry(bw, bh, T + 0.04).toNonIndexed();
        g.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation(cx, level.elevation + by, cz)
            .multiply(new THREE.Matrix4().makeRotationY(rotY))
            .multiply(new THREE.Matrix4().makeTranslation(bx, 0, 0)),
        );
        frameGeos.push(g);
      }
      if (o.type === 'window' || o.type === 'patio' || (o.type === 'door' && wall.exterior)) {
        panes.push({
          key: openingKey(o),
          kind: o.type === 'door' ? 'leaf' : 'glass',
          room: o.room || null,
          exterior: wall.exterior,
          type: o.type,
          width: o.width,
          height: p.h,
          sill: o.sill,
          thickness: T,
          center: [cx, level.elevation + o.sill + p.h / 2, cz],
          rotY,
          out,
        });
      }
    }
  });

  const merge = (geos, mat, name) => {
    if (!geos.length) return null;
    const merged = mergeGeometries(geos.map(stripToBasic));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    return mesh;
  };
  return {
    exterior: merge(exteriorGeos, mats.exterior, `walls-ext-${level.id}`),
    interior: merge(interiorGeos, mats.interior, `walls-int-${level.id}`),
    frames: merge(frameGeos, mats.frame, `frames-${level.id}`),
    panes,
    metas,
  };
}

function outwardDir(level, roomId, p, dir) {
  const room = level.rooms.find((r) => r.id === roomId);
  let n = [-dir[1], dir[0]];
  if (!room) return n;
  const c = centroid(room.poly);
  if ((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] > 0) n = [-n[0], -n[1]];
  return n;
}

// ---------------------------------------------------------------- floors

/** Floor slab of a room. The top face is at `elevation`. */
export function buildFloor(room, elevation, thickness, material) {
  const shape = new THREE.Shape(room.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2; // shape y = -z, extrusion axis becomes up
  mesh.position.y = elevation - thickness;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.roomId = room.id;
  mesh.name = `floor-${room.id}`;
  return mesh;
}

// ---------------------------------------------------------------- roofs

/** Gable roof over a rectangular footprint; ridge along `axis` ('x' or 'z'). */
function buildGableRoof(spec, roofMat, gableMat) {
  const { fp, eaveY, ridgeH, overhang: o, axis = 'x' } = spec;
  const al0 = axis === 'x' ? fp.x0 : fp.z0;
  const al1 = axis === 'x' ? fp.x1 : fp.z1;
  const ac0 = axis === 'x' ? fp.z0 : fp.x0;
  const ac1 = axis === 'x' ? fp.z1 : fp.x1;
  const acm = (ac0 + ac1) / 2;
  const slope = ridgeH / (acm - ac0);
  const yo = eaveY - slope * o; // roof height at the outer eave
  const ridge = eaveY + ridgeH;
  const V = (al, y, ac) => (axis === 'x' ? [al, y, ac] : [ac, y, al]);

  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad(V(al0 - o, yo, ac0 - o), V(al0 - o, ridge, acm), V(al1 + o, ridge, acm), V(al1 + o, yo, ac0 - o));
  quad(V(al0 - o, yo, ac1 + o), V(al1 + o, yo, ac1 + o), V(al1 + o, ridge, acm), V(al0 - o, ridge, acm));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, roofMat);
  roof.castShadow = true;
  roof.receiveShadow = true;

  const gpos = [];
  for (const al of [al0, al1]) gpos.push(...V(al, eaveY, ac0), ...V(al, eaveY, ac1), ...V(al, ridge, acm));
  const ggeo = new THREE.BufferGeometry();
  ggeo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  ggeo.computeVertexNormals();
  const gables = new THREE.Mesh(ggeo, gableMat);
  gables.castShadow = true;

  const group = new THREE.Group();
  group.add(roof, gables);
  return group;
}

/** Flat roof: the footprint polygons extruded upward from y. */
function buildFlatRoof(spec, roofMat) {
  const group = new THREE.Group();
  for (const poly of spec.polys) {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: spec.thickness ?? 0.2, bevelEnabled: false }), roofMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = spec.y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function buildRoof(spec, roofMat, gableMat) {
  if (!spec) return null;
  const g = spec.type === 'flat' ? buildFlatRoof(spec, roofMat) : buildGableRoof(spec, roofMat, gableMat);
  g.name = 'roof';
  return g;
}

// ---------------------------------------------------------------- site

/**
 * Ground (with an optional pool hole) plus the optional pool, deck, path and fence
 * described in `site`. `snowables` collects materials blended toward white by snow.
 */
export function buildSite(site, snowables, terrain = null) {
  const hy = (x, z) => (terrain ? terrain.heightAt(x, z) : 0);
  const group = new THREE.Group();
  group.name = 'site';
  const { plot, pool } = site;
  const M = 45;

  const gs = new THREE.Shape([
    new THREE.Vector2(plot.x0 - M, -(plot.z1 + M)),
    new THREE.Vector2(plot.x1 + M, -(plot.z1 + M)),
    new THREE.Vector2(plot.x1 + M, -(plot.z0 - M)),
    new THREE.Vector2(plot.x0 - M, -(plot.z0 - M)),
  ]);
  if (pool) {
    const hole = new THREE.Path();
    hole.moveTo(pool.x0, -pool.z0);
    hole.lineTo(pool.x0, -pool.z1);
    hole.lineTo(pool.x1, -pool.z1);
    hole.lineTo(pool.x1, -pool.z0);
    gs.holes.push(hole);
  }
  for (const h of site.holes || []) gs.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z)))); // drawn pools
  let groundMat;
  if (terrain) {
    groundMat = terrain.material; // ground mesh comes from the terrain builder
    group.add(terrain.group);
  } else {
    groundMat = new THREE.MeshStandardMaterial({ color: '#6aa84f', roughness: 1 });
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(gs), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    ground.name = 'ground';
    group.add(ground);
  }
  if (terrain && terrain.roadMaterial) snowables.push({ material: terrain.roadMaterial, key: 'road', snow: 0.75, wet: 0.6 });
  // an aerial photo keeps its own colors: no seasonal grass tint, snow is added as a white glow
  snowables.push(terrain && terrain.photo ? { material: groundMat, key: 'photo', photo: true, snow: 0.85, wet: 0.3 } : { material: groundMat, key: 'grass', snow: 1, wet: 0.45 });

  let water = null;
  let waterMat = null;
  if (pool) {
    const pw = pool.x1 - pool.x0;
    const pd = pool.z1 - pool.z0;
    const cx = (pool.x0 + pool.x1) / 2;
    const cz = (pool.z0 + pool.z1) / 2;
    const basinMat = new THREE.MeshStandardMaterial({ color: '#8fd8de', roughness: 0.6, side: THREE.BackSide });
    const basin = new THREE.Mesh(new THREE.BoxGeometry(pw, 1.5, pd), basinMat);
    const py = hy(cx, cz) + (site.poolDy || 0); // poolDy: manual vertical correction
    basin.position.set(cx, py - 0.75, cz);
    basin.receiveShadow = true;
    group.add(basin);
    waterMat = new THREE.MeshStandardMaterial({ color: '#3fb7c9', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.78, emissive: '#000000' });
    water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, py - 0.12, cz);
    water.name = 'water';
    group.add(water);
    const copingMat = new THREE.MeshStandardMaterial({ color: '#e4dfd3', roughness: 0.9 });
    const cw = 0.45;
    for (const [w, d, x, z] of [
      [pw + 2 * cw, cw, cx, pool.z0 - cw / 2],
      [pw + 2 * cw, cw, cx, pool.z1 + cw / 2],
      [cw, pd, pool.x0 - cw / 2, cz],
      [cw, pd, pool.x1 + cw / 2, cz],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), copingMat);
      m.position.set(x, py + 0.02, z);
      m.receiveShadow = true;
      m.castShadow = true;
      group.add(m);
    }
    snowables.push({ material: copingMat, key: 'stone', snow: 0.9, wet: 0.2 });
  }

  if (site.deck) {
    const [x0, z0, x1, z1] = site.deck.rect;
    const deckMat = new THREE.MeshStandardMaterial({ color: '#a07a4f', roughness: 0.85 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, z1 - z0), deckMat);
    deck.position.set((x0 + x1) / 2, hy((x0 + x1) / 2, (z0 + z1) / 2) + 0.04, (z0 + z1) / 2);
    deck.receiveShadow = true;
    deck.castShadow = true;
    deck.name = 'deck';
    group.add(deck);
    snowables.push({ material: deckMat, key: 'deck', snow: 0.95, wet: 0.35 });
  }

  if (site.path) {
    const [x0, z0, x1, z1] = site.path.rect;
    const pathMat = new THREE.MeshStandardMaterial({ color: '#c3b9a4', roughness: 0.95 });
    const path = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0), pathMat);
    path.position.set((x0 + x1) / 2, hy((x0 + x1) / 2, (z0 + z1) / 2) + 0.01, (z0 + z1) / 2);
    path.receiveShadow = true;
    group.add(path);
    snowables.push({ material: pathMat, key: 'path', snow: 0.9, wet: 0.3 });
  }

  if (site.fence) {
    const { x0, z0, x1, z1 } = plot;
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#8c7b66', roughness: 0.9 });
    const fence = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.08), fenceMat);
      m.position.set((ax + bx) / 2, hy((ax + bx) / 2, (az + bz) / 2) + 0.45, (az + bz) / 2);
      m.rotation.y = -Math.atan2(bz - az, bx - ax);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    };
    fence(x0, z0, x1, z0);
    fence(x0, z0, x0, z1);
    fence(x1, z0, x1, z1);
    if (site.fenceGap) {
      fence(x0, z1, site.fenceGap[0], z1);
      fence(site.fenceGap[1], z1, x1, z1);
    } else fence(x0, z1, x1, z1);
    snowables.push({ material: fenceMat, key: 'fence', snow: 0.6, wet: 0.2 });
  }

  return { group, water, groundMat, waterMat };
}
