// What Home Assistant creates for `custom:house-view-card`: a thin element around the card itself (house-view-card.js,
// registered as SCENE_TAG). Home Assistant throws its cards away when another dashboard is opened; the shell goes,
// the card inside it (its 3D scene, its camera, its open panels) waits in the reserve (scene-reserve.js) and the
// shell of the next card with the same configuration puts it back on the page as it was left.

import { SceneReserve, keepMs, needsNewScene, sceneKey } from './scene-reserve.js';

export const SCENE_TAG = 'house-view-scene';

const reserve = new SceneReserve();

/** Is the element a tile of the card picker ("Add to dashboard")? Its scene is a picture: nothing to keep or take. */
function inPicker(el) {
  for (let n = el; n; n = n.parentNode || n.host || null) if (n.localName === 'hui-card-picker') return true;
  return false;
}

/** Register the card shown by Home Assistant under `tag`; `Scene` is the class of the card itself. */
export function defineCard(tag, Scene) {
  class HouseViewShell extends HTMLElement {
    static getStubConfig() {
      return Scene.getStubConfig();
    }

    static getConfigElement() {
      return Scene.getConfigElement();
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
      const before = this._config;
      this._config = config;
      if (!this._scene) return;
      if (needsNewScene(before, config)) this.renew();
      else this._scene.setConfig(config);
    }

    set hass(h) {
      this._hass = h;
      if (this._scene) this._scene.hass = h;
    }

    get hass() {
      return this._hass;
    }

    /** The card itself (its scene): what the tests and the browser console work with. */
    get scene() {
      return this._scene || null;
    }

    getCardSize() {
      return 8;
    }

    getGridOptions() {
      return { columns: 'full', min_rows: 4 };
    }

    connectedCallback() {
      this.style.display = 'block';
      const mine = this._scene;
      if (mine && mine.parentNode === this && !mine.released) reserve.unpark(mine);
      else this._mount();
    }

    disconnectedCallback() {
      const scene = this._scene;
      // only a built scene is worth keeping (the tile of the card picker is a picture)
      if (!scene || !scene.keepable || scene.parentNode !== this) return;
      reserve.park(scene, sceneKey(this._config), keepMs(this._config), (s) => this._drop(s));
    }

    /** Show a scene: the one waiting for this configuration when there is one, a new one otherwise. */
    _mount() {
      if (!this._config) return;
      const kept = inPicker(this) ? null : reserve.take(sceneKey(this._config));
      const scene = kept || document.createElement(SCENE_TAG);
      // a scene taken back keeps the state it was left in (the demo it was showing, for one): its configuration is
      // the same, there is nothing to give it again
      if (!kept) scene.setConfig(this._config);
      this._scene = scene;
      this.appendChild(scene);
      if (this._hass) scene.hass = this._hass;
    }

    /** Nobody came back for the scene: its memory is given back, and this shell starts afresh if it is shown again. */
    _drop(scene) {
      scene.release();
      if (scene.parentNode) scene.parentNode.removeChild(scene);
      if (this._scene === scene) this._scene = null;
    }

    /**
     * A scene of its own, built anew: the quality changed (it is settled when the graphics context is created), or
     * the graphics context was lost and did not come back.
     */
    renew() {
      const old = this._scene;
      this._scene = null;
      if (old) {
        reserve.unpark(old);
        if (old.parentNode === this) this.removeChild(old);
        old.release();
      }
      if (this.isConnected) this._mount();
    }
  }
  if (!customElements.get(SCENE_TAG)) customElements.define(SCENE_TAG, Scene);
  if (!customElements.get(tag)) customElements.define(tag, HouseViewShell);
  return HouseViewShell;
}
