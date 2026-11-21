// Vegetation and furniture: a few built-in procedural species and pieces, and the entries of the house catalog
// (trees, objects: data only, drawn here; see ../catalog-lib.js and doc/format.md of house-catalog).
import * as THREE from 'three';
import { climateFor, seasonBlend as climateBlend } from '../climate.js';
import { decodeModel } from './sh3d-models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BLOSSOM_DENSITY,
  FORK,
  crownSolids,
  drawableObject,
  drawableTree,
  fitScale,
  localName,
  matchEntry,
  thinning,
  treeLook,
  treeSpecies,
  treeVarieties,
  varietyId,
  varietyTree,
} from '../catalog-lib.js';

// ---------------------------------------------------------------- helpers

function hash3(x, y, z) {
  let h = Math.imul(Math.round(x * 173) | 0, 73856093) ^ Math.imul(Math.round(y * 173) | 0, 19349663) ^ Math.imul(Math.round(z * 173) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radially jitter a geometry; the offset only depends on the position, so seams stay closed. */
function jitter(geo, amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 1 + (hash3(p.getX(i), p.getY(i), p.getZ(i)) - 0.5) * amount;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

function basic(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  out.clearGroups();
  return out;
}

const merge = (list) => mergeGeometries(list.map(basic));

function blob(r, sx, sy, sz, ox, oy, oz) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  jitter(g, 0.28);
  g.scale(sx, sy, sz);
  g.translate(ox, oy, oz);
  return g;
}

// ---------------------------------------------------------------- seasons

// the climate of the home (set from its latitude by the engine) decides when the seasons come
let CLIMATE = climateFor(45);

/** Latitude of the home: four seasons, long polar winters, or wet / dry seasons between the tropics. */
export function setClimate(latitude) {
  CLIMATE = climateFor(latitude);
  return CLIMATE;
}

/** Season blend of day `doy` (calendar) for the climate of the home. */
export function seasonBlend(doy) {
  return climateBlend(doy, CLIMATE);
}

const GRASS = { winter: '#7d8a62', spring: '#79bd48', summer: '#5f9e3b', autumn: '#9b9a46' };

export function grassColor(doy, out = new THREE.Color()) {
  const s = seasonBlend(doy);
  return out.set(GRASS[s.from]).lerp(new THREE.Color(GRASS[s.to]), s.t);
}

// ---------------------------------------------------------------- vegetation catalog

export const SPECIES = {
  maple: { name: 'Érable', kind: 'round', height: 6.5, crown: 2.7, trunkR: 0.2, trunk: '#6b4f3a', deciduous: true, leaf: { spring: '#a9d86f', summer: '#4f9a3f', autumn: '#d9622b', winter: '#8a6f50' } },
  oak: { name: 'Chêne', kind: 'round', height: 8.5, crown: 3.5, trunkR: 0.3, trunk: '#5c4636', deciduous: true, leaf: { spring: '#9ccf62', summer: '#3f7f35', autumn: '#c98a2e', winter: '#7a6446' } },
  birch: { name: 'Bouleau', kind: 'slim', height: 6.2, crown: 1.9, trunkR: 0.12, trunk: '#e8e4da', deciduous: true, leaf: { spring: '#b8e07a', summer: '#6fb54a', autumn: '#f0c43a', winter: '#9a9a8a' } },
  pine: { name: 'Pin', kind: 'conifer', height: 8, crown: 2.1, trunkR: 0.18, trunk: '#5a4333', deciduous: false, leaf: { all: '#2f6b45' } },
  olive: { name: 'Olivier', kind: 'round', height: 3.4, crown: 1.5, trunkR: 0.15, trunk: '#7a6a52', deciduous: false, leaf: { all: '#8fa36b' } },
  bush: { name: 'Arbuste', kind: 'bush', height: 1.2, crown: 0.9, trunkR: 0.05, trunk: '#6b4f3a', deciduous: true, winterScale: 0.45, leaf: { spring: '#8ccf5a', summer: '#4f9a3f', autumn: '#b8742a', winter: '#7d7358' } },
  hedge: { name: 'Haie', kind: 'hedge', height: 1.5, crown: 0.9, trunkR: 0.05, trunk: '#6b4f3a', deciduous: false, leaf: { all: '#3f7a3a' } },
  planter: { name: 'Jardinière', kind: 'planter', height: 0.9, crown: 0.4, trunkR: 0.05, trunk: '#8b5a3c', deciduous: true, winterScale: 0.15, leaf: { spring: '#f5b3d1', summer: '#ff6f91', autumn: '#d28a3a', winter: '#8a7a5a' } },
};

const BUILTIN_SPECIES = { ...SPECIES };
const CATALOG = { trees: {}, objects: {}, fish: {} };

/**
 * Take the entries of the house catalog: its trees join the species (an id of the catalog replaces the built-in
 * species of the same name), its objects are drawn in place of the furniture of the plan that names them, its fish
 * swim in the ponds.
 * Entries the engine cannot read (a newer format) are left out. `lang`: language of the names.
 */
// the sections of house-catalog: `pond_fish` holds the fish of the ponds
export function setCatalog({ trees = {}, objects = {}, pond_fish: fish = {} } = {}, lang = 'en') {
  for (const key of Object.keys(SPECIES)) delete SPECIES[key];
  Object.assign(SPECIES, BUILTIN_SPECIES);
  CATALOG.trees = {};
  for (const id of Object.keys(trees).sort()) {
    if (!drawableTree(trees[id])) continue;
    CATALOG.trees[id] = trees[id];
    SPECIES[id] = treeSpecies(id, trees[id], lang);
    // each variety is a species of its own, so that a red and a yellow apple tree can stand side by side; the plain
    // entry stays for the plants of a plan named after it, but is not offered when a variety can be chosen
    const varieties = treeVarieties(trees[id]);
    if (varieties.length) SPECIES[id].hidden = true;
    for (const variety of varieties) {
      const key = varietyId(id, variety);
      SPECIES[key] = treeSpecies(key, varietyTree(trees[id], variety), lang);
      SPECIES[key].name = `${SPECIES[id].name} - ${localName(variety.name, lang, variety.id)}`;
    }
  }
  CATALOG.objects = Object.fromEntries(Object.entries(objects).filter(([, object]) => drawableObject(object)));
  CATALOG.fish = Object.fromEntries(Object.entries(fish).filter(([, f]) => drawableFish(f)));
}

/** A fish the engine can draw: a length, a body and at least one variety with a colour. */
export function drawableFish(f) {
  return (
    !!f &&
    !!f.length &&
    Number.isFinite(f.length.default) &&
    !!f.body &&
    f.body.width > 0 &&
    f.body.height > 0 &&
    Array.isArray(f.varieties) &&
    f.varieties.some((v) => v && typeof v.base === 'string')
  );
}

/** Fish of the catalog, by id: what the ponds may hold. */
export const catalogFish = () => CATALOG.fish;

/** Species of the catalog a plant of the plan stands for, by its name (keywords of the entries), or null. */
export const catalogTreeFor = (name) => (name ? matchEntry(name, CATALOG.trees) : null);
/** Object of the catalog a piece of furniture of the plan stands for, by its name, or null. */
export function catalogObjectFor(name) {
  const id = name ? matchEntry(name, CATALOG.objects) : null;
  return id ? CATALOG.objects[id] : null;
}

/** Dots on a full crown, at most: flowers, fruits; and fallen leaves on the ground. */
const MAX_DOTS = { flowers: 170, fruits: 110, fallen: 150 };
/** Size of a dot, as a share of the crown radius. */
const DOT_SIZE = { flowers: 0.075, fruits: 0.05, fallen: 0.06 };

/** Every vertex of a clump keeps the centre it shrinks toward when the foliage gets thinner (see thinMaterial). */
function withCentre(geo, centre) {
  const out = basic(geo);
  const n = out.attributes.position.count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = centre[0];
    // a cone thins toward its axis: its height stays (centre at the height of each vertex)
    data[i * 3 + 1] = centre[1] === null ? out.attributes.position.getY(i) : centre[1];
    data[i * 3 + 2] = centre[2];
  }
  out.setAttribute('aCentre', new THREE.BufferAttribute(data, 3));
  return out;
}

/** A limb between two points, thinner at its end. */
function limb(from, to, r0, r1, sides = 5) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return g;
}

