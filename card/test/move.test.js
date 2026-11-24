import { describe, expect, it } from 'vitest';
import { GRAB_PX, WHOLE, handlesOf, middleOf, movedPts, nearestHandle, offsetPts, setPt } from '../src/move.js';

const SQ = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe('moving points and whole objects', () => {
  it('puts a handle on each point, and one in the middle for the object', () => {
    const h = handlesOf(SQ);
    expect(h).toHaveLength(5);
    expect(h[4]).toEqual({ i: WHOLE, x: 2, z: 2 });
    expect(handlesOf(SQ, false)).toHaveLength(4);
    expect(handlesOf([[1, 2]])).toEqual([{ i: 0, x: 1, z: 2 }]); // a single point is already the object
    expect(handlesOf([])).toEqual([]);
    expect(middleOf([])).toBeNull();
  });

  it('takes the handle nearest to the pointer, a point before the whole object', () => {
    const h = handlesOf(SQ);
    const at = (x) => [x.x * 10, x.z * 10]; // 10 pixels per metre
    expect(nearestHandle(h, at, 0, 0).i).toBe(0);
    expect(nearestHandle(h, at, 41, 1).i).toBe(1);
    expect(nearestHandle(h, at, 20, 20).i).toBe(WHOLE); // only the middle one is close enough
    expect(nearestHandle(h, at, 200, 200)).toBeNull(); // nothing within reach
    expect(nearestHandle(h, () => null, 0, 0)).toBeNull(); // every handle out of the view
    expect(nearestHandle(null, at, 0, 0)).toBeNull();
    expect(GRAB_PX).toBeGreaterThan(0);
  });

  it('the middle handle loses to a point that sits on it', () => {
    const tiny = [
      [0, 0],
      [0.1, 0],
    ];
    const at = (x) => [x.x, x.z];
    expect(nearestHandle(handlesOf(tiny), at, 0.05, 0).i).not.toBe(WHOLE);
  });

  it('moves one point, or every point with the handle of the object', () => {
    expect(setPt(SQ, 1, 9, 9)[1]).toEqual([9, 9]);
    expect(setPt(SQ, 1, 9, 9)[0]).not.toBe(SQ[0]); // the points are copied, never shared
    expect(offsetPts(SQ, 1, 2)[0]).toEqual([1, 2]);
    expect(movedPts(SQ, { i: 2, x: 4, z: 4 }, 5, 6)[2]).toEqual([5, 6]);
    expect(movedPts(SQ, { i: WHOLE, x: 2, z: 2 }, 3, 5, [2, 2])).toEqual([
      [1, 3],
      [5, 3],
      [5, 7],
      [1, 7],
    ]);
    expect(movedPts(SQ, null, 1, 1)).toBe(SQ); // no handle: nothing moves
  });
});
