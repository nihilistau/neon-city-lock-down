// @ts-check
// One place that owns "which panel is open".
//
// WHY THIS EXISTS
// Every panel installed its own `keydown` listener and its own
// `loop.pause('<its-own-name>')` token. Three problems followed:
//
//   1. Pause tokens leaked. Opening Esc, I, K, P, G in sequence left FIVE
//      reasons held; closing one panel dropped only its own, so the sim stayed
//      frozen behind panels the player had already dismissed.
//   2. Esc was not a universal "back" — only the save menu listened for it, so
//      pressing Esc over the Creation Kit opened the pause menu ON TOP of it.
//   3. Nothing enforced one-at-a-time, so overlays stacked and ordered by DOM
//      insertion. The elevator picker could render above the pause menu with no
//      way to dismiss either — a genuine soft-lock.
//
// Each panel's own pause/resume pair is already balanced; the leak came purely
// from stacking. So this deliberately does NOT take over pause management — it
// enforces one-open-at-a-time (which makes the existing tokens balance) and
// owns the Escape key.
import { emit } from '../core/bus.js';

/** @typedef {{ id: string, close: () => void }} ModalEntry */

/** @type {ModalEntry[]} */
const stack = [];

/** Wire the global Escape handler. Call once at boot. */
export function initModalStack() {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    // never steal Escape from a field the player is typing in
    if (e.target instanceof HTMLInputElement
      || e.target instanceof HTMLTextAreaElement
      || e.target instanceof HTMLSelectElement) return;
    if (!stack.length) return;   // nothing open — let the save menu's own handler open it
    e.preventDefault();
    e.stopPropagation();
    closeTopModal();
  }, true);   // capture: decide before any panel's own handler runs
}

/**
 * Declare a panel open. Closes whatever else was open first, so there is only
 * ever one — which is what keeps the pause tokens balanced and the z-order sane.
 * @param {string} id
 * @param {() => void} close idempotent teardown for this panel
 */
export function openModal(id, close) {
  if (stack.some((m) => m.id === id)) return;
  for (const other of [...stack].reverse()) closeModal(other.id);
  stack.push({ id, close });
  emit('modal.opened', { id });
}

/**
 * Declare a panel closed. Safe to call when it isn't open, and safe to call
 * re-entrantly from the panel's own close() — the entry is removed before
 * close() runs, so the recursive call is a no-op.
 * @param {string} id
 */
export function closeModal(id) {
  const i = stack.findIndex((m) => m.id === id);
  if (i === -1) return;
  const [entry] = stack.splice(i, 1);
  try { entry.close(); } catch (err) { console.error('[modal] close failed', id, err); }
  emit('modal.closed', { id });
}

/** Close the topmost open panel. @returns {boolean} true if something closed */
export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  closeModal(top.id);
  return true;
}

/** Close everything — e.g. on death or when a cutscene takes over. */
export function closeAllModals() {
  for (const m of [...stack].reverse()) closeModal(m.id);
}

/** @returns {boolean} is any panel open? */
export function isModalOpen() { return stack.length > 0; }

/** @returns {string|null} id of the topmost panel */
export function topModal() { return stack.length ? stack[stack.length - 1].id : null; }
