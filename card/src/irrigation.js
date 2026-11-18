// Garden watering: drip lines (while the valve is open, glints run in the pipe, a drop pulses under each emitter and a
// wet strip grows) and sprinklers grouped in circuits (estimated watered sector + animated jets). Positions are stored
// in the frame of each object ('grid' = terrain grid, 'plan' without terrain), like the fences.
import * as THREE from 'three';

// Saturated hydraulic conductivity Ks (m/s), typical order of magnitude per soil texture.
export const SOILS = { sand: 5e-5, loam: 5e-6, clay: 5e-7 };
export const LINE_COLORS = { black: '#1b1b1b', brown: '#5a3d2b', green: '#2f5d34' };
const ON_COLOR = '#2f8fff';
const WET_COLOR = '#1f4f6e';
const DRY_MS = 30 * 60 * 1000; // the wet strip fades this long after the valve closes
const DROP_COLOR = '#aee0ff';
const GLINT_COLOR = '#e6f5ff';
const FLOW_PERIOD = 0.9; // m between two glints running in an open pipe
const FLOW_SPEED = 0.55; // m/s
const FLOW_GLOW = 0.95;
const PULSE_S = 1.5; // s, one swell of the drop under an emitter
const PULSE_STEP = 0.21; // part of a pulse between two neighbour emitters: the swell runs down the line

/** Repeatable pseudo-random number in [0, 1) for emitter k. */
const noise = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;

let flowTex = null;

/** Emissive pattern shared by every pipe: one soft glint per period, moved along the pipes by its offset. */
function flowTexture() {
  if (flowTex) return flowTex;
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(255 * Math.sin(Math.PI * Math.min(i / n / 0.35, 1)) ** 2);
    data.set([v, v, v, 255], i * 4);
  }
  flowTex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  flowTex.wrapS = THREE.RepeatWrapping;
  flowTex.magFilter = flowTex.minFilter = THREE.LinearFilter;
  flowTex.needsUpdate = true;
  return flowTex;
}

/**
 * Wetted width (m) at the soil surface under one emitter after `minutes` of watering.
 * Semi-empirical model of Schwartzman & Zur (1986): W = 1.82 V^0.22 (Ks/q)^-0.17 in SI units
 * (V applied volume in m3, q emitter discharge in m3/s, Ks in m/s). It tends to underestimate on fine soils.
 * `soil` is a key of SOILS or a Ks value in m/s.
 */
export function wetWidth(minutes, flowLh = 2, soil = 'loam') {
  if (!(minutes > 0) || !(flowLh > 0)) return 0;
  const q = flowLh / 1000 / 3600;
  const v = q * minutes * 60;
  const ks = typeof soil === 'number' ? soil : SOILS[soil] || SOILS.loam;
  return Math.min(1.82 * v ** 0.22 * (ks / q) ** -0.17, 2);
}

// Built-in sprinkler catalog (to move to the shared catalog). r = usual radius (m), rRange = adjustable range,
// arc = [min, max] degrees. kind: spray = fixed fan, rotor = one rotating jet, rotator = several rotating streams.
export const SPRINKLERS = [
  { id: 'hunter-psu-04-8a', brand: 'Hunter', name: 'Pro-Spray PSU-04-8A', kind: 'spray', r: 2.4, rRange: [1.8, 2.4], arc: [1, 360] },
  { id: 'hunter-psu-04-10a', brand: 'Hunter', name: 'Pro-Spray PSU-04-10A', kind: 'spray', r: 3.0, rRange: [2.3, 3.0], arc: [1, 360] },
  { id: 'hunter-psu-04-12a', brand: 'Hunter', name: 'Pro-Spray PSU-04-12A', kind: 'spray', r: 3.7, rRange: [2.8, 3.7], arc: [1, 360] },
  { id: 'hunter-psu-04-15a', brand: 'Hunter', name: 'Pro-Spray PSU-04-15A', kind: 'spray', r: 4.6, rRange: [3.4, 4.6], arc: [1, 360] },
  { id: 'hunter-psu-04-17a', brand: 'Hunter', name: 'Pro-Spray PSU-04-17A', kind: 'spray', r: 5.2, rRange: [3.9, 5.2], arc: [1, 360] },
  { id: 'hunter-srm-04', brand: 'Hunter', name: 'SRM-04', kind: 'rotor', r: 8.5, rRange: [4.0, 10.7], arc: [40, 360] },
  { id: 'hunter-pgj-04', brand: 'Hunter', name: 'PGJ-04', kind: 'rotor', r: 9.0, rRange: [4.3, 11.6], arc: [40, 360] },
  { id: 'hunter-pgp-ultra', brand: 'Hunter', name: 'PGP Ultra', kind: 'rotor', r: 11.0, rRange: [4.9, 14.0], arc: [50, 360] },
  { id: 'hunter-mp1000', brand: 'Hunter', name: 'MP Rotator MP1000', kind: 'rotator', r: 4.0, rRange: [2.5, 4.5], arc: [90, 360] },
  { id: 'hunter-mp2000', brand: 'Hunter', name: 'MP Rotator MP2000', kind: 'rotator', r: 5.5, rRange: [4.0, 6.4], arc: [90, 360] },
  { id: 'hunter-mp3000', brand: 'Hunter', name: 'MP Rotator MP3000', kind: 'rotator', r: 8.5, rRange: [6.7, 9.1], arc: [90, 360] },
  { id: 'generic-spray', brand: '', name: 'Spray', kind: 'spray', r: 3.5, rRange: [1, 6], arc: [1, 360] },
  { id: 'generic-rotor', brand: '', name: 'Rotor', kind: 'rotor', r: 8, rRange: [3, 15], arc: [20, 360] },
];

