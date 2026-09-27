# lmstudio-engine

A self-contained, game-agnostic control layer over **LM Studio** (via the official
[`@lmstudio/sdk`](https://www.npmjs.com/package/@lmstudio/sdk)). Built to be lifted
into any Node project. It is the culmination of several roleplay-engine iterations.

## What it gives you

- **Streaming generation** — token fragments over the SDK's WebSocket transport,
  with reasoning tokens separated from speech (works with "thinking" models).
- **Structured output via a dedicated function model** — the big roleplay model
  writes clean prose; a tiny constrained model (e.g. `functiongemma-270m`) reads
  that prose into a strict JSON/zod schema you define. You inject the results
  yourself. This sidesteps small models fumbling inline tags.
- **Agentic tool loop** — `Engine.act()` wraps the SDK's `.act()` with a
  `guard` hook to allow / deny / override each tool call (director control).
- **Interceptor pipeline** — koa-style middleware around every prediction
  (timing, retry, prompt-rewrite, observe, your own).
- **Jinja-style persona templates** — `{{ }}`, `{% if %}`, `{% for %}`, filters.
- **SSE server** — `EngineServer` mounts routes onto any Node http server and
  streams to a browser.

## Connect / auth

LM Studio API keys are `sk-lm-<identifier>:<passkey>`. The SDK authenticates over
WebSocket with those two parts (not a bearer token); the engine parses them for
you from a key you pass in, `LMS_API_KEY`, or a key file.

```js
import { Engine } from './lmstudio-engine/index.mjs';

const engine = new Engine({
  apiKeyFile: 'lmstudio-api-key.txt',      // or apiKey: 'sk-lm-…', or env LMS_API_KEY
  baseUrl: 'ws://127.0.0.1:1234',          // default
  models: { chat: '', function: 'google/functiongemma-270m' }, // '' chat = whatever's loaded
});
await engine.health();                     // { ok, model, loaded }
```

## Stream + extract (the two-model dance)

```js
engine.template('persona', `You are {{ name }}, {{ archetype }}. You feel {{ mood }}.
{% if stats.tension > 50 %}Your hand keeps drifting to the knife.{% endif %} Reply in character.`);

const system = engine.render('persona', { name: 'Lola', archetype: 'a fixer', mood: 'guarded', stats: { tension: 62 } });

const res = await engine.chat(
  { system, input: 'Watch the door with me.', maxTokens: 120 },
  (frag, m) => { if (!m.reasoning) process.stdout.write(frag); },  // live typewriter
);

import { z } from './lmstudio-engine/index.mjs';
const tags = await engine.extract({
  input: `Roleplay line: "${res.content}". Pick the scene cues that fit.`,
  schema: z.object({ move: z.enum(['', 'bar', 'window']), trust_delta: z.number().int() }),
});   // → { move: 'window', trust_delta: 3 }
```

## SSE server

```js
import { EngineServer } from './lmstudio-engine/index.mjs';
const server = new EngineServer(engine);            // adds GET /engine/status
server.route('POST', '/chat', async (body, { sse }) => {
  const system = engine.render('persona', body.ctx);
  const r = await engine.chat({ system, input: body.input },
    (frag, m) => { if (!m.reasoning) sse.send('fragment', { text: frag }); });
  sse.send('tags', await engine.extract({ input: r.content, schema: TAG_SCHEMA }));
  sse.send('done', { stats: r.stats });
});
// in your Node http server, before static handling:
//   if (await server.handle(req, res, url)) return;
// browser: fetch('/engine/chat', { method:'POST', headers:{Accept:'text/event-stream'}, body })
```

## Interceptors & tools

```js
import { timing, retry, tool, z } from './lmstudio-engine/index.mjs';
engine.use(timing(console.log)).use(retry(1));

const rollDice = tool({ name: 'roll', description: 'Roll a die.',
  parameters: { sides: z.number() }, implementation: ({ sides }) => 1 + Math.floor(Math.random() * sides) });
await engine.act({ system, input: 'Roll a d20.', tools: [rollDice] },
  { onFragment: (t) => process.stdout.write(t),
    guard: (name, args) => name === 'roll' ? 'allow' : { deny: 'not allowed' } });
```

## Layout

```
lmstudio-engine/
  index.mjs            public surface
  src/config.mjs       connection/auth/model-role/sampling resolution
  src/client.mjs       LmsClient — WS connection + model handles by role
  src/predictor.mjs    streaming + structured respond over a handle
  src/engine.mjs       Engine — orchestrator (chat/extract/act/templates)
  src/middleware.mjs   Interceptors + ready-made middleware
  src/templates.mjs    Jinja-style renderer + PromptTemplate
  src/tools.mjs        tool()/z re-export + ToolRegistry
  src/sse.mjs          SSE framing
  src/server.mjs       EngineServer — route registry + dispatch
```

Requires `@lmstudio/sdk` and `zod` (declared in the host project's `package.json`).
Node 18 or newer.
