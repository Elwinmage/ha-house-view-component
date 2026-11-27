// Interactive editors of the card (admin only): detached outdoor objects, trees, ground corrections (walls, terraces,
// brushes, cross-section). They work on `engine.edits` (mutated in place) and call `engine.commit()` to rebuild the world;
// `onChange` lets the card persist the edits file and refresh its panel. No HA / DOM knowledge except the pointer events.
import * as THREE from 'three';
import { SPECIES } from './engine/catalog.js';
import { gridToPlan, planToGrid, houseParcel } from './engine/terrain.js';
import { compileOps, nearestOnLine, opAt, opCenter, opOutline, runsOf, wallEnds } from './engine/terrain-edit.js';
import { brushPreview, fillMesh, labelSprite, segment } from './engine/terrain-overlay.js';
import { unionOutline, inPoly } from './parcels.js';
import { nearestPoint, nearestSide } from './fences.js';
import { normalizeScene } from './engine/scene-model.js';
import { emptyEdits } from './engine/edits.js';
import { GRAB_PX, WHOLE, handlesOf, movedPts, nearestHandle } from './move.js';

const round = (v, n) => Math.round(v * n) / n;
const ringArea = (r) => r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
const TOGGLE_DOMAINS = ['light', 'switch', 'input_boolean', 'fan', 'cover', 'lock', 'siren', 'humidifier'];

/** Kind of ground correction a ground tool draws ('wall', 'terrace', 'brush'), 'all' for the tools that draw none. */
export const opKindOf = (mode) => (mode === 'wall' || mode === 'terrace' ? mode : String(mode).startsWith('brush') ? 'brush' : 'all');

export class WorldEditors {
  /**
   * @param {import('./engine.js').HouseEngine} engine
   * @param {{onChange?: () => void, opName?: (op: object, i: number, ops: object[]) => string}} [opts]
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.onChange = opts.onChange || (() => {});
    this.opName = opts.opName || (() => '');
    this.treeMode = 'off'; // 'off' | 'delete' | 'add'
    this.treeAdd = { species: 'oak', h: SPECIES.oak ? SPECIES.oak.height : 8 };
    this.tool = { mode: 'off', pts: [], r: 3, v: 0.5 }; // pts: grid-frame points of the shape being drawn (plan points for 'section')
    this.selOp = -1;
    this.showOps = 'all'; // kind of ground correction the overlay shows: 'all' | 'wall' | 'terrace' | 'brush'
    // generic one-at-a-time click tool of a feature editor: { key, click(hit, ev), draft?(d), undo?(), wall?, furniture? }
    this.clickTool = null;
    this.move = null; // move tool in use: { spec, grab (the handle taken, null), from ([x, z] where it was taken) }
    this.handles = null; // points dragged right away beside the tools (setHandles): the same shape, with `shown`
    this.ptsTool = null; // points being added or removed (setPointsTool): { mode: 'add' | 'del', spec (null: the handles) }
    this.placing = null; // entity id waiting for its position (next click)
    this.parcelSel = null; // Set of parcel indexes while choosing the parcels of the property
    this.section = null; // { d, ground0, ground, surf, wall } of the last cross-section
    this.sectionLine = null;
    this.hoverPt = null; // plan point under the pointer while a ground tool is in use
    this.hoverY = 0; // scene y of that point (height of the ground there)
    this.hoverOp = -1; // ground correction under the pointer (-1 none)
    this.draft = new THREE.Group();
    this.draft.name = 'terrain-draft';
    engine.scene.add(this.draft);
    // what the next click would do: rebuilt at every pointer move, so it is kept out of the draft group
    this.hover = new THREE.Group();
    this.hover.name = 'terrain-hover';
    engine.scene.add(this.hover);
    engine.onLoaded = () => this.drawDraft();
  }

  get edits() {
    return this.engine.edits;
  }

  get active() {
    return this.treeMode !== 'off' || this.tool.mode !== 'off' || !!this.clickTool || !!this.placing || !!this.parcelSel;
  }

  /** Leave the click modes except `keep` ('tree' | 'tool' | 'fence' | 'sensor'). */
  _exclusive(keep) {
    if (keep !== 'tree') {
      this.treeMode = 'off';
      this.engine.treeMode = 'off';
      this._treeMove = null;
    }
    if (keep !== 'tool') {
      this.tool.mode = 'off';
      this.tool.pts = [];
      this.sectionLine = null;
      this._setHover(null);
    }
    if (keep !== 'click' && this.clickTool) {
      if (this.clickTool.leave) this.clickTool.leave();
      this.clickTool = null;
    }
    if (keep !== 'sensor') this.placing = null;
    if (keep !== 'parcels') this.parcelSel = null;
  }

  dispose() {
    this.engine.setPicker(null);
    this.engine.pickerWheel = null;
    this.engine.pickerMove = null;
    this.engine.onLoaded = null;
    clearTimeout(this._hoverTimer);
    this._clearDraft();
    this._clearHover();
    this.engine.scene.remove(this.draft);
    this.engine.scene.remove(this.hover);
  }

  _commit() {
    this.engine.commit(); // -> onLoaded -> drawDraft
    this.onChange();
  }

  _syncPicker() {
    this.engine.setPicker(this.active ? (ev) => this._click(ev) : null);
    this.engine.pickerMove = this.active ? (ev) => this._move(ev) : null;
    this.engine.pickerWheel = this.active ? (ev) => this._wheel(ev) : null;
  }

  /** Shift + wheel over the view sizes the brush of the ground editor; true when the wheel was used for that. */
  _wheel(ev) {
    if (!ev.shiftKey || !this.tool.mode.startsWith('brush')) return false;
    const r = Math.min(20, Math.max(0.5, round((this.tool.r || 3) + (ev.deltaY < 0 ? 0.5 : -0.5), 2)));
    if (r !== this.tool.r) {
      this.tool.r = r;
      this.drawHover();
      this.onChange(false); // the radius field of the panel follows
    }
    return true;
  }

  /**
   * Pointer moving with a click tool (the tool shows what a click would use: tool.hover(hit), null off target), or
   * with a ground tool (the brush radius and the relief it would leave are drawn under the pointer).
   */
  _move(ev) {
    const t = this.clickTool;
    if (t) {
      if (!t.hover) return;
      return t.hover(ev ? this._pickFor(t, ev) : null);
    }
    if (this.tool.mode !== 'off') this._toolHover(ev);
  }

  /** What a click tool works on: its own picking (`pick(ev)`), a piece of furniture, or a point of a floor or wall. */
  _pickFor(t, ev) {
    if (t.pick) return t.pick(ev);
    return t.furniture ? this.engine.pickFurnitureAt(ev) : this.engine.pickPoint(ev, !!t.wall);
  }

  /**
   * Install the click tool of a feature editor (fences, irrigation, vacuum...), or null to leave it. Only one click
   * mode is active at a time. tool.click(hit, ev) gets the picked point; tool.draft(d) draws its overlay; a tool
   * that draws a shape point by point takes its last point back with tool.undo() (true when it had one).
   */
  setClickTool(tool) {
    if (this.clickTool && this.clickTool !== tool && this.clickTool.leave) this.clickTool.leave();
    this._exclusive('click');
    this.clickTool = tool;
    this._syncPicker();
    this.drawDraft();
    this.onChange(false);
  }

