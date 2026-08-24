// @ts-check
// Import every data module (triggering schema validation + tag compilation) and
// run referential checks: topic goto targets exist, stage-direction anims/zones
// resolve, fallback tones present. Runs in Node — catches content bugs without
// a browser. Usage: node tools/lint-data.mjs
//
// Node can't import three.js (browser globals), so data modules that transitively
// import three are loaded via a lightweight three shim registered on the loader.
import { pathToFileURL } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
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

  // DISCOVERED, not listed. This was nine hand-written import lines, so a new
  // dialogue pack was simply never linted — and since compileLine() throws on an
  // unknown stage tag at registration, "never imported" means "never checked".
  // A pack with a typo'd [[tag]] passed the linter and then killed the boot.
  // refugee.js is skipped deliberately: it exports a register function bound to
  // a runtime-assigned id rather than registering at import.
  const dlgDir = join(ROOT, 'data', 'dialogue');
  const packs = [];
  for (const entry of await readdir(dlgDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const f of (await readdir(join(dlgDir, entry.name))).filter((n) => n.endsWith('.js'))) {
        packs.push(join(dlgDir, entry.name, f));
      }
    } else if (entry.name.endsWith('.js') && entry.name !== 'intents.js' && entry.name !== 'refugee.js') {
      packs.push(join(dlgDir, entry.name));
    }
  }
  // fallbacks first — they register a different registry and must not be shadowed
  packs.sort((a, b) => (b.includes('fallbacks') ? 1 : 0) - (a.includes('fallbacks') ? 1 : 0));
  for (const f of packs) await import(pathToFileURL(f).href);
  const { topicRegistry, topicsFor } = await import('../src/dialogue/topics.js');
  ok(`topics: ${topicRegistry.size} registered from ${packs.length} packs`);

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
  // The Creation Kit's own cheatsheet is documentation people WRITE CONTENT
  // against, so a verb missing from it is a verb nobody uses. It documented 25
  // of 27 across two releases. Checked from the source of truth, both ways.
  {
    const runnerSrc = await readFile(join(ROOT, 'src', 'sim', 'eventRunner.js'), 'utf8');
    const real = [...runnerSrc.matchAll(/^ {6}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
    const docSrc = await readFile(join(ROOT, 'docs', 'event-catalog.md'), 'utf8');
    // ONLY the verb table — the file has other tables, and a loose scan reads
    // their first columns as verb names
    const table = docSrc.slice(docSrc.indexOf('| type | fields | effect |'), docSrc.indexOf('**Note:**'));
    const documented = new Set([...table.matchAll(/^\| `([a-zA-Z]+)`/gm)].map((m) => m[1]));
    // `powerDown / powerUp` share one row
    for (const m of table.matchAll(/`([a-zA-Z]+)` \/ `([a-zA-Z]+)`/g)) { documented.add(m[1]); documented.add(m[2]); }
    const undocumented = real.filter((v) => !documented.has(v));
    const phantom = [...documented].filter((v) => !real.includes(v));
    if (undocumented.length) err(`event verbs missing from docs/event-catalog.md: ${undocumented.join(', ')}`);
    if (phantom.length) err(`docs/event-catalog.md documents verbs that do not exist: ${phantom.join(', ')}`);
    if (!undocumented.length && !phantom.length) ok(`event verbs: ${real.length}, all documented`);
  }

  ok('referential checks complete');

  if (errors) { console.error(`\n${errors} content error(s).`); process.exit(1); }
  console.log('\nData lint passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
