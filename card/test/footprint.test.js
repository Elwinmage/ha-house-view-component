// The house in the ground: what it takes up on the plan, and the ground mesh cut along its walls.
import { describe, it, expect } from 'vitest';
import { houseFootprint } from '../src/engine/footprint.js';
import { buildTerrain, syntheticTerrain } from '../src/engine/terrain.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // prettier-ignore
const wall = (a, b, thickness = 0.3, more = {}) => ({ a, b, thickness, height: 2.5, joinStart: true, joinEnd: true, ...more });
// a room of 6 m by 4 m, its walls on its outline: their outer faces stand 15 cm out
const room = (x0, z0, x1, z1) => ({ poly: rect(x0, z0, x1, z1) });
const around = (x0, z0, x1, z1, t = 0.3) => [
  wall([x0, z0], [x1, z0], t),
  wall([x1, z0], [x1, z1], t),
  wall([x1, z1], [x0, z1], t),
  wall([x0, z1], [x0, z0], t),
];
const level = (elevation, rooms, walls) => ({ elevation, rooms, walls });

describe('what the house takes up on the plan', () => {
  it('is its rooms and the walls around them', () => {
    const h = houseFootprint([level(0, [room(0, 0, 6, 4)], around(0, 0, 6, 4))]);
    expect(h.floorAt(3, 2)).toBe(0);
    // in the thickness of a wall, and in the corner two walls share
    expect(h.floorAt(3, -0.1)).toBe(0);
    expect(h.floorAt(6.1, 2)).toBe(0);
    expect(h.floorAt(-0.1, -0.1)).toBe(0);
    // past the outer faces: the garden
    expect(h.floorAt(3, -0.2)).toBeNull();
    expect(h.floorAt(6.2, 2)).toBeNull();
    expect(h.floorAt(30, 30)).toBeNull();
    expect(h.box[0]).toBeCloseTo(-0.15);
    expect(h.box[2]).toBeCloseTo(6.15);
  });

  it('leaves a wall of the garden to the ground', () => {
    const garden = wall([10, 0], [16, 0]);
    // (one wall of the house goes on along the garden, 6 m past the corner)
    const long = wall([0, 4], [12, 4]);
    const h = houseFootprint([
      level(0, [room(0, 0, 6, 4)], [...around(0, 0, 6, 4).filter((w) => w.a[1] !== 4 || w.b[1] !== 4), long, garden]),
    ]);
    expect(h.floorAt(13, 0)).toBeNull();
    expect(h.floorAt(3, 4.1)).toBe(0);
    expect(h.floorAt(6.1, 4.1)).toBe(0); // the corner of the house
    expect(h.floorAt(8, 4)).toBeNull(); // further on, no room stands against it
    expect(h.floorAt(11, 4)).toBeNull();
  });

  it('keeps the lowest floor where levels stand over one another', () => {
    // a basement under the left half of the ground floor
    const basement = level(0, [room(0, 0, 3, 4)], around(0, 0, 3, 4));
    const ground = level(2.5, [room(0, 0, 6, 4)], around(0, 0, 6, 4));
    const h = houseFootprint([basement, ground]);
    expect(h.floorAt(1, 2)).toBe(0);
    expect(h.floorAt(3.1, 2)).toBe(0); // the wall of the basement
    expect(h.floorAt(5, 2)).toBe(2.5);
    expect(h.floorAt(6.1, 2)).toBe(2.5);
    // the limit of the basement, inside the house: found from both sides, the point given stands on the high side
    for (const x of [2.9, 3.4]) {
      const e = h.edge(x, 2, 0.4);
      expect(e.x).toBeCloseTo(3.17);
      expect(e.z).toBeCloseTo(2);
      expect(e.y).toBe(0);
      expect(h.floorAt(e.x, e.z)).toBe(2.5);
    }
  });

  it('gives the outline of the house: the outer face of its walls', () => {
    const h = houseFootprint([level(0, [room(0, 0, 6, 4)], around(0, 0, 6, 4))]);
    // from the garden and from the room, the same face; never the inner one
    for (const z of [-0.4, -0.05, 0.2]) {
      const e = h.edge(2.02, z, 0.4);
      expect(e.x).toBeCloseTo(2.02);
      expect(e.z).toBeCloseTo(-0.17);
      expect(e.y).toBe(0);
      expect(h.floorAt(e.x, e.z)).toBeNull();
    }
    // around a corner: the corner itself
    const c = h.edge(-0.3, -0.3, 0.4);
    expect(Math.hypot(c.x + 0.15, c.z + 0.15)).toBeLessThan(0.06);
    // too far, or in the middle of the room: nothing
    expect(h.edge(3, -1, 0.4)).toBeNull();
    expect(h.edge(3, 2, 0.4)).toBeNull();
    expect(h.edge(40, 40, 0.4)).toBeNull();
  });

  it('follows a room that has no wall', () => {
    const h = houseFootprint([level(0.2, [room(0, 0, 6, 4)], [])]);
    expect(h.floorAt(3, 0.05)).toBe(0.2);
    expect(h.floorAt(3, -0.05)).toBeNull();
    const e = h.edge(3, 0.2, 0.4);
    expect(e.z).toBeCloseTo(-0.02);
    expect(e.y).toBe(0.2);
  });

  it('ignores a void of an upper level, and a plan without rooms', () => {
    const basement = level(0, [room(0, 0, 3, 4)], []);
    const upper = level(2.5, [{ ...room(3, 0, 6, 4), noFloor: true }], []);
    const h = houseFootprint([basement, upper]);
    expect(h.floorAt(1, 2)).toBe(0);
    expect(h.floorAt(5, 2)).toBeNull();
    // (the lowest level keeps such a room: the ground was already dug there)
    expect(houseFootprint([level(0, [{ ...room(0, 0, 3, 4), noFloor: true }], [])]).floorAt(1, 2)).toBe(0);
    expect(houseFootprint([level(0, [], [wall([0, 0], [6, 0])])])).toBeNull();
    expect(houseFootprint([{ rooms: [{ poly: [[0, 0]] }] }])).toBeNull(); // prettier-ignore
    expect(houseFootprint([])).toBeNull();
    expect(houseFootprint(null)).toBeNull();
    // a level without elevation stands at 0
    expect(houseFootprint([{ rooms: [room(0, 0, 3, 4)] }]).floorAt(1, 1)).toBe(0);
  });
});

