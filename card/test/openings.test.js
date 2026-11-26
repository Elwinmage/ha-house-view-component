import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  openingKey,
  autoOpeningLinks,
  openingLinks,
  openingState,
  openingStates,
  isGlazed,
  isGarage,
  garageKind,
  GARAGE_KINDS,
} from '../src/openings.js';
import { OpeningsFx } from '../src/engine/openings-3d.js';
import { renderRoomOpenings, renderRoomOpeningWindow } from '../src/ui-openings.js';
import { nothing } from 'lit';

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

describe('garage doors', () => {
  const garage = (manual) => ({ level: 'g', type: 'garage', at: [4, 0], width: 2.5, sill: 0, height: 2.1, room: 'r1' });
  const meta = (key, width = 2.5) => ({
    key,
    type: 'garage',
    level: 'g',
    exterior: true,
    width,
    height: 2.1,
    sill: 0,
    thickness: 0.2,
    center: [0, 1.05, 0],
    rotY: 0,
    side: 1,
  });

  it('is one when the plan says so, and when the user says so', () => {
    expect(isGarage(garage(), undefined)).toBe(true);
    expect(isGarage(garage(), { garage: false })).toBe(false);
    expect(isGarage(win('r1', 1, 'door'), undefined)).toBe(false);
    expect(isGarage(win('r1', 1, 'door'), { garage: true })).toBe(true);
  });

  it('opens with panels under the ceiling unless another way was chosen', () => {
    expect(garageKind(undefined)).toBe('sectional');
    expect(garageKind({ kind: 'tilt' })).toBe('tilt');
    expect(garageKind({ kind: 'hovering' })).toBe('sectional');
    expect(GARAGE_KINDS).toEqual(['sectional', 'tilt', 'roller', 'swing', 'slide', 'folding']);
  });

  it('is in the states even with nothing linked, and carries the way it opens', () => {
    const map = openingStates([garage(), win('r2', 9)], {}, { 'g:40:0': { kind: 'roller' } }, {});
    expect(Object.keys(map)).toEqual(['g:40:0']); // the unlinked window is left out, the garage door is not
    expect(map['g:40:0']).toMatchObject({ open: 0, garage: 'roller' });
    const open = openingStates([garage()], { 'g:40:0': { opener: 'cover.gate' } }, {}, { 'cover.gate': st('open') });
    expect(open['g:40:0']).toMatchObject({ open: 1, garage: 'sectional' });
  });

  it('takes the cover of its area that says it is a garage door', () => {
    const states = {
      'cover.porte_garage': st('closed', { device_class: 'garage' }),
      'binary_sensor.garage': st('off', { device_class: 'garage_door' }),
      'cover.volet_salon': st('open', { device_class: 'shutter' }),
    };
    const auto = autoOpeningLinks(
      [garage()],
      states,
      {},
      () => 'a1',
      (id) => (id.endsWith('salon') ? 'a2' : 'a1'),
    );
    expect(auto['g:40:0']).toEqual({ contact: 'binary_sensor.garage', opener: 'cover.porte_garage' });
  });

  it.each([
    ['sectional', 4],
    ['tilt', 1],
    ['roller', 1],
    ['swing', 2],
    ['slide', 1],
    ['folding', 4],
  ])('builds %s and moves it when it opens', (kind, parts) => {
    const fx = new OpeningsFx();
    fx.register(meta('g1'), new THREE.Group());
    fx.set({ g1: { open: 0, garage: kind } });
    const it = fx.items.get('g1');
    expect(it.leaves).toHaveLength(parts);
    const before = it.leaves.map((l) => l.g.position.clone().toArray().concat(l.g.rotation.x, l.g.rotation.y));
    fx.set({ g1: { open: 1, garage: kind } });
    for (let i = 0; i < 400; i++) fx.tick(0.1);
    expect(it.open).toBe(1);
    const after = it.leaves.map((l) => l.g.position.clone().toArray().concat(l.g.rotation.x, l.g.rotation.y));
    const moved = kind === 'roller' ? it.leaves[0].curtain.scale.y < 0.1 : JSON.stringify(before) !== JSON.stringify(after);
    expect(moved).toBe(true);
  });

  it('takes its time, much longer than a casement', () => {
    const fx = new OpeningsFx();
    fx.register(meta('g1'), new THREE.Group());
    fx.register(meta('w1'), new THREE.Group());
    fx.items.get('w1').meta.type = 'window';
    fx.glass('w1', new THREE.MeshBasicMaterial());
    fx.set({ g1: { open: 1, garage: 'tilt' }, w1: { open: 1 } });
    for (let i = 0; i < 20; i++) fx.tick(0.1); // two seconds
    expect(fx.items.get('w1').open).toBe(1);
    expect(fx.items.get('g1').open).toBeLessThan(0.3);
  });

  it('is rebuilt when the way it opens changes, and only then', () => {
    const fx = new OpeningsFx();
    fx.register(meta('g1'), new THREE.Group());
    fx.set({ g1: { open: 0, garage: 'sectional' } });
    const first = fx.items.get('g1').leaves[0].g;
    fx.set({ g1: { open: 0, garage: 'sectional' } });
    expect(fx.items.get('g1').leaves[0].g).toBe(first);
    fx.set({ g1: { open: 0, garage: 'swing' } });
    expect(fx.items.get('g1').leaves).toHaveLength(2);
    expect(first.parent).toBe(null); // the panels of before are gone from the scene
    fx.garage('missing', 'tilt'); // an opening that is not there
  });

  it('runs its sectional panels up the rails and lays them flat inside', () => {
    const fx = new OpeningsFx();
    fx.register(meta('g1'), new THREE.Group());
    fx.set({ g1: { open: 0, garage: 'sectional' } });
    const it = fx.items.get('g1');
    const bottom = it.leaves[0];
    const top = it.leaves[it.leaves.length - 1];
    expect(bottom.g.position.y).toBeLessThan(top.g.position.y); // stacked, closed
    fx.set({ g1: { open: 1, garage: 'sectional' } });
    for (let i = 0; i < 400; i++) fx.tick(0.1);
    for (const l of it.leaves) {
      expect(l.g.position.y).toBeCloseTo(2.1 / 2, 6); // all up at the lintel
      expect(Math.abs(l.g.rotation.x)).toBeCloseTo(Math.PI / 2, 6); // lying flat
      expect(l.g.position.z).toBeLessThan(0); // and inside, past the outer face
    }
  });
});