/**
 * Geometry of a tree of the catalog, for its default height: trunk and branches, the full crown (thinned by the
 * material, season after season), and the dots some seasons show: flowers and fruits on the crown, fallen leaves on
 * the ground. Dots are merged in a fixed order, so that drawing the first ones shows a share of them.
 */
function catalogGeometry(tree, id) {
  const top = tree.height.default;
  const R = tree.crown_radius;
  const r = tree.trunk.radius;
  const fork = tree.trunk.height + (top - tree.trunk.height) * FORK;
  const trunk = new THREE.CylinderGeometry(r * 0.6, r, fork, 7);
  trunk.translate(0, fork / 2, 0);
  const wood = [trunk];
  if (tree.shape === 'round' || tree.shape === 'weeping') {
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4 + 0.5;
      const reach = R * (0.5 + 0.12 * (i % 3));
      const from = new THREE.Vector3(0, fork - (fork - tree.trunk.height) * 0.5 * (i % 2), 0);
      const to = new THREE.Vector3(reach * Math.cos(angle), fork + (top - fork) * (0.35 + 0.1 * (i % 2)), reach * Math.sin(angle));
      wood.push(limb(from, to, r * 0.4, r * 0.1));
    }
  } else {
    wood.push(limb(new THREE.Vector3(0, fork, 0), new THREE.Vector3(0, top * 0.97, 0), r * 0.6, 0.01, 6));
  }

  const solids = crownSolids(tree);
  const centreOf = (s) => (s.kind === 'blob' ? s.at : [s.at[0], null, s.at[2]]);
  const leaves = mergeGeometries(
    solids.map((s) => {
      if (s.kind === 'blob') {
        const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.28);
        g.scale(...s.size);
        g.translate(...s.at);
        return withCentre(g, centreOf(s));
      }
      const g = jitter(new THREE.ConeGeometry(s.size[0], s.size[1], 8), 0.12);
      g.translate(s.at[0], s.at[1] + s.size[1] / 2, s.at[2]);
      return withCentre(g, centreOf(s));
    }),
  );

  // the same dots for every tree of the species, whatever the season: only their number and colour change
  let seed = 7;
  for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const rand = mulberry32(seed);
  const onCrown = () => {
    const s = solids[Math.floor(rand() * solids.length)];
    const a = rand() * Math.PI * 2;
    if (s.kind === 'blob') {
      const y = -0.6 + rand() * 1.6;
      const ring = Math.sqrt(1 - y * y);
      return { s, at: [s.at[0] + s.size[0] * ring * Math.cos(a), s.at[1] + s.size[1] * y, s.at[2] + s.size[2] * ring * Math.sin(a)] };
    }
    const up = 0.05 + rand() * 0.85;
    return { s, at: [s.at[0] + s.size[0] * (1 - up) * Math.cos(a), s.at[1] + s.size[1] * up, s.at[2] + s.size[0] * (1 - up) * Math.sin(a)] };
  };
  const has = (key) => Object.values(tree.seasons).some((season) => season[key]);
  const dots = (key) => {
    if (!has(key)) return null;
    const size = R * DOT_SIZE[key];
    const list = [];
    for (let i = 0; i < MAX_DOTS[key]; i++) {
      const { s, at } = onCrown();
      const g = new THREE.OctahedronGeometry(size, 0);
      g.translate(...at);
      list.push(withCentre(g, centreOf(s)));
    }
    return mergeGeometries(list);
  };
  let fallen = null;
  if (has('fallen')) {
    const size = R * DOT_SIZE.fallen;
    const list = [];
    for (let i = 0; i < MAX_DOTS.fallen; i++) {
      const a = rand() * Math.PI * 2;
      const reach = R * 1.1 * Math.sqrt(rand());
      const g = new THREE.CircleGeometry(size, 6);
      g.rotateX(-Math.PI / 2);
      g.translate(reach * Math.cos(a), 0.04, reach * Math.sin(a));
      list.push(basic(g));
    }
    fallen = mergeGeometries(list);
  }
  return { trunk: merge(wood), leaves, leafY: 0, flowers: dots('flowers'), fruits: dots('fruits'), fallen };
}

