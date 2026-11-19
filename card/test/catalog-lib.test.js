import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CLUMPS,
  crownSolids,
  drawableObject,
  drawableTree,
  fitScale,
  localName,
  matchEntry,
  mixHex,
  objectBounds,
  objectSize,
  rotationMatrix,
  thinning,
  treeLook,
  treeSpecies,
  words,
} from '../src/catalog-lib.js';

// the built-in snapshot of the catalog: what the integration serves before the first download
const BUILTIN = new URL('../../custom_components/house_view/', import.meta.url);
const read = (folder, file) =>
  Object.fromEntries(
    readdirSync(new URL(`${folder}/items/`, BUILTIN)).map((id) => [
      id,
      JSON.parse(readFileSync(new URL(`${folder}/items/${id}/${file}`, BUILTIN), 'utf8')),
    ]),
  );
const TREES = read('catalog_builtin', 'tree.json');
const OBJECTS = read('catalog_builtin_objects', 'object.json');

const OAK = {
  name: { en: 'Oak', fr: 'Chêne' },
  keywords: ['oak', 'chene'],
  shape: 'round',
  evergreen: false,
  height: { default: 9, min: 4, max: 25 },
  crown_radius: 3.8,
  trunk: { height: 3.2, radius: 0.3, color: '#5c4636' },
  seasons: {
    spring: { foliage: '#9ccf62', density: 0.6, flowers: { color: '#ffffff', amount: 0.8 } },
    summer: { foliage: '#3f7f35', fruits: { color: '#aa0000', amount: 0.4 } },
    autumn: { foliage: '#c98a2e', density: 0.8, fruits: { color: '#550000', amount: 0.2 }, fallen: { color: '#b8792a', amount: 0.5 } },
    winter: { foliage: '#8a6a45', density: 0 },
  },
};

describe('names and keywords', () => {
  it('names an entry in the language of the user, English else', () => {
    expect(localName(OAK.name, 'fr')).toBe('Chêne');
    expect(localName(OAK.name, 'fr-CA')).toBe('Chêne');
    expect(localName(OAK.name, 'de')).toBe('Oak');
    expect(localName(OAK.name, undefined)).toBe('Oak');
    expect(localName({ fr: 'Chêne' }, 'de', 'oak')).toBe('oak');
    expect(localName(null, 'fr', 'oak')).toBe('oak');
    expect(localName('Oak', 'fr')).toBe('');
  });

  it('splits a name into plain words', () => {
    expect(words('Chêne  d’Amérique (grand) n°2')).toEqual(['chene', 'd', 'amerique', 'grand', 'n', '2']);
    expect(words(null)).toEqual([]);
  });

  it('finds the entry a plan names, by whole words', () => {
    const items = {
      oak: { keywords: ['oak', 'chene'] },
      chair: { keywords: ['chair', 'chaise'] },
      sun: { keywords: ['chaise longue'] },
      none: {},
    };
    expect(matchEntry('Grand Chêne', items)).toBe('oak');
    expect(matchEntry('chaise_de_jardin', items)).toBe('chair');
    expect(matchEntry('Chaise longue en teck', items)).toBe('sun'); // the longest keyword wins
    expect(matchEntry('Chaises', items)).toBeNull(); // not the same word
    expect(matchEntry('Oakland sofa', items)).toBeNull();
    expect(matchEntry('', items)).toBeNull();
    expect(matchEntry('oak', null)).toBeNull();
    // the same keyword twice: the first id, whatever the order of the catalog
    expect(matchEntry('table', { b: { keywords: ['table'] }, a: { keywords: ['table'] } })).toBe('a');
  });

  it('recognises the first entries of the catalog in a plan', () => {
    expect(matchEntry('Cerisier', TREES)).toBe('cherry-tree');
    expect(matchEntry('Abricotier nain', TREES)).toBe('apricot-tree');
    expect(matchEntry('If taillé', TREES)).toBe('yew');
    expect(matchEntry('Pin sylvestre', TREES)).toBe('pine');
    expect(matchEntry('Table basse', TREES)).toBeNull();
    expect(matchEntry('Chaise cuisine', OBJECTS)).toBe('chair');
  });
});

