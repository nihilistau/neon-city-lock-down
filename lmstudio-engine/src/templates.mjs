// @ts-check
// A compact Jinja-flavoured template engine (no deps) for authoring persona /
// system prompts as templates. Supports:
//   {{ path.to.value | filter }}         interpolation with filters
//   {% if expr %}…{% elif expr %}…{% else %}…{% endif %}
//   {% for item in list %}…{% endfor %}  (loop.index0/index/first/last, loop.length)
//   {# comment #}
// Expressions: dotted paths, string/number/bool/null literals, and the operators
// == != < <= > >= and or not (…) plus plain truthiness. Intentionally small and
// predictable — enough to render rich, conditional persona prompts.

const FILTERS = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  capitalize: (v) => { const s = String(v); return s.charAt(0).toUpperCase() + s.slice(1); },
  trim: (v) => String(v).trim(),
  round: (v, n = 0) => Number(v).toFixed(Number(n)),
  join: (v, sep = ', ') => (Array.isArray(v) ? v.join(sep) : String(v)),
  default: (v, d = '') => (v == null || v === '' ? d : v),
  length: (v) => (v == null ? 0 : (v.length ?? Object.keys(v).length)),
  json: (v) => JSON.stringify(v),
};

/** Resolve a dotted path against a scope stack (innermost first). */
function resolvePath(path, scopes) {
  const parts = path.split('.');
  for (let i = scopes.length - 1; i >= 0; i--) {
    let cur = scopes[i];
    if (cur == null || !(parts[0] in Object(cur))) continue;
    let ok = true;
    for (const p of parts) {
      if (cur == null) { ok = false; break; }
      cur = cur[p];
    }
    if (ok) return cur;
  }
  return undefined;
}

/** Evaluate a single value token: literal or path. */
function evalToken(tok, scopes) {
  tok = tok.trim();
  if (tok === 'true') return true;
  if (tok === 'false') return false;
  if (tok === 'null' || tok === 'none') return null;
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (/^"(.*)"$/.test(tok) || /^'(.*)'$/.test(tok)) return tok.slice(1, -1);
  return resolvePath(tok, scopes);
}

const COMPARE = {
  '==': (a, b) => a === b, '!=': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};

/** Evaluate a boolean-ish expression with and/or/not and comparisons. */
function evalExpr(expr, scopes) {
  expr = expr.trim();
  // parentheses
  const paren = /\(([^()]+)\)/;
  while (paren.test(expr)) expr = expr.replace(paren, (_m, inner) => JSON.stringify(evalExpr(inner, scopes)));
  // or / and (low → high precedence)
  if (/\bor\b/.test(expr)) return expr.split(/\bor\b/).some((p) => evalExpr(p, scopes));
  if (/\band\b/.test(expr)) return expr.split(/\band\b/).every((p) => evalExpr(p, scopes));
  const notM = /^not\s+(.+)$/.exec(expr);
  if (notM) return !evalExpr(notM[1], scopes);
  const cmp = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(expr);
  if (cmp) return COMPARE[cmp[2]](evalToken(cmp[1], scopes), evalToken(cmp[3], scopes));
  const v = evalToken(expr, scopes);
  if (typeof v === 'string' && (v === 'true' || v === 'false')) return v === 'true';
  return !!v && !(Array.isArray(v) && v.length === 0);
}

/** Render an interpolation `expr | filter:arg`. */
function renderInterp(body, scopes) {
  const [head, ...filterParts] = body.split('|');
  let val = evalToken(head, scopes);
  for (const fp of filterParts) {
    const [name, ...args] = fp.trim().split(':');
    const f = FILTERS[name.trim()];
    if (f) val = f(val, ...args.map((a) => evalToken(a, scopes)));
  }
  return val == null ? '' : String(val);
}

// ── tokenizer → flat token list ──
function tokenize(src) {
  const re = /\{\{(.+?)\}\}|\{%(.+?)%\}|\{#[\s\S]*?#\}/g;
  const toks = [];
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) toks.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] != null) toks.push({ t: 'interp', v: m[1].trim() });
    else if (m[2] != null) toks.push({ t: 'tag', v: m[2].trim() });
    // comments dropped
    last = m.index + m[0].length;
  }
  if (last < src.length) toks.push({ t: 'text', v: src.slice(last) });
  return toks;
}

// ── recursive renderer over the token stream ──
function renderBlock(toks, i, scopes, stopTags) {
  let out = '';
  while (i < toks.length) {
    const tok = toks[i];
    if (tok.t === 'text') { out += tok.v; i++; continue; }
    if (tok.t === 'interp') { out += renderInterp(tok.v, scopes); i++; continue; }
    // tag
    const [kw, ...rest] = tok.v.split(/\s+/);
    if (stopTags && stopTags.includes(kw)) return { out, i, kw };
    if (kw === 'if') {
      const r = renderIf(toks, i, scopes);
      out += r.out; i = r.i; continue;
    }
    if (kw === 'for') {
      const r = renderFor(toks, i, scopes);
      out += r.out; i = r.i; continue;
    }
    // unknown tag → skip
    i++;
  }
  return { out, i, kw: null };
}

function renderIf(toks, i, scopes) {
  const branches = [];
  let cond = toks[i].v.replace(/^if\s+/, '');
  i++;
  let cur = { cond, start: i };
  const stop = ['elif', 'else', 'endif'];
  while (true) {
    const r = renderBlock(toks, i, scopes, stop);
    cur.rendered = r.out; cur.i = r.i;
    branches.push(cur);
    i = r.i;
    const kw = r.kw;
    if (kw === 'endif' || kw == null) { i++; break; }
    if (kw === 'elif') { cond = toks[i].v.replace(/^elif\s+/, ''); i++; cur = { cond, start: i }; continue; }
    if (kw === 'else') { i++; cur = { cond: 'true', start: i }; continue; }
  }
  for (const b of branches) if (evalExpr(b.cond, scopes)) return { out: b.rendered, i };
  return { out: '', i };
}

function renderFor(toks, i, scopes) {
  const m = /^for\s+(\w+)\s+in\s+(.+)$/.exec(toks[i].v);
  i++;
  const bodyStart = i;
  const list = m ? evalToken(m[2], scopes) : [];
  const arr = Array.isArray(list) ? list : (list ? Object.values(list) : []);
  let out = '', endI = i;
  if (!arr.length) {
    const r = renderBlock(toks, bodyStart, [...scopes, {}], ['endfor']);
    return { out: '', i: r.i + 1 };
  }
  arr.forEach((item, idx) => {
    const loop = { index0: idx, index: idx + 1, first: idx === 0, last: idx === arr.length - 1, length: arr.length };
    const r = renderBlock(toks, bodyStart, [...scopes, { [m[1]]: item, loop }], ['endfor']);
    out += r.out; endI = r.i;
  });
  return { out, i: endI + 1 };
}

/**
 * Render a template string against a data object.
 * @param {string} template
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function render(template, data = {}) {
  const toks = tokenize(template);
  return renderBlock(toks, 0, [data], null).out;
}

/**
 * A reusable persona template: holds the template text + optional defaults,
 * renders against per-turn context.
 */
export class PromptTemplate {
  /** @param {string} template @param {Record<string,any>} [defaults] */
  constructor(template, defaults = {}) {
    this.template = template;
    this.defaults = defaults;
  }
  /** @param {Record<string,any>} ctx */
  render(ctx = {}) { return render(this.template, { ...this.defaults, ...ctx }).replace(/\n{3,}/g, '\n\n').trim(); }
}
