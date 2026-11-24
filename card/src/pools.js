// Pools, spas and ponds drawn on the ground (top view): outline, colour, depth, height over the ground, a cleaning robot, the lamps
// and a roller cover. Pure helpers, no three / HA knowledge: polygon tests, outline of a rectangle, frame of a side
// of the outline, the wandering of the robot on the bottom, and the reading of the entities of a pool.

// `up`: how high the rim stands over the ground (m). 0 digs the basin in, as a pool is; a spa stands on the
// ground by default, its whole height out, and a value in between sinks it part of the way.
export const POOL_KINDS = {
  pool: { color: '#2a9fd6', depth: 1.5, up: 0 },
  pond: { color: '#3d6b4a', depth: 0.8, up: 0 },
  // a spa is a small basin, drawn with the rectangle tool and then sized to the centimetre (see rectSize)
  spa: { color: '#1f7fa8', depth: 0.9, up: 0.9 },
};

/** Highest a basin may stand over the ground (m). */
export const MAX_UP = 3;

/** Shell of a basin standing over the ground, when none was chosen: the taupe of the usual spa cabinets. */
export const SHELL_COLOR = '#5c5349';

/**
 * Colour of the shell of basin `p`, seen from outside — a real spa is one colour inside, in the water, and
 * another outside, on its cabinet. The coping is the top of that shell, so it takes the same colour.
 */
export function shellOf(p) {
  const c = p && p.shell;
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : SHELL_COLOR;
}

/** How high basin `p` stands over the ground: 0 (dug in, like a pool) to MAX_UP. */
export function standsUp(p) {
  const v = Number(p && p.up);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_UP) : 0;
}

/** Point inside polygon [[x, z], ...] (even-odd rule). */
export function inPolygon(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Closest point of the outline of a closed polygon: { d, px, pz }. */
export function nearestOnOutline(poly, x, z) {
  let best = { d: Infinity, px: x, pz: z };
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz };
  }
  return best;
}

