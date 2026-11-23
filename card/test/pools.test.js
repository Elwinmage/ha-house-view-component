import { describe, it, expect } from 'vitest';
import {
  inPolygon,
  robotRunning,
  newLamp,
  newCover,
  lampsOf,
  poolLight,
  coverClosed,
  sideFrame,
  sideExtent,
  sidePoint,
  nearestSide,
  nearestOnOutline,
  polygonArea,
  centroidOf,
  rectFromCorners,
  newPool,
  poolValid,
  robotStep,
  POOL_KINDS,
  islandsOf,
  poolRoomsOf,
  roomFocus,
  POOL_ROOM,
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

describe('islands of a pond', () => {
  const isl = { shape: 'rect', pts: rectFromCorners([3, 3], [4, 4]), frame: 'plan' };

  it('keeps the usable islands only', () => {
    expect(islandsOf({ islands: [isl, { pts: [] }, null] })).toEqual([isl]);
    expect(islandsOf({})).toEqual([]);
    expect(islandsOf(null)).toEqual([]);
  });

  it('keeps the ground of an island above the water', () => {
    const t = syntheticTerrain([0, 0], 40, 1);
    const sd = { levels: [{ rooms: [{ poly: rectFromCorners([-12, -12], [-8, -8]) }] }], site: {} };
    const pond = { id: 'p', kind: 'pond', pts: rectFromCorners([1, 1], [7, 6]), frame: 'plan', islands: [isl] };
    const dug = buildTerrain(t, sd, { base: 0, pools: [pond] });
    const without = buildTerrain(t, sd, { base: 0, pools: [{ ...pond, islands: [] }] });
    const rim = dug.digs[0].rim;
    expect(dug.digs[0].islands).toHaveLength(1);
    expect(dug.heightAt(3.5, 3.5)).toBeGreaterThan(rim + 0.1);
    expect(dug.heightAt(3.02, 3.5)).toBeCloseTo(rim + 0.1, 1);
    expect(dug.heightAt(2, 2)).toBeCloseTo(rim);
    expect(dug.ground.geometry.index.count).toBeGreaterThan(without.ground.geometry.index.count);
  });

  it('draws the banks, a pebble ring and, without terrain, the ground of the island', () => {
    const p = buildPools([
      { id: 'q', kind: 'pond', poly: rectFromCorners([0, 0], [8, 6]), islands: [isl.pts], rim: 0, depth: 0.8, flat: true },
    ]);
    const g = p.items[0].g;
    const plain = buildPools([{ id: 'q', kind: 'pond', poly: rectFromCorners([0, 0], [8, 6]), rim: 0, depth: 0.8 }]);
    expect(g.children.length).toBe(plain.items[0].g.children.length + 3);
    expect(p.items[0].islands).toHaveLength(1);
  });
});

describe('pools as rooms', () => {
  const items = [
    {
      id: 'a',
      pond: false,
      poly: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      rim: 0.1,
    },
    {
      id: 'b',
      pond: true,
      poly: [
        [5, 5],
        [6, 5],
        [6, 6],
      ],
      rim: 0,
    },
  ];
  it('gives each pool a room on the ground level', () => {
    const rooms = poolRoomsOf(items, [{ id: 'a', name: 'Piscine nord' }], 'L0', (k) => `default ${k}`);
    expect(rooms.map((r) => r.id)).toEqual([`${POOL_ROOM}a`, `${POOL_ROOM}b`]);
    expect(rooms.map((r) => r.name)).toEqual(['Piscine nord', 'default pond']);
    expect(rooms[0]).toMatchObject({ level: 'L0', pool: 'a', rim: 0.1, poly: items[0].poly });
  });
  it('frames a room of the plan at the height of its level, a pool at its rim', () => {
    // `floor` of a room of the plan is the colour of its floor: taken for a height, it sent the camera nowhere
    const room = { id: 'r1', floor: '#b99a6b', poly: [[0, 0], [4, 0], [4, 3], [0, 3]] }; // prettier-ignore
    expect(roomFocus(room, 2.8)).toEqual({ target: [2, 3.3, 1.5], span: 6 });
    const [pool] = poolRoomsOf(items, [], 'L0', (k) => k);
    const { target, span } = roomFocus(pool, 0);
    expect(target[1]).toBeCloseTo(0.6); // rim at 0.1
    expect([...target, span].every(Number.isFinite)).toBe(true);
  });
  it('copes with no drawn pools', () => {
    expect(poolRoomsOf([], undefined, 'L0', () => '')).toEqual([]);
    expect(poolRoomsOf([items[0]], undefined, 'L0', (k) => k)[0].name).toBe('pool');
  });
});

describe('entities of a pool', () => {
  it('runs the robot on an on-like state or a reading above zero', () => {
    expect(robotRunning({ state: 'on' })).toBe(true);
    expect(robotRunning({ state: 'cleaning' })).toBe(true);
    expect(robotRunning({ state: 'off' })).toBe(false);
    expect(robotRunning({ state: '12.5' })).toBe(true); // the power its plug draws
    expect(robotRunning({ state: '0' })).toBe(false);
    expect(robotRunning({ state: 'unavailable' })).toBe(false);
    expect(robotRunning(null)).toBe(false);
  });

  it('keeps only the lamps linked to an entity', () => {
    const lamp = newLamp('l1', 2);
    expect(lamp).toMatchObject({ id: 'l1', side: 2, t: 0.5, entity: '' });
    expect(lampsOf({ lights: [{ ...lamp, entity: 'light.a' }, lamp, null] })).toHaveLength(1);
    expect(lampsOf({})).toEqual([]);
    expect(lampsOf(null)).toEqual([]);
  });

  it('mixes the colours of the lamps that are on', () => {
    const lamps = [
      { id: 'a', entity: 'light.a', color: '#ff0000' },
      { id: 'b', entity: 'switch.b', color: '#0000ff' },
      { id: 'c', entity: 'light.c', color: '#00ff00' },
    ];
    const states = {
      'light.a': { on: true, color: '#ff0000', brightness: 1 },
      'switch.b': { on: true, brightness: 0.5 }, // a plug: it keeps the colour chosen in the editor
      'light.c': { on: false },
    };
    const lit = poolLight(lamps, (id) => states[id]);
    expect(lit.on).toBe(true);
    expect(lit.color).toBe('#800080'); // red and blue, half each
    expect(lit.level).toBeCloseTo(0.75);
    expect(lit.lamps.b).toMatchObject({ on: true, color: '#0000ff' });
    expect(lit.lamps.c.on).toBe(false);
    const off = poolLight(lamps, () => ({ on: false }));
    expect(off).toMatchObject({ on: false, level: 0 });
    expect(poolLight([], () => null).on).toBe(false);
  });

  it('reads the cover from a position, a state, or nothing at all', () => {
    const cov = { ...newCover(1), entity: 'cover.volet' };
    expect(newCover()).toMatchObject({ side: 0, roller: 'deck', invert: false });
    expect(coverClosed(cov, { state: 'open', attributes: { current_position: 100 } })).toEqual({ closed: 0, moving: false });
    expect(coverClosed(cov, { state: 'closed', attributes: { current_position: 0 } })).toEqual({ closed: 1, moving: false });
    expect(coverClosed(cov, { state: 'open', attributes: { current_position: 30 } }).closed).toBeCloseTo(0.7);
    expect(coverClosed(cov, { state: 'closing', attributes: {} })).toEqual({ closed: 1, moving: true });
    expect(coverClosed(cov, { state: 'closed', attributes: {} }).closed).toBe(1);
    // a plug or a contact: on is taken as closed, `invert` turns it around
    const sw = { ...cov, entity: 'switch.volet' };
    expect(coverClosed(sw, { state: 'on' }).closed).toBe(1);
    expect(coverClosed({ ...sw, invert: true }, { state: 'on' }).closed).toBe(0);
    expect(coverClosed(sw, { state: 'unavailable' })).toBe(null);
    expect(coverClosed({ ...cov, entity: '' }, { state: 'on' })).toBe(null);
    expect(coverClosed(cov, null)).toBe(null);
  });
});

describe('frame of a side of an outline', () => {
  it('runs along the side, with its normal toward the water', () => {
    const f = sideFrame(square, 0); // [0, 0] -> [4, 0], the water on the +z side
    expect(f).toMatchObject({ x: 0, z: 0, len: 4 });
    expect(f.ux).toBe(1);
    expect(f.uz).toBe(0);
    expect(f.nx).toBeCloseTo(0);
    expect(f.nz).toBe(1);
    const back = sideFrame([...square].reverse(), 0); // drawn the other way round: the normal still looks inward
    expect(back.z + back.nz).toBeLessThan(back.z);
    expect(sideFrame(square, 5).x).toBe(sideFrame(square, 1).x); // the index runs around the outline
    expect(sideFrame([[1, 1], [1, 1], [3, 1]], 0).len).toBe(1); // prettier-ignore
  });

  it('takes the side nearest to a click', () => {
    expect(nearestSide(square, 2, -1)).toBe(0); // in front of [0, 0] -> [4, 0]
    expect(nearestSide(square, 5, 1.5)).toBe(1);
    expect(nearestSide(square, 2, 4)).toBe(2);
    expect(nearestSide(square, -1, 1.5)).toBe(3);
    expect(nearestSide([], 0, 0)).toBe(0);
  });

  it('measures the outline in that frame and places a point on the wall', () => {
    const f = sideFrame(square, 0);
    expect(sideExtent(square, f)).toEqual({ u0: 0, u1: 4, v0: 0, v1: 3 });
    const [x, z] = sidePoint(square, 0, 0.25, 0.1);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0.1);
    expect(sidePoint(square, 0, 5)[0]).toBe(4); // t is kept between 0 and 1
  });
});

