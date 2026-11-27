// Masonry of the low walls and retaining walls of the ground editor: a box along every segment of the line, from
// under the foot up to the top, faced with what the house catalog says (`walls` section: see wall-art.js) and
// capped with the coping the wall asks for (`copings` section: see coping-art.js), else with the one of its facing
// when it has one. The top and the foot may differ from one end of the wall to the other.
// The pure part (the faces of a wall as flat arrays) is free of the DOM and tested.
import * as THREE from 'three';
import { WALL_T, wallLevels } from './engine/terrain-edit.js';
import { WALL_DEFAULT, copingOf, hasWallKind, wallKind, wallKinds } from './wall-art.js';
import { copingKind, wallCoping } from './coping-art.js';
import { isHex, recolorSurface, surfaceKey, tileOf } from './surface-lib.js';
import { TEX_N, canvasOf, surfaceSwatch, surfaceTexture, surfaceTile } from './surface-art.js';
import { inPolygon } from './pools.js';

/** How far the masonry goes down under the foot, so that its base never shows on a slope (m). */
const BURIED = 1;
/** A wall lower than this at both ends is not built (m). */
const MIN_HEIGHT = 0.05;
/** Meters of wall across the thumbnail of a facing. */
const THUMB_RUN = 2;

const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

/**
 * The faces of a compiled wall (terrain-edit.js: `pts` in the plan frame, `cum` the run of each point, the
 * heights of its two ends): `wallFaces(w, tile)` gives the masonry itself, half a thickness on each side of the
 * line, with its texture coordinates (a row of the facing is a level course); with `cap` ({ height, overhang,
 * drop?, surface? }) it gives the coping laid on top instead, wider by its overhang and coming down over the faces
 * by its drop. A coping with a `surface` gets texture coordinates too: a row runs along the wall, the texture
 * starting at one edge of the coping and at its underside, so a row deeper than the coping is wide gives one unit
 * across (a brick on edge). Returns { pos, uv } (flat arrays, 6 points a face).
 */
export function wallFaces(w, tile = 2, cap = null) {
  const pos = [];
  const uv = [];
  const half = WALL_T / 2 + (cap ? cap.overhang : 0);
  for (let i = 0; i < w.pts.length - 1; i++) {
    const [ax, az] = w.pts[i];
    const [bx, bz] = w.pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const dx = (bx - ax) / L;
    const dz = (bz - az) / L;
    const nx = -dz * half;
    const nz = dx * half;
    // each box goes half a thickness past its ends: the corners of the line are filled
    const r0 = w.cum[i] - half;
    const r1 = w.cum[i + 1] + half;
    const x0 = ax - dx * half;
    const z0 = az - dz * half;
    const x1 = bx + dx * half;
    const z1 = bz + dz * half;
    const [top0, foot0] = wallLevels(w, r0);
    const [top1, foot1] = wallLevels(w, r1);
    const lo0 = cap ? top0 - (cap.drop || 0) : foot0 - BURIED;
    const lo1 = cap ? top1 - (cap.drop || 0) : foot1 - BURIED;
    const hi0 = cap ? top0 + cap.height : top0;
    const hi1 = cap ? top1 + cap.height : top1;
    // the two faces, the top, then the two ends
    quad(pos, [x0 + nx, lo0, z0 + nz], [x1 + nx, lo1, z1 + nz], [x1 + nx, hi1, z1 + nz], [x0 + nx, hi0, z0 + nz]);
    quad(pos, [x1 - nx, lo1, z1 - nz], [x0 - nx, lo0, z0 - nz], [x0 - nx, hi0, z0 - nz], [x1 - nx, hi1, z1 - nz]);
    quad(pos, [x0 + nx, hi0, z0 + nz], [x1 + nx, hi1, z1 + nz], [x1 - nx, hi1, z1 - nz], [x0 - nx, hi0, z0 - nz]);
    quad(pos, [x0 - nx, lo0, z0 - nz], [x0 + nx, lo0, z0 + nz], [x0 + nx, hi0, z0 + nz], [x0 - nx, hi0, z0 - nz]);
    quad(pos, [x1 + nx, lo1, z1 + nz], [x1 - nx, lo1, z1 - nz], [x1 - nx, hi1, z1 - nz], [x1 + nx, hi1, z1 + nz]);
    const u0 = r0 / tile;
    const u1 = r1 / tile;
    if (cap) {
      if (!cap.surface) continue; // the plain capping of a facing: one colour
      const wide = (2 * half) / tile;
      const tall0 = (hi0 - lo0) / tile;
      const tall1 = (hi1 - lo1) / tile;
      quad(uv, [u0, 0], [u1, 0], [u1, tall1], [u0, tall0]);
      quad(uv, [u1, 0], [u0, 0], [u0, tall0], [u1, tall1]);
      quad(uv, [u0, wide], [u1, wide], [u1, 0], [u0, 0]);
      quad(uv, [0, 0], [wide, 0], [wide, tall0], [0, tall0]);
      quad(uv, [wide, 0], [0, 0], [0, tall1], [wide, tall1]);
      continue;
    }
    const t = half / tile;
    quad(uv, [u0, lo0 / tile], [u1, lo1 / tile], [u1, hi1 / tile], [u0, hi0 / tile]);
    quad(uv, [u1, lo1 / tile], [u0, lo0 / tile], [u0, hi0 / tile], [u1, hi1 / tile]);
    quad(uv, [u0, t], [u1, t], [u1, -t], [u0, -t]);
    quad(uv, [-t, lo0 / tile], [t, lo0 / tile], [t, hi0 / tile], [-t, hi0 / tile]);
    quad(uv, [t, lo1 / tile], [-t, lo1 / tile], [-t, hi1 / tile], [t, hi1 / tile]);
  }
  return { pos, uv };
}

