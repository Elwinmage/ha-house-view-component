// Painting of the surfaces of the house catalog on a canvas, and the textures made of them: a path, a terrace, the
// facing of a wall and a fence all read the same numbers (surface-lib.js), so an entry added to the catalog looks
// like itself without a line of code here. Browser only: outside one (the tests) there is no canvas, every
// function returns null and the views fall back on plain colours.
import * as THREE from 'three';
import {
  RELIEF_SHADE,
  hashString,
  noise,
  openLines,
  rowUnits,
  shadeHex,
  stoneCells,
  stoneFace,
  stoneGrid,
  stoneOutline,
  stoneSites,
  surfaceKey,
  tileOf,
  unitColor,
} from './surface-lib.js';

export const TEX_N = 256; // side of a texture tile, in pixels
export const TEX_M = 2; // meters covered by one tile when the surface does not say
const GRAIN_SPREAD = 0.17; // how strongly `grain` lightens and darkens the pixels of a surface
const OPEN_PITCHES = 8; // wires or bars of a see-through fence across one tile of its texture
const MESH_PITCHES = 6; // diamonds of a wire mesh across one tile (their diagonal is a pitch times the root of two)

/** A canvas `w` by `h` pixels and its 2D context, or null outside a browser. */
export function canvasOf(w = TEX_N, h = w) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

