import { describe, expect, it } from 'vitest';
import { History, listSizes, resizedLists, syncInto, typingIn, undoKey } from '../src/history.js';

describe('states of a document', () => {
  it('goes back over the changes, and forth again', () => {
    const doc = { fences: [], pool: { dy: 0 } };
    const H = new History();
    H.reset(doc);
    expect([H.canUndo, H.canRedo]).toEqual([false, false]);
    expect(H.undo()).toBeNull();
    expect(H.redo()).toBeNull();
    doc.fences.push({ pts: [[0, 0]] });
    expect(H.note(doc)).toBe(true);
    expect(H.note(doc)).toBe(false); // told twice about the same change: one state
    doc.pool.dy = 0.4;
    H.note(doc);
    expect(H.past).toHaveLength(2);
    expect(H.undo()).toEqual({ fences: [{ pts: [[0, 0]] }], pool: { dy: 0 } });
    expect(H.undo()).toEqual({ fences: [], pool: { dy: 0 } });
    expect(H.undo()).toBeNull();
    expect([H.canUndo, H.canRedo]).toEqual([false, true]);
    expect(H.redo()).toEqual({ fences: [{ pts: [[0, 0]] }], pool: { dy: 0 } });
    expect(H.redo()).toEqual({ fences: [{ pts: [[0, 0]] }], pool: { dy: 0.4 } });
    expect(H.redo()).toBeNull();
  });

  it('gives a new object each time, and forgets what was undone once the document changes again', () => {
    const H = new History();
    H.reset({ n: 1 });
    H.note({ n: 2 });
    const back = H.undo();
    back.n = 99; // changing what was given back changes no state
    expect(H.redo()).toEqual({ n: 2 });
    H.undo();
    H.note({ n: 3 }); // another way from the first state: the second one is gone
    expect(H.canRedo).toBe(false);
    expect(H.undo()).toEqual({ n: 1 });
  });

  it('starts from the first document it is told about when it has none', () => {
    const H = new History();
    expect(H.note({ n: 1 })).toBe(true);
    expect(H.canUndo).toBe(false); // nothing was known before it
    H.note({ n: 2 });
    expect(H.undo()).toEqual({ n: 1 });
    H.reset({ n: 5 }); // read again: nothing of before
    expect([H.canUndo, H.canRedo]).toEqual([false, false]);
    H.reset(undefined);
    expect(H.now).toBeNull();
  });

  it('keeps a bounded number of states, and a bounded weight', () => {
    const H = new History({ states: 3 });
    H.reset({ n: 0 });
    for (let n = 1; n <= 10; n++) H.note({ n });
    expect(H.past.map((text) => JSON.parse(text).n)).toEqual([7, 8, 9]);
    const heavy = new History({ chars: 50 });
    heavy.reset({ text: 'a'.repeat(40) });
    heavy.note({ text: 'b'.repeat(40) });
    heavy.note({ text: 'c'.repeat(40) });
    expect(heavy.past).toHaveLength(1); // the last one is kept, however heavy
    expect(heavy.undo()).toEqual({ text: 'b'.repeat(40) });
  });
});

