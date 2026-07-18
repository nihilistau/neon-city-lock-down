// @ts-check
// Tool helpers. Re-exports the SDK's `tool()` + `zod`, and a tiny registry for
// grouping named tools. Tools are used by Engine.act() (auto agentic loop) or
// passed straight to the SDK. Each tool: { name, description, parameters:{zod},
// implementation:(args, ctx)=>result }.
export { tool } from '@lmstudio/sdk';
export { z } from 'zod';

export class ToolRegistry {
  constructor() { /** @type {Map<string, import('@lmstudio/sdk').Tool>} */ this._tools = new Map(); }
  /** @param {import('@lmstudio/sdk').Tool} t */
  add(t) { this._tools.set(t.name ?? String(this._tools.size), t); return this; }
  get(name) { return this._tools.get(name); }
  list() { return [...this._tools.values()]; }
  /** Return a subset by name (for scoping which tools a turn may use). */
  pick(names) { return names.map((n) => this._tools.get(n)).filter(Boolean); }
}
