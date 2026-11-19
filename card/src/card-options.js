// Options of the card as the visual editor (card-editor.js) presents them: defaults, form schema, tidy-up of the
// configuration to save. Pure functions, without any dependency: unit-tested in test/.

/** Options with a default: a value equal to its default is left out of the saved configuration. */
export const DEFAULTS = {
  mode: 'live',
  show_views: true,
  show_levels: true,
  show_entities: true,
  tap_action: 'zoom',
  movable_camera: true,
  height: 'fill',
  min_height: 320,
  fps_cap: 30,
  vacuum_poll: 15,
  vacuum_rate: 1,
  vacuum_show_floor: false,
};

/** ha-form schema of the options, grouped in foldable sections (the keys stay at the top level of the config). */
export function editorSchema(t) {
  const choices = (key, values) => values.map((value) => ({ value, label: t(`ed_${key}_${value}`) }));
  const section = (key, schema, expanded = false) => ({
    type: 'expandable',
    name: key,
    title: t(`ed_sec_${key}`),
    flatten: true,
    expanded,
    schema,
  });
  const number = (name, min, max, step, unit) => ({
    name,
    selector: { number: { min, max, step, mode: 'box', unit_of_measurement: unit } },
  });
  return [
    section(
      'weather',
      [
        { name: 'mode', selector: { select: { mode: 'dropdown', options: choices('mode', ['live', 'simulation']) } } },
        { name: 'weather_entity', selector: { entity: { domain: 'weather' } } },
        { name: 'rain_entity', selector: { entity: { domain: ['binary_sensor', 'sensor'] } } },
        { name: 'wind_speed_entity', selector: { entity: { domain: 'sensor' } } },
        { name: 'wind_bearing_entity', selector: { entity: { domain: 'sensor' } } },
      ],
      true,
    ),
    section('display', [
      { name: 'view', selector: { text: {} } },
      { name: 'show_views', selector: { boolean: {} } },
      { name: 'show_levels', selector: { boolean: {} } },
      { name: 'show_entities', selector: { boolean: {} } },
      {
        name: 'tap_action',
        selector: { select: { mode: 'dropdown', options: choices('tap_action', ['zoom', 'toggle_lights', 'none']) } },
      },
      { name: 'movable_camera', selector: { boolean: {} } },
      {
        name: 'height',
        selector: { select: { mode: 'dropdown', custom_value: true, options: choices('height', ['fill', 'aspect']) } },
      },
      number('min_height', 100, 2000, 10, 'px'),
      number('fps_cap', 5, 60, 1),
    ]),
    section('lights', [{ name: 'light_entities', selector: { entity: { domain: 'light', multiple: true } } }]),
    section('vacuum', [
      { name: 'vacuum_entity', selector: { entity: { domain: 'vacuum' } } },
      { name: 'vacuum_progress_entity', selector: { entity: { domain: 'sensor' } } },
      number('vacuum_poll', 5, 300, 1, 's'),
      number('vacuum_rate', 0.1, 10, 0.1, 'm²/min'),
      { name: 'vacuum_show_floor', selector: { boolean: {} } },
    ]),
  ];
}

/** Values shown by the form: the configuration over the defaults (and over the first names of two options). */
export function formData(config) {
  const data = { ...DEFAULTS, ...config };
  if (config.movable_camera === undefined && config.interactive !== undefined) data.movable_camera = !!config.interactive;
  if (config.show_entities === undefined && config.show_sensors !== undefined) data.show_entities = !!config.show_sensors;
  data.height = String(data.height); // the select works on strings; 600 comes back as a number in cleanConfig
  return data;
}

/** Configuration to save: no empty value, no value equal to its default, `height: "600"` back to a number. */
export function cleanConfig(config) {
  const out = {};
  for (const [key, raw] of Object.entries(config)) {
    let v = raw;
    if (key === 'height' && typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (key in DEFAULTS && v === DEFAULTS[key]) continue;
    out[key] = v;
  }
  // the options renamed since the first versions are saved under their current name only
  if ('movable_camera' in config) delete out.interactive;
  if ('show_entities' in config) delete out.show_sensors;
  return out;
}
