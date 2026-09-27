// @ts-check
// Just enough DOM for the canvas texture generators to run under `node --test`:
// jsdom for document/canvas elements, and a 2D context that answers every call
// texGen makes. With `record`, every draw call and property write is logged as
// a string — two runs of a seeded generator must produce the same log.
// (Not a *.test.mjs file, so `npm test` does not run it on its own.)
import { JSDOM } from 'jsdom';

const fmt = (v) => (typeof v === 'number' ? v.toFixed(4) : typeof v === 'string' ? v : typeof v);

/** @param {Uint8ClampedArray} data */
function checksum(data) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** @param {any} canvas @param {string[]|null} record */
function fakeCtx(canvas, record) {
  const note = (s) => { if (record) record.push(s); };
  const image = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  const target = {
    canvas,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => image(w, h),
    createImageData: (w, h) => image(w, h),
    putImageData: (img) => note(`putImageData(${checksum(img.data)})`),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[/** @type {keyof typeof t} */ (k)];
      return (...args) => note(`${String(k)}(${args.map(fmt).join(',')})`);
    },
    set(t, k, v) { note(`${String(k)}=${fmt(v)}`); return true; },
  });
}

/** @param {{record?: string[]|null}} [opts] */
export function installFakeDom({ record = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const g = /** @type {any} */ (globalThis);
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.Image = dom.window.Image;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return /** @type {any} */ (fakeCtx(this, record)); };
  return dom;
}
