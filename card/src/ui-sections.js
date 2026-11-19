// Editor sections of the card: fences, rooms <-> areas, robot vacuum, watering. Plain functions of the card instance
// (they read card._t, card._editors and the feature tools) so that the card file stays readable.
import { html, nothing } from 'lit';
import { FENCE_TYPES, normalizeFence, sideCount } from './fences.js';
import { SPRINKLERS, SOILS, LINE_COLORS, sprinklerModel, smoothPath, isOn } from './irrigation.js';
import { mapRoomsToAreas } from './ha-bridge.js';

const num = (value, onChange, step = 0.1, min = undefined, max = undefined) =>
  html`<input
    type="number"
    step=${step}
    min=${min ?? nothing}
    max=${max ?? nothing}
    .value=${String(value)}
    @change=${(e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) onChange(v);
    }}
  />`;

const tool = (ed, key) => !!ed.clickTool && ed.clickTool.key === key;

// ---------------------------------------------------------------------------- fences

export function renderFences(card) {
  const t = card._t;
  const ed = card._editors;
  const ft = card._fenceTools;
  const picking = !!ed.parcelSel;
  const drawing = !!ft.draw && tool(ed, 'fence-draw');
  const editing = ft.edit && tool(ed, 'fence-edit') ? ft.edit : null;
  const palette = () =>
    html`<div class="chips">
        ${Object.keys(FENCE_TYPES).map(
          (k) =>
            html`<button class=${ft.brush.s === k ? 'on' : ''} @click=${() => ft.setBrush({ s: k })}>
              <i class="sw" style=${`background:${FENCE_TYPES[k].draft}`}></i>${t(`fence_${k}`)}
            </button>`,
        )}
      </div>
      ${
        ft.brush.s === 'none'
          ? nothing
          : html`<div class="row">
              <span>${t('fence_h')}</span>${num(ft.brush.h, (v) => ft.setBrush({ h: v }), 0.1, 0.3, 4)} <span>${t('color')}</span
              ><input
                type="color"
                .value=${ft.brush.c || FENCE_TYPES[ft.brush.s].color}
                @change=${(e) => ft.setBrush({ c: e.target.value })}
              />
            </div>`
      }`;
  const create = () =>
    card._try(() => {
      const n = ed.fenceSelected();
      card._msg = n ? `${t('fence_created')} (${n})` : t('fence_failed');
    });
  return html`
    <div class="row">
      ${
        ed.parcels.length
          ? html`<button
              class=${picking ? 'on' : ''}
              @click=${() => card._try(() => (picking ? ed.cancelParcelPick() : ed.startParcelPick()))}
            >
              ${t('fence_parcel')}
            </button>`
          : nothing
      }
      <button class=${drawing ? 'on' : ''} @click=${() => (drawing ? ft.cancel() : ft.startDraw())}>${t('fence_draw')}</button>
    </div>
    ${ed.parcels.length ? nothing : html`<div class="hint">${t('fence_needs_parcels')}</div>`}
    ${
      picking
        ? html`<div class="hint">${t('fence_pick_hint')}</div>
            <div class="hint">
              <b>${ed.parcelSel.size} ${t('fence_parcels')}</b> ${[...ed.parcelSel].map((k) => ed.parcels[k].id || '?').join(', ')}
            </div>
            <div class="row">
              <button class="on" ?disabled=${!ed.parcelSel.size} @click=${create}>${t('fence_create')}</button>
            </div>`
        : nothing
    }
    ${
      drawing
        ? html`<div class="hint">${t('fence_draw_hint')}</div>
            ${palette()}
            <div class="row">
              <button class="on" ?disabled=${ft.draw.pts.length < 2} @click=${() => ft.finishDraw(false)}>
                ${t('finish')} (${ft.draw.pts.length})
              </button>
              <button ?disabled=${ft.draw.pts.length < 3} @click=${() => ft.finishDraw(true)}>${t('fence_close')}</button>
              <button ?disabled=${!ft.draw.pts.length} @click=${() => ft.undoPoint()}>${t('undo_point')}</button>
            </div>`
        : nothing
    }
    ${ft.fences.map((raw, i) => {
      const f = normalizeFence(raw);
      const on = !!editing && editing.i === i;
      const ids = f.parcels && f.parcels.length ? ` · ${f.parcels.join(', ')}` : '';
      const kinds = [...new Set(f.segs.map((s) => s.s))].map((k) => t(`fence_${k}`)).join(', ');
      return html`<div class=${`ent ${on ? 'open' : ''}`}>
        <div><b>${t('fence')} ${i + 1}${ids}</b> <span class="hint">${sideCount(f)} ${t('fence_sides')} · ${kinds}</span></div>
        <div class="row">
          <button class=${on ? 'on' : ''} @click=${() => (on ? ft.cancel() : ft.startEdit(i))}>${t('fence_edit')}</button>
          <button @click=${() => ft.toggleHidden(i)}>${f.hidden ? t('show') : t('hide')}</button>
          <button @click=${() => ft.remove(i)}>${t('delete')}</button>
        </div>
        ${
          on
            ? html`<div class="chips">
                  ${['paint', 'cut', 'unpoint'].map(
                    (k) =>
                      html`<button class=${editing.tool === k ? 'on' : ''} @click=${() => ft.setTool(k)}>${t(`fence_tool_${k}`)}</button>`,
                  )}
                </div>
                ${editing.tool === 'paint' ? palette() : nothing}
                <div class="hint">${t(`fence_hint_${editing.tool}`)}</div>`
            : nothing
        }
      </div>`;
    })}
  `;
}

