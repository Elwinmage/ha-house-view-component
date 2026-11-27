import { describe, it, expect, vi } from 'vitest';
import { IrrigationTools, VacuumTools, BedTools, RoofTools, FenceTools, GateTools, PathTools, TerraceTools } from '../src/garden-tools.js';
import { WHOLE } from '../src/move.js';

// minimal stand-in for WorldEditors: keeps the click tool, counts the rebuilds
const fakeEd = (edits) => ({
  edits,
  frame: 'plan',
  clickTool: null,
  moveTool: null,
  commits: 0,
  setClickTool(t) {
    this.clickTool = t;
    if (!t) this.moveTool = null;
  },
  setMoveTool(t) {
    this.moveTool = t;
    this.clickTool = t ? { key: `move:${t.key}` } : null;
  },
  moving(key) {
    return !!this.moveTool && this.moveTool.key === key;
  },
  fromPlan: () => (x, z) => [x, z],
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

describe('roofs read from the surface model', () => {
  const hit = (x, z) => ({ point: { x, z } });
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // prettier-ignore
  // an editor with a terrain (registration: the grid is the plan moved by 100 m), a surface model and a plan
  const editor = (edits, { s = [1], buildings = [{ poly: [...rect(100, 0, 110, 8), [100, 0]] }], sd = undefined } = {}) =>
    Object.assign(fakeEd(edits), {
      frame: 'grid',
      toStore: (x, z) => [x + 100, z],
      toPlan: () => (x, z) => [x - 100, z],
      cfg: { data: { origin: [0, 0], step: 1, nx: 2, nz: 2, z: [0], s, buildings, center: [0, 0] }, rot: 0, dx: -100, dz: 0 },
      engine: {
        world:
          sd === null
            ? null
            : {
                sd: sd || {
                  bbox: { x0: 0, x1: 10, z0: 0, z1: 8 },
                  levels: [{ elevation: 0, rooms: [{ poly: rect(0, 0, 10, 8) }], walls: [] }],
                },
              },
      },
    });

  it('draws the outline of a roof, then corrects its height, colour and name', () => {
    const ed = editor({ roofs: [] });
    const rt = new RoofTools(ed);
    expect(rt.hasModel).toBe(true);
    rt.startDraw();
    expect(ed.clickTool.key).toBe('roof-draw');
    for (const [x, z] of [[0, 0], [10, 0], [10, 8]]) ed.clickTool.click(hit(x, z)); // prettier-ignore
    rt.undoPoint();
    expect(rt.finishDraw()).toBe(false); // two points left
    ed.clickTool.click(hit(10, 8));
    ed.clickTool.draft({ ribbon() {}, dot() {} });
    expect(rt.finishDraw()).toBe(true);
    expect(rt.roofs).toHaveLength(1);
    expect(rt.roofs[0]).toMatchObject({ frame: 'grid', pts: [[100, 0], [110, 0], [110, 8]], dy: 0, c: '', hidden: false }); // prettier-ignore
    expect(rt.roofs[0].id).toMatch(/^r/);
    expect(rt.sel).toBe(0);
    expect(rt.handles()).toMatchObject({ key: 'roof-pts:0', closed: true });
    rt.edit(0, { dy: 0.234 });
    expect(rt.roofs[0].dy).toBe(0.23);
    rt.edit(0, { dy: 12, c: '#aa5533', name: 'Main' });
    expect(rt.roofs[0]).toMatchObject({ dy: 3, c: '#aa5533', name: 'Main' });
    rt.edit(0, { c: '' });
    expect(rt.roofs[0]).toMatchObject({ dy: 3, c: '' });
    rt.toggleHidden(0);
    expect(rt.roofs[0].hidden).toBe(true);
    rt.select(0);
    expect(rt.sel).toBeNull();
    expect(rt.handles()).toBeNull();
    rt._draft({ ribbon() {}, dot() {} }); // nothing being drawn
    rt.startDraw();
    rt.select(0);
    expect(rt.handles()).toBeNull(); // (while another outline is drawn)
    rt.cancel();
    expect(rt.draw).toBeNull();
    rt.undoPoint();
    expect(rt.finishDraw()).toBe(false);
    rt.remove(0);
    expect(rt.roofs).toHaveLength(0);
    expect(ed.commits).toBe(6);
  });

  it('takes the outline of the building of the map, or of the house of the plan with its eaves', () => {
    const ed = editor({ roofs: [] });
    const rt = new RoofTools(ed);
    expect(rt.building()).toEqual(rect(100, 0, 110, 8));
    expect(rt.fromBuilding()).toBe(true);
    // the house of the plan stands just where the building is: its eaves stick out of it, and the roof covers them
    expect(rt.roofs[0].frame).toBe('grid');
    expect(rt.roofs[0].pts).toHaveLength(4);
    expect(Math.min(...rt.roofs[0].pts.map((p) => p[0]))).toBeCloseTo(99.68, 2);
    expect(Math.max(...rt.roofs[0].pts.map((p) => p[1]))).toBeCloseTo(8.32, 2);
    rt.setOverhang(0.5);
    expect(rt.overhang).toBe(0.5);
    rt.setOverhang(9);
    expect(rt.overhang).toBe(1.5);
    rt.setOverhang(0.4);
    expect(rt.fromPlan()).toBe(true);
    const pts = rt.roofs[1].pts;
    expect(pts).toHaveLength(4);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(99.6, 1);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(110.4, 1);
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(-0.4, 1);
    expect(rt.sel).toBe(1);
  });

  it('carries the roof straight over an entrance set back in the facade when the surface model shows it covered', () => {
    // a house 12 m by 8 m with an entrance 3 m wide set back by 1.5 m; the plan stands 100 m from the grid origin
    const poly = [[0, 0], [4, 0], [4, 1.5], [7, 1.5], [7, 0], [12, 0], [12, 8], [0, 8]]; // prettier-ignore
    const sd = { bbox: { x0: 0, x1: 12, z0: 0, z1: 8 }, levels: [{ elevation: 0, rooms: [{ poly }], walls: [] }] };
    const model = (covered) => {
      // cells of 0.5 m from (98, -2): the ground at 100, the roof at 105 over the house and its eaves
      const [nx, nz] = [32, 24];
      const z = new Array(nx * nz).fill(100);
      const s = z.map((_, k) => {
        const x = 98 + (k % nx) * 0.5 - 100;
        const y = -2 + Math.floor(k / nx) * 0.5;
        const roof = x >= -0.4 && x <= 12.4 && y >= -0.4 && y <= 8.4 && (covered || !(x > 4.4 && x < 6.6 && y < 1.1));
        return roof ? 105 : 100;
      });
      return { origin: [98, -2], step: 0.5, nx, nz, z, s, buildings: [], center: [106, 4] };
    };
    const tool = (covered, roof) => {
      const ed = editor({ roofs: [] }, { sd: { ...sd, roof } });
      ed.cfg = { ...ed.cfg, data: model(covered) };
      return new RoofTools(ed);
    };
    const over = tool(true);
    expect(over.fromPlan()).toBe(true);
    expect(over.roofs[0].pts).toHaveLength(4);
    const open = tool(false);
    expect(open.fromPlan()).toBe(true);
    expect(open.roofs[0].pts).toHaveLength(8);
    // the plan has a flat roof of its own over the recess (drawn beside the house): the roof read stops at the walls
    const canopy = { type: 'flat', y: 2.6, thickness: 0.2, polys: [[[3.5, -1.5], [7.5, -1.5], [7.5, 1.4], [3.5, 1.4]]] }; // prettier-ignore
    const beside = tool(true, canopy);
    expect(beside.fromPlan()).toBe(true);
    expect(beside.roofs[0].pts).toHaveLength(8);
    // a flat roof over the rooms themselves is the one the roof read replaces: it changes nothing
    const onTop = tool(true, { type: 'flat', y: 2.6, thickness: 0.2, polys: [poly] });
    expect(onTop.fromPlan()).toBe(true);
    expect(onTop.roofs[0].pts).toHaveLength(4);
  });

  it('covers the walls of the plan that stand out of the building of the map', () => {
    const big = [{ poly: [...rect(98, -2, 112, 10), [98, -2]] }];
    // a building larger than the house all around: taken as it is
    const larger = new RoofTools(editor({ roofs: [] }, { buildings: big }));
    expect(larger.fromBuilding()).toBe(true);
    expect(larger.roofs[0].pts).toEqual(rect(98, -2, 112, 10));
    // a building drawn 1.5 m off: the roof covers what either holds, eaves of the house included
    const off = new RoofTools(editor({ roofs: [] }, { buildings: [{ poly: [...rect(101.5, 1, 111.5, 9), [101.5, 1]] }] }));
    off.setOverhang(0.3);
    expect(off.fromBuilding()).toBe(true);
    const pts = off.roofs[0].pts;
    expect(pts).toHaveLength(8);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(99.68, 2); // the house (100 to 110) and its eaves
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(111.5, 2); // the building
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(-0.32, 2);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(9, 2);
    // every corner of the house is under the roof
    const inside = (x, z) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0])
          c = !c;
      return c;
    };
    for (const [x, z] of rect(100, 0, 110, 8)) expect(inside(x, z)).toBe(true);
    // without a plan the building is all there is
    const bare = new RoofTools(
      editor({ roofs: [] }, { sd: { bbox: { x0: 0, x1: 10, z0: 0, z1: 8 }, levels: [{ elevation: 0, rooms: [], walls: [] }] } }),
    );
    expect(bare.fromBuilding()).toBe(true);
    expect(bare.roofs[0].pts).toEqual(rect(100, 0, 110, 8));
  });

  it('needs a surface model, a building on the map, a plan with rooms', () => {
    expect(new RoofTools(editor({ roofs: [] }, { s: null })).hasModel).toBe(false);
    expect(new RoofTools(Object.assign(editor({ roofs: [] }), { cfg: null })).hasModel).toBe(false);
    const none = new RoofTools(editor({ roofs: [] }, { buildings: [] }));
    expect(none.building()).toBeNull();
    expect(none.fromBuilding()).toBe(false);
    const flat = new RoofTools(Object.assign(editor({ roofs: [] }), { cfg: null }));
    expect(flat.building()).toBeNull();
    const empty = new RoofTools(
      editor({ roofs: [] }, { sd: { bbox: { x0: 0, x1: 1, z0: 0, z1: 1 }, levels: [{ elevation: 0, rooms: [], walls: [] }] } }),
    );
    expect(empty.fromPlan()).toBe(false);
    const unbuilt = new RoofTools(editor({ roofs: [] }, { sd: null }));
    expect(unbuilt.building()).toBeNull();
    expect(unbuilt.fromPlan()).toBe(false);
    expect(unbuilt.roofs).toHaveLength(0);
  });

  it('is kept by the edits, with nothing that is not a roof', async () => {
    const { normalizeEdits, emptyEdits } = await import('../src/engine/edits.js');
    expect(emptyEdits().roofs).toEqual([]);
    expect(normalizeEdits({ roofs: [{ id: 'r1', pts: [[0, 0]] }, null, { id: 'x' }, 3] }).roofs).toEqual([{ id: 'r1', pts: [[0, 0]] }]); // prettier-ignore
    expect(normalizeEdits({ roofs: 'x' }).roofs).toEqual([]);
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

  it('moves a gate by dragging its handle along the fences', () => {
    const { ed, gt } = setup();
    gt.gates.push({ id: 'a', f: 0, at: [3, 0] });
    gt.startMove(0);
    expect(ed.moving('gate:0')).toBe(true);
    const M = ed.moveTool;
    expect(M.points()).toEqual([[3, 0]]);
    M.draft({ ribbon() {}, dot() {} }, null);
    M.move({ i: 0, x: 3, z: 0 }, 10, 7, [3, 0]); // onto the second side of the same fence
    expect(gt.gates[0]).toMatchObject({ f: 0, at: [10, 7] });
    M.move({ i: 0, x: 10, z: 7 }, 60, 60, [10, 7]); // out of reach of every fence: left where it was
    expect(gt.gates[0]).toMatchObject({ f: 0, at: [10, 7] });
    M.commit();
    expect(ed.commits).toBe(1);
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

  it('moves a point of a fence, then the whole fence', () => {
    const { ed, ft } = setup();
    ft.startMove(0);
    expect(ed.moving('fence:0')).toBe(true);
    const M = ed.moveTool;
    expect(M.closed).toBe(false);
    expect(M.points()).toEqual([[0, 0], [10, 0], [10, 10]]); // prettier-ignore
    M.move({ i: 1, x: 10, z: 0 }, 12, 1, [10, 0]);
    expect(ft.fences[0].pts).toEqual([[0, 0], [12, 1], [10, 10]]); // prettier-ignore
    M.move({ i: WHOLE, x: 0, z: 0 }, 1, 2, [0, 0]);
    expect(ft.fences[0].pts).toEqual([[1, 2], [13, 3], [11, 12]]); // prettier-ignore
    M.commit();
    expect(ed.commits).toBe(1);
  });

  it('removing a fence removes its gates and shifts the others', () => {
    const { ed, ft } = setup();
    ed.edits.gates.push({ id: 'a', f: 0, at: [3, 0] }, { id: 'b', f: 1, at: [25, 0] });
    ft.remove(0);
    expect(ed.edits.gates).toEqual([{ id: 'b', f: 0, at: [25, 0] }]);
  });
});

describe('sprinkler heads, one at a time', () => {
  const circuit = () => ({
    id: 'c1',
    heads: [
      { id: 'h1', model: 'hunter-psu-04-15a', at: [2, 3], frame: 'plan' },
      { id: 'h2', model: 'hunter-pgp-ultra', at: [8, 3], frame: 'plan' },
      { id: 'h3', model: 'hunter-mp2000', at: null, frame: 'plan' },
    ],
  });
  const setup = () => {
    const ed = fakeEd({ irrigation: { lines: [], circuits: [circuit()] } });
    ed.toPlan = () => (x, z) => [x, z];
    ed.toStore = (x, z) => [x, z];
    return { ed, it: new IrrigationTools(ed) };
  };
  /** The rings the overlay draws: [x, z, colour] per head, widest ring first. */
  const rings = (ed) => {
    const out = [];
    ed.clickTool.draft({
      ribbon: (pts, color, width) => {
        const xs = pts.map((q) => q[0]);
        out.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, color, width, r: (Math.max(...xs) - Math.min(...xs)) / 2 });
      },
      dot: (x, z, color) => out.push({ dot: true, x, color }),
      line: () => {},
    });
    return out;
  };

  it('unfolds one head at a time and rings it in the view', () => {
    const { ed, it } = setup();
    expect(it.selHead).toBeNull();
    it.selectHead('c1', 'h2');
    expect(it.selHead).toBe('h2');
    expect(ed.clickTool.key).toBe('head-sel:c1');
    expect(ed.clickTool.pick()).toBeNull(); // the overlay draws, it does not take the clicks

    // a ring per head that is down (the third is not placed yet), the one unfolded in red and wider
    const drawn = rings(ed);
    expect(drawn.filter((r) => !r.dot)).toHaveLength(2);
    const red = drawn.filter((r) => r.color === '#ff3b30');
    expect(red.map((r) => r.x)).toEqual([8, 8]); // the ring and the dot of h2
    const pale = drawn.find((r) => r.color !== '#ff3b30');
    expect(pale.x).toBe(2);
    expect(red[0].width).toBeGreaterThan(pale.width);

    it.selectHead('c1', 'h2'); // the same head again: folded, no ring left
    expect(it.selHead).toBeNull();
    expect(rings(ed).some((r) => r.color === '#ff3b30')).toBe(false);
  });

  it('keeps the ring after placing a head, and drops it with the head', () => {
    const { ed, it } = setup();
    it.selectHead('c1', 'h1');
    it.placeHead('c1', 'h3');
    expect(ed.clickTool.key).toBe('head-place'); // placing takes the tool over
    ed.clickTool.click({ point: { x: 5, z: 7 } });
    expect(it.head('c1', 'h3').at).toEqual([5, 7]);
    expect(it.selHead).toBe('h3'); // the head just placed is the one unfolded
    expect(ed.clickTool.key).toBe('head-sel:c1'); // and ringed again
    expect(rings(ed).filter((r) => !r.dot)).toHaveLength(3);

    it.removeHead('c1', 'h3');
    expect(it.selHead).toBeNull();
    expect(rings(ed).filter((r) => !r.dot)).toHaveLength(2);
  });

  it('moves a head to another circuit with everything it was given', () => {
    const ed = fakeEd({ irrigation: { lines: [], circuits: [circuit(), { id: 'c2', heads: [] }] } });
    ed.toPlan = () => (x, z) => [x, z];
    const it = new IrrigationTools(ed);
    const was = { ...it.head('c1', 'h2') };

    expect(it.moveHead('c1', 'h2', 'c2')).toBe(true);
    expect(it.circuit('c1').heads.map((h) => h.id)).toEqual(['h1', 'h3']);
    expect(it.head('c2', 'h2')).toEqual(was); // the same head, not a new one placed again
    expect(it.sel).toBe('c2'); // the panel follows it
    expect(it.selHead).toBe('h2');
    expect(ed.clickTool.key).toBe('head-sel:c2');
    expect(ed.commits).toBe(1);

    // a move that leads nowhere changes nothing
    expect(it.moveHead('c2', 'h2', 'c2')).toBe(false);
    expect(it.moveHead('c2', 'h2', 'nope')).toBe(false);
    expect(it.moveHead('c2', 'gone', 'c1')).toBe(false);
    expect(ed.commits).toBe(1);
  });

  it('stops placing a head that is moved away', () => {
    const ed = fakeEd({ irrigation: { lines: [], circuits: [circuit(), { id: 'c2', heads: [] }] } });
    ed.toPlan = () => (x, z) => [x, z];
    const it = new IrrigationTools(ed);
    it.placeHead('c1', 'h3');
    it.moveHead('c1', 'h3', 'c2');
    expect(it.mode).toBeNull();
    expect(ed.clickTool.key).toBe('head-sel:c2');
  });

  it('leaves no overlay for a circuit that is gone', () => {
    const { ed, it } = setup();
    it.showHeads('nope');
    expect(ed.clickTool).toBeNull();
  });
});

describe('drives and paths', () => {
  const hit = (x, z) => ({ point: { x, z } });

  it('moves a point of a path, then the whole path', () => {
    const ed = fakeEd({ paths: [{ id: 'p1', pts: [[0, 0], [4, 0]], frame: 'plan', w: 2 }] }); // prettier-ignore
    ed.toStore = (x, z) => [x, z];
    ed.toPlan = () => (x, z) => [x, z];
    const pt = new PathTools(ed);
    pt.startMove(0);
    expect(ed.moving('path:0')).toBe(true);
    const M = ed.moveTool;
    M.move({ i: 0, x: 0, z: 0 }, -1, 1, [0, 0]);
    expect(pt.paths[0].pts).toEqual([[-1, 1], [4, 0]]); // prettier-ignore
    M.move({ i: WHOLE, x: 0, z: 0 }, 2, 0, [0, 0]);
    expect(pt.paths[0].pts).toEqual([[1, 1], [6, 0]]); // prettier-ignore
    M.commit();
    expect(ed.commits).toBe(1);
  });
  it('draws a path, edits it, extends it, draws it again', () => {
    const ed = fakeEd({ paths: [] });
    ed.toStore = (x, z) => [x, z];
    ed.toPlan = () => (x, z) => [x, z];
    const pt = new PathTools(ed);
    pt.startDraw();
    expect(ed.clickTool.key).toBe('path-draw');
    ed.clickTool.click(hit(0, 0));
    expect(pt.finishDraw()).toBe(false); // one point
    ed.clickTool.click(hit(5.123, 0));
    ed.clickTool.click(hit(5, 5));
    pt.undoPoint();
    const ribbons = [];
    ed.clickTool.draft({ ribbon: (pts, color, w) => ribbons.push(w), dot() {} });
    expect(ribbons).toEqual([3]); // drawn at the width of a new path
    expect(pt.finishDraw()).toBe(true);
    expect(pt.paths).toHaveLength(1);
    expect(pt.paths[0]).toMatchObject({
      pts: [
        [0, 0],
        [5.12, 0],
      ],
      w: 3,
      surface: 'gravel',
      frame: 'plan',
    });
    expect(pt.paths[0].id).toMatch(/^p/);
    expect(pt.sel).toBe(0);
    pt.edit(0, { w: 4, surface: 'asphalt', edge: true });
    expect(pt.paths[0]).toMatchObject({ w: 4, surface: 'asphalt', edge: true });
    // extend from its last point (in its own frame)
    pt.paths[0].frame = 'grid';
    pt.startDraw(0, true);
    expect(pt.draw.pts).toHaveLength(2);
    ed.clickTool.click(hit(9, 9));
    ed.clickTool.draft({ ribbon: (pts, color, w) => ribbons.push(w), dot() {} });
    expect(ribbons[1]).toBe(4);
    pt.finishDraw();
    expect(pt.paths[0].pts).toHaveLength(3);
    expect(pt.paths[0].w).toBe(4); // kept
    // draw it again from scratch (plan frame points are rounded to the cm)
    pt.startDraw(0);
    expect(pt.draw.pts).toEqual([]);
    pt.draw.frame = 'plan';
    ed.clickTool.click(hit(1.234, 2.345));
    ed.clickTool.click(hit(3, 4));
    pt.finishDraw();
    expect(pt.paths[0].pts).toEqual([
      [1.23, 2.35],
      [3, 4],
    ]);
    pt.undoPoint(); // not drawing: nothing
    pt.select(0);
    expect(pt.sel).toBeNull();
    pt.select(0);
    pt.toggleHidden(0);
    expect(pt.paths[0].hidden).toBe(true);
    pt.startDraw();
    ed.clickTool.draft({ ribbon() {}, dot() {} }); // nothing drawn yet
    pt.remove(0);
    expect(pt.paths).toEqual([]);
    expect(pt.draw).toBeNull();
    expect(ed.clickTool).toBeNull();
  });
});

describe('points dragged right away, section by section', () => {
  const same = (x, z) => [x, z];
  const editor = (edits) => {
    const ed = fakeEd(edits);
    ed.toStore = same;
    ed.toPlan = (o) => (o.frame === 'grid' ? (x, z) => [x + 100, z] : same);
    ed.fromPlan = (o) => (o.frame === 'grid' ? (x, z) => [x - 100, z] : same);
    return ed;
  };
  const LINE = [[0, 0], [4, 0], [4, 3]]; // prettier-ignore

  it('gives the points of the path unfolded in the panel', () => {
    const ed = editor({ paths: [{ id: 'p1', pts: LINE, frame: 'grid', surface: 'gravel' }, { id: 'p2', pts: [[0, 0]] }] }); // prettier-ignore
    const pt = new PathTools(ed);
    expect(pt.handles()).toBeNull(); // nothing unfolded
    pt.select(0);
    const spec = pt.handles();
    expect(spec).toMatchObject({ key: 'path-pts:0' });
    expect(spec.closed).toBeUndefined();
    expect(spec.points()).toEqual([
      [100, 0],
      [104, 0],
      [104, 3],
    ]); // prettier-ignore: in the plan frame
    // a point dragged: stored back in the frame of the path, the stored object itself (nothing is normalized away)
    const stored = pt.paths[0];
    spec.move({ i: 1, x: 104, z: 0 }, 105, 1, [104, 0]);
    expect(pt.paths[0]).toBe(stored);
    expect(stored.pts[1]).toEqual([5, 1]);
    expect(stored.surface).toBe('gravel');
    spec.commit();
    expect(ed.commits).toBe(1);
    // not while a line is being drawn, nor for a path of a single point
    pt.startDraw();
    expect(pt.handles()).toBeNull();
    pt.cancel();
    pt.select(0);
    pt.select(1);
    expect(pt.handles()).toBeNull();
  });

  it('gives the outline of the terrace and of the flower bed unfolded in their panels', () => {
    const SQUARE = [[0, 0], [4, 0], [4, 3], [0, 3]]; // prettier-ignore
    const ed = editor({
      terraces: [{ id: 't1', pts: SQUARE, frame: 'plan' }],
      beds: [{ pts: SQUARE, frame: 'plan' }, { pts: LINE.slice(0, 2) }],
    });
    ed.engine = { world: null };
    const tt = new TerraceTools(ed);
    expect(tt.handles()).toBeNull();
    tt.select(0);
    expect(tt.handles()).toMatchObject({ key: 'terrace-pts:0', closed: true });
    expect(tt.handles().points()).toEqual(SQUARE);
    tt.startDraw('free', 0); // its outline is being drawn again
    expect(tt.handles()).toBeNull();
    tt.cancel();
    // the tools that add and remove points keep the handles beside them
    tt.startPoints(0, 'del');
    expect(tt.handles()).toBeTruthy();

    const bt = new BedTools(ed);
    expect(bt.handles()).toBeNull();
    bt.select(0);
    expect(bt.handles()).toMatchObject({ key: 'bed-pts:0', closed: true });
    bt.startDraw();
    expect(bt.handles()).toBeNull();
    bt.cancel();
    bt.select(0);
    bt.select(1); // two points: no bed yet
    expect(bt.handles()).toBeNull();
  });

  it('gives the coping of the brush to the walls it draws, and to them only', () => {
    const ed = editor({ fences: [{ pts: LINE, closed: false, segs: [{ s: 'wood' }, { s: 'wood' }], frame: 'plan' }], gates: [] });
    const ft = new FenceTools(ed);
    ft.setBrush({ s: 'wall' });
    expect(ft._side()).toEqual({ s: 'wall', h: 1.2 });
    ft.setBrush({ cap: 'brick' });
    ft.setBrush({ capc: '#303030' });
    expect(ft._side()).toEqual({ s: 'wall', h: 1.2, cap: 'brick', capc: '#303030' });
    ft.setBrush({ cap: 'flat-stone' }); // another coping: its own colour again
    expect(ft._side()).toEqual({ s: 'wall', h: 1.2, cap: 'flat-stone' });
    ft.setBrush({ s: 'wood' }); // boards carry none: the coping waits in the brush for the next wall
    expect(ft._side()).toEqual({ s: 'wood', h: 1.8 });
    ft.setBrush({ s: 'wall' });
    expect(ft._side()).toEqual({ s: 'wall', h: 1.2, cap: 'flat-stone' });
    ft.setBrush({ cap: '' });
    expect(ft._side()).toEqual({ s: 'wall', h: 1.2 });
    // painting a side gives it the coping as well
    ft.setBrush({ cap: 'brick' });
    ft.startEdit(0, 'paint');
    ed.clickTool.click({ point: { x: 1, z: 0 } });
    expect(ft.fences[0].segs[0]).toEqual({ s: 'wall', h: 1.2, cap: 'brick' });
  });

  it('gives the points of the fence whose sides are being edited', () => {
    const ed = editor({ fences: [{ pts: LINE, closed: false, segs: [{ s: 'wood' }, { s: 'wood' }], frame: 'plan' }], gates: [] });
    const ft = new FenceTools(ed);
    expect(ft.handles()).toBeNull();
    ft.startEdit(0, 'unpoint');
    const spec = ft.handles();
    expect(spec).toMatchObject({ key: 'fence-pts:0', closed: false });
    spec.move({ i: 2, x: 4, z: 3 }, 6, 6, [4, 3]);
    expect(ft.fences[0].pts[2]).toEqual([6, 6]);
    ft.cancel();
    expect(ft.handles()).toBeNull();
    // the move tool works on the same points, with the fence as a whole
    ft.startMove(0);
    expect(ed.moveTool).toMatchObject({ key: 'fence:0', closed: false });
    ed.moveTool.move({ i: WHOLE, x: 0, z: 0 }, 1, 0, [0, 0]);
    expect(ft.fences[0].pts[0]).toEqual([1, 0]);
  });

  it('gives the points of the drip line unfolded in the panel', () => {
    const ed = editor({
      irrigation: {
        soil: 'loam',
        lines: [
          { id: 'l1', pts: LINE, frame: 'plan' },
          { id: 'l2', pts: [] },
        ],
        circuits: [{ id: 'c1', heads: [] }],
      },
    });
    const it_ = new IrrigationTools(ed);
    expect(it_.handles()).toBeNull();
    it_.sel = 'l1';
    expect(it_.handles()).toMatchObject({ key: 'drip-pts:l1' });
    expect(it_.handles().points()).toEqual(LINE);
    it_.sel = 'l2'; // not drawn yet
    expect(it_.handles()).toBeNull();
    it_.sel = 'c1'; // a circuit of sprinklers has no line
    expect(it_.handles()).toBeNull();
    it_.sel = 'l1';
    it_.drawLine('l1', true); // being drawn again
    expect(it_.handles()).toBeNull();
  });

  it('lets a point be added to a path, a flower bed and a drip line, or removed, in their own frame', () => {
    const SQUARE = [[0, 0], [4, 0], [4, 3], [0, 3]]; // prettier-ignore
    const ed = editor({
      paths: [{ id: 'p1', pts: LINE.map((p) => [...p]), frame: 'grid', surface: 'gravel' }],
      beds: [{ pts: SQUARE.map((p) => [...p]), frame: 'plan' }],
      irrigation: { soil: 'loam', lines: [{ id: 'l1', pts: LINE.map((p) => [...p]), frame: 'plan' }], circuits: [] },
      terraces: [{ id: 't1', pts: SQUARE, frame: 'plan' }],
      fences: [{ pts: LINE, closed: false, segs: [{ s: 'wood' }, { s: 'wood' }], frame: 'plan' }],
      gates: [],
    });
    ed.engine = { world: null };
    const pt = new PathTools(ed);
    pt.select(0);
    // a plan point after the first one: stored in the frame of the path
    pt.handles().insert(0, 102, 0);
    expect(pt.paths[0].pts).toEqual([[0, 0], [2, 0], [4, 0], [4, 3]]); // prettier-ignore
    pt.handles().remove(2);
    expect(pt.paths[0].pts).toEqual([[0, 0], [2, 0], [4, 3]]); // prettier-ignore
    const bt = new BedTools(ed);
    bt.select(0);
    bt.handles().insert(3, 0, 1.5);
    expect(bt.beds[0].pts).toHaveLength(5);
    expect(bt.beds[0].pts[4]).toEqual([0, 1.5]);
    const irr = new IrrigationTools(ed);
    irr.sel = 'l1';
    irr.handles().remove(1);
    expect(irr.line('l1').pts).toEqual([[0, 0], [4, 3]]); // prettier-ignore
    // a terrace and a fence have tools of their own for that: an outline that keeps its shape, sides with a type
    const tt = new TerraceTools(ed);
    tt.select(0);
    expect(tt.handles().insert).toBeUndefined();
    const ft = new FenceTools(ed);
    ft.startEdit(0, 'cut');
    expect(ft.handles().remove).toBeUndefined();
  });
});

describe('flights of steps', () => {
  it('tells what a flight comes to on the ground as it is', () => {
    const ed = fakeEd({
      paths: [
        { id: 'p1', pts: [[0, 0], [3, 0]], frame: 'plan', w: 1.2, surface: 'concrete', stairs: true }, // prettier-ignore
        { id: 'p2', pts: [[0, 0], [3, 0]], frame: 'plan', w: 1.2, surface: 'concrete' }, // prettier-ignore
        { id: 'p3', pts: [[0, 0]], frame: 'plan', stairs: true },
      ],
    });
    ed.toPlan = () => (x, z) => [x, z];
    const pt = new PathTools(ed);
    expect(pt.flight(0)).toBeNull(); // no view yet
    ed.engine = { world: null };
    expect(pt.flight(0)).toBeNull();
    ed.engine = { world: { groundAt: (x) => x * 0.3 } };
    const size = pt.flight(0);
    expect(size.n).toBe(6);
    expect(size.rise).toBeCloseTo(0.15, 9);
    expect(size.going).toBeCloseTo(0.5, 9);
    expect(pt.flight(1)).toBeNull(); // a plain path
    expect(pt.flight(2)).toBeNull(); // a single point
    // going down, a step is as high
    ed.engine.world.groundAt = (x) => -x * 0.3;
    expect(pt.flight(0).rise).toBeCloseTo(0.15, 9);
    // from the top of a deck rather than from the ground under it
    ed.engine.world.walkAt = (x) => (x < 1 ? 0.3 : x * 0.3);
    expect(pt.flight(0).n).toBe(4);
    delete ed.engine.world.walkAt;
    // the number asked for
    pt.edit(0, { steps: 3 });
    expect(pt.flight(0)).toMatchObject({ n: 3, going: 1 });
    pt.edit(0, { steps: '' });
    expect(pt.flight(0).n).toBe(6);
    pt.edit(0, { stairs: false });
    expect(pt.flight(0)).toBeNull();
    // a line too short for a flight
    pt.edit(0, { stairs: true, pts: [[0, 0], [0.1, 0]] }); // prettier-ignore
    expect(pt.flight(0)).toBeNull();
  });
});

describe('terraces', () => {
  const hit = (x, z) => ({ point: { x, z } });
  const same = (x, z) => [x, z];
  /** An editor whose stored frame is the plan itself; `world` gives it a terrain. */
  const editor = (terraces = [], world = null) => {
    const ed = fakeEd({ terraces });
    ed.toStore = same;
    ed.toPlan = () => same;
    ed.engine = { world };
    return ed;
  };
  const draft = () => {
    const seen = { ribbons: [], dots: [] };
    return { seen, ribbon: (pts, color) => seen.ribbons.push({ pts, color }), dot: (x, z, color) => seen.dots.push([x, z, color]) };
  };
  const SQUARE = [[0, 0], [4, 0], [4, 3], [0, 3]]; // prettier-ignore

  it('draws a rectangle with two clicks: its two opposite corners', () => {
    const ed = editor();
    const tt = new TerraceTools(ed);
    tt.startDraw('rect');
    expect(ed.clickTool.key).toBe('terrace-draw');
    ed.clickTool.click(hit(1, 1));
    expect(tt.draw.pts).toEqual([[1, 1]]);
    // the rectangle follows the pointer
    ed.clickTool.hover(hit(5, 4));
    const d = draft();
    ed.clickTool.draft(d);
    expect(d.seen.ribbons[0].pts).toHaveLength(5);
    expect(d.seen.dots).toHaveLength(1);
    ed.clickTool.hover(null); // the pointer left the view
    expect(tt.draw.hover).toBeNull();
    ed.clickTool.click(hit(1.2, 4)); // too narrow to be a corner yet
    expect(tt.terraces).toHaveLength(0);
    ed.clickTool.click(hit(5, 4));
    expect(tt.terraces).toHaveLength(1);
    expect(tt.terraces[0]).toMatchObject({
      pts: [[1, 1], [5, 1], [5, 4], [1, 4]], // prettier-ignore
      shape: 'rect',
      frame: 'plan',
      surface: 'wood-decking',
      alt: null, // no terrain: laid on the ground where it is
    });
    expect(tt.terraces[0].id).toMatch(/^t/);
    expect(tt.sel).toBe(0);
    expect(tt.draw).toBeNull();
    expect(ed.clickTool).toBeNull();
    expect(ed.commits).toBe(1);
  });

  it('draws a free shape point by point, on the ground where it is', () => {
    const ed = editor([], { terrain: { heightAt: (x) => 2 + x / 10 } });
    ed.cfg = {};
    ed._altOf = (y) => y + 150;
    const tt = new TerraceTools(ed);
    tt.startDraw('free');
    for (const [x, z] of [[0, 0], [4, 0], [4, 3]]) ed.clickTool.click(hit(x, z)); // prettier-ignore
    ed.clickTool.click(hit(9, 9));
    tt.undoPoint();
    expect(tt.draw.pts).toHaveLength(3);
    ed.clickTool.hover(hit(0, 3));
    const d = draft();
    ed.clickTool.draft(d);
    expect(d.seen.ribbons[0].pts).toHaveLength(5); // the points, the pointer, then back to the first one
    expect(tt.finishDraw()).toBe(true);
    expect(tt.terraces[0]).toMatchObject({ shape: 'free', alt: 152.25 }); // the ground in its middle, to 5 cm
    expect(tt.terraces[0].pts).toHaveLength(3);
    expect(tt.finishDraw()).toBe(false); // nothing being drawn
    tt.undoPoint();
  });

  it('needs three points, and can be given up', () => {
    const ed = editor();
    const tt = new TerraceTools(ed);
    tt.startDraw('free');
    ed.clickTool.click(hit(0, 0));
    const d = draft();
    ed.clickTool.draft(d); // one point: a dot, a line of one point
    expect(d.seen.dots).toHaveLength(1);
    ed.clickTool.click(hit(4, 0));
    expect(tt.finishDraw()).toBe(false);
    tt.cancel();
    expect(tt.draw).toBeNull();
    expect(ed.clickTool).toBeNull();
    expect(tt.terraces).toHaveLength(0);
  });

  it('draws the outline of a terrace again, keeping everything else', () => {
    const ed = editor([{ id: 't1', pts: SQUARE, frame: 'plan', surface: 'porcelain-tiles', alt: 151, name: 'Deck', c: '#336699' }]);
    const tt = new TerraceTools(ed);
    tt.startDraw('free', 0);
    for (const [x, z] of [[0, 0], [6, 0], [3, 5]]) ed.clickTool.click(hit(x, z)); // prettier-ignore
    const d = draft();
    ed.clickTool.draft(d);
    expect(d.seen.ribbons[0].color).toBe('#cfd3d6'); // in the colour of its covering
    expect(tt.finishDraw()).toBe(true);
    expect(tt.terraces).toHaveLength(1);
    expect(tt.terraces[0]).toMatchObject({ id: 't1', surface: 'porcelain-tiles', alt: 151, name: 'Deck', c: '#336699', shape: 'free' });
    expect(tt.terraces[0].pts).toEqual([[0, 0], [6, 0], [3, 5]]); // prettier-ignore
  });

  it('changes covering, colour, altitude and thickness', () => {
    const ed = editor([{ id: 't1', pts: SQUARE, frame: 'plan' }]);
    const tt = new TerraceTools(ed);
    tt.edit(0, { surface: 'concrete-slab', c: '#AA0000', alt: 151.234, h: 0.2, rot: 45 });
    expect(tt.terraces[0]).toMatchObject({ surface: 'concrete-slab', c: '#aa0000', alt: 151.23, h: 0.2, rot: 45 });
    tt.edit(0, { c: '' }); // back to the colour of the covering
    expect(tt.terraces[0].c).toBeUndefined();
    expect(ed.commits).toBe(2);
    tt.select(0);
    expect(tt.sel).toBe(0);
    tt.select(0);
    expect(tt.sel).toBeNull();
  });

  it('sizes and turns a rectangle about its middle', () => {
    const ed = editor([{ id: 't1', pts: SQUARE, frame: 'plan', shape: 'rect' }]);
    const tt = new TerraceTools(ed);
    tt.resize(0, 6, 2);
    expect(tt.outline(0)).toEqual([[-1, 0.5], [5, 0.5], [5, 2.5], [-1, 2.5]]); // prettier-ignore
    tt.turn(0, 90);
    const turned = tt.outline(0).map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
    expect(turned).toEqual([[3, -1.5], [3, 4.5], [1, 4.5], [1, -1.5]]); // prettier-ignore
    expect(ed.commits).toBe(2);
  });

  it('moves a point, then the whole terrace', () => {
    const ed = editor([{ id: 't1', pts: SQUARE, frame: 'plan' }]);
    const tt = new TerraceTools(ed);
    tt.startDraw('free');
    tt.startMove(0);
    expect(tt.draw).toBeNull();
    expect(tt.sel).toBe(0);
    expect(ed.moving('terrace:0')).toBe(true);
    const M = ed.moveTool;
    expect(M.closed).toBe(true);
    expect(M.points()).toEqual(SQUARE);
    M.move({ i: 2, x: 4, z: 3 }, 5, 4, [4, 3]);
    expect(tt.terraces[0].pts[2]).toEqual([5, 4]);
    M.move({ i: WHOLE, x: 0, z: 0 }, 10, 0, [0, 0]);
    expect(tt.terraces[0].pts[0]).toEqual([10, 0]);
    expect(tt.terraces[0].pts[2]).toEqual([15, 4]);
    M.commit();
    expect(ed.commits).toBe(1);
  });

  it('adds a point on the side clicked, and removes the point clicked', () => {
    const ed = editor([{ id: 't1', pts: SQUARE, frame: 'plan' }]);
    const tt = new TerraceTools(ed);
    tt.startPoints(0, 'add');
    expect(ed.clickTool.key).toBe('terrace-pts');
    expect(tt.pts).toEqual({ i: 0, tool: 'add' });
    ed.clickTool.click(hit(2, -0.3)); // near the first side, half-way
    expect(tt.terraces[0].pts).toEqual([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]); // prettier-ignore
    ed.clickTool.click(hit(2, -9)); // too far from any side
    ed.clickTool.click(hit(0.01, -0.1)); // on a corner: no point there
    expect(tt.terraces[0].pts).toHaveLength(5);
    const d = draft();
    ed.clickTool.draft(d);
    expect(d.seen.ribbons[0].pts).toHaveLength(6);
    expect(d.seen.dots.every(([, , color]) => color === '#ffffff')).toBe(true);

    tt.startPoints(0, 'del');
    const red = draft();
    ed.clickTool.draft(red);
    expect(red.seen.dots.every(([, , color]) => color === '#ff3b30')).toBe(true);
    ed.clickTool.click(hit(2.1, 0.1));
    expect(tt.terraces[0].pts).toEqual(SQUARE);
    ed.clickTool.click(hit(20, 20)); // no point near
    ed.clickTool.click(hit(4, 3));
    expect(tt.terraces[0].pts).toHaveLength(3);
    ed.clickTool.click(hit(0, 0)); // a terrace keeps three points
    expect(tt.terraces[0].pts).toHaveLength(3);
    expect(ed.commits).toBe(3);

    // the terrace is gone meanwhile: nothing to click, nothing to draw
    tt.terraces.length = 0;
    ed.clickTool.click(hit(0, 0));
    const none = draft();
    ed.clickTool.draft(none);
    expect(none.seen.ribbons).toEqual([]);
  });

  it('hides a terrace and removes it, ending the tool in use', () => {
    const ed = editor([
      { id: 't1', pts: SQUARE, frame: 'plan' },
      { id: 't2', pts: SQUARE, frame: 'plan' },
    ]);
    const tt = new TerraceTools(ed);
    tt.toggleHidden(1);
    expect(tt.terraces[1].hidden).toBe(true);
    tt.toggleHidden(1);
    expect(tt.terraces[1].hidden).toBe(false);
    tt.startPoints(0, 'add');
    tt.remove(0);
    expect(tt.terraces.map((t) => t.id)).toEqual(['t2']);
    expect(tt.pts).toBeNull();
    expect(ed.clickTool).toBeNull();
    expect(tt.sel).toBeNull();
    tt.remove(0);
    expect(tt.terraces).toEqual([]);
  });
});

describe('undo and redo beside the tools', () => {
  const same = (x, z) => [x, z];
  const hit = (x, z) => ({ point: { x, z } });
  const editor = (edits) => Object.assign(fakeEd(edits), { toStore: same, toPlan: () => same, fromPlan: () => same });
  const LINE = [[0, 0], [4, 0], [4, 3]]; // prettier-ignore

  it('takes back the last point of the shape being drawn, tool by tool', () => {
    const ed = editor({ fences: [], beds: [], roofs: [], paths: [], terraces: [], irrigation: { lines: [], circuits: [] } });
    const starts = [
      [new FenceTools(ed), (tool) => tool.startDraw()],
      [new BedTools(ed), (tool) => tool.startDraw()],
      [new RoofTools(ed), (tool) => tool.startDraw()],
      [new PathTools(ed), (tool) => tool.startDraw()],
      [new TerraceTools(ed), (tool) => tool.startDraw('free')],
      [new IrrigationTools(ed), (tool) => tool.addLine()],
    ];
    for (const [tool, start] of starts) {
      start(tool);
      expect(typeof ed.clickTool.undo).toBe('function');
      expect(ed.clickTool.undo()).toBe(false); // no point yet: nothing to take back here
      ed.clickTool.click(hit(0, 0));
      ed.clickTool.click(hit(4, 0));
      expect(tool.draw.pts).toHaveLength(2);
      expect(ed.clickTool.undo()).toBe(true);
      expect(tool.draw.pts).toHaveLength(1);
      expect(ed.clickTool.undo()).toBe(true);
      expect(ed.clickTool.undo()).toBe(false);
      tool.cancel();
      expect(tool.undoPoint()).toBe(false); // nothing being drawn
    }
  });

  it('forgets what was known by its rank in a list where an entry came or went', () => {
    const ed = editor({
      fences: [{ pts: LINE, closed: false, segs: [{ s: 'wood' }, { s: 'wood' }], frame: 'plan' }],
      gates: [{ id: 'g', f: 0, at: [2, 0] }],
      beds: [{ pts: [...LINE, [0, 3]], frame: 'plan' }],
      roofs: [{ id: 'r', pts: [...LINE, [0, 3]], frame: 'plan' }],
      paths: [{ id: 'p', pts: LINE, frame: 'plan' }],
      terraces: [{ id: 't', pts: [...LINE, [0, 3]], frame: 'plan' }],
    });
    const ft = new FenceTools(ed);
    const gt = new GateTools(ed);
    const bt = new BedTools(ed);
    const rt = new RoofTools(ed);
    const pt = new PathTools(ed);
    const tt = new TerraceTools(ed);
    const select = () => {
      ft.startEdit(0, 'paint');
      gt.select(0);
      gt.sel = 0;
      bt.sel = 0;
      rt.sel = 0;
      pt.sel = 0;
      tt.sel = 0;
      tt.pts = { i: 0, tool: 'add' };
    };
    select();
    // a change that adds or removes nothing: everything stays as it is
    for (const tool of [ft, gt, bt, rt, pt, tt]) tool.restored([]);
    expect([ft.edit.i, gt.sel, bt.sel, rt.sel, pt.sel, tt.sel]).toEqual([0, 0, 0, 0, 0, 0]);
    // a terrace came back: only the terraces forget
    for (const tool of [ft, gt, bt, rt, pt, tt]) tool.restored(['terraces']);
    expect([ft.edit.i, gt.sel, bt.sel, rt.sel, pt.sel]).toEqual([0, 0, 0, 0, 0]);
    expect([tt.sel, tt.pts, tt.draw]).toEqual([null, null, null]);
    // a fence went: the fence being edited, and the gates, which name their fence by its rank
    for (const tool of [ft, gt, bt, rt, pt, tt]) tool.restored(['fences']);
    expect([ft.edit, ft.draw, gt.sel, gt.mode]).toEqual([null, null, null, null]);
    expect([bt.sel, rt.sel, pt.sel]).toEqual([0, 0, 0]);
    select();
    for (const tool of [ft, gt, bt, rt, pt, tt]) tool.restored(['gates', 'beds', 'roofs', 'paths']);
    expect([gt.sel, bt.sel, rt.sel, pt.sel]).toEqual([null, null, null, null]);
    expect(ft.edit.i).toBe(0);
  });

  it('keeps the lines, circuits and heads of the watering that are still there', () => {
    const ed = editor({
      irrigation: {
        lines: [{ id: 'l1', pts: LINE, frame: 'plan' }],
        circuits: [{ id: 'c1', heads: [{ id: 'h1', at: [1, 1], model: 'hunter-psu-04-15a' }] }, { id: 'c2' }],
      },
    });
    const it_ = new IrrigationTools(ed);
    it_.sel = 'c1';
    it_.selHead = 'h1';
    it_.aimHead('c1', 'h1');
    it_.restored();
    expect([it_.sel, it_.selHead, it_.mode.kind, ed.clickTool.key]).toEqual(['c1', 'h1', 'aim', 'head-aim']);
    // the head went with the undo: its tool is left, and it is no longer the one unfolded
    it_.irr.circuits[0].heads = [];
    it_.restored();
    expect([it_.sel, it_.selHead, it_.mode, ed.clickTool]).toEqual(['c1', null, null, null]);
    // a line being drawn that went: the same, and another tool in use is left alone
    it_.sel = 'l1';
    it_.draw = { id: 'l1', pts: [], frame: 'plan' };
    ed.clickTool = { key: 'fence-edit' };
    it_.irr.lines = [];
    it_.restored();
    expect([it_.sel, it_.draw, ed.clickTool.key]).toEqual([null, null, 'fence-edit']);
    it_.sel = 'c2'; // a circuit without heads yet
    it_.restored();
    expect(it_.sel).toBe('c2');
  });
});