/** Where a segment a-b is inside a polygon: [[t0, t1], ...] as shares of its length, in order. */
function insideSpans(a, b, polygon) {
  const cuts = [0, 1];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-12) return; // parallel: no crossing
    const t = ((p[0] - a[0]) * ez - (p[1] - a[1]) * ex) / det;
    const u = ((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / det;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  });
  cuts.sort((m, n) => m - n);
  const spans = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    if (cuts[i + 1] - cuts[i] > 1e-9 && inPolygon(polygon, a[0] + dx * mid, a[1] + dz * mid)) spans.push([cuts[i], cuts[i + 1]]);
  }
  return spans;
}

/**
 * A compiled wall less what lies inside the `gaps` (outlines in the plan frame: the flights of steps that go
 * through it): the pieces left, each a wall of its own that keeps the heights of the whole one where it stands.
 * A gap is widened by half the thickness of the wall, the masonry of a piece going that far past its ends. The
 * wall itself is given back when nothing cuts it.
 */
export function wallPieces(w, gaps) {
  const half = WALL_T / 2;
  const out = []; // runs taken out of the wall: [from, to]
  for (let i = 0; i < w.pts.length - 1; i++) {
    const length = w.cum[i + 1] - w.cum[i];
    if (length < 1e-6) continue;
    for (const polygon of gaps || [])
      for (const [t0, t1] of insideSpans(w.pts[i], w.pts[i + 1], polygon))
        out.push([w.cum[i] + t0 * length - half, w.cum[i] + t1 * length + half]);
  }
  if (!out.length) return [w];
  out.sort((m, n) => m[0] - n[0]);
  const kept = []; // runs left standing
  let from = 0;
  for (const [a, b] of out) {
    if (a > from) kept.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < w.len) kept.push([from, w.len]);
  const at = (run) => {
    let i = 0;
    while (i < w.pts.length - 2 && w.cum[i + 1] < run) i++;
    const t = (run - w.cum[i]) / (w.cum[i + 1] - w.cum[i] || 1);
    return [w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * t, w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * t];
  };
  return kept
    .filter(([a, b]) => b - a > 0.05)
    .map(([a, b]) => {
      const inner = w.cum.map((run, i) => [run, w.pts[i]]).filter(([run]) => run > a + 1e-6 && run < b - 1e-6);
      return { ...w, pts: [at(a), ...inner.map(([, point]) => point), at(b)], cum: [a, ...inner.map(([run]) => run), b] };
    });
}

/** The wall stands over its foot somewhere along its length: there is masonry to show. */
export const wallShows = (w) => Math.max(w.hiY - w.loY, w.hi2Y - w.lo2Y) >= MIN_HEIGHT;

function meshOf(pos, uv, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = 'retaining-wall';
  return m;
}

