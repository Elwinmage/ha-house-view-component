// Moving parts of the doors and windows: window casements (one or two leaves), sliding patio panels, door leaves,
// garage doors (the six ways of GARAGE_KINDS) and roller shutters. Each opening has a root group in its own frame:
// x along the wall, y up, z across the wall (`side` tells which way z points: +1 outward).
import * as THREE from 'three';

const OPEN_SPEED = 0.9; // leaf travel per second (0..1)
const GARAGE_SPEED = 0.09; // a garage door takes its time: about 11 s end to end
const SHUTTER_SPEED = 0.22; // shutter travel per second: about 4.5 s from open to closed
const BEND = 0.45; // meters a sectional panel takes to turn the corner under the ceiling
const PANEL_T = 0.05; // thickness of a panel of a garage door
const GARAGE_COLOR = '#cfccc4';

let slatImage = null;
/** Canvas of the slats of a roller shutter (shared by every shutter). */
function slatCanvas() {
  if (slatImage || typeof document === 'undefined') return slatImage;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e6df';
  g.fillRect(0, 0, 4, 32);
  g.fillStyle = '#b9b4aa';
  g.fillRect(0, 28, 4, 4);
  g.fillStyle = '#f6f4ef';
  g.fillRect(0, 2, 4, 6);
  slatImage = c;
  return c;
}

export class OpeningsFx {
  constructor() {
    this.items = new Map();
    this.busy = false;
  }

  /** An opening of the plan (geometry meta) and the level group it lives in. */
  register(meta, group) {
    this.items.set(meta.key, {
      meta,
      group,
      root: null,
      leaves: [],
      shutter: null,
      garage: null,
      open: 0,
      shut: 0,
      to: { open: 0, shut: 0 },
    });
  }

  _root(it) {
    if (!it.root) {
      const r = new THREE.Group();
      r.name = `opening-${it.meta.key}`;
      r.position.set(...it.meta.center);
      r.rotation.y = it.meta.rotY;
      it.group.add(r);
      it.root = r;
    }
    return it.root;
  }

