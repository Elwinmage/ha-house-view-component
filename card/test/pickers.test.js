import { describe, it, expect } from 'vitest';
import { searchIcons, entityTree, shortName, otherDomains } from '../src/picker-lib.js';

describe('icon search', () => {
  it('shows icons while one types, best first', () => {
    expect(searchIcons('')).toEqual([]);
    expect(searchIcons('thermometer')[0]).toBe('thermometer');
    expect(searchIcons('mdi:thermo')[0]).toMatch(/^thermo/);
    expect(searchIcons('ther', 500).length).toBeGreaterThan(10);
    expect(searchIcons('water drop', 500)).toContain('water-outline');
    expect(
      searchIcons('fish')
        .slice(0, 7)
        .every((n) => n.includes('fish')),
    ).toBe(true); // names before aliases
    expect(searchIcons('zzzzqq')).toEqual([]);
  });

  it('finds an icon by an alias, after those named so', () => {
    expect(searchIcons('aquarium', 300)).toContain('fishbowl');
    expect(searchIcons('temperature', 300)).toContain('thermometer');
    const tv = searchIcons('tv', 300);
    expect(tv).toContain('television');
    expect(tv.indexOf('television')).toBeGreaterThan(tv.indexOf('tv'));
  });
});

describe('entities grouped by room and device', () => {
  const hass = {
    areas: { salon: { area_id: 'salon', name: 'Salon' }, cuisine: { area_id: 'cuisine', name: 'Cuisine' } },
    devices: {
      tv: { id: 'tv', name: 'Télé', area_id: 'salon' },
      frigo: { id: 'frigo', name: 'Frigo', name_by_user: 'Frigo cuisine', area_id: 'cuisine' },
    },
    entities: {
      'media_player.tele': { device_id: 'tv' },
      'sensor.tele_power': { device_id: 'tv' },
      'sensor.frigo_temp': { device_id: 'frigo' },
      'light.cuisine': { area_id: 'cuisine' },
      'light.salon_lamp': { device_id: 'tv', area_id: 'cuisine' }, // its own area wins over the device's
      'sensor.hidden': { device_id: 'tv', hidden: true },
    },
    states: Object.fromEntries(
      [
        ['media_player.tele', 'Télé'],
        ['sensor.tele_power', 'Télé Puissance'],
        ['sensor.frigo_temp', 'Frigo cuisine Température'],
        ['light.cuisine', 'Plafonnier'],
        ['light.salon_lamp', 'Lampe'],
        ['sensor.hidden', 'Caché'],
        ['sun.sun', 'Soleil'],
      ].map(([id, name]) => [id, { entity_id: id, state: 'on', attributes: { friendly_name: name } }]),
    ),
  };

  it('lists the room of the current room by device', () => {
    const t = entityTree(hass, { area: 'salon' });
    expect(t).toHaveLength(1);
    expect(t[0].area.name).toBe('Salon');
    expect(t[0].devices.map((d) => d.name)).toEqual(['Télé']);
    expect(t[0].devices[0].entities).toEqual([
      { id: 'sensor.tele_power', name: 'Puissance' },
      { id: 'media_player.tele', name: 'Télé' },
    ]);
  });

  it('opens on the whole house: rooms by name, then what has no room', () => {
    const t = entityTree(hass, { area: 'salon', all: true });
    expect(t.map((g) => g.area.name || null)).toEqual(['Cuisine', 'Salon', null]);
    const cuisine = t[0];
    expect(cuisine.devices.map((d) => d.name)).toEqual(['Frigo cuisine', 'Télé', '']);
    expect(cuisine.devices[0].entities[0].name).toBe('Température');
    expect(t[2].devices[0].entities.map((e) => e.id)).toEqual(['sun.sun']);
  });

  it('filters by domain and by words', () => {
    expect(
      entityTree(hass, { all: true, domains: ['media_player'] }).flatMap((g) => g.devices.flatMap((d) => d.entities.map((e) => e.id))),
    ).toEqual(['media_player.tele']);
    const found = entityTree(hass, { all: true, query: 'cuisine temp' });
    expect(found.flatMap((g) => g.devices.flatMap((d) => d.entities.map((e) => e.id)))).toEqual(['sensor.frigo_temp']);
    expect(entityTree(hass, { all: true, query: 'caché' })).toEqual([]);
  });

  it('offers the entities of the other domains when one is searched for', () => {
    // a pool robot seen as a light: it must be reachable although the picker asks for switches
    const found = otherDomains(hass, { query: 'lampe', domains: ['switch', 'binary_sensor'] });
    expect(found.map((e) => e.id)).toEqual(['light.salon_lamp']);
    expect(found[0]).toMatchObject({ name: 'Lampe', area: 'Cuisine' });
    expect(otherDomains(hass, { query: 'light.cuisine', domains: ['switch'] }).map((e) => e.id)).toEqual(['light.cuisine']);
    expect(otherDomains(hass, { query: 'caché', domains: ['switch'] })).toEqual([]); // hidden entities stay hidden
    expect(otherDomains(hass, { query: 'lampe', domains: ['light'] })).toEqual([]); // already listed by the picker
    expect(otherDomains(hass, { query: '', domains: ['switch'] })).toEqual([]);
    expect(otherDomains(hass, { query: 'lampe' })).toEqual([]); // no filter: nothing is left out
    expect(otherDomains(hass, { query: 'télé', domains: ['light'], limit: 1 })).toHaveLength(1);
  });

  it('shortens a name under its device', () => {
    expect(shortName('Télé Puissance', 'Télé')).toBe('Puissance');
    expect(shortName('Télé', 'Télé')).toBe('Télé');
    expect(shortName('Lampe', '')).toBe('Lampe');
  });
});
