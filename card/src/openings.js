// Doors and windows of the plan linked to Home Assistant: an open/closed contact (binary_sensor), a window opener
// (cover moving the window itself, or the motor of a garage door) and a roller shutter (cover). Pure functions, no
// HA / DOM / three knowledge.

/** Link kinds of an opening and the domains of their entities. */
export const OPENING_LINKS = { contact: ['binary_sensor'], opener: ['cover'], shutter: ['cover'] };

/** Stable id of an opening of the plan: level and position to the decimetre (survives a re-import of the plan). */
export function openingKey(o) {
  return `${o.level}:${Math.round(o.at[0] * 10)}:${Math.round(o.at[1] * 10)}`;
}

/** Windows and patio doors: glass, possibly with a shutter. */
export function isGlazed(o) {
  return o.type === 'window' || o.type === 'patio';
}

/**
 * How a garage door opens:
 * - `sectional`: panels hinged together that run up the rails and lie flat under the ceiling (the common one);
 * - `tilt`: one rigid panel that swings out and up (up-and-over);
 * - `roller`: a curtain of slats that winds into its drum over the lintel;
 * - `swing`: two leaves hinged on the sides, opening outward;
 * - `slide`: one panel running sideways along the inner wall;
 * - `folding`: narrow panels folding against one side like an accordion.
 */
export const GARAGE_KINDS = ['sectional', 'tilt', 'roller', 'swing', 'slide', 'folding'];

/**
 * Is this opening a garage door? The plan says so when it can (a wide door named after a garage), and the user may
 * say so themselves: `garage: true` makes one of a door the plan read as ordinary, `garage: false` takes it back.
 */
export function isGarage(o, manual) {
  if (manual && manual.garage !== undefined) return !!manual.garage;
  return o.type === 'garage';
}

/** Which way it opens: what the user chose, else panels under the ceiling. */
export function garageKind(manual) {
  const k = manual && manual.kind;
  return GARAGE_KINDS.includes(k) ? k : GARAGE_KINDS[0];
}

const WINDOW_CONTACTS = ['window'];
const DOOR_CONTACTS = ['door', 'garage_door'];
const NOT_SHUTTERS = ['window', 'door', 'garage', 'gate', 'damper', 'curtain'];

const classOf = (st) => (st && st.attributes && st.attributes.device_class) || null;

/**
 * Links found on their own: a room with a single window gets the window contact, the window opener and the roller
 * shutter of its HA area when there is exactly one of each; a room with a single door gets the door contact.
 * `areaOfRoom(roomId)` -> area id; `areaOf(entityId)` -> area id. Returns { openingKey: { contact?, opener?, shutter? } }.
 */
export function autoOpeningLinks(openings, states, registry, areaOfRoom, areaOf) {
  const byArea = new Map();
  for (const id of Object.keys(states)) {
    const dom = id.split('.')[0];
    if (dom !== 'binary_sensor' && dom !== 'cover') continue;
    const reg = registry && registry[id];
    if (reg && (reg.hidden || reg.hidden_by || reg.entity_category)) continue;
    const area = areaOf(id);
    if (!area) continue;
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(id);
  }
  const single = (list) => (list.length === 1 ? list[0] : null);
  const out = {};
  const rooms = new Map();
  for (const o of openings) {
    if (!o.room) continue;
    if (!rooms.has(o.room)) rooms.set(o.room, []);
    rooms.get(o.room).push(o);
  }
  for (const [room, ops] of rooms) {
    const area = areaOfRoom(room);
    const ids = (area && byArea.get(area)) || [];
    if (!ids.length) continue;
    const contacts = (classes) =>
      ids.filter((id) => id.startsWith('binary_sensor.') && (classes.includes(classOf(states[id])) || classOf(states[id]) === 'opening'));
    const windows = ops.filter(isGlazed);
    if (windows.length === 1) {
      const covers = ids.filter((id) => id.startsWith('cover.'));
      const link = {
        contact: single(contacts(WINDOW_CONTACTS)),
        opener: single(covers.filter((id) => classOf(states[id]) === 'window')),
        shutter: single(covers.filter((id) => !NOT_SHUTTERS.includes(classOf(states[id])))),
      };
      const kept = Object.fromEntries(Object.entries(link).filter(([, v]) => v));
      if (Object.keys(kept).length) out[openingKey(windows[0])] = kept;
    }
    const doors = ops.filter((o) => o.type === 'door');
    const garages = ops.filter((o) => o.type === 'garage');
    if (doors.length === 1) {
      // where a garage door is drawn too, the sensor of that one is left to it
      const c = single(contacts(garages.length ? ['door'] : DOOR_CONTACTS));
      if (c) out[openingKey(doors[0])] = { contact: c };
    }
    // a garage with a single door takes the cover of its area that says it is a garage door, and its contact
    if (garages.length === 1) {
      const link = {
        contact: single(contacts(doors.length ? ['garage_door'] : DOOR_CONTACTS)),
        opener: single(ids.filter((id) => id.startsWith('cover.') && classOf(states[id]) === 'garage')),
      };
      const kept = Object.fromEntries(Object.entries(link).filter(([, v]) => v));
      if (Object.keys(kept).length) out[openingKey(garages[0])] = kept;
    }
  }
  return out;
}

/** Links of an opening: the ones set by hand win over the automatic ones, an empty one ('') removes it. */
export function openingLinks(auto, manual) {
  const res = {};
  for (const k of Object.keys(OPENING_LINKS)) {
    const v = manual && manual[k] !== undefined ? manual[k] : auto && auto[k];
    if (v) res[k] = v;
  }
  return res;
}

/**
 * State of an opening for the 3D view: { open: 0..1 (leaf opening), shutter: closed fraction 0..1 or null without
 * shutter, moving: the shutter is moving }.
 */
export function openingState(links, states) {
  const l = links || {};
  let open = 0;
  const c = l.contact && states[l.contact];
  if (c && c.state === 'on') open = 1;
  const o = l.opener && states[l.opener];
  if (o) {
    const pos = o.attributes && o.attributes.current_position;
    open = Math.max(open, Number.isFinite(pos) ? pos / 100 : o.state === 'open' || o.state === 'opening' ? 1 : 0);
  }
  let shutter = null;
  let moving = false;
  const s = l.shutter && states[l.shutter];
  if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
    const pos = s.attributes && s.attributes.current_position;
    shutter = Number.isFinite(pos) ? 1 - pos / 100 : s.state === 'closed' ? 1 : 0;
    moving = s.state === 'opening' || s.state === 'closing';
  }
  return { open, shutter, moving };
}

/**
 * States of every linked opening: { key: openingState }. A garage door is there even when nothing is linked to it,
 * with the way it opens, because its panel is drawn whether it moves or not.
 */
export function openingStates(openings, auto, manual, states) {
  const res = {};
  for (const o of openings) {
    const key = openingKey(o);
    const mine = manual && manual[key];
    const links = openingLinks(auto[key], mine);
    const garage = isGarage(o, mine);
    if (!garage && !Object.keys(links).length) continue;
    res[key] = openingState(links, states);
    if (garage) res[key].garage = garageKind(mine);
  }
  return res;
}
