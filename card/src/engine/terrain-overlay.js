// Overlay of the ground editor: what a brush click is about to do (radius and resulting relief), outlines and names
// of the corrections already in place. Builders only, in the PLAN frame: no edits / HA / DOM knowledge.
import * as THREE from 'three';

const VIEW_H = 30; // world height visible at zoom 1 (keep in step with engine.js)
const UP = new THREE.Color('#4fe07a'); // ground raised by the brush
const DOWN = new THREE.Color('#ff7a4f'); // ground lowered
const FLAT = new THREE.Color('#ffe14d'); // untouched
const FULL = 0.5; // height change (m) at which the preview colour is saturated

/** Scale of one screen-stable unit in world units, for the orthographic camera of the view. */
export const screenScale = (camera) => VIEW_H / (camera.zoom || 1);

/**
 * Text plate floating over the scene at `pos` ([x, y, z] in the plan frame), kept at a constant size on screen
 * whatever the zoom (the sprite rescales itself at every render).
 */
export function labelSprite(text, pos, { color = '#ffffff', bg = 'rgba(14,18,24,0.74)', h = 0.042, opacity = 1 } = {}) {
  const F = 30; // font size in the texture
  const pad = 10;
  const cv = document.createElement('canvas');
  let g = cv.getContext('2d');
  g.font = `600 ${F}px sans-serif`;
  const w = Math.ceil(g.measureText(text).width);
  cv.width = w + pad * 2;
  cv.height = F + pad * 2;
  g = cv.getContext('2d');
  const r = 8;
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(cv.width, 0, cv.width, cv.height, r);
  g.arcTo(cv.width, cv.height, 0, cv.height, r);
  g.arcTo(0, cv.height, 0, 0, r);
  g.arcTo(0, 0, cv.width, 0, r);
  g.fillStyle = bg;
  g.fill();
  g.font = `600 ${F}px sans-serif`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, pad, cv.height / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthTest: false, depthWrite: false }));
  sp.position.set(pos[0], pos[1], pos[2]);
  sp.renderOrder = 1001;
  const aspect = cv.width / cv.height;
  // the sprite shader reads the scale from matrixWorld, rebuilt here because the render list is already built
  sp.onBeforeRender = (renderer, scene, camera) => {
    const k = screenScale(camera) * h;
    sp.scale.set(k * aspect, k, 1);
    sp.updateMatrix();
    sp.matrixWorld.multiplyMatrices(sp.parent ? sp.parent.matrixWorld : new THREE.Matrix4(), sp.matrix);
  };
  return sp;
}

/** Closed outline (plan points) filled flat at `yAt`, to tint the inside of a terrace or of a brush. */
export function fillMesh(planPts, yAt, color, opacity = 0.18, dy = -0.25) {
  const ring =
    planPts.length > 2 && planPts[0][0] === planPts[planPts.length - 1][0] && planPts[0][1] === planPts[planPts.length - 1][1]
      ? planPts.slice(0, -1)
      : planPts;
  if (ring.length < 3) return null;
  const tris = THREE.ShapeUtils.triangulateShape(
    ring.map(([x, z]) => new THREE.Vector2(x, z)),
    [],
  );
  const pos = [];
  for (const t of tris) for (const v of t) pos.push(ring[v][0], yAt(ring[v][0], ring[v][1]) + dy, ring[v][1]);
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = 996;
  return m;
}

/** Straight segment in space, used as the gauge showing how far the ground moves under the brush. */
export function segment(a, b, color) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
  l.renderOrder = 1000;
  return l;
}

/**
 * Relief the brush would leave: a polar disc of radius `r` around (cx, cz) drawn at the corrected heights, tinted
 * green where the ground rises and orange where it falls. `ground(x, z)` and `after(x, z)` give the scene y before
 * and after the correction. Returns { mesh, ring (plan points of the edge), dy (change at the centre), peak }.
 */
export function brushPreview(cx, cz, r, ground, after, { na = 36, nr = 8, lift = 0.04 } = {}) {
  const pos = [];
  const col = [];
  const idx = [];
  const ring = [];
  const c = new THREE.Color();
  let peak = 0;
  for (let i = 0; i <= nr; i++) {
    const rr = (r * i) / nr;
    for (let j = 0; j < na; j++) {
      const a = (j / na) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const y0 = ground(x, z);
      const y1 = after(x, z);
      const d = y1 - y0;
      if (Math.abs(d) > Math.abs(peak)) peak = d;
      pos.push(x, y1 + lift, z);
      c.copy(FLAT).lerp(d >= 0 ? UP : DOWN, Math.min(1, Math.abs(d) / FULL));
      col.push(c.r, c.g, c.b);
      if (i === nr) ring.push([x, z]);
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < na; j++) {
      const k = (j + 1) % na;
      const a = i * na + j;
      const b = i * na + k;
      const d = (i + 1) * na + k;
      const e = (i + 1) * na + j;
      idx.push(a, b, d, a, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 997;
  const y0 = ground(cx, cz);
  return { mesh, ring, dy: after(cx, cz) - y0, peak, y0 };
}
