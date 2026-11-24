import { describe, expect, it } from 'vitest';
import { TREE_SHAPES, treeArt, treeSvg, treeThumb } from '../src/tree-art.js';
import { SPECIES } from '../src/engine/catalog.js';

const catalog = (shape, foliage = '#6fa34a') => ({
  kind: 'catalog',
  height: 7,
  crown: 2.5,
  trunkR: 0.2,
  trunk: '#5c4636',
  tree: { shape, seasons: { summer: { foliage } } },
});

describe('miniatures of the tree species', () => {
  it('reads the shape and the summer foliage of a species of the catalogue', () => {
    expect(treeArt(catalog('conical'))).toMatchObject({ shape: 'conifer', foliage: '#6fa34a', trunk: '#5c4636' });
    expect(treeArt(catalog('weeping')).shape).toBe('weeping');
    expect(treeArt(catalog('palm')).shape).toBe('palm');
    expect(treeArt(catalog('nothing-known')).shape).toBe('round'); // a shape this module does not draw
  });

  it('reads a built-in species, evergreen or not', () => {
    expect(treeArt(SPECIES.pine)).toMatchObject({ shape: 'conifer', foliage: SPECIES.pine.leaf.all });
    expect(treeArt(SPECIES.maple).foliage).toBe(SPECIES.maple.leaf.summer);
    expect(treeArt(SPECIES.hedge).shape).toBe('hedge');
  });

  it('falls back rather than throwing on a species it knows nothing about', () => {
    const a = treeArt(undefined);
    expect(a.shape).toBe('round');
    expect(a.w).toBeGreaterThan(0);
    expect(a.tw).toBeGreaterThan(0);
    expect(treeArt({ height: 0 }).w).toBeGreaterThan(0); // no division by a height of zero
  });

  it('draws a yew or a cypress as a column, never as a cone', () => {
    const yew = treeArt(catalog('columnar'));
    expect(yew.shape).toBe('column');
    // the slimmer the species, the slimmer the drawing: a cypress is not as wide as a yew
    const slim = treeArt({ kind: 'catalog', height: 9, crown: 0.9, tree: { shape: 'columnar', seasons: {} } });
    const yewW = treeArt({ kind: 'catalog', height: 5, crown: 0.8, tree: { shape: 'columnar', seasons: {} } }).w;
    expect(slim.w).toBeLessThan(yewW);
    // the foliage is one column down to the ground, not the stack of triangles a conifer is made of
    expect(treeSvg(catalog('columnar'))).toContain('<path');
    expect(treeSvg(catalog('conical'))).not.toContain('<path');
    expect(treeSvg(catalog('columnar'))).not.toBe(treeSvg(catalog('conical')));
  });

  it('lifts the crown of a tree with a long bare trunk: a stone pine reads as an umbrella', () => {
    const round = (h, crown, trunk) => ({
      kind: 'catalog',
      height: h,
      crown,
      tree: { shape: 'round', trunk: { height: trunk }, seasons: { summer: { foliage: '#35654a' } } },
    });
    expect(treeArt(round(12, 4.5, 8)).t0).toBeCloseTo(8 / 12); // a stone pine: two thirds of bare trunk
    expect(treeArt(round(9, 3.8, 3.2)).t0).toBeCloseTo(3.2 / 9); // an oak branches low
    expect(treeArt(round(10, 2, 40)).t0).toBeLessThanOrEqual(0.78); // never all trunk
    expect(treeArt(SPECIES.oak).t0).toBe(0.36); // a built-in species keeps the look it always had
    // the higher the trunk, the flatter and the higher the crown
    const height = (sp) => Number(treeSvg(sp).match(/<ellipse cx="0" cy="([\d.]+)" rx="[\d.]+" ry="([\d.]+)"/)[1]);
    expect(height(round(12, 4.5, 8))).toBeGreaterThan(height(round(9, 3.8, 3.2)));
  });

  it('keeps the crown and the trunk within bounds, whatever the sizes say', () => {
    expect(treeArt({ kind: 'round', height: 2, crown: 40 }).w).toBeLessThanOrEqual(0.46);
    expect(treeArt({ kind: 'round', height: 40, crown: 0.01 }).w).toBeGreaterThanOrEqual(0.14);
    expect(treeArt({ kind: 'round', height: 2, trunkR: 9 }).tw).toBeLessThanOrEqual(0.09);
  });

  it('draws every shape as an SVG document, in the colours of the species', () => {
    for (const shape of TREE_SHAPES) {
      const svg = treeSvg({ kind: shape, height: 5, crown: 1.8, trunkR: 0.2, trunk: '#5c4636', leaf: { all: '#2f6b45' } });
      expect(svg.startsWith('<svg xmlns=')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('#2f6b45');
      expect(svg).not.toContain('NaN');
    }
    // a hedge is a block of foliage with no trunk showing, a palm has its own
    expect(treeSvg({ kind: 'hedge', height: 1.5, crown: 0.9, trunk: '#6b4f3a', leaf: { all: '#3f7a3a' } })).not.toContain('#6b4f3a');
    expect(treeSvg(catalog('palm'))).toContain('#5c4636');
  });

  it('gives an image address an <img> can use', () => {
    const url = treeThumb(SPECIES.oak);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toContain('<svg');
  });
});
