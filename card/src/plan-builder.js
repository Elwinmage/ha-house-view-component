// Simple plan builder: levels of rectangular rooms, doors and windows on their sides, a roof.
// The builder model is kept inside the scene (scene.builder) so that the plan can be edited again; the scene is
// generated from it with the same generic format as the Sweet Home 3D importer (see engine/scene-model.js).
//
// Builder model (meters, x = east, z = south, a room is given by its north-west corner on the wall axes):
//   { version: 1, roof: 'auto' | 'gable' | 'flat', north: deg,
//     levels:   [{ id, name, height }],                       // from the lowest to the highest
//     rooms:    [{ id, level, name, area?, x, z, w, d }],      // w along x (east), d along z (south)
//     openings: [{ id, room, side: 'n'|'e'|'s'|'w', pos, type: 'window'|'patio'|'door', width, height, sill }] }
// `pos` is the distance from the start of the side (west end of n / s, north end of e / w) to the centre of the opening.
import { SLAB_T, WALL_T } from './engine/scene-data.js';
import { buildWallSegments, centroid } from './engine/geometry.js';

export const GRID = 0.05; // positions and sizes are rounded to 5 cm
export const SNAP = 0.3; // an edge closer than this to an edge of another room sticks to it
export const OPENING_DEFAULTS = {
  window: { width: 1.2, height: 1.25, sill: 0.95 },
  patio: { width: 2.4, height: 2.15, sill: 0 },
  door: { width: 0.9, height: 2.1, sill: 0 },
};
const TILE = /cuisine|kitchen|salle de bain|sdb|bain|bath|douche|shower|wc|toilet|buanderie|laundry|cellier|garage|entree|hall/;

