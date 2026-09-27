# Engine Config

Every tunable engine value lives in a **config group** — a YAML file under `config/`
loaded at boot over baked defaults. Editing config never touches code, and the game
runs identically when no `config/` files exist.

## How it works

```
data/configDefaults.js   ← baked defaults (single source of truth, pure data)
data/configSchema.js     ← per-key type/range validation (pure)
config/<group>.yaml      ← optional human edits, merged over the defaults
src/core/config.js       ← the runtime store: loadConfig(), cfg(), saveConfigFile()
tools/configApi.mjs      ← GET/POST/DELETE /api/config (served by tools/serve.mjs)
tools/lint-config.mjs    ← `npm run lint` validates defaults + every config file
docs/config/<group>.md   ← this reference (one page per group)
```

At boot, `src/main.js` calls `await loadConfig()` **before** constructing the app. For
each group it fetches `/config/<group>.yaml`, validates it, and **deep-merges** it over
the defaults into the live store. Missing files keep defaults; an invalid file is skipped
with a console warning (the game still boots). Systems then read values with
`cfg('group.path.to.key')`.

## Reading config in code

```js
import { cfg } from '../core/config.js';
const dist = cfg('camera.thirdPerson.shoulderDist');   // live value (or the default)
```

Two patterns are used:
- **Module-cached** (hot paths, e.g. `firstPerson.js`): read all keys into module vars in a
  `_readConfig()` that re-runs on the `config.loaded` and `config.changed` bus events.
- **Read-at-use** (cooler paths, e.g. `cameraDirector.js`, `combat.js`): call `cfg(...)`
  directly where the value is consumed, so edits hot-reload with no bookkeeping.

Both are non-breaking: every `cfg()` call passes the original constant as a fallback, so a
partial or absent config never removes a value.

## Editing config

**By hand:** edit `config/<group>.yaml` and reload the page. Delete a key to fall back to its
default; delete the file for pure defaults. Run `npm run lint` to validate.

**Live (creation kit):** the config API lets tools read/write config without a restart.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`    | `/api/config`               | list groups + whether each has a file |
| `GET`    | `/api/config/<group>.yaml`  | current file contents |
| `POST`   | `/api/config/<group>.yaml`  | validate + write (422 on invalid) |
| `DELETE` | `/api/config/<group>.yaml`  | revert to defaults (delete file) |

From the browser, `saveConfigFile(group, obj)` validates, POSTs, and applies live (emits
`config.changed`); `applyConfig(group, obj)` applies in-memory only. Writes are confined to
the `config/` dir and known groups, and validated against `configSchema.js` before hitting
disk. **Saving through the API reformats the YAML and drops comments** (js-yaml dump) — the
authoritative documentation is here in `docs/config/`, not in the file comments.

## Validation

`validateConfig(group, obj)` checks every present key against `CONFIG_SCHEMA`: type, numeric
range, array length, and rejects unknown keys. It runs in three places — the browser store
(bad live edits are refused), the server (422 on POST), and `npm run lint` (which also
verifies the defaults themselves satisfy the schema, catching default/schema drift).

## Groups

| Group | File | Reference |
|-------|------|-----------|
| camera | `config/camera.yaml` | [camera.md](camera.md) |
| combat | `config/combat.yaml` | [combat.md](combat.md) |
| sim | `config/sim.yaml` | [sim.md](sim.md) |
| chars | `config/chars.yaml` | [chars.md](chars.md) — stat coupling/decay/compliance and the `bond` tier thresholds + hysteresis |
| humanoid | `config/humanoid.yaml` | [humanoid.md](humanoid.md) |
| world | `config/world.yaml` | [world.md](world.md) |
| lighting | `config/lighting.yaml` | [lighting.md](lighting.md) |
| render | `config/render.yaml` | shadows, AO, bloom, grain, FOV — documented inline in `data/configDefaults.js` |
| llm | `config/llm.yaml` | [llm.md](llm.md) |
| voice | `config/voice.yaml` | [systems/voice.md](../systems/voice.md) |

_(Audio bus volumes are player preferences in `settings.js`, not engine config. Server-side
config is read by `tools/serverConfig.mjs`.)_