/** Signed area (positive: counter-clockwise in x/z). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function centroidOf(poly) {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

/** Rectangle from two opposite corners (axis aligned in the frame of the points). */
export function rectFromCorners(a, b) {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

/**
 * Length and width of a four-point outline, read in the frame of its first side: { l (along that side), w (across
 * it) }, or null when the outline is not a quadrilateral. A spa is drawn with the rectangle tool, so its size can
 * then be shown and corrected to the centimetre.
 */
export function rectSize(pts) {
  if (!Array.isArray(pts) || pts.length !== 4) return null;
  const e = sideExtent(pts, sideFrame(pts, 0));
  return { l: e.u1 - e.u0, w: Math.abs(e.v1 - e.v0) };
}

/** Shortest side of a basin sized by hand (m). */
export const MIN_SIDE = 0.4;

/**
 * The same rectangle with a new length and width (metres, at least MIN_SIDE): it keeps its middle, its orientation
 * and the order of its sides, so the lamps and the cover stay where they were put.
 */
export function resizeRect(pts, l, w) {
  const f = sideFrame(pts, 0);
  const e = sideExtent(pts, f);
  const cu = (e.u0 + e.u1) / 2;
  const cv = (e.v0 + e.v1) / 2;
  const hu = Math.max(Number(l) || 0, MIN_SIDE) / 2;
  const hv = Math.max(Number(w) || 0, MIN_SIDE) / 2;
  const at = (u, v) => [f.x + f.ux * u + f.nx * v, f.z + f.uz * u + f.nz * v];
  return [at(cu - hu, cv - hv), at(cu + hu, cv - hv), at(cu + hu, cv + hv), at(cu - hu, cv + hv)];
}

/** Prefix of the id of the room that stands for a pool or a pond (see HouseEngine.poolRooms). */
export const POOL_ROOM = 'pool:';

/**
 * Where the editor opens for what is zoomed on in the view (`focus`: the id of a room, of the room standing for a
 * pool, or nothing): { section, pool? }, or null when nothing is selected. A pool or pond opens on its settings, a
 * room on its layer of entities.
 */
export function editTarget(focus, pools) {
  if (!focus) return null;
  if (!focus.startsWith(POOL_ROOM)) return { section: 'entities' };
  const id = focus.slice(POOL_ROOM.length);
  // a pool that is not in the list (drawn by the plan): the list of the pools
  return (pools || []).some((p) => p && p.id === id) ? { section: 'pools', pool: id } : { section: 'pools' };
}

/** Defaults of a pool or pond of kind `kind`. */
export function newPool(kind, id) {
  const k = POOL_KINDS[kind] ? kind : 'pool';
  const d = POOL_KINDS[k];
  return { id, kind: k, shape: 'rect', pts: [], color: d.color, shell: SHELL_COLOR, depth: d.depth, up: d.up, robot: '' };
}

// ---------------------------------------------------------------- entities of a pool

/**
 * Domains offered for the cleaning robot: a robot is seldom a `vacuum`, more often read through its plug (`switch`,
 * and a plug exposed as a `light`), a contact, or the power it draws (`sensor`). Any other entity can still be
 * chosen by typing its id in the picker.
 */
export const ROBOT_DOMAINS = ['binary_sensor', 'switch', 'input_boolean', 'vacuum', 'light', 'fan', 'sensor'];

/** Domains offered for a lamp of the water: a coloured light, or a plug that only switches it on. */
export const LAMP_DOMAINS = ['light', 'switch', 'input_boolean'];

/** Domains offered for the roller cover: a `cover` (with a position), or anything that says open / closed. */
export const COVER_DOMAINS = ['cover', 'switch', 'input_boolean', 'binary_sensor'];

const ON_WORDS = ['on', 'cleaning', 'running', 'active', 'true', 'playing'];

/** The cleaning robot is running: an `on`-like state, or a reading above zero (the power of its plug). */
export function robotRunning(st) {
  if (!st) return false;
  const s = String(st.state).trim().toLowerCase();
  if (ON_WORDS.includes(s)) return true;
  const v = Number(s);
  return Number.isFinite(v) && v > 0;
}

/** Defaults of a lamp of the water: a projector in the wall of side `side`, half way along it, 0.6 m under the rim. */
export function newLamp(id, side = 0) {
  return { id, entity: '', color: '#49e0ff', side, t: 0.5, depth: 0.6 };
}

/** Lamps of a pool that are linked to an entity (the ones the view draws). */
export function lampsOf(p) {
  return (p && Array.isArray(p.lights) ? p.lights : []).filter((l) => l && l.entity);
}

const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const rgbToHex = (rgb) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(Math.max(v, 0), 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/**
 * Light the lamps put in the water: { on, color, level (0..1.3), lamps: { lampId: { on, color, level } } }. The
 * colour of the water is the mean of the lamps that are on; a lamp whose entity has no colour of its own (a plug, a
 * white light) keeps the colour chosen in the editor. `lightOf(entityId)` -> { on, color?, brightness } (see
 * `entityLight` in ha-bridge.js).
 */
export function poolLight(lamps, lightOf) {
  const out = { on: false, color: '#ffffff', level: 0, lamps: {} };
  const lit = [];
  for (const l of lamps) {
    const st = lightOf(l.entity, l.id) || { on: false };
    const color = st.color || l.color || '#49e0ff';
    const level = st.on ? Math.min(Math.max(st.brightness ?? 0.9, 0.15), 1.3) : 0;
    out.lamps[l.id] = { on: !!st.on, color, level };
    if (st.on) lit.push({ color, level });
  }
  if (!lit.length) return out;
  const sum = lit.reduce(
    (acc, l) => {
      const rgb = hexToRgb(l.color);
      return [acc[0] + rgb[0], acc[1] + rgb[1], acc[2] + rgb[2]];
    },
    [0, 0, 0],
  );
  out.on = true;
  out.color = rgbToHex(sum.map((v) => v / lit.length));
  out.level = Math.min(lit.reduce((a, l) => a + l.level, 0) / lit.length, 1.3);
  return out;
}

/** Defaults of the roller cover of a pool: rolled on the deck, at the side `side` of the outline. */
export function newCover(side = 0) {
  return { entity: '', side, color: '#dfe4e8', roller: 'deck', invert: false };
}

/**
 * How far the cover is drawn over the water: { closed (0 = rolled up, 1 = over the whole pool), moving } or null
 * when nothing can be told (no entity, unavailable). A `cover` entity gives its position (Home Assistant: 100 =
 * open); the other domains only say on / off, `on` taken as closed. `invert` swaps the two readings.
 */
export function coverClosed(cfg, st) {
  if (!cfg || !cfg.entity || !st) return null;
  const s = String(st.state).trim().toLowerCase();
  if (s === 'unavailable' || s === 'unknown' || s === '') return null;
  const a = st.attributes || {};
  let closed;
  let moving = false;
  if (cfg.entity.startsWith('cover.')) {
    const pos = a.current_position;
    moving = s === 'opening' || s === 'closing';
    closed = Number.isFinite(pos) ? 1 - pos / 100 : s === 'closed' || s === 'closing' ? 1 : 0;
  } else closed = ON_WORDS.includes(s) ? 1 : 0;
  if (cfg.invert) closed = 1 - closed;
  return { closed: Math.min(Math.max(closed, 0), 1), moving };
}

// ---------------------------------------------------------------- frame of a side of the outline

/**
 * Frame of side `i` of an outline (its index is taken around the outline): { x, z (its first point), ux, uz (along
 * the side), nx, nz (toward the water), len }. A lamp and the cover are placed in that frame, so they follow the
 * outline whatever the frame the points are stored in.
 */
export function sideFrame(poly, i) {
  const n = poly.length;
  const k = ((Math.round(i) % n) + n) % n;
  const [ax, az] = poly[k];
  const [bx, bz] = poly[(k + 1) % n];
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const s = polygonArea(poly) > 0 ? 1 : -1;
  return { x: ax, z: az, ux: dx / len, uz: dz / len, nx: (-s * dz) / len, nz: (s * dx) / len, len };
}

/** Extent of an outline in the frame of one of its sides: { u0, u1, v0, v1 } (v grows toward the water). */
export function sideExtent(poly, f) {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, z] of poly) {
    const u = (x - f.x) * f.ux + (z - f.z) * f.uz;
    const v = (x - f.x) * f.nx + (z - f.z) * f.nz;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { u0, u1, v0, v1 };
}

/** Side of an outline nearest to a point, both in the same frame: its index (0 without an outline). */
export function nearestSide(poly, x, z) {
  let best = 0;
  let near = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1);
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < near) {
      near = d;
      best = i;
    }
  }
  return best;
}

