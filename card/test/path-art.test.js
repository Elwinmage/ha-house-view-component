import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PATHS,
  drawablePath,
  elementOutline,
  pathElements,
  pathKind,
  pathKindName,
  pathKinds,
  pathWidth,
  pointAt,
  setPathCatalog,
  shadeHex,
} from '../src/path-art.js';

const MODULE = {
  shapes: ['round'],
  size: [0.45, 0.45],
  thickness: 0.05,
  gap: 0.3,
  colors: ['#808080'],
  vary: { size: 0, angle: 0, side: 0, shade: 0 },
};

/** A "random" source that always gives the middle: no variation, the first shape and colour. */
const middle = () => 0.5;

describe('kinds of path', () => {
  it('ships with the surfaces the card drew before the catalog', () => {
    expect(Object.keys(BUILTIN_PATHS)).toEqual(['asphalt', 'gravel', 'concrete', 'pavers', 'dirt', 'tracks']);
    for (const def of Object.values(BUILTIN_PATHS)) expect(drawablePath(def)).toBe(true);
    expect(pathKind('gravel').surface.color).toBe('#bdb29c');
    expect(pathKind('nothing')).toBeNull();
  });

  it('takes the entries of the catalog over its own, and leaves out what it cannot draw', () => {
    setPathCatalog({
      gravel: { name: { en: 'Pea gravel', fr: 'Gravillon' }, kind: 'surface', draft: '#eeeeee', surface: { color: '#dddddd' } },
      sleepers: {
        name: { en: 'Sleepers' },
        kind: 'module',
        draft: '#8a6a45',
        module: { shapes: ['slab'], size: [0.2, 1.2], colors: ['#6b4f33'] },
      },
      broken: { name: { en: 'Broken' }, kind: 'surface' },
      alien: { name: { en: 'Alien' }, kind: 'hologram' },
    });
    expect(pathKind('gravel').surface.color).toBe('#dddddd');
    expect(pathKindName('gravel')).toBe('Pea gravel');
    expect(pathKind('sleepers').kind).toBe('module');
    expect(pathKind('broken')).toBeNull();
    expect(pathKind('alien')).toBeNull();
    expect(pathKind('asphalt')).toBeTruthy(); // the other built-in ones stay
    expect(pathKindName('asphalt')).toBe(''); // the card translates its own

    setPathCatalog({}, 'fr');
    expect(pathKind('gravel').surface.color).toBe('#bdb29c'); // back to the built-in one
    expect(pathKind('sleepers')).toBeNull();
    expect(Object.keys(pathKinds())).toHaveLength(6);
  });

  it('offers the width bounds of a kind, else the ones given', () => {
    const fallback = { min: 0.5, max: 12 };
    expect(pathWidth(pathKind('tracks'), fallback)).toEqual({ default: 3, min: 1.2, max: 10 });
    expect(pathWidth({ width: { default: 1, min: 2, max: 1 } }, fallback)).toBe(fallback);
    expect(pathWidth(null, fallback)).toBe(fallback);
  });

  it('lightens and darkens a colour, and leaves a broken one alone', () => {
    expect(shadeHex('#808080', 1.5)).toBe('#c0c0c0');
    expect(shadeHex('#808080', 0)).toBe('#000000');
    expect(shadeHex('#ffffff', 2)).toBe('#ffffff');
    expect(shadeHex('#zzzzzz', 1.2)).toBe('#zzzzzz');
  });
});

describe('elements of a modular path', () => {
  it('keeps each shape inside its size, a half-moon being a disc cut in two', () => {
    for (const shape of ['round', 'oval', 'slab']) {
      const points = elementOutline(shape, 0.4, 0.6, middle);
      const along = points.map(([x]) => x);
      const across = points.map(([, y]) => y);
      expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(0.6, 6);
      expect(Math.max(...along) - Math.min(...along)).toBeLessThanOrEqual(0.4 + 1e-6);
    }
    const moon = elementOutline('half-moon', 0.4, 0.6, middle);
    expect(Math.max(...moon.map(([, y]) => y)) - Math.min(...moon.map(([, y]) => y))).toBeCloseTo(0.6, 6);
    expect(Math.max(...moon.map(([x]) => x))).toBeCloseTo(0.15, 6);
    expect(Math.min(...moon.map(([x]) => x))).toBeCloseTo(-0.15, 6);
  });

  it('breaks a stone out of its ellipse', () => {
    let seed = 0;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const reach = elementOutline('stone', 0.4, 0.6, rand).map(([x, y]) => Math.hypot(x / 0.2, y / 0.3));
    expect(new Set(reach.map((v) => Math.round(v * 1000))).size).toBeGreaterThan(10);
    for (const value of reach) expect(value).toBeGreaterThan(0.7) && expect(value).toBeLessThan(1.15);
  });

  it('sets the elements one after another along the line', () => {
    const elements = pathElements(MODULE, 3, 0.6, middle);
    expect(elements.map((e) => Math.round(e.d * 100) / 100)).toEqual([0.23, 0.98, 1.73, 2.48]);
    for (const e of elements) expect(e).toMatchObject({ a: 0.45, c: 0.45, angle: 0, side: 0, shape: 'round', color: '#808080' });
  });

  it('never lays an element wider than the path', () => {
    const wide = pathElements({ ...MODULE, size: [0.45, 4] }, 2, 0.8, middle);
    for (const e of wide) expect(e.c).toBe(0.8);
  });

  it('takes the usual gap and variations when the entry gives none', () => {
    const bare = pathElements({ shapes: ['slab'], size: [0.2, 1], colors: ['#111111'] }, 1, 1, middle);
    expect(bare).toHaveLength(3); // 0.2 + 0.2 of gap
    expect(bare[0].color).toBe('#111111');
  });
});

describe('walking a line', () => {
  const LINE = [
    [0, 0],
    [4, 0],
    [4, 3],
  ];

  it('finds where it is at a distance, and which way it goes', () => {
    expect(pointAt(LINE, 0)).toMatchObject({ x: 0, z: 0, cos: 1, sin: 0 });
    expect(pointAt(LINE, 2)).toMatchObject({ x: 2, z: 0 });
    expect(pointAt(LINE, 5.5)).toMatchObject({ x: 4, z: 1.5, cos: 0, sin: 1 });
    // past the end it keeps going straight ahead, so the last element is not piled up
    expect(pointAt(LINE, 9)).toMatchObject({ x: 4, z: 5 });
  });

  it('needs two points apart', () => {
    expect(pointAt([[0, 0]], 1)).toBeNull();
    expect(pointAt(null, 1)).toBeNull();
    expect(
      pointAt(
        [
          [1, 1],
          [1, 1],
        ],
        0.5,
      ),
    ).toBeNull();
  });
});
