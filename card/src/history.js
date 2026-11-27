// Undo and redo of what the editors change: the states a document went through (the corrections made by hand, the
// model of the plan builder), each kept as text. A state is taken after every change, so going back is putting the
// one before it into the document again. Pure: no three.js, no DOM, unit-tested.

/** States kept to go back to, and the characters they may take all together. */
export const HISTORY_STATES = 100;
export const HISTORY_CHARS = 8e6;

export class History {
  constructor({ states = HISTORY_STATES, chars = HISTORY_CHARS } = {}) {
    this.states = states;
    this.chars = chars;
    this.reset(null);
  }

  /**
   * Forget every state: `doc` is the document as it now stands (read again, imported, changed by something that
   * is not to be undone here). Null when there is no document yet.
   */
  reset(doc) {
    this.past = []; // the states to go back to, the oldest first
    this.future = []; // the states undone, the next one to do again last
    this.now = doc === null || doc === undefined ? null : JSON.stringify(doc);
  }

  /**
   * The document may have changed: when it did, the state it had is kept to go back to, and what was undone can no
   * longer be done again. Returns true when it had changed.
   */
  note(doc) {
    const text = JSON.stringify(doc);
    if (text === this.now) return false;
    if (this.now !== null) this.past.push(this.now);
    this.now = text;
    this.future = [];
    this._trim();
    return true;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** The document as it was before its last change (a new object each time), or null when there is none. */
  undo() {
    if (!this.past.length) return null;
    this.future.push(this.now);
    this.now = this.past.pop();
    return JSON.parse(this.now);
  }

  /** The document as it was before the last undo, or null when nothing was undone. */
  redo() {
    if (!this.future.length) return null;
    this.past.push(this.now);
    this.now = this.future.pop();
    return JSON.parse(this.now);
  }

  /** The oldest states go first: too many of them, or too heavy all together (the last one is always kept). */
  _trim() {
    let size = this.past.reduce((sum, text) => sum + text.length, 0);
    while (this.past.length > this.states || (size > this.chars && this.past.length > 1)) size -= this.past.shift().length;
  }
}

const isList = (v) => Array.isArray(v);
const isRecord = (v) => !!v && typeof v === 'object' && !isList(v);

/**
 * Make `target` equal to `source` without replacing it: its lists and its objects are changed in place, entry by
 * entry and key by key, so what holds one of them (the editors, a tool at work on an entry) still holds the live
 * one. A value that changes kind (a list for an object, a number for a list) is replaced, and so is an object met
 * a second time (two entries sharing their points after a copy). The keys come out in the order of `source`: the
 * document reads as the state did, to the letter. Returns `target`.
 */
export function syncInto(target, source, seen = new WeakSet()) {
  if (!isList(target) && !isRecord(target)) return target; // nothing to put a state into
  seen.add(target);
  const merged = (mine, theirs) => {
    const alike = (isList(mine) && isList(theirs)) || (isRecord(mine) && isRecord(theirs));
    // an object the document holds in two places is put back in the first one: the other gets one of its own
    return alike && !seen.has(mine) ? syncInto(mine, theirs, seen) : theirs;
  };
  if (isList(target) && isList(source)) {
    target.length = Math.min(target.length, source.length);
    source.forEach((value, i) => {
      target[i] = merged(target[i], value);
    });
  } else if (isRecord(target) && isRecord(source)) {
    // the keys are laid again in the order of the state: the document is saved as it was, key for key
    const mine = { ...target };
    for (const key of Object.keys(target)) delete target[key];
    for (const [key, value] of Object.entries(source)) target[key] = merged(mine[key], value);
  }
  return target;
}

/**
 * How many entries each list of a document holds: its own lists (`fences`), and those of its objects
 * (`irrigation.lines`). Comparing two of them tells in which lists an entry came or went: what was selected there by
 * its rank may be another entry now.
 */
export function listSizes(doc) {
  const sizes = {};
  for (const [key, value] of Object.entries(doc || {})) {
    if (isList(value)) sizes[key] = value.length;
    else if (isRecord(value)) for (const [sub, list] of Object.entries(value)) if (isList(list)) sizes[`${key}.${sub}`] = list.length;
  }
  return sizes;
}

/** The lists whose number of entries differs between two `listSizes`. */
export function resizedLists(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]);
}

/**
 * What a key press asks for: true to undo (Ctrl+Z, Cmd+Z on a Mac), false to do again (Ctrl+Y, Ctrl+Shift+Z,
 * Cmd+Shift+Z), null for any other key.
 */
export function undoKey(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = String(e.key || '').toLowerCase();
  if (key === 'z') return !e.shiftKey;
  return key === 'y' && !e.shiftKey ? false : null;
}

/** The inputs nothing is typed in: a key pressed while one of them has the focus is not for it. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image']);

/**
 * Is the key of event `e` for a field being typed in? There, Ctrl+Z is the undo of the field itself. `settled(el)`
 * tells the fields whose text is the value they stand for (nothing typed since it was taken): those leave the key
 * to the editor, which puts the value back and the field with it.
 */
export function typingIn(e, settled = null) {
  const el = (e && e.composedPath ? e.composedPath()[0] : null) || (e && e.target);
  if (!el || !el.tagName) return false;
  const tag = String(el.tagName).toLowerCase();
  if (tag === 'textarea' || el.isContentEditable) return true;
  if (tag !== 'input' || NOT_TYPED.has(String(el.type || '').toLowerCase())) return false;
  return !(settled && settled(el));
}
