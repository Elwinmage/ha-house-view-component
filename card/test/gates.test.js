import { describe, it, expect } from 'vitest';
import {
  normalizeGate,
  placeGate,
  cutFence,
  topAt,
  leavesOf,
  gateOpenness,
  gatesOf,
  gatePlacement,
  buildGates,
  archRise,
  GATE_TRAVEL,
} from '../src/gates.js';
import { normalizeFence, buildFence } from '../src/fences.js';

const fence = (extra = {}) => ({
  pts: [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
  closed: false,
  segs: [
    { s: 'mesh', h: 1.5 },
    { s: 'wood', h: 1.8 },
  ],
  ...extra,
});
const anchor = () => (x, z) => [x, z];

describe('gates', () => {
  it('normalizes: defaults and bounds', () => {
    expect(normalizeGate(null)).toMatchObject({
      id: '',
      f: 0,
      at: [0, 0],
      w: 3,
      open: 'swing2',
      fill: 'bars',
      top: 'straight',
      pillars: true,
      h: 1.6,
      entity: '',
      hidden: false,
    });
    const c = normalizeGate({
      id: 'a',
      f: 2,
      at: [1, 2],
      w: 50,
      open: 'nope',
      fill: 'full',
      top: 'arch',
      pillars: false,
      c: '#ABCDEF',
      h: 9,
      entity: 'cover.g',
      flip: 1,
      hidden: 1,
    });
    expect(c).toMatchObject({
      id: 'a',
      f: 2,
      at: [1, 2],
      w: 12,
      open: 'swing2',
      fill: 'full',
      top: 'arch',
      pillars: false,
      c: '#ABCDEF',
      h: 3,
      entity: 'cover.g',
      flip: true,
      mirror: false,
      hidden: true,
    });
    expect(normalizeGate({ c: 'bad', w: 0.1, f: -1, at: [NaN, 1] })).toMatchObject({ c: '#2b2b2b', w: 0.6, f: 0, at: [0, 0] });
  });

  it('places a gate on the nearest side, kept inside it, width fitted', () => {
    const fe = normalizeFence(fence());
    const p = placeGate(normalizeGate({ at: [5, 0.5], w: 2 }), fe);
    expect(p).toMatchObject({ i: 0, t: 0.5, L: 10, w: 2 });
    expect(p.x).toBeCloseTo(5);
    expect(placeGate(normalizeGate({ at: [0.1, 0], w: 4 }), fe).t).toBeCloseTo(0.2); // pushed away from the end
    expect(placeGate(normalizeGate({ at: [10, 9], w: 50 }), fe)).toMatchObject({ i: 1, w: 10 });
    expect(placeGate(normalizeGate({ at: [50, 50] }), fe)).toBeNull(); // too far
    expect(placeGate(normalizeGate({ at: [0, 0] }), { pts: [[0, 0]], closed: false, segs: [] })).toBeNull();
    expect(
      placeGate(
        normalizeGate({ at: [0, 0] }),
        normalizeFence({
          pts: [
            [0, 0],
            [0.1, 0],
          ],
          closed: false,
          segs: [{ s: 'mesh' }],
        }),
      ),
    ).toBeNull(); // side too short
  });

  it('opens the fence under its gates, several per side', () => {
    const fe = normalizeFence(fence());
    const cut = cutFence(fe, [
      { i: 0, t: 0.8, w: 2 },
      { i: 0, t: 0.2, w: 2 },
      { i: 0, t: 0.25, w: 2 }, // overlaps the previous one
    ]);
    expect(cut.segs.map((s) => s.s)).toEqual(['mesh', 'none', 'mesh', 'none', 'mesh', 'wood']);
    expect(cut.pts[1][0]).toBeCloseTo(1);
    expect(cutFence(fe, [])).toBe(fe);
    // a gate reaching the end of the side leaves a zero-length piece, ignored by the fence
    const end = cutFence(fe, [{ i: 1, t: 0.9, w: 2 }]);
    expect(end.segs.map((s) => s.s)).toEqual(['mesh', 'wood', 'none', 'wood']);
    expect(end.pts).toHaveLength(5);
    // closed fence
    const closed = normalizeFence({
      pts: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      closed: true,
      segs: [{ s: 'mesh' }, { s: 'mesh' }, { s: 'mesh' }],
    });
    const cc = cutFence(closed, [{ i: 2, t: 0.5, w: 1 }]);
    expect(cc.pts.length).toBe(cc.segs.length);
    // the opened fence is really drawn with a gap
    const xs = (f) => {
      const out = [];
      buildFence(f, anchor(), () => 0).traverse((o) => {
        const pos = o.isMesh && !o.isInstancedMesh && o.geometry.attributes.position;
        for (let k = 0; pos && k < pos.count; k++) if (Math.abs(pos.getZ(k)) < 0.1) out.push(pos.getX(k));
      });
      return out;
    };
    expect(xs(fe).some((x) => x > 1.1 && x < 2.9)).toBe(true);
    expect(xs(cut).some((x) => x > 1.1 && x < 2.9)).toBe(false);
  });

  it('has a flat or arched top', () => {
    expect(topAt({ top: 'straight', h: 1.6, w: 3 }, 1)).toBe(1.6);
    const a = { top: 'arch', h: 1.6, w: 3 };
    expect(topAt(a, 0)).toBeCloseTo(1.6);
    expect(topAt(a, 1.5)).toBeCloseTo(1.6 - archRise(3));
  });

  it('has the leaves of each opening type', () => {
    const n = (open) => leavesOf({ open, w: 4 });
    expect(n('swing2').map((l) => l.pivot)).toEqual([-2, 2]);
    expect(n('swing1')).toHaveLength(1);
    expect(n('slide1')[0]).toMatchObject({ mode: 'slide', shift: 4 });
    expect(n('slide2').map((l) => l.shift)).toEqual([-2, 2]);
  });

  it('turns the opening toward the other side, and the single leaf toward the other end', () => {
    const base = { w: 4 };
    expect(leavesOf({ ...base, open: 'swing2', flip: true }).map((l) => l.sign)).toEqual([-1, 1]);
    expect(leavesOf({ ...base, open: 'swing1' })[0]).toMatchObject({ pivot: -2, sign: 1 });
    expect(leavesOf({ ...base, open: 'swing1', mirror: true })[0]).toMatchObject({ pivot: 2, sign: -1 });
    expect(leavesOf({ ...base, open: 'swing1', mirror: true, flip: true })[0]).toMatchObject({ pivot: 2, sign: 1 });
    expect(leavesOf({ ...base, open: 'slide1', mirror: true })[0].shift).toBe(-4);
    expect(leavesOf({ ...base, open: 'slide1', flip: true })[0].z).toBeLessThan(0);
    expect(leavesOf({ ...base, open: 'slide2', flip: true }).map((l) => l.z)).toEqual([-0.12, 0.12]);
  });

  it('reads the opening of a cover or of a contact', () => {
    const states = {
      'cover.a': { state: 'open', attributes: { current_position: 40 } },
      'cover.b': { state: 'open', attributes: {} },
      'binary_sensor.c': { state: 'on', attributes: {} },
      'light.d': { state: 'on', attributes: {} },
    };
    expect(gateOpenness('cover.a', states)).toBeCloseTo(0.4);
    expect(gateOpenness('cover.b', states)).toBe(1);
    expect(gateOpenness('binary_sensor.c', states)).toBe(1);
    expect(gateOpenness('light.d', states)).toBe(0);
    expect(gateOpenness('', states)).toBe(0);
    expect(gateOpenness('cover.a', null)).toBe(0);
  });

  it('lists the visible gates lying on a visible fence', () => {
    const fences = [fence(), fence({ hidden: true })];
    const gates = [
      { id: 'a', f: 0, at: [5, 0], w: 2 },
      { id: 'b', f: 0, at: [10, 5], w: 2 },
      { id: 'hid', f: 0, at: [5, 0], hidden: true },
      { id: 'onhidden', f: 1, at: [5, 0] },
      { id: 'nofence', f: 7, at: [5, 0] },
      { id: 'far', f: 0, at: [90, 90] },
      { f: 0, at: [2, 0] },
    ];
    const list = gatesOf(gates, fences, normalizeFence);
    expect(list.map((x) => x.key)).toEqual(['a', 'b', 'g6']);
    expect(list[1]).toMatchObject({ f: 0, i: 1 });
    expect(gatesOf(null, null, normalizeFence)).toEqual([]);
  });

  it('places the gate on its side', () => {
    const p = gatePlacement([10, 0], [10, 10], { t: 0.3 });
    expect(p).toMatchObject({ x: 10, z: 3, L: 10 });
    expect(p.rot).toBeCloseTo(-Math.PI / 2);
  });

  it('builds every kind of gate and animates it to its target', () => {
    const fences = [fence()];
    for (const open of ['swing2', 'swing1', 'slide1', 'slide2'])
      for (const fill of ['bars', 'full', 'mixed'])
        for (const top of ['straight', 'arch']) {
          const gates = buildGates(
            [
              { id: 'x', f: 0, at: [5, 0], open, fill, top, w: 3 },
              { id: 'y', f: 0, at: [10, 5], pillars: false },
            ],
            fences,
            anchor,
            () => 0,
            normalizeFence,
          );
          expect(gates.count).toBe(2);
          expect(gates.group.children).toHaveLength(2);
        }
    const gates = buildGates(
      [
        { id: 'p', f: 0, at: [5, 0], open: 'swing2' },
        { id: 'q', f: 0, at: [10, 5], open: 'slide1' },
      ],
      fences,
      anchor,
      () => 0,
      normalizeFence,
    );
    expect(gates.keys).toEqual(['p', 'q']);
    expect(gates.openOf('p')).toBe(0);
    expect(gates.openOf('zz')).toBeNull();
    expect(gates.tick(1)).toBe(false);
    gates.set({ p: 1, q: 2 });
    expect(gates.tick(GATE_TRAVEL / 2)).toBe(true);
    expect(gates.openOf('p')).toBeCloseTo(0.5);
    expect(gates.tick(GATE_TRAVEL)).toBe(true);
    expect(gates.openOf('p')).toBe(1);
    expect(gates.openOf('q')).toBe(1);
    expect(gates.tick(0.01)).toBe(false);
    gates.set({});
    gates.tick(GATE_TRAVEL * 2);
    expect(gates.openOf('p')).toBe(0);
    const leaf = gates.group.children[0].children.filter((c) => c.isGroup);
    expect(leaf).toHaveLength(2);
    expect(leaf[0].rotation.y).toBeCloseTo(0);
  });
});
