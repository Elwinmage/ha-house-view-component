import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BUILTIN_TERRACES,
  TERRACE_DEFAULT,
  TERRACE_THICKNESS,
  drawableTerrace,
  setTerraceCatalog,
  terraceKind,
  terraceKindName,
  terraceKinds,
  terraceLook,
  terraceThickness,
} from '../src/terrace-art.js';
import {
  TERRACE_FEATHER,
  TERRACE_H,
  buildTerraces,
  dropPoint,
  holesIn,
  insertPoint,
  isRectangle,
  layFrame,
  levelOps,
  normalizeTerrace,
  outlineAngle,
  outlineArea,
  rotateOutline,
  terraceKnown,
  terraceSides,
  terraceThumb,
  terraceTop,
  terraceValid,
  thicknessOf,
  walkLevel,
} from '../src/terraces.js';
import { compileOps } from '../src/engine/terrain-edit.js';
import { fakeDocument } from './fake-canvas.js';

// the built-in snapshot of the catalog: what the integration serves before the first download
const ITEMS = new URL('../../custom_components/house_view/catalog_builtin_terraces/items/', import.meta.url);
const CATALOG = Object.fromEntries(
  readdirSync(ITEMS).map((id) => [id, JSON.parse(readFileSync(new URL(`${id}/terrace.json`, ITEMS), 'utf8'))]),
);

const SQUARE = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
const same = (x, z) => [x, z];
const anchor = () => same;
const round = (pts) => pts.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]);

afterEach(() => {
  setTerraceCatalog({});
  vi.unstubAllGlobals();
});

describe('coverings of a terrace', () => {
  it('ships with wood, tiles, concrete and a colour, under the ids of the catalog', () => {
    expect(Object.keys(BUILTIN_TERRACES)).toEqual(['wood-decking', 'porcelain-tiles', 'concrete-slab', 'painted']);
    for (const [id, kind] of Object.entries(BUILTIN_TERRACES)) {
      expect(drawableTerrace(kind), id).toBe(true);
      expect(CATALOG[id], id).toBeTruthy(); // the entry that replaces it once the catalog is read
    }
    expect(terraceKind(TERRACE_DEFAULT)).toBe(BUILTIN_TERRACES['wood-decking']);
    expect(terraceKind('nothing')).toBeNull();
    expect(terraceLook('nothing')).toBe(BUILTIN_TERRACES['wood-decking']);
    expect(terraceKnown('painted')).toBe(true);
    expect(terraceKnown('nothing')).toBe(false);
  });

  it('draws every entry of the catalog', () => {
    setTerraceCatalog(CATALOG, 'fr');
    expect(Object.keys(terraceKinds()).sort()).toEqual(Object.keys(CATALOG).sort());
    for (const id of Object.keys(CATALOG)) {
      expect(terraceKind(id), id).toBe(CATALOG[id]);
      expect(terraceKindName(id), id).toBe(CATALOG[id].name.fr);
      expect(terraceThickness(terraceKind(id)), id).toBeGreaterThan(0);
    }
  });

  it('takes the entries of the catalog over its own, and leaves out what it cannot draw', () => {
    setTerraceCatalog({
      'wood-decking': { name: { en: 'Pine decking' }, draft: '#eeeeee', surface: { color: '#dddddd' } },
      marble: { name: { en: 'Marble', fr: 'Marbre' }, draft: '#ffffff', thickness: 0.02, surface: { color: '#f0f0f0' } },
      broken: { name: { en: 'Broken' }, draft: '#ffffff' },
    });
    expect(terraceKind('wood-decking').surface.color).toBe('#dddddd');
    expect(terraceKindName('wood-decking')).toBe('Pine decking');
    expect(terraceKind('marble').thickness).toBe(0.02);
    expect(terraceKind('broken')).toBeNull();
    expect(terraceKind('painted')).toBe(BUILTIN_TERRACES.painted); // the other built-in ones stay
    expect(terraceKindName('painted')).toBe(''); // the card translates its own
    setTerraceCatalog({});
    expect(terraceKind('marble')).toBeNull();
    expect(terraceKind('wood-decking')).toBe(BUILTIN_TERRACES['wood-decking']);
  });

  it('stands a covering over the ground by its own thickness, else the usual one', () => {
    expect(terraceThickness({ thickness: 0.12 })).toBe(0.12);
    expect(terraceThickness({})).toBe(TERRACE_THICKNESS);
    expect(terraceThickness(null)).toBe(TERRACE_THICKNESS);
  });
});