/**
 * A material whose geometry shrinks toward the centres its vertices carry (aCentre): thinner foliage, clump by
 * clump, without touching the geometry. `thin` is the uniform ({ value }) shared with whoever sets the season.
 */
function thinMaterial(material, thin) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uThin = thin;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCentre;\nuniform float uThin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = aCentre + (transformed - aCentre) * uThin;');
  };
  material.customProgramCacheKey = () => 'thin';
  return material;
}

function speciesGeometry(sp, opts = {}) {
  const c = sp.crown;
  if (sp.kind === 'round') {
    const tH = sp.height * 0.42;
    const cy = tH + c * 0.6;
    const trunk = new THREE.CylinderGeometry(sp.trunkR * 0.7, sp.trunkR, tH, 7);
    trunk.translate(0, tH / 2, 0);
    const branches = [0, 1, 2].map((i) => {
      const b = new THREE.CylinderGeometry(sp.trunkR * 0.18, sp.trunkR * 0.3, c * 1.1, 5);
      b.translate(0, c * 0.55, 0);
      b.rotateZ((i - 1) * 0.7);
      b.rotateY(i * 2.1);
      b.translate(0, tH * 0.85, 0);
      return b;
    });
    const offs = [
      [0, 0, 0, 1.0],
      [0.62, 0.3, 0.2, 0.75],
      [-0.58, 0.25, -0.3, 0.8],
      [0.1, 0.75, -0.5, 0.7],
      [-0.2, 0.45, 0.62, 0.7],
    ];
    const leaves = merge(offs.map((o) => blob(c * o[3], 1, 0.85, 1, o[0] * c, o[1] * c, o[2] * c)));
    return { trunk: merge([trunk, ...branches]), leaves, leafY: cy };
  }
  if (sp.kind === 'slim') {
    const tH = sp.height * 0.5;
    const trunk = new THREE.CylinderGeometry(sp.trunkR * 0.6, sp.trunkR * 1.1, tH + 1, 6);
    trunk.translate(0, (tH + 1) / 2, 0);
    const cy = tH * 0.9 + c * 1.05;
    const leaves = merge([blob(c, 0.8, 1.1, 0.8, 0, 0, 0), blob(c * 0.8, 0.8, 1.0, 0.8, 0.3, 1.0, 0.1), blob(c * 0.7, 0.8, 1.0, 0.8, -0.2, -0.9, 0.2)]);
    return { trunk, leaves, leafY: cy };
  }
  if (sp.kind === 'conifer') {
    const tH = sp.height * 0.18;
    const trunk = new THREE.CylinderGeometry(sp.trunkR * 0.7, sp.trunkR, tH + 0.5, 6);
    trunk.translate(0, (tH + 0.5) / 2, 0);
    const parts = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      const r = c * (1 - i * 0.2);
      const h = (sp.height - tH) / n * 1.5;
      const cone = new THREE.ConeGeometry(r, h, 8);
      jitter(cone, 0.12);
      cone.translate(0, tH + i * ((sp.height - tH) / n) * 0.85 + h / 2, 0);
      parts.push(cone);
    }
    const leaves = merge(parts);
    return { trunk, leaves, leafY: 0 /* conifers do not scale seasonally */ };
  }
  if (sp.kind === 'bush') {
    const leaves = merge([blob(c, 1, 0.8, 1, 0, 0, 0), blob(c * 0.7, 1, 0.8, 1, 0.55, -0.1, 0.2), blob(c * 0.65, 1, 0.8, 1, -0.5, -0.1, -0.25)]);
    const trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.3, 5);
    trunk.translate(0, 0.15, 0);
    return { trunk, leaves, leafY: c * 0.75 };
  }
  if (sp.kind === 'hedge') {
    const L = opts.length || 4;
    const g = new THREE.BoxGeometry(L, sp.height, sp.crown);
    const trunk = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    return { trunk, leaves: g, leafY: sp.height / 2 };
  }
  // planter
  const pot = new THREE.BoxGeometry(0.7, 0.45, 0.7);
  pot.translate(0, 0.225, 0);
  const blooms = merge([blob(0.22, 1, 0.8, 1, -0.15, 0, 0.05), blob(0.2, 1, 0.8, 1, 0.18, 0, -0.1), blob(0.18, 1, 0.8, 1, 0.02, 0.05, 0.2)]);
  return { trunk: pot, leaves: blooms, leafY: 0.55 };
}

