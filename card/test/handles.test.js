import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WorldEditors, opKindOf } from '../src/editors.js';
import { emptyEdits } from '../src/engine/edits.js';
import { WHOLE } from '../src/move.js';

/** A stand-in for the engine: a scene for the overlays, a flat ground, 10 pixels a metre seen from above. */
const fakeEngine = () => ({
  scene: new THREE.Scene(),
  edits: emptyEdits(),
  world: { groundAt: () => 0, terrain: null },
  terrainCfg: null,
  picker: null,
  moveGrab: null,
  commits: 0,
  setPicker(fn) {
    this.picker = fn;
  },
  pointerAt: (ev) => [ev.x, ev.y],
  project: (x, y, z) => [x * 10, z * 10],
  commit() {
    this.commits++;
    if (this.onLoaded) this.onLoaded();
  },
});

/** An editor over it, and a line of three points with its handles. */
function setup() {
  const engine = fakeEngine();
  let changes = 0;
  const ed = new WorldEditors(engine, { onChange: () => changes++ });
  const line = { pts: [[0, 0], [4, 0], [4, 4]] }; // prettier-ignore
  const spec = (key = 'line') => ({
    key,
    points: () => line.pts,
    move: (h, x, z) => {
      line.pts = line.pts.map((p, i) => (i === h.i ? [x, z] : p));
    },
    commit: () => engine.commit(),
  });
  return { engine, ed, line, spec, changes: () => changes };
}

const dots = (ed) => ed.draft.children.filter((c) => c.isMesh && c.geometry.type === 'SphereGeometry');
const colours = (ed) => dots(ed).map((d) => d.material.color.getHexString());