describe('terrace model', () => {
  it('fills a terrace with the usual values', () => {
    expect(normalizeTerrace(null)).toEqual({
      id: '',
      pts: [],
      frame: 'grid',
      shape: 'free',
      surface: TERRACE_DEFAULT,
      alt: null,
      feather: TERRACE_FEATHER,
      rot: 0,
      hidden: false,
    });
  });

  it('keeps what was given, within bounds', () => {
    const t = normalizeTerrace({
      id: 't1',
      pts: [[0, 0], [1, 'x'], [4, 0], null, [4, 3]],
      frame: 'plan',
      shape: 'rect',
      surface: 'porcelain-tiles',
      c: '#AABBCC',
      alt: '153.456',
      h: 5,
      feather: 99,
      rot: -90,
      hidden: 1,
      name: 'Pool deck',
    });
    expect(t).toEqual({
      id: 't1',
      pts: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      frame: 'plan',
      shape: 'rect',
      surface: 'porcelain-tiles',
      c: '#aabbcc',
      alt: 153.46,
      h: TERRACE_H[1],
      feather: 10,
      rot: 270,
      hidden: true,
      name: 'Pool deck',
    });
    expect(normalizeTerrace({ h: 0 }).h).toBe(TERRACE_H[0]);
    expect(normalizeTerrace({ h: '' }).h).toBeUndefined();
    expect(normalizeTerrace({ c: 'red' }).c).toBeUndefined();
    expect(normalizeTerrace({ alt: '' }).alt).toBeNull();
    expect(normalizeTerrace({ rot: 725.4 }).rot).toBe(5);
    expect(normalizeTerrace({ feather: -1 }).feather).toBe(0);
  });

  it('keeps a covering the catalog does not know yet, and draws it with the usual one', () => {
    const t = normalizeTerrace({ surface: 'travertine' });
    expect(t.surface).toBe('travertine');
    expect(terraceLook(t.surface)).toBe(BUILTIN_TERRACES[TERRACE_DEFAULT]);
    expect(normalizeTerrace({ surface: 42 }).surface).toBe(TERRACE_DEFAULT);
  });

  it('is laid once it has three points and is not hidden', () => {
    expect(terraceValid({ pts: SQUARE })).toBe(true);
    expect(terraceValid({ pts: SQUARE, hidden: true })).toBe(false);
    expect(terraceValid({ pts: SQUARE.slice(0, 2) })).toBe(false);
    expect(terraceValid({})).toBe(false);
    expect(terraceValid(null)).toBe(false);
  });

  it('is as thick as its covering, unless a thickness was typed', () => {
    expect(thicknessOf(normalizeTerrace({ surface: 'wood-decking' }))).toBe(0.12);
    expect(thicknessOf(normalizeTerrace({ surface: 'wood-decking', h: 0.3 }))).toBe(0.3);
    expect(thicknessOf(normalizeTerrace({ surface: 'unknown' }))).toBe(0.12); // the usual covering
  });
});

describe('terraces of a home', async () => {
  const { emptyEdits, normalizeEdits } = await import('../src/engine/edits.js');

  it('are kept with the rest of what was drawn, the broken ones left out', () => {
    expect(emptyEdits().terraces).toEqual([]);
    expect(normalizeEdits({}).terraces).toEqual([]);
    const kept = { id: 't1', pts: SQUARE, surface: 'travertine' };
    expect(normalizeEdits({ terraces: [kept, null, 'deck', { id: 't2' }] }).terraces).toEqual([kept]);
    expect(normalizeEdits({ terraces: 'none' }).terraces).toEqual([]);
  });
});

