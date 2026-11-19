// Pickers of the editor: an icon picker that shows the icons while one types (as Home Assistant does), and an entity
// picker that lists the entities of the current room grouped by device (like the aquarium editor of ha-reef-card),
// the rest of the house one tap away. Both send `value-changed` with { value }, like the pickers of Home Assistant.
import { LitElement, html, css, nothing } from 'lit';
import { searchIcons, entityTree } from './picker-lib.js';
import { makeT } from './i18n.js';

// ---------------------------------------------------------------- icons

const fire = (el, value) => el.dispatchEvent(new CustomEvent('value-changed', { detail: { value }, bubbles: true, composed: true }));

class IconPicker extends LitElement {
  static properties = { hass: { attribute: false }, value: {}, _q: { state: true }, _open: { state: true } };

  constructor() {
    super();
    this.value = '';
    this._q = null; // text being typed (null: the value is shown)
    this._open = false;
  }

  _pick(icon) {
    this._q = null;
    this._open = false;
    fire(this, icon);
  }

  render() {
    const t = makeT(this.hass && this.hass.language);
    const text = this._q ?? this.value ?? '';
    const found = this._open ? searchIcons(text) : [];
    return html`<div class="row">
        <span class="cur">${this.value ? html`<ha-icon .icon=${this.value}></ha-icon>` : nothing}</span>
        <input
          type="text"
          placeholder="mdi:thermometer"
          .value=${text}
          @focus=${() => (this._open = true)}
          @input=${(e) => {
            this._q = e.target.value;
            this._open = true;
          }}
          @keydown=${(e) => {
            if (e.key === 'Enter') this._pick(found.length && !/^\w+:/.test(text) ? `mdi:${found[0]}` : text.trim());
            if (e.key === 'Escape') {
              this._q = null;
              this._open = false;
            }
          }}
        />
        ${this.value ? html`<button class="clear" title=${t('picker_clear')} @click=${() => this._pick('')}>✕</button>` : nothing}
      </div>
      ${
        this._open && found.length
          ? html`<div class="grid">
              ${found.map(
                (n) =>
                  html`<button title=${`mdi:${n}`} @click=${() => this._pick(`mdi:${n}`)}>
                    <ha-icon .icon=${`mdi:${n}`}></ha-icon><span>${n}</span>
                  </button>`,
              )}
            </div>`
          : nothing
      }`;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cur {
      width: 22px;
      display: flex;
      justify-content: center;
    }
    .cur ha-icon {
      --mdc-icon-size: 20px;
    }
    input {
      flex: 1;
      min-width: 0;
      font: inherit;
      color: inherit;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 4px 6px;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: none;
      cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: 2px;
      max-height: 210px;
      overflow-y: auto;
      margin-top: 4px;
      padding: 4px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.25);
    }
    .grid button {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 4px 2px;
      border-radius: 6px;
    }
    .grid button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .grid span {
      font-size: 9px;
      opacity: 0.75;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
}

// ---------------------------------------------------------------- entities

/** Most entities listed at once (a search narrows the list). */
const MAX_LISTED = 400;

class EntityPicker extends LitElement {
  static properties = {
    hass: { attribute: false },
    value: {},
    area: {}, // area of the current room: its entities are listed first
    domains: { attribute: false },
    label: {},
    _open: { state: true },
    _q: { state: true },
    _all: { state: true },
    _openAreas: { state: true },
  };

  constructor() {
    super();
    this.value = '';
    this.area = '';
    this._open = false;
    this._q = '';
    this._all = false;
    this._openAreas = new Set(); // rooms unfolded in the whole house (their entities are only drawn then)
  }

  _pick(id) {
    this._open = false;
    this._q = '';
    fire(this, id);
  }

  _toggle() {
    this._open = !this._open;
    if (this._open) {
      this._all = !this.area;
      this.updateComplete.then(() => {
        const inp = this.renderRoot.querySelector('input');
        if (inp) inp.focus();
      });
    }
  }

  /** A room is unfolded when searching, when it is the only one, when it is the current room or opened by hand. */
  _unfolded(g, tree) {
    return !!this._q || tree.length === 1 || (!!this.area && g.area.id === this.area) || this._openAreas.has(g.area.id ?? '');
  }

