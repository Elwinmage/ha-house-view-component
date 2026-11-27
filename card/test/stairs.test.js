import { describe, expect, it } from 'vitest';
import {
  CHEEK,
  LANDING,
  RISE,
  STEPS_MAX,
  flightOutline,
  flightOutlines,
  flightReach,
  flightSize,
  stairFlight,
  stepCount,
} from '../src/stairs.js';

const LINE = [
  [0, 0],
  [3, 0],
];
/** A bank climbing 30 cm a metre along x. */
const bank = (x) => x * 0.3;
const ys = (pos) => pos.filter((_, i) => i % 3 === 1);
const xs = (pos) => pos.filter((_, i) => i % 3 === 0);
const zs = (pos) => pos.filter((_, i) => i % 3 === 2);
/** The faces of a flat array of positions: [[x, y, z] x 6, ...]. */
const faces = (pos) =>
  Array.from({ length: pos.length / 18 }, (_, f) => Array.from({ length: 6 }, (_, k) => pos.slice(f * 18 + k * 3, f * 18 + k * 3 + 3)));
const level = (face) => new Set(face.map(([, y]) => Math.round(y * 1000) / 1000));

describe('number of steps', () => {
  it('is one every 16 cm of height, one at least', () => {
    expect(RISE).toBe(0.16);
    expect(stepCount(0.96)).toBe(6);
    expect(stepCount(-0.96)).toBe(6); // going down as well as up
    expect(stepCount(1)).toBe(6);
    expect(stepCount(0.05)).toBe(1);
    expect(stepCount(0)).toBe(1);
    expect(stepCount(500)).toBe(STEPS_MAX);
  });

  it('is the one asked for, when there is one', () => {
    expect(stepCount(0.96, 4)).toBe(4);
    expect(stepCount(0.96, 4.4)).toBe(4);
    expect(stepCount(0.96, 999)).toBe(STEPS_MAX);
    expect(stepCount(0.96, 0)).toBe(6);
    expect(stepCount(0.96, null)).toBe(6);
    expect(stepCount(0.96, NaN)).toBe(6);
  });
});

describe('size of a flight', () => {
  it('climbs from the ground at its first point to the ground at its last one', () => {
    const size = flightSize(LINE, bank);
    expect(size).toMatchObject({ n: 6, h0: 0, length: 3 });
    expect(size.h1).toBeCloseTo(0.9, 9);
    expect(size.rise).toBeCloseTo(0.15, 9);
    expect(size.going).toBeCloseTo(0.5, 9);
    expect(flightSize(LINE, bank, 3)).toMatchObject({ n: 3, going: 1 });
  });

  it('goes down as well', () => {
    const size = flightSize([...LINE].reverse(), bank);
    expect(size.n).toBe(6);
    expect(size.height).toBeCloseTo(-0.9, 9);
    expect(size.rise).toBeCloseTo(-0.15, 9);
  });

  it('needs a line', () => {
    expect(flightSize(null, bank)).toBeNull();
    expect(flightSize([[0, 0]], bank)).toBeNull();
    expect(flightSize([[0, 0], [0.1, 0]], bank)).toBeNull(); // prettier-ignore
  });
});

