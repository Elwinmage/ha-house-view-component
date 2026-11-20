import { describe, it, expect } from 'vitest';
import {
  wetWidth,
  SOILS,
  SPRINKLERS,
  sprinklerModel,
  headDefaults,
  dirVec,
  bearing,
  smoothPath,
  spacedPoints,
  isOn,
  irrigationStates,
  buildIrrigation,
} from '../src/irrigation.js';

describe('wetWidth (Schwartzman & Zur)', () => {
  it('matches the values published for the model: 2.5 L/h, Ks 4.7 cm/h -> 30.0 / 34.9 / 38.2 cm after 1 / 2 / 3 h', () => {
    const ks = 0.047 / 3600; // m/s
    expect(wetWidth(60, 2.5, ks)).toBeCloseTo(0.3, 1);
    expect(Math.abs(wetWidth(60, 2.5, ks) - 0.3)).toBeLessThan(0.008);
    expect(Math.abs(wetWidth(120, 2.5, ks) - 0.349)).toBeLessThan(0.008);
    expect(Math.abs(wetWidth(180, 2.5, ks) - 0.382)).toBeLessThan(0.008);
    expect(Math.abs(wetWidth(60, 5, ks) - 0.393)).toBeLessThan(0.01);
  });

  it('grows with time, spreads wider on fine soils, is 0 when closed', () => {
    expect(wetWidth(0)).toBe(0);
    expect(wetWidth(-5)).toBe(0);
    expect(wetWidth(10, 0)).toBe(0);
    expect(wetWidth(60)).toBeGreaterThan(wetWidth(10));
    expect(wetWidth(60, 2, 'clay')).toBeGreaterThan(wetWidth(60, 2, 'loam'));
    expect(wetWidth(60, 2, 'loam')).toBeGreaterThan(wetWidth(60, 2, 'sand'));
    expect(wetWidth(60, 2, 'unknown')).toBe(wetWidth(60, 2, 'loam'));
    expect(wetWidth(1e9, 8, 'clay')).toBe(2); // capped
    expect(Object.keys(SOILS)).toEqual(['sand', 'loam', 'clay']);
  });
});

describe('sprinklers', () => {
  it('has a coherent catalog', () => {
    for (const m of SPRINKLERS) {
      expect(['spray', 'rotor', 'rotator']).toContain(m.kind);
      expect(m.rRange[0]).toBeLessThanOrEqual(m.r);
      expect(m.r).toBeLessThanOrEqual(m.rRange[1]);
      expect(m.arc[0]).toBeLessThan(m.arc[1]);
    }
    expect(new Set(SPRINKLERS.map((m) => m.id)).size).toBe(SPRINKLERS.length);
    expect(sprinklerModel('hunter-psu-04-15a').r).toBe(4.6);
    expect(sprinklerModel('nope').id).toBe('generic-rotor');
  });

  it('pre-fills a head from its model', () => {
    expect(headDefaults('hunter-psu-04-15a')).toEqual({ model: 'hunter-psu-04-15a', rMin: 0.9, rMax: 4.6, dir: 0, arc: 90 });
    const srm = headDefaults('hunter-srm-04');
    expect(srm.rMax).toBe(8.5);
    expect(srm.rMin).toBeGreaterThanOrEqual(2.5); // a rotor leaves the foot of the nozzle dry
    expect(srm.rMin).toBeLessThan(srm.rMax);
    expect(headDefaults('hunter-mp1000').arc).toBe(90);
  });

  it('uses compass directions on the plan (0 = up, clockwise)', () => {
    expect(dirVec(0)[1]).toBeCloseTo(-1);
    expect(dirVec(90)[0]).toBeCloseTo(1);
    expect(bearing([0, 0], [0, -5])).toBeCloseTo(0);
    expect(bearing([0, 0], [5, 0])).toBeCloseTo(90);
    expect(bearing([0, 0], [0, 5])).toBeCloseTo(180);
    expect(bearing([0, 0], [-5, 0])).toBeCloseTo(270);
  });
});