/**
 * Build vegetation instances. Geometry and materials are shared per species so a
 * large number of instances stays cheap. `surfaces` receives one entry per leaf
 * material so the environment can blend it toward snow.
 */
export function createVegetation(placements, surfaces) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const cache = new Map(); // species(+length) -> shared resources
  const instances = [];
  const leafMats = new Map();

  const get = (key, opts) => {
    const ck = key + (opts.length ? `:${opts.length}` : '');
    if (cache.has(ck)) return cache.get(ck);
    const sp = SPECIES[key];
    const fromCatalog = sp.kind === 'catalog';
    const geo = fromCatalog ? catalogGeometry(sp.tree, key) : speciesGeometry(sp, opts);
    const thin = { value: 1 };
    if (!leafMats.has(key)) {
      const color = fromCatalog ? sp.tree.seasons.summer.foliage : sp.leaf.all || sp.leaf.summer;
      const lm = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
      if (fromCatalog) thinMaterial(lm, thin);
      leafMats.set(key, lm);
      const entry = { material: lm, key: `leaf:${key}`, snow: sp.deciduous ? 0.12 : 0.6, wet: 0.1, base: lm.color.clone() };
      surfaces.push(entry);
      leafMats.set(`${key}:entry`, entry);
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: sp.trunk, roughness: 0.9 });
    const res = { sp, geo, leafMat: leafMats.get(key), trunkMat };
    if (fromCatalog) {
      // the shadow of a thinned crown is thinned too; the dots follow the clump they sit on
      res.thin = thin;
      res.leafDepth = thinMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), thin);
      res.dotThin = { value: 1 };
      const dotMat = () => thinMaterial(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), res.dotThin);
      res.dots = {};
      if (geo.flowers) res.dots.flowers = { geo: geo.flowers, mat: dotMat(), per: 24, max: MAX_DOTS.flowers };
      if (geo.fruits) res.dots.fruits = { geo: geo.fruits, mat: dotMat(), per: 24, max: MAX_DOTS.fruits };
      if (geo.fallen) {
        const mat = new THREE.MeshStandardMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        res.dots.fallen = { geo: geo.fallen, mat, per: 18, max: MAX_DOTS.fallen };
      }
    }
    cache.set(ck, res);
    return res;
  };

  const add = (p, rand) => {
    const res = get(p.species, { length: p.length });
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(res.geo.trunk, res.trunkMat);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    const leaves = new THREE.Mesh(res.geo.leaves, res.leafMat);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.position.y = res.geo.leafY;
    if (res.sp.kind === 'conifer') leaves.position.y = 0;
    g.add(trunk, leaves);
    if (res.sp.kind === 'catalog') {
      leaves.customDepthMaterial = res.leafDepth;
      for (const [name, dot] of Object.entries(res.dots)) {
        const mesh = new THREE.Mesh(dot.geo, dot.mat);
        mesh.receiveShadow = true;
        mesh.userData.dots = name;
        g.add(mesh);
      }
    }
    const s = p.scale ?? (p.species === 'hedge' ? 1 : 0.9 + rand() * 0.25);
    g.scale.setScalar(s);
    g.position.set(p.at[0], 0, p.at[1]);
    if (p.species !== 'hedge') g.rotation.y = rand() * Math.PI * 2;
    group.add(g);
    instances.push({ leaves, sp: res.sp, key: p.species, baseY: leaves.position.y });
  };

  const rand = mulberry32(7);
  for (const p of placements) add(p, rand);

  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();

  const api = {
    group,
    instances,
    /** Add n random trees outside the plot, for the performance stress test. */
    addStress(n, plot) {
      const r = mulberry32(Date.now() & 0xffff);
      const kinds = ['maple', 'oak', 'birch', 'pine'].filter((k) => SPECIES[k]);
      let added = 0;
      while (added < n) {
        const x = -40 + r() * 100;
        const z = -34 + r() * 74;
        if (x > plot.x0 - 2 && x < plot.x1 + 2 && z > plot.z0 - 2 && z < plot.z1 + 2) continue;
        add({ species: kinds[Math.floor(r() * kinds.length)], at: [x, z] }, r);
        added++;
      }
      api.apply(api.lastDoy ?? 200);
    },
    /** Update leaf colors and leaf volume for a day of the year. */
    apply(doy) {
      api.lastDoy = doy;
      const s = seasonBlend(doy);
      for (const [key, sp] of Object.entries(SPECIES)) {
        const entry = leafMats.get(`${key}:entry`);
        if (!entry) continue;
        if (sp.kind === 'catalog') {
          // the season of the catalog: foliage colour and density, flowers, fruits, fallen leaves
          const res = cache.get(key);
          const look = treeLook(sp.tree, s);
          entry.base.set(look.foliage);
          res.thin.value = thinning(look.density);
          res.leafy = look.density > 0.03;
          // flowers on bare branches (blossom before the leaves) sit where a light foliage would be
          res.dotThin.value = Math.max(res.thin.value, thinning(BLOSSOM_DENSITY));
          for (const [name, dot] of Object.entries(res.dots)) {
            const scatter = look[name];
            dot.shown = Boolean(scatter);
            if (!scatter) continue;
            dot.mat.color.set(scatter.color);
            dot.geo.setDrawRange(0, Math.max(1, Math.round(scatter.amount * dot.max)) * dot.per);
          }
          continue;
        }
        if (sp.leaf.all) {
          entry.base.set(sp.leaf.all);
        } else {
          tmp.set(sp.leaf[s.from]);
          tmp2.set(sp.leaf[s.to]);
          entry.base.copy(tmp).lerp(tmp2, s.t);
        }
      }
      const scaleOf = (sp, season) => {
        if (!sp.deciduous) return 1;
        return { spring: 0.65, summer: 1, autumn: 0.8, winter: sp.winterScale ?? 0 }[season];
      };
      for (const inst of instances) {
        if (inst.sp.kind === 'catalog') {
          const res = cache.get(inst.key);
          inst.leaves.visible = res.leafy;
          for (const child of inst.leaves.parent.children) if (child.userData.dots) child.visible = res.dots[child.userData.dots].shown;
          continue;
        }
        const sc = scaleOf(inst.sp, s.from) * (1 - s.t) + scaleOf(inst.sp, s.to) * s.t;
        if (inst.sp.kind === 'hedge' || inst.sp.kind === 'conifer') {
          inst.leaves.scale.setScalar(1);
          inst.leaves.visible = true;
        } else {
          inst.leaves.scale.setScalar(Math.max(sc, 0.001));
          inst.leaves.visible = sc > 0.03;
        }
      }
    },
  };
  return api;
}

