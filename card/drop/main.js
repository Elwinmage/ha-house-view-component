// House View: the demo house falls on the demo terrain, bounces and settles on its place (no text, no button).
// The scene is drawn by the real engine of the card; only the fall is added here.
// Options (query string): ?autoplay=0 waits for a click | ?hour=14&doy=112 (default: end of April) | ?weather=clear|rain|snow...
// A click (or the R key) plays it again.
import * as THREE from 'three';
import { HouseEngine } from '../src/engine.js';
import { importSh3d } from '../src/engine/sh3d-import.js';
import { normalizeScene } from '../src/engine/scene-model.js';
import { irrigationStates } from '../src/irrigation.js';
import terrain from '../../custom_components/house_view/demo/demo-terrain.json';
import edits from '../../custom_components/house_view/demo/demo-edits.json';
import houseBase64 from '../../custom_components/house_view/demo/demo-maison.sh3d';
import catalog from 'virtual:catalog';

const Q = new URLSearchParams(location.search);
const FALL_FROM = 46; // m above its place (out of the picture at the start)
const GRAVITY = 32; // m/s2: a little more than the real one, for a lively fall
const RESTITUTION = 0.36; // share of the speed kept at each bounce
const START_DELAY = 0.8; // s of empty terrain before the fall
const DUST_COLOR = '#d9cfba';

const bytes = Uint8Array.from(atob(houseBase64), (c) => c.charCodeAt(0));
const { scene } = await importSh3d({ name: 'demo-maison.sh3d', arrayBuffer: async () => bytes.buffer });

// the fetch of the demo centres the terrain on the plan, as the integration does
const sd = normalizeScene(structuredClone(scene));
const b = sd.bbox;
const center = [Math.round(((b.x0 + b.x1) / 2) * 100) / 100, Math.round(((b.z0 + b.z1) / 2) * 100) / 100];
const ground = { ...terrain, center };

// the garden of the plan: the trees named after the catalog (cherry, apricot) are plants, not furniture boxes; what is left
// outside goes to a level of its own, so that it stays on the terrain while the house falls
const outside = (f) => f.at && (f.at[0] < b.x0 || f.at[0] > b.x1 || f.at[1] < b.z0 || f.at[1] > b.z1);
const TREES = /cerisier|abricotier|pommier|poirier/i;
for (const f of scene.furniture.filter((x) => outside(x) && TREES.test(x.name))) {
  scene.vegetation.push({ name: f.name, species: 'oak', at: [f.at[0], f.at[1]], height: f.size[1] });
}
scene.furniture = scene.furniture.filter((x) => !(outside(x) && TREES.test(x.name)));
if (scene.furniture.some(outside)) {
  scene.levels.push({ id: 'garden', name: 'Jardin', elevation: 0, floorThickness: 0.12, height: 2.6, rooms: [], walls: [] });
  for (const f of scene.furniture) if (outside(f)) f.level = 'garden';
}

document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
const holder = document.createElement('div');
holder.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(holder);

const eng = new HouseEngine(holder, { movable: false });
eng.setCatalog(catalog, 'fr');
eng.load({ scene, terrain: ground, ortho: null, edits });
eng.setLive({ doy: +(Q.get('doy') ?? 112), hour: +(Q.get('hour') ?? 14), weather: Q.get('weather') || 'clear', latitude: 45 });
eng.start();

// the sprinklers and the drip lines are open and the pool robot runs (the valves and the robot are "on")
function switchOn() {
  const irr = eng.edits.irrigation;
  const now = Date.now();
  const on = Object.fromEntries([...(irr.lines || []), ...(irr.circuits || [])].map((o) => [o.entity, { state: 'on', last_changed: new Date(now).toISOString() }]));
  eng.setIrrigation(irrigationStates(irr, on, null, now), { soil: irr.soil });
  eng.setPoolRobots(Object.fromEntries(eng.edits.pools.filter((p) => p.robot).map((p) => [p.id, true])));
}
switchOn();

// ------------------------------------------------------------ the house: levels and roof, in a group that falls
const world = eng.world;
const [cx, cz] = center;
const faller = new THREE.Group(); // pivot at the foot of the house: the squash happens on the ground
const inner = new THREE.Group();
faller.position.set(cx, 0, cz);
inner.position.set(-cx, 0, -cz);
faller.add(inner);
world.root.add(faller);
for (const g of [...Object.values(world.levelGroups), world.roof]) if (g) inner.add(g);

const footprint = { w: b.x1 - b.x0, d: b.z1 - b.z0 };
const floorY = world.groundAt ? world.groundAt(cx, cz) : 0;

