import { afterEach, describe, it, expect, vi } from 'vitest';
import { PATH_DEFAULT, PATH_W, buildPaths, clipEnds, modulePath, normalizePath, pathLength, pathStrip, stairsKind } from '../src/paths.js';
import { compileOps } from '../src/engine/terrain-edit.js';
import { STEPS_MAX } from '../src/stairs.js';
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

describe('a path along a retaining wall', () => {
  // the foot of the wall along z = 0: the ground held 3 m up behind it (z > 0), the lane in front of it
  const WALL = { type: 'wall', pts: [[-10, 0], [30, 0]], hi: 3, lo: 0, side: 1, flat: 1.5, feather: 2 }; // prettier-ignore
  const same = (x, z) => [x, z];
  const { apply, meet } = compileOps([WALL], same, (alt) => alt);
  const ground = (x, z) => apply(x, z, 0, () => 0);
  // a drive 4 m wide whose line runs 1.9 m from the wall: its edge is drawn 10 cm behind the line of the wall
  const LINE = [[0, -1.9], [10, -1.9], [20, -1.9]]; // prettier-ignore
  const ys = (strip) => strip.pos.filter((_, i) => i % 3 === 1);
  const zs = (strip) => strip.pos.filter((_, i) => i % 3 === 2);

  it('tells where a move on the ground first meets a wall', () => {
    expect(meet(5, -1.9, 5, 0.1)).toBeCloseTo(0.95, 9);
    expect(meet(5, 1, 5, -1)).toBeCloseTo(0.5, 9); // from behind as well
    expect(meet(5, -1.9, 5, -0.1)).toBeNull(); // short of it
    expect(meet(5, -1.9, 9, -1.9)).toBeNull(); // along it
    expect(meet(40, -1, 40, 1)).toBeNull(); // past its end
    expect(compileOps([], same, (alt) => alt).meet(5, -1, 5, 1)).toBeNull();
    // the nearest of two walls on the way
    const two = compileOps([WALL, { ...WALL, pts: [[-10, 1], [30, 1]] }], same, (alt) => alt); // prettier-ignore
    expect(two.meet(5, -1, 5, 3)).toBeCloseTo(0.25, 9);
  });

  it('used to climb the wall where its edge was drawn through it', () => {
    const strip = pathStrip(LINE, 4, ground, { lift: 0 });
    expect(Math.max(...ys(strip))).toBe(3); // a heap of gravel against the wall
    expect(Math.max(...zs(strip))).toBeCloseTo(0.1, 9);
  });

  it('stops at the face of the wall instead, at the level of its foot', () => {
    const strip = pathStrip(LINE, 4, ground, { lift: 0, stop: meet });
    expect(Math.max(...ys(strip))).toBe(0);
    expect(Math.max(...zs(strip))).toBeCloseTo(-0.23, 9); // 3 cm in front of the masonry
    expect(Math.min(...zs(strip))).toBeCloseTo(-3.9, 9); // the other edge is where it was drawn
    // the texture is cut off there, not squeezed: 1.67 m of gravel from the line to the wall
    const us = strip.uv.filter((_, i) => i % 2 === 0);
    expect(Math.max(...us)).toBeCloseTo(1.67 / 2, 9);
    // seen across (wheel tracks), the same share of the width
    const across = pathStrip(LINE, 4, ground, { lift: 0, stop: meet, across: true });
    expect(Math.max(...across.uv.filter((_, i) => i % 2 === 0))).toBeCloseTo(1.67 / 4 + 0.5, 9);
    // a path that keeps clear of the wall is left as it was drawn
    const clear = [[0, -3], [20, -3]]; // prettier-ignore
    expect(pathStrip(clear, 4, ground, { stop: meet }).pos).toEqual(pathStrip(clear, 4, ground).pos);
  });

  it('hides the kerb that would stand in the wall', () => {
    const kerb = pathStrip(LINE, 4, ground, { lift: 0, from: 0.4625, to: 0.5, stop: meet });
    // both of its edges are brought back to the face of the wall: nothing left to see
    expect(new Set(zs(kerb).map((z) => z.toFixed(6)))).toEqual(new Set(['-0.230000']));
    const other = pathStrip(LINE, 4, ground, { lift: 0, from: -0.5, to: -0.4625, stop: meet });
    expect(Math.min(...zs(other))).toBeCloseTo(-3.9, 9);
    expect(Math.max(...zs(other))).toBeCloseTo(-3.75, 9);
  });

  it('ends at the wall when its line was drawn a little too far', () => {
    // the last point of the line is 40 cm behind the wall
    const far = [[5, -8], [5, -4], [5, -2], [5, 0.4]]; // prettier-ignore
    const cut = clipEnds(far, meet);
    expect(cut).toHaveLength(4);
    expect(cut[3][0]).toBe(5);
    expect(cut[3][1]).toBeCloseTo(-0.23, 9);
    expect(far[3]).toEqual([5, 0.4]); // the line given is left alone
    // the same from its first point
    const back = clipEnds([...far].reverse(), meet);
    expect(back[0][1]).toBeCloseTo(-0.23, 9);
    expect(back).toHaveLength(4);
    // a path that really goes across the wall, well past it, keeps its line: so does one that meets no wall
    const through = [[5, -8], [5, -2], [5, 3], [5, 8]]; // prettier-ignore
    expect(clipEnds(through, meet)).toEqual(through);
    expect(clipEnds(far, null)).toBe(far);
    expect(clipEnds([[0, -5], [9, -5]], meet)).toEqual([[0, -5], [9, -5]]); // prettier-ignore
    expect(clipEnds([[5, 0.4]], meet)).toEqual([[5, 0.4]]);
    // a line of two points astride the wall: what is left of it lies on one side
    const short = clipEnds([[5, -0.1], [5, 0.3]], meet); // prettier-ignore
    expect(Math.sign(short[0][1])).toBe(Math.sign(short[1][1]));
  });

  it('is laid that way by the card, a flight of steps going through the wall as before', () => {
    const drive = { id: 'd', pts: [[5, -8], [5, -4], [5, 0.4]], w: 2, surface: 'gravel' }; // prettier-ignore
    const plain = buildPaths([drive], () => same, ground);
    const stopped = buildPaths([drive], () => same, ground, { wallAt: meet });
    const top = (built) =>
      Math.max(...built.group.children[0].children[0].geometry.attributes.position.array.filter((_, i) => i % 3 === 1));
    expect(top(plain)).toBeGreaterThan(2.9);
    expect(top(stopped)).toBeLessThan(0.1);
    // steps are what climbs a wall: they keep their line and reach its top
    const steps = { ...drive, id: 's', pts: [[5, -1.5], [5, 0.6]], stairs: true }; // prettier-ignore
    const flight = buildPaths([steps], () => same, ground, { wallAt: meet });
    expect(flight.group.children[0].name).toBe('stairs');
    expect(top(flight)).toBeGreaterThan(2.9);
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

describe('a path laid as a flight of steps', () => {
  const anchor = () => (x, z) => [x, z];
  const FLIGHT = [
    [0, 0],
    [3, 0],
  ];
  const bank = (x) => x * 0.3;
  const MODULE = { shapes: ['slab'], size: [0.4, 0.8], colors: ['#808080'] };
  afterEach(() => {
    setPathCatalog({});
    vi.unstubAllGlobals();
  });

  it('is a plain path until it is asked for, with the number of steps its height calls for', () => {
    expect(normalizePath({})).toMatchObject({ stairs: false });
    expect(normalizePath({}).steps).toBeUndefined();
    expect(normalizePath({ stairs: 1 })).toMatchObject({ stairs: true });
    expect(normalizePath({ stairs: true, steps: '7' }).steps).toBe(7);
    expect(normalizePath({ stairs: true, steps: 7.6 }).steps).toBe(8);
    expect(normalizePath({ stairs: true, steps: 999 }).steps).toBe(STEPS_MAX);
    // back to what its height calls for
    for (const steps of ['', null, 0, -2, 'many']) expect(normalizePath({ stairs: true, steps }).steps).toBeUndefined();
  });

  it('needs an unbroken surface: elements set one by one are no steps', () => {
    setPathCatalog({ slabs: { name: { en: 'Slabs' }, kind: 'module', draft: '#808080', module: MODULE } });
    expect(stairsKind('gravel')).toBe(true);
    expect(stairsKind('slabs')).toBe(false);
    expect(stairsKind('nothing')).toBe(false);
    expect(normalizePath({ stairs: true, surface: 'slabs' }).stairs).toBe(false);
    expect(normalizePath({ stairs: true, surface: 'nothing' })).toMatchObject({ stairs: true, surface: PATH_DEFAULT.surface });
  });

  it('is built of treads and risers in its surface, between two cheek walls', () => {
    const built = buildPaths(
      [
        { pts: FLIGHT, w: 1.2, surface: 'concrete', stairs: true, edge: true },
        { pts: FLIGHT, w: 1.2, surface: 'concrete' },
      ],
      anchor,
      bank,
    );
    expect(built.count).toBe(2);
    const [flight, plain] = built.group.children;
    expect(flight.name).toBe('stairs');
    expect(plain.name).toBe('path');
    const [steps, cheeks] = flight.children;
    expect(flight.children).toHaveLength(2); // no kerbs: the cheeks stand for them
    expect(steps.geometry.attributes.position.count).toBe(12 * 6); // six treads and six risers
    expect(steps.geometry.attributes.uv.count).toBe(12 * 6);
    expect(cheeks.geometry.attributes.position.count).toBe((2 * 6 * 5 + 1) * 6);
    expect(cheeks.geometry.attributes.uv).toBeUndefined();
    expect(steps.castShadow && cheeks.castShadow).toBe(true);
    // the steps share the material of the paths of the same surface, the cheeks are darker
    expect(steps.material).toBe(plain.children[0].material);
    expect(cheeks.material.color.getHexString()).not.toBe(steps.material.color.getHexString());
    expect(built.materials).toHaveLength(2);
    const ys = Array.from(steps.geometry.attributes.position.array).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.93, 6);
  });

  it('counts its steps from what one walks on at both ends', () => {
    // a deck 30 cm over the ground at the foot of the bank: two steps less
    const built = buildPaths([{ pts: FLIGHT, surface: 'concrete', stairs: true }], anchor, bank, {
      levelAt: (x) => (x < 1 ? 0.3 : bank(x)),
    });
    expect(built.group.children[0].children[0].geometry.attributes.position.count).toBe(2 * 4 * 6);
  });

  it('takes the number of steps asked for, and is left out when its line is too short', () => {
    const built = buildPaths(
      [
        { pts: FLIGHT, surface: 'concrete', stairs: true, steps: 3 },
        { pts: [[0, 0], [0.1, 0]], surface: 'concrete', stairs: true }, // prettier-ignore
      ],
      anchor,
      bank,
    );
    expect(built.count).toBe(1);
    expect(built.group.children[0].children[0].geometry.attributes.position.count).toBe(6 * 6);
  });
});
