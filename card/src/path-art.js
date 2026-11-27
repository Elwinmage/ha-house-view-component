// What a drive or a garden path is made of: the kinds the card knows by itself and those of the house catalog
// (`paths` section, doc/format.md of house-catalog), and the geometry of a modular path (stepping stones,
// sleepers, log rounds). Pure: no three.js, no DOM, unit-tested. The same reading as the previews of the catalog
// (scripts/render_previews.py there), so a path looks here like the picture of its entry.
import { localName } from './catalog-lib.js';
import { shadeHex } from './surface-lib.js';

/** The kinds the card ships with: the surfaces it drew before the catalog had a section of its own. */
export const BUILTIN_PATHS = {
  asphalt: {
    kind: 'surface',
    draft: '#7a7f88',
    width: { default: 3, min: 0.8, max: 12 },
    surface: {
      color: '#4b4e53',
      roughness: 0.75,
      tile: 2,
      grain: 0.35,
      speckles: [
        { color: '#3e4146', amount: 0.09, size: 0.02 },
        { color: '#5a5d63', amount: 0.07, size: 0.016 },
        { color: '#64676c', amount: 0.04, size: 0.014 },
      ],
    },
  },
  gravel: {
    kind: 'surface',
    draft: '#e0d3b4',
    width: { default: 3, min: 0.5, max: 12 },
    surface: {
      color: '#bdb29c',
      roughness: 1,
      tile: 2,
      grain: 0.4,
      speckles: [
        { color: '#a99d86', amount: 0.12, size: 0.026 },
        { color: '#d2c8b3', amount: 0.12, size: 0.026 },
        { color: '#8f846f', amount: 0.1, size: 0.026 },
        { color: '#e3dccb', amount: 0.08, size: 0.026 },
      ],
    },
  },
  concrete: {
    kind: 'surface',
    draft: '#d8d5cf',
    width: { default: 3, min: 0.6, max: 12 },
    surface: {
      color: '#bfbbb2',
      roughness: 0.85,
      tile: 4,
      grain: 0.12,
      speckles: [
        { color: '#b2aea5', amount: 0.03, size: 0.011 },
        { color: '#cac6be', amount: 0.03, size: 0.011 },
      ],
      joints: { color: '#9a968e', cell: [2, 2], width: 0.01, shade: 0.02 },
    },
  },
  pavers: {
    kind: 'surface',
    draft: '#c99a7b',
    width: { default: 3, min: 0.6, max: 12 },
    surface: {
      color: '#a3816b',
      roughness: 0.9,
      tile: 2,
      grain: 0.1,
      joints: { color: '#5e4a3d', cell: [0.2, 0.1], width: 0.016, stagger: 0.5, shade: 0.2 },
    },
  },
  dirt: {
    kind: 'surface',
    draft: '#b8915f',
    width: { default: 3, min: 0.6, max: 12 },
    surface: {
      color: '#957650',
      roughness: 1,
      tile: 2,
      grain: 0.45,
      speckles: [
        { color: '#86684a', amount: 0.12, size: 0.034 },
        { color: '#a5845c', amount: 0.12, size: 0.034 },
        { color: '#7a5d40', amount: 0.1, size: 0.034 },
      ],
    },
  },
  tracks: {
    kind: 'surface',
    draft: '#8fbf5a',
    width: { default: 3, min: 1.2, max: 10 },
    surface: {
      color: '#6f8f4a',
      roughness: 1,
      tile: 2,
      grain: 0.3,
      speckles: [
        { color: '#5f7f3d', amount: 0.1, size: 0.024 },
        { color: '#7fa055', amount: 0.1, size: 0.024 },
        { color: '#668a43', amount: 0.08, size: 0.024 },
      ],
      wheels: {
        color: '#8d7150',
        bands: [
          [0.12, 0.36],
          [0.64, 0.88],
        ],
        speckles: [
          { color: '#76593b', amount: 0.08, size: 0.022 },
          { color: '#a3865f', amount: 0.08, size: 0.022 },
        ],
      },
    },
  },
};

/** Shapes a modular path sets along its line; anything else is drawn as a disc. */
export const ELEMENT_SHAPES = ['round', 'half-moon', 'slab', 'oval', 'stone'];
/** Points on the outline of a round, an oval or a stone element. */
const ROUND_STEPS = 36;
/** Corner radius of a slab, as a share of its smaller side. */
const SLAB_CORNER = 0.18;

const KINDS = { ...BUILTIN_PATHS };
const NAMES = {};

/** A path the card can draw: a surface with a colour, or modules with a shape, a size and a colour. */
export function drawablePath(p) {
  if (!p || (p.kind !== 'surface' && p.kind !== 'module')) return false;
  if (p.kind === 'surface') return !!(p.surface && typeof p.surface.color === 'string');
  const m = p.module;
  return !!(
    m &&
    Array.isArray(m.shapes) &&
    m.shapes.length &&
    Array.isArray(m.size) &&
    m.size[0] > 0 &&
    m.size[1] > 0 &&
    Array.isArray(m.colors) &&
    m.colors.length
  );
}

