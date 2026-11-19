import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { openingKey, autoOpeningLinks, openingLinks, openingState, openingStates, isGlazed } from '../src/openings.js';
import { OpeningsFx } from '../src/engine/openings-3d.js';

const win = (room, x, type = 'window') => ({ level: 'g', type, at: [x, 0], width: 1, sill: 1, height: 1.2, room });
const st = (state, attributes = {}) => ({ state, attributes });

describe('openings links', () => {
  const states = {
    'binary_sensor.kitchen_window': st('on', { device_class: 'window' }),
    'cover.kitchen_shutter': st('open', { device_class: 'shutter', current_position: 40 }),
    'binary_sensor.kitchen_motion': st('off', { device_class: 'motion' }),
    'binary_sensor.hall_door': st('off', { device_class: 'door' }),
    'cover.bed_a': st('closed'),
    'cover.bed_b': st('closed'),
    'binary_sensor.diag': st('off', { device_class: 'window' }),
    'light.x': st('on'),
  };
  const area = {
    'binary_sensor.kitchen_window': 'k',
    'cover.kitchen_shutter': 'k',
    'binary_sensor.kitchen_motion': 'k',
    'binary_sensor.hall_door': 'h',
    'cover.bed_a': 'b',
    'cover.bed_b': 'b',
    'binary_sensor.diag': 'k',
    'light.x': 'k',
  };
  const registry = { 'binary_sensor.diag': { entity_category: 'diagnostic' } };
  const rooms = { kitchen: 'k', hall: 'h', bed: 'b' };

  it('keys are stable to the decimetre', () => {
    expect(openingKey(win('kitchen', 1.23))).toBe('g:12:0');
    expect(isGlazed(win('x', 0, 'patio'))).toBe(true);
    expect(isGlazed(win('x', 0, 'door'))).toBe(false);
  });

  it('links a single window or door on its own', () => {
    const ops = [win('kitchen', 1), win('hall', 5, 'door'), win('bed', 8), win('bed', 9, 'door'), win(null, 3), win('nowhere', 2)];
    const auto = autoOpeningLinks(
      ops,
      states,
      registry,
      (r) => rooms[r],
      (id) => area[id],
    );
    expect(auto[openingKey(ops[0])]).toEqual({ contact: 'binary_sensor.kitchen_window', shutter: 'cover.kitchen_shutter' });
    expect(auto[openingKey(ops[1])]).toEqual({ contact: 'binary_sensor.hall_door' });
    // two covers in the bedroom: no guess
    expect(auto[openingKey(ops[2])]).toBeUndefined();
    expect(auto[openingKey(ops[3])]).toBeUndefined();
    // two windows in a room: none is linked
    const two = autoOpeningLinks(
      [win('kitchen', 1), win('kitchen', 3)],
      states,
      null,
      (r) => rooms[r],
      (id) => area[id],
    );
    expect(two).toEqual({});
  });

  it('hand-made links win, an empty one removes the automatic one', () => {
    expect(openingLinks({ contact: 'a', shutter: 's' }, { shutter: '', opener: 'o' })).toEqual({ contact: 'a', opener: 'o' });
    expect(openingLinks(undefined, undefined)).toEqual({});
  });

  it('reads the state of a window and its shutter', () => {
    expect(openingState({ contact: 'binary_sensor.kitchen_window', shutter: 'cover.kitchen_shutter' }, states)).toEqual({
      open: 1,
      shutter: 0.6,
      moving: false,
    });
    expect(openingState({ shutter: 'cover.bed_a' }, states)).toEqual({ open: 0, shutter: 1, moving: false });
    expect(openingState({ shutter: 'cover.x' }, { 'cover.x': st('opening') })).toEqual({ open: 0, shutter: 0, moving: true });
    expect(openingState({ shutter: 'cover.x' }, { 'cover.x': st('unavailable') }).shutter).toBe(null);
    expect(openingState({ opener: 'cover.v' }, { 'cover.v': st('open', { current_position: 30 }) }).open).toBeCloseTo(0.3);
    expect(openingState({ opener: 'cover.v' }, { 'cover.v': st('open') }).open).toBe(1);
    expect(openingState({ opener: 'cover.v' }, { 'cover.v': st('closed') }).open).toBe(0);
    expect(openingState(null, states)).toEqual({ open: 0, shutter: null, moving: false });
  });

  it('collects the states of the linked openings only', () => {
    const ops = [win('kitchen', 1), win('hall', 5)];
    const map = openingStates(ops, { [openingKey(ops[0])]: { contact: 'binary_sensor.kitchen_window' } }, {}, states);
    expect(Object.keys(map)).toEqual([openingKey(ops[0])]);
    expect(map[openingKey(ops[0])].open).toBe(1);
  });
});

