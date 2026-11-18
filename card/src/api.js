// Client of the house_view integration HTTP API (authenticated through hass.fetchWithAuth).
const BASE = '/api/house_view';
const UNLOCK_HEADER = 'X-House-View-Unlock';

/** A write was refused because editing is protected by a password and this page has not given it (or not lately). */
export class LockedError extends Error {
  constructor(message) {
    super(message || 'Editing is locked');
    this.locked = true;
  }
}

export class HouseViewApi {
  // Unlock token got with the edit password: shared by every card of the page, forgotten on reload. The server
  // drops it after `ttl` seconds without any use; `seen` lets the cards show the lock again without asking it.
  static token = null;
  static seen = 0;
  static ttl = 600;
  static locked = false; // a password is set (as last told by the integration)

  constructor(hass) {
    this.hass = hass;
    this.onLocked = null; // async () => boolean: ask the password (the card shows its dialog); true once unlocked
    this.lockedMessage = '';
  }

  _fetch(path, init = {}) {
    const headers = HouseViewApi.token ? { ...init.headers, [UNLOCK_HEADER]: HouseViewApi.token } : init.headers;
    return this.hass.fetchWithAuth(`${BASE}/${path}`, { ...init, headers });
  }

  async _json(path, init, retry = true) {
    // A write known to be refused: ask the password first, rather than let the request fail
    const write = !!init && !!init.method && init.method !== 'GET';
    if (write && retry && HouseViewApi.locked && !this.hasToken && this.onLocked && !(await this.onLocked())) {
      throw new LockedError(this.lockedMessage);
    }
    const res = await this._fetch(path, init);
    if (res.status === 404) return null;
    if (res.status === 423) {
      // locked: the token expired (no write for a while), the password changed, or it was never given
      HouseViewApi.token = null;
      if (retry && this.onLocked && (await this.onLocked())) return this._json(path, init, false);
      throw new LockedError(this.lockedMessage);
    }
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    if (HouseViewApi.token) HouseViewApi.seen = Date.now();
    return res.json();
  }

  /** True while this page holds an unlock token that the server should still accept. */
  get hasToken() {
    return !!HouseViewApi.token && Date.now() - HouseViewApi.seen < HouseViewApi.ttl * 1000;
  }

  /** { locked: a password is set, unlocked: this page may write }; null with an integration that has no lock. */
  async lockState() {
    const st = await this._json('unlock');
    if (st) HouseViewApi.locked = !!st.locked;
    return st;
  }

  /** Give the edit password: { ok: true } or { ok: false, wait: seconds to wait after too many wrong tries }. */
  async unlock(password) {
    const res = await this._fetch('unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.status === 403) return { ok: false };
    if (res.status === 429) return { ok: false, wait: (await res.json().catch(() => ({}))).retry_after || 60 };
    if (!res.ok) throw new Error(`unlock: HTTP ${res.status}`);
    const body = await res.json();
    HouseViewApi.token = body.token || null;
    HouseViewApi.seen = Date.now();
    if (body.ttl) HouseViewApi.ttl = body.ttl;
    return { ok: true };
  }

  /** Lock again right now (the token is forgotten on both sides). */
  async lock() {
    const had = HouseViewApi.token;
    if (had) await this._fetch('unlock', { method: 'DELETE' }).catch(() => null);
    HouseViewApi.token = null;
  }

  async info() {
    const info = await this._json('info');
    if (info) HouseViewApi.locked = !!info.locked;
    return info;
  }

  /** Stored data: null when nothing was uploaded yet. */
  getScene() {
    return this._json('scene');
  }

  getTerrain() {
    return this._json('terrain');
  }

  getEdits() {
    return this._json('edits');
  }

  getOrtho() {
    return this._json('ortho');
  }

  /** Start fetching the terrain from the national geodata service (runs in the integration). */
  startFetch(params) {
    return this._send('fetch', 'POST', params);
  }

  /** Fetch job state: { state: idle|running|done|error, step, message }. */
  fetchStatus() {
    return this._json('fetch');
  }

  /** GitHub backup: action = 'backup' | 'restore'. */
  github(action) {
    return this._send('github', 'POST', { action });
  }

  _send(path, method, body) {
    return this._json(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  setScene(scene) {
    return this._send('scene', 'POST', scene);
  }

  setTerrain(terrain) {
    return this._send('terrain', 'POST', terrain);
  }

  clearTerrain() {
    return this._send('terrain', 'DELETE');
  }

  clearOrtho() {
    return this._send('ortho', 'DELETE');
  }

  setEdits(edits) {
    return this._send('edits', 'POST', edits);
  }
}
