// General entities on the left, central alarm badge, and the zones a tap opens (media players, aquariums): their
// rendering on the view and their editor sections. Plain functions of the card instance, like ui-sections.js.
import { html, nothing } from 'lit';
import { alarmList, tapAction, roomAlarms } from './alarms.js';
import { areaOfEntity } from './ha-bridge.js';
import { rectAt, aquariumSize, onFloor, boxOf, rectCorners, quadMatrix } from './zones.js';

/** Element of ha-reef-card that draws an aquarium of reeftank (its aquarium view). */
export const AQUARIUM_CARD = 'reef-aquarium-card';
/** Width in pixels of the picture of an aquarium laid on its zone (its height follows the zone). */
const THUMB_W = 360;

/** Home Assistant area of the room a zone stands in (undefined: the picker starts from the current room). */
function zoneArea(card, z) {
  const eng = card._engine;
  const at = z.shape === 'box' && z.box ? z.box.at : z.rect ? [z.rect.c[0], z.rect.c[2]] : null;
  const room = at && z.level && eng && eng.world ? eng.roomAt(z.level, at[0], at[1]) : null;
  return (room && card._areas && card._areas[room]) || undefined;
}

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------- general entities (left, under the levels)

/** Tap on a general entity: toggle it or open its dialog. */
function tapGeneral(card, g) {
  const action = tapAction(g.entity, g.tap);
  if (action === 'toggle') card._hass.callService('homeassistant', 'toggle', { entity_id: g.entity });
  else if (action === 'more-info') card._moreInfo(g.entity);
}

export function renderGeneral(card) {
  const list = (card._data && card._data.edits.panel) || [];
  if (!list.length) return nothing;
  const hass = card._hass;
  return html`<div class="general">
    ${list
      .filter((g) => g.entity)
      .map((g) => {
        const st = hass.states[g.entity];
        const on = st && ['on', 'open', 'unlocked', 'playing', 'home', 'heat', 'cool'].includes(st.state);
        const armed = st && g.entity.startsWith('alarm_control_panel.') && st.state.startsWith('armed');
        const label = g.label || (st && st.attributes.friendly_name) || g.entity;
        return html`<button
          class=${`gen ${on || armed ? 'on' : ''} ${st && st.state === 'triggered' ? 'alarm' : ''}`}
          title=${`${label} : ${card._stateText(st)}`}
          @click=${() => tapGeneral(card, g)}
        >
          <ha-state-icon .hass=${hass} .stateObj=${st} .icon=${g.icon || undefined}></ha-state-icon>
          <span class="v">${g.label ? html`<small>${g.label}</small> ` : nothing}${card._stateText(st)}</span>
        </button>`;
      })}
  </div>`;
}

export function renderGeneralEditor(card) {
  const t = card._t;
  const edits = card._data.edits;
  const list = edits.panel;
  const save = () => card._edited(true);
  const set = (g, patch) => {
    Object.assign(g, patch);
    save();
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save();
  };
  return html`<div class="hint">${t('general_hint')}</div>
    ${list.map(
      (g, i) =>
        html`<div class="zone">
          <div class="grid">
            <span>${t('vac_pos_entity')}</span>${card._entityInput(g.entity, (id) => set(g, { entity: id }), null, '')}
            <span>${t('entity_label')}</span
            ><input type="text" .value=${g.label || ''} @change=${(e) => set(g, { label: e.target.value.trim() })} />
            <span>${t('entity_icon')}</span>${card._iconInput(g.icon, (icon) => set(g, { icon }))}
            <span>${t('general_tap')}</span>
            <select @change=${(e) => set(g, { tap: e.target.value })}>
              ${['auto', 'toggle', 'more-info', 'none'].map(
                (v) => html`<option value=${v} ?selected=${(g.tap || 'auto') === v}>${t(`general_tap_${v.replace('-', '_')}`)}</option>`,
              )}
            </select>
          </div>
          <div class="row">
            <button ?disabled=${i === 0} @click=${() => move(i, -1)}>↑</button>
            <button ?disabled=${i === list.length - 1} @click=${() => move(i, 1)}>↓</button>
            <button
              @click=${() => {
                list.splice(i, 1);
                save();
              }}
            >
              ${t('delete')}
            </button>
          </div>
        </div>`,
    )}
    <div class="row">
      <button
        @click=${() => {
          list.push({ id: newId('g'), entity: '', tap: 'auto' });
          save();
        }}
      >
        ${t('general_add')}
      </button>
    </div>`;
}

