import { describe, it, expect } from 'vitest';
import {
  VAC_DEFAULTS,
  robotToPlan,
  solveRotation,
  positionFromAttributes,
  rowsPath,
  VacuumTracker,
  buildRobot,
  buildDock,
  dockFront,
} from '../src/vacuum.js';

const dock = { at: [10, 5], level: 'l0', base: 0 };
const cfg = (o = {}) => ({ ...VAC_DEFAULTS, dock, origin: [25500, 25500], ...o });

describe('robot coordinates -> plan', () => {
  it('needs the dock and its robot coordinates', () => {
    expect(robotToPlan({ ...VAC_DEFAULTS }, { x: 1, y: 1 })).toBeNull();
    expect(robotToPlan(cfg({ origin: null }), { x: 1, y: 1 })).toBeNull();
    expect(robotToPlan(cfg(), null)).toBeNull();
    expect(robotToPlan(cfg({ origin: null }), { x: 1000, y: 0 }, [0, 0])).toEqual([11, 5]); // charger given by the source
  });

  it('applies scale, mirror and rotation around the dock', () => {
    expect(robotToPlan(cfg(), { x: 25500, y: 25500 })).toEqual([10, 5]);
    expect(robotToPlan(cfg(), { x: 27500, y: 26500 })).toEqual([12, 4]); // robot y up -> plan z up the page
    expect(robotToPlan(cfg({ flip: false }), { x: 27500, y: 26500 })).toEqual([12, 6]);
    const r = robotToPlan(cfg({ rot: 90 }), { x: 27500, y: 25500 });
    expect(r[0]).toBeCloseTo(10);
    expect(r[1]).toBeCloseTo(7);
    expect(robotToPlan(cfg({ scale: 0.01 }), { x: 25600, y: 25500 })[0]).toBeCloseTo(11);
  });

  it('solves the rotation from a second point', () => {
    const truth = cfg({ rot: 37 });
    const p = { x: 28000, y: 24000 };
    const at = robotToPlan(truth, p);
    const s = solveRotation(cfg(), p, at);
    expect(s.rot).toBeCloseTo(37, 1);
    expect(s.ratio).toBeCloseTo(1, 3);
    expect(solveRotation(cfg(), { x: 25600, y: 25500 }, at)).toBeNull(); // robot too close to its dock
    expect(solveRotation(cfg({ origin: null }), p, at)).toBeNull();
    expect(solveRotation(cfg({ scale: 0.002 }), p, at).ratio).toBeCloseTo(0.5, 3);
  });

  it('reads the position from map entity attributes', () => {
    expect(positionFromAttributes(null)).toBeNull();
    expect(positionFromAttributes({ friendly_name: 'x' })).toBeNull();
    expect(positionFromAttributes({ vacuum_position: { x: '100', y: 200, a: 90 }, charger: { x: 1, y: 2 } })).toEqual({
      pos: { x: 100, y: 200, a: 90 },
      charger: [1, 2],
    });
    expect(positionFromAttributes({ robot_position: { x: 1, y: 2 } })).toEqual({ pos: { x: 1, y: 2, a: undefined }, charger: null });
  });
});

const rooms = [
  {
    id: 'a',
    poly: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  },
  {
    id: 'b',
    poly: [
      [4, 0],
      [8, 0],
      [8, 3],
      [4, 3],
    ],
  },
];

describe('rowsPath', () => {
  it('covers a room with back-and-forth rows kept off the walls', () => {
    const p = rowsPath(rooms[0].poly, 0.3);
    expect(p.length).toBe(20); // 10 rows, two ends each
    expect(p[0]).toEqual([0.15, 0.15]);
    expect(p[1][0]).toBeCloseTo(3.85);
    expect(p[2][0]).toBeCloseTo(3.85); // next row starts where the previous one ended
    expect(
      rowsPath(
        [
          [0, 0],
          [0.2, 0],
          [0.2, 3],
          [0, 3],
        ],
        0.3,
      ),
    ).toEqual([]); // too narrow
  });
});

