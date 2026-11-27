import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BUILTIN_WALLS,
  WALL_DEFAULT,
  copingOf,
  drawableWall,
  hasWallKind,
  setWallCatalog,
  wallKind,
  wallKindName,
  wallKinds,
} from '../src/wall-art.js';
import { buildWalls, wallFaces, wallPieces, wallShows, wallThumb } from '../src/walls.js';
import { WALL_T, compileOps, runsOf, wallEnds, wallLevels, wallSlopes } from '../src/engine/terrain-edit.js';
import { callsOf, fakeDocument } from './fake-canvas.js';

// the built-in snapshot of the catalog: what the integration serves before the first download
const ITEMS = new URL('../../custom_components/house_view/catalog_builtin_walls/items/', import.meta.url);
const CATALOG = Object.fromEntries(
  readdirSync(ITEMS).map((id) => [id, JSON.parse(readFileSync(new URL(`${id}/wall.json`, ITEMS), 'utf8'))]),
);

const same = (x, z) => [x, z];
const scene = (alt) => alt - 100; // altitude 100 m is the floor of the scene

const OP = {
  type: 'wall',
  pts: [
    [0, 0],
    [10, 0],
  ],
  hi: 102,
  lo: 100,
  side: 1,
  flat: 1,
  feather: 1,
};
const compiled = (op) => compileOps([op], same, scene).walls[0];
const ys = (pos) => pos.filter((_, i) => i % 3 === 1);

afterEach(() => {
  setWallCatalog({});
  vi.unstubAllGlobals();
});

describe('facings of a wall', () => {
  it('ships with the plain masonry of before, a render and a dry stone', () => {
    expect(Object.keys(BUILTIN_WALLS)).toEqual(['masonry', 'render', 'dry-stone']);
    for (const [id, kind] of Object.entries(BUILTIN_WALLS)) {
      expect(drawableWall(kind), id).toBe(true);
      if (id !== WALL_DEFAULT) expect(CATALOG[id], id).toBeTruthy(); // the entry that replaces it once read
    }
    expect(CATALOG[WALL_DEFAULT]).toBeUndefined(); // the walls of before keep their look, whatever the catalog says
    expect(wallKind('masonry').surface.color).toBe('#a39a8b');
    expect(wallKind('nothing')).toBe(BUILTIN_WALLS.masonry);
    expect(wallKind(undefined)).toBe(BUILTIN_WALLS.masonry);
    expect(hasWallKind('render')).toBe(true);
    expect(hasWallKind('nothing')).toBe(false);
  });

  it('draws every entry of the catalog', () => {
    setWallCatalog(CATALOG, 'fr');
    expect(Object.keys(wallKinds()).sort()).toEqual([...Object.keys(CATALOG), WALL_DEFAULT].sort());
    for (const id of Object.keys(CATALOG)) {
      expect(wallKind(id), id).toBe(CATALOG[id]);
      expect(wallKindName(id), id).toBe(CATALOG[id].name.fr);
    }
    expect(wallKindName(WALL_DEFAULT)).toBe('');
  });

  it('takes the entries of the catalog over its own, and leaves out what it cannot draw', () => {
    setWallCatalog({
      render: { name: { en: 'Lime render' }, draft: '#ffffff', surface: { color: '#eeeeee' } },
      broken: { name: { en: 'Broken' }, draft: '#ffffff', surface: {} },
    });
    expect(wallKind('render').surface.color).toBe('#eeeeee');
    expect(wallKindName('render')).toBe('Lime render');
    expect(hasWallKind('broken')).toBe(false);
    expect(wallKind('dry-stone')).toBe(BUILTIN_WALLS['dry-stone']);
  });

  it('caps a wall when its facing has a coping, with the usual sizes by default', () => {
    expect(copingOf(BUILTIN_WALLS.render)).toEqual({ color: '#c9c2b4', height: 0.05, overhang: 0.03 });
    expect(copingOf({ coping: { color: '#111111', height: 0.08, overhang: 0 } })).toEqual({ color: '#111111', height: 0.08, overhang: 0 });
    expect(copingOf({ coping: { color: '#111111' } })).toEqual({ color: '#111111', height: 0.05, overhang: 0.03 });
    expect(copingOf({ coping: { color: 'grey' } })).toBeNull();
    expect(copingOf(BUILTIN_WALLS.masonry)).toBeNull();
    expect(copingOf(null)).toBeNull();
  });
});

