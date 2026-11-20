import { describe, it, expect } from 'vitest';
import { FENCE_TYPES, normalizeFence, sideCount, nearestSide, nearestPoint, splitSide, removePoint, buildFence } from '../src/fences.js';

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('fence model', () => {
  it('converts the first model (one style, open sides) to one type per side', () => {
    const f = normalizeFence({ pts: [...square, [0, 0]], h: 2, style: 'wood', color: '#112233', open: [1], parcel: 'AX82' });
    expect(f.closed).toBe(true);
    expect(f.pts).toHaveLength(4);
    expect(f.segs.map((s) => s.s)).toEqual(['wood', 'none', 'wood', 'wood']);
    expect(f.segs[0]).toEqual({ s: 'wood', h: 2, c: '#112233' });
    expect(f.parcels).toEqual(['AX82']);
    expect(f.frame).toBe('grid');
  });

  it('keeps the current model, fills missing sides and bad values', () => {
    const f = normalizeFence({ pts: square, closed: false, segs: [{ s: 'wall', h: 1 }, { s: 'nope' }], frame: 'plan', name: 'Rue' });
    expect(sideCount(f)).toBe(3);
    expect(f.segs).toEqual([
      { s: 'wall', h: 1 },
      { s: 'mesh', h: FENCE_TYPES.mesh.h },
      { s: 'mesh', h: FENCE_TYPES.mesh.h },
    ]);
    expect(f.frame).toBe('plan');
    expect(f.name).toBe('Rue');
    expect(normalizeFence({ pts: [] }).segs).toEqual([]);
  });

  it('finds the nearest side and point', () => {
    const n = nearestSide(square, true, 5, 11);
    expect(n.i).toBe(2);
    expect(n.t).toBeCloseTo(0.5);
    expect(n.d).toBeCloseTo(1);
    expect(nearestSide(square, false, -1, 5).i).toBe(0); // the closing side does not exist on an open line
    expect(nearestPoint(square, 9, 9)).toEqual({ i: 2, d: Math.SQRT2 });
  });

  it('cuts a side in two and removes a point', () => {
    const f = normalizeFence({
      pts: square,
      closed: true,
      segs: [
        { s: 'wall', h: 1 },
        { s: 'mesh', h: 1.5 },
        { s: 'wood', h: 1.8 },
        { s: 'hedge', h: 2 },
      ],
    });
    expect(splitSide(f, 0, 0.001)).toBe(false); // too close to the corner
    expect(splitSide(f, 0, 0.4)).toBe(true);
    expect(f.pts[1]).toEqual([4, 0]);
    expect(f.segs.map((s) => s.s)).toEqual(['wall', 'wall', 'mesh', 'wood', 'hedge']);
    f.segs[1].s = 'mesh';
    expect(removePoint(f, 1)).toBe(true); // back to four sides, the side before the point wins
    expect(f.pts).toEqual(square);
    expect(f.segs.map((s) => s.s)).toEqual(['wall', 'mesh', 'wood', 'hedge']);
    expect(removePoint(f, 0)).toBe(true);
    expect(f.segs.map((s) => s.s)).toEqual(['mesh', 'wood', 'hedge']);
    expect(removePoint(f, 0)).toBe(false); // a closed fence keeps three points
    const open = normalizeFence({ pts: square, closed: false, segs: [{ s: 'wall' }, { s: 'mesh' }, { s: 'wood' }] });
    expect(removePoint(open, 3)).toBe(true);
    expect(open.segs.map((s) => s.s)).toEqual(['wall', 'mesh']);
  });
});

describe('buildFence', () => {
  it('builds one mesh per type, posts for mesh and wood, nothing for open sides', () => {
    const f = { pts: square, closed: true, segs: [{ s: 'wall' }, { s: 'mesh' }, { s: 'none' }, { s: 'hedge' }] };
    const g = buildFence(
      f,
      (x, z) => [x + 100, z],
      (x) => x / 100,
    );
    const meshes = g.children.filter((c) => c.isMesh && !c.isInstancedMesh);
    expect(meshes).toHaveLength(3);
    expect(g.children.filter((c) => c.isInstancedMesh)).toHaveLength(1); // posts of the mesh side only
    const xs = meshes.flatMap((m) => Array.from(m.geometry.attributes.position.array).filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeGreaterThan(99); // converted to plan coordinates
    expect(
      buildFence(
        { pts: square, closed: true, segs: square.map(() => ({ s: 'none' })) },
        (x, z) => [x, z],
        () => 0,
      ).children,
    ).toHaveLength(0);
  });
});

describe('fence types', () => {
  it('are told apart in the editor and named in both languages', async () => {
    const { makeT } = await import('../src/i18n.js');
    const drafts = Object.values(FENCE_TYPES).map((T) => T.draft);
    expect(new Set(drafts).size).toBe(drafts.length);
    for (const lang of ['fr', 'en']) {
      const t = makeT(lang);
      for (const key of Object.keys(FENCE_TYPES)) expect(t(`fence_${key}`)).not.toBe(`fence_${key}`);
    }
    expect(makeT('fr')('fence_hedge_laurel')).toBe('Haie de laurier-palme');
  });

  it('give hedges their own height, colour and thickness', () => {
    const hedges = Object.entries(FENCE_TYPES).filter(([k]) => k.startsWith('hedge'));
    expect(hedges.length).toBeGreaterThan(8);
    for (const [, T] of hedges) expect(T).toMatchObject({ bumpy: true });
    expect(FENCE_TYPES.hedge_leyland.h).toBeGreaterThan(FENCE_TYPES.hedge_laurel.h);
    expect(FENCE_TYPES.hedge_box.h).toBeLessThan(1);
    const f = normalizeFence({ pts: square, closed: false, segs: [{ s: 'hedge_laurel' }, { s: 'iron' }, { s: 'gabion', h: 1.4 }] });
    expect(f.segs).toEqual([
      { s: 'hedge_laurel', h: 1.8 },
      { s: 'iron', h: 1.5 },
      { s: 'gabion', h: 1.4 },
    ]);
  });
});
