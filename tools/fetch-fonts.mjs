// @ts-check
// Re-fetch the vendored webfonts. DEV-TIME ONLY — the output is committed, so
// `clone && node tools/serve.mjs` still needs no network and no build step.
//
// Run: node tools/fetch-fonts.mjs
//
// WHY VENDORED: styles/base.css used to open with an @import from
// fonts.googleapis.com. That is a render-blocking third-party request on every
// boot of an offline-first, local-only game — it leaked the player's IP
// to Google, and offline every glyph fell back to Segoe UI, taking the whole
// typographic identity with it.
//
// WHY ONE REQUEST PER WEIGHT: `?family=Oxanium:wght@500;700;800` returns three
// @font-face blocks that all point at the SAME variable font (verified:
// identical md5). Vendoring those gives you 176KB of duplicated bytes. Asking
// for one weight at a time returns a static instance per weight — 95KB total.
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const OUT = new URL('../vendor/fonts/', import.meta.url);

/** Families and the weights the stylesheet actually uses. Keep in sync with base.css. */
const FAMILIES = [
  { slug: 'Oxanium', family: 'Oxanium', weights: [500, 700, 800] },
  { slug: 'IBMPlexSans', family: 'IBM+Plex+Sans', weights: [400, 500, 600] },
];

/** Google's CDN intermittently connect-times-out; a transient failure is not a reason to ship nothing. */
async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res;
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

await mkdir(OUT, { recursive: true });
const seen = new Map();
let total = 0;

for (const { slug, family, weights } of FAMILIES) {
  for (const weight of weights) {
    const css = await (await get(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`)).text();
    // latin base subset only — the other subsets are glyphs this game never renders
    const block = css.split('@font-face').find((b) => /unicode-range:[^;]*U\+0000-00FF/.test(b));
    if (!block) throw new Error(`no latin block for ${family} ${weight}`);
    const src = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!src) throw new Error(`no woff2 url for ${family} ${weight}`);

    const buf = Buffer.from(await (await get(src)).arrayBuffer());
    if (buf.subarray(0, 4).toString('ascii') !== 'wOF2') {
      throw new Error(`${slug}-${weight} is not woff2 (got ${buf.subarray(0, 4).toString('hex')})`);
    }
    const hash = createHash('md5').update(buf).digest('hex');
    if (seen.has(hash)) throw new Error(`${slug}-${weight} is byte-identical to ${seen.get(hash)} — variable font leaked through`);
    seen.set(hash, `${slug}-${weight}`);

    await writeFile(new URL(`${slug}-${weight}.woff2`, OUT), buf);
    total += buf.length;
    console.log(`${slug}-${weight}.woff2  ${(buf.length / 1024).toFixed(1)}KB`);
  }
}
console.log(`\n${seen.size} distinct files, ${(total / 1024).toFixed(1)}KB total`);