export const sprinklerModel = (id) => SPRINKLERS.find((m) => m.id === id) || SPRINKLERS[SPRINKLERS.length - 1];

/** Head settings pre-filled from a catalog model (everything stays editable). */
export function headDefaults(modelId) {
  const m = sprinklerModel(modelId);
  return {
    model: m.id,
    rMin: m.kind === 'spray' ? 0.3 : Math.round(m.r * 1.5) / 10,
    rMax: m.r,
    dir: 0,
    arc: Math.min(Math.max(90, m.arc[0]), m.arc[1]),
  };
}

/** Unit vector of a compass direction on the plan: 0 deg = top of the plan (-z), clockwise. */
export const dirVec = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];

/** Compass direction (deg, 0..360) from a point to another. */
export const bearing = (from, to) => (Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180) / Math.PI + (to[0] < from[0] ? 360 : 0);

/**
 * Smooth path through the points of a line (centripetal Catmull-Rom), sampled every `step` meters.
 * Returns [[x, z], ...]; with fewer than 2 points, the points themselves.
 */
export function smoothPath(pts, step = 0.15) {
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  if (pts.length === 2) {
    const L = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const n = Math.max(1, Math.round(L / step));
    return Array.from({ length: n + 1 }, (_, k) => [
      pts[0][0] + ((pts[1][0] - pts[0][0]) * k) / n,
      pts[0][1] + ((pts[1][1] - pts[0][1]) * k) / n,
    ]);
  }
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    false,
    'centripetal',
  );
  const n = Math.max(2, Math.round(curve.getLength() / step));
  return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
}

/** Points every `spacing` meters along a path [[x, z], ...] (the emitters of a drip line). */
export function spacedPoints(path, spacing = 0.3) {
  const out = [];
  let next = spacing / 2;
  let run = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    while (next <= run + L && L > 0) {
      const t = (next - run) / L;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      next += spacing;
    }
    run += L;
  }
  return out;
}

export const isOn = (st) => !!st && ['on', 'open', 'opening'].includes(st.state);

/**
 * Watering state of each line / circuit from Home Assistant: { [id]: { on, since } } with `since` = ms timestamp of
 * the last state change. `preview` (Set of ids) forces "on" in the editor without opening the valve.
 */
export function irrigationStates(irr, states, preview, now, previewSince = {}) {
  const out = {};
  for (const o of [...(irr.lines || []), ...(irr.circuits || [])]) {
    const st = o.entity ? states[o.entity] : null;
    if (preview && preview.has(o.id)) out[o.id] = { on: true, since: previewSince[o.id] || now };
    else out[o.id] = { on: isOn(st), since: st ? Date.parse(st.last_changed) || now : now };
  }
  return out;
}

