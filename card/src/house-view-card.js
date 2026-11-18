import { LitElement, html, css, nothing } from 'lit';
import { HouseEngine } from './engine.js';
import { HouseViewApi } from './api.js';
import { weatherLive, solarClock, mapRoomsToAreas, roomLights, areaOfEntity } from './ha-bridge.js';
import { importSh3d } from './engine/sh3d-import.js';
import { normalizeScene } from './engine/scene-model.js';
import { autoCalibrate, parseTerrain } from './engine/terrain.js';
import { normalizeEdits, emptyEdits } from './engine/edits.js';
import { WEATHER_PRESETS } from './engine/environment.js';
import { makeT } from './i18n.js';

const TICK_MS = 30000; // live clock refresh

class HouseViewCard extends LitElement {
  static properties = {
    _status: { state: true }, // 'loading' | 'ready' | 'empty' | 'error'
    _error: { state: true },
    _setup: { state: true },
    _report: { state: true },
    _views: { state: true },
    _view: { state: true },
    _sim: { state: true },
    _msg: { state: true },
  };

  static getStubConfig() {
    return { type: 'custom:house-view-card' };
  }

  constructor() {
    super();
    this._status = 'loading';
    this._setup = false;
    this._views = [];
    this._view = 0;
    this._sim = { hour: 14, doy: 172, weather: 'clear' };
    this._data = null;
    this._lastLive = '';
  }

  setConfig(config) {
    this._config = { mode: 'live', fps_cap: 30, interactive: false, show_views: true, tap_action: 'toggle_lights', ...config };
    if (this._engine) this._engine.opts.fpsCap = this._config.fps_cap;
  }

  getCardSize() {
    return 6;
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._init();
    else this._pushLive();
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
    this._io = new IntersectionObserver((e) => this._visible(e[0].isIntersecting));
    this._io.observe(this);
    this._vis = () => this._visible(!document.hidden && this._inView !== false);
    document.addEventListener('visibilitychange', this._vis);
    if (this._engine) this._engine.start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    if (this._io) this._io.disconnect();
    document.removeEventListener('visibilitychange', this._vis);
    if (this._engine) this._engine.stop(); // keep the engine: the card may be re-attached (dashboard edit mode)
  }

  _visible(v) {
    this._inView = v;
    if (!this._engine) return;
    if (v && !document.hidden) this._engine.start();
    else this._engine.stop();
  }

  // ------------------------------------------------------------ data

  async _init() {
    this._api = new HouseViewApi(this._hass);
    await this.updateComplete;
    this._engine = new HouseEngine(this.renderRoot.querySelector('#view'), {
      interactive: this._config.interactive,
      fpsCap: this._config.fps_cap,
      onRoomClick: (roomId) => this._roomClick(roomId),
    });
    this._engine.start();
    await this._reload();
  }

