import { LitElement, html, css, nothing } from 'lit';
import { HouseEngine } from './engine.js';
import { HouseViewApi } from './api.js';
import { WorldEditors, drawSection } from './editors.js';
import { FenceTools, GateTools, BedTools, IrrigationTools, VacuumTools } from './garden-tools.js';
import { VacuumController } from './vacuum-ctl.js';
import { irrigationStates } from './irrigation.js';
import { renderFences, renderGates, renderBeds, renderRooms, renderVacuumSetup, renderIrrigation } from './ui-sections.js';
import {
  renderGeneral,
  renderGeneralEditor,
  renderAlarmBadge,
  renderAlarmList,
  renderRoomAlarms,
  renderAlarmsEditor,
  alarmsOf,
  loadAquariums,
  pushZones,
  openZone,
  renderAquariumDialog,
  renderZoneThumbs,
  placeZones,
  renderZonesEditor,
} from './ui-general.js';
import {
  weatherLive,
  windSensors,
  rainSensor,
  applyRain,
  solarClock,
  mapRoomsToAreas,
  roomLights,
  roomTemps,
  areaOfEntity,
  entityLight,
} from './ha-bridge.js';
import { loadHaForm } from './card-editor.js';
import { importSh3d } from './engine/sh3d-import.js';
import { normalizeScene } from './engine/scene-model.js';
import { autoCalibrate, parseTerrain } from './engine/terrain.js';
import { normalizeEdits, emptyEdits } from './engine/edits.js';
import { WEATHER_PRESETS } from './engine/environment.js';
import { SPECIES } from './engine/catalog.js';
import { climateFor, seasonsOf, seasonKey, seasonDay } from './climate.js';
import { houseParcel } from './engine/terrain.js';
import { compassIndex } from './wind.js';
import { makeT } from './i18n.js';
import './pickers.js';
import pkg from '../package.json';
import { autoOpeningLinks, openingStates } from './openings.js';
import { gatesOf, gateOpenness } from './gates.js';
import { normalizeFence } from './fences.js';
import { renderOpenings } from './ui-openings.js';
import { renderPools } from './ui-pools.js';
import { renderBuilder } from './ui-builder.js';
import {
  addRoom,
  builderFromLevels,
  builderReport,
  builderScene,
  emptyBuilder,
  normalizeBuilder,
  sceneFromLevels,
} from './plan-builder.js';
import { importIfc } from './engine/ifc-import.js';
import { parseSvgRooms, svgLevels } from './engine/svg-import.js';
import { robotMapsWithRooms, robotPlanRooms } from './robot-plan.js';
import { DemoSim, DEMO_EVENTS } from './demo.js';

/** Room whose layer an entity belongs to (set while zoomed on it), else the room it stands in. */
const entityRoom = (s) => s.layer || s.room;
/** A label of the general view shown over the roof (the temperature of a room seen from afar). */
const overRoof = (s) => !!s.overRoof || s.scope === 'far';

console.info(
  `%c 🏠 HOUSE VIEW %c v${pkg.version} `,
  'color:#fff;background:#3b6ea5;font-weight:700;padding:2px 4px;border-radius:3px 0 0 3px',
  'color:#3b6ea5;background:#e8eef6;font-weight:700;padding:2px 4px;border-radius:0 3px 3px 0',
);

const TICK_MS = 30000; // live clock refresh
const SAVE_DELAY = 600; // edits are saved this long after the last change
const PREVIEW_MS = 180000; // a forced season / weather preview returns to live after 3 min
const PREVIEW = {
  weather: ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'],
  hour: { morning: 8.5, noon: 13, dusk: 19.2, night: 22.5 },
};
const VACUUM_ACTIVE = new Set(['cleaning', 'returning']);
/** Icons of the sections in the menu of the editor. */
const SECTION_ICONS = {
  entities: 'mdi:map-marker-radius',
  general: 'mdi:view-sequential',
  alarms: 'mdi:bell-ring-outline',
  zones: 'mdi:gesture-tap-box',
  rooms: 'mdi:floor-plan',
  openings: 'mdi:window-closed-variant',
  pools: 'mdi:pool',
  vacuum: 'mdi:robot-vacuum',
  irrigation: 'mdi:sprinkler-variant',
  fences: 'mdi:fence',
  gates: 'mdi:gate',
  beds: 'mdi:flower',
  outdoor: 'mdi:home-group',
  trees: 'mdi:pine-tree',
  ground: 'mdi:terrain',
  views: 'mdi:camera-outline',
};
const TOOLS = ['off', 'wall', 'terrace', 'brush-set', 'brush-add', 'brush-smooth', 'section'];
const OP_FIELDS = {
  wall: [
    ['hi', 'op_hi', 0.05],
    ['lo', 'op_lo', 0.05],
    ['flat', 'op_flat', 0.5],
    ['feather', 'op_feather', 0.5],
  ],
  terrace: [
    ['alt', 'op_alt', 0.05],
    ['feather', 'op_feather', 0.5],
  ],
  brush: [
    ['r', 'op_r', 0.5],
    ['value', 'op_value', 0.05],
  ],
};

