// Glue between Home Assistant, the vacuum tracker and the 3D engine: reads the robot state and position, follows the
// run room by room, and drives the robot model, the room effects and the progress shown by the card.
import { VAC_DEFAULTS, VacuumTracker, robotToPlan, solveRotation, positionFromAttributes, dockFront } from './vacuum.js';
import { mapSettings, calibrationOf, mapCorners, planToPixel } from './vacuum-map.js';

const ACTIVE = new Set(['cleaning', 'returning', 'paused', 'error']);
const ROBOROCK_DOCK = [25500, 25500]; // documented position of the dock in Roborock coordinates
const NO_VALUE = new Set(['unknown', 'unavailable', 'none', 'ok', '']);

export class VacuumController {
  /** `entity`: the vacuum this controller follows. */
  constructor(card, entity) {
    this.card = card;
    this._entity = entity;
    this.tracker = null;
    this.raw = null; // last robot coordinates { x, y, a }
    this.charger = null; // dock coordinates when the source gives them
    this.msg = ''; // last error of the position source
    this.sim = false; // the position is made up (no source)
    this.demo = null;
    this._state = null;
    this._timer = null;
    this._lookup = { at: 0 };
    this.mapOn = false; // the picture of the robot's map is shown over the plan (settings)
    this.mapMsg = ''; // why it is not: '' | none (no picture entity) | error (unreadable picture)
    this._mapPic = null; // { img, w, h }
    this._mapKey = '';
  }

  get hass() {
    return this.card._hass;
  }

  /** The engine, through the slot of this robot (its own robot, trail, map and room effects). */
  get engine() {
    return this.card._engine && this.card._engine.robotSlot(this._entity);
  }

  get entity() {
    return this._entity;
  }

  get cfg() {
    const c = { ...VAC_DEFAULTS, ...this._raw };
    if (!c.origin && this.source() === 'roborock') c.origin = ROBOROCK_DOCK;
    return c;
  }

  /** Settings of this robot as stored ({} before any); `_rawW`: the same, created to be written. */
  get _raw() {
    return this.card._vacCfg(this._entity) || {};
  }

  get _rawW() {
    return this.card._vacCfg(this._entity, true);
  }

  /** Entities of the vacuum's device, looked up at most every 30 s: position carrier, progress, error. */
  _related() {
    const h = this.hass;
    const id = this.entity;
    const L = this._lookup;
    if (L.id === id && Date.now() - L.at < 30000) return L;
    const reg = (h.entities && h.entities[id]) || {};
    const mine = reg.device_id ? Object.keys(h.entities).filter((e) => h.entities[e].device_id === reg.device_id) : [];
    const byKey = (k) => mine.find((e) => h.entities[e].translation_key === k && h.states[e]) || null;
    const conf = this.card._config;
    // pictures of the robot's map: image or camera entities of the device, those with calibration points first
    const pics = mine.filter((e) => /^(image|camera)\./.test(e) && h.states[e] && h.states[e].attributes.entity_picture);
    this._lookup = {
      id,
      at: Date.now(),
      platform: reg.platform || '',
      pos: [id, ...mine].find((e) => h.states[e] && positionFromAttributes(h.states[e].attributes)) || null,
      // the progress sensor of the options belongs to the robot of the options
      progress: (id === conf.vacuum_entity && conf.vacuum_progress_entity) || byKey('cleaning_progress'),
      error: byKey('vacuum_error'),
      map: pics.find((e) => calibrationOf(h.states[e].attributes)) || pics[0] || null,
    };
    return this._lookup;
  }

  /** Where the position comes from: entity (attributes of a map entity) | roborock (action, polled) | none (made up). */
  source() {
    const s = this._raw.source || 'auto';
    if (!this.entity || s === 'none') return 'none';
    const rel = this._related();
    if (s === 'entity' || (s === 'auto' && (this._raw.pos_entity || rel.pos))) return 'entity';
    if (s === 'roborock' || (s === 'auto' && rel.platform === 'roborock')) return 'roborock';
    return 'none';
  }

  posEntity() {
    const e = this._raw.pos_entity;
    return e && this.hass.states[e] ? e : this._related().pos;
  }

  get state() {
    const st = this.entity && this.hass.states[this.entity];
    return st ? st.state : null;
  }

  get error() {
    return this.state === 'error' || (this.demo && this.demo.error);
  }