/** Point of side `i` of an outline, `t` (0..1) along it, pushed `inward` metres toward the water: [x, z, frame]. */
export function sidePoint(poly, i, t, inward = 0) {
  const f = sideFrame(poly, i);
  const k = Math.min(Math.max(Number(t) || 0, 0), 1);
  return [f.x + f.ux * f.len * k + f.nx * inward, f.z + f.uz * f.len * k + f.nz * inward, f];
}

/** Islands of a pond with a usable outline: [{ pts, frame }] (same rule as a pool). */
export function islandsOf(p) {
  return (p && Array.isArray(p.islands) ? p.islands : []).filter((i) => poolValid(i));
}

/** A usable pool: at least 3 points and a positive area. */
export function poolValid(p) {
  return !!p && Array.isArray(p.pts) && p.pts.length >= 3 && Math.abs(polygonArea(p.pts)) > 0.05;
}

/**
 * One step of the cleaning robot wandering on the bottom: it goes straight and turns when the wall is near.
 * `r` = { x, z, h (heading, rad) }; `rand()` in [0, 1). Returns the new state.
 */
export function robotStep(poly, r, dt, speed = 0.35, margin = 0.3, rand = Math.random) {
  const tryAt = (h) => {
    const x = r.x + Math.cos(h) * speed * dt;
    const z = r.z + Math.sin(h) * speed * dt;
    return inPolygon(poly, x, z) && nearestOnOutline(poly, x, z).d >= margin ? { x, z, h } : null;
  };
  const ahead = tryAt(r.h);
  if (ahead) return ahead;
  // at the wall: a new direction, roughly back toward the middle
  for (let i = 0; i < 12; i++) {
    const h = r.h + Math.PI * (0.5 + rand());
    const n = tryAt(h);
    if (n) return n;
  }
  // stuck against the wall (or parked too close to it): back toward the middle
  const [cx, cz] = centroidOf(poly);
  const h = Math.atan2(cz - r.z, cx - r.x);
  return { x: r.x + Math.cos(h) * speed * dt, z: r.z + Math.sin(h) * speed * dt, h };
}

/**
 * Rooms that stand for the pools and ponds built in the 3D scene (`items`: { id, pond, poly, rim }), on `level`:
 * { id, name, level, poly, pool, rim }. A pool without a name takes `label(kind)`. The height of the water side is
 * `rim`, never `floor`: on a room of the plan, `floor` is the colour of its floor.
 */
export function poolRoomsOf(items, pools, level, label) {
  return items.map((it) => {
    const p = (pools || []).find((x) => x.id === it.id) || {};
    return {
      id: `${POOL_ROOM}${it.id}`,
      name: p.name || label(POOL_KINDS[p.kind] ? p.kind : it.pond ? 'pond' : 'pool'),
      level,
      poly: it.poly,
      pool: it.id,
      rim: it.rim,
    };
  });
}

/**
 * What the camera frames to show a room: { target: [x, y, z], span } (the point looked at, half a metre above the
 * floor, and the size the view must hold). The floor is the one of the level (`elevation`), or the rim of a pool.
 */
export function roomFocus(room, elevation) {
  const xs = room.poly.map((p) => p[0]);
  const zs = room.poly.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const floor = Number.isFinite(room.rim) ? room.rim : elevation;
  return { target: [(x0 + x1) / 2, floor + 0.5, (z0 + z1) / 2], span: Math.max(x1 - x0, z1 - z0) * 1.25 + 1 };
}
