// Editor of the pools and ponds drawn from the top: outline (rectangle from two corners, or free), kind, colour,
// depth, the entity of the cleaning robot, the lamps of the water, the roller cover and, for a pond, its islands.
// The ground is dug when the world is rebuilt (an island keeps its ground, a little above the water).
import { html, nothing } from 'lit';
import {
  POOL_KINDS,
  ROBOT_DOMAINS,
  LAMP_DOMAINS,
  COVER_DOMAINS,
  newPool,
  newLamp,
  newCover,
  rectFromCorners,
  poolValid,
  sideFrame,
  nearestSide,
} from './pools.js';
import { CUSTOM_PATTERNS, MAX_GROUP, fishThumb, groupVariety } from './fish.js';
import { localName } from './catalog-lib.js';

const uid = () => `pool${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const lampId = () => `lamp${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/**
 * Draw state of the card: { id, shape, pts (store frame), hover (plan point), island } while drawing an outline.
 * Without `island`: the outline of the pool. With `island` = 'rect' | 'free': a new island of the pond.
 */
function drawTool(card, pool, island = null) {
  const ed = card._editors;
  const D = (card._poolDraw = { id: pool.id, shape: island || pool.shape, pts: [], hover: null, island: !!island });
  const finish = () => {
    if (island) {
      const it = { shape: island, pts: D.pts, frame: ed.frame };
      if (poolValid(it)) (pool.islands = pool.islands || []).push(it);
    } else {
      pool.pts = D.pts;
      pool.frame = ed.frame;
    }
    card._poolDraw = null;
    ed.setClickTool(null);
    ed.commit();
    card.requestUpdate();
  };
  ed.setClickTool({
    key: 'pool-draw',
    hover: (hit) => {
      D.hover = hit && hit.point ? [hit.point.x, hit.point.z] : null;
      ed.drawDraft();
    },
    leave: () => {
      if (card._poolDraw === D) card._poolDraw = null;
    },
    draft: (d) => {
      const toPlan = ed.toPlan({ frame: ed.frame });
      const P = D.pts.map(([x, z]) => toPlan(x, z));
      if (D.shape === 'rect' && P.length === 1 && D.hover) {
        const r = rectFromCorners(P[0], D.hover);
        d.ribbon([...r, r[0]], '#29d3e8', 0.12);
      } else if (P.length) d.ribbon(D.hover ? [...P, D.hover] : P, '#29d3e8', 0.12);
      for (const [x, z] of P) d.dot(x, z, '#ffffff');
    },
    click: (hit) => {
      if (D.shape === 'rect' && D.pts.length === 1) {
        // the rectangle is the one of the preview, square with the plan: its corners are stored one by one (the
        // stored frame, the one of the terrain grid, is turned against the plan)
        const first = ed.toPlan({ frame: ed.frame })(...D.pts[0]);
        D.pts = rectFromCorners(first, [hit.point.x, hit.point.z]).map(([x, z]) => ed.toStore(x, z));
        return finish();
      }
      D.pts.push(ed.toStore(hit.point.x, hit.point.z));
      ed.drawDraft();
      card.requestUpdate();
    },
  });
  D.finish = finish;
  card.requestUpdate();
}

/** Outline of the selected pool on the ground (editor overlay). */
function outlineTool(card, pool) {
  const ed = card._editors;
  if (!pool || card._poolDraw || !poolValid(pool)) return;
  if (ed.clickTool && ed.clickTool.key !== 'pool-sel') return;
  if (ed.clickTool && ed.clickTool.pool === pool) return;
  const picking = () => (card._poolSide && card._poolSide.pool === pool.id ? card._poolSide : null);
  ed.setClickTool({
    key: 'pool-sel',
    pool,
    click: (hit, ev) => {
      const S = picking();
      if (S && hit && hit.point) {
        const toPlan = ed.toPlan(pool);
        S.set(nearestSide(pool.pts.map(([x, z]) => toPlan(x, z)), hit.point.x, hit.point.z)); // prettier-ignore
        card._poolSide = null;
        ed.drawDraft();
        card.requestUpdate();
        return;
      }
      // while a pool is open its editor takes every click of the view: a lamp, a cover or another pool clicked
      // there opens the matching part of the editor
      const part = card._engine ? card._engine.pickPoolPart(ev) : null;
      if (part) card._poolPick(part.pool, part.lamp ? `lamp:${part.lamp}` : part.cover ? 'cover' : null);
    },
    draft: (d) => {
      const toPlan = ed.toPlan(pool);
      const P = pool.pts.map(([x, z]) => toPlan(x, z));
      const S = picking();
      if (!S) return d.ribbon([...P, P[0]], pool.color || '#29d3e8', 0.15);
      // choosing a side: each one drawn on its own, the one in use lit up, a dot in its middle
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const on = i === (S.side || 0);
        d.ribbon([a, b], on ? '#ffe14d' : '#7b8a95', on ? 0.3 : 0.12);
        d.dot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, on ? '#ffe14d' : '#ffffff');
      }
    },
  });
}

