// @ts-check
// The game is all-audiences as of v0.6. This walks every shipped source/data/
// config/style file and fails with file:line on any word from the retired
// adult register, so none of it can drift back in unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'data', 'config', 'tools', 'styles', 'index.html'];
const EXTS = new Set(['.js', '.mjs', '.yaml', '.yml', '.css', '.html', '.json']);
const BANNED = [
  /\barousal\b/i, /\bhorniness\b/i, /\bhorny\b/i, /\berotic\b/i, /\b18\+/, /adults?-only/i,
  /\bnaked\b/i, /\bnude\b/i, /\bexplicitness\b/i, /\bgateTier\b/, /\bbed_(recline|reach|arch|straddle|climax)\b/,
  /\bdirty[- ]talk\b/i, /\btalk dirty\b/i, /\bsafeword\b/i, /\bdepraved\b/i, /\blingerie\b/i,
];
// the guard's own word list, and vendored third-party code
const SKIP = [/^vendor\//, /node_modules/, /test\/unit\/clean-content/];

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p)) yield* walk(join(p, f)); }
  else if (EXTS.has(extname(p))) yield p;
}

test('no retired adult-register vocabulary ships in the game', () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const rel = file.replace(/\\/g, '/');
      if (SKIP.some((re) => re.test(rel))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const re of BANNED) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${re}  ${line.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `\n${hits.join('\n')}`);
});
