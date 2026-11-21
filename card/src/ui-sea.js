// Editor of the sea (or any wide water: lagoon, river, canal): water level, beach, waves, tide, clarity, sound.
import { html, nothing } from 'lit';
import { BEACHES, normalizeSea } from './engine/sea-3d.js';

/** Altitudes (m) of the terrain grid: lowest point and the ground of the house, to help choosing the water level. */
export function terrainRange(terrain) {
  if (!terrain || !Array.isArray(terrain.z) || !terrain.z.length) return null;
  let lo = Infinity;
  for (const v of terrain.z) if (v < lo) lo = v;
  const c = terrain.center;
  let house = null;
  if (c && terrain.step) {
    const i = Math.round((c[0] - terrain.origin[0]) / terrain.step);
    const j = Math.round((c[1] - terrain.origin[1]) / terrain.step);
    const v = terrain.z[j * terrain.nx + i];
    house = Number.isFinite(v) ? v : null;
  }
  return { low: lo, house };
}

/** `YYYY-MM-DDTHH:mm` (local time) of an epoch, for a datetime-local input. */
export const toLocalInput = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export function renderSea(card) {
  const t = card._t;
  const ed = card._editors;
  if (!ed || !card._data) return nothing;
  const edits = card._data.edits;
  const sea = edits.sea || normalizeSea({ on: false });
  const range = terrainRange(card._data.terrain);
  // a change that rebuilds the water (level, beach, clarity, sound, on/off), or only moves it (waves, tide)
  const set = (patch, rebuild = true) => {
    edits.sea = normalizeSea({ ...sea, ...patch });
    card._edited(true);
    if (rebuild) ed.commit();
    card.requestUpdate();
  };
  return html`<div class="hint">${t('sea_hint')}</div>
    <label class="chk"><input type="checkbox" .checked=${sea.on} @change=${(e) => set({ on: e.target.checked })} /> ${t('sea_on')}</label>
    ${
      sea.on
        ? html`${
              range
                ? html`<div class="hint">
                    ${t('sea_range')
                      .replace('{low}', range.low.toFixed(1))
                      .replace('{house}', range.house === null ? '?' : range.house.toFixed(1))}
                  </div>`
                : nothing
            }
            <label
              >${t('sea_level')}
              <input type="number" step="0.1" .value=${String(sea.level)} @change=${(e) => set({ level: parseFloat(e.target.value) })} />
            </label>
            <label
              >${t('sea_beach')}
              <select @change=${(e) => set({ beach: e.target.value })}>
                ${BEACHES.map((b) => html`<option value=${b} ?selected=${b === sea.beach}>${t(`sea_beach_${b}`)}</option>`)}
              </select>
            </label>
            ${card._range(
              t('sea_waves'),
              sea.waves,
              0,
              1,
              0.05,
              (v) => set({ waves: v }, false),
              (v) => `${Math.round(v * 100)} %`,
              true,
            )}
            ${card._range(
              t('sea_tide'),
              sea.tide,
              0,
              6,
              0.1,
              (v) => set({ tide: v }, false),
              (v) => (v ? `${v.toFixed(1)} m` : t('sea_no_tide')),
              true,
            )}
            ${
              sea.tide
                ? html`<label
                      >${t('sea_tide_ref')}
                      <input
                        type="datetime-local"
                        .value=${sea.tideRef ? toLocalInput(sea.tideRef) : ''}
                        @change=${(e) => set({ tideRef: e.target.value ? new Date(e.target.value).getTime() : null }, false)}
                      />
                    </label>
                    <div class="hint">${t('sea_tide_hint')}</div>`
                : nothing
            }
            ${card._range(
              t('sea_clarity'),
              sea.clarity,
              0,
              1,
              0.05,
              (v) => set({ clarity: v }),
              (v) => `${Math.round(v * 100)} %`,
            )}
            <label class="chk"
              ><input type="checkbox" .checked=${sea.sound} @change=${(e) => set({ sound: e.target.checked })} /> ${t('sea_sound')}</label
            >
            <div class="hint">${t('sea_sound_hint')}</div>`
        : nothing
    }`;
}
