// Interactive editors of the card (admin only): detached outdoor objects, trees, ground corrections (walls, terraces,
// brushes, cross-section). They work on `engine.edits` (mutated in place) and call `engine.commit()` to rebuild the world;
// `onChange` lets the card persist the edits file and refresh its panel. No HA / DOM knowledge except the pointer events.
import * as THREE from 'three';
import { SPECIES } from './engine/catalog.js';
import { gridToPlan, planToGrid, houseParcel } from './engine/terrain.js';
import { unionOutline, inPoly } from './parcels.js';
import { normalizeScene } from './engine/scene-model.js';
import { emptyEdits } from './engine/edits.js';

const round = (v, n) => Math.round(v * n) / n;
const ringArea = (r) => r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2;
const TOGGLE_DOMAINS = ['light', 'switch', 'input_boolean', 'fan', 'cover', 'lock', 'siren', 'humidifier'];

export class WorldEditors {
  /**
   * @param {import('./engine.js').HouseEngine} engine
   * @param {{onChange?: () => void}} [opts]
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.onChange = opts.onChange || (() => {});
    this.treeMode = 'off'; // 'off' | 'delete' | 'add'
    this.treeAdd = { species: 'oak', h: SPECIES.oak ? SPECIES.oak.height : 8 };
    this.tool = { mode: 'off', pts: [], r: 3, v: 0.5 }; // pts: grid-frame points of the shape being drawn (plan points for 'section')
    this.selOp = -1;
    this.history = []; // undo stack of the tree editor
    this.clickTool = null; // generic one-at-a-time click tool of a feature editor: { key, click(hit, ev), draft?(d), wall?, furniture? }
    this.placing = null; // entity id waiting for its position (next click)
    this.parcelSel = null; // Set of parcel indexes while choosing the parcels of the property
    this.section = null; // { d, ground0, ground, surf, wall } of the last cross-section
    this.sectionLine = null;
    this.draft = new THREE.Group();
    this.draft.name = 'terrain-draft';
    engine.scene.add(this.draft);
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
    }
    if (keep !== 'tool') {
      this.tool.mode = 'off';
      this.tool.pts = [];
      this.sectionLine = null;
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
    this.engine.onLoaded = null;
    this._clearDraft();
    this.engine.scene.remove(this.draft);
  }

  _commit() {
    this.engine.commit(); // -> onLoaded -> drawDraft
    this.onChange();
  }

  _syncPicker() {
    this.engine.setPicker(this.active ? (ev) => this._click(ev) : null);
    this.engine.pickerMove = this.active ? (ev) => this._move(ev) : null;
  }

  /** Pointer moving with a click tool: the tool shows what a click would use (tool.hover(hit), null off target). */
  _move(ev) {
    const t = this.clickTool;
    if (!t || !t.hover) return;
    if (!ev) return t.hover(null);
    t.hover(t.furniture ? this.engine.pickFurnitureAt(ev) : this.engine.pickPoint(ev, !!t.wall));
  }

  /**
   * Install the click tool of a feature editor (fences, irrigation, vacuum...), or null to leave it. Only one click
   * mode is active at a time. tool.click(hit, ev) gets the picked point; tool.draft(d) draws its overlay.
   */
  setClickTool(tool) {
    if (this.clickTool && this.clickTool !== tool && this.clickTool.leave) this.clickTool.leave();
    this._exclusive('click');
    this.clickTool = tool;
    this._syncPicker();
    this.drawDraft();
    this.onChange(false);
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

  treeUndo() {
    const undo = this.history.pop();
    if (undo) {
      undo();
      this._commit();
    }
  }

  treeReset() {
    this.edits.trees = emptyEdits().trees;
    this.history.length = 0;
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
      if (src.kind === 'dsm') {
        rem.dsm.push([src.gx, src.gz]);
        this.history.push(() => rem.dsm.pop());
      } else if (src.kind === 'sd') {
        rem.sd.push(src.idx);
        this.history.push(() => rem.sd.pop());
      } else {
        const [a] = this.edits.trees.added.splice(src.idx, 1);
        this.history.push(() => this.edits.trees.added.splice(src.idx, 0, a));
      }
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
      this.history.push(() => this.edits.trees.added.pop());
    }
    this._commit();
  }

  // ------------------------------------------------------------ ground

  get cfg() {
    return this.engine.terrainCfg;
  }

