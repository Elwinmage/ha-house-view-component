// What a terrace, a patio or a deck is covered with: the coverings the card knows by itself and those of the house
// catalog (`terraces` section, doc/format.md of house-catalog). Pure: no three.js, no DOM, unit-tested.
import { drawableSurface, kindRegistry } from './surface-lib.js';

/** How far a terrace stands over the ground levelled under it when its covering does not say (m). */
export const TERRACE_THICKNESS = 0.05;

/**
 * The coverings the card ships with, enough to lay a terrace before the catalog is read. They carry the ids of the
 * catalog entries they stand for, which replace them once read: a terrace keeps its covering either way.
 */
export const BUILTIN_TERRACES = {
  'wood-decking': {
    draft: '#c29660',
    thickness: 0.12,
    surface: {
      color: '#a07b4f',
      roughness: 0.8,
      tile: 2.4,
      grain: 0.18,
      joints: { color: '#6b5134', cell: [0.15, 2.4], width: 0.007, stagger: 0.5, shade: 0.12 },
    },
  },
  'porcelain-tiles': {
    draft: '#cfd3d6',
    thickness: 0.03,
    surface: {
      color: '#a9a9a4',
      roughness: 0.5,
      tile: 2.4,
      grain: 0.06,
      joints: { color: '#74746f', cell: [0.6, 0.6], width: 0.006, shade: 0.04 },
    },
  },
  'concrete-slab': {
    draft: '#d8d5cf',
    thickness: 0.05,
    surface: { color: '#bfbbb2', roughness: 0.85, tile: 3, grain: 0.12 },
  },
  painted: {
    draft: '#f2f2f2',
    thickness: 0.04,
    surface: { color: '#c8c4bb', roughness: 0.7, tile: 2, grain: 0.05 },
  },
};

/** The covering a new terrace is given. */
export const TERRACE_DEFAULT = 'wood-decking';

/** A covering the card can lay: a painted surface and the colour of its outline in the editor. */
export const drawableTerrace = (entry) => !!entry && drawableSurface(entry.surface);

const registry = kindRegistry(BUILTIN_TERRACES, (entry) => (drawableTerrace(entry) ? entry : null));

/** Take the `terraces` section of the house catalog (an entry replaces the built-in covering of the same id). */
export const setTerraceCatalog = (items, lang) => registry.set(items, lang);
/** Every covering, by id. */
export const terraceKinds = () => registry.all();
/** One covering, by id; null when it is unknown (an entry of a newer catalog, a removed one). */
export const terraceKind = (id) => registry.get(id);
/** The covering a terrace is drawn with: its own, else the usual one, so a terrace is always drawn. */
export const terraceLook = (id) => registry.get(id) || registry.get(TERRACE_DEFAULT);
/** Name of a covering of the catalog, empty for a built-in one (the card translates those itself). */
export const terraceKindName = (id) => registry.name(id);
/** How far a covering stands over the ground. */
export const terraceThickness = (kind) => (kind && kind.thickness > 0 ? kind.thickness : TERRACE_THICKNESS);
