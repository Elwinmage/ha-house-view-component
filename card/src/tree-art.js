// Miniature of a tree species, seen from the side, as an SVG document — the counterpart of fishSvg for the fish of
// a pond. The species of the catalogue and the built-in ones are drawn from the same few numbers (shape, foliage,
// trunk, how wide the crown is against the height), each one filling its own box whatever its real size. No DOM,
// no three.js: unit-tested.
import { seasonOf } from './catalog-lib.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n = (v) => +v.toFixed(4);

/** Shapes drawn here; anything else falls back to a round crown. */
export const TREE_SHAPES = ['round', 'slim', 'conifer', 'column', 'weeping', 'palm', 'bush', 'hedge', 'planter'];

const CATALOG_SHAPES = { round: 'round', conical: 'conifer', columnar: 'column', weeping: 'weeping', palm: 'palm' };
const DEFAULT_FOLIAGE = '#4f9a3f';

/**
 * What a miniature needs of a species, whether it comes from the catalogue or from the built-in list:
 * { shape, foliage, trunk, w (half-width of the crown, as a share of the height), tw (half-width of the trunk),
 * t0 (where the crown starts over the ground, as a share of the height) }.
 */
export function treeArt(sp) {
  const s = sp || {};
  const cat = s.kind === 'catalog' && s.tree;
  const shape = cat ? CATALOG_SHAPES[s.tree.shape] || 'round' : TREE_SHAPES.includes(s.kind) ? s.kind : 'round';
  const summer = cat ? seasonOf(s.tree, 'summer') : null;
  const leaf = s.leaf || {};
  const foliage = (summer && summer.foliage) || leaf.all || leaf.summer || DEFAULT_FOLIAGE;
  const h = Math.max(Number(s.height) || 1, 0.2);
  // how much bare trunk there is under the crown: what tells a stone pine (an umbrella high over the ground)
  // from an oak. Only the catalogue says it; the built-in species keep the look they always had.
  const bare = cat && s.tree.trunk ? Number(s.tree.trunk.height) / h : NaN;
  return {
    shape,
    foliage,
    t0: Number.isFinite(bare) ? clamp(bare, 0.1, 0.78) : 0.36,
    trunk: s.trunk || '#6b4f3a',
    // a column may be far slimmer than any other shape: a cypress must not come out as wide as a yew
    w: clamp((Number(s.crown) || h * 0.3) / h, shape === 'column' ? 0.07 : 0.14, 0.46),
    tw: clamp((Number(s.trunkR) || h * 0.03) / h, 0.012, 0.09),
  };
}

const ell = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${extra}/>`;
const poly = (pts, fill) => `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${fill}"/>`;

/** Trunk as a trapezoid, wider at the foot, from the ground up to `top`. */
const stem = (a, top, k = 0.65) =>
  poly(
    [
      [-a.tw, 0],
      [a.tw, 0],
      [a.tw * k, top],
      [-a.tw * k, top],
    ],
    a.trunk,
  );