  async _reload() {
    try {
      this._status = 'loading';
      const info = await this._api.info();
      if (!info) throw Object.assign(new Error('no_integration'), { code: 'no_integration' });
      const scene = await this._api.getScene();
      if (!scene) {
        this._status = 'empty';
        return;
      }
      const [terrain, edits] = await Promise.all([info.has_terrain ? this._api.getTerrain() : null, this._api.getEdits()]);
      this._data = { scene, terrain, edits: edits || emptyEdits() };
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
    this._views = this._engine.views.map((v) => v.name);
    this._lastLive = '';
    this._pushTime(true);
    this._pushLive();
  }

  // ------------------------------------------------------------ live

  _pushTime(force = false) {
    if (!this._engine || !this._engine.world || !this._hass) return;
    if (this._config.mode === 'simulation') {
      if (force) this._engine.setLive({ hour: this._sim.hour, doy: this._sim.doy, weather: this._sim.weather });
      return;
    }
    const lon = this._hass.config.longitude ?? 0;
    this._engine.setLive({ ...solarClock(new Date(), lon), latitude: this._hass.config.latitude });
  }

  _pushLive() {
    const eng = this._engine;
    if (!eng || !eng.world || !this._hass) return;
    const h = this._hass;
    const cfg = this._config;
    const areas = mapRoomsToAreas(eng.rooms, h.areas, this._data.edits.room_areas || {});
    const lights = roomLights(h, areas, cfg.light_entities || null);
    const weather = cfg.mode === 'simulation' ? {} : weatherLive(cfg.weather_entity ? h.states[cfg.weather_entity] : null);
    const sig = JSON.stringify([lights, weather]);
    if (sig === this._lastLive) return; // nothing relevant changed: skip the rebuild of the light volumes
    this._lastLive = sig;
    this._areas = areas;
    eng.setRoomLights(lights);
    if (cfg.mode !== 'simulation' && Object.keys(weather).length) eng.setLive(weather);
  }

  _roomClick(roomId) {
    if (this._config.tap_action !== 'toggle_lights' || !this._hass) return;
    const area = this._areas && this._areas[roomId];
    if (!area) return;
    const ids = Object.keys(this._hass.states).filter((id) => id.startsWith('light.') && areaOfEntity(this._hass, id) === area);
    if (ids.length) this._hass.callService('light', 'toggle', { entity_id: ids });
  }

  // ------------------------------------------------------------ setup (admin)

  async _save(what) {
    try {
      if (what === 'scene') await this._api.setScene(this._data.scene);
      else if (what === 'edits') await this._api.setEdits(this._data.edits);
      else if (what === 'terrain') await (this._data.terrain ? this._api.setTerrain(this._data.terrain) : this._api.clearTerrain());
      this._msg = this._t('saved');
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
  }

  async _onPlan(ev) {
    const input = ev.target;
    const file = input.files[0];
    if (!file) return;
    try {
      const { scene, report } = await importSh3d(file);
      this._data = { ...(this._data || { terrain: null, edits: emptyEdits() }), scene };
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

  async _slider(key, v) {
    this._data.edits.registration = { ...this._data.edits.registration, [key]: v };
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
      await this._save('edits');
      this._apply(true);
    } catch (e) {
      this._msg = `${this._t('error')}: ${e.message}`;
    }
    input.value = '';
  }

  // ------------------------------------------------------------ render

  _renderSetup() {
    const t = this._t;
    const reg = (this._data && this._data.edits.registration) || {};
    const slider = (key, label, min, max, step, val) =>
      html` <label>${label} <b>${Number(val).toFixed(2)}</b></label>
        <input
          type="range"
          min=${min}
          max=${max}
          step=${step}
          .value=${String(val)}
          @change=${(e) => this._slider(key, parseFloat(e.target.value))}
        />`;
    const eng = this._engine;
    const unmapped = this._areas && eng ? eng.rooms.filter((r) => !this._areas[r.id]).map((r) => r.name) : [];
    return html` <div class="setup">
      <h3>${t('setup')}</h3>
      <label class="file">${t('import_plan')}<input type="file" accept=".sh3d,.xml" @change=${this._onPlan} /></label>
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
      ${unmapped.length ? html`<div class="report">${t('rooms_unmapped')} : ${unmapped.join(', ')}</div>` : nothing}
      ${
        this._data && this._data.scene
          ? html` <h4>${t('terrain')}</h4>
              <label class="file"
                >${t('import_terrain')}<input type="file" accept=".json,application/json" @change=${this._onTerrain}
              /></label>
              ${
                this._data.terrain
                  ? html`<button @click=${this._removeTerrain}>${t('remove_terrain')}</button>
                      <button @click=${this._calibrate}>${t('calibrate')}</button>
                      ${slider('base', t('base'), -3, 12, 0.05, reg.base ?? 0)} ${slider('rot', t('rot'), -180, 180, 0.1, reg.rot ?? 0)}
                      ${slider('dx', t('dx'), -15, 15, 0.1, reg.dx ?? 0)} ${slider('dz', t('dz'), -15, 15, 0.1, reg.dz ?? 0)}`
                  : nothing
              }
              <h4>${t('edits')}</h4>
              <button @click=${this._exportEdits}>${t('export')}</button>
              <label class="file">${t('import')}<input type="file" accept=".json,application/json" @change=${this._importEdits} /></label>`
          : nothing
      }
      ${this._msg ? html`<div class="msg">${this._msg}</div>` : nothing}
    </div>`;
  }

  _renderSim() {
    const t = this._t;
    const set = (patch) => {
      this._sim = { ...this._sim, ...patch };
      this._engine.setLive({ hour: this._sim.hour, doy: this._sim.doy, weather: this._sim.weather });
    };
    return html` <div class="sim">
      <label
        >${t('sim_hour')} ${Math.floor(this._sim.hour)}h<input
          type="range"
          min="0"
          max="24"
          step="0.1"
          .value=${String(this._sim.hour)}
          @input=${(e) => set({ hour: parseFloat(e.target.value) })}
      /></label>
      <label
        >${t('sim_date')}<input
          type="range"
          min="1"
          max="365"
          .value=${String(this._sim.doy)}
          @input=${(e) => set({ doy: parseInt(e.target.value, 10) })}
      /></label>
      <label
        >${t('sim_weather')}<select @change=${(e) => set({ weather: e.target.value })}>
          ${Object.entries(WEATHER_PRESETS).map(([k, p]) => html`<option value=${k} ?selected=${k === this._sim.weather}>${p.label}</option>`)}
        </select></label
      >
    </div>`;
  }

  render() {
    const t = this._t;
    return html` <ha-card>
      <div class="wrap">
        <div id="view"></div>
        ${
          this._status === 'ready' && this._config.show_views && this._views.length > 1
            ? html`<div class="views">
                ${this._views.map(
                  (n, i) =>
                    html`<button
                      class=${i === this._view ? 'on' : ''}
                      @click=${() => {
                        this._view = i;
                        this._engine.goToView(i);
                      }}
                    >
                      ${n}
                    </button>`,
                )}
              </div>`
            : nothing
        }
        ${this._isAdmin ? html`<button class="gear" title=${t('setup')} @click=${() => (this._setup = !this._setup)}>⚙</button>` : nothing}
        ${this._status === 'loading' ? html`<div class="overlay">${t('loading')}</div>` : nothing}
        ${this._status === 'error' ? html`<div class="overlay err">${this._error}</div>` : nothing}
        ${this._status === 'empty' ? html`<div class="overlay">${t('empty')}<br />${this._isAdmin ? t('empty_admin') : ''}</div>` : nothing}
      </div>
      ${this._config && this._config.mode === 'simulation' && this._status === 'ready' ? this._renderSim() : nothing}
      ${this._setup && this._isAdmin ? this._renderSetup() : nothing}
    </ha-card>`;
  }

  static styles = css`
    ha-card {
      overflow: hidden;
    }
    .wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 10;
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
    }
    .overlay {
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
    .views button,
    .gear {
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
    .views button.on {
      background: var(--primary-color, #03a9f4);
      border-color: transparent;
    }
    .gear {
      position: absolute;
      right: 8px;
      top: 8px;
      width: 32px;
      height: 32px;
      padding: 0;
      font-size: 16px;
      border-radius: 50%;
    }
    .setup,
    .sim {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sim {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .setup h3,
    .setup h4 {
      margin: 6px 0 0;
    }
    .setup label {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .setup .file,
    .setup button {
      align-self: flex-start;
      padding: 6px 12px;
      border: 1px solid var(--divider-color);
      border-radius: 6px;
      cursor: pointer;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
    }
    .setup .file input {
      display: none;
    }
    .report {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .report ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }
    .msg {
      font-size: 12px;
      color: var(--success-color, #43a047);
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
