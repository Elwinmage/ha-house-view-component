import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import * as THREE from 'three';
import { bakeModel, decodeModel, encodeModel, hexOf, materialOf, modelFiles, parseMtl, parseObj } from '../src/engine/sh3d-models.js';
import { attachModels, MODELS_BUDGET, readSh3dFiles, textureMeans } from '../src/engine/sh3d-import.js';
import { buildBoxFurnitureMesh } from '../src/engine/catalog.js';

// a little table: a top (box) and four legs (boxes), 60 triangles, two materials, plus a glass plate
function box(x0, y0, z0, x1, y1, z1, base) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const f = [
    [1, 4, 3, 2],
    [5, 6, 7, 8],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 4, 8, 7],
    [4, 1, 5, 8],
  ];
  return { v: v.map((p) => `v ${p.join(' ')}`), f: f.map((q) => `f ${q.map((k) => k + base).join(' ')}`) };
}
function table() {
  const lines = ['# a table', 'mtllib table.mtl', 'o table', 'usemtl wood'];
  const top = box(0, 70, 0, 120, 75, 80, 0);
  lines.push(...top.v, ...top.f);
  let base = 8;
  for (const [x, z] of [
    [0, 0],
    [115, 0],
    [0, 75],
    [115, 75],
  ]) {
    const leg = box(x, 0, z, x + 5, 70, z + 5, base);
    lines.push('usemtl flgrey', ...leg.v, ...leg.f);
    base += 8;
  }
  const plate = box(10, 76, 10, 110, 77, 70, base);
  lines.push('usemtl glass', ...plate.v, ...plate.f);
  return lines.join('\n');
}
const MTL = 'newmtl wood\nKd 0.6 0.4 0.2\nmap_Kd wood.jpg\nnewmtl glass\nKd 0.8 0.9 1\nd 0.3\nnewmtl ghost\nKd 1 1 1\nTr 1\n';

describe('model files', () => {
  it('reads OBJ and MTL texts', () => {
    const obj = parseObj(table());
    expect(obj.verts).toHaveLength(6 * 8 * 3);
    expect(obj.tris).toHaveLength(6 * 12 * 3);
    expect(obj.mat.slice(0, 12)).toEqual(Array(12).fill('wood'));
    expect(obj.mtllib).toBe('table.mtl');
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3/1/1 -2/2/2 -1/3/3\n').tris).toEqual([0, 1, 2]);
    const mtl = parseMtl(MTL);
    expect(mtl.wood).toEqual({ color: '#996633', alpha: 1, textured: true, texture: 'wood.jpg' });
    expect(mtl.glass.alpha).toBe(0.3);
    expect(mtl.ghost.alpha).toBe(0);
    expect(parseMtl('Kd 1 1 1\n')).toEqual({});
    expect(hexOf([1, 0.5, NaN])).toBe('#ff80cc');
  });

  it('falls back on the default materials of the OBJ loader', () => {
    expect(materialOf('white', null)).toEqual({ color: '#ffffff', alpha: 1 });
    expect(materialOf('amber_trans', null)).toEqual({ color: '#934400', alpha: 0.16 });
    expect(materialOf('mine', null).color).toBe('#c8bfae');
    expect(materialOf('mine', { mine: { color: '#123456', alpha: 1 } }).color).toBe('#123456');
  });

  it('finds the model of a piece and its material file in the archive', () => {
    const files = {
      'Home.xml': strToU8('<home/>'),
      '5/table.obj': strToU8(table()),
      '5/table.mtl': strToU8(MTL),
      7: strToU8('v 0 0 0\n'),
      8: new Uint8Array([0x50, 0x4b, 3, 4]),
      9: strToU8('\u0000\u0001 binary'),
    };
    const dec = (u8) => new TextDecoder().decode(u8);
    const f = modelFiles(files, '5/table.obj', dec);
    expect(f.dir).toBe('5/');
    expect(f.mtl).toContain('newmtl wood');
    expect(modelFiles(files, '7', dec)).toEqual({ obj: 'v 0 0 0\n', mtl: null, dir: '' });
    expect(modelFiles(files, '8', dec)).toBeNull();
    expect(modelFiles(files, '9', dec)).toBeNull();
    expect(modelFiles(files, 'nope', dec)).toBeNull();
    expect(modelFiles(files, '', dec)).toBeNull();
  });
});

