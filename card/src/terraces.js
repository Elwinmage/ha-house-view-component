// Terraces, patios and decks: an outline drawn on the ground (a rectangle or a free shape), laid flat at one
// altitude with the ground levelled under it, and covered with what the house catalog says (`terraces` section: see
// terrace-art.js). The pure part (normalisation, outline helpers, geometry) is free of the DOM and tested; the
// textures come from surface-art.js and are only painted in a browser.
import * as THREE from 'three';
import { TERRACE_DEFAULT, terraceKind, terraceLook, terraceThickness } from './terrace-art.js';
import { isHex, recolorSurface, shadeHex, tileOf } from './surface-lib.js';
import { surfaceSwatch, surfaceTexture } from './surface-art.js';
import { centroidOf, inPolygon } from './pools.js';

/** How far the ground blends back to the relief around a terrace, by default (m). */
export const TERRACE_FEATHER = 0.6;
/** Thinnest and thickest terrace (m). */
export const TERRACE_H = [0.01, 1];
/** How far the sides go down under the levelled ground, so that no gap ever shows on a slope (m). */
const SKIRT = 0.3;
/** Shortest side of a terrace sized by hand (m). */
export const MIN_SIDE = 0.4;

const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => v !== null && v !== '' && Number.isFinite(+v);

/**
 * Current model: { id, pts (outline, 3 points at least), frame, shape ('rect' | 'free': how it was drawn), surface
 * (id of its covering), c? (colour of the user's own), alt (absolute altitude of the ground under it, null: the
 * ground where it is), h? (thickness, when it is not the one of the covering), feather, rot (laying direction, in
 * degrees from its first side), hidden, name? }.
 */
export function normalizeTerrace(t) {
  const raw = t || {};
  const pts = (raw.pts || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => [q[0], q[1]]);
  const out = {
    id: raw.id || '',
    pts,
    frame: raw.frame || 'grid',
    shape: raw.shape === 'rect' ? 'rect' : 'free',
    // kept even when the catalog does not know it (not read yet, an entry removed): it is then drawn with the
    // usual covering, and finds its own again as soon as the catalog has it
    surface: typeof raw.surface === 'string' && raw.surface ? raw.surface : TERRACE_DEFAULT,
    alt: num(raw.alt) ? r2(+raw.alt) : null,
    feather: num(raw.feather) ? r2(Math.min(10, Math.max(0, +raw.feather))) : TERRACE_FEATHER,
    rot: num(raw.rot) ? ((Math.round(+raw.rot) % 360) + 360) % 360 : 0,
    hidden: !!raw.hidden,
  };
  if (isHex(raw.c)) out.c = raw.c.toLowerCase();
  if (num(raw.h)) out.h = r2(Math.min(TERRACE_H[1], Math.max(TERRACE_H[0], +raw.h)));
  if (raw.name) out.name = String(raw.name);
  return out;
}

/** A terrace that can be laid: an outline of three points at least, not hidden. */
export const terraceValid = (t) => !!t && Array.isArray(t.pts) && t.pts.length >= 3 && !t.hidden;

/** Thickness of a (normalized) terrace: the one given by hand, else the one of its covering. */
export const thicknessOf = (t) => (Number.isFinite(t.h) ? t.h : terraceThickness(terraceLook(t.surface)));

/** Area of an outline (m²). */
export function outlineArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a / 2);
}

// ---------------------------------------------------------------- outline helpers (plan frame)

/** Four points at right angles: the outline is still the rectangle it was drawn as (its size can be typed). */
export function isRectangle(pts, tolerance = 0.02) {
  if (!Array.isArray(pts) || pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const u = [b[0] - a[0], b[1] - a[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const lu = Math.hypot(u[0], u[1]);
    const lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-6 || lv < 1e-6 || Math.abs(u[0] * v[0] + u[1] * v[1]) > tolerance * lu * lv) return false;
  }
  return true;
}

/** Direction of the first side of an outline, in degrees (0 along x, counted towards z), 0 without one. */
export function outlineAngle(pts) {
  if (!pts || pts.length < 2) return 0;
  const deg = (Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) * 180) / Math.PI;
  return (((Math.round(deg * 10) / 10) % 360) + 360) % 360;
}