describe('a wall higher at one end than at the other', () => {
  it('takes the altitudes of its first point at its last one, unless they are given', () => {
    expect(wallEnds(OP)).toEqual({ hi: 102, lo: 100, hi2: 102, lo2: 100 });
    expect(wallEnds({ ...OP, hi2: 101, lo2: 99.5 })).toEqual({ hi: 102, lo: 100, hi2: 101, lo2: 99.5 });
    expect(wallEnds({ ...OP, hi2: null, lo2: 'x' })).toMatchObject({ hi2: 102, lo2: 100 });
    expect(wallSlopes(OP)).toBe(false);
    expect(wallSlopes({ ...OP, hi2: 102, lo2: 100 })).toBe(false);
    expect(wallSlopes({ ...OP, hi2: 101 })).toBe(true);
    expect(wallSlopes({ ...OP, lo2: 99 })).toBe(true);
  });

  it('measures the run of each point of its line', () => {
    expect(
      runsOf([
        [0, 0],
        [3, 4],
        [3, 10],
      ]),
    ).toEqual([0, 5, 11]);
    expect(runsOf([[1, 1]])).toEqual([0]);
  });

  it('compiles the heights of both ends and its length', () => {
    const level = compiled(OP);
    expect(level).toMatchObject({ hiY: 2, loY: 0, hi2Y: 2, lo2Y: 0, len: 10, cum: [0, 10] });
    const sloped = compiled({ ...OP, hi2: 101, lo2: 100.5 });
    expect(sloped).toMatchObject({ hiY: 2, loY: 0, hi2Y: 1, lo2Y: 0.5 });
    expect(wallLevels(sloped, 0)).toEqual([2, 0]);
    expect(wallLevels(sloped, 5)).toEqual([1.5, 0.25]);
    expect(wallLevels(sloped, 10)).toEqual([1, 0.5]);
    // past its ends it keeps the heights of the end
    expect(wallLevels(sloped, -3)).toEqual([2, 0]);
    expect(wallLevels(sloped, 30)).toEqual([1, 0.5]);
    expect(wallLevels({ ...sloped, len: 0 }, 5)).toEqual([2, 0]);
  });

  it('shapes the ground along the slope of its top and of its foot', () => {
    const { apply } = compileOps([{ ...OP, hi2: 101, lo2: 100.5 }], same, scene);
    const flat = () => 5;
    // side 1 is the high one: z > 0 here
    expect(apply(0, 0.5, 5, flat)).toBeCloseTo(2, 6);
    expect(apply(5, 0.5, 5, flat)).toBeCloseTo(1.5, 6);
    expect(apply(10, 0.5, 5, flat)).toBeCloseTo(1, 6);
    expect(apply(0, -0.5, 5, flat)).toBeCloseTo(0, 6);
    expect(apply(5, -0.5, 5, flat)).toBeCloseTo(0.25, 6);
    expect(apply(10, -0.5, 5, flat)).toBeCloseTo(0.5, 6);
    expect(apply(5, 9, 5, flat)).toBe(5); // too far: left alone
  });

  it('follows the slope from one point of a broken line to the next', () => {
    const bent = {
      ...OP,
      pts: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      hi2: 100,
      lo2: 100,
    };
    const { apply, walls } = compileOps([bent], same, scene);
    expect(walls[0].len).toBe(20);
    // 15 m along a wall of 20: three quarters of the way down
    expect(apply(9.5, 5, 5, () => 5)).toBeCloseTo(0.5, 6);
  });
});

