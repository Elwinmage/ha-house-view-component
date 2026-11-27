// Manual corrections kept apart from the plan (.sh3d) and the terrain (.json), so that re-importing
// either of them keeps what was fixed by hand. Exported / imported as a small JSON file.

import { normalizeSea } from './sea-3d.js';

export function emptyEdits() {
  return {
    version: 1,
    registration: {}, // plan <-> terrain registration: { base, rot, dx, dz, northOffsetDeg, showMns, showVec, showTrees }
    views: [], // optional user-defined camera views (replace the automatic ones when not empty)
    outdoor: {}, // id -> { dx, dz, dy, rot, hidden }   (detached objects: shed, gate, ...)
    terrain: [], // ground corrections: walls / terraces / brushes, see terrain-edit.js
    fences: [], // { pts (grid frame, closed), h, color, style: mesh|wood|wall, open: [segment index], parcel }
    gates: [], // gates set on the fences: { id, f (fence index), at: [x, z], w, open, fill, top, entity, ... } (see gates.js)
    paths: [], // drives and paths: { id, pts (centre line), frame, w, surface, edge, hidden } (see paths.js)
    // terraces, patios and decks: { id, pts (outline), frame, shape, surface, c, alt, h, feather, rot, hidden } (see terraces.js)
    terraces: [],
    beds: [], // flower beds: { pts (closed polygon), frame, count, colors: [{ c, w }], h, seed, hidden } (see flowerbeds.js)
    // roofs read from the surface model of the terrain (LiDAR): { id, pts (outline), frame, dy, c, name, hidden } (see roofs.js)
    roofs: [],
    // entities placed on the plan (sensors, lights, switches...):
    // { id, entity, at: [x, z], base, y, level, room, scope: general|level|room, display: badge|icon, color, label, icon,
    //   tap: toggle|more-info, kind / radius (lights: fixture and reach of the light source) }
    entities: [],
    room_areas: {}, // explicit room id -> HA area id (overrides the match by name)
    // entities listed on the left while zoomed on a room: room id -> { list: [entity ids], all: every entity of its area }
    room_entities: {},
    openings: {}, // openingKey -> { contact, opener, shutter } set by hand ('' = none)
    sea: null, // the sea or a wide water: { on, level, beach, waves, tide, clarity } (see sea-3d.js)
    pools: [], // drawn pools and ponds: { id, kind, shape, pts, frame, color, depth, robot }
    irrigation: { soil: 'loam', lines: [], circuits: [] }, // drip lines and sprinkler circuits (see irrigation.js)
    // robot vacuums: dock position and calibration of each one (see VAC_DEFAULTS in vacuum.js), `entity` naming it;
    // '' for the settings of the single robot of the first versions, taken by the card's robot
    vacuums: [],
    // general sensors and actuators shown on the left, under the level buttons: { id, entity, label, icon, tap: auto|toggle|more-info|none }
    panel: [],
    // central alarm badge: alarms found by their kind (auto), entities added by hand, entities left out
    alarms: { auto: true, rooms: true, extra: [], ignored: [] },
    // clickable zones: a media player or an aquarium (reeftank), on a piece of furniture or a rectangle drawn on a
    // floor or a wall (see zones.js)
    zones: [],
    room_views: {}, // room id -> camera view used when the room is tapped ({ pos, target, zoom, levels, roof })
    pool: { dy: 0 }, // vertical offset of the pool (basin, water, coping) from the ground
    trees: {
      removed: { dsm: [], sd: [] }, // dsm: [gx, gz] in the terrain grid frame ; sd: index in the plan vegetation
      added: [], // { species, at: [x, z] in plan frame, h }
    },
  };
}