/** The outline turned by `deg` degrees about its middle (its centroid). */
export function rotateOutline(pts, deg) {
  if (!pts || !pts.length) return [];
  const [cx, cz] = centroidOf(pts);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, z]) => [cx + (x - cx) * c - (z - cz) * s, cz + (x - cx) * s + (z - cz) * c]);
}

/** A point put on side `i` of an outline, `t` (0..1) along it; null when it would sit on one of its ends. */
export function insertPoint(pts, i, t) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (t * L < 0.1 || (1 - t) * L < 0.1) return null;
  const out = pts.map((p) => [p[0], p[1]]);
  out.splice(i + 1, 0, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  return out;
}

/** The outline without its point `i`; null when it would be left with less than a triangle. */
export function dropPoint(pts, i) {
  if (pts.length <= 3 || i < 0 || i >= pts.length) return null;
  return pts.filter((_, k) => k !== i).map((p) => [p[0], p[1]]);
}

// ---------------------------------------------------------------- the ground under the terraces

/**
 * Ground corrections of the terraces, for the terrain builder: one flat platform per terrace, in the grid frame
 * like the corrections drawn by hand (terrain-edit.js). `toGrid(terrace)` gives the conversion of its points to
 * the grid, `altAt(gx, gz)` the altitude of the relief for a terrace that was given none. Each one tells its
 * thickness (`deck`): the earth is kept under what is laid there.
 */
export function levelOps(terraces, toGrid, altAt) {
  const ops = [];
  for (const raw of terraces || []) {
    if (!terraceValid(raw)) continue;
    const t = normalizeTerrace(raw);
    const conv = toGrid(raw);
    const poly = t.pts.map(([x, z]) => conv(x, z));
    const [cx, cz] = centroidOf(poly);
    ops.push({ type: 'terrace', poly, alt: t.alt ?? altAt(cx, cz), feather: t.feather, deck: thicknessOf(t) });
  }
  return ops;
}

/**
 * What one walks on at a point of the plan: `walkLevel(...)(x, z)` is the top of the terrace laid there, else the
 * ground. Same arguments as buildTerraces. A flight of steps starts and arrives on a deck as well as on the
 * ground: its first step is counted from there.
 */
export function walkLevel(terraces, anchor, heightAt, { altToY = null } = {}) {
  const decks = [];
  for (const raw of terraces || []) {
    if (!terraceValid(raw)) continue;
    const t = normalizeTerrace(raw);
    const toPlan = anchor(raw);
    const P = t.pts.map(([x, z]) => toPlan(x, z));
    const [cx, cz] = centroidOf(P);
    const ground = altToY && t.alt !== null ? altToY(t.alt) : heightAt(cx, cz);
    decks.push({ P, top: ground + thicknessOf(t) });
  }
  return (x, z) => {
    let level = heightAt(x, z);
    for (const { P, top } of decks) if (top > level && inPolygon(P, x, z)) level = top;
    return level;
  };
}

// ---------------------------------------------------------------- geometry

/**
 * Frame the covering is laid in: its rows run along `u`, the first side of the outline turned by `rot` degrees,
 * so the boards of a deck follow that direction. { ox, oz, ux, uz, vx, vz }.
 */
export function layFrame(pts, rot = 0) {
  const [ox, oz] = pts[0];
  const a = (outlineAngle(pts) + rot) * (Math.PI / 180);
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  return { ox, oz, ux, uz, vx: -uz, vz: ux };
}

/** The holes of a terrace: the outlines (pools...) that lie wholly inside it. */
export function holesIn(pts, holes) {
  return (holes || []).filter((h) => Array.isArray(h) && h.length >= 3 && h.every(([x, z]) => inPolygon(pts, x, z)));
}

/**
 * Top of a terrace: the outline (plan frame) at height `top`, cut out around `holes`, with the texture coordinates
 * of the laying frame in tiles of `tile` meters. Returns { pos, uv, idx } (flat arrays), or null for an outline
 * that cannot be filled.
 */