// ---------------------------------------------------------------- furniture

const PAL = {};
const m = (color) => (PAL[color] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const FURNITURE = {
  sofa: () => [
    box(2.2, 0.4, 0.9, '#5b7a99', 0, 0.1, 0),
    box(2.2, 0.45, 0.22, '#4f6d8a', 0, 0.5, 0.34),
    box(0.2, 0.3, 0.9, '#4f6d8a', -1.0, 0.5, 0),
    box(0.2, 0.3, 0.9, '#4f6d8a', 1.0, 0.5, 0),
  ],
  tv: () => [box(1.8, 0.5, 0.4, '#3a3330'), box(1.3, 0.75, 0.05, '#101215', 0, 0.55, 0)],
  coffee: () => [box(1.0, 0.05, 0.6, '#7a5a3a', 0, 0.38, 0), box(0.9, 0.38, 0.5, '#5f4630', 0, 0, 0)],
  counter: () => [box(3.6, 0.9, 0.6, '#d8d2c6'), box(3.7, 0.04, 0.66, '#4a4a4a', 0, 0.9, 0)],
  island: () => [box(1.8, 0.9, 0.8, '#8a7f70'), box(1.9, 0.04, 0.9, '#e8e4dc', 0, 0.9, 0)],
  fridge: () => [box(0.7, 1.8, 0.65, '#c9ced3')],
  desk: () => [
    box(1.6, 0.04, 0.75, '#a98258', 0, 0.72, 0),
    box(0.05, 0.72, 0.7, '#7a5a3a', -0.75, 0, 0),
    box(0.05, 0.72, 0.7, '#7a5a3a', 0.75, 0, 0),
    box(0.6, 0.35, 0.04, '#15181d', 0, 0.76, -0.2),
    box(0.45, 0.45, 0.45, '#3b3f46', 0, 0, 0.7),
  ],
  bench: () => [box(1.4, 0.45, 0.4, '#8a6a48'), box(1.4, 0.9, 0.06, '#6f5438', 0, 0.45, -0.17)],
  bed: () => [
    box(1.8, 0.3, 2.0, '#8b6b4a'),
    box(1.7, 0.2, 1.9, '#e9e4da', 0, 0.3, 0),
    box(0.6, 0.12, 0.35, '#ffffff', -0.45, 0.5, -0.7),
    box(0.6, 0.12, 0.35, '#ffffff', 0.45, 0.5, -0.7),
    box(1.72, 0.22, 1.1, '#6c8fb3', 0, 0.3, 0.35),
    box(1.8, 0.9, 0.08, '#6f5438', 0, 0, -1.0),
  ],
  bedSingle: () => [
    box(0.95, 0.3, 2.0, '#9a7b57'),
    box(0.88, 0.2, 1.9, '#e9e4da', 0, 0.3, 0),
    box(0.55, 0.12, 0.35, '#ffffff', 0, 0.5, -0.7),
    box(0.9, 0.2, 1.1, '#e4a15a', 0, 0.3, 0.35),
    box(0.95, 0.8, 0.08, '#6f5438', 0, 0, -1.0),
  ],
  wardrobe: () => [box(0.6, 2.1, 1.6, '#d9cdb8')],
  bath: () => [box(1.7, 0.55, 0.8, '#f3f6f8'), box(1.5, 0.05, 0.6, '#9fd7ea', 0, 0.5, 0)],
};

export function buildFurniture(item) {
  const g = new THREE.Group();
  g.add(...FURNITURE[item.kind]());
  g.position.set(item.at[0], 0, item.at[1]);
  g.rotation.y = item.rot || 0;
  return g;
}

// ---------------------------------------------------------------- light fixtures

/** Simple fixture meshes; the emissive color is driven by the light state. */
export function buildFixture(light, floorY = 0) {
  const mat = new THREE.MeshStandardMaterial({ color: '#f4efe6', emissive: '#000000', roughness: 0.6 });
  const g = new THREE.Group();
  const [x, y, z] = light.pos;
  if (light.kind === 'pendant') {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), m('#222222'));
    cord.position.set(0, 0.2, 0);
    g.add(cord, new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), mat));
  } else if (light.kind === 'lamp') {
    const h = Math.max(y - floorY, 0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, h, 5), m('#2a2a2a'));
    pole.position.set(0, -h / 2, 0);
    g.add(pole, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.28, 10), mat));
  } else if (light.kind === 'strip') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.04), mat));
  } else if (light.kind === 'bollard') {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 8), m('#3b3b3b'));
    post.position.set(0, -0.12, 0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat);
    cap.position.set(0, 0.16, 0);
    g.add(post, cap);
  } else if (light.kind === 'spot') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 10), mat));
  }
  g.position.set(x, y, z);
  return { group: g, material: mat };
}