export function renderPools(card) {
  const t = card._t;
  const ed = card._editors;
  if (!ed || !card._data) return nothing;
  const list = card._data.edits.pools;
  const sel = list.find((p) => p.id === card._poolSel) || null;
  if (sel) outlineTool(card, sel);
  const add = (kind) => {
    const p = newPool(kind, uid());
    list.push(p);
    card._poolSel = p.id;
    card._edited(true);
    drawTool(card, p);
  };
  return html`<div class="hint">${t('pools_hint')}</div>
    <div class="row">
      <button @click=${() => add('pool')}>＋ ${t('pool_pool')}</button>
      <button @click=${() => add('pond')}>＋ ${t('pool_pond')}</button>
    </div>
    ${list.map(
      (p) =>
        html`<button
          class=${`row-btn ${card._poolSel === p.id ? 'on' : ''}`}
          @click=${() => {
            card._poolSel = card._poolSel === p.id ? null : p.id;
            if (!card._poolSel && ed.clickTool && ed.clickTool.key === 'pool-sel') ed.setClickTool(null);
            card.requestUpdate();
          }}
        >
          <ha-icon .icon=${p.kind === 'pond' ? 'mdi:fishbowl-outline' : 'mdi:pool'}></ha-icon>
          <span>${p.name || t(`pool_${p.kind}`)}</span>
          <span class="swatch" style=${`background:${p.color}`}></span>
          ${poolValid(p) ? nothing : html`<span class="badge">!</span>`}
        </button>`,
    )}
    ${
      sel
        ? card._asWindow(sel.name || t(`pool_${sel.kind}`), renderPoolEditor(card, sel), () => {
            card._poolSel = null;
            card._poolSide = null;
            card._poolPart = null;
            card._poolDemoStop();
            if (ed.clickTool && (ed.clickTool.key === 'pool-sel' || ed.clickTool.key === 'pool-draw')) ed.setClickTool(null);
            card._poolDraw = null;
          })
        : nothing
    }`;
}