  get errorText() {
    if (!this.error) return '';
    const rel = this._related();
    const st = this.hass.states[this.entity];
    const s = rel.error && this.hass.states[rel.error];
    if (s && !NO_VALUE.has(s.state)) return this.hass.formatEntityState ? this.hass.formatEntityState(s) : s.state;
    return (st && (st.attributes.error || st.attributes.status)) || '';
  }

  /** Rooms the robot can reach: those of the dock's level (every room while the dock is not placed). */
  rooms() {
    const lv = this._raw.dock && this._raw.dock.level;
    const out = [];
    for (const L of this.engine.world.sd.levels) {
      if (lv && L.id !== lv) continue;
      for (const r of L.rooms) if (r.poly && r.poly.length > 2) out.push({ id: r.id, poly: r.poly, level: L.id, y: L.elevation });
    }
    return out;
  }

  _ensureTracker() {
    const lv = (this._raw.dock && this._raw.dock.level) || '';
    if (this.tracker && this._scene === this.engine.sceneData && this._lv === lv) return;
    this._scene = this.engine.sceneData;
    this._lv = lv;
    this._rooms = this.rooms();
    this.tracker = new VacuumTracker(this._rooms);
  }

  get running() {
    return !!this.tracker && this.tracker.running;
  }

  /** Completion of the run 0..1 (the robot's own progress sensor when it has one), null when idle. */
  total() {
    if (!this.running) return null;
    const p = this._progress();
    return p !== null ? p : this.tracker.total();
  }

  _progress() {
    if (this.demo) return null;
    const e = this._related().progress;
    const v = e && this.hass.states[e] ? parseFloat(this.hass.states[e].state) : NaN;
    return Number.isFinite(v) ? Math.min(Math.max(v / 100, 0), 1) : null;
  }

  /** Called on every Home Assistant update (cheap when nothing changed). */
  sync() {
    if (!this.entity || !this.engine || !this.engine.world || this.demo) return;
    const st = this.hass.states[this.entity];
    const now = Date.now();
    if (st.state !== this._state) {
      this._state = st.state;
      this._ensureTracker();
      if (st.state === 'cleaning' && !this.tracker.running) this._begin(Date.parse(st.last_changed) || now, now);
      else if (this.tracker.running && ['returning', 'docked', 'idle'].includes(st.state)) this._end(now);
      if (!ACTIVE.has(st.state)) this._home();
      this.card._robotFloor('run', !!this.card._config.vacuum_show_floor && ACTIVE.has(st.state));
      this._fx(now);
      this._startTimer(1000);
    }
    if (ACTIVE.has(st.state) && this.source() === 'entity') this._fromEntity(now);
    if (this.mapOn) this._loadMap(); // a new picture of the map came in
  }

  /** The world was rebuilt or the settings changed: put everything back. */
  refresh() {
    if (!this.engine || !this.engine.world) return;
    this._lookup.at = 0;
    this._ensureTracker();
    const now = Date.now();
    if (this.tracker.pos && (this.running || ACTIVE.has(this.state))) this._place(this.tracker.pos, 0.2, true);
    else this._home();
    this._fx(now, true);
    if (this.mapOn && !this._loadMap()) this._drawMap();
  }

  _begin(startedAt, now) {
    const plan = this.card._vacPlan;
    this.tracker.start(plan && plan.entity === this._entity ? plan.rooms : null, startedAt);
    this.sim = this.source() === 'none';
    if (this.sim) this.tracker.plan(this._raw.dock && this._raw.dock.at);
    this._nextPoll = now;
  }

  _end(now) {
    this.tracker.stop(now);
    const plan = this.card._vacPlan;
    if (plan && plan.entity === this._entity) this.card._vacPlan = null;
  }

  /** Robot on its dock (when the dock is placed). */
  _home() {
    const d = this._raw.dock;
    if (!d || !d.at || !this.entity) {
      this.engine.setRobot(null);
      return;
    }
    const c = this.cfg;
    const [fx, fz] = dockFront(d); // the robot sits on the plate, in front of the dock, facing out
    this.engine.setRobot({
      heading: d.dir ?? 90,
      x: d.at[0] + fx * 0.05 * c.size,
      z: d.at[1] + fz * 0.05 * c.size,
      y: d.base ?? 0,
      level: d.level,
      color: c.color,
      size: c.size,
      error: this.error,
      period: 4,
    });
  }

