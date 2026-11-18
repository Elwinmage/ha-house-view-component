// Prototype "catalog": procedural stand-ins for what would be catalog assets
// (low-poly meshes / sprites per species and per season) in the real project.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

const ANCHORS = [
  ['winter', 15],
  ['spring', 105],
  ['summer', 200],
  ['autumn', 290],
  ['winter', 380],
];

export function seasonBlend(doy) {
  let d = doy;
  if (d < 15) d += 365;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (d <= ANCHORS[i + 1][1]) {
      const t = (d - ANCHORS[i][1]) / (ANCHORS[i + 1][1] - ANCHORS[i][1]);
      return { from: ANCHORS[i][0], to: ANCHORS[i + 1][0], t };
    }
  }
  return { from: 'winter', to: 'winter', t: 0 };
}

export function seasonName(doy) {
  const s = seasonBlend(doy);
  const n = s.t < 0.5 ? s.from : s.to;
  return { winter: 'hiver', spring: 'printemps', summer: 'été', autumn: 'automne' }[n];
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
    const geo = speciesGeometry(sp, opts);
    if (!leafMats.has(key)) {
      const lm = new THREE.MeshStandardMaterial({ color: sp.leaf.all || sp.leaf.summer, roughness: 0.95, flatShading: true });
      leafMats.set(key, lm);
      const entry = { material: lm, key: `leaf:${key}`, snow: sp.deciduous ? 0.12 : 0.6, wet: 0.1, base: lm.color.clone() };
      surfaces.push(entry);
      leafMats.set(`${key}:entry`, entry);
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: sp.trunk, roughness: 0.9 });
    const res = { sp, geo, leafMat: leafMats.get(key), trunkMat };
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
      const kinds = ['maple', 'oak', 'birch', 'pine'];
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
export function buildBoxFurnitureMesh(items, baseY) {
  const geos = [];
  const col = new THREE.Color();
  for (const it of items) {
    const [w, h, d] = it.size;
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    col.set(it.color || '#c8bfae');
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.applyMatrix4(
      new THREE.Matrix4()
        .makeTranslation(it.at[0], baseY + (it.elevation || 0) + h / 2, it.at[1])
        .multiply(new THREE.Matrix4().makeRotationY(-(it.rot || 0))),
    );
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'furniture-boxes';
  return mesh;
}
