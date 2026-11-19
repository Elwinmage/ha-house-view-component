// Demo home: the Home Assistant areas and entities simulated by the card (no entity is created in Home Assistant).
// Shared by the generator of the demo files (scripts/make-demo.mjs) and the simulator (demo.js). Pure data.

/** Areas, named like the rooms of the demo plan (rooms and areas match by name). */
export const DEMO_AREAS = [
  ['sejour', 'Séjour'],
  ['cuisine', 'Cuisine'],
  ['entree', 'Entrée'],
  ['wc', 'WC'],
  ['buanderie', 'Buanderie'],
  ['bureau', 'Bureau'],
  ['escalier', 'Escalier'],
  ['garage', 'Garage'],
  ['chambre_1', 'Chambre 1'],
  ['chambre_2', 'Chambre 2'],
  ['chambre_3', 'Chambre 3'],
  ['couloir', 'Couloir'],
  ['salle_de_bain', 'Salle de bain'],
  ['chambre_parentale', 'Chambre parentale'],
  ['jardin', 'Jardin'],
];

const T = (area, v) => [
  `sensor.${area}_temperature`,
  area,
  `${v}`,
  { device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' },
];
const H = (area, v) => [
  `sensor.${area}_humidite`,
  area,
  `${v}`,
  { device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement' },
];
const L = (area) => [`light.${area}`, area, 'off', { brightness: 200, color_mode: 'brightness', supported_color_modes: ['brightness'] }];
const SHUT = (area, name = 'volet') => [
  `cover.${area}_${name}`,
  area,
  'open',
  { device_class: 'shutter', current_position: 100, supported_features: 15 },
];
const WIN = (area, name = 'fenetre') => [`binary_sensor.${area}_${name}`, area, 'off', { device_class: 'window' }];

/** [entity_id, area, state, attributes] of every simulated entity; friendly names are added by the simulator. */
export const DEMO_ENTITIES = [
  ...[
    'sejour',
    'cuisine',
    'entree',
    'wc',
    'buanderie',
    'bureau',
    'escalier',
    'garage',
    'chambre_1',
    'chambre_2',
    'chambre_3',
    'couloir',
    'salle_de_bain',
    'chambre_parentale',
  ].map(L),
  ['light.terrasse', 'jardin', 'off', { brightness: 255, color_mode: 'brightness', supported_color_modes: ['brightness'] }],
  T('sejour', 21.4),
  T('cuisine', 22.1),
  T('bureau', 20.6),
  T('chambre_1', 19.2),
  T('chambre_2', 19.5),
  T('chambre_3', 18.9),
  T('chambre_parentale', 19.8),
  T('salle_de_bain', 23.0),
  H('sejour', 48),
  H('salle_de_bain', 64),
  H('chambre_1', 51),
  H('chambre_parentale', 50),
  ['sensor.sejour_co2', 'sejour', '612', { device_class: 'carbon_dioxide', unit_of_measurement: 'ppm', state_class: 'measurement' }],
  ['sensor.exterieur_temperature', 'jardin', '14.5', { device_class: 'temperature', unit_of_measurement: '°C' }],
  ['sensor.piscine_temperature', 'jardin', '24.5', { device_class: 'temperature', unit_of_measurement: '°C' }],
  // shutters and window contacts: one window in these rooms -> linked on their own
  SHUT('cuisine'),
  SHUT('bureau'),
  SHUT('chambre_1'),
  SHUT('chambre_2'),
  SHUT('chambre_3'),
  WIN('cuisine'),
  WIN('chambre_1'),
  WIN('bureau'),
  // two windows in the living room and in the main bedroom: linked by hand in the demo edits
  SHUT('sejour', 'volet_baie'),
  SHUT('sejour', 'volet_ouest'),
  WIN('sejour', 'baie'),
  WIN('sejour', 'fenetre'),
  SHUT('chambre_parentale', 'volet_sud'),
  SHUT('chambre_parentale', 'volet_est'),
  ['binary_sensor.entree_porte', 'entree', 'off', { device_class: 'door' }],
  ['binary_sensor.garage_porte', 'garage', 'off', { device_class: 'garage_door' }],
  // alarms
  ['alarm_control_panel.maison', 'entree', 'disarmed', { code_arm_required: false, supported_features: 3 }],
  ['binary_sensor.buanderie_fuite', 'buanderie', 'off', { device_class: 'moisture' }],
  ['binary_sensor.cuisine_fumee', 'cuisine', 'off', { device_class: 'smoke' }],
  // robots, watering, pool
  ['vacuum.robot', 'garage', 'docked', { battery_level: 100, fan_speed: 'balanced', supported_features: 16383 }],
  ['switch.arrosage_pelouse', 'jardin', 'off', {}],
  ['switch.arrosage_potager', 'jardin', 'off', {}],
  ['switch.arrosage_haie', 'jardin', 'off', {}],
  ['switch.pompe_piscine', 'jardin', 'off', { icon: 'mdi:pump' }],
  ['binary_sensor.robot_piscine', 'jardin', 'off', { icon: 'mdi:robot-vacuum-variant' }],
  ['media_player.salon', 'sejour', 'off', { volume_level: 0.3, supported_features: 152463 }],
];

/** Fictitious place of the demo home (sun and seasons only: nothing is fetched there). */
export const DEMO_LOCATION = { latitude: 45, longitude: 2 };
