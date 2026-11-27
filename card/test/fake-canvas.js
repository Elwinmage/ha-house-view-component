// A stand-in for the canvas of a browser, for the tests of what the card paints: every canvas made through the
// fake `document` keeps the list of what was drawn on it (`canvas.calls`), with the colours in use at that time.

/** One canvas whose 2D context records its calls. */
export function fakeCanvas(id = 0) {
  const calls = [];
  const note = (op, extra = {}) => calls.push({ op, ...extra });
  const g = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    globalAlpha: 1,
    fillRect(x, y, w, h) {
      note('fillRect', { style: this.fillStyle, alpha: this.globalAlpha, x, y, w, h });
    },
    arc(x, y, r) {
      note('arc', { style: this.fillStyle, x, y, r });
    },
    ellipse(x, y, rx, ry) {
      note('ellipse', { style: this.fillStyle, x, y, rx, ry });
    },
    moveTo(x, y) {
      note('moveTo', { x, y });
    },
    lineTo(x, y) {
      note('lineTo', { x, y });
    },
    stroke() {
      note('stroke', { style: this.strokeStyle, width: this.lineWidth });
    },
    rect(x, y, w, h) {
      note('rect', { x, y, w, h });
    },
    translate(x, y) {
      note('translate', { x, y });
    },
    scale(x, y) {
      note('scale', { x, y });
    },
    createPattern(source, repeat) {
      note('createPattern', { source, repeat });
      return { pattern: source };
    },
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4).fill(100) };
    },
    putImageData(image) {
      note('putImageData', { image });
    },
    beginPath() {},
    closePath() {},
    fill() {
      note('fill', { style: this.fillStyle });
    },
    clip() {
      note('clip');
    },
    save() {},
    restore() {},
  };
  return {
    id,
    width: 0,
    height: 0,
    calls,
    getContext: () => g,
    toDataURL: (type) => `data:${type};canvas-${id}`,
  };
}

/** A `document` that only makes canvases, and remembers them: { createElement, canvases }. */
export function fakeDocument() {
  const canvases = [];
  return {
    canvases,
    createElement() {
      const c = fakeCanvas(canvases.length);
      canvases.push(c);
      return c;
    },
  };
}

/** The calls of one kind made on a canvas. */
export const callsOf = (canvas, op) => canvas.calls.filter((call) => call.op === op);