describe('points dragged right away', () => {
  it('shows a handle on each point of the object being edited, none for the object as a whole', () => {
    const { engine, ed, spec } = setup();
    expect(engine.moveGrab).toBeNull();
    ed.setHandles(spec());
    expect(engine.moveGrab).toBeTruthy();
    expect(colours(ed)).toEqual(['ffffff', 'ffffff', 'ffffff']);
    expect(ed._handles(ed.handles).some((h) => h.i === WHOLE)).toBe(false);
    // the handle under the pointer, within reach
    expect(engine.moveGrab.pick({ x: 41, y: 2 })).toMatchObject({ i: 1, x: 4, z: 0 });
    expect(engine.moveGrab.pick({ x: 200, y: 200 })).toBeNull();
    expect(engine.moveGrab.y({ x: 4, z: 0 })).toBe(0);
    // no tool is in use for all that: the view still turns under the pointer
    expect(ed.active).toBe(false);
    expect(ed.clickTool).toBeNull();
  });

  it('drags a point: the overlay follows, the world is rebuilt when it is dropped', () => {
    const { engine, ed, line, spec } = setup();
    ed.setHandles(spec());
    const h = engine.moveGrab.pick({ x: 40, y: 0 });
    engine.moveGrab.start(h, 4, 0);
    expect(ed.handles.grab).toBe(h);
    expect(engine.moveGrab.pick({ x: 0, y: 0 })).toBeNull(); // one at a time
    expect(colours(ed)).toEqual(['ffffff', 'ffe14d', 'ffffff']); // the one taken is lit up
    engine.moveGrab.move(h, 6, 1);
    engine.moveGrab.move(h, 7, 2);
    expect(line.pts[1]).toEqual([7, 2]);
    expect(engine.commits).toBe(0); // not before the drop
    // while it moves, the outline is drawn (the world has not followed yet)
    expect(ed.draft.children.length).toBeGreaterThan(3);
    engine.moveGrab.end(h);
    expect(engine.commits).toBe(1);
    expect(ed.handles.grab).toBeNull();
    expect(colours(ed)).toEqual(['ffffff', 'ffffff', 'ffffff']);
    expect(ed.draft.children).toHaveLength(3); // the dots alone, where the points now are
    expect(dots(ed)[1].position.x).toBe(7);
  });

  it('leaves a press that does not move to the tool in use, as a click on that spot', () => {
    const { engine, ed, spec } = setup();
    const clicks = [];
    ed.setClickTool({
      key: 'remove-point',
      pick: (ev) => ({ point: { x: ev.x / 10, z: ev.y / 10 } }),
      click: (hit) => clicks.push(hit.point),
    });
    ed.setHandles(spec());
    const ev = { x: 40, y: 0 };
    const h = engine.moveGrab.pick(ev);
    engine.moveGrab.start(h, 4, 0);
    engine.moveGrab.tap(h, ev);
    expect(clicks).toEqual([{ x: 4, z: 0 }]);
    expect(ed.handles.grab).toBeNull(); // let go: the next press takes a handle again
    expect(engine.moveGrab.pick(ev)).toBeTruthy();
    expect(engine.commits).toBe(0);
    // and without a tool, nothing happens
    ed.setClickTool(null);
    engine.moveGrab.start(h, 4, 0);
    engine.moveGrab.tap(h, ev);
    expect(clicks).toHaveLength(1);
  });

  it('keeps a drag going when the same object is rendered again, and follows what was changed elsewhere', () => {
    const { engine, ed, line, spec } = setup();
    ed.setHandles(spec());
    const state = ed.handles;
    const h = engine.moveGrab.pick({ x: 40, y: 0 });
    engine.moveGrab.start(h, 4, 0);
    ed.setHandles(spec()); // the panel is rendered again during the drag
    expect(ed.handles).toBe(state);
    expect(ed.handles.grab).toBe(h);
    engine.moveGrab.end(h);
    // a point typed in the panel: the dots move at the next render
    line.pts = [[0, 0], [9, 9], [4, 4]]; // prettier-ignore
    expect(dots(ed)[1].position.x).toBe(4);
    ed.setHandles(spec());
    expect(dots(ed)[1].position.x).toBe(9);
    const before = ed.draft.children[0];
    ed.setHandles(spec()); // nothing changed: nothing drawn again
    expect(ed.draft.children[0]).toBe(before);
  });

  it('goes to another object, and away with the last one', () => {
    const { engine, ed, spec } = setup();
    ed.setHandles(null); // nothing to remove
    expect(engine.moveGrab).toBeNull();
    ed.setHandles(spec('a'));
    const first = ed.handles;
    ed.setHandles(spec('b'));
    expect(ed.handles).not.toBe(first);
    expect(ed.handles.spec.key).toBe('b');
    ed.setHandles(null);
    expect(ed.handles).toBeNull();
    expect(engine.moveGrab).toBeNull();
    expect(dots(ed)).toHaveLength(0);
  });

  it('gives way to the move tool, and comes back when it is left', () => {
    const { engine, ed, line, spec } = setup();
    ed.setHandles(spec());
    ed.setMoveTool({ ...spec('line-move'), whole: true });
    // the handles are now those of the move tool: the object as a whole can be taken too
    const whole = engine.moveGrab.pick({ x: 20, y: 20 });
    expect(whole.i).toBe(WHOLE);
    expect(dots(ed)).toHaveLength(4);
    // a press that does not move takes the handle; the next click drops it
    const h = engine.moveGrab.pick({ x: 40, y: 0 });
    engine.moveGrab.start(h, 4, 0);
    engine.moveGrab.tap(h, {});
    expect(ed.move.grab).toBe(h);
    ed.clickTool.click({ point: { x: 5, z: 5 } });
    expect(line.pts[1]).toEqual([5, 5]);
    expect(engine.commits).toBe(1);
    ed.setMoveTool(null);
    expect(ed.move).toBeNull();
    expect(engine.moveGrab.pick({ x: 20, y: 20 })).toBeNull(); // back to the points alone
    expect(engine.moveGrab.pick({ x: 0, y: 0 })).toMatchObject({ i: 0 });
    expect(dots(ed)).toHaveLength(3);
  });

  it('waits for the view', () => {
    const { engine, ed, spec } = setup();
    engine.world = null;
    ed.setHandles(spec());
    expect(dots(ed)).toHaveLength(0);
    ed.setHandles(spec()); // nothing to compare yet
    engine.world = { groundAt: () => 0, terrain: null };
    engine.commit(); // the view is built: the overlay is drawn
    expect(dots(ed)).toHaveLength(3);
  });
});

