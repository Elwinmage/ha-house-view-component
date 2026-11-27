import { describe, expect, it } from 'vitest';
import {
  GRID_RATIO,
  OPEN_PATTERNS,
  RAILS,
  RELIEF_RIM,
  STONE_CORNER,
  STONE_CORNER_STEPS,
  clipPolygon,
  drawableSurface,
  hashString,
  isHex,
  kindRegistry,
  noise,
  openLines,
  recolorSurface,
  rowUnits,
  shadeHex,
  stoneCells,
  stoneFace,
  stoneGrid,
  stoneOutline,
  stoneSites,
  surfaceKey,
  tileOf,
  unitColor,
} from '../src/surface-lib.js';

/** A source of chance that always gives the same share. */
const dice = (share) => () => share;
/** Seeded chance: the same stones every time. */
const seeded = (seed) => noise(hashString(seed));
const area = (polygon) =>
  Math.abs(
    polygon.reduce((sum, [x, y], i) => sum + x * polygon[(i + 1) % polygon.length][1] - polygon[(i + 1) % polygon.length][0] * y, 0) / 2,
  );

describe('colours of a surface', () => {
  it('knows a colour written #rrggbb', () => {
    expect(isHex('#a07b4f')).toBe(true);
    expect(isHex('#A07B4F')).toBe(true);
    expect(isHex('#abc')).toBe(false);
    expect(isHex('red')).toBe(false);
    expect(isHex(null)).toBe(false);
  });

  it('lightens and darkens a colour, and leaves a broken one alone', () => {
    expect(shadeHex('#808080', 1.5)).toBe('#c0c0c0');
    expect(shadeHex('#808080', 0.5)).toBe('#404040');
    expect(shadeHex('#ffffff', 2)).toBe('#ffffff');
    expect(shadeHex('#zzzzzz', 1.2)).toBe('#zzzzzz');
  });

  it('tells a surface it can paint: an object with a base colour', () => {
    expect(drawableSurface({ color: '#112233' })).toBe(true);
    expect(drawableSurface({ color: 'blue' })).toBe(false);
    expect(drawableSurface({})).toBe(false);
    expect(drawableSurface(null)).toBe(false);
    expect(drawableSurface('#112233')).toBe(false);
  });

  it('reads the size of a tile, two meters when the surface gives none', () => {
    expect(tileOf({ tile: 2.4 })).toBe(2.4);
    expect(tileOf({ tile: 0 })).toBe(2);
    expect(tileOf(null, 3)).toBe(3);
  });
});

describe('a surface in a colour of the user', () => {
  const DECK = {
    color: '#804020',
    roughness: 0.8,
    speckles: [{ color: '#402010', size: 0.01, amount: 0.1 }, { color: 'none' }],
    joints: { color: '#201008', cell: [0.15, 2.4] },
  };

  it('replaces the base colour and keeps the contrast of every grain', () => {
    const S = recolorSurface(DECK, '#FFFFFF');
    expect(S.color).toBe('#ffffff');
    // the grain was half as light as the base on every channel: it still is
    expect(S.speckles[0].color).toBe('#808080');
    expect(S.speckles[0].size).toBe(0.01);
    expect(S.speckles[1].color).toBe('none'); // a colour that cannot be read is left as it is
    expect(S.joints).toBe(DECK.joints); // mortar and shadows keep their colour
    expect(S.roughness).toBe(0.8);
    expect(DECK.color).toBe('#804020'); // the entry of the catalog is not touched
  });

  it('shifts a grain by as much as the base when a channel of the base is nil', () => {
    const S = recolorSurface({ color: '#000000', speckles: [{ color: '#101010' }] }, '#404040');
    expect(S.speckles[0].color).toBe('#505050');
  });

  it('gives the surface back when there is nothing to change', () => {
    expect(recolorSurface(DECK, '#804020')).toBe(DECK);
    expect(recolorSurface(DECK, '#804020'.toUpperCase())).toBe(DECK);
    expect(recolorSurface(DECK, 'red')).toBe(DECK);
    expect(recolorSurface(DECK, '')).toBe(DECK);
    expect(recolorSurface(null, '#ffffff')).toBeNull();
    expect(recolorSurface({ color: '#804020' }, '#ffffff')).toEqual({ color: '#ffffff' });
  });

  it('keeps the stones of another tint as far from the others as they were', () => {
    const WALL = { color: '#804020', joints: { color: '#201008', cell: [0.2, 0.3], tints: [{ color: '#402010', amount: 0.2 }] } };
    const S = recolorSurface(WALL, '#ffffff');
    expect(S.joints.tints).toEqual([{ color: '#808080', amount: 0.2 }]);
    expect(S.joints.color).toBe('#201008'); // the joints keep their colour
    expect(S.joints.cell).toBe(WALL.joints.cell);
    expect(WALL.joints.tints[0].color).toBe('#402010'); // the entry of the catalog is not touched
  });

  it('is kept under a key that changes with its look', () => {
    expect(surfaceKey(DECK)).toBe(surfaceKey({ ...DECK }));
    expect(surfaceKey(recolorSurface(DECK, '#ffffff'))).not.toBe(surfaceKey(DECK));
  });
});