describe('outline of a flight on the ground', () => {
  it('is its line widened to the middle of its cheeks, the ground going on under both ends', () => {
    const ring = flightOutline(LINE, 1);
    expect(ring).toHaveLength(2 * 7); // a point every half metre along each side
    const half = 0.5 + CHEEK / 2;
    expect(Math.min(...ring.map(([x]) => x))).toBeCloseTo(0.1, 9);
    expect(Math.max(...ring.map(([x]) => x))).toBeCloseTo(2.9, 9);
    expect(new Set(ring.map(([, z]) => Math.round(z * 1000) / 1000))).toEqual(new Set([half, -half]));
    // a closed ring: one side forwards, the other one back
    expect(ring[0][1]).toBeCloseTo(half, 9);
    expect(ring[6][0]).toBeCloseTo(2.9, 9);
    expect(ring[7]).toEqual([ring[6][0], -ring[6][1]]);
    expect(flightOutline(LINE, 1, 0)[0][1]).toBeCloseTo(0.5, 9);
  });

  it('follows a line that turns', () => {
    const ring = flightOutline([[0, 0], [2, 0], [2, 2]], 1, 0); // prettier-ignore
    const last = ring[ring.length / 2 - 1];
    expect(last[0]).toBeCloseTo(1.5, 9); // on the left of a line now heading along z
    expect(last[1]).toBeCloseTo(1.9, 9);
  });

  it('needs a line', () => {
    expect(flightOutline(null, 1)).toBeNull();
    expect(flightOutline([[0, 0]], 1)).toBeNull();
    expect(flightOutline([[0, 0], [0.1, 0]], 1)).toBeNull(); // prettier-ignore
    // a very short flight keeps an outline
    const ring = flightOutline([[0, 0], [0.3, 0]], 1); // prettier-ignore
    expect(Math.min(...ring.map(([x]) => x))).toBeCloseTo(0.075, 9);
  });
});

