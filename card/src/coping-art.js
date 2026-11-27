// What caps a low wall or a retaining wall: the copings the card knows by itself and those of the house catalog
// (`copings` section, doc/format.md of house-catalog). A wall keeps the capping of its facing (wall-art.js) unless
// it asks for one of these, or for none. Pure: no three.js, no DOM, unit-tested.
import { drawableSurface, isHex, kindRegistry, recolorSurface } from './surface-lib.js';
import { copingOf } from './wall-art.js';

/** What a wall asks for to stay bare, whatever its facing is capped with. */
export const COPING_NONE = 'none';
/** Bounds of the sizes of a coping (m): [least, most, usual]. */
export const COPING_HEIGHT = [0.005, 0.3, 0.05];
export const COPING_OVERHANG = [0, 0.2, 0.03];
export const COPING_DROP = [0, 0.2, 0];

/**
 * The copings the card ships with, enough to cap a wall before the catalog is read. They carry the ids of the
 * catalog entries they stand for, which replace them once read: a wall keeps its coping either way.
 */
export const BUILTIN_COPINGS = {
  'flat-stone': {
    surface: {
      color: '#c9c2b4',
      roughness: 0.9,
      tile: 1.2,
      grain: 0.18,
      joints: { color: '#8f887b', cell: [0.6, 0.6], width: 0.008, shade: 0.1 },
    },
    height: 0.05,
    overhang: 0.03,
  },
  brick: {
    surface: {
      color: '#a5553c',
      roughness: 0.9,
      tile: 0.6,
      grain: 0.14,
      joints: { color: '#c9c0b0', cell: [0.6, 0.075], width: 0.01, shade: 0.16 },
    },
    height: 0.07,
    overhang: 0.01,
  },
  aluminium: {
    surface: { color: '#4f5459', roughness: 0.35, tile: 2, grain: 0.02 },
    height: 0.015,
    overhang: 0.025,
    drop: 0.05,
  },
};

/** A coping the card can draw: a painted surface. */
export const drawableCoping = (entry) => !!entry && drawableSurface(entry.surface);

const registry = kindRegistry(BUILTIN_COPINGS, (entry) => (drawableCoping(entry) ? entry : null));

/** Take the `copings` section of the house catalog (an entry replaces the built-in coping of the same id). */
export const setCopingCatalog = (items, lang) => registry.set(items, lang);
/** Every coping, by id. */
export const copingKinds = () => registry.all();
/** One coping, by id; null when it is unknown. */
export const copingKind = (id) => registry.get(id);
/** Name of a coping of the catalog, empty for a built-in one (shown by its id until the catalog is read). */
export const copingKindName = (id) => registry.name(id);

const within = (value, [least, most, usual]) => (Number.isFinite(value) ? Math.min(most, Math.max(least, value)) : usual);

/** Sizes of a coping of the catalog (m), kept within bounds: { height, overhang, drop }. */
export const copingSizes = (kind) => ({
  height: within(kind && kind.height, COPING_HEIGHT),
  overhang: within(kind && kind.overhang, COPING_OVERHANG),
  drop: within(kind && kind.drop, COPING_DROP),
});

/**
 * What caps a wall: `wall.cap` names a coping ('none': the wall stays bare) and `wall.capc` gives it a colour of
 * the user's own. Without `cap`, or with one that is not known (the catalog not read yet, an entry removed), the
 * wall keeps the capping of its facing `facing`, in that colour when there is one.
 * Returns { id, surface, color, height, overhang, drop } (`surface` null and `id` empty for the plain capping of a
 * facing), or null for a wall without capping.
 */
export function wallCoping(wall, facing) {
  const w = wall || {};
  if (w.cap === COPING_NONE) return null;
  const own = isHex(w.capc) ? w.capc.toLowerCase() : null;
  const kind = w.cap ? registry.get(w.cap) : null;
  if (kind) {
    const surface = own ? recolorSurface(kind.surface, own) : kind.surface;
    return { id: w.cap, surface, color: surface.color, ...copingSizes(kind) };
  }
  const usual = copingOf(facing);
  return usual ? { id: '', surface: null, color: own || usual.color, height: usual.height, overhang: usual.overhang, drop: 0 } : null;
}
