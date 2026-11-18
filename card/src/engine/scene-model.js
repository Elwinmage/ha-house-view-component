// Generic scene format shared by the demo scene and the Sweet Home 3D importer.
//
//   { name,
//     site:      { latitude, northOffsetDeg, center?, plot?, pool?, deck?, path?, fence? },
//     levels:    [{ id, name, elevation, floorThickness, height,
//                   rooms: [{ id, name, area, floor, temp, poly, inset, noFloor }],
//                   walls: [{ a, b, thickness, height, exterior, joinStart, joinEnd }] }],
//     openings:  [{ level, type, at, width, sill, height, room }],
//     lights:    [{ id, name, level, room, kind, pos, color, brightness, on, radius }],
//     outdoor: [{ id, name, at, rot, size, elevation, color }],  // detached objects anchored to the terrain
//     furniture: [{ kind, level, at, rot, ... }],      // kind 'box' = generic bounding box
//     vegetation:[{ species, at, length? }],
//     roof?, views? }
//
// Lengths are meters; x = east, z = south (same axes as the Sweet Home 3D plan).
import { WALL_T, LEVEL_H, SLAB_T } from './scene-data.js';
import { buildWallSegments, locateOnEdge } from './geometry.js';

export function deriveWalls(rooms) {
  return buildWallSegments(rooms).map((s) => ({
    a: s.a,
    b: s.b,
    thickness: WALL_T,
    height: LEVEL_H,
    exterior: s.exterior,
    joinStart: true,
    joinEnd: true,
  }));
}

function bboxOf(levels) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const add = (x, z, m = 0) => {
    x0 = Math.min(x0, x - m);
    x1 = Math.max(x1, x + m);
    z0 = Math.min(z0, z - m);
    z1 = Math.max(z1, z + m);
  };
  for (const lv of levels) {
    for (const w of lv.walls) {
      add(w.a[0], w.a[1], w.thickness / 2);
      add(w.b[0], w.b[1], w.thickness / 2);
    }
    for (const r of lv.rooms) for (const p of r.poly) add(p[0], p[1]);
  }
  if (!isFinite(x0)) return { x0: 0, z0: 0, x1: 10, z1: 8 };
  return { x0, z0, x1, z1 };
}

function autoRoof(s) {
  const top = s.levels[s.levels.length - 1];
  const topWalls = top.walls.length ? top.walls : [];
  const wallH = topWalls.length ? Math.max(...topWalls.map((w) => w.height)) : top.height;
  const eaveY = top.elevation + wallH;
  const polys = top.rooms.filter((r) => !r.noFloor).map((r) => r.poly);
  const b = bboxOf([top]);
  const bw = b.x1 - b.x0;
  const bd = b.z1 - b.z0;
  const area = polys.reduce((sum, p) => sum + Math.abs(polyArea(p)), 0);
  if (polys.length && area / (bw * bd) >= 0.82) {
    return {
      type: 'gable',
      fp: { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 },
      eaveY,
      ridgeH: Math.min(Math.max(Math.min(bw, bd) * 0.28, 1.2), 3.2),
      overhang: 0.5,
      axis: bw >= bd ? 'x' : 'z',
    };
  }
  // non-rectangular footprint: flat roof over the rooms of the top level
  const flat = polys.length ? polys : [[[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]];
  return { type: 'flat', polys: flat, y: eaveY, thickness: 0.2 };
}

function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[(i + 1) % p.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

function autoViews(s) {
  const b = s.bbox;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const size = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  const top = s.levels[s.levels.length - 1];
  const totalH = top.elevation + top.height + (s.roof && s.roof.type === 'gable' ? s.roof.ridgeH : 0);
  const zoom = Math.min(Math.max(24 / (size * 1.15 + totalH * 0.6), 0.3), 6);
  const dist = 50 + size;
  const dir = [0.62, 0.58, 0.7];
  const target = [cx, totalH * 0.3, cz];
  const pos = (ty = target[1]) => [cx + dir[0] * dist, ty + dir[1] * dist, cz + dir[2] * dist];
  const all = Object.fromEntries(s.levels.map((l) => [l.id, true]));
  const views = [
    { name: 'Vue générale', pos: pos(), target, zoom, levels: all, roof: true },
    { name: 'Sans toit', pos: pos(), target, zoom: zoom * 1.15, levels: all, roof: false },
  ];
  s.levels.forEach((lv, i) => {
    const vis = Object.fromEntries(s.levels.map((l, j) => [l.id, j <= i]));
    const ty = lv.elevation + 0.5;
    views.push({ name: `${lv.name} (coupe)`, pos: pos(ty), target: [cx, ty, cz], zoom: zoom * 1.35, levels: vis, roof: false });
  });
  views.push({ name: 'Dessus', pos: [cx, 70 + size, cz + 0.01], target: [cx, 0, cz], zoom: zoom * 1.25, levels: all, roof: false });
  return views;
}

/** Fill defaults and derived data. Mutates and returns the scene. */
export function normalizeScene(s) {
  s.levels.sort((a, b) => a.elevation - b.elevation);
  for (const lv of s.levels) {
    lv.floorThickness ??= SLAB_T;
    lv.height ??= LEVEL_H;
    lv.walls ??= deriveWalls(lv.rooms);
    for (const r of lv.rooms) r.inset ??= WALL_T / 2;
  }
  s.openings ??= [];
  s.lights ??= [];
  s.furniture ??= [];
  s.vegetation ??= [];
  s.outdoor ??= [];
  s.bbox ??= bboxOf(s.levels);
  const b = s.bbox;
  s.site = { latitude: 43.6, northOffsetDeg: 0, ...s.site };
  s.site.center ??= [(b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2];
  const m = 9;
  s.site.plot ??= { x0: b.x0 - m, z0: b.z0 - m, x1: b.x1 + m, z1: b.z1 + m };
  s.roof = s.roof === undefined ? autoRoof(s) : s.roof;
  s.views ??= autoViews(s);

  // attach every opening to its closest wall (per level)
  for (const o of s.openings) {
    const lv = s.levels.find((l) => l.id === o.level);
    o._wall = -1;
    if (!lv) continue;
    let best = Infinity;
    lv.walls.forEach((w, i) => {
      const loc = locateOnEdge(w.a, w.b, o.at, w.thickness / 2 + 0.12);
      if (loc && loc.perp < best) {
        best = loc.perp;
        o._wall = i;
      }
    });
  }
  return s;
}
