// Feature editors built on the click tool of WorldEditors: fences (free drawing, type per side, cutting), watering
// (drip lines, sprinklers) and the robot vacuum dock. They only change `ed.edits` and ask for a rebuild.
import { FENCE_TYPES, normalizeFence, nearestSide, nearestPoint, splitSide, removePoint } from './fences.js';
import { smoothPath, headDefaults, sprinklerModel, bearing } from './irrigation.js';

const uid = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const r2 = (v) => Math.round(v * 100) / 100;

export class FenceTools {
  constructor(ed) {
    this.ed = ed;
    this.brush = { s: 'mesh', h: FENCE_TYPES.mesh.h, c: '' }; // type / height / color given to the next sides
    this.draw = null; // { pts, segs } of the fence being drawn
    this.edit = null; // { i, tool: paint | cut | unpoint }
  }

  get fences() {
    return this.ed.edits.fences;
  }

  _side() {
    return { s: this.brush.s, h: this.brush.h, ...(this.brush.c ? { c: this.brush.c } : {}) };
  }

  setBrush(patch) {
    Object.assign(this.brush, patch);
    if ('s' in patch) Object.assign(this.brush, { h: FENCE_TYPES[patch.s].h || this.brush.h, c: '' });
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Free drawing: every click adds a point, the side leading to it takes the current type. */
  startDraw() {
    this.edit = null;
    this.draw = { pts: [], segs: [] };
    this.ed.setClickTool({ key: 'fence-draw', click: (hit) => this._drawClick(hit), draft: (d) => this._draft(d) });
  }

  _drawClick(hit) {
    const D = this.draw;
    if (D.pts.length) D.segs.push(this._side());
    D.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  undoPoint() {
    const D = this.draw;
    if (!D || !D.pts.length) return;
    D.pts.pop();
    D.segs.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** End the drawing; `closed` joins the last point to the first one. */
  finishDraw(closed) {
    const D = this.draw;
    if (!D || D.pts.length < (closed ? 3 : 2)) return false;
    if (closed) D.segs.push(this._side());
    this.fences.push({ pts: D.pts, closed, segs: D.segs, frame: this.ed.frame });
    this.draw = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
    this.ed.commit();
    return true;
  }

  cancel() {
    this.draw = null;
    this.edit = null;
    this.ed.setClickTool(null);
  }

  /** Edit fence i with a click tool: paint (give the current type to a side), cut (a side in two), unpoint. */
  startEdit(i, tool = 'paint') {
    this.draw = null;
    this.fences[i] = normalizeFence(this.fences[i]);
    this.edit = { i, tool };
    this.ed.setClickTool({ key: 'fence-edit', click: (hit) => this._editClick(hit), draft: (d) => this._draft(d) });
  }

  setTool(tool) {
    if (!this.edit) return;
    this.edit.tool = tool;
    this.ed.onChange(false);
  }

  _editClick(hit) {
    const f = this.fences[this.edit.i];
    if (!f) return;
    const toPlan = this.ed.toPlan(f);
    const P = f.pts.map(([x, z]) => toPlan(x, z));
    const { x, z } = hit.point;
    if (this.edit.tool === 'unpoint') {
      const n = nearestPoint(P, x, z);
      if (n.d > 2.5 || !removePoint(f, n.i)) return;
    } else {
      const n = nearestSide(P, f.closed, x, z);
      if (n.i < 0 || n.d > 3) return;
      if (this.edit.tool === 'cut') {
        if (!splitSide(f, n.i, n.t)) return;
      } else f.segs[n.i] = this._side();
    }
    this.ed.commit();
  }

  toggleHidden(i) {
    this.fences[i].hidden = !this.fences[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.fences.splice(i, 1);
    if (this.edit) this.cancel();
    this.ed.commit();
  }

  /** Overlay: sides as colored strips (one color per type), points as dots. */
  _draft(d) {
    const show = (f) => {
      const toPlan = this.ed.toPlan(f);
      const P = f.pts.map(([x, z]) => toPlan(x, z));
      const n = f.closed ? P.length : P.length - 1;
      for (let i = 0; i < n; i++) {
        const s = (f.segs[i] && f.segs[i].s) || 'mesh';
        d.ribbon([P[i], P[(i + 1) % P.length]], FENCE_TYPES[s].draft, s === 'none' ? 0.12 : 0.3);
      }
      for (const [x, z] of P) d.dot(x, z, '#ffffff');
    };
    if (this.draw) show({ pts: this.draw.pts, segs: this.draw.segs, closed: false, frame: this.ed.frame });
    else if (this.edit && this.fences[this.edit.i]) show(this.fences[this.edit.i]);
  }
}

export class IrrigationTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // id of the line / circuit unfolded in the panel
    this.draw = null; // { id, pts } of the drip line being drawn
    this.mode = null; // { kind: place | aim, cid, hid }
    this.demo = null; // accelerated test: { ids: Set, all, t0, speed, dur } (the valves stay closed)
  }

  get irr() {
    return this.ed.edits.irrigation;
  }

  line(id) {
    return this.irr.lines.find((l) => l.id === id);
  }

  circuit(id) {
    return this.irr.circuits.find((c) => c.id === id);
  }

  setSoil(soil) {
    this.irr.soil = soil;
    this.ed.onChange();
  }

  // ---- drip lines

  addLine() {
    const ln = { id: uid('l'), name: '', entity: '', color: 'black', flow: 2, spacing: 0.3, pts: [], frame: this.ed.frame };
    this.irr.lines.push(ln);
    this.sel = ln.id;
    this.drawLine(ln.id);
    return ln.id;
  }

  /** Draw (or redraw) a line: every click adds a point, the pipe is rounded through the points. */
  drawLine(id, keep = false) {
    const ln = this.line(id);
    if (!ln) return;
    this.mode = null;
    this.draw = { id, pts: keep ? ln.pts.map((p) => [...p]) : [], frame: keep ? ln.frame : this.ed.frame };
    this.ed.setClickTool({
      key: 'drip',
      click: (hit) => {
        this.draw.pts.push(this.draw.frame === 'plan' ? [r2(hit.point.x), r2(hit.point.z)] : this.ed.toStore(hit.point.x, hit.point.z));
        this.ed.drawDraft();
        this.ed.onChange(false);
      },
      draft: (d) => {
        const toPlan = this.ed.toPlan(this.draw);
        const P = this.draw.pts.map(([x, z]) => toPlan(x, z));
        if (P.length > 1) d.ribbon(smoothPath(P, 0.3), '#2f8fff', 0.12);
        for (const [x, z] of P) d.dot(x, z, '#ffe14d');
      },
    });
  }

  undoPoint() {
    if (!this.draw) return;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  finishLine() {
    const D = this.draw;
    const ln = D && this.line(D.id);
    if (!ln || D.pts.length < 2) return false;
    ln.pts = D.pts;
    ln.frame = D.frame;
    this._leave();
    this.ed.commit();
    return true;
  }

  _leave() {
    this.draw = null;
    this.mode = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
  }

  cancel() {
    // a new line that never got its points is dropped
    if (this.draw) this.irr.lines = this.irr.lines.filter((l) => l.id !== this.draw.id || l.pts.length >= 2);
    this.draw = null;
    this.mode = null;
    this.ed.setClickTool(null);
  }

  editLine(id, patch) {
    Object.assign(this.line(id), patch);
    if (['color', 'spacing', 'flow'].some((k) => k in patch)) this.ed.commit();
    else this.ed.onChange();
  }

  removeLine(id) {
    this.irr.lines = this.irr.lines.filter((l) => l.id !== id);
    if (this.draw && this.draw.id === id) this._leave();
    this.ed.commit();
  }

  // ---- sprinkler circuits

  addCircuit() {
    const c = { id: uid('c'), name: '', entity: '', heads: [] };
    this.irr.circuits.push(c);
    this.sel = c.id;
    this.ed.onChange();
    return c.id;
  }

  editCircuit(id, patch) {
    Object.assign(this.circuit(id), patch);
    this.ed.onChange();
  }

  removeCircuit(id) {
    this.irr.circuits = this.irr.circuits.filter((c) => c.id !== id);
    this.ed.commit();
  }

  head(cid, hid) {
    const c = this.circuit(cid);
    return c && c.heads.find((h) => h.id === hid);
  }

  addHead(cid, modelId) {
    const c = this.circuit(cid);
    const last = c.heads[c.heads.length - 1];
    const h = { id: uid('h'), ...headDefaults(modelId || (last && last.model) || 'hunter-psu-04-15a'), at: null, frame: this.ed.frame };
    c.heads.push(h);
    this.placeHead(cid, h.id);
    return h.id;
  }

  /** Next click sets the position of the head. */
  placeHead(cid, hid) {
    this.draw = null;
    this.mode = { kind: 'place', cid, hid };
    this.ed.setClickTool({
      key: 'head-place',
      click: (hit) => {
        const h = this.head(cid, hid);
        h.frame = this.ed.frame;
        h.at = this.ed.toStore(hit.point.x, hit.point.z);
        this._leave();
        this.ed.commit();
      },
    });
  }

  /** Next click aims the head: direction towards the click, range = distance (within what the model can do). */
  aimHead(cid, hid) {
    this.draw = null;
    this.mode = { kind: 'aim', cid, hid };
    this.ed.setClickTool({
      key: 'head-aim',
      click: (hit) => {
        const h = this.head(cid, hid);
        if (!h || !h.at) return;
        const at = this.ed.toPlan(h)(h.at[0], h.at[1]);
        const to = [hit.point.x, hit.point.z];
        const m = sprinklerModel(h.model);
        h.dir = Math.round(bearing(at, to)) % 360;
        h.rMax = r2(Math.min(Math.max(Math.hypot(to[0] - at[0], to[1] - at[1]), m.rRange[0]), m.rRange[1]));
        h.rMin = Math.min(h.rMin, r2(h.rMax * 0.5));
        this._leave();
        this.ed.commit();
      },
    });
  }

  editHead(cid, hid, patch) {
    const h = this.head(cid, hid);
    if ('model' in patch) Object.assign(h, headDefaults(patch.model), { dir: h.dir });
    else Object.assign(h, patch);
    h.rMax = Math.max(h.rMax, 0.5);
    h.rMin = Math.min(Math.max(h.rMin, 0), h.rMax - 0.1);
    this.ed.commit();
  }

  removeHead(cid, hid) {
    const c = this.circuit(cid);
    c.heads = c.heads.filter((h) => h.id !== hid);
    this.ed.commit();
  }

  /**
   * Accelerated test without opening any valve: the given lines / circuits (all of them when `ids` is null) are shown
   * as open, time running `speed` times faster (30 s show 1 h 30 of watering).
   */
  startDemo(ids = null) {
    const all = [...this.irr.lines, ...this.irr.circuits].map((o) => o.id);
    this.demo = { ids: new Set(ids || all), all: !ids, t0: Date.now(), speed: 180, dur: 30000 };
    return this.demo.ids.size > 0;
  }

  /** "Open since" of the tested ids at `now` (virtual time), or null when the test is over. */
  demoSince(now) {
    const D = this.demo;
    if (!D || now - D.t0 > D.dur) return null;
    const since = now - (now - D.t0) * D.speed;
    return Object.fromEntries([...D.ids].map((id) => [id, since]));
  }

  testing(id) {
    return !!this.demo && this.demo.ids.has(id);
  }
}

export class VacuumTools {
  constructor(ed) {
    this.ed = ed;
    this.mode = null; // dock | aim | calib | map-pin
  }

  get vac() {
    return this.ed.edits.vacuum;
  }

  /** Next click (on a floor) places the dock. */
  placeDock() {
    this.mode = 'dock';
    this.ed.setClickTool({
      key: 'dock',
      click: (hit) => {
        this.vac.dock = {
          ...(this.vac.dock || {}),
          at: [r2(hit.point.x), r2(hit.point.z)],
          level: hit.level,
          base: r2(hit.floorY ?? hit.point.y),
        };
        this._leave();
        this.ed.commit();
      },
    });
  }

  /** Next click gives the way the dock faces (its front points to the click). */
  aimDock() {
    if (!this.vac.dock || !this.vac.dock.at) return;
    this.mode = 'aim';
    this.ed.setClickTool({
      key: 'dock-aim',
      click: (hit) => {
        this.vac.dock.dir = Math.round(bearing(this.vac.dock.at, [hit.point.x, hit.point.z])) % 360;
        this._leave();
        this.ed.commit();
      },
    });
  }

  /** Turn the dock by `deg` degrees (clockwise seen from above). */
  turnDock(deg) {
    if (!this.vac.dock) return;
    this.vac.dock.dir = ((((this.vac.dock.dir ?? 90) + deg) % 360) + 360) % 360;
    this.ed.commit();
  }

  /** Next click tells where the robot really is now: `done([x, z])` computes the rotation. */
  calibrate(done) {
    this.mode = 'calib';
    this.ed.setClickTool({
      key: 'calib',
      click: (hit) => {
        this._leave();
        done([hit.point.x, hit.point.z]);
      },
    });
  }

  /** Next click tells where the dock is drawn on the picture of the robot's map: `done([x, z])` pins it there. */
  pinMap(done) {
    this.mode = 'map-pin';
    this.ed.setClickTool({
      key: 'map-pin',
      click: (hit) => {
        this._leave();
        done([hit.point.x, hit.point.z]);
      },
    });
  }

  _leave() {
    this.mode = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
  }

  cancel() {
    this.mode = null;
    this.ed.setClickTool(null);
  }

  set(patch, rebuild = false) {
    Object.assign(this.vac, patch);
    if (rebuild) this.ed.commit();
    else this.ed.onChange();
  }
}
