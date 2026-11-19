import { describe, it, expect } from 'vitest';
import {
  inPolygon,
  nearestOnOutline,
  polygonArea,
  centroidOf,
  rectFromCorners,
  newPool,
  poolValid,
  robotStep,
  POOL_KINDS,
} from '../src/pools.js';
import { buildPools, offsetOutline } from '../src/engine/pools-3d.js';
import { buildTerrain, syntheticTerrain } from '../src/engine/terrain.js';

const square = rectFromCorners([0, 0], [4, 3]);

describe('pool helpers', () => {
  it('tests points and outlines', () => {
    expect(inPolygon(square, 1, 1)).toBe(true);
    expect(inPolygon(square, 5, 1)).toBe(false);
    expect(nearestOnOutline(square, 2, 1).d).toBeCloseTo(1);
    expect(nearestOnOutline(square, 6, 1)).toMatchObject({ px: 4, pz: 1 });
    expect(
      nearestOnOutline(
        [
          [1, 1],
          [1, 1],
          [3, 1],
        ],
        1,
        0,
      ).d,
    ).toBeCloseTo(1); // zero-length side
    expect(Math.abs(polygonArea(square))).toBe(12);
    expect(centroidOf(square)).toEqual([2, 1.5]);
  });

  it('makes new pools and checks them', () => {
    expect(newPool('pond', 'a')).toMatchObject({ id: 'a', kind: 'pond', depth: POOL_KINDS.pond.depth, pts: [] });
    expect(newPool('lake', 'b').kind).toBe('pool');
    expect(poolValid(newPool('pool', 'c'))).toBe(false);
    expect(poolValid({ pts: square })).toBe(true);
    expect(
      poolValid({
        pts: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      }),
    ).toBe(false);
    expect(poolValid(null)).toBe(false);
  });

  it('keeps the robot inside, away from the walls', () => {
    let r = { x: 2, z: 1.5, h: 0 };
    let k = 0;
    const rand = () => (k = (k * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 2000; i++) {
      r = robotStep(square, r, 0.1, 0.35, 0.3, rand);
      expect(inPolygon(square, r.x, r.z)).toBe(true);
    }
    // parked against the wall: it goes back toward the middle
    const back = robotStep(square, { x: 0.05, z: 0.05, h: Math.PI }, 0.1, 0.35, 0.3, () => 0);
    expect(back.x).toBeGreaterThan(0.05);
  });
});

describe('pool meshes', () => {
  it('pushes an outline outward whatever its direction', () => {
    const o = offsetOutline(square, 0.5);
    expect(o[0][0]).toBeCloseTo(-0.5);
    expect(o[0][1]).toBeCloseTo(-0.5);
    const r = offsetOutline([...square].reverse(), 0.5);
    expect(r[3][0]).toBeCloseTo(-0.5);
  });

  it('builds pools and ponds, the robot runs only when on', () => {
    const pond = [];
    for (let i = 0; i < 10; i++) pond.push([10 + Math.cos((i / 10) * 6.283) * 3, Math.sin((i / 10) * 6.283) * 2]);
    const p = buildPools([
      { id: 'p', kind: 'pool', poly: square, rim: 0.2, depth: 1.4, color: '#2a9fd6', robot: 'binary_sensor.r' },
      { id: 'q', kind: 'pond', poly: pond, rim: 0, depth: 0.8, robot: 'binary_sensor.s' },
      { id: 'n', kind: 'pool', poly: square, rim: 0 },
    ]);
    expect(p.items).toHaveLength(3);
    expect(p.group.children).toHaveLength(3);
    const R = p.items[0].robot;
    const x0 = R.g.position.x;
    p.tick(0.5, 1);
    expect(R.g.position.x).toBe(x0); // parked
    p.setRobots({ p: true, q: true });
    for (let i = 0; i < 20; i++) p.tick(0.1, 1 + i * 0.1);
    expect(R.g.position.x).not.toBe(x0);
    expect(R.g.position.y).toBeCloseTo(0.2 - 1.4);
    expect(p.items[1].robot.g.position.y).toBeLessThan(0);
    expect(p.items[2].robot).toBe(null);
    p.setRobots(null);
    expect(R.on).toBe(false);
  });
});

describe('pools dug in the terrain', () => {
  it('flattens a rim and cuts the ground over the pool', () => {
    const t = syntheticTerrain([0, 0], 40, 1);
    const sd = { levels: [{ rooms: [{ poly: rectFromCorners([-12, -12], [-8, -8]) }] }], site: {} };
    const pool = { id: 'p', pts: rectFromCorners([2, 2], [6, 5]), frame: 'plan' };
    const plain = buildTerrain(t, sd, { base: 0 });
    const dug = buildTerrain(t, sd, { base: 0, pools: [pool, { id: 'bad', pts: [] }] });
    expect(dug.digs).toHaveLength(1);
    const rim = dug.digs[0].rim;
    // flat over the pool and its band, untouched far away
    expect(dug.heightAt(2.2, 2.2)).toBeCloseTo(rim);
    expect(dug.heightAt(6.4, 5.3)).toBeCloseTo(rim);
    expect(dug.heightAt(-15, -15)).toBeCloseTo(plain.heightAt(-15, -15));
    expect(dug.ground.geometry.index.count).toBeLessThan(plain.ground.geometry.index.count);
    // stored in the grid frame: converted with the registration
    const g = buildTerrain(t, sd, { base: 0, rot: 0, dx: 1, dz: 0, pools: [{ ...pool, frame: undefined }] });
    expect(g.digs[0].poly[0][0]).toBeCloseTo(3);
  });
});
