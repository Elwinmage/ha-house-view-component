import { describe, it, expect } from 'vitest';
import {
  addLevel,
  addOpening,
  addRoom,
  builderReport,
  builderScene,
  emptyBuilder,
  levelElevations,
  nearestSide,
  normalizeBuilder,
  removeLevel,
  removeRoom,
  roomPoly,
  sceneFromPlan,
  sidePoint,
  snapRoom,
} from '../src/plan-builder.js';
import { normalizeScene } from '../src/engine/scene-model.js';

function house() {
  const b = emptyBuilder();
  const a = addRoom(b, 'L0', 'Séjour', [5, 4]);
  const k = addRoom(b, 'L0', 'Cuisine', [3, 4]);
  return { b, a, k };
}

describe('plan builder model', () => {
  it('adds rooms side by side, then over the level below', () => {
    const { b, a, k } = house();
    expect([a.x, a.z, k.x, k.z]).toEqual([0, 0, 5, 0]);
    const up = addLevel(b, 'Étage');
    const r = addRoom(b, up.id, 'Chambre');
    expect([r.x, r.z, r.level]).toEqual([0, 0, up.id]);
    expect(addRoom(emptyBuilder(), 'L0').name).toBe('Pièce 1');
  });

  it('copies the outline of a level when adding one on top', () => {
    const { b } = house();
    const up = addLevel(b, 'Étage', 'L0');
    expect(b.rooms.filter((r) => r.level === up.id).map((r) => r.name)).toEqual(['Séjour (Étage)', 'Cuisine (Étage)']);
    expect(levelElevations(b)).toEqual({ L0: 0, [up.id]: 2.7 });
  });

  it('snaps edges to the neighbouring rooms, moving or resizing', () => {
    const { b, k } = house();
    // moving: the west edge sticks to the east side of the living room, the size stays
    expect(snapRoom(b, k, 5.2, 0.13, 3, 4)).toEqual({ x: 5, z: 0, w: 3, d: 4 });
    // far from everything: rounded to 5 cm
    expect(snapRoom(b, k, 9.03, 2.02, 3, 4)).toEqual({ x: 9.05, z: 2, w: 3, d: 4 });
    // resizing the east edge of the living room: x0 stays, x1 sticks to the kitchen's far side
    const a = b.rooms[0];
    expect(snapRoom(b, a, 0, 0, 7.9, 4, ['x0', 'z0', 'z1'])).toEqual({ x: 0, z: 0, w: 8, d: 4 });
    // never smaller than 50 cm
    expect(snapRoom(b, a, 0, 0, 0.1, 4, ['x0', 'z0', 'z1']).w).toBe(0.5);
    expect(snapRoom(b, a, 3.9, 0, 0.1, 4, ['x1', 'z0', 'z1']).x).toBe(3.5);
    expect(snapRoom(b, a, 0, 0, 5, 0.1, ['x0', 'x1', 'z0']).d).toBe(0.5);
    expect(snapRoom(b, a, 0, 3.9, 5, 0.1, ['x0', 'x1', 'z1']).z).toBe(3.5);
  });

  it('places openings on the sides', () => {
    const { b, a } = house();
    const w = addOpening(b, a, 'n', 'window');
    expect(w).toMatchObject({ side: 'n', pos: 2.5, width: 1.2, sill: 0.95 });
    expect(sidePoint(a, 'n', 2.5)).toEqual([2.5, 0]);
    expect(sidePoint(a, 's', 1)).toEqual([1, 4]);
    expect(sidePoint(a, 'w', 1)).toEqual([0, 1]);
    expect(sidePoint(a, 'e', 1)).toEqual([5, 1]);
    // kept inside the side
    expect(addOpening(b, a, 'e', 'patio', 0).pos).toBe(1.2);
    expect(addOpening(b, a, 'w', 'unknown').type).toBe('unknown');
    expect(nearestSide(a, [4.9, 2])).toMatchObject({ side: 'e', pos: 2 });
    expect(nearestSide(a, [2, 4.2])).toMatchObject({ side: 's', pos: 2 });
    expect(nearestSide(a, [-1, 9])).toMatchObject({ side: 'w', pos: 4 });
  });

  it('removes rooms with their openings, and levels with their rooms', () => {
    const { b, a } = house();
    addOpening(b, a, 'n');
    removeRoom(b, a.id);
    expect(b.openings).toEqual([]);
    const up = addLevel(b, 'Étage', 'L0');
    removeLevel(b, up.id);
    expect(b.levels).toHaveLength(1);
    expect(b.rooms).toHaveLength(1);
    removeLevel(b, 'L0'); // the last level stays
    expect(b.levels).toHaveLength(1);
  });

  it('normalizes a partial model', () => {
    const n = normalizeBuilder({
      levels: [{ height: 1 }],
      rooms: [
        { id: 'x', level: 'L0', w: 2, d: 2 },
        { id: 'y', level: 'nope', w: 1, d: 1 },
      ],
      openings: [
        { room: 'x', side: 'q' },
        { room: 'x', side: 'n' },
      ],
      roof: 'dome',
      north: 'a',
    });
    expect(n.levels[0]).toEqual({ id: 'L0', name: 'Niveau 0', height: 2.5 });
    expect(n.rooms.map((r) => r.id)).toEqual(['x']);
    expect(n.openings).toHaveLength(1);
    expect([n.roof, n.north]).toEqual(['auto', 0]);
    expect(normalizeBuilder(null).levels).toHaveLength(1);
    expect(normalizeBuilder({ levels: [] }).levels).toHaveLength(1);
  });
});

