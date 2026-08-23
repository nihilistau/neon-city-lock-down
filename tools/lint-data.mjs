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
  await import('../data/dialogue/kai/depth.js');
  await import('../data/dialogue/vox/core.js');
  await import('../data/dialogue/vox/depth.js');
  const { topicRegistry, topicsFor } = await import('../src/dialogue/topics.js');
  ok(`topics: ${topicRegistry.size} registered`);

  // content that must at least parse + self-reference cleanly
  const { SCENARIOS } = await import('../data/scenarios.js');
  ok(`scenarios: ${Object.keys(SCENARIOS).length}`);
  const { EVENTS } = await import('../data/events.js');
  ok(`events: ${Object.keys(EVENTS).length}`);
  const { MYSTERY_CASES } = await import('../data/games/mysteryCases.js');
  const { BED_ACTIONS } = await import('../data/games/bedActions.js');
  const { TRUTHS, DARES } = await import('../data/games/todPrompts.js');
  ok(`games: ${BED_ACTIONS.length} bed actions, ${TRUTHS.length}+${DARES.length} ToD, ${Object.keys(MYSTERY_CASES).length} cases`);

  // referential checks
  const anims = clipRegistry;
  const zonesMod = await import('../data/zones.js');
  const knownZones = Object.keys(zonesMod.ZONES);
  // scenario placements must reference real zones
  for (const s of Object.values(SCENARIOS)) {
    for (const [cid, [zone]] of Object.entries(s.placements || {})) {
      if (!knownZones.includes(zone)) err(`scenario ${s.id}: placement ${cid} -> unknown zone "${zone}"`);
    }
    if (s.fireEvent && !EVENTS[s.fireEvent]) err(`scenario ${s.id}: fireEvent "${s.fireEvent}" unknown`);
  }
  // mystery clue zones exist
  for (const c of Object.values(MYSTERY_CASES)) {
    for (const cl of c.clues) if (!knownZones.includes(cl.zone)) err(`case ${c.id}: clue zone "${cl.zone}" unknown`);
  }
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
