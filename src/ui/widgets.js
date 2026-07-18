// @ts-check
// Tiny hyperscript helper — no framework. h(tag, props, children).
// props: attributes + on<Event> handlers + style/class strings.

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = v;
    } else if (k === 'style') {
      el.style.cssText = v;
    } else if (k === 'disabled') {
      if (v) el.setAttribute('disabled', '');
    } else {
      el.setAttribute(k, v);
    }
  }
  for (const c of children) {
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