  _floor(p) {
    const d = this._raw.dock;
    if (d && d.at) return { y: d.base ?? 0, level: d.level };
    const id = this.tracker.roomAt(p[0], p[1]);
    const r = this._rooms.find((x) => x.id === id) || this._rooms[0];
    return r ? { y: r.y, level: r.level } : { y: 0, level: null };
  }

  _place(p, period, snap = false) {
    const c = this.cfg;
    const f = this._floor(p);
    this.engine.setRobot({ x: p[0], z: p[1], y: f.y, level: f.level, color: c.color, size: c.size, error: this.error, period, snap });
    this.engine.setTrail(c.trail && this.tracker.trail.length > 1 ? this.tracker.trail : null, f.y, c.room_color, f.level);
  }

  _onRaw(raw, charger, now, period) {
    this.raw = raw;
    this.charger = charger;
    const p = robotToPlan(this.cfg, raw, charger);
    if (!p) return;
    this.tracker.sample(p[0], p[1], now);
    this._place(p, period);
  }

  _fromEntity(now) {
    const e = this.posEntity();
    const got = e && positionFromAttributes(this.hass.states[e].attributes);
    if (!got || (this.raw && got.pos.x === this.raw.x && got.pos.y === this.raw.y)) return;
    const period = this._rawAt ? Math.min((now - this._rawAt) / 1000, 30) : 2;
    this._rawAt = now;
    this._onRaw(got.pos, got.charger, now, period);
  }

  /** Read the robot coordinates once (settings panel): from the map entity, else from the Roborock action. */
  async readRaw() {
    const src = this.source();
    if (src === 'entity') {
      const e = this.posEntity();
      const got = e && positionFromAttributes(this.hass.states[e].attributes);
      if (got) {
        this.raw = got.pos;
        this.charger = got.charger;
      }
    } else if (src === 'roborock') await this._pollRoborock(true);
    return this.raw;
  }

  async _pollRoborock(quiet = false) {
    if (this._busy) return;
    this._busy = true;
    const period = Math.max(5, this.card._config.vacuum_poll || 15);
    try {
      const r = await this.hass.callWS({
        type: 'call_service',
        domain: 'roborock',
        service: 'get_vacuum_current_position',
        target: { entity_id: this.entity },
        return_response: true,
      });
      const resp = r && r.response;
      const v = resp && (resp[this.entity] || resp);
      if (!v || !Number.isFinite(+v.x) || !Number.isFinite(+v.y)) throw new Error('no position in the response');
      this.msg = '';
      this._fail = 0;
      if (quiet) this.raw = { x: +v.x, y: +v.y };
      else this._onRaw({ x: +v.x, y: +v.y }, null, Date.now(), period);
    } catch (e) {
      this.msg = (e && (e.message || e.code)) || String(e);
      this._fail = (this._fail || 0) + 1;
    }
    this._busy = false;
  }

  _simFrac(now) {
    const p = this._progress();
    if (p !== null) return p;
    const area = this.tracker.route.reduce((a, r) => a + this.tracker.byId[r.id].cells.size, 0) * this.tracker.cell ** 2;
    const rate = this.card._config.vacuum_rate || 1; // m2 per minute
    return Math.min((now - this.tracker.startedAt) / 60000 / Math.max(area / rate, 0.5), 0.999);
  }

  _startTimer(ms) {
    if (this._timer && this._ms === ms) return;
    this.pause();
    this._ms = ms;
    this._timer = setInterval(() => this._tick(), ms);
  }

  /** Stop the timer (card hidden or removed); sync() starts it again. */
  pause() {
    clearInterval(this._timer);
    this._timer = null;
    this._state = this.demo ? this._state : null;
  }

  _glowing(now) {
    return !!this.tracker && this.tracker.rooms.some((r) => this.tracker.glow(r.id, now) > 0);
  }

  _tick() {
    const now = Date.now();
    if (!this.engine || !this.engine.world || !this.tracker) return;
    if (this.demo) this._demoStep(now);
    else {
      const active = ACTIVE.has(this.state);
      if (this.running && this.sim) {
        const p = this.tracker.simulate(this._simFrac(now), now);
        if (p) this._place(p, 1);
      } else if (active && this.source() === 'roborock' && now >= (this._nextPoll || 0)) {
        // the action goes through the Roborock cloud: polled slowly, and slower after errors
        const period = Math.max(5, this.card._config.vacuum_poll || 15);
        this._nextPoll = now + period * 1000 * 2 ** Math.min(this._fail || 0, 3);
        this._pollRoborock();
      }
      if (!active && !this._glowing(now)) {
        this._fx(now);
        clearInterval(this._timer);
        this._timer = null;
      }
    }
    this._fx(now);
    this.card.requestUpdate();
  }

