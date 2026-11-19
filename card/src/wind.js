// Wind and rain intensity: pure helpers shared by the Home Assistant bridge (reading the sensors) and by the engine
// (slant, density and speed of what falls). No DOM, no three.js: unit-tested in test/.

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** The sixteen compass points, clockwise from north (22.5 degrees apart). */
const COMPASS = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse', 's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw'];
const WORDS = { north: 'n', east: 'e', south: 's', west: 'w', nord: 'n', est: 'e', sud: 's', ouest: 'o' };
/** Languages where an O is the east (Ost, oost) and not the west (ouest, oeste, ovest). */
const EAST_O = ['de', 'nl'];

/**
 * A wind direction in degrees (0..360, clockwise from north), or null when it cannot be read. Accepts degrees (number
 * or text) and compass points: N, NNE … NNW, "north-west", and the O of the languages that write the west with it
 * (NO, SO, ONO …). `lang` settles that O: east in German and Dutch, west elsewhere.
 */
export function bearingDeg(value, lang = 'en') {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  const v = Number(text.replace(/°$/, '').replace(',', '.'));
  if (Number.isFinite(v)) return ((v % 360) + 360) % 360;
  const o = EAST_O.includes(String(lang).slice(0, 2).toLowerCase()) ? 'e' : 'w';
  const point = text
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => WORDS[w] || w)
    .join('')
    .replace(/o/g, o);
  const i = COMPASS.indexOf(point);
  return i < 0 ? null : i * 22.5;
}

/** One of the eight compass points of a direction, as an index (0 = north, 2 = east …) into a translated list. */
export const compassIndex = (deg) => Math.round(((((deg % 360) + 360) % 360) / 45) % 8) % 8;

/**
 * A wind speed in km/h, or null when it cannot be read (unavailable sensor, negative value). Units of Home Assistant:
 * km/h (default), m/s, mph, kn, ft/s and Beaufort.
 */
export function windKmh(value, unit) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return null;
  const u = String(unit || 'km/h')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (u === 'm/s') return v * 3.6;
  if (u === 'mph' || u === 'mi/h') return v * 1.609344;
  if (u === 'kn' || u === 'kt' || u === 'kts' || u === 'knots') return v * 1.852;
  if (u === 'ft/s') return v * 1.09728;
  if (u === 'bft' || u === 'beaufort') return 0.836 * Math.pow(v, 1.5) * 3.6;
  return v;
}

/** Wind strength of the engine: 0 = calm … 1 = 60 km/h and more. */
export const windStrength = (kmh) => clamp01(kmh / 60);

/**
 * Horizontal drift of what falls, per metre of fall: [x, z] in the axes of the scene. `bearing` is the one of the
 * weather reports: where the wind comes FROM, in degrees clockwise from north. The scene has x to the east and z to
 * the south, turned by the north offset of the plan (same convention as the sun, see sunPosition).
 */
export function windDrift(strength, bearing, northOffsetDeg = 0, gain = 1.2) {
  const a = (bearing + northOffsetDeg) * DEG;
  const k = clamp01(strength) * gain;
  return [-Math.sin(a) * k, Math.cos(a) * k];
}

/**
 * Look of the rain for an intensity 0..1 (0.2 = drizzle … 1 = downpour): share of the drops shown, fall speed and
 * streak length relative to a moderate rain, opacity factor. A drizzle is sparse, slow and short; a downpour is
 * dense, fast and long.
 */
export function rainLook(precip) {
  const p = clamp01(precip);
  return { share: p, speed: 0.65 + 0.6 * p, length: 0.45 + 0.95 * p, alpha: 0.7 + 0.45 * p };
}