// ---------------------------------------------------------------- central alarm badge

export function alarmsOf(card) {
  return alarmList(card._hass.states, card._data ? card._data.edits.alarms : null);
}

/** Badge of the toolbar: a green tick when all is well, a red bell and the count of raised alarms otherwise. */
export function renderAlarmBadge(card) {
  if (card._config.show_alarms === false || !card._data) return nothing;
  const t = card._t;
  const { raised } = alarmsOf(card);
  const n = raised.length;
  return html`<button
    class=${`tb alarm ${n ? 'raised' : 'ok'} ${card._alarmOpen ? 'on' : ''}`}
    title=${n ? `${t('alarms_raised')} (${n})` : t('alarms_none')}
    @click=${() => {
      card._alarmOpen = !(card._alarmOpen && !card._alarmRoom);
      card._alarmRoom = null;
      card.requestUpdate();
    }}
  >
    <ha-icon icon=${n ? 'mdi:bell-ring' : 'mdi:check-bold'}></ha-icon>
    ${n ? html`<span class="count">(${n})</span>` : nothing}
  </button>`;
}

/** List of the raised alarms (and of those left out), opened by the badge. */
export function renderAlarmList(card) {
  if (!card._alarmOpen || !card._data) return nothing;
  const t = card._t;
  const hass = card._hass;
  const cfg = card._data.edits.alarms;
  let { raised, ignored } = alarmsOf(card);
  const admin = card._isAdmin;
  // opened from the badge of a room: the alarms of its area only
  const room = card._alarmRoom && card._engine && card._engine.rooms.find((r) => r.id === card._alarmRoom);
  const area = room && card._areas && card._areas[room.id];
  if (area) {
    const here = (st) => areaOfEntity(hass, st.entity_id) === area;
    raised = raised.filter(here);
    ignored = ignored.filter(here);
  }
  const toggleIgnore = (id, on) => {
    cfg.ignored = on ? [...new Set([...cfg.ignored, id])] : cfg.ignored.filter((x) => x !== id);
    card._edited(true);
  };
  const since = (st) => {
    const d = new Date(st.last_changed);
    return Number.isNaN(+d) ? '' : d.toLocaleString(hass.language || undefined, { dateStyle: 'short', timeStyle: 'short' });
  };
  const row = (st, left) =>
    html`<div class=${`al ${left ? 'left' : ''}`}>
      <button class="name" @click=${() => card._moreInfo(st.entity_id)}>
        <ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>
        <span>${st.attributes.friendly_name || st.entity_id}<br /><small>${since(st)} · ${card._stateText(st)}</small></span>
      </button>
      ${
        admin
          ? html`<button
              class="ign"
              title=${t(left ? 'alarms_count_again' : 'alarms_ignore')}
              @click=${() => toggleIgnore(st.entity_id, !left)}
            >
              <ha-icon icon=${left ? 'mdi:bell-plus' : 'mdi:bell-off'}></ha-icon>
            </button>`
          : nothing
      }
    </div>`;
  return html`<div class="alarm-list" @pointerdown=${(e) => e.stopPropagation()}>
    <div class="head">
      <b>${room ? `${room.name || room.id} · ` : ''}${raised.length ? `${t('alarms_raised')} (${raised.length})` : t('alarms_none')}</b>
      ${
        room
          ? html`<button
              class="all"
              @click=${() => {
                card._alarmRoom = null;
                card.requestUpdate();
              }}
            >
              ${t('alarms_all')}
            </button>`
          : nothing
      }
      <button
        class="x"
        @click=${() => {
          card._alarmOpen = false;
          card._alarmRoom = null;
          card.requestUpdate();
        }}
      >
        ✕
      </button>
    </div>
    ${raised.map((st) => row(st, false))}
    ${
      ignored.length
        ? html`<details>
            <summary>${t('alarms_ignored')} (${ignored.length})</summary>
            ${ignored.map((st) => row(st, true))}
          </details>`
        : nothing
    }
  </div>`;
}