describe('seeded noise', () => {
  it('gives the same numbers for the same text, between 0 and 1', () => {
    const a = noise(hashString('terrace:wood-decking'));
    const b = noise(hashString('terrace:wood-decking'));
    const c = noise(hashString('terrace:slate-tiles'));
    const first = [a(), a(), a(), a()];
    expect([b(), b(), b(), b()]).toEqual(first);
    expect([c(), c(), c(), c()]).not.toEqual(first);
    for (const v of first) expect(v).toBeGreaterThanOrEqual(0) && expect(v).toBeLessThan(1);
    expect(hashString('')).toBe(2166136261);
  });
});

describe('units of a row', () => {
  const total = (units) => units.reduce((sum, [, length]) => sum + length, 0);

  it('lays units of one length from before the row to its end', () => {
    const row = rowUnits(256, 64, 0, 0, () => 0.5);
    expect(row.map(([x]) => x)).toEqual([-64, 0, 64, 128, 192]);
    for (const [, length] of row) expect(length).toBe(64);
    // a staggered row is set off by half a unit
    expect(rowUnits(256, 64, 32, 0, () => 0.5).map(([x]) => x)).toEqual([-32, 32, 96, 160, 224]);
  });

  it('fits uneven units to the row and lays them twice, so that the tiles join up', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const row = rowUnits(256, 64, 32, 0.5, rand);
    expect(row).toHaveLength(8);
    const once = row.slice(0, 4);
    expect(total(once)).toBeCloseTo(256, 6);
    expect(new Set(once.map(([, length]) => Math.round(length))).size).toBeGreaterThan(1);
    // the second laying is the first one a whole row further on
    row.slice(4).forEach(([x, length], i) => {
      expect(x).toBeCloseTo(once[i][0] + 256, 6);
      expect(length).toBeCloseTo(once[i][1], 6);
    });
    expect(row[0][0]).toBe(-32);
  });

  it('lays nothing without a size', () => {
    expect(rowUnits(256, 0, 0, 0, Math.random)).toEqual([]);
    expect(rowUnits(0, 64, 0, 0, Math.random)).toEqual([]);
  });
});

