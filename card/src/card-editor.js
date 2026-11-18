// Visual editor of the card options (Lovelace "edit card" dialog): a ha-form driven by a schema of HA selectors.
// The plan, the terrain and everything drawn in the view are edited in the card itself (✎ and ⚙), not here.
import { LitElement, html, nothing } from 'lit';

import { makeT } from './i18n.js';
import { cleanConfig, editorSchema, formData } from './card-options.js';

/** The form elements of Home Assistant are loaded on demand by the frontend: get them through a built-in editor. */
export async function loadHaForm() {
  if (customElements.get('ha-form') && customElements.get('ha-entity-picker')) return;
  try {
    const helpers = await window.loadCardHelpers();
    for (const type of ['entities', 'button']) {
      const card = await helpers.createCardElement({ type, entities: [], entity: 'sun.sun' });
      if (card && card.constructor.getConfigElement) await card.constructor.getConfigElement();
    }
  } catch (e) {
    // outside of Home Assistant (test page): the form is simply not shown
  }
}

export class HouseViewCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  setConfig(config) {
    this._config = config;
  }

  get _t() {
    const lang = this.hass && this.hass.language;
    if (this._lang !== lang || !this._tr) {
      this._lang = lang;
      this._tr = makeT(lang);
      this._schema = editorSchema(this._tr); // kept: a new schema at every render would fold the sections again
    }
    return this._tr;
  }

  _text(key) {
    const v = this._t(key);
    return v === key ? undefined : v;
  }

  _changed(ev) {
    ev.stopPropagation();
    const config = cleanConfig({ ...this._config, ...ev.detail.value });
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.hass || !this._config) return nothing;
    const t = this._t;
    return html`<ha-form
        .hass=${this.hass}
        .data=${formData(this._config)}
        .schema=${this._schema}
        .computeLabel=${(s) => this._text(`ed_${s.name}`) || s.title || s.name}
        .computeHelper=${(s) => this._text(`ed_${s.name}_help`)}
        @value-changed=${this._changed}
      ></ha-form>
      <p style="opacity: 0.7; font-size: 12px; margin: 12px 0 0">${t('ed_where')}</p>`;
  }
}

if (!customElements.get('house-view-card-editor')) customElements.define('house-view-card-editor', HouseViewCardEditor);
