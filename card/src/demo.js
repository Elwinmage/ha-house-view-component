// Demo mode: the entities of the demo home are simulated here (no entity exists in Home Assistant). A scenario of
// the day drives them from the hour of the simulation (shutters, lights, watering, robots, a water leak...), and
// the services the card calls act on them, a manual change staying until the scenario moves that entity again.
// Pure logic (no lit / three): the card wraps its hass object with `hassFor`.
import { DEMO_AREAS, DEMO_ENTITIES } from './demo-data.js';

const COVER_SPEED = 25; // % per second of real time
const pretty = (id) => {
  const s = id.split('.')[1].replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const inRange = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const TOGGLE = ['light', 'switch', 'binary_sensor', 'media_player'];
const POOL_COVER = 'cover.volet_piscine'; // its own hours: it is not a shutter of a window

/** States the scenario wants at hour `h` (0..24): { entity_id: { state, attributes? } } for the entities it drives. */
export function scenarioAt(h) {
  const out = {};
  const on = (id, v) => (out[id] = { state: v ? 'on' : 'off' });
  // lights: mornings and evenings in the living rooms, bedtime upstairs, the garden in the evening
  for (const id of ['light.sejour', 'light.cuisine']) on(id, inRange(h, 6.5, 8) || inRange(h, 19, 23));
  for (const id of ['light.chambre_1', 'light.chambre_2', 'light.chambre_3']) on(id, inRange(h, 6.5, 7.5) || inRange(h, 21, 22.5));
  on('light.chambre_parentale', inRange(h, 6.75, 7.5) || inRange(h, 22, 23.5));
  on('light.salle_de_bain', inRange(h, 6.75, 7.25) || inRange(h, 22.5, 23));
  on('light.bureau', inRange(h, 18, 20));
  on('light.entree', inRange(h, 18, 18.25));
  on('light.terrasse', inRange(h, 20, 23));
  on('light.piscine', inRange(h, 19.5, 23.5)); // the lamps of the pool, once the sun is down
  // shutters: open in the morning, the bedrooms close in the evening, everything at night; the bay half closed at noon
  const shutters = DEMO_ENTITIES.filter(([id]) => id.startsWith('cover.') && id !== POOL_COVER).map(([id]) => id);
  for (const id of shutters) {
    let pos = inRange(h, 7, 21.5) ? 100 : 0;
    if (/chambre/.test(id) && inRange(h, 20.5, 21.5)) pos = 0;
    if (id === 'cover.sejour_volet_baie' && inRange(h, 12.5, 14.5)) pos = 40;
    out[id] = { position: pos };
  }
  // windows aired in the morning, the bay open in the afternoon, doors when leaving and coming back
  on('binary_sensor.chambre_1_fenetre', inRange(h, 7.5, 8.5));
  on('binary_sensor.cuisine_fenetre', inRange(h, 8, 9));
  on('binary_sensor.sejour_baie', inRange(h, 15, 17));
  on('binary_sensor.sejour_fenetre', inRange(h, 10, 12));
  on('binary_sensor.entree_porte', inRange(h, 8.4, 8.5) || inRange(h, 18, 18.1));
  on('binary_sensor.garage_porte', inRange(h, 8.5, 8.75) || inRange(h, 17.75, 18));
  out['alarm_control_panel.maison'] = { state: inRange(h, 9, 17.75) ? 'armed_away' : inRange(h, 23.5, 6.5) ? 'armed_night' : 'disarmed' };
  // a water leak in the laundry before dinner
  on('binary_sensor.buanderie_fuite', inRange(h, 18.5, 19.25));
  // watering at dawn and in the evening
  on('switch.arrosage_pelouse', inRange(h, 5.5, 6.25));
  on('switch.arrosage_potager', inRange(h, 6.25, 6.75));
  on('switch.arrosage_haie', inRange(h, 21, 21.5));
  // robots: the vacuum while the house is empty, the pool robot in the afternoon
  out['vacuum.robot'] = { state: inRange(h, 10, 11.5) ? 'cleaning' : inRange(h, 11.5, 11.75) ? 'returning' : 'docked' };
  on('switch.pompe_piscine', inRange(h, 9, 18));
  on('binary_sensor.robot_piscine', inRange(h, 14, 16));
  // the roller cover of the pool: rolled back for the day, over the water for the night
  out[POOL_COVER] = { position: inRange(h, 10, 19.5) ? 100 : 0 };
  out['media_player.salon'] = { state: inRange(h, 20, 22) ? 'playing' : 'off' };
  // temperatures: the day outside, a little heating inside
  const day = Math.sin(((h - 9) / 24) * 2 * Math.PI);
  const t = (v) => ({ state: (Math.round(v * 10) / 10).toFixed(1) });
  out['sensor.exterieur_temperature'] = t(13 + 7 * day);
  out['sensor.sejour_temperature'] = t(21 + 0.8 * day);
  out['sensor.chambre_parentale_temperature'] = t(19.5 + 0.6 * day);
  out['sensor.sejour_co2'] = { state: String(Math.round(inRange(h, 19, 23) ? 900 + 200 * Math.sin(h) : 520 + 40 * day)) };
  return out;
}

export class DemoSim {
  constructor() {
    this.states = {};
    this.registry = {};
    this.manual = new Map(); // entity id -> scenario value when it was changed by hand
    this.auto = true; // the scenario drives the entities
    this.covers = {}; // cover id -> target position
    this._v = 0; // version: bumped on each change
    const now = new Date().toISOString();
    for (const [id, area, state, attributes] of DEMO_ENTITIES) {
      this.states[id] = {
        entity_id: id,
        state,
        attributes: { friendly_name: pretty(id), ...attributes },
        last_changed: now,
        last_updated: now,
        context: { id: '' },
      };
      this.registry[id] = {
        entity_id: id,
        area_id: area,
        device_id: null,
        platform: 'house_view_demo',
        hidden: false,
        entity_category: null,
      };
      if (id.startsWith('cover.')) this.covers[id] = attributes.current_position ?? 100;
    }
    this.areas = Object.fromEntries(
      DEMO_AREAS.map(([area_id, name]) => [area_id, { area_id, name, floor_id: null, icon: null, picture: null }]),
    );
  }

  has(id) {
    return id in this.states;
  }

  /** New state object for `id` (HA states are immutable: a change gives a new object). */
  _set(id, state, attrs = null) {
    const old = this.states[id];
    const attributes = attrs ? { ...old.attributes, ...attrs } : old.attributes;
    if (old.state === state && (!attrs || Object.entries(attrs).every(([k, v]) => old.attributes[k] === v))) return false;
    const now = new Date().toISOString();
    this.states[id] = { ...old, state, attributes, last_updated: now, last_changed: old.state === state ? old.last_changed : now };
    this._v++;
    return true;
  }

  /** Move the scenario to hour `h`; `dt`: real seconds since the last call (shutters move at their own pace). */
  tick(h, dt) {
    const v0 = this._v;
    this.hour = h;
    if (this.auto) {
      const want = scenarioAt(h);
      for (const [id, w] of Object.entries(want)) {
        const key = JSON.stringify(w);
        if (this.manual.has(id)) {
          if (this.manual.get(id) === key) continue; // changed by hand: kept until the scenario moves it
          this.manual.delete(id);
        }
        if ('position' in w) this.covers[id] = w.position;
        else this._set(id, w.state);
      }
    }
    // shutters travel toward their target
    for (const [id, target] of Object.entries(this.covers)) {
      const st = this.states[id];
      const pos = st.attributes.current_position;
      if (pos === target) {
        this._set(id, target > 0 ? 'open' : 'closed', { current_position: target });
        continue;
      }
      const step = Math.sign(target - pos) * Math.min(Math.abs(target - pos), COVER_SPEED * dt);
      const next = Math.round((pos + step) * 10) / 10;
      this._set(id, next === target ? (target > 0 ? 'open' : 'closed') : step > 0 ? 'opening' : 'closing', { current_position: next });
    }
    return this._v !== v0;
  }

  /** A service called by the card on a demo entity. */
  call(domain, service, data = {}, target = {}) {
    const raw = data.entity_id ?? target.entity_id ?? [];
    const ids = (Array.isArray(raw) ? raw : [raw]).filter((id) => this.has(id));
    const want = scenarioAt(this.hour ?? 12);
    for (const id of ids) {
      const dom = id.split('.')[0];
      const st = this.states[id];
      this.manual.set(id, JSON.stringify(want[id] || null));
      if (dom === 'cover') {
        const pos =
          service === 'open_cover'
            ? 100
            : service === 'close_cover'
              ? 0
              : service === 'set_cover_position'
                ? data.position
                : service === 'stop_cover'
                  ? st.attributes.current_position
                  : st.attributes.current_position > 0
                    ? 0
                    : 100;
        this.covers[id] = Math.max(0, Math.min(100, pos ?? 100));
      } else if (dom === 'vacuum') {
        const map = {
          start: 'cleaning',
          clean_area: 'cleaning',
          clean_spot: 'cleaning',
          pause: 'paused',
          stop: 'idle',
          return_to_base: 'returning',
        };
        this._set(id, map[service] || st.state);
      } else if (dom === 'alarm_control_panel') {
        this._set(id, service.startsWith('alarm_arm_') ? `armed_${service.slice(10)}` : 'disarmed');
      } else if (TOGGLE.includes(dom)) {
        const next =
          service === 'turn_on' ? 'on' : service === 'turn_off' ? 'off' : st.state === 'on' || st.state === 'playing' ? 'off' : 'on';
        this._set(id, dom === 'media_player' && next === 'on' ? 'playing' : next);
      }
    }
    return ids.length > 0;
  }

  /** Events offered by the demo panel, played on the spot (until the scenario moves the entities again). */
  play(event) {
    const set = (id, state) => {
      this.manual.set(id, JSON.stringify(scenarioAt(this.hour ?? 12)[id] || null));
      this._set(id, state);
    };
    const shutters = Object.keys(this.covers);
    if (event === 'leak') set('binary_sensor.buanderie_fuite', this.states['binary_sensor.buanderie_fuite'].state === 'on' ? 'off' : 'on');
    else if (event === 'smoke')
      set('binary_sensor.cuisine_fumee', this.states['binary_sensor.cuisine_fumee'].state === 'on' ? 'off' : 'on');
    else if (event === 'shutters') {
      const close = shutters.some((id) => this.covers[id] > 0);
      this.call('cover', close ? 'close_cover' : 'open_cover', { entity_id: shutters });
    } else if (event === 'vacuum')
      this.call('vacuum', this.states['vacuum.robot'].state === 'cleaning' ? 'return_to_base' : 'start', { entity_id: 'vacuum.robot' });
    else if (event === 'watering') {
      const ids = ['switch.arrosage_pelouse', 'switch.arrosage_potager', 'switch.arrosage_haie'];
      const off = ids.some((id) => this.states[id].state === 'on');
      this.call('switch', off ? 'turn_off' : 'turn_on', { entity_id: ids });
    } else if (event === 'pool') {
      const id = 'binary_sensor.robot_piscine';
      set(id, this.states[id].state === 'on' ? 'off' : 'on');
    } else if (event === 'lights') {
      const ids = Object.keys(this.states).filter((id) => id.startsWith('light.'));
      const off = ids.some((id) => this.states[id].state === 'on');
      this.call('light', off ? 'turn_off' : 'turn_on', { entity_id: ids });
    }
  }

  /**
   * The hass object seen by the card in the demo: only the demo areas and entities (nothing of the real home shows),
   * their services handled here; everything else (user, language, websocket for the aquariums) is the real one.
   */
  hassFor(real, onCall) {
    const h = Object.create(real);
    h.states = { ...this.states };
    h.entities = this.registry;
    h.areas = this.areas;
    h.devices = {};
    h.callService = async (domain, service, data, target) => {
      if (this.call(domain, service, data, target)) onCall();
    };
    return h;
  }
}

export const DEMO_EVENTS = ['shutters', 'lights', 'vacuum', 'watering', 'pool', 'leak', 'smoke'];