  // ------------------------------------------------------------ moving points and whole objects

  /**
   * Move tool of a feature editor: the points of the object become handles that are dragged in the view (the orbit
   * controls are held back during the drag), with one more handle in the middle that moves the object as a whole.
   * A press that does not move takes the handle instead, and the next click drops it: touch screens, and a point
   * put exactly where another click tool would put it.
   *
   * spec = {
   *   key,                     // name of the tool, to leave it or tell it from another one
   *   points(),                // the handles, in plan coordinates: [[x, z], ...]
   *   move(h, x, z, from),     // the handle `h` ({ i, x, z }, i = WHOLE for the object) moved to a plan point;
   *                            // `from` is where it was taken, for an object moved as a whole
   *   commit(),                // rebuild the world and save: called when the handle is dropped
   *   whole,                   // false: no handle for the object as a whole (one point, or points of their own)
   *   closed,                  // the outline drawn between the points is a loop
   *   draft(d, grab),          // optional: draw the overlay in place of the outline and its handles
   *   pickAt(h),               // optional: height a handle is seen at, when it is not on the ground
   *   leave(),                 // optional: called when the tool is left, to put back what it changed
   * }
   */
  setMoveTool(spec) {
    if (!spec) return this.setClickTool(null);
    // installed first: leaving the tool that was in use clears `move` and `moveGrab`, which are set right after
    this.setClickTool({
      key: `move:${spec.key}`,
      // the handles are taken by the drag; a click on the view drops the one that was tapped
      pick: (ev) => this.engine.pickPoint(ev),
      click: (hit) => {
        if (!this.move || !this.move.grab || !hit) return;
        this._moveTo(this.move.grab, hit.point.x, hit.point.z);
        this._drop();
      },
      draft: (d) => this._moveDraft(d),
      leave: () => {
        this.move = null;
        this._syncGrab(); // back to the handles kept beside the tools, when there are some
        if (spec.leave) spec.leave();
      },
    });
    this.move = { spec, grab: null, from: null };
    this._syncGrab();
    this.drawDraft();
  }

  /**
   * Handles kept in the view beside the tool in use, or without any: the points of the object being edited in a
   * panel are dragged right away, without asking for the move tool first. A press that does not move is left to
   * the tool in use, as a click on that spot. `spec` as for setMoveTool ({ key, points, move, commit, closed,
   * pickAt }), without a handle for the object as a whole (that one is the move tool's); null removes them.
   */
  setHandles(spec) {
    const cur = this.handles;
    if (!spec && !cur) return;
    if (spec && cur && cur.spec.key === spec.key) {
      // the same object, rendered again: a drag in progress goes on, the dots follow what was changed elsewhere
      cur.spec = { ...spec, whole: false };
      if (!cur.grab && this._handlesKey(cur) !== cur.shown) this.drawDraft();
      return;
    }
    this.handles = spec ? { spec: { ...spec, whole: false }, grab: null, from: null, shown: '' } : null;
    this._syncGrab();
    this.drawDraft();
  }

  /**
   * Click tool on the points of the object being edited: 'add' puts a point on the side clicked, 'del' removes the
   * point clicked (a line keeps two of them, an outline three). It works on the handles kept in the view
   * (setHandles), or on `spec` when one is given (an object that has none: the island of a pond). The spec says how
   * to `insert(i, x, z)` a plan point after its point `i` and how to `remove(i)` one. Null, or the mode already in
   * use, leaves the tool.
   */
  setPointsTool(mode, spec = null) {
    if (!mode || this.pointsMode(spec ? spec.key : null) === mode) {
      if (this.clickTool && this.clickTool.key === 'pts') this.setClickTool(null);
      return;
    }
    this.setClickTool({
      key: 'pts',
      click: (hit) => this._ptsClick(hit),
      draft: (d) => this._ptsDraft(d),
      leave: () => {
        this.ptsTool = null;
      },
    });
    this.ptsTool = { mode: mode === 'del' ? 'del' : 'add', spec };
    this.drawDraft();
    this.onChange(false);
  }

  /**
   * Mode of the points tool in use ('add' | 'del'), null without it: on the handles kept in the view, or on the
   * object of key `key` when it was started on one.
   */
  pointsMode(key = null) {
    const T = this.clickTool && this.clickTool.key === 'pts' ? this.ptsTool : null;
    return T && (T.spec ? T.spec.key : null) === key ? T.mode : null;
  }

  /** What the points tool works on: the object it was started on, else the handles kept in the view. */
  _ptsSpec() {
    const T = this.ptsTool;
    const spec = T && (T.spec || (this.handles && this.handles.spec));
    return spec && spec.insert && spec.remove ? spec : null;
  }

