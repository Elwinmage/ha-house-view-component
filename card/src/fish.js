// Fish of the ponds: the groups chosen in the editor (a fish of the house catalog, a variety or colours of one's
// own, a count, a size) become fish with a robe of their own; how they wander in the water. Pure helpers, no
// three / HA knowledge: the drawing is in engine/fish-3d.js, the format in house-catalog doc/format.md.
import { inPolygon, nearestOnOutline } from './pools.js';

/** Patches of each size drawn for a layer (their total area follows `amount`): same as the catalog's previews. */
export const PATCH_COUNT = { small: 12, medium: 5, large: 2 };
/** Part of the body, from the root of the tail (0) to the snout (1), the patches of a layer go to. */
export const PATCH_SPAN = { anywhere: [0.06, 0.94], back: [0.12, 0.76], head: [0.8, 0.9] };
/** Patterns of a fish of one's own colours: the layer of patches over its body. */
export const CUSTOM_PATTERNS = {
  none: null,
  large: { amount: 0.45, size: 'large' },
  medium: { amount: 0.35, size: 'medium' },
  spots: { amount: 0.18, size: 'small' },
};
/** Largest number of fish in one group, and in a pond. */
export const MAX_GROUP = 30;
export const MAX_POND = 60;

/** Random numbers in [0, 1) from a seed: the same seed, the same robe. */
export function seeded(seed) {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Half width of the body seen from above, as a share of its widest point; `u` from the root of the tail (0) to the
 * snout (1). Same profile as the catalog's previews.
 */
export function bodyHalfwidth(u) {
  const v = Math.min(Math.max(u, 0), 1);
  if (v < 0.62) return 0.28 + 0.72 * Math.sin(((Math.PI / 2) * v) / 0.62);
  return Math.cos(((Math.PI / 2) * (v - 0.62)) / 0.38) ** 0.6;
}

/**
 * Patches of one fish: [{ color, x, y, rx, ry }], the fish being 1 long, x from the end of the tail (-0.5) to the
 * snout (0.5), y across.
 */
export function fishPatches(variety, body, seed) {
  const rand = seeded(seed);
  const tail = body.tail ?? 0.2;
  const start = -0.5 + tail;
  const span = 1 - tail;
  const width = body.width;
  const area = width * span * 0.7;
  const out = [];
  for (const p of variety.patches || []) {
    const where = p.where || 'anywhere';
    const count = where === 'head' ? 1 : PATCH_COUNT[p.size || 'medium'] || PATCH_COUNT.medium;
    const each = (p.amount * area) / count;
    const [lo, hi] = PATCH_SPAN[where] || PATCH_SPAN.anywhere;
    for (let k = 0; k < count; k++) {
      const u = lo + (hi - lo) * rand();
      const half = (width / 2) * bodyHalfwidth(u);
      const y = where === 'head' ? 0 : (rand() * 1.1 - 0.55) * half;
      const stretch = where === 'head' ? 1 : 1.5;
      const rx = Math.sqrt((each / Math.PI) * stretch);
      out.push({ color: p.color, x: start + u * span, y, rx, ry: rx / stretch });
    }
  }
  return out;
}

/**
 * Miniature of a variety seen from above, snout to the right, as an SVG document: the robe of the 3D fish (same
 * patches, back narrower than the flanks, metallic sheen), its tail and fins. For the lists of the editor.
 */
export function fishSvg(variety, body, seed = 1) {
  const W = body.width;
  const tail = body.tail ?? 0.2;
  const start = -0.5 + tail;
  const span = 1 - tail;
  const n = (v) => +v.toFixed(4);
  const outline = (k) => {
    const pts = [];
    for (let i = 0; i <= 32; i++) pts.push([start + (i / 32) * span, (-W / 2) * bodyHalfwidth(i / 32) * k]);
    for (let i = 32; i >= 0; i--) pts.push([start + (i / 32) * span, (W / 2) * bodyHalfwidth(i / 32) * k]);
    return pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  };
  const fins = variety.fins || variety.base;
  const root = (W / 2) * bodyHalfwidth(0);
  const fan = W * 0.55;
  const half = Math.max(fan / 2, W * 0.7) + 0.02; // the pectoral fins stick out of the body
  const patches = fishPatches(variety, body, seed)
    .map((p) => `<ellipse cx="${n(p.x)}" cy="${n(p.y)}" rx="${n(p.rx)}" ry="${n(p.ry)}" fill="${p.color}"/>`)
    .join('');
  const sheen = variety.metallic
    ? `<rect x="-0.5" y="${n(-W * 0.08)}" width="1" height="${n(W * 0.16)}" fill="#fff" fill-opacity="0.35"/>`
    : '';
  const ex = n(start + span * 0.9);
  const ey = n((W / 2) * bodyHalfwidth(0.9) * 0.75);
  const pec = start + span * 0.7;
  const side = (W / 2) * bodyHalfwidth(0.7);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.52 ${n(-half)} 1.04 ${n(2 * half)}">` +
    `<g fill="${fins}" fill-opacity="0.75">` +
    `<polygon points="${n(start + 0.02)},${n(-root)} -0.5,${n(-fan / 2)} ${n(-0.5 + tail * 0.35)},0 -0.5,${n(fan / 2)} ${n(start + 0.02)},${n(root)}"/>` +
    `<ellipse cx="${n(pec - 0.03)}" cy="${n(-side - W * 0.06)}" rx="${n(W * 0.28)}" ry="${n(W * 0.12)}" transform="rotate(-25 ${n(pec - 0.03)} ${n(-side - W * 0.06)})"/>` +
    `<ellipse cx="${n(pec - 0.03)}" cy="${n(side + W * 0.06)}" rx="${n(W * 0.28)}" ry="${n(W * 0.12)}" transform="rotate(25 ${n(pec - 0.03)} ${n(side + W * 0.06)})"/>` +
    `</g>` +
    `<clipPath id="b"><polygon points="${outline(0.8)}"/></clipPath>` +
    `<polygon points="${outline(1)}" fill="${variety.belly || variety.base}" stroke="#000" stroke-opacity="0.35" stroke-width="0.006"/>` +
    `<polygon points="${outline(0.8)}" fill="${variety.base}"/>` +
    `<g clip-path="url(#b)">${patches}${sheen}</g>` +
    `<circle cx="${ex}" cy="${-ey}" r="0.012" fill="#141414"/><circle cx="${ex}" cy="${ey}" r="0.012" fill="#141414"/>` +
    `</svg>`
  );
}

