import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  BUILTIN_FENCES,
  CAP_THICK,
  FENCE_H,
  NO_FENCE,
  POST_SIZE,
  POST_SPACING,
  fenceBounds,
  fenceGroups,
  fenceKind,
  fenceKindName,
  fenceKinds,
  readFence,
  setFenceCatalog,
} from '../src/fence-art.js';

// the built-in snapshot of the catalog: what the integration serves before the first download
const ITEMS = new URL('../../custom_components/house_view/catalog_builtin_fences/items/', import.meta.url);
const CATALOG = Object.fromEntries(
  readdirSync(ITEMS).map((id) => [id, JSON.parse(readFileSync(new URL(`${id}/fence.json`, ITEMS), 'utf8'))]),
);

const ENTRY = {
  name: { en: 'Larch boards', fr: 'Planches de mélèze' },
  draft: '#ff9f1a',
  height: { default: 1.8, min: 1, max: 2.5 },
  thickness: 0.04,
  surface: { color: '#8a6a48', roughness: 0.85, grain: 0.2, joints: { color: '#4a3826', cell: [1.8, 0.14] } },
  posts: { color: '#5a4330', spacing: 2, size: 0.09 },
};

afterEach(() => setFenceCatalog({}));

describe('kinds of fence', () => {
  it('ships with the fences the card drew before the catalog, each with its own colour in the editor', () => {
    expect(Object.keys(BUILTIN_FENCES)).toContain('mesh');
    expect(BUILTIN_FENCES[NO_FENCE]).toMatchObject({ h: 0, color: null });
    const drafts = Object.values(BUILTIN_FENCES).map((kind) => kind.draft);
    expect(new Set(drafts).size).toBe(drafts.length);
    expect(fenceKind('wood')).toBe(BUILTIN_FENCES.wood);
    expect(fenceKind('nothing')).toBeNull();
    expect(fenceKindName('wood')).toBe('');
  });

  it('finds every one of its own kinds in the catalog, with the same colour in the editor', () => {
    for (const [id, kind] of Object.entries(BUILTIN_FENCES)) {
      if (id === NO_FENCE) continue;
      expect(CATALOG[id], id).toBeTruthy();
      // a side keeps its colour in the overlay when the catalog is read, and its height
      expect(CATALOG[id].draft, id).toBe(kind.draft);
      expect(CATALOG[id].height.default, id).toBe(kind.h);
      expect(!!CATALOG[id].foliage, id).toBe(!!kind.bumpy);
    }
    expect(CATALOG[NO_FENCE]).toBeUndefined();
  });

  it('draws every entry of the catalog, told apart by its colour in the editor', () => {
    setFenceCatalog(CATALOG, 'fr');
    const kinds = fenceKinds();
    expect(Object.keys(kinds).sort()).toEqual([...Object.keys(CATALOG), NO_FENCE].sort());
    const drafts = Object.values(kinds).map((kind) => kind.draft);
    expect(new Set(drafts).size).toBe(drafts.length);
    for (const id of Object.keys(CATALOG)) {
      expect(kinds[id], id).toMatchObject({ h: CATALOG[id].height.default, color: CATALOG[id].surface.color });
      expect(fenceKindName(id), id).toBe(CATALOG[id].name.fr);
      const [low, high] = fenceBounds(kinds[id]);
      expect(low, id).toBeLessThanOrEqual(kinds[id].h);
      expect(high, id).toBeGreaterThanOrEqual(kinds[id].h);
    }
    expect(kinds[NO_FENCE]).toBe(BUILTIN_FENCES[NO_FENCE]); // the side left open is always there
    setFenceCatalog({});
    expect(fenceKind('picket')).toBeNull();
    expect(fenceKind('mesh')).toBe(BUILTIN_FENCES.mesh);
  });
});

