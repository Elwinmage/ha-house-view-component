import { describe, it, expect } from 'vitest';
import {
  bodyHalfwidth,
  fishPatches,
  fishSvg,
  fishThumb,
  groupVariety,
  inWater,
  MAX_GROUP,
  MAX_POND,
  pondFish,
  seeded,
  startPoint,
  swimDepth,
  swimStep,
} from '../src/fish.js';
import { buildPondFish } from '../src/engine/fish-3d.js';
import { catalogFish, drawableFish, setCatalog } from '../src/engine/catalog.js';

const KOI = {
  name: { en: 'Koi' },
  length: { default: 0.5, min: 0.2, max: 0.9 },
  body: { width: 0.2, height: 0.22, tail: 0.2 },
  swim: { speed: 0.2, depth: 'middle' },
  varieties: [
    { id: 'kohaku', base: '#ffffff', patches: [{ color: '#ff0000', amount: 0.45, size: 'large', where: 'back' }] },
    { id: 'tancho', base: '#ffffff', patches: [{ color: '#ff0000', amount: 0.08, where: 'head' }] },
    { id: 'ogon', base: '#ffcc00', metallic: true },
  ],
};
const SQUARE = [
  [0, 0],
  [6, 0],
  [6, 6],
  [0, 6],
];
const ISLAND = [
  [2.5, 2.5],
  [3.5, 2.5],
  [3.5, 3.5],
  [2.5, 3.5],
];

describe('robes', () => {
  it('draws the same robe from the same seed', () => {
    expect(seeded(3)()).toBe(seeded(3)());
    expect(seeded(3)()).not.toBe(seeded(4)());
    const r = seeded(9);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('shapes the body like the previews of the catalog', () => {
    expect(bodyHalfwidth(0)).toBeCloseTo(0.28);
    expect(bodyHalfwidth(0.62)).toBeCloseTo(1);
    expect(bodyHalfwidth(1)).toBeCloseTo(0);
    expect(bodyHalfwidth(-2)).toBe(bodyHalfwidth(0));
  });

  it('spreads the patches of a layer', () => {
    const p = fishPatches(KOI.varieties[0], KOI.body, 1);
    expect(p).toHaveLength(2);
    expect(p).toEqual(fishPatches(KOI.varieties[0], KOI.body, 1));
    for (const q of p) expect(q.rx).toBeGreaterThan(q.ry);
    const [spot] = fishPatches(KOI.varieties[1], KOI.body, 5);
    expect(spot.y).toBe(0);
    expect(spot.rx).toBe(spot.ry);
    expect(spot.x).toBeGreaterThan(0.3);
    expect(fishPatches({ patches: [{ color: '#000', amount: 0.1, size: 'odd', where: 'odd' }] }, KOI.body, 1)).toHaveLength(5);
    expect(fishPatches({}, KOI.body, 1)).toEqual([]);
  });
});

describe('groups of a pond', () => {
  const catalog = { koi: KOI };

  it('takes a variety, or colours of one own', () => {
    expect(groupVariety({ variety: 'tancho' }, KOI).id).toBe('tancho');
    expect(groupVariety({ variety: 'nope' }, KOI).id).toBe('kohaku');
    expect(groupVariety({ variety: 'x' }, { varieties: [] })).toBeNull();
    expect(groupVariety({ variety: 'custom', base: '#000000', patch: '#ff0000', pattern: 'spots', metallic: 1 }, KOI)).toEqual({
      id: 'custom',
      base: '#000000',
      metallic: true,
      patches: [{ color: '#ff0000', amount: 0.18, size: 'small' }],
    });
    expect(groupVariety({ variety: 'custom', pattern: 'none', patch: '#ff0000' }, KOI).patches).toEqual([]);
    expect(groupVariety({ variety: 'custom' }, KOI)).toMatchObject({ base: '#f6f2ea', patches: [] });
  });

  it('makes one fish per count, each with a robe and a size of its own', () => {
    const fish = pondFish(
      [
        { id: 'a', species: 'koi', variety: 'kohaku', count: 3 },
        { id: 'b', species: 'koi', variety: 'ogon', count: 2, length: 5 },
        { id: 'c', species: 'goldfish', count: 4 },
        { id: 'd', species: 'koi', count: -1 },
      ],
      catalog,
    );
    expect(fish.map((f) => f.key)).toEqual(['a:0', 'a:1', 'a:2', 'b:0', 'b:1']);
    expect(new Set(fish.map((f) => f.seed)).size).toBe(5);
    for (const f of fish.slice(0, 3)) expect(f.length).toBeGreaterThanOrEqual(0.5 * 0.85);
    for (const f of fish.slice(3)) expect(f.length).toBeLessThanOrEqual(0.9 * 1.15);
    expect(pondFish([{ species: 'koi', count: 1000 }], catalog)).toHaveLength(MAX_GROUP);
    expect(
      pondFish(
        Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, species: 'koi', count: 20 })),
        catalog,
      ),
    ).toHaveLength(MAX_POND);
    expect(pondFish(undefined, catalog)).toEqual([]);
    expect(pondFish([{ species: 'koi', count: 1 }], { koi: { ...KOI, varieties: [] } })).toEqual([]);
    expect(pondFish([{ species: 'koi', count: 1 }], { koi: { name: {} } })).toEqual([]);
  });

  it('tells the fish the engine can draw', () => {
    expect(drawableFish(KOI)).toBe(true);
    expect(drawableFish({ ...KOI, varieties: [{ id: 'x' }] })).toBe(false);
    expect(drawableFish({ ...KOI, body: { width: 0 } })).toBe(false);
    expect(drawableFish(null)).toBe(false);
  });
});