// ------------------------------------------------------------ dust raised at each impact
const puffGeo = new THREE.IcosahedronGeometry(1, 1);
const puffs = [];
function raiseDust(strength) {
  const n = Math.round(14 + 22 * strength);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    // start on the edge of the footprint (an ellipse), leave outwards
    const rx = footprint.w / 2;
    const rz = footprint.d / 2;
    const mat = new THREE.MeshBasicMaterial({ color: DUST_COLOR, transparent: true, opacity: 0.55 * (0.5 + strength / 2), depthWrite: false });
    const m = new THREE.Mesh(puffGeo, mat);
    m.position.set(cx + Math.cos(a) * rx, floorY + 0.25, cz + Math.sin(a) * rz);
    m.renderOrder = 20;
    const speed = (1.5 + Math.random() * 2.5) * (0.5 + strength);
    puffs.push({
      m,
      v: new THREE.Vector3(Math.cos(a) * speed, 0.5 + Math.random() * 1.2, Math.sin(a) * speed),
      o0: mat.opacity,
      r0: 0.35 + Math.random() * 0.4,
      life: 0,
      ttl: 0.9 + Math.random() * 0.6,
    });
    world.root.add(m);
  }
}
function stepDust(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt;
    const k = p.life / p.ttl;
    if (k >= 1) {
      world.root.remove(p.m);
      p.m.material.dispose();
      puffs.splice(i, 1);
      continue;
    }
    p.m.position.addScaledVector(p.v, dt);
    p.v.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
    p.m.scale.setScalar(p.r0 * (1 + 2.6 * k));
    p.m.material.opacity = p.o0 * (1 - k) * (1 - k);
  }
}

// ------------------------------------------------------------ the fall
const base = eng.controls.target.clone();
let sim = null;

function reset() {
  eng.world.irrigation.reset(); // the ground dries, the watering starts again
  switchOn();
  for (const p of puffs.splice(0)) {
    world.root.remove(p.m);
    p.m.material.dispose();
  }
  sim = { t0: performance.now() / 1000 + START_DELAY, last: null, y: FALL_FROM, v: 0, squash: 0, shake: 0, done: false };
  faller.position.y = FALL_FROM;
  faller.scale.set(1, 1, 1);
  faller.visible = true;
}

const SUB = 1 / 240; // physics step: the fall lasts the same time on a slow display

function physics(dt, t) {
  if (!sim.done) {
    sim.v -= GRAVITY * dt;
    sim.y += sim.v * dt;
    if (sim.y <= 0) {
      const impact = -sim.v;
      sim.y = 0;
      sim.v = impact * RESTITUTION;
      const strength = Math.min(1, impact / 50);
      sim.squash = Math.max(sim.squash, 0.075 * strength);
      sim.shake = Math.max(sim.shake, 0.5 * strength);
      raiseDust(strength);
      if (sim.v < 2.2) {
        // too weak to bounce again: it stays at its place
        sim.v = 0;
        sim.done = true;
      }
    }
  }
  // squash and stretch, then the camera shakes a little and calms down
  sim.squash *= Math.exp(-9 * dt);
  sim.shake *= Math.exp(-6 * dt);
}

function step(now) {
  const t = now / 1000;
  const dust = Math.min(0.1, t - (step.t || t));
  step.t = t;
  stepDust(dust);
  if (!sim || t < sim.t0) return;
  sim.acc = (sim.acc || 0) + Math.min(0.25, t - (sim.last ?? t));
  sim.last = t;
  while (sim.acc >= SUB) {
    physics(SUB, t);
    sim.acc -= SUB;
  }
  faller.position.y = sim.y;
  const stretch = sim.done ? 0 : Math.min(0.02, Math.abs(sim.v) / 2500);
  faller.scale.set(1 + sim.squash * 0.5 - stretch * 0.5, 1 - sim.squash + stretch, 1 + sim.squash * 0.5 - stretch * 0.5);
  eng.controls.target.set(
    base.x + Math.sin(t * 61) * sim.shake * 0.12,
    base.y + Math.sin(t * 73 + 1) * sim.shake * 0.18,
    base.z + Math.sin(t * 47 + 2) * sim.shake * 0.12,
  );
  if (sim.done && sim.squash < 1e-4 && sim.shake < 1e-3) {
    // settled: exactly where the plan puts it
    faller.position.y = 0;
    faller.scale.set(1, 1, 1);
    eng.controls.target.copy(base);
    sim = null;
  }
}
eng.onFrame = () => step(performance.now());

reset();
if (Q.get('autoplay') === '0') {
  faller.position.y = 0;
  sim = null;
}
const again = () => reset();
holder.addEventListener('click', again);
addEventListener('keydown', (e) => (e.key === 'r' || e.key === 'R') && again());
window.__drop = { eng, reset, state: () => sim }; // for the tests