describe('reading a fence of the catalog', () => {
  it('reads a solid fence with its painted surface and its posts', () => {
    expect(readFence(ENTRY, 'larch')).toEqual({
      h: 1.8,
      hMin: 1,
      hMax: 2.5,
      color: '#8a6a48',
      draft: '#ff9f1a',
      thick: 0.04,
      surface: ENTRY.surface,
      posts: '#5a4330',
      postSpacing: 2,
      postSize: 0.09,
    });
  });

  it('fills in what an entry leaves out', () => {
    const bare = readFence(
      { draft: '#ffffff', height: { default: 5 }, surface: { color: '#808080' }, posts: { color: '#111111' } },
      'bare',
    );
    expect(bare).toEqual({
      h: 5,
      hMin: FENCE_H[0],
      hMax: 5, // never lower than its usual height
      color: '#808080',
      draft: '#ffffff',
      thick: 0, // a sheet
      posts: '#111111',
      postSpacing: POST_SPACING,
      postSize: POST_SIZE,
    });
    expect(bare.surface).toBeUndefined(); // nothing to paint: the plain colour
    expect(readFence({ ...ENTRY, height: { default: 1 } }, 'x').hMax).toBe(FENCE_H[1]);
    expect(readFence({ ...ENTRY, posts: { color: 'brown' } }, 'x').posts).toBeUndefined();
    expect(readFence({ ...ENTRY, surface: { color: '#808080', speckles: [{ color: '#000000' }] } }, 'x').surface).toBeTruthy();
    expect(readFence({ ...ENTRY, surface: { color: '#808080', speckles: [] } }, 'x').surface).toBeUndefined();
  });

  it('reads a see-through fence: wires in a plane, as dense as they cover', () => {
    const mesh = readFence({ ...ENTRY, open: { pattern: 'mesh', pitch: 0.05, fill: 0.3 } }, 'x');
    expect(mesh).toMatchObject({ open: { pattern: 'mesh', pitch: 0.05, fill: 0.3 }, opacity: 0.3, thick: 0 });
    expect(mesh.surface).toBeUndefined(); // its wires are another texture
    expect(readFence({ ...ENTRY, open: { pattern: 'bars' } }, 'x').open).toEqual({ pattern: 'bars', pitch: 0.1, fill: 0.35 });
    expect(readFence({ ...ENTRY, open: { pattern: 'mesh' }, foliage: true }, 'x').bumpy).toBeUndefined();
  });

  it('clips a hedge', () => {
    expect(readFence({ ...ENTRY, foliage: true, thickness: 0.7 }, 'x')).toMatchObject({ bumpy: true, thick: 0.7 });
  });

  it('lets a wall carry a coping: the entry says so, or it is one of the walls of before', () => {
    const wall = { ...ENTRY, thickness: 0.2, posts: undefined };
    expect(readFence({ ...wall, coping: true }, 'x').cap).toBe(true);
    expect(readFence(wall, 'x').cap).toBeUndefined();
    // the catalogs written before the field: the plain wall and the brick one
    expect(readFence(wall, 'wall').cap).toBe(true);
    expect(readFence(wall, 'wall_brick').cap).toBe(true);
    expect(readFence({ ...wall, coping: false }, 'wall').cap).toBeUndefined(); // the entry has the last word
    // nothing to lay a coping on: boards, wires, leaves
    expect(readFence({ ...ENTRY, coping: true }, 'x').cap).toBeUndefined();
    expect(readFence({ ...wall, coping: true, thickness: CAP_THICK }, 'x').cap).toBe(true);
    expect(readFence({ ...wall, coping: true, open: { pattern: 'mesh' } }, 'x').cap).toBeUndefined();
    expect(readFence({ ...wall, coping: true, foliage: true }, 'x').cap).toBeUndefined();
    // the wall the card ships with, and the two of the catalog
    expect(BUILTIN_FENCES.wall.cap).toBe(true);
    setFenceCatalog(CATALOG);
    const capped = Object.keys(fenceKinds()).filter((id) => fenceKind(id).cap);
    expect(capped.sort()).toEqual(['wall', 'wall_brick']);
  });

  it('leaves out what it cannot draw', () => {
    expect(readFence(null, 'x')).toBeNull();
    expect(readFence(ENTRY, NO_FENCE)).toBeNull(); // never replaced by an entry
    expect(readFence({ ...ENTRY, surface: { color: 'brown' } }, 'x')).toBeNull();
    expect(readFence({ ...ENTRY, draft: undefined }, 'x')).toBeNull();
    expect(readFence({ ...ENTRY, height: undefined }, 'x')).toBeNull();
    expect(readFence({ ...ENTRY, height: { default: 0 } }, 'x')).toBeNull();
    expect(readFence({ ...ENTRY, open: { pattern: 'hologram' } }, 'x')).toBeNull(); // a newer format
  });
});

describe('palette of the fences', () => {
  it('offers the heights of a kind, else the usual ones', () => {
    expect(fenceBounds({ hMin: 1, hMax: 2.5 })).toEqual([1, 2.5]);
    expect(fenceBounds(BUILTIN_FENCES.wood)).toEqual(FENCE_H);
    expect(fenceBounds(null)).toEqual(FENCE_H);
  });

  it('sorts the kinds into fences, hedges and the side left open', () => {
    const groups = fenceGroups();
    expect(groups.map(([family]) => family)).toEqual(['fence', 'hedge', 'open']);
    const [[, fences], [, hedges], [, open]] = groups;
    expect(open).toEqual([NO_FENCE]);
    expect(hedges.every((id) => id.startsWith('hedge'))).toBe(true);
    expect(fences).toContain('wall');
    expect(fences).not.toContain(NO_FENCE);
    expect(fences).toEqual([...fences].sort());
    expect(fences.length + hedges.length + 1).toBe(Object.keys(BUILTIN_FENCES).length);
    // sorted by the names shown, not by the ids
    const byName = fenceGroups((id) => (id === 'wood' ? 'aaa' : id === 'composite' ? 'zzz' : id));
    expect(byName[0][1][0]).toBe('wood');
    expect(byName[0][1].at(-1)).toBe('composite');
  });
});
