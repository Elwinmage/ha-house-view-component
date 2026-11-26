// Editor of the doors and windows: pick one on the 3D view (or in the list) and link its entities: open/closed
// contact, window opener or garage motor, roller shutter. A garage door also says which way it opens. Rooms with a
// single window, door or garage door are linked on their own. The same editor is reached from the editor of the
// rooms, where each room lists the openings it holds (renderRoomOpenings).
import { html, nothing } from 'lit';
import { GARAGE_KINDS, OPENING_LINKS, openingKey, openingLinks, openingState, isGlazed, isGarage, garageKind } from './openings.js';

const TYPE_ICON = {
  window: 'mdi:window-closed-variant',
  patio: 'mdi:door-sliding',
  door: 'mdi:door',
  garage: 'mdi:garage',
  opening: 'mdi:door-open',
};
const GARAGE_ICON = {
  sectional: 'mdi:garage-variant',
  tilt: 'mdi:garage-open-variant',
  roller: 'mdi:window-shutter',
  swing: 'mdi:door-closed',
  slide: 'mdi:door-sliding',
  folding: 'mdi:dots-vertical',
};

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
  // zoomed on a room, the editor works on that room alone, as the list of its entities does
  const ops = sd.openings.filter(
    (o) => o.type !== 'opening' && eng.world.openings.items.has(openingKey(o)) && (!card._focus || o.room === card._focus),
  );
  const rooms = new Map(sd.levels.flatMap((l) => l.rooms.map((r) => [r.id, r])));
  const manual = card._data.edits.openings;
  const auto = card._openingAuto();
  const sel = ops.find((o) => openingKey(o) === card._opSel) || null;
  eng.setOpeningTarget(sel ? card._opSel : card._opRoomSel || null);

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
  return html`<div class="hint">${t(card._focus ? 'openings_room_hint' : 'openings_hint')}</div>
    ${card._focus && !ops.length ? html`<div class="hint">${t('openings_room_none')}</div>` : nothing}
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

/**
 * The openings a room holds, listed and opened in the very editor of the panel of the doors and windows: the user
 * works on a room without leaving it. Nothing when the room has none.
 */
export function renderRoomOpenings(card, roomId) {
  const t = card._t;
  const eng = card._engine;
  if (!eng || !eng.world) return nothing;
  const sd = eng.world.sd;
  const ops = sd.openings.filter((o) => o.room === roomId && o.type !== 'opening' && eng.world.openings.items.has(openingKey(o)));
  if (!ops.length) return nothing;
  const auto = card._openingAuto();
  const manual = card._data.edits.openings;
  return html`${ops.map((o) => {
    const key = openingKey(o);
    const n = Object.keys(openingLinks(auto[key], manual[key])).length;
    const garage = isGarage(o, manual[key]);
    return html`<button
      class=${`row-btn ${card._opRoomSel === key ? 'on' : ''}`}
      @pointerenter=${() => eng.setOpeningTarget(key)}
      @pointerleave=${() => eng.setOpeningTarget(card._opRoomSel || null)}
      @click=${() => {
        card._opRoomSel = card._opRoomSel === key ? null : key;
        eng.setOpeningTarget(card._opRoomSel);
        card.requestUpdate();
      }}
    >
      <ha-icon .icon=${garage ? TYPE_ICON.garage : TYPE_ICON[o.type] || TYPE_ICON.window}></ha-icon>
      <span>${t(`opening_${garage ? 'garage' : o.type}`)} · ${o.width.toFixed(2)} m</span>
      ${n ? html`<span class="badge">${n}</span>` : nothing}
    </button>`;
  })}`;
}

/**
 * The editor of the opening picked from a room, in its own window. The card renders it once, so the same opening
 * never shows twice when the lists of several rooms are on screen at the same time.
 */
export function renderRoomOpeningWindow(card) {
  const eng = card._engine;
  if (!eng || !eng.world || !card._opRoomSel) return nothing;
  const sd = eng.world.sd;
  const sel = sd.openings.find((o) => openingKey(o) === card._opRoomSel);
  if (!sel) return nothing;
  const rooms = new Map(sd.levels.flatMap((l) => l.rooms.map((r) => [r.id, r])));
  return card._asWindow(
    openingName(card, sel, rooms),
    renderOpeningEditor(card, sel, card._openingAuto()[card._opRoomSel] || {}, rooms),
    () => {
      card._opRoomSel = null;
      eng.setOpeningTarget(null);
    },
  );
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
  const garage = isGarage(o, manual);
  const kinds = Object.keys(OPENING_LINKS).filter((k) => k === 'contact' || isGlazed(o) || (garage && k === 'opener'));
  const st = openingState(links, card._hass.states);
  const room = rooms.get(o.room);
  return html`<div class="hint">
      ${t('opening_room')} : ${room ? room.name || room.id : t('openings_outside')} · ${o.width.toFixed(2)} × ${o.height.toFixed(2)}
      m${o.name ? ` · ${o.name}` : ''}
    </div>
    <div class="row">
      <label class="grow"
        ><input
          type="checkbox"
          .checked=${garage}
          @change=${(e) => {
            const on = e.target.checked;
            if (on === (o.type === 'garage')) delete manual.garage;
            else manual.garage = on;
            save();
          }}
        />
        ${t('opening_is_garage')}</label
      >
    </div>
    ${
      garage
        ? html`<div class="sub">${t('opening_garage_kind')}</div>
            <div class="chips">
              ${GARAGE_KINDS.map(
                (k) =>
                  html`<button
                    class=${garageKind(manual) === k ? 'on' : ''}
                    @click=${() => {
                      if (k === GARAGE_KINDS[0]) delete manual.kind;
                      else manual.kind = k;
                      save();
                    }}
                  >
                    <ha-icon icon=${GARAGE_ICON[k]}></ha-icon>${t(`garage_${k}`)}
                  </button>`,
              )}
            </div>
            <div class="row">
              <button
                class=${card._opDemo.has(key) ? 'on' : ''}
                @click=${() => {
                  if (!card._opDemo.delete(key)) card._opDemo.add(key);
                  card._pushOpenings();
                  card.requestUpdate();
                }}
              >
                ${t('gate_try')}
              </button>
            </div>
            <div class="hint">${t('opening_garage_hint')}</div>`
        : nothing
    }
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
