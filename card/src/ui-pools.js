// Editor of the pools and ponds drawn from the top: outline (rectangle from two corners, or free), kind, colour,
// depth and the binary_sensor of the cleaning robot. The ground is dug when the world is rebuilt.
import { html, nothing } from 'lit';
import { POOL_KINDS, newPool, rectFromCorners, poolValid } from './pools.js';

const uid = () => `pool${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Draw state of the card: { id, shape, pts (store frame), hover (plan point) } while drawing an outline. */
function drawTool(card, pool) {
  const ed = card._editors;
  const D = (card._poolDraw = { id: pool.id, shape: pool.shape, pts: [], hover: null });
  const finish = () => {
    pool.pts = D.pts;
    pool.frame = ed.frame;
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
      D.pts.push(ed.toStore(hit.point.x, hit.point.z));
      if (D.shape === 'rect' && D.pts.length === 2) {
        D.pts = rectFromCorners(D.pts[0], D.pts[1]);
        return finish();
      }
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
            class=${D && D.shape === s ? 'on' : ''}
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
