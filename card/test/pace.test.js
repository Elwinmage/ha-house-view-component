import { describe, expect, it } from 'vitest';

import { MotionScale, QUALITY, castersSign, qualityOf } from '../src/engine/pace.js';

describe('quality of the picture', () => {
  it('falls back to automatic for an unknown name', () => {
    expect(qualityOf('low')).toBe('low');
    expect(qualityOf('high')).toBe('high');
    expect(qualityOf(undefined)).toBe('auto');
    expect(qualityOf('ultra')).toBe('auto');
    expect(qualityOf('toString')).toBe('auto');
  });

  it('never lightens the high quality, and makes the low one cheaper everywhere', () => {
    expect(QUALITY.high.move).toBeNull();
    expect(QUALITY.auto).toMatchObject({ antialias: true, ratio: QUALITY.high.ratio, shadow: QUALITY.high.shadow, soft: true });
    expect(QUALITY.low.antialias).toBe(false);
    expect(QUALITY.low.ratio).toBeLessThan(QUALITY.auto.ratio);
    expect(QUALITY.low.move).toBeLessThan(QUALITY.auto.move);
    expect(QUALITY.low.shadow).toBeLessThan(QUALITY.auto.shadow);
  });
});

/** Frames of a camera move: `n` frames `dt` ms apart, starting at `t`; returns the ratios and the time reached. */
function move(scale, t, n, dt, wanted = 1000 / 30) {
  const ratios = [];
  for (let i = 0; i < n; i++) {
    t += dt;
    ratios.push(scale.next(t, true, dt, wanted));
  }
  return { ratios, t };
}

describe('resolution while the camera moves', () => {
  it('keeps the full picture when nothing moves', () => {
    const s = new MotionScale(2, 1);
    expect(s.next(1000, false, 33, 33)).toBe(2);
    expect(s.next(1033, false, 33, 33)).toBe(2);
  });

  it('never lowers the high quality', () => {
    const s = new MotionScale(2, null);
    expect(move(s, 0, 40, 200).ratios.every((r) => r === 2)).toBe(true);
  });

  it('draws fewer pixels as soon as the camera moves, and all of them again a moment after it stops', () => {
    const s = new MotionScale(2, 1);
    const { ratios, t } = move(s, 0, 10, 33);
    expect(ratios.every((r) => r === 1)).toBe(true);
    // the camera glides to a stop: the picture stays light for a quarter of a second
    expect(s.next(t + 100, false, 33, 33)).toBe(1);
    expect(s.next(t + 240, false, 33, 33)).toBe(1);
    expect(s.next(t + 260, false, 33, 33)).toBe(2);
  });

  it('never goes above the resolution of the screen', () => {
    const s = new MotionScale(1, 1);
    expect(move(s, 0, 10, 33).ratios.every((r) => r === 1)).toBe(true);
    const low = new MotionScale(1, 0.75);
    expect(move(low, 0, 3, 33).ratios[0]).toBe(0.75);
  });

  it('steps down while the frames come too slowly, down to half the pixels of the screen', () => {
    const s = new MotionScale(1, 1);
    const { ratios } = move(s, 0, 60, 90);
    expect(ratios[0]).toBe(1);
    expect(ratios[10]).toBeLessThan(1);
    expect(ratios.at(-1)).toBe(0.5);
    expect(Math.min(...ratios)).toBe(0.5);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]);
  });

  it('leaves the resolution alone when the frames come as wanted', () => {
    const s = new MotionScale(1, 1);
    expect(move(s, 0, 100, 34).ratios.every((r) => r === 1)).toBe(true);
    // a single slow frame (the browser was busy) is not a slow display
    const one = new MotionScale(1, 1);
    move(one, 0, 10, 33);
    one.next(600, true, 250, 33);
    expect(move(one, 600, 10, 33).ratios.every((r) => r === 1)).toBe(true);
  });

  it('judges a slow frame against the cap of the card', () => {
    // 10 frames per second asked for: 100 ms between two frames is what is wanted
    const s = new MotionScale(1, 1);
    expect(move(s, 0, 40, 100, 100).ratios.every((r) => r === 1)).toBe(true);
    expect(move(new MotionScale(1, 1), 0, 40, 160, 100).ratios.at(-1)).toBeLessThan(1);
  });

  it('remembers what it learnt for the next moves', () => {
    const s = new MotionScale(1, 1);
    let { t } = move(s, 0, 60, 90);
    t += 1000;
    expect(s.next(t, false, 33, 33)).toBe(1); // at rest: the full picture
    expect(move(s, t, 3, 33).ratios[0]).toBe(0.5);
  });

  it('steps down when two frames out of three are slow, not when one out of two is', () => {
    const two = new MotionScale(1, 1);
    let t = 0;
    for (let i = 0; i < 40; i++) two.next((t += 50), true, i % 3 === 2 ? 33 : 60, 33);
    expect(two.ratio).toBeLessThan(1);
    const half = new MotionScale(1, 1);
    t = 0;
    for (let i = 0; i < 80; i++) half.next((t += 42), true, i % 2 ? 33 : 50, 33); // the display misses every other frame
    expect(half.ratio).toBe(1);
  });

  it('tries a higher resolution again after a while, and keeps it when it holds', () => {
    const s = new MotionScale(1, 1);
    let { t } = move(s, 0, 8, 90); // one step down
    expect(s.ratio).toBeCloseTo(0.8);
    s.next((t += 1000), false, 33, 33);
    // too early: the next move stays at the learnt resolution
    ({ t } = move(s, t, 10, 33));
    expect(s.ratio).toBeCloseTo(0.8);
    s.next((t += 12000), false, 33, 33);
    const again = move(s, t, 10, 33);
    expect(again.ratios[0]).toBe(1);
    s.next(again.t + 1000, false, 33, 33);
    expect(s.ratio).toBe(1);
  });

  it('waits longer and longer when the tries fail', () => {
    const s = new MotionScale(1, 1);
    let { t } = move(s, 0, 8, 90);
    const waits = [];
    for (let k = 0; k < 3; k++) {
      s.next((t += s.wait + 1000), false, 33, 33);
      ({ t } = move(s, t, 8, 90)); // the try: slow again, so back down
      expect(s.ratio).toBeCloseTo(0.8);
      waits.push(s.wait);
    }
    expect(waits).toEqual([20000, 40000, 80000]);
  });

  it('does not take a move too short to tell for a success', () => {
    const s = new MotionScale(1, 1);
    let { t } = move(s, 0, 8, 90);
    s.next((t += 12000), false, 33, 33);
    ({ t } = move(s, t, 2, 33)); // two frames at the higher resolution: nothing proven
    s.next((t += 1000), false, 33, 33);
    expect(s.ratio).toBeCloseTo(0.8);
    expect(move(s, t, 2, 33).ratios[0]).toBe(1); // tried again at the next move
  });

  it('follows the screen when the still picture changes', () => {
    const s = new MotionScale(2, 1);
    s.setRest(1.5);
    expect(s.next(0, false, 33, 33)).toBe(1.5);
    const low = new MotionScale(1, 0.75);
    low.setRest(0.6); // the browser is zoomed out: the moving picture is never finer than the still one
    expect(low.next(0, true, 33, 33)).toBe(0.6);
  });
});

