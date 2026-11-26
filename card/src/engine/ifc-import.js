// IFC (BIM: ArchiCAD, Revit, FreeCAD, BlenderBIM…) -> generic scene (see scene-model.js).
// The STEP text is read here, without any WebAssembly: storeys become levels, spaces become rooms (footprint of
// their body), walls keep their axis, thickness and height, doors and windows sit on the walls. The geometry read
// covers what exporters write for these elements: extruded profiles (polyline, indexed curve, rectangle, circle),
// faceted B-reps, polygonal face sets, boolean results (first operand) and mapped items.
import { pointInPolygon } from './geometry.js';
import { SLAB_T } from './scene-data.js';
import { ceilingLights, sceneFromPlan, slug } from '../plan-builder.js';

// ---------------------------------------------------------------- STEP text

/** Decodes the escapes of STEP strings: '' , \X2\hhhh…\X0\ (UTF-16), \X\hh (ISO 8859-1), \S\c. */
export function decodeStepString(s) {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_, h) => String.fromCharCode(...h.match(/.{4}/g).map((x) => parseInt(x, 16))))
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 128));
}

/**
 * Entities of the DATA section: Map id -> { type, args }. An argument is a number, a string, a reference
 * ({ ref: id }), an enumeration ({ enum: 'X' }), null ($ or *), a list (array) or a typed value ({ type, args }).
 */
export function parseStep(text) {
  const start = text.indexOf('DATA;');
  if (start < 0) throw new Error('Not an IFC file (no DATA section).');
  const src = text.slice(start + 5);
  const out = new Map();
  let i = 0;
  const n = src.length;
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
      } else return;
    }
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === "'") {
      let j = i + 1;
      let s = '';
      for (;;) {
        const k = src.indexOf("'", j);
        if (k < 0) throw new Error('Unterminated string');
        if (src[k + 1] === "'") {
          s += src.slice(j, k + 2);
          j = k + 2;
        } else {
          s += src.slice(j, k);
          i = k + 1;
          break;
        }
      }
      return decodeStepString(s);
    }
    if (c === '#') {
      const m = /^#(\d+)/.exec(src.slice(i, i + 20));
      i += m[0].length;
      return { ref: +m[1] };
    }
    if (c === '$' || c === '*') {
      i++;
      return null;
    }
    if (c === '.') {
      const k = src.indexOf('.', i + 1);
      const e = src.slice(i + 1, k);
      i = k + 1;
      return { enum: e };
    }
    if (c === '(') return list();
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z0-9_]+/.exec(src.slice(i, i + 80));
      i += m[0].length;
      ws();
      return { type: m[0].toUpperCase(), args: list() };
    }
    const m = /^[-+0-9.eE]+/.exec(src.slice(i, i + 40));
    if (!m) throw new Error(`Unexpected "${c}" in the IFC file`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const list = () => {
    const a = [];
    i++; // (
    ws();
    if (src[i] === ')') {
      i++;
      return a;
    }
    for (;;) {
      a.push(value());
      ws();
      if (src[i] === ',') i++;
      else if (src[i] === ')') {
        i++;
        return a;
      } else throw new Error('Malformed list in the IFC file');
    }
  };
  for (;;) {
    ws();
    if (i >= n || src.startsWith('ENDSEC', i)) break;
    const m = /^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*/.exec(src.slice(i, i + 120));
    if (!m) {
      // something else (complex entity instance…): skip to the end of the record
      const e = src.indexOf(';', i);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    i += m[0].length;
    let args = [];
    try {
      args = list();
    } catch {
      const e = src.indexOf(';', i);
      i = e < 0 ? n : e;
    }
    ws();
    if (src[i] === ';') i++;
    out.set(+m[1], { type: m[2].toUpperCase(), args });
  }
  return out;
}

// ---------------------------------------------------------------- matrices (4x4, row-major, affine)

const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
const apply = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * (p[2] || 0) + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * (p[2] || 0) + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * (p[2] || 0) + m[11],
];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function frame(o, z, x) {
  z = norm(z);
  x = norm(x.map((v, k) => v - dot(x, z) * z[k]));
  if (!Number.isFinite(x[0]) || Math.hypot(...x) < 1e-9) x = Math.abs(z[0]) < 0.9 ? norm(cross([0, 1, 0], z)) : [0, 0, 1];
  const y = cross(z, x);
  return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2] || 0, 0, 0, 0, 1];
}