const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const slug = (s) =>
  strip(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const round = (v, g = GRID) => Math.round(v / g) * g;
const fix = (v) => Math.round(v * 1000) / 1000;

export function emptyBuilder(levelName = 'Rez-de-chaussée') {
  return { version: 1, roof: 'auto', north: 0, levels: [{ id: 'L0', name: levelName, height: 2.5 }], rooms: [], openings: [] };
}

/** A copy of a builder model with missing fields filled (an older or hand-made one stays usable). */
export function normalizeBuilder(b) {
  const out = { ...emptyBuilder(), ...structuredClone(b || {}) };
  if (!Array.isArray(out.levels) || !out.levels.length) out.levels = emptyBuilder().levels;
  out.levels = out.levels.map((l, i) => ({
    id: l.id || `L${i}`,
    name: l.name || `Niveau ${i}`,
    height: +l.height > 1.5 ? +l.height : 2.5,
  }));
  const levelIds = new Set(out.levels.map((l) => l.id));
  out.rooms = (out.rooms || []).filter((r) => levelIds.has(r.level) && r.w > 0 && r.d > 0);
  const roomIds = new Set(out.rooms.map((r) => r.id));
  out.openings = (out.openings || []).filter((o) => roomIds.has(o.room) && 'nesw'.includes(o.side) && o.side.length === 1);
  if (!['auto', 'gable', 'flat'].includes(out.roof)) out.roof = 'auto';
  out.north = Number.isFinite(+out.north) ? +out.north : 0;
  return out;
}

const nextId = (list, prefix) => {
  let n = list.length + 1;
  while (list.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

/** Corners of a room, clockwise seen from above (north-west first). */
export const roomPoly = (r) => [
  [r.x, r.z],
  [r.x + r.w, r.z],
  [r.x + r.w, r.z + r.d],
  [r.x, r.z + r.d],
];

/** Length of a side of a room. */
export const sideLength = (r, side) => (side === 'n' || side === 's' ? r.w : r.d);

/** Point of the plan at `pos` along a side of a room (on the wall axis). */
export function sidePoint(r, side, pos) {
  if (side === 'n') return [r.x + pos, r.z];
  if (side === 's') return [r.x + pos, r.z + r.d];
  if (side === 'w') return [r.x, r.z + pos];
  return [r.x + r.w, r.z + pos];
}

/** Closest side of a room to a point of the plan: { side, pos, dist } (pos kept inside the side). */
export function nearestSide(r, p) {
  const c = [
    { side: 'n', pos: p[0] - r.x, dist: Math.abs(p[1] - r.z) },
    { side: 's', pos: p[0] - r.x, dist: Math.abs(p[1] - r.z - r.d) },
    { side: 'w', pos: p[1] - r.z, dist: Math.abs(p[0] - r.x) },
    { side: 'e', pos: p[1] - r.z, dist: Math.abs(p[0] - r.x - r.w) },
  ].map((s) => ({ ...s, pos: Math.min(Math.max(s.pos, 0), sideLength(r, s.side)) }));
  return c.reduce((a, b) => (b.dist < a.dist ? b : a));
}

/**
 * Room moved or resized to (x, z, w, d): rounded to the grid, and each edge close to an edge of another room of the
 * same level sticks to it (rooms side by side share their wall). `fixed` lists the edges that must not move while
 * resizing ('x0', 'x1', 'z0', 'z1'); none while moving: the room then keeps its size.
 */
export function snapRoom(b, room, x, z, w, d, fixed = null) {
  const others = b.rooms.filter((r) => r.level === room.level && r.id !== room.id);
  const xs = others.flatMap((r) => [r.x, r.x + r.w]);
  const zs = others.flatMap((r) => [r.z, r.z + r.d]);
  const near = (v, list) => {
    let best = null;
    for (const c of list) if (Math.abs(c - v) <= SNAP && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
    return best;
  };
  let x0 = round(x);
  let z0 = round(z);
  let x1 = round(x + w);
  let z1 = round(z + d);
  if (!fixed) {
    // moving: the closest snap of either edge wins, the size stays
    const dx = [near(x, xs) !== null ? near(x, xs) - x : null, near(x + w, xs) !== null ? near(x + w, xs) - (x + w) : null].filter(
      (v) => v !== null,
    );
    const dz = [near(z, zs) !== null ? near(z, zs) - z : null, near(z + d, zs) !== null ? near(z + d, zs) - (z + d) : null].filter(
      (v) => v !== null,
    );
    const sx = dx.length ? dx.reduce((a, c) => (Math.abs(c) < Math.abs(a) ? c : a)) : null;
    const sz = dz.length ? dz.reduce((a, c) => (Math.abs(c) < Math.abs(a) ? c : a)) : null;
    x0 = sx !== null ? fix(x + sx) : round(x);
    z0 = sz !== null ? fix(z + sz) : round(z);
    return { x: x0, z: z0, w: fix(w), d: fix(d) };
  }
  if (!fixed.includes('x0')) x0 = near(x, xs) ?? x0;
  if (!fixed.includes('x1')) x1 = near(x + w, xs) ?? x1;
  if (!fixed.includes('z0')) z0 = near(z, zs) ?? z0;
  if (!fixed.includes('z1')) z1 = near(z + d, zs) ?? z1;
  const min = 0.5;
  if (x1 - x0 < min) fixed.includes('x0') ? (x1 = x0 + min) : (x0 = x1 - min);
  if (z1 - z0 < min) fixed.includes('z0') ? (z1 = z0 + min) : (z0 = z1 - min);
  return { x: fix(x0), z: fix(z0), w: fix(x1 - x0), d: fix(z1 - z0) };
}

/** Adds a room to a level, against the east side of the last room of that level (or at the origin). Returns it. */
export function addRoom(b, level, name = '', size = [4, 3.5]) {
  const same = b.rooms.filter((r) => r.level === level);
  const last = same[same.length - 1];
  // on an upper level with no room yet, start over the rooms of the level below
  const lvIdx = b.levels.findIndex((l) => l.id === level);
  const below = !last && lvIdx > 0 ? b.rooms.filter((r) => r.level === b.levels[lvIdx - 1].id) : [];
  const ref = last || below[0];
  const room = {
    id: nextId(b.rooms, 'r'),
    level,
    name: name || `Pièce ${b.rooms.length + 1}`,
    x: last ? fix(last.x + last.w) : ref ? ref.x : 0,
    z: ref ? ref.z : 0,
    w: size[0],
    d: size[1],
  };
  b.rooms.push(room);
  return room;
}

/** Copies the rooms of a level to a new level on top (same outline, rooms renamed later). Returns the new level. */
export function addLevel(b, name, copyFrom = null) {
  const lv = { id: nextId(b.levels, 'L'), name, height: 2.5 };
  b.levels.push(lv);
  // the copies are named after the new level: the rooms below keep their Home Assistant areas
  if (copyFrom)
    for (const r of b.rooms.filter((x) => x.level === copyFrom))
      b.rooms.push({ ...r, id: nextId(b.rooms, 'r'), level: lv.id, name: `${r.name} (${name})`, area: undefined });
  return lv;
}

export function removeRoom(b, id) {
  b.rooms = b.rooms.filter((r) => r.id !== id);
  b.openings = b.openings.filter((o) => o.room !== id);
}

export function removeLevel(b, id) {
  if (b.levels.length < 2) return;
  for (const r of b.rooms.filter((x) => x.level === id)) removeRoom(b, r.id);
  b.levels = b.levels.filter((l) => l.id !== id);
}

/** Adds a door or a window on a side of a room, centred at `pos` (middle of the side by default). Returns it. */
export function addOpening(b, room, side, type = 'window', pos = null) {
  const def = OPENING_DEFAULTS[type] || OPENING_DEFAULTS.window;
  const len = sideLength(room, side);
  const width = Math.min(def.width, Math.max(len - 0.2, 0.4));
  const o = {
    id: nextId(b.openings, 'o'),
    room: room.id,
    side,
    pos: fix(Math.min(Math.max(round(pos ?? len / 2), width / 2), len - width / 2)),
    type,
    ...def,
    width,
  };
  b.openings.push(o);
  return o;
}

/** Elevation of the floor of each level: { [levelId]: y } (slabs between levels). */
export function levelElevations(b) {
  const out = {};
  let y = 0;
  for (const l of b.levels) {
    out[l.id] = fix(y);
    y += l.height + SLAB_T;
  }
  return out;
}

/** One ceiling light per room, lit by the lights of its Home Assistant area. `levels`: [{ id, elevation, height, rooms }]. */
export function ceilingLights(levels) {
  const lights = [];
  for (const lv of levels)
    for (const r of lv.rooms) {
      const c = centroid(r.poly);
      const xs = r.poly.map((p) => p[0]);
      const zs = r.poly.map((p) => p[1]);
      lights.push({
        id: `light_${r.id}`,
        name: r.name,
        level: lv.id,
        room: r.id,
        kind: 'pendant',
        pos: [fix(c[0]), fix(lv.elevation + lv.height - 0.35), fix(c[1])],
        color: '#ffe1b8',
        brightness: 0.9,
        on: true,
        radius: fix(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 3)),
      });
    }
  return lights;
}

/**
 * Scene from levels of room polygons: walls follow the room outlines (one wall where two rooms touch), each room gets
 * a ceiling light (lit by the lights of its Home Assistant area), openings sit on the walls.
 *   plan = { name, levels: [{ id, name, elevation, height, rooms: [{ id, name, area?, poly }] }],
 *            openings: [{ level, type, at, width, sill, height, room, name? }], latitude, north, roof? }
 */
export function sceneFromPlan(plan) {
  const levels = plan.levels.map((lv) => {
    const rooms = lv.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area || slug(r.name) || r.id,
      floor: TILE.test(strip(r.name)) ? '#cfcfc8' : '#b99a6b',
      temp: null,
      poly: r.poly.map((p) => [fix(p[0]), fix(p[1])]),
    }));
    const walls = buildWallSegments(rooms).map((s) => ({
      a: s.a,
      b: s.b,
      thickness: WALL_T,
      height: lv.height,
      exterior: s.exterior,
      joinStart: true,
      joinEnd: true,
    }));
    return { id: lv.id, name: lv.name, elevation: lv.elevation, floorThickness: SLAB_T, height: lv.height, rooms, walls };
  });
  const scene = {
    name: plan.name || 'Plan',
    site: { latitude: Number.isFinite(plan.latitude) ? plan.latitude : 45, northOffsetDeg: plan.north || 0 },
    levels,
    openings: plan.openings || [],
    lights: ceilingLights(levels),
    furniture: [],
    vegetation: [],
    outdoor: [],
  };
  const top = levels[levels.length - 1];
  if (plan.roof === 'flat' && top)
    scene.roof = { type: 'flat', polys: top.rooms.map((r) => r.poly), y: fix(top.elevation + top.height), thickness: 0.2 };
  else if (plan.roof === 'gable' && top && top.rooms.length) {
    const xs = top.rooms.flatMap((r) => r.poly.map((p) => p[0]));
    const zs = top.rooms.flatMap((r) => r.poly.map((p) => p[1]));
    const fp = {
      x0: Math.min(...xs) - WALL_T / 2,
      z0: Math.min(...zs) - WALL_T / 2,
      x1: Math.max(...xs) + WALL_T / 2,
      z1: Math.max(...zs) + WALL_T / 2,
    };
    const bw = fp.x1 - fp.x0;
    const bd = fp.z1 - fp.z0;
    scene.roof = {
      type: 'gable',
      fp,
      eaveY: fix(top.elevation + top.height),
      ridgeH: fix(Math.min(Math.max(Math.min(bw, bd) * 0.28, 1.2), 3.2)),
      overhang: 0.5,
      axis: bw >= bd ? 'x' : 'z',
    };
  }
  return scene;
}

