// 3D engine of the card: one instance per card (several cards can show the same house).
// Pure rendering: it receives { scene, terrain, edits } plus live data (time, weather, lights) and knows nothing of HA.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeScene } from './engine/scene-model.js';
import { buildLevelWalls, buildFloor, buildRoof, buildSite } from './engine/geometry.js';
import { buildFurniture, buildBoxFurnitureMesh, buildFixture, createVegetation, SPECIES } from './engine/catalog.js';
import { normalizeEdits, outdoorEdit, isDsmRemoved } from './engine/edits.js';
import { LightSystem } from './engine/lighting.js';
import { Environment, WEATHER_PRESETS } from './engine/environment.js';
import { buildTerrain, treesFromDsm } from './engine/terrain.js';

const VIEW_H = 30; // world height visible at zoom 1

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Terrain registration stored in the edits file ({ base, rot, dx, dz, ... }) -> config used by the builders. */
export function terrainConfig(terrainData, edits, sd) {
  if (!terrainData) return null;
  const r = edits.registration || {};
  const defBase = sd.levels.length > 1 ? Math.round(sd.levels[1].elevation * 50) / 100 : 0;
  return {
    data: terrainData,
    name: 'terrain',
    base: r.base ?? defBase,
    rot: r.rot ?? 0,
    dx: r.dx ?? 0,
    dz: r.dz ?? 0,
    showMns: r.showMns ?? false,
    showVec: r.showVec ?? false,
    showTrees: r.showTrees ?? true,
  };
}