describe('no ground climbing in front of a wall', () => {
  it('moves every corner of a cell the wall crosses to the face of the wall', () => {
    const slanted = {
      ...OP,
      pts: [
        [0, 0],
        [10, 6],
      ],
    };
    const { snap } = compileOps([slanted], same, scene);
    const off = WALL_T / 2 + 0.02;
    const dist = ([x, z]) => Math.abs(6 * x - 10 * z) / Math.hypot(6, 10);
    // a corner a little more than a cell away (but less than its diagonal) used to stay where it was
    const corner = [5, 3 + 1.25];
    expect(dist(corner)).toBeGreaterThan(1);
    expect(dist(snap(...corner, 1))).toBeCloseTo(off, 6);
    expect(dist(snap(5, 3 + 0.3, 1))).toBeCloseTo(off, 6);
    // further than a diagonal, past the ends of the wall, or right on the line: left where it is
    expect(snap(5, 3 + 1.8, 1)).toEqual([5, 3 + 1.8]);
    expect(snap(-1, -0.6, 1)).toEqual([-1, -0.6]);
    expect(snap(5, 3, 1)).toEqual([5, 3]);
  });
});

describe('the two sides of a wall', () => {
  it('tells a move that goes across the line of a wall', () => {
    const { crosses } = compileOps([{ ...OP, pts: [[0, 0], [10, 0], [10, 6]] }], same, scene); // prettier-ignore
    expect(crosses(5, -1, 5, 1)).toBe(true);
    expect(crosses(5, 1, 5, -1)).toBe(true);
    expect(crosses(9, 3, 11, 3)).toBe(true); // its second side
    expect(crosses(5, 1, 6, 2)).toBe(false); // on the same side
    expect(crosses(-3, -1, -3, 1)).toBe(false); // past its end
    expect(crosses(5, 1, 5, 1)).toBe(false); // no move at all
    // without a wall nothing is ever across
    expect(compileOps([], same, scene).crosses(5, -1, 5, 1)).toBe(false);
  });
});

describe('masonry of a wall', () => {
  it('builds a box along the line, from under its foot to its top', () => {
    const { pos, uv } = wallFaces(compiled(OP), 2);
    expect(pos).toHaveLength(5 * 6 * 3); // two faces, the top, two ends
    expect(uv).toHaveLength(5 * 6 * 2);
    expect(Math.max(...ys(pos))).toBe(2);
    expect(Math.min(...ys(pos))).toBe(-1); // buried a meter under the foot
    const xs = pos.filter((_, i) => i % 3 === 0);
    const zs = pos.filter((_, i) => i % 3 === 2);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-WALL_T / 2, 10 + WALL_T / 2]); // the corners are filled
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-WALL_T / 2, WALL_T / 2]);
    // texture: meters along the wall and up it, in tiles of 2 m, so a course of stones stays level
    expect(uv.slice(0, 2)).toEqual([-0.1, -0.5]);
    expect(uv.slice(2, 4)).toEqual([5.1, -0.5]);
    expect(uv.slice(4, 6)).toEqual([5.1, 1]);
  });

  it('slopes its top and its foot from one end to the other', () => {
    const w = compiled({ ...OP, hi2: 101, lo2: 100.5 });
    const { pos } = wallFaces(w, 2);
    // first face: foot then top at the first end, then at the last one
    expect(pos[1]).toBeCloseTo(0 - 1, 6);
    expect(pos[4]).toBeCloseTo(0.5 - 1, 6);
    expect(pos[7]).toBeCloseTo(1, 6);
    expect(pos[16]).toBeCloseTo(2, 6);
  });

  it('turns the corners of a broken line, and skips a segment too short to show', () => {
    const w = compiled({
      ...OP,
      pts: [
        [0, 0],
        [10, 0],
        [10, 0.01],
        [10, 5],
      ],
    });
    const { pos } = wallFaces(w, 2);
    expect(pos).toHaveLength(2 * 5 * 6 * 3);
  });

  it('lays a coping on top, wider than the wall', () => {
    const { pos, uv } = wallFaces(compiled(OP), 1, { height: 0.05, overhang: 0.03 });
    expect(uv).toEqual([]);
    expect([Math.min(...ys(pos)), Math.max(...ys(pos))]).toEqual([2, 2.05]);
    const zs = pos.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(WALL_T / 2 + 0.03, 9);
  });

  it('shows a wall that stands over its foot at one end at least', () => {
    expect(wallShows(compiled(OP))).toBe(true);
    expect(wallShows(compiled({ ...OP, hi: 100.02 }))).toBe(false);
    expect(wallShows(compiled({ ...OP, hi: 100, hi2: 101 }))).toBe(true);
  });
});

