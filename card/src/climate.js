// Seasons of the vegetation and of the grass from the latitude of the home: four seasons in temperate lands, a long
// winter and a short summer toward the poles, a wet and a dry season between the tropics (no winter: the trees keep
// their leaves, the grass yellows a little in the dry season). The southern hemisphere has its seasons reversed.
// Pure functions; a season blend is { from, to, t } between two of 'winter' | 'spring' | 'summer' | 'autumn'.

const TROPIC = 23.44;

/** Climate of a latitude: { zone: 'tropical' | 'temperate' | 'polar', lat, south, ... } */
export function climateFor(latitude) {
  const lat = Number.isFinite(latitude) ? latitude : 45;
  const a = Math.abs(lat);
  const south = lat < 0;
  if (a < TROPIC) {
    // dry season: around February north of the equator, around August south of it; weaker near the equator
    return { zone: 'tropical', lat, south, dryPeak: south ? 227 : 45, amp: 0.15 + 0.25 * Math.min(1, a / TROPIC) };
  }
  // from 50° to 70° the winter grows longer and the summer shorter (k: 0 temperate .. 1 polar)
  const k = Math.max(0, Math.min(1, (a - 50) / 20));
  return {
    zone: k >= 0.5 ? 'polar' : 'temperate',
    lat,
    south,
    // days of the northern calendar: end of the full winter, spring, summer, autumn, start of the full winter
    anchors: [
      ['winter', 15 + 115 * k],
      ['spring', 105 + 60 * k],
      ['summer', 200],
      ['autumn', 290 - 50 * k],
      ['winter', 380 - 95 * k],
      ['winter', 380 + 115 * k],
    ],
  };
}

/** Day of the year turned into the northern calendar (the southern hemisphere is half a year ahead). */
const northern = (doy, c) => (((c.south ? doy + 182 : doy) % 365) + 365) % 365;

/** How far between two seasons the vegetation is on day `doy` (1..365) of the calendar. */
export function seasonBlend(doy, c = climateFor(45)) {
  if (c.zone === 'tropical') {
    const t = (c.amp * (1 + Math.cos((2 * Math.PI * (doy - c.dryPeak)) / 365))) / 2;
    return { from: 'summer', to: 'autumn', t };
  }
  const A = c.anchors;
  let d = northern(doy, c);
  if (d < A[0][1]) d += 365;
  for (let i = 0; i < A.length - 1; i++) {
    if (d <= A[i + 1][1]) {
      const span = A[i + 1][1] - A[i][1];
      return { from: A[i][0], to: A[i + 1][0], t: span > 0 ? (d - A[i][1]) / span : 0 };
    }
  }
  return { from: 'winter', to: 'winter', t: 0 };
}

/** Seasons offered by the preview: the four seasons, or the wet and the dry season between the tropics. */
export function seasonsOf(c) {
  return c.zone === 'tropical' ? ['wet', 'dry'] : ['spring', 'summer', 'autumn', 'winter'];
}

/** Name (key) of the season of day `doy`: one of seasonsOf(c). */
export function seasonKey(doy, c) {
  if (c.zone === 'tropical') {
    const dry = (1 + Math.cos((2 * Math.PI * (doy - c.dryPeak)) / 365)) / 2;
    return dry > 0.5 ? 'dry' : 'wet';
  }
  const s = seasonBlend(doy, c);
  return s.t < 0.5 ? s.from : s.to;
}

/**
 * A day of the calendar (1..365) as the value of an <input type="date">, and back. The year has no bearing on the
 * path the sun takes over a day, so the current one is used throughout.
 */
export const doyToDate = (doy) => new Date(Date.UTC(new Date().getFullYear(), 0, doy)).toISOString().slice(0, 10);

export function dateToDoy(value) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.min(365, Math.max(1, Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)));
}

/** Day of the calendar showing season `key` at its fullest (preview of a season). */
export function seasonDay(key, c) {
  if (c.zone === 'tropical') {
    const d = key === 'dry' ? c.dryPeak : c.dryPeak + 182;
    return ((d - 1) % 365) + 1;
  }
  // middle of the days where the season weighs the most
  let best = -1;
  let days = [];
  for (let d = 1; d <= 365; d++) {
    const s = seasonBlend(d, c);
    const w = (s.from === key ? 1 - s.t : 0) + (s.to === key ? s.t : 0);
    if (w > best + 1e-9) {
      best = w;
      days = [d];
    } else if (Math.abs(w - best) <= 1e-9) days.push(d);
  }
  // the days kept may wrap around the end of the year (a long winter): take the middle of the run
  const runs = [];
  for (const d of days) {
    const r = runs[runs.length - 1];
    if (r && d === r[r.length - 1] + 1) r.push(d);
    else runs.push([d]);
  }
  if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === 365) {
    runs[0] = [...runs.pop(), ...runs[0]];
  }
  const run = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return run[Math.floor(run.length / 2)];
}
