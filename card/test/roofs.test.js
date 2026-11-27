// Roofs read from the surface model: the slopes found, the roof they make, its mesh.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ROOF_DY,
  buildRoofs,
  buildingOutline,
  normalizeRoof,
  roofInfo,
  roofMesh,
  roofPlanes,
  roofSurface,
  topWalls,
  uncoveredRoof,
} from '../src/roofs.js';
import { inPolygon } from '../src/pools.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // prettier-ignore
/**
 * A terrain of 40 m by 40 m at 0.5 m, flat at 100 m, with a surface model: `roof(x, z)` gives the altitude of a roof
 * (null: the ground). `noise` adds a few centimetres, the same at every run.
 */
function terrain(roof, { step = 0.5, noise = 0, soft = false } = {}) {
  const n = Math.round(40 / step) + 1;
  const o = [-10, -10];
  const z = [];
  const s = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = o[0] + i * step;
      const y = o[1] + j * step;
      const r = roof(x, y);
      // (soft: the cells of the very edge of a roof see a part of the ground, as a real model does)
      const edge = soft && r !== null && [[step, 0], [-step, 0], [0, step], [0, -step]].some(([a, b]) => roof(x + a, y + b) === null); // prettier-ignore
      z.push(100);
      s.push(r === null ? 100 : (edge ? (r + 100) / 2 : r) + noise * Math.sin(i * 12.9898 + j * 78.233) * Math.cos(i * 3.1 - j * 1.7));
    }
  }
  return { version: 1, origin: o, step, nx: n, nz: n, z, s, center: [6, 4] };
}
// a hipped roof over a rectangle: eaves at `eave`, the same slope on the four sides
const hip =
  (x0, z0, x1, z1, eave = 103, slope = 0.5) =>
  (x, z) =>
    x < x0 || x > x1 || z < z0 || z > z1 ? null : eave + slope * Math.min(x - x0, x1 - x, z - z0, z1 - z);
// a roof of two slopes, its ridge along x
const gable =
  (x0, z0, x1, z1, eave = 103, slope = 0.5) =>
  (x, z) =>
    x < x0 || x > x1 || z < z0 || z > z1 ? null : eave + slope * Math.min(z - z0, z1 - z);
const HIP = rect(0, 0, 12, 8);

