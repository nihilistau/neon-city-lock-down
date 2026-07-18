// @ts-check
// lmstudio-engine — a self-contained, game-agnostic control layer over LM Studio
// (via @lmstudio/sdk). Streaming generation, structured extraction with a
// dedicated function model, an agentic tool loop, a koa-style interceptor
// pipeline, Jinja-style persona templates, and an SSE server to drive a browser.
//
// Quick start:
//   import { Engine, EngineServer } from './lmstudio-engine/index.mjs';
//   const engine = new Engine({ apiKeyFile: 'lmstudio-api-key.txt',
//     models: { chat: '', function: 'functiongemma-270m' } });
//   engine.template('persona', '{{ name }} — {{ archetype }} …');
//   const server = new EngineServer(engine);
//   server.route('POST', '/chat', async (body, { sse }) => {
//     const system = engine.render('persona', body.ctx);
//     const r = await engine.chat({ system, input: body.input },
//       (frag, m) => { if (!m.reasoning) sse.send('fragment', { text: frag }); });
//     sse.send('tags', await engine.extract({ input: r.content, schema: TAG_SCHEMA }));
//     sse.send('done', { stats: r.stats });
//   });
//   // then in your http server: if (await server.handle(req, res, url)) return;

export { Engine } from './src/engine.mjs';
export { EngineServer } from './src/server.mjs';
export { LmsClient } from './src/client.mjs';
export { Predictor, toChat } from './src/predictor.mjs';
export { Interceptors, timing, retry, systemRewrite, observe } from './src/middleware.mjs';
export { PromptTemplate, render } from './src/templates.mjs';
export { ToolRegistry, tool, z } from './src/tools.mjs';
export { openSSE } from './src/sse.mjs';
export { makeConfig, parseApiKey } from './src/config.mjs';
