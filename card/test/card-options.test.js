import { describe, expect, it } from 'vitest';

import { DEFAULTS, cleanConfig, editorSchema, formData } from '../src/card-options.js';
import { makeT } from '../src/i18n.js';

const flat = (schema) => schema.flatMap((s) => (s.schema ? flat(s.schema) : [s]));

describe('card option editor', () => {
  it('offers every option of the card, each with a label in French and in English', () => {
    for (const lang of ['fr', 'en']) {
      const t = makeT(lang);
      const schema = editorSchema(t);
      const names = flat(schema).map((s) => s.name);
      expect(names).toEqual([
        'mode',
        'weather_entity',
        'rain_entity',
        'wind_speed_entity',
        'wind_bearing_entity',
        'view',
        'show_views',
        'show_levels',
        'show_entities',
        'show_alarms',
        'tap_action',
        'movable_camera',
        'height',
        'min_height',
        'fps_cap',
        'quality',
        'keep_scene',
        'auto_reload',
        'year_seconds',
        'toolbar_buttons',
        'hide_menu',
        'light_entities',
        'vacuum_entity',
        'vacuum_progress_entity',
        'vacuum_poll',
        'vacuum_rate',
        'vacuum_show_floor',
      ]);
      for (const name of names) expect(t(`ed_${name}`), `${lang} ${name}`).not.toBe(`ed_${name}`);
      for (const s of schema) {
        expect(s.flatten).toBe(true); // sections do not nest the configuration
        expect(s.title).not.toMatch(/^ed_/);
      }
      const options = flat(schema).flatMap((s) => (s.selector.select ? s.selector.select.options : []));
      expect(options.length).toBe(16);
      for (const o of options) expect(o.label).not.toMatch(/^ed_/);
    }
    for (const key of Object.keys(DEFAULTS)) expect(flat(editorSchema(makeT('en'))).map((s) => s.name)).toContain(key);
  });

  it('lets the rain sensor be a detector or a rate sensor', () => {
    const rain = flat(editorSchema(makeT('fr'))).find((s) => s.name === 'rain_entity');
    expect(rain.selector.entity.domain).toEqual(['binary_sensor', 'sensor']);
  });

  it('shows the defaults and the first names of the renamed options', () => {
    const data = formData({ type: 'custom:house-view-card', interactive: false, show_sensors: false, height: 600 });
    expect(data).toMatchObject({ mode: 'live', tap_action: 'zoom', fps_cap: 30, movable_camera: false, show_entities: false });
    expect(data.height).toBe('600');
    expect(formData({ movable_camera: true, interactive: false }).movable_camera).toBe(true);
    expect(formData({}).height).toBe('fill');
  });

  it('saves a tidy configuration', () => {
    const before = { type: 'custom:house-view-card', weather_entity: 'weather.home', interactive: false, show_sensors: false };
    // what ha-form sends back: the whole form, defaults included
    const value = { ...formData(before), rain_entity: 'binary_sensor.rain', weather_entity: '', height: '600', view: ' Jardin ' };
    expect(cleanConfig({ ...before, ...value })).toEqual({
      type: 'custom:house-view-card',
      rain_entity: 'binary_sensor.rain',
      movable_camera: false,
      show_entities: false,
      height: 600,
      view: 'Jardin',
    });
    expect(cleanConfig({ type: 'x', height: '70vh', light_entities: [], vacuum_entity: null, fps_cap: 20 })).toEqual({
      type: 'x',
      height: '70vh',
      fps_cap: 20,
    });
    expect(cleanConfig({ type: 'x', ...DEFAULTS })).toEqual({ type: 'x' });
    expect(cleanConfig({ type: 'x', interactive: false })).toEqual({ type: 'x', interactive: false }); // untouched
  });
});

describe('homes in the editor', () => {
  it('offers the home only when there are several, the first one by default', () => {
    expect(editorSchema((k) => k, [{ id: 'a', title: 'Maison' }])[0].name).not.toBe('home');
    const [home] = editorSchema(
      (k) => k,
      [
        { id: 'a', title: 'Maison' },
        { id: 'b', title: 'Chalet' },
      ],
    );
    expect(home.name).toBe('home');
    expect(home.selector.select.options).toEqual([
      { value: '', label: 'Maison' },
      { value: 'b', label: 'Chalet' },
    ]);
    expect(cleanConfig({ type: 'custom:house-view-card', home: '' })).toEqual({ type: 'custom:house-view-card' });
  });
});
