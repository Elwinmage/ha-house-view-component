// The ground kept from one rebuild to the next (its signature), and the terrain saved with its corrections.
import { describe, it, expect } from 'vitest';
import { buildTerrain, correctedTerrain, syntheticTerrain, terrainSign } from '../src/engine/terrain.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // prettier-ignore
const sd = () => ({ levels: [{ elevation: 0, rooms: [{ poly: rect(0, 0, 6, 4) }], walls: [] }], site: {} });
const cfg = (more = {}) => ({ base: 0, rot: 0, dx: 0, dz: 0, ops: [], pools: [], terraces: [], paths: [], sea: null, ...more });

describe('what a ground is built from', () => {
  const t = syntheticTerrain([0, 0], 20, 1);
  const sign = (c = {}, s = sd(), doc = t, rev = 0) => terrainSign(doc, s, cfg(c), rev);

  it('is the same for the same terrain, registration, corrections and house', () => {
    expect(sign()).toBe(sign());
    // (a new scene object with the same house, as every rebuild makes one)
    expect(terrainSign(t, sd(), cfg())).toBe(terrainSign(t, sd(), cfg()));
    // what does not shape the ground: a path that is no flight of steps, the trees
    expect(sign({ paths: [{ id: 'p', pts: [[0, 0], [5, 0]], w: 2 }] })).toBe(sign()); // prettier-ignore
    expect(sign({ showTrees: false })).toBe(sign());
    expect(sign({ ops: undefined, pools: undefined, terraces: undefined, paths: undefined })).toBe(sign());
  });

  it('changes with everything the ground is made from', () => {
    const base = sign();
    const wall = { type: 'wall', pts: [[0, 8], [6, 8]], hi: 101, lo: 100, side: 1 }; // prettier-ignore
    for (const c of [
      { base: 0.5 },
      { rot: 10 },
      { dx: 1 },
      { dz: 1 },
      { showMns: true },
      { showVec: true },
      { showRoads: false },
      { ops: [wall] },
      { pools: [{ id: 'a', pts: rect(8, 8, 10, 10) }] },
      { terraces: [{ id: 't', pts: rect(8, 0, 10, 2), alt: 100 }] },
      { paths: [{ id: 's', stairs: true, pts: [[0, 6], [0, 9]], w: 1 }] }, // prettier-ignore
      { sea: { level: 99 } },
      { ortho: { texture: { uuid: 'a' }, bbox: [0, 0, 1, 1], lat: 1, lon: 2, north: 0 } },
    ])
      expect(sign(c)).not.toBe(base);
    // a correction moved by a centimetre, another photo
    expect(sign({ ops: [{ ...wall, hi: 101.01 }] })).not.toBe(sign({ ops: [wall] }));
    expect(sign({ ortho: { texture: { uuid: 'b' } } })).not.toBe(sign({ ortho: { texture: { uuid: 'a' } } }));
    expect(sign({ ortho: { bbox: [0, 0, 1, 1] } })).toBe(base); // (no picture yet)
    // the house, the pads of the plan
    const moved = sd();
    moved.levels[0].rooms[0].poly = rect(0, 0, 7, 4);
    expect(sign({}, moved)).not.toBe(base);
    const walled = sd();
    walled.levels[0].walls = [{ a: [0, 0], b: [6, 0], thickness: 0.2 }];
    expect(sign({}, walled)).not.toBe(base);
    const padded = sd();
    padded.site.pool = { x0: 8, z0: 8, x1: 10, z1: 12 };
    expect(sign({}, padded)).not.toBe(base);
    // another terrain document, even with the same content; the catalog read again
    expect(sign({}, sd(), structuredClone(t))).not.toBe(base);
    expect(sign({}, sd(), t, 1)).not.toBe(base);
  });
});

describe('the terrain saved with its corrections', () => {
  it('holds the ground of the view at every point of its grid, the rest as it was', () => {
    const t = { ...syntheticTerrain([0, 0], 20, 1), buildings: [{ poly: rect(0, 0, 6, 4) }] };
    t.s = t.z.map((v, k) => v + (k % 7 === 0 ? 4 : 0));
    // a platform at 103 m, 2 m of blend around it; the plan turned by 30 degrees and moved
    const c = cfg({ base: 1.2, rot: 30, dx: 0.4, dz: -0.3, ops: [{ type: 'terrace', poly: rect(-8, -8, -4, -4), alt: 103, feather: 2 }] });
    const terrain = buildTerrain(t, sd(), c);
    const doc = correctedTerrain(t, c, terrain);
    expect(doc).toMatchObject({
      version: 1,
      origin: t.origin,
      step: 1,
      nx: 21,
      nz: 21,
      center: [0, 0],
      corrected: true,
      buildings: t.buildings,
    });
    expect(doc.z).toHaveLength(441);
    const at = (x, z) => doc.z[(z + 10) * 21 + x + 10];
    const was = (x, z) => t.z[(z + 10) * 21 + x + 10];
    // on the platform: its altitude; far from it: the terrain as it was, to the millimetre
    expect(at(-6, -6)).toBe(103);
    expect(at(-8, -4)).toBe(103);
    expect(at(6, 6)).toBeCloseTo(was(6, 6), 3);
    expect(at(-10, 10)).toBeCloseTo(was(-10, 10), 3);
    // in the blend: between the two
    expect(at(-3, -6)).toBeGreaterThan(Math.min(was(-3, -6), 103));
    expect(at(-3, -6)).toBeLessThan(Math.max(was(-3, -6), 103));
    // the surface model is kept, and never under the ground
    expect(doc.s.every((v, k) => v >= doc.z[k])).toBe(true);
    expect(doc.s[7]).toBe(t.s[7]);
    // the document it was made from is left alone
    expect(t.corrected).toBeUndefined();
    expect(t.z[0]).toBe(was(-10, -10));
    // without a surface model: none is made up
    const bare = { ...t, s: undefined };
    expect(correctedTerrain(bare, c, buildTerrain(bare, sd(), c)).s).toBeUndefined();
  });

  it('is the terrain itself when nothing corrects it', () => {
    const t = syntheticTerrain([0, 0], 20, 1);
    const none = { levels: [{ elevation: 0, rooms: [], walls: [] }], site: {} };
    const doc = correctedTerrain(t, cfg({ base: 3 }), buildTerrain(t, none, cfg({ base: 3 })));
    for (let k = 0; k < t.z.length; k++) expect(doc.z[k]).toBeCloseTo(t.z[k], 3);
  });
});
