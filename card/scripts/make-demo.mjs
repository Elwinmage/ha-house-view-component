// Generates the demo home of the integration: a fictitious house (demo-maison.sh3d, Sweet Home 3D >= 5.3), a terrain
// in three plateaus with trees (demo-terrain.json) and the edits that show the features (demo-edits.json).
// Nothing comes from a real place: run `npm run demo` to write them into custom_components/house_view/demo/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { DEMO_ENTITIES } from '../src/demo-data.js';

const OUT = new URL('../../custom_components/house_view/demo/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- house (metres; x east, z south)

const EXT = 0.25; // exterior wall thickness
const INT = 0.1; // interior wall thickness
const H0 = 2.6; // height of a level
const SLAB = 0.12;

const rooms = {
  level0: [
    ['Bureau', 0, 0, 4, 4],
    ['Escalier', 4, 0, 8, 4],
    ['Entrée', 8, 0, 11, 5],
    ['WC', 11, 0, 14, 2.5],
    ['Buanderie', 11, 2.5, 14, 5],
    ['Séjour', 0, 4, 8, 10],
    ['Cuisine', 8, 5, 14, 10],
    ['Garage', 14, 4, 20, 10],
  ],
  level1: [
    ['Chambre 3', 0, 0, 4, 5],
    ['Couloir', 4, 0, 10, 5],
    ['Salle de bain', 10, 0, 14, 4],
    ['Chambre 1', 0, 5, 5, 10],
    ['Chambre 2', 5, 5, 10, 10],
    ['Chambre parentale', 10, 4, 14, 10],
  ],
};

// wall centre lines: [x0, z0, x1, z1, exterior]
const walls = {
  level0: [
    [0, 0, 14, 0, 1],
    [14, 0, 14, 10, 1],
    [14, 10, 0, 10, 1],
    [0, 10, 0, 0, 1],
    [14, 4, 20, 4, 1],
    [20, 4, 20, 10, 1],
    [20, 10, 14, 10, 1],
    [0, 4, 8, 4, 0],
    [4, 0, 4, 4, 0],
    [8, 0, 8, 10, 0],
    [8, 5, 14, 5, 0],
    [11, 0, 11, 5, 0],
    [11, 2.5, 14, 2.5, 0],
  ],
  level1: [
    [0, 0, 14, 0, 1],
    [14, 0, 14, 10, 1],
    [14, 10, 0, 10, 1],
    [0, 10, 0, 0, 1],
    [0, 5, 10, 5, 0],
    [4, 0, 4, 5, 0],
    [5, 5, 5, 10, 0],
    [10, 0, 10, 10, 0],
    [10, 4, 14, 4, 0],
  ],
};

// openings: [name, x, z, width, height, elevation, angle (0: wall along x, 90: along z)]
const openings = {
  level0: [
    ["Porte d'entrée", 9.5, 0, 1.0, 2.15, 0, 0],
    ['Fenêtre', 2, 0, 1.2, 1.2, 1.0, 0],
    ['Fenêtre', 12.5, 0, 0.6, 0.6, 1.5, 0],
    ['Fenêtre', 14, 3.5, 0.8, 1.0, 1.1, 90],
    ['Baie vitrée', 4, 10, 2.4, 2.15, 0, 0],
    ['Fenêtre', 0, 7, 1.2, 1.3, 0.9, 90],
    ['Fenêtre', 11, 10, 1.2, 1.1, 1.0, 0],
    ['Porte de garage', 17, 10, 2.4, 2.0, 0, 0],
    ['Porte', 6, 4, 0.9, 2.04, 0, 0],
    ['Porte', 4, 2, 0.8, 2.04, 0, 90],
    ['Porte', 8, 2, 0.9, 2.04, 0, 90],
    ['Porte', 11, 1.25, 0.7, 2.04, 0, 90],
    ['Porte', 11, 3.75, 0.8, 2.04, 0, 90],
    ['Porte', 10, 5, 0.9, 2.04, 0, 0],
    ['Passage', 8, 7.5, 1.4, 2.1, 0, 90],
    ['Porte', 14, 7, 0.9, 2.04, 0, 90],
  ],
  level1: [
    ['Fenêtre', 2.5, 10, 1.2, 1.25, 1.0, 0],
    ['Fenêtre', 7.5, 10, 1.2, 1.25, 1.0, 0],
    ['Fenêtre', 12, 10, 1.4, 1.25, 1.0, 0],
    ['Fenêtre', 14, 7, 1.0, 1.25, 1.0, 90],
    ['Fenêtre', 12, 0, 0.8, 0.8, 1.4, 0],
    ['Fenêtre', 2, 0, 1.0, 1.25, 1.0, 0],
    ['Fenêtre', 7, 0, 0.8, 1.0, 1.2, 0],
    ['Porte', 2.5, 5, 0.8, 2.04, 0, 0],
    ['Porte', 7.5, 5, 0.8, 2.04, 0, 0],
    ['Porte', 4, 2.5, 0.8, 2.04, 0, 90],
    ['Porte', 10, 6, 0.8, 2.04, 0, 90],
    ['Porte', 10, 2, 0.8, 2.04, 0, 90],
  ],
};

// furniture: [name, x, z, width, depth, height, elevation, angle deg, color]
const furniture = {
  level0: [
    ['Canapé', 2.4, 8.6, 2.2, 0.9, 0.85, 0, 0],
    ['Table basse', 2.4, 7.2, 1.1, 0.6, 0.42, 0, 0],
    ['Meuble TV', 2.4, 4.3, 1.8, 0.45, 0.5, 0, 0],
    ['Télévision', 2.4, 4.12, 1.3, 0.06, 0.75, 0.9, 0],
    ['Table', 6.0, 7.4, 1.8, 0.95, 0.75, 0, 0],
    ['Chaise', 5.5, 6.7, 0.45, 0.5, 0.9, 0, 0],
    ['Chaise', 6.5, 6.7, 0.45, 0.5, 0.9, 0, 0],
    ['Chaise', 5.5, 8.1, 0.45, 0.5, 0.9, 0, 180],
    ['Chaise', 6.5, 8.1, 0.45, 0.5, 0.9, 0, 180],
    ['Plan de travail', 11.0, 9.55, 4.0, 0.62, 0.9, 0, 0],
    ['Réfrigérateur', 13.5, 6.0, 0.7, 0.7, 1.85, 0, 270],
    ['Îlot', 10.5, 7.2, 1.8, 0.9, 0.9, 0, 0],
    ['Bureau', 2.0, 1.0, 1.4, 0.7, 0.75, 0, 0],
    ['Chaise de bureau', 2.0, 1.7, 0.6, 0.6, 1.0, 0, 180],
    ['Bibliothèque', 0.3, 2.4, 0.35, 1.6, 2.0, 0, 90],
    ['Escalier', 6.0, 2.0, 1.0, 3.2, 2.72, 0, 0],
    ['WC', 12.5, 0.5, 0.4, 0.65, 0.8, 0, 0],
    ['Lave-linge', 13.55, 3.0, 0.6, 0.6, 0.85, 0, 270],
    ['Étagère', 15.0, 4.4, 1.8, 0.45, 1.8, 0, 0],
  ],
  level1: [
    ['Lit', 2.5, 8.6, 1.4, 2.0, 0.55, 0, 0],
    ['Armoire', 0.4, 6.5, 0.6, 1.6, 2.1, 0, 90],
    ['Lit', 7.5, 8.6, 1.4, 2.0, 0.55, 0, 0],
    ['Bureau', 9.2, 6.0, 1.2, 0.6, 0.75, 0, 270],
    ['Lit', 12.0, 7.8, 1.6, 2.0, 0.55, 0, 0],
    ['Commode', 12.0, 4.4, 1.2, 0.5, 0.85, 0, 0],
    ['Lit', 2.0, 1.4, 0.9, 1.9, 0.5, 0, 0],
    ['Baignoire', 12.0, 3.4, 1.7, 0.75, 0.55, 0, 0],
    ['Lavabo', 13.6, 1.0, 0.5, 0.45, 0.85, 0, 270],
  ],
};

// trees, hedge and detached objects of the garden (outside every room, on the ground level)
const garden = [
  ['Chêne', -14, -6, 6, 6, 11],
  ['Chêne', 30, -14, 6, 6, 10],
  ['Pin', -18, 20, 4, 4, 12],
  ['Olivier', 22, 18, 3, 3, 4],
  ['Cerisier', 0, -20, 4, 4, 5],
  ['Cerisier', 6, -22, 4, 4, 5],
  ['Abricotier', 12, -20, 4, 4, 4.5],
  ['Haie', 8, 46, 30, 1.2, 1.6],
];
const outdoorObjects = [
  ['Abri de jardin', -6, -24, 3, 2.5, 2.3, 0],
  ['Portail', 8, 47.5, 4, 0.2, 1.6, 0],
];

const cm = (v) => Math.round(v * 1000) / 10;
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}='${String(v).replace(/&/g, '&amp;').replace(/'/g, '&apos;')}'`)
    .join(' ');