/** The miniature of a variety as an image address (data URL), for an <img>. */
export const fishThumb = (variety, body, seed) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fishSvg(variety, body, seed))}`;

/** The variety of a group: one of the fish, or the colours chosen in the editor ("custom"). */
export function groupVariety(group, fish) {
  const list = (fish && fish.varieties) || [];
  if (group.variety === 'custom') {
    const pattern = CUSTOM_PATTERNS[group.pattern || 'large'];
    const base = group.base || '#f6f2ea';
    return {
      id: 'custom',
      base,
      metallic: !!group.metallic,
      patches: pattern && group.patch ? [{ color: group.patch, ...pattern }] : [],
    };
  }
  return list.find((v) => v.id === group.variety) || list[0] || null;
}

/**
 * The fish of a pond, one by one: [{ key, fish (descriptor), variety, length, seed }]. `groups` from the editor,
 * `catalog` = { id: descriptor } (fish of the catalog). Groups of a fish the catalog does not have are left out; the
 * pond holds MAX_POND fish at most.
 */
export function pondFish(groups, catalog) {
  const out = [];
  for (const [g, group] of (groups || []).entries()) {
    const fish = catalog && catalog[group.species];
    if (!fish || !fish.body || !fish.length) continue;
    const variety = groupVariety(group, fish);
    if (!variety) continue;
    const L = fish.length;
    const length = Math.min(Math.max(+group.length || L.default, L.min), L.max);
    const count = Math.min(Math.max(Math.round(+group.count || 0), 0), MAX_GROUP);
    for (let i = 0; i < count && out.length < MAX_POND; i++) {
      // a robe of its own, kept from one day to the next: the seed follows the group and the rank in it
      const seed = (g + 1) * 1009 + i * 7919 + [...String(group.id || '')].reduce((s, c) => s + c.charCodeAt(0), 0);
      // a little less or more than the length of the group, so that they do not all look alike
      const size = length * (0.85 + 0.3 * seeded(seed)());
      out.push({ key: `${group.id || g}:${i}`, fish, variety, length: size, seed });
    }
  }
  return out;
}

/** A point of the water: inside the pond, out of its islands, `margin` away from their banks. */
export function inWater(poly, islands, x, z, margin) {
  if (!inPolygon(poly, x, z) || nearestOnOutline(poly, x, z).d < margin) return false;
  return !islands.some((i) => inPolygon(i, x, z) || nearestOnOutline(i, x, z).d < margin);
}

/**
 * One step of a fish wandering in a pond: it goes on, turning slowly one way then the other, and turns away when
 * the bank or an island comes near. `s` = { x, z, h (heading, rad), turn (rad/s) }; returns the new state.
 */
export function swimStep(poly, islands, s, dt, speed, margin, rand = Math.random) {
  let turn = s.turn + (rand() - 0.5) * 1.2 * dt;
  turn = Math.max(-0.6, Math.min(0.6, turn)) * (1 - 0.15 * dt);
  let h = s.h + turn * dt;
  const ahead = (a, d) => [s.x + Math.cos(a) * d, s.z + Math.sin(a) * d];
  const look = Math.max(speed * 1.5, margin * 2);
  if (!inWater(poly, islands, ...ahead(h, look), margin)) {
    // the bank ahead: the free direction closest to the heading, tried on both sides
    let found = null;
    for (let k = 1; k <= 12 && found === null; k++) {
      for (const sign of rand() < 0.5 ? [1, -1] : [-1, 1]) {
        const a = h + sign * k * (Math.PI / 12);
        if (inWater(poly, islands, ...ahead(a, look), margin)) {
          found = a;
          break;
        }
      }
    }
    const target = found ?? h + Math.PI;
    const d = Math.atan2(Math.sin(target - h), Math.cos(target - h));
    h += Math.sign(d) * Math.min(Math.abs(d), 2.5 * dt);
    turn = 0;
  }
  const [x, z] = ahead(h, speed * dt);
  if (!inWater(poly, islands, x, z, margin * 0.5)) return { ...s, h, turn }; // stays put while it turns
  return { x, z, h, turn };
}

/** A starting point in the water for each fish (spread around the pond), or null when there is no room. */
export function startPoint(poly, islands, margin, rand) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  for (let k = 0; k < 60; k++) {
    const x = Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs));
    const z = Math.min(...zs) + rand() * (Math.max(...zs) - Math.min(...zs));
    if (inWater(poly, islands, x, z, margin)) return { x, z, h: rand() * Math.PI * 2, turn: 0 };
  }
  return null;
}

/**
 * Depth of a fish under the surface: the one its fish keeps in warm water, all of them near the bottom when the
 * water is cold (below 8 °C), never under the bottom. `bottom`: depth of the water there.
 */
export function swimDepth(fish, cold, bottom, length) {
  const keep = (fish.swim && fish.swim.depth) || 'middle';
  const want = cold ? bottom * 0.85 : ({ surface: 0.08, middle: Math.min(0.25, bottom * 0.45), bottom: bottom * 0.8 }[keep] ?? 0.3);
  return Math.max(0.06, Math.min(want, bottom - length * 0.12));
}
