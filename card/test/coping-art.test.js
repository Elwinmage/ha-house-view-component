import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BUILTIN_COPINGS,
  COPING_NONE,
  copingKind,
  copingKindName,
  copingKinds,
  copingSizes,
  drawableCoping,
  setCopingCatalog,
  wallCoping,
} from '../src/coping-art.js';
import { BUILTIN_WALLS, setWallCatalog } from '../src/wall-art.js';
import { WALL_T, compileOps } from '../src/engine/terrain-edit.js';
import { buildWalls, copingThumb, wallFaces } from '../src/walls.js';
import { fakeDocument } from './fake-canvas.js';

// the built-in snapshot of the catalog: what the integration serves before the first download
const ITEMS = new URL('../../custom_components/house_view/catalog_builtin_copings/items/', import.meta.url);
const CATALOG = Object.fromEntries(
  readdirSync(ITEMS).map((id) => [id, JSON.parse(readFileSync(new URL(`${id}/coping.json`, ITEMS), 'utf8'))]),
);

const same = (x, z) => [x, z];
const scene = (alt) => alt - 100; // altitude 100 m is the floor of the scene
const OP = { type: 'wall', pts: [[0, 0], [10, 0]], hi: 102, lo: 100, side: 1, flat: 1, feather: 1 }; // prettier-ignore
const walls = (ops) => compileOps(ops, same, scene).walls;
const ys = (pos) => pos.filter((_, i) => i % 3 === 1);

afterEach(() => {
  setCopingCatalog({});
  setWallCatalog({});
  vi.unstubAllGlobals();
});

describe('copings of a wall', () => {
  it('ships with stone slabs, bricks on edge and a folded sheet, under the ids of the catalog', () => {
    expect(Object.keys(BUILTIN_COPINGS)).toEqual(['flat-stone', 'brick', 'aluminium']);
    for (const [id, kind] of Object.entries(BUILTIN_COPINGS)) {
      expect(drawableCoping(kind), id).toBe(true);
      // the entry that replaces it once read is the same coping
      expect(CATALOG[id], id).toBeTruthy();
      expect(CATALOG[id].surface.color, id).toBe(kind.surface.color);
      expect(copingSizes(CATALOG[id]), id).toEqual(copingSizes(kind));
    }
    expect(copingKind('brick')).toBe(BUILTIN_COPINGS.brick);
    expect(copingKind('nothing')).toBeNull();
    expect(copingKindName('brick')).toBe(''); // named by the catalog, once read
  });

  it('draws every entry of the catalog, one unit across the wall', () => {
    setCopingCatalog(CATALOG, 'fr');
    expect(Object.keys(copingKinds()).sort()).toEqual(Object.keys(CATALOG).sort());
    for (const [id, entry] of Object.entries(CATALOG)) {
      expect(copingKind(id), id).toBe(entry);
      expect(copingKindName(id), id).toBe(entry.name.fr);
      const { overhang } = copingSizes(entry);
      const joints = entry.surface.joints;
      // a row at least as deep as the coping is wide: no joint running along the wall
      if (joints) expect(joints.cell[0], id).toBeGreaterThanOrEqual(WALL_T + 2 * overhang);
    }
  });

  it('takes the entries of the catalog over its own, and leaves out what it cannot draw', () => {
    setCopingCatalog({
      brick: { name: { en: 'Yellow brick' }, surface: { color: '#d8c27a' }, height: 0.1 },
      broken: { name: { en: 'Broken' }, surface: {} },
    });
    expect(copingKind('brick').surface.color).toBe('#d8c27a');
    expect(copingKindName('brick')).toBe('Yellow brick');
    expect(copingKind('broken')).toBeNull();
    expect(copingKind('aluminium')).toBe(BUILTIN_COPINGS.aluminium);
  });

  it('keeps the sizes of a coping within bounds, with the usual ones by default', () => {
    expect(copingSizes({})).toEqual({ height: 0.05, overhang: 0.03, drop: 0 });
    expect(copingSizes(null)).toEqual({ height: 0.05, overhang: 0.03, drop: 0 });
    expect(copingSizes({ height: 2, overhang: -1, drop: 0.5 })).toEqual({ height: 0.3, overhang: 0, drop: 0.2 });
    expect(copingSizes(BUILTIN_COPINGS.aluminium)).toEqual({ height: 0.015, overhang: 0.025, drop: 0.05 });
  });
});

