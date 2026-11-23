// Feature editors built on the click tool of WorldEditors: fences (free drawing, type per side, cutting), watering
// (drip lines, sprinklers) and the robot vacuum dock. They only change `ed.edits` and ask for a rebuild.
import { FENCE_TYPES, normalizeFence, nearestSide, nearestPoint, splitSide, removePoint } from './fences.js';
import { normalizeBed, polygonArea, BED_MAX } from './flowerbeds.js';
import { normalizeGate, placeGate } from './gates.js';
import { smoothPath, headDefaults, sprinklerModel, bearing } from './irrigation.js';
import { PATH_SURFACES, normalizePath } from './paths.js';

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
    // the gates of that fence go with it, the following fences move up one place
    const gates = this.ed.edits.gates || [];
    this.ed.edits.gates = gates.filter((g) => g.f !== i).map((g) => (g.f > i ? { ...g, f: g.f - 1 } : g));
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

/**
 * Gates: added with a tap on a fence (the fence opens under it by itself), moved with another tap on a fence, edited
 * and deleted from the list. Several gates can sit on the same fence, even on the same side.
 */
export class GateTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the gate unfolded in the panel
    this.demo = new Set(); // gates shown open to try the animation: ids
    this.mode = null; // 'add' | 'move'
  }

  get gates() {
    return this.ed.edits.gates;
  }

  get fences() {
    return this.ed.edits.fences;
  }

  /** The fence side nearest to a click: { f, at: [x, z] (frame of that fence) } or null. */
  _target(hit) {
    let best = null;
    this.fences.forEach((raw, f) => {
      if (raw.hidden) return;
      const fe = normalizeFence(raw);
      const toPlan = this.ed.toPlan(raw);
      const P = fe.pts.map(([x, z]) => toPlan(x, z));
      const n = nearestSide(P, fe.closed, hit.point.x, hit.point.z);
      if (n.i < 0 || n.d > 4 || (best && n.d >= best.d)) return;
      const [a, b] = [fe.pts[n.i], fe.pts[(n.i + 1) % fe.pts.length]];
      best = { d: n.d, f, at: [r2(a[0] + (b[0] - a[0]) * n.t), r2(a[1] + (b[1] - a[1]) * n.t)] };
    });
    return best;
  }

  _arm(mode) {
    this.mode = mode;
    this.ed.setClickTool({ key: 'gate-pick', click: (hit) => this._click(hit), draft: (d) => this._draft(d) });
  }

  startAdd() {
    this._arm('add');
  }

  startMove(i) {
    this.sel = i;
    this._arm('move');
  }

  _click(hit) {
    const tg = this._target(hit);
    if (!tg) return;
    if (this.mode === 'move' && this.gates[this.sel]) Object.assign(this.gates[this.sel], { f: tg.f, at: tg.at });
    else {
      this.gates.push(normalizeGate({ id: uid('g'), f: tg.f, at: tg.at }));
      this.sel = this.gates.length - 1;
    }
    this.cancel(false);
    this.ed.commit();
  }

  cancel(redraw = true) {
    this.mode = null;
    this.ed.setClickTool(null);
    if (redraw) this.ed.onChange(false);
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  edit(i, patch) {
    this.gates[i] = normalizeGate({ ...this.gates[i], ...patch });
    this.ed.commit();
  }

  toggleDemo(id) {
    if (!this.demo.delete(id)) this.demo.add(id);
    this.ed.onChange(false);
  }

  toggleHidden(i) {
    this.gates[i].hidden = !this.gates[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.demo.delete(this.gates[i].id);
    this.gates.splice(i, 1);
    this.sel = null;
    if (this.mode) this.cancel(false);
    this.ed.commit();
  }

  /** True when gate i lies on a fence (otherwise it is not drawn: its fence was removed or moved away). */
  placed(i) {
    const g = normalizeGate(this.gates[i]);
    const raw = this.fences[g.f];
    return !!raw && !!placeGate(g, normalizeFence(raw));
  }

  /** Overlay: every gate as a strip along its side, the selected one in yellow. */
  _draft(d) {
    this.gates.forEach((raw, i) => {
      const g = normalizeGate(raw);
      const fr = this.fences[g.f];
      if (!fr) return;
      const fe = normalizeFence(fr);
      const p = placeGate(g, fe);
      if (!p) return;
      const toPlan = this.ed.toPlan(fr);
      const [a, b] = [fe.pts[p.i], fe.pts[(p.i + 1) % fe.pts.length]];
      const at = (t) => toPlan(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      d.ribbon([at(p.t - p.w / 2 / p.L), at(p.t + p.w / 2 / p.L)], i === this.sel ? '#ffee00' : '#ffffff', 0.5);
    });
  }
}

/** Flower beds: draw an area, then set the number of flowers and the list of colours (with weights). */
export class BedTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the bed unfolded in the panel
    this.draw = null; // { pts } of the bed being drawn
  }

  get beds() {
    return this.ed.edits.beds;
  }

  startDraw() {
    this.draw = { pts: [] };
    this.ed.setClickTool({ key: 'bed-draw', click: (hit) => this._click(hit), draft: (d) => this._draft(d) });
  }

  _click(hit) {
    this.draw.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Close the polygon: the bed gets about 20 flowers per m² (to adjust afterwards). */
  finishDraw() {
    const D = this.draw;
    if (!D || D.pts.length < 3) return false;
    const count = Math.max(10, Math.min(BED_MAX, Math.round(polygonArea(D.pts) * 20)));
    this.beds.push(normalizeBed({ pts: D.pts, frame: this.ed.frame, count, seed: Math.floor(Math.random() * 1e6) }));
    this.sel = this.beds.length - 1;
    this.draw = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
    this.ed.commit();
    return true;
  }

  cancel() {
    this.draw = null;
    this.ed.setClickTool(null);
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  /** Change count / height / name / seed of bed i. */
  edit(i, patch) {
    this.beds[i] = normalizeBed({ ...this.beds[i], ...patch });
    this.ed.commit();
  }

  /** Change colour k of bed i (hex, weight); k = colors.length adds one. */
  setColor(i, k, patch) {
    const b = normalizeBed(this.beds[i]);
    const list = b.colors.map((x) => ({ ...x }));
    list[k] = { c: '#ff69b4', w: 1, ...list[k], ...patch };
    this.edit(i, { colors: list });
  }

  removeColor(i, k) {
    const b = normalizeBed(this.beds[i]);
    if (b.colors.length <= 1) return;
    this.edit(i, { colors: b.colors.filter((_, n) => n !== k) });
  }

  toggleHidden(i) {
    this.beds[i].hidden = !this.beds[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.beds.splice(i, 1);
    this.sel = null;
    this.ed.commit();
  }

  _draft(d) {
    const show = (pts, closed) => {
      const toPlan = this.ed.toPlan({ frame: this.ed.frame });
      const P = pts.map(([x, z]) => toPlan(x, z));
      for (let i = 0; i < P.length - (closed ? 0 : 1); i++) d.ribbon([P[i], P[(i + 1) % P.length]], '#ff4fd8', 0.3);
      for (const [x, z] of P) d.dot(x, z, '#ffffff');
    };
    if (this.draw) show(this.draw.pts, false);
    else
      this.beds.forEach((b, i) => {
        if (i !== this.sel) return;
        const toPlan = this.ed.toPlan(b);
        const P = b.pts.map(([x, z]) => toPlan(x, z));
        for (let k = 0; k < P.length; k++) d.ribbon([P[k], P[(k + 1) % P.length]], '#ff4fd8', 0.3);
      });
  }
}

/**
 * Drives and paths: draw a centre line (every click adds a point, the strip is rounded through them), then set its
 * width and surface. A path can be drawn again or extended from its last point.
 */
export class PathTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the path unfolded in the panel
    this.draw = null; // { i (null: a new path), pts, frame } of the line being drawn
  }

  get paths() {
    return this.ed.edits.paths;
  }

  /** Draw a new path (i = null), draw path i again, or extend it (keep = true). */
  startDraw(i = null, keep = false) {
    const old = i === null ? null : this.paths[i];
    this.draw = {
      i,
      pts: old && keep ? old.pts.map((q) => [...q]) : [],
      frame: old && keep ? old.frame || 'grid' : this.ed.frame,
    };
    this.ed.setClickTool({ key: 'path-draw', click: (hit) => this._click(hit), draft: (d) => this._draft(d) });
  }

  _click(hit) {
    const D = this.draw;
    D.pts.push(
      D.frame === 'plan'
        ? [Math.round(hit.point.x * 100) / 100, Math.round(hit.point.z * 100) / 100]
        : this.ed.toStore(hit.point.x, hit.point.z),
    );
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  finishDraw() {
    const D = this.draw;
    if (!D || D.pts.length < 2) return false;
    if (D.i === null) {
      this.paths.push(normalizePath({ id: uid('p'), pts: D.pts, frame: D.frame }));
      this.sel = this.paths.length - 1;
    } else this.paths[D.i] = normalizePath({ ...this.paths[D.i], pts: D.pts, frame: D.frame });
    this.draw = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
    this.ed.commit();
    return true;
  }

  cancel() {
    this.draw = null;
    this.ed.setClickTool(null);
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  /** Change width / surface / kerbs / name of path i. */
  edit(i, patch) {
    this.paths[i] = normalizePath({ ...this.paths[i], ...patch });
    this.ed.commit();
  }

  toggleHidden(i) {
    this.paths[i].hidden = !this.paths[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.paths.splice(i, 1);
    this.sel = null;
    if (this.draw) this.cancel();
    this.ed.commit();
  }

  /** Overlay: the line being drawn at its width (or the selected path), its points as dots. */
  _draft(d) {
    const D = this.draw;
    const old = D && D.i !== null ? normalizePath(this.paths[D.i]) : null;
    const brush = old || normalizePath({});
    const toPlan = this.ed.toPlan({ frame: D ? D.frame : this.ed.frame });
    const P = (D ? D.pts : []).map(([x, z]) => toPlan(x, z));
    if (P.length > 1) d.ribbon(smoothPath(P, 0.5), PATH_SURFACES[brush.surface].draft, brush.w);
    for (const [x, z] of P) d.dot(x, z, '#ffffff');
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
  /** `settings()`: the settings of the robot being set up (created when missing). */
  constructor(ed, settings) {
    this.ed = ed;
    this.settings = settings;
    this.mode = null; // dock | aim | calib | map-pin
  }

  get vac() {
    return this.settings();
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
