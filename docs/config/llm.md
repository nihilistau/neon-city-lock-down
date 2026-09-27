# config/llm.yaml

Advanced LM Studio engine knobs, consumed by **both** sides: the server
(`tools/gameEngine.mjs` via `tools/serverConfig.mjs`, reading the file from disk) and the
browser agent (`src/dialogue/llm/agent.js` via `cfg()`). Sampling is applied server-side in
the engine (`lmstudio-engine/`), so the browser only sends token budgets.

**Split of responsibility:** the everyday LLM controls — chat model, temperature ("warmth"),
thinking on/off, and per-character interaction/model — live in the **LLM panel (press L)** and
persist to `settings.llm` (localStorage). *This file* is the deeper, less-often-touched surface.
**Restart `tools/serve.mjs` after editing `connection`** (the server reads it at startup).

## `connection`

| Key | Default | Effect |
|-----|---------|--------|
| `baseUrl` | `ws://127.0.0.1:1234` | LM Studio WebSocket URL. `env LMS_BASE_URL` overrides. |
| `apiKeyFile` | `lmstudio-api-key.txt` | Project-root-relative file holding `sk-lm-<id>:<passkey>`. |

## `models`

| Key | Default | Effect |
|-----|---------|--------|
| `function` | `google/functiongemma-270m` | Tiny model that reads prose → scene tags (structured extraction). |
| `draft` | `''` | Speculative-decoding draft model key (`''` = off). |

_(The chat/roleplay model is chosen in the LLM panel — `settings.llm.chatModel`.)_

## `sampling` — extra per-request sampling (SDK)

`temperature` is the panel "warmth" slider; these are the rest. Sent to the SDK only when set,
so a value can be removed to fall back to the model/server default.

| Key | Default | Range | SDK option |
|-----|---------|-------|-----------|
| `topP` | 0.95 | 0–1 | `topPSampling` |
| `topK` | 40 | 0–500 | `topKSampling` |
| `minP` | 0 | 0–1 | `minPSampling` |
| `repeatPenalty` | 1.1 | 0–3 | `repeatPenalty` |

## `budgets` — max reply tokens by situation (`agent.js`)

| Key | Default | When |
|-----|---------|------|
| `normal` | 1600 | Ordinary reply (covers a thinking model's reasoning + answer). |
| `heated` | 2200 | High tension or live combat. |
| `rewrite` | 300 | Restyle-authored-line mode. |

## `reasoning`

| Key | Default | Effect |
|-----|---------|--------|
| `startTag` / `endTag` | `<think>` / `</think>` | Markers the engine splits reasoning on, so a thinking model's chain-of-thought never lands in the reply. (Thinking on/off is the panel toggle → `/no_think`.) |

## Other

| Key | Default | Effect |
|-----|---------|--------|
| `ttlSeconds` | 86400 | How long a JIT-loaded model stays resident between requests (24h). |
| `stopStrings` | `[]` | Hard stop sequences (`[]` = none). |
| `structured.temperature` / `.maxTokens` | 0.2 / 200 | Sampling for the function-model tag extraction. |
| `interceptors.timing` | false | Log per-request latency / tokens-per-second to the server console. |
| `interceptors.retry` | 0 | Auto-retry a failed generation N times. |
