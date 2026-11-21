// House View: the demo house by the water. Three synthetic sites stand for real places until the integration fetches their
// elevation: ?site=beach (Atlantic dune and surf) | island (coral island and lagoon) | nl (Dutch polder and river).
// Options: ?hour=15&doy=200&weather=clear&view=0..3 (camera) &waves=0..1 &tide=m
import * as THREE from 'three';
import { HouseEngine } from '../src/engine.js';
import { importSh3d } from '../src/engine/sh3d-import.js';
import { normalizeScene } from '../src/engine/scene-model.js';
import edits0 from '../../custom_components/house_view/demo/demo-edits.json';
import houseBase64 from '../../custom_components/house_view/demo/demo-maison.sh3d';
import catalog from 'virtual:catalog';

const Q = new URLSearchParams(location.search);
const SITE = Q.get('site') || 'beach';
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// each site: absolute altitudes (sea level = 0) on a 400 m grid centred on the house, x east, z south
const SITES = {
  // Atlantic coast, ocean to the west: shallow sea with a sand bar, a 3 % beach, a foredune and the house on the dune
  beach: {
    lat: 44.648,
    sea: { on: true, level: 0, beach: 'sand', waves: 0.65, tide: 3, clarity: 0.35 },
    h(u, v) {
      const shore = -95 + 12 * Math.sin(v / 55) + 6 * Math.sin(v / 17);
      const d = u - shore; // > 0 landward
      if (d < 0) return d * 0.022 + 0.7 * Math.exp(-(((d + 70) / 22) ** 2)) - 0.25 * smooth(-200, 0, d) * 0 - 0.4 * smooth(-60, -10, d) * 0;
      const beach = Math.min(d, 52) * 0.03;
      const dune =
        8.5 * smooth(45, 95, d) + 1.2 * Math.sin(u / 11 + v / 23) * smooth(55, 110, d) + 0.7 * Math.sin(v / 9) * smooth(60, 100, d);
      return beach + dune - 0.012 * Math.max(0, d - 130);
    },
    view: [
      [60, 70, 110, -55, 2, 0, 0.27],
      [-210, 45, 120, -60, 0, -10, 0.3],
      [-60, 230, 70, -70, 0, 0, 0.17],
    ],
  },
  // Maldives: a coral island 1.2 m above the sea, a white shelf, turquoise lagoon, deeper water beyond
  island: {
    lat: 8.318,
    sea: { on: true, level: 0, beach: 'coral', waves: 0.18, tide: 0.5, clarity: 1 },
    h(u, v) {
      const e = Math.hypot(u / (165 + 25 * Math.sin(v / 60)), v / (78 + 10 * Math.sin(u / 70)));
      if (e < 1) return 1.25 * smooth(1, 0.8, e) + 0.2 * Math.sin(u / 9) * smooth(1, 0.6, e) * 0.3;
      return -0.35 - (e - 1) * 1.1 - smooth(1.8, 3.2, e) * 6 - 0.1 * Math.sin(u / 7 + v / 11) * (e < 2 ? 1 : 0);
    },
    view: [
      [120, 60, 130, 0, 0, 0, 0.3],
      [-150, 40, -100, 20, 0, 0, 0.3],
      [30, 230, 80, 10, 0, 0, 0.16],
    ],
  },
  // Dutch polder: flat land under the water level, a river between two dikes, a ditch, water kept at 0 (NAP)
  nl: {
    lat: 51.987,
    sea: { on: true, level: -0.8, beach: 'none', waves: 0.08, tide: 0, clarity: 0.08 },
    h(u, v) {
      const rv = v - 70 - 12 * Math.sin(u / 90); // distance south of the river axis
      const river = Math.abs(rv);
      let h = 0.2;
      h += 3.6 * Math.exp(-(((river - 38) / 11) ** 2)); // the two dikes
      h -= 4.2 * smooth(24, 4, river); // the river bed
      const ditch = Math.abs(v + 38);
      h -= 1.6 * smooth(3.5, 1, ditch);
      h -= 1.6 * smooth(3.5, 1, Math.abs(u - 85)) * (v < 30 ? 1 : 0);
      return h;
    },
    view: [
      [-90, 55, 150, 0, -1, 30, 0.38],
      [110, 35, -70, 0, -1, 40, 0.38],
      [20, 220, 90, 0, 0, 40, 0.2],
    ],
  },
};
const site = SITES[SITE];

const bytes = Uint8Array.from(atob(houseBase64), (c) => c.charCodeAt(0));
const { scene } = await importSh3d({ name: 'demo-maison.sh3d', arrayBuffer: async () => bytes.buffer });
const sd = normalizeScene(structuredClone(scene));
const b = sd.bbox;
const center = [Math.round(((b.x0 + b.x1) / 2) * 100) / 100, Math.round(((b.z0 + b.z1) / 2) * 100) / 100];

const SIZE = 420;
const STEP = 1.5;
const n = Math.round(SIZE / STEP) + 1;
const origin = [center[0] - SIZE / 2, center[1] - SIZE / 2];
const z = [];
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z.push(site.h(origin[0] + i * STEP - center[0], origin[1] + j * STEP - center[1]));
const terrain = { version: 1, origin, step: STEP, nx: n, nz: n, z, center };

const edits = structuredClone(edits0);
edits.pools = [];
edits.irrigation = { soil: 'loam', lines: [], circuits: [] };
edits.zones = [];
edits.fences = []; // no fence, to see the shore (and the gates that belong to them)
edits.gates = [];
edits.sea = { ...site.sea, waves: +(Q.get('waves') ?? site.sea.waves), tide: +(Q.get('tide') ?? site.sea.tide) };
// the floor of the house sits on the ground at its centre (altitude from the terrain)
edits.registration = { ...(edits.registration || {}), base: 0 };

document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
const holder = document.createElement('div');
holder.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(holder);
const eng = new HouseEngine(holder, { movable: false });
eng.setCatalog(catalog, 'fr');
eng.load({ scene, terrain, ortho: null, edits });
eng.setLive({ doy: +(Q.get('doy') ?? 200), hour: +(Q.get('hour') ?? 15), weather: Q.get('weather') || 'clear', latitude: site.lat });
eng.start();
window.eng = eng;
// frames for a clip: ?clock=1 lets the page set the time of the water (window.__t) instead of the real time
if (Q.get('clock')) {
  const tick = eng._tickSea.bind(eng);
  eng._tickSea = (t) => tick(window.__t ?? t);
}

const cams = site.view;
const [cx, cy, cz, tx, ty, tz, zm] = cams[+(Q.get('view') ?? 0) % cams.length];
const ground = eng.world.terrain.heightAt(center[0], center[1]);
eng.controls.target.set(center[0] + tx, ground + ty, center[1] + tz);
eng.camera.position.set(center[0] + cx, ground + cy, center[1] + cz);
eng.camera.zoom = +(Q.get('zoom') ?? zm);
eng.camera.updateProjectionMatrix();
eng.controls.update();
window.__ready = true;