describe('drip lines', () => {
  it('rounds the path through the points and spaces the emitters', () => {
    expect(smoothPath([[1, 2]])).toEqual([[1, 2]]);
    const two = smoothPath(
      [
        [0, 0],
        [3, 0],
      ],
      0.5,
    );
    expect(two).toHaveLength(7);
    const pts = [
      [0, 0],
      [5, 0],
      [5, 5],
    ];
    const p = smoothPath(pts, 0.2);
    expect(p[0][0]).toBeCloseTo(0);
    expect(p[p.length - 1][0]).toBeCloseTo(5);
    expect(p[p.length - 1][1]).toBeCloseTo(5);
    const mid = p.reduce((b, q) => (Math.hypot(q[0] - 5, q[1]) < Math.hypot(b[0] - 5, b[1]) ? q : b));
    expect(Math.hypot(mid[0] - 5, mid[1])).toBeLessThan(0.2); // goes through the corner point
    const em = spacedPoints(two, 0.3);
    expect(em).toHaveLength(10);
    expect(em[0][0]).toBeCloseTo(0.15);
    expect(spacedPoints([[0, 0]], 0.3)).toEqual([]);
  });

  it('reads the valve states, with editor previews', () => {
    const irr = { lines: [{ id: 'l1', entity: 'switch.a' }, { id: 'l2' }], circuits: [{ id: 'c1', entity: 'valve.b' }] };
    const states = { 'switch.a': { state: 'on', last_changed: '2026-11-18T10:00:00Z' }, 'valve.b': { state: 'closed', last_changed: 'x' } };
    const now = Date.parse('2026-11-18T10:30:00Z');
    const s = irrigationStates(irr, states, null, now);
    expect(s.l1).toEqual({ on: true, since: Date.parse('2026-11-18T10:00:00Z') });
    expect(s.l2).toEqual({ on: false, since: now });
    expect(s.c1).toEqual({ on: false, since: now });
    expect(irrigationStates(irr, states, new Set(['c1']), now, { c1: 5 }).c1).toEqual({ on: true, since: 5 });
    expect(irrigationStates(irr, states, new Set(['l2']), now).l2).toEqual({ on: true, since: now });
    expect(irrigationStates({}, states, null, now)).toEqual({});
    expect(isOn({ state: 'open' })).toBe(true);
    expect(isOn(null)).toBe(false);
  });
});

