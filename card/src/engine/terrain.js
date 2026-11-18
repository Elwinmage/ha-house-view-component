// Terrain (DTM) support: a regular height grid in plan coordinates -> ground mesh.
//
// Terrain file format (JSON, produced by tools/fetch_terrain.py or by hand):
//   { "version": 1, "origin": [x0, z0], "step": 1.0, "nx": N, "nz": M,
//     "z": [N*M absolute altitudes in meters, row-major: index = j * nx + i],
//     "center": [cx, cz],     // plan point used as reference for the vertical alignment
//     "s": [N*M altitudes of the SURFACE model (roofs, trees) on the same grid],   // optional (MNS)
//     "buildings": [{poly:[[x,z]..], h}], "roads": [{pts:[[x,z]..], w}], "parcels": [{poly, id}] }
//   the vector layers (optional, BD TOPO / cadastre) are in the same frame as the grid.
// x = east, z = south in the plan frame, same as the scene model.
import * as THREE from 'three';
import { pointInPolygon } from './geometry.js';
import { compileOps, WALL_T } from './terrain-edit.js';

export function parseTerrain(text) {
  const t = typeof text === 'string' ? JSON.parse(text) : text;
  if (!t || t.version !== 1 || !Array.isArray(t.z) || t.z.length !== t.nx * t.nz) throw new Error('Fichier terrain invalide (version 1 attendue)');
  if (t.s && t.s.length !== t.z.length) throw new Error('Fichier terrain invalide : surface (s) de taille différente');
  return t;
}

