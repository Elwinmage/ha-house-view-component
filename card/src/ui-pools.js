// Editor of the pools and ponds drawn from the top: outline (rectangle from two corners, or free), kind, colour,
// depth, the binary_sensor of the cleaning robot and, for a pond, its islands. The ground is dug when the world is
// rebuilt (an island keeps its ground, a little above the water).
import { html, nothing } from 'lit';
import { POOL_KINDS, newPool, rectFromCorners, poolValid } from './pools.js';
import { CUSTOM_PATTERNS, MAX_GROUP } from './fish.js';
import { localName } from './catalog-lib.js';

const uid = () => `pool${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

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
  ed.setClickTool({
    key: 'pool-sel',
    pool,
    click: () => {},
    draft: (d) => {
      const toPlan = ed.toPlan(pool);
      const P = pool.pts.map(([x, z]) => toPlan(x, z));
      d.ribbon([...P, P[0]], pool.color || '#29d3e8', 0.15);
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
      ['binary_sensor', 'switch', 'input_boolean', 'vacuum'],
      '',
    )}
    <div class="hint">${t('pool_robot_hint')}</div>
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
            ? html`<select @change=${(e) => set({ variety: e.target.value })}>
                ${fish.varieties.map(
                  (v) => html`<option value=${v.id} ?selected=${v.id === g.variety}>${localName(v.name, lang, v.id)}</option>`,
                )}
                <option value="custom" ?selected=${g.variety === 'custom'}>${t('fish_custom')}</option>
              </select>`
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