// ---------------------------------------------------------------------------- rooms <-> Home Assistant areas

export function renderRooms(card) {
  const t = card._t;
  const eng = card._engine;
  const hass = card._hass;
  const explicit = card._data.edits.room_areas;
  const auto = mapRoomsToAreas(eng.rooms, hass.areas, {});
  const areas = Object.values(hass.areas || {}).sort((a, b) => a.name.localeCompare(b.name));
  const name = (id) => (hass.areas[id] ? hass.areas[id].name : id);
  const set = (id, v) => {
    if (v) explicit[id] = v;
    else delete explicit[id];
    card._lastLive = '';
    card._pushLive();
    card._edited(true);
  };
  return html`<div class="hint">${t('rooms_hint')}</div>
    ${eng.world.sd.levels.map(
      (lv) =>
        html`<b>${lv.name || lv.id}</b>
          <div class="grid rooms">
            ${lv.rooms.map(
              (r) =>
                html`<span @pointerenter=${() => eng.setHighlight(new Set([r.id]))} @pointerleave=${() => card._vacuumSync()}
                    >${r.name || r.id}</span
                  >
                  <select @change=${(e) => set(r.id, e.target.value)}>
                    <option value="" ?selected=${!explicit[r.id]}>
                      ${t('area_auto')} : ${auto[r.id] ? name(auto[r.id]) : t('area_none')}
                    </option>
                    <option value="-" ?selected=${explicit[r.id] === '-'}>— ${t('area_none')} —</option>
                    ${areas.map((a) => html`<option value=${a.area_id} ?selected=${explicit[r.id] === a.area_id}>${a.name}</option>`)}
                  </select>`,
            )}
          </div>`,
    )}`;
}

// ---------------------------------------------------------------------------- robot vacuum

