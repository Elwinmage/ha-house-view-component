import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  TEX_N,
  canvasOf,
  openTexture,
  openTile,
  paintJoints,
  paintSpeckles,
  paintStones,
  paintSurface,
  strokeOpen,
  surfaceSwatch,
  surfaceTexture,
  surfaceTile,
} from '../src/surface-art.js';
import { RELIEF_SHADE, hashString, noise, shadeHex } from '../src/surface-lib.js';
import { callsOf, fakeCanvas, fakeDocument } from './fake-canvas.js';

/** A "random" source that always gives the middle: no variation. */
const middle = () => 0.5;

afterEach(() => vi.unstubAllGlobals());

describe('outside a browser', () => {
  it('paints nothing: the views fall back on plain colours', () => {
    expect(canvasOf()).toBeNull();
    expect(surfaceTile({ color: '#010203' }, 'nowhere')).toBeNull();
    expect(surfaceTexture({ color: '#010203' }, 'nowhere')).toBeNull();
    expect(surfaceSwatch({ color: '#010203' }, 'nowhere')).toBeNull();
    expect(openTexture({ pattern: 'mesh', pitch: 0.05, fill: 0.2 }, '#010203')).toBeNull();
  });

  it('paints nothing either on a canvas without a 2D context', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(canvasOf()).toBeNull();
    expect(surfaceTile({ color: '#010204' }, 'no context')).toBeNull();
  });
});