export function terraceTop(pts, holes, top, frame, tile) {
  const rings = [pts, ...holes];
  const faces = THREE.ShapeUtils.triangulateShape(
    pts.map(([x, z]) => new THREE.Vector2(x, z)),
    holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))),
  );
  if (!faces.length) return null;
  const pos = [];
  const uv = [];
  for (const ring of rings)
    for (const [x, z] of ring) {
      pos.push(x, top, z);
      const dx = x - frame.ox;
      const dz = z - frame.oz;
      uv.push((dx * frame.ux + dz * frame.uz) / tile, (dx * frame.vx + dz * frame.vz) / tile);
    }
  return { pos, uv, idx: faces.flat() };
}

/** Sides of a terrace: a strip from `top` down to `bottom` along the outline and around each hole (positions only). */
export function terraceSides(pts, holes, top, bottom) {
  const pos = [];
  for (const ring of [pts, ...holes])
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      pos.push(ax, top, az, bx, top, bz, bx, bottom, bz, ax, top, az, bx, bottom, bz, ax, bottom, az);
    }
  return pos;
}

// ---------------------------------------------------------------- 3D

/**
 * 3D terraces: the top of each one, textured, and its sides. `anchor(terrace)` gives the conversion of its frame
 * to the plan, `heightAt` the ground, `altToY` the height of an absolute altitude (with a terrain) and `holes` the
 * outlines to cut out of the terraces they lie in (pools). Returns { group, count, materials } (materials: the tops,
 * for snow and rain).
 */
export function buildTerraces(terraces, anchor, heightAt, { altToY = null, holes = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'terraces';
  const tops = new Map();
  const edges = new Map();
  let count = 0;
  for (const raw of terraces || []) {
    if (!terraceValid(raw)) continue;
    const t = normalizeTerrace(raw);
    const kind = terraceLook(t.surface);
    const toPlan = anchor(raw);
    const P = t.pts.map(([x, z]) => toPlan(x, z));
    const [cx, cz] = centroidOf(P);
    const ground = altToY && t.alt !== null ? altToY(t.alt) : heightAt(cx, cz);
    const top = ground + thicknessOf(t);
    const S = t.c ? recolorSurface(kind.surface, t.c) : kind.surface;
    const inside = holesIn(P, holes);
    const face = terraceTop(P, inside, top, layFrame(P, t.rot), tileOf(S));
    if (!face) continue;
    const key = `${t.surface}|${S.color}`;
    if (!tops.has(key)) {
      const map = surfaceTexture(S, `terrace:${t.surface}`);
      tops.set(
        key,
        new THREE.MeshStandardMaterial({
          color: map ? '#ffffff' : S.color,
          map,
          roughness: Number.isFinite(S.roughness) ? S.roughness : 0.9,
          side: THREE.DoubleSide,
        }),
      );
      edges.set(key, new THREE.MeshStandardMaterial({ color: shadeHex(S.color, 0.72), roughness: 0.95, side: THREE.DoubleSide }));
    }
    const g = new THREE.Group();
    g.name = 'terrace';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(face.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(face.uv, 2));
    geo.setIndex(face.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, tops.get(key));
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    g.add(mesh);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(terraceSides(P, inside, top, ground - SKIRT), 3));
    sg.computeVertexNormals();
    const sides = new THREE.Mesh(sg, edges.get(key));
    sides.castShadow = true;
    sides.receiveShadow = true;
    g.add(sides);
    group.add(g);
    count++;
  }
  return { group, count, materials: [...tops.values()] };
}

/** A square of a covering as an image address (data URL) for the picker; null outside a browser. */
export function terraceThumb(id) {
  const kind = terraceKind(id);
  return kind ? surfaceSwatch(kind.surface, `terrace:${id}`) : null;
}

/** The covering of a terrace is known: the picker shows it as chosen (else the usual one is drawn in its place). */
export const terraceKnown = (id) => !!terraceKind(id);
