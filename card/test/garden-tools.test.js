import { describe, it, expect, vi } from 'vitest';
import { IrrigationTools, VacuumTools, BedTools, FenceTools, GateTools } from '../src/garden-tools.js';

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

describe('flower bed tools', () => {
  const hit = (x, z) => ({ point: { x, z } });
  const withStore = (ed) => Object.assign(ed, { toStore: (x, z) => [x, z], toPlan: () => (x, z) => [x, z] });

  it('draws a bed, sizes it by its area, then edits colours and count', () => {
    const ed = withStore(fakeEd({ beds: [] }));
    const bt = new BedTools(ed);
    bt.startDraw();
    expect(ed.clickTool.key).toBe('bed-draw');
    for (const [x, z] of [
      [0, 0],
      [4, 0],
      [4, 3],
    ])
      ed.clickTool.click(hit(x, z));
    bt.undoPoint();
    expect(bt.finishDraw()).toBe(false); // two points left
    ed.clickTool.click(hit(4, 3));
    ed.clickTool.draft({ ribbon() {}, dot() {} });
    expect(bt.finishDraw()).toBe(true);
    expect(bt.beds).toHaveLength(1);
    expect(bt.beds[0].count).toBe(120); // 20 per m2 on the 6 m2 of the triangle
    expect(bt.sel).toBe(0);
    bt.edit(0, { count: 12 });
    bt.setColor(0, 3, { c: '#123456' }); // adds one
    expect(bt.beds[0].colors.at(-1)).toMatchObject({ c: '#123456', w: 1 });
    bt.setColor(0, 0, { w: 5 });
    expect(bt.beds[0].colors[0].w).toBe(5);
    const n = bt.beds[0].colors.length;
    bt.removeColor(0, 0);
    expect(bt.beds[0].colors).toHaveLength(n - 1);
    bt.edit(0, { colors: [{ c: '#ffffff', w: 1 }] });
    bt.removeColor(0, 0); // the last colour stays
    expect(bt.beds[0].colors).toHaveLength(1);
    bt.select(0);
    expect(bt.sel).toBeNull();
    bt.select(0);
    bt._draft({ ribbon() {}, dot() {} });
    bt.toggleHidden(0);
    expect(bt.beds[0].hidden).toBe(true);
    bt.startDraw();
    bt.cancel();
    expect(bt.draw).toBeNull();
    bt.undoPoint();
    expect(bt.finishDraw()).toBe(false);
    bt.remove(0);
    expect(bt.beds).toHaveLength(0);
  });
});

describe('gate tools', () => {
  const hit = (x, z) => ({ point: { x, z } });
  const setup = () => {
    const ed = Object.assign(
      fakeEd({
        gates: [],
        fences: [
          {
            pts: [
              [0, 0],
              [10, 0],
              [10, 10],
            ],
            closed: false,
            segs: [{ s: 'mesh' }, { s: 'mesh' }],
          },
          {
            pts: [
              [20, 0],
              [30, 0],
            ],
            closed: false,
            segs: [{ s: 'wood' }],
            hidden: true,
          },
        ],
      }),
      { toStore: (x, z) => [x, z], toPlan: () => (x, z) => [x, z] },
    );
    return { ed, gt: new GateTools(ed), ft: new FenceTools(ed) };
  };

  it('adds gates with a tap on a fence, several on the same fence', () => {
    const { ed, gt } = setup();
    gt.startAdd();
    expect(ed.clickTool.key).toBe('gate-pick');
    ed.clickTool.click(hit(50, 50)); // nowhere near a fence
    expect(gt.gates).toHaveLength(0);
    ed.clickTool.click(hit(25, 0.5)); // hidden fence: ignored
    expect(gt.gates).toHaveLength(0);
    ed.clickTool.click(hit(3, 0.5));
    expect(gt.gates).toHaveLength(1);
    expect(gt.gates[0]).toMatchObject({ f: 0, at: [3, 0], open: 'swing2' });
    expect(gt.sel).toBe(0);
    expect(gt.mode).toBeNull();
    expect(ed.clickTool).toBeNull();
    gt.startAdd();
    ed.clickTool.click(hit(7, 0));
    expect(gt.gates).toHaveLength(2);
    expect(new Set(gt.gates.map((g) => g.id)).size).toBe(2);
    expect(gt.placed(0)).toBe(true);
    gt.gates.push({ id: 'z', f: 9, at: [0, 0] });
    expect(gt.placed(2)).toBe(false);
  });

  it('moves a gate with a tap, even onto another fence', () => {
    const { ed, gt } = setup();
    gt.gates.push({ id: 'a', f: 0, at: [3, 0] });
    gt.startMove(0);
    expect(gt.mode).toBe('move');
    ed.clickTool.draft({ ribbon() {}, dot() {} });
    ed.clickTool.click(hit(10, 7));
    expect(gt.gates[0]).toMatchObject({ f: 0, at: [10, 7] });
    expect(gt.gates).toHaveLength(1);
  });

  it('edits, shows open to try, hides and removes', () => {
    const { ed, gt } = setup();
    gt.gates.push({ id: 'a', f: 0, at: [3, 0] }, { id: 'b', f: 0, at: [7, 0] });
    gt.select(1);
    expect(gt.sel).toBe(1);
    gt.select(1);
    expect(gt.sel).toBeNull();
    gt.edit(0, { open: 'slide2', w: 4, entity: 'cover.portail' });
    expect(gt.gates[0]).toMatchObject({ id: 'a', open: 'slide2', w: 4, entity: 'cover.portail' });
    gt.toggleDemo('a');
    expect(gt.demo.has('a')).toBe(true);
    gt.toggleDemo('a');
    expect(gt.demo.has('a')).toBe(false);
    gt.toggleDemo('a');
    gt.toggleHidden(0);
    expect(gt.gates[0].hidden).toBe(true);
    gt.startMove(0);
    gt.remove(0);
    expect(gt.gates.map((g) => g.id)).toEqual(['b']);
    expect(gt.demo.size).toBe(0);
    expect(gt.mode).toBeNull();
    gt.startAdd();
    gt.cancel();
    expect(ed.clickTool).toBeNull();
    gt._draft({ ribbon() {}, dot() {} });
  });

  it('removing a fence removes its gates and shifts the others', () => {
    const { ed, ft } = setup();
    ed.edits.gates.push({ id: 'a', f: 0, at: [3, 0] }, { id: 'b', f: 1, at: [25, 0] });
    ft.remove(0);
    expect(ed.edits.gates).toEqual([{ id: 'b', f: 0, at: [25, 0] }]);
  });
});
