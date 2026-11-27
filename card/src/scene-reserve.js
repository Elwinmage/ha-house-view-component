// Scenes kept in reserve. Home Assistant throws a card away when another dashboard is opened and creates a new one on
// the way back: the plan, the ground and the whole 3D scene would be read and built again each time. The scene of a
// card that left the page waits here instead: the next card with the same configuration takes it back as it was left,
// and a scene nobody came back for is released after a delay, which gives its memory back. No DOM here: unit-tested.

import { qualityOf } from './engine/pace.js';

export const KEEP_MINUTES = 10; // default of the card option `keep_scene`
// A card taken out of the page is very often put back at once (the dashboard enters its edit mode, a view is drawn
// again): even with `keep_scene: 0` its scene waits this long.
const GRACE_MS = 5000;

/** How long the scene of a card with this configuration is kept once the card left the page (ms). */
export function keepMs(config) {
  const minutes = Number(config && config.keep_scene);
  return Math.max(GRACE_MS, (Number.isFinite(minutes) && minutes >= 0 ? minutes : KEEP_MINUTES) * 60000);
}

const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;

/** Two cards may share a scene when they are configured alike: the configuration, whatever the order of its keys. */
export function sceneKey(config) {
  return JSON.stringify(sorted(config || {}));
}

/**
 * Does the new configuration of a card need a scene of its own? What is settled when the graphics context is created
 * (the quality: smoothed edges, kind of shadows) cannot change on a living scene; everything else is applied to it.
 */
export function needsNewScene(before, after) {
  return qualityOf(before && before.quality) !== qualityOf(after && after.quality);
}

/** The documents a scene is built from, and when the integration last wrote each of them (`updated` of its info). */
const DOCS = ['scene', 'terrain', 'edits', 'ortho'];

export function stampsOf(updated) {
  return updated ? Object.fromEntries(DOCS.map((k) => [k, updated[k] ?? null])) : null;
}

/**
 * Is a scene built from documents stamped `mine` still what the integration holds (`updated`)? When either side is
 * unknown the scene is kept: nothing says it is out of date.
 */
export function sameStamps(mine, updated) {
  if (!mine || !updated) return true;
  return DOCS.every((k) => (mine[k] ?? null) === (updated[k] ?? null));
}

export class SceneReserve {
  /** `max`: scenes waiting at most (each one holds a graphics context); beyond, the oldest is released. */
  constructor({ max = 2, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this.max = max;
    this._set = setTimer;
    this._clear = clearTimer;
    this._waiting = new Map(); // scene -> { key, timer, release }, oldest first
  }

  get size() {
    return this._waiting.size;
  }

  has(scene) {
    return this._waiting.has(scene);
  }

  /** A scene left the page: it waits `ms` for a card of the same key, then `release(scene)` is called. */
  park(scene, key, ms, release) {
    this.unpark(scene);
    const timer = this._set(() => this._release(scene), ms);
    this._waiting.set(scene, { key, timer, release });
    while (this._waiting.size > this.max) this._release(this._waiting.keys().next().value);
  }

  /** The scene is shown again (by its own card, or taken with take()): it no longer waits. */
  unpark(scene) {
    const w = this._waiting.get(scene);
    if (!w) return false;
    this._clear(w.timer);
    this._waiting.delete(scene);
    return true;
  }

  /** The scene waiting for this key, the one that left the page last; null when none waits. */
  take(key) {
    let found = null;
    for (const [scene, w] of this._waiting) if (w.key === key) found = scene;
    if (found) this.unpark(found);
    return found;
  }

  _release(scene) {
    const w = this._waiting.get(scene);
    if (!w) return;
    this._clear(w.timer);
    this._waiting.delete(scene);
    w.release(scene);
  }
}
