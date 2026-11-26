// Panel of the simple plan builder: a top view of the current level where rectangular rooms are moved and resized
// with the mouse (edges stick to the neighbouring rooms), doors and windows placed on their sides, and the fields of
// the selected room. Every change rebuilds the 3D scene behind the panel (the plan is saved a moment later).
import { html, svg, nothing } from 'lit';
import {
  OPENING_DEFAULTS,
  addLevel,
  addOpening,
  addRoom,
  nearestSide,
  removeLevel,
  removeRoom,
  sideLength,
  sidePoint,
  snapRoom,
} from './plan-builder.js';

const SIDE_KEYS = ['n', 'e', 's', 'w'];
const TYPE_COLOR = { window: '#7fd3ff', patio: '#3fa9f5', door: '#f5b041', garage: '#c08a3e' };

/** Point of the plan (meters) under a pointer event on the svg. */
function planPoint(ev, svgEl) {
  const m = svgEl.getScreenCTM();
  if (!m) return [0, 0];
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}

/** View box around the rooms of the level (and of the level below), at least 12 m wide. */
function viewBox(rooms) {
  if (!rooms.length) return [-2, -2, 14, 10];
  let x0 = Math.min(...rooms.map((r) => r.x));
  let z0 = Math.min(...rooms.map((r) => r.z));
  let x1 = Math.max(...rooms.map((r) => r.x + r.w));
  let z1 = Math.max(...rooms.map((r) => r.z + r.d));
  const m = 2;
  x0 -= m;
  z0 -= m;
  x1 += m;
  z1 += m;
  if (x1 - x0 < 12) {
    const c = (x0 + x1) / 2;
    x0 = c - 6;
    x1 = c + 6;
  }
  if (z1 - z0 < 8) {
    const c = (z0 + z1) / 2;
    z0 = c - 4;
    z1 = c + 4;
  }
  return [x0, z0, x1 - x0, z1 - z0];
}