export function renderVacuumSetup(card) {
  const t = card._t;
  const ed = card._editors;
  const vt = card._vacTools;
  const ctl = card._vac;
  const eng = card._engine;
  const v = ctl.cfg;
  const st = card._hass.states[card._vacuum];
  const src = ctl.source();
  const dock = v.dock && v.dock.at ? v.dock : null;
  const where = () => {
    if (!dock) return t('entity_unplaced');
    const lv = eng.world.sd.levels.find((l) => l.id === dock.level);
    return (lv && (lv.name || lv.id)) || t('outside');
  };
  const save = (patch, rebuild = false) => {
    vt.set(patch, rebuild);
    ctl.refresh();
  };
  const capture = () =>
    card._try(async () => {
      const ok = await ctl.captureOrigin();
      card._msg = ok ? t('vac_origin_ok') : `${t('vac_no_pos')} ${ctl.msg}`;
      card._edited(ok);
    });
  const calib = () =>
    card._try(async () => {
      await ctl.readRaw();
      if (!ctl.raw) {
        card._msg = `${t('vac_no_pos')} ${ctl.msg}`;
        card.requestUpdate();
        return;
      }
      vt.calibrate((at) => {
        const r = ctl.solve(at);
        card._msg = !r
          ? t('vac_calib_near')
          : `${t('rot')} ${r.rot}°${Math.abs(r.ratio - 1) > 0.2 ? ` · ${t('vac_calib_ratio')} ×${r.ratio.toFixed(2)}` : ''}`;
        ctl.refresh();
        card._edited(!!r);
      });
    });
  const mode = ['dock', 'dock-aim', 'calib', 'map-pin'].find((k) => tool(ed, k)) || null;
  const turn = (deg) => {
    vt.turnDock(deg);
    ctl.refresh();
  };
  // picture of the robot's map laid over the plan: turned (and, without calibration points, pinned and sized) until
  // its walls follow those of the plan
  const m = ctl.mapCfg;
  const mapEntity = ctl.mapEntity();
  const calibrated = !!ctl.mapCalibration();
  const saveMap = (patch) => save({ map: { ...(v.map || {}), ...patch } });
  const pin = () =>
    vt.pinMap((at) => {
      ctl.pinMap(at);
      card._edited(true);
    });
  const nudge = (dx, dz) => {
    if (ctl.nudgeMap(dx, dz)) card._edited(true);
  };
  const mapWhy = !dock
    ? 'vac_map_need_dock'
    : !mapEntity
      ? 'vac_map_none'
      : ctl.mapMsg === 'error'
        ? 'vac_map_error'
        : calibrated && !v.origin && !ctl.charger
          ? 'vac_map_need_origin'
          : '';
  const arrow = (label, dx, dz) => html`<button @click=${() => nudge(dx, dz)}>${label}</button>`;
  const mapBlock = () => html`
    <label class="chk"
      ><input
        type="checkbox"
        .checked=${ctl.mapOn}
        @change=${(e) => {
          ctl.showMap(e.target.checked);
          card.requestUpdate();
        }}
      />
      ${t('vac_map_show')}</label
    >
    ${
      !ctl.mapOn
        ? nothing
        : html`<div class="grid">
              <span>${t('vac_map_entity')}</span
              >${card._entityInput(m.entity || mapEntity || '', (id) => saveMap({ entity: id }), ['image', 'camera'])}
            </div>
            ${
              mapWhy
                ? html`<div class="hint"><span class="err">${t(mapWhy)}</span></div>`
                : html`${card._range(
                      t('vac_rot'),
                      v.rot || 0,
                      -180,
                      180,
                      0.5,
                      (x) => save({ rot: x }),
                      (x) => `${Number(x).toFixed(1)}°`,
                      true,
                    )}
                    ${
                      calibrated
                        ? nothing
                        : html`${card._range(
                              t('vac_map_res'),
                              m.res * 1000,
                              2,
                              60,
                              0.1,
                              (x) => saveMap({ res: x / 1000 }),
                              (x) => `${Number(x).toFixed(1)} mm`,
                              true,
                            )}
                            <div class="row">
                              <button class=${mode === 'map-pin' ? 'on' : ''} @click=${() => (mode === 'map-pin' ? vt.cancel() : pin())}>
                                ${t('vac_map_pin')}
                              </button>
                            </div>
                            <div class="row">
                              <span>${t('vac_map_nudge')}</span>
                              ${arrow('←', -0.05, 0)}${arrow('↑', 0, -0.05)}${arrow('↓', 0, 0.05)}${arrow('→', 0.05, 0)}
                            </div>`
                    }
                    ${card._range(
                      t('vac_map_opacity'),
                      m.opacity,
                      0.1,
                      1,
                      0.05,
                      (x) => saveMap({ opacity: x }),
                      (x) => `${Math.round(x * 100)} %`,
                      true,
                    )}
                    <div class="hint">
                      ${t(mode === 'map-pin' ? 'vac_map_pin_click' : calibrated ? 'vac_map_hint_calib' : 'vac_map_hint')}
                    </div>`
            }`
    }
  `;
  return html`
    <div class="hint">${(st && st.attributes.friendly_name) || card._vacuum} · ${card._stateText(st)}</div>
    <div class="row">
      <button class=${mode === 'dock' ? 'on' : ''} @click=${() => (mode === 'dock' ? vt.cancel() : vt.placeDock())}>
        ${t('vac_place_dock')}
      </button>
      <span class="hint">${where()}</span>
    </div>
    ${mode === 'dock' ? html`<div class="hint">${t('vac_dock_hint')}</div>` : nothing}
    ${
      dock
        ? html`<div class="row">
              <span>${t('vac_dock_dir')}</span
              >${num(dock.dir ?? 90, (x) => save({ dock: { ...dock, dir: ((x % 360) + 360) % 360 } }, true), 5)}
              <button title="-90°" @click=${() => turn(-90)}>⟲</button>
              <button title="+90°" @click=${() => turn(90)}>⟳</button>
              <button class=${mode === 'dock-aim' ? 'on' : ''} @click=${() => (mode === 'dock-aim' ? vt.cancel() : vt.aimDock())}>
                ${t('vac_dock_aim')}
              </button>
            </div>
            <div class="hint">${t(mode === 'dock-aim' ? 'vac_dock_aim_hint' : 'vac_dock_dir_hint')}</div>`
        : nothing
    }
    <div class="grid">
      <span>${t('vac_source')}</span>
      <select @change=${(e) => save({ source: e.target.value })}>
        ${['auto', 'roborock', 'entity', 'none'].map((k) => html`<option value=${k} ?selected=${(v.source || 'auto') === k}>${t(`vac_src_${k}`)}</option>`)}
      </select>
      ${
        v.source === 'entity' || (src === 'entity' && v.pos_entity)
          ? html`<span>${t('vac_pos_entity')}</span
              >${card._entityInput(v.pos_entity, (id) => save({ pos_entity: id }), ['camera', 'image', 'sensor', 'vacuum'])}`
          : nothing
      }
    </div>
    <div class="hint">
      ${t('vac_using')} : ${t(`vac_src_${src}`)}${src === 'entity' ? ` (${ctl.posEntity() || '?'})` : ''}
      ${ctl.raw ? html`<br />${t('vac_raw')} : ${Math.round(ctl.raw.x)}, ${Math.round(ctl.raw.y)}` : nothing}
      ${ctl.msg ? html`<br /><span class="err">${ctl.msg}</span>` : nothing}
    </div>
    ${
      src === 'none'
        ? html`<div class="hint">${t('vac_sim_hint')}</div>`
        : html`<div class="row">
              <button @click=${capture}>${t('vac_capture')}</button>
              <span class="hint">${v.origin ? `${Math.round(v.origin[0])}, ${Math.round(v.origin[1])}` : '—'}</span>
            </div>
            <div class="grid">
              <span>${t('vac_rot')}</span>${num(v.rot || 0, (x) => save({ rot: x }), 1, -180, 180)} <span>${t('vac_scale')}</span>${num(
                v.scale,
                (x) => save({ scale: x }),
                0.0001,
              )}
            </div>
            <label class="chk"
              ><input type="checkbox" .checked=${v.flip !== false} @change=${(e) => save({ flip: e.target.checked })} />
              ${t('vac_flip')}</label
            >
            <button class=${mode === 'calib' ? 'on' : ''} @click=${() => (mode === 'calib' ? vt.cancel() : calib())}>
              ${t('vac_calib')}
            </button>
            <div class="hint">${t(mode === 'calib' ? 'vac_calib_click' : 'vac_calib_hint')}</div>
            ${mapBlock()}`
    }
    <div class="grid">
      <span>${t('vac_color')}</span>
      <span class="row">
        <input type="color" .value=${v.color} @change=${(e) => save({ color: e.target.value })} />
        <button @click=${() => save({ color: '#f2f2f2' })}>${t('white')}</button>
        <button @click=${() => save({ color: '#1d1f23' })}>${t('black')}</button>
      </span>
      <span>${t('vac_room_color')}</span
      ><input type="color" .value=${v.room_color} @change=${(e) => save({ room_color: e.target.value })} />
      <span>${t('vac_size')}</span>${num(v.size, (x) => save({ size: Math.min(Math.max(x, 0.5), 4) }, true), 0.1, 0.5, 4)}
    </div>
    <label class="chk"
      ><input type="checkbox" .checked=${v.trail !== false} @change=${(e) => save({ trail: e.target.checked })} /> ${t('vac_trail')}</label
    >
    <div class="row">
      <button class=${ctl.demo ? 'on' : ''} @click=${() => (ctl.demo ? ctl.stopDemo() : ctl.startDemo(false))}>${t('vac_demo')}</button>
      <button ?disabled=${!!ctl.demo} @click=${() => ctl.startDemo(true)}>${t('vac_demo_err')}</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------- watering

export function renderIrrigation(card) {
  const t = card._t;
  const ed = card._editors;
  const it = card._irrTools;
  const hass = card._hass;
  const irr = it.irr;
  const eng = card._engine;
  const drawing = it.draw && tool(ed, 'drip') ? it.draw : null;
  const mode = it.mode && (tool(ed, 'head-place') || tool(ed, 'head-aim')) ? it.mode : null;
  const open = (id) => {
    it.sel = it.sel === id ? null : id;
    card.requestUpdate();
  };
  const stateOf = (o) =>
    it.testing(o.id) ? t('irr_preview_on') : o.entity && hass.states[o.entity] ? (isOn(hass.states[o.entity]) ? 'ON' : 'off') : '—';
  const length = (ln) => {
    if (!ln.pts || ln.pts.length < 2 || !eng.world) return 0;
    const toPlan = ed.toPlan(ln);
    const p = smoothPath(
      ln.pts.map(([x, z]) => toPlan(x, z)),
      0.3,
    );
    return p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  };
  const previewBtn = (o) =>
    html`<button class=${it.demo && !it.demo.all && it.testing(o.id) ? 'on' : ''} @click=${() => card._irrDemo([o.id])}>
      ${t('irr_test')}
    </button>`;
  const line = (ln, i) => {
    const on = it.sel === ln.id;
    const isDraw = drawing && drawing.id === ln.id;
    return html`<div class=${`ent ${on ? 'open' : ''}`}>
      <div class="ent-head" @click=${() => open(ln.id)}>
        <i class="sw" style=${`background:${LINE_COLORS[ln.color] || 'transparent'};border:1px solid #888`}></i>
        <span class="grow">${ln.name || `${t('irr_line')} ${i + 1}`}</span>
        <span class="hint">${length(ln).toFixed(1)} m · ${stateOf(ln)}</span>
        <span>${on ? '▾' : '▸'}</span>
      </div>
      ${
        on
          ? html`<div class="grid">
                <span>${t('name')}</span
                ><input type="text" .value=${ln.name || ''} @change=${(e) => it.editLine(ln.id, { name: e.target.value })} />
                <span>${t('irr_color')}</span>
                <select @change=${(e) => it.editLine(ln.id, { color: e.target.value })}>
                  ${['black', 'brown', 'green', 'none'].map((k) => html`<option value=${k} ?selected=${(ln.color || 'black') === k}>${t(`irr_color_${k}`)}</option>`)}
                </select>
                <span>${t('irr_flow')}</span>${num(ln.flow || 2, (v) => it.editLine(ln.id, { flow: Math.max(v, 0.1) }), 0.1, 0.1)}
                <span>${t('irr_spacing')}</span
                >${num(ln.spacing || 0.3, (v) => it.editLine(ln.id, { spacing: Math.max(v, 0.1) }), 0.05, 0.1)}
              </div>
              <label>${t('irr_switch')}</label>
              ${card._entityInput(ln.entity, (id) => it.editLine(ln.id, { entity: id }), ['switch', 'valve', 'input_boolean'])}
              ${
                isDraw
                  ? html`<div class="hint">${t('irr_draw_hint')}</div>
                      <div class="row">
                        <button class="on" ?disabled=${drawing.pts.length < 2} @click=${() => it.finishLine()}>
                          ${t('finish')} (${drawing.pts.length})
                        </button>
                        <button ?disabled=${!drawing.pts.length} @click=${() => it.undoPoint()}>${t('undo_point')}</button>
                        <button @click=${() => it.cancel()}>${t('cancel_pick')}</button>
                      </div>`
                  : html`<div class="row">
                      <button @click=${() => it.drawLine(ln.id)}>${t('irr_redraw')}</button>
                      ${ln.pts.length > 1 ? html`<button @click=${() => it.drawLine(ln.id, true)}>${t('irr_extend')}</button>` : nothing}
                      ${previewBtn(ln)}
                      <button @click=${() => it.removeLine(ln.id)}>${t('delete')}</button>
                    </div>`
              }`
          : nothing
      }
    </div>`;
  };
  const head = (c, h, k) => {
    const m = sprinklerModel(h.model);
    const set = (patch) => it.editHead(c.id, h.id, patch);
    const is = (kind) => mode && mode.kind === kind && mode.hid === h.id;
    return html`<div class="sub">
      <b>${t('irr_head')} ${k + 1}</b> <span class="hint">${h.at ? '' : t('entity_unplaced')}</span>
      <div class="grid">
        <span>${t('irr_model')}</span>
        <select @change=${(e) => set({ model: e.target.value })}>
          ${SPRINKLERS.map((s) => html`<option value=${s.id} ?selected=${s.id === m.id}>${s.brand ? `${s.brand} ` : ''}${s.name}</option>`)}
        </select>
        <span>${t('irr_rmin')}</span>${num(h.rMin, (v) => set({ rMin: v }), 0.1, 0)}
        <span>${t('irr_rmax')} (${m.rRange[0]}–${m.rRange[1]} m)</span>${num(h.rMax, (v) => set({ rMax: v }), 0.1, 0.5)}
        <span>${t('irr_dir')}</span>${num(h.dir, (v) => set({ dir: ((v % 360) + 360) % 360 }), 5)}
        <span>${t('irr_arc')} (${m.arc[0]}–${m.arc[1]}°)</span>${num(h.arc, (v) => set({ arc: Math.min(Math.max(v, 1), 360) }), 5, 1, 360)}
      </div>
      <div class="row">
        <button class=${is('place') ? 'on' : ''} @click=${() => (is('place') ? it.cancel() : it.placeHead(c.id, h.id))}>
          ${t('irr_place')}
        </button>
        <button class=${is('aim') ? 'on' : ''} ?disabled=${!h.at} @click=${() => (is('aim') ? it.cancel() : it.aimHead(c.id, h.id))}>
          ${t('irr_aim')}
        </button>
        <button @click=${() => it.removeHead(c.id, h.id)}>${t('delete')}</button>
      </div>
      ${is('place') ? html`<div class="hint">${t('irr_place_hint')}</div>` : is('aim') ? html`<div class="hint">${t('irr_aim_hint')}</div>` : nothing}
    </div>`;
  };
  const circuit = (c, i) => {
    const on = it.sel === c.id;
    return html`<div class=${`ent ${on ? 'open' : ''}`}>
      <div class="ent-head" @click=${() => open(c.id)}>
        <ha-icon icon="mdi:sprinkler-variant"></ha-icon>
        <span class="grow">${c.name || `${t('irr_circuit')} ${i + 1}`}</span>
        <span class="hint">${c.heads.length} ${t('irr_heads')} · ${stateOf(c)}</span>
        <span>${on ? '▾' : '▸'}</span>
      </div>
      ${
        on
          ? html`<div class="grid">
                <span>${t('name')}</span
                ><input type="text" .value=${c.name || ''} @change=${(e) => it.editCircuit(c.id, { name: e.target.value })} />
              </div>
              <label>${t('irr_switch')}</label>
              ${card._entityInput(c.entity, (id) => it.editCircuit(c.id, { entity: id }), ['switch', 'valve', 'input_boolean'])}
              ${c.heads.map((h, k) => head(c, h, k))}
              <div class="row">
                <button @click=${() => it.addHead(c.id)}>＋ ${t('irr_head')}</button>
                ${previewBtn(c)}
                <button @click=${() => it.removeCircuit(c.id)}>${t('irr_del_circuit')}</button>
              </div>`
          : nothing
      }
    </div>`;
  };
  return html`
    <div class="grid">
      <span>${t('irr_soil')}</span>
      <select @change=${(e) => it.setSoil(e.target.value)}>
        ${Object.keys(SOILS).map((k) => html`<option value=${k} ?selected=${(irr.soil || 'loam') === k}>${t(`soil_${k}`)}</option>`)}
      </select>
    </div>
    <div class="row">
      <button
        class=${it.demo && it.demo.all ? 'on' : ''}
        ?disabled=${!irr.lines.length && !irr.circuits.length}
        @click=${() => card._irrDemo()}
      >
        ${t('irr_demo')}
      </button>
    </div>
    <div class="hint">${t('irr_demo_hint')}</div>
    <b>${t('irr_drip')}</b>
    <div class="hint">${t('irr_drip_hint')}</div>
    ${irr.lines.map(line)}
    <button @click=${() => it.addLine()}>＋ ${t('irr_line')}</button>
    <b>${t('irr_sprinklers')}</b>
    <div class="hint">${t('irr_sprinklers_hint')}</div>
    ${irr.circuits.map(circuit)}
    <button @click=${() => it.addCircuit()}>＋ ${t('irr_circuit')}</button>
  `;
}