export class HouseEngine {
  /**
   * @param {HTMLElement} container
   * @param {{interactive?: boolean, fpsCap?: number, onRoomClick?: (roomId: string, ev: PointerEvent) => void}} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = { interactive: false, fpsCap: 0, ...opts };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minZoom = 0.2;
    this.controls.maxZoom = 9;
    this.controls.screenSpacePanning = false;
    this.controls.enabled = !!this.opts.interactive;
    this.controls.addEventListener('start', () => (this.tween = null));
    this.env = new Environment(this.scene, this.renderer, {
      latitude: 43.6,
      northOffsetDeg: 0,
      center: [10, 0, 4],
      plot: { x0: -8, z0: -8, x1: 24, z1: 16 },
    });
    this.spillTex = radialTexture();
    this.black = new THREE.Color(0, 0, 0);
    this.world = null;
    this.visibility = { roof: true, levels: {} };
    this.views = [];
    this.tween = null;
    this.vegDoyShift = 0; // 182 in the southern hemisphere: vegetation seasons are reversed
    this.running = false;
    this.disposed = false;
    this._last = 0;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (ev) => (this._down = [ev.clientX, ev.clientY]));
    el.addEventListener('pointerup', (ev) => this._click(ev));
    this._frame = this._frame.bind(this);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const c = this.camera;
    c.left = (-VIEW_H * aspect) / 2;
    c.right = (VIEW_H * aspect) / 2;
    c.top = VIEW_H / 2;
    c.bottom = -VIEW_H / 2;
    c.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ world

  _disposeWorld(w) {
    w.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m !== null) m.dispose();
    });
    this.scene.remove(w.root);
  }

  _buildWorld(sd, terr, edits, lightsOverride = null) {
    const { scene, spillTex, black } = this;
    const root = new THREE.Group();
    root.name = 'world';
    scene.add(root);
    const surfaces = [];
    const w = {
      root,
      sd,
      levelGroups: {},
      floors: [],
      fixtures: [],
      spills: [],
      glassByRoom: new Map(),
      lightSystem: new LightSystem(),
      lights: lightsOverride || sd.lights.map((l) => ({ ...l })),
      terrain: terr ? buildTerrain(terr.data, sd, { ...terr, ops: edits.terrain }) : null,
      levelsById: {},
      roof: null,
      site: null,
      veg: null,
      surfaces,
    };

    const mats = {
      exterior: new THREE.MeshStandardMaterial({ color: '#e8dccb', roughness: 0.95 }),
      interior: new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.95 }),
      frame: new THREE.MeshStandardMaterial({ color: '#f7f7f7', roughness: 0.6 }),
    };
    const roofMat = new THREE.MeshStandardMaterial({ color: '#b5563c', roughness: 0.85, side: THREE.DoubleSide });
    const gableMat = new THREE.MeshStandardMaterial({ color: '#e8dccb', roughness: 0.95, side: THREE.DoubleSide });
    surfaces.push({ material: roofMat, key: 'roof', snow: 0.92, wet: 0.25 });

    const glassFor = (roomId) => {
      const k = roomId || '_';
      if (!w.glassByRoom.has(k)) {
        w.glassByRoom.set(
          k,
          new THREE.MeshStandardMaterial({
            color: '#bfe3f2',
            transparent: true,
            opacity: 0.3,
            roughness: 0.05,
            metalness: 0.1,
            emissive: '#000000',
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
      }
      return w.glassByRoom.get(k);
    };

    const levelOfRoom = {};
    const groundLevel = sd.levels[0];

    for (const level of sd.levels) {
      w.levelsById[level.id] = level;
      const g = new THREE.Group();
      g.name = `level-${level.id}`;
      w.levelGroups[level.id] = g;
      root.add(g);

      const walls = buildLevelWalls(level, sd.openings, mats);
      for (const m of [walls.exterior, walls.interior, walls.frames]) if (m) g.add(m);

      for (const room of level.rooms) {
        levelOfRoom[room.id] = level.id;
        if (!room.noFloor) {
          const mat = new THREE.MeshStandardMaterial({ color: room.floor, roughness: 0.7, emissive: '#000000' });
          const floor = buildFloor(room, level.elevation, level.floorThickness, mat);
          g.add(floor);
          w.floors.push({ mesh: floor, room, level });
        }
        w.lightSystem.addRoom(room, level, sd.openings);
        g.add(w.lightSystem.volumes.get(room.id).mesh);
      }

      const boxes = [];
      for (const item of sd.furniture.filter((f) => f.level === level.id)) {
        if (item.kind === 'box') boxes.push(item);
        else {
          const f = buildFurniture(item);
          f.position.y = level.elevation;
          g.add(f);
        }
      }
      const boxMesh = buildBoxFurnitureMesh(boxes, level.elevation);
      if (boxMesh) g.add(boxMesh);

      for (const p of walls.panes) {
        if (p.kind === 'glass') {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), glassFor(p.room));
          mesh.position.set(...p.center);
          mesh.rotation.y = p.rotY;
          mesh.renderOrder = 5;
          g.add(mesh);
          if (level === groundLevel && p.exterior && p.room) {
            const sm = new THREE.MeshBasicMaterial({
              map: spillTex,
              color: '#ffffff',
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const spill = new THREE.Mesh(new THREE.PlaneGeometry(p.width * 2.2 + 0.8, 3.2), sm);
            spill.rotation.order = 'YXZ';
            spill.rotation.set(-Math.PI / 2, p.rotY, 0);
            const sx = p.center[0] + p.out[0] * 1.5;
            const sz = p.center[2] + p.out[1] * 1.5;
            spill.position.set(sx, (w.terrain ? w.terrain.heightAt(sx, sz) : 0) + (p.type === 'patio' && sd.site.deck ? 0.112 : 0.016), sz);
            spill.renderOrder = 6;
            g.add(spill);
            w.spills.push({ room: p.room, mesh: spill });
          }
        } else {
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(p.width - 0.04, p.height - 0.02, Math.min(0.05, p.thickness * 0.5)),
            new THREE.MeshStandardMaterial({ color: '#7a4f33', roughness: 0.8 }),
          );
          mesh.position.set(...p.center);
          mesh.rotation.y = p.rotY;
          mesh.castShadow = true;
          g.add(mesh);
        }
      }
    }

    w.roof = buildRoof(sd.roof, roofMat, gableMat);
    if (w.roof) root.add(w.roof);

    sd.site.poolDy = edits.pool.dy;
    w.site = buildSite(sd.site, surfaces, w.terrain);
    root.add(w.site.group);

    // detached objects (shed, gate...) : anchored to the terrain, whatever level they were drawn on in SH3D
    w.outdoor = [];
    const og = new THREE.Group();
    og.name = 'outdoor';
    for (const it of sd.outdoor) {
      const e = outdoorEdit(edits, it.id);
      const x = it.at[0] + e.dx;
      const z = it.at[1] + e.dz;
      const rot = it.rot + (e.rot * Math.PI) / 180;
      // lowest ground point under the footprint: on a slope the high side is buried, the low side never floats
      let ground = 0;
      if (w.terrain) {
        const [bw, , bd] = it.size;
        const c = Math.cos(rot);
        const sn = Math.sin(rot);
        ground = Infinity;
        for (const [u, v] of [
          [0, 0],
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const lx = (u * bw) / 2;
          const lz = (v * bd) / 2;
          ground = Math.min(ground, w.terrain.heightAt(x + lx * c + lz * sn, z - lx * sn + lz * c));
        }
      }
      w.outdoor.push({ id: it.id, name: it.name, sh3dLevel: it.sh3dLevel, ground, ...e });
      if (e.hidden) continue;
      const mesh = buildBoxFurnitureMesh([{ ...it, at: [x, z], rot }], ground + e.dy);
      if (mesh) og.add(mesh);
    }
    root.add(og);

    const b = sd.bbox;
    const outdoorExtras = [];
    if (sd.site.deck) {
      const [x0, z0, x1, z1] = sd.site.deck.rect;
      outdoorExtras.push({
        rect: [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
        y: 0.106,
        color: '#a07a4f',
      });
    }
    if (sd.site.path) {
      const [x0, z0, x1, z1] = sd.site.path.rect;
      outdoorExtras.push({
        rect: [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
        y: 0.042,
        color: '#c3b9a4',
      });
    }
    w.lightSystem.addOutdoor(sd.site.plot, { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, outdoorExtras);
    root.add(w.lightSystem.volumes.get('outdoor').mesh);

    // trees = plan vegetation + trees deduced from the DSM + trees added by hand, minus the ones deleted by hand.
    // `_src` tells the tree editor where each one comes from (veg.group.children[i] <-> w.trees[i]).
    const dsmTrees = terr && terr.showTrees !== false ? treesFromDsm(terr.data, terr, sd, (gx, gz) => isDsmRemoved(edits, gx, gz)) : [];
    w.trees = [
      ...sd.vegetation.map((p, i) => ({ ...p, _src: { kind: 'sd', idx: i } })).filter((p) => !edits.trees.removed.sd.includes(p._src.idx)),
      ...dsmTrees,
      ...edits.trees.added
        .filter((a) => SPECIES[a.species])
        .map((a, i) => ({ species: a.species, at: a.at, scale: a.h / SPECIES[a.species].height, _src: { kind: 'added', idx: i } })),
    ];
    w.veg = createVegetation(w.trees, surfaces);
    if (w.terrain) for (const g of w.veg.group.children) g.position.y = w.terrain.heightAt(g.position.x, g.position.z);
    root.add(w.veg.group);

    for (const l of w.lights) {
      if (l.kind === 'pool') continue;
      l.level ??= levelOfRoom[l.room] ?? null;
      const lvl = l.level ? w.levelsById[l.level] : null;
      const fx = buildFixture(l, lvl ? lvl.elevation : 0);
      (lvl ? w.levelGroups[lvl.id] : root).add(fx.group);
      w.fixtures.push({ light: l, material: fx.material });
    }
    return w;
  }

  _applyVisibility() {
    const world = this.world;
    const vis = this.visibility;
    for (const lv of world.sd.levels) world.levelGroups[lv.id].visible = vis.levels[lv.id] !== false;
    if (world.roof) world.roof.visible = vis.roof;
    world.lightSystem.updateVisibility(vis.levels);
    const ov = world.lightSystem.volumes.get('outdoor');
    if (world.terrain && ov) ov.mesh.visible = false; // flat outdoor light volume does not follow a sloped ground
    const groundId = world.sd.levels[0].id;
    for (const s of world.spills) s.mesh.visible = vis.levels[groundId] !== false && s.mesh.material.opacity > 0.002;
  }

  _refreshLights() {
    const w = this.world;
    const env = this.env;
    const black = this.black;
    const rs = w.lightSystem.setLights(w.lights);
    w.lightSystem.setGlow(env.glow);
    for (const f of w.fixtures) {
      f.material.emissive.copy(f.light.on ? new THREE.Color(f.light.color) : black);
      f.material.emissiveIntensity = f.light.on ? 0.6 + f.light.brightness * 1.4 : 0;
    }
    for (const [roomId, gm] of w.glassByRoom) {
      const st = rs.get(roomId);
      const on = st && st.level > 0;
      gm.emissive.copy(on ? st.color : black);
      gm.emissiveIntensity = on ? Math.min(st.level, 1.3) * (0.25 + 0.75 * env.glow) * 1.1 : 0;
    }
    for (const s of w.spills) {
      const st = rs.get(s.room);
      const a = st ? st.level : 0;
      s.mesh.material.opacity = Math.min(a * env.glow * 0.6, 0.9);
      if (st) s.mesh.material.color.copy(st.color);
    }
    if (w.site.waterMat) {
      const pool = w.lights.find((l) => l.room === 'pool');
      w.site.waterMat.emissive.copy(
        pool && pool.on ? new THREE.Color(pool.color).multiplyScalar(0.5 * pool.brightness * (0.3 + 0.7 * env.night)) : black,
      );
    }
    this._applyVisibility();
  }

  /**
   * (Re)build the world.
   * @param {{scene: object, terrain?: object|null, edits?: object|null}} data  scene = generic scene format (see scene-model.js)
   * @param {{keepLights?: boolean}} [opts]
   */
  load(data, opts = {}) {
    const edits = normalizeEdits(data.edits);
    this.edits = edits;
    const sd = normalizeScene(structuredClone(data.scene));
    if (edits.registration && Number.isFinite(edits.registration.northOffsetDeg))
      sd.site.northOffsetDeg = edits.registration.northOffsetDeg;
    const keptLights = opts.keepLights && this.world ? this.world.lights : null;
    const keptVis = opts.keepLights && this.world ? { roof: this.visibility.roof, levels: { ...this.visibility.levels } } : null;
    if (this.world) this._disposeWorld(this.world);
    this.tween = null;
    this.env.setSite(sd.site);
    this.vegDoyShift = (sd.site.latitude ?? 43.6) < 0 ? 182 : 0;
    const terr = terrainConfig(data.terrain, edits, sd);
    this.world = this._buildWorld(sd, terr, edits, keptLights);
    for (const e of this.world.surfaces) this.env.registerSurface(e);
    this.env.applyState();
    this.world.veg.apply((this.env.state.doy + this.vegDoyShift) % 365);
    this.visibility.roof = true;
    this.visibility.levels = Object.fromEntries(sd.levels.map((l) => [l.id, true]));
    if (keptVis) Object.assign(this.visibility, keptVis);
    this.views = edits.views && edits.views.length ? edits.views : sd.views;
    this._refreshLights();
    if (!keptVis) this.goToView(0, true);
    return this;
  }

