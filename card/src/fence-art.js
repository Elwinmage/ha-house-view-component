// Kinds of fences: the ones the card knows by itself and those of the house catalog (`fences` section,
// doc/format.md of house-catalog). Pure: no three.js, no DOM, unit-tested.
//
// A kind, as the card uses it: h (usual height, m) and hMin / hMax (the bounds offered); color (built colour);
// draft (colour of a side in the overlay of the editor: how the kinds are told apart while a fence is edited);
// thick (thickness, m; 0 a sheet); posts (their colour), postSpacing, postSize; bumpy (a hedge); opacity and open
// ({ pattern, pitch, fill }) for a see-through fence; surface (the painted texture of a solid one); cap (a wall
// that may carry a coping: see coping-art.js).
import { OPEN_PATTERNS, drawableSurface, isHex, kindRegistry } from './surface-lib.js';

/** The kinds the card ships with: the fences it drew before the catalog had a section of its own. */
export const BUILTIN_FENCES = {
  mesh: { h: 1.5, color: '#5f7d5c', draft: '#ff2bd6', thick: 0, opacity: 0.38, posts: '#3d4a3c' },
  wood: { h: 1.8, color: '#8a6a48', draft: '#ff9f1a', thick: 0.04, posts: '#5a4330' },
  wall: { h: 1.2, color: '#d8cfc0', draft: '#2f8fff', thick: 0.2, cap: true },
  hedge: { h: 1.8, color: '#3f6b35', draft: '#b8ff3b', thick: 0.6, bumpy: true },
  // hedges by species: height, colour of the foliage and thickness (the generic `hedge` stays for the fences of before)
  hedge_laurel: { h: 1.8, color: '#2f6b2f', draft: '#7bd62a', thick: 0.7, bumpy: true }, // cherry laurel (laurier-palme)
  hedge_thuja: { h: 2.0, color: '#2d5a2e', draft: '#3fbf6e', thick: 0.8, bumpy: true }, // thuja (thuya)
  hedge_leyland: { h: 2.5, color: '#35603a', draft: '#2fa68f', thick: 1.0, bumpy: true }, // Leyland cypress
  hedge_hornbeam: { h: 1.8, color: '#6f8f3a', draft: '#d6e83b', thick: 0.5, bumpy: true }, // hornbeam (charmille)
  hedge_photinia: { h: 1.8, color: '#8a4a3c', draft: '#ff6f61', thick: 0.7, bumpy: true }, // red-tipped photinia
  hedge_privet: { h: 1.5, color: '#4a7a3a', draft: '#a5d86e', thick: 0.5, bumpy: true }, // privet (troène)
  hedge_bamboo: { h: 2.5, color: '#8aa83a', draft: '#c5e63a', thick: 0.5, bumpy: true }, // bamboo
  hedge_box: { h: 0.6, color: '#355f3a', draft: '#47d1a3', thick: 0.4, bumpy: true }, // box (buis), low
  hedge_wild: { h: 1.6, color: '#5f7f3a', draft: '#8fd13b', thick: 1.0, bumpy: true }, // mixed country hedge (haie champêtre)
  // other fences
  iron: { h: 1.5, color: '#26272a', draft: '#9b8cff', thick: 0, opacity: 0.5, posts: '#1c1c1e' }, // wrought iron bars
  panel: { h: 1.2, color: '#3a3f44', draft: '#ff4fa3', thick: 0, opacity: 0.45, posts: '#2b2f33' }, // rigid welded panels
  reed: { h: 1.5, color: '#c9a45c', draft: '#ffd34f', thick: 0.02, posts: '#6f5a35' }, // reed screen (canisse)
  composite: { h: 1.8, color: '#6f6a63', draft: '#7fd1ff', thick: 0.04, posts: '#4a4640' }, // composite slats
  gabion: { h: 1.0, color: '#8a8780', draft: '#4fe0e0', thick: 0.3 }, // stone-filled wire cages
  none: { h: 0, color: null, draft: '#ffffff' }, // opening: gate, passage, side closed by the house
};

