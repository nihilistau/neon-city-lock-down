// @ts-check
// A koa-style middleware/interceptor pipeline wrapping every prediction, so
// callers can decorate generation with cross-cutting concerns: prompt
// rewriting, logging, timing, retries, token filtering, guardrails, caching.
//
// A middleware is `async (ctx, next) => { …before…; await next(); …after… }`.
// `ctx` is mutable and shared down the chain:
//   { role, system, input, opts, meta, result, cancelled }
// Before `next()`: mutate ctx.system / ctx.input / ctx.opts to shape the request.
// After `next()`: read/adjust ctx.result (the final text + stats + tags).

export class Interceptors {
  constructor() {
    /** @type {Array<(ctx:any, next:()=>Promise<void>)=>Promise<void>>} */
    this._mw = [];
  }

  /** Register a middleware. Returns `this` for chaining. */
  use(fn) { this._mw.push(fn); return this; }

  /** Run the chain around a terminal `action(ctx)` that performs the prediction. */
  async run(ctx, action) {
    let idx = -1;
    const dispatch = async (i) => {
      if (i <= idx) throw new Error('next() called multiple times');
      idx = i;
      const fn = i === this._mw.length ? action : this._mw[i];
      if (fn) await fn(ctx, () => dispatch(i + 1));
    };
    await dispatch(0);
    return ctx;
  }
}

// ── a few ready-made interceptors ──

/** Time each prediction; writes ms + tps into ctx.meta. */
export function timing(log = null) {
  return async (ctx, next) => {
    const t0 = Date.now();
    await next();
    ctx.meta.latencyMs = Date.now() - t0;
    if (log) log(`[engine] ${ctx.role} ${ctx.meta.latencyMs}ms · ${ctx.result?.stats?.tokensPerSecond?.toFixed?.(0) || '?'} tps`);
  };
}

/** Retry a failed prediction up to `n` times (fresh attempt each time). */
export function retry(n = 1) {
  return async (ctx, next) => {
    let lastErr;
    for (let attempt = 0; attempt <= n; attempt++) {
      try { await next(); return; } catch (e) { lastErr = e; ctx.result = null; }
    }
    throw lastErr;
  };
}

/** Prepend/rewrite the system prompt via a function of ctx. */
export function systemRewrite(fn) {
  return async (ctx, next) => { ctx.system = fn(ctx) ?? ctx.system; await next(); };
}

/** Observe the final result (read-only hook). */
export function observe(fn) {
  return async (ctx, next) => { await next(); try { fn(ctx); } catch { /* observer only */ } };
}