describe('painting a surface', () => {
  it('makes a square canvas of the size of a tile, or the one asked', () => {
    vi.stubGlobal('document', fakeDocument());
    const { c, g } = canvasOf();
    expect([c.width, c.height]).toEqual([TEX_N, TEX_N]);
    expect(g).toBe(c.getContext('2d'));
    expect(canvasOf(64, 32).c).toMatchObject({ width: 64, height: 32 });
  });

  it('fills the base colour, and nothing more for a plain surface', () => {
    const c = fakeCanvas();
    paintSurface(c.getContext(), { color: '#c8c4bb' }, 128, middle);
    expect(c.calls).toEqual([{ op: 'fillRect', style: '#c8c4bb', alpha: 1, x: 0, y: 0, w: TEX_N, h: TEX_N }]);
  });

  it('lays the units of a staggered bond over their bed of mortar', () => {
    const c = fakeCanvas();
    // one meter a tile: rows of 64 px, units of 128 px, joints of 4 px
    paintJoints(c.getContext(), { color: '#333333', cell: [0.25, 0.5], width: 4 / 256, stagger: 0.5, shade: 0 }, '#808080', 256, middle);
    const [bed, ...units] = callsOf(c, 'fillRect');
    expect(bed).toMatchObject({ style: '#333333', w: TEX_N, h: TEX_N });
    for (const unit of units) expect(unit).toMatchObject({ style: '#808080', w: 124, h: 60 });
    const rowAt = (y) => units.filter((u) => u.y === y).map((u) => u.x);
    expect(rowAt(-62)).toEqual([-126, 2, 130]); // the row before the tile, not set off
    expect(rowAt(2)).toEqual([-62, 66, 194]); // the next one, half a unit further
    expect(rowAt(66)).toEqual([-126, 2, 130]);
    expect(new Set(units.map((u) => u.y))).toEqual(new Set([-62, 2, 66, 130, 194]));
  });

  it('shades each unit, and gives the joints a width when the surface has none', () => {
    const c = fakeCanvas();
    let n = 0;
    paintJoints(c.getContext(), { color: '#000000', cell: [1, 1] }, '#808080', 256, () => (n++ % 2 ? 1 : 0));
    const units = callsOf(c, 'fillRect').slice(1);
    expect(new Set(units.map((u) => u.style)).size).toBe(2); // 8 % lighter or darker
    expect(units[0].w).toBeCloseTo(256 - 0.015 * 256, 6);
  });

  it('gives a share of the units another tint', () => {
    const c = fakeCanvas();
    let n = 0;
    const joints = { color: '#333333', cell: [0.25, 0.5], shade: 0, tints: [{ color: '#c08040', amount: 0.5 }] };
    // one throw for the tint, one for the shade: every other unit takes the tint
    paintJoints(c.getContext(), joints, '#808080', 256, () => (n++ % 4 === 0 ? 0.1 : 0.9));
    const units = callsOf(c, 'fillRect').slice(1);
    expect(new Set(units.map((u) => u.style))).toEqual(new Set(['#c08040', '#808080']));
    expect(units.filter((u) => u.style === '#c08040')).toHaveLength(Math.ceil(units.length / 2));
  });

  it('fits irregular stones into one another over their bed, without rows', () => {
    const c = fakeCanvas();
    const joints = { pattern: 'irregular', color: '#38332b', cell: [0.2, 0.3], width: 0.02, shade: 0, vary: 0.8 };
    paintJoints(c.getContext(), joints, '#b7b0a1', 128, noise(hashString('stones')));
    // the bed first, and not a single rectangle after it
    expect(callsOf(c, 'fillRect')).toEqual([{ op: 'fillRect', style: '#38332b', alpha: 1, x: 0, y: 0, w: TEX_N, h: TEX_N }]);
    const stones = callsOf(c, 'fill');
    // two metres of wall in stones of 0.2 by 0.3 m: about seventy of them, less those left out, plus the ones that
    // go over an edge and come back on the opposite one
    expect(stones.length).toBeGreaterThan(55);
    expect(stones.length).toBeLessThan(110);
    for (const stone of stones) expect(stone.style).toBe('#b7b0a1');
    // every stone shows on the tile, and some start outside it: the tile joins up with the next
    const starts = callsOf(c, 'moveTo');
    expect(starts).toHaveLength(stones.length);
    expect(starts.some((m) => m.x < 0 || m.y < 0 || m.x > TEX_N || m.y > TEX_N)).toBe(true);
    for (const m of starts) expect(m.x > -TEX_N / 2 && m.x < TEX_N * 1.5 && m.y > -TEX_N / 2 && m.y < TEX_N * 1.5).toBe(true);
  });

  it('gives the stones that bulge a rim in shade, and some of them a tint', () => {
    const c = fakeCanvas();
    const joints = {
      pattern: 'irregular',
      color: '#38332b',
      cell: [0.4, 0.5],
      vary: 0.5,
      relief: 0.5,
      tints: [{ color: '#c9a878', amount: 0.4 }],
    };
    paintStones(c.getContext(), joints, '#b7b0a1', 128, noise(hashString('relief')));
    const fills = callsOf(c, 'fill');
    expect(fills.length % 2).toBe(0); // each stone twice: its rim, then its face
    const styles = new Set(fills.map((f) => f.style));
    expect(styles.size).toBeGreaterThan(8); // shaded one from the other (8 % by default), in two colours
    // a rim is its face, darker
    const tone = (hex) => parseInt(hex.slice(1, 3), 16);
    for (let i = 0; i < fills.length; i += 2) expect(tone(fills[i].style)).toBeLessThan(tone(fills[i + 1].style));
    expect(tone(shadeHex('#b7b0a1', 1 - RELIEF_SHADE * 0.5))).toBeLessThan(tone('#b7b0a1'));
    // warm stones among the grey ones
    const warm = fills.filter((f) => parseInt(f.style.slice(1, 3), 16) - parseInt(f.style.slice(5, 7), 16) > 50);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.length).toBeLessThan(fills.length);
  });

  it('takes the usual joint and no unevenness when irregular stones give none', () => {
    const c = fakeCanvas();
    paintStones(c.getContext(), { pattern: 'irregular', color: '#000000', cell: [0.5, 0.5] }, '#808080', 256, () => 0.5);
    // tiles of one metre, stones of half a metre: four of them, each seen once or cut by an edge
    const fills = callsOf(c, 'fill');
    expect(fills.length).toBeGreaterThanOrEqual(4);
    expect(new Set(fills.map((f) => f.style))).toEqual(new Set(['#808080']));
  });

  it('scatters grains: round ones, long ones, more of them over a wider band', () => {
    const c = fakeCanvas();
    const g = c.getContext();
    paintSpeckles(g, [{ color: '#111111', size: 0.02, amount: 0.1 }], 256, middle);
    const round = callsOf(c, 'arc');
    // a tenth of the tile covered by discs 0.02 m across (2.56 px of radius)
    expect(round).toHaveLength(Math.round((0.1 * TEX_N * TEX_N) / (Math.PI * 2.56 * 2.56)));
    expect(round[0]).toMatchObject({ style: '#111111', x: 128, y: 128 });
    expect(round[0].r).toBeCloseTo(2.56, 6);

    paintSpeckles(g, [{ color: '#222222', size: 0.02, amount: 0.1, stretch: 4 }], 256, middle, { x: 64, w: 64 });
    const long = callsOf(c, 'ellipse');
    expect(long).toHaveLength(Math.round(round.length / 4));
    expect(long[0]).toMatchObject({ style: '#222222', x: 96 });
    expect(long[0].rx / long[0].ry).toBeCloseTo(4, 6); // four times as long as wide, the same area

    paintSpeckles(g, undefined, 256, middle); // a surface without grains
    expect(callsOf(c, 'arc')).toHaveLength(round.length);
  });

  it('paints base, units, grains, ruts, then the noise', () => {
    const c = fakeCanvas();
    paintSurface(
      c.getContext(),
      {
        color: '#806040',
        grain: 0.2,
        joints: { color: '#201810', cell: [0.5, 0.5] },
        speckles: [{ color: '#a08060', size: 0.05, amount: 0.02 }],
        wheels: {
          color: '#504030',
          bands: [
            [0.1, 0.3],
            [0.7, 0.9],
            [0.5, 0.5],
          ],
          speckles: [{ color: '#302010', size: 0.05, amount: 0.02 }],
        },
      },
      128,
      middle,
    );
    const ops = c.calls.map((call) => call.op);
    expect(ops[0]).toBe('fillRect');
    expect(c.calls[0].style).toBe('#806040');
    expect(c.calls[1].style).toBe('#201810'); // the bed of the joints
    const ruts = callsOf(c, 'fillRect').filter((call) => call.style === '#504030');
    expect(ruts.map((r) => [r.x, r.w])).toEqual([
      [26, 51],
      [179, 51],
    ]); // the band without a width is left out
    expect(callsOf(c, 'clip')).toHaveLength(2);
    expect(callsOf(c, 'arc').some((a) => a.style === '#302010')).toBe(true);
    expect(ops[ops.length - 1]).toBe('putImageData');
    // every pixel was lightened or darkened by the noise (here: left as it was, the noise being nil)
    expect(c.calls[c.calls.length - 1].image.data[0]).toBe(100);
  });

  it('skips the noise where the pixels cannot be read back', () => {
    const c = fakeCanvas();
    const g = c.getContext();
    g.getImageData = undefined;
    paintSurface(g, { color: '#806040', grain: 0.5 }, 128, middle);
    expect(callsOf(c, 'putImageData')).toHaveLength(0);
  });
});

