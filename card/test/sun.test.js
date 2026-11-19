import { describe, it, expect } from 'vitest';
import { sunDirection } from '../src/sun.js';

const deg = (rad) => (rad * 180) / Math.PI;

describe('sunDirection', () => {
  it('puts the noon sun in the south, higher in summer than in winter', () => {
    const summer = sunDirection(172, 12, 45);
    const winter = sunDirection(355, 12, 45);
    expect(deg(summer.elevation)).toBeCloseTo(68.4, 0);
    expect(deg(winter.elevation)).toBeCloseTo(21.6, 0);
    for (const s of [summer, winter]) {
      expect(s.dir[0]).toBeCloseTo(0);
      expect(s.dir[2]).toBeGreaterThan(0); // z points south
      expect(Math.hypot(...s.dir)).toBeCloseTo(1);
    }
  });

  it('rises in the east and sets in the west', () => {
    expect(sunDirection(80, 8, 45).dir[0]).toBeGreaterThan(0.5);
    expect(sunDirection(80, 16, 45).dir[0]).toBeLessThan(-0.5);
    expect(sunDirection(80, 0, 45).elevation).toBeLessThan(0);
  });

  it('turns with the north of the plan', () => {
    const turned = sunDirection(172, 12, 45, 90).dir;
    expect(turned[0]).toBeCloseTo(-Math.cos(sunDirection(172, 12, 45).elevation));
    expect(turned[2]).toBeCloseTo(0);
  });
});
