// 3D engine of the card: one instance per card (several cards can show the same house).
// Pure rendering: it receives { scene, terrain, edits } plus live data (time, weather, lights) and knows nothing of HA.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { normalizeScene } from './engine/scene-model.js';
import { buildLevelWalls, buildFloor, buildRoof, buildSite } from './engine/geometry.js';
import {
  buildFurniture,
  buildBoxFurnitureMesh,
  buildFixture,
  catalogTreeFor,
  createVegetation,
  setCatalog,
  setClimate,
  SPECIES,
} from './engine/catalog.js';
import { normalizeEdits, outdoorEdit, isDsmRemoved } from './engine/edits.js';
import { LightSystem } from './engine/lighting.js';
import { Environment, WEATHER_PRESETS } from './engine/environment.js';
import { buildTerrain, treesFromDsm, gridToPlan } from './engine/terrain.js';
import { buildFence } from './fences.js';
import { buildIrrigation } from './irrigation.js';
import { buildRobot, buildDock } from './vacuum.js';
import { rectCorners, pickFurniture } from './zones.js';
import { OpeningsFx } from './engine/openings-3d.js';
import { buildPools } from './engine/pools-3d.js';
import { poolValid } from './pools.js';

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
export function terrainConfig(terrainData, edits, sd, ortho = null) {
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
    showRoads: r.showRoads ?? true,
    ortho: ortho && r.showPhoto !== false ? ortho : null,
  };
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class HouseEngine {
  /**
   * @param {HTMLElement} container
   * @param {{movable?: boolean, fpsCap?: number, onRoomClick?: (roomId: string, ev: PointerEvent) => void,
   *          onHover?: (info: object|null, ev: PointerEvent) => void}} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = { movable: true, fpsCap: 0, ...opts };
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
    this.picker = null; // editor click handler: takes over the clicks (and keeps the orbit controls usable)
    this.treeMode = 'off'; // 'delete' shows crown markers in the world
    this.layer = 'none'; // 'none' | 'temp'
    this.onLoaded = null; // called after every (re)build of the world
    this._hovered = null;
    this.setMovable(this.opts.movable);
    this.controls.addEventListener('start', () => (this.tween = null));
    this.focus = null; // room id the camera is zoomed on
    this.highlight = null;
    this.onFrame = null;
    this.irrigState = {}; // { [line or circuit id]: { on, since } }
    this.irrigOpts = {};
    this.roomFx = null; // { [roomId]: { color, mix, glow, blink } } (vacuum: room being cleaned, done, in error)
    this._robot = null;
    this._robotMap = null;
    this._zones = null; // clickable zones (media players, aquariums): see setZones
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
    this.running = false;
    this.disposed = false;
    this._last = 0;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._down = null;
    const el = this.renderer.domElement;
    // zones dragged on their surface in the editor: before the orbit controls (capture), which then stay still
    el.addEventListener('pointerdown', (ev) => this._zoneDown(ev), true);
    el.addEventListener('pointermove', (ev) => this._zoneMove(ev), true);
    el.addEventListener('pointerup', (ev) => this._zoneUp(ev), true);
    el.addEventListener('pointerdown', (ev) => (this._down = [ev.clientX, ev.clientY]));
    el.addEventListener('pointerup', (ev) => this._click(ev));
    el.addEventListener('pointermove', (ev) => this._hover(ev));
    el.addEventListener('pointerleave', (ev) => this._hover(ev, true));
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
      // kept lights (rebuild after an edit): their live state is carried over by id, new ones start off
      lights: sd.lights.map((l) => {
        const k = lightsOverride && lightsOverride.find((x) => x.id === l.id);
        return k ? { ...l, on: k.on, color: k.color, brightness: k.brightness } : { ...l };
      }),
      terrain: terr ? buildTerrain(terr.data, sd, { ...terr, ops: edits.terrain, pools: edits.pools }) : null,
      levelsById: {},
      roof: null,
      site: null,
      veg: null,
      surfaces,
      walls: [], // { mesh, level }: wall picking (wall-mounted labels) and label occlusion
      openings: new OpeningsFx(), // moving parts of the doors and windows
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
      for (const m of [walls.exterior, walls.interior]) if (m) w.walls.push({ mesh: m, level });

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

      for (const m of walls.metas) w.openings.register(m, g);
      for (const p of walls.panes) {
        if (p.kind === 'glass') {
          w.openings.glass(p.key, glassFor(p.room));
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
        } else w.openings.leaf(p.key);
      }
    }

    w.openings.set(this._openingStates);
    w.roof = buildRoof(sd.roof, roofMat, gableMat);
    if (w.roof) root.add(w.roof);

    sd.site.poolDy = edits.pool.dy;
    // pools and ponds drawn in the editor: dug in the terrain (rim height from it), or in the flat ground
    const pools = edits.pools || [];
    const digs = w.terrain
      ? w.terrain.digs
      : pools.filter((p) => poolValid(p) && p.frame === 'plan').map((p) => ({ id: p.id, poly: p.pts, rim: 0 }));
    sd.site.holes = w.terrain ? [] : digs.map((d) => d.poly);
    w.site = buildSite(sd.site, surfaces, w.terrain);
    root.add(w.site.group);
    w.pools = buildPools(digs.map((d) => ({ ...pools.find((p) => p.id === d.id), ...d })));
    w.pools.setRobots(this._poolRobots);
    root.add(w.pools.group);

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

    // garden objects anchored to the ground: stored in the terrain grid frame (or in the plan frame without terrain)
    const g2p = w.terrain && terr ? gridToPlan(terr.data, terr) : null;
    const ident = (x, z) => [x, z];
    w.anchor = (o) => (o.frame === 'plan' || !g2p ? ident : g2p);
    w.groundAt = w.terrain ? w.terrain.heightAt : () => 0;
    const fg = new THREE.Group();
    fg.name = 'fences';
    for (const f of edits.fences || []) if (!f.hidden && (f.frame === 'plan' || g2p)) fg.add(buildFence(f, w.anchor(f), w.groundAt));
    root.add(fg);

    // watering: drip lines and sprinklers (animated in _frame from the valve states)
    w.irrigation = buildIrrigation(edits.irrigation || {}, w.anchor, w.groundAt);
    root.add(w.irrigation.group);

    // docks of the robot vacuums (each robot its own; the single robot of the first versions in `vacuum`)
    const robots = edits.vacuums && edits.vacuums.length ? edits.vacuums : [edits.vacuum || {}];
    for (const vac of robots) {
      if (vac.hidden || !vac.dock || !vac.dock.at) continue;
      const dock = buildDock();
      dock.position.set(vac.dock.at[0], (vac.dock.base ?? 0) + 0.005, vac.dock.at[1]);
      dock.rotation.y = Math.PI / 2 - ((vac.dock.dir ?? 90) * Math.PI) / 180; // model front is +x; dir is a compass angle
      dock.scale.setScalar(vac.size || 1.4);
      (vac.dock.level && w.levelGroups[vac.dock.level] ? w.levelGroups[vac.dock.level] : root).add(dock);
    }

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
      // a plant of the plan named after a tree of the catalog ("Cerisier") is drawn as that tree
      ...sd.vegetation
        .map((p, i) => ({ ...p, species: catalogTreeFor(p.name) || p.species, _src: { kind: 'sd', idx: i } }))
        .filter((p) => SPECIES[p.species] && !edits.trees.removed.sd.includes(p._src.idx)),
      ...dsmTrees,
      ...edits.trees.added
        .filter((a) => SPECIES[a.species])
        .map((a, i) => ({ species: a.species, at: a.at, scale: a.h / SPECIES[a.species].height, _src: { kind: 'added', idx: i } })),
    ];
    w.veg = createVegetation(w.trees, surfaces);
    if (w.terrain) for (const g of w.veg.group.children) g.position.y = w.terrain.heightAt(g.position.x, g.position.z);
    root.add(w.veg.group);

    if (this.treeMode === 'delete') {
      // red markers on the crowns: click one to delete that tree
      const mk = new THREE.MeshBasicMaterial({ color: '#ff3b30', depthTest: false, transparent: true, opacity: 0.9 });
      const geo = new THREE.SphereGeometry(0.4, 10, 8);
      w.veg.group.children.forEach((g, i) => {
        const m = new THREE.Mesh(geo, mk);
        m.position.set(0, SPECIES[w.trees[i].species].height * 0.8, 0); // local frame: the tree group is scaled
        m.scale.setScalar(1 / g.scale.x);
        m.renderOrder = 999;
        m.userData.marker = true;
        g.add(m);
      });
    }

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
    // commit() passes the edits object back: keep it (the card and the editors hold a reference to it)
    const edits = data.edits && data.edits === this.edits ? this.edits : normalizeEdits(data.edits);
    this.edits = edits;
    const sd = normalizeScene(structuredClone(data.scene));
    if (edits.registration && Number.isFinite(edits.registration.northOffsetDeg))
      sd.site.northOffsetDeg = edits.registration.northOffsetDeg;
    // light entities placed on the plan become light sources of their own (position chosen in the editor)
    for (const e of edits.entities) {
      if (!e.at || !e.entity || !e.entity.startsWith('light.') || e.kind === 'off') continue;
      sd.lights.push({
        id: `ent:${e.id}`,
        entity: e.entity,
        name: e.label || e.entity,
        room: e.room || 'outdoor',
        level: e.level || null,
        kind: e.kind || 'spot',
        // wall mount: wall lamp at the clicked height, 30 cm inside the room; otherwise lightY above the floor
        pos: e.mount === 'wall' && e.wall ? [e.at[0], e.wall.p[1], e.at[1]] : [e.at[0], (e.base ?? 0) + (e.lightY ?? 2.3), e.at[1]],
        color: '#ffd9a0',
        brightness: 0.9,
        radius: e.radius || 4.5,
        on: false,
      });
    }
    const keptLights = opts.keepLights && this.world ? this.world.lights : null;
    const keptVis = opts.keepLights && this.world ? { roof: this.visibility.roof, levels: { ...this.visibility.levels } } : null;
    if (this.world) this._disposeWorld(this.world);
    this.tween = null;
    this.env.setSite(sd.site);
    setClimate(sd.site.latitude ?? 43.6);
    this.orthoData = data.ortho || null;
    const terr = terrainConfig(data.terrain, edits, sd, this._orthoTexture(this.orthoData));
    this.sceneData = data.scene;
    this.terrainData = data.terrain || null;
    this.terrainCfg = terr;
    this.world = this._buildWorld(sd, terr, edits, keptLights);
    for (const e of this.world.surfaces) this.env.registerSurface(e);
    this.env.applyState();
    this.world.veg.apply(this.env.state.doy);
    this.visibility.roof = true;
    this.visibility.levels = Object.fromEntries(sd.levels.map((l) => [l.id, true]));
    if (keptVis) Object.assign(this.visibility, keptVis);
    this.views = edits.views && edits.views.length ? edits.views : sd.views;
    if (!keptVis) this.layer = 'none';
    this._refreshLights();
    this.applyLayer();
    if (!keptVis) {
      this.focus = null;
      this.goToView(0, true);
    }
    if (this.onLoaded) this.onLoaded();
    return this;
  }

  /** Rebuild after an edit (edits object mutated in place): lights, visibility and camera are kept. */
  commit() {
    return this.load({ scene: this.sceneData, terrain: this.terrainData, ortho: this.orthoData, edits: this.edits }, { keepLights: true });
  }

  /**
   * Entries of the house catalog ({ trees: { id: descriptor }, objects: { id: descriptor } }, names in `lang`): the
   * trees become species to plant, and both are drawn where the plan names them. The view is drawn again with them.
   */
  setCatalog(catalog, lang = 'en') {
    setCatalog(catalog, lang);
    if (this.world && this.sceneData) this.commit();
  }

  /** Aerial photo document { bbox, lat, lon, north, mime, data (base64) } -> cached texture + its geo-reference. */
  _orthoTexture(doc) {
    if (!doc || !doc.data) return null;
    if (!this._ortho || this._ortho.doc !== doc) {
      if (this._ortho) this._ortho.texture.dispose();
      const tex = new THREE.TextureLoader().load(`data:${doc.mime || 'image/jpeg'};base64,${doc.data}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._ortho = { doc, texture: tex };
    }
    return { texture: this._ortho.texture, bbox: doc.bbox, lat: doc.lat, lon: doc.lon, north: doc.north || 0 };
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
   *          precipType?: string, wind?: number, windBearing?: number, temp?: number, snowCover?: number}} s
   *   wind: 0 (calm) .. 1 (60 km/h and more); windBearing: where it comes from, degrees clockwise from north
   */
  setLive(s) {
    if (!this.world) return;
    const env = this.env;
    if (s.latitude !== undefined && Math.abs(s.latitude - env.site.latitude) > 1e-6) {
      env.site.latitude = s.latitude;
      // the seasons of the vegetation and of the grass follow the climate of the latitude
      setClimate(s.latitude);
      this.world.veg.apply(env.state.doy);
    }
    const prevDoy = env.state.doy;
    const { weather, snowCover, latitude, ...rest } = s;
    if (weather && WEATHER_PRESETS[weather]) env.setWeather(weather);
    env.setState(rest);
    if (snowCover !== undefined) env.snowCover = snowCover;
    if (env.state.doy !== prevDoy) this.world.veg.apply(env.state.doy);
    this._refreshLights();
  }

  /**
   * Light state per room: { [roomId]: { on, color?, brightness? } }. Rooms absent from the map are switched off.
   */
  setRoomLights(map) {
    if (!this.world) return;
    for (const l of this.world.lights) {
      if (l.entity) continue; // placed light: driven by its own entity (setEntityLights)
      const st = map[l.room];
      l.on = !!(st && st.on);
      if (st && st.on) {
        if (st.color) l.color = st.color;
        if (st.brightness !== undefined) l.brightness = st.brightness;
      }
    }
    this._refreshLights();
  }

  /** Placed light entities: { [entityId]: { on, color?, brightness? } }. */
  setEntityLights(map) {
    if (!this.world) return;
    for (const l of this.world.lights) {
      if (!l.entity) continue;
      const st = map[l.entity];
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
    this.focus = null;
    this._beforeFocus = null;
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

  saveView(name) {
    const r = (n) => Math.round(n * 100) / 100;
    if (!this.edits.views.length) this.edits.views = this.views.map((v) => ({ ...v, levels: { ...v.levels } }));
    this.edits.views.push({
      name: name || `Vue ${this.edits.views.length + 1}`,
      pos: this.camera.position.toArray().map(r),
      target: this.controls.target.toArray().map(r),
      zoom: r(this.camera.zoom),
      levels: { ...this.visibility.levels },
      roof: this.visibility.roof,
    });
    this.views = this.edits.views;
    return this.views.length - 1;
  }

  deleteView(i) {
    if (!this.edits.views.length) this.edits.views = this.views.map((v) => ({ ...v, levels: { ...v.levels } }));
    this.edits.views.splice(i, 1);
    this.views = this.edits.views.length ? this.edits.views : this.world.sd.views;
  }

  // ------------------------------------------------------------ room focus

  _roomInfo(roomId) {
    for (const lv of this.world.sd.levels) {
      const r = lv.rooms.find((x) => x.id === roomId);
      if (r) return { room: r, level: lv };
    }
    return null;
  }

  /** Zoom on a room: hide the roof and the levels above it, keep the viewing direction. */
  focusRoom(roomId) {
    const info = this.world && this._roomInfo(roomId);
    if (!info) return false;
    if (!this.focus) {
      this._beforeFocus = {
        pos: this.camera.position.clone(),
        target: this.controls.target.clone(),
        zoom: this.camera.zoom,
        vis: { roof: this.visibility.roof, levels: { ...this.visibility.levels } },
      };
    }
    this.focus = roomId;
    const saved = this.edits.room_views && this.edits.room_views[roomId];
    if (saved) {
      // view chosen for this room in the editor
      for (const lv of this.world.sd.levels) this.visibility.levels[lv.id] = saved.levels[lv.id] !== false;
      this.visibility.roof = !!saved.roof;
      this._refreshLights();
      this._tweenTo({ pos: new THREE.Vector3(...saved.pos), target: new THREE.Vector3(...saved.target), zoom: saved.zoom });
      return true;
    }
    const xs = info.room.poly.map((p) => p[0]);
    const zs = info.room.poly.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);
    const target = new THREE.Vector3(
      (Math.max(...xs) + Math.min(...xs)) / 2,
      info.level.elevation + 0.5,
      (Math.max(...zs) + Math.min(...zs)) / 2,
    );
    for (const lv of this.world.sd.levels) this.visibility.levels[lv.id] = lv.elevation <= info.level.elevation;
    this.visibility.roof = false;
    this._refreshLights();
    const c = this.camera;
    const aspect = (c.right - c.left) / (c.top - c.bottom);
    const span = Math.max(w, d) * 1.25 + 1; // the room fills most of the view
    const zoom = Math.min(Math.max(Math.min(VIEW_H / span, (VIEW_H * aspect) / span), this.controls.minZoom), this.controls.maxZoom);
    const dir = c.position.clone().sub(this.controls.target);
    this._tweenTo({ pos: target.clone().add(dir), target, zoom });
    return true;
  }

  /** Store the current camera + visible levels as the view of a room (used by focusRoom). */
  saveRoomView(roomId) {
    const r = (n) => Math.round(n * 100) / 100;
    this.edits.room_views[roomId] = {
      pos: this.camera.position.toArray().map(r),
      target: this.controls.target.toArray().map(r),
      zoom: r(this.camera.zoom),
      levels: { ...this.visibility.levels },
      roof: this.visibility.roof,
    };
  }

  deleteRoomView(roomId) {
    delete this.edits.room_views[roomId];
  }

  unfocus() {
    const b = this._beforeFocus;
    this.focus = null;
    this._beforeFocus = null;
    if (!b || !this.world) return;
    Object.assign(this.visibility, { roof: b.vis.roof, levels: b.vis.levels });
    this._refreshLights();
    this._tweenTo({ pos: b.pos, target: b.target, zoom: b.zoom });
  }

  _tweenTo(to) {
    this.tween = {
      t: 0,
      dur: 0.8,
      from: { pos: this.camera.position.clone(), target: this.controls.target.clone(), zoom: this.camera.zoom },
      to,
    };
  }

  /** Rooms highlighted in blue (vacuum selection): Set of room ids. */
  setHighlight(ids) {
    this.highlight = ids;
    this.applyLayer();
  }

  // ------------------------------------------------------------ anchors (HTML overlays: placed sensors)

  /** Screen position (px, relative to the canvas) of a world point; null when outside the view. */
  project(x, y, z) {
    const v = this._pv || (this._pv = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null;
    const el = this.renderer.domElement;
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }

  /** Highest visible level id (the floor "seen from above" when the levels over it are hidden). */
  get topVisibleLevel() {
    if (!this.world) return null;
    const vis = this.world.sd.levels.filter((l) => this.visibility.levels[l.id] !== false);
    return vis.length ? vis.reduce((a, b) => (b.elevation > a.elevation ? b : a)).id : null;
  }

  /** Room of a level containing a plan point (null outside). */
  roomAt(levelId, x, z) {
    const lv = this.world.levelsById[levelId];
    const r = lv && lv.rooms.find((rm) => pointInPoly(x, z, rm.poly));
    return r ? r.id : null;
  }

  /**
   * Point under the pointer: { point, room, level, floorY, normal? }. With `wall`, the walls of the visible levels are
   * tried first (normal = horizontal [nx, nz] of the wall face, turned towards the camera); then room floors, then the ground.
   */
  pickPoint(ev, wall = false) {
    const ray = this.rayAt(ev);
    if (wall) {
      const cand = this.world.walls.filter((x) => this.visibility.levels[x.level.id] !== false);
      const wh = ray.intersectObjects(
        cand.map((x) => x.mesh),
        false,
      )[0];
      if (wh && wh.face) {
        const n = wh.face.normal.clone().transformDirection(wh.object.matrixWorld);
        n.y = 0;
        if (n.lengthSq() > 1e-6) {
          n.normalize();
          if (n.dot(ray.ray.direction) > 0) n.negate(); // the face seen by the camera
          const lv = cand.find((x) => x.mesh === wh.object).level;
          const inside = [wh.point.x + n.x * 0.3, wh.point.z + n.z * 0.3];
          return {
            point: wh.point,
            normal: [n.x, n.z],
            level: lv.id,
            room: this.roomAt(lv.id, ...inside),
            floorY: lv.elevation,
            mesh: wh.object,
          };
        }
      }
    }
    const cand = this.world.floors.filter((f) => this.visibility.levels[f.level.id] !== false).map((f) => f.mesh);
    const hit = ray.intersectObjects(cand, false)[0];
    if (hit) {
      const f = this.world.floors.find((x) => x.mesh === hit.object);
      return { point: hit.point, room: f.room.id, level: f.level.id, floorY: hit.point.y, mesh: hit.object };
    }
    let p = null;
    if (this.world.terrain) {
      const th = ray.intersectObject(this.world.terrain.ground, false)[0];
      if (th) p = th.point;
    }
    if (!p) {
      p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    }
    return { point: p, room: null, level: null, floorY: p.y };
  }

  /**
   * Screen position of a label anchored at `pos` ([x, y, z]), or null when hidden: outside the view, on a wall seen
   * from behind (`normal` [nx, nz]), or behind a wall / roof / upper floor. Occlusion is recomputed only when the
   * camera or the visible levels change.
   */
  anchorScreen(id, pos, normal = null, levelId = null) {
    const c = this.camera;
    const dir = this._dir || (this._dir = new THREE.Vector3());
    c.getWorldDirection(dir);
    if (normal && normal[0] * dir.x + normal[1] * dir.z > -0.05) return null; // back of the wall
    const scr = this.project(pos[0], pos[1], pos[2]);
    if (!scr) return null;
    const sig = `${c.matrixWorld.elements.map((v) => v.toFixed(3)).join(',')}|${c.zoom.toFixed(3)}|${this._visSig()}`;
    // at most ~7 refreshes per second while the camera moves (raycasts against the walls are not free)
    const now = performance.now();
    if (!this._occ || (sig !== this._occSig && now - (this._occT || 0) > 150)) {
      this._occSig = sig;
      this._occT = now;
      this._occ = new Map();
    }
    const k = `${id}|${pos.map((v) => v.toFixed(2)).join(',')}`;
    if (!this._occ.has(k)) this._occ.set(k, this._occluded(pos, levelId));
    return this._occ.get(k) ? null : scr;
  }

  _visSig() {
    const v = this.visibility;
    return `${v.roof}${Object.values(v.levels).join('')}${this.world ? this.world.root.uuid : ''}`;
  }

  /**
   * Hidden by the house? Inside the house only what is ABOVE the label's level hides it (upper floors, their walls,
   * the roof): the walls of its own level would hide most floor labels in a cut-away view. Outside, every wall counts.
   */
  _occluded(pos, levelId = null) {
    const w = this.world;
    const p = new THREE.Vector3(...pos);
    const v = p.clone().project(this.camera);
    const ray = this._raycaster;
    this._ndc.set(v.x, v.y);
    ray.setFromCamera(this._ndc, this.camera);
    const dist = ray.ray.origin.distanceTo(p);
    const own = levelId ? w.levelsById[levelId] : null;
    const vis = (lv) => this.visibility.levels[lv.id] !== false && (!own || lv.elevation > own.elevation + 0.01);
    const occ = [
      ...w.walls.filter((x) => vis(x.level)).map((x) => x.mesh),
      ...w.floors.filter((f) => vis(f.level)).map((f) => f.mesh),
      ...(w.roof && this.visibility.roof ? [w.roof] : []),
    ];
    const hit = ray.intersectObjects(occ, true).find((h) => h.distance < dist - 0.12);
    return !!hit;
  }

  // ------------------------------------------------------------ display options

  setMovable(on) {
    this.movable = !!on;
    this._updateControls();
  }

  _updateControls() {
    this.controls.enabled = this.movable || !!this.picker;
  }

  setLevel(id, on) {
    this.visibility.levels[id] = on;
    this._applyVisibility();
  }

  setRoof(on) {
    this.visibility.roof = on;
    this._applyVisibility();
  }

  setLayer(l) {
    this.layer = l;
    this.applyLayer();
  }

  /** Temperatures per room id (from HA area sensors), used by the 'temp' layer. */
  setRoomTemps(map) {
    if (!this.world) return;
    for (const lv of this.world.sd.levels) for (const r of lv.rooms) r.temp = map[r.id] ?? null;
    this.applyLayer();
  }

  get hasTemps() {
    return !!this.world && this.world.sd.levels.some((lv) => lv.rooms.some((r) => r.temp != null));
  }

  applyLayer() {
    if (!this.world) return;
    const cold = new THREE.Color('#4a90e2');
    const mid = new THREE.Color('#7bd88f');
    const hot = new THREE.Color('#f2994a');
    for (const f of this.world.floors) {
      const base = new THREE.Color(f.room.floor);
      if (this.highlight && this.highlight.has(f.room.id)) base.lerp(new THREE.Color('#2f80ed'), 0.75);
      else if (this.layer === 'temp' && f.room.temp != null) {
        const t = Math.min(Math.max((f.room.temp - 16) / 8, 0), 1);
        const c = t < 0.5 ? cold.clone().lerp(mid, t * 2) : mid.clone().lerp(hot, (t - 0.5) * 2);
        base.lerp(c, 0.8);
      }
      const fx = this.roomFx && this.roomFx[f.room.id];
      if (fx && fx.mix) base.lerp(new THREE.Color(fx.color), fx.mix);
      f.mesh.material.color.copy(base);
    }
  }

  // ------------------------------------------------------------ watering / robot vacuum

  /** Valve states of the drip lines and sprinkler circuits; opts: { soil, editing }. */
  setIrrigation(states, opts = {}) {
    this.irrigState = states || {};
    this.irrigOpts = opts;
  }

  /**
   * Per-room effects: { [roomId]: { color, mix (0..1 tint), glow (0..1 shimmer), blink (red alarm) } }; null to clear.
   * `key`: who sets them (each robot its own); the rooms show all of them.
   */
  setRoomFx(fx, key = '') {
    this._fxBy = this._fxBy || new Map();
    if (fx && Object.keys(fx).length) this._fxBy.set(key, fx);
    else this._fxBy.delete(key);
    const all = Object.assign({}, ...this._fxBy.values());
    this.roomFx = Object.keys(all).length ? all : null;
    this._fxDirty = true;
    this.applyLayer();
  }

  /**
   * The robot `key` (its vacuum entity): an object with the robot methods of the engine (setRobot, robotPos,
   * setTrail, setRobotMap, setRoomFx) acting on its own robot, trail and map; everything else is the engine's.
   */
  robotSlot(key) {
    this._slots = this._slots || new Map();
    let s = this._slots.get(key);
    if (!s) {
      s = Object.create(this);
      s._robot = null;
      s._trail = null;
      s._robotMap = null;
      s.setRoomFx = (fx) => this.setRoomFx(fx, key);
      this._slots.set(key, s);
    }
    return s;
  }

  /** A robot gone (no longer shown): its robot, trail, map and room effects are removed. */
  dropRobotSlot(key) {
    const s = this._slots && this._slots.get(key);
    if (!s) return;
    if (s._robot) this.scene.remove(s._robot.g);
    s.setTrail(null);
    s.setRobotMap(null);
    s.setRoomFx(null);
    this._slots.delete(key);
  }

  _animateFx(t) {
    for (const f of this.world.floors) {
      const fx = this.roomFx && this.roomFx[f.room.id];
      const e = f.mesh.material.emissive;
      if (fx && fx.blink) e.set('#ff2a1f').multiplyScalar(Math.sin(t * 7) > 0 ? 0.75 : 0.08);
      else if (fx && fx.glow) e.set('#fff2b0').multiplyScalar(fx.glow * (0.3 + 0.22 * Math.sin(t * 5 + f.mesh.id)));
      else if (f._fx) e.setScalar(this._hovered === f ? 0.12 : 0);
      f._fx = !!(fx && (fx.blink || fx.glow));
    }
    this._fxDirty = !!this.roomFx; // one more pass after the effects are cleared, to reset the floors
  }

  /**
   * Robot vacuum. null removes it; otherwise { x, z, y (floor), level, color, size, error, period, snap, heading }
   * (heading: compass direction faced once arrived, e.g. on the dock).
   * The robot glides to each new position in about `period` seconds (time between two known positions).
   */
  setRobot(r) {
    if (!r) {
      if (this._robot) this._robot.g.visible = false;
      if (this._robot) this._robot.state = null;
      return;
    }
    let R = this._robot;
    if (!R || R.color !== r.color) {
      if (R) this.scene.remove(R.g);
      R = this._robot = { g: buildRobot(r.color), color: r.color, target: new THREE.Vector3(), heading: 0, placed: false, speed: 0.3 };
      this.scene.add(R.g);
    }
    R.state = r;
    R.g.scale.setScalar(r.size || 1.4);
    R.target.set(r.x, r.y + 0.005, r.z);
    const d = R.g.position.distanceTo(R.target);
    if (r.snap || !R.placed || d > 12) {
      R.g.position.copy(R.target);
      R.placed = true;
    } else R.speed = Math.min(Math.max(d / Math.max((r.period || 1) * 0.9, 0.2), 0.05), 4);
  }

  /** Current (animated) position of the robot, or null. */
  get robotPos() {
    return this._robot && this._robot.state ? this._robot.g.position : null;
  }

  /** Path already cleaned: [[x, z], ...] at floor height y; null removes it. */
  setTrail(pts, y = 0, color = '#2f80ed', level = null) {
    if (this._trail) {
      this.scene.remove(this._trail);
      this._trail.geometry.dispose();
      this._trail = null;
    }
    if (!pts || pts.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, y + 0.03, z)));
    this._trail = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65 }));
    this._trail.userData.level = level;
    this.scene.add(this._trail);
  }

  /**
   * Picture of the robot's own map laid on a floor, to line it up with the plan (settings of the vacuum):
   * { image, corners: [[x, z] x 4] for its top-left, top-right, bottom-right and bottom-left pixels, y, level,
   * opacity }, or null to remove it.
   */
  setRobotMap(m) {
    let M = this._robotMap;
    if (M && (!m || M.image !== m.image)) {
      this.scene.remove(M.mesh);
      M.mesh.geometry.dispose();
      M.mesh.material.map.dispose();
      M.mesh.material.dispose();
      M = this._robotMap = null;
    }
    if (!m) return;
    if (!M) {
      const tex = new THREE.Texture(m.image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
      geo.setIndex([0, 3, 2, 0, 2, 1]);
      // seen from both sides: a mirrored map turns its triangles over
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      M = this._robotMap = { image: m.image, mesh: new THREE.Mesh(geo, mat) };
      M.mesh.name = 'robot-map';
      M.mesh.renderOrder = 5;
      M.mesh.raycast = () => {}; // taps go through it, to the floor
      this.scene.add(M.mesh);
    }
    const pos = M.mesh.geometry.attributes.position;
    m.corners.forEach(([x, z], i) => pos.setXYZ(i, x, (m.y || 0) + 0.04, z));
    pos.needsUpdate = true;
    M.mesh.geometry.computeBoundingSphere();
    M.mesh.material.opacity = m.opacity ?? 0.6;
    M.mesh.userData.level = m.level || null;
  }

  // ------------------------------------------------------------ clickable zones

  /**
   * Zones a tap opens (media players, aquariums): `list` of zones (see zones.js). Drawn only while editing
   * (`show`), in the colour of their kind, the selected one brighter; otherwise invisible but still tapped.
   */
  setZones(list, { show = false, sel = null } = {}) {
    if (this._zones) {
      this.scene.remove(this._zones);
      this._zones.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const g = (this._zones = new THREE.Group());
    g.name = 'zones';
    for (const z of list || []) {
      let geo = null;
      if (z.shape === 'box' && z.box) {
        const [w, h, d] = z.box.size;
        // a hair larger than the piece, so that it is tapped (and drawn) over it
        geo = new THREE.BoxGeometry(w + 0.04, h + 0.04, d + 0.04);
        geo.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation(z.box.at[0], z.box.y0 + h / 2, z.box.at[1])
            .multiply(new THREE.Matrix4().makeRotationY(-(z.box.rot || 0))),
        );
      } else if (z.rect) {
        const c = rectCorners(z.rect);
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.flat()), 3));
        geo.setIndex([0, 3, 2, 0, 2, 1]);
      }
      if (!geo) continue;
      const color = z.kind === 'aquarium' ? '#29d3e8' : '#b47cff';
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: z.id === sel ? 0.55 : 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
        visible: show,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 6;
      mesh.userData = { zone: z.id, level: z.level || null };
      g.add(mesh);
    }
    this.scene.add(g);
    this._applyZoneLevels();
  }

  _applyZoneLevels() {
    if (!this._zones) return;
    for (const m of this._zones.children) m.visible = !m.userData.level || this.visibility.levels[m.userData.level] !== false;
  }

  /**
   * Surface a click is about to use, lit in yellow: { hit } of pickPoint (the face of the wall, or the floor of the
   * room), { box } (a piece of furniture), plus `rect` (rectangle of the zone, drawn on it); null to remove it.
   */
  setTarget(spec) {
    const old = this._hl;
    if (old) {
      this.scene.remove(old);
      old.traverse((o) => {
        if (o.geometry && !o.userData.shared) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this._hl = null;
    }
    if (!spec) return;
    const g = (this._hl = new THREE.Group());
    g.name = 'highlight';
    const mat = (color, opacity) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const hit = spec.hit;
    if (hit && hit.mesh) {
      let surface = null;
      if (hit.normal) {
        const geo = this._wallFace(hit);
        if (geo) surface = new THREE.Mesh(geo, mat('#ffe14d', 0.55));
      } else {
        // the floor of the room: its own geometry, shared (not disposed here)
        surface = new THREE.Mesh(hit.mesh.geometry, mat('#ffe14d', 0.45));
        surface.matrixAutoUpdate = false;
        surface.matrix.copy(hit.mesh.matrixWorld);
        surface.userData.shared = true;
      }
      if (surface) {
        surface.renderOrder = 7;
        g.add(surface);
      }
    }
    if (spec.box) {
      const [w, h, d] = spec.box.size;
      const geo = new THREE.BoxGeometry(w + 0.06, h + 0.06, d + 0.06);
      geo.applyMatrix4(
        new THREE.Matrix4()
          .makeTranslation(spec.box.at[0], spec.box.y0 + h / 2, spec.box.at[1])
          .multiply(new THREE.Matrix4().makeRotationY(-(spec.box.rot || 0))),
      );
      const m = new THREE.Mesh(geo, mat('#ffe14d', 0.45));
      m.renderOrder = 7;
      g.add(m);
    }
    if (spec.rect) {
      const c = rectCorners(spec.rect);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(c.flat()), 3));
      geo.setIndex([0, 3, 2, 0, 2, 1]);
      const m = new THREE.Mesh(geo, mat(spec.color || '#29d3e8', 0.6));
      m.renderOrder = 8;
      g.add(m);
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(c.map((p) => new THREE.Vector3(...p))),
        new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false }),
      );
      edge.renderOrder = 9;
      g.add(edge);
    }
    this.scene.add(g);
  }

  /** Triangles of a wall mesh in the plane of the face hit, near the hit: the face of that wall (kept for reuse). */
  _wallFace(hit) {
    const mesh = hit.mesh;
    const n = new THREE.Vector3(hit.normal[0], 0, hit.normal[1]);
    const d = n.dot(hit.point);
    const key = `${mesh.uuid}|${n.x.toFixed(3)},${n.z.toFixed(3)}|${d.toFixed(2)}`;
    this._faces = this._faces || new Map();
    if (this._faces.has(key)) return this._faces.get(key).clone();
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    const m = mesh.matrixWorld;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const out = [];
    const at = (i, v) => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
    const tn = new THREE.Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      at(i, a);
      at(i + 1, b);
      at(i + 2, c);
      tn.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
      if (tn.lengthSq() < 1e-10) continue;
      tn.normalize();
      if (Math.abs(Math.abs(tn.dot(n)) - 1) > 1e-3) continue; // not parallel to the face
      if (Math.abs(n.dot(a) - d) > 0.01) continue; // another plane
      // the same plane can run through the whole house: keep what is around the hit
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      if (Math.hypot(cx - hit.point.x, cz - hit.point.z) > 8) continue;
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    if (!out.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    if (this._faces.size > 50) this._faces.clear();
    this._faces.set(key, geo);
    return geo.clone();
  }

  _zoneDown(ev) {
    if (!this.zoneDrag || this.picker || ev.button !== 0 || !this.world) return;
    const id = this.pickZone(ev);
    const plane = id && this.zoneDrag.start(id);
    if (!plane) return;
    const P = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...plane.normal), new THREE.Vector3(...plane.point));
    const hit = this.rayAt(ev).ray.intersectPlane(P, new THREE.Vector3());
    if (!hit) return;
    this._zd = { id, plane: P, offset: new THREE.Vector3(...plane.point).sub(hit) };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(ev.pointerId);
    ev.stopImmediatePropagation();
  }

  _zoneMove(ev) {
    if (!this._zd) return;
    ev.stopImmediatePropagation();
    const hit = this.rayAt(ev).ray.intersectPlane(this._zd.plane, new THREE.Vector3());
    if (hit) this.zoneDrag.move(this._zd.id, hit.add(this._zd.offset).toArray());
  }

  _zoneUp(ev) {
    if (!this._zd) return;
    ev.stopImmediatePropagation();
    const { id } = this._zd;
    this._zd = null;
    this._down = null; // not a click
    this._updateControls();
    this.zoneDrag.end(id);
  }

  /** Doors and windows: { openingKey: { open: 0..1, shutter: closed fraction or null } }; they move to it. */
  setOpenings(map) {
    this._openingStates = map || null;
    if (this.world) this.world.openings.set(this._openingStates);
  }

  /** Cleaning robots of the drawn pools: { poolId: running }. */
  setPoolRobots(map) {
    this._poolRobots = map || null;
    if (this.world) this.world.pools.setRobots(this._poolRobots);
  }

  /** Key of the door or window under the pointer (not behind a wall), or null. */
  pickOpening(ev) {
    if (!this.world) return null;
    const rc = this.rayAt(ev);
    const shown = (lv) => this.visibility.levels[lv] !== false;
    const wall = rc.intersectObjects(
      this.world.walls.filter((x) => shown(x.level.id)).map((x) => x.mesh),
      false,
    )[0];
    return this.world.openings.pick(rc.ray, shown, wall ? wall.distance + 0.4 : Infinity);
  }

  /** Lit frame around an opening (editor), null to remove it. */
  setOpeningTarget(key) {
    if (this._opHl) {
      this._opHl.parent.remove(this._opHl);
      this._opHl.geometry.dispose();
      this._opHl.material.dispose();
      this._opHl = null;
    }
    const it = key && this.world && this.world.openings.items.get(key);
    if (!it) return;
    const m = it.meta;
    const geo = new THREE.BoxGeometry(m.width + 0.08, m.height + 0.08, m.thickness + 0.1);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    mesh.position.set(...m.center);
    mesh.rotation.y = m.rotY;
    mesh.renderOrder = 8;
    it.group.add(mesh);
    this._opHl = mesh;
  }

  /** Id of the zone under the pointer, or null. */
  pickZone(ev) {
    if (!this._zones || !this._zones.children.length) return null;
    const hit = this.rayAt(ev).intersectObjects(
      this._zones.children.filter((m) => m.visible),
      false,
    )[0];
    return hit ? hit.object.userData.zone : null;
  }

  /** Piece of furniture of a visible level under the pointer: { item, box, level } or null. */
  pickFurnitureAt(ev) {
    if (!this.world) return null;
    const ray = this.rayAt(ev).ray;
    const items = this.world.sd.furniture
      .filter((f) => f.kind === 'box' && this.visibility.levels[f.level] !== false && this.world.levelsById[f.level])
      .map((item) => ({ item, base: this.world.levelsById[item.level].elevation }));
    const p = pickFurniture(ray.origin.toArray(), ray.direction.toArray(), items);
    return p ? { item: p.item, box: p.box, level: p.item.level } : null;
  }

  /** Screen position of a point even outside of the view (a corner of a picture partly off screen); null behind the camera. */
  projectAny(x, y, z) {
    const v = this._pa || (this._pa = new THREE.Vector3());
    v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.camera.isPerspectiveCamera && v.z > -this.camera.near) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    const el = this.renderer.domElement;
    return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight];
  }

  _turnRobot(to, dt) {
    const R = this._robot;
    const da = Math.atan2(Math.sin(to - R.heading), Math.cos(to - R.heading));
    R.heading += da * Math.min(1, dt * 5);
    R.g.rotation.y = R.heading;
  }

  _animateRobot(dt, t) {
    const R = this._robot;
    const shown = (lv) => !lv || this.visibility.levels[lv] !== false;
    if (this._trail) this._trail.visible = shown(this._trail.userData.level);
    if (this._robotMap) this._robotMap.mesh.visible = shown(this._robotMap.mesh.userData.level);
    this._applyZoneLevels();
    if (!R || !R.state) return;
    const g = R.g;
    g.visible = shown(R.state.level);
    const dx = R.target.x - g.position.x;
    const dz = R.target.z - g.position.z;
    const L = Math.hypot(dx, dz);
    if (L > 0.004) {
      const step = Math.min(L, R.speed * dt);
      g.position.x += (dx / L) * step;
      g.position.z += (dz / L) * step;
      if (L > 0.05) this._turnRobot(Math.atan2(-dz, dx), dt);
    } else if (Number.isFinite(R.state.heading)) this._turnRobot(Math.PI / 2 - (R.state.heading * Math.PI) / 180, dt); // at rest: asked direction
    g.position.y = R.target.y;
    const em = g.userData.body.emissive;
    if (R.state.error) em.set('#ff2a1f').multiplyScalar(Math.sin(t * 7) > 0 ? 0.9 : 0.1);
    else em.setScalar(0);
  }

  // ------------------------------------------------------------ picking

  /** Install (or remove with null) an editor click handler; it receives the pointer event and this engine. */
  setPicker(fn, cursor = 'crosshair') {
    this.picker = fn;
    this.renderer.domElement.style.cursor = fn ? cursor : '';
    this._updateControls();
  }

  /** Raycaster through a pointer event. */
  rayAt(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this.camera);
    return this._raycaster;
  }

  _pickRoom(ev) {
    const cand = this.world.floors.filter((f) => this.visibility.levels[f.level.id] !== false).map((f) => f.mesh);
    const hit = this.rayAt(ev).intersectObjects(cand, false)[0];
    return hit ? this.world.floors.find((f) => f.mesh === hit.object) : null;
  }

  _hover(ev, leave = false) {
    if (!this.world) return;
    if (this.picker && this.pickerMove) this.pickerMove(leave ? null : ev); // the tool of the editor shows its target
    if (!this.picker) this.renderer.domElement.style.cursor = !leave && !ev.buttons && this.pickZone(ev) ? 'pointer' : '';
    const f = leave || ev.buttons || this.picker ? null : this._pickRoom(ev);
    if (this._hovered && (!f || f.mesh !== this._hovered.mesh)) this._hovered.mesh.material.emissive.setScalar(0);
    if (f === this._hovered) return;
    this._hovered = f;
    if (f) f.mesh.material.emissive.setScalar(0.12);
    if (this.opts.onHover)
      this.opts.onHover(f ? { room: f.room, lights: this.world.lights.filter((l) => l.room === f.room.id) } : null, ev);
  }

  _click(ev) {
    if (!this._down || !this.world) return;
    if (Math.hypot(ev.clientX - this._down[0], ev.clientY - this._down[1]) > 4) return;
    if (this.picker) return this.picker(ev, this);
    const zone = this.opts.onZoneClick ? this.pickZone(ev) : null;
    if (zone) return this.opts.onZoneClick(zone, ev);
    if (!this.opts.onRoomClick) return;
    const f = this._pickRoom(ev);
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
    const realDt = Math.min((now - this._last) / 1000, 1.5); // the robot keeps its real speed on a slow display
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    if (!this.world) return;
    const tw = this.tween;
    if (tw) {
      tw.t += Math.min(realDt, 0.3) / tw.dur; // real time: a camera move does not drag on a slow display
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
    if (this.world.irrigation.count) this.world.irrigation.update(this.irrigState, Date.now(), this.irrigOpts);
    if (this.roomFx || this._fxDirty) this._animateFx(now / 1000);
    if (this.world.openings.busy) this.world.openings.tick(realDt);
    if (this.world.pools.items.length) this.world.pools.tick(realDt, now / 1000);
    this._animateRobot(realDt, now / 1000);
    if (this._slots) for (const s of this._slots.values()) this._animateRobot.call(s, realDt, now / 1000);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame();
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