describe('colours', () => {
  it('mixes two colours', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#302010', 0.5)).toBe('#202020');
    expect(mixHex('#000000', '#ffffff', 7)).toBe('#ffffff');
    expect(mixHex('#0a0b0c', '#0a0b0c', 0.3)).toBe('#0a0b0c');
  });
});

describe('trees', () => {
  it('reads a season as it is', () => {
    const summer = treeLook(OAK, { from: 'summer', to: 'autumn', t: 0 });
    expect(summer).toEqual({ foliage: '#3f7f35', density: 1, flowers: null, fruits: { color: '#aa0000', amount: 0.4 }, fallen: null });
    const winter = treeLook(OAK, { from: 'winter', to: 'spring', t: 0 });
    expect(winter.density).toBe(0);
    expect(winter.flowers).toBeNull();
  });

  it('blends two seasons', () => {
    const look = treeLook(OAK, { from: 'summer', to: 'autumn', t: 0.5 });
    expect(look.foliage).toBe(mixHex('#3f7f35', '#c98a2e', 0.5));
    expect(look.density).toBeCloseTo(0.9);
    // fruits on both sides: amount and colour blend; fallen leaves only come: they fade in with their own colour
    expect(look.fruits.amount).toBeCloseTo(0.3);
    expect(look.fruits.color).toBe(mixHex('#aa0000', '#550000', 0.5));
    expect(look.fallen).toEqual({ color: '#b8792a', amount: 0.25 });
    // blossom fades out toward summer
    const late = treeLook(OAK, { from: 'spring', to: 'summer', t: 0.75 });
    expect(late.flowers.color).toBe('#ffffff');
    expect(late.flowers.amount).toBeCloseTo(0.2);
    expect(treeLook(OAK, { from: 'spring', to: 'summer', t: 1 }).flowers).toBeNull();
  });

  it('draws a missing season like summer', () => {
    const evergreen = { ...OAK, seasons: { summer: { foliage: '#205030' } } };
    expect(treeLook(evergreen, { from: 'winter', to: 'spring', t: 0.4 })).toEqual({
      foliage: '#205030',
      density: 1,
      flowers: null,
      fruits: null,
      fallen: null,
    });
  });

  it('thins the foliage where it is', () => {
    expect(thinning(1)).toBe(1);
    expect(thinning(0)).toBe(0);
    expect(thinning(0.65)).toBeCloseTo(0.772, 3);
    expect(thinning(3)).toBe(1);
  });

  it('fills the crown box of a round tree', () => {
    const solids = crownSolids(OAK);
    expect(solids).toHaveLength(CLUMPS.length);
    const reach = (axis) => Math.max(...solids.map((s) => Math.abs(s.at[axis] - (axis === 1 ? 6.1 : 0)) + s.size[axis]));
    expect(reach(0)).toBeCloseTo(3.8); // crown_radius
    expect(reach(2)).toBeLessThanOrEqual(3.8 + 1e-9);
    expect(reach(1)).toBeLessThanOrEqual(2.9 + 1e-9); // half of the height above the trunk
    expect(Math.max(...solids.map((s) => s.at[1] + s.size[1]))).toBeCloseTo(9); // the top of the tree
    expect(Math.min(...solids.map((s) => s.at[1] - s.size[1]))).toBeGreaterThanOrEqual(3.2 - 1e-9); // the top of the trunk
  });

  it('stacks the cones of a conical tree up to its top', () => {
    const solids = crownSolids({ ...OAK, shape: 'conical' });
    expect(solids.map((s) => s.kind)).toEqual(['cone', 'cone', 'cone', 'cone']);
    expect(solids[0].at).toEqual([0, 3.2, 0]);
    expect(solids[0].size[0]).toBeCloseTo(3.8);
    expect(solids[3].size[0]).toBeCloseTo(3.8 * 0.4);
    expect(solids[3].at[1] + solids[3].size[1]).toBeCloseTo(9);
  });

  it('lists a tree as a species of the engine', () => {
    const sp = treeSpecies('oak', OAK, 'fr');
    expect(sp).toMatchObject({
      name: 'Chêne',
      kind: 'catalog',
      height: 9,
      minHeight: 4,
      maxHeight: 25,
      crown: 3.8,
      trunkR: 0.3,
      trunk: '#5c4636',
      deciduous: true,
    });
    expect(sp.tree).toBe(OAK);
    expect(treeSpecies('fir', { ...OAK, name: {}, evergreen: true }, 'fr')).toMatchObject({ name: 'fir', deciduous: false });
  });

  it('tells what it can draw', () => {
    expect(drawableTree(OAK)).toBe(true);
    for (const tree of Object.values(TREES)) expect(drawableTree(tree)).toBe(true);
    const broken = [
      null,
      {},
      { ...OAK, shape: 'weeping' },
      { ...OAK, height: { default: 0 } },
      { ...OAK, crown_radius: 0 },
      { ...OAK, trunk: { ...OAK.trunk, height: 9 } },
      { ...OAK, trunk: { ...OAK.trunk, color: 'brown' } },
      { ...OAK, seasons: { spring: OAK.seasons.spring } },
      { ...OAK, seasons: { summer: { foliage: 'green' } } },
    ];
    for (const tree of broken) expect(drawableTree(tree)).toBe(false);
  });
});