describe('a flight of steps', () => {
  it('lays level treads, each flush with the step above at its back', () => {
    const flight = stairFlight(LINE, 1.2, bank, { tile: 2 });
    expect(flight).toMatchObject({ n: 6 });
    expect(flight.rise).toBeCloseTo(0.15, 9);
    expect(flight.going).toBeCloseTo(0.5, 9);
    const all = faces(flight.steps.pos);
    expect(all).toHaveLength(6 + 6); // six treads, a riser in front of each
    const treads = all.slice(0, 6);
    treads.forEach((tread, k) => {
      expect([...level(tread)]).toEqual([Math.round((0.15 * (k + 1) + 0.03) * 1000) / 1000]);
      const x = tread.map(([px]) => px);
      expect(Math.min(...x)).toBeCloseTo(0.5 * k, 9);
      // the top tread goes on past the end of the line: the landing
      expect(Math.max(...x)).toBeCloseTo(k === 5 ? 3 + LANDING : 0.5 * (k + 1), 9);
      const z = tread.map(([, , pz]) => pz);
      expect([Math.min(...z), Math.max(...z)]).toEqual([-0.6, 0.6]);
    });
    // the last tread arrives level with the ground at the top
    expect(Math.max(...ys(flight.steps.pos))).toBeCloseTo(0.9 + 0.03, 9);
  });

  it('starts and arrives on what one walks on: a deck stands over the ground', () => {
    // a deck 12 cm thick at the foot of the bank: the first step is counted from its top
    const deck = (x) => (x < 1 ? 0.12 : bank(x));
    const flight = stairFlight(LINE, 1.2, bank, { levelAt: deck });
    expect(flight.n).toBe(5);
    expect(flight.rise).toBeCloseTo((0.9 - 0.12) / 5, 9);
    const first = faces(flight.steps.pos)[0];
    expect([...level(first)][0]).toBeCloseTo(0.12 + 0.156 + 0.03, 3);
    expect(Math.max(...ys(flight.steps.pos))).toBeCloseTo(0.93, 9);
  });

  it('stands a riser in front of each tread, the first one down into the ground', () => {
    const flight = stairFlight(LINE, 1.2, bank);
    const risers = faces(flight.steps.pos).slice(6);
    risers.forEach((riser, k) => {
      expect(new Set(riser.map(([x]) => Math.round(x * 1000) / 1000))).toEqual(new Set([0.5 * k])); // upright, across the line
      const y = riser.map(([, py]) => py);
      expect(Math.max(...y)).toBeCloseTo(0.15 * (k + 1) + 0.03, 9);
      expect(Math.min(...y)).toBeCloseTo(k ? 0.15 * k + 0.03 : -0.3, 9);
    });
  });

  it('lays its texture in rows across the flight', () => {
    const { steps } = stairFlight(LINE, 1.2, bank, { tile: 2 });
    expect(steps.uv).toHaveLength((steps.pos.length / 3) * 2);
    // first tread: across the width, then along the run, in tiles of 2 m
    expect(steps.uv.slice(0, 8)).toEqual([-0.3, 0, -0.3, 0.25, 0.3, 0.25, -0.3, 0]);
    // a riser: across the width, then up
    const riser = steps.uv.slice(6 * 12, 6 * 12 + 6);
    expect(riser[0]).toBe(-0.3);
    expect(riser[1]).toBeCloseTo(-0.15, 9);
    expect(riser[5]).toBeCloseTo((0.15 + 0.03) / 2, 9);
  });

  it('goes down a bank the same way, a riser at its foot', () => {
    const flight = stairFlight([...LINE].reverse(), 1.2, bank);
    expect(flight.rise).toBeCloseTo(-0.15, 9);
    const all = faces(flight.steps.pos);
    expect(all).toHaveLength(12);
    // the first tread is level with the ground at the top, where the line starts, and goes on before it
    expect([...level(all[0])]).toEqual([0.93]);
    expect(Math.max(...all[0].map(([x]) => x))).toBeCloseTo(3 + LANDING, 9);
    expect([...level(all[5])]).toEqual([0.18]);
    // the last riser comes down to the ground, at the end of the line
    const foot = all[11];
    expect(new Set(foot.map(([x]) => Math.round(x * 1000) / 1000))).toEqual(new Set([0]));
    expect(Math.min(...foot.map(([, y]) => y))).toBeCloseTo(-0.3, 9);
  });

  it('is a slab on level ground: one tread, no riser', () => {
    const flight = stairFlight(LINE, 1, () => 2);
    expect(flight).toMatchObject({ n: 1, rise: 0, going: 3 });
    expect(faces(flight.steps.pos)).toHaveLength(1);
    expect([Math.min(...xs(flight.steps.pos)), Math.max(...xs(flight.steps.pos))]).toEqual([0, 3]); // no landing: no top
    expect(stairFlight(LINE, 1, () => 2, { steps: 3 }).n).toBe(3);
    expect(stairFlight([[0, 0]], 1, () => 2)).toBeNull();
  });

  it('closes each side with a cheek wall, from under the ground up to the treads', () => {
    const { cheeks } = stairFlight(LINE, 1.2, bank);
    expect(faces(cheeks.pos)).toHaveLength(2 * 6 * 5 + 1); // two sides, six steps, five faces each, and the back
    const z = zs(cheeks.pos);
    expect(Math.min(...z)).toBeCloseTo(-0.6 - CHEEK, 9);
    expect(Math.max(...z)).toBeCloseTo(0.6 + CHEEK, 9);
    expect(Math.min(...z.map(Math.abs))).toBeCloseTo(0.6, 9); // never over the treads
    // level with the treads, and with the bank where it goes on climbing beside the landing
    expect(Math.max(...ys(cheeks.pos))).toBeCloseTo(bank(3 + LANDING) + 0.03, 9);
    expect(Math.min(...ys(cheeks.pos))).toBeCloseTo(-0.3, 9); // down under the ground at the foot
    // along the landing too
    expect([Math.min(...xs(cheeks.pos)), Math.max(...xs(cheeks.pos))]).toEqual([0, 3 + LANDING]);
  });

  it('closes its back under the end of the landing, down into the ground', () => {
    const back = (flight) => faces(flight.cheeks.pos).at(-1);
    const up = back(stairFlight(LINE, 1.2, bank));
    expect(new Set(up.map(([x]) => Math.round(x * 1000) / 1000))).toEqual(new Set([3 + LANDING])); // across the high end
    expect(Math.max(...up.map(([, y]) => y))).toBeCloseTo(0.93, 9);
    expect(Math.min(...up.map(([, y]) => y))).toBeCloseTo(0.93 - 0.3, 9); // the bank goes on climbing behind it
    // where the ground it arrives on is lower than its top step, nothing shows through
    const low = back(stairFlight(LINE, 1.2, (x) => (x > 3.1 ? -2 : bank(x)), { levelAt: bank }));
    expect(Math.min(...low.map(([, y]) => y))).toBeCloseTo(-2.3, 9);
    // a flight drawn from the top has its back where the line starts
    const down = back(stairFlight([...LINE].reverse(), 1.2, bank));
    expect(new Set(down.map(([x]) => Math.round(x * 1000) / 1000))).toEqual(new Set([3 + LANDING]));
    // and a slab on level ground has none
    expect(faces(stairFlight(LINE, 1, () => 2).cheeks.pos)).toHaveLength(2 * 5);
  });

  it('raises the cheeks to the ground beside the flight where it stands higher, as in a bank', () => {
    // a trench: the ground is 2 m up on both sides of the flight, and climbs under it
    const trench = (x, z) => (Math.abs(z) > 0.6 ? 2 : x * 0.3);
    const { cheeks, steps } = stairFlight(LINE, 1.2, trench);
    expect(Math.max(...ys(cheeks.pos))).toBeCloseTo(2 + 0.03, 9);
    expect(Math.max(...ys(steps.pos))).toBeCloseTo(0.93, 9); // the steps stay where they were
    // and a flight standing over a hollow goes down to it
    const hollow = (x, z) => (Math.abs(z) > 0.6 ? -1 : x * 0.3);
    expect(Math.min(...ys(stairFlight(LINE, 1.2, hollow).cheeks.pos))).toBeCloseTo(-1.3, 9);
  });
});