/** A stand-in for a three.js object: what castersSign reads. */
function node({ at = [0, 0, 0], cast = false, visible = true, geometry = null, children = [] } = {}) {
  const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1];
  return { visible, castShadow: cast, geometry, matrixWorld: { elements }, children };
}
const shape = (id, version = 0) => ({ id, attributes: { position: { version } } });

describe('what casts a shadow', () => {
  const world = () => {
    const tree = node({ at: [4, 0, 2], cast: true, geometry: shape(1) });
    const gate = node({ at: [9, 0, -3], cast: true, geometry: shape(2) });
    const lawn = node({ at: [0, 0, 0], geometry: shape(3) }); // receives shadows, casts none
    const level = node({ children: [node({ at: [1, 2.5, 1], cast: true, geometry: shape(4) })] });
    return { root: node({ children: [tree, gate, lawn, level] }), tree, gate, lawn, level };
  };

  it('is the same from one frame to the next when nothing changed', () => {
    const w = world();
    expect(castersSign(w.root)).toBe(castersSign(w.root));
    expect(castersSign(world().root)).toBe(castersSign(w.root));
  });

  it('changes when an object that casts a shadow moves, turns or is resized', () => {
    const w = world();
    const before = castersSign(w.root);
    w.gate.matrixWorld.elements[12] += 0.01;
    const moved = castersSign(w.root);
    expect(moved).not.toBe(before);
    // a gate swinging: the rotation changes the matrix, not the position
    const c = Math.cos(0.3);
    const s = Math.sin(0.3);
    Object.assign(w.gate.matrixWorld.elements, { 0: c, 2: -s, 8: s, 10: c });
    const turned = castersSign(w.root);
    expect(turned).not.toBe(moved);
    Object.assign(w.gate.matrixWorld.elements, { 0: c, 2: s, 8: -s, 10: c }); // the same angle the other way
    expect(castersSign(w.root)).not.toBe(turned);
    w.tree.matrixWorld.elements[5] = 1.2; // a tree growing with the season
    expect(castersSign(w.root)).not.toBe(turned);
  });

  it('changes when a level is hidden, an object added or removed, or a shape edited in place', () => {
    const w = world();
    const before = castersSign(w.root);
    w.level.visible = false;
    const hidden = castersSign(w.root);
    expect(hidden).not.toBe(before);
    w.level.visible = true;
    expect(castersSign(w.root)).toBe(before);
    w.root.children.push(node({ at: [0, 0, 0], cast: true, geometry: shape(9) }));
    expect(castersSign(w.root)).not.toBe(before);
    w.root.children.pop();
    w.tree.geometry.attributes.position.version++;
    expect(castersSign(w.root)).not.toBe(before);
    w.tree.geometry = shape(12);
    expect(castersSign(w.root)).not.toBe(before);
  });

  it('ignores what casts no shadow', () => {
    const w = world();
    const before = castersSign(w.root);
    w.lawn.matrixWorld.elements[13] = 3;
    w.root.children.push(node({ at: [5, 5, 5], geometry: shape(20) }));
    // hidden with its parent: the renderer skips it too
    w.root.children.push(node({ visible: false, children: [node({ at: [7, 0, 7], cast: true, geometry: shape(21) })] }));
    expect(castersSign(w.root)).toBe(before);
  });
});