describe('objects', () => {
  const box = { shape: 'box', width: 2, height: 4, depth: 6, color: '#808080' };
  const apply = (m, v) => m.map((row) => +(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]).toFixed(6));

  it('turns a part like the catalog says', () => {
    expect(apply(rotationMatrix(), [1, 2, 3])).toEqual([1, 2, 3]);
    expect(apply(rotationMatrix(90), [0, 0, 1])).toEqual([1, 0, 0]); // yaw: the front turns toward +x
    expect(apply(rotationMatrix(0, 90), [0, 1, 0])).toEqual([0, 0, 1]); // pitch: the top leans to the front
    expect(apply(rotationMatrix(0, 0, 90), [0, 1, 0])).toEqual([-1, 0, 0]); // roll: the top leans toward -x
    expect(apply(rotationMatrix(90, 90, 0), [0, 1, 0])).toEqual([1, 0, 0]); // yaw is applied last
  });

  it('measures an object like the checks of the catalog', () => {
    expect(objectBounds([{ ...box, x: 1, z: -1, elevation: 3 }])).toEqual({ low: [0, 3, -4], high: [2, 7, 2] });
    const turned = objectSize([{ ...box, yaw: 90 }]);
    expect(turned[0]).toBeCloseTo(6);
    expect(turned[2]).toBeCloseTo(2);
    const ball = objectSize([{ ...box, shape: 'sphere', width: 2, height: 2, depth: 2, yaw: 33, pitch: 71 }]);
    for (const side of ball) expect(side).toBeCloseTo(2);
    const chair = objectSize(OBJECTS.chair.parts);
    expect(chair.map((v) => +v.toFixed(2))).toEqual([0.42, 0.9, 0.42]);
  });

  it('fits an object to a piece of furniture', () => {
    expect(fitScale([box], [4, 2, 6])).toEqual([2, 0.5, 1]);
    expect(fitScale([box], null)).toEqual([1, 1, 1]);
    expect(fitScale([box], [0, 4, undefined])).toEqual([1, 1, 1]);
  });

  it('tells what it can draw', () => {
    expect(drawableObject(OBJECTS.chair)).toBe(true);
    const broken = [
      null,
      {},
      { parts: [] },
      { parts: [null] },
      { parts: [{ ...box, shape: 'torus' }] },
      { parts: [{ ...box, width: 0 }] },
      { parts: [{ ...box, color: 'red' }] },
    ];
    for (const object of broken) expect(drawableObject(object)).toBe(false);
  });
});
