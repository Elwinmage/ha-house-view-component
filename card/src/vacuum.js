// Robot vacuum on the plan: conversion of the robot's own coordinates to plan coordinates (calibrated on the dock),
// tracking of the rooms being cleaned (coverage estimated from the robot's path), a simulated route for vacuums that
// report no position, and the 3D models of the robot and its dock.
import * as THREE from 'three';

export const VAC_DEFAULTS = {
  dock: null, // { at: [x, z], level, base, dir }: where the dock is on the plan and the way it faces (compass deg)
  origin: null, // robot coordinates of the dock [x, y] (Roborock: 25500, 25500)
  rot: 0, // degrees, robot map -> plan
  flip: true, // robot maps have y up, the plan has z down
  scale: 0.001, // robot unit -> meters (millimeters by default)
  color: '#f2f2f2',
  room_color: '#2f80ed',
  size: 1.4, // the robot is drawn a little bigger than life to stay visible
  source: 'auto', // auto | roborock | entity | none
  pos_entity: '',
  trail: true,
};

const inPoly = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Direction the dock faces, as a unit vector on the plan (compass: 0 deg = top of the plan, clockwise; default east). */
export function dockFront(dock) {
  const a = (((dock && dock.dir) ?? 90) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/** Robot coordinates {x, y} -> plan [x, z]; null while the dock or its robot coordinates are unknown. */
export function robotToPlan(v, p, charger = null) {
  const o = charger || v.origin;
  if (!v.dock || !v.dock.at || !o || !p) return null;
  const s = v.scale || 0.001;
  const dx = (p.x - o[0]) * s;
  const dy = (p.y - o[1]) * s * (v.flip === false ? 1 : -1);
  const a = ((v.rot || 0) * Math.PI) / 180;
  return [v.dock.at[0] + dx * Math.cos(a) - dy * Math.sin(a), v.dock.at[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * Rotation that brings robot position `p` onto plan point `at` (second calibration point, the first is the dock).
 * ratio = plan distance / robot distance: far from 1 means a wrong scale, or a point too close to the dock.
 */
export function solveRotation(v, p, at, charger = null) {
  const o = charger || v.origin;
  if (!v.dock || !v.dock.at || !o || !p) return null;
  const s = v.scale || 0.001;
  const dx = (p.x - o[0]) * s;
  const dy = (p.y - o[1]) * s * (v.flip === false ? 1 : -1);
  const tx = at[0] - v.dock.at[0];
  const tz = at[1] - v.dock.at[1];
  const dr = Math.hypot(dx, dy);
  if (dr < 0.5 || Math.hypot(tx, tz) < 0.5) return null; // too close to the dock to give an angle
  let rot = ((Math.atan2(tz, tx) - Math.atan2(dy, dx)) * 180) / Math.PI;
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  return { rot: Math.round(rot * 10) / 10, ratio: Math.hypot(tx, tz) / dr };
}

/** Position {x, y, a?} and charger [x, y] read from the attributes of a map entity (map extractors, Dreame, AnyVac...). */
export function positionFromAttributes(attrs) {
  if (!attrs) return null;
  const num = (o) => o && Number.isFinite(+o.x) && Number.isFinite(+o.y);
  const p = [attrs.vacuum_position, attrs.robot_position, attrs.position].find(num);
  if (!p) return null;
  const c = [attrs.charger, attrs.charger_position, attrs.dock_position].find(num);
  return { pos: { x: +p.x, y: +p.y, a: Number.isFinite(+p.a) ? +p.a : undefined }, charger: c ? [+c.x, +c.y] : null };
}

/** Back-and-forth rows covering a polygon (rows `gap` apart, kept `gap / 2` from the walls): [[x, z], ...]. */
export function rowsPath(poly, gap = 0.3) {
  const zs = poly.map((p) => p[1]);
  const out = [];
  let flip = false;
  for (let z = Math.min(...zs) + gap / 2; z < Math.max(...zs); z += gap) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z) xs.push(xi + ((z - zi) * (xj - xi)) / (zj - zi));
    }
    xs.sort((a, b) => a - b);
    const spans = [];
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > gap) spans.push([xs[k] + gap / 2, xs[k + 1] - gap / 2]);
    if (flip) spans.reverse();
    for (const [a, b] of spans) out.push(flip ? [b, z] : [a, z], flip ? [a, z] : [b, z]);
    flip = !flip;
  }
  return out;
}

const pathLength = (p) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

function pointAt(path, d) {
  for (let i = 1; i < path.length; i++) {
    const L = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (d <= L && L > 0)
      return [path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * d) / L, path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * d) / L];
    d -= L;
  }
  return path[path.length - 1];
}