function renderPoolEditor(card, p) {
  const t = card._t;
  const ed = card._editors;
  const list = card._data.edits.pools;
  const commit = () => {
    card._edited(true);
    ed.commit();
    card._pushPools();
    card.requestUpdate();
  };
  const D = card._poolDraw && card._poolDraw.id === p.id ? card._poolDraw : null;
  return html`<label
      >${t('pool_name')}
      <input
        .value=${p.name || ''}
        @change=${(e) => {
          p.name = e.target.value.trim() || undefined;
          card._edited(true);
          card.requestUpdate();
        }}
    /></label>
    <label
      >${t('pool_kind')}
      <select
        @change=${(e) => {
          p.kind = e.target.value;
          commit();
        }}
      >
        ${Object.keys(POOL_KINDS).map((k) => html`<option value=${k} ?selected=${p.kind === k}>${t(`pool_${k}`)}</option>`)}
      </select></label
    >
    <div class="sub">${t('pool_outline')}</div>
    <div class="row">
      ${['rect', 'free'].map(
        (s) =>
          html`<button
            class=${(D && !D.island ? D.shape : p.shape || 'rect') === s ? 'on' : ''}
            @click=${() => {
              p.shape = s;
              drawTool(card, p);
            }}
          >
            ${t(`pool_shape_${s}`)}
          </button>`,
      )}
    </div>
    ${
      D
        ? html`<div class="hint">${t(D.shape === 'rect' ? 'pool_draw_rect' : 'pool_draw_free')} (${D.pts.length})</div>
            ${
              D.shape === 'free'
                ? html`<div class="row">
                    <button
                      ?disabled=${!D.pts.length}
                      @click=${() => {
                        D.pts.pop();
                        ed.drawDraft();
                        card.requestUpdate();
                      }}
                    >
                      ${t('pool_undo')}
                    </button>
                    <button ?disabled=${D.pts.length < 3} @click=${() => D.finish()}>${t('pool_finish')}</button>
                  </div>`
                : nothing
            }`
        : poolValid(p)
          ? nothing
          : html`<div class="hint">${t('pool_no_outline')}</div>`
    }
    ${
      p.kind === 'pond'
        ? html`<div class="sub">${t('pool_islands')}</div>
            <div class="row">
              ${['rect', 'free'].map(
                (s) =>
                  html`<button
                    class=${D && D.island && D.shape === s ? 'on' : ''}
                    ?disabled=${!poolValid(p)}
                    @click=${() => drawTool(card, p, s)}
                  >
                    ＋ ${t('pool_island')} (${t(`pool_shape_${s}`)})
                  </button>`,
              )}
            </div>
            ${(p.islands || []).map(
              (isl, i) =>
                html`<div class="row">
                  <span class="grow">${t('pool_island')} ${i + 1}</span>
                  <button
                    title=${t('delete')}
                    @click=${() => {
                      p.islands.splice(i, 1);
                      commit();
                    }}
                  >
                    🗑
                  </button>
                </div>`,
            )}
            <div class="hint">${t('pool_islands_hint')}</div>`
        : nothing
    }
    ${p.kind === 'pond' ? renderFishGroups(card, p, commit) : nothing}
    <label
      >${t('pool_color')}
      <input
        type="color"
        .value=${p.color || POOL_KINDS[p.kind].color}
        @change=${(e) => {
          p.color = e.target.value;
          commit();
        }}
    /></label>
    <label
      >${t('pool_depth')}
      <input
        type="number"
        min="0.2"
        max="6"
        step="0.1"
        .value=${String(p.depth)}
        @change=${(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) p.depth = Math.max(0.2, Math.min(6, v));
          commit();
        }}
    /></label>
    <div class="sub">${t('pool_robot')}</div>
    ${card._entityInput(
      p.robot || '',
      (v) => {
        p.robot = v;
        commit();
      },
      ROBOT_DOMAINS,
      '',
    )}
    <div class="hint">${t('pool_robot_hint')}</div>
    ${renderLamps(card, p, commit)} ${p.kind === 'pond' ? nothing : renderCover(card, p, commit)}
    <button
      class="danger"
      @click=${() => {
        list.splice(list.indexOf(p), 1);
        card._poolSel = null;
        card._poolDraw = null;
        ed.setClickTool(null);
        commit();
      }}
    >
      ${t('delete')}
    </button>`;
}

/** Sides of the outline, to choose where a lamp or the cover sits: [{ i, label }] (nothing without an outline). */
function sideOptions(p, t) {
  const pts = poolValid(p) ? p.pts : [];
  return pts.map((_, i) => ({
    i,
    label: t('pool_side_n')
      .replace('{n}', String(i + 1))
      .replace('{len}', sideFrame(pts, i).len.toFixed(1)),
  }));
}

/**
 * A side of the outline, chosen in a list — the sides are numbered as they were drawn, with their length — or
 * pointed at in the view: 🎯 lights the sides on the ground, and the next click takes the nearest one.
 */
function sideSelect(card, pool, key, sides, value, onPick) {
  const t = card._t;
  const S = card._poolSide && card._poolSide.pool === pool.id && card._poolSide.key === key ? card._poolSide : null;
  if (S) {
    S.set = onPick; // the list is rebuilt at each render: the view answers to the latest one
    S.side = value || 0;
  }
  return html`<div class="row">
    <label class="grow"
      >${t('pool_side')}
      <select @change=${(e) => onPick(Number(e.target.value))}>
        ${sides.map((s) => html`<option value=${s.i} ?selected=${(value || 0) === s.i}>${s.label}</option>`)}
      </select></label
    >
    <button
      class=${S ? 'on' : ''}
      title=${t('pool_side_pick')}
      ?disabled=${!sides.length}
      @click=${() => {
        card._poolSide = S ? null : { pool: pool.id, key, set: onPick, side: value || 0 };
        if (card._editors) card._editors.drawDraft();
        card.requestUpdate();
      }}
    >
      🎯
    </button>
  </div>`;
}

/**
 * Lamps of the water: each one is a projector sunk in the wall of a side of the outline, linked to a `light` (its
 * colour is taken from the entity) or to anything that switches on (the colour chosen here is then used). The
 * colour of the lamps that are on tints the water and the basin.
 */