  setTool(mode) {
    if (mode !== 'off' && !this.cfg) return false; // needs a terrain
    this._exclusive('tool');
    this.tool.mode = mode;
    this._syncPicker();
    this.engine.commit();
    this.onChange(false);
    return true;
  }

  setToolParams(p) {
    Object.assign(this.tool, p);
  }

  cancelDraft() {
    this.tool.pts = [];
    this.sectionLine = null;
    this.drawDraft();
    this.onChange(false);
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
    if (m === 'wall' || m === 'terrace') {
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
    this.showSection([mx - nx * 7, mz - nz * 7], [mx + nx * 7, mz + nz * 7], { hi: op.hi, lo: op.lo });
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
    if (s.scope === 'room' && !s.room) s.scope = s.level ? 'level' : 'general';
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
      const hit = this.clickTool.furniture ? this.engine.pickFurnitureAt(ev) : this.engine.pickPoint(ev, !!this.clickTool.wall);
      if (hit) this.clickTool.click(hit, ev);
      return;
    }
    if (this.tool.mode !== 'off') return this._terrainToolClick(ev);
    if (this.treeMode !== 'off') return this._editTreeAt(ev);
  }

  // ------------------------------------------------------------ draft (yellow shape being drawn, existing corrections)

  _clearDraft() {
    for (const c of [...this.draft.children]) {
      this.draft.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  drawDraft() {
    this._clearDraft();
    const w = this.engine.world;
    const cfg = this.cfg;
    if (!w) return;
    const from = cfg ? gridToPlan(cfg.data, cfg) : (x, z) => [x, z];
    const y = (x, z) => w.groundAt(x, z) + 0.5;
    const mat = (c) => new THREE.LineBasicMaterial({ color: c, depthTest: false });
    const line = (planPts, color, closed) => {
      if (planPts.length < 2) return;
      const g = new THREE.BufferGeometry().setFromPoints(planPts.map(([x, z]) => new THREE.Vector3(x, y(x, z), z)));
      const l = closed ? new THREE.LineLoop(g, mat(color)) : new THREE.Line(g, mat(color));
      l.renderOrder = 998;
      this.draft.add(l);
    };
    const dot = (x, z, color) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.set(x, y(x, z), z);
      m.renderOrder = 999;
      this.draft.add(m);
    };
    // flat colored strip on the ground (lines are 1 px wide whatever the zoom: too thin to tell the types apart)
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
      this.draft.add(m);
    };
    if (this.clickTool && this.clickTool.draft) this.clickTool.draft({ line, dot, ribbon, group: this.draft, y });
    if (this.parcelSel) {
      // parcels of the terrain: selected ones filled in green, the others outlined in yellow
      this.parcels.forEach((pc, k) => {
        const P = pc.poly.map(([x, z]) => from(x, z));
        const on = this.parcelSel.has(k);
        line(P, on ? '#4cd964' : '#ffe14d', true);
        if (!on) return;
        const ring = P.length > 2 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1] ? P.slice(0, -1) : P;
        const tris = THREE.ShapeUtils.triangulateShape(
          ring.map(([x, z]) => new THREE.Vector2(x, z)),
          [],
        );
        const pos = [];
        for (const t of tris) for (const v of t) pos.push(ring[v][0], y(ring[v][0], ring[v][1]) - 0.3, ring[v][1]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.25, depthTest: false, side: THREE.DoubleSide }),
        );
        m.renderOrder = 997;
        this.draft.add(m);
      });
    }
    const tool = this.tool;
    if (tool.mode !== 'off') {
      // existing corrections, to see and pick what is already there
      this.edits.terrain.forEach((op, i) => {
        const col = i === this.selOp ? '#ffffff' : op.type === 'wall' ? '#ff9f43' : '#38d9f5';
        if (op.type === 'wall')
          line(
            op.pts.map(([x, z]) => from(x, z)),
            col,
            false,
          );
        else if (op.type === 'terrace')
          line(
            op.poly.map(([x, z]) => from(x, z)),
            col,
            true,
          );
      });
    }
    const pl = tool.mode === 'section' ? tool.pts : tool.pts.map(([x, z]) => from(x, z));
    line(pl, '#ffe14d', false);
    for (const [x, z] of pl) dot(x, z, '#ffe14d');
    if (this.sectionLine) line(this.sectionLine, '#ffe14d', false);
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