describe('points of a ground correction', () => {
  /** A terrain whose grid is the plan itself. */
  const withTerrain = () => {
    const made = setup();
    made.engine.terrainCfg = { data: { center: [0, 0] }, rot: 0, scale: 1, mirror: false, dx: 0, dz: 0 };
    made.engine.edits.terrain = [
      { type: 'wall', pts: [[0, 0], [10, 0]], hi: 2, lo: 0, side: 1 }, // prettier-ignore
      { type: 'brush', pt: [5, 5], r: 2, mode: 'set', value: 1 },
      { type: 'terrace', poly: [[0, 0], [4, 0], [4, 4]], alt: 1 }, // prettier-ignore
      { type: 'brush' },
    ];
    return made;
  };

  it('are handles while corrections are picked in the view or no tool is in use', () => {
    const { ed } = withTerrain();
    expect(ed.opHandles()).toBeNull(); // nothing selected
    ed.selOp = 0;
    const wall = ed.opHandles();
    expect(wall).toMatchObject({ key: 'op:0', closed: false });
    expect(wall.points()).toHaveLength(2);
    ed.tool.mode = 'select';
    expect(ed.opHandles()).toBeTruthy();
    // a brush, or a wall being drawn, keeps the clicks to itself
    ed.tool.mode = 'brush-set';
    expect(ed.opHandles()).toBeNull();
    ed.tool.mode = 'off';
    ed.clickTool = { key: 'other' };
    expect(ed.opHandles()).toBeNull();
    ed.clickTool = null;
    ed.selOp = 2;
    expect(ed.opHandles()).toMatchObject({ key: 'op:2', closed: true });
    ed.selOp = 1;
    expect(ed.opHandles().points()).toHaveLength(1); // a brush is one point
    ed.selOp = 3;
    expect(ed.opHandles()).toBeNull(); // a correction without a point
    ed.selOp = 9;
    expect(ed.opHandles()).toBeNull();
  });

  it('move the correction they belong to', () => {
    const { ed, engine } = withTerrain();
    ed.selOp = 0;
    const spec = ed.opHandles();
    const [, end] = spec.points();
    spec.move({ i: 1, x: end[0], z: end[1] }, end[0] + 1, end[1] + 2, end);
    const moved = spec.points()[1];
    expect(moved[0]).toBeCloseTo(end[0] + 1, 6);
    expect(moved[1]).toBeCloseTo(end[1] + 2, 6);
    expect(spec.points()[0]).toEqual(ed.opHandles().points()[0]);
    spec.commit();
    expect(engine.commits).toBe(1);
    // the move tool works on the same points, with the correction as a whole
    ed.startOpMove(0);
    expect(ed.moving('op:0')).toBe(true);
    ed.startOpMove(3); // nothing to move
    expect(ed.moving('op:0')).toBe(true);
    // while it is in use, the move tool has its own handles: none beside it
    expect(ed.opHandles()).toBeNull();
    ed.setMoveTool(null);
    // a brush is moved by its single point
    ed.selOp = 1;
    const brush = ed.opHandles();
    const [at] = brush.points();
    brush.move({ i: 0, x: at[0], z: at[1] }, at[0] + 3, at[1], at);
    expect(brush.points()[0][0]).toBeCloseTo(at[0] + 3, 6);
  });
});

