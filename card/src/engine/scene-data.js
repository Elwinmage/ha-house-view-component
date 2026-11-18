// Hardcoded demo scene. In the real project this would be a JSON document stored
// in /config, produced by the Sweet Home 3D importer or the in-card editor.
// Units: meters. World axes: x = east, z = south, y = up.

export const WALL_T = 0.2; // wall thickness
export const LEVEL_H = 2.6; // storey height (floor top -> slab underside)
export const SLAB_T = 0.2; // slab thickness

export const SITE = {
  latitude: 43.6, // Toulouse, used by the sun model
  northOffsetDeg: 0, // rotation of the plan relative to true north
  center: [10, 0, 4],
  plot: { x0: -8, z0: -8, x1: 24, z1: 16 },
};

const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

export const LEVELS = [
  {
    id: 'rdc',
    name: 'Rez-de-chaussée',
    elevation: 0,
    rooms: [
      { id: 'salon', name: 'Salon', area: 'living_room', floor: '#b88a5a', temp: 21.5, poly: rect(0, 0, 6, 5) },
      { id: 'cuisine', name: 'Cuisine', area: 'kitchen', floor: '#cfc8bd', temp: 22.4, poly: rect(6, 0, 10, 5) },
      { id: 'entree', name: 'Entrée', area: 'hallway', floor: '#c9c2b5', temp: 19.0, poly: rect(0, 5, 4, 8) },
      { id: 'bureau', name: 'Bureau', area: 'office', floor: '#a98258', temp: 20.2, poly: rect(4, 5, 10, 8) },
    ],
  },
  {
    id: 'etage',
    name: 'Étage',
    elevation: LEVEL_H + SLAB_T,
    rooms: [
      { id: 'parents', name: 'Chambre parents', area: 'master_bedroom', floor: '#b79468', temp: 18.6, poly: rect(0, 0, 5, 4) },
      { id: 'enfant', name: 'Chambre enfant', area: 'kids_room', floor: '#c4a574', temp: 19.4, poly: rect(5, 0, 10, 4) },
      { id: 'sdb', name: 'Salle de bain', area: 'bathroom', floor: '#b9c9cf', temp: 23.1, poly: rect(0, 4, 4, 8) },
      { id: 'palier', name: 'Palier', area: 'landing', floor: '#c9c2b5', temp: 18.0, poly: rect(4, 4, 6, 8) },
      { id: 'chambre3', name: 'Chambre 3', area: 'guest_room', floor: '#b79468', temp: 17.8, poly: rect(6, 4, 10, 8) },
    ],
  },
];

// Openings are located by a point on the wall axis; the wall segment is found automatically.
// type: window | patio (full-height glass) | door (leaf if exterior) | opening (open passage)
export const OPENINGS = [
  // ground floor, exterior
  { level: 'rdc', type: 'patio', at: [3, 0], width: 2.6, sill: 0, height: 2.2, room: 'salon' },
  { level: 'rdc', type: 'window', at: [0, 2.5], width: 1.6, sill: 0.9, height: 1.3, room: 'salon' },
  { level: 'rdc', type: 'window', at: [8, 0], width: 1.4, sill: 1.0, height: 1.1, room: 'cuisine' },
  { level: 'rdc', type: 'window', at: [10, 2.5], width: 1.4, sill: 1.0, height: 1.1, room: 'cuisine' },
  { level: 'rdc', type: 'door', at: [2, 8], width: 1.0, sill: 0, height: 2.1, room: 'entree' },
  { level: 'rdc', type: 'window', at: [0, 6.5], width: 1.0, sill: 1.0, height: 1.2, room: 'entree' },
  { level: 'rdc', type: 'window', at: [7, 8], width: 2.0, sill: 0.9, height: 1.3, room: 'bureau' },
  { level: 'rdc', type: 'window', at: [10, 6.5], width: 1.4, sill: 0.9, height: 1.3, room: 'bureau' },
  // ground floor, interior
  { level: 'rdc', type: 'door', at: [2, 5], width: 0.9, sill: 0, height: 2.1 },
  { level: 'rdc', type: 'opening', at: [6, 2.5], width: 1.8, sill: 0, height: 2.2 },
  { level: 'rdc', type: 'door', at: [4, 6.5], width: 0.9, sill: 0, height: 2.1 },
  { level: 'rdc', type: 'door', at: [8, 5], width: 0.9, sill: 0, height: 2.1 },
  // upper floor, exterior
  { level: 'etage', type: 'window', at: [2.5, 0], width: 1.4, sill: 0.9, height: 1.3, room: 'parents' },
  { level: 'etage', type: 'window', at: [0, 2], width: 1.2, sill: 0.9, height: 1.3, room: 'parents' },
  { level: 'etage', type: 'window', at: [7.5, 0], width: 1.4, sill: 0.9, height: 1.3, room: 'enfant' },
  { level: 'etage', type: 'window', at: [10, 2], width: 1.2, sill: 0.9, height: 1.3, room: 'enfant' },
  { level: 'etage', type: 'window', at: [0, 6], width: 0.8, sill: 1.2, height: 0.9, room: 'sdb' },
  { level: 'etage', type: 'window', at: [2, 8], width: 1.0, sill: 1.2, height: 0.9, room: 'sdb' },
  { level: 'etage', type: 'window', at: [5, 8], width: 1.0, sill: 0.9, height: 1.3, room: 'palier' },
  { level: 'etage', type: 'window', at: [8, 8], width: 1.6, sill: 0.9, height: 1.3, room: 'chambre3' },
  { level: 'etage', type: 'window', at: [10, 6], width: 1.2, sill: 0.9, height: 1.3, room: 'chambre3' },
  // upper floor, interior
  { level: 'etage', type: 'door', at: [2, 4], width: 0.8, sill: 0, height: 2.1 },
  { level: 'etage', type: 'door', at: [5, 4], width: 0.9, sill: 0, height: 2.1 },
  { level: 'etage', type: 'door', at: [8, 4], width: 0.9, sill: 0, height: 2.1 },
  { level: 'etage', type: 'door', at: [4, 5.5], width: 0.8, sill: 0, height: 2.1 },
  { level: 'etage', type: 'door', at: [6, 6.5], width: 0.9, sill: 0, height: 2.1 },
];