  /** Room effects: room being cleaned tinted, rooms to come lightly tinted, finished rooms shimmering, alarm in red. */
  _fx(now, force = false) {
    const c = this.cfg;
    const T = this.tracker;
    const fx = {};
    if (T) {
      for (const r of T.rooms) {
        const s = T.status(r.id);
        const g = T.glow(r.id, now);
        if (s === 'active') fx[r.id] = { color: c.room_color, mix: 0.7 };
        else if (s === 'queued') fx[r.id] = { color: c.room_color, mix: 0.25 };
        else if (g > 0) fx[r.id] = { color: c.room_color, mix: 0.1, glow: Math.round(g * 10) / 10 + 0.1 };
      }
      if (this.error) {
        const at = T.pos || (this._raw.dock && this._raw.dock.at);
        const id = T.active || (at && T.roomAt(at[0], at[1]));
        if (id) fx[id] = { color: '#ff3b30', mix: 0.5, blink: true };
      }
    }
    const sig = JSON.stringify(fx);
    if (!force && sig === this._fxSig) return;
    this._fxSig = sig;
    this.engine.setRoomFx(fx);
  }

  /** Labels drawn over the rooms: [{ id, pos: [x, y, z], level, text, kind }]. */
  tags() {
    const T = this.tracker;
    if (!T || !this._rooms) return [];
    const now = Date.now();
    const out = [];
    for (const r of this._rooms) {
      const s = T.status(r.id);
      const c = T.byId[r.id].center;
      if (s === 'active')
        out.push({ id: r.id, pos: [c[0], r.y + 0.05, c[1]], level: r.level, text: `${Math.round(T.pct(r.id) * 100)} %`, kind: 'active' });
      else if (T.glow(r.id, now) > 0) out.push({ id: r.id, pos: [c[0], r.y + 0.05, c[1]], level: r.level, text: '✓', kind: 'done' });
    }
    return out;
  }

  /** Name of the room being cleaned. */
  activeRoom() {
    const id = this.tracker && this.tracker.active;
    const r = id && this.engine.rooms.find((x) => x.id === id);
    return r ? { id, name: r.name, pct: this.tracker.pct(id) } : null;
  }

  // ---- picture of the robot's map over the plan (settings): turned and moved until it lines up

  /** Entity carrying the picture of the map: the one chosen, else the first image or camera of the vacuum's device. */
  mapEntity() {
    const chosen = (this._raw.map || {}).entity;
    return chosen && this.hass.states[chosen] ? chosen : this._related().map;
  }

  get mapCfg() {
    return mapSettings(this._raw, this._related().platform);
  }

  /** Calibration given by the map entity (pixels -> robot coordinates), or null: the picture is then placed by hand. */
  mapCalibration() {
    const e = this.mapEntity();
    return e && this.hass.states[e] ? calibrationOf(this.hass.states[e].attributes) : null;
  }

  /** True when the picture is drawn on the plan. */
  get mapShown() {
    return this.mapOn && !!this._mapPic && !!this._mapCorners();
  }

  showMap(on) {
    if (this.mapOn === !!on) return;
    this.mapOn = !!on;
    this.card._robotFloor('map', this.mapOn); // the floors above and the roof would hide it
    if (this.mapOn) {
      if (!this._loadMap()) this._drawMap();
      return;
    }
    this._mapPic = null;
    this._mapKey = '';
    this.mapMsg = '';
    if (this.engine) this.engine.setRobotMap(null);
  }

