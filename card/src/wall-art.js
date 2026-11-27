// What a low wall or a retaining wall is faced with: the facings the card knows by itself and those of the house
// catalog (`walls` section, doc/format.md of house-catalog). Pure: no three.js, no DOM, unit-tested.
import { drawableSurface, isHex, kindRegistry } from './surface-lib.js';

/**
 * The facings the card ships with: `masonry`, the plain grey every wall had before they could be chosen, and two
 * that carry the ids of the catalog entries they stand for, which replace them once read.
 */
export const BUILTIN_WALLS = {
  masonry: {
    draft: '#ff9f43',
    surface: { color: '#a39a8b', roughness: 0.95, tile: 2, grain: 0.12 },
  },
  render: {
    draft: '#ffe9b8',
    surface: { color: '#e3d9c6', roughness: 0.9, tile: 2, grain: 0.1 },
    coping: { color: '#c9c2b4', height: 0.05, overhang: 0.03 },
  },
  'dry-stone': {
    draft: '#c7b99b',
    surface: {
      color: '#9c9382',
      roughness: 1,
      tile: 2.24,
      grain: 0.3,
      joints: { color: '#4d483f', cell: [0.14, 0.34], width: 0.012, stagger: 0.5, shade: 0.22, vary: 0.5 },
    },
  },
};

/** The facing of a wall that names none: the walls drawn before the facings existed keep their look. */
export const WALL_DEFAULT = 'masonry';

/** A facing the card can draw: a painted surface. */
export const drawableWall = (entry) => !!entry && drawableSurface(entry.surface);

const registry = kindRegistry(BUILTIN_WALLS, (entry) => (drawableWall(entry) ? entry : null));

/** Take the `walls` section of the house catalog (an entry replaces the built-in facing of the same id). */
export const setWallCatalog = (items, lang) => registry.set(items, lang);
/** Every facing, by id. */
export const wallKinds = () => registry.all();
/** One facing, by id; the plain masonry when it is unknown, so a wall is always drawn. */
export const wallKind = (id) => registry.get(id) || registry.get(WALL_DEFAULT);
/** A facing is known under this id. */
export const hasWallKind = (id) => !!registry.get(id);
/** Name of a facing of the catalog, empty for a built-in one (the card translates those itself). */
export const wallKindName = (id) => registry.name(id);

/** Capping of a facing: { color, height, overhang } with the usual sizes filled in, or null when it has none. */
export function copingOf(kind) {
  const c = kind && kind.coping;
  if (!c || !isHex(c.color)) return null;
  return { color: c.color, height: c.height > 0 ? c.height : 0.05, overhang: c.overhang >= 0 ? c.overhang : 0.03 };
}
