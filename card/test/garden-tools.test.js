import { describe, it, expect, vi } from 'vitest';
import { IrrigationTools, VacuumTools } from '../src/garden-tools.js';

// minimal stand-in for WorldEditors: keeps the click tool, counts the rebuilds
const fakeEd = (edits) => ({
  edits,
  frame: 'plan',
  clickTool: null,
  commits: 0,
  setClickTool(t) {
    this.clickTool = t;
  },
  _syncPicker() {},
  commit() {
    this.commits++;
  },
  onChange() {},
  drawDraft() {},
});

describe('watering test (accelerated, valves closed)', () => {
  it('opens every line and circuit, or only the given ones, on a fast clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const it_ = new IrrigationTools(fakeEd({ irrigation: { lines: [{ id: 'l1' }], circuits: [{ id: 'c1' }] } }));
    expect(it_.demoSince(Date.now())).toBeNull();
    expect(it_.testing('l1')).toBe(false);
    expect(it_.startDemo()).toBe(true);
    expect(it_.demo.all).toBe(true);
    expect(it_.testing('c1')).toBe(true);
    expect(it_.demoSince(1_000_000)).toEqual({ l1: 1_000_000, c1: 1_000_000 });
    const s = it_.demoSince(1_010_000); // 10 s later: as if open for 30 minutes
    expect((1_010_000 - s.l1) / 60000).toBeCloseTo(30);
    expect(it_.demoSince(1_030_001)).toBeNull(); // over after 30 s
    expect(it_.startDemo(['c1'])).toBe(true);
    expect(it_.demo.all).toBe(false);
    expect(it_.testing('l1')).toBe(false);
    const none = new IrrigationTools(fakeEd({ irrigation: { lines: [], circuits: [] } }));
    expect(none.startDemo()).toBe(false);
    vi.useRealTimers();
  });
});

describe('dock orientation', () => {
  it('turns by steps and aims at a click', () => {
    const ed = fakeEd({ vacuum: {} });
    const vt = new VacuumTools(ed, () => ed.edits.vacuum); // the settings of the robot being set up
    vt.turnDock(90); // no dock yet: nothing
    vt.aimDock();
    expect(ed.clickTool).toBeNull();
    expect(ed.commits).toBe(0);
    ed.edits.vacuum.dock = { at: [5, 5], level: 'l0', base: 0 };
    vt.turnDock(90);
    expect(ed.edits.vacuum.dock.dir).toBe(180); // default 90 (east) + 90
    vt.turnDock(-270);
    expect(ed.edits.vacuum.dock.dir).toBe(270);
    vt.aimDock();
    expect(ed.clickTool.key).toBe('dock-aim');
    ed.clickTool.click({ point: { x: 5, z: 0 } }); // straight up the plan
    expect(ed.edits.vacuum.dock.dir).toBe(0);
    expect(ed.clickTool).toBeNull();
    expect(ed.commits).toBe(3);
    vt.placeDock();
    ed.clickTool.click({ point: { x: 1.234, z: 2 }, level: 'l1', floorY: 2.6 });
    expect(ed.edits.vacuum.dock).toEqual({ at: [1.23, 2], level: 'l1', base: 2.6, dir: 0 }); // moving the dock keeps its direction
  });
});

describe('robots', () => {
  it('reads the settings of a robot list, and of the single robot of the first versions', async () => {
    const { normalizeEdits } = await import('../src/engine/edits.js');
    expect(normalizeEdits({ vacuum: { rot: 12 } }).vacuums).toEqual([{ entity: '', rot: 12 }]);
    expect(normalizeEdits({ vacuum: {} }).vacuums).toEqual([]);
    const two = [{ entity: 'vacuum.a', rot: 1 }, { entity: 'vacuum.b' }];
    expect(normalizeEdits({ vacuum: { rot: 12 }, vacuums: two }).vacuums).toEqual(two);
    expect(normalizeEdits({}).vacuums).toEqual([]);
  });
});