/**
 * 3D masonry of the compiled walls of a terrain (compileOps().walls): one mesh per facing and colour, and one per
 * coping and colour. A wall is cut where one of the `gaps` goes through it (the outlines of the flights of steps,
 * plan frame). Returns the group, or null when no wall shows.
 */
export function buildWalls(walls, gaps = []) {
  const faces = new Map(); // facing + colour -> { S, id, pos, uv }
  const caps = new Map(); // coping + colour -> { cap, pos, uv }
  for (const whole of walls || []) {
    if (!wallShows(whole)) continue;
    const id = hasWallKind(whole.kind) ? whole.kind : WALL_DEFAULT;
    const kind = wallKind(id);
    const S = isHex(whole.c) ? recolorSurface(kind.surface, whole.c) : kind.surface;
    const key = `${id}|${S.color}`;
    if (!faces.has(key)) faces.set(key, { S, id, pos: [], uv: [] });
    const batch = faces.get(key);
    // what the wall asks to be capped with, else the capping of its facing
    const cap = wallCoping(whole, kind);
    const capKey = cap ? (cap.surface ? `${cap.id}|${surfaceKey(cap.surface)}` : `|${cap.color}`) : '';
    if (cap && !caps.has(capKey)) caps.set(capKey, { cap, pos: [], uv: [] });
    for (const w of wallPieces(whole, gaps)) {
      const made = wallFaces(w, tileOf(S));
      batch.pos.push(...made.pos);
      batch.uv.push(...made.uv);
      if (!cap) continue;
      const laid = wallFaces(w, cap.surface ? tileOf(cap.surface) : 1, cap);
      caps.get(capKey).pos.push(...laid.pos);
      caps.get(capKey).uv.push(...laid.uv);
    }
  }
  if (!faces.size) return null;
  const group = new THREE.Group();
  group.name = 'retaining-walls';
  for (const { S, id, pos, uv } of faces.values()) {
    if (!pos.length) continue;
    const map = surfaceTexture(S, `wall:${id}`);
    group.add(
      meshOf(
        pos,
        uv,
        new THREE.MeshStandardMaterial({
          color: map ? '#ffffff' : S.color,
          map,
          roughness: Number.isFinite(S.roughness) ? S.roughness : 0.95,
          side: THREE.DoubleSide,
        }),
      ),
    );
  }
  for (const { cap, pos, uv } of caps.values()) {
    if (!pos.length) continue;
    const S = cap.surface;
    const map = S ? surfaceTexture(S, `coping:${cap.id}`) : null;
    group.add(
      meshOf(
        pos,
        S ? uv : null,
        new THREE.MeshStandardMaterial({
          color: map ? '#ffffff' : cap.color,
          map,
          roughness: S && Number.isFinite(S.roughness) ? S.roughness : 0.9,
          side: THREE.DoubleSide,
        }),
      ),
    );
  }
  return group;
}

/** A square of a coping as an image address (data URL) for the picker; null outside a browser. */
export function copingThumb(id) {
  const kind = copingKind(id);
  return kind ? surfaceSwatch(kind.surface, `coping:${id}`) : null;
}

const thumbs = new Map();

/**
 * A piece of wall seen from the front as an image address (data URL) for the picker: its facing, and its coping on
 * top when it has one. Null outside a browser.
 */
export function wallThumb(id) {
  const kind = wallKinds()[id];
  if (!kind) return null;
  const key = `${id}|${JSON.stringify(kind)}`;
  if (thumbs.has(key)) return thumbs.get(key);
  const tile = surfaceTile(kind.surface, `wall:${id}`);
  const made = tile && canvasOf();
  if (!made) return null;
  const { c, g } = made;
  // the tile covers `tileOf` meters: scaled so that the thumbnail shows THUMB_RUN meters of wall
  const k = tileOf(kind.surface) / THUMB_RUN;
  g.save();
  g.scale(k, k);
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, 0, TEX_N / k, TEX_N / k);
  g.restore();
  const cap = copingOf(kind);
  if (cap) {
    const h = Math.max(6, (cap.height * TEX_N) / THUMB_RUN);
    g.fillStyle = cap.color;
    g.fillRect(0, 0, TEX_N, h);
    g.fillStyle = 'rgba(0, 0, 0, 0.28)'; // the shade under the capping, which juts out
    g.fillRect(0, h, TEX_N, Math.max(2, h * 0.3));
  }
  const url = c.toDataURL('image/png');
  thumbs.set(key, url);
  return url;
}