describe('putting a state back into the live document', () => {
  it('changes lists and objects in place, so what holds them holds the live ones', () => {
    const fence = {
      pts: [
        [0, 0],
        [4, 0],
      ],
      segs: [{ s: 'wall', h: 1, cap: 'brick' }],
      hidden: true,
    };
    const doc = { fences: [fence], pool: { dy: 0.4 }, sea: { on: true }, views: [] };
    const { pts, segs } = fence;
    const side = segs[0];
    const same = syncInto(doc, {
      fences: [
        {
          pts: [
            [0, 0],
            [2, 0],
            [2, 3],
          ],
          segs: [
            { s: 'wood', h: 1.8 },
            { s: 'mesh', h: 1.5 },
          ],
        },
        { pts: [], segs: [] },
      ],
      pool: { dy: 0 },
      sea: null,
      zones: [{ id: 'z' }],
    });
    expect(same).toBe(doc);
    expect(doc.fences[0]).toBe(fence); // the same fence, changed
    expect(fence.pts).toBe(pts);
    expect(fence.segs[0]).toBe(side);
    expect(fence).toEqual({
      pts: [
        [0, 0],
        [2, 0],
        [2, 3],
      ],
      segs: [
        { s: 'wood', h: 1.8 },
        { s: 'mesh', h: 1.5 },
      ],
    });
    expect('hidden' in fence).toBe(false); // keys the state does not have are gone
    expect(doc.fences).toHaveLength(2);
    expect(doc).toEqual({
      fences: [fence, { pts: [], segs: [] }],
      pool: { dy: 0 },
      sea: null, // an object for nothing: replaced
      zones: [{ id: 'z' }],
    });
    expect('views' in doc).toBe(false);
  });

  it('lays the keys again in the order of the state: the document reads as the state did', () => {
    const state = { fences: [{ pts: [], closed: false, segs: [], hidden: false, frame: 'grid' }], gates: [], pool: { dy: 0 } };
    const text = JSON.stringify(state);
    // the live document: the same fence before it was given its missing fields, its keys in another order
    const doc = { pool: { dy: 2 }, fences: [{ frame: 'grid', pts: [[1, 1]], closed: false, segs: [] }], zones: [] };
    syncInto(doc, JSON.parse(text));
    expect(JSON.stringify(doc)).toBe(text);
  });

  it('shortens a list, and replaces what changes kind', () => {
    const doc = { list: [{ a: 1 }, { a: 2 }, { a: 3 }], value: [1, 2], other: { k: 1 } };
    const first = doc.list[0];
    syncInto(doc, { list: [{ a: 9 }], value: { x: 1 }, other: [1] });
    expect(doc).toEqual({ list: [{ a: 9 }], value: { x: 1 }, other: [1] });
    expect(doc.list[0]).toBe(first);
    expect(syncInto(5, { a: 1 })).toBe(5); // nothing to put a state into
  });

  it('gives each entry its own points when two of them shared theirs', () => {
    const pts = [
      [0, 0],
      [1, 1],
    ];
    const doc = {
      pools: [
        { id: 'a', pts },
        { id: 'b', pts },
      ],
    }; // a copy that kept the points of its model
    syncInto(doc, {
      pools: [
        {
          id: 'a',
          pts: [
            [0, 0],
            [1, 1],
          ],
        },
        {
          id: 'b',
          pts: [
            [5, 5],
            [6, 6],
          ],
        },
      ],
    });
    expect(doc.pools[0].pts).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(doc.pools[1].pts).toEqual([
      [5, 5],
      [6, 6],
    ]);
    expect(doc.pools[1].pts).not.toBe(doc.pools[0].pts);
  });

  it('tells in which lists an entry came or went', () => {
    const before = listSizes({
      fences: [1, 2],
      gates: [],
      irrigation: { soil: 'loam', lines: [1], circuits: [] },
      sea: null,
      pool: { dy: 0 },
    });
    expect(before).toEqual({ fences: 2, gates: 0, 'irrigation.lines': 1, 'irrigation.circuits': 0 });
    const after = listSizes({ fences: [1], gates: [], irrigation: { lines: [1, 2] }, zones: [1] });
    expect(resizedLists(before, after).sort()).toEqual(['fences', 'irrigation.circuits', 'irrigation.lines', 'zones']);
    expect(resizedLists(before, before)).toEqual([]);
    expect(listSizes(null)).toEqual({});
  });
});

describe('keys', () => {
  const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it('reads undo and redo, on a PC and on a Mac', () => {
    expect(undoKey(key('z', { ctrlKey: true }))).toBe(true);
    expect(undoKey(key('Z', { metaKey: true }))).toBe(true);
    expect(undoKey(key('y', { ctrlKey: true }))).toBe(false);
    expect(undoKey(key('Z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(undoKey(key('z', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(undoKey(key('z'))).toBeNull();
    expect(undoKey(key('z', { ctrlKey: true, altKey: true }))).toBeNull(); // AltGr on some keyboards
    expect(undoKey(key('y', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(undoKey(key('a', { ctrlKey: true }))).toBeNull();
    expect(undoKey(key(undefined, { ctrlKey: true }))).toBeNull();
    expect(undoKey(null)).toBeNull();
  });

  it('leaves the key to a field being typed in', () => {
    const on = (el) => ({ composedPath: () => [el, {}], target: {} });
    expect(typingIn(on({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(typingIn(on({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(typingIn(on({ tagName: 'INPUT', type: 'text' }))).toBe(true);
    expect(typingIn(on({ tagName: 'INPUT', type: 'number' }))).toBe(true);
    expect(typingIn(on({ tagName: 'INPUT' }))).toBe(true);
    // nothing is typed in these
    for (const type of ['checkbox', 'radio', 'range', 'color', 'button', 'file'])
      expect(typingIn(on({ tagName: 'INPUT', type }))).toBe(false);
    expect(typingIn(on({ tagName: 'BUTTON' }))).toBe(false);
    expect(typingIn(on({ tagName: 'CANVAS' }))).toBe(false);
    expect(typingIn(on({}))).toBe(false);
    // without the path of the event, its target
    expect(typingIn({ target: { tagName: 'INPUT', type: 'text' } })).toBe(true);
    expect(typingIn({})).toBe(false);
    expect(typingIn(null)).toBe(false);
  });

  it('takes the key back from a field whose text is the value it stands for', () => {
    const field = { tagName: 'INPUT', type: 'number' };
    const e = { composedPath: () => [field] };
    expect(typingIn(e, () => true)).toBe(false);
    expect(typingIn(e, () => false)).toBe(true);
    expect(typingIn({ composedPath: () => [{ tagName: 'TEXTAREA' }] }, () => true)).toBe(true); // never taken back
  });
});