/** Scene of a builder model (with the model kept in scene.builder). `latitude`: of the home. */
export function builderScene(model, latitude) {
  const b = normalizeBuilder(model);
  const elev = levelElevations(b);
  const roomsById = Object.fromEntries(b.rooms.map((r) => [r.id, r]));
  const plan = {
    name: 'Plan',
    latitude,
    north: b.north,
    roof: b.roof,
    levels: b.levels.map((l) => ({
      id: l.id,
      name: l.name,
      elevation: elev[l.id],
      height: l.height,
      rooms: b.rooms.filter((r) => r.level === l.id).map((r) => ({ id: r.id, name: r.name, area: r.area, poly: roomPoly(r) })),
    })),
    openings: b.openings.map((o) => {
      const r = roomsById[o.room];
      return {
        level: r.level,
        type: o.type,
        at: sidePoint(r, o.side, o.pos).map(fix),
        width: o.width,
        sill: o.sill,
        height: o.height,
        room: r.id,
        name: o.type,
      };
    }),
  };
  const scene = sceneFromPlan(plan);
  scene.builder = b;
  return scene;
}

/** Count of what a builder model holds, for the report shown after a change. */
export function builderReport(b) {
  const n = (t) => b.openings.filter((o) => o.type === t).length;
  return {
    counts: { niveaux: b.levels.length, pièces: b.rooms.length, fenêtres: n('window') + n('patio'), portes: n('door') },
    warnings: [],
  };
}

