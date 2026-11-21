import { describe, it, expect } from 'vitest';
import { normalizeSea, activeSea, seaWaves, swellDirection, axisCoords, tintBeach, BEACHES } from '../src/engine/sea-3d.js';
import { surfVolume } from '../src/engine/sea-sound.js';
import { terrainRange } from '../src/ui-sea.js';

describe('sea', () => {
  it('keeps its settings when off, and cleans them up', () => {
    expect(normalizeSea(undefined)).toBeNull();
    expect(normalizeSea('x')).toBeNull();
    expect(normalizeSea({ level: 3 })).toMatchObject({ on: false, level: 3 });
    expect(activeSea(normalizeSea({ level: 3 }))).toBeNull();
    expect(activeSea(null)).toBeNull();
    expect(normalizeSea({ on: true })).toEqual({
      on: true,
      level: 0,
      beach: 'sand',
      waves: 0.5,
      tide: 0,
      clarity: 0.5,
      sound: false,
      tideRef: null,
    });
    expect(activeSea(normalizeSea({ on: true, sound: 1 }))).toMatchObject({ on: true, sound: true });
    const s = normalizeSea({ on: true, level: '-0.8', beach: 'lava', waves: 7, tide: -2, clarity: 'x' });
    expect(s).toMatchObject({ level: -0.8, beach: 'sand', waves: 1, tide: 0, clarity: 0.5 });
    for (const b of BEACHES) expect(normalizeSea({ on: true, beach: b }).beach).toBe(b);
  });
  it('raises the sea with the wind and steers the swell with its bearing', () => {
    expect(seaWaves(0.5, 0.15)).toBeCloseTo(0.5);
    expect(seaWaves(0.5, 0.9)).toBeGreaterThan(0.9);
    expect(seaWaves(0.1, 0)).toBe(0);
    expect(seaWaves(0.9, 1)).toBe(1);
    const [x, z] = swellDirection(0); // wind from the north blows toward the south
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(1);
    expect(swellDirection(270)[0]).toBeCloseTo(1); // from the west: toward the east
    expect(surfVolume(0)).toBeLessThan(surfVolume(1));
    expect(surfVolume(5)).toBe(surfVolume(1));
  });
  it('reads the altitudes of the terrain to help choosing the level', () => {
    expect(terrainRange(null)).toBeNull();
    expect(terrainRange({ z: [] })).toBeNull();
    const t = { origin: [0, 0], step: 1, nx: 2, nz: 2, z: [5, 4, 3, 2], center: [1, 1] };
    expect(terrainRange(t)).toEqual({ low: 2, house: 2 });
    expect(terrainRange({ ...t, center: undefined })).toEqual({ low: 2, house: null });
    expect(terrainRange({ ...t, center: [9, 9] })).toEqual({ low: 2, house: null });
  });
  it('lays a grid dense over the terrain, stretched to the horizon', () => {
    const xs = axisCoords(-100, 100, 2);
    expect(xs.length).toBeGreaterThan(101);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBeLessThan(-1000);
    expect(xs.at(-1)).toBeGreaterThan(1000);
    expect(xs).toContain(-100);
    expect(xs).toContain(100);
  });
  it('turns the ground around the waterline into beach, leaves steep and high ground alone', () => {
    // three vertices: under the water, 1 m above on flat ground, 1 m above on a steep slope; a fourth 20 m above
    const pos = [0, -1, 0, 1, 1, 0, 2, 1, 0, 3, 20, 0];
    const nrm = [0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0];
    const col = new Array(12).fill(0.2);
    tintBeach(pos, nrm, col, 0, 'sand');
    expect(col[0]).toBeGreaterThan(0.2); // sandy
    expect(col[3]).toBeGreaterThan(0.2);
    expect(col.slice(6, 9)).toEqual([0.2, 0.2, 0.2]); // too steep
    expect(col.slice(9, 12)).toEqual([0.2, 0.2, 0.2]); // too high
    const none = new Array(12).fill(0.2);
    tintBeach(pos, nrm, none, 0, 'none');
    expect(none.every((v) => v === 0.2)).toBe(true);
  });
});

describe('tide', async () => {
  const { tideLevel, simMs, defaultTideRef } = await import('../src/engine/tide.js');
  const H = 3600000;
  it('peaks at the calibrated high water and is low a quarter of a lunar day later', () => {
    const ref = Date.UTC(2026, 10, 21, 5, 30);
    expect(tideLevel(ref, ref)).toBeGreaterThan(tideLevel(ref - 20 * 60000, ref));
    expect(tideLevel(ref, ref)).toBeGreaterThan(tideLevel(ref + 20 * 60000, ref));
    expect(tideLevel(ref + 6.2 * H, ref)).toBeLessThan(-0.5);
    expect(tideLevel(ref + 12.42 * H, ref)).toBeGreaterThan(0.6);
  });
  it('slides by about 50 minutes a day and stays in range', () => {
    const ref = Date.UTC(2026, 10, 21, 5, 30);
    let max = 0;
    for (let i = 0; i < 24 * 30 * 4; i++) max = Math.max(max, Math.abs(tideLevel(ref + i * 0.25 * H, ref)));
    expect(max).toBeLessThanOrEqual(1);
    // next day the high water is ~50 min later (look for the best instant within the window)
    let best = 0,
      bv = -2;
    for (let m = -180; m <= 180; m += 2) {
      const v = tideLevel(ref + 24 * H + m * 60000, ref);
      if (v > bv) {
        bv = v;
        best = m;
      }
    }
    expect(best).toBeGreaterThan(20);
    expect(best).toBeLessThan(80);
  });
  it('has spring and neap tides over the month', () => {
    const ref = defaultTideRef();
    const range = (t0) => {
      let lo = 2,
        hi = -2;
      for (let i = 0; i < 26; i++) {
        const v = tideLevel(t0 + i * H, null);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    expect(range(ref)).toBeGreaterThan(range(ref + 7.4 * 24 * H));
  });
  it('maps a calendar day and hour to an instant', () => {
    expect(simMs(1, 12.5, 2026)).toBe(new Date(2026, 0, 1, 12, 30).getTime());
  });
});

describe('tide calibration input', async () => {
  const { toLocalInput } = await import('../src/ui-sea.js');
  it('round-trips a local date through a datetime-local value', () => {
    const ms = new Date(2026, 10, 21, 5, 30).getTime();
    expect(toLocalInput(ms)).toBe('2026-11-21T05:30');
    expect(new Date(toLocalInput(ms)).getTime()).toBe(ms);
  });
  it('keeps the calibration in the settings', () => {
    expect(normalizeSea({ on: true, tideRef: '1700000000000' }).tideRef).toBe(1700000000000);
    expect(normalizeSea({ on: true, tideRef: 'x' }).tideRef).toBeNull();
  });
});
