// Pure helpers that turn Home Assistant state into the live data the engine understands.
// No DOM, no three.js: unit-tested in test/.

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

/**
 * Live weather from a `weather.*` state object. Returns the engine fields (preset + measured overrides).
 * Wind speed is read in km/h (HA default unit) and mapped to the engine's 0..1 scale.
 */
export function weatherLive(st) {
  if (!st) return {};
  const out = {};
  const preset = WEATHER_MAP[st.state];
  if (preset) out.weather = preset;
  const a = st.attributes || {};
  if (st.state === 'partlycloudy') out.cloud = 0.45;
  if (Number.isFinite(a.cloud_coverage)) out.cloud = Math.min(Math.max(a.cloud_coverage / 100, 0), 1);
  if (Number.isFinite(a.temperature)) out.temp = a.temperature;
  if (Number.isFinite(a.wind_speed)) out.wind = Math.min(Math.max(a.wind_speed / 60, 0), 1);
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