  _ptsClick(hit) {
    const sp = this._ptsSpec();
    if (!sp) return;
    const P = sp.points();
    const { x, z } = hit.point;
    if (this.ptsTool.mode === 'del') {
      const n = nearestPoint(P, x, z);
      if (n.i < 0 || n.d > 2.5 || P.length <= (sp.closed ? 3 : 2)) return;
      sp.remove(n.i);
    } else {
      const n = nearestSide(P, !!sp.closed, x, z);
      if (n.i < 0 || n.d > 3) return;
      const a = P[n.i];
      const b = P[(n.i + 1) % P.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (n.t * L < 0.1 || (1 - n.t) * L < 0.1) return; // on one of the ends of the side: there is a point already
      sp.insert(n.i, a[0] + (b[0] - a[0]) * n.t, a[1] + (b[1] - a[1]) * n.t);
    }
    sp.commit();
  }

  /** Overlay of the points tool: the sides to click between the points, and the points of an object without handles. */
  _ptsDraft({ dot, ribbon }) {
    const sp = this._ptsSpec();
    if (!sp) return;
    const pts = sp.points();
    if (pts.length > 1) ribbon(sp.closed ? [...pts, pts[0]] : pts, '#7b8a95', 0.12);
    if (this.ptsTool.spec) for (const [x, z] of pts) dot(x, z, '#ffffff');
  }

  /** Where the handles kept in the view are: the overlay is drawn again when it changes. */
  _handlesKey(S) {
    return this.engine.world ? JSON.stringify(S.spec.points()) : '';
  }

  /** What the pointer takes hold of in the view: the handles of the move tool in use, else the ones kept beside the tools. */
  _syncGrab() {
    const S = this.move || this.handles;
    if (!S) {
      this.engine.moveGrab = null;
      return;
    }
    const beside = S !== this.move;
    this.engine.moveGrab = {
      pick: (ev) => (!S.grab ? this._handleAt(ev, S) : null),
      y: (h) => this._handleY(h),
      start: (h) => this._grab(h, S),
      move: (h, x, z) => this._moveTo(h, x, z, S),
      tap: beside
        ? (h, ev) => {
            // not a drag: the handle is let go, and the tool in use gets the click it would have had
            S.grab = null;
            S.from = null;
            this.drawDraft();
            this.onChange(false);
            if (this.engine.picker) this.engine.picker(ev, this.engine);
          }
        : () => this.onChange(false), // the handle stays taken: the next click drops it
      end: () => this._drop(S),
    };
  }

  /** The move tool `key` is the one in use. */
  moving(key) {
    return !!this.move && this.move.spec.key === key && !!this.clickTool && this.clickTool.key === `move:${key}`;
  }

  _handles(S = this.move) {
    const sp = S.spec;
    return handlesOf(sp.points(), sp.whole !== false);
  }

  /** Height of a handle: the ground under it, where the drag plane sits. */
  _handleY(h) {
    const w = this.engine.world;
    return w ? w.groundAt(h.x, h.z) : 0;
  }

  _handleAt(ev, S = this.move) {
    const [sx, sy] = this.engine.pointerAt(ev);
    const sp = S.spec;
    const at = (h) => this.engine.project(h.x, sp.pickAt ? sp.pickAt(h) : this._handleY(h), h.z);
    return nearestHandle(this._handles(S), at, sx, sy, GRAB_PX);
  }

  _grab(h, S = this.move) {
    S.grab = h;
    S.from = [h.x, h.z];
    this.drawDraft();
    this.onChange(false);
  }

  /** The handle taken follows the pointer: only the overlay is redrawn, the world waits for the drop. */
  _moveTo(h, x, z, S = this.move) {
    const M = S;
    if (!M) return;
    M.spec.move(h, x, z, M.from);
    M.from = [x, z];
    M.grab = { ...h, x, z };
    this.drawDraft();
  }

  _drop(S = this.move) {
    const M = S;
    if (!M) return;
    M.grab = null;
    M.from = null;
    M.spec.commit();
  }

  /** Overlay of the move tool: the outline, a dot per handle, the one taken lit up and bigger. */
  _moveDraft(d) {
    const M = this.move;
    if (!M) return;
    const grab = M.grab;
    if (M.spec.draft) return M.spec.draft(d, grab);
    const pts = M.spec.points();
    if (pts.length > 1) d.ribbon(M.spec.closed ? [...pts, pts[0]] : pts, '#7b8a95', 0.12);
    for (const h of this._handles()) {
      const on = grab && grab.i === h.i;
      d.dot(h.x, h.z, on ? '#ffe14d' : h.i === WHOLE ? '#4cd964' : '#ffffff');
    }
  }

  get frame() {
    return this.cfg ? 'grid' : 'plan';
  }

  /** Plan point -> frame of new garden objects (terrain grid when there is a terrain, so they follow a new registration). */
  toStore(x, z) {
    const p = this.cfg ? planToGrid(this.cfg.data, this.cfg)(x, z) : [x, z];
    return [round(p[0], 100), round(p[1], 100)];
  }

  /** Converter of the stored points of garden object `o` to plan coordinates. */
  toPlan(o) {
    return this.engine.world.anchor(o);
  }

  /** The other way round: plan coordinates to the frame `o` is stored in (its own, which may not be the current one). */
  fromPlan(o) {
    const grid = o && o.frame !== 'plan' && this.cfg ? planToGrid(this.cfg.data, this.cfg) : null;
    return (x, z) => {
      const q = grid ? grid(x, z) : [x, z];
      return [round(q[0], 100), round(q[1], 100)];
    };
  }

  /** Rebuild the world and save (for feature editors). */
  commit() {
    this._commit();
  }

  /** Leave every editing mode (e.g. when the panel closes). */
  stop() {
    this._exclusive(null);
    this._syncPicker();
    if (this.engine.world) this.engine.commit();
  }

  // ------------------------------------------------------------ outdoor objects / pool

  outdoorEdit(id, patch) {
    this.edits.outdoor[id] = { ...(this.edits.outdoor[id] || {}), ...patch };
    this._commit();
  }

  poolDy(v) {
    this.edits.pool.dy = v;
    this._commit();
  }

  // ------------------------------------------------------------ trees

  treeInfo() {
    const w = this.engine.world;
    const r = this.edits.trees.removed.dsm.length + this.edits.trees.removed.sd.length;
    return { count: w ? w.trees.length : 0, removed: r, added: this.edits.trees.added.length };
  }

  setTreeMode(m) {
    if (m === 'move') return this.startTreeMove();
    this._exclusive('tree');
    this.treeMode = m;
    this.engine.treeMode = m;
    this._syncPicker();
    this.engine.commit(); // the markers are part of the world
    this.onChange(false);
  }

  setTreeParams(p) {
    Object.assign(this.treeAdd, p);
  }

  treeReset() {
    this.edits.trees = emptyEdits().trees;
    this._commit();
  }

  /**
   * Move the trees in the view: every tree is taken by its crown. One added by hand simply moves; one that comes
   * from the height model or from the plan is taken off and an equal one put at the new place — those trees are
   * not stored in the edits, so that is the only way to move them (and `treeUndo` puts it all back).
   */
  startTreeMove() {
    this._treeMove = null;
    const trees = () => (this.engine.world ? this.engine.world.trees : []);
    const crown = (t) => SPECIES[t.species].height * 0.8 * (t.scale || 1);
    this.setMoveTool({
      key: 'trees',
      whole: false,
      points: () => trees().map((t) => [t.at[0], t.at[1]]),
      pickAt: (h) => {
        const t = trees()[h.i];
        return this._handleY(h) + (t ? crown(t) : 0);
      },
      move: (h, x, z) => {
        const t = trees()[h.i];
        if (!t) return;
        t.at = [round(x, 10), round(z, 10)]; // the copy of the world, so the handle follows the pointer
        this._treeMove = { src: t._src, species: t.species, scale: t.scale, at: t.at };
      },
      draft: (d, grab) => {
        const t = grab ? trees()[grab.i] : null;
        if (t) d.dot(t.at[0], t.at[1], '#ffe14d');
      },
      commit: () => this._dropTree(),
      leave: () => {
        this.treeMode = 'off';
        this.engine.treeMode = 'off';
        this._treeMove = null;
        this.engine.commit();
      },
    });
    // after the click tool is installed, which leaves every tree mode: the markers are part of the world
    this.treeMode = 'move';
    this.engine.treeMode = 'move';
    this.engine.commit();
    this._syncPicker();
  }

  _dropTree() {
    const M = this._treeMove;
    this._treeMove = null;
    if (!M) return;
    const added = this.edits.trees.added;
    const rem = this.edits.trees.removed;
    const at = [round(M.at[0], 10), round(M.at[1], 10)];
    if (M.src.kind === 'added') {
      const a = added[M.src.idx];
      if (!a) return;
      a.at = at;
    } else {
      // a tree of the height model or of the plan: taken off there, put back here as a tree of its own
      if (M.src.kind === 'dsm') rem.dsm.push([M.src.gx, M.src.gz]);
      else rem.sd.push(M.src.idx);
      added.push({ species: M.species, at, h: round((M.scale || 1) * SPECIES[M.species].height, 10) });
    }
    this._commit();
  }

  _editTreeAt(ev) {
    const eng = this.engine;
    const w = eng.world;
    const rect = eng.renderer.domElement.getBoundingClientRect();
    if (this.treeMode === 'delete') {
      // nearest crown marker on screen (orthographic view: depth does not help, screen distance does)
      let best = -1;
      let bestD = 30;
      const v = new THREE.Vector3();
      w.veg.group.children.forEach((g, i) => {
        v.set(g.position.x, g.position.y + SPECIES[w.trees[i].species].height * 0.8 * g.scale.y, g.position.z).project(eng.camera);
        const d = Math.hypot(((v.x + 1) / 2) * rect.width + rect.left - ev.clientX, ((1 - v.y) / 2) * rect.height + rect.top - ev.clientY);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return;
      const src = w.trees[best]._src;
      const rem = this.edits.trees.removed;
      if (src.kind === 'dsm') rem.dsm.push([src.gx, src.gz]);
      else if (src.kind === 'sd') rem.sd.push(src.idx);
      else this.edits.trees.added.splice(src.idx, 1);
    } else {
      const ray = eng.rayAt(ev);
      let p = null;
      if (w.terrain) {
        const hit = ray.intersectObject(w.terrain.group, true)[0];
        if (hit) p = hit.point;
      }
      if (!p) {
        p = new THREE.Vector3();
        if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
      }
      this.edits.trees.added.push({ species: this.treeAdd.species, at: [round(p.x, 10), round(p.z, 10)], h: this.treeAdd.h });
    }
    this._commit();
  }

  // ------------------------------------------------------------ ground

  get cfg() {
    return this.engine.terrainCfg;
  }

  /** `rebuild` false when the world is known to be up to date (the caller just left another mode): only redraw. */
  setTool(mode, rebuild = true) {
    if (mode !== 'off' && !this.cfg) return false; // needs a terrain
    this._exclusive('tool');
    if (mode !== this.tool.mode) {
      this.tool.pts = []; // points of a shape left unfinished: they are not for the tool being taken
      this.sectionLine = null;
      // a tool that draws one kind of correction shows that kind only: the others are in the way
      this._showOps(opKindOf(mode));
    }
    this.tool.mode = mode;
    this._setHover(null);
    this._syncPicker();
    if (rebuild) this.engine.commit();
    else this.drawDraft();
    this.onChange(false);
    return true;
  }

  /** The correction `op`, of rank `i`, is drawn on the view: its kind is the one shown, or it is the selected one. */
  opShown(op, i) {
    return this.showOps === 'all' || op.type === this.showOps || i === this.selOp;
  }

  _showOps(kind) {
    this.showOps = kind;
    // the selection follows: a correction of another kind would be the only one left on the view
    const ops = this.edits.terrain;
    if (kind === 'all' || (ops[this.selOp] && ops[this.selOp].type === kind)) return;
    for (let i = ops.length - 1; i >= 0; i--)
      if (ops[i].type === kind) {
        this.selOp = i;
        return;
      }
  }

  /** Show one kind of ground correction on the view ('wall', 'terrace', 'brush'), or all of them ('all'). */
  setShowOps(kind) {
    this._showOps(['wall', 'terrace', 'brush'].includes(kind) ? kind : 'all');
    this._setHover(null);
    this.drawDraft();
    this.onChange(false);
  }

  setToolParams(p) {
    Object.assign(this.tool, p);
    this.drawHover(); // the radius and the preview follow the fields right away, without moving the pointer
  }

  cancelDraft() {
    this.tool.pts = [];
    this.sectionLine = null;
    this.drawDraft();
    this.onChange(false);
  }

  /**
   * Take back the last point of the shape being drawn: a ground correction, or what the click tool in use draws
   * (its `undo`). False when nothing is being drawn, or nothing that has a point yet: there is nothing to take back
   * before the last change of the corrections themselves.
   */
  undoPoint() {
    if (this.tool.mode !== 'off' && this.tool.pts.length) {
      this.tool.pts.pop();
      this.sectionLine = null;
      this.drawDraft();
      this.onChange(false);
      return true;
    }
    return !!(this.clickTool && this.clickTool.undo && this.clickTool.undo());
  }

  /**
   * The corrections were put back as they were before or after a change (undo, redo): `lists` names the lists
   * where an entry came or went (history.js, resizedLists). What is being moved or picked, and the correction
   * selected by its rank, may be another entry now: they are left. The trees are told apart by where they stand:
   * their tools go on.
   */
  restored(lists) {
    const others = lists.filter((key) => !key.startsWith('trees'));
    if (others.includes('terrain')) this.selOp = -1;
    if (others.length && this.clickTool) this.setClickTool(null);
    this._treeMove = null;
    this._setHover(null);
  }

  // ------------------------------------------------------------ ground: what the next click would do

  /** Pointer over the view with a ground tool: the preview is rebuilt at most every 40 ms (it samples the ground). */
  _toolHover(ev) {
    const w = this.engine.world;
    this._hoverWant = ev && !ev.buttons && w && w.terrain ? this._groundPoint(ev) : null;
    const wait = 40 - (performance.now() - (this._hoverT || 0));
    if (wait > 0) {
      if (!this._hoverTimer)
        this._hoverTimer = setTimeout(() => {
          this._hoverTimer = null;
          this._applyHover();
        }, wait);
      return;
    }
    this._applyHover();
  }

  _applyHover() {
    this._hoverT = performance.now();
    const p = this._hoverWant;
    this._setHover(p ? [p.x, p.z] : null, p ? p.y : 0);
  }

  /** Point under the pointer (plan frame) and correction found there; redraws only when one of them changes. */
  _setHover(pt, y = 0) {
    clearTimeout(this._hoverTimer);
    this._hoverTimer = null;
    const g = pt && this.cfg ? planToGrid(this.cfg.data, this.cfg)(pt[0], pt[1]) : null;
    const op = g ? opAt(this.edits.terrain, g[0], g[1], (o, i) => this.opShown(o, i)) : -1;
    const still = !pt === !this.hoverPt && (!pt || Math.hypot(pt[0] - this.hoverPt[0], pt[1] - this.hoverPt[1]) < 0.03);
    this.hoverPt = pt;
    this.hoverY = y;
    const sameOp = op === this.hoverOp;
    this.hoverOp = op;
    if (still && sameOp) return;
    this.drawHover();
  }

  /** Brush a click at `pt` (plan frame) would add, in the grid frame: same values as _terrainToolClick. */
  _brushAt(pt, y) {
    const m = this.tool.mode;
    if (!m.startsWith('brush') || !pt || !this.cfg) return null;
    const mode = m.slice(6);
    const v = this.tool.v;
    const value =
      mode === 'set' ? (Number.isFinite(v) ? v : round(this._altOf(y), 100)) : mode === 'add' ? v || 0 : Math.min(Math.max(v || 1, 0.1), 1);
    const g = planToGrid(this.cfg.data, this.cfg)(pt[0], pt[1]);
    return { type: 'brush', pt: g, r: Math.max(0.5, this.tool.r || 3), mode, value };
  }

  _altOf(y) {
    return y + this.engine.world.terrain.zRef - this.cfg.base; // scene y -> absolute altitude
  }

  _groundPoint(ev) {
    const hit = this.engine.rayAt(ev).intersectObject(this.engine.world.terrain.ground, false)[0];
    return hit ? hit.point : null;
  }

  _terrainToolClick(ev) {
    const w = this.engine.world;
    if (!w.terrain) return;
    const p = this._groundPoint(ev);
    if (!p) return;
    const g = planToGrid(this.cfg.data, this.cfg)(p.x, p.z);
    const tool = this.tool;
    const m = tool.mode;
    if (m === 'select') {
      // clicking a correction in the view selects it in the panel (-1 outside any of them: nothing selected)
      this.selOp = opAt(this.edits.terrain, g[0], g[1], (o, i) => this.opShown(o, i));
      this.drawDraft();
      this.onChange(false);
    } else if (m === 'wall' || m === 'terrace') {
      tool.pts.push(g);
      this.drawDraft();
      this.onChange(false);
    } else if (m === 'section') {
      tool.pts.push([p.x, p.z]);
      if (tool.pts.length === 2) {
        this.showSection(tool.pts[0], tool.pts[1]);
        tool.pts = [];
      } else {
        this.sectionLine = null;
        this.drawDraft();
      }
      this.onChange(false);
    } else {
      const mode = m.slice(6); // brush-set / brush-add / brush-smooth
      const value =
        mode === 'set'
          ? Number.isFinite(tool.v)
            ? tool.v
            : round(this._altOf(p.y), 100)
          : mode === 'add'
            ? tool.v || 0
            : Math.min(Math.max(tool.v || 1, 0.1), 1);
      this.edits.terrain.push({ type: 'brush', pt: g.map((v) => round(v, 100)), r: tool.r, mode, value });
      this.selOp = this.edits.terrain.length - 1;
      this._commit();
    }
  }

  finishDraft() {
    const T = this.engine.world.terrain;
    const tool = this.tool;
    if (!T || !this.cfg) return;
    const from = gridToPlan(this.cfg.data, this.cfg);
    const toAlt = (y) => round(this._altOf(y), 20);
    const grid = (pts) => pts.map((q) => q.map((v) => round(v, 100)));
    if (tool.mode === 'wall' && tool.pts.length >= 2) {
      const P = tool.pts.map(([x, z]) => from(x, z));
      let left = 0;
      let right = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i];
        const [bx, bz] = P[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = -(bz - az) / L;
        const nz = (bx - ax) / L;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        left += T.heightAt(mx + nx * 1.5, mz + nz * 1.5);
        right += T.heightAt(mx - nx * 1.5, mz - nz * 1.5);
      }
      left /= P.length - 1;
      right /= P.length - 1;
      let hi = toAlt(Math.max(left, right));
      const lo = toAlt(Math.min(left, right));
      if (hi - lo < 0.3) hi = lo + 1; // measured relief is flat: start from a 1 m wall, to be adjusted
      this.edits.terrain.push({ type: 'wall', pts: grid(tool.pts), hi, lo, side: left >= right ? 1 : -1, flat: 1.5, feather: 2 });
    } else if (tool.mode === 'terrace' && tool.pts.length >= 3) {
      const P = tool.pts.map(([x, z]) => from(x, z));
      const cx = P.reduce((a, q) => a + q[0], 0) / P.length;
      const cz = P.reduce((a, q) => a + q[1], 0) / P.length;
      this.edits.terrain.push({ type: 'terrace', poly: grid(tool.pts), alt: toAlt(T.heightAt(cx, cz)), feather: 1 });
    } else return;
    this.selOp = this.edits.terrain.length - 1;
    tool.pts = [];
    this._commit();
  }

  selectOp(i) {
    this.selOp = i;
    this.drawDraft();
  }

  /** The points of ground correction `i` as handles (a brush is a single point); null when it has none to show. */
  _opSpec(i) {
    const op = this.edits.terrain[i];
    if (!op || !this.cfg) return null;
    const key = op.type === 'wall' ? 'pts' : op.type === 'terrace' ? 'poly' : null;
    if (!key && !op.pt) return null;
    const pts = () => {
      const g2p = gridToPlan(this.cfg.data, this.cfg);
      return key ? op[key].map(([x, z]) => g2p(x, z)) : [g2p(op.pt[0], op.pt[1])];
    };
    return {
      key: `op:${i}`,
      closed: op.type === 'terrace',
      whole: !!key,
      points: pts,
      move: (h, x, z, from) => {
        const p2g = planToGrid(this.cfg.data, this.cfg);
        const next = movedPts(pts(), h, x, z, from).map(([a, b]) => p2g(a, b).map((v) => round(v, 100)));
        if (key) op[key] = next;
        else op.pt = next[0];
      },
      // a wall and a platform take a point more, or one less (setPointsTool); a brush has only its centre
      ...(key
        ? {
            insert: (k, x, z) =>
              op[key].splice(
                k + 1,
                0,
                planToGrid(this.cfg.data, this.cfg)(x, z).map((v) => round(v, 100)),
              ),
            remove: (k) => op[key].splice(k, 1),
          }
        : {}),
      commit: () => this._commit(),
    };
  }

  /** Move the points of ground correction `i` in the view, or the whole correction. */
  startOpMove(i) {
    const spec = this._opSpec(i);
    if (!spec) return;
    this.selOp = i;
    this.setMoveTool(spec);
  }

  /**
   * The points of the correction selected in the panel, dragged right away: while corrections are being picked in
   * the view or no ground tool is in use (a brush or a wall being drawn keeps the clicks to itself).
   */
  opHandles() {
    const busy = this.clickTool && this.clickTool.key !== 'pts'; // (the tool that adds and removes points works on them)
    if (this.selOp < 0 || busy || !['off', 'select'].includes(this.tool.mode)) return null;
    return this._opSpec(this.selOp);
  }

  editOp(i, patch) {
    Object.assign(this.edits.terrain[i], patch);
    this._commit();
  }

  deleteOp(i) {
    this.edits.terrain.splice(i, 1);
    this.selOp = Math.min(this.selOp, this.edits.terrain.length - 1);
    this._commit();
  }

  flipOp(i) {
    const op = this.edits.terrain[i];
    if (op && op.type === 'wall') {
      op.side = -op.side;
      this._commit();
    }
  }

  /** Cross-section through the middle of the longest segment of a wall, 7 m on each side. */
  sectionOfOp(i) {
    const op = this.edits.terrain[i];
    if (!op || op.type !== 'wall' || !this.cfg) return;
    const from = gridToPlan(this.cfg.data, this.cfg);
    const P = op.pts.map(([x, z]) => from(x, z));
    let best = 0;
    let bl = -1;
    for (let k = 0; k < P.length - 1; k++) {
      const l = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
      if (l > bl) {
        bl = l;
        best = k;
      }
    }
    const [ax, az] = P[best];
    const [bx, bz] = P[best + 1];
    const nx = -(bz - az) / bl;
    const nz = (bx - ax) / bl;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    // top and foot of the wall where it is cut: they may differ from one end of the wall to the other
    const runs = runsOf(P);
    const k = (runs[best] + bl / 2) / (runs[runs.length - 1] || 1);
    const e = wallEnds(op);
    this.showSection([mx - nx * 7, mz - nz * 7], [mx + nx * 7, mz + nz * 7], {
      hi: e.hi + (e.hi2 - e.hi) * k,
      lo: e.lo + (e.lo2 - e.lo) * k,
    });
    this.onChange(false);
  }

  showSection(a, b, wall) {
    const T = this.engine.world.terrain;
    this.sectionLine = [a, b];
    const pr = T.profile(a[0], a[1], b[0], b[1]);
    const k = T.zRef - this.cfg.base;
    const alt = (arr) => arr && arr.map((v) => v + k);
    this.section = { d: pr.d, ground0: alt(pr.ground0), ground: alt(pr.ground), surf: alt(pr.surf), wall: wall || null };
    this.drawDraft();
  }

  // ------------------------------------------------------------ fences

  get parcels() {
    const cfg = this.cfg;
    return (cfg && cfg.data.parcels) || [];
  }

  /** Parcels holding a part of the house (a room corner or center inside): preselected for the fence. */
  houseParcels() {
    const cfg = this.cfg;
    const toGrid = planToGrid(cfg.data, cfg);
    const sd = normalizeScene(structuredClone(this.engine.sceneData));
    const pts = [];
    for (const r of sd.levels[0].rooms) {
      for (const p of r.poly) pts.push(toGrid(p[0], p[1]));
      const cx = r.poly.reduce((a, q) => a + q[0], 0) / r.poly.length;
      const cz = r.poly.reduce((a, q) => a + q[1], 0) / r.poly.length;
      pts.push(toGrid(cx, cz));
    }
    const idx = this.parcels.map((p, k) => (pts.some(([x, z]) => inPoly(x, z, p.poly)) ? k : -1)).filter((k) => k >= 0);
    if (idx.length) return idx;
    const one = houseParcel(cfg.data, cfg, sd);
    return one ? [this.parcels.indexOf(one)] : [];
  }

  /** Click mode: choose the parcels of the property (several parcels can make one plot). */
  startParcelPick() {
    this._exclusive('parcels');
    this.parcelSel = new Set(this.houseParcels());
    this._syncPicker();
    this.drawDraft();
    this.onChange(false);
  }

  cancelParcelPick() {
    this.parcelSel = null;
    this._syncPicker();
    this.drawDraft();
    this.onChange(false);
  }

  _parcelClick(ev) {
    const hit = this.engine.pickPoint(ev);
    if (!hit) return;
    const [gx, gz] = planToGrid(this.cfg.data, this.cfg)(hit.point.x, hit.point.z);
    // smallest parcel under the click (a big enclosing polygon must not win over the parcel inside it)
    let k = -1;
    let best = Infinity;
    this.parcels.forEach((p, i) => {
      if (!inPoly(gx, gz, p.poly)) return;
      const a = Math.abs(ringArea(p.poly));
      if (a < best) {
        best = a;
        k = i;
      }
    });
    if (k < 0) return;
    if (this.parcelSel.has(k)) this.parcelSel.delete(k);
    else this.parcelSel.add(k);
    this.drawDraft();
    this.onChange(false);
  }

  /**
   * Fence the outline of the selected parcels (shared borders removed); one fence per separate block.
   * Returns the number of fences created (0 = no usable outline).
   */
  fenceSelected() {
    const sel = [...(this.parcelSel || [])].map((k) => this.parcels[k]);
    // cadastral borders do not always match to the centimeter: widen the tolerance until the parcels merge
    let loops = [];
    for (const tol of [0.05, 0.3, 0.8]) {
      const l = unionOutline(
        sel.map((p) => p.poly),
        tol,
      );
      if (!loops.length || (l.length && l.length < loops.length)) loops = l;
      if (loops.length === 1) break;
    }
    const ids = [...new Set(sel.map((p) => p.id || '').filter(Boolean))];
    for (const loop of loops) {
      this.edits.fences.push({
        pts: loop.map((q) => q.map((v) => round(v, 100))),
        closed: true,
        segs: loop.map(() => ({ s: 'mesh', h: 1.5 })),
        parcels: ids,
        frame: 'grid',
      });
    }
    this.parcelSel = null;
    this._syncPicker();
    this._commit();
    return loops.length;
  }

  // ------------------------------------------------------------ entities placed on the plan

  /** Defaults by domain: lights get a light source (ceiling spot), toggleable entities toggle on tap. */
  addEntity(entity) {
    const id = `e${Date.now().toString(36)}`;
    const domain = entity.split('.')[0];
    const light = domain === 'light';
    this.edits.entities.push({
      id,
      entity,
      at: null,
      mount: 'floor', // floor | wall | free: where the label is attached
      y: 1, // free mount: height of the label above the floor
      lightY: 2.3, // lights: height of the light source above the floor
      kind: 'spot', // lights: fixture (spot, pendant, lamp, strip, none)
      radius: 4.5, // lights: reach of the light (m)
      level: null,
      room: null,
      scope: 'general',
      display: light ? 'icon' : 'badge',
      tap: TOGGLE_DOMAINS.includes(domain) ? 'toggle' : 'more-info',
      color: '',
      label: '',
      icon: '',
    });
    this.placeEntity(id);
    return id;
  }

  _ent(id) {
    return this.edits.entities.find((x) => x.id === id);
  }

  editEntity(id, patch) {
    const s = this._ent(id);
    if (!s) return;
    Object.assign(s, patch);
    // a light source is part of the world: rebuild; the other changes only move / restyle the HTML labels
    if (s.entity.startsWith('light.') && ['lightY', 'kind', 'radius', 'mount'].some((k) => k in patch) && s.at) this._commit();
    else this.onChange();
  }

  deleteEntity(id) {
    const s = this._ent(id);
    this.edits.entities = this.edits.entities.filter((x) => x.id !== id);
    if (this.placing === id) this.placeEntity(null);
    if (s && s.entity.startsWith('light.')) this._commit();
    else this.onChange();
  }

  /** Next click on the view sets the position of entity `id` (null = cancel). */
  placeEntity(id) {
    this._exclusive('sensor');
    this.placing = id;
    this._syncPicker();
    this.onChange(false);
  }

  /** Position of entity `s` from a pointer event (floor / ground, or a wall for the wall mount). */
  _locate(s, ev) {
    const hit = this.engine.pickPoint(ev, s.mount === 'wall');
    if (!hit || (s.mount === 'wall' && !hit.normal)) return false; // wall mount: only a wall will do
    const p = hit.point;
    if (s.mount === 'wall' && hit.normal) {
      s.wall = { p: [round(p.x, 100), round(p.y, 100), round(p.z, 100)], n: [round(hit.normal[0], 1000), round(hit.normal[1], 1000)] };
      s.at = [round(p.x + hit.normal[0] * 0.3, 100), round(p.z + hit.normal[1] * 0.3, 100)]; // inside the room
    } else {
      s.wall = null;
      s.at = [round(p.x, 100), round(p.z, 100)];
    }
    s.base = round(hit.floorY ?? p.y, 100); // floor / ground height under the entity
    s.level = hit.level;
    s.room = hit.room;
    // an entity of a room layer stays in it wherever it is put (on a wall seen from the room, in the air...)
    if (s.scope === 'room' && !(s.layer || s.room)) s.scope = s.level ? 'level' : 'general';
    if (s.scope === 'level' && !s.level) s.scope = 'general';
    return true;
  }

  _entityClick(ev) {
    const s = this._ent(this.placing);
    if (!s || !this._locate(s, ev)) return;
    this.placing = null;
    this._syncPicker();
    if (s.entity.startsWith('light.')) this._commit();
    else this.onChange();
  }

  /** Drag of a placed label: move it under the pointer, rebuild / save on drop. */
  dragEntity(id, ev) {
    const s = this._ent(id);
    if (s) this._locate(s, ev);
  }

  endDrag(id) {
    const s = this._ent(id);
    if (!s) return;
    if (s.entity.startsWith('light.')) this._commit();
    else this.onChange();
  }

  _click(ev) {
    if (this.parcelSel) return this._parcelClick(ev);
    if (this.placing) return this._entityClick(ev);
    if (this.clickTool) {
      // furniture: the pieces of the plan under the pointer (pickPoint only knows floors and walls)
      const hit = this._pickFor(this.clickTool, ev);
      if (hit) this.clickTool.click(hit, ev);
      return;
    }
    if (this.tool.mode !== 'off') return this._terrainToolClick(ev);
    if (this.treeMode !== 'off') return this._editTreeAt(ev);
  }

  // ------------------------------------------------------------ draft (yellow shape being drawn, existing corrections)

  /** Empty an overlay group; a sprite keeps its geometry, which three.js shares between all of them. */
  _clearGroup(group) {
    for (const c of [...group.children]) {
      group.remove(c);
      if (c.geometry && !c.isSprite && !c.userData.shared) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  }

  _clearDraft() {
    this._clearGroup(this.draft);
  }

  /**
   * Drawing primitives of the overlays, added to `group`: they follow the ground (or `level(x, z)` when given),
   * ignore the depth buffer and take plan points. Only called once the world is there.
   */
  _prim(group, level = null) {
    const w = this.engine.world;
    const y = level ? (x, z) => level(x, z) + 0.5 : (x, z) => w.groundAt(x, z) + 0.5;
    const mat = (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false });
    const line = (planPts, color, closed) => {
      if (planPts.length < 2) return;
      const g = new THREE.BufferGeometry().setFromPoints(planPts.map(([x, z]) => new THREE.Vector3(x, y(x, z), z)));
      const l = closed ? new THREE.LineLoop(g, mat(color)) : new THREE.Line(g, mat(color));
      l.renderOrder = 998;
      group.add(l);
    };
    const dot = (x, z, color) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.set(x, y(x, z), z);
      m.renderOrder = 999;
      group.add(m);
    };
    const ribbon = (planPts, color, width = 0.25, closed = false) => {
      const pos = [];
      const n = closed ? planPts.length : planPts.length - 1;
      for (let i = 0; i < n; i++) {
        const [ax, az] = planPts[i];
        const [bx, bz] = planPts[(i + 1) % planPts.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.01) continue;
        const nx = (-(bz - az) / L) * (width / 2);
        const nz = ((bx - ax) / L) * (width / 2);
        const m = Math.max(1, Math.ceil(L / 2));
        for (let k = 0; k < m; k++) {
          const x1 = ax + ((bx - ax) * k) / m;
          const z1 = az + ((bz - az) * k) / m;
          const x2 = ax + ((bx - ax) * (k + 1)) / m;
          const z2 = az + ((bz - az) * (k + 1)) / m;
          const y1 = y(x1, z1) - 0.2;
          const y2 = y(x2, z2) - 0.2;
          pos.push(
            x1 + nx,
            y1,
            z1 + nz,
            x1 - nx,
            y1,
            z1 - nz,
            x2 - nx,
            y2,
            z2 - nz,
            x1 + nx,
            y1,
            z1 + nz,
            x2 - nx,
            y2,
            z2 - nz,
            x2 + nx,
            y2,
            z2 + nz,
          );
        }
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      m.renderOrder = 998;
      group.add(m);
    };
    return { y, line, dot, ribbon, group };
  }

  drawDraft() {
    this._clearDraft();
    const w = this.engine.world;
    const cfg = this.cfg;
    if (!w) return;
    const from = cfg ? gridToPlan(cfg.data, cfg) : (x, z) => [x, z];
    const { y, line, dot, ribbon } = this._prim(this.draft);
    if (this.clickTool && this.clickTool.draft) this.clickTool.draft({ line, dot, ribbon, group: this.draft, y });
    const H = this.handles;
    if (H && !this.move) {
      // the points of the object being edited, dragged right away: the one taken lit up, the outline shown while
      // it moves (the world itself waits for the drop)
      const pts = H.spec.points();
      if (H.grab && pts.length > 1) ribbon(H.spec.closed ? [...pts, pts[0]] : pts, '#7b8a95', 0.12);
      pts.forEach(([x, z], i) => dot(x, z, H.grab && H.grab.i === i ? '#ffe14d' : '#ffffff'));
      H.shown = JSON.stringify(pts);
    }
    if (this.parcelSel) {
      // parcels of the terrain: selected ones filled in green, the others outlined in yellow
      this.parcels.forEach((pc, k) => {
        const P = pc.poly.map(([x, z]) => from(x, z));
        const on = this.parcelSel.has(k);
        line(P, on ? '#4cd964' : '#ffe14d', true);
        if (on) this._add(this.draft, fillMesh(P, y, '#4cd964', 0.25, -0.3));
      });
    }
    const tool = this.tool;
    if (tool.mode !== 'off') {
      // corrections already in place: outlined, tinted and named, so they can be seen, picked and told apart
      // (those of the kind shown: with all of them on a busy ground, one hides the other)
      this.edits.terrain.forEach((op, i) => {
        if (this.opShown(op, i)) this._drawOp(this.draft, op, i, i === this.selOp ? 2 : 0);
      });
    }
    const pl = tool.mode === 'section' ? tool.pts : tool.pts.map(([x, z]) => from(x, z));
    line(pl, '#ffe14d', false);
    for (const [x, z] of pl) dot(x, z, '#ffe14d');
    if (this.sectionLine) line(this.sectionLine, '#ffe14d', false);
    this.drawHover();
  }

  _add(group, obj) {
    if (obj) group.add(obj);
    return obj;
  }

  /**
   * Height of the top of wall `op` along its line `P` (plan frame), for its outline: on the line itself the ground
   * is its top or its foot at random, and the outline would go up and down from one point to the next.
   */
  _wallTop(op, P) {
    const e = wallEnds(op);
    const cum = runsOf(P);
    const length = cum[cum.length - 1] || 1;
    const toY = (alt) => alt - this.engine.world.terrain.zRef + this.cfg.base;
    return (x, z) => {
      const q = nearestOnLine(P, x, z);
      if (!q) return this.engine.world.groundAt(x, z);
      const run = cum[q.seg] + Math.min(Math.max(q.t, 0), 1) * (cum[q.seg + 1] - cum[q.seg]);
      return toY(e.hi + (e.hi2 - e.hi) * (run / length));
    };
  }

  /**
   * One ground correction in `group`: its outline, a tint inside, the high side of a wall and its name.
   * `level`: 0 = one of the others, 1 = under the pointer, 2 = the one selected in the panel.
   */
  _drawOp(group, op, i, level) {
    const o = opOutline(op);
    const cfg = this.cfg;
    if (!o || !cfg) return;
    const from = gridToPlan(cfg.data, cfg);
    const P = o.pts.map(([x, z]) => from(x, z));
    const { y, line, ribbon } = this._prim(group, op.type === 'wall' ? this._wallTop(op, P) : null);
    const strong = level > 0;
    const col =
      level === 2 ? '#ffffff' : level === 1 ? '#ffe14d' : op.type === 'wall' ? '#ff9f43' : op.type === 'terrace' ? '#38d9f5' : '#c08bff';
    ribbon(P, col, strong ? 0.4 : 0.22, o.closed);
    if (o.fill) this._add(group, fillMesh(P, y, col, strong ? 0.22 : 0.1, -0.22));
    // a wall is told from its high side: a short tick in the middle of every segment points at it
    if (op.type === 'wall')
      for (let k = 0; k < P.length - 1; k++) {
        const [ax, az] = P[k];
        const [bx, bz] = P[k + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / L) * (op.side || 1);
        const nz = ((bx - ax) / L) * (op.side || 1);
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        line(
          [
            [mx, mz],
            [mx + nx * 0.9, mz + nz * 0.9],
          ],
          col,
          false,
        );
      }
    // the two ends of the selected wall are named, as in the panel: A where it was started, B where it ends
    if (op.type === 'wall' && level === 2)
      for (const [mark, [x, z]] of [
        ['A', P[0]],
        ['B', P[P.length - 1]],
      ])
        this._add(group, labelSprite(mark, [x, y(x, z) + 0.5, z], { h: 0.036, color: '#ffe14d' }));
    const c = opCenter(op);
    if (!c) return;
    const [lx, lz] = from(c[0], c[1]);
    const name = this.opName(op, i, this.edits.terrain);
    if (name)
      this._add(group, labelSprite(name, [lx, y(lx, lz) + 0.9, lz], { h: strong ? 0.044 : 0.034, opacity: strong ? 1 : 0.62, color: col }));
  }

  _clearHover() {
    this._clearGroup(this.hover);
  }

  /**
   * What the next click would do, under the pointer: radius and resulting relief of a brush, segment still to close
   * of a wall / terrace / cross-section, and the correction the pointer is over (outlined, with its name).
   */
  drawHover() {
    this._clearHover();
    const w = this.engine.world;
    const cfg = this.cfg;
    const mode = this.tool.mode;
    if (!w || !w.terrain || !cfg || mode === 'off') return;
    const T = w.terrain;
    const from = gridToPlan(cfg.data, cfg);
    const { y, line, dot } = this._prim(this.hover);
    if (this.hoverOp >= 0 && this.hoverOp !== this.selOp) this._drawOp(this.hover, this.edits.terrain[this.hoverOp], this.hoverOp, 1);
    const pt = this.hoverPt;
    if (!pt) return;
    const br = this._brushAt(pt, this.hoverY);
    if (br) {
      // the ground as the brush would leave it: green where it rises, orange where it falls
      const { apply } = compileOps([br], from, (alt) => alt - T.zRef + cfg.base);
      const g0 = (x, z) => T.heightAt(x, z);
      const grid = br.mode === 'smooth' ? { na: 24, nr: 6 } : { na: 36, nr: 9 };
      const pv = brushPreview(pt[0], pt[1], br.r, g0, (x, z) => apply(x, z, g0(x, z), g0), grid);
      this.hover.add(pv.mesh);
      line(pv.ring, '#ffe14d', true);
      this.hover.add(segment([pt[0], pv.y0, pt[1]], [pt[0], pv.y0 + pv.dy, pt[1]], '#ffffff'));
      dot(pt[0], pt[1], '#ffe14d');
      const alt = this._altOf(this.hoverY); // the altitude a click would read there, as _terrainToolClick does
      const sign = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
      const txt =
        br.mode === 'set'
          ? `R ${br.r} m · ${alt.toFixed(2)} → ${br.value.toFixed(2)} m`
          : br.mode === 'add'
            ? `R ${br.r} m · ${alt.toFixed(2)} m ${sign(br.value)} m`
            : `R ${br.r} m · ${alt.toFixed(2)} m · ${sign(pv.peak)} m`;
      this.hover.add(labelSprite(txt, [pt[0], y(pt[0], pt[1]) + 1.2, pt[1]], { h: 0.04, color: '#ffe14d' }));
      return;
    }
    if (mode === 'select') return;
    // shape being drawn: the segment the next click would add, and its length
    const pl = mode === 'section' ? this.tool.pts : this.tool.pts.map(([x, z]) => from(x, z));
    dot(pt[0], pt[1], '#ffe14d');
    if (!pl.length) return;
    const last = pl[pl.length - 1];
    line([last, pt], '#b9a43a', false);
    if (mode === 'terrace' && pl.length >= 2) line([pt, pl[0]], '#6f6530', false);
    const d = Math.hypot(pt[0] - last[0], pt[1] - last[1]);
    const mx = (pt[0] + last[0]) / 2;
    const mz = (pt[1] + last[1]) / 2;
    this.hover.add(labelSprite(`${d.toFixed(2)} m`, [mx, y(mx, mz) + 0.9, mz], { h: 0.036, color: '#ffe14d' }));
  }
}

/** Cross-section chart: p = { d[], ground0[], ground[], surf[]|null, wall: {hi, lo}|null } with absolute altitudes. */
export function drawSection(cv, p) {
  const c = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  c.clearRect(0, 0, W, H);
  const all = [...p.ground0, ...p.ground, ...(p.surf || []).filter((v, i) => v - p.ground0[i] < 12)];
  if (p.wall) all.push(p.wall.hi, p.wall.lo);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = 22;
  const L = p.d[p.d.length - 1] || 1;
  const X = (d) => pad + (d / L) * (W - pad - 6);
  const Y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 24);
  c.strokeStyle = '#2a3340';
  c.fillStyle = '#8b95a5';
  c.font = '10px sans-serif';
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    c.beginPath();
    c.moveTo(pad, Y(v));
    c.lineTo(W - 6, Y(v));
    c.stroke();
    c.fillText(v.toFixed(1), 0, Y(v) + 3);
  }
  c.fillText(`${L.toFixed(1)} m`, W - 40, H - 2);
  const plot = (arr, color, w, dash) => {
    c.beginPath();
    c.strokeStyle = color;
    c.lineWidth = w;
    c.setLineDash(dash || []);
    arr.forEach((v, i) => (i ? c.lineTo(X(p.d[i]), Y(v)) : c.moveTo(X(p.d[i]), Y(v))));
    c.stroke();
    c.setLineDash([]);
  };
  if (p.surf)
    plot(
      p.surf.map((v, i) => (v - p.ground0[i] < 12 ? v : p.ground0[i])),
      '#ff8a00',
      1,
    );
  plot(p.ground0, '#4aa3ff', 1.5);
  plot(p.ground, '#7ee081', 1.5);
  if (p.wall) {
    for (const v of [p.wall.hi, p.wall.lo]) {
      c.beginPath();
      c.strokeStyle = '#ffd166';
      c.setLineDash([3, 3]);
      c.moveTo(pad, Y(v));
      c.lineTo(W - 6, Y(v));
      c.stroke();
      c.setLineDash([]);
    }
  }
}