const stats = (model, poly, truth, margin = 0.5) => {
  const at = roofSurface(model);
  let worst = 0;
  let n = 0;
  for (let x = Math.min(...poly.map((p) => p[0])); x <= Math.max(...poly.map((p) => p[0])); x += 0.37) {
    for (let z = Math.min(...poly.map((p) => p[1])); z <= Math.max(...poly.map((p) => p[1])); z += 0.41) {
      if (!inPolygon(poly, x, z) || truth(x, z) === null) continue;
      if ([[margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([a, b]) => !inPolygon(poly, x + a, z + b))) continue; // prettier-ignore
      worst = Math.max(worst, Math.abs(at(x, z).y - truth(x, z)));
      n++;
    }
  }
  return { worst, n };
};
const areaOf = (pos) => {
  let a = 0;
  for (let k = 0; k < pos.length; k += 9)
    a += Math.abs((pos[k + 3] - pos[k]) * (pos[k + 8] - pos[k + 2]) - (pos[k + 6] - pos[k]) * (pos[k + 5] - pos[k + 2])) / 2;
  return a;
};
const steps = (pos) => {
  const seen = new Map();
  let worst = 0;
  for (let k = 0; k < pos.length; k += 3) {
    const id = `${Math.round(pos[k] * 1e4)}:${Math.round(pos[k + 2] * 1e4)}`;
    if (seen.has(id)) worst = Math.max(worst, Math.abs(seen.get(id) - pos[k + 1]));
    else seen.set(id, pos[k + 1]);
  }
  return worst;
};

describe('a roof of the edits', () => {
  it('gets its defaults, its height correction kept within bounds', () => {
    expect(normalizeRoof(null)).toEqual({ id: '', pts: [], frame: 'grid', dy: 0, c: '', name: '', hidden: false });
    const r = normalizeRoof({ id: 'r1', pts: [[0, 0], [1, 'a'], [2, 2], null], frame: 'plan', dy: 9, c: '#AABBCC', name: 'Main', hidden: 1 }); // prettier-ignore
    expect(r).toMatchObject({ id: 'r1', frame: 'plan', dy: ROOF_DY[1], c: '#AABBCC', name: 'Main', hidden: true });
    expect(r.pts).toEqual([[0, 0], [2, 2]]); // prettier-ignore
    expect(normalizeRoof({ dy: -9, c: 'red', name: 3, pts: 'x' })).toMatchObject({ dy: ROOF_DY[0], c: '', name: '', pts: [] });
  });
});

describe('the outline of the building of the map', () => {
  const t = { buildings: [{ poly: [...rect(0, 0, 10, 8), [0, 0]] }, { poly: rect(30, 30, 34, 34) }, { poly: [[0, 0]] }, null] };
  it('is the one standing at the point, else the nearest one, given open', () => {
    expect(buildingOutline(t, 5, 4)).toEqual(rect(0, 0, 10, 8));
    expect(buildingOutline(t, 36, 36)).toEqual(rect(30, 30, 34, 34)); // 5.7 m from its middle
    expect(buildingOutline(t, 60, 60)).toBeNull();
    expect(buildingOutline({}, 0, 0)).toBeNull();
    expect(buildingOutline(null, 0, 0)).toBeNull();
  });
});

describe('the slopes of a roof in the surface model', () => {
  it('finds the four slopes of a hipped roof and how they meet', () => {
    const model = roofPlanes(terrain(hip(0, 0, 12, 8)), HIP);
    expect(model.planes).toHaveLength(4);
    for (const p of model.planes) {
      expect(p.slope).toBeCloseTo(26.57, 1); // a slope of 1 in 2
      expect(p.rms).toBeLessThan(0.01);
    }
    for (let k = 0; k < 4; k++) for (let l = 0; l < 4; l++) if (k !== l) expect(model.rel(k, l)).not.toBe('max');
    // the two long slopes meet in the ridge, each one meets the two ends in a hip
    expect([1, 2, 3].filter((l) => model.rel(0, l) === 'min')).toHaveLength(3);
    expect(model.rel(0, 0)).toBe('step');
    const { worst, n } = stats(model, HIP, hip(0, 0, 12, 8));
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeLessThan(0.01);
    // the roof goes on to the outline on the plane of each slope, and a little past it
    const at = roofSurface(model);
    expect(at(6, 0).y).toBeCloseTo(103, 2);
    expect(at(6, -0.4).y).toBeCloseTo(102.8, 2);
    expect(at(6, 4).y).toBeCloseTo(105, 2);
    expect(at(0, 4).y).toBeCloseTo(103, 2);
    // far from the window: the nearest cell of it
    expect(at(-50, -50)).toBeTruthy();
  });

  it('stands a model with noise and soft edges, at 0.5 m and at 1 m', () => {
    const noisy = roofPlanes(terrain(hip(0, 0, 12, 8), { noise: 0.03, soft: true }), HIP);
    expect(noisy.planes).toHaveLength(4);
    expect(stats(noisy, HIP, hip(0, 0, 12, 8)).worst).toBeLessThan(0.06);
    expect(roofSurface(noisy)(6, 0).y).toBeCloseTo(103, 1); // (not the half height the model shows on the edge)
    const coarse = roofPlanes(terrain(hip(0, 0, 12, 8), { step: 1 }), HIP);
    expect(coarse.planes).toHaveLength(4);
    expect(stats(coarse, HIP, hip(0, 0, 12, 8)).worst).toBeLessThan(0.02);
  });

  it('tells a valley from a ridge where two roofs cross', () => {
    // two roofs of two slopes at a right angle: the roof is the higher of the two where they cross
    // (the first one stops at the ridge of the second)
    const a = gable(0, 0, 11, 6, 103, 0.6);
    const b = (x, z) => (x < 8 || x > 14 || z < 0 || z > 12 ? null : 103 + 0.6 * Math.min(x - 8, 14 - x));
    const both = (x, z) => (a(x, z) === null ? b(x, z) : b(x, z) === null ? a(x, z) : Math.max(a(x, z), b(x, z)));
    const L = [[0, 0], [14, 0], [14, 12], [8, 12], [8, 6], [0, 6]]; // prettier-ignore
    const model = roofPlanes(terrain(both), L);
    expect(model.planes.length).toBe(4);
    const rels = [];
    for (let k = 0; k < 4; k++) for (let l = k + 1; l < 4; l++) rels.push(model.rel(k, l));
    expect(rels.filter((r) => r === 'max').length).toBeGreaterThanOrEqual(2); // the valleys
    expect(rels.filter((r) => r === 'min').length).toBeGreaterThanOrEqual(2); // the two ridges
    expect(stats(model, L, both).worst).toBeLessThan(0.03);
    const mesh = roofMesh(model, L);
    expect(areaOf(mesh.pos)).toBeCloseTo(120, 3);
    expect(steps(mesh.pos)).toBeLessThan(1e-6);
  });

  it('reads an L of two hipped roofs: a valley inside the corner, hips outside', () => {
    const a = hip(0, 0, 14, 6);
    const b = hip(8, 0, 14, 12);
    const both = (x, z) => (a(x, z) === null ? b(x, z) : b(x, z) === null ? a(x, z) : Math.max(a(x, z), b(x, z)));
    const L = [[0, 0], [14, 0], [14, 12], [8, 12], [8, 6], [0, 6]]; // prettier-ignore
    const model = roofPlanes(terrain(both), L);
    // the south and east slopes are shared by the two wings: six planes in all
    expect(model.planes).toHaveLength(6);
    const rels = [];
    for (let k = 0; k < 6; k++) for (let l = k + 1; l < 6; l++) rels.push(model.rel(k, l));
    expect(rels.filter((r) => r === 'max')).toHaveLength(1);
    expect(rels.filter((r) => r === 'min').length).toBeGreaterThanOrEqual(6);
    expect(stats(model, L, both).worst).toBeLessThan(0.03);
    const mesh = roofMesh(model, L);
    expect(areaOf(mesh.pos)).toBeCloseTo(120, 3);
    expect(steps(mesh.pos)).toBeLessThan(1e-6);
    expect(roofInfo(model, mesh)).toMatchObject({ planes: 6, rise: expect.closeTo(1.5, 1) });
  });

  it('keeps a step between two roofs at different heights', () => {
    // a flat roof 1.2 m under the eaves of the hipped one, against its long side
    const low = (x, z) => (x >= 2 && x <= 10 && z > 8 && z <= 12 ? 101.8 : null);
    const both = (x, z) => hip(0, 0, 12, 8)(x, z) ?? low(x, z);
    const outline = [[0, 0], [12, 0], [12, 8], [10, 8], [10, 12], [2, 12], [2, 8], [0, 8]]; // prettier-ignore
    const model = roofPlanes(terrain(both), outline);
    expect(model.planes).toHaveLength(5);
    const flat = model.planes.findIndex((p) => p.slope < 1);
    expect(flat).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < 5; k++) if (k !== flat) expect(model.rel(k, flat)).toBe('step');
    const at = roofSurface(model);
    expect(at(6, 10).y).toBeCloseTo(101.8, 2);
    expect(at(6, 7).y).toBeCloseTo(103.5, 2);
    const mesh = roofMesh(model, outline);
    expect(areaOf(mesh.pos)).toBeCloseTo(128, 3);
    expect(steps(mesh.pos)).toBeLessThan(1e-6); // (the step is bridged by the triangles standing across it)
  });

  it('needs a surface model, an outline and a roof in it', () => {
    const t = terrain(hip(0, 0, 12, 8));
    expect(roofPlanes({ ...t, s: undefined }, HIP)).toBeNull();
    expect(roofPlanes(null, HIP)).toBeNull();
    expect(roofPlanes(t, [[0, 0], [1, 1]])).toBeNull(); // prettier-ignore
    expect(roofPlanes(t, rect(20, 20, 28, 28))).toBeNull(); // the bare ground
    expect(roofPlanes(t, rect(4, 3, 4.2, 3.2))).toBeNull(); // too small for a slope
  });
});

