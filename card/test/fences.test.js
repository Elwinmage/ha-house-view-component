import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  FENCE_TYPES,
  normalizeFence,
  sideCount,
  nearestSide,
  nearestPoint,
  splitSide,
  removePoint,
  buildFence,
  copingFaces,
  fenceThumb,
  fenceType,
  sideCoping,
  sideSurface,
} from '../src/fences.js';
import { setFenceCatalog } from '../src/fence-art.js';
import { BUILTIN_COPINGS, setCopingCatalog } from '../src/coping-art.js';
import { callsOf, fakeDocument } from './fake-canvas.js';

afterEach(() => {
  setFenceCatalog({});
  setCopingCatalog({});
  vi.unstubAllGlobals();
});

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
    const f = normalizeFence({
      pts: square,
      closed: false,
      segs: [{ s: 'wall', h: 1 }, { s: 'No Such Kind' }],
      frame: 'plan',
      name: 'Rue',
    });
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

describe('coping of a wall', () => {
  const same = (x, z) => [x, z];
  const flat = () => 0;
  const copings = (g) => g.children.filter((c) => c.name === 'fence-coping');
  const span = (mesh, axis) => {
    const values = Array.from(mesh.geometry.attributes.position.array).filter((_, i) => i % 3 === axis);
    return [Math.min(...values), Math.max(...values)];
  };

  it('keeps the coping a side asks for, with a colour of its own', () => {
    const f = normalizeFence({
      pts: square,
      closed: true,
      segs: [
        { s: 'wall', h: 1, cap: 'flat-stone', capc: '#AABBCC' },
        { s: 'wall', h: 1, cap: 'not-read-yet' },
        { s: 'mesh', h: 1, cap: 'brick' },
        { s: 'wall', h: 1, cap: 'No Such', capc: 'red' },
      ],
    });
    expect(f.segs).toEqual([
      { s: 'wall', h: 1, cap: 'flat-stone', capc: '#aabbcc' },
      { s: 'wall', h: 1, cap: 'not-read-yet' }, // kept: the catalog may bring it
      { s: 'mesh', h: 1, cap: 'brick' }, // kept too: the side may become a wall again
      { s: 'wall', h: 1 },
    ]);
  });

  it('caps a wall only, with a coping it knows', () => {
    const stone = BUILTIN_COPINGS['flat-stone'];
    expect(sideCoping({ s: 'wall', h: 1, cap: 'flat-stone' })).toEqual({
      id: 'flat-stone',
      surface: stone.surface,
      height: 0.05,
      overhang: 0.03,
      drop: 0,
    });
    expect(sideCoping({ s: 'wall', h: 1, cap: 'flat-stone', capc: '#112233' }).surface).toMatchObject({
      color: '#112233',
      joints: stone.surface.joints,
    });
    expect(sideCoping({ s: 'wall', h: 1 })).toBeNull(); // bare
    expect(sideCoping({ s: 'wall', h: 1, cap: 'not-read-yet' })).toBeNull();
    expect(sideCoping({ s: 'wood', h: 1, cap: 'flat-stone' })).toBeNull(); // boards carry none
    expect(sideCoping({ s: 'hedge', h: 1, cap: 'flat-stone' })).toBeNull();
    expect(sideCoping(null)).toBeNull();
  });

  it('lays a box on the top of the wall, wider by its overhang, over the faces by its drop', () => {
    const cap = { surface: { color: '#808080', tile: 2 }, height: 0.05, overhang: 0.03, drop: 0.04 };
    const steps = [
      { x: 0, z: 0, top: 1 },
      { x: 2, z: 0, top: 1.2 },
      { x: 4, z: 0, top: 1.4 },
    ];
    const out = copingFaces({ pos: [], uv: [] }, steps, 0.1, cap, 10, [0.13, 0.03]);
    // two steps of three faces, and the two ends: 8 faces of 6 points
    expect(out.pos).toHaveLength(8 * 6 * 3);
    expect(out.uv).toHaveLength(8 * 6 * 2);
    const at = (axis) => out.pos.filter((_, i) => i % 3 === axis);
    expect(Math.min(...at(0))).toBeCloseTo(-0.13, 9); // over the corner at the start
    expect(Math.max(...at(0))).toBeCloseTo(4.03, 9); // past the free end by the overhang
    expect(Math.min(...at(2))).toBeCloseTo(-0.13, 9); // half the wall and the overhang
    expect(Math.max(...at(2))).toBeCloseTo(0.13, 9);
    expect(Math.min(...at(1))).toBeCloseTo(0.96, 9); // it comes down over the faces
    expect(Math.max(...at(1))).toBeCloseTo(1.45, 9); // and follows the top of the wall
    // the rows go on from the sides before: 10 m of fence, in tiles of 2 m
    const us = out.uv.filter((_, i) => i % 2 === 0);
    expect(Math.max(...us)).toBeCloseTo((10 + 4.03) / 2, 9);
    // a side too short to be built gets nothing
    expect(copingFaces({ pos: [], uv: [] }, [steps[0], { x: 0.01, z: 0, top: 1 }], 0.1, cap).pos).toHaveLength(0);
  });

  it('builds one mesh per coping and colour, on the walls that ask for one', () => {
    const f = {
      pts: square,
      closed: true,
      segs: [
        { s: 'wall', h: 1, cap: 'flat-stone' },
        { s: 'wall', h: 1, cap: 'flat-stone' },
        { s: 'wall', h: 1, cap: 'brick', capc: '#303030' },
        { s: 'wall', h: 1 },
      ],
    };
    const g = buildFence(f, same, flat);
    expect(copings(g)).toHaveLength(2);
    const [stone, brick] = copings(g);
    expect(stone.material.color.getHexString()).toBe('c9c2b4'); // no canvas here: the colour of the coping
    expect(brick.material.color.getHexString()).toBe('303030');
    expect(stone.castShadow && stone.receiveShadow).toBe(true);
    expect(stone.geometry.attributes.uv.count).toBe(stone.geometry.attributes.position.count);
    // on the top of a wall of 1 m, 5 cm thick
    expect(span(stone, 1)[0]).toBeCloseTo(1, 6);
    expect(span(stone, 1)[1]).toBeCloseTo(1.05, 6);
    // side 0 runs along z = 0 from x = 0 to 10: it juts out by its overhang at the bare side, and covers the
    // corner it shares with side 1 (half the wall and the overhang)
    expect(span(stone, 0)[0]).toBeCloseTo(-0.03, 6);
    expect(span(stone, 0)[1]).toBeCloseTo(10.13, 6);
    // the walls themselves are not changed by it
    expect(g.children.filter((c) => c.isMesh && c.name !== 'fence-coping')).toHaveLength(1);
    // no wall left that asks for one: no coping
    const bare = buildFence({ ...f, segs: f.segs.map((sg) => ({ ...sg, s: 'wood' })) }, same, flat);
    expect(copings(bare)).toHaveLength(0);
  });

  it('follows the wall down a slope, and stops at the free ends of an open fence', () => {
    const line = [
      [0, 0],
      [10, 0],
    ];
    const g = buildFence({ pts: line, closed: false, segs: [{ s: 'wall', h: 1, cap: 'flat-stone' }] }, same, (x) => x / 10);
    const [coping] = copings(g);
    expect(span(coping, 0)[0]).toBeCloseTo(-0.03, 6);
    expect(span(coping, 0)[1]).toBeCloseTo(10.03, 6);
    expect(span(coping, 1)[0]).toBeCloseTo(1, 6); // top of the wall at the low end
    expect(span(coping, 1)[1]).toBeCloseTo(2.05, 6); // and at the high end, the coping on it
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

describe('fences of the catalog', () => {
  const same = (x, z) => [x, z];
  const flat = () => 0;
  const line = [
    [0, 0],
    [10, 0],
  ];
  const CATALOG = {
    larch: {
      name: { en: 'Larch boards' },
      draft: '#ff9f1a',
      height: { default: 1.8, min: 1, max: 2.5 },
      thickness: 0.04,
      surface: { color: '#8a6a48', roughness: 0.6, tile: 2, joints: { color: '#4a3826', cell: [2, 0.25] } },
      posts: { color: '#5a4330', spacing: 2, size: 0.1 },
    },
    railing: {
      name: { en: 'Railing' },
      draft: '#9b8cff',
      height: { default: 1 },
      surface: { color: '#26272a' },
      open: { pattern: 'bars', pitch: 0.1, fill: 0.25 },
    },
    netting: {
      name: { en: 'Netting' },
      draft: '#ff2bd6',
      height: { default: 1.5 },
      surface: { color: '#5f7d5c' },
      open: { pattern: 'mesh', pitch: 0.05, fill: 0.3 },
    },
  };
  const panels = (g) => g.children.filter((c) => c.isMesh && !c.isInstancedMesh);

  it('keeps a kind it does not know yet, and draws it as a wire mesh meanwhile', () => {
    const f = normalizeFence({ pts: line, closed: false, segs: [{ s: 'larch' }] });
    expect(f.segs).toEqual([{ s: 'larch', h: FENCE_TYPES.mesh.h }]); // the height of the mesh until the catalog is read
    expect(fenceType('larch')).toBe(FENCE_TYPES.mesh);
    setFenceCatalog(CATALOG);
    expect(fenceType('larch')).toBe(FENCE_TYPES.larch); // the same object all along: filled by the catalog
    expect(normalizeFence({ pts: line, closed: false, segs: [{ s: 'larch' }] }).segs).toEqual([{ s: 'larch', h: 1.8 }]);
    expect(normalizeFence({ pts: line, closed: false, segs: [{ s: 'Larch!' }, { s: 7 }] }).segs[0].s).toBe('mesh');
  });

  it('paints a side with the surface of its kind, in the colour of the side', () => {
    setFenceCatalog(CATALOG);
    const T = fenceType('larch');
    expect(sideSurface(T, null)).toBe(T.surface);
    expect(sideSurface(T, '#8a6a48')).toBe(T.surface);
    expect(sideSurface(T, '#ffffff')).toMatchObject({ color: '#ffffff', joints: T.surface.joints });
    expect(sideSurface(fenceType('railing'), null)).toBeNull(); // wires: another texture
    expect(sideSurface(FENCE_TYPES.wall, null)).toBeNull(); // a built-in kind: a plain colour
    expect(sideSurface(null, null)).toBeNull();
  });

  it('gives every side texture coordinates in meters along and up the fence', () => {
    setFenceCatalog(CATALOG);
    const g = buildFence({ pts: line, closed: false, segs: [{ s: 'larch' }] }, same, flat);
    const [panel] = panels(g);
    const uv = panel.geometry.attributes.uv;
    expect(uv.count).toBe(panel.geometry.attributes.position.count);
    const us = Array.from(uv.array).filter((_, i) => i % 2 === 0);
    const vs = Array.from(uv.array).filter((_, i) => i % 2 === 1);
    expect(Math.max(...us)).toBeCloseTo(5, 6); // 10 m in tiles of 2 m
    expect(Math.max(...vs)).toBeCloseTo(0.9, 6); // 1.8 m high
    expect(Math.min(...vs)).toBeCloseTo(-0.1, 6); // sunk a little in the ground, being thick
    expect(panel.material.roughness).toBe(0.6);
    expect(panel.material.map).toBeNull(); // no canvas here: the plain colour
    expect(panel.material.color.getHexString()).toBe('8a6a48');
    // posts every 2 m, as the entry says, and of its size
    const posts = g.children.find((c) => c.isInstancedMesh);
    expect(posts.count).toBe(6);
    expect(posts.geometry.parameters.width).toBe(0.1);
  });

  it('tints a see-through fence where its wires cannot be drawn', () => {
    setFenceCatalog(CATALOG);
    const [panel] = panels(buildFence({ pts: line, closed: false, segs: [{ s: 'railing' }] }, same, flat));
    expect(panel.material).toMatchObject({ transparent: true, opacity: 0.25, alphaTest: 0, depthWrite: false });
    expect(panel.castShadow).toBe(false);
  });

  it('draws the wires of a see-through fence and the surface of a solid one in a browser', () => {
    vi.stubGlobal('document', fakeDocument());
    setFenceCatalog(CATALOG);
    const g = buildFence(
      { pts: [...line, [10, 10], [0, 10]], closed: false, segs: [{ s: 'larch' }, { s: 'railing', h: 2 }, { s: 'netting' }] },
      same,
      flat,
    );
    const [boards, bars, net] = panels(g);
    expect(boards.material.map).not.toBeNull();
    expect(boards.material.color.getHexString()).toBe('ffffff');
    expect(boards.material.transparent).toBe(false);
    // wires on nothing: cut out by their alpha, fully opaque where they are
    for (const m of [bars.material, net.material]) expect(m).toMatchObject({ transparent: true, opacity: 1, alphaTest: 0.04 });
    // bars are drawn once over the whole height of the side, whatever it is
    const barV = Array.from(bars.geometry.attributes.uv.array).filter((_, i) => i % 2 === 1);
    expect(Math.min(...barV)).toBeCloseTo(0, 9);
    expect(Math.max(...barV)).toBe(1);
    // a mesh repeats up the fence, in tiles of its own
    const netV = Array.from(net.geometry.attributes.uv.array).filter((_, i) => i % 2 === 1);
    expect(Math.max(...netV)).toBeCloseTo(1.5 / (6 * 0.05 * Math.SQRT2), 5);
  });

  it('shows each kind on a thumbnail: wires on a pale ground, a painted panel, a clipped hedge, posts', () => {
    expect(fenceThumb('wood')).toBeNull(); // no canvas
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    setFenceCatalog(CATALOG);
    const last = () => doc.canvases[doc.canvases.length - 1];

    const url = fenceThumb('railing');
    expect(url).toMatch(/^data:image\/png;canvas-/);
    expect(fenceThumb('railing')).toBe(url); // painted once
    const wires = last();
    expect(callsOf(wires, 'fillRect')[0]).toMatchObject({ x: 0, y: 0, w: 256, h: 256 }); // the ground behind the wires
    expect(callsOf(wires, 'stroke').length).toBeGreaterThan(10);
    expect(callsOf(wires, 'stroke')[0].style).toBe('#26272a');

    fenceThumb('larch');
    const boards = last();
    expect(callsOf(boards, 'createPattern')).toHaveLength(1); // its painted surface
    expect(callsOf(boards, 'fillRect').filter((c) => c.style === '#5a4330').length).toBeGreaterThan(1); // its posts

    fenceThumb('hedge');
    const hedge = last();
    expect(callsOf(hedge, 'clip')).toHaveLength(1); // an uneven top
    expect(callsOf(hedge, 'fillRect')).toEqual([expect.objectContaining({ style: FENCE_TYPES.hedge.color, alpha: 1 })]);

    fenceThumb('mesh'); // a built-in see-through kind without a pattern: a tinted sheet
    expect(callsOf(last(), 'fillRect')[0]).toMatchObject({ style: FENCE_TYPES.mesh.color, alpha: 0.38 });

    expect(fenceThumb('none')).toBeNull(); // nothing to show for a side left open
    expect(fenceThumb('nothing')).toBeNull();
  });
});
