// Search of the pickers of the editor (pickers.js): icons by name or alias, entities grouped by area and device.
// No dependency: unit-tested in test/.
import { MDI_ICONS } from './mdi-names.js';

let ICONS = null;
/** [{ name, aliases }] of the Material Design Icons, read once. */
function icons() {
  if (!ICONS)
    ICONS = MDI_ICONS.split(' ').map((s) => {
      const [name, aliases] = s.split(':');
      return { name, aliases: aliases ? aliases.split(',') : [] };
    });
  return ICONS;
}

/**
 * Icons matching `query` (words separated by spaces or hyphens, all of them found in the name or an alias),
 * best first: name starting with the query, then name containing it, then an alias. Names without "mdi:".
 */
export function searchIcons(query, limit = 80) {
  const q = String(query || '')
    .toLowerCase()
    .replace(/^mdi:/, '')
    .trim();
  if (!q) return [];
  const words = q.split(/[\s-]+/).filter(Boolean);
  const whole = words.join('-');
  const scored = [];
  for (const i of icons()) {
    const inName = words.every((w) => i.name.includes(w));
    if (!inName && !words.every((w) => i.name.includes(w) || i.aliases.some((a) => a.includes(w)))) continue;
    const score = i.name === whole ? 0 : i.name.startsWith(whole) ? 1 : i.name.includes(whole) ? 2 : inName ? 3 : 4;
    scored.push([score, i.name.length, i.name]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
  return scored.slice(0, limit).map((s) => s[2]);
}

/** Area of an entity: its own, else the one of its device; null when neither has one. */
function areaOf(hass, id) {
  const e = hass.entities && hass.entities[id];
  if (e && e.area_id) return e.area_id;
  const d = e && e.device_id && hass.devices && hass.devices[e.device_id];
  return (d && d.area_id) || null;
}

const deviceName = (d) => (d && (d.name_by_user || d.name)) || '';

/** Name of an entity under its device: the device name taken off the front of its friendly name. */
export function shortName(full, device) {
  if (device && full.toLowerCase().startsWith(`${device.toLowerCase()} `)) return full.slice(device.length + 1);
  return full;
}

/**
 * Entities to choose from, grouped: [{ area: { id, name }, devices: [{ id, name, entities: [{ id, name }] }] }].
 * opts: area (only that area, unless `all`), all, domains (allowed domains), query (words found in the entity id,
 * its name, its device or its area). Areas by name (no area last), devices by name (entities without device last),
 * entities by name. Hidden entities are left out.
 */
export function entityTree(hass, { area = null, all = false, domains = null, query = '' } = {}) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const areas = new Map();
  for (const [id, st] of Object.entries(hass.states || {})) {
    if (domains && domains.length && !domains.includes(id.split('.')[0])) continue;
    const reg = hass.entities && hass.entities[id];
    if (reg && (reg.hidden || reg.hidden_by)) continue;
    const a = areaOf(hass, id);
    if (!all && area && a !== area) continue;
    const dev = reg && reg.device_id && hass.devices && hass.devices[reg.device_id];
    const full = (st.attributes && st.attributes.friendly_name) || id;
    const areaName = (a && hass.areas && hass.areas[a] && hass.areas[a].name) || '';
    const hay = `${id} ${full} ${deviceName(dev)} ${areaName}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    if (!areas.has(a)) areas.set(a, { area: { id: a, name: areaName }, devices: new Map() });
    const devs = areas.get(a).devices;
    const dk = dev ? reg.device_id : null;
    if (!devs.has(dk)) devs.set(dk, { id: dk, name: deviceName(dev), entities: [] });
    devs.get(dk).entities.push({ id, name: shortName(full, deviceName(dev)) });
  }
  const byName = (x, y) => (x.name || '').localeCompare(y.name || '', undefined, { numeric: true });
  return [...areas.values()]
    .map((g) => ({
      area: g.area,
      devices: [...g.devices.values()]
        .map((d) => ({ ...d, entities: d.entities.sort(byName) }))
        .sort((x, y) => (x.id === null) - (y.id === null) || byName(x, y)),
    }))
    .sort((x, y) => (x.area.id === null) - (y.area.id === null) || byName(x.area, y.area));
}

/**
 * Entities matching `query` whose domain is left out by `domains`: [{ id, name, area }], best first by name. The
 * picker offers them apart, so that an entity of an unexpected domain (a pool robot seen as a `light`, a plug read
 * as a `sensor`…) can still be chosen by typing its id or its name. Without a query, or without a domain filter,
 * nothing is offered. Hidden entities are left out, as in `entityTree`.
 */
export function otherDomains(hass, { query = '', domains = null, limit = 20 } = {}) {
  if (!domains || !domains.length) return [];
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const [id, st] of Object.entries(hass.states || {})) {
    if (domains.includes(id.split('.')[0])) continue;
    const reg = hass.entities && hass.entities[id];
    if (reg && (reg.hidden || reg.hidden_by)) continue;
    const a = areaOf(hass, id);
    const areaName = (a && hass.areas && hass.areas[a] && hass.areas[a].name) || '';
    const full = (st.attributes && st.attributes.friendly_name) || id;
    if (!words.every((w) => `${id} ${full} ${areaName}`.toLowerCase().includes(w))) continue;
    out.push({ id, name: full, area: areaName });
  }
  return out.sort((x, y) => (x.name || '').localeCompare(y.name || '', undefined, { numeric: true })).slice(0, limit);
}