// triangles of the ground mesh, as [[x, y, z] x 3]: those that lie on the plan, or those that stand straight up
const triangles = (terrain, standing = false) => {
  const g = terrain.ground.geometry;
  const p = g.getAttribute('position').array;
  const idx = g.index.array;
  const out = [];
  for (let k = 0; k < idx.length; k += 3) {
    const tri = [0, 1, 2].map((c) => [p[idx[k + c] * 3], p[idx[k + c] * 3 + 1], p[idx[k + c] * 3 + 2]]);
    const plan = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) - (tri[2][0] - tri[0][0]) * (tri[1][2] - tri[0][2])) / 2;
    const tall = Math.max(...tri.map((v) => v[1])) - Math.min(...tri.map((v) => v[1])) > 0.05;
    if (standing ? plan < 1e-9 && tall : plan >= 1e-9) out.push(tri);
  }
  return out;
};
const flat = () => syntheticTerrain([3, 2], 40, 0.5, 0, 0);

describe('the ground around a house sunk in it', () => {
  // a basement of 6 m by 4 m, its floor 2 m under the ground
  const sd = { levels: [level(0, [room(0, 0, 6, 4)], around(0, 0, 6, 4))], site: {} };
  const inHouse = (x, z, m = 0) => x > -0.15 + m && x < 6.15 - m && z > -0.15 + m && z < 4.15 - m;

  it('stops at the outer face of the walls, straight down', () => {
    const terrain = buildTerrain(flat(), sd, { base: 2 });
    let under = 0;
    let rim = 0;
    for (const tri of triangles(terrain)) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      if (inHouse(cx, cz)) {
        // under the house: the whole triangle is below the floor, corners on the outline included
        for (const v of tri) expect(v[1]).toBeLessThan(-0.3 + 1e-6);
        under++;
      } else {
        // in the garden: at the level of the ground, and no corner further in than the face of the wall
        for (const v of tri) {
          expect(v[1]).toBeCloseTo(1.98, 5);
          expect(inHouse(v[0], v[2], 0.001)).toBe(false);
          if (inHouse(v[0], v[2], -0.03)) rim++;
        }
      }
    }
    expect(under).toBeGreaterThan(150);
    expect(rim).toBeGreaterThan(80);
    // what stands on the ground still reads it as it is around the house
    expect(terrain.heightAt(3, 2)).toBeCloseTo(2);
    // the earth behind the walls: faces standing all around the house, from the pit up to the ground, 2 cm clear
    // of the walls
    const earth = triangles(terrain, true);
    let run = 0;
    for (const tri of earth) {
      for (const v of tri) {
        expect(inHouse(v[0], v[2], 0.001)).toBe(false);
        expect(inHouse(v[0], v[2], -0.03)).toBe(true);
        expect(Math.min(Math.abs(v[1] + 0.32), Math.abs(v[1] - 1.98))).toBeLessThan(1e-5);
      }
      // (none goes across a corner of the house: the middle of its sides is out of it as well)
      for (let k = 0; k < 3; k++)
        expect(inHouse((tri[k][0] + tri[(k + 1) % 3][0]) / 2, (tri[k][2] + tri[(k + 1) % 3][2]) / 2, 0.001)).toBe(false);
      run += Math.max(...tri.map((v) => Math.hypot(v[0] - tri[0][0], v[2] - tri[0][2]))) / 2;
    }
    // (the outline of the house with its walls: 2 x (6.3 + 4.3) m, the 2 cm kept clear at each corner, and a few
    // faces that overlap where a vertex was pulled onto a corner)
    expect(run).toBeGreaterThan(21.3);
    expect(run).toBeLessThan(22.5);
  });

  it('goes under the floor of a house standing on it, as before', () => {
    const terrain = buildTerrain(flat(), sd, { base: 0 });
    expect(triangles(terrain, true).length).toBeGreaterThan(80);
    for (const tri of triangles(terrain)) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      for (const v of tri) expect(v[1]).toBeCloseTo(inHouse(cx, cz) ? -0.32 : -0.02, 5);
    }
  });

  it('is left alone under a floor that stands above it', () => {
    const plain = buildTerrain(flat(), { levels: [level(0, [], [])], site: {} }, { base: -1 });
    const terrain = buildTerrain(flat(), sd, { base: -1 });
    const a = plain.ground.geometry.getAttribute('position').array;
    const b = terrain.ground.geometry.getAttribute('position').array;
    // no vertex is moved onto the outline, the copies under the house stand at the level of the ground, and no
    // face stands around it
    expect(Array.from(b.slice(0, a.length))).toEqual(Array.from(a));
    for (let k = a.length + 1; k < b.length; k += 3) expect(b[k]).toBeCloseTo(-1.02, 5);
    expect(triangles(terrain, true)).toHaveLength(0);
  });

  it('follows a house of any shape: no earth across a corner, no hole in the garden', () => {
    // an L with a side at 45 degrees and a re-entrant corner, on a slope, its walls of 20 cm on its outline
    const poly = [[0.2, 0.1], [8.2, 0.1], [8.2, 3.1], [5.2, 6.1], [3.2, 6.1], [3.2, 4.1], [0.2, 4.1]]; // prettier-ignore
    const walls = poly.map((a, i) => wall(a, poly[(i + 1) % poly.length], 0.2));
    const levels = [level(0, [{ poly }], walls)];
    const house = houseFootprint(levels);
    const terrain = buildTerrain(syntheticTerrain([4, 3], 40, 0.5), { levels, site: {} }, { base: 3 });
    const inside = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.1, 0.45, 0.45], [0.45, 0.1, 0.45]]; // prettier-ignore
    let sunk = 0;
    let garden = 0;
    for (const tri of triangles(terrain)) {
      const area = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) - (tri[2][0] - tri[0][0]) * (tri[1][2] - tri[0][2])) / 2;
      const low = tri.every((v) => v[1] < -0.3 + 1e-6);
      // (on this slope the ground stands between 0 and 6 m: a triangle is either in the pit or on the ground)
      expect(low || tri.every((v) => v[1] > -0.1)).toBe(true);
      if (low) sunk += area;
      else garden += area;
      for (const [u, v, w] of inside) {
        const x = tri[0][0] * u + tri[1][0] * v + tri[2][0] * w;
        const z = tri[0][2] * u + tri[1][2] * v + tri[2][2] * w;
        const over = house.floorAt(x, z) !== null;
        // further than 5 cm from the outline, a point of the pit is in the house and a point of the ground is not
        if (over === low || house.edge(x, z, 0.05)) continue;
        throw new Error(`${low ? 'a hole in the garden' : 'earth in the house'} at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      }
    }
    // the pit is the house (37.45 m2 of room, 2.65 m2 of walls around it, and the 2 cm kept clear of their faces),
    // the ground all the rest
    expect(sunk).toBeGreaterThan(40.1);
    expect(sunk).toBeLessThan(40.8);
    // (a few triangles overlap by some cm2 where a vertex was pulled onto a corner)
    expect(Math.abs(sunk + garden - 1600)).toBeLessThan(0.2);
    // one corner for each turn of the outline (the walls in line with one another add none that matters)
    for (const [x, z] of [[0.1, 0], [8.3, 0], [3.1, 4.2]]) expect(house.corners.some((c) => Math.hypot(c.x - x, c.z - z) < 0.06)).toBe(true); // prettier-ignore
  });

  it('steps down at the limit of a basement under a part of the house', () => {
    const levels = [level(0, [room(0, 0, 3, 4)], around(0, 0, 3, 4)), level(2.5, [room(0, 0, 6, 4)], around(0, 0, 6, 4))];
    const terrain = buildTerrain(flat(), { levels, site: {} }, { base: 3 });
    const seen = new Set();
    for (const tri of triangles(terrain)) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      if (!inHouse(cx, cz)) continue;
      // one level per triangle: none slopes from the pit of the basement up to the one of the ground floor
      const ys = tri.map((v) => Math.round(v[1] * 100) / 100);
      expect(ys[1]).toBe(ys[0]);
      expect(ys[2]).toBe(ys[0]);
      expect(ys[0]).toBe(cx < 3.15 ? -0.32 : 2.18);
      seen.add(ys[0]);
    }
    expect([...seen].sort()).toEqual([-0.32, 2.18]);
  });
});

describe('the outline of the house on the plan', () => {
  it('is the outer face of its walls, pushed out by the eaves', async () => {
    const { houseOutline } = await import('../src/engine/footprint.js');
    const levels = [level(0, [room(0, 0, 6, 4)], around(0, 0, 6, 4))];
    const flush = houseOutline(levels);
    expect(flush).toHaveLength(4);
    for (const [x, z] of flush) {
      expect(Math.min(Math.abs(x + 0.15), Math.abs(x - 6.15))).toBeLessThan(0.03);
      expect(Math.min(Math.abs(z + 0.15), Math.abs(z - 4.15))).toBeLessThan(0.03);
    }
    const eaves = houseOutline(levels, 0.4);
    expect(Math.min(...eaves.map((p) => p[0]))).toBeCloseTo(-0.55, 1);
    expect(Math.max(...eaves.map((p) => p[0]))).toBeCloseTo(6.55, 1);
    expect(Math.min(...eaves.map((p) => p[1]))).toBeCloseTo(-0.55, 1);
    expect(Math.max(...eaves.map((p) => p[1]))).toBeCloseTo(4.55, 1);
    expect(houseOutline([level(0, [], [])])).toBeNull();
  });

  it('follows an L with a side at an angle, a level over another, and leaves an outbuilding out', async () => {
    const { houseOutline } = await import('../src/engine/footprint.js');
    const poly = [[0.2, 0.1], [8.2, 0.1], [8.2, 3.1], [5.2, 6.1], [3.2, 6.1], [3.2, 4.1], [0.2, 4.1]]; // prettier-ignore
    const walls = poly.map((a, i) => wall(a, poly[(i + 1) % poly.length], 0.2));
    // (an upper room on a part of it, and a shed 5 m away)
    const levels = [level(0, [{ poly }, room(14, 0, 16, 2)], walls), level(2.5, [room(1, 1, 5, 3)], [])];
    const line = houseOutline(levels, 0.3);
    expect(line).toHaveLength(7);
    let area = 0;
    line.forEach((p, i) => (area += p[0] * line[(i + 1) % 7][1] - line[(i + 1) % 7][0] * p[1]));
    // the house with its walls is 40.1 m2, 26.9 m around: 8.6 m2 more with eaves of 30 cm (and the 2 cm kept clear
    // of the walls), then what the corners add
    expect(Math.abs(area / 2)).toBeGreaterThan(48.8);
    expect(Math.abs(area / 2)).toBeLessThan(49.8);
    expect(Math.max(...line.map((p) => p[0]))).toBeLessThan(9); // not the shed
    // the side at 45 degrees is one straight side
    const slanted = line.filter(([x, z]) => Math.abs(x + z - (8.3 + 3.1 + 0.3 * Math.SQRT2 + 0.1 * (Math.SQRT2 - 1))) < 0.15);
    expect(slanted.length).toBe(2);
  });
});

describe('recesses of the walls under the roof', () => {
  // a house 12 m by 8 m; its front (z = 0) holds an entrance 3 m wide set back by 1.5 m
  const FRONT = [[0, 0], [4, 0], [4, 1.5], [7, 1.5], [7, 0], [12, 0], [12, 8], [0, 8]]; // prettier-ignore
  const BOX = [[0, 0], [12, 0], [12, 8], [0, 8]]; // prettier-ignore
  const within = (x, z, x0, z0, x1, z1) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  // a roof with two slopes over the whole house, its ridge along z = 4, eaves of 40 cm
  const gable = (x, z) => (within(x, z, -0.4, -0.4, 12.4, 8.4) ? 196 - 0.5 * Math.abs(z - 4) : null);
  const same = (line, want) => expect(line.map((p) => p.join())).toEqual(want.map((p) => p.join()));

  it('closes an entrance set back in the facade when the roof goes over it', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    same(closeCovered(FRONT, gable), BOX);
    // whichever way the outline turns, and wherever it starts
    same(closeCovered([...FRONT].reverse(), gable), [...BOX].reverse());
    const turned = [...FRONT.slice(3), ...FRONT.slice(0, 3)];
    expect(closeCovered(turned, gable)).toHaveLength(4);
  });

  it('leaves it open when the sky is over it', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    // the roof stops at the walls of the recess (eaves of 40 cm all the same)
    const open = (x, z) => (within(x, z, 4.4, -1, 6.6, 1.1) ? null : gable(x, z));
    same(closeCovered(FRONT, open), FRONT);
    same(
      closeCovered(FRONT, () => null),
      FRONT,
    );
  });

  it('does not take a canopy, a car or a tree standing in it for the roof', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    // something 2.5 m lower than the roof behind the walls
    const canopy = (x, z) => (within(x, z, 4, -1, 7, 1.5) ? 191.5 : gable(x, z));
    same(closeCovered(FRONT, canopy), FRONT);
    // the crown of a tree, 3 m above it
    const tree = (x, z) => (within(x, z, 4, -1, 7, 1.5) ? 197 : gable(x, z));
    same(closeCovered(FRONT, tree), FRONT);
  });

  it('follows a roof that comes down over a deep porch', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    // a porch 4 m deep on the side of the eaves: the roof is 2 m lower at its mouth than at its back wall
    const porch = [[0, 0], [4, 0], [4, 4], [8, 4], [8, 0], [12, 0], [12, 10], [0, 10]]; // prettier-ignore
    const slope = (x, z) => (within(x, z, -0.4, -0.4, 12.4, 10.4) ? 194 + 0.5 * z : null);
    expect(closeCovered(porch, slope)).toHaveLength(4);
  });

  it('leaves the inner corner of an L, a wide court and a small step of the facade as they are', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    // an L: the roof follows it, with its eaves over the inner corner
    const ell = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 9], [0, 9]]; // prettier-ignore
    const overL = (x, z) => (within(x, z, -0.4, -0.4, 10.4, 4.4) || within(x, z, -0.4, -0.4, 4.4, 9.4) ? 195 : null);
    same(closeCovered(ell, overL), ell);
    // a court 9 m wide between two wings, under one large roof all the same: too wide to be a recess
    const court = [[0, 0], [3, 0], [3, 5], [12, 5], [12, 0], [15, 0], [15, 9], [0, 9]]; // prettier-ignore
    same(
      closeCovered(court, () => 195),
      court,
    );
    // a facade stepping back by 30 cm: the eaves see to it
    const step = [[0, 0], [5, 0], [5, 0.3], [9, 0.3], [9, 0], [12, 0], [12, 8], [0, 8]]; // prettier-ignore
    same(closeCovered(step, gable), step);
  });

  it('closes the recess under the roof and keeps the court around it', async () => {
    const { closeCovered } = await import('../src/engine/footprint.js');
    // an open court 6 m wide; at its back, a door set back by 1 m under the roof
    const both = [[0, 0], [4, 0], [4, 5], [6, 5], [6, 6], [8, 6], [8, 5], [10, 5], [10, 0], [14, 0], [14, 10], [0, 10]]; // prettier-ignore
    const roof = (x, z) => (within(x, z, 4.4, -1, 9.6, 4.6) ? null : within(x, z, -0.4, -0.4, 14.4, 10.4) ? 195 : null);
    same(closeCovered(both, roof), [[0, 0], [4, 0], [4, 5], [10, 5], [10, 0], [14, 0], [14, 10], [0, 10]]); // prettier-ignore
  });

  it('gives the roof of a plan a straight edge over its entrance', async () => {
    const { houseOutline } = await import('../src/engine/footprint.js');
    const walls = FRONT.map((a, i) => wall(a, FRONT[(i + 1) % FRONT.length], 0.2));
    const levels = [level(0, [{ poly: FRONT }], walls)];
    expect(houseOutline(levels, 0.3)).toHaveLength(8);
    const line = houseOutline(levels, 0.3, gable);
    expect(line).toHaveLength(4);
    expect(Math.min(...line.map((p) => p[1]))).toBeCloseTo(-0.4, 1); // the wall and the eaves
    // without a roof over the recess, nothing changes
    expect(houseOutline(levels, 0.3, () => null)).toEqual(houseOutline(levels, 0.3));
  });
});

describe('what several outlines cover together', () => {
  const area = (pts) =>
    Math.abs(pts.reduce((a, p, i) => a + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2);

  it('is one outline with their own corners', async () => {
    const { unionOutline } = await import('../src/engine/footprint.js');
    const a = [[0, 0], [10, 0], [10, 6], [0, 6]]; // prettier-ignore
    const b = [[8, 4], [14, 4], [14, 9], [8, 9]]; // prettier-ignore
    const both = unionOutline([a, b]);
    expect(both).toHaveLength(8);
    expect(area(both)).toBeCloseTo(60 + 30 - 4, 1);
    for (const p of [[0, 0], [10, 0], [14, 4], [14, 9], [8, 9], [0, 6]]) expect(both.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true); // prettier-ignore
    // one inside the other: the larger one, as it was given
    expect(unionOutline([a, [[2, 2], [5, 2], [5, 4], [2, 4]]])).toHaveLength(4); // prettier-ignore
    expect(area(unionOutline([a, [[2, 2], [5, 2], [5, 4], [2, 4]]]))).toBeCloseTo(60, 1); // prettier-ignore
    // sides at an angle stay straight sides
    const tri = [[0, 0], [8, 0], [4, 7]]; // prettier-ignore
    expect(unionOutline([tri])).toHaveLength(3);
  });

  it('leaves out what stands apart, and needs an outline', async () => {
    const { unionOutline } = await import('../src/engine/footprint.js');
    const a = [[0, 0], [10, 0], [10, 6], [0, 6]]; // prettier-ignore
    const far = [[20, 0], [22, 0], [22, 2], [20, 2]]; // prettier-ignore
    expect(area(unionOutline([a, far]))).toBeCloseTo(60, 1);
    expect(unionOutline([])).toBeNull();
    expect(
      unionOutline([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toBeNull();
    expect(unionOutline(null)).toBeNull();
  });
});
