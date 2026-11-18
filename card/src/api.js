// Client of the house_view integration HTTP API (authenticated through hass.fetchWithAuth).
const BASE = '/api/house_view';

export class HouseViewApi {
  constructor(hass) {
    this.hass = hass;
  }

  async _json(path, init) {
    const res = await this.hass.fetchWithAuth(`${BASE}/${path}`, init);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    return res.json();
  }

  info() {
    return this._json('info');
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