// Lights: kind pendant | lamp | strip | bollard | spot | pool.
// room: id of a room, or 'outdoor' (garden volume), or 'pool'.
export const LIGHTS = [
  { id: 'salon_pendant', name: 'Suspension salon', room: 'salon', kind: 'pendant', pos: [3, 2.35, 2.6], color: '#ffd6a0', brightness: 0.9, on: true, radius: 7 },
  { id: 'salon_lamp', name: 'Lampadaire salon', room: 'salon', kind: 'lamp', pos: [0.8, 1.5, 4.1], color: '#ff9f4a', brightness: 0.8, on: true, radius: 4.2 },
  { id: 'salon_tv', name: 'Rétro-éclairage TV', room: 'salon', kind: 'strip', pos: [3, 0.7, 0.55], color: '#6a5cff', brightness: 0.7, on: true, radius: 3.6 },
  { id: 'cuisine_pendant', name: 'Suspension cuisine', room: 'cuisine', kind: 'pendant', pos: [8, 2.3, 2.6], color: '#fff2dc', brightness: 1.0, on: true, radius: 6 },
  { id: 'cuisine_strip', name: 'Ruban plan de travail', room: 'cuisine', kind: 'strip', pos: [8, 1.45, 0.5], color: '#fff6e8', brightness: 0.8, on: false, radius: 3.5 },
  { id: 'entree_pendant', name: 'Plafonnier entrée', room: 'entree', kind: 'pendant', pos: [2, 2.35, 6.5], color: '#ffe1b8', brightness: 0.9, on: false, radius: 5 },
  { id: 'bureau_lamp', name: 'Lampe de bureau', room: 'bureau', kind: 'lamp', pos: [7, 1.2, 7.3], color: '#ffe9c4', brightness: 0.8, on: false, radius: 4 },
  { id: 'parents_l', name: 'Chevet gauche', room: 'parents', kind: 'lamp', pos: [1.2, 3.75, 0.7], color: '#ffb36b', brightness: 0.7, on: false, radius: 3.2 },
  { id: 'parents_r', name: 'Chevet droit', room: 'parents', kind: 'lamp', pos: [3.9, 3.75, 0.7], color: '#ffb36b', brightness: 0.7, on: false, radius: 3.2 },
  { id: 'enfant_pendant', name: 'Suspension enfant', room: 'enfant', kind: 'pendant', pos: [7.5, 5.15, 2], color: '#8ad0ff', brightness: 0.9, on: true, radius: 5.5 },
  { id: 'sdb_spot', name: 'Spots salle de bain', room: 'sdb', kind: 'spot', pos: [2, 5.15, 6], color: '#f0f6ff', brightness: 1.0, on: false, radius: 5 },
  { id: 'palier_pendant', name: 'Plafonnier palier', room: 'palier', kind: 'pendant', pos: [5, 5.15, 6], color: '#ffe1b8', brightness: 0.8, on: false, radius: 4 },
  { id: 'chambre3_pendant', name: 'Suspension chambre 3', room: 'chambre3', kind: 'pendant', pos: [8, 5.15, 6], color: '#ffd6a0', brightness: 0.8, on: false, radius: 5 },
  { id: 'garden_b1', name: 'Borne chemin 1', room: 'outdoor', kind: 'bollard', pos: [1.5, 0.45, 10], color: '#ffcf8a', brightness: 0.9, on: true, radius: 3.4 },
  { id: 'garden_b2', name: 'Borne chemin 2', room: 'outdoor', kind: 'bollard', pos: [1.5, 0.45, 13], color: '#ffcf8a', brightness: 0.9, on: true, radius: 3.4 },
  { id: 'terrace_spot', name: 'Spot terrasse', room: 'outdoor', kind: 'spot', pos: [3, 2.4, -1.5], color: '#ffd9a8', brightness: 0.9, on: false, radius: 6 },
  { id: 'pool_light', name: 'Projecteur piscine', room: 'pool', kind: 'pool', pos: [16, -1.3, 3], color: '#35e0ff', brightness: 1.0, on: true, radius: 6 },
];

