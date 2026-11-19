import { describe, it, expect } from 'vitest';
import { rectAxes, rectCorners, rectAt, aquariumSize, boxOf, rayBox, pickFurniture, quadMatrix, applyQuad, onFloor } from '../src/zones.js';
import { alarmList, isAlarmKind, isRaised, tapAction, polyCentre, roomAlarms } from '../src/alarms.js';

const near = (a, b, d = 6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], d));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('rectangles', () => {
  it('face their surface: u x v = n', () => {
    for (const n of [
      [1, 0, 0],
      [0, 0, -1],
      [Math.SQRT1_2, 0, Math.SQRT1_2],
    ]) {
      const { u, v } = rectAxes({ n, rot: 0 });
      near(cross(u, v), n);
    }
    for (const rot of [0, 30, -120]) near(cross(...Object.values(rectAxes({ n: [0, 1, 0], rot }))), [0, 1, 0]);
  });

  it('on a wall: upright, as wide as asked, centred on the tap', () => {
    const r = rectAt({ point: { x: 2, y: 1.2, z: 3 }, normal: [0, 1] }, 1.2, 0.5);
    expect(onFloor(r)).toBe(false);
    near(r.c, [2, 1.2, 3.02]);
    const [tl, tr, br, bl] = rectCorners(r);
    expect(tl[1] - bl[1]).toBeCloseTo(0.5);
    expect(Math.hypot(tr[0] - tl[0], tr[2] - tl[2])).toBeCloseTo(1.2);
    near(br, [tr[0], tr[1] - 0.5, tr[2]]);
    // seen from the front (from +z, looking toward -z): the left corner is on the left (smaller x)
    expect(tl[0]).toBeLessThan(tr[0]);
  });

  it('on a floor: flat, its top toward the top of the plan, turnable', () => {
    const r = rectAt({ point: { x: 0, y: 0, z: 0 } }, 2, 1);
    expect(onFloor(r)).toBe(true);
    const [tl, tr, , bl] = rectCorners(r);
    near(tl, [-1, 0.02, -0.5]);
    near(tr, [1, 0.02, -0.5]);
    near(bl, [-1, 0.02, 0.5]);
    const [tl90] = rectCorners({ ...r, rot: 90 });
    near(tl90, [0.5, 0.02, -1]);
  });

  it('takes the size of an aquarium', () => {
    expect(aquariumSize({ length: 120, width: 50, height: 60 }, false)).toEqual([1.2, 0.6]);
    expect(aquariumSize({ length: 120, width: 50, height: 60 }, true)).toEqual([1.2, 0.5]);
    expect(aquariumSize(null, false)).toBeNull();
    expect(aquariumSize({ length: 120, width: 0, height: 60 }, true)).toBeNull();
  });
});

describe('furniture', () => {
  const sofa = { at: [3, 4], rot: 0, size: [2, 0.8, 1], elevation: 0 };
  const turned = { at: [0, 0], rot: Math.PI / 2, size: [4, 1, 1], elevation: 0.5 };

  it('is hit by a ray from above, along its own size', () => {
    expect(rayBox([3, 10, 4], [0, -1, 0], boxOf(sofa, 0))).toBeCloseTo(9.2);
    expect(rayBox([3.9, 10, 4], [0, -1, 0], boxOf(sofa, 0))).not.toBeNull();
    expect(rayBox([4.1, 10, 4], [0, -1, 0], boxOf(sofa, 0))).toBeNull();
    expect(rayBox([3, 10, 4.6], [0, -1, 0], boxOf(sofa, 0))).toBeNull();
    expect(rayBox([3, -1, 4], [0, -1, 0], boxOf(sofa, 0))).toBeNull(); // behind the ray
  });

  it('turns as the plan draws it', () => {
    // 4 m long, turned a quarter: it now runs along z
    const b = boxOf(turned, 1);
    expect(b.y0).toBe(1.5);
    expect(rayBox([0, 10, 1.8], [0, -1, 0], b)).toBeCloseTo(7.5);
    expect(rayBox([1.8, 10, 0], [0, -1, 0], b)).toBeNull();
  });

  it('picks the nearest piece', () => {
    const low = { at: [0, 0], rot: 0, size: [1, 0.5, 1], elevation: 0 };
    const shelf = { at: [0, 0], rot: 0, size: [0.5, 0.2, 0.5], elevation: 1 };
    const p = pickFurniture(
      [0, 5, 0],
      [0, -1, 0],
      [
        { item: low, base: 0 },
        { item: shelf, base: 0 },
      ],
    );
    expect(p.item).toBe(shelf);
    expect(pickFurniture([9, 5, 9], [0, -1, 0], [{ item: low, base: 0 }])).toBeNull();
  });
});

