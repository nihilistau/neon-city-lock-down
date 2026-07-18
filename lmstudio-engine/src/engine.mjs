// @ts-check
// Engine — the high-level, game-agnostic orchestrator. Combines the client,
// predictor, a template registry, and an interceptor pipeline into one surface:
//   • chat()      — interceptor-wrapped streaming generation (prose)
//   • extract()   — structured tag/directive extraction (function model)
//   • act()       — agentic tool loop with a guard/injection hook
//   • template()/render() — persona/prompt templates
//
// The signature two-model dance the game uses: chat() streams the roleplay
// prose from the big model while extract() reads that prose into structured
// directives from the tiny function model — the app injects those itself.
import { LmsClient } from './client.mjs';
import { Predictor } from './predictor.mjs';
import { Interceptors } from './middleware.mjs';
import { PromptTemplate } from './templates.mjs';

export class Engine {
  /** @param {Parameters<typeof import('./config.mjs').makeConfig>[0]} [opts] */
  constructor(opts = {}) {
    this.client = new LmsClient(opts);
    this.predictor = new Predictor(this.client);
    this.interceptors = new Interceptors();
    /** @type {Map<string, PromptTemplate>} */
    this.templates = new Map();
  }

  /** Register an interceptor (koa-style). */
  use(mw) { this.interceptors.use(mw); return this; }

  /** Register a named prompt template. */
  template(name, tpl, defaults) { this.templates.set(name, new PromptTemplate(tpl, defaults)); return this; }
  /** Render a named template against context. */
  render(name, ctx) {
    const t = this.templates.get(name);
    if (!t) throw new Error(`unknown template: ${name}`);
    return t.render(ctx);
  }

  async health() {
    const h = await this.client.health();
    return { ...h, model: h.ok ? await this.client.chatModelName() : '' };
  }

  /** All downloaded LLMs for a picker. */
  models() { return this.client.listAvailable(); }
  /** Repoint the default chat / function roles at specific model keys. */
  setChatModel(key) { this.client.setChatModel(key); }
  setFunctionModel(key) { this.client.setFunctionModel(key); }

  /**
   * Streaming chat through the interceptor pipeline.
   * @param {Object} req  {role, system, input, temperature, maxTokens, draftModel, stopStrings, signal, meta}
   * @param {(text:string, meta:{reasoning:boolean})=>void} [onFragment]
   * @returns {Promise<{content:string, reasoning:string, stats:any, meta:any}>}
   */
  async chat(req, onFragment) {
    const ctx = {
      role: req.role || 'chat',
      system: req.system || '',
      input: req.input,
      opts: {
        temperature: req.temperature, maxTokens: req.maxTokens,
        draftModel: req.draftModel, stopStrings: req.stopStrings, signal: req.signal,
      },
      meta: req.meta || {},
      result: null,
    };
    await this.interceptors.run(ctx, async () => {
      ctx.result = await this.predictor.stream(
        { role: ctx.role, system: ctx.system, input: ctx.input, ...ctx.opts },
        onFragment);
    });
    return { ...ctx.result, meta: ctx.meta };
  }

  /**
   * Structured extraction (function model by default).
   * @param {Object} req {input, schema, system, role, maxTokens, temperature, signal}
   * @returns {Promise<any>}
   */
  extract(req) {
    return this.predictor.structured({
      role: req.role || 'function',
      system: req.system, input: req.input, schema: req.schema,
      maxTokens: req.maxTokens, temperature: req.temperature, signal: req.signal,
    });
  }

  /**
   * Agentic tool loop. `tools` are SDK tool() objects. `guard(req)` may return
   * 'allow' | {override} | {deny:reason} to gate/inject each call.
   * @param {Object} req {system, input, tools, role, maxRounds, temperature, maxTokens, signal}
   * @param {Object} [cb] {onFragment, onToolCall, onToolResult, onMessage}
   * @param {(name:string, args:any)=>('allow'|{override:any}|{deny:string})} [cb.guard]
   */
  async act(req, cb = {}) {
    const model = await this.client.model(req.role || 'chat');
    const { toChat } = await import('./predictor.mjs');
    const chat = toChat(req.system, req.input);
    return model.act(chat, req.tools || [], {
      temperature: req.temperature ?? 0.7,
      maxTokens: req.maxTokens,
      maxPredictionRounds: req.maxRounds ?? 5,
      signal: req.signal,
      onMessage: (m) => { chat.append(m); cb.onMessage?.(m); },
      onPredictionFragment: ({ content, reasoningType }) => {
        if (reasoningType === 'none') cb.onFragment?.(content);
      },
      onToolCallResult: (_r, id, result) => cb.onToolResult?.(id, result),
      guardToolCall: cb.guard
        ? (_r, _id, ctl) => {
            const verdict = cb.guard(ctl.toolCallRequest.name, ctl.toolCallRequest.arguments);
            if (verdict === 'allow' || verdict == null) ctl.allow();
            else if (verdict.override) ctl.allowAndOverrideParameters(verdict.override);
            else ctl.deny(verdict.deny || 'denied');
          }
        : undefined,
    });
  }
}
