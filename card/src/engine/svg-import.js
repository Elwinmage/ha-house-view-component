// SVG floor plan (the kind drawn for ha-floorplan, or with Inkscape) -> rooms of one or more levels.
// A room is a closed shape (rect, polygon, closed path, ellipse) that has a name: its id, its Inkscape label, a
// data-name attribute or a <title>. ha-floorplan ids such as "area.living_room" give "Living room". Shapes named
// like an entity ("light.kitchen") are left out. Inkscape layers holding rooms become levels, bottom layer first.
// No DOM here (the importer also runs in the tests): a small XML reader is enough for SVG.

const ENTITY = /^(light|switch|sensor|binary_sensor|cover|climate|media_player|camera|vacuum|fan|lock|input_\w+|script|scene|automation)\./;

/** Tags of an XML text: [{ name, attrs, close, self, text }] in document order (text = text before the next tag). */
export function xmlTags(text) {
  const out = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
  let m;
  let last = null;
  while ((m = re.exec(text))) {
    if (last) last.text += text.slice(last.end, m.index);
    if (!m[2]) {
      if (last) last.end = re.lastIndex;
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = (a[2] ?? a[3]).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    last = { name: m[2], attrs, close: !!m[1], self: !!m[4], text: '', end: re.lastIndex };
    out.push(last);
  }
  return out;
}

// ---------------------------------------------------------------- transforms (a b c d e f, like SVG matrices)

const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const tx = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

export function parseTransform(s) {
  let m = ID;
  for (const t of (s || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = t[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let n = ID;
    if (t[1] === 'matrix' && v.length === 6) n = v;
    else if (t[1] === 'translate') n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (t[1] === 'scale') n = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (t[1] === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180;
      const [c, s2] = [Math.cos(a), Math.sin(a)];
      n = [c, s2, -s2, c, 0, 0];
      if (v.length >= 3) n = mul(mul([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (t[1] === 'skewX') n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (t[1] === 'skewY') n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

/** Points of a path (curves reduced to their end points); null when it is not closed. */
export function pathPoints(d) {
  const tok = (d || '').match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) || [];
  const pts = [];
  let i = 0;
  let cmd = '';
  let cur = [0, 0];
  let start = [0, 0];
  let closed = false;
  const n = () => parseFloat(tok[i++]);
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    if (C === 'Z') {
      closed = true;
      cur = start;
      continue;
    }
    if (!(C in ARGS) || i + ARGS[C] > tok.length) break;
    const v = Array.from({ length: ARGS[C] }, n);
    if (C === 'H') cur = [rel ? cur[0] + v[0] : v[0], cur[1]];
    else if (C === 'V') cur = [cur[0], rel ? cur[1] + v[0] : v[0]];
    else {
      const [x, y] = v.slice(-2);
      cur = rel ? [cur[0] + x, cur[1] + y] : [x, y];
    }
    if (C === 'M') {
      if (pts.length) break; // only the first sub-path (outline of the room)
      start = cur;
      cmd = rel ? 'l' : 'L';
    }
    pts.push(cur);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) {
    pts.pop();
    closed = true;
  }
  return closed && pts.length >= 3 ? pts : null;
}

/** Display name of a room from its SVG name: "area.living_room" -> "Living room". */
export function roomName(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/^area\./, '');
  if (/^[a-z0-9_]+$/.test(s)) s = s.replace(/_/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const shapeName = (t) => t.attrs['inkscape:label'] || t.attrs['data-name'] || t.attrs.id || '';

/**
 * Rooms of an SVG text, in SVG units: { levels: [{ name, rooms: [{ name, poly }] }], bbox: [x0, y0, x1, y1],
 * unitsPerMeter }. `unitsPerMeter` is guessed from the size of the drawing when it is given in mm, cm or m.
 */
export function parseSvgRooms(text) {
  const tags = xmlTags(text);
  const root = tags.find((t) => t.name === 'svg' && !t.close);
  if (!root) throw new Error('Not an SVG file.');
  const stack = [{ m: ID, layer: null }];
  const layers = [];
  const shapes = [];
  let pendingTitle = null; // shape waiting for its <title>
  for (let k = 0; k < tags.length; k++) {
    const t = tags[k];
    const top = stack[stack.length - 1];
    if (t.close) {
      if (t.name === 'g' || t.name === 'svg' || t.name === 'a') stack.pop();
      if (pendingTitle && t.name === pendingTitle.tag) pendingTitle = null;
      continue;
    }
    if (t.name === 'title' && pendingTitle && !pendingTitle.shape.name) pendingTitle.shape.name = t.text.trim();
    const m = mul(top.m, parseTransform(t.attrs.transform));
    if (t.name === 'g' || t.name === 'svg' || t.name === 'a') {
      let layer = top.layer;
      if (t.name === 'g' && t.attrs['inkscape:groupmode'] === 'layer') {
        layer = { name: t.attrs['inkscape:label'] || t.attrs.id || `Layer ${layers.length + 1}` };
        layers.push(layer);
      }
      if (!t.self) stack.push({ m: t.name === 'svg' && t !== root ? ID : m, layer });
      continue;
    }
    let pts = null;
    const a = (n) => parseFloat(t.attrs[n]) || 0;
    if (t.name === 'rect') {
      const [x, y, w, h] = [a('x'), a('y'), a('width'), a('height')];
      if (w > 0 && h > 0)
        pts = [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ];
    } else if (t.name === 'polygon') {
      const v = (t.attrs.points || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      pts = [];
      for (let j = 0; j + 1 < v.length; j += 2) pts.push([v[j], v[j + 1]]);
      if (pts.length < 3) pts = null;
    } else if (t.name === 'path') pts = pathPoints(t.attrs.d);
    else if (t.name === 'ellipse' || t.name === 'circle') {
      const rx = t.name === 'circle' ? a('r') : a('rx');
      const ry = t.name === 'circle' ? a('r') : a('ry');
      if (rx > 0 && ry > 0) pts = Array.from({ length: 16 }, (_, j) => [a('cx') + rx * Math.cos((j * Math.PI) / 8), a('cy') + ry * Math.sin((j * Math.PI) / 8)]);
    }
    if (!pts) continue;
    const shape = { name: shapeName(t), poly: pts.map((p) => tx(m, p)), layer: top.layer };
    shapes.push(shape);
    if (!t.self) pendingTitle = { tag: t.name, shape };
  }
  const named = shapes.filter((s) => s.name && !ENTITY.test(s.name));
  // a shape around every other one is the outline of the house, not a room
  const area = (p) => Math.abs(p.reduce((s, q, j) => s + q[0] * p[(j + 1) % p.length][1] - p[(j + 1) % p.length][0] * q[1], 0)) / 2;
  const inside = (big, small) => {
    const xs = big.poly.map((q) => q[0]);
    const ys = big.poly.map((q) => q[1]);
    return small.poly.every((q) => q[0] >= Math.min(...xs) - 1e-6 && q[0] <= Math.max(...xs) + 1e-6 && q[1] >= Math.min(...ys) - 1e-6 && q[1] <= Math.max(...ys) + 1e-6);
  };
  const rooms = named.filter((s) => named.filter((o) => o !== s && o.layer === s.layer && inside(s, o) && area(o.poly) < area(s.poly)).length < 2);
  if (!rooms.length) throw new Error('No named room in this SVG (rect, polygon or closed path with an id or a label).');
  const pts = rooms.flatMap((r) => r.poly);
  const bbox = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  // units per meter from the size of the drawing (width="210mm" viewBox="0 0 210 297" -> 1000)
  let unitsPerMeter = 100;
  const w = /^([\d.]+)\s*(mm|cm|m)$/.exec(root.attrs.width || '');
  const vb = (root.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  if (w && vb.length === 4 && vb[2] > 0) unitsPerMeter = vb[2] / (parseFloat(w[1]) * { mm: 0.001, cm: 0.01, m: 1 }[w[2]]);
  const used = layers.filter((l) => rooms.some((r) => r.layer === l));
  const levels = (used.length >= 2 ? [...used].reverse() : [null]).map((l, i) => ({
    name: l ? l.name : '',
    index: i,
    rooms: rooms.filter((r) => used.length < 2 || r.layer === l).map((r) => ({ name: roomName(r.name), poly: r.poly })),
  }));
  return { levels, bbox, unitsPerMeter };
}

/**
 * Levels of rooms in meters (x = east, z = south: the SVG is drawn north up), from the rooms of parseSvgRooms and
 * a scale; the drawing starts at (0, 0).
 */
export function svgLevels(parsed, unitsPerMeter = parsed.unitsPerMeter) {
  const [x0, y0] = parsed.bbox;
  const k = 1 / unitsPerMeter;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return parsed.levels.map((l) => ({
    name: l.name,
    rooms: l.rooms.map((r) => ({ name: r.name, poly: r.poly.map((q) => [r3((q[0] - x0) * k), r3((q[1] - y0) * k)]) })),
  }));
}
