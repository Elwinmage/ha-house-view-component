import { describe, it, expect } from 'vitest';
import { normalizeBed, polygonArea, inPolygon, rng, colorShares, bedFlowers, bloomAt, buildBeds, BED_MAX } from '../src/flowerbeds.js';

const SQUARE = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];

describe('flower beds', () => {
  it('normalizes a bed: defaults, clamped count, valid colours only', () => {
    const b = normalizeBed({ pts: SQUARE, count: 99999, colors: [{ c: '#FF0000', w: 2 }, { c: 'red' }, { c: '#00ff00', w: -1 }] });
    expect(b.count).toBe(BED_MAX);
    expect(b.colors).toEqual([
      { c: '#ff0000', w: 2 },
      { c: '#00ff00', w: 1 },
    ]);
    const d = normalizeBed(null);
    expect(d.pts).toEqual([]);
    expect(d.colors.length).toBeGreaterThan(0);
    expect(d.count).toBe(60);
    expect(normalizeBed({ pts: SQUARE, name: 'Rosiers', h: 0.5, seed: 7.9 })).toMatchObject({ name: 'Rosiers', h: 0.5, seed: 7 });
  });

  it('computes areas and containment', () => {
    expect(polygonArea(SQUARE)).toBe(12);
    expect(inPolygon(SQUARE, 1, 1)).toBe(true);
    expect(inPolygon(SQUARE, 5, 1)).toBe(false);
  });

  it('is deterministic', () => {
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(0)()).toBeGreaterThanOrEqual(0);
  });

  it('shares the count between colours by weight, total exact', () => {
    const n = colorShares(
      [
        { c: '#111111', w: 1 },
        { c: '#222222', w: 1 },
        { c: '#333333', w: 1 },
      ],
      10,
    );
    expect(n.reduce((s, v) => s + v, 0)).toBe(10);
    expect(Math.max(...n) - Math.min(...n)).toBe(1);
    expect(
      colorShares(
        [
          { c: '#111111', w: 3 },
          { c: '#222222', w: 1 },
        ],
        8,
      ),
    ).toEqual([6, 2]);
  });

  it('plants the requested number of flowers inside the bed, same each time', () => {
    const bed = {
      pts: SQUARE,
      count: 80,
      seed: 5,
      colors: [
        { c: '#ff0000', w: 3 },
        { c: '#ffffff', w: 1 },
      ],
    };
    const f = bedFlowers(bed);
    expect(f).toHaveLength(80);
    expect(f.every((p) => inPolygon(SQUARE, p.x, p.z))).toBe(true);
    expect(f.filter((p) => p.c === '#ff0000')).toHaveLength(60);
    expect(bedFlowers(bed)).toEqual(f);
    expect(bedFlowers({ ...bed, seed: 6 })).not.toEqual(f);
    expect(bedFlowers({ pts: SQUARE.slice(0, 2), count: 5 })).toEqual([]);
    expect(bedFlowers({ pts: SQUARE, count: 0 })).toEqual([]);
  });

  it('falls back on the vertices of a degenerate polygon', () => {
    const f = bedFlowers({
      pts: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      count: 4,
    });
    expect(f).toHaveLength(4);
  });

  it('blooms by season: none in winter, full in summer', () => {
    expect(bloomAt({ from: 'winter', to: 'winter', t: 0.5 })).toBe(0);
    expect(bloomAt({ from: 'summer', to: 'summer', t: 0 })).toBe(1);
    expect(bloomAt({ from: 'winter', to: 'spring', t: 0.5 })).toBeCloseTo(0.375);
    expect(bloomAt({ from: 'x', to: 'summer', t: 0 })).toBe(1);
  });

  it('builds the 3D beds and shows the share in bloom', () => {
    const anchor = () => (x, z) => [x, z];
    const beds = buildBeds(
      [{ pts: SQUARE, count: 40 }, { pts: SQUARE, hidden: true }, { pts: [[0, 0]] }, { pts: SQUARE, count: 0 }],
      anchor,
      () => 0,
    );
    expect(beds.count).toBe(2);
    const inst = [];
    beds.group.traverse((o) => o.isInstancedMesh && inst.push(o));
    expect(inst).toHaveLength(2);
    beds.apply({ from: 'summer', to: 'summer', t: 0 });
    expect(inst[0].count).toBe(40);
    beds.apply({ from: 'winter', to: 'winter', t: 0 });
    expect(inst[0].count).toBe(0);
  });
});
