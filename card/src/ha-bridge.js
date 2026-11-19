// Pure helpers that turn Home Assistant state into the live data the engine understands.
// No DOM, no three.js: unit-tested in test/.
import { bearingDeg, windKmh, windStrength } from './wind.js';

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** HA weather condition -> engine weather preset. */
export const WEATHER_MAP = {
  sunny: 'clear',
  'clear-night': 'clear',
  partlycloudy: 'clear',
  cloudy: 'cloudy',
  fog: 'fog',
  hail: 'rain',
  lightning: 'storm',
  'lightning-rainy': 'storm',
  pouring: 'rain',
  rainy: 'rain',
  snowy: 'snow',
  'snowy-rainy': 'snow',
  windy: 'cloudy',
  'windy-variant': 'cloudy',
  exceptional: 'cloudy',
};

/** Conditions that say something the preset does not: a downpour, a windy day without a measured speed. */
const POURING = 1;
const WINDY = 0.7;

/**
 * Live weather from a `weather.*` state object. Returns the engine fields (preset + measured overrides): the wind
 * speed in the unit the entity declares (km/h by default) on the engine's 0..1 scale, and where the wind comes from
 * (`wind_bearing`: degrees, or a compass point read in the language `lang`).
 */
export function weatherLive(st, lang = 'en') {
  if (!st) return {};
  const out = {};
  const preset = WEATHER_MAP[st.state];
  if (preset) out.weather = preset;
  const a = st.attributes || {};
  if (st.state === 'partlycloudy') out.cloud = 0.45;
  if (st.state === 'pouring') out.precip = POURING;
  if (st.state === 'windy' || st.state === 'windy-variant') out.wind = WINDY;
  if (Number.isFinite(a.cloud_coverage)) out.cloud = Math.min(Math.max(a.cloud_coverage / 100, 0), 1);
  if (Number.isFinite(a.temperature)) out.temp = a.temperature;
  const kmh = Number.isFinite(a.wind_speed) ? windKmh(a.wind_speed, a.wind_speed_unit) : null;
  if (kmh !== null) out.wind = windStrength(kmh);
  const bearing = bearingDeg(a.wind_bearing, lang);
  if (bearing !== null) out.windBearing = bearing;
  return out;
}

/**
 * Reading of the wind sensors (a weather station, or the sensors of an internet weather service): the fields they
 * can tell, among { wind (0..1), windBearing (degrees) }. They take over the wind of the weather entity, field by
 * field: an unavailable sensor leaves what the weather entity says.
 */
export function windSensors(speedSt, bearingSt, lang = 'en') {
  const out = {};
  const kmh = speedSt ? windKmh(speedSt.state, (speedSt.attributes || {}).unit_of_measurement) : null;
  if (kmh !== null) out.wind = windStrength(kmh);
  const bearing = bearingSt ? bearingDeg(bearingSt.state, lang) : null;
  if (bearing !== null) out.windBearing = bearing;
  return out;
}

const RAIN_WORDS = { on: true, raining: true, rain: true, wet: true, true: true, off: false, dry: false, false: false };

/**
 * Reading of a local rain sensor: { raining, rate } (rate in mm/h, null when the sensor only says yes / no), or null
 * when it cannot tell: no sensor, unavailable, or a cumulated amount ("rain today", in mm), which says nothing about
 * what is falling now. Accepts a binary_sensor (rain detector) or a rain rate sensor (mm/h, mm/d, in/h, in/d).
 */
export function rainSensor(st) {
  if (!st || st.state === null || st.state === undefined) return null;
  const word = String(st.state).trim().toLowerCase();
  if (word in RAIN_WORDS) return { raining: RAIN_WORDS[word], rate: null };
  const v = Number(word);
  if (word === '' || !Number.isFinite(v)) return null; // unavailable, unknown…
  const a = st.attributes || {};
  const unit = String(a.unit_of_measurement || '').toLowerCase();
  if (a.device_class === 'precipitation' || (unit && !unit.includes('/'))) return null;
  const rate = Math.max(0, v) * (unit.startsWith('in') ? 25.4 : 1) * (unit.endsWith('/d') ? 1 / 24 : 1);
  return { raining: rate > 0, rate };
}

/**
 * A local rain sensor refines the weather service: the service tells what is expected over the town, the sensor what
 * falls on the garden. Rain seen here shows rain (snow and thunderstorm are kept, a gauge cannot tell them apart);
 * no rain here turns "rainy" into an overcast sky and keeps a thunderstorm dry. Snow is left to the weather service:
 * most gauges do not see it.
 */