/** Grains, chippings or pebbles of a surface, scattered over the whole tile or over one band of it. */
export function paintSpeckles(g, speckles, px, rand, { x = 0, w = TEX_N } = {}) {
  for (const grain of speckles || []) {
    const stretch = grain.stretch > 1 ? grain.stretch : 1;
    const radius = Math.max(0.6, (grain.size * px) / 2);
    const count = Math.round((grain.amount * w * TEX_N) / (Math.PI * radius * radius));
    g.fillStyle = grain.color;
    for (let i = 0; i < count; i++) {
      const cx = x + rand() * w;
      const cy = rand() * TEX_N;
      const r = (radius * (0.6 + rand() * 0.8)) / Math.sqrt(stretch);
      g.beginPath();
      if (stretch === 1) g.arc(cx, cy, r, 0, Math.PI * 2);
      else g.ellipse(cx, cy, r * stretch, r, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function fillPolygon(g, points, dx, dy) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
  g.closePath();
  g.fill();
}

/**
 * Stones of uneven shapes and sizes fitted into one another over their bed (`pattern: 'irregular'`): `cell` is
 * their usual size (height, then length), `vary` how uneven they are, `relief` how much they bulge. The tile joins
 * up with itself on all sides: a stone that goes over an edge comes back on the opposite one.
 */
export function paintStones(g, joints, color, px, rand) {
  const along = joints.cell[0] * px;
  const across = joints.cell[1] * px;
  const gap = Math.max(1, (joints.width > 0 ? joints.width : 0.015) * px);
  const spread = Number.isFinite(joints.shade) ? joints.shade : 0.08;
  const vary = joints.vary > 0 ? joints.vary : 0;
  const relief = joints.relief > 0 ? joints.relief : 0;
  const [cols, rows] = stoneGrid(TEX_N, TEX_N, across, along);
  for (const { middle, corners } of stoneCells(stoneSites(cols, rows, vary, rand), TEX_N, TEX_N, gap)) {
    const own = unitColor(color, joints.tints, rand);
    const factor = 1 + (rand() * 2 - 1) * spread;
    const outline = stoneOutline(corners, middle, vary, rand);
    const face = relief ? stoneFace(outline, middle, relief) : null;
    const xs = outline.map(([x]) => x);
    const ys = outline.map(([, y]) => y);
    for (const dx of [-TEX_N, 0, TEX_N])
      for (const dy of [-TEX_N, 0, TEX_N]) {
        // only the copies that show on the tile
        if (Math.max(...xs) + dx < 0 || Math.min(...xs) + dx > TEX_N || Math.max(...ys) + dy < 0 || Math.min(...ys) + dy > TEX_N) continue;
        g.fillStyle = shadeHex(own, factor * (face ? 1 - RELIEF_SHADE * relief : 1));
        fillPolygon(g, outline, dx, dy);
        if (!face) continue;
        g.fillStyle = shadeHex(own, factor);
        fillPolygon(g, face, dx, dy);
      }
  }
}

/**
 * The units of a laid surface (pavers, tiles, boards, the stones of a wall) over their bed of mortar: rows
 * `cell[0]` deep down the tile, units `cell[1]` long across it, of uneven length with `vary`; some take one of the
 * `tints` instead of the base colour. With the `irregular` pattern there are no rows: see paintStones.
 */
export function paintJoints(g, joints, color, px, rand) {
  g.fillStyle = joints.color;
  g.fillRect(0, 0, TEX_N, TEX_N);
  if (joints.pattern === 'irregular') {
    paintStones(g, joints, color, px, rand);
    return;
  }
  const along = joints.cell[0] * px;
  const across = joints.cell[1] * px;
  const gap = Math.max(1, (joints.width > 0 ? joints.width : 0.015) * px);
  const stagger = (joints.stagger || 0) * across;
  const spread = Number.isFinite(joints.shade) ? joints.shade : 0.08;
  for (let row = 0, y = -along; y < TEX_N; row++, y += along)
    for (const [x, length] of rowUnits(TEX_N, across, (row % 2) * stagger, joints.vary, rand)) {
      g.fillStyle = shadeHex(unitColor(color, joints.tints, rand), 1 + (rand() * 2 - 1) * spread);
      g.fillRect(x + gap / 2, y + gap / 2, length - gap, along - gap);
    }
}

/** Two tracks worn by wheels across the width, the surface showing between and beside them. */
function paintWheels(g, wheels, px, rand) {
  const bands = (wheels.bands || [])
    .map(([low, high]) => [Math.round(low * TEX_N), Math.round(high * TEX_N)])
    .filter(([x0, x1]) => x1 > x0);
  for (const [x0, x1] of bands) {
    g.fillStyle = wheels.color;
    g.fillRect(x0, 0, x1 - x0, TEX_N);
  }
  for (const [x0, x1] of bands) {
    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, TEX_N);
    g.clip();
    paintSpeckles(g, wheels.speckles, px, rand, { x: x0, w: x1 - x0 });
    g.restore();
  }
}

/** The speckled noise over the base colour of a surface (skipped where the pixels cannot be read back). */
function paintGrain(g, grain, rand) {
  const image = typeof g.getImageData === 'function' ? g.getImageData(0, 0, TEX_N, TEX_N) : null;
  const data = image && image.data;
  if (!data || !data.length) return;
  for (let i = 0; i < data.length; i += 4) {
    const factor = 1 + (rand() * 2 - 1) * grain * GRAIN_SPREAD;
    data[i] = Math.min(255, data[i] * factor);
    data[i + 1] = Math.min(255, data[i + 1] * factor);
    data[i + 2] = Math.min(255, data[i + 2] * factor);
  }
  g.putImageData(image, 0, 0);
}

/** A square of surface, painted from the numbers of its entry alone: base, units, grains, ruts, then the noise. */
export function paintSurface(g, S, px, rand) {
  g.fillStyle = S.color;
  g.fillRect(0, 0, TEX_N, TEX_N);
  if (S.joints) paintJoints(g, S.joints, S.color, px, rand);
  paintSpeckles(g, S.speckles, px, rand);
  if (S.wheels) paintWheels(g, S.wheels, px, rand);
  if (S.grain > 0) paintGrain(g, S.grain, rand);
}

const tiles = new Map();

/**
 * One tile of a surface as a canvas, kept for the surfaces already painted (`seed` gives two surfaces of the same
 * numbers the same grains). Null outside a browser.
 */
export function surfaceTile(S, seed = '') {
  const key = `${seed}|${surfaceKey(S)}`;
  if (tiles.has(key)) return tiles.get(key);
  const made = canvasOf();
  if (!made) return null;
  paintSurface(made.g, S, TEX_N / tileOf(S, TEX_M), noise(hashString(seed || key)));
  tiles.set(key, made.c);
  return made.c;
}

const textures = new Map();

/** The tile of a surface as a repeating texture (null outside a browser: plain colours then). */
export function surfaceTexture(S, seed = '') {
  const key = `${seed}|${surfaceKey(S)}`;
  if (textures.has(key)) return textures.get(key);
  const c = surfaceTile(S, seed);
  if (!c) return null;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  return tex;
}

/** The tile of a surface as an image address (data URL) for an <img> of a picker; null outside a browser. */
export function surfaceSwatch(S, seed = '') {
  const c = surfaceTile(S, seed);
  return c ? c.toDataURL('image/png') : null;
}

// ---------------------------------------------------------------- see-through fences

/**
 * Metres one tile of the texture of a see-through fence covers along it: a whole number of wires, so that the
 * tiles join up (the wires of a mesh lean, and cross a level line every pitch times the root of two).
 */
export function openTile(open) {
  const pitch = open.pitch > 0 ? open.pitch : 0.1;
  return open.pattern === 'mesh' ? MESH_PITCHES * pitch * Math.SQRT2 : OPEN_PITCHES * pitch;
}

/** The wires or the bars of a see-through fence, stroked on a context over a sheet `w` by `h` pixels. */
export function strokeOpen(g, open, color, w, h, pxPerM) {
  g.strokeStyle = color;
  g.lineCap = 'butt';
  for (const l of openLines(open, w, h, pxPerM)) {
    g.lineWidth = Math.max(1, l.w);
    g.beginPath();
    g.moveTo(l.x0, l.y0);
    g.lineTo(l.x1, l.y1);
    g.stroke();
  }
}

/**
 * Texture of a see-through fence: its wires drawn in `color` on nothing. It repeats along the fence; a mesh and a
 * grid repeat up the fence too, while bars are drawn once over its whole height, their two rails where they sit.
 * Null outside a browser (the fence is then a tinted sheet).
 */
export function openTexture(open, color) {
  const key = `open|${color}|${JSON.stringify(open)}`;
  if (textures.has(key)) return textures.get(key);
  const made = canvasOf();
  if (!made) return null;
  const { c, g } = made;
  const px = TEX_N / openTile(open);
  if (open.pattern === 'bars') strokeOpen(g, open, color, TEX_N, TEX_N, px);
  else {
    // drawn over three tiles and cut to the middle one: the wires leaning across the edges join up
    g.translate(-TEX_N, -TEX_N);
    strokeOpen(g, open, color, TEX_N * 3, TEX_N * 3, px);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = open.pattern === 'bars' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  return tex;
}