// ---------------------------------------------------------------- the IFC model

class Model {
  constructor(text) {
    this.e = parseStep(text);
    this.scale = this._lengthScale();
    this._plc = new Map();
  }

  get(ref) {
    return ref && ref.ref !== undefined ? this.e.get(ref.ref) || null : ref && ref.type ? ref : null;
  }

  *all(...types) {
    for (const [id, x] of this.e) if (types.includes(x.type)) yield [id, x];
  }

  _lengthScale() {
    for (const [, u] of this.all('IFCSIUNIT')) {
      if (u.args[1] && u.args[1].enum === 'LENGTHUNIT') {
        const p = u.args[2] && u.args[2].enum;
        return { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[p] || 1;
      }
    }
    for (const [, u] of this.all('IFCCONVERSIONBASEDUNIT')) {
      if (u.args[1] && u.args[1].enum === 'LENGTHUNIT') {
        const name = String(u.args[2] || '').toUpperCase();
        if (name.includes('INCH')) return 0.0254;
        if (name.includes('FOOT') || name.includes('FEET')) return 0.3048;
      }
    }
    return 1;
  }

  point(ref) {
    const p = this.get(ref);
    return p && p.args[0] ? p.args[0].map(Number) : [0, 0, 0];
  }

  dir(ref, def) {
    const d = this.get(ref);
    return d && d.args[0] ? [...d.args[0].map(Number), 0, 0].slice(0, 3) : def;
  }

  /** Matrix of an IfcAxis2Placement3D / 2D. */
  axis(ref) {
    const a = this.get(ref);
    if (!a) return I4();
    const o = this.point(a.args[0]);
    if (a.type === 'IFCAXIS2PLACEMENT2D') {
      const x = this.dir(a.args[1], [1, 0, 0]);
      return frame([o[0], o[1], 0], [0, 0, 1], [x[0], x[1], 0]);
    }
    return frame([o[0], o[1], o[2] || 0], this.dir(a.args[1], [0, 0, 1]), this.dir(a.args[2], [1, 0, 0]));
  }

  /** World matrix of an IfcLocalPlacement (chain of relative placements). */
  placement(ref) {
    const p = this.get(ref);
    if (!p || p.type !== 'IFCLOCALPLACEMENT') return I4();
    const id = ref.ref;
    if (this._plc.has(id)) return this._plc.get(id);
    this._plc.set(id, I4()); // guards against a cycle
    const m = mul(p.args[0] ? this.placement(p.args[0]) : I4(), this.axis(p.args[1]));
    this._plc.set(id, m);
    return m;
  }

  /** Outline of a profile (2D points, in the profile's frame). */
  profile(ref) {
    const p = this.get(ref);
    if (!p) return null;
    if (p.type === 'IFCRECTANGLEPROFILEDEF' || p.type === 'IFCROUNDEDRECTANGLEPROFILEDEF') {
      const m = this.axis(p.args[2]);
      const [hx, hy] = [p.args[3] / 2, p.args[4] / 2];
      return [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ].map((q) => apply(m, q).slice(0, 2));
    }
    if (p.type === 'IFCCIRCLEPROFILEDEF') {
      const m = this.axis(p.args[2]);
      const r = p.args[3];
      return Array.from({ length: 16 }, (_, k) => apply(m, [r * Math.cos((k * Math.PI) / 8), r * Math.sin((k * Math.PI) / 8)]).slice(0, 2));
    }
    if (p.type === 'IFCARBITRARYCLOSEDPROFILEDEF' || p.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') return this.curve(p.args[2]);
    return null;
  }

  /** Points of a 2D or 3D curve (polyline, indexed poly curve, composite of polylines). */
  curve(ref) {
    const c = this.get(ref);
    if (!c) return null;
    if (c.type === 'IFCPOLYLINE') return c.args[0].map((q) => this.point(q));
    if (c.type === 'IFCINDEXEDPOLYCURVE') {
      const pl = this.get(c.args[0]);
      return pl ? pl.args[0].map((q) => q.map(Number)) : null;
    }
    if (c.type === 'IFCCOMPOSITECURVE') {
      const pts = [];
      for (const s of c.args[0] || []) {
        const seg = this.get(s);
        const sub = seg && this.curve(seg.args[2]);
        if (sub) pts.push(...sub);
      }
      return pts.length ? pts : null;
    }
    if (c.type === 'IFCTRIMMEDCURVE') return this.curve(c.args[0]);
    return null;
  }

  /** Faces (3D polygons) of a representation item, in the frame of its representation. */
  faces(ref, depth = 0) {
    const it = this.get(ref);
    if (!it || depth > 8) return [];
    const t = it.type;
    if (t === 'IFCEXTRUDEDAREASOLID' || t === 'IFCEXTRUDEDAREASOLIDTAPERED') {
      const prof = this.profile(it.args[0]);
      if (!prof || prof.length < 3) return [];
      const m = this.axis(it.args[1]);
      const d = norm(this.dir(it.args[2], [0, 0, 1]));
      const h = +it.args[3] || 0;
      const bottom = prof.map((q) => apply(m, [q[0], q[1], 0]));
      const md = [
        m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
        m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
        m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
      ];
      const top = bottom.map((q) => [q[0] + md[0] * h, q[1] + md[1] * h, q[2] + md[2] * h]);
      return [bottom, top];
    }
    if (t === 'IFCFACETEDBREP' || t === 'IFCFACETEDBREPWITHVOIDS') {
      const shell = this.get(it.args[0]);
      return shell ? this._shellFaces(shell) : [];
    }
    if (t === 'IFCSHELLBASEDSURFACEMODEL' || t === 'IFCFACEBASEDSURFACEMODEL')
      return (it.args[0] || []).flatMap((s) => {
        const sh = this.get(s);
        return sh ? this._shellFaces(sh) : [];
      });
    if (t === 'IFCPOLYGONALFACESET' || t === 'IFCTRIANGULATEDFACESET') {
      const pl = this.get(it.args[0]);
      if (!pl) return [];
      const pts = pl.args[0].map((q) => q.map(Number));
      const at = (k) => pts[k - 1];
      if (t === 'IFCTRIANGULATEDFACESET') return (it.args[3] || []).map((tri) => tri.map(at).filter(Boolean));
      return (it.args[2] || []).map((f) => {
        const face = this.get(f);
        return face ? face.args[0].map(at).filter(Boolean) : [];
      });
    }
    if (t === 'IFCBOOLEANCLIPPINGRESULT' || t === 'IFCBOOLEANRESULT') return this.faces(it.args[1], depth + 1);
    if (t === 'IFCMAPPEDITEM') {
      const map = this.get(it.args[0]);
      if (!map) return [];
      const origin = this.axis(map.args[0]);
      const target = this._operator(it.args[1]);
      const rep = this.get(map.args[1]);
      const m = mul(target, origin);
      return (rep ? rep.args[3] || [] : []).flatMap((x) => this.faces(x, depth + 1)).map((f) => f.map((q) => apply(m, q)));
    }
    return [];
  }

  _shellFaces(shell) {
    return (shell.args[0] || [])
      .map((f) => {
        const face = this.get(f);
        const bound = face && (face.args[0] || []).map((b) => this.get(b)).find((b) => b && b.type === 'IFCFACEOUTERBOUND');
        const any = bound || (face && this.get((face.args[0] || [])[0]));
        const loop = any && this.get(any.args[0]);
        return loop && loop.type === 'IFCPOLYLOOP' ? loop.args[0].map((q) => this.point(q)) : null;
      })
      .filter((f) => f && f.length >= 3);
  }

  _operator(ref) {
    const o = this.get(ref);
    if (!o) return I4();
    const x = this.dir(o.args[0], [1, 0, 0]);
    const z = o.args[4] !== undefined ? this.dir(o.args[4], [0, 0, 1]) : [0, 0, 1];
    const p = this.point(o.args[2]);
    const s = Number.isFinite(o.args[3]) ? o.args[3] : 1;
    const m = frame(p, z, x);
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[k] *= s;
    return m;
  }

  /** World faces of a product (its Body representation, or any 3D one), in meters. */
  productFaces(prod, placementIdx = 5, reprIdx = 6) {
    const shape = this.get(prod.args[reprIdx]);
    if (!shape) return [];
    const reps = (shape.args[2] || []).map((r) => this.get(r)).filter(Boolean);
    const body = reps.find((r) => r.args[1] === 'Body') || reps.find((r) => r.args[1] !== 'Axis' && r.args[1] !== 'FootPrint') || null;
    if (!body) return [];
    const m = this.placement(prod.args[placementIdx]);
    const s = this.scale;
    return (body.args[3] || []).flatMap((it) => this.faces(it)).map((f) => f.map((q) => apply(m, q).map((v) => v * s)));
  }
}

// ---------------------------------------------------------------- outlines

const area2 = (p) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (const q of p.reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Footprint of faces seen from above, in IFC plan coordinates: the boundary of the faces lying at the lowest height
 * (edges used by one of them only, chained), or the convex hull of all the points. { poly, zMin, zMax } or null.
 */
export function footprint(faces) {
  const pts = faces.flat();
  if (pts.length < 3) return null;
  const zMin = Math.min(...pts.map((q) => q[2]));
  const zMax = Math.max(...pts.map((q) => q[2]));
  const tol = 0.02;
  const bottom = faces.filter((f) => f.length >= 3 && f.every((q) => Math.abs(q[2] - zMin) < tol));
  const k = (q) => `${q[0].toFixed(3)},${q[1].toFixed(3)}`;
  const edges = new Map();
  for (const f of bottom)
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      if (k(a) === k(b)) continue;
      const key = [k(a), k(b)].sort().join('|');
      const e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { a, b, n: 1 });
    }
  const free = [...edges.values()].filter((e) => e.n === 1);
  if (free.length >= 3) {
    // chain the free edges into the longest loop
    const next = new Map();
    for (const e of free) {
      next.set(k(e.a), [...(next.get(k(e.a)) || []), e.b]);
      next.set(k(e.b), [...(next.get(k(e.b)) || []), e.a]);
    }
    const used = new Set();
    let best = null;
    for (const e of free) {
      if (used.has(k(e.a))) continue;
      const loop = [e.a];
      let prev = null;
      let cur = e.a;
      for (let guard = 0; guard < free.length + 2; guard++) {
        used.add(k(cur));
        const cand = (next.get(k(cur)) || []).find((q) => (!prev || k(q) !== k(prev)) && (!used.has(k(q)) || k(q) === k(e.a)));
        if (!cand || k(cand) === k(e.a)) break;
        loop.push(cand);
        prev = cur;
        cur = cand;
      }
      if (loop.length >= 3 && (!best || Math.abs(area2(loop)) > Math.abs(area2(best)))) best = loop;
    }
    if (best && Math.abs(area2(best)) > 0.05) return { poly: best.map((q) => [q[0], q[1]]), zMin, zMax };
  }
  const hull = convexHull(pts.map((q) => [q[0], q[1]]));
  return hull.length >= 3 ? { poly: hull, zMin, zMax } : null;
}

/** Smallest rectangle around a polygon: { c: centre, u: unit long axis, len, wid }. */
export function minRect(poly) {
  const hull = convexHull(poly);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const v = [-u[1], u[0]];
    const pu = hull.map((q) => q[0] * u[0] + q[1] * u[1]);
    const pv = hull.map((q) => q[0] * v[0] + q[1] * v[1]);
    const [u0, u1, v0, v1] = [Math.min(...pu), Math.max(...pu), Math.min(...pv), Math.max(...pv)];
    const ar = (u1 - u0) * (v1 - v0);
    if (!best || ar < best.ar - 1e-9) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const c = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      best = u1 - u0 >= v1 - v0 ? { ar, c, u, len: u1 - u0, wid: v1 - v0 } : { ar, c, u: v, len: v1 - v0, wid: u1 - u0 };
    }
  }
  return best;
}