/** The side left open: never a catalog entry, always there. */
export const NO_FENCE = 'none';
/** Distance between two posts, and their side, when a kind does not say (m). */
export const POST_SPACING = 2.5;
export const POST_SIZE = 0.07;
/** Lowest and highest fence offered when a kind gives no bounds (m). */
export const FENCE_H = [0.3, 4];
/** Thinnest wall a coping can sit on (m). */
export const CAP_THICK = 0.1;
/** The walls that carry a coping in the catalogs written before an entry could say so (`coping`). */
const CAPPED_BEFORE = new Set(['wall', 'wall_brick']);

/**
 * A fence of the catalog as the card uses it, or null when it cannot be drawn: no colour, no height, or a
 * see-through pattern of a newer format.
 */
export function readFence(entry, id) {
  if (id === NO_FENCE || !entry || !drawableSurface(entry.surface) || !isHex(entry.draft)) return null;
  const H = entry.height;
  if (!H || !(H.default > 0)) return null;
  if (entry.open && !OPEN_PATTERNS.includes(entry.open.pattern)) return null;
  const S = entry.surface;
  const out = {
    h: H.default,
    hMin: H.min > 0 ? H.min : FENCE_H[0],
    hMax: H.max >= H.default ? H.max : Math.max(FENCE_H[1], H.default),
    color: S.color,
    draft: entry.draft,
    thick: entry.thickness > 0 ? entry.thickness : 0,
  };
  if (entry.open) {
    const fill = entry.open.fill > 0 ? entry.open.fill : 0.35;
    out.open = { pattern: entry.open.pattern, pitch: entry.open.pitch > 0 ? entry.open.pitch : 0.1, fill };
    out.opacity = fill;
    out.thick = 0; // wires hang in a plane
  } else if (S.joints || (S.speckles && S.speckles.length) || S.grain > 0) out.surface = S;
  if (entry.posts && isHex(entry.posts.color)) {
    out.posts = entry.posts.color;
    out.postSpacing = entry.posts.spacing > 0 ? entry.posts.spacing : POST_SPACING;
    out.postSize = entry.posts.size > 0 ? entry.posts.size : POST_SIZE;
  }
  if (entry.foliage && !entry.open) out.bumpy = true;
  // a coping sits on masonry: a wall thick enough, neither wires nor foliage
  const capped = typeof entry.coping === 'boolean' ? entry.coping : CAPPED_BEFORE.has(id);
  if (capped && !out.open && !out.bumpy && out.thick >= CAP_THICK) out.cap = true;
  return out;
}

const registry = kindRegistry(BUILTIN_FENCES, readFence);

/** Take the `fences` section of the house catalog (an entry replaces the built-in kind of the same id). */
export const setFenceCatalog = (items, lang) => registry.set(items, lang);
/** Every kind, by id: the same object all along, so it is imported once (FENCE_TYPES in fences.js). */
export const fenceKinds = () => registry.all();
/** One kind, by id; null when it is unknown. */
export const fenceKind = (id) => registry.get(id);
/** Name of a kind of the catalog, empty for a built-in one (the card translates those itself). */
export const fenceKindName = (id) => registry.name(id);
/** Heights offered for a kind: [lowest, highest]. */
export const fenceBounds = (kind) => [kind && kind.hMin > 0 ? kind.hMin : FENCE_H[0], kind && kind.hMax > 0 ? kind.hMax : FENCE_H[1]];

/**
 * The kinds in the order the palette shows them: [[family, [id, ...]], ...] with the families `fence` (posts,
 * panels, walls), `hedge` and `open` (the side left without a fence), each sorted by `label(id)`.
 */
export function fenceGroups(label = (id) => id) {
  const kinds = fenceKinds();
  const ids = Object.keys(kinds)
    .filter((id) => id !== NO_FENCE)
    .sort((a, b) => label(a).localeCompare(label(b)));
  return [
    ['fence', ids.filter((id) => !kinds[id].bumpy)],
    ['hedge', ids.filter((id) => kinds[id].bumpy)],
    ['open', [NO_FENCE]],
  ].filter(([, list]) => list.length);
}
