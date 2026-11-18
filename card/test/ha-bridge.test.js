import { describe, it, expect } from 'vitest';
import {
  weatherLive,
  rainSensor,
  applyRain,
  solarClock,
  areaOfEntity,
  mapRoomsToAreas,
  roomLights,
  roomTemps,
  entityLight,
} from '../src/ha-bridge.js';

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

describe('local rain sensor', () => {
  const sensor = (state, attributes = {}) => ({ state, attributes });

  it('reads a rain detector or a rain rate, and ignores what cannot tell', () => {
    expect(rainSensor(sensor('on'))).toEqual({ raining: true, rate: null });
    expect(rainSensor(sensor('off'))).toEqual({ raining: false, rate: null });
    expect(rainSensor(sensor('Raining'))).toEqual({ raining: true, rate: null });
    expect(rainSensor(sensor('dry'))).toEqual({ raining: false, rate: null });
    expect(rainSensor(sensor('2.4', { unit_of_measurement: 'mm/h', device_class: 'precipitation_intensity' }))).toEqual({
      raining: true,
      rate: 2.4,
    });
    expect(rainSensor(sensor('0', { unit_of_measurement: 'mm/h' }))).toEqual({ raining: false, rate: 0 });
    expect(rainSensor(sensor('0.1', { unit_of_measurement: 'in/h' })).rate).toBeCloseTo(2.54);
    expect(rainSensor(sensor('24', { unit_of_measurement: 'mm/d' })).rate).toBeCloseTo(1);
    expect(rainSensor(sensor('1'))).toEqual({ raining: true, rate: 1 }); // helper without unit
    // rain fallen today is not rain falling now
    expect(rainSensor(sensor('12.5', { unit_of_measurement: 'mm', device_class: 'precipitation' }))).toBeNull();
    expect(rainSensor(sensor('80', { unit_of_measurement: '%' }))).toBeNull();
    for (const state of ['unavailable', 'unknown', '', null, undefined]) expect(rainSensor(sensor(state))).toBeNull();
    expect(rainSensor(undefined)).toBeNull();
  });

  it('corrects the rain of the weather service with what falls here', () => {
    const wet = { raining: true, rate: null };
    const dry = { raining: false, rate: null };
    // no sensor (or one that cannot tell): the weather service decides alone
    expect(applyRain({ weather: 'rain', temp: 9 }, null)).toEqual({ weather: 'rain', temp: 9 });
    // it rains here although the service says cloudy or clear
    expect(applyRain({ weather: 'cloudy', temp: 9 }, wet)).toEqual({ weather: 'rain', temp: 9 });
    expect(applyRain({ weather: 'clear', cloud: 0.45 }, wet).weather).toBe('rain');
    expect(applyRain({ weather: 'fog' }, wet).weather).toBe('rain');
    // the service says rain but the garden is dry
    expect(applyRain({ weather: 'rain', temp: 9 }, dry)).toEqual({ weather: 'cloudy', temp: 9 });
    // a gauge cannot tell snow or thunder: kept from the service
    expect(applyRain({ weather: 'snow' }, wet)).toEqual({ weather: 'snow' });
    expect(applyRain({ weather: 'snow' }, dry)).toEqual({ weather: 'snow' });
    expect(applyRain({ weather: 'storm' }, wet).weather).toBe('storm');
    expect(applyRain({ weather: 'storm' }, dry)).toEqual({ weather: 'storm', precip: 0 }); // thunder around, dry here
    expect(applyRain({ weather: 'clear' }, dry)).toEqual({ weather: 'clear' });
    // the sensor alone, without any weather service
    expect(applyRain({}, wet)).toEqual({ weather: 'rain' });
    expect(applyRain({}, dry)).toEqual({ weather: 'clear' });
  });

  it('scales the rain with the measured rate', () => {
    const at = (rate) => applyRain({ weather: 'cloudy' }, { raining: rate > 0, rate });
    expect(at(0.5).precip).toBeCloseTo(0.25); // drizzle
    expect(at(4).precip).toBeCloseTo(0.6);
    expect(at(30).precip).toBe(1); // downpour
    expect(at(0)).toEqual({ weather: 'cloudy' });
    const storm = applyRain({ weather: 'storm' }, { raining: true, rate: 4 });
    expect(storm.weather).toBe('storm');
    expect(storm.precip).toBeCloseTo(0.6);
    expect(applyRain({ weather: 'snow' }, { raining: true, rate: 4 })).toEqual({ weather: 'snow' });
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

describe('roomTemps', () => {
  it('prefers the area temperature sensor, then any temperature sensor of the area', () => {
    const hass = {
      areas: { salon: { area_id: 'salon', temperature_entity_id: 'sensor.t_salon' }, cuisine: { area_id: 'cuisine' } },
      entities: { 'sensor.t_cuisine': { area_id: 'cuisine' }, 'sensor.h_cuisine': { area_id: 'cuisine' } },
      states: {
        'sensor.t_salon': { state: '21.5', attributes: { device_class: 'temperature' } },
        'sensor.h_cuisine': { state: '55', attributes: { device_class: 'humidity' } },
        'sensor.t_cuisine': { state: '19', attributes: { device_class: 'temperature' } },
      },
    };
    expect(roomTemps(hass, { r1: 'salon', r2: 'cuisine', r3: 'garage' })).toEqual({ r1: 21.5, r2: 19 });
  });

  it('ignores unavailable sensors', () => {
    const hass = {
      areas: { a: { area_id: 'a', temperature_entity_id: 'sensor.x' } },
      states: { 'sensor.x': { state: 'unavailable', attributes: {} } },
    };
    expect(roomTemps(hass, { r: 'a' })).toEqual({});
  });
});

describe('placed lights', () => {
  it('entityLight reads state, color and brightness', () => {
    expect(entityLight(null)).toEqual({ on: false });
    expect(entityLight({ state: 'off', attributes: {} })).toEqual({ on: false });
    expect(entityLight({ state: 'on', attributes: { rgb_color: [255, 0, 16], brightness: 255 } })).toEqual({
      on: true,
      color: '#ff0010',
      brightness: 1,
    });
    expect(entityLight({ state: 'on', attributes: {} })).toEqual({ on: true, color: undefined, brightness: 0.9 });
  });

  it('roomLights skips the placed lights', () => {
    const hass = {
      entities: { 'light.a': { area_id: 'salon' }, 'light.b': { area_id: 'salon' } },
      states: { 'light.a': { state: 'on', attributes: {} }, 'light.b': { state: 'off', attributes: {} } },
    };
    expect(roomLights(hass, { r: 'salon' }).r.on).toBe(true);
    expect(roomLights(hass, { r: 'salon' }, null, new Set(['light.a'])).r.on).toBe(false);
  });
});