export const FURNITURE = [
  { kind: 'sofa', level: 'rdc', at: [3, 3.9], rot: 0 },
  { kind: 'tv', level: 'rdc', at: [3, 0.45], rot: 0 },
  { kind: 'coffee', level: 'rdc', at: [3, 2.6], rot: 0 },
  { kind: 'counter', level: 'rdc', at: [8, 0.4], rot: 0 },
  { kind: 'island', level: 'rdc', at: [8, 2.6], rot: 0 },
  { kind: 'fridge', level: 'rdc', at: [9.5, 0.45], rot: 0 },
  { kind: 'desk', level: 'rdc', at: [7, 7.3], rot: 0 },
  { kind: 'bench', level: 'rdc', at: [1, 7.4], rot: 0 },
  { kind: 'bed', level: 'etage', at: [2.5, 1.6], rot: 0 },
  { kind: 'bedSingle', level: 'etage', at: [8, 1.5], rot: 0 },
  { kind: 'wardrobe', level: 'etage', at: [9.4, 3.5], rot: 0 },
  { kind: 'bath', level: 'etage', at: [1, 7.2], rot: 0 },
  { kind: 'bedSingle', level: 'etage', at: [8, 6.6], rot: 0 },
];

// Vegetation / outdoor devices placed from the catalog (catalog.js).
export const VEGETATION = [
  { species: 'maple', at: [-4, 2] },
  { species: 'oak', at: [-5.5, 10] },
  { species: 'birch', at: [14, 11] },
  { species: 'birch', at: [16.5, 12.5] },
  { species: 'pine', at: [22, 13] },
  { species: 'pine', at: [22.5, 8] },
  { species: 'olive', at: [-1.8, 6.2] },
  { species: 'bush', at: [11.4, 6.5] },
  { species: 'bush', at: [11.6, 1.5] },
  { species: 'bush', at: [-1.2, 1.2] },
  { species: 'hedge', at: [-3, 15.4], length: 8 },
  { species: 'hedge', at: [6.5, 15.4], length: 12 },
  { species: 'hedge', at: [21, 15.4], length: 5 },
  { species: 'planter', at: [5.4, -2.4] },
  { species: 'planter', at: [0.6, -2.4] },
];

// Saved camera views (the user-defined fixed positions). Persisted by the real card.
export const VIEWS = [
  { name: 'Vue générale', pos: [30, 27, 33], target: [10, 1.5, 4], zoom: 0.85, levels: { rdc: true, etage: true }, roof: true },
  { name: 'Sans toit', pos: [30, 27, 33], target: [10, 1.5, 4], zoom: 1.5, levels: { rdc: true, etage: true }, roof: false },
  { name: 'Rez-de-chaussée', pos: [24, 22, 26], target: [5, 0, 4], zoom: 2.1, levels: { rdc: true, etage: false }, roof: false },
  { name: 'Étage (coupe)', pos: [-8, 24, 26], target: [5, 3, 4], zoom: 2.1, levels: { rdc: true, etage: true }, roof: false },
  { name: 'Dessus', pos: [5, 60, 4.01], target: [5, 0, 4], zoom: 2.2, levels: { rdc: true, etage: true }, roof: false },
  { name: 'Jardin / piscine', pos: [34, 14, 24], target: [16, 0, 4], zoom: 1.8, levels: { rdc: true, etage: true }, roof: true },
];

// Full demo scene in the generic scene format (see scene-model.js). The importer
// produces the same structure from a Sweet Home 3D file.
export const DEMO_SCENE = {
  name: 'Maison démo',
  levels: LEVELS.map((l) => ({ ...l, floorThickness: SLAB_T, height: LEVEL_H })),
  openings: OPENINGS,
  lights: LIGHTS,
  furniture: FURNITURE,
  vegetation: VEGETATION,
  views: VIEWS,
  site: {
    ...SITE,
    pool: { x0: 12, z0: 1, x1: 20, z1: 5 },
    deck: { rect: [0, -3, 6, 0] },
    path: { rect: [0.8, 8.1, 2.2, 15.1] },
    fence: true,
    fenceGap: [0.8, 2.2],
  },
  roof: { type: 'gable', fp: { x0: 0, z0: 0, x1: 10, z1: 8 }, eaveY: 2 * LEVEL_H + SLAB_T, ridgeH: 2.2, overhang: 0.5, axis: 'x' },
};