describe('light copies of the models', () => {
  const obj = parseObj(table());
  const mtl = parseMtl(MTL);

  it('normalizes the model to the unit box, one group per colour', () => {
    const b = bakeModel(obj, mtl);
    expect(b.groups.map((g) => [g.c, g.a])).toEqual([
      ['#996633', 1],
      ['#808080', 1], // flgrey: a default material
      ['#ccE6ff'.toLowerCase(), 0.3],
    ]);
    const xs = [];
    const ys = [];
    for (let i = 0; i < b.pos.length; i += 3) {
      xs.push(b.pos[i]);
      ys.push(b.pos[i + 1]);
    }
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(65535);
    expect(Math.max(...ys)).toBeGreaterThan(64000); // merged vertices: the mean of their group
    expect(b.wide).toBe(false);
  });

  it('turns, recolours and thins out the model', () => {
    // turned a quarter round about x: the top of the table is now at the back
    const turned = bakeModel(obj, mtl, { rotation: [1, 0, 0, 0, 0, -1, 0, 1, 0] });
    expect(turned).not.toBeNull();
    const red = bakeModel(obj, mtl, { color: '#ff0000' });
    expect(new Set(red.groups.map((g) => g.c))).toEqual(new Set(['#ff0000']));
    const own = bakeModel(obj, mtl, { colors: { flgrey: '#000000' } });
    expect(own.groups[1].c).toBe('#000000');
    // few triangles allowed: the vertices merge on a coarser grid, small parts vanish
    const coarse = bakeModel(obj, mtl, { maxTris: 20, cells: 32 });
    expect(coarse.idx.length / 3).toBeLessThan(obj.tris.length / 3);
    expect(bakeModel({ verts: [], tris: [], mat: [] }, null)).toBeNull();
    // only invisible faces: nothing left
    expect(bakeModel(parseObj('usemtl ghost\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'), mtl)).toBeNull();
    // a face with a missing vertex is left out
    expect(bakeModel(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 1\nf 1 2 3\nf 1 2 9'), null).idx).toHaveLength(3);
  });

  it('stores and reads back a model', () => {
    const doc = encodeModel(bakeModel(obj, mtl));
    expect(typeof doc.v).toBe('string');
    const m = decodeModel(doc);
    expect(m.pos.length / 3).toBeGreaterThan(8);
    expect(Math.min(...m.pos)).toBeCloseTo(-0.5);
    expect(m.idx.length).toBe(doc.g.reduce((s, g) => s + g.n, 0));
    const wide = encodeModel({
      pos: new Uint16Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      idx: new Uint32Array([0, 1, 2]),
      groups: [{ c: '#ffffff', a: 1, s: 0, n: 3 }],
      wide: true,
    });
    expect(wide.wide).toBe(true);
    expect(decodeModel(wide).idx).toEqual(new Uint32Array([0, 1, 2]));
    expect(decodeModel({ v: '!!', i: '', g: [] })).toBeNull();
    expect(decodeModel({ ...doc, g: null })).toBeNull();
    expect(
      decodeModel({ ...doc, i: encodeModel({ pos: new Uint16Array(3), idx: new Uint16Array([60000, 60000, 60000]), groups: [] }).i }),
    ).toBeNull();
  });
});

describe('models of a plan', () => {
  const files = {
    'Home.xml': strToU8('<home/>'),
    '5/table.obj': strToU8(table()),
    '5/table.mtl': strToU8(MTL),
    box: strToU8('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4'),
    9: new Uint8Array([0x50, 0x4b]),
  };
  const scene = () => ({
    furniture: [
      {
        name: 'Table',
        size: [1.2, 0.77, 0.8],
        at: [0, 0],
        _model: { ref: '5/table.obj', rotation: null, mirrored: false, color: null, colors: {} },
      },
      {
        name: 'Table',
        size: [1.2, 0.77, 0.8],
        at: [2, 0],
        _model: { ref: '5/table.obj', rotation: null, mirrored: true, color: null, colors: {} },
      },
      {
        name: 'Table rouge',
        size: [1.2, 0.77, 0.8],
        at: [4, 0],
        _model: { ref: '5/table.obj', rotation: null, mirrored: false, color: '#ff0000', colors: {} },
      },
      { name: 'Caisse', size: [1, 1, 1], at: [6, 0], _model: { ref: 'box', rotation: null, mirrored: false, color: null, colors: {} } },
      { name: 'Vieux', size: [1, 1, 1], at: [8, 0], _model: { ref: '9', rotation: null, mirrored: false, color: null, colors: {} } },
      { name: 'Rien', size: [1, 1, 1], at: [9, 0], _model: null },
    ],
    outdoor: [],
  });

  it('keeps one copy per model and colouring, and leaves the boxes', () => {
    const sc = scene();
    const out = attachModels(sc, files, { '5/wood.jpg': [0.5, 0.5, 0.5] });
    expect(out).toEqual({ drawn: 3, unreadable: 1 });
    expect(Object.keys(sc.models)).toEqual(['m1', 'm2']);
    expect(sc.furniture.map((f) => [f.model, f.mirrored])).toEqual([
      ['m1', undefined],
      ['m1', true],
      ['m2', undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(sc.furniture.every((f) => !('_model' in f))).toBe(true);
    // the texture of the wood darkens its colour
    expect(sc.models.m1.g[0].c).toBe('#4d331a');
    expect(MODELS_BUDGET).toBeGreaterThan(10000);
  });

  it('leaves everything as boxes without the files of the archive', () => {
    const sc = scene();
    expect(attachModels(sc, null)).toEqual({ drawn: 0, unreadable: 0 });
    expect(sc.models).toBeUndefined();
    expect(sc.furniture.every((f) => !('_model' in f) && !f.model)).toBe(true);
  });

  it('reads the archive', async () => {
    expect(readSh3dFiles(strToU8('<home/>'))).toBeNull();
    expect(readSh3dFiles(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await textureMeans(files)).toEqual({}); // no picture reading outside a browser
  });

  it('draws the pieces with their models, their glass apart', () => {
    const sc = scene();
    attachModels(sc, files);
    const g = buildBoxFurnitureMesh(sc.furniture.slice(0, 1), 0, sc.models);
    expect(g.children).toHaveLength(2);
    const [solid, glass] = g.children;
    expect(glass.material.transparent).toBe(true);
    const bb = new THREE.Box3().setFromBufferAttribute(solid.geometry.attributes.position);
    expect(bb.max.y).toBeCloseTo(0.75, 2); // the top of the wood; the glass plate over it is apart
    expect(bb.min.x).toBeCloseTo(-0.6, 2);
    // without the models: boxes only
    const boxes = buildBoxFurnitureMesh(sc.furniture, 0, null);
    expect(buildBoxFurnitureMesh(sc.furniture, 0, sc.models).children).toHaveLength(2);
    expect(boxes.children).toHaveLength(1);
    expect(buildBoxFurnitureMesh([], 0)).toBeNull();
    // a model that cannot be read: a box
    expect(buildBoxFurnitureMesh([{ ...sc.furniture[0] }], 0, { m1: { v: '', i: '', g: [] } }).children).toHaveLength(1);
  });
});