const fmtHour = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const fmtDoy = (doy, lang) =>
  new Date(Date.UTC(2026, 0, doy)).toLocaleDateString(lang || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' });

class HouseViewCard extends LitElement {
  static properties = {
    _status: { state: true }, // 'loading' | 'ready' | 'empty' | 'error'
    _error: { state: true },
    _panel: { state: true }, // null | 'setup' | 'edit' | 'sim'
    _report: { state: true },
    _views: { state: true },
    _view: { state: true },
    _sim: { state: true },
    _msg: { state: true },
    _tip: { state: true },
    _movable: { state: true },
    _rev: { state: true }, // bumped by the editors to refresh the panel
    _section: { state: true }, // unfolded section of the editor (one at a time)
    _focus: { state: true }, // room id the camera is zoomed on
    _preview: { state: true }, // forced { season?, weather?, hour? } in live mode
    _vacMode: { state: true },
    _vacSel: { state: true },
    _fetch: { state: true }, // terrain fetch job status
    _busy: { state: true },
    _lockDlg: { state: true }, // password dialog of the edit lock: { error, busy } while shown
    _provider: { state: true }, // terrain source chosen in the fetch form: auto | ign | world
  };

  static getStubConfig() {
    return { type: 'custom:house-view-card' };
  }

  /** Visual editor of the options (card-editor.js). */
  static async getConfigElement() {
    await loadHaForm();
    return document.createElement('house-view-card-editor');
  }

  constructor() {
    super();
    this._status = 'loading';
    this._panel = null;
    this._views = [];
    this._view = 0;
    this._sim = { hour: 14, doy: 172, weather: 'clear', play: false };
    this._data = null;
    this._lastLive = '';
    this._rev = 0;
    this._outSel = '';
    this._opSel = -1;
    this._focus = null;
    this._preview = null;
    this._vacMode = false;
    this._vacSel = new Set();
    this._fetch = null;
    this._fit = this._fit.bind(this);
    this._onKey = this._onKey.bind(this);
  }

  setConfig(config) {
    const c = {
      mode: 'live',
      fps_cap: 30,
      show_views: true,
      show_levels: true,
      tap_action: 'zoom', // zoom | toggle_lights | none
      show_entities: true, // labels of the entities placed in the editor
      height: 'fill',
      min_height: 320,
      ...config,
    };
    // `interactive` was the first name of the option
    c.movable_camera = c.movable_camera ?? c.interactive ?? true;
    this._config = c;
    this._movable = c.movable_camera;
    if (this._engine) {
      this._engine.opts.fpsCap = c.fps_cap;
      this._engine.setMovable(this._movable);
    }
    // another home chosen in the editor of the card: its plan, terrain and corrections
    if (this._api && this._api.home !== (c.home || '')) {
      this._api.home = c.home || '';
      this._reload();
    }
    this._fit();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 'full', min_rows: 4 };
  }

  set hass(h) {
    this._realHass = h;
    // demo home: only the simulated areas and entities are seen, their services handled by the simulator
    if (this._demo) h = this._demo.hassFor(h, () => this._demoChanged());
    const first = !this._hass;
    this._hass = h;
    if (first) this._init();
    else {
      this._pushLive();
      this._pushIrrigation();
      this._pushOpenings();
      this._pushGates();
      this._pushPools();
      this._syncVacs();
    }
    // placed sensors and the vacuum show live states: re-render only when one of them changed
    const ed = this._data && this._data.edits;
    const watched = [
      ...this._vacuumIds,
      ...((ed && ed.entities) || []).map((x) => x.entity),
      ...((ed && ed.panel) || []).map((x) => x.entity),
    ].filter(Boolean);
    // raised alarms: the badge and its list follow them
    const alarms = ed && this._config.show_alarms !== false ? alarmsOf(this).raised.map((st) => `${st.entity_id}:${st.last_changed}`) : [];
    const sig = `${watched.map((id) => h.states[id] && h.states[id].last_updated).join('|')}#${alarms.join('|')}`;
    if (sig !== this._watchSig) {
      this._watchSig = sig;
      this.requestUpdate();
    }
  }

  /** Climate of the home (its latitude): which seasons it has and when. */
  get _climate() {
    const lat = this._info && Number.isFinite(this._info.latitude) ? this._info.latitude : this._hass && this._hass.config.latitude;
    return climateFor(lat);
  }

  get _t() {
    return makeT(this._hass && this._hass.language);
  }

  get _isAdmin() {
    return !!(this._hass && this._hass.user && this._hass.user.is_admin);
  }

  connectedCallback() {
    super.connectedCallback();
    this._tick = setInterval(() => this._pushTime(), TICK_MS);
    this._io = new IntersectionObserver((e) => {
      this._inView = e[0].isIntersecting;
      this._updateRunning();
    });
    this._io.observe(this);
    this._vis = () => this._updateRunning();
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('resize', this._fit);
    window.addEventListener('keydown', this._onKey);
    this._updateRunning();
    requestAnimationFrame(this._fit);
    if (this._engine) this._watchCatalog(); // re-attached (dashboard edit mode): follow the catalog again
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    clearInterval(this._playTimer);
    this._playTimer = null;
    clearInterval(this._demoTimer);
    this._demoTimer = null;
    if (this._year) cancelAnimationFrame(this._year.raf);
    this._year = null;
    clearTimeout(this._previewTimer);
    clearTimeout(this._fetchTimer);
    for (const v of (this._vacs || new Map()).values()) v.pause();
    this._irrDemoStop();
    if (this._io) this._io.disconnect();
    this._unwatchCatalog();
    document.removeEventListener('visibilitychange', this._vis);
    window.removeEventListener('resize', this._fit);
    window.removeEventListener('keydown', this._onKey);
    if (this._engine) this._engine.stop(); // keep the engine: the card may be re-attached (dashboard edit mode)
  }

  firstUpdated() {
    this._fit();
  }

  updated() {
    const cv = this.renderRoot.querySelector('#section');
    if (cv && this._editors && this._editors.section) drawSection(cv, this._editors.section);
  }

  /** Render only when the card is on screen and the browser tab is visible. Both conditions are tracked
   * separately: mixing them made a hidden tab look like an off-screen card, and the loop never restarted. */
  _updateRunning() {
    if (!this._engine) return;
    if (this._inView !== false && !document.hidden) this._engine.start();
    else this._engine.stop();
  }

  _onKey(e) {
    if (e.key === 'Escape' && this._editors && this._editors.tool.mode !== 'off') this._editors.cancelDraft();
  }

  /** Card height: fill the screen below the card's top (default), keep an aspect ratio, or a fixed height. */
  _fit() {
    const wrap = this.renderRoot && this.renderRoot.querySelector('.wrap');
    if (!wrap || !this._config) return;
    const hgt = this._config.height;
    if (hgt === 'aspect') {
      wrap.style.height = '';
      wrap.style.aspectRatio = '16 / 10';
      return;
    }
    wrap.style.aspectRatio = 'auto';
    if (typeof hgt === 'number') wrap.style.height = `${hgt}px`;
    else if (hgt && hgt !== 'fill')
      wrap.style.height = hgt; // any CSS length, e.g. "70vh"
    else {
      // top of the card in the viewport, at most half of the screen (the card may be scrolled into view later)
      const top = Math.min(Math.max(wrap.getBoundingClientRect().top, 0), window.innerHeight / 2);
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      wrap.style.height = `${Math.max(this._config.min_height, Math.floor(vh - top - 8))}px`;
    }
  }

  // ------------------------------------------------------------ data

  async _init() {
    this._api = new HouseViewApi(this._hass, this._config.home);
    this._api.onLocked = () => this._askUnlock(); // a write refused by the edit lock: ask the password, then retry
    this._api.lockedMessage = this._t('lock_refused');
    await this.updateComplete;
    this._fit();
    this._engine = new HouseEngine(this.renderRoot.querySelector('#view'), {
      movable: this._movable,
      fpsCap: this._config.fps_cap,
      onRoomClick: (roomId) => this._roomClick(roomId),
      onZoneClick: (id) => openZone(this, id),
      onHover: (info, ev) => this._hover(info, ev),
    });
    this._engine.onFrame = () => {
      this._placeAnchors();
      placeZones(this);
    };
    this._syncVacs();
    this._updateRunning();
    this._watchCatalog();
    await Promise.all([this._loadCatalog(), this._reload()]);
    this._aquariums = await loadAquariums(this);
    this._aquariumsLoaded = true;
    this.requestUpdate();
  }

  /**
   * Trees, objects and pond fish of the house catalog. The integration downloads them and merges the entries saved with the
   * catalog editor; the card only asks it (never the network) and draws them. Without them (an older integration)
   * the built-in species stay.
   */
  async _loadCatalog() {
    const h = this._hass;
    if (!h || !h.callWS || !this._engine) return;
    this._catalog = this._catalog || { trees: {}, objects: {}, fish: {} };
    // each section on its own: one that cannot be read keeps what it had, and does not hide the other
    await Promise.all(
      Object.keys(this._catalog).map(async (section) => {
        try {
          const answer = await h.callWS({ type: 'house_view/catalog', section });
          this._catalog[section] = (answer && answer.data && answer.data.items) || {};
        } catch (err) {
          // an older integration does not know the command: nothing to report
          if (err && err.code === 'unknown_command') console.debug('house-view-card: no catalog in this integration');
          else console.warn(`house-view-card: the ${section} of the catalog could not be loaded`, err);
        }
      }),
    );
    try {
      this._engine.setCatalog(this._catalog, h.language);
    } catch (err) {
      console.warn('house-view-card: the catalog could not be drawn', err);
    }
    this.requestUpdate();
  }

  /** A new release, or an entry saved in the catalog editor: the view takes it at once. */
  _watchCatalog() {
    const h = this._hass;
    if (this._catalogUnsub || !h || !h.connection || !h.connection.subscribeMessage) return;
    this._catalogUnsub = ['trees', 'objects', 'fish'].map((section) =>
      h.connection.subscribeMessage(() => this._loadCatalog(), { type: 'house_view/catalog/subscribe', section }).catch(() => null),
    );
  }

  _unwatchCatalog() {
    for (const pending of this._catalogUnsub || []) pending.then((unsub) => unsub && unsub());
    this._catalogUnsub = null;
  }

  async _reload() {
    try {
      this._status = 'loading';
      const info = await this._api.info();
      if (!info) throw Object.assign(new Error('no_integration'), { code: 'no_integration' });
      this._info = info;
      this._setDemo(!!info.demo);
      // Only request what exists: a 404 would be logged by the browser even though the API client handles it.
      const scene = info.has_scene ? await this._api.getScene() : null;
      if (!scene) {
        this._status = 'empty';
        return;
      }
      this._info = info;
      const [terrain, edits, ortho] = await Promise.all([
        info.has_terrain ? this._api.getTerrain() : null,
        info.has_edits ? this._api.getEdits() : null,
        info.has_ortho ? this._api.getOrtho() : null,
      ]);
      this._data = { scene, terrain, ortho, edits: edits || emptyEdits() };
      this._apply();
      this._status = 'ready';
    } catch (e) {
      console.error('house-view-card', e);
      this._error = e.code === 'no_integration' ? this._t('no_integration') : e.message;
      this._status = 'error';
    }
  }

  _apply(keep = false) {
    this._engine.load(this._data, { keepLights: keep });
    this._data.edits = this._engine.edits; // the engine owns the normalized edits; the editors mutate them in place
    this._views = this._engine.views.map((v) => v.name);
    this._focus = this._engine.focus;
    this._lastLive = '';
    if (!keep && this._config.view) {
      const i = this._views.indexOf(this._config.view);
      if (i >= 0) {
        this._view = i;
        this._engine.goToView(i, true);
      }
    }
    this._pushTime(true);
    this._pushLive();
    this._pushIrrigation();
    this._pushOpenings();
    this._pushGates();
    this._pushPools();
    this._syncVacs();
    for (const v of this._vacs.values()) v.refresh();
    if (this._preview) this._applyPreview();
  }

  /** Links of the doors and windows found on their own (cached: the registry and the areas seldom change). */
  _openingAuto() {
    const eng = this._engine;
    const hass = this._hass;
    const src = [hass.entities, this._areas, eng.world.sd, Object.keys(hass.states).length];
    if (!this._opAuto || this._opAuto.src.some((v, i) => v !== src[i])) {
      const auto = autoOpeningLinks(
        eng.world.sd.openings,
        hass.states,
        hass.entities,
        (room) => this._areas && this._areas[room],
        (id) => areaOfEntity(hass, id),
      );
      this._opAuto = { src, auto };
    }
    return this._opAuto.auto;
  }

  /** Cleaning robots of the drawn pools run while their entity is on. */
  _pushPools() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._data || !this._hass) return;
    const map = {};
    for (const p of this._data.edits.pools) {
      const st = p.robot && this._hass.states[p.robot];
      map[p.id] = !!st && ['on', 'cleaning', 'running'].includes(st.state);
    }
    const sig = JSON.stringify(map);
    if (sig === this._poolSig && eng.world === this._poolWorld) return;
    this._poolSig = sig;
    this._poolWorld = eng.world;
    eng.setPoolRobots(map);
  }

  /** Doors, windows and shutters follow their entities. */
  _pushOpenings() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._data || !this._hass) return;
    const map = openingStates(eng.world.sd.openings, this._openingAuto(), this._data.edits.openings, this._hass.states);
    const sig = JSON.stringify(map);
    if (sig === this._opSig && eng.world === this._opWorld) return;
    this._opSig = sig;
    this._opWorld = eng.world;
    eng.setOpenings(map);
  }

  /** Gates of the fences follow their entity (cover or contact); the editor can show one open to try it. */
  _pushGates() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._data || !this._hass) return;
    const demo = (this._gateTools && this._panel === 'edit' && this._gateTools.demo) || new Set();
    const map = {};
    for (const { key, g } of gatesOf(this._data.edits.gates, this._data.edits.fences, normalizeFence))
      map[key] = demo.has(key) ? 1 : gateOpenness(g.entity, this._hass.states);
    const sig = JSON.stringify(map);
    if (sig === this._gateSig && eng.world === this._gateWorld) return;
    this._gateSig = sig;
    this._gateWorld = eng.world;
    eng.setGates(map);
  }

  /** Valve states of the drip lines and sprinkler circuits (plus the "test" previews of the editor). */
  _pushIrrigation() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._data) return;
    pushZones(this);
    this._pushGates();
    const irr = this._data.edits.irrigation;
    const it = this._irrTools;
    const now = Date.now();
    const test = it && this._panel === 'edit' ? it.demoSince(now) : null; // accelerated test of the editor
    const states = irrigationStates(irr, this._hass.states, test ? new Set(Object.keys(test)) : null, now, test || {});
    eng.setIrrigation(states, { soil: irr.soil, editing: this._panel === 'edit' && this._section === 'irrigation' });
  }

  /**
   * Accelerated watering test (valves stay closed): the given lines / circuits, or all of them, run for 30 s.
   * Calling it again for the same target stops the test.
   */
  _irrDemo(ids = null) {
    const it = this._irrTools;
    const same = it.demo && (ids ? !it.demo.all && ids.every((id) => it.demo.ids.has(id)) : it.demo.all);
    this._irrDemoStop();
    if (same || !it.startDemo(ids)) return;
    this._irrTimer = setInterval(() => {
      if (it.demoSince(Date.now())) this._pushIrrigation();
      else this._irrDemoStop();
    }, 150);
    this._pushIrrigation();
    this.requestUpdate();
  }

  _irrDemoStop() {
    clearInterval(this._irrTimer);
    this._irrTimer = null;
    const it = this._irrTools;
    if (!it || !it.demo) return;
    it.demo = null;
    const eng = this._engine;
    if (eng && eng.world) eng.world.irrigation.reset(); // the ground wetted by the test dries at once
    this._pushIrrigation();
    this.requestUpdate();
  }

  /** Run an editor action; an error is shown in the panel instead of being lost in the console. */
  _try(fn) {
    const fail = (e) => {
      console.error('house-view-card', e);
      this._msg = `${this._t('error')}: ${e && e.message ? e.message : e}`;
      this.requestUpdate();
    };
    this._saidAt = Date.now();
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch(fail);
    } catch (e) {
      fail(e);
    }
    this.requestUpdate();
  }

  /** Entity field: the Home Assistant picker when it is loaded, else a text field with suggestions. */
  /**
   * Entity picker of the editor: the entities of `area` (by default the area of the current room) grouped by device,
   * the whole house one tap away.
   */
  _entityInput(value, onPick, domains = null, area = undefined) {
    return html`<house-view-entity-picker
      .hass=${this._hass}
      .value=${value || ''}
      .area=${area === undefined ? this._currentArea() : area || ''}
      .domains=${domains}
      @value-changed=${(e) => {
        if ((e.detail.value || '') !== (value || '')) onPick(e.detail.value || '');
      }}
    ></house-view-entity-picker>`;
  }

  /** Icon picker of the editor: the icons are shown while one types. */
  _iconInput(value, onPick) {
    return html`<house-view-icon-picker
      .hass=${this._hass}
      .value=${value || ''}
      @value-changed=${(e) => onPick(e.detail.value || '')}
    ></house-view-icon-picker>`;
  }

  /** Home Assistant area of the current room: the room zoomed on, else the room of the entity chosen in the editor. */
  _currentArea() {
    const eng = this._engine;
    const room = (eng && eng.focus) || (this._entSel && (this._entities.find((x) => x.id === this._entSel) || {}).room);
    return (room && this._areas && this._areas[room]) || '';
  }

  /** One section of the editor; only one is unfolded at a time and only that one is rendered. */
  /**
   * A section of the editor: a button of the menu; the section open shows in its own window, beside the menu.
   * `icon`: its icon in the menu.
   */
  _sec(key, title, body, icon = SECTION_ICONS[key] || 'mdi:shape-outline') {
    const open = this._section === key;
    if (open) this._winSec = { key, title, body };
    return html`<button class=${`menu ${open ? 'on' : ''}`} @click=${() => this._onSection(key, !open)}>
      <ha-icon .icon=${icon}></ha-icon><span>${title}</span><span class="arrow">›</span>
    </button>`;
  }

  /**
   * Shows `content` in the item window (stacked over the window of the section) instead of in the section:
   * the editing of one item of a list. `close` closes it (the section unselects its item). Returns nothing.
   */
  _asWindow(title, content, close) {
    this._winItem = { title, content, close };
    return nothing;
  }

  /** Windows of the editor, stacked over the menu: the open section, then the item being edited over it. */
  _renderWindows() {
    if (this._panel !== 'edit') return nothing;
    const sec = this._winSec;
    const body = sec ? sec.body() : nothing; // evaluated first: it may open the item window
    const item = this._winItem;
    // stacked over the menu: the back arrow returns to the window underneath
    const win = (cls, title, content, close) =>
      html`<div class=${`win ${cls}`} @pointerdown=${(e) => e.stopPropagation()}>
        <div class="head">
          <button class="wback" title=${this._t('back')} @click=${close}><ha-icon icon="mdi:arrow-left"></ha-icon></button><b>${title}</b>
        </div>
        <div class="body">${content}</div>
      </div>`;
    return html`${sec ? win('sec', sec.title, body, () => this._onSection(sec.key, false)) : nothing}
    ${
      item
        ? win('item', item.title, item.content, () => {
            item.close();
            this.requestUpdate();
          })
        : nothing
    }`;
  }

  _onSection(key, open) {
    const next = open ? key : this._section === key ? null : this._section;
    if (next === this._section) return;
    if (this._editors && this._editors.active) this._editors.stop();
    if (next !== 'vacuum' && this._vac) this._vac.showMap(false); // the picture of the robot's map is a setting aid
    this._section = next;
    if (next !== 'openings' && this._engine) this._engine.setOpeningTarget(null);
    this._pushIrrigation();
    // the aquariums read again: views or sizes changed in ha-reef-card meanwhile
    if (next === 'zones')
      loadAquariums(this).then((list) => {
        this._aquariums = list;
        this.requestUpdate();
      });
  }

  // ------------------------------------------------------------ live

  _pushTime(force = false) {
    if (!this._engine || !this._engine.world || !this._hass) return;
    if (this._preview || this._year) return; // forced season / weather / hour, or a year being played
    if (this._simMode) {
      if (force) this._pushSim();
      return;
    }
    const lon = (this._info && Number.isFinite(this._info.longitude) ? this._info.longitude : this._hass.config.longitude) ?? 0;
    this._engine.setLive({ ...solarClock(new Date(), lon), latitude: this._climate.lat });
  }

  _pushSim() {
    const s = this._sim;
    const live = { hour: s.hour, doy: this._year ? this._year.doy : s.doy, latitude: this._climate.lat };
    if (s.weather) live.weather = s.weather;
    for (const k of ['cloud', 'precip', 'wind', 'windBearing', 'temp', 'snowCover']) if (s[k] !== undefined) live[k] = s[k];
    this._engine.setLive(live);
  }

  _pushLive() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._hass) return;
    const h = this._hass;
    const cfg = this._config;
    const areas = mapRoomsToAreas(eng.rooms, h.areas, this._data.edits.room_areas || {});
    const placed = new Set(
      (this._data.edits.entities || [])
        .filter((e) => e.at && e.entity && e.entity.startsWith('light.') && e.kind !== 'off')
        .map((e) => e.entity),
    );
    const lights = roomLights(h, areas, cfg.light_entities || null, placed);
    const entLights = Object.fromEntries([...placed].map((id) => [id, entityLight(h.states[id])]));
    const temps = roomTemps(h, areas);
    // the weather service decides (rain, snow, storm, fog, clouds); a local rain sensor, when given, corrects the rain,
    // and wind sensors the wind (speed: slant of what falls; bearing: the way it leans)
    const st = (id) => (id ? h.states[id] : null);
    const weather = this._simMode
      ? {}
      : {
          ...applyRain(weatherLive(st(cfg.weather_entity), h.language), cfg.rain_entity ? rainSensor(st(cfg.rain_entity)) : null),
          ...windSensors(st(cfg.wind_speed_entity), st(cfg.wind_bearing_entity), h.language),
        };
    const sig = JSON.stringify([lights, entLights, weather, temps]);
    if (sig === this._lastLive) return; // nothing relevant changed: skip the rebuild of the light volumes
    this._lastLive = sig;
    this._areas = areas;
    eng.setRoomLights(lights);
    eng.setEntityLights(entLights);
    eng.setRoomTemps(temps);
    if (!this._simMode && !this._preview && Object.keys(weather).length) eng.setLive(weather);
    this._vacuumSync();
  }

  _roomClick(roomId) {
    if (!this._hass) return;
    if (this._vacMode) return this._vacToggleRoom(roomId);
    // in the editor a tap on a room opens the editing of its layer of entities (zoom), whatever the tap action
    const act = this._editing ? 'zoom' : this._config.tap_action;
    if (this._editing && this._engine.focus === roomId) return;
    if (act === 'zoom' && this._engine.focus !== roomId) {
      this._engine.focusRoom(roomId);
      this._focus = roomId;
      this._tip = null;
      return;
    }
    // toggle_lights, or a second tap on the room already zoomed on
    if (act === 'none') return;
    this._toggleRoomLights(roomId);
  }

  _toggleRoomLights(roomId) {
    const area = this._areas && this._areas[roomId];
    if (!area) return;
    const ids = Object.keys(this._hass.states).filter((id) => id.startsWith('light.') && areaOfEntity(this._hass, id) === area);
    if (ids.length) this._hass.callService('light', 'toggle', { entity_id: ids });
  }

  _saveRoomView() {
    this._engine.saveRoomView(this._focus);
    this._msg = this._t('room_view_saved');
    this._edited(true);
  }

  _deleteRoomView() {
    this._engine.deleteRoomView(this._focus);
    this._edited(true);
  }

  _unfocus() {
    this._engine.unfocus();
    this._focus = null;
  }

  // ------------------------------------------------------------ forced preview (season / weather / hour)

  _setPreview(kind, key) {
    const cur = { ...(this._preview || {}) };
    if (cur[kind] === key) delete cur[kind];
    else cur[kind] = key;
    if (this._simMode) {
      // simulation mode: the preview simply moves the sliders
      const patch = {};
      if (kind === 'season') patch.doy = seasonDay(key, this._climate);
      if (kind === 'hour') patch.hour = PREVIEW.hour[key];
      if (kind === 'weather')
        Object.assign(patch, {
          weather: key,
          cloud: undefined,
          precip: undefined,
          wind: undefined,
          temp: undefined,
          snowCover: key === 'snow' ? 0.9 : 0,
        });
      this._setSim(patch);
      return;
    }
    if (!this._preview) {
      const env = this._engine.env;
      this._beforePreview = { ...env.state, snowCover: env.snowCover };
    }
    this._preview = Object.keys(cur).length ? cur : null;
    clearTimeout(this._previewTimer);
    if (!this._preview) return this._endPreview();
    this._previewTimer = setTimeout(() => this._endPreview(), PREVIEW_MS);
    this._applyPreview();
  }

  _applyPreview() {
    const p = this._preview;
    const b = this._beforePreview || {};
    const live = { doy: b.doy, hour: b.hour, weather: b.weather };
    if (p.season) live.doy = seasonDay(p.season, this._climate);
    if (this._year) live.doy = this._year.doy;
    if (p.hour) live.hour = PREVIEW.hour[p.hour];
    if (p.weather) live.weather = p.weather;
    live.snowCover = p.weather === 'snow' ? 0.9 : p.season === 'winter' && b.snowCover > 0.3 ? b.snowCover : 0;
    this._engine.setLive(live);
  }

  _endPreview() {
    clearTimeout(this._previewTimer);
    this._preview = null;
    const b = this._beforePreview;
    this._beforePreview = null;
    if (b && this._engine && this._engine.world) {
      const { snowCover, ...state } = b;
      this._engine.env.setState(state);
      this._engine.setLive({ snowCover });
    }
    this._lastLive = '';
    this._pushTime();
    this._pushLive();
  }

  // ------------------------------------------------------------ vacuum (generic: vacuum.clean_area on HA areas)

  /**
   * Robots shown: the one of the options (vacuum_entity) and those set up in the editor; without options, every
   * vacuum of Home Assistant. A robot set up as hidden is left out.
   */
  get _vacuumIds() {
    const h = this._hass;
    if (!h) return [];
    const set = (this._data && this._data.edits.vacuums) || [];
    const listed = set.map((v) => v.entity).filter(Boolean);
    const conf = this._demo ? null : this._config.vacuum_entity;
    const ids = conf ? [conf, ...listed] : [...listed, ...Object.keys(h.states).filter((e) => e.startsWith('vacuum.'))];
    const hidden = new Set(set.filter((v) => v.hidden).map((v) => v.entity));
    return [...new Set(ids)].filter((id) => h.states[id] && !hidden.has(id));
  }

  /** Robot chosen (toolbar, settings): the last one picked, else the first one. */
  get _vacuum() {
    const ids = this._vacuumIds;
    return ids.includes(this._vacCur) ? this._vacCur : ids[0] || null;
  }

  /** Controller of the robot chosen. */
  get _vac() {
    return (this._vacs && this._vacs.get(this._vacuum)) || null;
  }

  /**
   * Settings of a robot (edits.vacuums), null when none yet; `create`: made (and kept) when missing. The settings
   * of the single robot of the first versions (no entity) go to the robot of the options, else the first robot.
   */
  _vacCfg(entity, create = false) {
    if (!this._data || !entity) return null;
    const list = this._data.edits.vacuums;
    let v = list.find((x) => x.entity === entity);
    if (!v) {
      const heir = this._config.vacuum_entity || this._vacuumIds[0];
      const old = entity === heir && list.find((x) => !x.entity);
      if (old) {
        old.entity = entity;
        v = old;
      }
    }
    if (!v && create) {
      v = { entity };
      list.push(v);
    }
    return v || null;
  }

  /** One controller per robot shown: new robots get one, robots gone lose theirs (and their robot on the plan). */
  _syncVacs() {
    this._vacs = this._vacs || new Map();
    const ids = this._vacuumIds;
    for (const [id, v] of this._vacs) {
      if (ids.includes(id)) continue;
      v.pause();
      if (this._engine) this._engine.dropRobotSlot(id);
      this._vacs.delete(id);
    }
    for (const id of ids) if (!this._vacs.has(id)) this._vacs.set(id, new VacuumController(this, id));
    for (const v of this._vacs.values()) v.sync();
  }

  _vacuumSync() {
    if (!this._engine) return;
    this._engine.setHighlight(this._vacMode ? this._vacSel : null);
  }

  /**
   * Show the robot's floor from above (roof and upper floors hidden) while at least one reason holds ('pick' = rooms
   * being chosen, 'demo', 'run' = cleaning with the vacuum_show_floor option); the previous view comes back after.
   */
  _robotFloor(reason, on) {
    const eng = this._engine;
    if (!eng || !eng.world) return;
    this._floorWhy = this._floorWhy || new Set();
    if (on) this._floorWhy.add(reason);
    else this._floorWhy.delete(reason);
    const dock = (this._vacCfg(this._vacuum) || {}).dock;
    const lv = dock && eng.world.levelsById[dock.level];
    if (this._floorWhy.size && lv && !this._vacVis) {
      this._vacVis = { roof: eng.visibility.roof, levels: { ...eng.visibility.levels } };
      for (const l of eng.world.sd.levels) eng.setLevel(l.id, l.elevation <= lv.elevation + 0.01);
      eng.setRoof(false);
    } else if (!this._floorWhy.size && this._vacVis) {
      for (const [id, v] of Object.entries(this._vacVis.levels)) eng.setLevel(id, v);
      eng.setRoof(this._vacVis.roof);
      this._vacVis = null;
    }
    this._rev++;
  }

  _toggleVacMode() {
    this._vacMode = !this._vacMode;
    this._robotFloor('pick', this._vacMode); // the rooms are chosen on the robot's floor, seen from above
    this._vacSel = new Set();
    this._vacMsg = '';
    this._tip = null;
    this._vacuumSync();
  }

  _vacToggleRoom(roomId) {
    if (!this._areas || !this._areas[roomId]) {
      this._vacMsg = this._t('vac_no_area');
      this.requestUpdate();
      return;
    }
    const sel = new Set(this._vacSel);
    if (sel.has(roomId)) sel.delete(roomId);
    else sel.add(roomId);
    this._vacSel = sel;
    this._vacMsg = '';
    this._vacuumSync();
  }

  async _vacCall(service, data = {}) {
    try {
      await this._hass.callService('vacuum', service, data, { entity_id: this._vacuum });
      this._vacMsg = '';
      return true;
    } catch (e) {
      this._vacMsg = e.message || String(e);
      this.requestUpdate();
      return false;
    }
  }

  async _vacClean() {
    const areas = [...new Set([...this._vacSel].map((r) => this._areas[r]).filter(Boolean))];
    if (!areas.length) return;
    // rooms asked for: shown as "to come" during the run of this robot
    this._vacPlan = { entity: this._vacuum, rooms: [...this._vacSel].filter((r) => this._areas[r]) };
    if (await this._vacCall('clean_area', { cleaning_area_id: areas })) this._toggleVacMode();
    else this._vacPlan = null;
  }

  // ------------------------------------------------------------ entities placed on the plan (HTML labels)

  get _entities() {
    return (this._data && this._data.edits.entities) || [];
  }

  /**
   * Layers of the placed entities: zoomed on a room, only the entities of that room show (those placed while zoomed
   * on it); in the other views, every entity but those of the rooms.
   */
  _entityVisible(s) {
    const eng = this._engine;
    if (!s.at) return false;
    if (eng.focus) return s.scope === 'room' && entityRoom(s) === eng.focus;
    if (s.scope === 'room') return false;
    if (s.scope === 'level') return eng.visibility.levels[s.level] !== false && eng.topVisibleLevel === s.level && !eng.visibility.roof;
    return !s.level || eng.visibility.levels[s.level] !== false;
  }

  /** 3D anchor of a label: on the floor (default), on a wall (slightly off its face), or free at a height. */
  _anchorOf(s) {
    if (s.mount === 'wall' && s.wall)
      return { pos: [s.wall.p[0] + s.wall.n[0] * 0.06, s.wall.p[1], s.wall.p[2] + s.wall.n[1] * 0.06], normal: s.wall.n };
    if (s.mount === 'free') return { pos: [s.at[0], (s.base ?? 0) + (s.y ?? 1), s.at[1]], normal: null };
    return { pos: [s.at[0], (s.base ?? 0) + 0.05, s.at[1]], normal: null };
  }

  _placeAnchors() {
    const root = this.renderRoot;
    const eng = this._engine;
    if (!root || !eng || !eng.world) return;
    for (const el of root.querySelectorAll('.rtag')) {
      let p = null;
      if (el.dataset.k === 'robot') {
        const slot = eng.robotSlot(el.dataset.robot);
        const rp = slot.robotPos;
        if (rp && slot._robot.g.visible) p = eng.project(rp.x, rp.y + 0.5, rp.z);
      } else {
        const g = this._tags && this._tags[+el.dataset.k];
        // under a visible roof the label is hidden like the room itself; in a cut-away view it always shows
        if (g && eng.visibility.levels[g.level] !== false)
          p = eng.visibility.roof ? eng.anchorScreen(`tag:${g.id}`, g.pos, null, g.level) : eng.project(...g.pos);
      }
      el.style.display = p ? '' : 'none';
      if (p) el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px) translate(-50%, -50%)`;
    }
    const list = this._entities;
    const editing = this._editing && this._section === 'entities';
    for (const el of root.querySelectorAll('.anchor')) {
      const s = list.find((x) => x.id === el.dataset.id);
      let p = null;
      let hidden = false;
      if (s && this._entityVisible(s)) {
        const a = this._anchorOf(s);
        // the label being dragged stays visible even behind a wall; an entity seen "from afar" shows over the roof
        p = this._drag === s.id || overRoof(s) ? eng.project(...a.pos) : eng.anchorScreen(s.id, a.pos, a.normal, s.level);
        // in the editor every label shows (dimmed when the house hides it): any place can be chosen and dragged
        if (!p && editing) {
          p = eng.project(...a.pos);
          hidden = !!p;
        }
      }
      if (!p) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.classList.toggle('behind', hidden);
      el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px) translate(-50%, -50%)`;
    }
  }

  _moreInfo(entityId) {
    if (this._demo && this._demo.has(entityId)) {
      // no dialog for a simulated entity: what can be switched is switched
      if (this._demo.call('homeassistant', 'toggle', { entity_id: entityId })) this._demoChanged();
      return;
    }
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _stateText(st) {
    if (!st) return '—';
    if (this._hass.formatEntityState) return this._hass.formatEntityState(st);
    const u = st.attributes && st.attributes.unit_of_measurement;
    return u ? `${st.state} ${u}` : st.state;
  }

  get _editing() {
    return this._panel === 'edit' && !!this._editors;
  }

  /** Labels of the vacuum run: completion of the room being cleaned, tick on the rooms just finished, alarm on the robot. */
  _renderTags() {
    if (this._status !== 'ready' || !this._vacs) return nothing;
    const ctls = [...this._vacs.values()].filter((v) => v.tracker);
    const tags = ctls.flatMap((v) => v.tags());
    this._tags = tags;
    const errs = ctls.filter((v) => v.error);
    if (!tags.length && !errs.length) return nothing;
    return html`<div class="anchors">
      ${tags.map((g, i) => html`<div class=${`rtag ${g.kind}`} data-k=${i}>${g.text}</div>`)}
      ${errs.map((v) => html`<div class="rtag warn" data-k="robot" data-robot=${v.entity}><ha-icon icon="mdi:alert"></ha-icon></div>`)}
    </div>`;
  }

  _anchorDown(ev, s) {
    if (!this._editing) return; // normal mode: the click does the tap action
    this._section = 'entities';
    ev.stopPropagation();
    ev.preventDefault();
    this._entSel = s.id;
    this._drag = s.id;
    this._dragMoved = false;
    this._engine.controls.enabled = false;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    this.requestUpdate();
  }

  _anchorMove(ev, s) {
    if (this._drag !== s.id) return;
    this._dragMoved = true;
    this._editors.dragEntity(s.id, ev);
  }

  _anchorUp(ev, s) {
    if (this._drag !== s.id) return;
    this._drag = null;
    this._engine._updateControls();
    if (this._dragMoved) this._editors.endDrag(s.id);
  }

  _anchorClick(s) {
    if (this._editing) return;
    if (s.tap === 'toggle') this._hass.callService('homeassistant', 'toggle', { entity_id: s.entity });
    else if (s.tap !== 'none') this._moreInfo(s.entity);
  }

  _renderAnchors() {
    const show = this._config.show_entities ?? this._config.show_sensors ?? true;
    if (!show || this._status !== 'ready' || !this._data) return nothing;
    const list = this._entities.filter((s) => s.at && s.entity);
    if (!list.length) return nothing;
    return html`<div class="anchors">
      ${list.map((s) => {
        const st = this._hass.states[s.entity];
        const label = s.label || (st && st.attributes.friendly_name) || s.entity;
        const style = s.color ? `--c:${s.color}` : '';
        const on = st && ['on', 'open', 'unlocked', 'playing', 'home', 'heat', 'cool'].includes(st.state);
        const sel = this._editing && this._entSel === s.id;
        return html`<div
          class=${`anchor ${s.display === 'icon' ? 'icon' : 'badge'} ${on ? 'active' : ''} ${sel ? 'sel' : ''} ${this._editing ? 'edit' : ''}`}
          data-id=${s.id}
          style=${style}
          title=${`${label} : ${this._stateText(st)}`}
          @pointerdown=${(e) => this._anchorDown(e, s)}
          @pointermove=${(e) => this._anchorMove(e, s)}
          @pointerup=${(e) => this._anchorUp(e, s)}
          @click=${() => this._anchorClick(s)}
        >
          <ha-state-icon .hass=${this._hass} .stateObj=${st} .icon=${s.icon || undefined}></ha-state-icon>
          ${s.display === 'icon' ? nothing : html`<span class="v">${s.label ? html`<small>${s.label}</small> ` : nothing}${this._stateText(st)}</span>`}
        </div>`;
      })}
    </div>`;
  }

  /** HA pickers (entity with search, icon with previews) are lazy-loaded by the frontend: load them through a card editor. */
  async _loadPickers() {
    if (customElements.get('ha-icon-picker') && customElements.get('ha-entity-picker')) return;
    try {
      const helpers = await window.loadCardHelpers();
      for (const type of ['entities', 'button']) {
        const c = await helpers.createCardElement({ type, entities: [], entity: 'sun.sun' });
        if (c && c.constructor.getConfigElement) await c.constructor.getConfigElement();
      }
    } catch (e) {
      // outside of HA (test page) or very old frontend: plain inputs are used
    }
    this.requestUpdate();
  }

  _hover(info, ev) {
    if (!info || this._vacMode) {
      this._tip = null;
      return;
    }
    const rect = this.renderRoot.querySelector('.wrap').getBoundingClientRect();
    const on = info.lights.filter((l) => l.on).length;
    this._tip = {
      x: ev.clientX - rect.left + 14,
      y: ev.clientY - rect.top + 14,
      name: info.room.name,
      lights: info.lights.length ? `${on}/${info.lights.length}` : null,
      temp: info.room.temp != null ? `${info.room.temp.toFixed(1)} °C` : null,
      tap:
        this._config.tap_action === 'zoom' && this._focus !== info.room.id
          ? 'tip_zoom'
          : this._config.tap_action !== 'none' && this._areas && this._areas[info.room.id]
            ? 'tip_toggle'
            : null,
    };
  }

  // ------------------------------------------------------------ edit lock

  /** True when a password protects the editors and this page has not given it (or not lately). */
  get _lockedNow() {
    return !!(this._info && this._info.locked && this._api && !this._api.hasToken);
  }

  /** Open or close the editor / the setup: opening first asks the edit password when one is set. */
  async _guardedPanel(p) {
    if (this._panel === p) return this._togglePanel(p);
    if ((await this._ensureUnlocked()) && this._panel !== p) this._togglePanel(p);
  }

  async _ensureUnlocked() {
    let st = null;
    try {
      st = await this._api.lockState();
    } catch (e) {
      // unreachable: let the panel open, the writes will report the problem
    }
    if (st && this._info) this._info = { ...this._info, locked: !!st.locked };
    if (!st || !st.locked || st.unlocked) return true;
    return this._askUnlock();
  }

  /** Show the password dialog: resolves true once unlocked, false when cancelled. One dialog for all the callers. */
  _askUnlock() {
    if (!this._lockAsk) {
      this._lockAsk = new Promise((resolve) => {
        this._lockResolve = resolve;
      });
      this._lockDlg = { error: '', busy: false };
      this.updateComplete.then(() => {
        const input = this.renderRoot.querySelector('.lockdlg input');
        if (input) input.focus();
      });
    }
    return this._lockAsk;
  }

  _closeUnlock(ok) {
    const resolve = this._lockResolve;
    this._lockAsk = this._lockResolve = null;
    this._lockDlg = null;
    if (ok && this._info) this._info = { ...this._info, locked: true };
    if (resolve) resolve(ok);
  }

  async _submitUnlock(ev) {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const password = input.value;
    if (!password || this._lockDlg.busy) return;
    this._lockDlg = { error: '', busy: true };
    let error;
    try {
      const r = await this._api.unlock(password);
      if (r.ok) return this._closeUnlock(true);
      error = r.wait ? this._t('lock_wait').replace('{n}', r.wait) : this._t('lock_wrong');
    } catch (e) {
      error = e.message;
    }
    if (!this._lockDlg) return; // cancelled meanwhile
    this._lockDlg = { error, busy: false };
    await this.updateComplete;
    input.value = '';
    input.focus();
  }

  /** "Lock now" of the panels: save what is pending, forget the token, close the panel. */
  async _lockNow() {
    if (this._dirty) {
      clearTimeout(this._saveTimer);
      await this._save('edits');
    }
    await this._api.lock();
    if (this._panel === 'edit' || this._panel === 'setup') this._togglePanel(this._panel);
    this.requestUpdate();
  }

  _renderLock() {
    const t = this._t;
    const d = this._lockDlg;
    if (!d) return nothing;
    return html`<div class="lockdlg" @pointerdown=${(e) => e.stopPropagation()}>
      <form @submit=${(e) => this._submitUnlock(e)} @keydown=${(e) => e.key === 'Escape' && this._closeUnlock(false)}>
        <b>🔒 ${t('lock_title')}</b>
        <div class="hint">${t('lock_hint')}</div>
        <input type="password" autocomplete="off" placeholder=${t('lock_password')} ?disabled=${d.busy} />
        ${d.error ? html`<div class="lockerr">${d.error}</div>` : nothing}
        <div class="row">
          <button type="button" @click=${() => this._closeUnlock(false)}>${t('lock_cancel')}</button>
          <button type="submit" class="primary" ?disabled=${d.busy}>${t('lock_unlock')}</button>
        </div>
      </form>
    </div>`;
  }

  // ------------------------------------------------------------ panels / camera

  _togglePanel(p) {
    const next = this._panel === p ? null : p;
    if (this._panel === 'edit' && next !== 'edit' && this._editors) this._editors.stop();
    if (next === 'edit') this._loadPickers();
    if (next === 'edit' && !this._editors && this._engine) {
      this._editors = new WorldEditors(this._engine, { onChange: (persist = true) => this._edited(persist) });
      this._fenceTools = new FenceTools(this._editors);
      this._gateTools = new GateTools(this._editors);
      this._bedTools = new BedTools(this._editors);
      this._irrTools = new IrrigationTools(this._editors);
      this._vacTools = new VacuumTools(this._editors, () => this._vacCfg(this._vacuum, true));
    }
    if (next !== 'edit')
      for (const v of (this._vacs || new Map()).values()) {
        if (v.demo) v.stopDemo();
        v.showMap(false);
      }
    if (next !== 'edit') this._irrDemoStop();
    this._panel = next;
    this._pushIrrigation();
  }

  _toggleMovable() {
    this._movable = !this._movable;
    this._engine.setMovable(this._movable);
  }

  _edited(persist) {
    this._rev++;
    this._views = this._engine.views.map((v) => v.name);
    this._pushIrrigation();
    this._syncVacs(); // a robot hidden or shown again in the settings
    for (const v of (this._vacs || new Map()).values()) if (!v.demo) v.refresh();
    if (!persist) return;
    this._dirty = true;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save('edits'), SAVE_DELAY);
  }

  _setSim(patch) {
    this._sim = { ...this._sim, ...patch };
    this._pushSim();
  }

  _togglePlay(on) {
    this._sim = { ...this._sim, play: on };
    clearInterval(this._playTimer);
    this._playTimer = on ? setInterval(() => this._setSim({ hour: (this._sim.hour + 0.1) % 24 }), 200) : null; // 1 h / 2 s
  }

  // ------------------------------------------------------------ toolbar and its menu

  /**
   * Tools of the view, in the ⋮ menu unless the card puts them in the toolbar (`toolbar_buttons`): occasional view
   * tools (preview, a year, camera, simulation, demo), then the administration (editor, setup).
   */
  _toolItems(ready) {
    const t = this._t;
    return [
      {
        key: 'preview',
        group: 'view',
        icon: 'mdi:weather-snowy-rainy',
        label: t('preview'),
        on: this._panel === 'preview' || !!this._preview,
        action: () => this._togglePanel('preview'),
        show: ready,
      },
      {
        key: 'year',
        group: 'view',
        icon: 'mdi:calendar-sync',
        label: `${t('year_sim')} (${this._yearSeconds} s)`,
        on: !!this._year,
        action: () => this._toggleYear(),
        show: ready,
      },
      {
        key: 'camera',
        group: 'view',
        icon: this._movable ? 'mdi:axis-arrow' : 'mdi:lock',
        label: t(this._movable ? 'camera_lock' : 'camera_unlock'),
        on: !this._movable,
        action: () => this._toggleMovable(),
        show: ready,
        check: true,
      },
      {
        key: 'sim',
        group: 'view',
        icon: 'mdi:tune-variant',
        label: t('simulation'),
        on: this._panel === 'sim',
        action: () => this._togglePanel('sim'),
        show: ready && this._simMode,
      },
      {
        key: 'demo',
        group: 'view',
        icon: 'mdi:movie-open-play',
        label: t('demo'),
        on: this._panel === 'demo',
        action: () => this._togglePanel('demo'),
        show: ready && !!this._demo,
      },
      {
        key: 'edit',
        group: 'admin',
        icon: this._lockedNow ? 'mdi:pencil-lock' : 'mdi:pencil',
        label: t('editor'),
        on: this._panel === 'edit',
        action: () => this._guardedPanel('edit'),
        show: ready && this._isAdmin,
      },
      {
        key: 'setup',
        group: 'admin',
        icon: 'mdi:cog',
        label: t('setup'),
        on: this._panel === 'setup',
        action: () => this._guardedPanel('setup'),
        show: this._isAdmin,
      },
    ];
  }

  /** Tools the card puts in the toolbar itself (`toolbar_buttons`), the others go to the menu. */
  _inBar(key) {
    const list = this._config.toolbar_buttons;
    return Array.isArray(list) && list.includes(key);
  }

  /** The ⋮ menu: when it holds something, and not hidden from the users who are not administrators. */
  _menuShown(ready) {
    if (this._config.hide_menu && !this._isAdmin) return false;
    return this._toolItems(ready).some((it) => it.show && !this._inBar(it.key));
  }

  _toggleMenu() {
    this._menuOpen = !this._menuOpen;
    this.requestUpdate();
  }

  _renderMenu(ready) {
    const t = this._t;
    const items = this._toolItems(ready).filter((it) => it.show && !this._inBar(it.key));
    const group = (g) => items.filter((it) => it.group === g);
    const entry = (it) =>
      html`<button
        class=${`mi ${it.on ? 'on' : ''}`}
        @click=${() => {
          this._menuOpen = false;
          it.action();
          this.requestUpdate();
        }}
      >
        <ha-icon .icon=${it.icon}></ha-icon
        ><span>${it.label}</span>${it.check ? html`<span class="ck">${it.on ? '✓' : ''}</span>` : nothing}
      </button>`;
    return html`<div
        class="menu-back"
        @pointerdown=${() => {
          this._menuOpen = false;
          this.requestUpdate();
        }}
      ></div>
      <div class="menu-pop" @pointerdown=${(e) => e.stopPropagation()}>
        ${
          group('view').length
            ? html`<div class="mh">${t('menu_view')}</div>
                ${group('view').map(entry)}`
            : nothing
        }
        ${
          group('admin').length
            ? html`<div class="mh">${t('menu_admin')}</div>
                ${group('admin').map(entry)}`
            : nothing
        }
      </div>`;
  }

  // ------------------------------------------------------------ a year in a few seconds

  get _yearSeconds() {
    const v = Number(this._config.year_seconds);
    return Math.min(60, Math.max(5, Number.isFinite(v) && v > 0 ? v : 10));
  }

  /** Play the seasons of a whole year (from today, or the date shown) in `year_seconds`, then back to the date. */
  _toggleYear() {
    if (this._year) return this._endYear();
    const eng = this._engine;
    const from = eng.env.state.doy;
    const y = (this._year = { t0: performance.now(), dur: this._yearSeconds * 1000, from, doy: from });
    const step = () => {
      if (this._year !== y) return;
      const k = (performance.now() - y.t0) / y.dur;
      if (k >= 1) return this._endYear();
      const doy = ((from - 1 + Math.round(k * 365)) % 365) + 1;
      if (doy !== y.doy) {
        y.doy = doy;
        eng.setLive({ doy });
        this.requestUpdate();
      }
      y.raf = requestAnimationFrame(step);
    };
    step();
    this.requestUpdate();
  }

  _endYear() {
    const y = this._year;
    if (!y) return;
    cancelAnimationFrame(y.raf);
    this._year = null;
    // back to the date of before: the live one, the simulated one, or the forced preview
    if (this._simMode) this._pushSim();
    else if (this._preview) this._applyPreview();
    else this._engine.setLive({ doy: y.from });
    this._pushTime(true);
    this.requestUpdate();
  }

  // ------------------------------------------------------------ demo

  /** Simulation of the day used when the demo home is shown (and only then). */
  get _simMode() {
    return !!this._demo || this._config.mode === 'simulation';
  }

  _setDemo(on) {
    if (on === !!this._demo) return;
    clearInterval(this._demoTimer);
    this._demoTimer = null;
    if (on) {
      this._demo = new DemoSim();
      // a fine day of early summer, the clock running (1 h every 2 s)
      this._sim = { ...this._sim, hour: 6, doy: 160, weather: 'clear', cloud: undefined, precip: undefined };
      this._togglePlay(true);
      let last = performance.now();
      this._demoTimer = setInterval(() => {
        const now = performance.now();
        if (this._demo.tick(this._sim.hour, Math.min((now - last) / 1000, 1))) this._demoChanged();
        last = now;
      }, 200);
      this._demo.tick(this._sim.hour, 10);
    } else {
      this._demo = null;
      this._togglePlay(false);
      if (this._panel === 'demo') this._panel = null;
    }
    if (this._realHass) this.hass = this._realHass;
  }

  /** A simulated entity changed: the card sees a new hass object, as on a state change in Home Assistant. */
  _demoChanged() {
    if (this._realHass) this.hass = this._realHass;
  }

  /** Create the demo home (or put it back as shipped) and show it in this card until leaving it. */
  async _startDemo() {
    try {
      const { home } = await this._api.startDemo();
      this._api.home = home;
      this._panel = null;
      await this._reload();
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
  }

  /** The plan of the demo house, to import with "Import a .sh3d" (or to rework in Sweet Home 3D). */
  async _downloadDemoHouse() {
    try {
      const url = URL.createObjectURL(new Blob([await this._api.demoHouse()], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'demo-maison.sh3d';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
  }

  async _leaveDemo() {
    this._api.home = this._config.home || '';
    this._panel = null;
    this._setDemo(false);
    await this._reload();
  }

  _renderDemo() {
    const t = this._t;
    const d = this._demo;
    const s = this._sim;
    return html`
      <div class="hint">${t('demo_panel_hint')}</div>
      <label class="chk"
        ><input
          type="checkbox"
          .checked=${d.auto}
          @change=${(e) => {
            d.auto = e.target.checked;
            d.manual.clear();
            this.requestUpdate();
          }}
        />
        ${t('demo_auto')}</label
      >
      <label class="chk"
        ><input type="checkbox" .checked=${s.play} @change=${(e) => this._togglePlay(e.target.checked)} /> ${t('sim_play')}</label
      >
      ${this._range(
        t('sim_hour'),
        s.hour,
        0,
        23.9,
        0.1,
        (v) => this._setSim({ hour: v }),
        (v) => `${Math.floor(v)} h ${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`,
        true,
      )}
      <label>${t('demo_events')}</label>
      <div class="chips">
        ${DEMO_EVENTS.map(
          (k) =>
            html`<button
              @click=${() => {
                d.hour = s.hour;
                d.play(k);
                this._demoChanged();
              }}
            >
              ${t(`demo_ev_${k}`)}
            </button>`,
        )}
      </div>
      <button @click=${() => this._leaveDemo()}>${t('demo_leave')}</button>
    `;
  }

  // ------------------------------------------------------------ setup (admin)

  async _save(what) {
    try {
      if (what === 'scene') await this._api.setScene(this._data.scene);
      else if (what === 'edits') {
        this._dirty = false;
        if (this._engine && this._engine.edits) this._data.edits = this._engine.edits;
        await this._api.setEdits(this._data.edits);
      } else if (what === 'terrain') await (this._data.terrain ? this._api.setTerrain(this._data.terrain) : this._api.clearTerrain());
      if (Date.now() - (this._saidAt || 0) > 3000) this._msg = this._t('saved'); // keep the message of the action just done
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
  }

  /** First plan of the home: the documents already stored (edits restored, demo edits, terrain) are kept. */
  async _ensureData() {
    if (this._data) return;
    const info = (await this._api.info()) || {};
    const [terrain, edits, ortho] = await Promise.all([
      info.has_terrain ? this._api.getTerrain() : null,
      info.has_edits ? this._api.getEdits() : null,
      info.has_ortho ? this._api.getOrtho() : null,
    ]);
    this._data = { terrain, ortho, edits: edits || emptyEdits() };
  }

  /**
   * Opens the simple plan builder: on the builder model kept in the scene, or a new one (one room to start with).
   * A plan imported from a file is replaced only after a confirmation (`force`).
   */
  async _openBuilder(force = false, given = null, show = true) {
    const sc = this._data && this._data.scene;
    if (sc && !sc.builder && !force && !given) {
      this._replaceAsk = () => this._openBuilder(true);
      this.requestUpdate();
      return;
    }
    this._replaceAsk = null;
    await this._ensureData();
    let model = given ? normalizeBuilder(given) : sc && sc.builder ? normalizeBuilder(sc.builder) : null;
    if (!model) {
      model = emptyBuilder(this._t('b_ground'));
      const free = Object.values((this._hass && this._hass.areas) || {})[0];
      const r = addRoom(model, model.levels[0].id, free ? free.name : this._t('b_room'));
      if (free) r.area = free.area_id;
    }
    this._builder = model;
    this._bLevel = model.levels[0].id;
    this._bSel = model.rooms[0] ? model.rooms[0].id : null;
    this._bOpening = null;
    this._bPlace = null;
    this._bBox = null;
    if (given || !sc || !sc.builder) this._builderChanged(true);
    if (show && this._panel !== 'builder') this._togglePanel('builder');
    this.requestUpdate();
  }

  /**
   * Rooms in meters from an SVG or a robot map: into the builder when they are all rectangles, otherwise a plan of
   * polygons (walls drawn around the rooms).
   */
  async _plainPlan(levels, report, show = true) {
    const model = builderFromLevels(levels, this._t('b_ground'));
    if (model) {
      await this._openBuilder(true, model, show);
      this._report = { ...builderReport(this._builder), warnings: report.warnings };
      return;
    }
    await this._ensureData();
    this._data = { ...this._data, scene: sceneFromLevels(levels, this._homePlace.latitude, this._t('b_ground')) };
    this._report = report;
    await this._save('scene');
    this._apply();
    this._status = 'ready';
  }

  /** SVG plan at a scale (SVG units per meter); the parsed drawing stays at hand to change the scale. */
  async _svgPlan(upm) {
    const sv = this._svg;
    if (!sv) return;
    sv.upm = upm;
    const levels = svgLevels(sv.parsed, upm);
    const [x0, y0, x1, y1] = sv.parsed.bbox;
    const size = `${((x1 - x0) / upm).toFixed(1)} × ${((y1 - y0) / upm).toFixed(1)} m`;
    // the setup stays open: the scale can be corrected, the builder opened from there
    await this._plainPlan(levels, { counts: {}, warnings: [this._t('svg_size').replace('{size}', size)] }, false);
  }

  /** Plan from the rooms of a robot vacuum's map entity. */
  async _robotPlan(entity, force = false) {
    if (this._data && this._data.scene && !force) {
      this._replaceAsk = () => this._robotPlan(entity, true);
      this.requestUpdate();
      return;
    }
    this._replaceAsk = null;
    const st = this._hass.states[entity];
    const rooms = robotPlanRooms(st && st.attributes, (i) => `${this._t('b_room')} ${i}`);
    if (!rooms.length) return;
    this._svg = null;
    await this._plainPlan([{ name: this._t('b_ground'), rooms }], { counts: {}, warnings: [this._t('robot_plan_note')] });
  }

  /** The builder model changed: new scene now, 3D rebuilt a moment later, plan saved after a pause. */
  _builderChanged(now = false) {
    if (!this._builder || !this._data) return;
    this._data.scene = builderScene(this._builder, this._homePlace.latitude);
    this._report = builderReport(this._builder);
    clearTimeout(this._bApplyTimer);
    const apply = () => {
      const first = this._status !== 'ready';
      this._apply(!first);
      this._status = 'ready';
      // the house grew or shrank: the camera frames it again (on the view in use)
      const bb = this._engine.world && this._engine.world.sd ? JSON.stringify(this._engine.world.sd.bbox) : '';
      if (first || bb !== this._bFrame) this._engine.goToView(Math.min(this._view || 0, this._views.length - 1), true);
      this._bFrame = bb;
      this.requestUpdate();
    };
    if (now) apply();
    else this._bApplyTimer = setTimeout(apply, 250);
    clearTimeout(this._bSaveTimer);
    this._bSaveTimer = setTimeout(() => this._save('scene'), now ? 0 : 1500);
    this.requestUpdate();
  }

  async _onPlan(ev) {
    const input = ev.target;
    const file = input.files[0];
    if (!file) return;
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      this._svg = null;
      if (ext === 'svg') {
        const parsed = parseSvgRooms(await file.text());
        this._svg = { parsed, upm: parsed.unitsPerMeter };
        await this._svgPlan(parsed.unitsPerMeter);
        input.value = '';
        return;
      }
      const { scene, report } = ext === 'ifc' ? await importIfc(file, this._homePlace.latitude) : await importSh3d(file);
      await this._ensureData();
      this._data = { ...this._data, scene };
      this._report = report;
      await this._save('scene');
      this._apply();
      this._status = 'ready';
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    input.value = '';
  }

  async _onTerrain(ev) {
    const input = ev.target;
    const file = input.files[0];
    if (!file || !this._data) return;
    try {
      this._data.terrain = parseTerrain(await file.text());
      this._data.edits.registration = {};
      await this._save('terrain');
      await this._save('edits');
      this._apply(true);
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    input.value = '';
  }

  async _removeTerrain() {
    this._data.terrain = null;
    await this._save('terrain');
    this._apply(true);
  }

  async _calibrate() {
    try {
      const sd = normalizeScene(structuredClone(this._data.scene));
      const r = autoCalibrate(this._data.terrain, sd);
      this._data.edits.registration = {
        ...this._data.edits.registration,
        rot: r.rot,
        dx: r.dx,
        dz: r.dz,
        ...(r.base !== undefined ? { base: r.base } : {}),
        northOffsetDeg: (this._data.terrain.north || 0) + r.rot,
      };
      await this._save('edits');
      this._apply(true);
      this._msg = `${this._t('calibrate')}: ${r.rot}°, ${r.dx} / ${r.dz} m (${(r.iou * 100).toFixed(0)} %)`;
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
  }

  // ------------------------------------------------------------ terrain fetch (integration) / GitHub backup

  /** Where the home is: its own location (the demo one included), the country of Home Assistant. */
  get _homePlace() {
    const i = this._info || {};
    const cfg = this._hass.config;
    if (!Number.isFinite(i.latitude)) return cfg;
    return { latitude: i.latitude, longitude: i.longitude, country: this._demo ? null : cfg.country };
  }

  /** Same rule as the integration (sources.py): the French services in France, the worldwide ones elsewhere. */
  get _inFrance() {
    const c = this._homePlace;
    if (c.country) return ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF'].includes(String(c.country).toUpperCase());
    return c.latitude > 41 && c.latitude < 51.5 && c.longitude > -5.5 && c.longitude < 10; // metropolitan France
  }

  /** Provider that the fetch form describes: the one chosen, or the one "auto" will try first. */
  get _fetchSource() {
    const chosen = this._provider || 'auto';
    return chosen === 'auto' ? (this._inFrance ? 'ign' : 'world') : chosen;
  }

  async _startFetch(form) {
    const sd = normalizeScene(structuredClone(this._data.scene));
    const b = sd.bbox;
    const params = {
      lat: parseFloat(form.lat.value),
      lon: parseFloat(form.lon.value),
      center: [Math.round(((b.x0 + b.x1) / 2) * 100) / 100, Math.round(((b.z0 + b.z1) / 2) * 100) / 100],
      north: sd.site.northOffsetDeg || 0,
      size: parseFloat(form.size.value),
      provider: form.provider.value,
      // the surface model and the ground texture only exist with the French services: not in the form otherwise
      mns: form.mns ? form.mns.checked : false,
      vectors: form.vectors.checked,
      locate: form.locate.checked,
      photo: form.photo ? form.photo.value : 'none',
    };
    try {
      this._fetch = { state: 'running', step: 'start' };
      await this._api.startFetch(params);
      this._pollFetch();
    } catch (e) {
      this._fetch = { state: 'error', message: e.message };
    }
  }

  async _pollFetch() {
    clearTimeout(this._fetchTimer);
    try {
      const st = await this._api.fetchStatus();
      this._fetch = st;
      if (st && st.state === 'running') {
        this._fetchTimer = setTimeout(() => this._pollFetch(), 2000);
        return;
      }
      if (st && st.state === 'done') {
        const [terrain, ortho] = await Promise.all([this._api.getTerrain(), this._api.getOrtho()]);
        this._data.terrain = terrain;
        this._data.ortho = ortho;
        // a terrain that says how it sits on the plan (the demo) is not registered again
        this._data.edits.registration = terrain && terrain.registration ? { ...terrain.registration } : {};
        this._apply(true);
        if (terrain && !terrain.registration && (terrain.s || terrain.buildings)) await this._calibrate();
        else await this._save('edits');
      }
    } catch (e) {
      this._fetch = { state: 'error', message: e.message };
    }
  }

  async _github(action) {
    if (action === 'restore' && this._confirm !== 'restore') {
      this._confirm = 'restore'; // second click confirms
      this.requestUpdate();
      return;
    }
    this._confirm = null;
    this._busy = true;
    try {
      const r = await this._api.github(action);
      this._msg = `GitHub : ${r && r.message ? r.message : this._t('done')}`;
      if (action === 'restore') await this._reload();
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    this._busy = false;
  }

  async _removeOrtho() {
    this._data.ortho = null;
    try {
      await this._api.clearOrtho();
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    this._apply(true);
  }

  async _registration(patch) {
    this._data.edits.registration = { ...this._data.edits.registration, ...patch };
    await this._save('edits');
    this._apply(true);
  }

  _exportEdits() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this._data.edits, null, 1)], { type: 'application/json' }));
    a.download = 'house-view-edits.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async _importEdits(ev) {
    const input = ev.target;
    const file = input.files[0];
    if (!file) return;
    try {
      this._data.edits = normalizeEdits(JSON.parse(await file.text()));
      if (this._editors) this._editors.history.length = 0;
      this._apply(true); // the engine adopts the imported edits before they are saved
      await this._save('edits');
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    input.value = '';
  }

  // ------------------------------------------------------------ render helpers

  _range(label, val, min, max, step, onChange, fmt = (v) => Number(v).toFixed(2), live = false) {
    const ev = (e) => onChange(parseFloat(e.target.value));
    return html`<label class="rng"
      ><span>${label} <b>${fmt(val)}</b></span
      ><input
        type="range"
        min=${min}
        max=${max}
        step=${step}
        .value=${String(val)}
        @change=${live ? nothing : ev}
        @input=${live ? ev : nothing}
    /></label>`;
  }

  _renderSetup() {
    const t = this._t;
    const reg = (this._data && this._data.edits.registration) || {};
    const eng = this._engine;
    const unmapped = this._areas && eng ? eng.rooms.filter((r) => !this._areas[r.id]).map((r) => r.name) : [];
    const terr = this._data && this._data.terrain;
    const chk = (key, label, def) =>
      html`<label class="chk"
        ><input type="checkbox" .checked=${reg[key] ?? def} @change=${(e) => this._registration({ [key]: e.target.checked })} />
        ${label}</label
      >`;
    return html`
      <details ?open=${!!this._demo}>
        <summary>${t('demo')}</summary>
        <div class="hint">${t(this._demo ? 'demo_on_hint' : 'demo_hint')}</div>
        <div class="row">
          <button @click=${() => this._startDemo()}>${t(this._demo ? 'demo_reset' : 'demo_start')}</button>
          ${this._demo ? html`<button @click=${() => this._downloadDemoHouse()}>${t('demo_download')}</button>` : nothing}
          ${this._demo ? html`<button @click=${() => this._leaveDemo()}>${t('demo_leave')}</button>` : nothing}
        </div>
      </details>
      <details open>
        <summary>${t('plan')}</summary>
        <label class="file">${t('import_plan')}<input type="file" accept=".sh3d,.xml,.ifc,.svg" @change=${this._onPlan} /></label>
        <div class="hint">${t('import_plan_hint')}</div>
        <div class="row">
          <button @click=${() => this._openBuilder()}>
            ${t(this._data && this._data.scene && this._data.scene.builder ? 'b_edit' : 'b_create')}
          </button>
          ${robotMapsWithRooms(this._hass && this._hass.states).map(
            (m) => html`<button title=${m.name} @click=${() => this._robotPlan(m.entity)}>${t('robot_plan')} (${m.count})</button>`,
          )}
        </div>
        ${
          this._svg
            ? html`<label class="bnum"
                >${t('svg_scale')}<input
                  type="number"
                  min="0.001"
                  step="any"
                  .value=${String(+this._svg.upm.toFixed(4))}
                  @change=${(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0) this._svgPlan(v);
                  }}
              /></label>`
            : nothing
        }
        ${
          this._replaceAsk
            ? html`<div class="report">
                ${t('b_replace')}
                <div class="row">
                  <button @click=${() => this._replaceAsk()}>${t('b_replace_ok')}</button>
                  <button @click=${() => ((this._replaceAsk = null), this.requestUpdate())}>${t('lock_cancel')}</button>
                </div>
              </div>`
            : nothing
        }
        ${
          this._report
            ? html`<div class="report">
                ${Object.entries(this._report.counts)
                  .map(([k, v]) => `${k} : ${v}`)
                  .join(' · ')}
                <ul>
                  ${this._report.warnings.map((w) => html`<li>${w}</li>`)}
                </ul>
              </div>`
            : nothing
        }
        ${this._data && this._data.scene && this._data.scene.models ? chk('showModels', t('show_models'), true) : nothing}
        ${unmapped.length ? html`<div class="report">${t('rooms_unmapped')} : ${unmapped.join(', ')}</div>` : nothing}
      </details>
      ${
        this._data && this._data.scene
          ? html`<details ?open=${!terr}>
                <summary>${t('terrain')}</summary>
                ${this._renderFetch()}
                <label class="file"
                  >${t('import_terrain')}<input type="file" accept=".json,application/json" @change=${this._onTerrain}
                /></label>
                ${
                  terr && (terr.source || terr.attribution)
                    ? html`<div class="hint">${t('terrain_source')} : ${[terr.source, terr.attribution].filter(Boolean).join(' — ')}</div>`
                    : nothing
                }
                ${
                  terr
                    ? html`<div class="row">
                          <button @click=${this._removeTerrain}>${t('remove_terrain')}</button>
                          <button @click=${this._calibrate}>${t('calibrate')}</button>
                        </div>
                        ${terr.s ? chk('showMns', t('show_mns'), false) : nothing}
                        ${terr.s ? chk('showTrees', t('show_dsm_trees'), true) : nothing}
                        ${terr.buildings || terr.parcels || terr.roads ? chk('showVec', t('show_vec'), false) : nothing}
                        ${terr.roads ? chk('showRoads', t('show_roads'), true) : nothing}
                        ${
                          this._data.ortho
                            ? html`${chk('showPhoto', t(this._data.ortho.kind === 'plan' ? 'show_plan' : 'show_photo'), true)}
                                <button @click=${this._removeOrtho}>${t('remove_photo')}</button>`
                            : nothing
                        }
                        ${this._range(t('base'), reg.base ?? 0, -3, 12, 0.05, (v) => this._registration({ base: v }))}
                        ${this._range(
                          t('rot'),
                          reg.rot ?? 0,
                          -180,
                          180,
                          0.1,
                          (v) => this._registration({ rot: v }),
                          (v) => `${Number(v).toFixed(1)}°`,
                        )}
                        ${this._range(
                          t('dx'),
                          reg.dx ?? 0,
                          -15,
                          15,
                          0.1,
                          (v) => this._registration({ dx: v }),
                          (v) => `${Number(v).toFixed(1)} m`,
                        )}
                        ${this._range(
                          t('dz'),
                          reg.dz ?? 0,
                          -15,
                          15,
                          0.1,
                          (v) => this._registration({ dz: v }),
                          (v) => `${Number(v).toFixed(1)} m`,
                        )}`
                    : nothing
                }
              </details>
              <details>
                <summary>${t('backup')}</summary>
                ${
                  this._info && this._info.github
                    ? html`<div class="hint">${t('github_hint')} ${this._info.github}</div>
                        <div class="row">
                          <button ?disabled=${this._busy} @click=${() => this._github('backup')}>${t('github_backup')}</button>
                          <button ?disabled=${this._busy} @click=${() => this._github('restore')}>
                            ${this._confirm === 'restore' ? t('github_confirm') : t('github_restore')}
                          </button>
                        </div>`
                    : html`<div class="hint">${t('github_setup')}</div>`
                }
              </details>
              <details>
                <summary>${t('lock_section')}</summary>
                <div class="hint">${t(this._info && this._info.locked ? 'lock_on' : 'lock_off')} ${t('lock_where')}</div>
              </details>
              <details>
                <summary>${t('edits')}</summary>
                <div class="row">
                  <button @click=${this._exportEdits}>${t('export')}</button>
                  <label class="file"
                    >${t('import')}<input type="file" accept=".json,application/json" @change=${this._importEdits}
                  /></label>
                </div>
              </details>`
          : nothing
      }
    `;
  }

  _renderFetch() {
    const t = this._t;
    const c = this._homePlace;
    const f = this._fetch;
    const running = f && f.state === 'running';
    const src = this._fetchSource;
    const french = src === 'ign';
    return html`<form
      class="fetch"
      @submit=${(e) => {
        e.preventDefault();
        this._startFetch(e.target);
      }}
    >
      <div class="hint">${t(`fetch_hint_${src}`)}</div>
      <div class="grid">
        <span>${t('fetch_provider')}</span>
        <select
          name="provider"
          @change=${(e) => {
            this._provider = e.target.value;
          }}
        >
          ${['auto', 'ign', 'world'].map(
            (v) => html`<option value=${v} ?selected=${v === (this._provider || 'auto')}>${t(`fetch_provider_${v}`)}</option>`,
          )}
        </select>
        <span>${t('lat')}</span><input name="lat" type="number" step="0.000001" .value=${String(c.latitude)} /> <span>${t('lon')}</span
        ><input name="lon" type="number" step="0.000001" .value=${String(c.longitude)} />
        <span>${t('fetch_size')}</span>
        <select name="size">
          ${[80, 120, 200].map((v) => html`<option value=${v} ?selected=${v === 120}>${v} m</option>`)}
        </select>
        ${
          french
            ? html`<span>${t('fetch_photo')}</span>
                <select name="photo">
                  ${['ortho', 'plan', 'none'].map((v) => html`<option value=${v}>${t(`photo_${v}`)}</option>`)}
                </select>`
            : nothing
        }
      </div>
      <label class="chk"><input name="locate" type="checkbox" checked /> ${t('fetch_locate')}</label>
      ${french ? html`<label class="chk"><input name="mns" type="checkbox" checked /> ${t('fetch_mns')}</label>` : nothing}
      <label class="chk"><input name="vectors" type="checkbox" checked /> ${t(french ? 'fetch_vectors' : 'fetch_vectors_world')}</label>
      <button type="submit" ?disabled=${running}>${t('fetch_go')}</button>
      ${
        f
          ? html`<div class=${f.state === 'error' ? 'hint err' : 'hint'}>
              ${f.state === 'running' ? `${t('fetch_running')} ${f.step ? `(${f.step})` : ''}` : f.state === 'done' ? t('fetch_done') : ''}
              ${f.message || ''}
            </div>`
          : nothing
      }
    </form>`;
  }

  _renderEntities() {
    const t = this._t;
    const ed = this._editors;
    // the layer being edited: the room zoomed on, or the general view
    const layer = this._focus || null;
    const list = this._entities.filter((s) => (layer ? s.scope === 'room' && entityRoom(s) === layer : s.scope !== 'room'));
    const layerName = layer && (this._engine.rooms.find((r) => r.id === layer) || {}).name;
    const eng = this._engine;
    const hass = this._hass;
    const where = (s) => {
      if (!s.at) return t('entity_unplaced');
      const lv = s.level && eng.world.sd.levels.find((l) => l.id === s.level);
      const room = s.room && eng.rooms.find((r) => r.id === s.room);
      return [lv && (lv.name || lv.id), room && room.name].filter(Boolean).join(' · ') || t('outside');
    };
    const add = (id) => {
      if (!id || !hass.states[id]) return;
      this._entSel = ed.addEntity(id);
      // added while zoomed on a room: it belongs to the layer of that room, placed at once
      if (layer) ed.editEntity(this._entSel, { scope: 'room', layer, room: layer });
      ed.placeEntity(this._entSel);
    };
    const entityPicker = html`<house-view-entity-picker
      .hass=${hass}
      .value=${''}
      .area=${this._currentArea()}
      .label=${t('entity_add')}
      @value-changed=${(e) => add(e.detail.value)}
    ></house-view-entity-picker>`;
    const iconPicker = (s) => this._iconInput(s.icon, (icon) => ed.editEntity(s.id, { icon }));
    const select = (s, key, values, def) =>
      html`<select @change=${(e) => ed.editEntity(s.id, { [key]: e.target.value })}>
        ${values.map((v) => html`<option value=${v} ?selected=${(s[key] || def) === v}>${t(`${key}_${v}`)}</option>`)}
      </select>`;
    const num = (s, key, def, step = 0.1) =>
      html`<input
        type="number"
        step=${step}
        .value=${String(s[key] ?? def)}
        @change=${(e) => ed.editEntity(s.id, { [key]: parseFloat(e.target.value) || 0 })}
      />`;
    return html`<div class=${`layer-hint ${layer ? 'room' : ''}`}>
        ${layer ? html`<b>${t('layer_room')} : ${layerName || layer}</b><br />${t('layer_room_hint')}` : t('layer_general_hint')}
      </div>
      ${entityPicker}
      ${ed.placing ? html`<div class="hint">${t(this._ent(ed.placing)?.mount === 'wall' ? 'entity_place_wall' : 'entity_place_hint')}</div>` : nothing}
      ${list.map((s) => {
        const open = this._entSel === s.id;
        const st = hass.states[s.entity];
        const light = s.entity.startsWith('light.');
        return html`<div class=${`ent ${open ? 'open' : ''}`}>
          <div
            class="ent-head"
            @click=${() => {
              this._entSel = open ? null : s.id;
              this.requestUpdate();
            }}
          >
            <ha-state-icon .hass=${hass} .stateObj=${st} .icon=${s.icon || undefined}></ha-state-icon>
            <span class="grow">${s.label || (st && st.attributes.friendly_name) || s.entity}</span>
            <span class="hint">${where(s)}</span>
            <span>${open ? '▾' : '▸'}</span>
          </div>
          ${
            open
              ? this._asWindow(
                  s.label || (st && st.attributes.friendly_name) || s.entity,
                  html`<div class="grid">
                      <span>${t('entity_label')}</span
                      ><input type="text" .value=${s.label || ''} @change=${(e) => ed.editEntity(s.id, { label: e.target.value })} />
                      <span>${t('entity_mount')}</span>${select(s, 'mount', ['floor', 'wall', 'free'], 'floor')}
                      ${s.mount === 'free' ? html`<span>${t('entity_y')}</span>${num(s, 'y', 1)}` : nothing}
                      <span>${t('entity_display')}</span>${select(s, 'display', ['badge', 'icon'], 'badge')}
                      ${
                        layer
                          ? nothing
                          : html`<span>${t('entity_scope')}</span>
                              <select
                                @change=${(e) =>
                                  // into the layer of its room: shown only when zoomed on it
                                  ed.editEntity(
                                    s.id,
                                    e.target.value === 'room' ? { scope: 'room', layer: s.room } : { scope: e.target.value },
                                  )}
                              >
                                ${['general', 'level', 'room'].map(
                                  (v) =>
                                    html`<option
                                      value=${v}
                                      ?selected=${(s.scope === 'far' ? 'general' : s.scope || 'general') === v}
                                      ?disabled=${(v === 'level' && !s.level) || (v === 'room' && !s.room)}
                                    >
                                      ${t(`scope_${v}`)}
                                    </option>`,
                                )}
                              </select>`
                      }
                      ${
                        layer
                          ? nothing
                          : html`<span>${t('entity_over_roof')}</span
                              ><input
                                type="checkbox"
                                .checked=${overRoof(s)}
                                @change=${(e) => ed.editEntity(s.id, { overRoof: e.target.checked, ...(s.scope === 'far' ? { scope: 'general' } : {}) })}
                              />`
                      } <span>${t('entity_tap')}</span>${select(s, 'tap', ['more-info', 'toggle', 'none'], 'more-info')}
                      <span>${t('color')}</span
                      ><input
                        type="color"
                        .value=${s.color || '#03a9f4'}
                        @change=${(e) => ed.editEntity(s.id, { color: e.target.value })}
                      />
                      ${
                        light
                          ? html`<span>${t('entity_kind')}</span
                              >${select(s, 'kind', ['spot', 'pendant', 'lamp', 'strip', 'none', 'off'], 'spot')}
                              ${s.mount === 'wall' ? nothing : html`<span>${t('entity_lighty')}</span>${num(s, 'lightY', 2.3)}`}
                              <span>${t('entity_radius')}</span>${num(s, 'radius', 4.5, 0.5)}`
                          : nothing
                      }
                    </div>
                    <label>${t('entity_icon')}</label>${iconPicker(s)}
                    <div class="hint">${t(light ? 'entity_light_hint' : 'entity_drag_hint')}</div>
                    <div class="row">
                      <button class=${ed.placing === s.id ? 'on' : ''} @click=${() => ed.placeEntity(ed.placing === s.id ? null : s.id)}>
                        ${t('entity_place')}
                      </button>
                      <button @click=${() => ed.deleteEntity(s.id)}>${t('delete')}</button>
                    </div>`,
                  () => {
                    this._entSel = null;
                  },
                )
              : nothing
          }
        </div>`;
      })}`;
  }

  _ent(id) {
    return this._entities.find((x) => x.id === id);
  }

  _renderOutdoor() {
    const t = this._t;
    const ed = this._editors;
    const list = (this._engine.world && this._engine.world.outdoor) || [];
    if (!list.some((x) => x.id === this._outSel)) this._outSel = list.length ? list[0].id : '';
    const it = list.find((x) => x.id === this._outSel);
    const set = (patch) => ed.outdoorEdit(it.id, patch);
    const m = (v) => `${Number(v).toFixed(2)} m`;
    return html` ${
      list.length
        ? html`<select
              @change=${(e) => {
                this._outSel = e.target.value;
                this._rev++;
              }}
            >
              ${list.map((x) => html`<option value=${x.id} ?selected=${x.id === this._outSel}>${x.id.replace('#1', '')}</option>`)}
            </select>
            ${
              it
                ? html`<label class="chk"
                      ><input type="checkbox" .checked=${it.hidden} @change=${(e) => set({ hidden: e.target.checked })} />
                      ${t('hide')}</label
                    >
                    ${this._range(t('out_dy'), it.dy, -3, 3, 0.05, (v) => set({ dy: v }), m)}
                    ${this._range(t('dx'), it.dx, -10, 10, 0.1, (v) => set({ dx: v }), m)}
                    ${this._range(t('dz'), it.dz, -10, 10, 0.1, (v) => set({ dz: v }), m)}
                    ${this._range(
                      t('rotation'),
                      it.rot,
                      -180,
                      180,
                      1,
                      (v) => set({ rot: v }),
                      (v) => `${Number(v).toFixed(0)}°`,
                    )}
                    <div class="hint">
                      ${t('out_ground')} : ${Number.isFinite(it.ground) ? it.ground.toFixed(2) : '0'} m · SH3D : ${it.sh3dLevel || '?'}
                    </div>
                    <button @click=${() => set({ dx: 0, dz: 0, dy: 0, rot: 0, hidden: false })}>${t('reset')}</button>`
                : nothing
            }`
        : html`<div class="hint">${t('no_outdoor')}</div>`
    }
    ${this._range(t('pool_dy'), this._data.edits.pool.dy, -1.5, 1.5, 0.02, (v) => ed.poolDy(v), m)}`;
  }

  _renderTrees() {
    const t = this._t;
    const ed = this._editors;
    const info = ed.treeInfo();
    return html` <select @change=${(e) => ed.setTreeMode(e.target.value)}>
        ${['off', 'delete', 'add'].map((m) => html`<option value=${m} ?selected=${ed.treeMode === m}>${t(`tree_${m}`)}</option>`)}
      </select>
      ${
        ed.treeMode === 'add'
          ? html`<div class="row">
              <select
                @change=${(e) => {
                  const sp = e.target.value;
                  ed.setTreeParams({ species: sp, h: SPECIES[sp].height });
                  this._rev++;
                }}
              >
                ${Object.entries(SPECIES)
                  .filter(([, v]) => !v.hidden)
                  .map(([k, v]) => html`<option value=${k} ?selected=${ed.treeAdd.species === k}>${v.name}</option>`)}
              </select>
              <input
                type="number"
                min=${(SPECIES[ed.treeAdd.species] || {}).minHeight ?? 1}
                max=${(SPECIES[ed.treeAdd.species] || {}).maxHeight ?? 30}
                step="0.5"
                .value=${String(ed.treeAdd.h)}
                @change=${(e) => ed.setTreeParams({ h: parseFloat(e.target.value) || 8 })}
              />
              m
            </div>`
          : nothing
      }
      ${ed.treeMode !== 'off' ? html`<div class="hint">${t(`tree_hint_${ed.treeMode}`)}</div>` : nothing}
      <div class="row">
        <button ?disabled=${!ed.history.length} @click=${() => ed.treeUndo()}>${t('undo')}</button>
        <button @click=${() => ed.treeReset()}>${t('tree_reset')}</button>
      </div>
      <div class="hint">${info.count} ${t('tree_count')} · ${info.removed} ${t('tree_removed')} · ${info.added} ${t('tree_added')}</div>`;
  }

  _renderGround() {
    const t = this._t;
    const ed = this._editors;
    const tool = ed.tool;
    const ops = this._data.edits.terrain;
    if (this._opSel >= ops.length || (this._opSel < 0 && ops.length)) this._opSel = ops.length - 1;
    const op = ops[this._opSel];
    const opName = (o, i) => {
      const n = ops.slice(0, i + 1).filter((x) => x.type === o.type).length;
      if (o.type === 'wall') return `${t('op_wall')} ${n} (${o.lo.toFixed(2)} → ${o.hi.toFixed(2)} m)`;
      if (o.type === 'terrace') return `${t('op_terrace')} ${n} (${o.alt.toFixed(2)} m)`;
      return `${t('op_brush')} ${n} (${t(`brush_${o.mode}`)})`;
    };
    if (!this._engine.terrainCfg) {
      return html` <div class="hint">${t('ground_needs_terrain')}</div>`;
    }
    const brush = tool.mode.startsWith('brush');
    return html` <select @change=${(e) => ed.setTool(e.target.value)}>
        ${TOOLS.map((m) => html`<option value=${m} ?selected=${tool.mode === m}>${t(`tool_${m}`)}</option>`)}
      </select>
      ${
        brush
          ? html`<div class="row">
              <span>${t('op_r')}</span
              ><input
                type="number"
                min="0.5"
                max="20"
                step="0.5"
                .value=${String(tool.r)}
                @change=${(e) => ed.setToolParams({ r: parseFloat(e.target.value) || 3 })}
              />
              <span>${t(`brush_v_${tool.mode.slice(6)}`)}</span
              ><input
                type="number"
                step="0.05"
                .value=${Number.isFinite(tool.v) ? String(tool.v) : ''}
                @change=${(e) => ed.setToolParams({ v: parseFloat(e.target.value) })}
              />
            </div>`
          : nothing
      }
      ${
        tool.mode === 'wall' || tool.mode === 'terrace'
          ? html`<div class="row">
              <button ?disabled=${tool.pts.length < (tool.mode === 'wall' ? 2 : 3)} @click=${() => ed.finishDraft()}>
                ${t('finish')} (${tool.pts.length})
              </button>
              <button @click=${() => ed.cancelDraft()}>${t('cancel')}</button>
            </div>`
          : nothing
      }
      ${tool.mode !== 'off' ? html`<div class="hint">${t(`tool_hint_${tool.mode}`)}</div>` : nothing}
      <label>${t('ops')}</label>
      ${
        ops.length
          ? html`<select
                @change=${(e) => {
                  this._opSel = parseInt(e.target.value, 10);
                  ed.selectOp(this._opSel);
                  this._rev++;
                }}
              >
                ${ops.map((o, i) => html`<option value=${i} ?selected=${i === this._opSel}>${opName(o, i)}</option>`)}
              </select>
              ${
                op
                  ? html`<div class="grid">
                        ${OP_FIELDS[op.type].map(
                          ([key, label, step]) =>
                            html`<span>${key === 'value' ? t(`brush_v_${op.mode}`) : t(label)}</span
                              ><input
                                type="number"
                                step=${step}
                                .value=${String(op[key])}
                                @change=${(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v)) ed.editOp(this._opSel, { [key]: v });
                                }}
                              />`,
                        )}
                      </div>
                      <div class="row">
                        <button @click=${() => ed.deleteOp(this._opSel)}>${t('delete')}</button>
                        ${
                          op.type === 'wall'
                            ? html`<button @click=${() => ed.flipOp(this._opSel)}>${t('flip')}</button>
                                <button @click=${() => ed.sectionOfOp(this._opSel)}>${t('section')}</button>`
                            : nothing
                        }
                      </div>`
                  : nothing
              }`
          : html`<div class="hint">${t('no_ops')}</div>`
      }
      ${
        ed.section
          ? html`<canvas id="section" width="300" height="140"></canvas>
              <div class="hint">${t('section_legend')}</div>`
          : nothing
      }`;
  }

  _renderViewsEditor() {
    const t = this._t;
    return html` <div class="hint">${t('views_hint')}</div>
      ${this._views.map(
        (n, i) =>
          html`<div class="row">
            <button class="grow" @click=${() => this._goView(i)}>${n}</button>
            <button
              title=${t('delete')}
              @click=${() => {
                this._engine.deleteView(i);
                this._edited(true);
              }}
            >
              ✕
            </button>
          </div>`,
      )}
      <div class="row">
        <input id="viewName" type="text" placeholder=${t('view_name')} />
        <button
          @click=${() => {
            const inp = this.renderRoot.querySelector('#viewName');
            this._view = this._engine.saveView(inp.value.trim());
            inp.value = '';
            this._edited(true);
          }}
        >
          ${t('save_view')}
        </button>
      </div>`;
  }

  _renderEdit() {
    if (!this._editors || !this._engine.world) return nothing;
    const t = this._t;
    // entities of the layer being edited: the room zoomed on, or the general view
    const inLayer = this._entities.filter((s) => (this._focus ? s.scope === 'room' && entityRoom(s) === this._focus : s.scope !== 'room'));
    return html`${this._sec('entities', `${t('entities')} (${inLayer.length})`, () => this._renderEntities())}
    ${this._sec('general', `${t('general')} (${this._data.edits.panel.length})`, () => renderGeneralEditor(this))}
    ${this._sec('alarms', t('alarms'), () => renderAlarmsEditor(this))}
    ${this._sec('zones', `${t('zones')} (${this._data.edits.zones.length})`, () => renderZonesEditor(this))}
    ${this._sec('rooms', t('rooms'), () => renderRooms(this))} ${this._sec('openings', t('openings'), () => renderOpenings(this))}
    ${this._sec('pools', `${t('pools')} (${this._data.edits.pools.length})`, () => renderPools(this))}
    ${this._vacuum ? this._sec('vacuum', t('vac_setup'), () => renderVacuumSetup(this)) : nothing}
    ${this._sec('irrigation', t('irrigation'), () => renderIrrigation(this))} ${this._sec('fences', t('fences'), () => renderFences(this))}
    ${this._sec('gates', `${t('gates')} (${this._data.edits.gates.length})`, () => renderGates(this))}
    ${this._sec('beds', `${t('beds')} (${this._data.edits.beds.length})`, () => renderBeds(this))}
    ${this._sec('outdoor', t('outdoor'), () => this._renderOutdoor())} ${this._sec('trees', t('trees'), () => this._renderTrees())}
    ${this._sec('ground', t('ground'), () => this._renderGround())} ${this._sec('views', t('views'), () => this._renderViewsEditor())}`;
  }

  _renderSim() {
    const t = this._t;
    const s = this._sim;
    const env = this._engine && this._engine.env;
    const st = env ? env.state : {};
    const pct = (v) => `${Math.round(v * 100)} %`;
    return html`
      ${this._range(t('sim_hour'), s.hour, 0, 24, 0.05, (v) => this._setSim({ hour: v }), fmtHour, true)}
      <label class="chk"
        ><input type="checkbox" .checked=${s.play} @change=${(e) => this._togglePlay(e.target.checked)} /> ${t('sim_play')}</label
      >
      ${this._range(
        t('sim_date'),
        s.doy,
        1,
        365,
        1,
        (v) => this._setSim({ doy: v }),
        (v) => `${fmtDoy(v, this._hass.language)} · ${t(`season_${seasonKey(v, this._climate)}`)}`,
        true,
      )}
      <label
        >${t('sim_weather')}<select
          @change=${(e) =>
            this._setSim({
              weather: e.target.value,
              cloud: undefined,
              precip: undefined,
              wind: undefined,
              temp: undefined,
              snowCover: undefined,
            })}
        >
          ${Object.entries(WEATHER_PRESETS).map(([k, p]) => html`<option value=${k} ?selected=${k === s.weather}>${p.label}</option>`)}
        </select></label
      >
      ${this._range(t('sim_cloud'), s.cloud ?? st.cloud ?? 0, 0, 1, 0.01, (v) => this._setSim({ cloud: v }), pct, true)}
      ${this._range(t('sim_precip'), s.precip ?? st.precip ?? 0, 0, 1, 0.01, (v) => this._setSim({ precip: v }), pct, true)}
      ${this._range(t('sim_wind'), s.wind ?? st.wind ?? 0, 0, 1, 0.01, (v) => this._setSim({ wind: v }), pct, true)}
      ${this._range(
        t('sim_wind_bearing'),
        s.windBearing ?? st.windBearing ?? 270,
        0,
        355,
        5,
        (v) => this._setSim({ windBearing: v }),
        (v) => `${t('compass').split(',')[compassIndex(v)]} · ${v}°`,
        true,
      )}
      ${this._range(
        t('sim_temp'),
        s.temp ?? st.temp ?? 15,
        -10,
        35,
        1,
        (v) => this._setSim({ temp: v }),
        (v) => `${v} °C`,
        true,
      )}
      ${this._range(t('sim_snow'), s.snowCover ?? (env ? env.snowCover : 0), 0, 1, 0.01, (v) => this._setSim({ snowCover: v }), pct, true)}
    `;
  }

  _renderPreview() {
    const t = this._t;
    const p = this._preview || {};
    const sim = this._simMode;
    const chip = (kind, key, label) =>
      html`<button class=${!sim && p[kind] === key ? 'on' : ''} @click=${() => this._setPreview(kind, key)}>${label}</button>`;
    return html`
      <div class="hint">${t(sim ? 'preview_hint_sim' : 'preview_hint')}</div>
      <label>${t('preview_season')}</label>
      <div class="chips">${seasonsOf(this._climate).map((k) => chip('season', k, t(`season_${k}`)))}</div>
      <label>${t('preview_weather')}</label>
      <div class="chips">${PREVIEW.weather.map((k) => chip('weather', k, WEATHER_PRESETS[k].label))}</div>
      <label>${t('preview_hour')}</label>
      <div class="chips">${Object.keys(PREVIEW.hour).map((k) => chip('hour', k, t(`hour_${k}`)))}</div>
      ${this._preview ? html`<button @click=${() => this._endPreview()}>${t('preview_live')}</button>` : nothing}
    `;
  }

  _renderVacuum() {
    const t = this._t;
    const id = this._vacuum;
    if (!this._vacMode || !id) return nothing;
    const st = this._hass.states[id];
    const active = VACUUM_ACTIVE.has(st.state);
    const names = [...this._vacSel].map((r) => (this._engine.rooms.find((x) => x.id === r) || {}).name).filter(Boolean);
    const ctl = this._vac;
    const total = ctl ? ctl.total() : null;
    const room = ctl ? ctl.activeRoom() : null;
    return html`<div class="vacbar" @pointerdown=${(e) => e.stopPropagation()}>
      <div>
        <b>${st.attributes.friendly_name || id}</b> · ${this._stateText(st)}
        ${st.attributes.battery_level != null ? html` · 🔋 ${st.attributes.battery_level} %` : nothing}
      </div>
      ${
        total !== null
          ? html`<div>
              ${t('vac_progress')} ${Math.round(total * 100)} %${room ? ` · ${room.name} ${Math.round(room.pct * 100)} %` : ''}
              ${ctl.sim ? html`<span class="hint"> · ${t('vac_estimated')}</span>` : nothing}
            </div>`
          : nothing
      }
      ${ctl && ctl.error ? html`<div class="hint err">⚠ ${ctl.errorText || t('vac_error')}</div>` : nothing}
      <div class="hint">${names.length ? names.join(', ') : t('vac_pick')}</div>
      ${this._vacMsg ? html`<div class="hint err">${this._vacMsg}</div>` : nothing}
      <div class="row">
        <button class="primary" ?disabled=${!names.length} @click=${() => this._vacClean()}>${t('vac_clean')} (${names.length})</button>
        <button @click=${() => this._vacCall(active ? 'pause' : 'start')}>${t(active ? 'vac_pause' : 'vac_start')}</button>
        <button @click=${() => this._vacCall('return_to_base')}>${t('vac_dock')}</button>
        <button @click=${() => this._toggleVacMode()}>✕</button>
      </div>
    </div>`;
  }

  _goView(i) {
    this._view = i;
    this._focus = null;
    this._engine.goToView(i);
    this._rev++;
  }

  _renderLeft() {
    if (this._status !== 'ready' || !this._engine || !this._engine.world) return nothing;
    return html`<div class="left">${this._renderLevels()} ${renderGeneral(this)}</div>`;
  }

  _renderLevels() {
    const eng = this._engine;
    if (!this._config.show_levels || this._status !== 'ready' || !eng || !eng.world) return nothing;
    const t = this._t;
    const vis = eng.visibility;
    const chip = (label, on, cb) => html`<button class=${on ? 'on' : ''} @click=${cb}>${label}</button>`;
    return html`<div class="levels">
      ${eng.world.roof ? chip(t('roof'), vis.roof, () => (eng.setRoof(!vis.roof), this._rev++)) : nothing}
      ${
        eng.world.sd.levels.length > 1
          ? eng.world.sd.levels.map((lv) =>
              chip(lv.name || lv.id, vis.levels[lv.id] !== false, () => (eng.setLevel(lv.id, vis.levels[lv.id] === false), this._rev++)),
            )
          : nothing
      }
      ${eng.hasTemps ? chip('🌡', eng.layer === 'temp', () => (eng.setLayer(eng.layer === 'temp' ? 'none' : 'temp'), this._rev++)) : nothing}
    </div>`;
  }

  _renderPanel() {
    const t = this._t;
    if (!this._panel) return nothing;
    const title = {
      setup: t('setup'),
      edit: t('editor'),
      sim: t('simulation'),
      preview: t('preview'),
      demo: t('demo'),
      builder: t('b_title'),
    }[this._panel];
    const body = {
      setup: () => this._renderSetup(),
      edit: () => this._renderEdit(),
      sim: () => this._renderSim(),
      preview: () => this._renderPreview(),
      demo: () => this._renderDemo(),
      builder: () => renderBuilder(this),
    }[this._panel]();
    return html`<div class=${this._panel === 'builder' ? 'panel wide' : 'panel'} @pointerdown=${(e) => e.stopPropagation()}>
      <div class="head">
        <b>${title}</b>
        <span>
          ${
            this._info && this._info.locked && ['setup', 'edit', 'builder'].includes(this._panel)
              ? html`<button class="x" title=${t('lock_now')} @click=${() => this._lockNow()}>🔒</button>`
              : nothing
          }
          <button class="x" @click=${() => this._togglePanel(this._panel)}>✕</button>
        </span>
      </div>
      ${body}
      ${
        this._msg && ['setup', 'edit', 'builder'].includes(this._panel)
          ? html`<div class=${this._msg.startsWith(t('error')) ? 'msg bad' : 'msg'}>${this._msg}</div>`
          : nothing
      }
    </div>`;
  }

  render() {
    const t = this._t;
    const ready = this._status === 'ready';
    this._winSec = null;
    this._winItem = null;
    const tb = (icon, title, active, cb, show = true) =>
      show
        ? html`<button class=${`tb ${active ? 'on' : ''}`} title=${title} @click=${cb}><ha-icon .icon=${icon}></ha-icon></button>`
        : nothing;
    // one button per robot: a tap chooses it and shows its panel (again: hides it)
    const vacBtn = (vac) => {
      const ctl = this._vacs && this._vacs.get(vac);
      const vacSt = this._hass.states[vac];
      const vacTotal = ctl ? ctl.total() : null;
      const vacErr = !!(ctl && ctl.error);
      const on = this._vacMode && this._vacuum === vac;
      return html`<button
        class=${`tb vac ${on ? 'on' : ''} ${vacErr ? 'err' : ''} ${vacTotal === null && VACUUM_ACTIVE.has(vacSt.state) ? 'busy' : ''}`}
        title=${`${vacSt.attributes.friendly_name || vac} · ${this._stateText(vacSt)}${vacTotal !== null ? ` · ${Math.round(vacTotal * 100)} %` : ''}${vacErr ? ` · ${ctl.errorText}` : ''}`}
        @click=${() => {
          if (this._vacMode && this._vacuum !== vac) this._toggleVacMode(); // leave the rooms of the other robot
          this._vacCur = vac;
          this._toggleVacMode();
        }}
      >
        ${
          vacTotal !== null
            ? html`<svg class="ring" viewBox="0 0 40 40">
                <circle class="bg" cx="20" cy="20" r="18"></circle>
                <circle
                  class="fg"
                  cx="20"
                  cy="20"
                  r="18"
                  stroke-dasharray=${`${(vacTotal * 113.1).toFixed(1)} 113.1`}
                  transform="rotate(-90 20 20)"
                ></circle>
              </svg>`
            : nothing
        }
        <ha-icon icon=${vacErr ? 'mdi:alert' : 'mdi:robot-vacuum'}></ha-icon>
      </button>`;
    };
    return html` <ha-card>
      <div class="wrap">
        <div id="view"></div>
        ${this._renderAnchors()} ${renderZoneThumbs(this)} ${this._renderTags()} ${renderRoomAlarms(this)} ${this._renderLeft()}
        ${
          ready && this._config.show_views && this._views.length > 1
            ? html`<div class="views">
                ${this._views.map((n, i) => html`<button class=${i === this._view ? 'on' : ''} @click=${() => this._goView(i)}>${n}</button>`)}
              </div>`
            : nothing
        }
        <div class="toolbar">
          ${ready ? renderAlarmBadge(this) : nothing} ${ready ? this._vacuumIds.map(vacBtn) : nothing}
          ${this._toolItems(ready)
            .filter((it) => it.show && this._inBar(it.key))
            .map((it) => tb(it.icon, it.label, it.on, it.action))}
          ${this._menuShown(ready) ? tb('mdi:dots-vertical', t('menu'), this._menuOpen, () => this._toggleMenu()) : nothing}
        </div>
        ${this._menuOpen ? this._renderMenu(ready) : nothing}
        ${
          this._tip && !this._panel
            ? html`<div class="tip" style=${`left:${this._tip.x}px;top:${this._tip.y}px`}>
                <b>${this._tip.name}</b>
                ${this._tip.temp ? html`<br />${this._tip.temp}` : nothing}
                ${this._tip.lights ? html`<br />${this._tip.lights} ${t('lights_on')}` : nothing}
                ${this._tip.tap ? html`<br /><i>${t(this._tip.tap)}</i>` : nothing}
              </div>`
            : nothing
        }
        ${this._year ? html`<div class="year-chip">📅 ${fmtDoy(this._year.doy, this._hass.language)}</div>` : nothing}
        ${this._status === 'loading' ? html`<div class="overlay">${t('loading')}</div>` : nothing}
        ${this._status === 'error' ? html`<div class="overlay err">${this._error}</div>` : nothing}
        ${
          this._status === 'empty'
            ? html`<div class="overlay">
                <div>
                  ${t('empty')}<br />${this._isAdmin ? t('empty_admin') : ''}
                  ${this._isAdmin ? html`<br /><button class="open-setup" @click=${() => this._guardedPanel('setup')}>⚙ ${t('setup')}</button>` : nothing}
                </div>
              </div>`
            : nothing
        }
        ${
          this._editing && this._focus && ready
            ? html`<div class="layer-banner">
                ✎ ${t('layer_room')} : ${(this._engine.rooms.find((r) => r.id === this._focus) || {}).name || this._focus}
                <small>${t('layer_room_banner')}</small>
              </div>`
            : nothing
        }
        ${this._renderPanel()} ${this._renderWindows()} ${this._renderVacuum()} ${this._renderLock()}
        ${ready ? renderAlarmList(this) : nothing} ${renderAquariumDialog(this)}
        ${
          this._focus && ready && !this._vacMode
            ? html`<div class="back-row">
                <button class="back" @click=${() => this._unfocus()}>
                  ← ${(this._engine.rooms.find((r) => r.id === this._focus) || {}).name || ''}
                </button>
                ${
                  this._editing
                    ? html`<button class="back" title=${t('room_view_hint')} @click=${() => this._saveRoomView()}>
                          📷 ${t('room_view_save')}
                        </button>
                        ${
                          this._data.edits.room_views[this._focus]
                            ? html`<button class="back" @click=${() => this._deleteRoomView()}>${t('room_view_reset')}</button>`
                            : nothing
                        }`
                    : nothing
                }
              </div>`
            : nothing
        }
        ${
          this._preview && this._panel !== 'preview'
            ? html`<button class="back preview" @click=${() => this._endPreview()}>
                ${t('preview')} :
                ${[
                  this._preview.season && t(`season_${this._preview.season}`),
                  this._preview.weather && WEATHER_PRESETS[this._preview.weather].label,
                  this._preview.hour && t(`hour_${this._preview.hour}`),
                ]
                  .filter(Boolean)
                  .join(', ')}
                ✕
              </button>`
            : nothing
        }
      </div>
    </ha-card>`;
  }

  static styles = css`
    ha-card {
      overflow: hidden;
    }
    .wrap {
      position: relative;
      width: 100%;
      height: 70vh;
      background: #1b2330;
    }
    #view {
      position: absolute;
      inset: 0;
    }
    #view canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
    .overlay {
      pointer-events: none; /* never hide the toolbar / views buttons below */
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 16px;
      color: #dfe6f0;
      background: rgba(16, 21, 28, 0.7);
    }
    .overlay .open-setup {
      pointer-events: auto;
      margin-top: 12px;
      padding: 6px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: var(--primary-color, #03a9f4);
      color: #fff;
      font: inherit;
      cursor: pointer;
    }
    .overlay.err {
      color: #ff9b9b;
    }
    .views {
      position: absolute;
      left: 8px;
      bottom: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-width: calc(100% - 60px);
    }
    /* left column: the level buttons, then the general sensors and actuators */
    .left {
      position: absolute;
      left: 8px;
      top: 8px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      max-width: calc(100% - 220px);
      max-height: calc(100% - 60px);
      pointer-events: none;
    }
    .left > * {
      pointer-events: auto;
    }
    .levels {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .general.room {
      border-top: 1px solid rgba(255, 255, 255, 0.25);
      padding-top: 6px;
    }
    .general .rname {
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    }
    .general {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      overflow-y: auto;
      max-height: 100%;
    }
    .gen {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(20, 26, 36, 0.72);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 14px;
      padding: 3px 10px 3px 6px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(4px);
      white-space: nowrap;
    }
    .gen ha-state-icon {
      --mdc-icon-size: 18px;
      display: flex;
    }
    .gen small {
      opacity: 0.7;
    }
    .gen.on ha-state-icon {
      color: #ffd54f;
    }
    .gen.alarm {
      background: rgba(198, 40, 40, 0.85);
    }
    .tb.alarm.ok {
      background: #2e7d32;
      border-color: transparent;
    }
    .tb.alarm.raised {
      background: #c62828;
      border-color: transparent;
      width: auto;
      padding: 0 8px;
      gap: 3px;
      border-radius: 16px;
      animation: alarm-pulse 1.6s ease-in-out infinite;
    }
    .tb.alarm .count {
      font-size: 12px;
      line-height: 1;
      font-weight: 600;
    }
    @keyframes alarm-pulse {
      50% {
        box-shadow: 0 0 0 4px rgba(198, 40, 40, 0.35);
      }
    }
    .ralarm {
      position: absolute;
      left: 0;
      top: 0;
      display: none;
      align-items: center;
      gap: 2px;
      pointer-events: auto;
      cursor: pointer;
      background: #c62828;
      color: #fff;
      border: 2px solid rgba(255, 255, 255, 0.85);
      border-radius: 14px;
      padding: 2px 7px 2px 4px;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
      animation: alarm-pulse 1.6s ease-in-out infinite;
    }
    .ralarm[style*='translate'] {
      display: inline-flex;
    }
    .ralarm ha-icon {
      --mdc-icon-size: 16px;
      display: flex;
    }
    .alarm-list .all {
      margin-left: auto;
      margin-right: 6px;
      text-decoration: underline;
      opacity: 0.85;
    }
    .alarm-list {
      position: absolute;
      right: 8px;
      top: 48px;
      z-index: 3;
      width: min(340px, calc(100% - 16px));
      max-height: calc(100% - 60px);
      overflow-y: auto;
      background: rgba(20, 26, 36, 0.94);
      color: #fff;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    }
    .alarm-list .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .alarm-list .al {
      display: flex;
      align-items: center;
      gap: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 0;
    }
    .alarm-list .al.left {
      opacity: 0.6;
    }
    .alarm-list button {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .alarm-list .name {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
    }
    .alarm-list .name ha-state-icon {
      color: #ff8a80;
    }
    .alarm-list .al.left ha-state-icon {
      color: inherit;
    }
    .alarm-list small {
      opacity: 0.7;
    }
    .alarm-list summary {
      cursor: pointer;
      margin-top: 6px;
      opacity: 0.8;
    }
    .zthumb {
      position: absolute;
      left: 0;
      top: 0;
      transform-origin: 0 0;
      pointer-events: none;
      overflow: hidden;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zthumb > * {
      display: block;
      flex: none;
    }
    .dialog {
      position: absolute;
      inset: 0;
      z-index: 5;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dialog .box {
      width: min(1100px, calc(100% - 24px));
      max-height: calc(100% - 24px);
      overflow: auto;
      background: var(--card-background-color, #1c1f26);
      color: var(--primary-text-color, #fff);
      border-radius: 12px;
      padding: 8px;
    }
    .dialog .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 2px 4px 8px;
    }
    .dialog .x {
      background: none;
      border: none;
      color: inherit;
      font-size: 16px;
      cursor: pointer;
    }
    .menu-back {
      position: absolute;
      inset: 0;
      z-index: 5;
    }
    .menu-pop {
      position: absolute;
      top: 46px;
      right: 8px;
      z-index: 6;
      min-width: 220px;
      background: #1a212d;
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      padding: 4px 0;
      display: flex;
      flex-direction: column;
      font-size: 13px;
    }
    .menu-pop .mh {
      padding: 6px 12px 2px;
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.6;
    }
    .menu-pop .mi {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px;
      background: none;
      border: none;
      color: inherit;
      text-align: left;
      cursor: pointer;
      font: inherit;
      --mdc-icon-size: 20px;
    }
    .menu-pop .mi span {
      flex: 1;
    }
    .menu-pop .mi:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .menu-pop .mi.on {
      color: var(--primary-color, #03a9f4);
    }
    .menu-pop .ck {
      flex: none !important;
    }
    .year-chip {
      position: absolute;
      top: 52px;
      right: 8px;
      z-index: 2;
      background: rgba(20, 26, 36, 0.82);
      color: #fff;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      pointer-events: none;
    }
    .layer-banner {
      position: absolute;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 3;
      background: rgba(198, 40, 40, 0.92);
      color: #fff;
      padding: 5px 14px;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 600;
      pointer-events: none;
      text-align: center;
    }
    .layer-banner small {
      display: block;
      font-weight: 400;
      font-size: 11px;
    }
    :is(.panel, .win) .layer-hint {
      border-left: 3px solid rgba(255, 255, 255, 0.3);
      padding: 4px 8px;
      font-size: 12px;
      opacity: 0.9;
    }
    :is(.panel, .win) .layer-hint.room {
      border-left-color: #e53935;
      background: rgba(229, 57, 53, 0.15);
    }
    :is(.panel, .win) .row-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      text-align: left;
      margin-bottom: 3px;
    }
    :is(.panel, .win) .row-btn span:first-of-type {
      flex: 1;
    }
    :is(.panel, .win) .row-btn ha-icon {
      --mdc-icon-size: 18px;
    }
    :is(.panel, .win) .swatch {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.4);
    }
    :is(.panel, .win) button.danger {
      color: #ff8a80;
      margin-top: 8px;
    }
    :is(.panel, .win) .badge {
      background: var(--primary-color, #03a9f4);
      color: #fff;
      border-radius: 9px;
      padding: 0 6px;
      font-size: 11px;
    }
    :is(.panel, .win) .zone {
      border-left: 2px solid rgba(255, 255, 255, 0.12);
      padding-left: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 6px;
    }
    :is(.panel, .win) .zone.open {
      border-left-color: var(--primary-color, #03a9f4);
    }
    .views button,
    .levels button,
    .tb {
      background: rgba(20, 26, 36, 0.72);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 14px;
      padding: 4px 10px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(4px);
    }
    .views button.on,
    .levels button.on,
    .tb.on {
      background: var(--primary-color, #03a9f4);
      border-color: transparent;
    }
    .toolbar {
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 2;
      display: flex;
      gap: 6px;
    }
    .tb {
      position: relative;
      width: 32px;
      height: 32px;
      padding: 0;
      font-size: 15px;
      line-height: 0;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tb ha-icon {
      --mdc-icon-size: 18px;
      width: 18px;
      height: 18px;
      display: block;
    }
    .tb .ring {
      position: absolute;
      inset: -5px;
      width: calc(100% + 10px);
      height: calc(100% + 10px);
      pointer-events: none;
    }
    .tb .ring circle {
      fill: none;
      stroke-width: 3;
    }
    .tb .ring .bg {
      stroke: rgba(255, 255, 255, 0.22);
    }
    .tb .ring .fg {
      stroke: var(--primary-color, #03a9f4);
      stroke-linecap: round;
      transition: stroke-dasharray 0.6s;
    }
    .tb.err {
      background: #d32f2f;
      animation: blink 0.9s steps(2) infinite;
    }
    @keyframes blink {
      50% {
        opacity: 0.45;
      }
    }
    .rtag {
      position: absolute;
      left: 0;
      top: 0;
      display: none;
      pointer-events: none;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: rgba(16, 21, 28, 0.78);
      white-space: nowrap;
    }
    .rtag[style*='translate'] {
      display: block;
    }
    .rtag.done {
      background: rgba(46, 160, 67, 0.9);
    }
    .rtag.warn {
      background: #d32f2f;
      padding: 3px;
      border-radius: 50%;
      line-height: 0;
      animation: blink 0.9s steps(2) infinite;
    }
    .rtag.warn ha-icon {
      --mdc-icon-size: 18px;
      display: block;
      width: 18px;
      height: 18px;
    }
    :is(.panel, .win) .sw {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
    }
    :is(.panel, .win) .grid.rooms {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    }
    :is(.panel, .win) .grid.rooms span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: default;
    }
    :is(.panel, .win) .ent-head ha-icon {
      --mdc-icon-size: 18px;
      display: flex;
    }
    :is(.panel, .win) .err {
      color: #ff9b9b;
    }
    .tb.busy {
      animation: pulse 1.6s infinite;
    }
    @keyframes pulse {
      50% {
        box-shadow: 0 0 0 4px rgba(3, 169, 244, 0.35);
      }
    }
    .anchors {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .anchor.behind {
      opacity: 0.55;
    }
    .anchor {
      --c: var(--primary-color, #03a9f4);
      position: absolute;
      left: 0;
      top: 0;
      display: none;
      align-items: center;
      gap: 4px;
      pointer-events: auto;
      cursor: pointer;
      color: #fff;
      font-size: 12px;
      white-space: nowrap;
      background: rgba(16, 21, 28, 0.78);
      border: 2px solid var(--c);
      backdrop-filter: blur(3px);
    }
    .anchor[style*='translate'] {
      display: flex;
    }
    .anchor.badge {
      padding: 2px 8px 2px 4px;
      border-radius: 14px;
    }
    .anchor.icon {
      padding: 3px;
      border-radius: 50%;
    }
    .anchor.active {
      background: var(--c);
    }
    .anchor ha-state-icon {
      --mdc-icon-size: 16px;
      color: var(--c);
      display: flex;
    }
    .anchor.edit {
      cursor: grab;
      touch-action: none;
    }
    .anchor.sel {
      outline: 2px dashed #fff;
      outline-offset: 2px;
      z-index: 1;
    }
    :is(.panel, .win) .ent {
      border-left: 2px solid rgba(255, 255, 255, 0.12);
      padding-left: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    :is(.panel, .win) .ent.open {
      border-left-color: var(--primary-color, #03a9f4);
    }
    :is(.panel, .win) .ent-head {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    :is(.panel, .win) .ent-head ha-state-icon {
      --mdc-icon-size: 18px;
      display: flex;
    }
    :is(.panel, .win) .ent-head .hint {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 40%;
    }
    :is(.panel, .win) house-view-icon-picker,
    :is(.panel, .win) house-view-entity-picker {
      display: block;
      width: 100%;
    }
    .anchor.active ha-state-icon {
      color: #fff;
    }
    .anchor small {
      opacity: 0.75;
    }
    .back {
      position: absolute;
      left: 8px;
      bottom: 46px;
      z-index: 2;
      background: rgba(20, 26, 36, 0.82);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 14px;
      padding: 5px 12px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .back-row {
      position: absolute;
      left: 8px;
      bottom: 46px;
      z-index: 2;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .back-row .back {
      position: static;
    }
    .back.preview {
      left: auto;
      right: 8px;
      bottom: 8px;
      background: rgba(3, 169, 244, 0.85);
    }
    .vacbar {
      position: absolute;
      left: 50%;
      bottom: 46px;
      transform: translateX(-50%);
      z-index: 3;
      width: min(460px, calc(100% - 16px));
      box-sizing: border-box;
      padding: 8px 12px;
      background: rgba(22, 28, 38, 0.93);
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .vacbar button,
    :is(.panel, .win) .chips button {
      padding: 5px 10px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 6px;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.05);
      color: #e6edf5;
      font: inherit;
    }
    .vacbar button.primary,
    :is(.panel, .win) button.on {
      background: var(--primary-color, #03a9f4);
      border-color: transparent;
    }
    .vacbar button:disabled {
      opacity: 0.4;
    }
    .vacbar .row,
    :is(.panel, .win) .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    :is(.panel, .win) .sub {
      border-left: 2px solid rgba(255, 255, 255, 0.12);
      padding-left: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    :is(.panel, .win) .grid input[type='text'] {
      width: 100%;
    }
    :is(.panel, .win) input[type='color'] {
      width: 48px;
      height: 26px;
      border: none;
      background: none;
      padding: 0;
    }
    :is(.panel, .win) form {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .hint.err {
      color: #ff9b9b;
    }
    .tip {
      position: absolute;
      pointer-events: none;
      background: rgba(16, 21, 28, 0.88);
      color: #e6edf5;
      font-size: 12px;
      padding: 6px 9px;
      border-radius: 6px;
      max-width: 220px;
      z-index: 1;
    }
    :is(.panel, .win) .menu {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    :is(.panel, .win) .menu:hover {
      background: rgba(255, 255, 255, 0.09);
    }
    :is(.panel, .win) .menu.on {
      border-color: var(--primary-color, #03a9f4);
      background: rgba(3, 169, 244, 0.15);
    }
    :is(.panel, .win) .menu span:nth-of-type(1) {
      flex: 1;
    }
    :is(.panel, .win) .menu .arrow {
      opacity: 0.6;
    }
    /* windows of the editor: stacked over the menu, each one over the previous one */
    .win {
      position: absolute;
      top: 48px;
      right: 8px;
      bottom: 8px;
      z-index: 4;
      width: min(340px, calc(100% - 16px));
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      background: #1a212d;
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      font-size: 13px;
    }
    .win.item {
      z-index: 5;
    }
    .win .head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      padding: 8px 12px 8px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .win .head .wback {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 2px;
      display: flex;
      --mdc-icon-size: 20px;
    }
    .win .head b {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .win .body {
      overflow-y: auto;
      padding: 8px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .panel {
      position: absolute;
      top: 48px;
      right: 8px;
      bottom: 8px;
      z-index: 3;
      width: min(340px, calc(100% - 16px));
      overflow-y: auto;
      box-sizing: border-box;
      padding: 8px 12px 12px;
      background: rgba(22, 28, 38, 0.93);
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      backdrop-filter: blur(6px);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .panel.wide {
      width: min(560px, calc(100% - 16px));
    }
    .bplan {
      width: 100%;
      aspect-ratio: 4 / 3;
      flex: none;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      touch-action: none;
      user-select: none;
    }
    .bplan .broom {
      cursor: move;
    }
    .blist {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .bbox {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
    }
    .bnum {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      font-size: 12px;
    }
    .bnum input {
      width: 64px;
    }
    .bnum.wide select {
      flex: 1;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .panel .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    :is(.panel, .win) .x {
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
    }
    :is(.panel, .win) details {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    :is(.panel, .win) details[open] {
      padding-bottom: 6px;
    }
    :is(.panel, .win) details > * + * {
      margin-top: 6px;
    }
    :is(.panel, .win) summary {
      cursor: pointer;
      font-weight: 600;
    }
    :is(.panel, .win) label {
      display: block;
      color: #aab4c3;
    }
    :is(.panel, .win) .rng span {
      display: flex;
      justify-content: space-between;
    }
    :is(.panel, .win) .rng b {
      color: #e6edf5;
      font-weight: 500;
    }
    :is(.panel, .win) input[type='range'] {
      width: 100%;
    }
    :is(.panel, .win) .chk {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    :is(.panel, .win) select,
    :is(.panel, .win) input[type='number'],
    :is(.panel, .win) input[type='text'] {
      background: #10151c;
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
      box-sizing: border-box;
    }
    :is(.panel, .win) select {
      width: 100%;
    }
    :is(.panel, .win) input[type='number'] {
      width: 72px;
    }
    :is(.panel, .win) .row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    :is(.panel, .win) .row input[type='text'],
    :is(.panel, .win) .grow {
      flex: 1;
      min-width: 0;
    }
    :is(.panel, .win) .grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px 8px;
      align-items: center;
    }
    :is(.panel, .win) .file,
    :is(.panel, .win) button:not(.x) {
      align-self: flex-start;
      padding: 5px 10px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 6px;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.05);
      color: #e6edf5;
      font: inherit;
      display: inline-block;
    }
    :is(.panel, .win) button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    :is(.panel, .win) .file input {
      display: none;
    }
    :is(.panel, .win) canvas {
      width: 100%;
      background: #10151c;
      border-radius: 6px;
    }
    .hint,
    .report {
      font-size: 12px;
      color: #8b95a5;
    }
    .report ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }
    .msg {
      font-size: 12px;
      color: var(--success-color, #43a047);
    }
    .msg.bad {
      color: var(--error-color, #ef5350);
    }
    .lockdlg {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(16, 21, 28, 0.6);
    }
    .lockdlg form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(280px, calc(100% - 32px));
      box-sizing: border-box;
      padding: 14px;
      background: rgba(22, 28, 38, 0.97);
      color: #e6edf5;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      font-size: 13px;
    }
    .lockdlg .hint {
      opacity: 0.75;
      font-size: 12px;
    }
    .lockdlg input {
      padding: 8px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(0, 0, 0, 0.3);
      color: inherit;
      font-size: 16px; /* no zoom on focus on phones */
    }
    .lockdlg .row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .lockdlg button {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .lockdlg button.primary {
      background: var(--primary-color, #03a9f4);
      border-color: transparent;
      color: #fff;
    }
    .lockdlg .lockerr {
      color: var(--error-color, #ef5350);
      font-size: 12px;
    }
  `;
}

if (!customElements.get('house-view-card')) customElements.define('house-view-card', HouseViewCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'house-view-card',
  name: 'House View',
  description: 'Dynamic pseudo-3D view of your house: lights, weather and seasons.',
});
