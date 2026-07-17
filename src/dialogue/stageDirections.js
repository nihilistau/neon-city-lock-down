// @ts-check
// Inline stage-direction grammar. Line text carries [[type:arg:arg2]] tags; at
// load they compile to { cleanText, directions:[{at, type, args}] } where `at` is
// the character offset in cleanText (so a direction fires when the typewriter
// reaches it). Unknown tags throw at compile time — content errors never ship.

/** Closed tag vocabulary → arg count validation ('+' = variadic, '*' = 0+). */
export const TAG_TYPES = {
  anim: 1, face: '+', mood: 1, look: 1, move: 1, sit: 1, pair: '+',
  outfit: 1, light: '+', cam: 1, sfx: 1, vox: 1, gate: '+', wait: 1, fx: 1, beat: 1,
};

const TAG_RE = /\[\[([a-z]+)((?::[^\]]*)?)\]\]/g;

/**
 * @param {string} text
 * @returns {import('../core/types.js').CompiledLine}
 */
export function compileLine(text) {
  /** @type {import('../core/types.js').StageDirection[]} */
  const directions = [];
  let clean = '';
  let lastIndex = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    clean += text.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;
    const type = m[1];
    if (!(type in TAG_TYPES)) throw new Error(`unknown stage tag [[${type}]] in: ${text}`);
    const args = m[2] ? m[2].slice(1).split(':') : [];
    const arity = TAG_TYPES[type];
    if (arity === '+' && args.length < 1) throw new Error(`[[${type}]] needs >=1 arg in: ${text}`);
    if (typeof arity === 'number' && args.length !== arity) {
      throw new Error(`[[${type}]] needs ${arity} arg(s), got ${args.length} in: ${text}`);
    }
    directions.push({ at: clean.length, type, args });
  }
  clean += text.slice(lastIndex);
  return { cleanText: clean.replace(/\s+/g, ' ').trim(), directions };
}

/**
 * A dispatcher turns a compiled direction into engine calls. The engine builds
 * one bound to a specific speaking character; this factory keeps the vocabulary
 * in one place. Missing handlers warn (not throw) so partial wiring still runs.
 * @param {Object} ctx
 * @param {import('../chars/character.js').Character} ctx.speaker
 * @param {Record<string, import('../chars/character.js').Character>} ctx.cast
 * @param {any} ctx.world @param {any} ctx.lighting @param {any} ctx.audio
 * @param {any} ctx.cutscene @param {(id:string)=>void} [ctx.onBeat]
 * @param {number} ctx.nowMinute
 */
export function makeDispatcher(ctx) {
  const { speaker } = ctx;
  return /** @param {import('../core/types.js').StageDirection} d */ (d) => {
    const a = d.args;
    switch (d.type) {
      case 'anim':
        speaker.queue.pushPriority({ type: 'playClip', args: [a[0], 0.3] });
        break;
      case 'face':
        speaker.actor.face.setExpression(parseFace(a));
        break;
      case 'mood':
        // a soft nudge; real mood derives from stats, this biases the face now
        speaker.actor.face.setExpression({ mouth: a[0] });
        break;
      case 'look': {
        const target = resolveTarget(a[0], ctx);
        if (target) speaker.actor.lookAt(target);
        break;
      }
      case 'move':
        speaker.queue.goto(a[0]);
        break;
      case 'sit':
        speaker.queue.sit(a[0]);
        break;
      case 'pair': {
        const tier = a[2];
        speaker.queue.push({ type: 'playClip', args: [a[0], 0.4], gateTier: tier });
        break;
      }
      case 'outfit':
        if (speaker.wardrobe) speaker.wardrobe.change(a[0]);
        break;
      case 'light':
        ctx.lighting?.apply(a[0], a[1] ? Number(a[1]) : 1.2);
        break;
      case 'cam':
        ctx.cutscene?.shot?.(a[0]);
        break;
      case 'sfx':
        ctx.audio?.sfx?.(a[0]);
        break;
      case 'vox':
        ctx.audio?.vox?.(a[0]);
        break;
      case 'gate': {
        // gate:offer:kiss  |  gate:grant:kiss  |  gate:revoke:touch
        const [action, tier] = a;
        speaker.gate(tier, action, ctx.nowMinute);
        break;
      }
      case 'fx':
        ctx.world?.particles?.(a[0], speaker.actor.root.position);
        break;
      case 'beat':
        ctx.onBeat?.(a[0]);
        break;
      case 'wait':
        // handled by the typewriter pacing, not here
        break;
    }
  };
}

/** @param {string[]} args e.g. ['smirk','0.6'] or ['blush','0.4'] */
function parseFace(args) {
  const [expr, intensity] = args;
  const i = intensity != null ? Number(intensity) : undefined;
  const EXPR = ['smile', 'smirk', 'grin', 'frown', 'pout', 'open', 'grit', 'neutral'];
  if (EXPR.includes(expr)) return { mouth: expr };
  if (expr === 'blush') return { blush: i ?? 0.6 };
  if (expr === 'wink') return { lids: 0.5, mouth: 'smirk' };
  if (expr === 'brow') return { browRaise: i ?? 0.5 };
  if (expr === 'glare') return { browAngle: -0.7, browRaise: -0.5, mouth: 'grit' };
  return { mouth: 'neutral' };
}

/** @param {string} ref @param {any} ctx */
function resolveTarget(ref, ctx) {
  if (ref === 'player') return ctx.playerMarker || null;
  const c = ctx.cast[ref];
  return c ? c.actor.root : null;
}
