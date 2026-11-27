// Editor sections of what surrounds the house: the terraces (outline, covering, altitude), and the pickers shared
// with the low walls and the fences, where a kind is chosen from a picture of it. Plain functions of the card
// instance, like ui-sections.js.
import { html, nothing } from 'lit';
import { isRectangle, normalizeTerrace, outlineAngle, outlineArea, terraceThumb, thicknessOf, TERRACE_H } from './terraces.js';
import { terraceKindName, terraceKinds, terraceLook } from './terrace-art.js';
import { copingOf, wallKindName, wallKinds, wallKind, WALL_DEFAULT } from './wall-art.js';
import { COPING_NONE, copingKindName, copingKinds, wallCoping } from './coping-art.js';
import { copingThumb, wallThumb } from './walls.js';
import { rectSize } from './pools.js';
import { renderMove } from './ui-pools.js';

const tool = (ed, key) => !!ed.clickTool && ed.clickTool.key === key;

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

/** Name of a kind: the one of the catalog, else the translation of the kinds the card knows, else its id. */
export const kindLabel = (prefix, id, name, t) => name(id) || (t(`${prefix}_${id}`) === `${prefix}_${id}` ? id : t(`${prefix}_${id}`));

/**
 * A grid of kinds to choose from, each shown by a picture of it over its name: `thumb(id)` gives the picture (a
 * dot of `draft(id)` stands for it when there is none), `dot` keeps that dot beside the name as well, for the
 * kinds that are told apart by their colour on the view (the sides of a fence).
 */
export function kindPicker(ids, { on, thumb, draft, label, pick, dot = false }) {
  return html`<div class="pathpick">
    ${ids.map((k) => {
      const picture = thumb(k);
      return html`<button class=${on === k ? 'on' : ''} title=${label(k)} @click=${() => pick(k)}>
        ${picture ? html`<img src=${picture} alt="" />` : html`<i class="sw big" style=${`background:${draft(k)}`}></i>`}
        <span>${dot && picture ? html`<i class="sw" style=${`background:${draft(k)}`}></i>` : nothing}${label(k)}</span>
      </button>`;
    })}
  </div>`;
}

/** A colour of the user's own over the one of a kind, with a button to go back to the kind's. */
export function colorRow(t, own, usual, set) {
  return html`<div class="row">
    <span>${t('color')}</span><input type="color" .value=${own || usual} @change=${(e) => set(e.target.value)} />
    ${own ? html`<button title=${t('color_usual')} @click=${() => set('')}>↺ ${t('color_usual')}</button>` : nothing}
  </div>`;
}

// ---------------------------------------------------------------------------- terraces

const terraceLabel = (id, t) => kindLabel('terrace', id, terraceKindName, t);
const terraceIds = (t) => Object.keys(terraceKinds()).sort((a, b) => terraceLabel(a, t).localeCompare(terraceLabel(b, t)));

