// Painted surfaces of the house catalog (doc/format.md there, "Painted surfaces"): what a terrace, the facing of a
// wall or a fence is made of is a few numbers, read here. Pure: no three.js, no DOM, unit-tested. The painting
// itself (canvas, textures) is in surface-art.js; scripts/render_previews.py of house-catalog is the reference.
import { localName } from './catalog-lib.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour written `#rrggbb`. */
export const isHex = (c) => HEX.test(c || '');

const hex2 = (v) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0');
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A colour lightened (factor above 1) or darkened. */
export function shadeHex(hex, factor) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  return `#${hex2(((n >> 16) & 255) * factor)}${hex2(((n >> 8) & 255) * factor)}${hex2((n & 255) * factor)}`;
}

/** A surface the card can paint: an object with a base colour. */
export const drawableSurface = (S) => !!S && typeof S === 'object' && isHex(S.color);

/** Metres covered by one tile of the texture of a surface. */
export const tileOf = (S, fallback = 2) => (S && S.tile > 0 ? S.tile : fallback);

/**
 * The same surface in a colour of the user's own: the base colour is replaced, and every grain keeps its contrast
 * with it (each channel is shifted as the base colour was), so a stained deck still shows its grain, and so do the
 * units of another tint. The joints are mortar or shadow: they keep their colour.
 */
export function recolorSurface(S, color) {
  if (!drawableSurface(S) || !isHex(color) || color.toLowerCase() === S.color.toLowerCase()) return S;
  const from = channels(S.color);
  const to = channels(color);
  const shift = (hex) =>
    isHex(hex)
      ? `#${channels(hex)
          .map((v, i) => hex2(from[i] > 0 ? (v * to[i]) / from[i] : to[i] + (v - from[i])))
          .join('')}`
      : hex;
  const out = { ...S, color: color.toLowerCase() };
  if (Array.isArray(S.speckles)) out.speckles = S.speckles.map((g) => ({ ...g, color: shift(g.color) }));
  // the stones of another colour stay as far from the others as they were
  if (S.joints && Array.isArray(S.joints.tints))
    out.joints = { ...S.joints, tints: S.joints.tints.map((tint) => ({ ...tint, color: shift(tint.color) })) };
  return out;
}

/** A text that changes whenever the look of a surface does: the key its texture is kept under. */
export const surfaceKey = (S) => JSON.stringify(S);

// ---------------------------------------------------------------- seeded noise

/** A number from a text, so that a kind or an object keeps the same look. */
export function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Seeded noise (0..1): the same picture every time. */
export function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- units of a laid surface

/**
 * The units of one row of a laid surface, `width` wide: [[x, length], ...] from left to right. `across` is the
 * usual length of a unit, `shift` how far the row is set off (a staggered bond). With `vary` the lengths are drawn
 * first, then fitted to the row, and the row is laid twice over: what the shift pushes out on the right comes back
 * on the left, so a texture laid in tiles still joins up.
 */
export function rowUnits(width, across, shift, vary, rand) {
  const out = [];
  if (!(across > 0) || !(width > 0)) return out;
  const start = -across + shift;
  if (!(vary > 0)) {
    for (let x = start; x < width; x += across) out.push([x, across]);
    return out;
  }
  const count = Math.max(1, Math.round(width / across));
  const lengths = Array.from({ length: count }, () => 1 + (rand() * 2 - 1) * vary);
  const fit = width / lengths.reduce((a, b) => a + b, 0);
  let x = start;
  for (const length of [...lengths, ...lengths]) {
    out.push([x, length * fit]);
    x += length * fit;
  }
  return out;
}

/** The colour of one unit: one of the `tints` for its share of the units, else the base colour. */
export function unitColor(base, tints, rand) {
  if (!Array.isArray(tints) || !tints.length) return base;
  let pick = rand();
  for (const tint of tints) {
    pick -= tint.amount > 0 ? tint.amount : 0;
    if (pick < 0) return isHex(tint.color) ? tint.color : base;
  }
  return base;
}

// ---------------------------------------------------------------- irregular stones

// Stones of uneven shapes fitted into one another, without rows (`pattern: 'irregular'`): a wall of stones as they
// came, a crazy paving. The same steps and numbers as scripts/render_previews.py of house-catalog.

/** Share of the stones left out at `vary` 1: their neighbours grow into larger blocks. */
export const STONE_DROP = 0.3;
/** How far a corner is pulled towards the middle of its stone at `vary` 1. */
export const STONE_PULL = 0.14;
/** How far along its sides a corner is rounded, and in how many steps. */
export const STONE_CORNER = 0.14;
export const STONE_CORNER_STEPS = 2;
/** The shortest side a stone keeps, as a share of its size: a shorter one would show as a notch. */
export const STONE_SHORT = 0.35;
/** A stone that bulges, at `relief` 1: how much darker its rim is, how wide, and how far up and left its face sits. */
export const RELIEF_SHADE = 0.4;
export const RELIEF_RIM = 0.24;
export const RELIEF_SHIFT = 0.6;

