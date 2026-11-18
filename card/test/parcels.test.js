import { describe, it, expect } from 'vitest';
import { unionOutline, inPoly } from '../src/parcels.js';

const area = (l) => l.reduce((a, p, i) => a + p[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * p[1], 0) / 2;

describe('unionOutline', () => {
  it('merges two parcels sharing a border into one loop', () => {
    const a = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const b = [
      [10, 10],
      [10, 0],
      [20, 0],
      [20, 10],
    ]; // other orientation, not closed
    const loops = unionOutline([a, b]);
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops[0]))).toBeCloseTo(200);
  });

  it('handles a shared border split differently on each side (extra vertex)', () => {
    const a = [
      [0, 0],
      [10, 0],
      [10, 5],
      [10, 10],
      [0, 10],
    ];
    const b = [
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
    ];
    const c = [
      [0, 10],
      [20, 10],
      [20.02, 15],
      [0, 15],
    ]; // shares the top border of a and b, almost exactly
    const loops = unionOutline([a, b, c]);
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops[0]))).toBeCloseTo(300, 0);
  });

  it('keeps separate parcels as separate loops, drops holes and degenerate input', () => {
    const a = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const far = [
      [5, 5],
      [8, 5],
      [8, 8],
      [5, 8],
    ];
    const loops = unionOutline([
      a,
      far,
      [
        [0, 0],
        [1, 1],
      ],
    ]);
    expect(loops).toHaveLength(2);
    expect(Math.abs(area(loops[0]))).toBeCloseTo(9); // largest first
    // ring around a hole: the inner border remains as a negative loop and is not fenced
    const ring = [
      [
        [0, 0],
        [9, 0],
        [9, 3],
        [0, 3],
      ],
      [
        [0, 6],
        [9, 6],
        [9, 9],
        [0, 9],
      ],
      [
        [0, 3],
        [3, 3],
        [3, 6],
        [0, 6],
      ],
      [
        [6, 3],
        [9, 3],
        [9, 6],
        [6, 6],
      ],
    ];
    const out = unionOutline(ring);
    expect(out).toHaveLength(1);
    expect(Math.abs(area(out[0]))).toBeCloseTo(81);
  });

  it('inPoly', () => {
    const sq = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(inPoly(1, 1, sq)).toBe(true);
    expect(inPoly(5, 1, sq)).toBe(false);
  });
});
