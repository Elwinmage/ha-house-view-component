import { describe, it, expect } from 'vitest';
import { climateFor, seasonBlend, seasonsOf, seasonKey, seasonDay, doyToDate, dateToDoy } from '../src/climate.js';

describe('climate and seasons', () => {
  it('tells the zones apart', () => {
    expect(climateFor(43.6).zone).toBe('temperate');
    expect(climateFor(-33.9).zone).toBe('temperate');
    expect(climateFor(5).zone).toBe('tropical');
    expect(climateFor(-12).zone).toBe('tropical');
    expect(climateFor(65).zone).toBe('polar');
    expect(climateFor(-78).zone).toBe('polar');
    expect(climateFor(undefined).lat).toBe(45);
  });

  it('keeps the temperate seasons of the north as they were', () => {
    const c = climateFor(45);
    expect(seasonBlend(200, c)).toMatchObject({ from: 'spring', to: 'summer', t: 1 });
    expect(seasonBlend(105, c)).toMatchObject({ from: 'winter', to: 'spring', t: 1 });
    expect(seasonBlend(5, c).from).toBe('autumn');
    expect(seasonKey(15, c)).toBe('winter');
    expect(seasonKey(110, c)).toBe('spring');
  });

  it('reverses the southern hemisphere', () => {
    const c = climateFor(-35);
    expect(seasonKey(20, c)).toBe('summer');
    expect(seasonKey(200, c)).toBe('winter');
    expect(seasonDay('summer', c)).toBeLessThan(40);
  });

  it('gives the far north a long winter and a short summer', () => {
    const c = climateFor(68);
    const winter = Array.from({ length: 365 }, (_, i) => seasonKey(i + 1, c)).filter((k) => k === 'winter').length;
    const temperate = Array.from({ length: 365 }, (_, i) => seasonKey(i + 1, climateFor(45))).filter((k) => k === 'winter').length;
    expect(winter).toBeGreaterThan(temperate + 60);
    expect(seasonKey(120, c)).toBe('winter'); // still winter at the end of April
    expect(seasonKey(200, c)).toBe('summer');
    const w = seasonDay('winter', c);
    expect(w < 60 || w > 330).toBe(true); // the middle of a winter that wraps around the new year
    expect(seasonsOf(c)).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });

  it('has a wet and a dry season between the tropics, never a winter', () => {
    const c = climateFor(15);
    expect(seasonsOf(c)).toEqual(['wet', 'dry']);
    for (let d = 1; d <= 365; d += 7) {
      const s = seasonBlend(d, c);
      expect(s.from).toBe('summer');
      expect(s.t).toBeLessThanOrEqual(c.amp + 1e-9);
    }
    expect(seasonKey(45, c)).toBe('dry');
    expect(seasonKey(230, c)).toBe('wet');
    expect(seasonDay('dry', c)).toBe(45);
    expect(seasonDay('wet', c)).toBe(227);
    const s = climateFor(-15);
    expect(seasonKey(45, s)).toBe('wet');
    expect(seasonDay('wet', s)).toBe(44);
    // weaker near the equator
    expect(climateFor(1).amp).toBeLessThan(c.amp);
  });
});

describe('a day of the calendar and the date of an input', () => {
  const year = new Date().getFullYear();

  it('reads and writes the same day', () => {
    expect(doyToDate(1)).toBe(`${year}-01-01`);
    expect(dateToDoy(`${year}-01-01`)).toBe(1);
    expect(dateToDoy(`${year}-12-31`)).toBe(365); // the last day of a leap year is held at 365, as the seasons are
    for (const doy of [1, 60, 172, 200, 365]) expect(dateToDoy(doyToDate(doy))).toBe(doy);
  });

  it('stays in the year, whatever it is given', () => {
    expect(dateToDoy('1999-12-31')).toBe(365);
    expect(dateToDoy('')).toBeNull();
    expect(dateToDoy('not a date')).toBeNull();
  });
});