/**
 * Imported furniture: every piece becomes a colored bounding box. All boxes of a
 * level are merged into one mesh (vertex colors) so they cost a single draw call.
 * item: { at:[x,z], rot, size:[width,height,depth], elevation, color }
 */
const DEG = Math.PI / 180;
const UNIT = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  sphere: () => new THREE.SphereGeometry(0.5, 16, 10),
  cone: () => new THREE.ConeGeometry(0.5, 1, 16),
};

/** A geometry painted in one colour (vertex colours), without index, to be merged with the others. */
function painted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * The parts of a catalog object, in its own frame (on the ground, centred, front toward +z), stretched to the size
 * of the piece of furniture it stands for. Parts marked `tint` take `tint` when the plan gives the piece a colour.
 */
export function objectGeometries(object, size, tint) {
  const fit = new THREE.Matrix4().makeScale(...fitScale(object.parts, size));
  return object.parts.map((part) => {
    const g = UNIT[part.shape]();
    g.scale(part.width, part.height, part.depth);
    const turn = new THREE.Euler((part.pitch || 0) * DEG, (part.yaw || 0) * DEG, (part.roll || 0) * DEG, 'YXZ');
    const place = new THREE.Matrix4().makeTranslation(part.x || 0, (part.elevation || 0) + part.height / 2, part.z || 0);
    g.applyMatrix4(fit.clone().multiply(place).multiply(new THREE.Matrix4().makeRotationFromEuler(turn)));
    return painted(g, part.tint && tint ? tint : part.color);
  });
}