/**
 * Take the `paths` section of the house catalog: its entries join the kinds the card knows, an entry replacing the
 * built-in kind of the same id. Entries the card cannot read (a newer format) are left out.
 */
export function setPathCatalog(items = {}, lang = 'en') {
  for (const key of Object.keys(KINDS)) delete KINDS[key];
  for (const key of Object.keys(NAMES)) delete NAMES[key];
  Object.assign(KINDS, BUILTIN_PATHS);
  for (const id of Object.keys(items).sort()) {
    const entry = items[id];
    if (!drawablePath(entry)) continue;
    KINDS[id] = entry;
    NAMES[id] = localName(entry.name, lang, '');
  }
}

/** Every kind the card can lay, by id. */
export const pathKinds = () => KINDS;
/** One kind, by id; `null` when it is unknown (an entry of a newer catalog, a removed one). */
export const pathKind = (id) => KINDS[id] || null;
/** Name of a kind of the catalog, empty for a built-in one (the card translates those itself). */
export const pathKindName = (id) => NAMES[id] || '';
/** Width offered for a kind: its own bounds, else the ones of the card. */
export const pathWidth = (def, fallback) =>
  def && def.width && def.width.min > 0 && def.width.max >= def.width.min ? def.width : fallback;

/** A colour lightened (factor above 1) or darkened: shared by every painted surface. */
export { shadeHex };

// ---------------------------------------------------------------- modular paths

/**
 * Outline of one element, centred on the origin: `along` the path by `across` it, as [[along, across], ...].
 * A half-moon is a disc of the width of the path cut through the middle, so half as deep as it is wide.
 */
export function elementOutline(shape, along, across, rand) {
  const a = along / 2;
  const c = across / 2;
  if (shape === 'half-moon') {
    const steps = ROUND_STEPS / 2;
    return Array.from({ length: steps + 1 }, (_, k) => [c * (Math.sin((Math.PI * k) / steps) - 0.5), c * Math.cos((Math.PI * k) / steps)]);
  }
  if (shape === 'slab') {
    const corner = Math.min(along, across) * SLAB_CORNER;
    const out = [];
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const cx = sx * (a - corner);
      const cy = sy * (c - corner);
      const start = Math.atan2(sy, sx) - Math.PI / 4;
      for (let k = 0; k < 5; k++) {
        const angle = start + (Math.PI / 2) * (k / 4);
        out.push([cx + corner * Math.cos(angle), cy + corner * Math.sin(angle)]);
      }
    }
    return out;
  }
  const jitter = shape === 'stone';
  return Array.from({ length: ROUND_STEPS }, (_, k) => {
    const angle = (2 * Math.PI * k) / ROUND_STEPS;
    const reach = jitter ? 0.76 + rand() * 0.34 : 1;
    return [a * reach * Math.cos(angle), c * reach * Math.sin(angle)];
  });
}

/**
 * The elements of a modular path `length` m long on a path `width` m wide: where each sits along the line (`d`),
 * its size (`a` along, `c` across), how far it is turned (`angle`, radians) and set off the line (`side`, m), its
 * shape and its colour. Drawn from `rand` (0..1), so the same path keeps its look.
 */
export function pathElements(module, length, width, rand) {
  const [along, across] = module.size;
  const gap = Number.isFinite(module.gap) ? module.gap : 0.2;
  const vary = module.vary || {};
  const pick = (key, fallback) => (Number.isFinite(vary[key]) ? vary[key] : fallback);
  const sized = pick('size', 0.15);
  const turn = pick('angle', 0.08);
  const sideways = pick('side', 0.1);
  const spread = pick('shade', 0.08);
  const between = (amount) => (rand() * 2 - 1) * amount;
  const out = [];
  for (let d = along / 2; d - along / 2 < length;) {
    const scale = 1 + between(sized);
    const a = along * scale;
    const c = Math.min(across * scale, width);
    const angle = between(turn) * 2 * Math.PI;
    const side = between(sideways) * c;
    const color = shadeHex(module.colors[Math.floor(rand() * module.colors.length) % module.colors.length], 1 + between(spread));
    const shape = module.shapes[Math.floor(rand() * module.shapes.length) % module.shapes.length];
    out.push({ d, a, c, angle, side, shape, color });
    d += a / 2 + gap + along / 2;
  }
  return out;
}

/**
 * Where a polyline is `d` m from its start: { x, z, cos, sin } (cos, sin: the heading there). Past its end it keeps
 * going straight ahead; `null` for a line of less than two points.
 */
export function pointAt(center, d) {
  if (!center || center.length < 2) return null;
  let run = 0;
  for (let i = 1; i < center.length; i++) {
    const [x0, z0] = center[i - 1];
    const [x1, z1] = center[i];
    const step = Math.hypot(x1 - x0, z1 - z0);
    if (!step) continue;
    if (run + step >= d || i === center.length - 1) {
      const t = (d - run) / step;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, cos: (x1 - x0) / step, sin: (z1 - z0) / step };
    }
    run += step;
  }
  return null;
}