describe('the mesh of a roof', () => {
  it('covers the outline, cut on its sides and along the ridge', () => {
    const outline = rect(0.13, 0.21, 11.9, 7.83); // (not on the cells of the mesh)
    const model = roofPlanes(terrain(gable(0, 0, 12, 8)), outline);
    expect(model.planes).toHaveLength(2);
    const mesh = roofMesh(model, outline);
    expect(areaOf(mesh.pos)).toBeCloseTo((11.9 - 0.13) * (7.83 - 0.21), 4);
    expect(steps(mesh.pos)).toBeLessThan(1e-9);
    expect(mesh.slope).toHaveLength(mesh.pos.length / 9);
    let top = -Infinity;
    for (let k = 0; k < mesh.pos.length; k += 9) {
      const zs = [mesh.pos[k + 2], mesh.pos[k + 5], mesh.pos[k + 8]];
      // no triangle stands across the ridge (z = 4), and each one lies on the plane of its slope
      expect(Math.min(...zs) >= 4 - 1e-6 || Math.max(...zs) <= 4 + 1e-6).toBe(true);
      for (let c = 0; c < 3; c++) {
        expect(mesh.pos[k + c * 3 + 1]).toBeCloseTo(103 + 0.5 * Math.min(zs[c], 8 - zs[c]), 4);
        top = Math.max(top, mesh.pos[k + c * 3 + 1]);
      }
      // (its face looks up)
      const n =
        (mesh.pos[k + 5] - mesh.pos[k + 2]) * (mesh.pos[k + 6] - mesh.pos[k]) -
        (mesh.pos[k + 3] - mesh.pos[k]) * (mesh.pos[k + 8] - mesh.pos[k + 2]);
      expect(n).toBeGreaterThanOrEqual(0);
    }
    expect(top).toBeCloseTo(105, 3);
    // its edges: the whole outline, at the height of the roof there
    let run = 0;
    for (const [p, q] of mesh.edge) {
      run += Math.hypot(q[0] - p[0], q[2] - p[2]);
      for (const v of [p, q]) expect(v[1]).toBeCloseTo(103 + 0.5 * Math.min(v[2], 8 - v[2]), 4);
    }
    expect(run).toBeCloseTo(2 * (11.9 - 0.13 + 7.83 - 0.21), 4);
    expect(roofInfo(model, mesh)).toMatchObject({ planes: 2 });
    expect(roofInfo(model, mesh).slope).toBeCloseTo(26.57, 1);
    expect(roofInfo(model, mesh).rise).toBeCloseTo(105 - (103 + 0.5 * 0.17), 2);
    expect(roofInfo(null, null)).toBeNull();
    expect(roofInfo(model, { pos: [] })).toBeNull();
  });

  it('follows an outline with a re-entrant corner and sides at an angle', () => {
    const outline = [[1, 1], [11, 0.5], [11.5, 7], [7, 7.5], [6, 5], [1.5, 7.2]]; // prettier-ignore
    const model = roofPlanes(terrain(hip(0, 0, 12, 8)), outline);
    const mesh = roofMesh(model, outline, { cell: 0.2 });
    let a = 0;
    for (let i = 0; i < outline.length; i++)
      a += outline[i][0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * outline[i][1];
    expect(areaOf(mesh.pos)).toBeCloseTo(Math.abs(a / 2), 3);
    expect(steps(mesh.pos)).toBeLessThan(1e-6);
    let run = 0;
    for (const [p, q] of mesh.edge) run += Math.hypot(q[0] - p[0], q[2] - p[2]);
    let around = 0;
    for (let i = 0; i < outline.length; i++)
      around += Math.hypot(outline[(i + 1) % outline.length][0] - outline[i][0], outline[(i + 1) % outline.length][1] - outline[i][1]);
    expect(run).toBeCloseTo(around, 3);
    // the outline drawn the other way round gives the same roof
    expect(areaOf(roofMesh(model, [...outline].reverse(), { cell: 0.2 }).pos)).toBeCloseTo(Math.abs(a / 2), 3);
  });
});

describe('the roofs of the view', () => {
  const t = terrain(hip(0, 0, 12, 8));
  const opts = (more = {}) => ({
    toGrid: (r) => (r.frame === 'plan' ? (x, z) => [x - 100, z] : (x, z) => [x, z]),
    toPlan: (x, z) => [x + 100, z],
    altToY: (alt) => alt - 100,
    material: (r) => new THREE.MeshBasicMaterial({ color: r.c || '#b5563c' }),
    edgeMaterial: new THREE.MeshBasicMaterial(),
    ...more,
  });
  const box = (mesh) => new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position'));

  it('are set on the plan at the height of the model, their edges closed', () => {
    const { group, info } = buildRoofs([{ id: 'a', pts: HIP }], t, opts());
    expect(info).toEqual([{ planes: 4, slope: expect.closeTo(26.57, 1), rise: expect.closeTo(2, 2), seat: null }]);
    expect(group.children.map((c) => c.name)).toEqual(['roof-read-a', 'roof-read-sides-a']);
    const top = box(group.children[0]);
    expect(top.min.x).toBeCloseTo(100, 4);
    expect(top.max.x).toBeCloseTo(112, 4);
    expect(top.min.y).toBeCloseTo(3, 2);
    expect(top.max.y).toBeCloseTo(5, 2);
    // without the walls of a plan under it: the height of a fascia
    const sides = box(group.children[1]);
    expect(sides.max.y).toBeCloseTo(3, 2);
    expect(sides.min.y).toBeCloseTo(2.88, 2);
  });

  it('take a height correction and a colour', () => {
    const { group } = buildRoofs([{ id: 'a', pts: HIP, dy: 0.5, c: '#112233' }], t, opts());
    expect(box(group.children[0]).min.y).toBeCloseTo(3.5, 2);
    expect(group.children[0].material.color.getHexString()).toBe('112233');
    expect(box(group.children[1]).min.y).toBeCloseTo(3.38, 2);
  });

  it('have the walls of the plan carried up to them, and can be seated on those walls', () => {
    // walls of 30 cm, 40 cm inside the edge of the roof, their top at 2.6 m: the roof stands 3.12 m to 3.28 m over
    // their two faces
    const wall = (a, b, top = 2.6) => ({ a, b, thickness: 0.3, top, joinStart: true, joinEnd: true });
    const walls = [
      wall([100.4, 0.4], [111.6, 0.4]),
      wall([111.6, 0.4], [111.6, 7.6]),
      wall([111.6, 7.6], [100.4, 7.6]),
      wall([100.4, 7.6], [100.4, 0.4]),
    ];
    const { group, info } = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls }));
    expect(info[0].seat).toBeCloseTo(-0.525, 1);
    const sides = group.children[1].geometry.getAttribute('position').array;
    let low = 0;
    let gap = 0;
    for (let k = 0; k < sides.length; k += 3) {
      const [x, y, z] = [sides[k] - 100, sides[k + 1], sides[k + 2]];
      const edge = Math.min(x, 12 - x, z, 8 - z); // how far in from the edge of the roof
      if (edge < 0.01) continue; // (the fascia)
      // a point of a wall carried up: on one of its faces, from its top to just under the roof
      expect([x, 12 - x, z, 8 - z].some((d) => Math.abs(d - 0.25) < 1e-4 || Math.abs(d - 0.55) < 1e-4)).toBe(true);
      const roof = 3 + 0.5 * edge;
      expect(y).toBeGreaterThan(2.6 - 1e-4);
      expect(y).toBeLessThan(roof);
      if (Math.abs(y - 2.6) < 1e-4) low++;
      else gap = Math.max(gap, Math.abs(y - (roof - 0.01)));
    }
    expect(low).toBeGreaterThan(300);
    expect(gap).toBeLessThan(1e-3);
    // seated: the roof comes down onto the outer face of the walls, where nothing is left to carry up
    const seated = buildRoofs([{ id: 'a', pts: HIP, dy: info[0].seat }], t, opts({ walls }));
    expect(box(seated.group.children[0]).min.y).toBeCloseTo(3 + info[0].seat, 2);
    expect(seated.info[0].seat).toBe(info[0].seat); // (what it takes does not depend on the correction in place)
    // walls that stand higher than the roof are left as they are; the roof would have to go up to sit on them
    const high = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: walls.map((w) => ({ ...w, top: 4 })) }));
    expect(box(high.group.children[1]).min.y).toBeCloseTo(2.88, 2);
    expect(high.info[0].seat).toBeCloseTo(0.875, 1);
    // a wall out of the roof, a wall half under it
    expect(buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: [wall([130, 0], [140, 0])] })).info[0].seat).toBeNull();
    const half = buildRoofs(
      [{ id: 'a', pts: HIP }],
      t,
      opts({ walls: [{ ...wall([106, 4], [120, 4]), joinStart: false, joinEnd: false }] }),
    );
    expect(box(half.group.children[1]).max.x).toBeLessThan(112.01);
    // a low wall under the roof (a porch, the garden) does not carry it: it is left as it is
    const porch = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: [wall([102, 4], [110, 4], 1.2)] }));
    expect(porch.info[0].seat).toBeNull();
    expect(box(porch.group.children[1]).min.y).toBeCloseTo(2.88, 2);
    // a roof that is hidden still tells what it would take
    expect(buildRoofs([{ id: 'a', pts: HIP, hidden: true }], t, opts({ walls })).info[0].seat).toBeCloseTo(-0.525, 1);
  });

  it('carry up a wall set back under the slope when it goes on from the walls along the eaves', () => {
    const wall = (a, b, top = 2.6) => ({ a, b, thickness: 0.3, top, joinStart: true, joinEnd: true });
    // the front wall of the house with an entrance set back by 3 m: the roof is 2 m above the wall of the door
    const front = [wall([100.4, 0.4], [104, 0.4]), wall([107, 0.4], [111.6, 0.4])];
    const recess = [wall([104, 0.4], [104, 3.4]), wall([104, 3.4], [107, 3.4]), wall([107, 3.4], [107, 0.4])];
    const top = (g) => box(g.children[1]).max.y;
    const whole = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: [...front, ...recess] }));
    // the wall of the door reaches the roof: 3 + 0.5 x 3.55 m over its inner face
    expect(top(whole.group)).toBeCloseTo(3 + 0.5 * 3.55 - 0.01, 2);
    const sides = whole.group.children[1].geometry.getAttribute('position').array;
    let door = 0;
    for (let k = 0; k < sides.length; k += 3) if (Math.abs(sides[k + 2] - 3.25) < 1e-4 && sides[k] > 104.5 && sides[k] < 106.5) door++;
    expect(door).toBeGreaterThan(20); // its outer face, carried up
    // what it takes to seat the roof is still told by the walls along the eaves
    expect(whole.info[0].seat).toBe(buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: front })).info[0].seat);
    // the same wall alone under the slope, or lower than the walls it touches, is left as it is
    const alone = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: [...front, recess[1]] }));
    expect(top(alone.group)).toBeLessThan(3.3);
    const low = buildRoofs([{ id: 'a', pts: HIP }], t, opts({ walls: [...front, recess[0], { ...recess[1], top: 2 }, recess[2]] }));
    let lowDoor = 0;
    const ls = low.group.children[1].geometry.getAttribute('position').array;
    for (let k = 0; k < ls.length; k += 3) if (Math.abs(ls[k + 2] - 3.25) < 1e-4 && ls[k] > 104.5 && ls[k] < 106.5) lowDoor++;
    expect(lowDoor).toBe(0);
  });

  it('are carried by the outer walls no other wall stands on', () => {
    const w = (a, b, more = {}) => ({ a, b, thickness: 0.2, height: 2.5, exterior: true, joinStart: true, joinEnd: false, ...more });
    const levels = [
      // the ground floor: its front under the upper floor, a wing on the side, a partition
      {
        elevation: 0,
        walls: [w([0, 0], [6, 0]), w([6, 0], [10, 0], { height: 2.8 }), w([3, 0], [3, 4], { exterior: false }), w([0, 0], [0, 0])],
      },
      { elevation: 2.7, walls: [w([0, 0], [6, 0.05], { height: 2.4 })] },
    ];
    expect(topWalls(levels)).toEqual([
      { a: [6, 0], b: [10, 0], thickness: 0.2, top: 2.8, joinStart: true, joinEnd: false },
      { a: [0, 0], b: [6, 0.05], thickness: 0.2, top: expect.closeTo(5.1, 5), joinStart: true, joinEnd: false },
    ]);
    expect(topWalls([{ walls: [w([0, 0], [4, 0])] }])[0].top).toBe(2.5); // (a level without elevation stands at 0)
    expect(topWalls([{ elevation: 0 }])).toEqual([]);
    expect(topWalls(null)).toEqual([]);
  });

  it('read an outline given on the plan, and leave out what is hidden or cannot be read', () => {
    const plan = HIP.map(([x, z]) => [x + 100, z]);
    const { group, info } = buildRoofs(
      [
        { id: 'p', pts: plan, frame: 'plan' },
        { id: 'h', pts: HIP, hidden: true },
        { id: 'g', pts: rect(20, 20, 28, 28) },
        { id: 'n', pts: [[0, 0]] }, // prettier-ignore
      ],
      t,
      opts(),
    );
    expect(group.children.map((c) => c.name)).toEqual(['roof-read-p', 'roof-read-sides-p']);
    expect(info.map((i) => (i ? i.planes : null))).toEqual([4, 4, null, null]);
    expect(buildRoofs(null, t, opts()).info).toEqual([]);
  });

  it('take the place of the roof of the plan where they stand', () => {
    const { outlines } = buildRoofs([{ id: 'a', pts: HIP }, { id: 'h', pts: rect(20, 0, 28, 8), hidden: true }], t, opts()); // prettier-ignore
    expect(outlines).toEqual([HIP.map(([x, z]) => [x + 100, z])]);
    // a flat roof of two slabs: the one under the roof read goes, the other one (a terrace beside it) stays
    const flat = { type: 'flat', y: 3, thickness: 0.2, polys: [rect(101, 1, 111, 7), rect(112.5, 0, 118, 8)] };
    expect(uncoveredRoof(flat, outlines)).toEqual({ ...flat, polys: [rect(112.5, 0, 118, 8)] });
    expect(uncoveredRoof({ ...flat, polys: [rect(101, 1, 111, 7)] }, outlines)).toBeNull();
    // a roof of two slopes: all of it or nothing
    const two = { type: 'gable', fp: { x0: 100, z0: 0, x1: 112, z1: 8 }, eaveY: 3, ridgeH: 2, overhang: 0.5, axis: 'x' };
    expect(uncoveredRoof(two, outlines)).toBeNull();
    expect(uncoveredRoof({ ...two, fp: { x0: 130, z0: 0, x1: 140, z1: 8 } }, outlines)).toMatchObject({ type: 'gable' });
    // no roof read: the roof of the plan as it is
    expect(uncoveredRoof(flat, [])).toBe(flat);
    expect(uncoveredRoof(null, outlines)).toBeNull();
  });
});

describe('where a roof stands on the surface model', () => {
  it('gives its altitude, and nothing over the ground or out of the model', async () => {
    const { roofAltitude } = await import('../src/roofs.js');
    // 3 x 2 cells of 0.5 m from (10, 20): ground at 100, a roof at 104.2 on two of them, a hedge of 1 m, a gap
    const t = { origin: [10, 20], step: 0.5, nx: 3, nz: 2, z: [100, 100, 100, 100, 100, 100], s: [104.2, 104.2, 101, 100, null, 101.5] };
    const at = roofAltitude(t);
    expect(at(10, 20)).toBe(104.2);
    expect(at(10.6, 20.1)).toBe(104.2); // the nearest cell
    expect(at(11, 20)).toBeNull(); // a hedge
    expect(at(10, 20.5)).toBeNull(); // the ground
    expect(at(10.5, 20.5)).toBeNull(); // no measure
    expect(at(11, 20.5)).toBe(101.5); // 1.5 m: a low roof
    expect(at(9, 20)).toBeNull();
    expect(at(10, 22)).toBeNull();
    expect(roofAltitude({ ...t, s: null })(10, 20)).toBeNull();
    expect(roofAltitude(null)(10, 20)).toBeNull();
  });
});