/** Bilinear height (absolute altitude) of the raw grid, clamped at the borders. */
export function gridHeight(t, x, z, arr = t.z) {
  const fx = Math.min(Math.max((x - t.origin[0]) / t.step, 0), t.nx - 1.0001);
  const fz = Math.min(Math.max((z - t.origin[1]) / t.step, 0), t.nz - 1.0001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const h = (a, b) => arr[b * t.nx + a];
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** A synthetic slope used for tests: rises toward -z (north) and toward x min. */
export function syntheticTerrain(center, size = 80, step = 1, slopeZ = 0.12, slopeX = 0.03) {
  const n = Math.round(size / step) + 1;
  const o = [center[0] - size / 2, center[1] - size / 2];
  const z = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z.push(100 - (o[1] + j * step - center[1]) * slopeZ - (o[0] + i * step - center[0]) * slopeX);
  return { version: 1, origin: o, step, nx: n, nz: n, z, center };
}

const rectPoly = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

/**
 * Build the ground mesh.
 * - the terrain is aligned so that its height at `t.center` equals `base` (meters, plan frame);
 * - vertices under the lowest level's rooms are dug below the floor so the house sits in the ground;
 * - pool / deck / path rectangles get a flat pad, the pool footprint is cut out of the mesh.
 * Returns { group, material, heightAt, pads } where pads holds the pad height of each element.
 */
/**
 * Plan point -> grid point. The grid is rotated by `rot` degrees and shifted by (dx, dz) meters
 * around its center, relative to the plan (used to register the plan on the DTM/DSM).
 */
export function planToGrid(t, cfg) {
  const a = (-(cfg.rot || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [cx, cz] = t.center;
  const dx = cfg.dx || 0;
  const dz = cfg.dz || 0;
  return (x, z) => {
    const px = x - cx - dx;
    const pz = z - cz - dz;
    return [cx + px * c - pz * s, cz + px * s + pz * c];
  };
}

/** Inverse of planToGrid: grid point -> plan point (used to draw grid-frame vectors on the plan). */
export function gridToPlan(t, cfg) {
  const a = ((cfg.rot || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [cx, cz] = t.center;
  return (x, z) => {
    const px = x - cx;
    const pz = z - cz;
    return [cx + px * c - pz * s + (cfg.dx || 0), cz + px * s + pz * c + (cfg.dz || 0)];
  };
}

export function buildTerrain(t, sd, cfg) {
  const base = cfg.base;
  const cell = Math.max(0.5, Math.max((t.nx - 1) * t.step, (t.nz - 1) * t.step) / 260);
  const zRef = gridHeight(t, t.center[0], t.center[1]);
  const toGrid = planToGrid(t, cfg);
  const raw0 = (x, z) => {
    const [gx, gz] = toGrid(x, z);
    return gridHeight(t, gx, gz) - zRef + base;
  };
  // manual corrections (retaining walls, terraces, brushes) applied on top of the LiDAR ground
  const eops = cfg.ops && cfg.ops.length ? compileOps(cfg.ops, gridToPlan(t, cfg), (alt) => alt - zRef + base) : null;
  const raw = eops ? (x, z) => eops.apply(x, z, raw0(x, z), raw0) : raw0;
  const surf = (x, z) => {
    const [gx, gz] = toGrid(x, z);
    return gridHeight(t, gx, gz, t.s) - zRef + base;
  };

  const ground = sd.levels[0];
  const footprint = ground.rooms.map((r) => r.poly);
  const pad = {};
  const pads = [];
  const addPad = (key, rect) => {
    const cx = (rect[0] + rect[2]) / 2;
    const cz = (rect[1] + rect[3]) / 2;
    pad[key] = raw(cx, cz);
    pads.push({ key, rect: [rect[0] - 0.5, rect[1] - 0.5, rect[2] + 0.5, rect[3] + 0.5], y: pad[key] });
  };
  const pool = sd.site.pool;
  if (pool) addPad('pool', [pool.x0, pool.z0, pool.x1, pool.z1]);
  if (sd.site.deck) addPad('deck', sd.site.deck.rect);
  if (sd.site.path) addPad('path', sd.site.path.rect);

  const nearFootprint = (x, z) => footprint.some((p) => pointInPolygon([x, z], p));
  const heightAt = (x, z) => {
    for (const p of pads) if (x >= p.rect[0] && x <= p.rect[2] && z >= p.rect[1] && z <= p.rect[3]) return p.y;
    return raw(x, z);
  };
  // dug height used for the mesh only (inside the building the ground goes under the floor)
  const meshHeight = (x, z) => {
    if (nearFootprint(x, z)) return Math.min(heightAt(x, z), -0.3);
    return heightAt(x, z);
  };

  const x0 = t.origin[0];
  const z0 = t.origin[1];
  const nx = Math.floor(((t.nx - 1) * t.step) / cell);
  const nz = Math.floor(((t.nz - 1) * t.step) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      let x = x0 + i * cell;
      let z = z0 + j * cell;
      if (eops && eops.walls.length) [x, z] = eops.snap(x, z, cell);
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = meshHeight(x, z) - 0.02;
      pos[k + 2] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * cell;
      const cz = z0 + (j + 0.5) * cell;
      if (pool && cx > pool.x0 && cx < pool.x1 && cz > pool.z0 && cz < pool.z1) continue; // pool cut-out
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise seen from +y
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // slope shading: banks get darker and earthier so the relief reads like a hillshade
  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(nrm.count * 3);
  for (let k = 0; k < nrm.count; k++) {
    const steep = Math.min(Math.max((1 - nrm.getY(k)) * 4, 0), 1);
    col[k * 3] = 1 - 0.28 * steep;
    col[k * 3 + 1] = 1 - 0.42 * steep;
    col[k * 3 + 2] = 1 - 0.55 * steep;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  // skirt so the slab edge does not look paper-thin
  const skirt = [];
  const sk = (ax, az, bx, bz) => {
    const ya = meshHeight(ax, az) - 0.02;
    const yb = meshHeight(bx, bz) - 0.02;
    skirt.push(ax, ya, az, bx, yb, bz, ax, ya - 4, az, bx, yb, bz, bx, yb - 4, bz, ax, ya - 4, az);
  };
  const xe = x0 + nx * cell;
  const ze = z0 + nz * cell;
  for (let i = 0; i < nx; i++) {
    sk(x0 + i * cell, z0, x0 + (i + 1) * cell, z0);
    sk(x0 + (i + 1) * cell, ze, x0 + i * cell, ze);
  }
  for (let j = 0; j < nz; j++) {
    sk(x0, z0 + (j + 1) * cell, x0, z0 + j * cell);
    sk(xe, z0 + j * cell, xe, z0 + (j + 1) * cell);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
  sg.computeVertexNormals();

  // DSM overlay: smooth orange surface where the DSM is > 2.5 m above the ground (buildings, tall trees)
  let mns = null;
  if (t.s && cfg.showMns !== false) {
    const mc = 1;
    const mw = Math.floor((nx * cell) / mc);
    const mh = Math.floor((nz * cell) / mc);
    const ex = t.center[0];
    const ez = t.center[1];
    const mp = new Float32Array((mw + 1) * (mh + 1) * 3);
    const ok = new Uint8Array((mw + 1) * (mh + 1));
    for (let j = 0; j <= mh; j++) {
      for (let i = 0; i <= mw; i++) {
        const x = x0 + i * mc;
        const z = z0 + j * mc;
        const [gx, gz] = toGrid(x, z);
        const gh = gridHeight(t, gx, gz) - zRef + base;
        const sh = gridHeight(t, gx, gz, t.s) - zRef + base;
        const k = j * (mw + 1) + i;
        mp[k * 3] = x;
        mp[k * 3 + 1] = sh;
        mp[k * 3 + 2] = z;
        ok[k] = sh - gh >= 2.5 && Math.hypot(x - ex, z - ez) <= 45 ? 1 : 0;
      }
    }
    const mi = [];
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        const a = j * (mw + 1) + i;
        const b2 = a + 1;
        const c = a + (mw + 1);
        const d = c + 1;
        if (ok[a] && ok[b2] && ok[c] && ok[d]) mi.push(a, c, b2, b2, c, d);
      }
    }
    if (mi.length) {
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      mg.setIndex(mi);
      mg.computeVertexNormals();
      mns = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
      mns.renderOrder = 4;
      mns.name = 'mns';
    }
  }

  // Vector overlay: BD TOPO buildings (red), roads (grey), cadastral parcels (yellow)
  let vec = null;
  if ((t.buildings || t.roads || t.parcels) && cfg.showVec !== false) {
    vec = new THREE.Group();
    vec.name = 'vectors';
    const g2p = gridToPlan(t, cfg);
    const P = (pt) => g2p(pt[0], pt[1]);
    const lineMat = (c) => new THREE.LineBasicMaterial({ color: c });
    const lift = (x, z, dy) => heightAt(x, z) + dy;
    const outline = (poly, color, dy, closed) => {
      const pts = poly.map(P).map(([x, z]) => new THREE.Vector3(x, lift(x, z, dy), z));
      const l = closed ? new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color)) : new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color));
      l.renderOrder = 5;
      vec.add(l);
    };
    for (const p of t.parcels || []) outline(p.poly, '#ffe14d', 0.2, true);
    const bpos = [];
    const bidx = [];
    for (const b of t.buildings || []) {
      outline(b.poly, '#ff4d4d', 0.3, true);
      const pl = b.poly.map(P);
      if (pl.length > 3 && pl[0][0] === pl[pl.length - 1][0] && pl[0][1] === pl[pl.length - 1][1]) pl.pop();
      const tris = THREE.ShapeUtils.triangulateShape(pl.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const base = bpos.length / 3;
      const cy = lift(pl[0][0], pl[0][1], 0.25);
      for (const [x, z] of pl) bpos.push(x, cy, z);
      for (const [a, b2, c] of tris) bidx.push(base + a, base + b2, base + c);
    }
    if (bidx.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
      bg.setIndex(bidx);
      const bm = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
      bm.renderOrder = 4;
      vec.add(bm);
    }
    const rpos = [];
    const ridx = [];
    for (const r of t.roads || []) {
      const pl = r.pts.map(P);
      const hw = (r.w || 4) / 2;
      for (let i = 0; i < pl.length - 1; i++) {
        const [ax, az] = pl[i];
        const [bx, bz] = pl[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.01) continue;
        const nx = (-(bz - az) / L) * hw;
        const nz = ((bx - ax) / L) * hw;
        const k = rpos.length / 3;
        const ya = lift(ax, az, 0.08);
        const yb = lift(bx, bz, 0.08);
        rpos.push(ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx - nx, yb, bz - nz, bx + nx, yb, bz + nz);
        ridx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    if (ridx.length) {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
      rg.setIndex(ridx);
      const rm = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#8a8f98', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      rm.renderOrder = 3;
      vec.add(rm);
    }
  }

  const material = new THREE.MeshStandardMaterial({ color: '#6aa84f', roughness: 1, side: THREE.DoubleSide, vertexColors: true });
  const group = new THREE.Group();
  group.name = 'terrain';
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  const skirtMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: '#4a3b2a', roughness: 1, side: THREE.DoubleSide }));
  group.add(mesh, skirtMesh);
  if (mns) group.add(mns);
  if (vec) group.add(vec);

  // masonry faces of the retaining walls (vertical boxes along each segment)
  if (eops) {
    const wallMat = new THREE.MeshStandardMaterial({ color: '#a39a8b', roughness: 0.95 });
    for (const w of eops.walls) {
      if (w.hiY - w.loY < 0.05) continue;
      for (let i = 0; i < w.pts.length - 1; i++) {
        const [ax, az] = w.pts[i];
        const [bx, bz] = w.pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const h = w.hiY - w.loY + 1.03; // buried 1 m below the foot so the base never shows on a slope
        const m = new THREE.Mesh(new THREE.BoxGeometry(L + WALL_T, h, WALL_T), wallMat);
        m.position.set((ax + bx) / 2, w.loY - 1 + h / 2 - 0.02, (az + bz) / 2);
        m.rotation.y = -Math.atan2(bz - az, bx - ax);
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = 'retaining-wall';
        group.add(m);
      }
    }
  }

  // Vertical profile between two plan points: original ground, corrected ground and DSM (when available)
  const profile = (ax, az, bx, bz, n = 120) => {
    const out = { d: [], ground0: [], ground: [], surf: t.s ? [] : null };
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      out.d.push((Math.hypot(bx - ax, bz - az) * i) / n);
      out.ground0.push(raw0(x, z));
      out.ground.push(raw(x, z));
      if (t.s) out.surf.push(surf(x, z));
    }
    return out;
  };
  return { group, material, heightAt, pad, profile, ground: mesh, hasMns: !!mns, hasVec: !!vec, extent: { x0, z0, x1: xe, z1: ze }, zRef };
}

/**
 * Register the plan on the DSM: search rotation + shift that maximize the overlap (IoU) between the
 * plan footprint (rooms of every level) and the "above ground" mask of the DSM, then estimate the
 * vertical base from the median DSM height over the footprint versus the top of the plan walls.
 */
/**
 * Tall vegetation from the DSM: local maxima of (surface - ground) above 2.5 m that are not on a
 * building. Returns vegetation placements (plan coordinates) with a scale relative to the species height.
 */
export function treesFromDsm(t, cfg, sd, isRemoved = null) {
  if (!t.s) return [];
  const g2p = gridToPlan(t, cfg);
  const bpolys = (t.buildings || []).map((b) => b.poly);
  const rooms = sd.levels.flatMap((l) => l.rooms.map((r) => r.poly));
  const H = (i, j) => t.s[j * t.nx + i] - t.z[j * t.nx + i];
  const rad = Math.max(2, Math.round(2.5 / t.step)); // a tree crown is ~5 m wide
  const found = [];
  for (let j = 1; j < t.nz - 1; j++) {
    for (let i = 1; i < t.nx - 1; i++) {
      const h = H(i, j);
      if (h < 2.5 || h > 30) continue;
      let peak = true;
      for (let dj = -rad; dj <= rad && peak; dj++) {
        for (let di = -rad; di <= rad; di++) {
          if ((di || dj) && H(Math.min(Math.max(i + di, 0), t.nx - 1), Math.min(Math.max(j + dj, 0), t.nz - 1)) >= h + (di < 0 || dj < 0 ? 0 : 1e-6)) peak = false;
        }
      }
      if (!peak) continue;
      const gx = t.origin[0] + i * t.step;
      const gz = t.origin[1] + j * t.step;
      if (bpolys.some((p) => pointInPolygon([gx, gz], p))) continue;
      if (isRemoved && isRemoved(gx, gz)) continue; // deleted by hand in the tree editor
      const [x, z] = g2p(gx, gz);
      if (rooms.some((p) => pointInPolygon([x, z], p))) continue;
      found.push({ x, z, h, gx, gz });
    }
  }
  found.sort((a, b) => b.h - a.h);
  return found.slice(0, 500).map(({ x, z, h, gx, gz }) => {
    const species = h < 4.5 ? 'olive' : 'oak';
    return { species, at: [x, z], scale: h / (species === 'olive' ? 3.4 : 8.5), _src: { kind: 'dsm', gx, gz } };
  });
}

export function autoCalibrate(t, sd) {
  const hasB = !!(t.buildings && t.buildings.length);
  if (!t.s && !hasB) throw new Error('Ce terrain ne contient ni MNS ni bâtiments : relancer fetch_terrain.py avec --mns et/ou --vectors');
  const polys = sd.levels.flatMap((l) => l.rooms.map((r) => r.poly));
  if (!polys.length) throw new Error('Aucune pièce dans le plan : rien à caler');
  const xs = polys.flat().map((p) => p[0]);
  const zs = polys.flat().map((p) => p[1]);
  const cells = [];
  for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += 1) {
    for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 1) if (polys.some((p) => pointInPolygon([x, z], p))) cells.push([x, z]);
  }
  const mask = new Uint8Array(t.z.length);
  let maskCount = 0;
  const bpolys = hasB ? t.buildings.map((b) => b.poly) : [];
  for (let j = 0; j < t.nz; j++) {
    for (let i = 0; i < t.nx; i++) {
      const x = t.origin[0] + i * t.step;
      const z = t.origin[1] + j * t.step;
      if (Math.hypot(x - t.center[0], z - t.center[1]) > 30) continue;
      const on = hasB ? bpolys.some((p) => pointInPolygon([x, z], p)) : t.s[j * t.nx + i] - t.z[j * t.nx + i] > 2.5;
      if (on) {
        mask[j * t.nx + i] = 1;
        maskCount++;
      }
    }
  }
  const maskArea = maskCount * t.step * t.step; // plan cells are 1 m x 1 m
  if (!maskCount) throw new Error('Aucun bâti détecté autour de la maison');
  const score = (rot, dx, dz) => {
    const f = planToGrid(t, { rot, dx, dz });
    let hit = 0;
    for (const [x, z] of cells) {
      const [gx, gz] = f(x, z);
      const i = Math.round((gx - t.origin[0]) / t.step);
      const j = Math.round((gz - t.origin[1]) / t.step);
      if (i >= 0 && j >= 0 && i < t.nx && j < t.nz && mask[j * t.nx + i]) hit++;
    }
    return hit / (cells.length + maskArea - hit);
  };
  let best = { rot: 0, dx: 0, dz: 0, v: -1 };
  // 3 stages around the current best: the plan may be rotated by any angle (compass often left at 0)
  const scan = (rc, rr, rs, xc, zc, dr, ds) => {
    for (let rot = rc - rr; rot <= rc + rr + 1e-9; rot += rs) {
      for (let dx = xc - dr; dx <= xc + dr + 1e-9; dx += ds) {
        for (let dz = zc - dr; dz <= zc + dr + 1e-9; dz += ds) {
          const v = score(rot, dx, dz);
          if (v > best.v) best = { rot, dx, dz, v };
        }
      }
    }
  };
  scan(0, 180, 3, 0, 0, 14, 2);
  scan(best.rot, 4, 1, best.dx, best.dz, 3, 1);
  scan(best.rot, 1, 0.25, best.dx, best.dz, 1, 0.25);
  const out = { rot: Math.round(best.rot * 100) / 100, dx: Math.round(best.dx * 100) / 100, dz: Math.round(best.dz * 100) / 100, iou: best.v, source: hasB ? 'bâtiments BD TOPO' : 'MNS' };
  if (t.s) {
    // vertical: median DSM over the footprint vs the highest wall top of the plan (eaves)
    const f = planToGrid(t, best);
    const zRef = gridHeight(t, t.center[0], t.center[1]);
    const hs = cells.map(([x, z]) => {
      const [gx, gz] = f(x, z);
      return gridHeight(t, gx, gz, t.s) - zRef;
    }).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)];
    const top = Math.max(...sd.levels.map((l) => l.elevation + Math.max(0, ...l.walls.map((w) => w.height))));
    out.base = Math.round((top - med) * 100) / 100;
  }
  return out;
}