export function applyRain(weather, rain) {
  if (!rain) return weather;
  const out = { ...weather };
  if (rain.raining) {
    if (out.weather !== 'storm' && out.weather !== 'snow') out.weather = 'rain';
    // 0.2 = drizzle … 1 = downpour (8 mm/h and more)
    if (rain.rate !== null && out.weather !== 'snow') out.precip = Math.min(1, 0.2 + rain.rate / 10);
  } else if (out.weather === 'rain') out.weather = 'cloudy';
  else if (out.weather === 'storm') out.precip = 0;
  else if (!out.weather) out.weather = 'clear'; // no weather service: the sensor alone switches the rain off
  return out;
}

/** Solar-ish time from a Date and a longitude: { hour (0..24), doy (1..366) }. Equation of time ignored (< 17 min). */
export function solarClock(date, longitudeDeg) {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const hour = (((utcH + longitudeDeg / 15) % 24) + 24) % 24;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = Math.floor((date.getTime() - start) / 86400000);
  return { hour, doy };
}

/**
 * Area id of an entity: its own area, else its device's. `hass.entities` / `hass.devices` are the frontend registries
 * (display entries): entity.area_id, entity.device_id, device.area_id.
 */
export function areaOfEntity(hass, entityId) {
  const e = hass.entities && hass.entities[entityId];
  if (e && e.area_id) return e.area_id;
  const d = e && e.device_id && hass.devices && hass.devices[e.device_id];
  return (d && d.area_id) || null;
}

/** Room id -> HA area id: explicit mapping first, then by (accent/case-insensitive) name. */
export function mapRoomsToAreas(rooms, areas, explicit = {}) {
  const byName = new Map(Object.values(areas || {}).map((a) => [norm(a.name), a.area_id]));
  const out = {};
  for (const r of rooms) {
    if (explicit[r.id] === '-') continue; // explicitly linked to no area
    if (explicit[r.id]) out[r.id] = explicit[r.id];
    else if (byName.has(norm(r.name))) out[r.id] = byName.get(norm(r.name));
  }
  return out;
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Per-room light state from the `light.*` entities of each room's area:
 *   on = any light on; color = first colored light; brightness = mean over the lights that are on (0..1).
 * `lightEntities` may restrict which entities count (card option); null = every light.* entity.
 * `exclude`: light entities placed on the plan (they light their own source, not the whole room).
 */
export function roomLights(hass, roomToArea, lightEntities = null, exclude = null) {
  const byArea = {};
  for (const [id, st] of Object.entries(hass.states || {})) {
    if (!id.startsWith('light.')) continue;
    if (lightEntities && !lightEntities.includes(id)) continue;
    if (exclude && exclude.has(id)) continue; // placed on the plan: drives its own light source
    const area = areaOfEntity(hass, id);
    if (area) (byArea[area] ||= []).push(st);
  }
  const out = {};
  for (const [roomId, area] of Object.entries(roomToArea)) {
    const on = (byArea[area] || []).filter((s) => s.state === 'on');
    if (!on.length) {
      out[roomId] = { on: false };
      continue;
    }
    const colored = on.find((s) => Array.isArray(s.attributes && s.attributes.rgb_color));
    const bright = on.map((s) => (Number.isFinite(s.attributes && s.attributes.brightness) ? s.attributes.brightness / 255 : 0.8));
    out[roomId] = {
      on: true,
      color: colored ? toHex(colored.attributes.rgb_color) : undefined,
      brightness: Math.min(Math.max(bright.reduce((a, b) => a + b, 0) / bright.length, 0.2), 1.3),
    };
  }
  return out;
}

/**
 * Room temperatures (°C) from HA: the area's own temperature sensor when set (area registry
 * `temperature_entity_id`), otherwise the first `sensor.*` with device_class temperature in that area.
 */
export function roomTemps(hass, roomToArea) {
  const byArea = {};
  for (const a of Object.values(hass.areas || {})) if (a.temperature_entity_id) byArea[a.area_id] = a.temperature_entity_id;
  for (const [id, st] of Object.entries(hass.states || {})) {
    if (!id.startsWith('sensor.') || !st.attributes || st.attributes.device_class !== 'temperature') continue;
    const area = areaOfEntity(hass, id);
    if (area && !byArea[area]) byArea[area] = id;
  }
  const out = {};
  for (const [roomId, area] of Object.entries(roomToArea)) {
    const st = byArea[area] && hass.states[byArea[area]];
    const v = st ? parseFloat(st.state) : NaN;
    if (Number.isFinite(v)) out[roomId] = v;
  }
  return out;
}

/** State of one light entity for its placed light source: { on, color?, brightness }. */
export function entityLight(st) {
  if (!st || st.state !== 'on') return { on: false };
  const a = st.attributes || {};
  return {
    on: true,
    color: Array.isArray(a.rgb_color) ? toHex(a.rgb_color) : undefined,
    brightness: Number.isFinite(a.brightness) ? Math.min(Math.max(a.brightness / 255, 0.15), 1.3) : 0.9,
  };
}