describe('ground corrections shown on the view', () => {
  const wall = (z) => ({ type: 'wall', pts: [[0, z], [10, z]], hi: 105, lo: 103, side: 1, flat: 1, feather: 1 }); // prettier-ignore
  const OPS = () => [
    wall(0),
    { type: 'terrace', poly: [[0, -4], [10, -4], [10, 4], [0, 4]], alt: 104, feather: 1 }, // prettier-ignore
    { type: 'brush', pt: [5, 0], r: 2, mode: 'set', value: 104 },
    wall(8),
  ];
  /** An editor over a ground with two walls, a platform and a brush stroke; `drawn` lists what the overlay shows. */
  function ground() {
    const { engine, ed, changes } = setup();
    engine.edits.terrain = OPS();
    engine.terrainCfg = { data: { center: [0, 0] }, base: 2 };
    engine.world.terrain = { zRef: 100, heightAt: () => 0 };
    const drawn = [];
    ed._drawOp = (group, op, i, level) => drawn.push(level === 2 ? `${i}*` : `${i}`);
    const shown = () => {
      drawn.length = 0;
      ed.drawDraft();
      return drawn.join(' ');
    };
    return { engine, ed, shown, changes };
  }

  it('tells the kind of correction a tool draws', () => {
    expect(opKindOf('wall')).toBe('wall');
    expect(opKindOf('terrace')).toBe('terrace');
    expect(['brush-set', 'brush-add', 'brush-smooth'].map(opKindOf)).toEqual(['brush', 'brush', 'brush']);
    expect(['off', 'select', 'section'].map(opKindOf)).toEqual(['all', 'all', 'all']);
  });

  it('shows them all while they are picked, and the kind of the tool that draws one', () => {
    const { ed, shown } = ground();
    expect(shown()).toBe(''); // no ground tool: nothing on the view
    ed.setTool('select', false);
    expect(ed.showOps).toBe('all');
    expect(shown()).toBe('0 1 2 3');
    // the wall tool: the walls alone, the last one selected in place of what was
    ed.selOp = 1;
    ed.setTool('wall', false);
    expect(ed.showOps).toBe('wall');
    expect(ed.selOp).toBe(3);
    expect(shown()).toBe('0 3*');
    ed.setTool('terrace', false);
    expect(ed.selOp).toBe(1);
    expect(shown()).toBe('1*');
    ed.setTool('brush-add', false);
    expect(shown()).toBe('2*');
    // from one brush to another the kind is the same: the selection stays
    ed.setTool('brush-smooth', false);
    expect(ed.selOp).toBe(2);
    // back to picking: all of them again
    ed.setTool('select', false);
    expect(shown()).toBe('0 1 2* 3');
  });

  it('shows the kind chosen in the panel, and keeps the selected one in sight', () => {
    const { ed, shown, changes } = ground();
    ed.setTool('select', false);
    ed.selOp = 0;
    const before = changes();
    ed.setShowOps('terrace');
    expect(changes()).toBe(before + 1); // the panel follows
    expect(ed.selOp).toBe(1);
    expect(shown()).toBe('1*');
    // a correction of another kind picked in the list stays on the view with the kind shown
    ed.selectOp(3);
    expect(shown()).toBe('1 3*');
    expect(ed.opShown(ed.edits.terrain[0], 0)).toBe(false);
    // a kind with nothing drawn yet leaves the selection alone
    ed.deleteOp(2);
    ed.selectOp(2); // the second wall, now the last of the list
    ed.setShowOps('brush');
    expect(ed.selOp).toBe(2);
    expect(shown()).toBe('2*');
    ed.setShowOps('anything else');
    expect(ed.showOps).toBe('all');
    expect(shown()).toBe('0 1 2*');
  });

  it('only picks a correction that is shown', () => {
    const { ed } = ground();
    ed.setTool('select', false);
    ed.setShowOps('terrace');
    // over the first wall, which lies on the platform: the platform is the one under the pointer
    ed._setHover([5, 0.2]);
    expect(ed.hoverOp).toBe(1);
    ed.setShowOps('all');
    ed._setHover([5, 0.2]);
    expect(ed.hoverOp).toBe(2); // the brush stroke, the narrowest of the three
  });

  it('adds a point to the wall or the platform selected, and removes one', () => {
    const { ed } = ground();
    ed.setTool('select', false);
    ed.selectOp(0);
    expect(ed.opHandles()).toMatchObject({ key: 'op:0', closed: false });
    // the tool takes the clicks, the outlines of the ground tools go, the points of the wall stay
    ed.setHandles(ed.opHandles());
    ed.setPointsTool('add');
    expect(ed.tool.mode).toBe('off');
    expect(ed.opHandles()).toMatchObject({ key: 'op:0' });
    ed._ptsClick({ point: { x: 4.004, z: 0.3 } });
    expect(ed.edits.terrain[0].pts).toEqual([[0, 0], [4, 0], [10, 0]]); // prettier-ignore
    ed.setPointsTool('del');
    ed._ptsClick({ point: { x: 9.6, z: 0.2 } });
    expect(ed.edits.terrain[0].pts).toEqual([[0, 0], [4, 0]]); // prettier-ignore
    ed._ptsClick({ point: { x: 0, z: 0 } }); // a wall keeps two points
    expect(ed.edits.terrain[0].pts).toHaveLength(2);
    // a platform: its outline is closed, the side from its last point to the first one takes a point too
    ed.selectOp(1);
    ed.setHandles(ed.opHandles());
    ed.setPointsTool('add');
    ed._ptsClick({ point: { x: -0.2, z: 1 } });
    expect(ed.edits.terrain[1].poly).toEqual([[0, -4], [10, -4], [10, 4], [0, 4], [0, 1]]); // prettier-ignore
    // a brush stroke is a single point: nothing to add or remove
    ed.selectOp(2);
    expect(ed.opHandles().insert).toBeUndefined();
    // another click tool keeps the points of the correction out of the view, as before
    ed.setClickTool({ key: 'other', click: () => {} });
    expect(ed.opHandles()).toBeNull();
  });

  it('draws the outline of a wall along its top', () => {
    const { ed } = ground();
    const line = [[0, 0], [10, 0], [10, 10]]; // prettier-ignore
    const top = ed._wallTop({ ...wall(0), hi2: 101 }, line);
    // altitude 105 at its first point, 101 at the last one, 100 being the floor of a scene raised by 2
    expect(top(0, 0)).toBeCloseTo(7, 6);
    expect(top(10, 0)).toBeCloseTo(5, 6);
    expect(top(10, 10)).toBeCloseTo(3, 6);
    expect(top(5, 0.4)).toBeCloseTo(6, 6); // beside the line: the top where it is nearest
    expect(ed._wallTop(wall(0), line)(10, 10)).toBeCloseTo(7, 6); // a level top
  });
});