describe('tiles and textures of a surface', () => {
  const S = { color: '#a9a9a4', tile: 2.4, joints: { color: '#74746f', cell: [0.6, 0.6], width: 0.006 } };

  it('paints a tile once per surface and seed', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const tile = surfaceTile(S, 'test:tiles');
    expect(tile).toBe(doc.canvases[0]);
    expect(surfaceTile({ ...S }, 'test:tiles')).toBe(tile);
    expect(doc.canvases).toHaveLength(1);
    expect(surfaceTile(S, 'test:other')).not.toBe(tile);
    expect(surfaceTile({ ...S, color: '#000000' }, 'test:tiles')).not.toBe(tile);
    expect(doc.canvases).toHaveLength(3);
    // 2.4 m a tile, slabs of 0.6 m: four rows of four whole slabs, so the tiles join up
    const slab = callsOf(tile, 'fillRect').find((u) => u.style !== '#74746f' && u.x > 0 && u.y > 0);
    expect(slab.w + 1).toBe(TEX_N / 4); // a joint is never thinner than a pixel
  });

  it('wraps the tile in a repeating texture, kept for the next build', () => {
    vi.stubGlobal('document', fakeDocument());
    const tex = surfaceTexture(S, 'test:texture');
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.image).toBe(surfaceTile(S, 'test:texture'));
    expect(surfaceTexture(S, 'test:texture')).toBe(tex);
  });

  it('gives the tile as an image for a picker', () => {
    vi.stubGlobal('document', fakeDocument());
    expect(surfaceSwatch(S, 'test:swatch')).toBe('data:image/png;canvas-0');
  });
});

describe('texture of a see-through fence', () => {
  it('holds a whole number of wires, so that the tiles join up', () => {
    expect(openTile({ pattern: 'grid', pitch: 0.05 })).toBeCloseTo(0.4, 9);
    expect(openTile({ pattern: 'bars', pitch: 0.11 })).toBeCloseTo(0.88, 9);
    expect(openTile({ pattern: 'mesh', pitch: 0.05 })).toBeCloseTo(0.3 * Math.SQRT2, 9);
    expect(openTile({ pattern: 'bars' })).toBeCloseTo(0.8, 9);
  });

  it('strokes every wire in the colour of the fence, never thinner than a pixel', () => {
    const c = fakeCanvas();
    strokeOpen(c.getContext(), { pattern: 'bars', pitch: 0.1, fill: 0.01 }, '#26272a', 100, 80, 100);
    const strokes = callsOf(c, 'stroke');
    expect(strokes).toHaveLength(12); // ten bars and two rails
    for (const s of strokes) expect(s).toEqual({ op: 'stroke', style: '#26272a', width: 1 });
    expect(callsOf(c, 'moveTo')[0]).toMatchObject({ x: 5, y: 0 });
    expect(callsOf(c, 'lineTo')[0]).toMatchObject({ x: 5, y: 80 });
  });

  it('draws bars once over the whole height, and repeats them along the fence only', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const tex = openTexture({ pattern: 'bars', pitch: 0.11, fill: 0.2 }, '#26272a');
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(callsOf(doc.canvases[0], 'translate')).toHaveLength(0);
    expect(callsOf(doc.canvases[0], 'stroke')).toHaveLength(8 + 2); // eight bars a tile, two rails
    expect(openTexture({ pattern: 'bars', pitch: 0.11, fill: 0.2 }, '#26272a')).toBe(tex);
    expect(openTexture({ pattern: 'bars', pitch: 0.11, fill: 0.2 }, '#ffffff')).not.toBe(tex);
  });

  it('repeats a mesh both ways, its leaning wires joining across the edges', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const tex = openTexture({ pattern: 'mesh', pitch: 0.05, fill: 0.2 }, '#5f7d5c');
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    // drawn over three tiles, cut to the middle one
    expect(callsOf(doc.canvases[0], 'translate')).toEqual([{ op: 'translate', x: -TEX_N, y: -TEX_N }]);
    const starts = callsOf(doc.canvases[0], 'moveTo').map((m) => m.x);
    // a wire starts every sixth of a tile: the same picture one tile further on
    const step = TEX_N / 6;
    expect(starts[2] - starts[0]).toBeCloseTo(step, 6);
  });
});