describe('colour of a unit', () => {
  const tints = [
    { color: '#ff0000', amount: 0.25 },
    { color: '#0000ff', amount: 0.25 },
  ];

  it('is a tint for its share of the units, else the base colour', () => {
    expect(unitColor('#102030', tints, dice(0.1))).toBe('#ff0000');
    expect(unitColor('#102030', tints, dice(0.4))).toBe('#0000ff');
    expect(unitColor('#102030', tints, dice(0.6))).toBe('#102030');
  });

  it('throws no dice without tints, and leaves out what it cannot read', () => {
    const never = () => {
      throw new Error('no dice');
    };
    expect(unitColor('#102030', undefined, never)).toBe('#102030');
    expect(unitColor('#102030', [], never)).toBe('#102030');
    expect(unitColor('#102030', [{ color: 'red', amount: 0.5 }], dice(0.1))).toBe('#102030');
    expect(unitColor('#102030', [{ color: '#ff0000', amount: -1 }, tints[1]], dice(0.1))).toBe('#0000ff');
  });
});

describe('irregular stones', () => {
  const SQUARE = [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40],
  ];

  it('sets their middles one to a square, every other row half a square on', () => {
    const even = stoneSites(4, 2, 0, dice(0.5));
    expect(even.slice(0, 4)).toEqual([
      [0.125, 0.25],
      [0.375, 0.25],
      [0.625, 0.25],
      [0.875, 0.25],
    ]);
    expect(even.slice(4)).toEqual([
      [0.25, 0.75],
      [0.5, 0.75],
      [0.75, 0.75],
      [0, 0.75], // pushed over the edge, it comes back on the left
    ]);
  });

  it('moves them about and leaves some out, the more so as they are uneven', () => {
    const moved = stoneSites(4, 2, 0.8, dice(0.999));
    expect(moved[0][0]).toBeCloseTo(0.125 + (0.4 * 0.998) / 4, 9);
    expect(moved[0][1]).toBeCloseTo(0.25 + (0.4 * 0.998) / 2, 9);
    const rand = seeded('stones');
    expect(stoneSites(20, 20, 0.8, rand).length).toBeLessThan(360);
    expect(stoneSites(20, 20, 0, rand)).toHaveLength(400);
    for (const [x, y] of stoneSites(6, 6, 0.8, rand)) expect(x >= 0 && x < 1 && y >= 0 && y < 1).toBe(true);
    expect(stoneSites(3, 2, 0.8, dice(0))).toEqual([[0.5, 0.5]]); // never an empty wall
  });

  it('counts the stones of a sheet, in an even number of rows', () => {
    expect(stoneGrid(256, 256, 32, 21)).toEqual([8, 12]);
    expect(stoneGrid(256, 256, 32, 23)).toEqual([8, 12]); // eleven rows would not wrap around
    expect(stoneGrid(256, 256, 900, 900)).toEqual([1, 2]);
  });

  it('cuts a polygon along a line', () => {
    expect(clipPolygon(SQUARE, 1, 0, 10)).toEqual([
      [0, 0],
      [10, 0],
      [10, 40],
      [0, 40],
    ]);
    expect(clipPolygon(SQUARE, 1, 0, 90)).toEqual(SQUARE);
    expect(clipPolygon(SQUARE, 1, 0, -1)).toEqual([]);
    // a line through two corners keeps them, and adds none
    expect(clipPolygon(SQUARE, 1, -1, 0)).toEqual([
      [0, 0],
      [40, 40],
      [0, 40],
    ]);
  });

  it('shares the whole surface between the stones, less their joints', () => {
    const sites = stoneSites(5, 4, 0.8, seeded('cells'));
    const cells = stoneCells(sites, 100, 80, 0);
    expect(cells).toHaveLength(sites.length);
    expect(cells.reduce((sum, cell) => sum + area(cell.corners), 0)).toBeCloseTo(8000, 6);
    const sizes = cells.map((cell) => area(cell.corners)).sort((a, b) => a - b);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(2 * sizes[0]); // small stones wedged between large blocks
    for (const { middle, corners } of cells) {
      expect(Math.min(...corners.map(([x]) => x))).toBeLessThan(middle[0]);
      expect(Math.max(...corners.map(([x]) => x))).toBeGreaterThan(middle[0]);
    }
    // with joints each stone is that much smaller, and a joint too wide leaves none
    const jointed = stoneCells(sites, 100, 80, 4);
    expect(jointed).toHaveLength(sites.length);
    expect(jointed.reduce((sum, cell) => sum + area(cell.corners), 0)).toBeLessThan(0.9 * 8000);
    expect(stoneCells(sites, 100, 80, 500)).toEqual([]);
    // a single stone is cut by itself, a whole surface away on every side
    const [alone] = stoneCells([[0.5, 0.5]], 100, 80, 0);
    expect(alone.middle).toEqual([50, 40]);
    expect(area(alone.corners)).toBeCloseTo(8000, 6);
  });

  it('pulls the corners of a stone in and rounds them', () => {
    const sharp = stoneOutline(SQUARE, [20, 20], 0, dice(0.5));
    expect(sharp).toHaveLength(4 * (STONE_CORNER_STEPS + 1));
    // each corner is cut off: the outline leaves a side and joins the next one a little way along
    const cut = 40 * STONE_CORNER;
    expect(sharp[0][0]).toBeCloseTo(0, 9);
    expect(sharp[0][1]).toBeCloseTo(cut, 9);
    expect(sharp[STONE_CORNER_STEPS][0]).toBeCloseTo(cut, 9);
    expect(sharp[STONE_CORNER_STEPS][1]).toBeCloseTo(0, 9);
    expect(area(sharp)).toBeGreaterThan(0.9 * 1600);
    expect(area(sharp)).toBeLessThan(1600);
    // the more uneven, the more each corner is pulled towards the middle
    const rough = stoneOutline(SQUARE, [20, 20], 0.8, dice(1));
    expect(area(rough)).toBeLessThan(0.85 * area(sharp));
    for (const [x, y] of rough) expect(x > 0 && x < 40 && y > 0 && y < 40).toBe(true);
  });

  it('drops a side too short to show, but keeps three sides', () => {
    const corners = 4 * (STONE_CORNER_STEPS + 1);
    const nicked = [[0, 0], [40, 0], [40, 1], [40, 40], [0, 40]]; // prettier-ignore
    expect(stoneOutline(nicked, [20, 20], 0, dice(0.5))).toHaveLength(corners);
    const closing = [[0, 1], [40, 0], [40, 40], [0, 40], [0, 0]]; // prettier-ignore
    expect(stoneOutline(closing, [20, 20], 0, dice(0.5))).toHaveLength(corners);
    const sliver = [[0, 0], [40, 0], [20, 30], [0, 1]]; // prettier-ignore
    expect(stoneOutline(sliver, [20, 10], 0, dice(0.5))).toHaveLength(3 * (STONE_CORNER_STEPS + 1));
  });

  it('sets the lit face of a stone up and left in its rim', () => {
    const face = stoneFace(SQUARE, [20, 20], 1);
    expect(area(face)).toBeCloseTo(1600 * (1 - RELIEF_RIM) ** 2, 6);
    const [left, top] = face[0];
    const [right, bottom] = face[2];
    // the rim left in shade is wider below and on the right
    expect(left).toBeGreaterThan(0);
    expect(40 - right).toBeGreaterThan(left);
    expect(40 - bottom).toBeGreaterThan(top);
    expect(stoneFace(SQUARE, [20, 20], 0)).toEqual(SQUARE);
    // a stone without any room around its middle keeps its face on it
    expect(stoneFace([[5, 5], [5, 5]], [5, 5], 1)).toEqual([[5, 5], [5, 5]]); // prettier-ignore
  });
});