function renderLamps(card, p, commit) {
  const t = card._t;
  const sides = sideOptions(p, t);
  const list = (p.lights = p.lights || []);
  const maxDepth = Math.max(0.2, (p.depth || 1.5) - 0.15);
  return html`<div class="sub">${t('pool_lamps')}</div>
    ${list.map((l, i) => {
      const set = (patch) => {
        Object.assign(l, patch);
        commit();
      };
      const seen = card._poolPart === `lamp:${l.id}`;
      return html`<div class="bbox" style=${seen ? 'outline:2px solid var(--primary-color);outline-offset:2px' : ''}>
        <div class="row">
          <span class="grow">${t('pool_lamp')} ${i + 1}</span>
          <label class="bnum"
            >${t('pool_lamp_color')}<input type="color" .value=${l.color || '#49e0ff'} @change=${(e) => set({ color: e.target.value })}
          /></label>
          <button
            class=${card._poolTest && card._poolTest.id === p.id && card._poolTest.lamps.has(l.id) ? 'on' : ''}
            title=${t('pool_test')}
            @click=${() => card._poolDemo(p.id, 'lamp', l.id)}
          >
            💡
          </button>
          <button
            title=${t('delete')}
            @click=${() => {
              list.splice(i, 1);
              card._poolDemoStop();
              commit();
            }}
          >
            🗑
          </button>
        </div>
        ${card._entityInput(l.entity || '', (v) => set({ entity: v }), LAMP_DOMAINS, '')}
        ${sideSelect(card, p, `lamp:${l.id}`, sides, l.side, (v) => set({ side: v }))}
        ${card._range(
          t('pool_lamp_pos'),
          l.t ?? 0.5,
          0,
          1,
          0.02,
          (v) => set({ t: v }),
          (v) => `${Math.round(v * 100)} %`,
        )}
        ${card._range(
          t('pool_lamp_depth'),
          Math.min(l.depth ?? 0.6, maxDepth),
          0.1,
          maxDepth,
          0.05,
          (v) => set({ depth: v }),
          (v) => `${v.toFixed(2)} m`,
        )}
      </div>`;
    })}
    <button
      ?disabled=${!poolValid(p)}
      @click=${() => {
        list.push(newLamp(lampId()));
        commit();
      }}
    >
      ＋ ${t('pool_lamp')}
    </button>
    <div class="hint">${t('pool_lamps_hint')}</div>`;
}

/**
 * Roller cover: a sheet of slats that unrolls over the water from one side of the outline. A `cover` entity gives
 * its position, any other entity only says open or closed (`on` taken as closed, which *Swap* turns around). A
 * click on the sheet in the view opens or closes it.
 */
function renderCover(card, p, commit) {
  const t = card._t;
  const sides = sideOptions(p, t);
  const c = p.cover || null;
  const set = (patch) => {
    p.cover = { ...newCover(), ...c, ...patch };
    commit();
  };
  return html`<div class="sub" style=${card._poolPart === 'cover' ? 'outline:2px solid var(--primary-color)' : ''}>${t('pool_cover')}</div>
    ${
      c
        ? html`${card._entityInput(c.entity || '', (v) => set({ entity: v }), COVER_DOMAINS, '')}
            ${sideSelect(card, p, 'cover', sides, c.side, (v) => set({ side: v }))}
            <div class="row">
              <label class="bnum"
                >${t('pool_cover_color')}<input
                  type="color"
                  .value=${c.color || '#dfe4e8'}
                  @change=${(e) => set({ color: e.target.value })}
              /></label>
              <label class="chk"
                ><input type="checkbox" .checked=${!!c.invert} @change=${(e) => set({ invert: e.target.checked })} />
                ${t('pool_cover_invert')}</label
              >
            </div>
            <label
              >${t('pool_cover_roller')}
              <select @change=${(e) => set({ roller: e.target.value })}>
                ${['deck', 'water'].map(
                  (k) => html`<option value=${k} ?selected=${(c.roller || 'deck') === k}>${t(`pool_cover_roller_${k}`)}</option>`,
                )}
              </select></label
            >
            <div class="row">
              <button
                class=${card._poolTest && card._poolTest.id === p.id && card._poolTest.cover !== null ? 'on' : ''}
                @click=${() => card._poolDemo(p.id, 'cover')}
              >
                ▶ ${t('pool_test')}
              </button>
              <button
                @click=${() => {
                  card._poolDemoStop();
                  p.cover = undefined;
                  commit();
                }}
              >
                ${t('delete')}
              </button>
            </div>`
        : html`<button ?disabled=${!poolValid(p)} @click=${() => set({})}>＋ ${t('pool_cover')}</button>`
    }
    <div class="hint">${t('pool_cover_hint')}</div>`;
}