describe('a garage with a service door beside its garage door', () => {
  const big = { level: 'g', type: 'garage', at: [4, 0], width: 2.5, sill: 0, height: 2.1, room: 'r1' };
  const small = { level: 'g', type: 'door', at: [7, 0], width: 0.9, sill: 0, height: 2.1, room: 'r1' };

  it('gives each its own sensor instead of letting one take both', () => {
    const states = {
      'binary_sensor.porte_garage': st('off', { device_class: 'garage_door' }),
      'binary_sensor.porte_service': st('off', { device_class: 'door' }),
    };
    const auto = autoOpeningLinks(
      [big, small],
      states,
      {},
      () => 'a1',
      () => 'a1',
    );
    expect(auto[openingKey(big)]).toEqual({ contact: 'binary_sensor.porte_garage' });
    expect(auto[openingKey(small)]).toEqual({ contact: 'binary_sensor.porte_service' });
  });

  it('and a lone garage door takes a sensor that only says "door"', () => {
    const states = { 'binary_sensor.porte': st('on', { device_class: 'door' }) };
    const auto = autoOpeningLinks(
      [big],
      states,
      {},
      () => 'a1',
      () => 'a1',
    );
    expect(auto[openingKey(big)]).toEqual({ contact: 'binary_sensor.porte' });
  });
});

describe('the openings a room holds, in the editor of the rooms', () => {
  const op = (room, x, type = 'window') => ({ level: 'g', type, at: [x, 0], width: 1.2, sill: 1, height: 1.2, room });

  const card = (openings) => ({
    _t: (k) => k,
    _opRoomSel: null,
    _focus: null,
    _data: { edits: { openings: {} } },
    _openingAuto: () => ({}),
    _hass: { states: {} },
    _areas: {},
    _edited() {},
    _pushOpenings() {},
    _opDemo: new Set(),
    _entityInput: () => nothing,
    _asWindow: (title, body) => ({ title, body }),
    requestUpdate() {},
    _engine: {
      setOpeningTarget() {},
      world: {
        openings: { items: new Map(openings.map((o) => [openingKey(o), {}])) },
        sd: { openings, levels: [{ id: 'g', rooms: [{ id: 'r1', name: 'Séjour' }] }] },
      },
    },
  });

  it('opens the editor of the one picked, once, wherever the list was shown', () => {
    const ops = [op('r1', 1), op('r1', 3, 'door')];
    const c = card(ops);
    expect(renderRoomOpeningWindow(c)).toBe(nothing); // nothing picked
    c._opRoomSel = openingKey(ops[1]);
    const win = renderRoomOpeningWindow(c);
    expect(win.title).toContain('Séjour');
    expect(renderRoomOpenings(c, 'r1')).not.toBe(nothing); // the list itself holds no window
    c._opRoomSel = 'g:999:0'; // an opening that left with a new plan
    expect(renderRoomOpeningWindow(c)).toBe(nothing);
    expect(renderRoomOpeningWindow({ _engine: null })).toBe(nothing);
  });

  it('lists them, and nothing at all for a room without', () => {
    const ops = [op('r1', 1), op('r1', 3, 'door'), op('r1', 5, 'garage'), op(null, 9), op('r1', 7, 'opening')];
    expect(renderRoomOpenings(card(ops), 'r1')).not.toBe(nothing);
    expect(renderRoomOpenings(card(ops), 'r2')).toBe(nothing); // another room
    expect(renderRoomOpenings(card([op(null, 9)]), 'r1')).toBe(nothing); // only openings outside
    expect(renderRoomOpenings({ _engine: null }, 'r1')).toBe(nothing); // before the view is built
  });
});
