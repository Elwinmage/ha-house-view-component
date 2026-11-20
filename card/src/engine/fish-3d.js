// Fish of a pond, built from their descriptor (house catalog, doc/format.md): a tapered body in two pieces (the rear
// one sways), a tail fin and two pectoral fins, under a robe painted on a small canvas, seen from above. They wander
// in the water, go down when it is cold, and take the colour of the water the deeper they are.
import * as THREE from 'three';
import { bodyHalfwidth, fishPatches, startPoint, swimDepth, swimStep, seeded } from '../fish.js';

const RINGS = 14;
const SIDES = 10;
const JOINT = 0.42; // where the rear of the body bends, from the root of the tail (0) to the snout (1)
const TEX_W = 128;
const TEX_H = 48;

/** Lateral span of the robe texture, as a share of the width of the body (fins and flanks included). */
const SPAN = 1.25;

/** Robe of one fish, painted from above on a canvas (null outside a browser: plain colours then). */
function robeTexture(fish, variety, seed) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d');
  const body = fish.body;
  const W = body.width;
  const tail = body.tail ?? 0.2;
  const start = -0.5 + tail;
  const span = 1 - tail;
  const px = (x) => (x + 0.5) * TEX_W;
  const py = (y) => (0.5 + y / (W * SPAN)) * TEX_H;
  g.fillStyle = variety.belly || variety.base;
  g.fillRect(0, 0, TEX_W, TEX_H);
  // the back, a little narrower than the body: the flanks keep the colour of the belly
  const outline = (k) => {
    g.beginPath();
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      const y = (W / 2) * bodyHalfwidth(u) * k;
      g[i ? 'lineTo' : 'moveTo'](px(start + u * span), py(-y));
    }
    for (let i = 32; i >= 0; i--) {
      const u = i / 32;
      g.lineTo(px(start + u * span), py((W / 2) * bodyHalfwidth(u) * k));
    }
    g.closePath();
  };
  outline(0.8);
  g.fillStyle = variety.base;
  g.fill();
  g.save();
  outline(0.8);
  g.clip();
  for (const p of fishPatches(variety, body, seed)) {
    g.fillStyle = p.color;
    g.beginPath();
    g.ellipse(px(p.x), py(p.y), p.rx * TEX_W, (p.ry / (W * SPAN)) * TEX_H, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (variety.metallic) {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, py(-W * 0.08), TEX_W, py(W * 0.08) - py(-W * 0.08));
  }
  g.restore();
  // eyes
  g.fillStyle = '#141414';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(px(start + span * 0.9), py(s * (W / 2) * bodyHalfwidth(0.9) * 0.75), 1.4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Body of a fish 1 long, from u0 to u1 (0: root of the tail, 1: snout), head toward +x, laid out for the robe
 * (texture seen from above). The positions are shifted by -shift along x (the rear piece turns about the joint).
 */
function bodyPiece(fish, u0, u1, shift) {
  const { width: W, height: H } = fish.body;
  const tail = fish.body.tail ?? 0.2;
  const start = -0.5 + tail;
  const span = 1 - tail;
  const pos = [];
  const uv = [];
  const n = Math.max(2, Math.round(RINGS * (u1 - u0)));
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const x = start + u * span;
    const a = (W / 2) * bodyHalfwidth(u);
    const b = (H / 2) * Math.max(bodyHalfwidth(u), 0.05) * 0.9;
    for (let j = 0; j <= SIDES; j++) {
      const t = (j / SIDES) * Math.PI * 2;
      const z = a * Math.cos(t);
      const y = b * Math.sin(t) * (Math.sin(t) < 0 ? 0.7 : 1); // flatter belly
      pos.push(x - shift, y, z);
      uv.push((x + 0.5), 1 - (0.5 + z / (W * SPAN)));
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j;
      const b = a + SIDES + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A flat fin from points [[x, z]] (fish 1 long), lying horizontally. */
function finGeometry(pts) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** One fish 1 long: { group, rear (turns about the joint), mats }. */
function buildFish(fish, variety, seed) {
  const body = fish.body;
  const W = body.width;
  const tail = body.tail ?? 0.2;
  const start = -0.5 + tail;
  const span = 1 - tail;
  const long = body.fins === 'long';
  const map = robeTexture(fish, variety, seed);
  const skin = new THREE.MeshStandardMaterial({
    color: map ? '#ffffff' : variety.base,
    map,
    roughness: variety.metallic ? 0.3 : 0.55,
    metalness: variety.metallic ? 0.45 : 0.05,
    transparent: true, // drawn after the water (transparent too), under it by its own depth tint
  });
  const finMat = new THREE.MeshStandardMaterial({
    color: variety.fins || variety.base,
    roughness: 0.6,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const jointX = start + JOINT * span;
  const group = new THREE.Group();
  const front = new THREE.Mesh(bodyPiece(fish, JOINT, 1, 0), skin);
  const rear = new THREE.Group();
  rear.position.x = jointX;
  rear.add(new THREE.Mesh(bodyPiece(fish, 0, JOINT, jointX), skin));
  // tail fin: a notched fan behind the root of the tail
  const root = (W / 2) * bodyHalfwidth(0);
  const spread = W * (long ? 0.75 : 0.55);
  const tailFin = new THREE.Mesh(
    finGeometry([
      [start + 0.01 - jointX, -root],
      [-0.5 - jointX, -spread],
      [-0.5 + tail * 0.4 - jointX, 0],
      [-0.5 - jointX, spread],
      [start + 0.01 - jointX, root],
    ]),
    finMat,
  );
  tailFin.name = 'tail';
  rear.add(tailFin);
  // pectoral fins, a little behind the head
  const reach = W * (long ? 0.6 : 0.42);
  for (const s of [-1, 1]) {
    const x0 = start + span * 0.66;
    const z0 = s * (W / 2) * bodyHalfwidth(0.66) * 0.8;
    const fin = new THREE.Mesh(
      finGeometry([
        [x0, z0],
        [x0 - reach * 0.9, z0 + s * reach],
        [x0 - reach * 0.2, z0],
      ]),
      finMat,
    );
    fin.position.y = -0.01;
    group.add(fin);
  }
  group.add(front, rear);
  for (const m of [front, ...rear.children]) m.renderOrder = 6;
  group.traverse((o) => {
    if (o.isMesh && o.renderOrder !== 6) o.renderOrder = 6;
  });
  return { group, rear, skin, finMat };
}

/**
 * Fish of one pond. `list` = pondFish(…), `pond` = { poly, islands, rim (ground height), depth, color (water) },
 * `floorAt(x, z)`: height of the bottom. Returns { group, fish, tick(dt, t, cold) }.
 */
export function buildPondFish(list, pond, floorAt) {
  const group = new THREE.Group();
  group.name = 'fish';
  const water = new THREE.Color(pond.color || '#3d6b4a');
  const surface = pond.rim - 0.08;
  const fish = [];
  for (const f of list) {
    const rand = seeded(f.seed);
    const margin = Math.max(f.length * 0.6, 0.15);
    const s = startPoint(pond.poly, pond.islands || [], margin, rand);
    if (!s) continue;
    const built = buildFish(f.fish, f.variety, f.seed);
    built.group.scale.setScalar(f.length);
    group.add(built.group);
    const speed = ((f.fish.swim && f.fish.swim.speed) || 0.2) * (0.8 + 0.4 * rand());
    fish.push({ ...f, ...built, s, rand, margin, speed, phase: rand() * 6.28, y: surface - 0.3 });
  }
  const tint = (it, depth) => {
    // the deeper, the more the colour of the water
    const k = Math.min(0.75, 0.08 + depth * 0.6);
    it.skin.color.set('#ffffff').lerp(water, k);
    it.finMat.color.set(it.variety.fins || it.variety.base).lerp(water, k);
  };
  const place = (it, t, cold) => {
    const bottom = Math.max(surface - floorAt(it.s.x, it.s.z), 0.1);
    const depth = swimDepth(it.fish, cold, bottom, it.length);
    const want = surface - depth;
    it.y += (want - it.y) * 0.02; // goes up or down slowly
    it.group.position.set(it.s.x, it.y, it.s.z);
    it.group.rotation.y = -it.s.h;
    it.rear.rotation.y = Math.sin(t * (cold ? 2.5 : 5) + it.phase) * 0.3;
    tint(it, surface - it.y);
  };
  for (const it of fish) {
    it.y = surface - swimDepth(it.fish, false, Math.max(surface - floorAt(it.s.x, it.s.z), 0.1), it.length);
    place(it, 0, false);
  }
  return {
    group,
    fish,
    tick(dt, t, cold = false) {
      const step = Math.min(dt, 0.1);
      for (const it of fish) {
        it.s = swimStep(pond.poly, pond.islands || [], it.s, step, it.speed * (cold ? 0.35 : 1), it.margin, it.rand);
        place(it, t, cold);
      }
    },
  };
}