const decoded = new WeakMap();

/**
 * Geometries of a piece drawn with its model (see sh3d-models.js): { solid, glass } (glass: the transparent parts,
 * with their opacity), already placed. Null when the model cannot be read.
 */
function modelGeometries(it, doc, at) {
  let m = decoded.get(doc);
  if (m === undefined) {
    m = decodeModel(doc);
    decoded.set(doc, m);
  }
  if (!m) return null;
  const [w, h, d] = it.size;
  const sx = it.mirrored ? -w : w;
  const out = { solid: null, glass: [] };
  const col = new THREE.Color();
  const build = (groups) => {
    let count = 0;
    for (const g of groups) count += g.n;
    if (!count) return null;
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let k = 0;
    for (const g of groups) {
      col.set(g.c);
      for (let t = g.s; t < g.s + g.n; t += 3) {
        // a mirrored piece: the triangles are turned the other way, so that they still face out
        const tri = it.mirrored ? [m.idx[t], m.idx[t + 2], m.idx[t + 1]] : [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
        for (const v of tri) {
          pos[k * 3] = m.pos[v * 3] * sx;
          pos[k * 3 + 1] = m.pos[v * 3 + 1] * h;
          pos[k * 3 + 2] = m.pos[v * 3 + 2] * d;
          col.toArray(colors, k * 3);
          k++;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo.applyMatrix4(at);
  };
  out.solid = build(m.groups.filter((g) => (g.a ?? 1) >= 0.9));
  for (const g of m.groups.filter((x) => (x.a ?? 1) < 0.9)) {
    const geo = build([g]);
    if (geo) out.glass.push({ geo, alpha: g.a });
  }
  return out;
}

/** Only the attributes every piece has, so that they merge. */
const plain = (g) => {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  return g;
};

/**
 * Pieces of furniture: drawn with their model of the plan (`it.model`, a key of `models`), else with the object of
 * the catalog their name stands for, else as a box. One merged mesh (and one for the transparent parts of the
 * models), in a group.
 */
export function buildBoxFurnitureMesh(items, baseY, models = null) {
  const geos = [];
  const glass = [];
  const col = new THREE.Color();
  for (const it of items) {
    const [w, h, d] = it.size;
    const at = new THREE.Matrix4()
      .makeTranslation(it.at[0], baseY + (it.elevation || 0), it.at[1])
      .multiply(new THREE.Matrix4().makeRotationY(-(it.rot || 0)));
    const doc = it.model && models ? models[it.model] : null;
    const fromModel = doc ? modelGeometries(it, doc, at) : null;
    if (fromModel && (fromModel.solid || fromModel.glass.length)) {
      if (fromModel.solid) geos.push(fromModel.solid);
      glass.push(...fromModel.glass);
      continue;
    }
    const object = catalogObjectFor(it.name);
    if (object) {
      // drawn from the catalog: same place, same footprint and height as the box it replaces
      for (const g of objectGeometries(object, it.size, it.colored ? it.color : null)) geos.push(g.applyMatrix4(at));
      continue;
    }
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    col.set(it.color || '#c8bfae');
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(it.at[0], baseY + (it.elevation || 0) + h / 2, it.at[1]).multiply(new THREE.Matrix4().makeRotationY(-(it.rot || 0))));
    geos.push(g);
  }
  if (!geos.length && !glass.length) return null;
  const group = new THREE.Group();
  group.name = 'furniture-boxes';
  if (geos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => plain(g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (glass.length) {
    // the transparent parts (glass of a cabinet, of an aquarium…) at the opacity of their material
    const alpha = glass.reduce((s, g) => s + g.alpha, 0) / glass.length;
    const mesh = new THREE.Mesh(
      mergeGeometries(glass.map((g) => plain(g.geo))),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, transparent: true, opacity: Math.max(alpha, 0.2), depthWrite: false, side: THREE.DoubleSide }),
    );
    group.add(mesh);
  }
  return group;
}