const MODEL = { model: 'box', icon: 'icon', modelMirrored: 'false' };

function homeXml() {
  const lines = [`<?xml version='1.0'?>`, `<home version='7000' name='Maison de démonstration' wallHeight='${cm(H0)}'>`];
  // compass: fictitious latitude 45° N (sun and seasons only), north at the top of the plan
  lines.push(
    `  <compass ${attrs({ x: -300, y: -300, diameter: 150, northDirection: 0, latitude: (45 * Math.PI) / 180, longitude: (2 * Math.PI) / 180, timeZone: 'Europe/Paris' })}/>`,
  );
  lines.push(
    `  <level ${attrs({ id: 'level0', name: 'Rez-de-chaussée', elevation: 0, floorThickness: cm(SLAB), height: cm(H0), elevationIndex: 0 })}/>`,
  );
  lines.push(
    `  <level ${attrs({ id: 'level1', name: 'Étage', elevation: cm(H0 + SLAB), floorThickness: cm(SLAB), height: cm(H0), elevationIndex: 0 })}/>`,
  );
  for (const lv of ['level0', 'level1']) {
    for (const [name, x, z, w, h, elev, a] of openings[lv]) {
      const thick =
        Math.abs(x) < 0.01 || Math.abs(z) < 0.01 || Math.abs(x - 14) < 0.01 || Math.abs(z - 10) < 0.01 || Math.abs(x - 20) < 0.01
          ? EXT
          : INT;
      lines.push(
        `  <doorOrWindow ${attrs({ level: lv, catalogId: name, name, x: cm(x), y: cm(z), elevation: cm(elev), width: cm(w), depth: cm(thick), height: cm(h), angle: (a * Math.PI) / 180, ...MODEL, wallThickness: 1, wallDistance: 0, doorOrWindowBoundToWall: 'true' })}/>`,
      );
    }
    for (const [name, x, z, w, d, h, elev, a] of furniture[lv]) {
      lines.push(
        `  <pieceOfFurniture ${attrs({ level: lv, catalogId: name, name, x: cm(x), y: cm(z), elevation: cm(elev), width: cm(w), depth: cm(d), height: cm(h), angle: (a * Math.PI) / 180, ...MODEL })}/>`,
      );
    }
    // a ceiling light in the middle of every room
    for (const [name, x0, z0, x1, z1] of rooms[lv]) {
      lines.push(
        `  <light ${attrs({ level: lv, catalogId: 'plafonnier', name: `Plafonnier ${name}`, x: cm((x0 + x1) / 2), y: cm((z0 + z1) / 2), elevation: cm(H0 - 0.25), width: 40, depth: 40, height: 20, power: 0.5, ...MODEL })}><lightSource x='0.5' y='0.5' z='0.5' color='#FFFFE0B8' diameter='0.1'/></light>`,
      );
    }
  }
  for (const [name, x, z, w, d, h] of garden) {
    lines.push(
      `  <pieceOfFurniture ${attrs({ level: 'level0', catalogId: name, name, x: cm(x), y: cm(z), elevation: 0, width: cm(w), depth: cm(d), height: cm(h), angle: 0, ...MODEL })}/>`,
    );
  }
  for (const [name, x, z, w, d, h, a] of outdoorObjects) {
    lines.push(
      `  <pieceOfFurniture ${attrs({ level: 'level0', catalogId: name, name, x: cm(x), y: cm(z), elevation: 0, width: cm(w), depth: cm(d), height: cm(h), angle: a, ...MODEL })}/>`,
    );
  }
  let wid = 0;
  for (const lv of ['level0', 'level1']) {
    for (const [x0, z0, x1, z1, ext] of walls[lv]) {
      wid++;
      lines.push(
        `  <wall ${attrs({ id: `w${wid}`, level: lv, xStart: cm(x0), yStart: cm(z0), xEnd: cm(x1), yEnd: cm(z1), height: cm(H0), thickness: cm(ext ? EXT : INT), pattern: 'hatchUp' })}/>`,
      );
    }
  }
  // rooms along the inner faces of their walls
  const outer = (v, lo, hi) => (Math.abs(v - lo) < 0.01 || Math.abs(v - hi) < 0.01 ? EXT / 2 : INT / 2);
  for (const lv of ['level0', 'level1']) {
    for (const [name, x0, z0, x1, z1] of rooms[lv]) {
      const garage = name === 'Garage';
      const ix0 = x0 + (garage ? EXT / 2 : outer(x0, 0, 14));
      const ix1 = x1 - (garage ? EXT / 2 : outer(x1, 0, 14));
      const iz0 = z0 + (garage ? EXT / 2 : outer(z0, 0, 10));
      const iz1 = z1 - outer(z1, 0, 10);
      const pts = [
        [ix0, iz0],
        [ix1, iz0],
        [ix1, iz1],
        [ix0, iz1],
      ];
      lines.push(
        `  <room ${attrs({ level: lv, name, areaVisible: 'false', floorVisible: 'true', ceilingVisible: 'true' })}>${pts.map(([x, z]) => `<point x='${cm(x)}' y='${cm(z)}'/>`).join('')}</room>`,
      );
    }
  }
  lines.push('</home>', '');
  return lines.join('\n');
}

