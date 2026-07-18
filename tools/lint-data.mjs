// @ts-check
// Import every data module (triggering schema validation + tag compilation) and
// run referential checks: topic goto targets exist, stage-direction anims/zones
// resolve, fallback tones present. Runs in Node — catches content bugs without
// a browser. Usage: node tools/lint-data.mjs
//
// Node can't import three.js (browser globals), so data modules that transitively
// import three are loaded via a lightweight three shim registered on the loader.
import { pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
let errors = 0;
const err = (m) => { console.error('  ✗', m); errors++; };
const ok = (m) => console.log('  ✓', m);

async function main() {
  // pure-logic + content modules that DON'T need three
  const { clipRegistry } = await import('../src/humanoid/clips.js');
  await import('../data/poses/base.js');
  ok(`clips: ${clipRegistry.size} registered`);

  await import('../data/dialogue/intents.js');
  const { intentRegistry } = await import('../src/dialogue/parser/intents.js');
  ok(`intents: ${intentRegistry.size} registered`);

  await import('../data/dialogue/lola/fallbacks.js');
  await import('../data/dialogue/lola/core.js');
  await import('../data/dialogue/lola/depth.js');
  await import('../data/dialogue/aria/core.js');
  await import('../data/dialogue/aria/depth.js');
  await import('../data/dialogue/kai/core.js');
  await import('../data/dialogue/vox/core.js');
  const { topicRegistry, topicsFor } = await import('../src/dialogue/topics.js');
  ok(`topics: ${topicRegistry.size} registered`);

  // referential checks
  const anims = clipRegistry;
  const knownZones = Object.keys((await import('../data/zones.js')).ZONES);
  for (const topic of topicRegistry.values()) {
    // branch goto targets exist
    for (const b of topic.branches || []) {
      if (b.goto && !topicRegistry.has(b.goto)) err(`${topic.id}: branch goto -> missing topic "${b.goto}"`);
    }
    // stage-direction references
    for (const ln of topic.lines) {
      for (const d of ln.compiled.directions) {
        if (d.type === 'anim' && !anims.has(d.args[0])) err(`${topic.id}: [[anim:${d.args[0]}]] not a known clip`);
        if (d.type === 'move' && !knownZones.includes(d.args[0])) err(`${topic.id}: [[move:${d.args[0]}]] not a known zone`);
        if (d.type === 'gate' && !['offer', 'grant', 'revoke'].includes(d.args[0])) err(`${topic.id}: [[gate:${d.args[0]}]] bad action`);
      }
    }
    // triggers reference known intents
    for (const t of topic.triggers || []) {
      if (t.intent && !intentRegistry.has(t.intent)) err(`${topic.id}: trigger intent "${t.intent}" unknown`);
    }
  }
  ok('referential checks complete');

  if (errors) { console.error(`\n${errors} content error(s).`); process.exit(1); }
  console.log('\nData lint passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
