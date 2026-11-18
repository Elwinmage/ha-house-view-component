import { beforeEach, describe, expect, it } from 'vitest';

import { HouseViewApi, LockedError } from '../src/api.js';

const HEADER = 'X-House-View-Unlock';

/** Fake of the integration: a password, live tokens, and the log of the calls received. */
function server(password = 's3same') {
  const calls = [];
  const tokens = new Set();
  let n = 0;
  let wrong = 0;
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
  const hass = {
    async fetchWithAuth(url, init = {}) {
      const path = url.replace('/api/house_view/', '');
      const method = init.method || 'GET';
      const token = (init.headers || {})[HEADER];
      calls.push({ path, method, token, body: init.body });
      if (path === 'missing') return reply(404, {});
      if (path === 'info') return reply(200, { has_scene: false, locked: !!password });
      if (path === 'unlock') {
        if (method === 'GET') return reply(200, { locked: !!password, unlocked: !password || tokens.has(token) });
        if (method === 'DELETE') return (tokens.delete(token), reply(200, { ok: true }));
        if (!password) return reply(200, { ok: true, locked: false, token: null });
        if (wrong >= 2) return reply(429, { retry_after: 42 });
        if (JSON.parse(init.body).password !== password) return (wrong++, reply(403, { message: 'Wrong password' }));
        const t = `tok${++n}`;
        tokens.add(t);
        return reply(200, { ok: true, locked: true, token: t, ttl: 600 });
      }
      if (method !== 'GET' && password && !tokens.has(token)) return reply(423, { message: 'Editing is locked' });
      if (path === 'broken') return reply(500, { message: 'boom' });
      return reply(200, { ok: true });
    },
  };
  return { hass, calls, tokens };
}

describe('edit lock on the client side', () => {
  beforeEach(() => {
    HouseViewApi.token = null;
    HouseViewApi.locked = false;
  });

  it('sends the token with every request once the password is given', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    expect(await api.lockState()).toEqual({ locked: true, unlocked: false });
    expect(api.hasToken).toBe(false);
    expect(await api.unlock('nope')).toEqual({ ok: false });
    expect(await api.unlock('s3same')).toEqual({ ok: true });
    expect(api.hasToken).toBe(true);
    expect(await api.setEdits({ a: 1 })).toEqual({ ok: true });
    expect(s.calls.at(-1)).toMatchObject({ path: 'edits', method: 'POST', token: 'tok1' });
    expect(await api.lockState()).toEqual({ locked: true, unlocked: true });
    // a second card of the same page is unlocked too
    expect(await new HouseViewApi(s.hass).clearOrtho()).toEqual({ ok: true });
  });

  it('asks the password when a write is refused, then sends the write again', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    let asked = 0;
    api.onLocked = async () => {
      asked++;
      return (await api.unlock('s3same')).ok;
    };
    expect(await api.setEdits({ a: 1 })).toEqual({ ok: true });
    expect(asked).toBe(1);
    expect(s.calls.filter((c) => c.path === 'edits').map((c) => c.token)).toEqual([undefined, 'tok1']);

    s.tokens.clear(); // the token expired on the server: asked again, once
    expect(await api.setScene({})).toEqual({ ok: true });
    expect(asked).toBe(2);
  });

  it('asks before sending a write when it knows that editing is locked', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    await api.info(); // tells that a password is set
    let asked = 0;
    api.onLocked = async () => {
      asked++;
      return (await api.unlock('s3same')).ok;
    };
    expect(await api.setEdits({ a: 1 })).toEqual({ ok: true });
    expect(asked).toBe(1);
    expect(s.calls.filter((c) => c.path === 'edits').map((c) => c.token)).toEqual(['tok1']); // no refused request
    expect(await api.setEdits({ a: 2 })).toEqual({ ok: true });
    expect(asked).toBe(1);

    HouseViewApi.seen = Date.now() - 601 * 1000; // 10 minutes without any write: the lock is back
    expect(api.hasToken).toBe(false);
    api.onLocked = async () => false;
    const n = s.calls.length;
    await expect(api.setEdits({ a: 3 })).rejects.toThrow(LockedError);
    expect(s.calls).toHaveLength(n); // cancelled: nothing sent
    expect(await api.getEdits()).toEqual({ ok: true }); // reading never asks
  });

  it('gives up with a LockedError when the password is not given', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    api.lockedMessage = 'Édition verrouillée';
    await expect(api.setEdits({})).rejects.toThrow(LockedError); // nobody to ask
    api.onLocked = async () => false; // dialog cancelled
    const err = await api.setEdits({}).catch((e) => e);
    expect(err.locked).toBe(true);
    expect(err.message).toBe('Édition verrouillée');
    api.onLocked = async () => true; // says unlocked but is not: no endless loop
    await expect(api.setEdits({})).rejects.toThrow(LockedError);
    expect(new LockedError().message).toBe('Editing is locked');
  });

  it('reports the wait after too many wrong passwords', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    await api.unlock('a');
    await api.unlock('b');
    expect(await api.unlock('s3same')).toEqual({ ok: false, wait: 42 });
  });

  it('locks again on demand', async () => {
    const s = server();
    const api = new HouseViewApi(s.hass);
    await api.lock(); // nothing to forget: no request
    expect(s.calls).toHaveLength(0);
    await api.unlock('s3same');
    await api.lock();
    expect(api.hasToken).toBe(false);
    expect(s.tokens.size).toBe(0);
    await expect(api.setEdits({})).rejects.toThrow(LockedError);
  });

  it('works with an unprotected or older integration', async () => {
    const open = server('');
    const api = new HouseViewApi(open.hass);
    expect(await api.lockState()).toEqual({ locked: false, unlocked: true });
    expect(await api.unlock('whatever')).toEqual({ ok: true });
    expect(api.hasToken).toBe(false);
    expect(await api.setEdits({})).toEqual({ ok: true });
    expect(await api._json('missing')).toBeNull(); // no /unlock route before this version
    await expect(api._json('broken', { method: 'POST' })).rejects.toThrow('broken: HTTP 500');
  });
});
