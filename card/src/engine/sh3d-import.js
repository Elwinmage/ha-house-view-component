// Sweet Home 3D importer: .sh3d (zip) -> Home.xml -> generic scene (see scene-model.js).
//
// In the real project this logic lives in the integration (Python): the zip and the
// XML are plain standard formats, and only the structure (walls, rooms, openings,
// lights) is read; the 3D models stored in the archive are never decoded.
//
// Home.xml facts used here (Sweet Home 3D >= 5.3, DTD in HomeXMLHandler):
//   lengths in cm, angles in radians, colors as AARRGGBB hex, plan y axis = our z axis,
//   wall/door/window coordinates are measured at their center, rooms are polygons
//   usually drawn along the inner faces of the walls.
import { unzipSync, strFromU8 } from 'fflate';
import { catalogTreeFor } from './catalog.js';
import { pointInPolygon, centroid } from './geometry.js';
import { bakeModel, encodeModel, hexOf, modelFiles, parseMtl, parseObj } from './sh3d-models.js';

const OUTDOOR_NAME = /abri|cabanon|remise|portail|portillon|poteau|barri[eè]re|garage|carport|pergola|pont|ponton|bassin|piscine|pool/i;
const CM = 0.01;

const strip = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = (s) =>
  strip(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const hex = (argb) => (argb && /^[0-9a-fA-F]{6,8}$/.test(argb) ? `#${argb.slice(-6).toLowerCase()}` : null);
const num = (el, name, def = 0) => {
  const v = parseFloat(el.getAttribute(name));
  return Number.isFinite(v) ? v : def;
};
const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);

// ---------------------------------------------------------------- zip

/** Every entry of a .sh3d archive (Home.xml, models, textures): { name: bytes }, or null for a raw Home.xml. */
export function readSh3dFiles(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x3c || (bytes[0] === 0xef && bytes[3] === 0x3c)) return null;
  try {
    return unzipSync(bytes);
  } catch {
    return null;
  }
}

export function readHomeXml(buffer) {
  const bytes = new Uint8Array(buffer);
  // raw XML file (no zip): starts with "<"
  if (bytes[0] === 0x3c || (bytes[0] === 0xef && bytes[3] === 0x3c)) return strFromU8(bytes);
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => /(^|\/)Home\.xml$/.test(f.name) });
  } catch (e) {
    throw new Error(`Archive illisible (${e.message || e}). Ce n'est pas un fichier .sh3d valide.`);
  }
  const key = Object.keys(files)[0];
  if (!key) {
    throw new Error(
      "Pas de Home.xml dans l'archive : ce fichier a été enregistré avec une version de Sweet Home 3D antérieure à 5.3 (format Java sérialisé). Rouvrez-le dans une version ≥ 5.3 puis enregistrez-le à nouveau.",
    );
  }
  return strFromU8(files[key]);
}

// ---------------------------------------------------------------- heuristics

const FLOOR_TILE = /cuisine|kitchen|bain|bath|douche|shower|wc|toilet|buanderie|laundry|garage|entree|hall/;
const guessFloor = (name) => (FLOOR_TILE.test(strip(name)) ? '#cfcfc8' : '#b99a6b');

function classifyOpening(name, catalogId, elevation, height) {
  const n = strip(`${name} ${catalogId}`);
  if (elevation < 0.1 && /doorframe|frame|opening|passage|arche|arch|cadre|ouverture/.test(n)) return 'opening';
  if (elevation >= 0.35) return 'window';
  if (/baie|patio|coulissant|sliding|french|vitree|balcon|glass door/.test(n)) return 'patio';
  if (/window|fenetre|velux|vitre/.test(n)) return height > 1.8 ? 'patio' : 'window';
  return 'door';
}

const VEG_RULES = [
  [/pin\b|pine|sapin|conifer|cypres|epicea|thuya/, 'pine'],
  [/olivier|olive/, 'olive'],
  [/bouleau|birch/, 'birch'],
  [/chene|oak/, 'oak'],
  [/erable|maple/, 'maple'],
  [/haie|hedge/, 'hedge'],
  [/arbre|tree|palmier|palm|feuillu/, 'tree'],
  [/arbuste|bush|buisson|massif|fleur|flower|plante|plant|shrub/, 'bush'],
];