/** The top view of the current level, with the drag handlers. */
function planView(card, b, t) {
  const level = card._bLevel;
  const lvIdx = b.levels.findIndex((l) => l.id === level);
  const rooms = b.rooms.filter((r) => r.level === level);
  const below = lvIdx > 0 ? b.rooms.filter((r) => r.level === b.levels[lvIdx - 1].id) : [];
  // the view box stays put while dragging, so that the room does not run away from the pointer
  if (!card._bDrag || !card._bBox) card._bBox = viewBox([...rooms, ...below]);
  const [vx, vz, vw, vh] = card._bBox;
  const sel = b.rooms.find((r) => r.id === card._bSel) || null;
  const handle = 0.12 * Math.max(vw / 14, 1);

  const down = (ev, drag) => {
    ev.stopPropagation();
    const el = ev.currentTarget.ownerSVGElement || ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    card._bDrag = { ...drag, start: planPoint(ev, el), svg: el };
    card.requestUpdate();
  };
  const move = (ev) => {
    const D = card._bDrag;
    if (!D) return;
    const p = planPoint(ev, D.svg);
    const dx = p[0] - D.start[0];
    const dz = p[1] - D.start[1];
    const r = b.rooms.find((x) => x.id === D.room);
    if (!r) return;
    const o = D.orig;
    if (D.mode === 'move') Object.assign(r, snapRoom(b, r, o.x + dx, o.z + dz, o.w, o.d));
    else if (D.mode === 'x0') Object.assign(r, snapRoom(b, r, o.x + dx, o.z, o.w - dx, o.d, ['x1', 'z0', 'z1']));
    else if (D.mode === 'x1') Object.assign(r, snapRoom(b, r, o.x, o.z, o.w + dx, o.d, ['x0', 'z0', 'z1']));
    else if (D.mode === 'z0') Object.assign(r, snapRoom(b, r, o.x, o.z + dz, o.w, o.d - dz, ['x0', 'x1', 'z1']));
    else if (D.mode === 'z1') Object.assign(r, snapRoom(b, r, o.x, o.z, o.w, o.d + dz, ['x0', 'x1', 'z0']));
    else if (D.mode === 'opening') {
      const op = b.openings.find((x) => x.id === D.opening);
      const s = nearestSide(r, p);
      if (op && s.side === op.side)
        op.pos = Math.min(Math.max(Math.round(s.pos * 20) / 20, op.width / 2), sideLength(r, op.side) - op.width / 2);
    }
    D.moved = true;
    card.requestUpdate();
  };
  const up = () => {
    const D = card._bDrag;
    card._bDrag = null;
    if (D && D.moved) card._builderChanged();
    else card.requestUpdate();
  };
  const clickRoom = (ev, r) => {
    // placing a door or a window: on the side of the room closest to the click
    if (card._bPlace && r.id === card._bSel) {
      const s = nearestSide(r, planPoint(ev, ev.currentTarget.ownerSVGElement));
      const o = addOpening(b, r, s.side, card._bPlace, s.pos);
      card._bPlace = null;
      card._bOpening = o.id;
      card._builderChanged();
      return;
    }
    card._bSel = r.id;
    card._bOpening = null;
    card.requestUpdate();
  };

  const font = Math.max(vw / 38, 0.22);
  return html`<svg
      class="bplan"
      viewBox=${`${vx} ${vz} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      @pointermove=${move}
      @pointerup=${up}
      @pointercancel=${up}
      @pointerdown=${() => {
        card._bSel = null;
        card._bPlace = null;
        card.requestUpdate();
      }}
    >
      ${svg`
      <defs><pattern id="bgrid" width="1" height="1" patternUnits="userSpaceOnUse">
        <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.02" />
      </pattern></defs>
      <rect x=${vx} y=${vz} width=${vw} height=${vh} fill="url(#bgrid)" />
      ${below.map((r) => svg`<rect x=${r.x} y=${r.z} width=${r.w} height=${r.d} fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.04" stroke-dasharray="0.2 0.15" />`)}
      ${rooms.map((r) => {
        const on = r.id === card._bSel;
        return svg`<g>
          <rect class="broom" x=${r.x} y=${r.z} width=${r.w} height=${r.d}
            fill=${on ? 'rgba(80,160,255,0.35)' : 'rgba(200,190,170,0.25)'} stroke=${on ? '#4ea3ff' : '#d8d0c0'} stroke-width="0.1"
            @pointerdown=${(e) => {
              if (card._bPlace && on) return e.stopPropagation();
              card._bSel = r.id;
              down(e, { mode: 'move', room: r.id, orig: { ...r } });
            }}
            @click=${(e) => clickRoom(e, r)} />
          <text x=${r.x + r.w / 2} y=${r.z + r.d / 2} font-size=${font} text-anchor="middle" fill="#fff" pointer-events="none">${r.name}</text>
          <text x=${r.x + r.w / 2} y=${r.z + r.d / 2 + font * 1.2} font-size=${font * 0.8} text-anchor="middle" fill="rgba(255,255,255,0.7)"
            pointer-events="none">${r.w.toFixed(2)} × ${r.d.toFixed(2)} m</text>
        </g>`;
      })}
      ${b.openings
        .filter((o) => rooms.some((r) => r.id === o.room))
        .map((o) => {
          const r = rooms.find((x) => x.id === o.room);
          const along = o.side === 'n' || o.side === 's';
          const c = sidePoint(r, o.side, o.pos);
          const half = o.width / 2;
          const [x1, z1, x2, z2] = along ? [c[0] - half, c[1], c[0] + half, c[1]] : [c[0], c[1] - half, c[0], c[1] + half];
          const on = o.id === card._bOpening;
          return svg`<line x1=${x1} y1=${z1} x2=${x2} y2=${z2} stroke=${TYPE_COLOR[o.type] || '#fff'} stroke-width=${on ? 0.32 : 0.22}
            stroke-linecap="butt" style="cursor:grab"
            @pointerdown=${(e) => {
              card._bSel = r.id;
              card._bOpening = o.id;
              down(e, { mode: 'opening', room: r.id, opening: o.id, orig: { ...r } });
            }} />`;
        })}
      ${
        sel && sel.level === level && !card._bPlace
          ? [
              ['x0', sel.x, sel.z + sel.d / 2, 'ew-resize'],
              ['x1', sel.x + sel.w, sel.z + sel.d / 2, 'ew-resize'],
              ['z0', sel.x + sel.w / 2, sel.z, 'ns-resize'],
              ['z1', sel.x + sel.w / 2, sel.z + sel.d, 'ns-resize'],
            ].map(
              ([
                mode,
                x,
                z,
                cur,
              ]) => svg`<rect x=${x - handle} y=${z - handle} width=${handle * 2} height=${handle * 2} fill="#fff" stroke="#4ea3ff"
                stroke-width="0.04" style=${`cursor:${cur}`} @pointerdown=${(e) => down(e, { mode, room: sel.id, orig: { ...sel } })} />`,
            )
          : nothing
      }
      <text x=${vx + vw - 0.4} y=${vz + 0.9} font-size=${font} text-anchor="middle" fill="#ff6b6b">N</text>
      <path d=${`M ${vx + vw - 0.4} ${vz + 1.1} l -0.2 0.5 l 0.4 0 z`} fill="#ff6b6b" />
    `}
    </svg>
    <div class="hint">${t(card._bPlace ? 'b_place_hint' : 'b_plan_hint')}</div>`;
}

const num = (label, value, set, step = 0.05, min = 0) =>
  html`<label class="bnum"
    >${label}<input
      type="number"
      step=${step}
      min=${min}
      .value=${String(+(+value).toFixed(2))}
      @change=${(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) set(v);
      }}
  /></label>`;

/** Fields of the selected room: name, Home Assistant area, size, position, its doors and windows. */
function roomFields(card, b, t, r) {
  const areas = Object.values((card._hass && card._hass.areas) || {}).sort((x, y) => (x.name || '').localeCompare(y.name || ''));
  const changed = () => card._builderChanged();
  const set = (patch) => {
    Object.assign(r, patch);
    changed();
  };
  const ops = b.openings.filter((o) => o.room === r.id);
  const op = ops.find((o) => o.id === card._bOpening) || null;
  return html`<div class="bbox">
    <div class="row">
      <input
        class="grow"
        .value=${r.name}
        list="hv-areas"
        @change=${(e) => {
          const a = areas.find((x) => x.name === e.target.value);
          set({ name: e.target.value, area: a ? a.area_id : r.area });
        }}
      />
      <datalist id="hv-areas">${areas.map((a) => html`<option value=${a.name}></option>`)}</datalist>
      <button
        title=${t('remove')}
        @click=${() => {
          removeRoom(b, r.id);
          card._bSel = null;
          changed();
        }}
      >
        🗑
      </button>
    </div>
    <label class="bnum wide"
      >${t('b_area')}
      <select @change=${(e) => set({ area: e.target.value || undefined })} .value=${r.area || ''}>
        <option value="">${t('b_area_auto')}</option>
        ${areas.map((a) => html`<option value=${a.area_id} ?selected=${a.area_id === r.area}>${a.name}</option>`)}
      </select></label
    >
    <div class="row">
      ${num(t('b_width'), r.w, (v) => set({ w: Math.max(v, 0.5) }))} ${num(t('b_depth'), r.d, (v) => set({ d: Math.max(v, 0.5) }))}
    </div>
    <div class="row">${num('x', r.x, (v) => set({ x: v }), 0.05, -999)} ${num('z', r.z, (v) => set({ z: v }), 0.05, -999)}</div>
    <div class="row">
      ${['window', 'patio', 'door', 'garage'].map(
        (k) =>
          html`<button
            class=${card._bPlace === k ? 'on' : ''}
            @click=${() => {
              card._bPlace = card._bPlace === k ? null : k;
              card.requestUpdate();
            }}
          >
            ＋ ${t(`opening_${k}`)}
          </button>`,
      )}
    </div>
    ${
      ops.length
        ? html`<div class="blist">
            ${ops.map(
              (o) =>
                html`<button
                  class=${o.id === card._bOpening ? 'on' : ''}
                  @click=${() => {
                    card._bOpening = o.id === card._bOpening ? null : o.id;
                    card.requestUpdate();
                  }}
                >
                  ${t(`opening_${o.type}`)} · ${t(`b_side_${o.side}`)}
                </button>`,
            )}
          </div>`
        : nothing
    }
    ${
      op
        ? html`<div class="bbox">
            <div class="row">
              <select
                @change=${(e) => {
                  const type = e.target.value;
                  Object.assign(op, { type, height: OPENING_DEFAULTS[type].height, sill: OPENING_DEFAULTS[type].sill });
                  changed();
                }}
              >
                ${['window', 'patio', 'door', 'garage'].map((k) => html`<option value=${k} ?selected=${op.type === k}>${t(`opening_${k}`)}</option>`)}
              </select>
              <select
                @change=${(e) => {
                  op.side = e.target.value;
                  op.pos = Math.min(op.pos, sideLength(r, op.side) - op.width / 2);
                  changed();
                }}
              >
                ${SIDE_KEYS.map((k) => html`<option value=${k} ?selected=${op.side === k}>${t(`b_side_${k}`)}</option>`)}
              </select>
              <button
                title=${t('remove')}
                @click=${() => {
                  b.openings = b.openings.filter((x) => x.id !== op.id);
                  card._bOpening = null;
                  changed();
                }}
              >
                🗑
              </button>
            </div>
            <div class="row">
              ${num(t('b_pos'), op.pos, (v) => ((op.pos = v), changed()))}
              ${num(t('b_width'), op.width, (v) => ((op.width = Math.max(v, 0.3)), changed()))}
            </div>
            <div class="row">
              ${num(t('b_height'), op.height, (v) => ((op.height = Math.max(v, 0.3)), changed()))}
              ${num(t('b_sill'), op.sill, (v) => ((op.sill = Math.max(v, 0)), changed()))}
            </div>
          </div>`
        : nothing
    }
  </div>`;
}

/** Body of the builder panel. */
export function renderBuilder(card) {
  const t = card._t;
  const b = card._builder;
  if (!b) return nothing;
  if (!b.levels.some((l) => l.id === card._bLevel)) card._bLevel = b.levels[0].id;
  const level = b.levels.find((l) => l.id === card._bLevel);
  const sel = b.rooms.find((r) => r.id === card._bSel && r.level === level.id) || null;
  const changed = () => card._builderChanged();
  return html`
    <div class="hint">${t('b_hint')}</div>
    <div class="blist">
      ${b.levels.map(
        (l) =>
          html`<button
            class=${l.id === level.id ? 'on' : ''}
            @click=${() => {
              card._bLevel = l.id;
              card._bSel = null;
              card._bBox = null;
              card.requestUpdate();
            }}
          >
            ${l.name}
          </button>`,
      )}
      <button
        title=${t('b_add_level_hint')}
        @click=${() => {
          const lv = addLevel(b, `${t('b_level')} ${b.levels.length}`, b.levels[b.levels.length - 1].id);
          card._bLevel = lv.id;
          card._bBox = null;
          changed();
        }}
      >
        ＋ ${t('b_level')}
      </button>
    </div>
    <div class="row">
      <input
        class="grow"
        .value=${level.name}
        @change=${(e) => {
          level.name = e.target.value || level.name;
          changed();
        }}
      />
      ${num(t('b_ceiling'), level.height, (v) => ((level.height = Math.min(Math.max(v, 1.8), 6)), changed()))}
      ${
        b.levels.length > 1
          ? html`<button
              title=${t('remove')}
              @click=${() => {
                removeLevel(b, level.id);
                card._bLevel = b.levels[0].id;
                card._bBox = null;
                changed();
              }}
            >
              🗑
            </button>`
          : nothing
      }
    </div>
    ${planView(card, b, t)}
    <div class="row">
      <button
        @click=${() => {
          const used = new Set(b.rooms.map((r) => r.area).filter(Boolean));
          const free = Object.values((card._hass && card._hass.areas) || {}).find((a) => !used.has(a.area_id));
          const r = addRoom(b, level.id, free ? free.name : '');
          if (free) r.area = free.area_id;
          card._bSel = r.id;
          card._bBox = null;
          changed();
        }}
      >
        ＋ ${t('b_add_room')}
      </button>
    </div>
    ${sel ? roomFields(card, b, t, sel) : nothing}
    <details>
      <summary>${t('b_house')}</summary>
      <label class="bnum wide"
        >${t('b_roof')}
        <select
          @change=${(e) => {
            b.roof = e.target.value;
            changed();
          }}
        >
          ${['auto', 'gable', 'flat'].map((k) => html`<option value=${k} ?selected=${b.roof === k}>${t(`b_roof_${k}`)}</option>`)}
        </select></label
      >
      ${num(t('b_north'), b.north, (v) => ((b.north = v), changed()), 1, -360)}
      <div class="hint">${t('b_north_hint')}</div>
    </details>
  `;
}
