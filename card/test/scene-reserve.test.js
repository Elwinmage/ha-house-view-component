import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULTS } from '../src/card-options.js';
import { KEEP_MINUTES, SceneReserve, keepMs, needsNewScene, sameStamps, sceneKey, stampsOf } from '../src/scene-reserve.js';

describe('how long a scene is kept', () => {
  it('follows the option of the card, in minutes', () => {
    expect(keepMs({})).toBe(KEEP_MINUTES * 60000);
    expect(keepMs(undefined)).toBe(KEEP_MINUTES * 60000);
    expect(keepMs({ keep_scene: 30 })).toBe(30 * 60000);
    expect(keepMs({ keep_scene: '2' })).toBe(120000);
    expect(keepMs({ keep_scene: 'x' })).toBe(KEEP_MINUTES * 60000);
    expect(keepMs({ keep_scene: -5 })).toBe(KEEP_MINUTES * 60000);
    expect(DEFAULTS.keep_scene).toBe(KEEP_MINUTES); // the default shown by the editor of the card
  });

  it('still waits a few seconds when nothing is to be kept', () => {
    // Home Assistant takes a card out and puts it back at once when the dashboard enters its edit mode
    expect(keepMs({ keep_scene: 0 })).toBe(5000);
    expect(keepMs({ keep_scene: 0.01 })).toBe(5000);
  });
});

describe('which cards may share a scene', () => {
  it('those configured alike, whatever the order of the keys', () => {
    const a = { type: 'custom:house-view-card', home: 'abc', toolbar_buttons: ['edit', 'sim'], weather_entity: 'weather.home' };
    const b = { weather_entity: 'weather.home', toolbar_buttons: ['edit', 'sim'], home: 'abc', type: 'custom:house-view-card' };
    expect(sceneKey(a)).toBe(sceneKey(b));
    expect(sceneKey({ ...a, home: 'other' })).not.toBe(sceneKey(a));
    expect(sceneKey({ ...a, toolbar_buttons: ['sim', 'edit'] })).not.toBe(sceneKey(a)); // the order of a list counts
    expect(sceneKey({ ...a, show_views: false })).not.toBe(sceneKey(a));
    expect(sceneKey(undefined)).toBe(sceneKey({}));
  });

  it('a new scene is only needed when the quality changes', () => {
    expect(needsNewScene({ quality: 'auto' }, { quality: 'low' })).toBe(true);
    expect(needsNewScene({}, { quality: 'high' })).toBe(true);
    expect(needsNewScene({}, { quality: 'auto' })).toBe(false); // automatic is the default
    expect(needsNewScene({ quality: 'low' }, { quality: 'low', fps_cap: 10, keep_scene: 0 })).toBe(false);
    expect(needsNewScene(undefined, { home: 'abc' })).toBe(false);
  });
});

describe('is a kept scene still up to date', () => {
  const updated = {
    scene: '2026-11-26T10:00:00+00:00',
    terrain: '2026-11-20T08:00:00+00:00',
    edits: '2026-11-26T21:00:00+00:00',
    ortho: null,
    other: 'x',
  };

  it('yes while no document of the scene was written since', () => {
    const mine = stampsOf(updated);
    expect(mine).toEqual({ scene: updated.scene, terrain: updated.terrain, edits: updated.edits, ortho: null });
    expect(sameStamps(mine, { ...updated })).toBe(true);
    expect(sameStamps(mine, { ...updated, other: 'y' })).toBe(true); // not a document of the scene
    expect(sameStamps(mine, { scene: updated.scene, terrain: updated.terrain, edits: updated.edits })).toBe(true); // no photo either way
  });

  it('no once a document was written, added or removed', () => {
    const mine = stampsOf(updated);
    expect(sameStamps(mine, { ...updated, edits: '2026-11-26T22:30:00+00:00' })).toBe(false);
    expect(sameStamps(mine, { ...updated, ortho: '2026-11-26T22:30:00+00:00' })).toBe(false);
    expect(sameStamps(mine, { ...updated, terrain: null })).toBe(false);
  });

  it('kept when nothing can be told', () => {
    expect(stampsOf(undefined)).toBeNull();
    expect(sameStamps(null, updated)).toBe(true);
    expect(sameStamps(stampsOf(updated), undefined)).toBe(true);
  });
});

describe('scenes kept in reserve', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const scene = (name) => ({ name });

  it('gives a scene back to the next card configured alike', () => {
    const reserve = new SceneReserve();
    const released = [];
    const s = scene('home');
    reserve.park(s, 'A', 60000, (x) => released.push(x));
    expect(reserve.size).toBe(1);
    expect(reserve.take('B')).toBeNull();
    expect(reserve.take('A')).toBe(s);
    expect(reserve.size).toBe(0);
    expect(reserve.take('A')).toBeNull(); // one card at a time
    vi.advanceTimersByTime(120000);
    expect(released).toEqual([]); // taken back: no longer waiting
  });

  it('releases a scene nobody came back for', () => {
    const reserve = new SceneReserve();
    const released = [];
    const s = scene('home');
    reserve.park(s, 'A', 60000, (x) => released.push(x));
    vi.advanceTimersByTime(59000);
    expect(released).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(released).toEqual([s]);
    expect(reserve.size).toBe(0);
    expect(reserve.take('A')).toBeNull();
  });

  it('forgets the wait when the card itself is shown again', () => {
    const reserve = new SceneReserve();
    const released = [];
    const s = scene('home');
    reserve.park(s, 'A', 60000, (x) => released.push(x));
    expect(reserve.unpark(s)).toBe(true);
    expect(reserve.unpark(s)).toBe(false);
    vi.advanceTimersByTime(120000);
    expect(released).toEqual([]);
    // away again: the delay starts again from the beginning
    reserve.park(s, 'A', 60000, (x) => released.push(x));
    vi.advanceTimersByTime(30000);
    reserve.park(s, 'A', 60000, (x) => released.push(x));
    vi.advanceTimersByTime(45000);
    expect(released).toEqual([]);
    vi.advanceTimersByTime(20000);
    expect(released).toEqual([s]);
  });

  it('takes the scene that left the page last', () => {
    const reserve = new SceneReserve({ max: 3 });
    const first = scene('first');
    const last = scene('last');
    reserve.park(first, 'A', 60000, () => {});
    reserve.park(last, 'A', 60000, () => {});
    expect(reserve.take('A')).toBe(last);
    expect(reserve.take('A')).toBe(first);
  });

  it('holds two scenes at most: the oldest is released for a third', () => {
    const reserve = new SceneReserve();
    const released = [];
    const [a, b, c] = ['a', 'b', 'c'].map(scene);
    reserve.park(a, 'A', 60000, (x) => released.push(x.name));
    reserve.park(b, 'B', 60000, (x) => released.push(x.name));
    expect(released).toEqual([]);
    reserve.park(c, 'C', 60000, (x) => released.push(x.name));
    expect(released).toEqual(['a']);
    expect(reserve.has(a)).toBe(false);
    expect(reserve.take('B')).toBe(b);
    expect(reserve.take('C')).toBe(c);
    vi.advanceTimersByTime(120000);
    expect(released).toEqual(['a']);
  });
});
