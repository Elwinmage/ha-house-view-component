// Feature editors built on the click tool of WorldEditors: fences (free drawing, type per side, cutting), watering
// (drip lines, sprinklers) and the robot vacuum dock. They only change `ed.edits` and ask for a rebuild.
import { fenceType, normalizeFence, nearestSide, nearestPoint, splitSide, removePoint } from './fences.js';
import { normalizeBed, polygonArea, BED_MAX } from './flowerbeds.js';
import { normalizeGate, placeGate } from './gates.js';
import { smoothPath, headDefaults, sprinklerModel, bearing } from './irrigation.js';
import { normalizePath } from './paths.js';
import { flightSize } from './stairs.js';
import { pathKind } from './path-art.js';
import { MIN_SIDE, dropPoint, insertPoint, normalizeTerrace, outlineAngle, rotateOutline } from './terraces.js';
import { terraceLook } from './terrace-art.js';
import { centroidOf, inPolygon, rectFromCorners, resizeRect } from './pools.js';
import { movedPts } from './move.js';
import { ROOF_DY, buildingOutline, normalizeRoof, roofAltitude } from './roofs.js';
import { planToGrid } from './engine/terrain.js';
import { houseOutline, unionOutline } from './engine/footprint.js';

const uid = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

//: What the editor rings in red: the object the settings on the panel belong to.
const SEL_COLOR = '#ff3b30';

/** A circle on the ground as a closed polyline, to ring what is being set up. */
const ringPts = (x, z, r, n = 28) =>
  Array.from({ length: n + 1 }, (_, i) => [x + r * Math.cos((i * 2 * Math.PI) / n), z + r * Math.sin((i * 2 * Math.PI) / n)]);
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * The points of an object drawn on the ground (`pts`, in its own frame) as handles in the view: what the move tool
 * works on, and the handles dragged right away while the object is being edited (editors.js, setHandles).
 */
function pointsSpec(ed, key, o, more = {}) {
  const pts = () => {
    const toPlan = ed.toPlan(o);
    return o.pts.map(([x, z]) => toPlan(x, z));
  };
  return {
    key,
    points: pts,
    move: (h, x, z, from) => {
      const store = ed.fromPlan(o);
      o.pts = movedPts(pts(), h, x, z, from).map(([a, b]) => store(a, b));
    },
    commit: () => ed.commit(),
    ...more,
  };
}

/**
 * The same handles for an object that is nothing but its points (a path, a flower bed, a drip line): a point can be
 * added on one of its sides or removed (editors.js, setPointsTool). A fence and a terrace have tools of their own
 * for that: their sides carry a type, their outline a shape.
 */
const freePointsSpec = (ed, key, o, more = {}) =>
  pointsSpec(ed, key, o, {
    insert: (i, x, z) => o.pts.splice(i + 1, 0, ed.fromPlan(o)(x, z)),
    remove: (i) => o.pts.splice(i, 1),
    ...more,
  });

export class FenceTools {
  constructor(ed) {
    this.ed = ed;
    // what the next sides are given: kind, height, colour, and for a wall its coping with a colour of its own
    this.brush = { s: 'mesh', h: fenceType('mesh').h, c: '', cap: '', capc: '' };
    this.draw = null; // { pts, segs } of the fence being drawn
    this.edit = null; // { i, tool: paint | cut | unpoint }
  }

  get fences() {
    return this.ed.edits.fences;
  }

  _side() {
    const B = this.brush;
    // the coping goes with a wall only; it stays in the brush for the next wall
    const cap = B.cap && fenceType(B.s).cap ? { cap: B.cap, ...(B.capc ? { capc: B.capc } : {}) } : {};
    return { s: B.s, h: B.h, ...(B.c ? { c: B.c } : {}), ...cap };
  }