describe('scene of a builder model', () => {
  it('builds walls, lights and openings the engine can load', () => {
    const { b, a } = house();
    a.area = 'living';
    addOpening(b, a, 's', 'door', 1);
    b.levels[0].height = 2.8;
    const sc = builderScene(b, 44.5);
    expect(sc.builder.rooms).toHaveLength(2);
    expect(sc.site).toEqual({ latitude: 44.5, northOffsetDeg: 0 });
    const lv = sc.levels[0];
    expect(lv.rooms.map((r) => r.area)).toEqual(['living', 'cuisine']);
    expect(lv.rooms[1].floor).toBe('#cfcfc8'); // tiled kitchen
    expect(lv.rooms[0].poly).toEqual(roomPoly(a));
    // 4 + 4 sides, the shared one counted once: 7 walls, one interior
    expect(lv.walls).toHaveLength(7);
    expect(lv.walls.filter((w) => !w.exterior)).toHaveLength(1);
    expect(lv.walls[0].height).toBe(2.8);
    expect(sc.lights).toHaveLength(2);
    expect(sc.lights[0].pos[1]).toBeCloseTo(2.45);
    expect(sc.openings[0]).toMatchObject({ level: 'L0', type: 'door', at: [1, 4], room: a.id });
    const n = normalizeScene(structuredClone(sc));
    expect(n.roof.type).toBe('gable'); // automatic: a rectangular footprint
    expect(n.openings[0]._wall).toBeGreaterThanOrEqual(0);
    expect(builderReport(sc.builder).counts).toEqual({ niveaux: 1, pièces: 2, fenêtres: 0, portes: 1 });
  });

  it('forces the roof', () => {
    const { b } = house();
    b.roof = 'flat';
    expect(builderScene(b).roof).toMatchObject({ type: 'flat', y: 2.5 });
    expect(builderScene(b).site.latitude).toBe(45);
    b.roof = 'gable';
    const g = builderScene(b).roof;
    expect(g).toMatchObject({ type: 'gable', axis: 'x', eaveY: 2.5 });
    expect(g.fp).toEqual({ x0: -0.1, z0: -0.1, x1: 8.1, z1: 4.1 });
    b.rooms[1].d = 9;
    expect(builderScene(b).roof.axis).toBe('z');
  });

  it('makes a scene of any room polygons', () => {
    const sc = sceneFromPlan({
      levels: [
        {
          id: 'a',
          name: 'A',
          elevation: 0,
          height: 2.5,
          rooms: [
            {
              id: 'r',
              name: '',
              poly: [
                [0, 0],
                [2, 0],
                [1, 2],
              ],
            },
          ],
        },
      ],
      roof: 'gable',
    });
    expect(sc.name).toBe('Plan');
    expect(sc.levels[0].rooms[0].area).toBe('r');
    expect(sc.lights[0].radius).toBe(3);
    expect(sceneFromPlan({ levels: [{ id: 'a', name: 'A', elevation: 0, height: 2.5, rooms: [] }], roof: 'gable' }).roof).toBeUndefined();
  });
});
