// What a frame costs, kept within what the display can draw: the quality the card asks for, the resolution lowered
// while the camera moves, and the shadows drawn again only when something that casts one has moved. No three.js here
// (the objects are only read): unit-tested.

/**
 * Quality of the picture (option `quality` of the card).
 * - `ratio`: the most pixels of the picture per pixel of the screen, when nothing moves;
 * - `move`: the same while the camera moves (null: never lowered), a start: it goes down while the frames are slow.
 *   Automatic starts from the still picture, so that a display that keeps up shows no difference; the low quality
 *   always moves with fewer pixels;
 * - `shadow`: side of the shadow map; `soft`: blurred shadow edges; `antialias`: smoothed edges of the picture.
 */
export const QUALITY = {
  low: { antialias: false, ratio: 1, move: 0.75, shadow: 1024, soft: false },
  auto: { antialias: true, ratio: 2, move: 2, shadow: 2048, soft: true },
  high: { antialias: true, ratio: 2, move: null, shadow: 2048, soft: true },
};

export const qualityOf = (name) => (Object.hasOwn(QUALITY, name) ? name : 'auto');

const HOLD = 250; // ms the picture stays light after the last move of the camera (the damping, the steps of the wheel)
const FLOOR = 0.5; // the picture is never drawn below this many pixels per pixel of the screen
const STEP = 0.8; // one step down (a third fewer pixels), or back up
const SAMPLES = 5; // frames measured before a try at a higher resolution counts as a success
// Slow frames weigh 1 each and fade (x FADE at every frame): the resolution steps down past WEIGHT, that is after four
// slow frames in a row or when two frames out of three are slow. One slow frame (the browser was busy) changes nothing.
const FADE = 0.75;
const WEIGHT = 2.5;
const RETRY = 10000; // ms before a higher resolution is tried again, doubled each time the try fails
const RETRY_MAX = 160000;

/**
 * Pixel ratio of each frame. The still picture keeps its full resolution; while the camera moves the ratio starts
 * at `move` and steps down as long as the frames come too slowly, so that turning and zooming stay smooth on a small
 * graphics processor. What was learnt is kept for the next moves; a higher ratio is tried again now and then (a slow
 * moment may have been a passing one), less and less often when it fails.
 */
export class MotionScale {
  constructor(rest, move = null, floor = FLOOR) {
    this.adapt = move !== null;
    this.floor = floor;
    this.move = move;
    this.setRest(rest);
    this.until = 0;
    this.moving = false;
    this.wait = RETRY;
    this.tryAt = Infinity;
    this.trying = false;
    this._reset();
  }

  /** The ratio of the still picture (the screen changed, or the zoom of the browser). */
  setRest(rest) {
    this.rest = rest;
    this.top = this.adapt ? Math.min(rest, this.move) : rest;
    this.low = Math.min(this.floor, this.top);
    this.ratio = this.ratio === undefined ? this.top : Math.min(this.top, Math.max(this.low, this.ratio));
  }

  _reset() {
    this.n = 0;
    this.slow = 0;
    this.skip = true; // the frame after a change of resolution pays for it: not measured
  }

  /**
   * @param {number} now     ms
   * @param {boolean} moved  the camera moved since the previous frame
   * @param {number} dt      ms since the previous drawn frame
   * @param {number} wanted  ms between two frames when the display keeps up (the cap of the card)
   * @returns {number} the pixel ratio to draw this frame with
   */
  next(now, moved, dt, wanted) {
    if (moved) this.until = now + HOLD;
    const moving = now < this.until;
    if (!moving) {
      if (this.moving) this._settle(now);
      this.moving = false;
      return this.rest;
    }
    if (!this.adapt) return this.rest;
    if (!this.moving) {
      this.moving = true;
      this._reset();
      if (this.ratio < this.top && now >= this.tryAt) {
        this.before = this.ratio;
        this.ratio = Math.min(this.top, this.ratio / STEP);
        this.trying = true;
      }
      return this.ratio;
    }
    if (this.skip) this.skip = false;
    else {
      this.n++;
      this.slow = this.slow * FADE + (dt > Math.max(wanted * 1.4, 40) ? 1 : 0);
    }
    if (this.slow > WEIGHT && this.ratio > this.low) {
      this.ratio = Math.max(this.low, this.ratio * STEP);
      if (this.trying) this.wait = Math.min(RETRY_MAX, this.wait * 2); // the try failed: the next one comes later
      this.trying = false;
      this.tryAt = now + this.wait;
      this._reset();
    }
    return this.ratio;
  }

  /**
   * End of a move. A try that held is kept, and the next one may come after the usual delay; a move too short to
   * tell leaves things as they were (the try is made again at the next move).
   */
  _settle(now) {
    if (this.trying) {
      if (this.n >= SAMPLES) {
        this.wait = RETRY;
        this.tryAt = now + this.wait;
      } else this.ratio = this.before;
    }
    this.trying = false;
  }
}

/**
 * A number that changes when what casts a shadow changes: an object moved, turned, was resized, shown or hidden, added
 * or removed, or its shape was edited in place. Read after a frame is drawn (the world matrices are then up to date);
 * the objects hidden with one of their parents are skipped, as the renderer does.
 */
export function castersSign(root) {
  let sum = 0;
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o.visible) continue;
    if (o.castShadow && o.geometry) {
      const e = o.matrixWorld.elements;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      n++;
      sum +=
        (e[12] * 1.13 + e[13] * 2.27 + e[14] * 3.41 + e[0] * 5.3 + e[5] * 7.1 + e[10] * 11.9 + e[1] * 13.7 + e[2] * 17.3 + e[6] * 19.1) *
          (1 + (n % 31)) +
        o.geometry.id * 0.37 +
        (pos ? pos.version * 0.73 : 0);
    }
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
  return sum + n * 1000003;
}