/** { x, z, w, d } of an axis-aligned rectangle given as 4 points (any order), or null. */
export function rectOf(poly) {
  if (!poly || poly.length !== 4) return null;
  const xs = [...new Set(poly.map((p) => fix(p[0])))];
  const zs = [...new Set(poly.map((p) => fix(p[1])))];
  if (xs.length !== 2 || zs.length !== 2) return null;
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, z, w: fix(Math.max(...xs) - x), d: fix(Math.max(...zs) - z) };
}

/**
 * Builder model of levels of rooms ({ name, rooms: [{ name, poly }] }) when every room is an axis-aligned rectangle
 * (it can then be edited in the builder), or null. Rooms are rounded to the grid.
 */
export function builderFromLevels(levels, levelName = 'Rez-de-chaussée') {
  const b = emptyBuilder(levelName);
  b.levels = levels.map((l, i) => ({ id: `L${i}`, name: l.name || (i ? `Niveau ${i}` : levelName), height: 2.5 }));
  for (const [i, l] of levels.entries())
    for (const r of l.rooms) {
      const q = rectOf(r.poly);
      if (!q) return null;
      b.rooms.push({
        id: nextId(b.rooms, 'r'),
        level: `L${i}`,
        name: r.name || `Pièce ${b.rooms.length + 1}`,
        x: round(q.x),
        z: round(q.z),
        w: Math.max(round(q.w), 0.5),
        d: Math.max(round(q.d), 0.5),
      });
    }
  return b.rooms.length ? b : null;
}

/** Scene of levels of room polygons in meters (SVG, robot map), all at 2.5 m high. */
export function sceneFromLevels(levels, latitude, levelName = 'Rez-de-chaussée') {
  let y = 0;
  return sceneFromPlan({
    latitude,
    levels: levels.map((l, i) => {
      const lv = {
        id: `L${i}`,
        name: l.name || (i ? `Niveau ${i}` : levelName),
        elevation: fix(y),
        height: 2.5,
        rooms: l.rooms.map((r, j) => ({ id: `r${i}_${j + 1}`, name: r.name || `Pièce ${j + 1}`, poly: r.poly })),
      };
      y += 2.5 + SLAB_T;
      return lv;
    }),
  });
}