  get rooms() {
    return this.world ? this.world.sd.levels.flatMap((l) => l.rooms.map((r) => ({ id: r.id, name: r.name, level: l.id }))) : [];
  }

  get lights() {
    return this.world ? this.world.lights : [];
  }

  // ------------------------------------------------------------ live data

  /**
   * Live state from Home Assistant. Every field is optional.
   * @param {{hour?: number, doy?: number, latitude?: number, weather?: string, cloud?: number, precip?: number,
   *          precipType?: string, wind?: number, temp?: number, snowCover?: number}} s
   */
  setLive(s) {
    if (!this.world) return;
    const env = this.env;
    if (s.latitude !== undefined && Math.abs(s.latitude - env.site.latitude) > 1e-6) {
      env.site.latitude = s.latitude;
      this.vegDoyShift = s.latitude < 0 ? 182 : 0;
    }
    const prevDoy = env.state.doy;
    const { weather, snowCover, latitude, ...rest } = s;
    if (weather && WEATHER_PRESETS[weather]) env.setWeather(weather);
    env.setState(rest);
    if (snowCover !== undefined) env.snowCover = snowCover;
    if (env.state.doy !== prevDoy) this.world.veg.apply((env.state.doy + this.vegDoyShift) % 365);
    this._refreshLights();
  }