export function normalizeEdits(raw) {
  const e = emptyEdits();
  if (!raw || typeof raw !== 'object') return e;
  if (raw.outdoor && typeof raw.outdoor === 'object') e.outdoor = raw.outdoor;
  if (raw.registration && typeof raw.registration === 'object') e.registration = raw.registration;
  if (Array.isArray(raw.views)) e.views = raw.views;
  if (Array.isArray(raw.terrain)) e.terrain = raw.terrain;
  if (Array.isArray(raw.fences)) e.fences = raw.fences;
  if (Array.isArray(raw.gates)) e.gates = raw.gates.filter((g) => g && typeof g === 'object' && Array.isArray(g.at));
  if (Array.isArray(raw.paths)) e.paths = raw.paths.filter((p) => p && typeof p === 'object' && Array.isArray(p.pts));
  if (Array.isArray(raw.terraces)) e.terraces = raw.terraces.filter((t) => t && typeof t === 'object' && Array.isArray(t.pts));
  if (Array.isArray(raw.beds)) e.beds = raw.beds.filter((b) => b && typeof b === 'object' && Array.isArray(b.pts));
  if (Array.isArray(raw.roofs)) e.roofs = raw.roofs.filter((r) => r && typeof r === 'object' && Array.isArray(r.pts));
  if (Array.isArray(raw.entities)) e.entities = raw.entities;
  else if (Array.isArray(raw.sensors)) e.entities = raw.sensors; // first name of the list (0.2 previews)
  if (raw.room_areas && typeof raw.room_areas === 'object') e.room_areas = raw.room_areas;
  if (raw.room_entities && typeof raw.room_entities === 'object') e.room_entities = raw.room_entities;
  if (raw.openings && typeof raw.openings === 'object' && !Array.isArray(raw.openings)) e.openings = raw.openings;
  e.sea = normalizeSea(raw.sea);
  if (Array.isArray(raw.pools)) e.pools = raw.pools.filter((p) => p && typeof p === 'object' && p.id);
  if (raw.room_views && typeof raw.room_views === 'object') e.room_views = raw.room_views;
  if (raw.irrigation && typeof raw.irrigation === 'object') {
    e.irrigation = { soil: raw.irrigation.soil || 'loam', lines: raw.irrigation.lines || [], circuits: raw.irrigation.circuits || [] };
  }
  if (Array.isArray(raw.vacuums)) e.vacuums = raw.vacuums.filter((v) => v && typeof v === 'object');
  else if (raw.vacuum && typeof raw.vacuum === 'object' && Object.keys(raw.vacuum).length)
    e.vacuums = [{ entity: '', ...raw.vacuum }]; // one robot before: its settings, for the robot of the card
  if (Array.isArray(raw.panel)) e.panel = raw.panel;
  if (Array.isArray(raw.zones)) e.zones = raw.zones;
  if (raw.alarms && typeof raw.alarms === 'object') {
    const a = raw.alarms;
    e.alarms = { auto: a.auto !== false, rooms: a.rooms !== false, extra: Array.isArray(a.extra) ? a.extra : [], ignored: Array.isArray(a.ignored) ? a.ignored : [] };
  }
  if (raw.pool && Number.isFinite(raw.pool.dy)) e.pool.dy = raw.pool.dy;
  const t = raw.trees || {};
  if (t.removed) {
    e.trees.removed.dsm = Array.isArray(t.removed.dsm) ? t.removed.dsm : [];
    e.trees.removed.sd = Array.isArray(t.removed.sd) ? t.removed.sd : [];
  }
  e.trees.added = Array.isArray(t.added) ? t.added : [];
  return e;
}

/** Effective edit of one outdoor object (defaults filled in). */
export function outdoorEdit(edits, id) {
  return { dx: 0, dz: 0, dy: 0, rot: 0, hidden: false, ...(edits.outdoor[id] || {}) };
}

/** True when a DSM tree at grid position (gx, gz) was removed (2 m tolerance: peaks move a little between fetches). */
export function isDsmRemoved(edits, gx, gz) {
  return edits.trees.removed.dsm.some(([x, z]) => Math.hypot(x - gx, z - gz) < 2);
}
