// Central alarm badge: the alarms raised in Home Assistant, found by their kind, plus the entities added by hand,
// minus the ones left out.

/** Kinds of binary sensors that are alarms when on (a door left open or a presence is not). */
export const ALARM_CLASSES = new Set(['problem', 'safety', 'smoke', 'gas', 'carbon_monoxide', 'moisture', 'heat', 'cold', 'tamper']);

/** States that raise an alarm, whatever the domain of the entity. */
const RAISED = new Set(['on', 'triggered', 'problem', 'detected', 'unsafe', 'alarm']);

/** True when entity `st` (a state object) is an alarm by its kind, before any choice of the user. */
export function isAlarmKind(st) {
  if (!st || !st.entity_id) return false;
  const domain = st.entity_id.split('.')[0];
  if (domain === 'alarm_control_panel') return true;
  return domain === 'binary_sensor' && ALARM_CLASSES.has(st.attributes && st.attributes.device_class);
}

/** True when the alarm of `st` is raised. */
export function isRaised(st) {
  if (!st) return false;
  if (st.entity_id.startsWith('alarm_control_panel.')) return st.state === 'triggered';
  return RAISED.has(st.state);
}

/**
 * Alarms of `states` (hass.states) for the settings `cfg` ({ auto, extra, ignored }):
 * { raised: [state], ignored: [state] } — raised alarms counted on the badge, and those raised but left out.
 * Newest first.
 */
export function alarmList(states, cfg) {
  const c = { auto: true, extra: [], ignored: [], ...(cfg || {}) };
  const ignored = new Set(c.ignored);
  const ids = new Set(c.extra.filter((id) => states[id]));
  if (c.auto) for (const [id, st] of Object.entries(states)) if (isAlarmKind(st)) ids.add(id);
  const raised = [];
  const left = [];
  for (const id of ids) {
    const st = states[id];
    if (!isRaised(st)) continue;
    (ignored.has(id) ? left : raised).push(st);
  }
  const newest = (a, b) => String(b.last_changed || '').localeCompare(String(a.last_changed || ''));
  return { raised: raised.sort(newest), ignored: left.sort(newest) };
}

/** Domains a tap toggles; the others open their dialog. */
const TOGGLED = new Set(['switch', 'light', 'input_boolean', 'fan', 'automation', 'siren', 'cover', 'valve']);

/** What a tap on a general entity does: 'toggle' | 'more-info' | 'none' (`tap`: choice of the user, 'auto' by default). */
export function tapAction(entityId, tap) {
  if (tap && tap !== 'auto') return tap;
  return TOGGLED.has(String(entityId).split('.')[0]) ? 'toggle' : 'more-info';
}

/** Centre of a polygon [[x, z], ...] (area-weighted; the mean of its points when it is flat). */
export function polyCentre(poly) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const k = x0 * z1 - x1 * z0;
    a += k;
    cx += (x0 + x1) * k;
    cz += (z0 + z1) * k;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cz / (3 * a)];
}

/**
 * Raised alarms of each room: [{ room, level, pos: [x, y, z], alarms: [state] }], rooms without alarm left out.
 * raised: state objects (alarmList().raised); rooms: [{ id, level, y (floor), poly }]; roomAreas: room id -> area id;
 * areaOf(entityId): area of an entity. A room shares the alarms of its area (with the other rooms of that area).
 */
export function roomAlarms(raised, rooms, roomAreas, areaOf) {
  const byArea = new Map();
  for (const st of raised) {
    const a = areaOf(st.entity_id);
    if (!a) continue;
    if (!byArea.has(a)) byArea.set(a, []);
    byArea.get(a).push(st);
  }
  const out = [];
  for (const r of rooms) {
    const list = byArea.get(roomAreas[r.id]);
    if (!list || !r.poly || r.poly.length < 3) continue;
    const [x, z] = polyCentre(r.poly);
    out.push({ room: r.id, level: r.level, pos: [x, r.y + 0.05, z], alarms: list });
  }
  return out;
}