/** The parts of a crown, by shape. The ground is y = 0 and the top of the tree y = 1. */
function crown(a) {
  const { w, foliage } = a;
  switch (a.shape) {
    case 'slim':
      return stem(a, 0.5) + ell(0, 0.63, w * 0.66, 0.37, foliage);
    case 'conifer': {
      // three tiers, each one narrower and shorter than the one under it
      const tiers = [
        [0.16, 0.62, 1],
        [0.42, 0.85, 0.78],
        [0.66, 1, 0.52],
      ];
      return (
        stem(a, 0.24) +
        tiers.map(([base, top, k]) => poly([[-w * k, base], [w * k, base], [0, top]], foliage)).join('') // prettier-ignore
      );
    }
    case 'column': {
      // a yew, a cypress: a tall column of foliage down to the ground, rounded off at the top — not a cone
      const x = Math.min(w, 0.3);
      return (
        stem(a, 0.2) +
        `<path d="M${n(-x)} 0.03 L${n(-x)} 0.6 Q${n(-x * 0.96)} 0.88 0 1 Q${n(x * 0.96)} 0.88 ${n(x)} 0.6 L${n(x)} 0.03 Z" fill="${foliage}"/>`
      );
    }
    case 'weeping': {
      // a dome, and the branches hanging from under its edge, longer in the middle of each side
      const hang = [-0.88, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.88].map((u) => {
        const x = u * w * 0.9;
        const y0 = 0.74 - 0.18 * Math.sqrt(Math.max(0, 1 - u * u)); // leaves the dome at its lower edge
        // the curtain tapers: the middle branches reach the ground, the outer ones stop high up
        const yEnd = 0.14 + 0.45 * u * u;
        return `<path d="M${n(x)} ${n(y0)} Q${n(x * 1.18)} ${n((y0 + yEnd) / 2)} ${n(x * 1.02)} ${n(yEnd)}" stroke="${foliage}" stroke-width="${n(Math.min(w * 0.19, 0.06))}" fill="none" stroke-linecap="round"/>`;
      });
      return stem(a, 0.5) + hang.join('') + ell(0, 0.78, w * 0.9, 0.22, foliage);
    }
    case 'palm': {
      // fronds sprayed from the top of the trunk, each one arching up and drooping at its tip
      const top = 0.66;
      const R = Math.max(w, 0.28);
      const frond = (deg) => {
        const t = (deg * Math.PI) / 180;
        const [cx, cy] = [Math.cos(t), Math.sin(t)];
        const mid = [cx * R * 0.55, top + cy * R * 0.55 + 0.07];
        const tip = [cx * R, top + cy * R - 0.11];
        return `<path d="M0 ${n(top)} Q${n(mid[0])} ${n(mid[1])} ${n(tip[0])} ${n(tip[1])}" stroke="${foliage}" stroke-width="${n(R * 0.2)}" fill="none" stroke-linecap="round"/>`;
      };
      return stem(a, top, 0.8) + [12, 48, 90, 132, 168].map(frond).join('') + ell(0, top, R * 0.13, R * 0.13, a.trunk);
    }
    case 'bush':
      return ell(0, 0.34, w, 0.34, foliage) + ell(-w * 0.52, 0.52, w * 0.54, 0.3, foliage) + ell(w * 0.5, 0.5, w * 0.5, 0.28, foliage);
    case 'hedge': {
      const r = Math.min(w * 0.35, 0.12);
      return `<rect x="${n(-w)}" y="0" width="${n(2 * w)}" height="1" rx="${n(r)}" fill="${foliage}"/>`;
    }
    case 'planter': {
      // a box with a few tufts over it, rather than one dome, so it does not read as a tree
      const pot = 0.34;
      const tufts = [-0.72, -0.26, 0.26, 0.72].map((u) => ell(u * w * 0.85, 0.52 + (1 - u * u) * 0.14, w * 0.42, w * 0.46, foliage));
      return (
        poly(
          [
            [-w * 0.72, 0],
            [w * 0.72, 0],
            [w * 0.82, pot],
            [-w * 0.82, pot],
          ],
          a.trunk,
        ) +
        tufts.join('') +
        ell(0, 0.56, w * 0.56, w * 0.58, foliage)
      );
    }
    default: {
      // a round crown filling what is over the bare trunk: one dome and two lobes, so it does not read as a
      // plain circle. A high trunk and a wide crown then draw the umbrella of a stone pine by themselves.
      const cy = (a.t0 + 1) / 2;
      const ry = (1 - a.t0) / 2;
      return (
        stem(a, cy - ry * 0.5) +
        ell(-w * 0.5, cy - ry * 0.31, w * 0.62, ry * 0.81, foliage) +
        ell(w * 0.5, cy - ry * 0.31, w * 0.62, ry * 0.81, foliage) +
        ell(0, cy, w * 0.86, ry, foliage)
      );
    }
  }
}

/**
 * Miniature of a species seen from the side, as an SVG document: the trunk and the crown in the colours of the
 * species, the whole tree filling the box whatever its real height. For the lists of the editor.
 */
export function treeSvg(sp) {
  const a = treeArt(sp);
  // the box holds the widest part, never narrower than half the height, so a hedge and a birch both fit; the
  // fronds of a palm reach further than its crown
  const half = a.shape === 'palm' ? Math.max(a.w * 1.35, 0.38) : Math.max(a.w * 1.35, 0.26);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(-half)} 0 ${n(2 * half)} 1.04">` +
    `<g transform="translate(0 1.02) scale(1 -1)">${crown(a)}</g>` +
    `</svg>`
  );
}

/** The miniature of a species as an image address (data URL), for an <img>. */
export const treeThumb = (sp) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(treeSvg(sp))}`;