/**
 * Middles of the stones of an irregular surface, as shares of its width and height: one to a square of a grid
 * `cols` by `rows`, every other row set off by half a square (no joint runs straight up the wall), each moved about
 * by `vary`. Some are left out, the more so as `vary` grows: their neighbours take their place. The middles wrap
 * around, so the surface joins up with itself on all four sides.
 */
export function stoneSites(cols, rows, vary, rand) {
  const sites = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5 + (row % 2) * 0.5 + (rand() - 0.5) * vary) / cols;
      const y = (row + 0.5 + (rand() - 0.5) * vary) / rows;
      if (rand() < vary * STONE_DROP) continue;
      sites.push([((x % 1) + 1) % 1, ((y % 1) + 1) % 1]);
    }
  return sites.length ? sites : [[0.5, 0.5]];
}

/** The part of a convex polygon on the near side of a line: x * nx + y * ny <= limit. */
export function clipPolygon(polygon, nx, ny, limit) {
  const out = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const da = a[0] * nx + a[1] * ny - limit;
    const db = b[0] * nx + b[1] * ny - limit;
    if (da <= 0) out.push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return out;
}

/**
 * The stone around each middle: [{ middle: [x, y], corners: [[x, y], ...] }, ...] in pixels. A stone is all that
 * lies nearer to its middle than to any other, less half a joint on every side, so the stones fit into one another
 * whatever their shapes. The surface repeats on all sides: the stones of an edge are cut by those of the opposite
 * one. A joint wider than a stone leaves no stone at all.
 */
export function stoneCells(sites, width, height, gap) {
  const points = sites.map(([x, y]) => [x * width, y * height]);
  const around = [];
  for (const [x, y] of points) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) around.push([x + dx * width, y + dy * height]);
  const cells = [];
  for (const [px, py] of points) {
    const reach = width + height;
    let polygon = [
      [px - reach, py - reach],
      [px + reach, py - reach],
      [px + reach, py + reach],
      [px - reach, py + reach],
    ];
    const others = around.map(([qx, qy]) => [Math.hypot(qx - px, qy - py), qx, qy]).sort((a, b) => a[0] - b[0]);
    for (const [dist, qx, qy] of others) {
      if (dist < 1e-9) continue; // the middle itself
      // too far away to cut anything off, and so are the next ones
      if ((dist - gap) / 2 > Math.max(...polygon.map(([x, y]) => Math.hypot(x - px, y - py)))) break;
      const nx = (qx - px) / dist;
      const ny = (qy - py) / dist;
      polygon = clipPolygon(polygon, nx, ny, px * nx + py * ny + (dist - gap) / 2);
      if (polygon.length < 3) break;
    }
    if (polygon.length >= 3) cells.push({ middle: [px, py], corners: polygon });
  }
  return cells;
}

/**
 * The outline of a stone, from the corners of its cell: the sides too short to show are dropped, each corner is
 * pulled a little towards the middle, by as much as `vary` says (the joints open unevenly, as between stones that
 * were not cut), then the corners are rounded.
 */
export function stoneOutline(corners, middle, vary, rand) {
  const [cx, cy] = middle;
  const size = corners.reduce((sum, [x, y]) => sum + Math.hypot(x - cx, y - cy), 0) / corners.length;
  const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const kept = [];
  for (const corner of corners) {
    if (kept.length && apart(corner, kept[kept.length - 1]) < size * STONE_SHORT) continue; // the end of a side too short to show
    kept.push(corner);
  }
  if (kept.length > 3 && apart(kept[0], kept[kept.length - 1]) < size * STONE_SHORT) kept.pop();
  const pulled = kept.map(([x, y]) => {
    const k = rand() * vary * STONE_PULL;
    return [x + (cx - x) * k, y + (cy - y) * k];
  });
  const out = [];
  pulled.forEach(([vx, vy], i) => {
    const [px, py] = pulled[(i + pulled.length - 1) % pulled.length];
    const [qx, qy] = pulled[(i + 1) % pulled.length];
    const ax = vx + (px - vx) * STONE_CORNER;
    const ay = vy + (py - vy) * STONE_CORNER;
    const bx = vx + (qx - vx) * STONE_CORNER;
    const by = vy + (qy - vy) * STONE_CORNER;
    for (let step = 0; step <= STONE_CORNER_STEPS; step++) {
      const t = step / STONE_CORNER_STEPS;
      const u = 1 - t;
      out.push([u * u * ax + 2 * u * t * vx + t * t * bx, u * u * ay + 2 * u * t * vy + t * t * by]);
    }
  });
  return out;
}