export function renderAlarmsEditor(card) {
  const t = card._t;
  const cfg = card._data.edits.alarms;
  const save = () => card._edited(true);
  return html`<label class="chk"
      ><input
        type="checkbox"
        .checked=${cfg.auto !== false}
        @change=${(e) => {
          cfg.auto = e.target.checked;
          save();
        }}
      />
      ${t('alarms_auto')}</label
    >
    <div class="hint">${t('alarms_auto_hint')}</div>
    <label class="chk"
      ><input
        type="checkbox"
        .checked=${cfg.rooms !== false}
        @change=${(e) => {
          cfg.rooms = e.target.checked;
          save();
        }}
      />
      ${t('alarms_rooms')}</label
    >
    <div class="hint">${t('alarms_rooms_hint')}</div>
    <b class="sub">${t('alarms_extra')}</b>
    ${cfg.extra.map(
      (id, i) =>
        html`<div class="row">
          ${card._entityInput(
            id,
            (v) => {
              cfg.extra[i] = v;
              save();
            },
            null,
            '',
          )}
          <button
            @click=${() => {
              cfg.extra.splice(i, 1);
              save();
            }}
          >
            ✕
          </button>
        </div>`,
    )}
    <div class="row">
      ${card._entityInput(
        '',
        (v) => {
          if (v && !cfg.extra.includes(v)) cfg.extra.push(v);
          save();
        },
        null,
        '',
      )}
    </div>
    <b class="sub">${t('alarms_ignored')}</b>
    ${
      cfg.ignored.length
        ? cfg.ignored.map(
            (id) =>
              html`<div class="row">
                <span>${(card._hass.states[id] && card._hass.states[id].attributes.friendly_name) || id}</span>
                <button
                  @click=${() => {
                    cfg.ignored = cfg.ignored.filter((x) => x !== id);
                    save();
                  }}
                >
                  ✕
                </button>
              </div>`,
          )
        : html`<div class="hint">${t('alarms_ignored_none')}</div>`
    }`;
}

// ---------------------------------------------------------------- zones: media players and aquariums

/**
 * Aquariums of reeftank: [{ id, name, dims, views }] (dims: its dimensions in cm, or null; views: [{ id, name }], its
 * default view first), [] without reeftank.
 */
export async function loadAquariums(card) {
  const h = card._hass;
  if (!h || !h.callWS) return [];
  try {
    const list = await h.callWS({ type: 'reeftank/aquarium/list' });
    return await Promise.all(
      (list || []).map(async (a) => {
        let dims = null;
        let views = [];
        try {
          const doc = await h.callWS({ type: 'reeftank/aquarium/get', aquarium_id: a.id });
          const d = (doc && doc.document) || {};
          dims = d.dimensions_cm || null;
          views = Object.entries(d.views || {}).map(([id, v]) => ({ id, name: (v && v.name) || id }));
          const first = views.findIndex((v) => v.id === d.default_view);
          if (first > 0) views.unshift(...views.splice(first, 1));
        } catch (err) {
          // an aquarium that cannot be read keeps its name: its zone is sized by hand, its default view is shown
        }
        return { id: a.id, name: a.name, dims, views };
      }),
    );
  } catch (err) {
    return []; // no reeftank
  }
}

/** The engine draws (while editing) and taps the zones. */
export function pushZones(card) {
  const eng = card._engine;
  if (!eng || !eng.world || !card._data) return;
  const show = card._panel === 'edit' && card._section === 'zones';
  eng.setZones(card._data.edits.zones, { show, sel: card._zoneSel });
  eng.zoneDrag = show ? zoneDrag(card) : null;
  if (!show) eng.setTarget(null);
}