describe('outline of a terrace', () => {
  it('measures its area whichever way it turns', () => {
    expect(outlineArea(SQUARE)).toBe(12);
    expect(outlineArea([...SQUARE].reverse())).toBe(12);
    expect(outlineArea([])).toBe(0);
  });

  it('tells a rectangle from another shape', () => {
    expect(isRectangle(SQUARE)).toBe(true);
    expect(isRectangle(rotateOutline(SQUARE, 37))).toBe(true);
    expect(
      isRectangle([
        [0, 0],
        [4, 0],
        [5, 3],
        [0, 3],
      ]),
    ).toBe(false);
    expect(isRectangle(SQUARE.slice(0, 3))).toBe(false);
    expect(
      isRectangle([
        [0, 0],
        [0, 0],
        [4, 3],
        [0, 3],
      ]),
    ).toBe(false); // two points at the same place
    expect(isRectangle(null)).toBe(false);
  });

  it('gives the direction of its first side', () => {
    expect(outlineAngle(SQUARE)).toBe(0);
    expect(
      outlineAngle([
        [0, 0],
        [0, 2],
      ]),
    ).toBe(90);
    expect(
      outlineAngle([
        [0, 0],
        [-1, -1],
      ]),
    ).toBe(225);
    expect(outlineAngle([[0, 0]])).toBe(0);
    expect(outlineAngle(null)).toBe(0);
  });

  it('turns about its middle', () => {
    expect(round(rotateOutline(SQUARE, 90))).toEqual([
      [3.5, -0.5],
      [3.5, 3.5],
      [0.5, 3.5],
      [0.5, -0.5],
    ]);
    expect(outlineAngle(rotateOutline(SQUARE, 30))).toBe(30);
    expect(outlineArea(rotateOutline(SQUARE, 30))).toBeCloseTo(12, 9);
    expect(rotateOutline([], 30)).toEqual([]);
    expect(rotateOutline(null, 30)).toEqual([]);
  });

  it('takes a point on a side, but not on one of its ends', () => {
    expect(insertPoint(SQUARE, 0, 0.5)).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
    expect(insertPoint(SQUARE, 3, 0.5)).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 1.5],
    ]); // the side that closes it
    expect(insertPoint(SQUARE, 0, 0.01)).toBeNull();
    expect(insertPoint(SQUARE, 0, 0.99)).toBeNull();
    expect(SQUARE).toHaveLength(4); // the outline given is left alone
  });

  it('loses a point, down to a triangle', () => {
    expect(dropPoint(SQUARE, 1)).toEqual([
      [0, 0],
      [4, 3],
      [0, 3],
    ]);
    expect(dropPoint(SQUARE.slice(0, 3), 0)).toBeNull();
    expect(dropPoint(SQUARE, 4)).toBeNull();
    expect(dropPoint(SQUARE, -1)).toBeNull();
  });
});

describe('ground under the terraces', () => {
  const terraces = [
    { pts: SQUARE, alt: 152.5, feather: 1.5 },
    { pts: SQUARE, frame: 'plan' },
    { pts: SQUARE, hidden: true },
    { pts: SQUARE.slice(0, 2) },
  ];

  it('levels one platform per terrace laid, in the grid frame', () => {
    const toGrid = (t) => (t.frame === 'plan' ? (x, z) => [x + 10, z + 20] : same);
    const ops = levelOps(terraces, toGrid, (gx, gz) => 100 + gx + gz);
    expect(ops).toEqual([
      // each one tells how thick what is laid there is: the earth is kept under it
      { type: 'terrace', poly: SQUARE, alt: 152.5, feather: 1.5, deck: thicknessOf(normalizeTerrace(terraces[0])) },
      // no altitude given: the one of the relief in its middle
      {
        type: 'terrace',
        poly: [
          [10, 20],
          [14, 20],
          [14, 23],
          [10, 23],
        ],
        alt: 100 + 12 + 21.5,
        feather: TERRACE_FEATHER,
        deck: thicknessOf(normalizeTerrace(terraces[1])),
      },
    ]);
    expect(levelOps(null, toGrid, () => 0)).toEqual([]);
  });

  it('flattens the ground under the terrace, then blends back to the relief', () => {
    const ops = levelOps(
      [terraces[0]],
      () => same,
      () => 0,
    );
    const { apply } = compileOps(ops, same, (alt) => alt - 150);
    const slope = (x) => x / 2;
    expect(apply(2, 1.5, slope(2), slope)).toBeCloseTo(2.5, 6); // inside
    expect(apply(0.1, 0.1, slope(0.1), slope)).toBeCloseTo(2.5, 6);
    const near = apply(-0.75, 1.5, slope(-0.75), slope); // half-way through the blend
    expect(near).toBeGreaterThan(slope(-0.75));
    expect(near).toBeLessThan(2.5);
    expect(apply(-1.5, 1.5, slope(-1.5), slope)).toBeCloseTo(slope(-1.5), 6); // past it
  });
});