describe('3D walls', () => {
  const walls = (ops) => compileOps(ops, same, scene).walls;

  it('builds one mesh per facing and colour, and the copings', () => {
    const group = buildWalls(
      walls([
        OP, // plain masonry
        { ...OP, kind: 'masonry' },
        { ...OP, kind: 'render' },
        { ...OP, kind: 'render', c: '#aa3322' },
        { ...OP, kind: 'dry-stone' },
        { ...OP, kind: 'no-such-facing' }, // drawn as plain masonry
        { ...OP, hi: 100 }, // nothing to show
      ]),
    );
    expect(group.name).toBe('retaining-walls');
    const colours = group.children.map((m) => m.material.color.getHexString());
    expect(colours).toEqual(['a39a8b', 'e3d9c6', 'aa3322', '9c9382', 'c9c2b4']);
    for (const m of group.children) expect(m.name).toBe('retaining-wall');
    const [masonry, render, , , coping] = group.children;
    expect(masonry.geometry.attributes.position.count).toBe(3 * 30); // three walls in one mesh
    expect(render.geometry.attributes.uv.count).toBe(30);
    expect(coping.geometry.attributes.position.count).toBe(2 * 30); // the two rendered walls
    expect(coping.geometry.attributes.uv).toBeUndefined();
    expect(masonry.material.map).toBeNull(); // no canvas here: plain colours
    expect(masonry.material.roughness).toBe(0.95);
    expect(masonry.castShadow && masonry.receiveShadow).toBe(true);
  });

  it('builds nothing when no wall shows', () => {
    expect(buildWalls(walls([{ ...OP, hi: 100 }]))).toBeNull();
    expect(buildWalls([])).toBeNull();
    expect(buildWalls(null)).toBeNull();
  });

  it('paints the facings in a browser', () => {
    vi.stubGlobal('document', fakeDocument());
    setWallCatalog({ bare: { name: { en: 'Bare' }, draft: '#ffffff', surface: { color: '#808080' } } });
    const group = buildWalls(
      walls([
        { ...OP, kind: 'dry-stone' },
        { ...OP, kind: 'bare' },
      ]),
    );
    for (const m of group.children) {
      expect(m.material.map).not.toBeNull();
      expect(m.material.color.getHexString()).toBe('ffffff');
    }
    expect(group.children[1].material.roughness).toBe(0.95); // the usual one when the facing gives none
  });
});

