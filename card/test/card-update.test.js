import { describe, expect, it } from 'vitest';
import { RELOAD_IDLE_MS, buildOf, isOtherBuild, shouldReload } from '../src/card-update.js';

describe('a newer build of the card on the server', () => {
  it('reads the build a bundle was loaded as from its own address', () => {
    expect(buildOf('http://ha.local:8123/house_view/house-view-card.js?v=1.2.0-0a1b2c3d')).toBe('1.2.0-0a1b2c3d');
    expect(buildOf('http://ha.local:8123/house_view/house-view-card.js')).toBeNull(); // added by hand: unknown
    expect(buildOf('http://ha.local:8123/house_view/house-view-card.js?v=')).toBeNull();
    expect(buildOf('file:///card/src/house-view-card.js')).toBeNull();
    expect(buildOf('not an address')).toBeNull();
    expect(buildOf(undefined)).toBeNull();
  });

  it('tells another build from the one running, when both are known', () => {
    expect(isOtherBuild('1.2.0-aaaa', '1.2.0-bbbb')).toBe(true);
    expect(isOtherBuild('1.2.0-aaaa', '1.3.0-aaaa')).toBe(true);
    expect(isOtherBuild('1.2.0-aaaa', '1.2.0-aaaa')).toBe(false);
    expect(isOtherBuild(null, '1.2.0-bbbb')).toBe(false); // a test page: nothing to compare
    expect(isOtherBuild('1.2.0-aaaa', null)).toBe(false); // the bundle is gone from the server: nothing to load
    expect(isOtherBuild('1.2.0-aaaa', undefined)).toBe(false);
  });

  it('reloads the page by itself only when asked to, once per build, and when nobody is using it', () => {
    const ask = { mine: 'a', theirs: 'b', auto: true, tried: null, busy: false, idleMs: RELOAD_IDLE_MS };
    expect(shouldReload(ask)).toBe(true);
    expect(shouldReload({ ...ask, auto: false })).toBe(false); // the button offers it instead
    expect(shouldReload({ ...ask, auto: undefined })).toBe(false);
    expect(shouldReload({ ...ask, theirs: 'a' })).toBe(false);
    expect(shouldReload({ ...ask, mine: null })).toBe(false);
    expect(shouldReload({ ...ask, tried: 'b' })).toBe(false); // already reloaded for it: the browser kept the old one
    expect(shouldReload({ ...ask, tried: 'a' })).toBe(true); // reloaded for the build before: this is another one
    expect(shouldReload({ ...ask, busy: true })).toBe(false); // the editor is open
    expect(shouldReload({ ...ask, idleMs: RELOAD_IDLE_MS - 1 })).toBe(false); // somebody just touched the page
  });
});