  /** Glass of a window (one casement, two past 1.1 m) or of a patio door (two sliding panels). */
  glass(key, mat) {
    const it = this.items.get(key);
    if (!it) return;
    const { width: w, height: h, type } = it.meta;
    const r = this._root(it);
    if (type === 'patio') {
      [-1, 1].forEach((i) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w / 2, h), mat);
        m.renderOrder = 5;
        const g = new THREE.Group();
        g.position.set((i * w) / 4, 0, i * 0.015);
        g.add(m);
        r.add(g);
        it.leaves.push({ g, kind: i > 0 ? 'slide' : 'fixed', w });
      });
      return;
    }
    const n = w > 1.1 ? 2 : 1;
    const lw = w / n;
    for (let i = 0; i < n; i++) {
      const side = i === 0 ? -1 : 1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, h), mat);
      m.renderOrder = 5;
      m.position.x = (-side * lw) / 2;
      const g = new THREE.Group();
      g.position.x = (side * w) / 2;
      g.add(m);
      r.add(g);
      it.leaves.push({ g, kind: 'swing', dir: side, angle: 1.2 });
    }
  }

  /** Leaf of a door, hinged on its left post. */
  leaf(key) {
    const it = this.items.get(key);
    if (!it || it.leaves.length) return;
    const { width: w, height: h, thickness: T } = it.meta;
    const r = this._root(it);
    const lw = w - 0.04;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(lw, h - 0.02, Math.min(0.05, T * 0.5)),
      new THREE.MeshStandardMaterial({ color: '#7a4f33', roughness: 0.8 }),
    );
    m.castShadow = true;
    m.position.x = lw / 2;
    const g = new THREE.Group();
    g.position.x = -lw / 2;
    g.add(m);
    r.add(g);
    it.leaves.push({ g, kind: 'swing', dir: -1, angle: 1.45 });
    this._apply(it);
  }

  /**
   * Garage door, built the way it opens (GARAGE_KINDS in openings.js). Changing the way rebuilds it, so the view
   * follows the choice of the user at once; a door that is linked to nothing simply stays closed.
   */
  garage(key, kind) {
    const it = this.items.get(key);
    if (!it || it.garage === kind) return;
    for (const l of it.leaves) l.g.removeFromParent();
    it.leaves = [];
    it.garage = kind;
    const { width: w, height: h, thickness: T, side } = it.meta;
    const r = this._root(it);
    const z0 = side * (T / 2 + 0.03);
    const tex = slatCanvas() ? new THREE.CanvasTexture(slatCanvas()) : null;
    if (tex) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: GARAGE_COLOR, map: tex, roughness: 0.55, metalness: 0.2 });
    const panel = (pw, ph) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, PANEL_T), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const hold = (x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      r.add(g);
      return g;
    };

    if (kind === 'roller') {
      // a curtain of slats winding into its drum over the lintel
      const geo = new THREE.PlaneGeometry(w - 0.02, 1);
      geo.translate(0, -0.5, 0); // hangs from y = 0
      const roll = tex ? tex.clone() : null;
      if (roll) roll.wrapS = roll.wrapT = THREE.RepeatWrapping;
      const curtain = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: GARAGE_COLOR, map: roll, roughness: 0.6, side: THREE.DoubleSide }),
      );
      curtain.castShadow = true;
      curtain.position.set(0, h / 2, z0);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, w, 14), mat);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, h / 2 + 0.19, z0);
      drum.castShadow = true;
      const g = hold(0, 0, 0);
      g.add(curtain, drum);
      it.leaves.push({ g, kind: 'roll', curtain, tex: roll, h: h - 0.02 });
    } else if (kind === 'tilt') {
      // one rigid panel on a pivot at the lintel: the bottom swings out and up
      const g = hold(0, h / 2, z0);
      const m = panel(w - 0.02, h - 0.02);
      m.position.y = -(h - 0.02) / 2;
      g.add(m);
      it.leaves.push({ g, kind: 'tilt', side, angle: 1.4 });
    } else if (kind === 'swing') {
      // two leaves hinged on the sides, opening outward
      const lw = w / 2 - 0.02;
      for (const dir of [-1, 1]) {
        const g = hold((dir * w) / 2, 0, z0);
        const m = panel(lw, h - 0.02);
        m.position.x = (-dir * lw) / 2;
        g.add(m);
        it.leaves.push({ g, kind: 'swing', dir, angle: 1.9, sign: 1 });
      }
    } else if (kind === 'slide') {
      // one panel running sideways along the inner wall
      const g = hold(0, 0, z0 - side * (PANEL_T + 0.03));
      g.add(panel(w - 0.02, h - 0.02));
      it.leaves.push({ g, kind: 'sideslide', w });
    } else if (kind === 'folding') {
      // narrow panels folding against one side like an accordion
      const n = 4;
      const pw = w / n;
      for (let i = 0; i < n; i++) {
        const g = hold(-w / 2 + pw * (i + 0.5), 0, z0);
        g.add(panel(pw - 0.015, h - 0.02));
        it.leaves.push({ g, kind: 'fold', i, pw, w });
      }
    } else {
      // sectional: panels hinged together, running up the rails and lying flat under the ceiling
      const n = Math.min(6, Math.max(3, Math.round(h / 0.55)));
      const ph = h / n;
      for (let i = 0; i < n; i++) {
        const g = hold(0, 0, z0);
        g.add(panel(w - 0.02, ph - 0.012));
        // the curtain travels the height of the door plus the bend, so the last panel ends up flat too
        it.leaves.push({ g, kind: 'sectional', d0: h - ph * (i + 0.5), h, travel: h + BEND, z0, side });
      }
    }
    it.dirty = true;
    this._apply(it);
  }

  /** Roller shutter on the outer face: the curtain hangs from its box, its height follows the closed fraction. */
  _makeShutter(it) {
    const { width: w, height: h, thickness: T, side } = it.meta;
    const r = this._root(it);
    const g = new THREE.Group();
    g.position.z = side * (T / 2 + 0.035);
    const tex = new THREE.CanvasTexture(slatCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const geo = new THREE.PlaneGeometry(w + 0.04, 1);
    geo.translate(0, -0.5, 0); // hangs from y = 0
    const curtain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    curtain.position.y = h / 2;
    curtain.castShadow = true;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.1, 0.16, 0.16),
      new THREE.MeshStandardMaterial({ color: '#e4e1da', roughness: 0.7 }),
    );
    box.position.set(0, h / 2 + 0.08, side * 0.05);
    box.castShadow = true;
    g.add(curtain, box);
    r.add(g);
    it.shutter = { g, curtain, tex, h };
  }

  /** New states { key: { open, shutter } } (missing: closed, no shutter). */
  set(map) {
    for (const [key, it] of this.items) {
      const s = map && map[key];
      it.to.open = s ? s.open || 0 : 0;
      const hasShutter =
        !!s && s.shutter !== null && s.shutter !== undefined && it.meta.exterior && (it.meta.type === 'window' || it.meta.type === 'patio');
      it.to.shut = hasShutter ? s.shutter : 0;
      if (s && s.garage) this.garage(key, s.garage); // the user may change the way it opens at any time
      if (s && it.meta.type === 'door' && !it.leaves.length) this.leaf(key); // an interior door gets a leaf once linked
      if (hasShutter && !it.shutter) this._makeShutter(it);
      if (it.shutter) it.shutter.g.visible = hasShutter;
    }
    this.busy = true;
  }

  /** Move every part toward its target; `busy` stays true while something moves. */
  tick(dt) {
    let moving = false;
    const step = (v, to, speed) => {
      if (Math.abs(to - v) < 1e-3) return to;
      moving = true;
      return v + Math.sign(to - v) * Math.min(Math.abs(to - v), speed * dt);
    };
    for (const it of this.items.values()) {
      const o = step(it.open, it.to.open, it.garage ? GARAGE_SPEED : OPEN_SPEED);
      const s = step(it.shut, it.to.shut, SHUTTER_SPEED);
      if (o !== it.open || s !== it.shut || it.dirty !== false) {
        it.open = o;
        it.shut = s;
        this._apply(it);
        it.dirty = false;
      }
    }
    this.busy = moving;
  }

  _apply(it) {
    const side = it.meta.side;
    for (const l of it.leaves) {
      // a leaf turns inward (away from the outer side) unless it is told otherwise, as a garage door is
      if (l.kind === 'swing') l.g.rotation.y = (l.sign === undefined ? -1 : l.sign) * l.dir * side * it.open * l.angle;
      else if (l.kind === 'slide') l.g.position.x = l.w / 4 - it.open * (l.w / 2) * 0.95;
      else if (l.kind === 'sideslide') l.g.position.x = -it.open * l.w * 0.98;
      else if (l.kind === 'tilt') l.g.rotation.x = -l.side * it.open * l.angle;
      else if (l.kind === 'fold') {
        // every panel gathers against the first one, turned one way then the other
        const closed = -l.w / 2 + l.pw * (l.i + 0.5);
        l.g.position.x = closed + (-l.w / 2 + l.pw * 0.5 - closed) * it.open;
        l.g.rotation.y = (l.i % 2 ? 1 : -1) * it.open * 1.35;
      } else if (l.kind === 'sectional') {
        // the panel runs up to the lintel, then turns the corner and lies flat inside
        const d = l.d0 - it.open * l.travel;
        if (d >= 0) {
          l.g.position.set(0, l.h / 2 - d, l.z0);
          l.g.rotation.x = 0;
        } else {
          l.g.position.set(0, l.h / 2, l.z0 + l.side * d);
          l.g.rotation.x = -l.side * Math.min(1, -d / BEND) * (Math.PI / 2);
        }
      } else if (l.kind === 'roll') {
        const f = Math.max(1 - it.open, 0.001);
        l.curtain.scale.y = l.h * f;
        l.curtain.visible = it.open < 0.995;
        if (l.tex) l.tex.repeat.set(1, (l.h * f) / 0.09);
      }
    }
    const sh = it.shutter;
    if (sh) {
      const f = Math.max(it.shut, 0.001);
      sh.curtain.scale.y = sh.h * f;
      sh.curtain.visible = it.shut > 0.005;
      sh.tex.repeat.set(1, (sh.h * f) / 0.055);
    }
  }

  /** Hit test for the editor: key of the opening whose rectangle the ray crosses first, among visible levels. */
  pick(ray, levelShown, maxT = Infinity) {
    let best = null;
    const inv = new THREE.Matrix4();
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (const it of this.items.values()) {
      const m = it.meta;
      if (!levelShown(m.level)) continue;
      inv.makeRotationY(-m.rotY);
      o.copy(ray.origin)
        .sub(new THREE.Vector3(...m.center))
        .applyMatrix4(inv);
      d.copy(ray.direction).applyMatrix4(inv);
      if (Math.abs(d.z) < 1e-6) continue;
      const t = -o.z / d.z;
      if (t <= 0 || t > maxT) continue;
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      if (Math.abs(x) <= m.width / 2 && Math.abs(y) <= m.height / 2 && (!best || t < best.t)) best = { t, key: m.key };
    }
    return best ? best.key : null;
  }
}