// a unit cube (OBJ) and a 1x1 PNG: the pieces need a model and an icon to open in Sweet Home 3D
const CUBE = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n`;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) =>
  c.charCodeAt(0),
);
writeFileSync(new URL('demo-maison.sh3d', OUT), zipSync({ 'Home.xml': strToU8(homeXml()), box: strToU8(CUBE), icon: PNG }));

// ---------------------------------------------------------------- terrain: three plateaus on a slope

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const ramp = (z, z0, z1, h0, h1) => h0 + (h1 - h0) * smooth((z - z0) / (z1 - z0));
const noise = (x, z) => 0.18 * Math.sin(x * 0.21 + z * 0.07) + 0.12 * Math.sin(z * 0.17 - x * 0.05) + 0.06 * Math.sin(x * 0.53 + z * 0.41);

/** Ground: upper plateau (orchard, north) 104.5, house plateau 102, lower plateau (pool, pond, south) 99.5. */
function ground(x, z) {
  let h;
  if (z < -34) h = ramp(z, -60, -34, 108.5, 104.5) + noise(x, z);
  else if (z < -10) h = 104.5 + noise(x, z) * 0.15;
  else if (z < -6) h = ramp(z, -10, -6, 104.5, 102);
  else if (z < 18) h = 102 + noise(x, z) * 0.05;
  else if (z < 22) h = ramp(z, 18, 22, 102, 99.5);
  else if (z < 45) h = 99.5 + noise(x, z) * 0.12;
  else h = ramp(z, 45, 70, 99.5, 97.5) + noise(x, z);
  // the hillside also leans a little to the west, outside of the property
  if (x < -25 || x > 40) h += (x < -25 ? -25 - x : x - 40) * 0.04;
  return h;
}

const SIZE = 140;
const STEP = 1;
const N = SIZE / STEP + 1;
const centre = [7, 5];
const origin = [centre[0] - SIZE / 2, centre[1] - SIZE / 2];
const crowns = [
  // [x, z, radius, height]: trees seen by the surface model (placed on their own by the view)
  ...[-20, -14, -8, 2, 8, 14, 20].map((x, i) => [x, -16 - (i % 2) * 6, 2.2, 5]), // orchard rows
  ...[-22, -10, 2, 14, 26].map((x) => [x, -28, 2.4, 6]),
  [-20, 10, 3.5, 11],
  [-22, 30, 3, 9],
  [34, 28, 3.2, 10],
  [36, 0, 3, 9],
  [-30, -40, 4, 13],
  [44, -36, 4, 12],
  [-40, 52, 3.5, 10],
];
// roofs seen by the surface model at the eaves of the plan: the automatic registration puts the house on its plateau
const house = { x0: 0, z0: 0, x1: 20, z1: 10, h: 5.32 };
const z = [];
const s = [];
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = origin[0] + i * STEP;
    const zz = origin[1] + j * STEP;
    const g = ground(x, zz);
    let top = g;
    for (const [cx, cz, r, h] of crowns) {
      const d = Math.hypot(x - cx, zz - cz);
      if (d < r) top = Math.max(top, g + h * Math.sqrt(1 - (d / r) ** 2));
    }
    if (x >= house.x0 && x <= house.x1 && zz >= house.z0 && zz <= house.z1) top = Math.max(top, g + (x > 14 ? 2.6 : house.h));
    z.push(Math.round(g * 100) / 100);
    s.push(Math.round(top * 100) / 100);
  }
}
const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const terrain = {
  version: 1,
  origin,
  step: STEP,
  nx: N,
  nz: N,
  z,
  s,
  center: centre,
  // already drawn in the frame of the plan: no automatic registration after the (simulated) fetch
  registration: { base: 0, rot: 0, dx: 0, dz: 0, showTrees: true, showRoads: true },
  buildings: [
    { poly: rect(0, 0, 14, 10), h: 7 },
    { poly: rect(14, 4, 20, 10), h: 3.2 },
  ],
  roads: [
    {
      pts: [
        [origin[0], 52],
        [origin[0] + SIZE, 52],
      ],
      w: 6,
    },
  ],
  parcels: [
    { id: 'demo-1', poly: rect(-26, -32, 42, 48) },
    { id: 'demo-2', poly: rect(-60, -32, -26, 48) },
    { id: 'demo-3', poly: rect(42, -32, 76, 48) },
  ],
};
writeFileSync(new URL('demo-terrain.json', OUT), `${JSON.stringify(terrain)}\n`);

// ---------------------------------------------------------------- edits: everything the demo shows

const ids = new Set(DEMO_ENTITIES.map((e) => e[0]));
const ent = (id) => {
  if (!ids.has(id)) throw new Error(`unknown demo entity ${id}`);
  return id;
};
let n = 0;
const uid = (p) => `${p}${++n}`;
const okey = (level, x, zz) => `${level}:${Math.round(x * 10)}:${Math.round(zz * 10)}`;

const edits = {
  version: 1,
  registration: { base: 0, rot: 0, dx: 0, dz: 0, showTrees: true, showRoads: true },
  views: [],
  outdoor: {},
  terrain: [],
  fences: [
    {
      pts: rect(-26, -32, 42, 47.5),
      closed: true,
      frame: 'plan',
      segs: [
        { s: 'wood', h: 1.5 },
        { s: 'mesh', h: 1.5 },
        { s: 'wall', h: 1.2 },
        { s: 'mesh', h: 1.5 },
      ],
    },
  ],
  entities: [
    {
      id: uid('e'),
      entity: ent('sensor.exterieur_temperature'),
      at: [24, 14],
      base: 0,
      level: null,
      room: null,
      scope: 'general',
      display: 'badge',
      label: 'Dehors',
    },
    {
      id: uid('e'),
      entity: ent('sensor.sejour_temperature'),
      overRoof: true,
      at: [4, 7],
      base: 0,
      level: 'level0',
      room: 'r6',
      scope: 'general',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('sensor.chambre_parentale_temperature'),
      overRoof: true,
      at: [12, 7],
      base: 2.72,
      level: 'level1',
      room: 'r14',
      scope: 'general',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('sensor.piscine_temperature'),
      at: [5, 35],
      base: -2.5,
      level: null,
      room: null,
      scope: 'general',
      display: 'badge',
      label: 'Piscine',
    },
    // layers of the rooms: shown only when zoomed on the room (the general ones disappear there)
    {
      id: uid('e'),
      entity: ent('sensor.sejour_humidite'),
      at: [1.2, 5.5],
      base: 0,
      level: 'level0',
      room: 'r6',
      layer: 'r6',
      scope: 'room',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('sensor.sejour_co2'),
      at: [6.8, 5.2],
      base: 0,
      level: 'level0',
      room: 'r6',
      layer: 'r6',
      scope: 'room',
      display: 'badge',
      mount: 'free',
      y: 1.2,
    },
    {
      id: uid('e'),
      entity: ent('cover.sejour_volet_ouest'),
      at: [0.43, 7],
      base: 0,
      level: 'level0',
      room: 'r6',
      layer: 'r6',
      scope: 'room',
      display: 'badge',
      mount: 'wall',
      wall: { p: [0.13, 2.35, 7], n: [1, 0] },
      tap: 'toggle',
    },
    {
      id: uid('e'),
      entity: ent('media_player.salon'),
      at: [2.4, 6.2],
      base: 0,
      level: 'level0',
      room: 'r6',
      layer: 'r6',
      scope: 'room',
      display: 'icon',
      tap: 'toggle',
    },
    {
      id: uid('e'),
      entity: ent('sensor.cuisine_temperature'),
      at: [12, 7],
      base: 0,
      level: 'level0',
      room: 'r7',
      layer: 'r7',
      scope: 'room',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('binary_sensor.cuisine_fumee'),
      at: [10.5, 6],
      base: 0,
      level: 'level0',
      room: 'r7',
      layer: 'r7',
      scope: 'room',
      display: 'icon',
      mount: 'free',
      y: 2.4,
    },
    {
      id: uid('e'),
      entity: ent('binary_sensor.buanderie_fuite'),
      at: [12.5, 3.8],
      base: 0,
      level: 'level0',
      room: 'r5',
      layer: 'r5',
      scope: 'room',
      display: 'icon',
    },
    {
      id: uid('e'),
      entity: ent('sensor.salle_de_bain_humidite'),
      at: [11, 1.5],
      base: 2.72,
      level: 'level1',
      room: 'r11',
      layer: 'r11',
      scope: 'room',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('sensor.salle_de_bain_temperature'),
      at: [13, 1.5],
      base: 2.72,
      level: 'level1',
      room: 'r11',
      layer: 'r11',
      scope: 'room',
      display: 'badge',
    },
    {
      id: uid('e'),
      entity: ent('light.terrasse'),
      at: [4, 11],
      base: 0,
      level: null,
      room: null,
      scope: 'general',
      display: 'icon',
      kind: 'spot',
      tap: 'toggle',
      lightY: 2.4,
    },
  ],
  room_areas: {},
  openings: {
    [okey('level0', 4, 10)]: { contact: ent('binary_sensor.sejour_baie'), shutter: ent('cover.sejour_volet_baie') },
    [okey('level0', 0, 7)]: { contact: ent('binary_sensor.sejour_fenetre'), shutter: ent('cover.sejour_volet_ouest') },
    [okey('level1', 12, 10)]: { shutter: ent('cover.chambre_parentale_volet_sud') },
    [okey('level1', 14, 7)]: { shutter: ent('cover.chambre_parentale_volet_est') },
    [okey('level0', 9.5, 0)]: { contact: ent('binary_sensor.entree_porte') },
    [okey('level0', 17, 10)]: { contact: ent('binary_sensor.garage_porte') },
  },
  pools: [
    {
      id: 'pool1',
      name: 'Piscine',
      kind: 'pool',
      shape: 'rect',
      pts: rect(0, 28, 10, 34),
      frame: 'plan',
      color: '#2a9fd6',
      depth: 1.6,
      robot: ent('binary_sensor.robot_piscine'),
    },
    {
      id: 'pond1',
      name: 'Étang',
      kind: 'pond',
      shape: 'free',
      pts: Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const r = 3.2 + 0.9 * Math.sin(3 * a) + 0.4 * Math.cos(5 * a);
        return [Math.round((26 + Math.cos(a) * r * 1.3) * 100) / 100, Math.round((34 + Math.sin(a) * r) * 100) / 100];
      }),
      frame: 'plan',
      // a small island off the middle, for a tree
      islands: [
        {
          shape: 'free',
          frame: 'plan',
          pts: Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            const r = 0.95 + 0.15 * Math.sin(2 * a);
            return [Math.round((26.6 + Math.cos(a) * r * 1.2) * 100) / 100, Math.round((34.3 + Math.sin(a) * r) * 100) / 100];
          }),
        },
      ],
      color: '#3d6b4a',
      depth: 0.9,
      robot: '',
      // koi of the house catalog: 3 red, 1 red and white, 2 yellow, 2 black, red and white
      fish: [
        { id: 'k1', species: 'koi', variety: 'benigoi', count: 3 },
        { id: 'k2', species: 'koi', variety: 'kohaku', count: 1, length: 0.6 },
        { id: 'k3', species: 'koi', variety: 'yamabuki-ogon', count: 2 },
        { id: 'k4', species: 'koi', variety: 'showa', count: 2, length: 0.4 },
      ],
    },
  ],
  irrigation: {
    soil: 'loam',
    lines: [
      {
        id: 'l1',
        name: 'Potager',
        entity: ent('switch.arrosage_potager'),
        color: 'black',
        flow: 2,
        spacing: 0.3,
        frame: 'plan',
        pts: [
          [-18, 26],
          [-8, 26],
          [-8, 30],
          [-18, 30],
          [-18, 34],
          [-8, 34],
        ],
      },
      {
        id: 'l2',
        name: 'Haie',
        entity: ent('switch.arrosage_haie'),
        color: 'brown',
        flow: 2,
        spacing: 0.5,
        frame: 'plan',
        pts: [
          [-6, 45.5],
          [10, 45.5],
          [22, 45.5],
        ],
      },
    ],
    circuits: [
      {
        id: 'c1',
        name: 'Pelouse',
        entity: ent('switch.arrosage_pelouse'),
        heads: [
          { id: 'h1', model: 'hunter-pgj-04', rMin: 1.4, rMax: 9, dir: 90, arc: 180, at: [14, 26], frame: 'plan' },
          { id: 'h2', model: 'hunter-pgj-04', rMin: 1.4, rMax: 9, dir: 270, arc: 180, at: [14, 40], frame: 'plan' },
          { id: 'h3', model: 'hunter-mp2000', rMin: 4, rMax: 5.5, dir: 180, arc: 90, at: [-4, 22.5], frame: 'plan' },
        ],
      },
    ],
  },
  vacuums: [{ entity: ent('vacuum.robot'), source: 'none', color: '#ffffff', dock: { at: [16.9, 4.45], level: 'level0', base: 0, dir: 180 } }],
  panel: [
    { id: uid('g'), entity: ent('sensor.exterieur_temperature'), label: 'Dehors', icon: 'mdi:thermometer', tap: 'more-info' },
    { id: uid('g'), entity: ent('alarm_control_panel.maison'), label: 'Alarme', icon: '', tap: 'more-info' },
    { id: uid('g'), entity: ent('switch.pompe_piscine'), label: 'Pompe', icon: 'mdi:pump', tap: 'toggle' },
    { id: uid('g'), entity: ent('light.terrasse'), label: 'Terrasse', icon: '', tap: 'toggle' },
    { id: uid('g'), entity: ent('binary_sensor.robot_piscine'), label: 'Robot piscine', icon: 'mdi:robot-vacuum-variant', tap: 'toggle' },
    { id: uid('g'), entity: ent('switch.arrosage_pelouse'), label: 'Arrosage pelouse', icon: 'mdi:sprinkler-variant', tap: 'toggle' },
    { id: uid('g'), entity: ent('switch.arrosage_potager'), label: 'Arrosage potager', icon: 'mdi:water-pump', tap: 'toggle' },
    { id: uid('g'), entity: ent('switch.arrosage_haie'), label: 'Arrosage haie', icon: 'mdi:sprinkler', tap: 'toggle' },
  ],
  alarms: { auto: true, rooms: true, extra: [], ignored: [] },
  zones: [
    {
      id: 'z1',
      kind: 'media',
      name: 'Télévision',
      entity: ent('media_player.salon'),
      shape: 'rect',
      level: 'level0',
      rect: { c: [2.4, 1.3, 4.08], n: [0, 0, 1], rot: 0, w: 1.3, h: 0.75 },
    },
  ],
  room_views: {},
  pool: { dy: 0 },
  trees: { removed: { dsm: [], sd: [] }, added: [{ species: 'cherry-tree', at: [26.6, 34.3], h: 3.2 }] }, // the cherry tree of the island
};
writeFileSync(new URL('demo-edits.json', OUT), `${JSON.stringify(edits, null, 1)}\n`);
console.log('demo written to', OUT.pathname);
