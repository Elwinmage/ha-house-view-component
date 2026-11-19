import { describe, it, expect } from 'vitest';
import { bearingDeg, compassIndex, windKmh, windStrength, windDrift, rainLook } from '../src/wind.js';
import { sunDirection } from '../src/sun.js';

describe('bearingDeg', () => {
  it('reads degrees, as a number or a text', () => {
    expect(bearingDeg(0)).toBe(0);
    expect(bearingDeg(270)).toBe(270);
    expect(bearingDeg('135.5')).toBe(135.5);
    expect(bearingDeg('90°')).toBe(90);
    expect(bearingDeg('22,5')).toBe(22.5);
    expect(bearingDeg(360)).toBe(0);
    expect(bearingDeg(-90)).toBe(270);
    expect(bearingDeg(725)).toBe(5);
  });

  it('reads compass points', () => {
    expect(bearingDeg('N')).toBe(0);
    expect(bearingDeg('ne')).toBe(45);
    expect(bearingDeg('ESE')).toBe(112.5);
    expect(bearingDeg('S')).toBe(180);
    expect(bearingDeg('WSW')).toBe(247.5);
    expect(bearingDeg('NNW')).toBe(337.5);
    expect(bearingDeg('North-West')).toBe(315);
    expect(bearingDeg('south east')).toBe(135);
  });

  it('reads the O of the west, or of the east in German and Dutch', () => {
    expect(bearingDeg('O')).toBe(270);
    expect(bearingDeg('NO', 'fr')).toBe(315);
    expect(bearingDeg('SSO', 'es')).toBe(202.5);
    expect(bearingDeg('Nord-Ouest', 'fr')).toBe(315);
    expect(bearingDeg('O', 'de')).toBe(90);
    expect(bearingDeg('NO', 'de-CH')).toBe(45);
    expect(bearingDeg('ZO', 'nl')).toBeNull(); // only the O is translated
  });

  it('gives up on what is not a direction', () => {
    for (const v of [null, undefined, '', '  ', 'unavailable', 'unknown', 'calm', true, false, NaN]) expect(bearingDeg(v)).toBeNull();
  });
});

describe('compassIndex', () => {
  it('picks one of the eight points', () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 338, 359, 360, -45].map(compassIndex)).toEqual([0, 1, 1, 2, 4, 5, 6, 7, 0, 0, 0, 7]);
  });
});

describe('windKmh', () => {
  it('converts the units of Home Assistant', () => {
    expect(windKmh(30)).toBe(30);
    expect(windKmh('30', 'km/h')).toBe(30);
    expect(windKmh(10, 'm/s')).toBeCloseTo(36);
    expect(windKmh(10, 'mph')).toBeCloseTo(16.09, 2);
    expect(windKmh(10, 'kn')).toBeCloseTo(18.52);
    expect(windKmh(10, 'kt')).toBeCloseTo(18.52);
    expect(windKmh(10, 'ft/s')).toBeCloseTo(10.97, 2);
    expect(windKmh(6, 'Bft')).toBeCloseTo(44.2, 1);
    expect(windKmh(0, 'Beaufort')).toBe(0);
    expect(windKmh(12, 'K M / H')).toBe(12);
  });

  it('gives up on what is not a speed', () => {
    for (const v of [null, undefined, '', 'unavailable', -3, true, NaN]) expect(windKmh(v, 'km/h')).toBeNull();
  });
});

describe('windStrength', () => {
  it('maps km/h to 0..1, a gale at 60 km/h', () => {
    expect(windStrength(0)).toBe(0);
    expect(windStrength(30)).toBe(0.5);
    expect(windStrength(90)).toBe(1);
    expect(windStrength(-5)).toBe(0);
  });
});

describe('windDrift', () => {
  const close = ([x, z], [ex, ez]) => {
    expect(x).toBeCloseTo(ex);
    expect(z).toBeCloseTo(ez);
  };

  it('pushes the rain the way the wind blows (x east, z south)', () => {
    close(windDrift(1, 270, 0, 1), [1, 0]); // west wind: to the east
    close(windDrift(1, 90, 0, 1), [-1, 0]); // east wind: to the west
    close(windDrift(1, 0, 0, 1), [0, 1]); // north wind: to the south
    close(windDrift(1, 180, 0, 1), [0, -1]); // south wind: to the north
    close(windDrift(1, 315, 0, 1), [Math.SQRT1_2, Math.SQRT1_2]); // north-west wind: to the south-east
  });

  it('grows with the strength, within bounds', () => {
    close(windDrift(0, 270), [0, 0]);
    close(windDrift(0.5, 270), [0.6, 0]);
    close(windDrift(1, 270), [1.2, 0]);
    close(windDrift(7, 270), [1.2, 0]);
    close(windDrift(-1, 270), [0, 0]);
  });

  it('follows the north of the plan like the sun does', () => {
    // at solar noon the sun is due south: a north wind blows toward it, whatever the orientation of the plan
    for (const north of [0, 30, 90, -45, 200]) {
      const [x, , z] = sunDirection(172, 12, 45, north).dir;
      const len = Math.hypot(x, z);
      close(windDrift(1, 0, north, 1), [x / len, z / len]);
    }
  });
});

describe('rainLook', () => {
  it('makes a drizzle sparse, slow and short, a downpour dense, fast and long', () => {
    const drizzle = rainLook(0.2);
    const pour = rainLook(1);
    for (const k of ['share', 'speed', 'length', 'alpha']) expect(pour[k]).toBeGreaterThan(drizzle[k]);
    expect(pour).toEqual({ share: 1, speed: 1.25, length: 1.4, alpha: 1.15 });
    expect(rainLook(0).share).toBe(0);
  });

  it('keeps the intensity within 0..1', () => {
    expect(rainLook(3)).toEqual(rainLook(1));
    expect(rainLook(-1)).toEqual(rainLook(0));
  });
});
