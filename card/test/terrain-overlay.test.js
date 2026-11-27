import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { brushPreview, fillMesh, labelSprite, screenScale } from '../src/engine/terrain-overlay.js';

// the label draws its text on a canvas: a stub is enough to check the sprite that comes out
beforeAll(() => {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        measureText: (s) => ({ width: s.length * 15 }),
        beginPath() {},
        moveTo() {},
        arcTo() {},
        fill() {},
        fillText() {},
      }),
    }),
  };
});

const flat = () => 10;
const RING = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe('ground editor overlay', () => {
  it('keeps a label the same size on screen whatever the zoom', () => {
    expect(screenScale({ zoom: 1 })).toBe(30);
    expect(screenScale({ zoom: 3 })).toBe(10);
    expect(screenScale({})).toBe(30);
  });

  it('builds the label as a sprite drawn over the scene', () => {
    const sp = labelSprite('Muret 1', [1, 2, 3]);
    expect(sp.isSprite).toBe(true);
    expect(sp.position.toArray()).toEqual([1, 2, 3]);
    expect(sp.material.depthTest).toBe(false);
    expect(sp.renderOrder).toBeGreaterThan(1000);
  });

  it('tints the inside of a closed outline, and refuses an open one', () => {
    const m = fillMesh(RING, flat, '#ffffff', 0.2, -0.25);
    expect(m.geometry.getAttribute('position').count).toBe(6); // two triangles
    expect(m.material.opacity).toBe(0.2);
    for (const y of m.geometry.getAttribute('position').array.filter((v, i) => i % 3 === 1)) expect(y).toBeCloseTo(9.75);
    expect(
      fillMesh(
        [
          [0, 0],
          [1, 1],
        ],
        flat,
        '#fff',
      ),
    ).toBeNull();
  });

  it('closes a ring given with its first point repeated', () => {
    expect(fillMesh([...RING, [0, 0]], flat, '#fff').geometry.getAttribute('position').count).toBe(6);
  });

  it('draws the relief a brush would leave, green up and orange down', () => {
    const up = brushPreview(0, 0, 3, flat, (x, z) => 10 + (Math.hypot(x, z) < 3 ? 0.5 : 0), { na: 12, nr: 4 });
    expect(up.mesh.geometry.getAttribute('position').count).toBe(5 * 12);
    expect(up.mesh.geometry.getIndex().count).toBe(4 * 12 * 6);
    expect(up.ring).toHaveLength(12);
    for (const [x, z] of up.ring) expect(Math.hypot(x, z)).toBeCloseTo(3);
    expect(up.dy).toBeCloseTo(0.5);
    expect(up.y0).toBe(10);
    const c = up.mesh.geometry.getAttribute('color');
    expect(c.getY(0)).toBeGreaterThan(c.getX(0)); // raised: green wins over red
    const down = brushPreview(0, 0, 3, flat, () => 9, { na: 12, nr: 4 });
    expect(down.dy).toBeCloseTo(-1);
    const d = down.mesh.geometry.getAttribute('color');
    expect(d.getX(0)).toBeGreaterThan(d.getY(0)); // lowered: red wins over green
  });

  it('lifts the preview just over the ground so it stays visible', () => {
    const pv = brushPreview(0, 0, 2, flat, flat, { na: 8, nr: 2, lift: 0.04 });
    expect(pv.mesh.geometry.getAttribute('position').getY(0)).toBeCloseTo(10.04);
    expect(pv.peak).toBe(0);
    expect(pv.mesh.material.vertexColors).toBe(true);
    expect(pv.mesh.material.side).toBe(THREE.DoubleSide);
  });
});
