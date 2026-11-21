// Tide of the sea from the real calendar: two high waters a day that slide by about 50 minutes each day (the moon), and
// spring tides at new and full moon, neap tides at the quarters (the sun adds its own, slightly smaller, wave).
//
// It is an astronomical model with two constituents (M2 lunar, S2 solar) and no harmonic table of the place, so it is
// calibrated on ONE observed high water (`tideRef`, epoch ms) of the real harbour: the following days then stay within a
// few tens of minutes of the real tables. Without calibration, the high water is at noon on the day of the new moon.
const H = 3600000;
const LUNAR_DAY = 24.8412 * H; // a lunar day: two high waters
const SYNODIC = 29.530588 * 24 * H; // new moon to new moon
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
const SOLAR_RATIO = 0.46; // S2 / M2 in the Atlantic (springs 1.46, neaps 0.54: a range ratio of 2.7, as observed)

/** Epoch (ms) of the high water the model starts from: the calibration if any, else noon of a new moon day. */
export const defaultTideRef = () => NEW_MOON - 6.2333 * H;

/**
 * Normalised tide at an instant: -1 (low water of a spring tide) .. 1 (high water of a spring tide).
 * @param {number} ms epoch of the instant
 * @param {number|null} ref epoch of an observed high water of the place (null = uncalibrated)
 */
export function tideLevel(ms, ref) {
  return raw(ms + shiftOf(Number.isFinite(ref) ? ref : defaultTideRef()));
}

// the sum of the two waves, the lunar one peaking at the default high water (noon of a new moon day, springs)
function raw(ms) {
  const m = (2 * Math.PI * (ms - defaultTideRef())) / LUNAR_DAY;
  const d = (2 * Math.PI * (((ms - NEW_MOON) / SYNODIC) % 1)) % (2 * Math.PI); // elongation of the moon
  return (Math.cos(2 * m) + SOLAR_RATIO * Math.cos(2 * m + 2 * d)) / (1 + SOLAR_RATIO);
}

// The whole curve is slid in time so that its peak nearest to the observed high water falls exactly on it (minute by
// minute search, +-6.5 h: the model and the real harbour can be a lunar half day apart).
let shiftCache = [NaN, 0];
function shiftOf(ref) {
  if (shiftCache[0] === ref) return shiftCache[1];
  let best = -2;
  let at = 0;
  for (let k = -390; k <= 390; k++) {
    const v = raw(ref + k * 60000);
    if (v > best) {
      best = v;
      at = k * 60000;
    }
  }
  shiftCache = [ref, at];
  return at;
}

/** Epoch (ms) of the simulated moment: calendar day `doy` of the current year at `hour` (local time of the browser). */
export function simMs(doy, hour, year = new Date().getFullYear()) {
  return new Date(year, 0, doy, Math.floor(hour), Math.round((hour % 1) * 60)).getTime();
}