/**
 * Fish of a pond: groups of a fish of the catalog, of one variety (or of colours of one's own), with a count and a
 * size. Each fish of a group gets a robe of its own.
 */
function renderFishGroups(card, p, commit) {
  const t = card._t;
  const lang = (card._hass && card._hass.language) || 'en';
  const catalog = (card._catalog && card._catalog.pond_fish) || {};
  const ids = Object.keys(catalog).sort();
  const groups = (p.fish = p.fish || []);
  const add = () => {
    const species = ids[0];
    const first = catalog[species].varieties[0];
    groups.push({ id: `f${Date.now().toString(36)}`, species, variety: first.id, count: 3 });
    commit();
  };
  return html`<div class="sub">${t('fish')}</div>
    ${groups.map((g, i) => {
      const fish = catalog[g.species];
      const set = (patch) => {
        Object.assign(g, patch);
        commit();
      };
      return html`<div class="bbox">
        <div class="row">
          <select @change=${(e) => set({ species: e.target.value, variety: catalog[e.target.value].varieties[0].id })}>
            ${ids.map((id) => html`<option value=${id} ?selected=${id === g.species}>${localName(catalog[id].name, lang, id)}</option>`)}
            ${fish ? nothing : html`<option selected>${g.species} ?</option>`}
          </select>
          <input
            type="number"
            min="1"
            max=${MAX_GROUP}
            step="1"
            title=${t('fish_count')}
            style="width:56px"
            .value=${String(g.count)}
            @change=${(e) => set({ count: Math.min(Math.max(Math.round(Number(e.target.value) || 1), 1), MAX_GROUP) })}
          />
          <button
            title=${t('delete')}
            @click=${() => {
              groups.splice(i, 1);
              commit();
            }}
          >
            🗑
          </button>
        </div>
        ${
          fish
            ? html`<div class="fishpick">
                ${[...fish.varieties, groupVariety({ ...g, variety: 'custom', patch: g.patch || '#d3301f' }, fish)].map((v) => {
                  const name = v.id === 'custom' ? t('fish_custom') : localName(v.name, lang, v.id);
                  return html`<button
                    class=${v.id === g.variety ? 'on' : ''}
                    title=${name}
                    @click=${() => set(v.id === 'custom' ? { variety: 'custom', patch: g.patch || '#d3301f' } : { variety: v.id })}
                  >
                    <img src=${fishThumb(v, fish.body)} alt="" />
                    <span>${name.replace(/\s*\(.*\)\s*$/, '')}</span>
                  </button>`;
                })}
              </div>`
            : nothing
        }
        ${
          g.variety === 'custom'
            ? html`<div class="row">
                  <label class="bnum"
                    >${t('fish_base')}<input type="color" .value=${g.base || '#f6f2ea'} @change=${(e) => set({ base: e.target.value })}
                  /></label>
                  <label class="bnum"
                    >${t('fish_patch')}<input type="color" .value=${g.patch || '#d3301f'} @change=${(e) => set({ patch: e.target.value })}
                  /></label>
                </div>
                <div class="row">
                  <select @change=${(e) => set({ pattern: e.target.value, patch: g.patch || '#d3301f' })}>
                    ${Object.keys(CUSTOM_PATTERNS).map(
                      (k) => html`<option value=${k} ?selected=${(g.pattern || 'large') === k}>${t(`fish_pattern_${k}`)}</option>`,
                    )}
                  </select>
                  <label class="chk"
                    ><input type="checkbox" .checked=${!!g.metallic} @change=${(e) => set({ metallic: e.target.checked })} />
                    ${t('fish_metallic')}</label
                  >
                </div>`
            : nothing
        }
        ${
          fish
            ? html`<label class="bnum"
                >${t('fish_length')}<input
                  type="number"
                  min=${fish.length.min}
                  max=${fish.length.max}
                  step="0.05"
                  .value=${String(g.length || fish.length.default)}
                  @change=${(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) set({ length: Math.min(Math.max(v, fish.length.min), fish.length.max) });
                  }}
              /></label>`
            : html`<div class="hint">${t('fish_unknown')}</div>`
        }
      </div>`;
    })}
    ${ids.length ? html`<button @click=${add}>＋ ${t('fish_add')}</button>` : html`<div class="hint">${t('fish_none')}</div>`}
    <div class="hint">${t('fish_hint')}</div>`;
}