/**
 * Follows a cleaning run room by room.
 * Room states: idle | queued (asked, not started) | active | done. With real positions, the completion of a room is
 * the share of its floor the robot passed over (cells of `cell` m; `reach` = share of a room a robot can reach, the
 * rest being furniture). Without positions, `simulate()` moves the robot along a made-up route.
 */
export class VacuumTracker {
  constructor(rooms, opts = {}) {
    this.cell = opts.cell || 0.25;
    this.reach = opts.reach || 0.8;
    this.glowMs = opts.glowMs ?? 60000;
    this.rooms = rooms.map((r) => {
      const xs = r.poly.map((p) => p[0]);
      const zs = r.poly.map((p) => p[1]);
      const cells = new Set();
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      for (let iz = 0; z0 + iz * this.cell < Math.max(...zs); iz++) {
        for (let ix = 0; x0 + ix * this.cell < Math.max(...xs); ix++) {
          if (inPoly(x0 + (ix + 0.5) * this.cell, z0 + (iz + 0.5) * this.cell, r.poly)) cells.add(`${ix},${iz}`);
        }
      }
      return { id: r.id, poly: r.poly, x0, z0, cells, center: [(x0 + Math.max(...xs)) / 2, (z0 + Math.max(...zs)) / 2] };
    });
    this.byId = Object.fromEntries(this.rooms.map((r) => [r.id, r]));
    this.reset();
  }

  reset() {
    this.state = Object.fromEntries(this.rooms.map((r) => [r.id, { status: 'idle', covered: new Set(), doneAt: 0, sim: null }]));
    this.running = false;
    this.sel = null;
    this.active = null;
    this.pos = null;
    this.trail = [];
    this.route = null;
    this._last = null;
    this._cand = undefined;
  }

  /** A run starts. sel = room ids asked for (null when unknown: started from the robot's own app). */
  start(sel, now) {
    this.reset();
    this.running = true;
    this.startedAt = now;
    this.sel = sel && sel.length ? new Set(sel.filter((id) => this.byId[id])) : null;
    if (this.sel) for (const id of this.sel) this.state[id].status = 'queued';
  }

  roomAt(x, z) {
    const r = this.rooms.find((rm) => inPoly(x, z, rm.poly));
    return r ? r.id : null;
  }