describe('what one walks on', () => {
  const ground = (x) => x / 10;

  it('is the top of the terrace laid there, else the ground', () => {
    const at = walkLevel(
      [
        { pts: SQUARE, surface: 'wood-decking' }, // on the ground in its middle (0.2), 12 cm thick
        { pts: SQUARE, hidden: true, h: 1 },
        { pts: SQUARE.slice(0, 2), h: 1 },
      ],
      anchor,
      ground,
    );
    expect(at(2, 1)).toBeCloseTo(0.32, 9);
    expect(at(0.5, 0.5)).toBeCloseTo(0.32, 9); // level all over it
    expect(at(8, 1)).toBeCloseTo(0.8, 9); // beside it: the ground
    expect(walkLevel(null, anchor, ground)(8, 1)).toBeCloseTo(0.8, 9);
  });

  it('follows the altitude of a terrace, and never goes under the ground', () => {
    const at = walkLevel([{ pts: SQUARE, alt: 152, h: 0.2, frame: 'grid' }], () => (x, z) => [x + 10, z], ground, {
      altToY: (alt) => alt - 150,
    });
    expect(at(12, 1)).toBeCloseTo(2.2, 9);
    expect(at(2, 1)).toBeCloseTo(0.2, 9); // the terrace is 10 m further on
    // a terrace sunk under the relief does not lower what one walks on
    const sunk = walkLevel([{ pts: SQUARE, alt: 100 }], anchor, () => 5, { altToY: (alt) => alt - 150 });
    expect(sunk(2, 1)).toBe(5);
  });
});

describe('geometry of a terrace', () => {
  it('lays its rows along its first side, turned by the laying direction', () => {
    expect(layFrame(SQUARE)).toMatchObject({ ox: 0, oz: 0, ux: 1, uz: 0, vx: -0, vz: 1 });
    const turned = layFrame(SQUARE, 90);
    expect(turned.ux).toBeCloseTo(0, 9);
    expect(turned.uz).toBeCloseTo(1, 9);
    const leaning = layFrame(rotateOutline(SQUARE, 30), 60);
    expect(leaning.ux).toBeCloseTo(0, 9); // 30 + 60: along z
  });

  it('cuts out the outlines that lie wholly inside it', () => {
    const pool = [
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
    ];
    const astride = [
      [3, 1],
      [6, 1],
      [6, 2],
      [3, 2],
    ];
    expect(holesIn(SQUARE, [pool, astride, [[1, 1]], null])).toEqual([pool]);
    expect(holesIn(SQUARE, null)).toEqual([]);
  });

  it('builds a flat top with its texture in tiles of the covering', () => {
    const top = terraceTop(SQUARE, [], 1.2, layFrame(SQUARE), 2);
    expect(top.pos).toEqual([0, 1.2, 0, 4, 1.2, 0, 4, 1.2, 3, 0, 1.2, 3]);
    expect(top.uv).toEqual([0, 0, 2, 0, 2, 1.5, 0, 1.5]);
    expect(top.idx).toHaveLength(6);
    // turned a quarter: the rows run along z
    const turned = terraceTop(SQUARE, [], 1.2, layFrame(SQUARE, 90), 2);
    expect(turned.uv[2]).toBeCloseTo(0, 9);
    expect(turned.uv[3]).toBeCloseTo(-2, 9);
  });

  it('leaves a hole in the top and gives it sides', () => {
    const pool = [
      [1, 1],
      [1, 2],
      [3, 2],
      [3, 1],
    ];
    const top = terraceTop(SQUARE, [pool], 0, layFrame(SQUARE), 1);
    expect(top.pos).toHaveLength(8 * 3);
    expect(top.idx).toHaveLength(8 * 3); // eight triangles around the hole
    const area = (idx) => {
      let a = 0;
      for (let i = 0; i < idx.length; i += 3) {
        const [p, q, r] = [0, 1, 2].map((k) => [top.pos[idx[i + k] * 3], top.pos[idx[i + k] * 3 + 2]]);
        a += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
      }
      return a;
    };
    expect(area(top.idx)).toBeCloseTo(12 - 2, 9);
    expect(terraceSides(SQUARE, [pool], 0.1, -0.3)).toHaveLength(8 * 6 * 3);
    expect(
      terraceTop(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        [],
        0,
        layFrame(SQUARE),
        1,
      ),
    ).toBeNull(); // nothing to fill
  });

  it('drops its sides from the top to under the ground', () => {
    const pos = terraceSides(SQUARE.slice(0, 3), [], 0.1, -0.3);
    expect(pos).toHaveLength(3 * 6 * 3);
    const ys = pos.filter((_, i) => i % 3 === 1);
    expect(new Set(ys)).toEqual(new Set([0.1, -0.3]));
  });
});

