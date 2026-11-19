import { describe, it, expect } from 'vitest';
import { robotToPlan } from '../src/vacuum.js';
import {
  MAP_DEFAULTS,
  mapSettings,
  affineFromCalibration,
  calibrationOf,
  pixelToRobot,
  pixelToPlan,
  mapCorners,
  planToPixel,
} from '../src/vacuum-map.js';

const near = (a, b, digits = 6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits));

// a robot map drawn at 4 pixels per 5 cm cell: 12.5 mm per pixel, y of the robot going up
const robotOf = (u, v) => ({ x: 20000 + u * 12.5, y: 30000 - v * 12.5 });
const pair = (u, v) => ({ vacuum: robotOf(u, v), map: { x: u, y: v } });
const DOCK = { dock: { at: [3, -2], level: 'l0', base: 0 }, origin: [25500, 25500], rot: 0, flip: true, scale: 0.001 };

describe('settings of the picture', () => {
  it('fills the defaults, with the pixel size of the integration', () => {
    expect(mapSettings({})).toEqual(MAP_DEFAULTS);
    expect(mapSettings(null).res).toBe(0.05);
    expect(mapSettings({}, 'roborock').res).toBe(0.0125);
    expect(mapSettings({ map: { res: 0.02, opacity: 0.3 } }, 'roborock')).toMatchObject({ res: 0.02, opacity: 0.3, pin: null });
  });
});

describe('calibration points', () => {
  it('gives the robot coordinates of any pixel from three points', () => {
    const calib = affineFromCalibration([pair(0, 0), pair(800, 0), pair(0, 600)]);
    const p = pixelToRobot(calib, 440, 360);
    near([p.x, p.y], [25500, 25500]);
  });

  it('fits four points, even slightly off', () => {
    const pts = [pair(0, 0), pair(800, 0), pair(800, 600), pair(0, 600)];
    pts[2].vacuum.x += 4; // a rounding of the integration
    const p = pixelToRobot(affineFromCalibration(pts), 400, 300);
    expect(Math.abs(p.x - robotOf(400, 300).x)).toBeLessThan(2);
    expect(p.y).toBeCloseTo(robotOf(400, 300).y, 6);
  });

  it('follows a picture the integration turned by a quarter', () => {
    // pixel u goes along -y of the robot, pixel v along -x
    const turned = (u, v) => ({ vacuum: { x: 30000 - v * 50, y: 30000 - u * 50 }, map: { x: u, y: v } });
    const p = pixelToRobot(affineFromCalibration([turned(0, 0), turned(100, 0), turned(0, 100)]), 10, 20);
    near([p.x, p.y], [29000, 29500]);
  });

  it('refuses what cannot place a picture', () => {
    expect(affineFromCalibration(null)).toBeNull();
    expect(affineFromCalibration([pair(0, 0), pair(10, 10)])).toBeNull();
    expect(affineFromCalibration([pair(0, 0), pair(10, 10), pair(20, 20)])).toBeNull(); // on one line
    expect(affineFromCalibration([pair(0, 0), { vacuum: { x: 'a', y: 1 }, map: { x: 1, y: 1 } }, pair(0, 9)])).toBeNull();
    expect(calibrationOf(undefined)).toBeNull();
    expect(calibrationOf({})).toBeNull();
    expect(calibrationOf({ calibration_points: [pair(0, 0), pair(800, 0), pair(0, 600)] })).not.toBeNull();
  });
});

describe('picture with calibration points', () => {
  const calib = affineFromCalibration([pair(0, 0), pair(800, 0), pair(0, 600)]);
  const size = { w: 800, h: 600 };

  it('puts the pixel of the dock on the dock, whatever the rotation', () => {
    for (const rot of [0, 37, -120]) near(pixelToPlan({ ...DOCK, rot }, mapSettings(DOCK), size, calib, 440, 360), [3, -2]);
  });

  it('places every pixel where the robot would be', () => {
    const v = { ...DOCK, rot: 30 };
    for (const [u, w] of [
      [0, 0],
      [800, 600],
      [123, 456],
    ])
      near(pixelToPlan(v, mapSettings(v), size, calib, u, w), robotToPlan(v, robotOf(u, w)));
    // 800 pixels of 12.5 mm: the top side is 10 m long
    const c = mapCorners(v, mapSettings(v), size, calib);
    expect(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1])).toBeCloseTo(10, 6);
  });

  it('uses the dock coordinates of the position source when it gives them', () => {
    near(pixelToPlan({ ...DOCK, origin: null }, mapSettings(DOCK), size, calib, 440, 360, [25500, 25500]), [3, -2]);
  });

  it('cannot be placed without the dock or its robot coordinates', () => {
    expect(mapCorners({ ...DOCK, dock: null }, mapSettings(DOCK), size, calib)).toBeNull();
    expect(mapCorners({ ...DOCK, origin: null }, mapSettings(DOCK), size, calib)).toBeNull();
  });
});

describe('picture placed by hand', () => {
  const size = { w: 800, h: 600 };
  const hand = (patch = {}, map = {}) => {
    const v = { ...DOCK, map: { res: 0.0125, pin: [440, 360], ...map }, ...patch };
    return [v, mapSettings(v, 'roborock')];
  };

  it('agrees with the calibrated picture when pinned on the dock at the same pixel size', () => {
    const calib = affineFromCalibration([pair(0, 0), pair(800, 0), pair(0, 600)]);
    for (const patch of [{ rot: 0 }, { rot: 52.5 }, { rot: -90, flip: false }]) {
      const [v, m] = hand(patch);
      near(mapCorners(v, m, size, null).flat(), mapCorners(v, m, size, calib).flat());
    }
  });

  it('starts centred on the dock', () => {
    const [v, m] = hand({}, { pin: null });
    near(pixelToPlan(v, m, size, null, 400, 300), [3, -2]);
    near(pixelToPlan(v, m, size, null, 480, 300), [4, -2]); // 80 pixels of 12.5 mm to the right
    near(pixelToPlan(v, m, size, null, 400, 380), [3, -1]); // and down the plan
  });

  it('turns around the dock', () => {
    const [v, m] = hand({ rot: 90 });
    near(pixelToPlan(v, m, size, null, 440, 360), [3, -2]);
    near(pixelToPlan(v, m, size, null, 520, 360), [3, -1]); // the right of the picture now points down the plan
  });

  it('finds the pixel under a point of the plan', () => {
    for (const patch of [{ rot: 0 }, { rot: 33 }, { rot: 140, flip: false }]) {
      const [v, m] = hand(patch);
      near(planToPixel(v, m, size, pixelToPlan(v, m, size, null, 120, 505)), [120, 505]);
    }
    const [v, m] = hand({ dock: null });
    expect(planToPixel(v, m, size, [0, 0])).toBeNull();
  });

  it('is pinned by the pixel tapped where the dock is drawn', () => {
    const [v, m] = hand({ rot: 20 }, { pin: null });
    const tapped = pixelToPlan(v, m, size, null, 610, 95); // the dock as the picture shows it, before pinning
    const pin = planToPixel(v, m, size, tapped);
    near(pin, [610, 95]);
    near(pixelToPlan(v, { ...m, pin }, size, null, 610, 95), [3, -2]);
  });

  it('needs a picture and a dock', () => {
    const [v, m] = hand();
    expect(mapCorners(v, m, null, null)).toBeNull();
    expect(mapCorners(v, m, { w: 0, h: 0 }, null)).toBeNull();
    expect(mapCorners({ ...v, dock: {} }, m, size, null)).toBeNull();
  });
});
