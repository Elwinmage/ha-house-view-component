// Position of the sun: pure maths shared by the engine (lighting, shadows) and by the tests of what must follow the
// same compass (the wind). No DOM, no three.js.

const DEG = Math.PI / 180;

/**
 * Sun elevation (rad) and unit direction toward the sun, [x, y, z] in the axes of the scene: x to the east and z to
 * the south, turned by the north offset of the plan.
 */
export function sunDirection(doy, hour, latDeg, northOffsetDeg = 0) {
  const lat = latDeg * DEG;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const H = (hour - 12) * 15 * DEG;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinEl)));
  // azimuth measured from the south, positive toward the west
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + northOffsetDeg * DEG;
  const ce = Math.cos(elevation);
  return { elevation, dir: [-Math.sin(az) * ce, Math.sin(elevation), Math.cos(az) * ce] };
}