describe('a point more, a point less', () => {
  /** The line of three points as an object whose points can be added and removed. */
  function free(closed = false) {
    const s = setup();
    const spec = (key = 'line') => ({
      ...s.spec(key),
      closed,
      insert: (i, x, z) => s.line.pts.splice(i + 1, 0, [x, z]),
      remove: (i) => s.line.pts.splice(i, 1),
    });
    return { ...s, free: spec };
  }
  const click = (ed, x, z) => ed._ptsClick({ point: { x, z } });

  it('puts a point on the side clicked', () => {
    const { engine, ed, line, free: spec, changes } = free();
    ed.setHandles(spec());
    const before = changes();
    ed.setPointsTool('add');
    expect(ed.pointsMode()).toBe('add');
    expect(ed.active).toBe(true); // the tool takes the clicks of the view
    expect(changes()).toBeGreaterThan(before);
    click(ed, 2, 0.4);
    expect(line.pts).toEqual([[0, 0], [2, 0], [4, 0], [4, 4]]); // prettier-ignore
    expect(engine.commits).toBe(1);
    expect(colours(ed)).toHaveLength(4); // the new point has its handle
    // on a point that is there already, or away from the line: nothing
    click(ed, 0.05, 0);
    click(ed, -5, -5);
    expect(line.pts).toHaveLength(4);
    expect(engine.commits).toBe(1);
    // the same button again leaves the tool
    ed.setPointsTool('add');
    expect(ed.pointsMode()).toBeNull();
    expect(ed.clickTool).toBeNull();
    expect(ed.ptsTool).toBeNull();
  });

  it('removes the point clicked, down to a line of two', () => {
    const { ed, line, free: spec } = free();
    ed.setHandles(spec());
    ed.setPointsTool('del');
    expect(ed.pointsMode()).toBe('del');
    click(ed, 9, 9); // too far from any point
    expect(line.pts).toHaveLength(3);
    click(ed, 4.2, 0.1);
    expect(line.pts).toEqual([[0, 0], [4, 4]]); // prettier-ignore
    click(ed, 0, 0);
    expect(line.pts).toHaveLength(2);
    // from one mode to the other without leaving the tool
    ed.setPointsTool('add');
    expect(ed.pointsMode()).toBe('add');
    ed.setPointsTool(null);
    expect(ed.pointsMode()).toBeNull();
  });

  it('keeps three points to an outline, and closes it when a point is added', () => {
    const { ed, line, free: spec } = free(true);
    ed.setHandles(spec());
    ed.setPointsTool('add');
    click(ed, 2, 2.1); // on the side that closes it, from the last point back to the first
    expect(line.pts).toHaveLength(4);
    expect(line.pts[3][0]).toBeCloseTo(2.05, 6);
    ed.setPointsTool('del');
    click(ed, 2, 2);
    click(ed, 4, 4);
    expect(line.pts).toEqual([[0, 0], [4, 0], [4, 4]]); // prettier-ignore
  });

  it('leaves alone an object that has tools of its own, or no handles at all', () => {
    const { engine, ed, line, spec } = setup();
    ed.setPointsTool('add');
    click(ed, 2, 0); // nothing is being edited
    ed.setHandles(spec()); // a fence, a terrace: no `insert`
    click(ed, 2, 0);
    expect(line.pts).toHaveLength(3);
    expect(engine.commits).toBe(0);
  });

  it('works on an object given to it, which has no handles in the view', () => {
    const { ed, line, free: spec } = free(true);
    ed.setPointsTool('add', spec('island'));
    expect(ed.pointsMode('island')).toBe('add');
    expect(ed.pointsMode()).toBeNull();
    expect(ed.pointsMode('other')).toBeNull();
    expect(colours(ed)).toEqual(['ffffff', 'ffffff', 'ffffff']); // its points are shown while the tool is in use
    click(ed, 2, -0.3);
    expect(line.pts).toHaveLength(4);
    ed.setPointsTool('add', spec('island'));
    expect(ed.clickTool).toBeNull();
    expect(colours(ed)).toEqual([]);
  });
});