describe('buildIrrigation', () => {
  const irr = {
    lines: [
      {
        id: 'l1',
        color: 'none',
        flow: 2,
        spacing: 0.3,
        pts: [
          [0, 0],
          [6, 0],
          [6, 3],
        ],
      },
      { id: 'short', pts: [[0, 0]] },
    ],
    circuits: [
      {
        id: 'c1',
        heads: [
          { id: 'h1', model: 'hunter-srm-04', at: [10, 10], rMin: 1, rMax: 8, dir: 90, arc: 90 },
          { id: 'h2', model: 'hunter-psu-04-15a', at: [0, 10], rMin: 0.3, rMax: 4.6, dir: 0, arc: 360 },
          { id: 'h3', model: 'hunter-mp2000', at: [5, 10], rMin: 1, rMax: 5, dir: 180, arc: 180 },
          { id: 'unplaced', model: 'generic-rotor', at: null },
        ],
      },
    ],
  };
  const build = () =>
    buildIrrigation(
      irr,
      () => (x, z) => [x, z],
      () => 0,
    );

  it('shows nothing when the valves are closed (pipe hidden when its color is "none")', () => {
    const w = build();
    expect(w.count).toBe(4);
    expect(w.update({}, 1000)).toBe(false);
    const [tube, spots] = w.group.children;
    expect(tube.visible).toBe(false);
    expect(spots.visible).toBe(false);
    expect(w.group.children.filter((c) => c.isPoints).every((c) => !c.visible)).toBe(true);
    w.update({}, 1000, { editing: true });
    expect(tube.visible).toBe(true); // the editor shows hidden pipes and the sectors
    expect(w.group.children.filter((c) => c.material && c.material.opacity === 0.1 && c.visible)).toHaveLength(3);
  });

  it('wets the ground while a line is on, then lets it dry', () => {
    const w = build();
    const [tube, spots] = w.group.children;
    const t0 = 1e9;
    expect(w.update({ l1: { on: true, since: t0 - 60 * 60000 } }, t0, { soil: 'loam' })).toBe(true);
    expect(tube.visible).toBe(true);
    expect(tube.material.color.getHexString()).toBe('2f8fff');
    expect(spots.visible).toBe(true);
    expect(spots.count).toBeGreaterThan(25);
    expect(w.update({ l1: { on: false, since: t0 } }, t0 + 60000)).toBe(true); // still drying
    expect(spots.visible).toBe(true);
    expect(tube.visible).toBe(false);
    expect(w.update({ l1: { on: false, since: t0 } }, t0 + 31 * 60000)).toBe(false);
    expect(spots.visible).toBe(false);
  });

  it('makes an open line shimmer: glints run in the pipe and a drop swells and shrinks under each emitter', () => {
    const w = build();
    const [tube, spots, beads] = w.group.children;
    const size = (k) => beads.instanceMatrix.array[k * 16]; // x scale of the instance = diameter of drop k
    const on = { l1: { on: true, since: 0 } };
    w.update({}, 10000);
    expect(beads.visible).toBe(false);
    expect(tube.material.emissiveIntensity).toBe(0);

    w.update(on, 10000);
    expect(beads.visible).toBe(true);
    expect(beads.count).toBe(spots.count);
    expect(tube.material.emissiveIntensity).toBeGreaterThan(0.5);
    const first = [size(0), size(1), size(7)];
    const glint = tube.material.emissiveMap.offset.x;
    w.update(on, 10400);
    expect([size(0), size(1), size(7)]).not.toEqual(first);
    expect(tube.material.emissiveMap.offset.x).not.toBe(glint);

    // over two pulses every drop goes from small to large without ever touching its neighbours (spacing 0.3 m)
    const lo = Array(beads.count).fill(9);
    const hi = Array(beads.count).fill(0);
    for (let t = 0; t <= 3000; t += 50) {
      w.update(on, 20000 + t);
      for (let k = 0; k < beads.count; k++) {
        lo[k] = Math.min(lo[k], size(k));
        hi[k] = Math.max(hi[k], size(k));
      }
    }
    expect(Math.min(...lo)).toBeGreaterThan(0.06);
    expect(Math.max(...lo)).toBeLessThan(0.08);
    expect(Math.min(...hi)).toBeGreaterThan(0.2);
    expect(Math.max(...hi)).toBeLessThan(0.3);
    w.update(on, 30000);
    expect(new Set(Array.from({ length: 8 }, (_, k) => size(k).toFixed(3))).size).toBeGreaterThan(4); // not in unison

    w.update({ l1: { on: false, since: 0 } }, 31000);
    expect(beads.visible).toBe(false); // the drops stop with the valve; only the wet ground stays while it dries
    expect(tube.material.emissiveIntensity).toBe(0);
    expect(spots.visible).toBe(true);
    w.update(on, 32000);
    w.reset();
    expect(beads.visible).toBe(false);
    expect(tube.material.emissiveIntensity).toBe(0);
  });

  it('forgets the wet ground at the end of a test', () => {
    const w = build();
    const spots = w.group.children[1];
    const t0 = 1e9;
    w.update({ l1: { on: true, since: t0 - 3600000 } }, t0);
    w.update({ l1: { on: false, since: t0 } }, t0 + 1000);
    expect(spots.visible).toBe(true); // drying
    w.reset();
    expect(spots.visible).toBe(false);
    expect(w.group.children[0].material.color.getHexString()).toBe('1b1b1b'); // pipe back to its own color
    expect(w.update({ l1: { on: false, since: t0 } }, t0 + 2000)).toBe(false);
    expect(spots.visible).toBe(false);
    w.update({ l1: { on: true, since: t0 } }, t0 + 3000); // a valve really open shows again
    expect(w.group.children[0].material.color.getHexString()).toBe('2f8fff');
  });

  it('animates the jets of a circuit that is on', () => {
    const w = build();
    const drops = w.group.children.filter((c) => c.isPoints);
    expect(drops).toHaveLength(3);
    expect(w.update({ c1: { on: true, since: 0 } }, 5000)).toBe(true);
    expect(drops.every((d) => d.visible)).toBe(true);
    const p = drops[0].geometry.attributes.position.array;
    const far = Math.max(...Array.from({ length: p.length / 3 }, (_, i) => Math.hypot(p[i * 3] - 10, p[i * 3 + 2] - 10)));
    expect(far).toBeLessThanOrEqual(8.001); // the rotor jet stays within its range
    expect(far).toBeGreaterThan(4);
    const before = Array.from(p.slice(0, 6));
    w.update({ c1: { on: true, since: 0 } }, 5400);
    expect(Array.from(p.slice(0, 6))).not.toEqual(before);
  });

  it('lands the water inside the band [rMin, rMax], never from the nozzle', () => {
    const w = build();
    const drops = w.group.children.filter((c) => c.isPoints);
    w.update({ c1: { on: true, since: 0 } }, 5000);
    for (const [idx, [cx, cz, rMin, rMax]] of [
      [10, 10, 1, 8],
      [0, 10, 0.3, 4.6],
      [5, 10, 1, 5],
    ].entries()) {
      const p = drops[idx].geometry.attributes.position.array;
      const half = p.length / 6; // flying drops, then their impacts
      let landed = 0;
      for (let i = half; i < half * 2; i++) {
        const d = Math.hypot(p[i * 3] - cx, p[i * 3 + 2] - cz);
        if (d < 1e-6) continue; // parked under the nozzle (no impact at that moment)
        landed++;
        expect(d).toBeGreaterThanOrEqual(rMin - 1e-6);
        expect(d).toBeLessThanOrEqual(rMax + 1e-6);
      }
      expect(landed).toBeGreaterThan(0);
    }
  });

  it('draws the edges of the watered band, shown with the sector', () => {
    const w = build();
    const outlines = w.group.children.filter((c) => c.isLineSegments);
    expect(outlines).toHaveLength(3);
    w.update({ c1: { on: false, since: 0 } }, 5000, { editing: true });
    expect(outlines.every((o) => o.visible)).toBe(true);
    w.update({ c1: { on: false, since: 0 } }, 5000, {});
    expect(outlines.some((o) => o.visible)).toBe(false);
  });
});
