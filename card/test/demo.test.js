import { describe, it, expect, vi } from 'vitest';
import { DemoSim, scenarioAt, DEMO_EVENTS } from '../src/demo.js';
import { DEMO_ENTITIES, DEMO_AREAS } from '../src/demo-data.js';

const run = (sim, h, seconds = 6) => {
  for (let i = 0; i < seconds * 5; i++) sim.tick(h, 0.2);
};

describe('demo scenario', () => {
  it('drives only demo entities', () => {
    const ids = new Set(DEMO_ENTITIES.map((e) => e[0]));
    for (const h of [0, 6, 10.5, 14.5, 18.75, 21.2, 23.9]) for (const id of Object.keys(scenarioAt(h))) expect(ids.has(id)).toBe(true);
    const areas = new Set(DEMO_AREAS.map((a) => a[0]));
    for (const [, area] of DEMO_ENTITIES) expect(areas.has(area)).toBe(true);
  });

  it('follows the day', () => {
    expect(scenarioAt(10.5)['vacuum.robot'].state).toBe('cleaning');
    expect(scenarioAt(11.6)['vacuum.robot'].state).toBe('returning');
    expect(scenarioAt(3)['cover.cuisine_volet'].position).toBe(0);
    expect(scenarioAt(12)['cover.cuisine_volet'].position).toBe(100);
    expect(scenarioAt(13.5)['cover.sejour_volet_baie'].position).toBe(40);
    expect(scenarioAt(11)['binary_sensor.sejour_fenetre'].state).toBe('on');
    expect(scenarioAt(21)['cover.chambre_1_volet'].position).toBe(0);
    expect(scenarioAt(5.8)['switch.arrosage_pelouse'].state).toBe('on');
    expect(scenarioAt(19)['binary_sensor.buanderie_fuite'].state).toBe('on');
    expect(scenarioAt(0)['alarm_control_panel.maison'].state).toBe('armed_night');
    expect(scenarioAt(12)['alarm_control_panel.maison'].state).toBe('armed_away');
    expect(scenarioAt(19)['sensor.sejour_co2'].state).toMatch(/^\d+$/);
  });
});