describe('undo beside the tools', () => {
  it('takes back the last point of a ground correction being drawn', () => {
    const { ed, changes } = setup();
    expect(ed.undoPoint()).toBe(false); // nothing being drawn
    ed.tool.mode = 'wall';
    expect(ed.undoPoint()).toBe(false); // no point yet
    ed.tool.pts = [[0, 0], [4, 0]]; // prettier-ignore
    const before = changes();
    expect(ed.undoPoint()).toBe(true);
    expect(ed.tool.pts).toEqual([[0, 0]]);
    expect(changes()).toBe(before + 1); // the panel follows
    expect(ed.undoPoint()).toBe(true);
    expect(ed.undoPoint()).toBe(false);
  });

  it('asks the click tool in use for the last point of what it draws', () => {
    const { ed } = setup();
    let points = 2;
    ed.setClickTool({ key: 'draw', click() {}, undo: () => points > 0 && !!points-- });
    expect(ed.undoPoint()).toBe(true);
    expect(ed.undoPoint()).toBe(true);
    expect(ed.undoPoint()).toBe(false);
    ed.setClickTool({ key: 'paint', click() {} }); // a tool that draws nothing
    expect(ed.undoPoint()).toBe(false);
  });

  it('leaves the tool in use and the correction selected when an entry came or went', () => {
    const { ed, spec } = setup();
    ed.selOp = 2;
    ed.setMoveTool(spec('fence:0'));
    // nothing came or went: the tool goes on, on the very object it was given
    ed.restored([]);
    expect(ed.moving('fence:0')).toBe(true);
    expect(ed.selOp).toBe(2);
    // a tree planted or pulled out: the tools of the trees know them by where they stand
    ed.restored(['trees.added']);
    expect(ed.moving('fence:0')).toBe(true);
    // a fence came back: the one being moved may be another one now
    ed.restored(['fences']);
    expect(ed.clickTool).toBeNull();
    expect(ed.move).toBeNull();
    expect(ed.selOp).toBe(2); // the ground corrections did not change
    ed.restored(['terrain']);
    expect(ed.selOp).toBe(-1);
  });
});
