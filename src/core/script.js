// @ts-check
// Generic step interpreter shared by world events (eventRunner) and cutscenes
// (cutscene/player). A script is an array of step objects {type, ...params};
// vocabularies register handlers. Handlers may be async; 'choice' steps resolve
// through a UI hook. One Script runs at a time per runner.

export class ScriptRunner {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
    /** @type {Record<string, (step:any, ctx:any) => Promise<any>|any>} */
    this.handlers = {};
    this.running = false;
    this.abortFlag = false;
  }

  /** @param {Record<string, (step:any, ctx:any) => Promise<any>|any>} map */
  register(map) {
    Object.assign(this.handlers, map);
  }

  /**
   * Run a step list with a context. Steps run sequentially; a handler's return
   * value is stored at ctx.last (usable by later steps, e.g. choice outcomes).
   * @param {any[]} steps
   * @param {any} ctx
   */
  async run(steps, ctx = {}) {
    if (this.running) throw new Error(`${this.name}: script already running`);
    this.running = true;
    this.abortFlag = false;
    try {
      for (const step of steps) {
        if (this.abortFlag) break;
        const handler = this.handlers[step.type];
        if (!handler) {
          console.warn(`[${this.name}] no handler for step type "${step.type}"`);
          continue;
        }
        ctx.last = await handler(step, ctx);
        // a handler can branch by returning {steps: [...]}
        if (ctx.last && Array.isArray(ctx.last.steps)) {
          for (const s of ctx.last.steps) {
            if (this.abortFlag) break;
            const h = this.handlers[s.type];
            if (h) ctx.last = await h(s, ctx);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  abort() { this.abortFlag = true; }
}

/** shared tiny helper for handler authors */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
