import { afterEach, describe, it, expect, vi } from 'vitest';
import { PATH_DEFAULT, PATH_W, buildPaths, modulePath, normalizePath, pathLength, pathStrip } from '../src/paths.js';
import { BUILTIN_PATHS, pathKind, setPathCatalog } from '../src/path-art.js';

const LINE = [
  [0, 0],
  [10, 0],
  [10, 6],
];

describe('drives and paths', () => {
  it('normalizes a path: defaults, clamped width, known surface only', () => {
    const d = normalizePath(null);
    expect(d).toMatchObject({ pts: [], frame: 'grid', w: PATH_DEFAULT.w, surface: PATH_DEFAULT.surface, edge: false, hidden: false });
    expect(d.name).toBeUndefined();
    const p = normalizePath({
      id: 'p1',
      pts: [
        [0, 0],
        [1, 'x'],
        [2, 2],
      ],
      w: 99,
      surface: 'lava',
      edge: 1,
      name: 'Allée',
      frame: 'plan',
    });
    expect(p.pts).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(p).toMatchObject({ id: 'p1', w: PATH_W[1], surface: PATH_DEFAULT.surface, edge: true, name: 'Allée', frame: 'plan' });
    expect(normalizePath({ w: 0.1 }).w).toBe(PATH_W[0]);
    expect(normalizePath({ w: '2.345', surface: 'pavers' })).toMatchObject({ w: 2.35, surface: 'pavers' });
    expect(normalizePath({ w: '' }).w).toBe(PATH_DEFAULT.w);
  });

  it('measures its length', () => {
    expect(pathLength(LINE)).toBe(16);
    expect(pathLength([[0, 0]])).toBe(0);
  });

  it('builds a strip draped on the ground, subdivided across', () => {
    const s = pathStrip(
      [
        [0, 0],
        [4, 0],
        [4, 0], // a repeated point is dropped
        [8, 0],
      ],
      3,
      (x) => x / 10, // a slope along x
    );
    expect(s.pos.length / 3).toBe(3 * 4); // 3 rows of 4 points (3 columns across 3 m)
    expect(s.idx.length).toBe(2 * 3 * 6);
    // the first row spans -1.5 .. 1.5 across (normal of the line: +z on its left), lifted above the ground
    expect(s.pos.slice(0, 3)).toEqual([0, 0.05, -1.5]);
    expect(s.pos.slice(9, 12)).toEqual([0, 0.05, 1.5]);
    // last row: 8 m along, 0.8 m higher
    const last = s.pos.slice(-3);
    expect(last[0]).toBe(8);
    expect(last[1]).toBeCloseTo(0.85);
    // uvs in tiles of 2 m, or across the width for the wheel tracks
    expect(s.uv.slice(-2)).toEqual([0.75, 4]);
    const tr = pathStrip(
      [
        [0, 0],
        [8, 0],
      ],
      3,
      () => 0,
      { across: true },
    );
    expect(tr.uv.slice(0, 2)).toEqual([0, 0]);
    expect(tr.uv.slice(-2)).toEqual([1, 2]);
    // part of the width only (a kerb), one column
    const k = pathStrip(
      [
        [0, 0],
        [8, 0],
      ],
      3,
      () => 0,
      { from: 0.45, to: 0.5, lift: 0.1 },
    );
    expect(k.pos.length / 3).toBe(4);
    expect(k.pos[1]).toBe(0.1);
    expect(pathStrip([[0, 0]], 3, () => 0)).toBeNull();
  });
});

describe('3D drives and paths', () => {
  const anchor = () => (x, z) => [x, z];
  afterEach(() => vi.unstubAllGlobals());

  it('draws the visible paths with their kerbs, one material per surface', () => {
    const built = buildPaths(
      [
        { pts: LINE, surface: 'asphalt', edge: true },
        { pts: LINE, surface: 'asphalt' },
        { pts: LINE, hidden: true },
        { pts: [[0, 0]] },
        {
          pts: [
            [1, 1],
            [1, 1],
          ],
        }, // no length: no strip
      ],
      anchor,
      () => 0,
    );
    expect(built.count).toBe(2);
    const meshes = [];
    built.group.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(4); // two strips, two kerbs
    expect(built.materials).toHaveLength(2); // asphalt and kerbs
    expect(built.materials[0].map).toBeNull(); // no browser: plain colour
    expect(buildPaths(undefined, anchor, () => 0).count).toBe(0);
  });

  it('sets the elements of a modular path on the ground, one colour each', () => {
    setPathCatalog({
      stones: {
        name: { en: 'Stepping stones' },
        kind: 'module',
        draft: '#b5b0a6',
        width: { default: 0.5, min: 0.3, max: 1.2 },
        module: { shapes: ['round', 'half-moon'], size: [0.45, 0.45], thickness: 0.05, gap: 0.25, colors: ['#8d8a84', '#a39a8c'] },
      },
    });
    const built = buildPaths([{ id: 'p1', pts: LINE, surface: 'stones', w: 0.5 }], anchor, () => 2);
    expect(built.count).toBe(1);
    const meshes = [];
    built.group.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(1); // one merged mesh for the whole path
    const geo = meshes[0].geometry;
    expect(geo.attributes.color).toBeTruthy();
    expect(built.materials[0].vertexColors).toBe(true);
    geo.computeBoundingBox();
    // the elements stand on the ground, the thickness above it
    expect(geo.boundingBox.min.y).toBeCloseTo(2.05, 2);
    expect(geo.boundingBox.max.y).toBeCloseTo(2.1, 2);
    // and stay along the line, never a stone's throw off it
    expect(geo.boundingBox.min.x).toBeGreaterThan(-1);
    expect(geo.boundingBox.max.x).toBeLessThan(11);
    expect(geo.boundingBox.min.z).toBeGreaterThan(-1);
    expect(geo.boundingBox.max.z).toBeLessThan(7);

    // the same path drawn again is the same path
    const again = buildPaths([{ id: 'p1', pts: LINE, surface: 'stones', w: 0.5 }], anchor, () => 2);
    const [first] = [];
    expect(again.group.children[0].children[0].geometry.attributes.position.count).toBe(geo.attributes.position.count);
    expect(first).toBeUndefined();

    // a line too short for one element draws nothing
    expect(modulePath(pathKind('stones').module, [[0, 0]], 0.5, () => 0, 'x')).toBeNull();
    setPathCatalog({});
  });

  it('draws a texture per surface in a browser', () => {
    const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    const built = buildPaths(
      Object.keys(BUILTIN_PATHS).map((surface) => ({ pts: LINE, surface })),
      anchor,
      () => 0,
    );
    expect(built.materials).toHaveLength(Object.keys(BUILTIN_PATHS).length);
    for (const m of built.materials) expect(m.map).not.toBeNull();
    // drawn once: the same texture for the next build
    const again = buildPaths([{ pts: LINE, surface: 'gravel' }], anchor, () => 0);
    expect(again.materials[0].map).toBe(built.materials[1].map);
  });
});