describe('wires of a see-through fence', () => {
  it('crosses the wires of a mesh, leaning both ways', () => {
    const lines = openLines({ pattern: 'mesh', pitch: 0.05, fill: 0.2 }, 100, 50, 100);
    expect(lines.length % 2).toBe(0);
    const [down, up] = lines;
    expect(down.x1 - down.x0).toBe(50); // at 45 degrees over the height
    expect(up.x1 - up.x0).toBe(-50);
    expect(down.w).toBeCloseTo(0.5, 6); // two sets of wires: each one half as wide
    // a wire crosses a level line every pitch times the root of two
    expect(lines[2].x0 - lines[0].x0).toBeCloseTo(5 * Math.SQRT2, 6);
  });

  it('welds a panel: upright wires, and level ones four times further apart', () => {
    const lines = openLines({ pattern: 'grid', pitch: 0.05, fill: 0.2 }, 100, 60, 100);
    const upright = lines.filter((l) => l.x0 === l.x1);
    const level = lines.filter((l) => l.y0 === l.y1);
    expect(upright).toHaveLength(21);
    expect(level.map((l) => l.y0)).toEqual([60, 40, 20, 0]);
    expect(level[0].y0 - level[1].y0).toBe(5 * GRID_RATIO);
    expect(upright[0].w).toBeCloseTo(0.5, 6);
  });

  it('stands bars between two rails', () => {
    const lines = openLines({ pattern: 'bars', pitch: 0.1, fill: 0.3 }, 100, 80, 100);
    const bars = lines.filter((l) => l.x0 === l.x1);
    const rails = lines.filter((l) => l.y0 === l.y1);
    expect(bars.map((l) => l.x0)).toEqual([5, 15, 25, 35, 45, 55, 65, 75, 85, 95]);
    expect(rails.map((l) => l.y0)).toEqual(RAILS.map((share) => 80 * share));
    expect(bars[0].w).toBeCloseTo(3, 6);
  });

  it('takes the usual pitch and share when the kind gives none', () => {
    const lines = openLines({ pattern: 'bars' }, 100, 80, 100);
    expect(lines.filter((l) => l.x0 === l.x1)).toHaveLength(10);
    expect(lines[0].w).toBeCloseTo(3.5, 6);
    expect(OPEN_PATTERNS).toEqual(['mesh', 'grid', 'bars']);
  });
});