describe('a wall cut where a flight of steps goes through it', () => {
  /** A flight 1 m wide across the wall, 4 m along it. */
  const GAP = [[4, -1.5], [5, -1.5], [5, 1.5], [4, 1.5]]; // prettier-ignore
  const half = WALL_T / 2;

  it('is left whole when nothing goes through it', () => {
    const w = compiled(OP);
    expect(wallPieces(w, [])).toEqual([w]);
    expect(wallPieces(w, null)[0]).toBe(w);
    const beside = [[4, 2], [5, 2], [5, 5], [4, 5]]; // prettier-ignore
    expect(wallPieces(w, [beside])[0]).toBe(w);
    const along = [
      [2, 0],
      [8, 0],
      [8, 0],
      [2, 0],
    ]; // prettier-ignore: flat, on the line itself
    expect(wallPieces(w, [along])[0]).toBe(w);
  });

  it('is cut in two, each piece keeping the heights of the wall where it stands', () => {
    const w = compiled({ ...OP, hi2: 101, lo2: 100.5 });
    const [before, after] = wallPieces(w, [GAP]);
    // the cut is half a thickness wider on each side: the masonry of a piece goes that far past its end
    expect(before.pts).toEqual([[0, 0], [4 - half, 0]]); // prettier-ignore
    expect(before.cum).toEqual([0, 4 - half]);
    expect(after.pts).toEqual([[5 + half, 0], [10, 0]]); // prettier-ignore
    expect(after.cum).toEqual([5 + half, 10]);
    expect(after).toMatchObject({ len: 10, hiY: 2, hi2Y: 1 });
    // the masonry stops at the sides of the flight
    const xs = (piece) => wallFaces(piece, 2).pos.filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs(before))).toBeCloseTo(4, 9);
    expect(Math.min(...xs(after))).toBeCloseTo(5, 9);
    // and the top of the second piece starts where the whole wall is at that point
    const tops = wallFaces(after, 2).pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...tops)).toBeCloseTo(2 - 0.5, 6);
  });

  it('loses an end, its middle or all of it', () => {
    const w = compiled(OP);
    const start = [[-1, -1], [2, -1], [2, 1], [-1, 1]]; // prettier-ignore
    expect(wallPieces(w, [start]).map((piece) => piece.cum)).toEqual([[2 + half, 10]]);
    const end = [[9, -1], [12, -1], [12, 1], [9, 1]]; // prettier-ignore
    expect(wallPieces(w, [end]).map((piece) => piece.cum)).toEqual([[0, 9 - half]]);
    const all = [[-1, -1], [11, -1], [11, 1], [-1, 1]]; // prettier-ignore
    expect(wallPieces(w, [all])).toEqual([]);
    // two flights side by side leave nothing between them worth building
    const next = [[5.3, -1], [6, -1], [6, 1], [5.3, 1]]; // prettier-ignore
    expect(wallPieces(w, [GAP, next]).map((piece) => piece.cum)).toEqual([
      [0, 4 - half],
      [6 + half, 10],
    ]);
    // and they may be given in any order
    expect(wallPieces(w, [next, GAP])).toHaveLength(2);
  });

  it('keeps the corners of a wall that turns', () => {
    // a corner drawn twice (two clicks at the same place) is no side of the wall
    const bent = compiled({ ...OP, pts: [[0, 0], [10, 0], [10, 0], [10, 6]] }); // prettier-ignore
    const flight = [[9, 2], [11, 2], [11, 3], [9, 3]]; // prettier-ignore
    const [before, after] = wallPieces(bent, [flight]);
    expect(before.pts.slice(0, 2)).toEqual([[0, 0], [10, 0]]); // prettier-ignore
    expect(before.pts.at(-1)[0]).toBe(10);
    expect(before.pts.at(-1)[1]).toBeCloseTo(2 - half, 9);
    expect(before.cum.at(-1)).toBeCloseTo(12 - half, 9);
    expect(after.pts[0][1]).toBeCloseTo(3 + half, 9);
    expect(after.pts.at(-1)).toEqual([10, 6]);
    expect(after.cum.at(-1)).toBe(16);
  });

  it('opens the masonry and its coping', () => {
    const group = buildWalls(compileOps([{ ...OP, kind: 'render' }], same, scene).walls, [GAP]);
    const [masonry, coping] = group.children;
    expect(masonry.geometry.attributes.position.count).toBe(2 * 30); // two boxes instead of one
    expect(coping.geometry.attributes.position.count).toBe(2 * 30);
    const xs = Array.from(masonry.geometry.attributes.position.array).filter((_, i) => i % 3 === 0);
    expect(xs.some((x) => x > 4.001 && x < 4.999)).toBe(false);
  });
});

describe('thumbnail of a facing', () => {
  it('shows two meters of wall under its coping, in a browser', () => {
    expect(wallThumb('render')).toBeNull(); // no canvas
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const url = wallThumb('render');
    expect(url).toMatch(/^data:image\/png;canvas-\d$/);
    expect(wallThumb('render')).toBe(url); // painted once
    const thumb = doc.canvases[doc.canvases.length - 1];
    expect(callsOf(thumb, 'createPattern')).toHaveLength(1);
    expect(callsOf(thumb, 'scale')[0]).toMatchObject({ x: 1, y: 1 }); // a tile of 2 m for 2 m of wall
    const [, cap, shade] = callsOf(thumb, 'fillRect');
    expect(cap).toMatchObject({ style: '#c9c2b4', x: 0, y: 0, w: 256 });
    expect(shade.y).toBe(cap.h);
    // no coping: the facing alone
    wallThumb('masonry');
    expect(callsOf(doc.canvases[doc.canvases.length - 1], 'fillRect')).toHaveLength(1);
    expect(wallThumb('nothing')).toBeNull();
  });
});