/**
 * The lit face of a stone that bulges out of the wall: its outline drawn in towards a point up and left of the
 * middle. What is left around it, wider below and on the right, is the rim in shade.
 */
export function stoneFace(outline, middle, relief) {
  const [cx, cy] = middle;
  let room = Infinity; // from the middle to the nearest side
  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > 1e-9) room = Math.min(room, Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / length);
  });
  const shift = Number.isFinite(room) ? (room * RELIEF_SHIFT) / Math.SQRT2 : 0;
  const ox = cx - shift;
  const oy = cy - shift;
  const k = 1 - RELIEF_RIM * relief;
  return outline.map(([x, y]) => [ox + (x - ox) * k, oy + (y - oy) * k]);
}

/**
 * How many stones an irregular surface holds across a sheet `width` by `height` pixels, their usual size being
 * `across` by `along`: [cols, rows], the rows in even number (set off one from the next, they wrap around).
 */
export const stoneGrid = (width, height, across, along) => [
  Math.max(1, Math.round(width / across)),
  Math.max(2, 2 * Math.round(height / along / 2)),
];

// ---------------------------------------------------------------- see-through fences

/** Upright wires between two level ones on a welded panel. */
export const GRID_RATIO = 4;
/** Where the two rails of a fence of bars sit, as shares of its height. */
export const RAILS = [0.14, 0.86];

/**
 * The wires or bars of a see-through fence over a sheet `width` by `height` (pixels, `pxPerM` of them in a metre):
 * [{ x0, y0, x1, y1, w }, ...]. `fill` is the share of the sheet they cover: a mesh and a grid are made of two sets
 * of wires, so each wire is half as wide as a bar would be.
 */
export function openLines(open, width, height, pxPerM) {
  const pitch = (open.pitch > 0 ? open.pitch : 0.1) * pxPerM;
  const fill = open.fill > 0 ? open.fill : 0.35;
  const lines = [];
  if (open.pattern === 'mesh') {
    const w = (pitch * fill) / 2;
    for (let x = -height; x < width + height; x += pitch * Math.SQRT2) {
      lines.push({ x0: x, y0: 0, x1: x + height, y1: height, w });
      lines.push({ x0: x + height, y0: 0, x1: x, y1: height, w });
    }
    return lines;
  }
  if (open.pattern === 'grid') {
    const w = (pitch * fill) / 2;
    for (let x = 0; x <= width + 1e-9; x += pitch) lines.push({ x0: x, y0: 0, x1: x, y1: height, w });
    for (let y = height; y >= -1e-9; y -= pitch * GRID_RATIO) lines.push({ x0: 0, y0: y, x1: width, y1: y, w });
    return lines;
  }
  const w = pitch * fill;
  for (let x = pitch / 2; x < width; x += pitch) lines.push({ x0: x, y0: 0, x1: x, y1: height, w });
  for (const share of RAILS) lines.push({ x0: 0, y0: height * share, x1: width, y1: height * share, w });
  return lines;
}

/** Patterns of see-through fence the card draws. */
export const OPEN_PATTERNS = ['mesh', 'grid', 'bars'];

// ---------------------------------------------------------------- kinds: the card's own, then the catalog's

/**
 * A family of kinds (terrace coverings, wall facings, fences): the ones the card ships with, and the entries of
 * its section of the house catalog over them, an entry replacing the built-in kind of the same id. `read(entry,
 * id)` turns an entry into what the card uses, or null when it cannot be drawn (a newer format): it is left out.
 * Returns { set(items, lang), all(), get(id), name(id) }.
 */
export function kindRegistry(builtin, read = (entry) => entry) {
  const kinds = { ...builtin };
  const names = {};
  return {
    set(items = {}, lang = 'en') {
      for (const key of Object.keys(kinds)) delete kinds[key];
      for (const key of Object.keys(names)) delete names[key];
      Object.assign(kinds, builtin);
      for (const id of Object.keys(items || {}).sort()) {
        const kind = read(items[id], id);
        if (!kind) continue;
        kinds[id] = kind;
        names[id] = localName(items[id].name, lang, '');
      }
    },
    /** Every kind, by id (the same object all along: it can be imported once). */
    all: () => kinds,
    get: (id) => kinds[id] || null,
    /** Name of a kind of the catalog, empty for a built-in one (the card translates those itself). */
    name: (id) => names[id] || '',
  };
}