describe('what caps a wall', () => {
  const render = BUILTIN_WALLS.render; // a facing with a capping of its own
  const masonry = BUILTIN_WALLS.masonry; // a facing without one

  it('is the capping of its facing when the wall asks for nothing', () => {
    expect(wallCoping({}, render)).toEqual({ id: '', surface: null, color: '#c9c2b4', height: 0.05, overhang: 0.03, drop: 0 });
    expect(wallCoping({}, masonry)).toBeNull();
    expect(wallCoping(null, masonry)).toBeNull();
    // in the colour of the user, when there is one
    expect(wallCoping({ capc: '#AA3322' }, render).color).toBe('#aa3322');
    expect(wallCoping({ capc: 'red' }, render).color).toBe('#c9c2b4');
    expect(wallCoping({ capc: '#aa3322' }, masonry)).toBeNull();
  });

  it('is the coping the wall asks for, whatever its facing', () => {
    const brick = wallCoping({ cap: 'brick' }, masonry);
    expect(brick).toEqual({ id: 'brick', surface: BUILTIN_COPINGS.brick.surface, color: '#a5553c', height: 0.07, overhang: 0.01, drop: 0 });
    expect(wallCoping({ cap: 'aluminium' }, render)).toMatchObject({ id: 'aluminium', drop: 0.05, color: '#4f5459' });
    // a colour of the user's own stains its surface, joints included
    const stained = wallCoping({ cap: 'brick', capc: '#335577' }, masonry);
    expect(stained.color).toBe('#335577');
    expect(stained.surface.color).toBe('#335577');
    expect(stained.surface.joints.cell).toEqual([0.6, 0.075]);
    expect(BUILTIN_COPINGS.brick.surface.color).toBe('#a5553c'); // the coping itself is left alone
  });

  it('is nothing for a wall asked to stay bare, and the capping of the facing for a coping not known yet', () => {
    expect(wallCoping({ cap: COPING_NONE }, render)).toBeNull();
    expect(wallCoping({ cap: 'zinc' }, render)).toMatchObject({ id: '', color: '#c9c2b4' }); // the catalog not read
    expect(wallCoping({ cap: 'zinc' }, masonry)).toBeNull();
    setCopingCatalog(CATALOG);
    expect(wallCoping({ cap: 'zinc' }, masonry)).toMatchObject({ id: 'zinc', drop: 0.04 });
  });
});

describe('a coping laid on a wall', () => {
  it('comes down over the faces by its drop, and takes its texture from one of its edges', () => {
    const w = walls([OP])[0];
    const cap = wallCoping({ cap: 'aluminium' }, null);
    const { pos, uv } = wallFaces(w, 2, cap);
    expect(Math.min(...ys(pos))).toBeCloseTo(2 - 0.05, 9);
    expect(Math.max(...ys(pos))).toBeCloseTo(2 + 0.015, 9);
    expect(Math.max(...pos.filter((_, i) => i % 3 === 2))).toBeCloseTo(WALL_T / 2 + 0.025, 9);
    expect(uv).toHaveLength((pos.length / 3) * 2);
    // across the top the texture runs from 0 to the width of the coping, in tiles: never across a row boundary
    const vs = uv.filter((_, i) => i % 2 === 1);
    expect(Math.min(...vs)).toBe(0);
    expect(Math.max(...vs)).toBeCloseTo((WALL_T + 2 * 0.025) / 2, 9);
    // along the wall it follows the run, as the masonry does
    const us = uv.filter((_, i) => i % 2 === 0);
    expect(Math.max(...us)).toBeCloseTo((10 + WALL_T / 2 + 0.025) / 2, 9);
  });

  it('builds one mesh per coping and colour, after the masonry', () => {
    const group = buildWalls(
      walls([
        { ...OP, cap: 'brick' },
        { ...OP, kind: 'render' }, // the capping of its facing
        { ...OP, kind: 'render', cap: COPING_NONE },
        { ...OP, kind: 'render', cap: 'brick' },
        { ...OP, cap: 'brick', capc: '#335577' },
        { ...OP, kind: 'render', capc: '#101010' },
      ]),
    );
    const colours = group.children.map((m) => m.material.color.getHexString());
    // two facings, then: the bricks, the capping of the render, the stained bricks, the stained capping
    expect(colours).toEqual(['a39a8b', 'e3d9c6', 'a5553c', 'c9c2b4', '335577', '101010']);
    const [, , brick, plain, stained] = group.children;
    expect(brick.geometry.attributes.position.count).toBe(2 * 30); // two walls capped with bricks
    expect(brick.geometry.attributes.uv.count).toBe(2 * 30);
    expect(brick.material.roughness).toBe(0.9);
    expect(plain.geometry.attributes.position.count).toBe(30);
    expect(plain.geometry.attributes.uv).toBeUndefined();
    expect(stained.geometry.attributes.uv.count).toBe(30);
    expect(brick.castShadow && brick.receiveShadow).toBe(true);
    // a coping without a roughness of its own takes the usual one
    setCopingCatalog({ smooth: { name: { en: 'Smooth' }, surface: { color: '#dddddd' } } });
    const smooth = buildWalls(walls([{ ...OP, cap: 'smooth' }])).children[1];
    expect(smooth.material.roughness).toBe(0.9);
  });

  it('is painted in a browser, for the wall and for the picker', () => {
    expect(copingThumb('brick')).toBeNull(); // no canvas
    expect(copingThumb('nothing')).toBeNull();
    vi.stubGlobal('document', fakeDocument());
    expect(copingThumb('brick')).toMatch(/^data:image\/png;canvas-\d+$/);
    const [, cap] = buildWalls(walls([{ ...OP, cap: 'brick' }])).children;
    expect(cap.material.map).toBeTruthy();
    expect(cap.material.color.getHexString()).toBe('ffffff'); // the texture carries the colour
  });
});
