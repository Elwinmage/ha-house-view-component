// Manual corrections kept apart from the plan (.sh3d) and the terrain (.json), so that re-importing
// either of them keeps what was fixed by hand. Exported / imported as a small JSON file.

export function emptyEdits() {
  return {
    version: 1,
    registration: {}, // plan <-> terrain registration: { base, rot, dx, dz, northOffsetDeg, showMns, showVec, showTrees }
    views: [], // optional user-defined camera views (replace the automatic ones when not empty)
    outdoor: {}, // id -> { dx, dz, dy, rot, hidden }   (detached objects: shed, gate, ...)
    terrain: [], // ground corrections: walls / terraces / brushes, see terrain-edit.js
    pool: { dy: 0 }, // vertical offset of the pool (basin, water, coping) from the ground
    trees: {
      removed: { dsm: [], sd: [] }, // dsm: [gx, gz] in the terrain grid frame ; sd: index in the plan vegetation
      added: [], // { species, at: [x, z] in plan frame, h }
    },
  };
}

export function normalizeEdits(raw) {
  const e = emptyEdits();
  if (!raw || typeof raw !== 'object') return e;
  if (raw.outdoor && typeof raw.outdoor === 'object') e.outdoor = raw.outdoor;
  if (raw.registration && typeof raw.registration === 'object') e.registration = raw.registration;
  if (Array.isArray(raw.views)) e.views = raw.views;
  if (Array.isArray(raw.terrain)) e.terrain = raw.terrain;
  if (raw.pool && Number.isFinite(raw.pool.dy)) e.pool.dy = raw.pool.dy;
  const t = raw.trees || {};
  if (t.removed) {
    e.trees.removed.dsm = Array.isArray(t.removed.dsm) ? t.removed.dsm : [];
    e.trees.removed.sd = Array.isArray(t.removed.sd) ? t.removed.sd : [];
  }
  e.trees.added = Array.isArray(t.added) ? t.added : [];
  return e;
}

/** Effective edit of one outdoor object (defaults filled in). */
export function outdoorEdit(edits, id) {
  return { dx: 0, dz: 0, dy: 0, rot: 0, hidden: false, ...(edits.outdoor[id] || {}) };
}

/** True when a DSM tree at grid position (gx, gz) was removed (2 m tolerance: peaks move a little between fetches). */
export function isDsmRemoved(edits, gx, gz) {
  return edits.trees.removed.dsm.some(([x, z]) => Math.hypot(x - gx, z - gz) < 2);
}