describe('a family of kinds', () => {
  const BUILTIN = { plain: { draft: '#111111' }, stone: { draft: '#222222' } };

  it('offers its own kinds, then the entries of the catalog over them', () => {
    const kinds = kindRegistry(BUILTIN, (entry) => (entry.draft ? entry : null));
    const all = kinds.all();
    expect(Object.keys(all)).toEqual(['plain', 'stone']);
    expect(kinds.get('stone')).toBe(BUILTIN.stone);
    expect(kinds.get('brick')).toBeNull();
    expect(kinds.name('stone')).toBe('');

    kinds.set(
      {
        stone: { name: { en: 'Cut stone', fr: 'Pierre de taille' }, draft: '#333333' },
        brick: { name: { en: 'Brick' }, draft: '#444444' },
        broken: { name: { en: 'Broken' } },
      },
      'fr',
    );
    expect(kinds.all()).toBe(all); // the same object all along
    expect(Object.keys(all).sort()).toEqual(['brick', 'plain', 'stone']);
    expect(kinds.get('stone').draft).toBe('#333333');
    expect(kinds.name('stone')).toBe('Pierre de taille');
    expect(kinds.name('brick')).toBe('Brick'); // English when the language is missing
    expect(kinds.name('plain')).toBe(''); // the card translates its own
    expect(kinds.get('broken')).toBeNull(); // what cannot be drawn is left out

    kinds.set();
    expect(Object.keys(all)).toEqual(['plain', 'stone']);
    expect(kinds.get('stone')).toBe(BUILTIN.stone);
    expect(kinds.name('stone')).toBe('');
    kinds.set(null);
    expect(Object.keys(all)).toEqual(['plain', 'stone']);
  });

  it('takes the entries as they are when nothing reads them', () => {
    const kinds = kindRegistry({});
    kinds.set({ a: { name: { en: 'A' } } });
    expect(kinds.get('a')).toEqual({ name: { en: 'A' } });
  });
});
