import { describe, it, expect } from 'vitest';
import { brushK, compileOps, opAt, opCenter, opOutline } from '../src/engine/terrain-edit.js';

const id = (x, z) => [x, z];
const alt = (a) => a; // absolute altitude == scene y in these tests

const WALL = {
  type: 'wall',
  pts: [
    [0, 0],
    [10, 0],
  ],
  hi: 2,
  lo: 0,
  side: 1,
  flat: 1,
  feather: 1,
};
const TERRACE = {
  type: 'terrace',
  poly: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
  alt: 5,
  feather: 1,
};
const BRUSH = { type: 'brush', pt: [25, 5], r: 2, mode: 'set', value: 7 };

describe('brush falloff', () => {
  it('is full at the centre, nothing at the edge and symmetric', () => {
    expect(brushK(0, 3)).toBeCloseTo(1);
    expect(brushK(3, 3)).toBe(0);
    expect(brushK(4, 3)).toBe(0);
    expect(brushK(1.5, 3)).toBeCloseTo(0.5);
  });
});

describe('outline of a correction', () => {
  it('gives the line of a wall, the ring of a terrace and the circle of a brush', () => {
    expect(opOutline(WALL)).toMatchObject({ closed: false, fill: false });
    expect(opOutline(WALL).pts).toHaveLength(2);
    expect(opOutline(TERRACE)).toMatchObject({ closed: true, fill: true });
    const c = opOutline(BRUSH, 12);
    expect(c.pts).toHaveLength(12);
    expect(c.closed).toBe(true);
    for (const [x, z] of c.pts) expect(Math.hypot(x - 25, z - 5)).toBeCloseTo(2);
  });
  it('refuses a shape with too few points', () => {
    expect(opOutline({ type: 'wall', pts: [[0, 0]] })).toBeNull();
    expect(
      opOutline({
        type: 'terrace',
        poly: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
    expect(opOutline(null)).toBeNull();
  });
  it('centres a correction on its points', () => {
    expect(opCenter(WALL)).toEqual([5, 0]);
    expect(opCenter(TERRACE)).toEqual([25, 5]);
    expect(opCenter(BRUSH)).toEqual([25, 5]);
    expect(opCenter({ type: 'wall', pts: [] })).toBeNull();
  });
});

describe('correction under a point', () => {
  const ops = [WALL, TERRACE, BRUSH];
  it('finds the one that acts there', () => {
    expect(opAt(ops, 5, 0.5)).toBe(0); // on the wall
    expect(opAt(ops, 21, 1)).toBe(1); // inside the terrace, away from the brush
    expect(opAt(ops, 5, 10)).toBe(-1); // nothing around
  });
  it('keeps the narrowest one reachable inside a wider one', () => {
    expect(opAt(ops, 25, 5)).toBe(2); // the brush, dropped in the middle of the terrace
    expect(opAt(ops, 25.5, 5)).toBe(2);
    expect(opAt(ops, 28, 5)).toBe(1); // out of the brush: the terrace again
  });
  it('takes the feather of a shape into account, and no more', () => {
    expect(opAt([TERRACE], 19.5, 5)).toBe(1 - 1); // 0.5 m outside, within the 1 m blend
    expect(opAt([TERRACE], 18.5, 5)).toBe(-1); // 1.5 m outside
    expect(opAt([WALL], 5, 1.9)).toBe(0); // flat 1 + feather 1
    expect(opAt([WALL], 5, 2.1)).toBe(-1);
  });
  it('looks at the corrections shown only, when told which ones are', () => {
    // the brush is hidden: the terrace under it takes the click
    expect(opAt(ops, 25, 5, (op) => op.type !== 'brush')).toBe(1);
    expect(opAt(ops, 25, 5, (op, i) => i === 2)).toBe(2);
    expect(opAt(ops, 25, 5, () => false)).toBe(-1);
  });

  it('ignores an empty list and broken shapes', () => {
    expect(opAt([], 0, 0)).toBe(-1);
    expect(opAt(null, 0, 0)).toBe(-1);
    expect(opAt([{ type: 'brush' }, { type: 'wall', pts: [[0, 0]] }], 0, 0)).toBe(-1);
  });
});

describe('preview of a single brush', () => {
  const ground = () => 10;
  it('flattens to the asked altitude at the centre and fades to nothing at the edge', () => {
    const { apply } = compileOps([BRUSH], id, alt);
    expect(apply(25, 5, ground(), ground)).toBeCloseTo(7);
    expect(apply(26, 5, ground(), ground)).toBeCloseTo(10 + (7 - 10) * brushK(1, 2));
    expect(apply(27.1, 5, ground(), ground)).toBeCloseTo(10);
  });
  it('raises or lowers by the given value', () => {
    const { apply } = compileOps([{ ...BRUSH, mode: 'add', value: -0.5 }], id, alt);
    expect(apply(25, 5, ground(), ground)).toBeCloseTo(9.5);
    expect(apply(27.1, 5, ground(), ground)).toBeCloseTo(10);
  });
});

// A big wall along x (the ground held at 3 for z < 0, its foot at 0 for z > 0), a smaller one coming down to it from
// the high side and drawn 30 cm too far: the junction of the report.
const BIG = { type: 'wall', pts: [[0, 0], [20, 0]], hi: 3, lo: 0, side: -1, flat: 1.5, feather: 2 }; // prettier-ignore
const SMALL = { type: 'wall', pts: [[10, -8], [10, 0.3]], hi: 3.5, lo: 2.5, side: 1, flat: 1.5, feather: 2 }; // prettier-ignore
const relief = () => 1;
const ground = (ops, x, z, opts) => compileOps(ops, id, alt, opts).apply(x, z, relief(x, z), relief);

describe('walls that meet', () => {
  it('has no hold on the ground behind another wall', () => {
    // at the foot of the big wall, right past the end of the small one: alone, the small one would lift it
    expect(ground([SMALL], 9.5, 1)).toBeCloseTo(3.5, 6);
    expect(ground([SMALL], 10.5, 1)).toBeCloseTo(2.5, 6);
    // behind the big one it has nothing to say, whichever was drawn first
    for (const ops of [
      [SMALL, BIG],
      [BIG, SMALL],
    ]) {
      expect(ground(ops, 9.5, 1)).toBeCloseTo(0, 6);
      expect(ground(ops, 10.5, 1)).toBeCloseTo(0, 6);
      expect(ground(ops, 10, 3)).toBeCloseTo(0.84375, 6); // the blend of the big one, back to the relief
    }
    // on its own side each one still holds its ground: the last one drawn has the last word where they meet
    expect(ground([BIG, SMALL], 9.5, -1)).toBeCloseTo(3.5, 6);
    expect(ground([BIG, SMALL], 10.5, -1)).toBeCloseTo(2.5, 6);
    expect(ground([SMALL, BIG], 9.5, -1)).toBeCloseTo(3, 6);
    expect(ground([SMALL, BIG], 9.5, -5)).toBeCloseTo(3.5, 6); // away from the big one
  });

  it('holds its own foot behind the stub of a wall drawn through it', () => {
    // the small wall comes down at an angle and ends 30 cm past the big one: a stub on the low side
    const slanted = { ...SMALL, pts: [[8, -8], [10.3, 0.3]] }; // prettier-ignore
    // right behind that stub, seen from the big wall: the foot of the big wall, not the relief
    for (const ops of [[slanted, BIG], [BIG, slanted]]) expect(ground(ops, 10.25, 0.25)).toBeCloseTo(0, 6); // prettier-ignore
    expect(ground([BIG, slanted], 9, 0.5)).toBeCloseTo(0, 6);
  });

  it('tells the sides apart around a bend sharper than a right angle', () => {
    // a wall that steps back, drawn by hand: its two corners turn by a little more than a right angle; the ground
    // it holds is on the side the step goes to (z > 0 here), its foot on the other
    const jog = { ...BIG, side: 1, pts: [[0, 0], [10, 0], [9.9, 1.2], [20, 1.2]] }; // prettier-ignore
    const at = (x, z) => ground([jog], x, z);
    // past the first corner, at the foot of the step: the low side, though the line of the first stretch carried on
    // would say the high one
    expect(at(10.6, 0.05)).toBeCloseTo(0, 6);
    expect(at(10.3, -0.2)).toBeCloseTo(0, 6);
    expect(at(10.05, 0.6)).toBeCloseTo(0, 6); // in front of the step itself
    // before the second corner, behind the step: the high side
    expect(at(9.3, 1.15)).toBeCloseTo(3, 6);
    expect(at(9.6, 1.4)).toBeCloseTo(3, 6);
    expect(at(9.8, 0.6)).toBeCloseTo(3, 6);
    // the bends of a gentle curve are told as before, and so are the two ends of the wall
    const curve = { ...BIG, pts: [[0, 0], [10, 0], [19, 4]] }; // prettier-ignore
    expect(ground([curve], 10.2, -0.5)).toBeCloseTo(3, 6);
    expect(ground([curve], 9.9, 0.6)).toBeCloseTo(0, 6);
    expect(ground([BIG], -0.5, -0.5)).toBeCloseTo(3, 6);
    expect(ground([BIG], -0.5, 0.5)).toBeCloseTo(0, 6);
  });

  it('takes two points on top of each other for one', () => {
    // a double click at the end, a point dragged onto the next one: the wall is the same
    const doubled = { ...BIG, pts: [[0, 0], [10, 0], [10.01, 0.02], [20, 0], [20, 0]] }; // prettier-ignore
    const { walls, snap } = compileOps([doubled], id, alt);
    expect(walls[0].pts).toEqual([[0, 0], [10, 0], [20, 0]]); // prettier-ignore
    expect(walls[0].len).toBe(20);
    for (const x of [5, 9.9, 10.1, 15]) {
      expect(ground([doubled], x, -0.5)).toBeCloseTo(3, 6);
      expect(ground([doubled], x, 0.5)).toBeCloseTo(0, 6);
    }
    // its end is still an end: a vertex past it is left where it is
    expect(snap(20.4, 0.3, 1)).toEqual([20.4, 0.3]);
    // a wall of a single place is no wall
    expect(compileOps([{ ...BIG, pts: [[3, 3], [3, 3.01]] }], id, alt).walls).toEqual([]); // prettier-ignore
  });

  it('keeps its sides around a small kink left by a point added and dragged', () => {
    // 20 cm of wall going back and sideways between two long stretches: two turns sharper than a right angle
    const kinked = { ...BIG, pts: [[0, 0], [10, 0], [9.9, -0.2], [20, -0.2]] }; // prettier-ignore
    for (let x = 6; x <= 14; x += 0.5) {
      // the ground it holds (z < 0 for this wall), then its foot: no heap on one side, no hole on the other
      for (const z of [-1.4, -0.7, -0.35]) expect(ground([kinked], x, z), `${x} ${z}`).toBeCloseTo(3, 6);
      for (const z of [0.3, 0.8, 1.2]) expect(ground([kinked], x, z), `${x} ${z}`).toBeCloseTo(0, 6);
    }
  });

  it('is not stopped by a wall drawn well through the other one', () => {
    const through = { ...SMALL, pts: [[10, -8], [10, 4]] }; // prettier-ignore
    expect(ground([BIG, through], 9.5, 2)).toBeCloseTo(3.5, 6);
  });

  it('keeps two walls drawn end to end working as one', () => {
    const first = { ...BIG, pts: [[0, 0], [10, 0]] }; // prettier-ignore
    const second = { ...BIG, pts: [[10, 0], [20, 0]] }; // prettier-ignore
    for (const x of [8, 9.9, 10.1, 12]) {
      expect(ground([first, second], x, -0.5)).toBeCloseTo(3, 6);
      expect(ground([first, second], x, 0.5)).toBeCloseTo(0, 6);
    }
  });

  it('moves a vertex to the nearest wall, never across another one', () => {
    const { snap } = compileOps([SMALL, BIG], id, alt);
    const off = 0.22;
    // at the foot of the big wall, beside the end of the small one: it used to be pulled to the small one, over
    // the big one, and drew a heap of earth on the low side
    const [, z1] = snap(9.4, 0.5, 1);
    expect(z1).toBeCloseTo(off, 6);
    // nearer the small one, on its side of the big one: to the small one
    const [x2, z2] = snap(9.7, -3, 1);
    expect(x2).toBeCloseTo(10 - off, 6);
    expect(z2).toBeCloseTo(-3, 6);
    // in the corner the two walls make, a vertex goes to the nearest one and stays on its side of the other
    const [x3, z3] = snap(10.6, -0.5, 1);
    expect(z3).toBeLessThan(0);
    expect(x3).toBeGreaterThan(10);
    // between two walls 20 cm apart there is no room on either face: it stays where it is
    const twin = { ...SMALL, pts: [[9.8, -8], [9.8, 8]] }; // prettier-ignore
    const long = { ...SMALL, pts: [[10, -8], [10, 8]] }; // prettier-ignore
    expect(compileOps([twin, long], id, alt).snap(9.87, 1, 1)).toEqual([9.87, 1]);
    expect(compileOps([twin, long], id, alt).snap(9.5, 1, 1)[0]).toBeCloseTo(9.8 - off, 6);
  });

  it('moves a vertex around a bend of the line too, and leaves it past the two ends', () => {
    const bent = { ...BIG, pts: [[0, 0], [10, 0], [16, 5]] }; // prettier-ignore
    const { snap } = compileOps([bent], id, alt);
    // on the outer side of the bend the nearest point is the corner itself
    const [x, z] = snap(10.3, -0.6, 1);
    expect(Math.hypot(x - 10, z)).toBeCloseTo(0.22, 6);
    expect(z).toBeLessThan(0);
    expect(snap(-0.5, 0.4, 1)).toEqual([-0.5, 0.4]);
    expect(snap(16.5, 5.3, 1)).toEqual([16.5, 5.3]);
  });

  it('keeps its flat band as wide as the mesh can draw it', () => {
    // 1.2 m behind a wall given a band of 1 m: in the blend...
    const narrow = { ...BIG, flat: 1, feather: 2 };
    expect(ground([narrow], 5, -1.2)).toBeLessThan(3);
    // ...unless the cells of the mesh are too wide to have a vertex of their own that close
    expect(ground([narrow], 5, -1.2, { cell: 0.5 })).toBeCloseTo(3, 6);
    expect(ground([narrow], 5, -2, { cell: 1 })).toBeCloseTo(3, 6);
    // a wall asked not to shape the ground is left alone
    expect(ground([{ ...BIG, flat: 0, feather: 0 }], 5, -0.3, { cell: 1 })).toBe(1);
  });
});

describe('a platform drawn along a wall', () => {
  // the lane at the foot of the big wall, its outline drawn by hand: 30 cm past the line on half of its length
  const lane = { type: 'terrace', poly: [[0, -0.3], [10, -0.3], [10, 0.2], [20, 0.2], [20, 6], [0, 6]], alt: 0.2, feather: 1 }; // prettier-ignore

  it('levels its own side of the wall only', () => {
    const ops = [BIG, lane];
    expect(ground(ops, 5, 3)).toBeCloseTo(0.2, 6); // the lane itself
    expect(ground(ops, 5, 0.3)).toBeCloseTo(0.2, 6); // up to the foot of the wall
    // the strip that goes past the wall is left to it: the ground it holds is not dug
    expect(ground(ops, 5, -0.2)).toBeCloseTo(3, 6);
    expect(ground(ops, 5, -0.25)).toBeCloseTo(3, 6);
    // and the blend around the lane does not climb over the wall, from that strip or from its foot
    expect(ground(ops, 5, -0.6)).toBeCloseTo(3, 6);
    expect(ground(ops, 15, -0.3)).toBeCloseTo(3, 6);
    // without the wall the same outline levels all it covers, and blends around it
    expect(ground([lane], 5, -0.2)).toBeCloseTo(0.2, 6);
    expect(ground([lane], 5, -0.6)).toBeLessThan(1);
    expect(ground([lane], 5, -0.6)).toBeGreaterThan(0.2);
  });

  it('still levels both sides of a wall it was drawn well across', () => {
    const wide = { ...lane, poly: [[2, -4], [18, -4], [18, 6], [2, 6]] }; // prettier-ignore
    expect(ground([BIG, wide], 5, -0.5)).toBeCloseTo(0.2, 6);
    expect(ground([BIG, wide], 5, 0.5)).toBeCloseTo(0.2, 6);
  });

  it('is not a strip along the wall when it only starts further from it', () => {
    const apart = { ...lane, poly: [[2, -3], [18, -3], [18, -0.6], [2, -0.6]] }; // prettier-ignore
    expect(ground([BIG, apart], 5, -0.9)).toBeCloseTo(0.2, 6);
    expect(compileOps([BIG], id, alt).spills(apart.poly, 5, -0.9)).toBe(false);
    expect(compileOps([BIG], id, alt).spills(lane.poly, 5, -0.2)).toBe(true);
    expect(compileOps([BIG], id, alt).spills(lane.poly, 5, 0.5)).toBe(false);
    expect(compileOps([], id, alt).spills(lane.poly, 5, -0.2)).toBe(false);
  });
});

describe('the ground under a terrace of the garden', () => {
  // a deck at the foot of the big wall, 4 cm thick on a ground at 0.1
  const deck = { type: 'terrace', poly: [[4, 0], [16, 0], [16, 6], [4, 6]], alt: 0.1, feather: 0.6, deck: 0.04 }; // prettier-ignore

  it('never comes up through it', () => {
    // the foot of the wall was typed 30 cm above the deck: the deck stays clear
    const high = { ...BIG, lo: 0.4 };
    expect(ground([deck, high], 10, 1)).toBeCloseTo(0.1, 6);
    expect(ground([deck, high], 2, 1)).toBeCloseTo(0.4, 6); // beside the deck the wall has its foot
    // a foot typed lower is kept: the sides of the deck go down to it
    expect(ground([deck, { ...BIG, lo: -0.1 }], 10, 1)).toBeCloseTo(-0.1, 6);
    // past the end of a wall its high side has nothing to hold: no heap of earth on the deck
    const ending = { ...SMALL, pts: [[10, -8], [10, -1]] }; // prettier-ignore
    const beside = { ...deck, poly: [[4, -0.5], [16, -0.5], [16, 6], [4, 6]] }; // prettier-ignore
    expect(ground([ending], 9, 0)).toBeGreaterThan(3);
    expect(ground([beside, ending], 9, 0)).toBeCloseTo(0.1, 6);
    // a platform drawn by hand is not a deck: what is drawn after it shapes it
    expect(ground([{ ...deck, deck: undefined }, high], 10, 1)).toBeCloseTo(0.4, 6);
  });

  it('is raised by a wall standing on it: a planter', () => {
    const planter = { type: 'wall', pts: [[8, 2], [12, 2]], hi: 0.6, lo: 0.1, side: 1, flat: 1, feather: 0.5 }; // prettier-ignore
    expect(ground([deck, planter], 10, 2.5)).toBeCloseTo(0.6, 6);
    expect(ground([deck, planter], 10, 1.5)).toBeCloseTo(0.1, 6);
    // a wall that holds the ground level with the deck, or a kerb a little above it, is no planter
    expect(ground([deck, { ...planter, hi: 0.13 }], 10, 2.5)).toBeCloseTo(0.1, 6);
    expect(ground([deck, { ...planter, hi: 0.3 }], 10, 2.5)).toBeCloseTo(0.1, 6);
  });

  it('is left to the wall where the deck was drawn a little past it', () => {
    const past = { ...deck, poly: [[4, -0.3], [16, -0.3], [16, 6], [4, 6]] }; // prettier-ignore
    expect(ground([past, BIG], 10, -0.25)).toBeCloseTo(3, 6); // no hole behind the wall
    expect(ground([past, BIG], 10, 0.5)).toBeCloseTo(0, 6);
  });
});