// ---------------------------------------------------------------- IFC -> scene

const WALLS = ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE', 'IFCCURTAINWALL'];
const DOORS = ['IFCDOOR', 'IFCDOORSTANDARDCASE'];
const WINDOWS = ['IFCWINDOW', 'IFCWINDOWSTANDARDCASE'];
const fix = (v) => Math.round(v * 1000) / 1000;

function dms(v) {
  if (!Array.isArray(v) || !v.length) return null;
  const [d, m = 0, s = 0, u = 0] = v.map(Number);
  const sign = d < 0 || m < 0 || s < 0 ? -1 : 1;
  return sign * (Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600 + Math.abs(u) / 3.6e9);
}

/** Scene of an IFC text: { scene, report }. `latitude`: of the home, when the file gives none. */
export function parseIfc(text, filename = 'plan.ifc', latitude = 45) {
  const M = new Model(text);
  const warnings = [];
  // plan of the scene: x = east (IFC x), z = south (IFC -y)
  const toPlan = (q) => [fix(q[0]), fix(-q[1])];

  // ---- storeys and what they hold
  const storeys = [...M.all('IFCBUILDINGSTOREY')].map(([id, s]) => {
    const z = apply(M.placement(s.args[5]), [0, 0, 0])[2] * M.scale;
    const elev = Number.isFinite(s.args[9]) ? s.args[9] * M.scale : z;
    return { id, name: s.args[7] || s.args[2] || `Niveau ${id}`, elevation: fix(elev) };
  });
  if (!storeys.length) throw new Error('No storey (IfcBuildingStorey) in this IFC file.');
  storeys.sort((a, b) => a.elevation - b.elevation);
  const owner = new Map(); // element id -> storey id
  const spaceOwner = new Map();
  for (const [, r] of M.all('IFCRELAGGREGATES')) {
    const parent = r.args[4] && r.args[4].ref;
    for (const c of r.args[5] || []) if (c && c.ref) spaceOwner.set(c.ref, parent);
  }
  for (const [, r] of M.all('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const parent = r.args[5] && r.args[5].ref;
    for (const c of r.args[4] || []) if (c && c.ref) owner.set(c.ref, parent);
  }
  const storeyIds = new Set(storeys.map((s) => s.id));
  const storeyOf = (id, zMin) => {
    let p = owner.get(id) ?? spaceOwner.get(id);
    for (let guard = 0; p && !storeyIds.has(p) && guard < 6; guard++) p = spaceOwner.get(p) ?? owner.get(p);
    if (p && storeyIds.has(p)) return p;
    // not related: the storey just under the element
    let best = storeys[0];
    for (const s of storeys) if (s.elevation <= zMin + 0.3) best = s;
    return best.id;
  };

  // ---- spaces -> rooms
  const rooms = new Map(storeys.map((s) => [s.id, []]));
  let ri = 0;
  for (const [id, sp] of M.all('IFCSPACE')) {
    const fp = footprint(M.productFaces(sp));
    if (!fp || Math.abs(area2(fp.poly)) < 0.5) continue;
    ri++;
    const name = sp.args[7] || sp.args[2] || `Pièce ${ri}`;
    rooms
      .get(storeyOf(id, fp.zMin))
      .push({ id: `r${ri}`, name: String(name), area: slug(String(name)) || `room_${ri}`, poly: fp.poly.map(toPlan), zMin: fp.zMin });
  }

  // ---- walls
  const walls = new Map(storeys.map((s) => [s.id, []]));
  for (const [id, w] of M.all(...WALLS)) {
    const fp = footprint(M.productFaces(w));
    if (!fp) continue;
    const rect = minRect(fp.poly);
    if (!rect || rect.len < 0.1) continue;
    // axis = middle line of the smallest rectangle around the body, along its long side
    const half = rect.len / 2;
    const a = [rect.c[0] - rect.u[0] * half, rect.c[1] - rect.u[1] * half];
    const b = [rect.c[0] + rect.u[0] * half, rect.c[1] + rect.u[1] * half];
    walls.get(storeyOf(id, fp.zMin)).push({
      a: toPlan(a),
      b: toPlan(b),
      thickness: fix(Math.min(Math.max(rect.wid, 0.05), 1)),
      height: fix(Math.max(fp.zMax - fp.zMin, 0.3)),
      zMin: fp.zMin,
      joinStart: true,
      joinEnd: true,
      exterior: true,
    });
  }

  // ---- levels: height up to the next storey
  const levels = storeys.map((s, i) => {
    const next = storeys[i + 1];
    const ws = walls.get(s.id);
    const wallH = ws.length ? Math.max(...ws.map((w) => w.height)) : 2.5;
    const height = next ? Math.max(next.elevation - s.elevation - SLAB_T, 2) : wallH;
    return {
      id: `L${s.id}`,
      sid: s.id,
      name: String(s.name),
      elevation: s.elevation,
      height: fix(height),
      rooms: rooms.get(s.id),
      walls: ws,
    };
  });

  // ---- doors and windows: centre and width from their body, on the wall nearest to them
  const openings = [];
  const roomAt = (lv, p) => lv.rooms.find((r) => pointInPolygon(p, r.poly)) || null;
  const nearestWall = (lv, p) => {
    let best = null;
    for (const w of lv.walls) {
      const dx = w.b[0] - w.a[0];
      const dz = w.b[1] - w.a[1];
      const L2 = dx * dx + dz * dz;
      if (!L2) continue;
      const t = Math.min(Math.max(((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dz) / L2, 0), 1);
      const q = [w.a[0] + dx * t, w.a[1] + dz * t];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= w.thickness / 2 + 0.6 && (!best || d < best.d)) best = { d, q, w };
    }
    return best;
  };
  for (const [id, o] of M.all(...DOORS, ...WINDOWS)) {
    const fp = footprint(M.productFaces(o));
    const plc = apply(M.placement(o.args[5]), [0, 0, 0]).map((v) => v * M.scale);
    const zMin = fp ? fp.zMin : plc[2];
    const lv = levels.find((l) => l.sid === storeyOf(id, zMin));
    const rect = fp && minRect(fp.poly);
    // without a body: OverallHeight / OverallWidth of the element
    const width = rect ? rect.len : (+o.args[9] || 0) * M.scale || (DOORS.includes(o.type) ? 0.9 : 1.2);
    const height = fp ? fp.zMax - fp.zMin : (+o.args[8] || 0) * M.scale || (DOORS.includes(o.type) ? 2.1 : 1.25);
    let at = toPlan(rect ? rect.c : plc);
    const near = nearestWall(lv, at);
    if (!near) continue;
    at = near.q.map(fix);
    const sill = fix(Math.max(zMin - lv.elevation, 0));
    let type = DOORS.includes(o.type) ? 'door' : 'window';
    const name = String(o.args[2] || '');
    if (type === 'window' && sill < 0.3 && height > 1.8) type = 'patio';
    if (type === 'door' && /slid|coulis|patio|glaz|vitr|baie/i.test(name)) type = 'patio';
    // a garage door: named as one, or simply a door too wide to be anything else
    if (type === 'door' && sill < 0.2 && (/garage|sectional|basculante|overhead/i.test(name) || (width >= 2.4 && height >= 1.9)))
      type = 'garage';
    const nx = -(near.w.b[1] - near.w.a[1]);
    const nz = near.w.b[0] - near.w.a[0];
    const L = Math.hypot(nx, nz) || 1;
    const room =
      roomAt(lv, [at[0] + (nx / L) * 0.35, at[1] + (nz / L) * 0.35]) || roomAt(lv, [at[0] - (nx / L) * 0.35, at[1] - (nz / L) * 0.35]);
    openings.push({
      level: lv.id,
      type,
      at,
      width: fix(Math.max(width, 0.3)),
      sill,
      height: fix(Math.max(height, 0.3)),
      room: room ? room.id : null,
      name,
    });
  }

  // ---- scene: the walls of the file, or walls drawn around the spaces when it has none
  const anyWalls = levels.some((l) => l.walls.length);
  const kept = levels.filter((l) => l.rooms.length || l.walls.length);
  if (!kept.length) throw new Error('No space (IfcSpace) nor wall in this IFC file.');
  const dropped = levels.filter((l) => !kept.includes(l)).map((l) => l.name);
  if (dropped.length) warnings.push(`Niveau(x) vide(s) retiré(s) : ${dropped.join(', ')}`);
  let lat = latitude;
  let north = 0;
  for (const [, s] of M.all('IFCSITE')) {
    const v = dms(s.args[9]);
    if (v !== null && Math.abs(v) > 0.01 && Math.abs(v) <= 90) lat = v;
  }
  for (const [, c] of M.all('IFCGEOMETRICREPRESENTATIONCONTEXT')) {
    const tn = M.get(c.args[5]);
    if (tn && tn.args[0]) north = (Math.atan2(tn.args[0][0], tn.args[0][1]) * 180) / Math.PI;
  }
  let scene;
  if (anyWalls) {
    for (const lv of kept) {
      for (const r of lv.rooms) {
        r.floor = /cuisine|kitchen|bain|bath|wc|toilet|buanderie|laundry|garage|entr|hall/i.test(r.name) ? '#cfcfc8' : '#b99a6b';
        r.temp = null;
        r.inset = 0.004; // spaces follow the inner faces of the walls
        delete r.zMin;
      }
      for (const w of lv.walls) {
        delete w.zMin;
        if (!lv.rooms.length) continue;
        const dx = w.b[0] - w.a[0];
        const dz = w.b[1] - w.a[1];
        const L = Math.hypot(dx, dz) || 1;
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        const d = w.thickness / 2 + 0.1;
        w.exterior = !(roomAt(lv, [m[0] - (dz / L) * d, m[1] + (dx / L) * d]) && roomAt(lv, [m[0] + (dz / L) * d, m[1] - (dx / L) * d]));
      }
    }
    scene = {
      name: filename.replace(/\.ifc$/i, ''),
      site: { latitude: lat, northOffsetDeg: fix(north) },
      levels: kept.map(({ sid, ...l }) => ({ ...l, floorThickness: SLAB_T })),
      openings,
      lights: ceilingLights(kept),
      furniture: [],
      vegetation: [],
      outdoor: [],
    };
  } else {
    warnings.push('Aucun mur dans le fichier : murs tracés autour des pièces');
    scene = sceneFromPlan({ name: filename.replace(/\.ifc$/i, ''), latitude: lat, north: fix(north), levels: kept, openings });
  }
  const noRoom = kept.filter((l) => !l.rooms.length).map((l) => l.name);
  if (noRoom.length) warnings.push(`Aucune pièce (IfcSpace) sur : ${noRoom.join(', ')} ; pas de lumières ni de lien avec les zones`);
  const count = (t) => openings.filter((o) => o.type === t).length;
  return {
    scene,
    report: {
      counts: {
        niveaux: kept.length,
        murs: kept.reduce((n, l) => n + l.walls.length, 0),
        pièces: kept.reduce((n, l) => n + l.rooms.length, 0),
        fenêtres: count('window') + count('patio'),
        portes: count('door'),
      },
      warnings,
    },
  };
}

export async function importIfc(file, latitude) {
  return parseIfc(await file.text(), file.name, latitude);
}