  /** Fetch the picture when the entity or its picture changed. Returns true when a fetch started. */
  _loadMap() {
    const e = this.mapEntity();
    const pic = e && this.hass.states[e] && this.hass.states[e].attributes.entity_picture;
    const key = pic ? `${e}|${pic}` : '';
    if (key === this._mapKey) return false;
    this._mapKey = key;
    if (!pic) {
      this._mapPic = null;
      this.mapMsg = 'none';
      this._drawMap();
      return false;
    }
    const img = new Image();
    const done = (ok) => {
      if (this._mapKey !== key) return; // another picture was asked for meanwhile
      // a picture that failed to load keeps the previous one on screen: the robot's map is refreshed often
      if (ok) this._mapPic = { img, w: img.naturalWidth, h: img.naturalHeight };
      this.mapMsg = ok || this._mapPic ? '' : 'error';
      this._drawMap();
      this.card.requestUpdate();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = this.hass.hassUrl ? this.hass.hassUrl(pic) : pic;
    return true;
  }

  _mapCorners() {
    return this._mapPic ? mapCorners(this.cfg, this.mapCfg, this._mapPic, this.mapCalibration(), this.charger) : null;
  }

  _drawMap() {
    if (!this.engine) return;
    const corners = this.mapOn ? this._mapCorners() : null;
    if (!corners) {
      this.engine.setRobotMap(null);
      return;
    }
    const d = this._raw.dock;
    this.engine.setRobotMap({ image: this._mapPic.img, corners, y: d.base ?? 0, level: d.level, opacity: this.mapCfg.opacity });
  }

  /**
   * Picture placed by hand: plan point `at` is where the picture shows the dock, so the pixel under it becomes the
   * one that sits on the dock. Returns false when there is no picture to pin.
   */
  pinMap(at) {
    const px = this._mapPic && planToPixel(this.cfg, this.mapCfg, this._mapPic, at);
    if (!px) return false;
    const map = { ...(this._raw.map || {}), pin: [Math.round(px[0] * 10) / 10, Math.round(px[1] * 10) / 10] };
    this._rawW.map = map;
    this._drawMap();
    return true;
  }

  /** Move a picture placed by hand by (dx, dz) meters on the plan. */
  nudgeMap(dx, dz) {
    const d = this._raw.dock;
    return !!d && !!d.at && this.pinMap([d.at[0] - dx, d.at[1] - dz]);
  }

  // ---- settings helpers

  /** The robot is on its dock: remember its coordinates as the dock's. */
  async captureOrigin() {
    const raw = await this.readRaw();
    if (!raw) return false;
    this._rawW.origin = this.charger || [raw.x, raw.y];
    return true;
  }

  /** Second calibration point: the robot is at plan point `at` right now. Returns { rot, ratio } or null. */
  solve(at) {
    const r = this.raw ? solveRotation(this.cfg, this.raw, at, this.charger) : null;
    if (r) this._rawW.rot = r.rot;
    return r;
  }

  /** Accelerated made-up run on the rooms nearest to the dock, to see the animation without starting the robot. */
  startDemo(withError = false) {
    this._ensureTracker();
    const T = this.tracker;
    const from = (this._raw.dock && this._raw.dock.at) || (T.rooms[0] && T.rooms[0].center) || [0, 0];
    const ids = [...T.rooms]
      .filter((r) => r.cells.size > 40)
      .sort((a, b) => Math.hypot(a.center[0] - from[0], a.center[1] - from[1]) - Math.hypot(b.center[0] - from[0], b.center[1] - from[1]))
      .slice(0, 3)
      .map((r) => r.id);
    if (!ids.length) return false;
    const now = Date.now();
    T.glowMs = 8000;
    T.start(ids, now);
    T.plan(from);
    this.sim = true;
    this.demo = { t0: now, dur: 40000, error: false, withError };
    this.card._robotFloor('demo', true);
    this._startTimer(150);
    return true;
  }

  stopDemo() {
    if (!this.demo) return;
    this.demo = null;
    this.card._robotFloor('demo', false);
    this.tracker.glowMs = 60000;
    this.tracker.reset();
    this.engine.setTrail(null);
    this._state = null;
    this._home();
    this._fx(Date.now(), true);
    this.sync();
    this.card.requestUpdate();
  }

  _demoStep(now) {
    const D = this.demo;
    const k = (now - D.t0) / D.dur;
    D.error = D.withError && k > 0.45 && k < 0.6; // a short alarm in the middle of the run
    if (k < 1) {
      if (!D.error) {
        const frac = D.withError && k >= 0.6 ? k - 0.15 : k;
        const p = this.tracker.simulate(Math.min(frac / (D.withError ? 0.85 : 1), 1), now);
        if (p) this._place(p, 0.15);
      } else if (this.tracker.pos) this._place(this.tracker.pos, 0.15);
    } else if (this.tracker.running) {
      this.tracker.stop(now);
      this._home();
    } else if (!this._glowing(now)) this.stopDemo();
  }
}