describe('all a flight takes up', () => {
  it('is its steps, its cheeks and a landing at each end: a wall is opened over it', () => {
    const reach = flightReach(LINE, 1);
    expect(Math.min(...reach.map(([x]) => x))).toBeCloseTo(-LANDING, 9);
    expect(Math.max(...reach.map(([x]) => x))).toBeCloseTo(3 + LANDING, 9);
    expect(Math.max(...reach.map(([, z]) => z))).toBeCloseTo(0.5 + CHEEK, 9);
    expect(flightReach([[0, 0]], 1)).toBeNull();
  });
});

describe('flights among the paths', () => {
  const paths = [
    { pts: LINE, w: 1, stairs: true },
    { pts: LINE, w: 1 }, // a plain path
    { pts: LINE, w: 1, stairs: true, hidden: true },
    { pts: [[0, 0]], w: 1, stairs: true },
    { pts: [[0, 0], [0.1, 0]], w: 1, stairs: true }, // prettier-ignore
    null,
    { pts: LINE, stairs: true, frame: 'grid' }, // no width: a metre
  ];

  it('gives the outline of each one, in the plan frame', () => {
    const rings = flightOutlines(paths, (p) => (p.frame === 'grid' ? (x, z) => [x + 100, z] : (x, z) => [x, z]));
    expect(rings).toHaveLength(2);
    expect(rings[0]).toEqual(flightOutline(LINE, 1));
    expect(Math.min(...rings[1].map(([x]) => x))).toBeCloseTo(100.1, 9);
    expect(Math.max(...rings[1].map(([, z]) => z))).toBeCloseTo(0.5 + CHEEK / 2, 9);
    expect(flightOutlines(null, () => (x, z) => [x, z])).toEqual([]);
  });

  it('gives all they take up instead, when asked', () => {
    const [reach] = flightOutlines([paths[0]], () => (x, z) => [x, z], undefined, flightReach);
    expect(reach).toEqual(flightReach(LINE, 1));
  });

  it('rounds the line as the paths are drawn', () => {
    const seen = [];
    flightOutlines(
      [paths[0]],
      () => (x, z) => [x, z],
      (points) => {
        seen.push(points);
        return points;
      },
    );
    expect(seen).toEqual([LINE]);
  });
});
