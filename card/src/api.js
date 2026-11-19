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
  // Unlock state of each home (its config entry id, '' for the first home): the token got with the edit password,
  // shared by every card of the page showing that home, forgotten on reload. The server drops it after `ttl`
  // seconds without any use; `seen` lets the cards show the lock again without asking it; `locked`: a password is
  // set (as last told by the integration).
  static _auth = new Map();

  static auth(home = '') {
    if (!this._auth.has(home)) this._auth.set(home, { token: null, seen: 0, ttl: 600, locked: false });
    return this._auth.get(home);
  }

  // the first home, as before homes existed
  static get token() {
    return this.auth().token;
  }
  static set token(v) {
    this.auth().token = v;
  }
  static get seen() {
    return this.auth().seen;
  }
  static set seen(v) {
    this.auth().seen = v;
  }
  static get ttl() {
    return this.auth().ttl;
  }
  static set ttl(v) {
    this.auth().ttl = v;
  }
  static get locked() {
    return this.auth().locked;
  }
  static set locked(v) {
    this.auth().locked = v;
  }

  /** `home`: config entry id of the home shown ('' or absent: the first home). */
  constructor(hass, home = '') {
    this.hass = hass;
    this.home = home || '';
    this.onLocked = null; // async () => boolean: ask the password (the card shows its dialog); true once unlocked
    this.lockedMessage = '';
  }

  get _a() {
    return HouseViewApi.auth(this.home);
  }

  _fetch(path, init = {}) {
    const a = this._a;
    const headers = a.token ? { ...init.headers, [UNLOCK_HEADER]: a.token } : init.headers;
    const query = this.home ? `?home=${encodeURIComponent(this.home)}` : '';
    return this.hass.fetchWithAuth(`${BASE}/${path}${query}`, { ...init, headers });
  }

  /** Create the demo home, or put it back as shipped: { home } (admin). */
  async startDemo() {
    const res = await this.hass.fetchWithAuth(`${BASE}/demo`, { method: 'POST' });
    if (!res.ok) throw new Error(`demo: HTTP ${res.status}`);
    return res.json();
  }

  /** The plan of the demo house (.sh3d bytes). */
  async demoHouse() {
    const res = await this.hass.fetchWithAuth(`${BASE}/demo`);
    if (!res.ok) throw new Error(`demo: HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  /** The homes set up: [{ id, title }] ([] with an integration that has no homes yet). */
  async homes() {
    const res = await this.hass.fetchWithAuth(`${BASE}/homes`);
    return res.ok ? res.json() : [];
  }

  async _json(path, init, retry = true) {
    // A write known to be refused: ask the password first, rather than let the request fail
    const write = !!init && !!init.method && init.method !== 'GET';
    if (write && retry && this._a.locked && !this.hasToken && this.onLocked && !(await this.onLocked())) {
      throw new LockedError(this.lockedMessage);
    }
    const res = await this._fetch(path, init);
    if (res.status === 404) return null;
    if (res.status === 423) {
      // locked: the token expired (no write for a while), the password changed, or it was never given
      this._a.token = null;
      if (retry && this.onLocked && (await this.onLocked())) return this._json(path, init, false);
      throw new LockedError(this.lockedMessage);
    }
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    if (this._a.token) this._a.seen = Date.now();
    return res.json();
  }

  /** True while this page holds an unlock token that the server should still accept. */
  get hasToken() {
    return !!this._a.token && Date.now() - this._a.seen < this._a.ttl * 1000;
  }

  /** { locked: a password is set, unlocked: this page may write }; null with an integration that has no lock. */
  async lockState() {
    const st = await this._json('unlock');
    if (st) this._a.locked = !!st.locked;
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
    this._a.token = body.token || null;
    this._a.seen = Date.now();
    if (body.ttl) this._a.ttl = body.ttl;
    return { ok: true };
  }

  /** Lock again right now (the token is forgotten on both sides). */
  async lock() {
    const had = this._a.token;
    if (had) await this._fetch('unlock', { method: 'DELETE' }).catch(() => null);
    this._a.token = null;
  }

  async info() {
    const info = await this._json('info');
    if (info) this._a.locked = !!info.locked;
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