describe('demo simulator', () => {
  it('moves the shutters smoothly and reports changes', () => {
    const sim = new DemoSim();
    expect(sim.tick(3, 0.2)).toBe(true); // the night closes the shutters
    expect(sim.states['cover.cuisine_volet'].state).toBe('closing');
    run(sim, 3);
    expect(sim.states['cover.cuisine_volet']).toMatchObject({ state: 'closed', attributes: { current_position: 0 } });
    expect(sim.tick(3, 0.2)).toBe(false); // nothing moves
    sim.tick(12, 0.2);
    expect(sim.states['cover.cuisine_volet'].state).toBe('opening');
    run(sim, 12);
    expect(sim.states['cover.cuisine_volet'].attributes.current_position).toBe(100);
  });

  it('keeps a change made by hand until the scenario moves that entity', () => {
    const sim = new DemoSim();
    run(sim, 12, 1);
    expect(sim.call('light', 'turn_on', { entity_id: 'light.cuisine' })).toBe(true);
    run(sim, 12.5, 1);
    expect(sim.states['light.cuisine'].state).toBe('on');
    run(sim, 20, 1); // the scenario switches the kitchen on in the evening: the hand change is forgotten
    run(sim, 23.5, 1);
    expect(sim.states['light.cuisine'].state).toBe('off');
    // services of every kind
    sim.call('cover', 'set_cover_position', { position: 30 }, { entity_id: 'cover.bureau_volet' });
    run(sim, 23.5, 6);
    expect(sim.states['cover.bureau_volet'].attributes.current_position).toBe(30);
    sim.call('cover', 'close_cover', { entity_id: 'cover.bureau_volet' });
    sim.call('cover', 'stop_cover', { entity_id: 'cover.bureau_volet' });
    sim.call('cover', 'open_cover', { entity_id: 'cover.bureau_volet' });
    sim.call('homeassistant', 'toggle', { entity_id: 'cover.chambre_1_volet' });
    sim.call('vacuum', 'start', { entity_id: 'vacuum.robot' });
    expect(sim.states['vacuum.robot'].state).toBe('cleaning');
    sim.call('vacuum', 'locate', { entity_id: 'vacuum.robot' });
    sim.call('alarm_control_panel', 'alarm_arm_home', { entity_id: 'alarm_control_panel.maison' });
    expect(sim.states['alarm_control_panel.maison'].state).toBe('armed_home');
    sim.call('alarm_control_panel', 'alarm_disarm', { entity_id: 'alarm_control_panel.maison' });
    expect(sim.states['alarm_control_panel.maison'].state).toBe('disarmed');
    sim.call('homeassistant', 'toggle', { entity_id: 'media_player.salon' });
    expect(sim.states['media_player.salon'].state).toBe('playing');
    sim.call('homeassistant', 'toggle', { entity_id: 'media_player.salon' });
    expect(sim.states['media_player.salon'].state).toBe('off');
    sim.call('switch', 'turn_off', { entity_id: ['switch.pompe_piscine'] });
    sim.call('sensor', 'whatever', { entity_id: 'sensor.sejour_temperature' });
    expect(sim.call('light', 'toggle', { entity_id: 'light.real_one' })).toBe(false);
    expect(sim.call('light', 'toggle')).toBe(false);
  });

  it('plays the events of the panel, both ways', () => {
    const sim = new DemoSim();
    run(sim, 12, 6);
    for (const ev of DEMO_EVENTS) {
      sim.play(ev);
      run(sim, 12, 6);
    }
    expect(sim.states['binary_sensor.buanderie_fuite'].state).toBe('on');
    expect(sim.states['binary_sensor.cuisine_fumee'].state).toBe('on');
    expect(sim.states['cover.cuisine_volet'].attributes.current_position).toBe(0);
    expect(sim.states['vacuum.robot'].state).toBe('cleaning');
    expect(sim.states['switch.arrosage_pelouse'].state).toBe('on');
    expect(sim.states['binary_sensor.robot_piscine'].state).toBe('on');
    expect(sim.states['light.sejour'].state).toBe('on');
    for (const ev of DEMO_EVENTS) sim.play(ev);
    run(sim, 12, 6);
    expect(sim.states['binary_sensor.buanderie_fuite'].state).toBe('off');
    expect(sim.states['cover.cuisine_volet'].attributes.current_position).toBe(100);
    expect(sim.states['vacuum.robot'].state).toBe('returning');
    expect(sim.states['light.sejour'].state).toBe('off');
    sim.play('nothing');
  });

  it('stops following the scenario when asked', () => {
    const sim = new DemoSim();
    sim.auto = false;
    run(sim, 10.5, 1);
    expect(sim.states['vacuum.robot'].state).toBe('docked');
  });

  it('shows only the demo home to the card', async () => {
    const sim = new DemoSim();
    const real = {
      language: 'fr',
      user: { is_admin: true },
      states: { 'light.real': { state: 'on' } },
      areas: { a: {} },
      callService: vi.fn(),
    };
    const changed = vi.fn();
    const h = sim.hassFor(real, changed);
    expect(h.language).toBe('fr');
    expect(h.user.is_admin).toBe(true);
    expect(h.states['light.real']).toBeUndefined();
    expect(h.states['light.sejour'].attributes.friendly_name).toBe('Sejour');
    expect(h.areas.sejour.name).toBe('Séjour');
    expect(h.entities['light.sejour'].area_id).toBe('sejour');
    expect(h.devices).toEqual({});
    await h.callService('light', 'turn_on', { entity_id: 'light.sejour' });
    expect(changed).toHaveBeenCalledTimes(1);
    await h.callService('light', 'turn_on', { entity_id: 'light.real' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(real.callService).not.toHaveBeenCalled();
  });
});
