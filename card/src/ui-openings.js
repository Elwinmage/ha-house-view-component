// Editor of the doors and windows: pick one on the 3D view (or in the list) and link its entities: open/closed
// contact, window opener, roller shutter. Rooms with a single window or door are linked on their own.
import { html, nothing } from 'lit';
import { OPENING_LINKS, openingKey, openingLinks, openingState, isGlazed } from './openings.js';

const TYPE_ICON = { window: 'mdi:window-closed-variant', patio: 'mdi:door-sliding', door: 'mdi:door', opening: 'mdi:door-open' };

/** Name of an opening in the lists: its room, its kind and its width. */
function openingName(card, o, rooms) {
  const t = card._t;
  const room = rooms.get(o.room);
  return `${room ? room.name || room.id : t('openings_outside')} · ${t(`opening_${o.type}`)} ${o.width.toFixed(2)} m`;
}

export function renderOpenings(card) {
  const t = card._t;
  const eng = card._engine;
  const ed = card._editors;
  if (!eng || !eng.world || !ed) return nothing;
  const sd = eng.world.sd;
  const ops = sd.openings.filter((o) => o.type !== 'opening' && eng.world.openings.items.has(openingKey(o)));
  const rooms = new Map(sd.levels.flatMap((l) => l.rooms.map((r) => [r.id, r])));
  const manual = card._data.edits.openings;
  const auto = card._openingAuto();
  const sel = ops.find((o) => openingKey(o) === card._opSel) || null;
  eng.setOpeningTarget(sel ? card._opSel : null);

  const choose = (key) => {
    card._opSel = card._opSel === key ? null : key;
    card.requestUpdate();
  };
  const tool = ed.clickTool && ed.clickTool.key === 'opening-pick';
  const pickTool = () =>
    ed.setClickTool({
      key: 'opening-pick',
      cursor: 'pointer',
      pick: (ev) => eng.pickOpening(ev),
      hover: (key) => eng.setOpeningTarget(key || card._opSel),
      leave: () => eng.setOpeningTarget(card._opSel),
      click: (key) => {
        card._opSel = key;
        card.requestUpdate();
      },
    });

  const levels = sd.levels.filter((l) => ops.some((o) => o.level === l.id));
  return html`<div class="hint">${t('openings_hint')}</div>
    <button class=${tool ? 'on' : ''} @click=${() => (tool ? ed.setClickTool(null) : pickTool())}>${t('openings_pick')}</button>
    ${levels.map(
      (l) =>
        html`<div class="sub">${l.name || l.id}</div>
          ${ops
            .filter((o) => o.level === l.id)
            .map((o) => {
              const key = openingKey(o);
              const links = openingLinks(auto[key], manual[key]);
              const n = Object.keys(links).length;
              return html`<button class=${`row-btn ${card._opSel === key ? 'on' : ''}`} @click=${() => choose(key)}>
                <ha-icon .icon=${TYPE_ICON[o.type] || TYPE_ICON.window}></ha-icon>
                <span>${openingName(card, o, rooms)}</span>
                ${n ? html`<span class="badge">${n}</span>` : nothing}
              </button>`;
            })}`,
    )}
    ${
      sel
        ? card._asWindow(openingName(card, sel, rooms), renderOpeningEditor(card, sel, auto[openingKey(sel)] || {}, rooms), () => {
            card._opSel = null;
          })
        : nothing
    }`;
}

/** Links of one opening: each entity is automatic until changed by hand; "none" removes an automatic one. */
function renderOpeningEditor(card, o, auto, rooms) {
  const t = card._t;
  const key = openingKey(o);
  const all = card._data.edits.openings;
  const manual = all[key] || {};
  const links = openingLinks(auto, manual);
  const area = (card._areas && card._areas[o.room]) || '';
  const save = () => {
    if (Object.keys(manual).length) all[key] = manual;
    else delete all[key];
    card._edited(true);
    card._pushOpenings();
    card.requestUpdate();
  };
  const set = (k, v) => {
    if (v === (auto[k] || '')) delete manual[k];
    else manual[k] = v; // '' removes an automatic link
    save();
  };
  const kinds = Object.keys(OPENING_LINKS).filter((k) => k === 'contact' || isGlazed(o));
  const st = openingState(links, card._hass.states);
  const room = rooms.get(o.room);
  return html`<div class="hint">
      ${t('opening_room')} : ${room ? room.name || room.id : t('openings_outside')} · ${o.width.toFixed(2)} × ${o.height.toFixed(2)}
      m${o.name ? ` · ${o.name}` : ''}
    </div>
    ${kinds.map(
      (k) =>
        html`<div class="sub">${t(`opening_link_${k}`)}</div>
          <div class="row">
            ${card._entityInput(links[k] || '', (v) => set(k, v), OPENING_LINKS[k], area)}
            ${
              manual[k] !== undefined && auto[k]
                ? html`<button title=${t('opening_auto_back')} @click=${() => set(k, auto[k])}>↺</button>`
                : nothing
            }
          </div>
          ${auto[k] && manual[k] === undefined ? html`<div class="hint">${t('opening_auto')}</div>` : nothing}
          ${manual[k] === '' && auto[k] ? html`<div class="hint">${t('opening_auto_off')} (${auto[k]})</div>` : nothing}`,
    )}
    ${
      Object.keys(links).length
        ? html`<div class="hint">
            ${t('opening_now')} : ${Math.round(st.open * 100)}
            %${st.shutter !== null ? html` · ${t('opening_link_shutter')} ${Math.round((1 - st.shutter) * 100)} %` : nothing}
          </div>`
        : nothing
    }`;
}