function ringSector(head, toPlan, heightAt, lift) {
  // annular sector draped on the ground: radial x angular grid
  const [cx, cz] = toPlan(head.at[0], head.at[1]);
  const arc = Math.min(Math.max(head.arc || 90, 1), 360);
  const na = Math.max(2, Math.ceil(arc / 6));
  const r0 = Math.max(0, Math.min(head.rMin || 0, head.rMax - 0.1));
  const nr = Math.max(1, Math.ceil((head.rMax - r0) / 0.75));
  const pos = [];
  const pt = (ia, ir) => {
    const [dx, dz] = dirVec(head.dir - arc / 2 + (arc * ia) / na);
    const r = r0 + ((head.rMax - r0) * ir) / nr;
    const x = cx + dx * r;
    const z = cz + dz * r;
    return [x, heightAt(x, z) + lift, z];
  };
  for (let ia = 0; ia < na; ia++) {
    for (let ir = 0; ir < nr; ir++) {
      const a = pt(ia, ir);
      const b = pt(ia + 1, ir);
      const c = pt(ia + 1, ir + 1);
      const d = pt(ia, ir + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * Three.js objects of the whole irrigation. anchor(o) gives the converter of object o to plan coordinates,
 * heightAt(x, z) the ground. Returns { group, update(states, now, opts), animated }.
 */
export function buildIrrigation(irr, anchor, heightAt) {
  const group = new THREE.Group();
  group.name = 'irrigation';
  const lines = [];
  const heads = [];
  const disc = new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2);

  for (const ln of irr.lines || []) {
    if (!ln.pts || ln.pts.length < 2) continue;
    const toPlan = anchor(ln);
    const path = smoothPath(
      ln.pts.map((p) => toPlan(p[0], p[1])),
      0.15,
    );
    const pts3 = path.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.035, z));
    const curve = new THREE.CatmullRomCurve3(pts3);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(pts3.length * 2, 1200), 0.028, 5, false),
      new THREE.MeshStandardMaterial({
        color: LINE_COLORS[ln.color] || LINE_COLORS.black,
        roughness: 0.7,
        emissive: GLINT_COLOR,
        emissiveMap: flowTexture(),
        emissiveIntensity: 0, // lit while the valve is open
      }),
    );
    tube.castShadow = true;
    // u runs in metres along the pipe, so that the glints have the same length and speed on every line
    const uv = tube.geometry.attributes.uv;
    const rep = curve.getLength() / FLOW_PERIOD;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
    const em = spacedPoints(path, ln.spacing || 0.3).slice(0, 4000);
    const spots = new THREE.InstancedMesh(
      disc,
      new THREE.MeshBasicMaterial({
        color: WET_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
      Math.max(em.length, 1),
    );
    spots.count = em.length;
    spots.visible = false;
    spots.renderOrder = 3;
    // one drop per emitter, swelling and shrinking in a loop while the valve is open
    const beads = new THREE.InstancedMesh(
      disc,
      new THREE.MeshBasicMaterial({
        color: DROP_COLOR,
        toneMapped: false, // keeps the drops clear and bright against the wet ground
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
      }),
      Math.max(em.length, 1),
    );
    beads.count = em.length;
    beads.visible = false;
    beads.renderOrder = 4;
    group.add(tube, spots, beads);
    lines.push({
      ln,
      tube,
      spots,
      beads,
      em: em.map(([x, z]) => [x, heightAt(x, z) + 0.045, z]),
      // phase of each drop: a regular shift along the line plus a little disorder, so that the line twinkles
      ph: Float32Array.from(em, (_, k) => k * PULSE_STEP + 0.24 * noise(k)),
      bead: 2 * Math.min(Math.max((ln.spacing || 0.3) * 0.36, 0.05), 0.12), // largest drop (m), never touching its neighbours
      w: -1,
      wetAtOff: 0,
      offAt: 0,
      wasOn: false,
    });
  }

  for (const c of irr.circuits || []) {
    for (const h of c.heads || []) {
      if (!h.at) continue;
      const toPlan = anchor(h);
      const [x, z] = toPlan(h.at[0], h.at[1]);
      const y = heightAt(x, z);
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.12, 10),
        new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.6 }),
      );
      body.position.set(x, y + 0.06, z);
      const sector = new THREE.Mesh(
        ringSector(h, toPlan, heightAt, 0.05),
        new THREE.MeshBasicMaterial({
          color: ON_COLOR,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        }),
      );
      sector.renderOrder = 3;
      sector.visible = false;
      const model = sprinklerModel(h.model);
      const arc = Math.min(Math.max(h.arc || 90, 1), 360);
      const jets =
        model.kind === 'spray' ? Math.max(3, Math.round(arc / 10)) : model.kind === 'rotator' ? Math.max(3, Math.round(arc / 45)) : 1;
      const per = model.kind === 'rotor' ? 34 : 9;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(jets * per * 3), 3));
      const drops = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: '#dff1ff',
          size: 2.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      drops.visible = false;
      drops.frustumCulled = false;
      group.add(body, sector, drops);
      heads.push({
        h,
        cid: c.id,
        x,
        y,
        z,
        sector,
        drops,
        jets,
        per,
        kind: model.kind,
        arc,
        landY: (dx, dz, r) => heightAt(x + dx * r, z + dz * r),
      });
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  /**
   * states: { [id]: { on, since } }; now: ms; opts: { soil, editing }.
   * Cheap when nothing is on: only the lines / heads whose state changed are touched.
   */
  function update(states, now, opts = {}) {
    let animated = false;
    const cyc = now / 1000 / PULSE_S;
    flowTexture().offset.x = -(((now / 1000) * FLOW_SPEED) / FLOW_PERIOD) % 1;
    for (const L of lines) {
      const st = states[L.ln.id] || { on: false };
      let w;
      let fade = 1;
      if (st.on) {
        w = wetWidth((now - st.since) / 60000, L.ln.flow || 2, opts.soil);
        L.wetAtOff = w;
        L.offAt = 0;
        animated = true;
      } else {
        if (L.wasOn) L.offAt = now;
        fade = L.offAt ? Math.max(0, 1 - (now - L.offAt) / DRY_MS) : 0;
        w = fade > 0 ? L.wetAtOff : 0;
        if (fade > 0) animated = true;
      }
      if (st.on !== L.wasOn) {
        L.tube.material.color.set(st.on ? ON_COLOR : LINE_COLORS[L.ln.color] || LINE_COLORS.black);
        L.tube.material.emissiveIntensity = st.on ? FLOW_GLOW : 0;
        L.tube.visible = st.on || L.ln.color !== 'none' || !!opts.editing;
        L.wasOn = st.on;
      } else if (!st.on) L.tube.visible = L.ln.color !== 'none' || !!opts.editing;
      L.beads.visible = st.on;
      if (st.on) {
        L.em.forEach(([x, y, z], k) => {
          const u = (((cyc - L.ph[k]) % 1) + 1) % 1;
          const d = L.bead * (0.3 + 0.7 * Math.sin(Math.PI * u) ** 2);
          L.beads.setMatrixAt(k, m4.compose(p3.set(x, y + 0.03, z), q, s3.set(d, 1, d)));
        });
        L.beads.instanceMatrix.needsUpdate = true;
      }
      L.spots.visible = w > 0.02;
      L.spots.material.opacity = 0.55 * fade;
      if (L.spots.visible && Math.abs(w - L.w) > 0.004) {
        L.w = w;
        L.em.forEach(([x, y, z], k) => L.spots.setMatrixAt(k, m4.compose(p3.set(x, y, z), q, s3.set(w, 1, w))));
        L.spots.instanceMatrix.needsUpdate = true;
      }
    }
    const t = now / 1000;
    for (const H of heads) {
      const st = states[H.cid] || { on: false };
      H.sector.visible = st.on || !!opts.editing;
      H.sector.material.opacity = st.on ? 0.16 + 0.14 * Math.min((now - st.since) / 600000, 1) : 0.1;
      H.drops.visible = st.on;
      if (!st.on) continue;
      animated = true;
      const pos = H.drops.geometry.attributes.position;
      const h = H.h;
      const lo = h.dir - H.arc / 2;
      for (let j = 0; j < H.jets; j++) {
        let ang;
        if (H.kind === 'rotor') {
          // one jet sweeping the arc back and forth (14 deg/s), or turning round on a full circle
          const u = (t * 14) / H.arc;
          ang = H.arc >= 359 ? lo + ((t * 14) % 360) : lo + H.arc * (1 - Math.abs((u % 2) - 1));
        } else if (H.kind === 'rotator') ang = lo + H.arc * ((j / H.jets + t * 0.04) % 1);
        else ang = lo + (H.arc * (j + 0.5)) / H.jets;
        const [dx, dz] = dirVec(ang);
        for (let k = 0; k < H.per; k++) {
          // droplets fly along a parabola; every other one of a rotor falls short (secondary nozzle)
          const reach = H.kind === 'rotor' && k % 2 ? Math.max(h.rMin || 0, h.rMax * 0.55) : h.rMax;
          const u = (k / H.per + t * 0.9 + j * 0.37) % 1;
          const r = reach * u;
          const yg = H.y + (H.landY(dx, dz, reach) - H.y) * u;
          pos.setXYZ(j * H.per + k, H.x + dx * r, yg + 0.12 + reach * 0.36 * u * (1 - u), H.z + dz * r);
        }
      }
      pos.needsUpdate = true;
    }
    return animated;
  }

  /** Forget the wet ground left by lines that are now closed (end of a test). */
  function reset() {
    for (const L of lines) {
      Object.assign(L, { wetAtOff: 0, offAt: 0, w: -1, wasOn: false });
      L.tube.material.color.set(LINE_COLORS[L.ln.color] || LINE_COLORS.black); // a line really open turns blue again at the next update
      L.tube.material.emissiveIntensity = 0;
      L.spots.visible = false;
      L.beads.visible = false;
    }
  }

  return { group, update, reset, count: lines.length + heads.length };
}