describe('lamps and cover of a pool in 3D', () => {
  const lamps = [
    { id: 'a', entity: 'light.a', color: '#49e0ff', side: 0, t: 0.5, depth: 0.5 },
    { id: 'b', entity: 'switch.b', color: '#ff8800', side: 2, t: 0.2, depth: 0.5 },
  ];
  const make = (over = {}) =>
    buildPools([{ id: 'p', kind: 'pool', poly: square, rim: 0.2, depth: 1.4, color: '#2a9fd6', lights: lamps, ...over }]);

  it('sinks a projector in the wall of its side and tints the water', () => {
    const p = make();
    const it = p.items[0];
    expect(it.lamps).toHaveLength(2);
    expect(it.lamps[0].group.position.y).toBeCloseTo(0.2 - 0.5);
    expect(it.lamps[0].group.position.x).toBeCloseTo(2);
    p.setLights({ p: { on: true, color: '#ff0000', level: 1, lamps: { a: { on: true, color: '#ff0000', level: 1 } } } }, 1);
    expect(it.lit).toBe(true);
    expect(it.wm.emissive.r).toBeGreaterThan(0);
    expect(it.wm.emissive.b).toBe(0);
    expect(it.linerMat.emissive.r).toBeGreaterThan(0);
    expect(it.lamps[0].haloMat.visible).toBe(true);
    expect(it.lamps[1].haloMat.visible).toBe(false);
    p.tick(0.1, 1); // the glow breathes
    expect(it.wm.emissiveIntensity).toBeGreaterThan(0.8);
    expect(p.lampMeshes().map((l) => l.lamp)).toEqual(['a', 'b']); // what a click can take hold of
    expect(p.lampMeshes()[0].mesh).toBe(it.lamps[0].pick);
    p.setLights(null);
    expect(it.lit).toBe(false);
    expect(it.wm.emissive.r).toBe(0);
    expect(it.lamps[0].haloMat.opacity).toBe(0);
  });

  it('unrolls the cover over the water and offers its sheet to a click', () => {
    const p = make({ cover: { entity: 'cover.v', side: 0, color: '#dfe4e8', roller: 'deck' } });
    const C = p.items[0].cover;
    expect(C.reach).toBeCloseTo(3); // the pool is 4 by 3, the cover comes from the 4 m side
    expect(C.deck.visible).toBe(false);
    expect(p.coverMeshes()).toEqual([{ pool: 'p', mesh: C.roller }]); // rolled up: only the roller answers a click
    p.setCovers({ p: { closed: 1, moving: true } });
    for (let i = 0; i < 12; i++) p.tick(1, i); // 0.3 m/s over 3 m
    expect(C.cur).toBeCloseTo(1);
    expect(C.deck.scale.z).toBeCloseTo(3);
    expect(C.spin.rotation.y).not.toBe(0); // the roller turned with it
    expect(p.coverMeshes()).toEqual([
      { pool: 'p', mesh: C.roller },
      { pool: 'p', mesh: C.deck },
    ]);
    expect(C.deck.userData.pool).toBe('p');
    expect(C.roller.userData.pool).toBe('p');
    // a cover already closed when the world is built shows closed at once
    const snap = buildPools([{ id: 'p', kind: 'pool', poly: square, rim: 0, depth: 1.4, cover: { entity: 'cover.v', roller: 'water' } }]);
    snap.setCovers({ p: { closed: 1 } }, true);
    expect(snap.items[0].cover.cur).toBe(1);
    expect(snap.items[0].cover.deck.visible).toBe(true);
    // a cover not linked yet is drawn all the same (it is placed and tried in the editor before being linked)
    expect(buildPools([{ id: 'p', kind: 'pool', poly: square, rim: 0, depth: 1, cover: { entity: '' } }]).items[0].cover).not.toBe(null);
    expect(buildPools([{ id: 'p', kind: 'pool', poly: square, rim: 0, depth: 1 }]).items[0].cover).toBe(null);
    expect(p.coverAt('p')).toBeCloseTo(1); // what the editor watches while it runs a cycle
    expect(p.coverAt('nope')).toBe(null);
  });
});
