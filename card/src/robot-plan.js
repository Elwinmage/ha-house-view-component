// A first plan out of the rooms a robot vacuum has mapped: the map extractors (Xiaomi Cloud Map Extractor,
// Roborock Custom Map…) give, on their map entity, the rooms of the robot (rectangles, sometimes outlines) in robot
// coordinates (mm) and calibration points. The rooms are laid out as they look on the picture of the map (north is
// wherever the robot's picture puts it: the registration on the terrain turns the plan afterwards).
import { affineFromCalibration } from './vacuum-map.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Rooms listed by a map entity: [{ id, name, poly (robot units) }]. */
export function robotRooms(attrs) {
  const raw = attrs && attrs.rooms;
  if (!raw || typeof raw !== 'object') return [];
  const list = Array.isArray(raw) ? raw.map((r, i) => [r.id ?? i + 1, r]) : Object.entries(raw);
  const out = [];
  for (const [id, r] of list) {
    if (!r || typeof r !== 'object') continue;
    let poly = null;
    if (Array.isArray(r.outline) && r.outline.length >= 3) poly = r.outline.map((p) => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.y]));
    else if ([r.x0, r.y0, r.x1, r.y1].every((v) => Number.isFinite(+v)) && +r.x1 !== +r.x0 && +r.y1 !== +r.y0)
      poly = [
        [+r.x0, +r.y0],
        [+r.x1, +r.y0],
        [+r.x1, +r.y1],
        [+r.x0, +r.y1],
      ];
    if (poly && poly.every((p) => p.every(Number.isFinite))) out.push({ id: String(id), name: r.name ? String(r.name) : '', poly });
  }
  return out;
}

/**
 * Rooms in meters, laid out like the picture of the map (x to the right, z down), starting at (0, 0).
 * Without calibration points: robot millimetres, robot y pointing up on the picture.
 */
export function robotPlanRooms(attrs, name = (i) => `Pièce ${i}`) {
  const rooms = robotRooms(attrs);
  if (!rooms.length) return [];
  const cal = affineFromCalibration(attrs.calibration_points);
  let to = (p) => [p[0] / 1000, -p[1] / 1000];
  if (cal) {
    // pixel -> robot is A·[u v] + c: robot -> pixel is A⁻¹, a pixel being sqrt|det A| robot units (mm)
    const det = cal.ax * cal.by - cal.bx * cal.ay;
    if (Math.abs(det) > 1e-12) {
      const k = Math.sqrt(Math.abs(det)) / 1000 / det;
      to = (p) => [(cal.by * p[0] - cal.bx * p[1]) * k, (-cal.ay * p[0] + cal.ax * p[1]) * k];
    }
  }
  const out = rooms.map((r, i) => ({ name: r.name || name(i + 1), poly: r.poly.map(to) }));
  const pts = out.flatMap((r) => r.poly);
  const x0 = Math.min(...pts.map((p) => p[0]));
  const z0 = Math.min(...pts.map((p) => p[1]));
  return out.map((r) => ({ ...r, poly: r.poly.map((p) => [r3(p[0] - x0), r3(p[1] - z0)]) }));
}

/** Map entities of the home that list rooms: [{ entity, name, count }]. */
export function robotMapsWithRooms(states) {
  return Object.entries(states || {})
    .filter(([id, st]) => /^(image|camera)\./.test(id) && st && robotRooms(st.attributes).length)
    .map(([id, st]) => ({
      entity: id,
      name: (st.attributes && st.attributes.friendly_name) || id,
      count: robotRooms(st.attributes).length,
    }));
}
