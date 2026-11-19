// The picture a robot vacuum draws of the floor, laid over the plan to line the two up (settings of the vacuum).
//
// Two cases:
//  - the map entity gives calibration points, pairs of robot coordinates and picture pixels (the format of the Xiaomi
//    map extractors, also given by "Roborock Custom Map", Dreame, Valetudo...): every pixel has robot coordinates,
//    so the picture follows the conversion of the robot itself (dock, rotation, mirror);
//  - it does not (the image entities of the Roborock integration of Home Assistant): the picture is pinned on the
//    dock by the pixel that shows the dock, sized by the size of a pixel, and turned by the same rotation.
// In both cases turning the picture until its walls follow those of the plan gives the rotation of the robot.
import { robotToPlan } from './vacuum.js';

export const MAP_DEFAULTS = {
  entity: '', // image or camera entity; empty: the first one of the vacuum's device
  opacity: 0.6,
  res: 0.05, // meters per pixel (picture placed by hand); robots map the floor in 5 cm cells
  pin: null, // [u, v]: pixel that sits on the dock (picture placed by hand); null: the middle of the picture
};

/** Meters per pixel of the pictures drawn by an integration (Roborock draws each 5 cm cell on 4 pixels). */
const PLATFORM_RES = { roborock: 0.0125 };

/** Settings of the picture with the defaults filled in. `platform`: integration of the vacuum. */
export function mapSettings(v, platform = '') {
  return { ...MAP_DEFAULTS, res: PLATFORM_RES[platform] || MAP_DEFAULTS.res, ...((v && v.map) || {}) };
}

const point = (o) => o && Number.isFinite(+o.x) && Number.isFinite(+o.y);

/**
 * Least-squares affine map from picture pixels to robot coordinates, out of calibration points
 * [{ vacuum: { x, y }, map: { x, y } }, ...] (three or more, not on a line); null when they cannot be used.
 */
export function affineFromCalibration(points) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && point(p.vacuum) && point(p.map));
  if (pts.length < 3) return null;
  // pixels counted from their mean: the sums stay small, the solution stays exact
  const mu = pts.reduce((a, p) => a + +p.map.x, 0) / pts.length;
  const mv = pts.reduce((a, p) => a + +p.map.y, 0) / pts.length;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  const s = { x: [0, 0, 0], y: [0, 0, 0] }; // sums of u*X, v*X, X (and the same for Y)
  for (const p of pts) {
    const u = +p.map.x - mu;
    const v = +p.map.y - mv;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    for (const k of ['x', 'y']) {
      s[k][0] += u * +p.vacuum[k];
      s[k][1] += v * +p.vacuum[k];
      s[k][2] += +p.vacuum[k];
    }
  }
  const det = suu * svv - suv * suv;
  if (!(det > 1e-9 * Math.max(suu * svv, 1))) return null; // every point on one line
  const fit = ([su, sv, sum]) => {
    const a = (su * svv - sv * suv) / det;
    const b = (sv * suu - su * suv) / det;
    return [a, b, sum / pts.length - a * mu - b * mv];
  };
  const [ax, bx, cx] = fit(s.x);
  const [ay, by, cy] = fit(s.y);
  return { ax, bx, cx, ay, by, cy };
}

/** Calibration of a map entity read from its attributes: affine pixel -> robot coordinates, or null. */
export function calibrationOf(attrs) {
  return attrs ? affineFromCalibration(attrs.calibration_points) : null;
}

export function pixelToRobot(calib, u, v) {
  return { x: calib.ax * u + calib.bx * v + calib.cx, y: calib.ay * u + calib.by * v + calib.cy };
}

const turn = (v) => {
  const a = ((v.rot || 0) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
};

/**
 * Plan position [x, z] of pixel (u, w) of the picture.
 * v: settings of the vacuum (dock, origin, rot, flip, scale); m: settings of the picture (mapSettings);
 * size: { w, h } of the picture; calib: calibration of the entity or null; charger: robot coordinates of the dock
 * when the position source gives them. null while the dock is not placed (with a calibration: also while the robot
 * coordinates of the dock are unknown).
 */
export function pixelToPlan(v, m, size, calib, u, w, charger = null) {
  if (!v.dock || !v.dock.at) return null;
  if (calib) return robotToPlan(v, pixelToRobot(calib, u, w), charger);
  const pin = m.pin || [size.w / 2, size.h / 2];
  // pixels go right and down like the plan; a robot counts its y upwards, hence the same mirror as its positions
  const dx = (u - pin[0]) * m.res;
  const dy = (w - pin[1]) * m.res * (v.flip === false ? -1 : 1);
  const [c, s] = turn(v);
  return [v.dock.at[0] + dx * c - dy * s, v.dock.at[1] + dx * s + dy * c];
}

/** Corners of the picture on the plan, for its pixels (0, 0), (w, 0), (w, h) and (0, h); null when it cannot be placed. */
export function mapCorners(v, m, size, calib, charger = null) {
  if (!size || !(size.w > 0) || !(size.h > 0)) return null;
  const corners = [
    [0, 0],
    [size.w, 0],
    [size.w, size.h],
    [0, size.h],
  ].map(([u, w]) => pixelToPlan(v, m, size, calib, u, w, charger));
  return corners.every(Boolean) ? corners : null;
}

/** Pixel [u, w] of a picture placed by hand that lies under plan point `at`; null while the dock is not placed. */
export function planToPixel(v, m, size, at) {
  if (!v.dock || !v.dock.at || !(m.res > 0)) return null;
  const pin = m.pin || [size.w / 2, size.h / 2];
  const tx = at[0] - v.dock.at[0];
  const tz = at[1] - v.dock.at[1];
  const [c, s] = turn(v);
  const dx = tx * c + tz * s;
  const dy = -tx * s + tz * c;
  return [pin[0] + dx / m.res, pin[1] + (dy / m.res) * (v.flip === false ? -1 : 1)];
}