  _mark(x, z) {
    const id = this.roomAt(x, z);
    if (!id) return;
    const r = this.byId[id];
    const cx = Math.floor((x - r.x0) / this.cell);
    const cz = Math.floor((z - r.z0) / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = `${cx + dx},${cz + dz}`;
        // the robot is about 35 cm wide: it covers the cells whose center is within 22 cm
        if (r.cells.has(k) && Math.hypot(r.x0 + (cx + dx + 0.5) * this.cell - x, r.z0 + (cz + dz + 0.5) * this.cell - z) < 0.22)
          this.state[id].covered.add(k);
      }
    }
  }

  /** New real position (plan coordinates). */
  sample(x, z, now) {
    const prev = this._last;
    this._last = { x, z, t: now };
    this.pos = [x, z];
    if (!this.running) return;
    this.trail.push([x, z]);
    if (this.trail.length > 1500) this.trail.splice(0, this.trail.length - 1500);
    const d = prev ? Math.hypot(x - prev.x, z - prev.z) : 0;
    // coverage along the move since the last position (not across a long gap: the path in between is unknown)
    const n = prev && now - prev.t < 90000 && d < 6 ? Math.ceil(d / (this.cell / 2)) : 0;
    for (let k = 0; k <= n; k++) this._mark(n ? prev.x + ((x - prev.x) * k) / n : x, n ? prev.z + ((z - prev.z) * k) / n : z);
    // a room becomes the active one when two positions in a row are inside it (no flicker in a doorway)
    const id = this.roomAt(x, z);
    if (id !== this.active && id === this._cand) this._enter(id, now);
    this._cand = id;
  }

  _enter(id, now) {
    if (this.active) this._leave(this.active, now);
    this.active = id;
    if (id && this.state[id].status !== 'done') this.state[id].status = 'active';
  }

  _leave(id, now) {
    const st = this.state[id];
    if (st.status !== 'active') return;
    if (this.pct(id) >= 0.5) {
      st.status = 'done';
      st.doneAt = now;
    } else st.status = this.sel && this.sel.has(id) ? 'queued' : 'idle'; // only crossed on the way to another room
  }

  /** The run is over (robot going home or docked). */
  stop(now) {
    if (!this.running) return;
    for (const r of this.rooms) {
      const st = this.state[r.id];
      if (st.status === 'done') continue;
      const cleaned = this.route ? st.sim !== null && st.sim > 0.3 : this.pct(r.id) >= 0.3;
      st.status = cleaned ? 'done' : 'idle';
      if (cleaned) st.doneAt = now;
    }
    this.running = false;
    this.active = null;
  }

  /** Completion of a room, 0..1. */
  pct(id) {
    const st = this.state[id];
    const r = this.byId[id];
    if (!st || !r) return 0;
    if (st.status === 'done') return 1;
    const v = st.sim !== null ? st.sim : r.cells.size ? st.covered.size / (r.cells.size * this.reach) : 0;
    return Math.min(v, 0.99);
  }

  status(id) {
    return this.state[id] ? this.state[id].status : 'idle';
  }

  /** 1 -> 0 during the minute after a room was finished. */
  glow(id, now) {
    const st = this.state[id];
    if (!st || !st.doneAt || now - st.doneAt >= this.glowMs) return 0;
    return 1 - (now - st.doneAt) / this.glowMs;
  }

  /** Completion of the whole run, 0..1 (rooms weighted by their area). */
  total() {
    const ids = this.sel ? [...this.sel] : this.rooms.filter((r) => this.state[r.id].status !== 'idle').map((r) => r.id);
    let a = 0;
    let s = 0;
    for (const id of ids) {
      a += this.byId[id].cells.size;
      s += this.byId[id].cells.size * this.pct(id);
    }
    return a ? s / a : 0;
  }

  /** Made-up route for a vacuum that reports no position: rooms nearest first, back-and-forth rows in each. */
  plan(from) {
    let ids = this.sel ? [...this.sel] : this.rooms.map((r) => r.id);
    const route = [];
    let at = from || (ids.length ? this.byId[ids[0]].center : [0, 0]);
    while (ids.length) {
      ids.sort(
        (a, b) =>
          Math.hypot(this.byId[a].center[0] - at[0], this.byId[a].center[1] - at[1]) -
          Math.hypot(this.byId[b].center[0] - at[0], this.byId[b].center[1] - at[1]),
      );
      const id = ids.shift();
      const path = rowsPath(this.byId[id].poly);
      if (path.length < 2) continue;
      route.push({ id, path, len: pathLength(path) });
      at = path[path.length - 1];
    }
    this.route = route;
    this.routeLen = route.reduce((a, r) => a + r.len, 0);
    for (const r of route) {
      this.state[r.id].sim = 0;
      if (this.state[r.id].status === 'idle') this.state[r.id].status = 'queued';
    }
    if (!this.sel) this.sel = new Set(route.map((r) => r.id));
    return route;
  }

  /** Simulated position at `frac` (0..1) of the route; updates the room states. Returns [x, z] or null. */
  simulate(frac, now) {
    if (!this.route || !this.route.length) return null;
    let d = Math.min(Math.max(frac, 0), 1) * this.routeLen;
    for (let i = 0; i < this.route.length; i++) {
      const r = this.route[i];
      const st = this.state[r.id];
      if (d > r.len && i < this.route.length - 1) {
        if (st.status !== 'done') {
          st.status = 'done';
          st.doneAt = now;
        }
        st.sim = 1;
        d -= r.len;
        continue;
      }
      st.sim = Math.min(d / r.len, 1);
      if (st.status !== 'done') st.status = 'active';
      this.active = r.id;
      this.pos = pointAt(r.path, Math.min(d, r.len));
      this.trail.push(this.pos);
      if (this.trail.length > 1500) this.trail.splice(0, this.trail.length - 1500);
      return this.pos;
    }
    return this.pos;
  }
}

/** Robot model, about life size (35 cm), origin on the floor, front towards +x. */
export function buildRobot(color = '#f2f2f2') {
  const g = new THREE.Group();
  g.name = 'robot';
  const dark = new THREE.Color(color).getHSL({}).l > 0.5 ? '#3a3f46' : '#9aa3ad';
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: '#000000' });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.08, 28), bodyMat);
  body.position.y = 0.055;
  body.castShadow = true;
  const bumper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.178, 0.178, 0.035, 28, 1, true, Math.PI / 2 - 1.2, 2.4),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 }),
  );
  bumper.position.y = 0.05;
  const turret = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.03, 18),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.4 }),
  );
  turret.position.set(-0.04, 0.11, 0);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7fd4ff' }));
  led.position.set(0.1, 0.0965, 0);
  g.add(body, bumper, turret, led);
  g.userData.body = bodyMat;
  return g;
}

/** Charging dock: a small base with a back plate, front towards +x. */
export function buildDock() {
  const g = new THREE.Group();
  g.name = 'dock';
  const mat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.36), mat);
  base.position.set(0.05, 0.01, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.2), mat);
  back.position.set(-0.15, 0.08, 0);
  back.castShadow = true;
  g.add(base, back);
  return g;
}