function vegetationSpecies(name, catalogId, height) {
  const n = strip(`${name} ${catalogId}`);
  for (const [re, sp] of VEG_RULES) {
    if (re.test(n)) return sp === 'tree' ? (height > 6 ? 'oak' : 'maple') : sp;
  }
  return null;
}

const COLOR_RULES = [
  [/canape|sofa|fauteuil|armchair/, '#5b7a99'],
  [/\blit\b|bed|matelas/, '#e9e4da'],
  [/armoire|placard|wardrobe|commode|dresser|etagere|bibliotheque|shelf/, '#d9cdb8'],
  [/table|bureau|desk|chaise|chair|banc|bench/, '#a98258'],
  [/frigo|refriger|four\b|oven|lave|washer|cuisini|evier|sink|plan de travail|hotte/, '#c9ced3'],
  [/tv|television|ecran|screen/, '#1a1c20'],
  [/baignoire|bath|douche|shower|lavabo|wc|toilet/, '#f1f4f6'],
  [/piscine|pool|bassin/, '#3fb7c9'],
  [/escalier|stair/, '#b8a98f'],
];
const guessColor = (name) => {
  const n = strip(name);
  for (const [re, c] of COLOR_RULES) if (re.test(n)) return c;
  return '#c8bfae';
};

// ---------------------------------------------------------------- models of the pieces

/** What the plan says of the model of a piece: { ref, rotation, mirrored, color, colors } (no model: null). */
function modelOf(el) {
  const ref = el.getAttribute('model');
  if (!ref) return null;
  const rot = (el.getAttribute('modelRotation') || '').split(/\s+/).map(Number);
  const colors = {};
  for (const m of kids(el, 'material')) {
    const c = hex(m.getAttribute('color'));
    if (c && m.getAttribute('name')) colors[m.getAttribute('name')] = c;
  }
  return {
    ref,
    rotation: rot.length === 9 && rot.every(Number.isFinite) ? rot : null,
    mirrored: el.getAttribute('modelMirrored') === 'true',
    color: hex(el.getAttribute('color')),
    colors,
  };
}

/** Colour of a textured material: its colour times the mean colour of its picture (when it could be read). */
function texturedColors(mtl, dir, textures) {
  for (const m of Object.values(mtl)) {
    const mean = m.texture && (textures[dir + m.texture] || textures[m.texture]);
    if (!mean) continue;
    const kd = [1, 3, 5].map((k) => parseInt(m.color.slice(k, k + 2), 16) / 255);
    m.color = hexOf(kd.map((v, k) => v * mean[k]));
  }
  return mtl;
}

/**
 * Mean colour of each picture of the archive (textures of the models), [r, g, b] from 0 to 1; read in a browser only
 * (nothing elsewhere).
 */