/** Moving a zone with the pointer, on its own surface (its wall, its floor), while the zones are edited. */
function zoneDrag(card) {
  const find = (id) => card._data.edits.zones.find((x) => x.id === id);
  return {
    start(id) {
      const z = find(id);
      if (!z) return null;
      card._zoneSel = id;
      card.requestUpdate();
      if (z.shape === 'rect' && z.rect) return { point: z.rect.c, normal: z.rect.n };
      if (z.shape === 'box' && z.box) return { point: [z.box.at[0], z.box.y0, z.box.at[1]], normal: [0, 1, 0] };
      return null;
    },
    move(id, p) {
      const z = find(id);
      if (!z) return;
      if (z.shape === 'rect') z.rect = { ...z.rect, c: p };
      else z.box = { ...z.box, at: [p[0], p[2]] };
      card._engine.setZones(card._data.edits.zones, { show: true, sel: id });
    },
    end() {
      card._edited(true);
      card.requestUpdate();
    },
  };
}

/** A tap on a zone: the dialog of the media player, or the view of the aquarium. */
export function openZone(card, id) {
  const z = card._data && card._data.edits.zones.find((x) => x.id === id);
  if (!z || card._panel === 'edit') return;
  if (z.kind === 'media') {
    if (z.entity) card._moreInfo(z.entity);
    return;
  }
  card._aquariumOpen = z;
  card.requestUpdate();
}

/** Dialog with the view of an aquarium (ha-reef-card), opened by a tap on its zone. */
export function renderAquariumDialog(card) {
  const z = card._aquariumOpen;
  if (!z) return nothing;
  const t = card._t;
  const close = () => {
    card._aquariumOpen = null;
    card.requestUpdate();
  };
  const ok = !!customElements.get(AQUARIUM_CARD);
  return html`<div class="dialog" @pointerdown=${(e) => e.stopPropagation()} @click=${(e) => e.target === e.currentTarget && close()}>
    <div class="box">
      <div class="head"><b>${z.name || t('zone_aquarium')}</b><button class="x" @click=${close}>✕</button></div>
      ${ok ? aquariumElement(card, z.aquarium, 'dialog', z.view) : html`<div class="hint">${t('zone_no_reef_card')}</div>`}
    </div>
  </div>`;
}

/**
 * An aquarium card, kept between renders (it subscribes to its aquarium). One element per place (`place`: the dialog,
 * or the zone it is laid on): an element lives in one place of the page only, the dialog would take it from its zone.
 */
function aquariumElement(card, aquarium, place, view) {
  card._aqEls = card._aqEls || new Map();
  // a new view gives a new element: the aquarium card reads its view when it is configured
  const key = `${place}|${aquarium}|${view || ''}`;
  let el = card._aqEls.get(key);
  if (!el) {
    el = document.createElement(AQUARIUM_CARD);
    el.setConfig(view ? { aquarium, view } : { aquarium });
    card._aqEls.set(key, el);
  }
  el.hass = card._hass;
  return el;
}

/** Pictures of the aquariums laid on their zones (fish moving), placed on every frame by placeZones. */
export function renderZoneThumbs(card) {
  if (!card._data || card._status !== 'ready' || !customElements.get(AQUARIUM_CARD)) return nothing;
  const zones = card._data.edits.zones.filter(
    (z) => z.kind === 'aquarium' && z.aquarium && z.thumb !== false && z.shape === 'rect' && z.rect,
  );
  if (!zones.length) return nothing;
  return html`<div class="anchors">
    ${zones.map(
      (z) =>
        html`<div class="zthumb" data-zone=${z.id} style=${`width:${THUMB_W}px;height:${Math.round((THUMB_W * z.rect.h) / z.rect.w)}px`}>
          ${aquariumElement(card, z.aquarium, `zone:${z.id}`, z.view)}
        </div>`,
    )}
  </div>`;
}