describe('VacuumTracker with real positions', () => {
  const sweep = (T, x0, x1, t0) => {
    // rows 0.3 m apart, a position every 0.5 m
    let t = t0;
    for (let z = 0.15; z < 3; z += 0.3) for (let x = x0 + 0.15; x <= x1 - 0.1; x += 0.5) T.sample(x, z, (t += 2000));
    return t;
  };

  it('follows the rooms: queued -> active -> done, then glows for a minute', () => {
    const T = new VacuumTracker(rooms);
    expect(T.status('a')).toBe('idle');
    T.sample(1, 1, 0); // not running: only the position is kept
    expect(T.pos).toEqual([1, 1]);
    expect(T.total()).toBe(0);
    T.start(['a', 'b', 'ghost'], 1000);
    expect(T.status('a')).toBe('queued');
    expect(T.sel.size).toBe(2);
    let t = sweep(T, 0, 4, 1000);
    expect(T.active).toBe('a');
    expect(T.status('a')).toBe('active');
    expect(T.pct('a')).toBeGreaterThan(0.9);
    expect(T.pct('a')).toBeLessThanOrEqual(0.99); // never 100 % before the room is left
    expect(T.total()).toBeGreaterThan(0.4);
    expect(T.total()).toBeLessThan(0.55);
    T.sample(5, 1, (t += 2000));
    expect(T.active).toBe('a'); // one position next door is not enough
    T.sample(5.2, 1, (t += 2000));
    expect(T.active).toBe('b');
    expect(T.status('a')).toBe('done');
    expect(T.pct('a')).toBe(1);
    expect(T.glow('a', t + 30000)).toBeCloseTo(0.5);
    expect(T.glow('a', t + 61000)).toBe(0);
    expect(T.glow('b', t)).toBe(0);
    T.stop((t += 1000)); // b was only entered
    expect(T.status('b')).toBe('idle');
    expect(T.running).toBe(false);
    T.stop(t); // no-op
    expect(T.trail.length).toBeGreaterThan(50);
  });

  it('does not count a room that is only crossed, nor a jump across a long gap', () => {
    const T = new VacuumTracker(rooms);
    T.start(null, 0);
    T.sample(1, 1.5, 1000);
    T.sample(2, 1.5, 2000);
    expect(T.status('a')).toBe('active');
    T.sample(5, 1.5, 3000);
    T.sample(6, 1.5, 4000);
    expect(T.status('a')).toBe('idle'); // crossed, not selected
    expect(T.status('b')).toBe('active');
    const before = T.state.b.covered.size;
    T.sample(7.5, 2.5, 4000 + 200000); // position after a long silence: nothing is marked in between
    expect(T.state.b.covered.size - before).toBeLessThan(6);
    T.sample(20, 20, 4000 + 201000); // outside of every room
    T.sample(21, 20, 4000 + 202000);
    expect(T.active).toBeNull();
    expect(T.roomAt(20, 20)).toBeNull();
    expect(T.pct('ghost')).toBe(0);
    expect(T.status('ghost')).toBe('idle');
    expect(T.glow('ghost', 0)).toBe(0);
  });

  it('keeps a selected room queued when it was only crossed, and a trail of bounded length', () => {
    const T = new VacuumTracker(rooms);
    T.start(['a', 'b'], 0);
    T.sample(1, 1.5, 1000);
    T.sample(2, 1.5, 2000);
    T.sample(5, 1.5, 3000);
    T.sample(6, 1.5, 4000);
    expect(T.status('a')).toBe('queued');
    for (let i = 0; i < 1600; i++) T.sample(6 + (i % 2) * 0.1, 1.5, 5000 + i);
    expect(T.trail.length).toBe(1500);
  });
});

describe('VacuumTracker without positions (made-up route)', () => {
  it('plans the rooms nearest first and walks the route', () => {
    const T = new VacuumTracker(rooms, { glowMs: 1000 });
    expect(T.simulate(0.5, 0)).toBeNull(); // no route yet
    T.start(null, 0);
    const route = T.plan([7.5, 1]);
    expect(route.map((r) => r.id)).toEqual(['b', 'a']);
    expect(T.sel.size).toBe(2);
    expect(T.status('a')).toBe('queued');
    const p = T.simulate(0.25, 1000);
    expect(T.roomAt(p[0], p[1])).toBe('b');
    expect(T.status('b')).toBe('active');
    expect(T.pct('b')).toBeCloseTo(0.5, 1);
    T.simulate(0.75, 2000);
    expect(T.status('b')).toBe('done');
    expect(T.active).toBe('a');
    expect(T.glow('b', 2500)).toBeCloseTo(0.5);
    expect(T.total()).toBeCloseTo(0.75, 1);
    T.simulate(2, 3000); // clamped to the end of the route
    T.stop(4000);
    expect(T.status('a')).toBe('done');
    expect(T.pct('a')).toBe(1);
  });

  it('starts from the first room without a dock, skips rooms too small for a row, forgets unfinished rooms', () => {
    const T = new VacuumTracker([
      ...rooms,
      {
        id: 'tiny',
        poly: [
          [20, 0],
          [20.2, 0],
          [20.2, 3],
          [20, 3],
        ],
      },
    ]);
    T.start(['a', 'tiny'], 0);
    expect(T.plan(null).map((r) => r.id)).toEqual(['a']);
    T.simulate(0.1, 1000);
    T.stop(2000);
    expect(T.status('a')).toBe('idle');
    const empty = new VacuumTracker([]);
    empty.start(null, 0);
    expect(empty.plan(null)).toEqual([]);
    expect(empty.simulate(0.5, 0)).toBeNull();
    expect(empty.total()).toBe(0);
  });
});

describe('dock direction', () => {
  it('is a compass angle on the plan, east by default', () => {
    expect(dockFront(null)[0]).toBeCloseTo(1);
    expect(dockFront({})[1]).toBeCloseTo(0);
    expect(dockFront({ dir: 0 })[1]).toBeCloseTo(-1); // top of the plan
    expect(dockFront({ dir: 180 })[1]).toBeCloseTo(1);
    expect(dockFront({ dir: 270 })[0]).toBeCloseTo(-1);
  });
});

describe('models', () => {
  it('builds a robot (dark details on a light body and the reverse) and a dock', () => {
    const light = buildRobot();
    const dark = buildRobot('#111111');
    expect(light.children.length).toBe(4);
    expect(light.userData.body.color.getHexString()).toBe('f2f2f2');
    expect(light.children[1].material.color.getHexString()).not.toBe(dark.children[1].material.color.getHexString());
    expect(buildDock().children.length).toBe(2);
  });
});
