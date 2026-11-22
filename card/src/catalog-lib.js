// Reading of the house catalog (trees, objects: https://github.com/Elwinmage/house-catalog, doc/format.md): pure
// helpers shared by the engine (geometry, seasons) and the card (names, lists). No DOM, no three.js: unit-tested.

/** Clumps of a round crown, in a box from -1 to 1: centre (x, y, z) and radius. Same as the catalog's own previews. */
export const CLUMPS = [
  [0.0, -0.15, 0.0, 0.8],
  [0.5, 0.1, 0.25, 0.5],
  [-0.5, 0.05, -0.3, 0.5],
  [0.1, 0.5, -0.35, 0.5],
  [-0.2, 0.45, 0.45, 0.5],
  [0.05, -0.45, 0.5, 0.45],
  [-0.1, -0.4, -0.5, 0.45],
];
/** Tiers of a conical crown. */
export const TIERS = 4;
/** Share of the crown height the trunk goes on into, where the branches leave it. */
export const FORK = 0.3;
/** Foliage that flowers on bare branches sit on (a density), so that a tree in blossom before its leaves shows it. */
export const BLOSSOM_DENSITY = 0.75;

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** A name of the catalog ({ en, fr, … }) in a language, English else, `fallback` when there is none. */
export function localName(names, lang, fallback = '') {
  if (!names || typeof names !== 'object') return fallback;
  const short = String(lang || 'en').split('-')[0];
  return names[lang] || names[short] || names.en || fallback;
}