describe('3D terraces', () => {
  const ground = (x) => x / 10;

  it('lays each terrace flat on the ground in its middle, or at its own altitude', () => {
    const built = buildTerraces(
      [
        { pts: SQUARE, surface: 'porcelain-tiles' },
        { pts: SQUARE, surface: 'porcelain-tiles', alt: 152, h: 0.2 },
        { pts: SQUARE, hidden: true },
        { pts: SQUARE.slice(0, 2) },
      ],
      anchor,
      ground,
      { altToY: (alt) => alt - 150 },
    );
    expect(built.count).toBe(2);
    expect(built.group.name).toBe('terraces');
    expect(built.materials).toHaveLength(1); // one material for the same covering in the same colour
    const [first, second] = built.group.children;
    const [top, sides] = first.children;
    const ys = (mesh) => [...mesh.geometry.attributes.position.array].filter((_, i) => i % 3 === 1);
    for (const y of ys(top)) expect(y).toBeCloseTo(0.2 + 0.03, 6); // ground in the middle + thickness of the tiles
    expect(Math.min(...ys(sides))).toBeCloseTo(0.2 - 0.3, 6); // down under the ground
    for (const y of ys(second.children[0])) expect(y).toBeCloseTo(2 + 0.2, 6);
    expect(top.geometry.attributes.uv.count).toBe(4);
    expect(top.material).toBe(second.children[0].material);
    expect(top.material.color.getHexString()).toBe('a9a9a4'); // no canvas here: the plain colour
    expect(top.material.map).toBeNull();
    expect(top.material.roughness).toBe(0.5);
  });

  it('ignores the altitude without a terrain, and cuts out the pools', () => {
    const pool = [
      [1, 1],
      [1, 2],
      [3, 2],
      [3, 1],
    ];
    const built = buildTerraces([{ pts: SQUARE, alt: 152 }], anchor, () => 0, { holes: [pool] });
    const [top, sides] = built.group.children[0].children;
    expect(top.geometry.attributes.position.count).toBe(8);
    expect(top.geometry.attributes.position.array[1]).toBeCloseTo(0.12, 6);
    expect(sides.geometry.attributes.position.count).toBe(8 * 6);
  });

  it('stains a covering in the colour of the user, and paints it in a browser', () => {
    vi.stubGlobal('document', fakeDocument());
    const built = buildTerraces(
      [{ pts: SQUARE }, { pts: SQUARE, c: '#336699' }, { pts: SQUARE, surface: 'travertine' }],
      (t) => (t.c ? (x, z) => [x + 10, z] : same),
      () => 0,
    );
    expect(built.count).toBe(3);
    expect(built.materials).toHaveLength(3); // the unknown covering is drawn as the usual one, under its own id
    for (const m of built.materials) {
      expect(m.map).not.toBeNull();
      expect(m.color.getHexString()).toBe('ffffff'); // the texture carries the colour
    }
    const stained = built.group.children[1];
    expect(stained.children[0].geometry.attributes.position.array[0]).toBe(10); // converted to the plan
    expect(stained.children[1].material.color.getHexString()).not.toBe(built.group.children[0].children[1].material.color.getHexString());
    expect(buildTerraces(null, anchor, () => 0)).toMatchObject({ count: 0, materials: [] });
  });

  it('takes the usual roughness for a covering that gives none', () => {
    setTerraceCatalog({ bare: { name: { en: 'Bare' }, draft: '#ffffff', surface: { color: '#808080' } } });
    const built = buildTerraces([{ pts: SQUARE, surface: 'bare' }], anchor, () => 0);
    expect(built.materials[0].roughness).toBe(0.9);
    expect(thicknessOf(normalizeTerrace({ surface: 'bare' }))).toBe(TERRACE_THICKNESS);
  });
});

describe('thumbnail of a covering', () => {
  it('is a square of its surface in a browser, nothing elsewhere', () => {
    expect(terraceThumb('slate-test')).toBeNull();
    setTerraceCatalog({ 'slate-test': { name: { en: 'Slate' }, draft: '#333333', surface: { color: '#44484c' } } });
    expect(terraceThumb('slate-test')).toBeNull(); // no canvas
    vi.stubGlobal('document', fakeDocument());
    expect(terraceThumb('slate-test')).toBe('data:image/png;canvas-0');
    expect(terraceThumb('nothing')).toBeNull();
  });
});
