// The card hears from the integration that another build of itself is on the server (card_bundle.py): it offers to
// reload the page, or reloads it by itself when nobody is using it (option `auto_reload`, for a wall display).
// Pure: no DOM, unit-tested.

/** Where the page keeps the build it already reloaded itself for (the time of the tab). */
export const RELOAD_KEY = 'house-view-card-reloaded-for';
/** A page reloads itself once it was left alone this long (ms). */
export const RELOAD_IDLE_MS = 5000;

/**
 * The build a bundle was loaded as: the `v` of its own address (the loader of the integration puts the version and
 * the fingerprint of the file there). Null without one: a test page, a bundle added by hand as a resource.
 */
export function buildOf(url) {
  try {
    return new URL(url).searchParams.get('v') || null;
  } catch {
    return null;
  }
}

/** Is the build on the server (`theirs`) another one than the build running (`mine`)? Both have to be known. */
export const isOtherBuild = (mine, theirs) => !!mine && !!theirs && mine !== theirs;

/**
 * Should the page reload itself now? With the option on (`auto`), for a build it did not reload for already
 * (`tried`: a browser that keeps giving the bundle of before must not reload for ever), while nobody is at work in
 * the card (`busy`: a panel open, corrections not saved yet) and the page was left alone for a while (`idleMs`).
 */
export function shouldReload({ mine, theirs, auto, tried, busy, idleMs }) {
  return isOtherBuild(mine, theirs) && !!auto && tried !== theirs && !busy && idleMs >= RELOAD_IDLE_MS;
}