/** Words of a text: lower case, without accents, split on anything that is not a letter or a digit. */
export function words(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The entry of the catalog a name of a Sweet Home 3D plan stands for: the one with a keyword found in the name as
 * whole words ("chaise de jardin" holds "chaise", not "chai"). The longest keyword wins, then the first id.
 * `items`: { id: { keywords: [...] } }. Returns the id, or null.
 */
export function matchEntry(name, items) {
  const list = words(name);
  if (!list.length || !items) return null;
  const text = ` ${list.join(' ')} `;
  let best = null;
  for (const id of Object.keys(items).sort()) {
    for (const keyword of items[id].keywords || []) {
      const key = words(keyword).join(' ');
      if (key && text.includes(` ${key} `) && (!best || key.length > best.length)) best = { id, length: key.length };
    }
  }
  return best ? best.id : null;
}

// ---------------------------------------------------------------- colours

const parseHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A colour between two `#rrggbb`: t = 0 gives a, t = 1 gives b. */
export function mixHex(a, b, t) {
  const from = parseHex(a);
  const to = parseHex(b);
  const k = clamp01(t);
  return `#${from
    .map((v, i) =>
      Math.round(v + (to[i] - v) * k)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ---------------------------------------------------------------- trees

/** The rendering of a season: a missing one is drawn like summer. */
export const seasonOf = (tree, season) => tree.seasons[season] || tree.seasons.summer;

/** Dots (flowers, fruits, fallen leaves) between two seasons: the amount fades in or out, in the colour of whichever has some. */
function mixScatter(from, to, t) {
  const amount = (from ? from.amount : 0) * (1 - t) + (to ? to.amount : 0) * t;
  if (amount <= 0.001) return null;
  const color = from && to ? mixHex(from.color, to.color, t) : (from || to).color;
  return { color, amount };
}

/**
 * How a tree looks between two seasons (`blend`: { from, to, t }, see seasonBlend): foliage colour, density (1 fills
 * the crown, 0 leaves bare branches), and the dots on the crown and on the ground, or null when there are none.
 */
export function treeLook(tree, blend) {
  const from = seasonOf(tree, blend.from);
  const to = seasonOf(tree, blend.to);
  const t = clamp01(blend.t);
  return {
    foliage: mixHex(from.foliage, to.foliage, t),
    density: (from.density ?? 1) * (1 - t) + (to.density ?? 1) * t,
    flowers: mixScatter(from.flowers, to.flowers, t),
    fruits: mixScatter(from.fruits, to.fruits, t),
    fallen: mixScatter(from.fallen, to.fallen, t),
  };
}

/** How much each clump of leaves shrinks, where it is, for a density (the crown keeps its spread). */
export const thinning = (density) => Math.pow(clamp01(density), 0.6);

/** Curtains of branches hanging from the rim of a weeping crown. */
export const CURTAINS = 10;

/**
 * A weeping crown: a low dome in the upper part of the box (one blob and four around it) and `CURTAINS` vertical
 * blobs hanging from its rim (0.85 of the radius) down to the trunk, some longer than others. Same as the catalog's
 * own previews (`_weeping` in scripts/render_previews.py).
 */
function weepingSolids(top, radius, bottom) {
  const span = top - bottom;
  const solids = [{ kind: 'blob', at: [0, bottom + 0.78 * span, 0], size: [0.7 * radius, 0.22 * span, 0.7 * radius] }];
  for (let i = 0; i < 4; i++) {
    const a = ((i * 90 + 45) * Math.PI) / 180;
    solids.push({
      kind: 'blob',
      at: [0.55 * radius * Math.cos(a), bottom + 0.68 * span, 0.55 * radius * Math.sin(a)],
      size: [0.45 * radius, 0.18 * span, 0.45 * radius],
    });
  }
  for (let i = 0; i < CURTAINS; i++) {
    const a = ((i * 360) / CURTAINS) * (Math.PI / 180);
    const half = 0.33 * span * (0.9 + 0.1 * ((i % 3) - 1));
    solids.push({
      kind: 'blob',
      at: [0.85 * radius * Math.cos(a), bottom + 0.7 * span - half, 0.85 * radius * Math.sin(a)],
      size: [0.2 * radius, half, 0.2 * radius],
    });
  }
  return solids;
}

/** Fronds of a palm: the number around the trunk. */
export const FRONDS = 9;

/**
 * The crown of a palm: a tuft at the top of the trunk and fronds that leave it, rise a little and droop at their tip
 * (each one two flat blobs along its length, turned about the vertical axis by `yaw`).
 */
function palmSolids(top, radius, bottom) {
  const span = Math.max(0.5, top - bottom);
  const t = Math.min(span, radius * 0.8);
  const solids = [{ kind: 'blob', at: [0, top - 0.25 * t, 0], size: [0.28 * radius, 0.3 * t, 0.28 * radius] }];
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2 + (i % 2) * 0.18;
    const lift = i % 2 ? 0.05 : 0.2; // two ranks: the upper fronds rise, the lower ones droop
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (reach, drop) => [reach * radius * c, top - drop * t, reach * radius * s];
    solids.push({ kind: 'blob', at: at(0.28, 0.1 - lift), size: [0.32 * radius, 0.08 * t, 0.15 * radius], yaw: -a });
    solids.push({ kind: 'blob', at: at(0.62, 0.5 - lift), size: [0.34 * radius, 0.07 * t, 0.14 * radius], yaw: -a });
    solids.push({ kind: 'blob', at: at(0.98, 1.2 - lift), size: [0.26 * radius, 0.06 * t, 0.1 * radius], yaw: -a });
  }
  return solids;
}

/**
 * The solids of a full crown, for a tree of the default height: blobs `{ kind: 'blob', at: [x, y, z], size: [rx, ry,
 * rz] }` filling the box between the top of the trunk and the top of the tree for a round shape, stacked cones
 * `{ kind: 'cone', at: base centre, size: [radius, height] }` for a conical one.
 */
export function crownSolids(tree) {
  const top = tree.height.default;
  const radius = tree.crown_radius;
  const bottom = tree.trunk.height;
  const middle = (bottom + top) / 2;
  const half = (top - bottom) / 2;
  if (tree.shape === 'round') {
    const reach = Math.max(...CLUMPS.flatMap(([x, y, z, r]) => [Math.abs(x) + r, Math.abs(y) + r, Math.abs(z) + r]));
    return CLUMPS.map(([x, y, z, r]) => ({
      kind: 'blob',
      at: [(x * radius) / reach, middle + (y * half) / reach, (z * radius) / reach],
      size: [(r * radius) / reach, (r * half) / reach, (r * radius) / reach],
    }));
  }
  if (tree.shape === 'weeping') return weepingSolids(top, radius, bottom);
  if (tree.shape === 'palm') return palmSolids(top, radius, bottom);
  const step = (2 * half) / TIERS;
  return Array.from({ length: TIERS }, (_, tier) => ({
    kind: 'cone',
    at: [0, bottom + (tier * step * 5) / 6, 0],
    size: [radius * (1 - 0.2 * tier), step * 1.5],
  }));
}

/**
 * A tree of the catalog as the engine lists its species: name in the language of the user, sizes for the default
 * height, and the descriptor itself (`tree`) the geometry and the seasons are read from.
 */
export function treeSpecies(id, tree, lang) {
  return {
    name: localName(tree.name, lang, id),
    kind: 'catalog',
    height: tree.height.default,
    minHeight: tree.height.min,
    maxHeight: tree.height.max,
    crown: tree.crown_radius,
    trunkR: tree.trunk.radius,
    trunk: tree.trunk.color,
    deciduous: !tree.evergreen,
    tree,
  };
}

/** Species id of a variety of a tree of the catalog (`apple-tree:gala`). */
export const varietyId = (id, variety) => `${id}:${variety.id}`;

/** Varieties of a tree that can be told apart: an id and at least one colour, ids not repeated. */
export function treeVarieties(tree) {
  const seen = new Set();
  return (Array.isArray(tree.varieties) ? tree.varieties : []).filter((v) => {
    const ok = v && typeof v.id === 'string' && !seen.has(v.id) && (isHex(v.flowers) || isHex(v.fruits));
    if (ok) seen.add(v.id);
    return ok;
  });
}

const isHex = (c) => /^#[0-9a-f]{6}$/.test(c || '');

/**
 * The tree of a variety: its blossom and fruits take the colours of the variety in every season that shows some
 * (the amounts stay the seasons' own).
 */
export function varietyTree(tree, variety) {
  const seasons = {};
  for (const [name, look] of Object.entries(tree.seasons)) {
    seasons[name] = { ...look };
    for (const key of ['flowers', 'fruits']) {
      if (look[key] && isHex(variety[key])) seasons[name][key] = { ...look[key], color: variety[key] };
    }
  }
  return { ...tree, seasons };
}

/** Shapes of crown the engine draws. */
export const SHAPES_OF_TREES = ['round', 'conical', 'weeping', 'palm'];

/** A descriptor the engine can draw: the fields the geometry reads are there (an entry of a newer format is skipped). */
export function drawableTree(tree) {
  return Boolean(
    tree &&
    SHAPES_OF_TREES.includes(tree.shape) &&
    tree.height &&
    tree.height.default > 0 &&
    tree.crown_radius > 0 &&
    tree.trunk &&
    tree.trunk.radius > 0 &&
    tree.trunk.height >= 0 &&
    tree.trunk.height < tree.height.default &&
    /^#[0-9a-f]{6}$/.test(tree.trunk.color || '') &&
    tree.seasons &&
    tree.seasons.summer &&
    /^#[0-9a-f]{6}$/.test(tree.seasons.summer.foliage || ''),
  );
}

// ---------------------------------------------------------------- objects

const SHAPES = ['box', 'cylinder', 'sphere', 'cone'];
const DEG = Math.PI / 180;

/** Matrix (rows) turning a part: yaw about y, then pitch about x, then roll about z (the `YXZ` order of three.js). */
export function rotationMatrix(yaw = 0, pitch = 0, roll = 0) {
  const [cy, sy] = [Math.cos(yaw * DEG), Math.sin(yaw * DEG)];
  const [cx, sx] = [Math.cos(pitch * DEG), Math.sin(pitch * DEG)];
  const [cz, sz] = [Math.cos(roll * DEG), Math.sin(roll * DEG)];
  return [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
}

/** Lowest and highest corner of the box around the parts of an object, as the checks of the catalog compute it. */
export function objectBounds(parts) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const half = [part.width / 2, part.height / 2, part.depth / 2];
    const centre = [part.x || 0, (part.elevation || 0) + half[1], part.z || 0];
    const m = rotationMatrix(part.yaw, part.pitch, part.roll);
    for (let axis = 0; axis < 3; axis++) {
      const row = m[axis];
      const extent =
        part.shape === 'sphere'
          ? Math.hypot(row[0] * half[0], row[1] * half[1], row[2] * half[2])
          : Math.abs(row[0]) * half[0] + Math.abs(row[1]) * half[1] + Math.abs(row[2]) * half[2];
      low[axis] = Math.min(low[axis], centre[axis] - extent);
      high[axis] = Math.max(high[axis], centre[axis] + extent);
    }
  }
  return { low, high };
}

/** Width, height (from the ground) and depth of an object. */
export function objectSize(parts) {
  const { low, high } = objectBounds(parts);
  return [high[0] - low[0], high[1], high[2] - low[2]];
}

/** A descriptor the engine can draw: every part has a known shape, sizes and a colour. */
export function drawableObject(object) {
  return Boolean(
    object &&
    Array.isArray(object.parts) &&
    object.parts.length > 0 &&
    object.parts.every(
      (part) =>
        part &&
        SHAPES.includes(part.shape) &&
        part.width > 0 &&
        part.height > 0 &&
        part.depth > 0 &&
        /^#[0-9a-f]{6}$/.test(part.color || ''),
    ),
  );
}

/**
 * How a catalog object fits a piece of furniture of the plan: the scale along x, y and z that brings its own size to
 * `size` ([width, height, depth] of the piece). A size the plan does not give keeps the object as it is.
 */
export function fitScale(parts, size) {
  const own = objectSize(parts);
  return own.map((value, axis) => (size && size[axis] > 0 && value > 0 ? size[axis] / value : 1));
}
