// @ts-check
// The neon-noir colour grade, as a function and as an Adobe .cube 3D LUT.
// Generated, not painted: the project has no grading tools, and a grade that
// lives in code can be diffed, tested and retuned in one place. The LUT runs
// AFTER tone-mapping (src/scene3d/postfx.js, LUTPass after OutputPass), so the
// input is display-referred sRGB in 0..1 — which is where a .cube is authored.

export const LUT_SIZE = 33;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * @param {number[]} rgb display-referred 0..1
 * @returns {number[]} graded 0..1
 */
export function neonNoir([r, g, b]) {
  // 1. black point: crush the bottom 1.5% so night reads as night, not grey
  const bp = 0.015;
  let c = [r, g, b].map((v) => Math.max(0, (v - bp) / (1 - bp)));
  // 2. split tone keyed on luminance — teal shadows, warm-magenta highlights.
  //    Squared weights keep the midtones (skin) nearly untouched.
  const l = luma(c);
  const sh = (1 - l) ** 2;
  const hi = l ** 2;
  c = [c[0] + 0.035 * hi, c[1] + 0.025 * sh + 0.005 * hi, c[2] + 0.045 * sh + 0.02 * hi];
  // 3. a little extra saturation around the pixel's own luma: neon should sing
  const l2 = luma(c);
  c = c.map((v) => l2 + (v - l2) * 1.12);
  // 4. gentle S-curve, a quarter of a smoothstep: contrast without clipping
  c = c.map((v) => {
    const x = clamp01(v);
    const s = x * x * (3 - 2 * x);
    return x + (s - x) * 0.25;
  });
  return c.map(clamp01);
}

export const GRADES = { neonNoir };

/**
 * Serialise a grade as a .cube file. Red varies fastest, then green, then blue
 * — the order the format specifies and three's LUTCubeLoader reads.
 * @param {{title:string, size:number, grade:(rgb:number[]) => number[]}} o
 */
export function cubeText({ title, size, grade }) {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  const n = size - 1;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const out = grade([ri / n, gi / n, bi / n]);
        lines.push(out.map((v) => clamp01(v).toFixed(4)).join(' '));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Parse the data rows back out (tests + sanity checks). @param {string} text */
export function parseCube(text) {
  let size = 0;
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) { size = Number(line.split(/\s+/)[1]); continue; }
    if (/^[A-Z_]/.test(line)) continue;
    rows.push(line.split(/\s+/).map(Number));
  }
  return { size, rows };
}