  render() {
    const hass = this.hass;
    if (!hass) return nothing;
    const t = makeT(hass.language);
    const st = this.value && hass.states[this.value];
    const head = html`<button class="cur" @click=${() => this._toggle()}>
      ${
        this.value
          ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>
              <span class="txt"><span>${(st && st.attributes.friendly_name) || this.value}</span><small>${this.value}</small></span>`
          : html`<span class="txt placeholder">${this.label || t('picker_choose')}</span>`
      }
      <span class="arrow">${this._open ? '▴' : '▾'}</span>
    </button>`;
    if (!this._open) return head;
    const all = this._all || !this.area;
    // a search looks through the whole house
    const tree = entityTree(hass, { area: this.area || null, all: all || !!this._q, domains: this.domains, query: this._q });
    let count = 0;
    const areaName = this.area && hass.areas && hass.areas[this.area] ? hass.areas[this.area].name : '';
    const devices = (g) =>
      g.devices.map(
        (d) =>
          html`<div class="dev">
            <div class="dname">${d.id ? d.name : t('picker_no_device')}</div>
            ${d.entities.map((e) => {
              if (++count > MAX_LISTED) return nothing;
              const s = hass.states[e.id];
              return html`<button class=${`ent ${e.id === this.value ? 'sel' : ''}`} title=${e.id} @click=${() => this._pick(e.id)}>
                <ha-state-icon .hass=${hass} .stateObj=${s}></ha-state-icon>
                <span class="txt"><span>${e.name}</span><small>${e.id}</small></span>
              </button>`;
            })}
          </div>`,
      );
    const body = !tree.length
      ? html`<div class="none">${t('picker_none')}</div>`
      : all || this._q
        ? tree.map(
            (g) =>
              html`<details
                ?open=${this._unfolded(g, tree)}
                @toggle=${(e) => {
                  const k = g.area.id ?? '';
                  if (e.target.open === this._openAreas.has(k)) return;
                  const next = new Set(this._openAreas);
                  if (e.target.open) next.add(k);
                  else next.delete(k);
                  this._openAreas = next;
                }}
              >
                <summary>
                  ${g.area.id ? g.area.name : t('picker_no_area')} <small>(${g.devices.reduce((n, d) => n + d.entities.length, 0)})</small>
                </summary>
                ${this._unfolded(g, tree) ? devices(g) : nothing}
              </details>`,
          )
        : devices(tree[0]);
    return html`${head}
      <div class="pop">
        <input type="search" placeholder=${t('picker_search')} .value=${this._q} @input=${(e) => (this._q = e.target.value)} />
        ${
          this.area
            ? html`<label class="chk"
                  ><input type="checkbox" .checked=${all} @change=${(e) => (this._all = e.target.checked)} />
                  ${t('picker_whole_house')}</label
                >
                ${all ? nothing : html`<div class="room">${t('picker_room')} : <b>${areaName}</b></div>`}`
            : nothing
        }
        <div class="list">${body}</div>
        ${count > MAX_LISTED ? html`<div class="none">${t('picker_more')}</div>` : nothing}
        ${this.value ? html`<button class="clear" @click=${() => this._pick('')}>${t('picker_clear')}</button>` : nothing}
      </div>`;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
    }
    .cur {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 3px 6px;
    }
    .txt {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .txt > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .placeholder {
      opacity: 0.6;
    }
    small {
      opacity: 0.6;
      font-size: 10px;
    }
    ha-state-icon {
      --mdc-icon-size: 18px;
      display: flex;
    }
    .pop {
      margin-top: 4px;
      padding: 6px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    input[type='search'] {
      font: inherit;
      color: inherit;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 4px 6px;
    }
    .chk {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .room {
      font-size: 12px;
      opacity: 0.85;
    }
    .list {
      max-height: 280px;
      overflow-y: auto;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      padding: 3px 0;
    }
    .dev {
      margin: 2px 0 6px 6px;
    }
    .dname {
      font-size: 11px;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px 0;
    }
    .ent {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 4px;
      border-radius: 6px;
    }
    .ent:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .ent.sel {
      background: rgba(3, 169, 244, 0.3);
    }
    .none {
      font-size: 12px;
      opacity: 0.7;
    }
    .clear {
      align-self: flex-start;
      font-size: 12px;
      opacity: 0.8;
      text-decoration: underline;
    }
  `;
}

if (!customElements.get('house-view-icon-picker')) customElements.define('house-view-icon-picker', IconPicker);
if (!customElements.get('house-view-entity-picker')) customElements.define('house-view-entity-picker', EntityPicker);