describe('swimming', () => {
  it('stays in the water, away from the banks and the islands', () => {
    expect(inWater(SQUARE, [], 3, 3, 0.2)).toBe(true);
    expect(inWater(SQUARE, [ISLAND], 3, 3, 0.2)).toBe(false);
    expect(inWater(SQUARE, [ISLAND], 2.4, 3, 0.2)).toBe(false);
    expect(inWater(SQUARE, [], 0.1, 3, 0.2)).toBe(false);
    expect(inWater(SQUARE, [], 7, 3, 0.2)).toBe(false);
    const rand = seeded(1);
    let s = startPoint(SQUARE, [ISLAND], 0.3, rand);
    expect(inWater(SQUARE, [ISLAND], s.x, s.z, 0.3)).toBe(true);
    let turns = 0;
    for (let i = 0; i < 4000; i++) {
      const before = s.h;
      s = swimStep(SQUARE, [ISLAND], s, 0.05, 0.3, 0.3, rand);
      if (Math.abs(s.h - before) > 0.05) turns++;
      expect(inWater(SQUARE, [ISLAND], s.x, s.z, 0.15)).toBe(true);
    }
    expect(turns).toBeGreaterThan(0);
    expect(
      startPoint(
        [
          [0, 0],
          [0.2, 0],
          [0.2, 0.2],
        ],
        [],
        0.3,
        rand,
      ),
    ).toBeNull();
  });

  it('turns back in a dead end', () => {
    const narrow = [
      [0, 0],
      [3, 0],
      [3, 0.8],
      [0, 0.8],
    ];
    let s = { x: 2.4, z: 0.4, h: 0, turn: 0 };
    for (let i = 0; i < 40; i++) s = swimStep(narrow, [], s, 0.05, 0.3, 0.3, () => 0.5);
    expect(Math.cos(s.h)).toBeLessThan(0);
  });

  it('keeps its depth in warm water and goes down in the cold', () => {
    expect(swimDepth(KOI, false, 1, 0.5)).toBeCloseTo(0.25);
    expect(swimDepth(KOI, true, 1, 0.5)).toBeCloseTo(0.85);
    expect(swimDepth({ swim: { depth: 'surface' } }, false, 1, 0.5)).toBeCloseTo(0.08);
    expect(swimDepth({ swim: { depth: 'bottom' } }, false, 1, 0.5)).toBeCloseTo(0.8);
    expect(swimDepth({}, false, 0.2, 1.5)).toBe(0.06);
    expect(swimDepth({ swim: { depth: 'odd' } }, false, 1, 0.2)).toBe(0.3);
  });
});

describe('3D fish', () => {
  it('builds and moves the fish of a pond', () => {
    const list = pondFish(
      [
        { id: 'a', species: 'koi', variety: 'kohaku', count: 2 },
        { id: 'b', species: 'koi', variety: 'ogon', count: 1 },
      ],
      { koi: { ...KOI, body: { ...KOI.body, fins: 'long' } } },
    );
    const pond = buildPondFish(list, { poly: SQUARE, islands: [ISLAND], rim: 0, depth: 1 }, () => -1);
    expect(pond.fish).toHaveLength(3);
    expect(pond.group.children).toHaveLength(3);
    const f = pond.fish[0];
    const [x, z] = [f.group.position.x, f.group.position.z];
    for (let i = 0; i < 30; i++) pond.tick(0.05, i * 0.05);
    expect(Math.hypot(f.group.position.x - x, f.group.position.z - z)).toBeGreaterThan(0.05);
    expect(f.group.position.y).toBeLessThan(-0.08);
    const warm = f.group.position.y;
    for (let i = 0; i < 400; i++) pond.tick(0.05, i * 0.05, true);
    expect(f.group.position.y).toBeLessThan(warm); // down in the cold
    expect(f.skin.metalness).toBeLessThan(pond.fish[2].skin.metalness);
    // no room for a fish: left out
    expect(
      buildPondFish(
        list,
        {
          poly: [
            [0, 0],
            [0.1, 0],
            [0.1, 0.1],
          ],
          rim: 0,
        },
        () => -1,
      ).fish,
    ).toEqual([]);
  });
});

describe('fish of the catalog', () => {
  it('come from the pond_fish section of house-catalog', () => {
    setCatalog({ pond_fish: { koi: KOI, broken: { name: { en: 'x' } } } });
    expect(Object.keys(catalogFish())).toEqual(['koi']);
    setCatalog({});
    expect(catalogFish()).toEqual({});
  });
});

describe('miniatures', () => {
  it('draw the robe of a variety seen from above', () => {
    const svg = fishSvg(KOI.varieties[0], KOI.body);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#ff0000"'); // its patches
    expect(svg).toContain('fill="#ffffff"'); // its base
    expect(svg).not.toContain('fill-opacity="0.35"'); // no sheen
    expect(fishSvg(KOI.varieties[0], KOI.body)).toBe(svg); // the same seed, the same robe
    expect(fishSvg(KOI.varieties[0], KOI.body, 7)).not.toBe(svg);
    // metallic, without patches, tail by default, fins and belly of their own
    const ogon = fishSvg({ ...KOI.varieties[2], fins: '#123456', belly: '#654321' }, { width: 0.2 });
    expect(ogon).toContain('fill-opacity="0.35"');
    expect(ogon).toContain('<g clip-path="url(#b)"><rect');
    expect(ogon).toContain('fill="#123456"');
    expect(ogon).toContain('fill="#654321"');
    expect(fishThumb(KOI.varieties[1], KOI.body)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });
});