export function renderTerraces(card) {
  const t = card._t;
  const ed = card._editors;
  const tt = card._terraceTools;
  const drawing = tt.draw && tool(ed, 'terrace-draw') ? tt.draw : null;
  const points = tt.pts && tool(ed, 'terrace-pts') ? tt.pts : null;
  const terrain = !!ed.cfg;
  const draw = drawing
    ? html`<div class="hint">${t(drawing.shape === 'rect' ? 'pool_draw_rect' : 'pool_draw_free')} (${drawing.pts.length})</div>
        <div class="row">
          ${
            drawing.shape === 'free'
              ? html`<button class="on" ?disabled=${drawing.pts.length < 3} @click=${() => tt.finishDraw()}>
                    ${t('finish')} (${drawing.pts.length})
                  </button>
                  <button ?disabled=${!drawing.pts.length} @click=${() => tt.undoPoint()}>${t('undo_point')}</button>`
              : nothing
          }
          <button @click=${() => tt.cancel()}>${t('cancel')}</button>
        </div>`
    : nothing;
  const shapes = (i, label) =>
    html`<div class="sub">${label}</div>
      <div class="row">
        ${['rect', 'free'].map(
          (s) =>
            html`<button
              class=${drawing && drawing.i === i && drawing.shape === s ? 'on' : ''}
              ?disabled=${!!drawing}
              @click=${() => tt.startDraw(s, i)}
            >
              ${t(`pool_shape_${s}`)}
            </button>`,
        )}
      </div>`;
  return html`
    <div class="hint">${t('terraces_hint')}</div>
    ${shapes(null, t('terrace_draw'))} ${drawing && drawing.i === null ? draw : nothing}
    ${tt.terraces.map((raw, i) => {
      const p = normalizeTerrace(raw);
      const on = tt.sel === i;
      const kind = terraceLook(p.surface);
      const P = p.pts.length >= 3 ? tt.outline(i) : [];
      const size = isRectangle(P) ? rectSize(P) : null;
      return html`<div class=${`ent ${on ? 'open' : ''}`}>
        <div @click=${() => tt.select(i)}>
          <i class="sw" style=${`background:${kind.draft}`}></i>
          <b>${p.name || `${t('terrace')} ${i + 1}`}</b>
          <span class="hint">${terraceLabel(p.surface, t)} · ${Math.round(outlineArea(P) * 10) / 10} m²</span>
        </div>
        ${
          on
            ? html`<div class="row">
                  <span>${t('name')}</span
                  ><input type="text" .value=${p.name || ''} @change=${(e) => tt.edit(i, { name: e.target.value.trim() })} />
                </div>
                <div class="sub">${t('terrace_kind')}</div>
                ${kindPicker(terraceIds(t), {
                  on: p.surface,
                  thumb: terraceThumb,
                  draft: (k) => terraceLook(k).draft,
                  label: (k) => terraceLabel(k, t),
                  pick: (k) => tt.edit(i, { surface: k }),
                })}
                ${colorRow(t, p.c, kind.surface.color, (c) => tt.edit(i, { c }))}
                <div class="grid">
                  ${terrain ? html`<span>${t('terrace_alt')}</span>${num(p.alt ?? 0, (v) => tt.edit(i, { alt: v }), 0.05)}` : nothing}
                  <span>${t('terrace_h')}</span>${num(thicknessOf(p), (v) => tt.edit(i, { h: v }), 0.01, TERRACE_H[0], TERRACE_H[1])}
                  ${terrain ? html`<span>${t('op_feather')}</span>${num(p.feather, (v) => tt.edit(i, { feather: v }), 0.1, 0, 10)}` : nothing}
                  <span>${t('terrace_rot')}</span>${num(p.rot, (v) => tt.edit(i, { rot: v }), 15, 0, 345)}
                  ${
                    size
                      ? html`<span>${t('terrace_size')}</span>
                          <span class="pair"
                            >${num(Math.round(size.l * 100) / 100, (v) => tt.resize(i, v, size.w), 0.05, 0.4)} ×
                            ${num(Math.round(size.w * 100) / 100, (v) => tt.resize(i, size.l, v), 0.05, 0.4)}</span
                          >
                          <span>${t('terrace_angle')}</span>${num(outlineAngle(P), (v) => tt.turn(i, v), 1, 0, 359)}`
                      : nothing
                  }
                </div>
                ${drawing && drawing.i === i ? draw : nothing}
                <div class="sub">${t('terrace_points')}</div>
                ${renderMove(card, `terrace:${i}`, () => tt.startMove(i))}
                <div class="row">
                  ${['add', 'del'].map(
                    (k) =>
                      html`<button
                        class=${points && points.i === i && points.tool === k ? 'on' : ''}
                        ?disabled=${!!drawing || p.pts.length < 3}
                        @click=${() => (points && points.i === i && points.tool === k ? tt.cancel() : tt.startPoints(i, k))}
                      >
                        ${t(`terrace_pt_${k}`)}
                      </button>`,
                  )}
                </div>
                ${points && points.i === i ? html`<div class="hint">${t(`terrace_hint_${points.tool}`)}</div>` : nothing}
                ${shapes(i, t('terrace_redraw'))}`
            : nothing
        }
        <div class="row">
          <button @click=${() => tt.toggleHidden(i)}>${p.hidden ? t('show') : t('hide')}</button>
          <button @click=${() => tt.remove(i)}>${t('delete')}</button>
        </div>
      </div>`;
    })}
  `;
}

// ---------------------------------------------------------------------------- facing of a low wall

const wallLabel = (id, t) => kindLabel('wall', id, wallKindName, t);

/** Facing and colour of a wall of the ground editor: `op` is the correction, `set(patch)` changes it. */
export function renderWallFacing(card, op, set) {
  const t = card._t;
  const kinds = wallKinds();
  const id = kinds[op.kind] ? op.kind : WALL_DEFAULT;
  const ids = Object.keys(kinds).sort((a, b) => wallLabel(a, t).localeCompare(wallLabel(b, t)));
  return html`<div class="sub">${t('wall_kind')}</div>
    ${kindPicker(ids, {
      on: id,
      thumb: wallThumb,
      draft: (k) => kinds[k].draft,
      label: (k) => wallLabel(k, t),
      pick: (k) => set({ kind: k }),
    })}
    ${colorRow(t, op.c, wallKind(id).surface.color, (c) => set({ c: c || undefined }))} ${renderWallCoping(t, op, wallKind(id), set)}`;
}

const copingLabel = (id, t) => kindLabel('coping', id, copingKindName, t);

/**
 * What a wall is capped with: the capping of its facing (when it has one), none, or a coping of the catalog, with a
 * colour of the user's own.
 */
function renderWallCoping(t, op, facing, set) {
  const kinds = copingKinds();
  const usual = copingOf(facing);
  // '' stands for the capping of the facing: what a wall has when it asks for nothing
  const on = op.cap === COPING_NONE || kinds[op.cap] ? op.cap : '';
  const ids = Object.keys(kinds).sort((a, b) => copingLabel(a, t).localeCompare(copingLabel(b, t)));
  const laid = wallCoping(op, facing);
  // the colour the coping has without one of the user's own
  const plain = laid ? (kinds[on] ? kinds[on].surface.color : usual.color) : '';
  return html`<div class="sub">${t('wall_coping')}</div>
    ${kindPicker(['', COPING_NONE, ...ids], {
      on,
      thumb: (k) => (kinds[k] ? copingThumb(k) : null),
      draft: (k) => (kinds[k] ? kinds[k].surface.color : k === '' && usual ? usual.color : 'transparent'),
      label: (k) => (k === '' ? t('wall_coping_own') : k === COPING_NONE ? t('wall_coping_none') : copingLabel(k, t)),
      pick: (k) => set({ cap: k || undefined }),
    })}
    ${laid ? colorRow(t, op.capc, plain, (c) => set({ capc: c || undefined })) : nothing}`;
}
