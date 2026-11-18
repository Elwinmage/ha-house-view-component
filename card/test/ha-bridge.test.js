import { describe, it, expect } from 'vitest';
import { weatherLive, solarClock, areaOfEntity, mapRoomsToAreas, roomLights } from '../src/ha-bridge.js';

describe('weatherLive', () => {
  it('maps conditions and measured values', () => {
    expect(weatherLive({ state: 'rainy', attributes: { temperature: 9, wind_speed: 30, cloud_coverage: 90 } })).toEqual({
      weather: 'rain',
      temp: 9,
      wind: 0.5,
      cloud: 0.9,
    });
    expect(weatherLive({ state: 'partlycloudy', attributes: {} })).toEqual({ weather: 'clear', cloud: 0.45 });
    expect(weatherLive(null)).toEqual({});
    expect(weatherLive({ state: 'unknown', attributes: {} })).toEqual({});
  });
});

describe('solarClock', () => {
  it('shifts by longitude', () => {
    const d = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(solarClock(d, 0).hour).toBeCloseTo(12);
    expect(solarClock(d, 15).hour).toBeCloseTo(13);
    expect(solarClock(d, -30).hour).toBeCloseTo(10);
    expect(solarClock(d, 0).doy).toBe(172);
  });
  it('wraps around midnight', () => {
    expect(solarClock(new Date(Date.UTC(2026, 0, 1, 23, 0, 0)), 30).hour).toBeCloseTo(1);
  });
});

describe('rooms and lights', () => {
  const hass = {
    areas: { salon: { area_id: 'salon', name: 'Salon' }, cuisine: { area_id: 'cuisine', name: 'Cuisine' } },
    devices: { d1: { area_id: 'cuisine' } },
    entities: { 'light.a': { area_id: 'salon' }, 'light.b': { device_id: 'd1' }, 'light.c': { area_id: 'salon' } },
    states: {
      'light.a': { state: 'on', attributes: { brightness: 255, rgb_color: [255, 200, 100] } },
      'light.b': { state: 'off', attributes: {} },
      'light.c': { state: 'on', attributes: { brightness: 51 } },
      'switch.x': { state: 'on', attributes: {} },
    },
  };
  it('resolves areas through devices', () => {
    expect(areaOfEntity(hass, 'light.b')).toBe('cuisine');
    expect(areaOfEntity(hass, 'light.zzz')).toBeNull();
  });
  it('maps rooms by name, ignoring accents and case, explicit mapping wins', () => {
    const rooms = [
      { id: 'r1', name: 'SALON' },
      { id: 'r2', name: 'Cuisine' },
      { id: 'r3', name: 'Chambre' },
      { id: 'r4', name: 'x' },
    ];
    expect(mapRoomsToAreas(rooms, hass.areas, { r4: 'salon' })).toEqual({ r1: 'salon', r2: 'cuisine', r4: 'salon' });
  });
  it('aggregates lights per room', () => {
    const res = roomLights(hass, { r1: 'salon', r2: 'cuisine' });
    expect(res.r1.on).toBe(true);
    expect(res.r1.color).toBe('#ffc864');
    expect(res.r1.brightness).toBeCloseTo(0.6);
    expect(res.r2).toEqual({ on: false });
    expect(roomLights(hass, { r1: 'salon' }, ['light.c']).r1.color).toBeUndefined();
  });
});