  setBrush(patch) {
    Object.assign(this.brush, patch);
    if ('s' in patch) Object.assign(this.brush, { h: fenceType(patch.s).h || this.brush.h, c: '' });
    if ('cap' in patch) this.brush.capc = ''; // another coping: its own colour again
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Free drawing: every click adds a point, the side leading to it takes the current type. */
  startDraw() {
    this.edit = null;
    this.draw = { pts: [], segs: [] };
    this.ed.setClickTool({
      key: 'fence-draw',
      click: (hit) => this._drawClick(hit),
      draft: (d) => this._draft(d),
      undo: () => this.undoPoint(),
    });
  }

  _drawClick(hit) {
    const D = this.draw;
    if (D.pts.length) D.segs.push(this._side());
    D.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Take back the last point of the fence being drawn; false when it has none. */
  undoPoint() {
    const D = this.draw;
    if (!D || !D.pts.length) return false;
    D.pts.pop();
    D.segs.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
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

  /**
   * The corrections were put back as they were (undo, redo): `lists` names the lists where an entry came or went.
   * A fence came or went: the one being edited, known by its rank, may be another one now.
   */
  restored(lists) {
    if (!lists.includes('fences')) return;
    this.draw = null;
    this.edit = null;
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

  /** Move the points of fence `i` in the view, or the whole fence (the gates on it follow their side). */
  startMove(i) {
    this.draw = null;
    this.edit = null;
    const f = (this.fences[i] = normalizeFence(this.fences[i]));
    this.ed.setMoveTool(pointsSpec(this.ed, `fence:${i}`, f, { closed: f.closed }));
  }

  /** The points of the fence whose sides are being edited, dragged right away in the view; null without one. */
  handles() {
    const f = this.edit ? this.fences[this.edit.i] : null;
    return f && Array.isArray(f.pts) && f.pts.length > 1
      ? pointsSpec(this.ed, `fence-pts:${this.edit.i}`, f, { closed: !!f.closed })
      : null;
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
        d.ribbon([P[i], P[(i + 1) % P.length]], fenceType(s).draft, s === 'none' ? 0.12 : 0.3);
      }
      for (const [x, z] of P) d.dot(x, z, '#ffffff');
    };
    if (this.draw) show({ pts: this.draw.pts, segs: this.draw.segs, closed: false, frame: this.ed.frame });
    else if (this.edit && this.fences[this.edit.i]) show(this.fences[this.edit.i]);
  }
}

/**
 * Gates: added with a tap on a fence (the fence opens under it by itself), moved by dragging them along the fences
 * (startMove), edited and deleted from the list. Several gates can sit on the same fence, even on the same side.
 */
export class GateTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the gate unfolded in the panel
    this.demo = new Set(); // gates shown open to try the animation: ids
    this.mode = null; // 'add' while waiting for the tap that puts a new gate on a fence
  }

  get gates() {
    return this.ed.edits.gates;
  }

  get fences() {
    return this.ed.edits.fences;
  }