// ---------------------------------------------------------------- alarms of the rooms

/** Badges of the rooms with raised alarms: a red bell and their count, a tap opens the list of the room. */
export function renderRoomAlarms(card) {
  const eng = card._engine;
  card._roomAlarms = [];
  if (card._config.show_alarms === false || !card._data || card._status !== 'ready' || !eng || !eng.world) return nothing;
  if (card._data.edits.alarms.rooms === false || !card._areas) return nothing;
  const rooms = eng.world.sd.levels.flatMap((l) => l.rooms.map((r) => ({ id: r.id, level: l.id, y: l.elevation, poly: r.poly })));
  const list = roomAlarms(alarmsOf(card).raised, rooms, card._areas, (id) => areaOfEntity(card._hass, id));
  card._roomAlarms = list;
  if (!list.length) return nothing;
  const t = card._t;
  return html`<div class="anchors">
    ${list.map(
      (r) =>
        html`<button
          class="ralarm"
          data-room=${r.room}
          title=${`${t('alarms_raised')} : ${r.alarms.map((st) => st.attributes.friendly_name || st.entity_id).join(', ')}`}
          @click=${() => {
            card._alarmRoom = r.room;
            card._alarmOpen = true;
            card.requestUpdate();
          }}
        >
          <ha-icon icon="mdi:bell-ring"></ha-icon><span>${r.alarms.length}</span>
        </button>`,
    )}
  </div>`;
}