describe('picture laid on a quad', () => {
  it('sends the corners of the element to the corners of the quad', () => {
    const q = [
      [100, 50],
      [400, 80],
      [380, 300],
      [120, 260],
    ];
    const m = quadMatrix(320, 160, q);
    near(applyQuad(m, 0, 0), q[0], 3);
    near(applyQuad(m, 320, 0), q[1], 3);
    near(applyQuad(m, 320, 160), q[2], 3);
    near(applyQuad(m, 0, 160), q[3], 3);
  });

  it('stays affine for a parallelogram, and refuses a flat quad', () => {
    const m = quadMatrix(100, 50, [
      [0, 0],
      [100, 0],
      [120, 50],
      [20, 50],
    ]);
    near(applyQuad(m, 50, 25), [60, 25], 4);
    expect(
      quadMatrix(10, 10, [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toBeNull();
  });
});

describe('alarms', () => {
  const st = (entity_id, state, device_class, last_changed = '2026-11-19T10:00:00Z') => ({
    entity_id,
    state,
    last_changed,
    attributes: device_class ? { device_class } : {},
  });
  const states = {
    'binary_sensor.leak': st('binary_sensor.leak', 'on', 'moisture', '2026-11-19T12:00:00Z'),
    'binary_sensor.smoke': st('binary_sensor.smoke', 'off', 'smoke'),
    'binary_sensor.door': st('binary_sensor.door', 'on', 'door'),
    'binary_sensor.ph_low': st('binary_sensor.ph_low', 'on', 'problem'),
    'alarm_control_panel.home': st('alarm_control_panel.home', 'armed_away'),
    'alarm_control_panel.shed': st('alarm_control_panel.shed', 'triggered'),
    'input_boolean.panic': st('input_boolean.panic', 'on'),
    'binary_sensor.gone': st('binary_sensor.gone', 'unavailable', 'problem'),
  };

  it('finds the alarms by their kind', () => {
    expect(isAlarmKind(states['binary_sensor.door'])).toBe(false);
    expect(isAlarmKind(states['alarm_control_panel.home'])).toBe(true);
    expect(isRaised(states['alarm_control_panel.home'])).toBe(false);
    expect(isRaised(states['alarm_control_panel.shed'])).toBe(true);
    expect(isRaised(states['binary_sensor.gone'])).toBe(false);
    expect(isRaised(undefined)).toBe(false);
    const { raised, ignored } = alarmList(states, {});
    expect(raised.map((s) => s.entity_id)).toEqual(['binary_sensor.leak', 'binary_sensor.ph_low', 'alarm_control_panel.shed']);
    expect(ignored).toEqual([]);
  });

  it('adds the entities of the user, leaves out the ignored ones', () => {
    const { raised, ignored } = alarmList(states, { extra: ['input_boolean.panic', 'sensor.missing'], ignored: ['binary_sensor.ph_low'] });
    expect(raised.map((s) => s.entity_id)).toContain('input_boolean.panic');
    expect(raised.map((s) => s.entity_id)).not.toContain('binary_sensor.ph_low');
    expect(ignored.map((s) => s.entity_id)).toEqual(['binary_sensor.ph_low']);
    expect(alarmList(states, { auto: false, extra: ['binary_sensor.door'] }).raised.map((s) => s.entity_id)).toEqual([
      'binary_sensor.door',
    ]);
  });

  it('toggles what can be toggled', () => {
    expect(tapAction('switch.alarm_siren')).toBe('toggle');
    expect(tapAction('sensor.outside_temperature', 'auto')).toBe('more-info');
    expect(tapAction('alarm_control_panel.home')).toBe('more-info');
    expect(tapAction('switch.x', 'none')).toBe('none');
  });
});

describe('alarms of the rooms', () => {
  const st = (entity_id) => ({ entity_id, state: 'on', attributes: {} });
  const square = (x, z, s) => [
    [x, z],
    [x + s, z],
    [x + s, z + s],
    [x, z + s],
  ];
  it('finds the centre of a room', () => {
    expect(polyCentre(square(0, 0, 4))).toEqual([2, 2]);
    const l = polyCentre([
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ]);
    expect(l[0]).toBeCloseTo(l[1]); // an L symmetric about the diagonal
    expect(
      polyCentre([
        [0, 0],
        [2, 0],
        [4, 0],
      ]),
    ).toEqual([2, 0]);
  });

  it('puts each alarm in the rooms of its area', () => {
    const rooms = [
      { id: 'kitchen', level: 'l0', y: 0, poly: square(0, 0, 4) },
      { id: 'bath', level: 'l1', y: 3, poly: square(10, 0, 2) },
      { id: 'hall', level: 'l0', y: 0, poly: square(5, 5, 2) },
      { id: 'flat', level: 'l0', y: 0, poly: [[0, 0]] },
    ];
    const areas = { kitchen: 'cuisine', bath: 'sdb', hall: 'cuisine', flat: 'sdb' };
    const where = {
      'binary_sensor.leak': 'cuisine',
      'binary_sensor.smoke': 'cuisine',
      'binary_sensor.wc': 'sdb',
      'binary_sensor.nowhere': null,
    };
    const out = roomAlarms(
      ['binary_sensor.leak', 'binary_sensor.smoke', 'binary_sensor.wc', 'binary_sensor.nowhere'].map(st),
      rooms,
      areas,
      (id) => where[id],
    );
    expect(out.map((r) => [r.room, r.alarms.length])).toEqual([
      ['kitchen', 2],
      ['bath', 1],
      ['hall', 2],
    ]);
    expect(out[1].pos).toEqual([11, 3.05, 1]);
    expect(roomAlarms([], rooms, areas, () => 'cuisine')).toEqual([]);
  });
});