  /** The fence side nearest to a plan point: { f, at: [x, z] (frame of that fence) } or null. */
  _target(x, z) {
    let best = null;
    this.fences.forEach((raw, f) => {
      if (raw.hidden) return;
      const fe = normalizeFence(raw);
      const toPlan = this.ed.toPlan(raw);
      const P = fe.pts.map(([x, z]) => toPlan(x, z));
      const n = nearestSide(P, fe.closed, x, z);
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

  /**
   * Move gate `i`: its handle is dragged in the view and falls back on the nearest side of a fence (another fence
   * will do: the gate changes fence). Out of reach of every fence, it stays where it was.
   */
  startMove(i) {
    this.sel = i;
    const g = (this.gates[i] = normalizeGate(this.gates[i]));
    const place = () => {
      const fe = this.fences[g.f];
      const toPlan = this.ed.toPlan(fe || {});
      return fe ? [toPlan(g.at[0], g.at[1])] : [];
    };
    this.ed.setMoveTool({
      key: `gate:${i}`,
      whole: false,
      points: place,
      move: (h, x, z) => {
        const tg = this._target(x, z);
        if (tg) Object.assign(g, { f: tg.f, at: tg.at });
      },
      draft: (d, grab) => {
        this._draftFences(d);
        const P = place();
        if (P.length) d.dot(P[0][0], P[0][1], grab ? '#ffe14d' : '#4cd964');
      },
      commit: () => this.ed.commit(),
    });
  }

  /** The fences on the ground, to see where a gate may be put. */
  _draftFences(d) {
    this.fences.forEach((raw) => {
      if (raw.hidden) return;
      const fe = normalizeFence(raw);
      const toPlan = this.ed.toPlan(raw);
      const P = fe.pts.map(([x, z]) => toPlan(x, z));
      const n = fe.closed ? P.length : P.length - 1;
      for (let k = 0; k < n; k++) d.ribbon([P[k], P[(k + 1) % P.length]], '#7b8a95', 0.12);
    });
  }

  _click(hit) {
    const tg = this._target(hit.point.x, hit.point.z);
    if (!tg) return;
    this.gates.push(normalizeGate({ id: uid('g'), f: tg.f, at: tg.at }));
    this.sel = this.gates.length - 1;
    this.cancel(false);
    this.ed.commit();
  }

  cancel(redraw = true) {
    this.mode = null;
    this.ed.setClickTool(null);
    if (redraw) this.ed.onChange(false);
  }

  /** After an undo or a redo (see FenceTools): a gate or a fence came or went, the gate unfolded is folded. */
  restored(lists) {
    if (!lists.includes('gates') && !lists.includes('fences')) return;
    this.sel = null;
    this.mode = null;
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
    this.ed.setClickTool({
      key: 'bed-draw',
      click: (hit) => this._click(hit),
      draft: (d) => this._draft(d),
      undo: () => this.undoPoint(),
    });
  }

  _click(hit) {
    this.draw.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Take back the last point of the shape being drawn; false when it has none. */
  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return false;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
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

  /** After an undo or a redo (see FenceTools): an entry came or went, the one unfolded is folded. */
  restored(lists) {
    if (!lists.includes('beds')) return;
    this.sel = null;
    this.draw = null;
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  /** The points of the flower bed unfolded in the panel, dragged right away in the view; null without one. */
  handles() {
    const b = this.sel !== null && !this.draw ? this.beds[this.sel] : null;
    return b && Array.isArray(b.pts) && b.pts.length > 2 ? freePointsSpec(this.ed, `bed-pts:${this.sel}`, b, { closed: true }) : null;
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
 * Roofs read from the surface model of the terrain (roofs.js): the outline of a roof is drawn from above, point by
 * point, or taken from the building of the map; its slopes are then found inside it at every rebuild.
 */
export class RoofTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the roof unfolded in the panel
    this.draw = null; // { pts } of the outline being drawn
    this.overhang = 0.3; // eaves given to an outline taken from the walls of the plan (m)
  }

  get roofs() {
    return this.ed.edits.roofs;
  }

  /** The terrain comes with a surface model: roofs can be read. */
  get hasModel() {
    return !!(this.ed.cfg && Array.isArray(this.ed.cfg.data.s));
  }

  /** The outline of the building of the map standing where the house is (grid frame), null without one. */
  building() {
    const cfg = this.ed.cfg;
    const sd = this.ed.engine.world && this.ed.engine.world.sd;
    if (!cfg || !sd) return null;
    const b = sd.bbox;
    const [gx, gz] = planToGrid(cfg.data, cfg)((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    return buildingOutline(cfg.data, gx, gz);
  }

  startDraw() {
    this.draw = { pts: [] };
    this.ed.setClickTool({
      key: 'roof-draw',
      click: (hit) => this._click(hit),
      draft: (d) => this._draft(d),
      undo: () => this.undoPoint(),
    });
  }

  _click(hit) {
    this.draw.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Take back the last point of the shape being drawn; false when it has none. */
  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return false;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
  }

  _add(pts, frame) {
    this.roofs.push(normalizeRoof({ id: uid('r'), pts, frame }));
    this.sel = this.roofs.length - 1;
    this.draw = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
    this.ed.commit();
    return true;
  }

  /** Close the outline: the roof is read inside it. */
  finishDraw() {
    const D = this.draw;
    return !!D && D.pts.length >= 3 && this._add(D.pts, this.ed.frame);
  }

  /**
   * A roof over the building of the map standing where the house is. The map is seldom right to the metre, and the
   * plan is set on it by eye: where the walls of the plan stand out of the building, the roof covers them too, or
   * rooms would be left open to the sky along its edges. Its points are then moved, added or removed as needed.
   */
  fromBuilding() {
    const pts = this.building();
    if (!pts) return false;
    const house = this._houseOutline();
    const toGrid = house ? planToGrid(this.ed.cfg.data, this.ed.cfg) : null;
    return this._add((house && unionOutline([pts, house.map(([x, z]) => toGrid(x, z))])) || pts, 'grid');
  }

  setOverhang(v) {
    this.overhang = Math.min(1.5, Math.max(0, r2(v)));
    this.ed.onChange(false);
  }

  /**
   * The outline of the house of the plan (plan frame, null without rooms): the outer face of its walls, pushed out
   * by the eaves. Where the walls step back under the roof (an entrance set in the facade, a porch), the surface
   * model shows the roof going across: the outline does the same.
   */
  _houseOutline() {
    const sd = this.ed.engine.world && this.ed.engine.world.sd;
    if (!sd) return null;
    const cfg = this.ed.cfg;
    let roofAt = null;
    if (this.hasModel) {
      const toGrid = planToGrid(cfg.data, cfg);
      const altitude = roofAltitude(cfg.data);
      // (a flat roof of the plan standing beside the house, over a terrace, is a roof of its own: what the surface
      // model shows there is not the roof of the house going on)
      const walls = houseOutline(sd.levels, 0);
      const middle = (p) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
      const beside = ((sd.roof && sd.roof.type === 'flat' && sd.roof.polys) || []).filter((p) => walls && !inPolygon(walls, ...middle(p)));
      roofAt = (x, z) => (beside.some((p) => inPolygon(p, x, z)) ? null : altitude(...toGrid(x, z)));
    }
    return houseOutline(sd.levels, this.overhang, roofAt);
  }

  /** A roof over the house of the plan (_houseOutline). */
  fromPlan() {
    const pts = this._houseOutline();
    return (
      !!pts &&
      this._add(
        pts.map(([x, z]) => this.ed.toStore(x, z)),
        this.ed.frame,
      )
    );
  }

  cancel() {
    this.draw = null;
    this.ed.setClickTool(null);
  }

  /** After an undo or a redo (see FenceTools): an entry came or went, the one unfolded is folded. */
  restored(lists) {
    if (!lists.includes('roofs')) return;
    this.sel = null;
    this.draw = null;
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  /** The points of the roof unfolded in the panel, dragged right away in the view; null without one. */
  handles() {
    const r = this.sel !== null && !this.draw ? this.roofs[this.sel] : null;
    return r && Array.isArray(r.pts) && r.pts.length > 2 ? freePointsSpec(this.ed, `roof-pts:${this.sel}`, r, { closed: true }) : null;
  }

  /** Change the height, the colour or the name of roof i. */
  edit(i, patch) {
    const dy = 'dy' in patch ? Math.min(ROOF_DY[1], Math.max(ROOF_DY[0], patch.dy)) : null;
    this.roofs[i] = normalizeRoof({ ...this.roofs[i], ...patch, ...(dy === null ? {} : { dy: r2(dy) }) });
    this.ed.commit();
  }

  toggleHidden(i) {
    this.roofs[i].hidden = !this.roofs[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.roofs.splice(i, 1);
    this.sel = null;
    this.ed.commit();
  }

  _draft(d) {
    if (!this.draw) return;
    const toPlan = this.ed.toPlan({ frame: this.ed.frame });
    const P = this.draw.pts.map(([x, z]) => toPlan(x, z));
    for (let i = 0; i < P.length - 1; i++) d.ribbon([P[i], P[i + 1]], '#ff7a3d', 0.3);
    for (const [x, z] of P) d.dot(x, z, '#ffffff');
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
    this.ed.setClickTool({
      key: 'path-draw',
      click: (hit) => this._click(hit),
      draft: (d) => this._draft(d),
      undo: () => this.undoPoint(),
    });
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

  /** Take back the last point of the shape being drawn; false when it has none. */
  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return false;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
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

  /** After an undo or a redo (see FenceTools): an entry came or went, the one unfolded is folded. */
  restored(lists) {
    if (!lists.includes('paths')) return;
    this.sel = null;
    this.draw = null;
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.onChange(false);
  }

  /** The points of the path unfolded in the panel, dragged right away in the view; null without one. */
  handles() {
    const p = this.sel !== null && !this.draw ? this.paths[this.sel] : null;
    return p && Array.isArray(p.pts) && p.pts.length > 1 ? freePointsSpec(this.ed, `path-pts:${this.sel}`, p) : null;
  }

  /** Move the points of path `i` in the view, or the whole path. */
  startMove(i) {
    this.draw = null;
    const p = (this.paths[i] = normalizePath(this.paths[i]));
    this.ed.setMoveTool(pointsSpec(this.ed, `path:${i}`, p));
  }

  /** Change width / surface / kerbs / steps / name of path i. */
  edit(i, patch) {
    this.paths[i] = normalizePath({ ...this.paths[i], ...patch });
    this.ed.commit();
  }

  /**
   * What the flight of steps of path i comes to on the ground as it is: { n, rise, going } (steps, then the
   * height and the depth of one, in m); null for a path that is not a flight, or before the view is built.
   */
  flight(i) {
    const p = normalizePath(this.paths[i]);
    const world = this.ed.engine && this.ed.engine.world;
    const levelAt = world && (world.walkAt || world.groundAt);
    if (!p.stairs || p.pts.length < 2 || !levelAt) return null;
    const toPlan = this.ed.toPlan(p);
    const size = flightSize(
      smoothPath(
        p.pts.map(([x, z]) => toPlan(x, z)),
        0.5,
      ),
      levelAt,
      p.steps,
    );
    return size ? { n: size.n, rise: Math.abs(size.rise), going: size.going } : null;
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
    if (P.length > 1) d.ribbon(smoothPath(P, 0.5), (pathKind(brush.surface) || {}).draft || '#9aa0a6', brush.w);
    for (const [x, z] of P) d.dot(x, z, '#ffffff');
  }
}

/**
 * Terraces, patios and decks: an outline drawn as a rectangle (two opposite corners, square with the plan) or as a
 * free shape (a point per click), then its covering, its altitude and its thickness. Its points stay editable:
 * moved by their handles, added on a side, removed; a rectangle is also sized and turned by typing.
 */
export class TerraceTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // index of the terrace unfolded in the panel
    this.draw = null; // { i (null: a new terrace), shape, pts (store frame), hover (plan point), frame } while drawing
    this.pts = null; // { i, tool: 'add' | 'del' } while points are added to or removed from an outline
  }

  get terraces() {
    return this.ed.edits.terraces;
  }

  /** Draw a new terrace (i = null) or the outline of terrace i again, as a rectangle or a free shape. */
  startDraw(shape, i = null) {
    this.pts = null;
    const D = (this.draw = { i, shape: shape === 'rect' ? 'rect' : 'free', pts: [], hover: null, frame: this.ed.frame });
    this.ed.setClickTool({
      key: 'terrace-draw',
      hover: (hit) => {
        D.hover = hit && hit.point ? [hit.point.x, hit.point.z] : null;
        this.ed.drawDraft();
      },
      click: (hit) => this._click(hit),
      draft: (d) => this._draft(d),
      undo: () => this.undoPoint(),
    });
  }

  _click(hit) {
    const D = this.draw;
    if (D.shape === 'rect' && D.pts.length === 1) {
      // the rectangle is the one of the preview, square with the plan: its corners are stored one by one (the
      // stored frame, the one of the terrain grid, is turned against the plan)
      const first = this.ed.toPlan({ frame: D.frame })(...D.pts[0]);
      const r = rectFromCorners(first, [hit.point.x, hit.point.z]);
      if (Math.abs(r[1][0] - r[0][0]) < MIN_SIDE || Math.abs(r[2][1] - r[1][1]) < MIN_SIDE) return; // not a corner yet
      D.pts = r.map(([x, z]) => this.ed.toStore(x, z));
      this.finishDraw();
      return;
    }
    D.pts.push(this.ed.toStore(hit.point.x, hit.point.z));
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Take back the last point of the shape being drawn; false when it has none. */
  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return false;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
  }

  /** Altitude (m) of the ground in the middle of an outline, where a new terrace is laid; null without a terrain. */
  _groundAlt(pts, frame) {
    const w = this.ed.engine.world;
    if (!w || !w.terrain || !this.ed.cfg) return null;
    const toPlan = this.ed.toPlan({ frame });
    const [cx, cz] = centroidOf(pts.map(([x, z]) => toPlan(x, z)));
    return Math.round(this.ed._altOf(w.terrain.heightAt(cx, cz)) * 20) / 20;
  }

  /** Close the outline: a new terrace is laid on the ground where it is, a redrawn one keeps its altitude. */
  finishDraw() {
    const D = this.draw;
    if (!D || D.pts.length < 3) return false;
    if (D.i === null) {
      this.terraces.push(
        normalizeTerrace({ id: uid('t'), pts: D.pts, frame: D.frame, shape: D.shape, alt: this._groundAlt(D.pts, D.frame) }),
      );
      this.sel = this.terraces.length - 1;
    } else this.terraces[D.i] = normalizeTerrace({ ...this.terraces[D.i], pts: D.pts, frame: D.frame, shape: D.shape });
    this.draw = null;
    this.ed.clickTool = null;
    this.ed._syncPicker();
    this.ed.commit();
    return true;
  }

  cancel() {
    this.draw = null;
    this.pts = null;
    this.ed.setClickTool(null);
  }

  /** After an undo or a redo (see FenceTools): an entry came or went, the one unfolded is folded. */
  restored(lists) {
    if (!lists.includes('terraces')) return;
    this.sel = null;
    this.draw = null;
    this.pts = null;
  }

  select(i) {
    this.sel = this.sel === i ? null : i;
    this.ed.drawDraft();
    this.ed.onChange(false);
  }

  /** Change covering / colour / altitude / thickness / blend / laying direction / name of terrace i. */
  edit(i, patch) {
    this.terraces[i] = normalizeTerrace({ ...this.terraces[i], ...patch });
    this.ed.commit();
  }

  /** Outline of terrace i in the plan frame. */
  outline(i) {
    const t = this.terraces[i];
    const toPlan = this.ed.toPlan(t);
    return t.pts.map(([x, z]) => toPlan(x, z));
  }

  _setOutline(i, plan) {
    const store = this.ed.fromPlan(this.terraces[i]);
    this.terraces[i].pts = plan.map(([x, z]) => store(x, z));
    this.ed.commit();
  }

  /** Give a rectangular terrace a length and a width (m): it keeps its middle and its orientation. */
  resize(i, l, w) {
    this._setOutline(i, resizeRect(this.outline(i), l, w));
  }

  /** Turn terrace i about its middle until its first side points `deg` degrees from the x axis of the plan. */
  turn(i, deg) {
    const P = this.outline(i);
    this._setOutline(i, rotateOutline(P, deg - outlineAngle(P)));
  }

  /** Move the points of terrace `i` in the view, or the whole terrace. */
  startMove(i) {
    this.draw = null;
    this.pts = null;
    const t = (this.terraces[i] = normalizeTerrace(this.terraces[i]));
    this.sel = i;
    this.ed.setMoveTool(pointsSpec(this.ed, `terrace:${i}`, t, { closed: true }));
  }

  /** The points of the terrace unfolded in the panel, dragged right away in the view; null without one. */
  handles() {
    const t = this.sel !== null && !this.draw ? this.terraces[this.sel] : null;
    return t && Array.isArray(t.pts) && t.pts.length > 2 ? pointsSpec(this.ed, `terrace-pts:${this.sel}`, t, { closed: true }) : null;
  }

  /** Click tool on the outline of terrace i: `add` puts a point on the side clicked, `del` removes the point clicked. */
  startPoints(i, tool) {
    this.draw = null;
    this.terraces[i] = normalizeTerrace(this.terraces[i]);
    this.sel = i;
    this.pts = { i, tool: tool === 'del' ? 'del' : 'add' };
    this.ed.setClickTool({ key: 'terrace-pts', click: (hit) => this._ptsClick(hit), draft: (d) => this._draft(d) });
  }

  _ptsClick(hit) {
    const E = this.pts;
    const t = E && this.terraces[E.i];
    if (!t) return;
    const P = this.outline(E.i);
    const { x, z } = hit.point;
    if (E.tool === 'del') {
      const n = nearestPoint(P, x, z);
      if (n.d > 2.5 || !dropPoint(P, n.i)) return;
      t.pts.splice(n.i, 1);
    } else {
      const n = nearestSide(P, true, x, z);
      const next = n.i >= 0 && n.d <= 3 ? insertPoint(P, n.i, n.t) : null;
      if (!next) return;
      // only the new point is stored: the others keep their coordinates to the centimeter
      t.pts.splice(n.i + 1, 0, this.ed.fromPlan(t)(...next[n.i + 1]));
    }
    this.ed.commit();
  }

  toggleHidden(i) {
    this.terraces[i].hidden = !this.terraces[i].hidden;
    this.ed.commit();
  }

  remove(i) {
    this.terraces.splice(i, 1);
    this.sel = null;
    if (this.draw || this.pts) this.cancel();
    this.ed.commit();
  }

  /** Overlay: the outline being drawn (the rectangle follows the pointer), or the one whose points are edited. */
  _draft(d) {
    const D = this.draw;
    if (D) {
      const toPlan = this.ed.toPlan({ frame: D.frame });
      const P = D.pts.map(([x, z]) => toPlan(x, z));
      const old = D.i !== null && this.terraces[D.i] ? this.terraces[D.i].surface : null;
      const color = terraceLook(old).draft || '#ffe14d';
      if (D.shape === 'rect' && P.length === 1 && D.hover) {
        const r = rectFromCorners(P[0], D.hover);
        d.ribbon([...r, r[0]], color, 0.14);
      } else if (P.length) d.ribbon(D.hover ? [...P, D.hover, ...(P.length > 1 ? [P[0]] : [])] : P, color, 0.14);
      for (const [x, z] of P) d.dot(x, z, '#ffffff');
      return;
    }
    const E = this.pts;
    if (!E || !this.terraces[E.i]) return;
    const P = this.outline(E.i);
    d.ribbon([...P, P[0]], terraceLook(this.terraces[E.i].surface).draft || '#ffe14d', 0.14);
    for (const [x, z] of P) d.dot(x, z, E.tool === 'del' ? '#ff3b30' : '#ffffff');
  }
}

export class IrrigationTools {
  constructor(ed) {
    this.ed = ed;
    this.sel = null; // id of the line / circuit unfolded in the panel
    this.draw = null; // { id, pts } of the drip line being drawn
    this.mode = null; // { kind: place | aim, cid, hid }
    this.selHead = null; // id of the head unfolded in the panel, ringed in the view
    this.demo = null; // accelerated test: { ids: Set, all, t0, speed, dur } (the valves stay closed)
  }

  get irr() {
    return this.ed.edits.irrigation;
  }

  line(id) {
    return this.irr.lines.find((l) => l.id === id);
  }

  /** The points of the drip line unfolded in the panel, dragged right away in the view; null without one. */
  handles() {
    const ln = this.sel && !this.draw && !this.mode ? this.line(this.sel) : null;
    return ln && Array.isArray(ln.pts) && ln.pts.length > 1 ? freePointsSpec(this.ed, `drip-pts:${ln.id}`, ln) : null;
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
      undo: () => this.undoPoint(),
    });
  }

  /** Take back the last point of the line being drawn; false when it has none. */
  undoPoint() {
    if (!this.draw || !this.draw.pts.length) return false;
    this.draw.pts.pop();
    this.ed.drawDraft();
    this.ed.onChange(false);
    return true;
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

  /**
   * After an undo or a redo: lines, circuits and heads are known by their id, so what is unfolded stays so when it
   * is still there. A line being drawn or a head being placed that is gone leaves its tool.
   */
  restored() {
    const heads = this.irr.circuits.flatMap((c) => c.heads || []);
    const lost = (this.draw && !this.line(this.draw.id)) || (this.mode && !this.head(this.mode.cid, this.mode.hid));
    if (lost) {
      const mine = this.ed.clickTool && ['drip', 'head-place', 'head-aim'].includes(this.ed.clickTool.key);
      this.draw = null;
      this.mode = null;
      if (mine) this.ed.setClickTool(null);
    }
    if (this.sel && !this.line(this.sel) && !this.circuit(this.sel)) this.sel = null;
    if (this.selHead && !heads.some((h) => h.id === this.selHead)) this.selHead = null;
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
        this.selHead = hid;
        this._leave();
        this.ed.commit();
        this.showHeads(cid); // the ring comes back once the head is down
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
        this.showHeads(cid);
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
    if (this.selHead === hid) this.selHead = null;
    this.ed.commit();
    this.showHeads(cid);
  }

  /**
   * Move a head to another circuit, keeping everything it has been given: where it stands, which way it points,
   * its arc and its ranges. The panel follows it, so the circuit it lands in opens with the head unfolded.
   */
  moveHead(cid, hid, toCid) {
    const from = this.circuit(cid);
    const to = this.circuit(toCid);
    const h = this.head(cid, hid);
    if (!from || !to || !h || from === to) return false;
    if (this.mode && this.mode.hid === hid) this._leave();
    from.heads = from.heads.filter((o) => o.id !== hid);
    to.heads.push(h);
    this.sel = toCid;
    this.selHead = hid;
    this.ed.commit();
    this.showHeads(toCid);
    return true;
  }

  /**
   * Unfold one head of a circuit in the panel, folding the one before it: a circuit of ten heads would otherwise
   * be a wall of settings. Clicking the same head again folds it. The head unfolded is ringed in the view.
   */
  selectHead(cid, hid) {
    this.selHead = this.selHead === hid ? null : hid;
    this.showHeads(cid);
  }

  /**
   * Overlay of a circuit being set up: a red ring around the head unfolded in the panel, a pale one around the
   * others, so that the head under the settings is plain to see. It draws and nothing else — a click on the view
   * is left alone, and placing or aiming a head takes the tool over until it is done.
   */
  showHeads(cid) {
    const c = this.circuit(cid);
    if (!c) return this.ed.setClickTool(null);
    this.ed.setClickTool({
      key: `head-sel:${cid}`,
      pick: () => null, // nothing to pick: the tool only draws
      click: () => {},
      draft: (d) => {
        for (const h of c.heads) {
          if (!h.at) continue;
          const [x, z] = this.ed.toPlan(h)(h.at[0], h.at[1]);
          const on = h.id === this.selHead;
          d.ribbon(ringPts(x, z, on ? 0.55 : 0.35), on ? SEL_COLOR : '#8aa0b0', on ? 0.09 : 0.04);
          if (on) d.dot(x, z, SEL_COLOR);
        }
      },
    });
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