function placeRoomAlarms(card, root, eng) {
  for (const el of root.querySelectorAll('.ralarm')) {
    const r = (card._roomAlarms || []).find((x) => x.room === el.dataset.room);
    let p = null;
    if (r && eng.visibility.levels[r.level] !== false)
      // under the roof the badge hides with its room, as the labels of the vacuum do
      p = eng.visibility.roof ? eng.anchorScreen(`ralarm:${r.room}`, r.pos, null, r.level) : eng.project(...r.pos);
    el.style.display = p ? '' : 'none';
    if (p) el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px) translate(-50%, -50%)`;
  }
}

/** On every frame: each picture follows its rectangle, hidden with its level or behind a wall. */
export function placeZones(card) {
  const root = card.renderRoot;
  const eng = card._engine;
  if (!root || !eng || !eng.world || !card._data) return;
  placeRoomAlarms(card, root, eng);
  for (const el of root.querySelectorAll('.zthumb')) {
    const z = card._data.edits.zones.find((x) => x.id === el.dataset.zone);
    let m = null;
    if (z && z.rect && (!z.level || eng.visibility.levels[z.level] !== false)) {
      const facing = onFloor(z.rect) ? null : [z.rect.n[0], z.rect.n[2]];
      // hidden when its centre is behind a wall, like the labels
      if (eng.anchorScreen(`zone:${z.id}`, z.rect.c, facing, z.level)) {
        const q = rectCorners(z.rect).map((p) => eng.projectAny(...p));
        if (q.every(Boolean)) m = quadMatrix(el.offsetWidth || THUMB_W, el.offsetHeight || THUMB_W / 2, q);
      }
    }
    el.style.display = m ? '' : 'none';
    if (m) el.style.transform = m;
  }
}

export function renderZonesEditor(card) {
  const t = card._t;
  const ed = card._editors;
  const edits = card._data.edits;
  const list = edits.zones;
  const aquariums = card._aquariums || [];
  const save = () => {
    card._edited(true);
    pushZones(card);
  };
  const sel = list.find((z) => z.id === card._zoneSel) || null;
  const choose = (id) => {
    card._zoneSel = card._zoneSel === id ? null : id;
    pushZones(card);
    card.requestUpdate();
  };
  const tool = ed.clickTool && ed.clickTool.key;
  // aquarium: the zone takes its size (front on a wall, top on a floor)
  const sizeOf = (z, floor) => {
    const a = z.kind === 'aquarium' && aquariums.find((x) => x.id === z.aquarium);
    return (a && aquariumSize(a.dims, floor)) || [1, 0.6];
  };
  const eng = card._engine;
  const color = (z) => (z.kind === 'aquarium' ? '#29d3e8' : '#b47cff');
  const placeRect = (z) =>
    ed.setClickTool({
      key: 'zone-rect',
      wall: true,
      hover: (hit) => {
        if (!hit || !hit.mesh) return eng.setTarget(null);
        const [w, h] = sizeOf(z, !hit.normal);
        eng.setTarget({ hit, rect: rectAt(hit, w, h), color: color(z) });
      },
      leave: () => eng.setTarget(null),
      click: (hit) => {
        const floor = !hit.normal;
        const [w, h] = sizeOf(z, floor);
        Object.assign(z, { shape: 'rect', rect: rectAt(hit, w, h), level: hit.level || null, box: undefined });
        ed.setClickTool(null);
        save();
      },
    });
  const pickObject = (z) =>
    ed.setClickTool({
      key: 'zone-box',
      furniture: true,
      hover: (p) => eng.setTarget(p ? { box: p.box } : null),
      leave: () => eng.setTarget(null),
      click: (p) => {
        Object.assign(z, {
          shape: 'box',
          box: boxOf(p.item, card._engine.world.levelsById[p.level].elevation),
          level: p.level,
          rect: undefined,
        });
        if (!z.name && p.item.name) z.name = p.item.name;
        ed.setClickTool(null);
        save();
      },
    });
  const add = (kind) => {
    const z = { id: newId('z'), kind, name: '', thumb: true };
    if (kind === 'aquarium' && aquariums.length) Object.assign(z, { aquarium: aquariums[0].id, name: aquariums[0].name });
    list.push(z);
    card._zoneSel = z.id;
    save();
  };
  const where = (z) =>
    !z.shape ? t('zone_unplaced') : z.shape === 'box' ? t('zone_on_object') : onFloor(z.rect) ? t('zone_on_floor') : t('zone_on_wall');
  const rng = (label, value, min, max, step, apply, fmt) => card._range(label, value, min, max, step, apply, fmt, true);
  const setRect = (z, patch) => {
    z.rect = { ...z.rect, ...patch };
    save();
  };
  // view of the aquarium shown on the zone and opened by a tap ('' = its default view)
  const viewSelect = (z) => {
    const a = aquariums.find((x) => x.id === z.aquarium);
    if (!a || a.views.length < 2) return nothing;
    return html`<span>${t('zone_view')}</span>
      <select
        @change=${(e) => {
          z.view = e.target.value;
          save();
        }}
      >
        <option value="" ?selected=${!z.view}>${t('zone_view_default')} (${a.views[0].name})</option>
        ${a.views.map((v) => html`<option value=${v.id} ?selected=${v.id === z.view}>${v.name}</option>`)}
      </select>`;
  };
  const body = (z) => {
    const floor = z.rect && onFloor(z.rect);
    return html`<div class="grid">
        <span>${t('zone_name')}</span
        ><input
          type="text"
          .value=${z.name || ''}
          @change=${(e) => {
            z.name = e.target.value.trim();
            save();
          }}
        />
        ${
          z.kind === 'media'
            ? html`<span>${t('zone_player')}</span>${card._entityInput(
                  z.entity,
                  (id) => {
                    z.entity = id;
                    save();
                  },
                  ['media_player'],
                  zoneArea(card, z),
                )}`
            : html`<span>${t('zone_aquarium')}</span>
                <select
                  @change=${(e) => {
                    const a = aquariums.find((x) => x.id === e.target.value);
                    z.aquarium = e.target.value;
                    if (a && (!z.name || aquariums.some((x) => x.name === z.name))) z.name = a.name;
                    if (a && z.rect) {
                      const size = aquariumSize(a.dims, onFloor(z.rect));
                      if (size) z.rect = { ...z.rect, w: size[0], h: size[1] };
                    }
                    z.view = ''; // the views belong to an aquarium
                    save();
                  }}
                >
                  ${aquariums.map((a) => html`<option value=${a.id} ?selected=${a.id === z.aquarium}>${a.name}</option>`)}
                </select>
                ${viewSelect(z)}`
        }
      </div>
      <div class="row">
        <button class=${tool === 'zone-rect' ? 'on' : ''} @click=${() => (tool === 'zone-rect' ? ed.setClickTool(null) : placeRect(z))}>
          ${t('zone_draw')}
        </button>
        ${
          z.kind === 'media'
            ? html`<button
                class=${tool === 'zone-box' ? 'on' : ''}
                @click=${() => (tool === 'zone-box' ? ed.setClickTool(null) : pickObject(z))}
              >
                ${t('zone_pick_object')}
              </button>`
            : nothing
        }
      </div>
      ${tool === 'zone-rect' ? html`<div class="hint">${t('zone_draw_hint')}</div>` : nothing}
      ${tool === 'zone-box' ? html`<div class="hint">${t('zone_pick_hint')}</div>` : nothing}
      ${
        z.shape === 'rect' && z.rect
          ? html`${rng(
              t('zone_width'),
              z.rect.w * 100,
              10,
              600,
              1,
              (x) => setRect(z, { w: x / 100 }),
              (x) => `${Math.round(x)} cm`,
            )}
            ${rng(
              t('zone_height'),
              z.rect.h * 100,
              10,
              400,
              1,
              (x) => setRect(z, { h: x / 100 }),
              (x) => `${Math.round(x)} cm`,
            )}
            ${
              floor
                ? rng(
                    t('zone_rot'),
                    z.rect.rot || 0,
                    -180,
                    180,
                    1,
                    (x) => setRect(z, { rot: x }),
                    (x) => `${Math.round(x)}°`,
                  )
                : rng(
                    t('zone_lift'),
                    z.rect.c[1] * 100,
                    (z.rect.c[1] - 3) * 100,
                    (z.rect.c[1] + 3) * 100,
                    1,
                    (x) => setRect(z, { c: [z.rect.c[0], x / 100, z.rect.c[2]] }),
                    (x) => `${(x / 100).toFixed(2)} m`,
                  )
            }
            ${
              z.kind === 'aquarium'
                ? html`<label class="chk"
                    ><input
                      type="checkbox"
                      .checked=${z.thumb !== false}
                      @change=${(e) => {
                        z.thumb = e.target.checked;
                        save();
                      }}
                    />
                    ${t('zone_thumb')}</label
                  >`
                : nothing
            }`
          : nothing
      }
      <div class="row">
        <button
          @click=${() => {
            list.splice(list.indexOf(z), 1);
            card._zoneSel = null;
            ed.setClickTool(null);
            save();
          }}
        >
          ${t('delete')}
        </button>
      </div>`;
  };
  return html`<div class="hint">${t('zones_hint')}</div>
    ${list.map(
      (z) =>
        html`<div class=${`zone ${sel === z ? 'open' : ''}`}>
          <div class="ent-head" @click=${() => choose(z.id)}>
            <ha-icon icon=${z.kind === 'media' ? 'mdi:play-box-outline' : 'mdi:fishbowl-outline'}></ha-icon>
            <b>${z.name || (z.kind === 'media' ? z.entity : '') || t(z.kind === 'media' ? 'zone_media' : 'zone_aquarium')}</b>
            <small>${where(z)}</small>
          </div>
          ${sel === z ? body(z) : nothing}
        </div>`,
    )}
    <div class="row">
      <button @click=${() => add('media')}>${t('zone_add_media')}</button>
      ${aquariums.length ? html`<button @click=${() => add('aquarium')}>${t('zone_add_aquarium')}</button>` : nothing}
    </div>
    ${aquariums.length || !card._aquariumsLoaded ? nothing : html`<div class="hint">${t('zone_no_reeftank')}</div>`}
    ${aquariums.length && !customElements.get(AQUARIUM_CARD) ? html`<div class="hint">${t('zone_no_reef_card')}</div>` : nothing}`;
}