export async function textureMeans(files, limit = 300) {
  const out = {};
  if (!files || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return out;
  const canvas = new OffscreenCanvas(8, 8);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  let n = 0;
  for (const [name, bytes] of Object.entries(files)) {
    if (!/\.(jpe?g|png|gif|bmp)$/i.test(name) || n++ >= limit) continue;
    try {
      const bmp = await createImageBitmap(new Blob([bytes]));
      g.clearRect(0, 0, 8, 8);
      g.drawImage(bmp, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
      out[name] = sum.map((v) => v / 64 / 255);
    } catch {
      // a picture that cannot be read: the colour of the material stays
    }
  }
  return out;
}

/** Triangles kept for all the models of a plan, shared among them (fewer for each when there are many). */
export const MODELS_BUDGET = 90000;

/**
 * The models of the pieces, from the files of the .sh3d (null: none), into scene.models; each piece drawn with a
 * model gets `model` (its key) and `mirrored`. Pieces whose model cannot be read (another format than OBJ) stay
 * boxes, and so do those whose model is a plain box. Returns the counts of pieces drawn with their model and of those
 * whose model could not be read.
 */
export function attachModels(scene, files, textures = {}) {
  const items = [...scene.furniture, ...scene.outdoor];
  const wanted = new Map();
  for (const it of items) {
    const m = it._model;
    delete it._model;
    if (!m || !files) continue;
    const key = [m.ref, (m.rotation || []).join(','), m.color || '', JSON.stringify(m.colors)].join('|');
    if (!wanted.has(key)) wanted.set(key, { ...m, items: [] });
    wanted.get(key).items.push({ it, mirrored: m.mirrored });
  }
  if (!wanted.size) return { drawn: 0, unreadable: 0 };
  const decode = (u8) => strFromU8(u8);
  const maxTris = Math.min(2500, Math.max(300, Math.floor(MODELS_BUDGET / wanted.size)));
  const models = {};
  const parsed = new Map();
  let drawn = 0;
  let unreadable = 0;
  let n = 0;
  for (const m of wanted.values()) {
    let src = parsed.get(m.ref);
    if (src === undefined) {
      const f = modelFiles(files, m.ref, decode);
      src = f ? { obj: parseObj(f.obj), mtl: texturedColors(parseMtl(f.mtl), f.dir, textures) } : null;
      parsed.set(m.ref, src);
    }
    const baked = src && bakeModel(src.obj, src.mtl, { rotation: m.rotation, colors: m.colors, color: m.color, maxTris });
    if (!baked) {
      unreadable += m.items.length;
      continue;
    }
    // a plain box (12 triangles at most) says nothing more than the box: the object of the catalog may draw it better
    if (baked.idx.length <= 36) continue;
    const key = `m${++n}`;
    models[key] = encodeModel(baked);
    for (const { it, mirrored } of m.items) {
      it.model = key;
      if (mirrored) it.mirrored = true;
      drawn++;
    }
  }
  if (n) scene.models = models;
  return { drawn, unreadable };
}

// ---------------------------------------------------------------- parser

/**
 * Convert Home.xml text to a generic scene + an import report.
 * @returns {{ scene: object, report: { counts: object, warnings: string[] } }}
 */
export function parseHome(xmlText, filename = 'plan.sh3d') {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error(`Home.xml illisible : ${perr.textContent.slice(0, 140)}`);
  const home = doc.documentElement;
  if (home.tagName !== 'home') throw new Error(`Racine inattendue <${home.tagName}> (attendu <home>).`);

  const warnings = [];
  const defaultWallH = num(home, 'wallHeight', 250) * CM;

  // ---- levels
  let levels = kids(home, 'level').map((el) => ({
    id: el.getAttribute('id'),
    name: el.getAttribute('name') || 'Niveau',
    elevation: num(el, 'elevation') * CM,
    floorThickness: Math.max(num(el, 'floorThickness', 12) * CM, 0.05),
    height: num(el, 'height', defaultWallH / CM) * CM,
    viewable: el.getAttribute('viewable') !== 'false',
    rooms: [],
    walls: [],
  }));
  if (!levels.length) {
    levels = [{ id: '__level0', name: 'Niveau 0', elevation: 0, floorThickness: 0.12, height: defaultWallH, viewable: true, rooms: [], walls: [] }];
  }
  levels.sort((a, b) => a.elevation - b.elevation);
  const byId = new Map(levels.map((l) => [l.id, l]));
  const levelOf = (id) => byId.get(id) || levels[0];
  const hidden = levels.filter((l) => !l.viewable);
  if (hidden.length) warnings.push(`Niveau(x) masqué(s) dans SH3D, importé(s) quand même : ${hidden.map((l) => l.name).join(', ')}`);
  const live = () => true;

  // ---- walls
  let curved = 0;
  let sloped = 0;
  for (const el of kids(home, 'wall')) {
    const lv = levelOf(el.getAttribute('level'));
    if (!live(lv)) continue;
    const a = [num(el, 'xStart') * CM, num(el, 'yStart') * CM];
    const b = [num(el, 'xEnd') * CM, num(el, 'yEnd') * CM];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) continue;
    const height = (el.hasAttribute('height') ? num(el, 'height') : defaultWallH / CM) * CM;
    if (Math.abs(num(el, 'arcExtent')) > 0.01) curved++;
    if (el.hasAttribute('heightAtEnd') && Math.abs(num(el, 'heightAtEnd') * CM - height) > 0.02) sloped++;
    lv.walls.push({
      a,
      b,
      thickness: Math.max(num(el, 'thickness', 7.5) * CM, 0.03),
      height: Math.max(height, num(el, 'heightAtEnd', 0) * CM),
      joinStart: !!el.getAttribute('wallAtStart'),
      joinEnd: !!el.getAttribute('wallAtEnd'),
      exterior: true,
    });
  }
  if (curved) warnings.push(`${curved} mur(s) courbe(s) approximé(s) par un segment droit`);
  if (sloped) warnings.push(`${sloped} mur(s) à hauteur variable : hauteur maximale utilisée`);

  // ---- rooms
  let roomIdx = 0;
  for (const el of kids(home, 'room')) {
    const lv = levelOf(el.getAttribute('level'));
    if (!live(lv)) continue;
    const poly = kids(el, 'point').map((p) => [num(p, 'x') * CM, num(p, 'y') * CM]);
    if (poly.length < 3) continue;
    roomIdx++;
    const name = el.getAttribute('name') || `Pièce ${roomIdx}`;
    lv.rooms.push({
      id: `r${roomIdx}`,
      name,
      area: slug(name) || `room_${roomIdx}`,
      floor: hex(el.getAttribute('floorColor')) || guessFloor(name),
      temp: null,
      poly,
      inset: 0.004, // rooms already follow the inner wall faces
      noFloor: el.getAttribute('floorVisible') === 'false',
    });
  }

  const roomAt = (lv, p) => lv.rooms.find((r) => pointInPolygon(p, r.poly)) || null;

  // ---- exterior / interior classification of walls
  // Level without rooms: a point is "outside" if one of 4 axis rays reaches infinity without crossing a wall
  const rayFree = (lv, p, dir) => {
    for (const w of lv.walls) {
      const [x0, z0] = w.a;
      const [x1, z1] = w.b;
      const ex = x1 - x0;
      const ez = z1 - z0;
      const den = dir[0] * ez - dir[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x0 - p[0]) * ez - (z0 - p[1]) * ex) / den;
      const u = ((x0 - p[0]) * dir[1] - (z0 - p[1]) * dir[0]) / den;
      if (t > 0 && u >= 0 && u <= 1) return false;
    }
    return true;
  };
  const isOutside = (lv, p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some((d) => rayFree(lv, p, d));
  for (const lv of levels) {
    if (!lv.rooms.length && lv.walls.length) {
      for (const w of lv.walls) {
        const dx = w.b[0] - w.a[0];
        const dz = w.b[1] - w.a[1];
        const L = Math.hypot(dx, dz);
        const nx = -dz / L;
        const nz = dx / L;
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        const d = w.thickness / 2 + 0.15;
        w.exterior = isOutside(lv, [m[0] + nx * d, m[1] + nz * d]) || isOutside(lv, [m[0] - nx * d, m[1] - nz * d]);
      }
    }
    for (const w of lv.walls) {
      if (!lv.rooms.length) continue;
      const dx = w.b[0] - w.a[0];
      const dz = w.b[1] - w.a[1];
      const L = Math.hypot(dx, dz);
      const nx = -dz / L;
      const nz = dx / L;
      const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const d = w.thickness / 2 + 0.1;
      const s1 = roomAt(lv, [m[0] + nx * d, m[1] + nz * d]);
      const s2 = roomAt(lv, [m[0] - nx * d, m[1] - nz * d]);
      w.exterior = !(s1 && s2);
    }
  }

  // ---- pieces (flatten groups; group children carry absolute coordinates)
  const pieces = [];
  const collect = (parent, inherited) => {
    for (const el of Array.from(parent.children)) {
      if (el.tagName === 'furnitureGroup') collect(el, el.getAttribute('level') || inherited);
      else if (['pieceOfFurniture', 'doorOrWindow', 'light'].includes(el.tagName)) pieces.push({ el, level: el.getAttribute('level') || inherited });
    }
  };
  collect(home, null);

  const openings = [];
  const lights = [];
  const furniture = [];
  const vegetation = [];
  const outdoor = []; // detached objects (shed, gate...) : anchored to the ground, independent of any level
  const outdoorCount = {};
  let sitePool = null;
  const lowest = levels[0];
  let skipped = 0;

  for (const { el, level } of pieces) {
    if (el.getAttribute('visible') === 'false') continue;
    const lv = levelOf(level);
    if (!live(lv)) continue;
    const name = el.getAttribute('name') || '';
    const catalogId = el.getAttribute('catalogId') || '';
    const x = num(el, 'x') * CM;
    const z = num(el, 'y') * CM;
    const w = num(el, 'width') * CM;
    const d = num(el, 'depth') * CM;
    const h = num(el, 'height') * CM;
    const elev = num(el, 'elevation') * CM;
    const angle = num(el, 'angle');

    if (el.tagName === 'doorOrWindow') {
      const type = classifyOpening(name, catalogId, elev, h);
      // owning room = the room on either side of the wall (wall direction = piece angle)
      const nx = -Math.sin(angle);
      const nz = Math.cos(angle);
      const room = roomAt(lv, [x + nx * 0.35, z + nz * 0.35]) || roomAt(lv, [x - nx * 0.35, z - nz * 0.35]);
      openings.push({ level: lv.id, type, at: [x, z], width: w, sill: elev, height: h, room: room ? room.id : null, name });
      continue;
    }

    if (el.tagName === 'light') {
      const src = kids(el, 'lightSource')[0];
      const color = (src && hex(src.getAttribute('color'))) || '#ffe1b8';
      const power = num(el, 'power', 0.5);
      let kind = 'spot';
      if (elev > 1.2 && elev + h >= lv.height - 0.4) kind = 'pendant';
      else if (elev < 0.3 && h > 1.2) kind = 'lamp';
      const y = lv.elevation + elev + (kind === 'lamp' ? h * 0.92 : h * 0.5);
      let room = roomAt(lv, [x, z]);
      if (!room && lv !== lowest && lv.rooms.length) {
        room = lv.rooms.reduce((best, r) => {
          const c = centroid(r.poly);
          const dist = Math.hypot(c[0] - x, c[1] - z);
          return !best || dist < best.dist ? { r, dist } : best;
        }, null).r;
      }
      lights.push({
        id: `light_${lights.length + 1}`,
        name: name || `Lumière ${lights.length + 1}`,
        level: lv.id,
        room: room ? room.id : 'outdoor',
        kind,
        pos: [x, y, z],
        color,
        brightness: Math.min(Math.max(power * 1.8, 0.35), 1.3),
        on: true,
        radius: 5,
      });
      continue;
    }

    // plain piece of furniture
    if (Math.max(w, d) < 0.05) {
      skipped++;
      continue;
    }
    const inRoom = roomAt(lv, [x, z]);
    // Outdoor pool piece -> site pool (axis-aligned bounding box of the rotated footprint)
    if (!inRoom && !sitePool && /piscine|pool|bassin/i.test(name) && Math.max(w, d) > 2) {
      const hx = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * d) / 2;
      const hz = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * d) / 2;
      sitePool = { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz };
      continue;
    }
    // a tree of the catalog named by the plan ("Cerisier", "Yew"), else a generic species by the usual words
    const sp = !inRoom ? catalogTreeFor(name) || vegetationSpecies(name, catalogId, h) : null;
    if (sp) {
      // the name is kept: a tree of the catalog with that name (its keywords) is drawn instead of the generic species
      vegetation.push({ species: sp, at: [x, z], name, ...(sp === 'hedge' ? { length: Math.max(w, d) } : {}) });
      continue;
    }
    const own = hex(el.getAttribute('color'));
    const color = own || guessColor(name);
    // colored: the plan gives the piece a colour of its own, which a catalog object takes on its tinted parts
    const colored = Boolean(own);
    // A piece outside every room, either on a level without walls/rooms (an "annex" level used to place
    // detached objects) or with a typical outdoor name, is anchored to the terrain instead of a level.
    if (!inRoom && ((!lv.rooms.length && !lv.walls.length) || OUTDOOR_NAME.test(name))) {
      // the same object drawn twice (copy left on another level): keep one
      if (sitePool && /piscine|pool|bassin/i.test(name) && Math.max(w, d) > 2) continue;
      if (outdoor.some((o) => o.name === (name || 'objet') && Math.hypot(o.at[0] - x, o.at[1] - z) < 0.05 && Math.abs(o.size[0] - w) < 0.05)) continue;
      const n = (outdoorCount[name] = (outdoorCount[name] || 0) + 1);
      // id = name + occurrence: stable when the piece is moved in SH3D, so manual edits survive a re-import
      outdoor.push({
        id: `${name || 'objet'}#${n}`,
        name: name || 'objet',
        at: [x, z],
        rot: angle,
        size: [w, h, d],
        elevation: 0,
        color,
        colored,
        sh3dLevel: lv.name,
        _model: modelOf(el),
      });
      continue;
    }
    furniture.push({ kind: 'box', level: lv.id, at: [x, z], rot: angle, size: [w, h, d], elevation: elev, color, colored, name, _model: modelOf(el) });
  }

  // light radius from the size of its room
  for (const l of lights) {
    if (l.room === 'outdoor') {
      l.radius = 5;
      continue;
    }
    for (const lv of levels) {
      const r = lv.rooms.find((rr) => rr.id === l.room);
      if (r) {
        let area = 0;
        for (let i = 0; i < r.poly.length; i++) {
          const [x0, z0] = r.poly[i];
          const [x1, z1] = r.poly[(i + 1) % r.poly.length];
          area += x0 * z1 - x1 * z0;
        }
        l.radius = Math.min(Math.max(1.3 * Math.sqrt(Math.abs(area) / 2), 3.2), 7.5);
      }
    }
  }

  // ---- compass -> latitude + orientation of the plan relative to true north
  const compass = kids(home, 'compass')[0];
  const site = { latitude: 43.6, northOffsetDeg: 0 };
  if (sitePool) site.pool = sitePool;
  if (compass) {
    if (compass.hasAttribute('latitude')) site.latitude = (num(compass, 'latitude') * 180) / Math.PI;
    if (Math.abs(site.latitude - 48.8566) < 0.05) warnings.push('Latitude de la boussole = valeur par défaut de SH3D (Paris) : régler la boussole sur le site réel (soleil, saisons)');
    site.northOffsetDeg = (num(compass, 'northDirection') * 180) / Math.PI;
  } else warnings.push('Pas de boussole dans le plan : latitude par défaut (43,6°), nord vers le haut');

  const emptyLevels = levels.filter((l) => !l.rooms.length && !l.walls.length);
  if (emptyLevels.length) warnings.push(`Niveau(x) vide(s) retiré(s) : ${emptyLevels.map((l) => l.name).join(', ')}`);
  levels = levels.filter((l) => l.rooms.length || l.walls.length);
  if (!levels.length) throw new Error('Aucun mur ni aucune pièce dans ce plan.');
  const noRoom = levels.filter((l) => !l.rooms.length).map((l) => l.name);
  if (noRoom.length) warnings.push(`Aucune pièce dessinée sur : ${noRoom.join(', ')}. Façades déduites des murs, mais pas de lumières ni de lien area : tracer les pièces dans SH3D (outil « Créer des pièces »)`);

  // Top level made only of low walls (parapet / terrace) -> flat roof slab instead of a level
  let roof;
  const top = levels[levels.length - 1];
  if (
    levels.length > 1 &&
    top.walls.length &&
    top.rooms.length &&
    Math.max(...top.walls.map((w) => w.height)) < 1 &&
    !openings.some((o) => o.level === top.id) &&
    !furniture.some((f) => f.level === top.id)
  ) {
    roof = { type: 'flat', polys: top.rooms.map((r) => r.poly), y: top.elevation, thickness: 0.2 };
    levels = levels.filter((l) => l !== top);
    warnings.push(`« ${top.name} » (murs < 1 m) interprété comme toit-terrasse`);
  }
  if (skipped) warnings.push(`${skipped} objet(s) minuscule(s) ignoré(s)`);

  const count = (t) => openings.filter((o) => o.type === t).length;
  const report = {
    counts: {
      niveaux: levels.length,
      murs: levels.reduce((n, l) => n + l.walls.length, 0),
      pièces: levels.reduce((n, l) => n + l.rooms.length, 0),
      fenêtres: count('window') + count('patio'),
      portes: count('door') + count('opening'),
      lumières: lights.length,
      meubles: furniture.length,
      'objets extérieurs': outdoor.length,
      végétation: vegetation.length,
    },
    warnings,
  };

  const scene = {
    name: home.getAttribute('name') || filename,
    site,
    levels: levels.map(({ viewable, ...l }) => l),
    openings,
    lights,
    furniture,
    vegetation,
    outdoor,
  };
  if (roof) scene.roof = roof;
  return { scene, report };
}

export async function importSh3d(file) {
  const buf = await file.arrayBuffer();
  const out = parseHome(readHomeXml(buf), file.name);
  const files = readSh3dFiles(buf);
  const { drawn, unreadable } = attachModels(out.scene, files, await textureMeans(files));
  out.report.counts['modèles 3D'] = drawn;
  if (unreadable) out.report.warnings.push(`${unreadable} meuble(s) au modèle illisible (format autre qu'OBJ) : dessinés en boîtes`);
  return out;
}