  /**
   * Light state per room: { [roomId]: { on, color?, brightness? } }. Rooms absent from the map are switched off.
   */
  setRoomLights(map) {
    if (!this.world) return;
    for (const l of this.world.lights) {
      const st = map[l.room];
      l.on = !!(st && st.on);
      if (st && st.on) {
        if (st.color) l.color = st.color;
        if (st.brightness !== undefined) l.brightness = st.brightness;
      }
    }
    this._refreshLights();
  }

  // ------------------------------------------------------------ views

  goToView(ref, instant = false) {
    const i = typeof ref === 'number' ? ref : this.views.findIndex((v) => v.name === ref);
    const v = this.views[i];
    if (!v) return;
    for (const lv of this.world.sd.levels) this.visibility.levels[lv.id] = v.levels[lv.id] !== false;
    this.visibility.roof = v.roof;
    this._refreshLights();
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), zoom: v.zoom };
    if (instant) {
      this.camera.position.copy(to.pos);
      this.controls.target.copy(to.target);
      this.camera.zoom = to.zoom;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.tween = null;
      return;
    }
    this.tween = {
      t: 0,
      dur: 0.9,
      from: { pos: this.camera.position.clone(), target: this.controls.target.clone(), zoom: this.camera.zoom },
      to,
    };
  }

  // ------------------------------------------------------------ picking

  _click(ev) {
    if (!this._down || !this.world || !this.opts.onRoomClick) return;
    if (Math.hypot(ev.clientX - this._down[0], ev.clientY - this._down[1]) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this.camera);
    const cand = this.world.floors.filter((f) => this.visibility.levels[f.level.id] !== false).map((f) => f.mesh);
    const hit = this._raycaster.intersectObjects(cand, false)[0];
    const f = hit && this.world.floors.find((x) => x.mesh === hit.object);
    if (f) this.opts.onRoomClick(f.room.id, ev);
  }

  // ------------------------------------------------------------ loop

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  _frame(now) {
    if (!this.running || this.disposed) return;
    requestAnimationFrame(this._frame);
    const minDt = this.opts.fpsCap ? 1000 / this.opts.fpsCap : 0;
    if (now - this._last < minDt - 1) return;
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    if (!this.world) return;
    const tw = this.tween;
    if (tw) {
      tw.t += dt / tw.dur;
      const k = Math.min(tw.t, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, e);
      this.camera.zoom = tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e;
      this.camera.updateProjectionMatrix();
      if (k >= 1) this.tween = null;
    }
    this.env.update(dt, this.camera, this.renderer.domElement.height);
    if (this.world.site.waterMat) this.world.site.waterMat.opacity = 0.76 + 0.03 * Math.sin(this.env.time * 1.3);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    this._ro.disconnect();
    if (this.world) this._disposeWorld(this.world);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