describe('openings 3D', () => {
  const meta = (key, type, side = 1, width = 1.4) => ({
    key,
    type,
    level: 'g',
    exterior: true,
    width,
    height: 1.2,
    sill: 1,
    thickness: 0.2,
    center: [0, 1.6, 0],
    rotY: 0,
    side,
  });

  it('opens the casements inward and rolls the shutter down', () => {
    const fx = new OpeningsFx();
    const g = new THREE.Group();
    fx.register(meta('w', 'window'), g);
    fx.register(meta('p', 'patio'), g);
    fx.register(meta('d', 'door', -1, 0.9), g);
    fx.register(meta('i', 'door', 1, 0.8), g);
    fx.glass('w', new THREE.MeshBasicMaterial());
    fx.glass('p', new THREE.MeshBasicMaterial());
    fx.glass('missing', null);
    fx.leaf('d');
    fx.leaf('d'); // only one leaf
    fx.leaf('missing');
    expect(fx.items.get('w').leaves).toHaveLength(2);
    expect(fx.items.get('d').leaves).toHaveLength(1);
    expect(fx.items.get('i').leaves).toHaveLength(0);

    fx.set({ w: { open: 1, shutter: 0.5 }, p: { open: 1, shutter: null }, d: { open: 1 }, i: { open: 1 } });
    expect(fx.items.get('i').leaves).toHaveLength(1); // a linked interior door gets its leaf
    expect(fx.items.get('w').shutter).not.toBe(null);
    for (let i = 0; i < 100; i++) fx.tick(0.1);
    expect(fx.busy).toBe(false);
    const w = fx.items.get('w');
    expect(w.open).toBe(1);
    expect(w.shut).toBe(0.5);
    // outer side +z: a leaf turns so that its free end goes to -z
    const tip = new THREE.Vector3();
    w.leaves[0].g.updateMatrixWorld(true);
    w.leaves[0].g.children[0].getWorldPosition(tip);
    expect(tip.z).toBeLessThan(0);
    expect(w.shutter.curtain.scale.y).toBeCloseTo(0.6);
    const p = fx.items.get('p');
    expect(p.leaves[1].g.position.x).toBeLessThan(0);
    const d = fx.items.get('d');
    d.leaves[0].g.updateMatrixWorld(true);
    d.leaves[0].g.children[0].getWorldPosition(tip);
    expect(tip.z).toBeGreaterThan(0); // its outer side is -z
    fx.set(null);
    expect(w.shutter.g.visible).toBe(false);
    fx.tick(0.1);
    expect(fx.busy).toBe(true);
  });

  it('picks the opening crossed by a ray', () => {
    const fx = new OpeningsFx();
    fx.register(meta('a', 'window'), new THREE.Group());
    fx.register({ ...meta('b', 'window'), center: [0, 1.6, 2], level: 'up' }, new THREE.Group());
    const ray = new THREE.Ray(new THREE.Vector3(0, 1.6, 5), new THREE.Vector3(0, 0, -1));
    expect(fx.pick(ray, () => true)).toBe('b');
    expect(fx.pick(ray, (lv) => lv !== 'up')).toBe('a');
    expect(fx.pick(ray, () => true, 2)).toBe(null);
    expect(fx.pick(new THREE.Ray(new THREE.Vector3(0, 1.6, 5), new THREE.Vector3(1, 0, 0)), () => true)).toBe(null);
    expect(fx.pick(new THREE.Ray(new THREE.Vector3(3, 1.6, 5), new THREE.Vector3(0, 0, -1)), () => true)).toBe(null);
  });
});
