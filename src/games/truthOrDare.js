// @ts-check
// Truth or Dare engine. Rotating turns among present cast + player. Prompts are
// filtered by gate/explicitness; refusals cost compliance/trust, completions
// shift stats. A round can organically escalate the whole room.
import { TRUTHS, DARES } from '../../data/games/todPrompts.js';
import { tierIndex } from '../chars/gates.js';
import { emit } from '../core/bus.js';
import { feed } from '../core/log.js';

const CAP_TIER = { suggestive: 2, mature: 4, full: 5 };
const TIER_GATE = { 1: null, 2: 'light_touch', 3: 'kiss', 4: 'touch', 5: 'intimate' };

export class TruthOrDare {
  /**
   * @param {Object} deps
   * @param {() => import('../chars/character.js').Character[]} deps.players present cast
   * @param {() => string} deps.explicitness
   * @param {() => number} deps.nowMinute
   * @param {string} deps.playerName
   * @param {import('../core/rng.js').RngStream} deps.rng
   */
  constructor(deps) {
    this.d = deps;
    this.active = false;
    this.turnIdx = 0;
    this.roundTier = 1;   // creeps up as the game heats
    this.usedTruths = new Set();
    this.usedDares = new Set();
  }

  start() {
    this.active = true;
    this.turnIdx = 0;
    this.roundTier = 1;
    this.usedTruths.clear();
    this.usedDares.clear();
    // order: player first, then present cast
    this._order = ['__player__', ...this.d.players().map((c) => c.id)];
    feed('Truth or Dare. The whiskey comes out. The room leans in.', 'gate');
    emit('tod.started', { players: this._order });
    return this.turn();
  }

  turn() {
    const who = this._order[this.turnIdx % this._order.length];
    const isPlayer = who === '__player__';
    return {
      who, isPlayer,
      name: isPlayer ? this.d.playerName : this.d.players().find((c) => c.id === who)?.name,
      tier: this.roundTier,
    };
  }

  /** draw a prompt of the given kind at/below the current tier + caps */
  draw(kind) {
    const pool = kind === 'truth' ? TRUTHS : DARES;
    const used = kind === 'truth' ? this.usedTruths : this.usedDares;
    const cap = CAP_TIER[this.d.explicitness()];
    const maxTier = Math.min(this.roundTier, cap);
    const eligible = pool.filter((p) => p.tier <= maxTier && !used.has(p.id));
    const fallback = pool.filter((p) => p.tier <= maxTier);
    const choice = this.d.rng.pick(eligible.length ? eligible : fallback);
    used.add(choice.id);
    emit('tod.prompt', { kind, prompt: choice });
    return choice;
  }

  /** resolve the current turn: 'complete' or 'refuse' */
  resolve(prompt, outcome, targetId) {
    const who = this._order[this.turnIdx % this._order.length];
    const isPlayer = who === '__player__';
    const actor = isPlayer ? null : this.d.players().find((c) => c.id === who);

    if (outcome === 'complete') {
      if (actor) actor.applyStats(prompt.fx, `tod:${prompt.id}`);
      // a dare aimed at someone lands on the target too
      if (targetId && this.d.players().find((c) => c.id === targetId)) {
        this.d.players().find((c) => c.id === targetId).applyStats(
          Object.fromEntries(Object.entries(prompt.fx).map(([k, v]) => [k, v * 0.6])), 'tod:target');
      }
      feed(`${isPlayer ? this.d.playerName : actor.name} goes through with it.`, 'gate');
      // completions heat the room
      if (prompt.tier >= this.roundTier && this.d.rng.chance(0.55)) this.roundTier = Math.min(5, this.roundTier + 1);
    } else {
      if (actor) actor.applyStats({ trust: -3, tension: 3, openness: -2 }, 'tod:refuse');
      feed(`${isPlayer ? this.d.playerName : actor.name} refuses. The room notices.`, 'dialogue');
    }
    this.turnIdx++;
    emit('tod.resolved', { outcome, next: this.turn() });
    return this.turn();
  }

  /** NPC auto-picks truth or dare + auto-resolves (when it's their turn) */
  autoTurn() {
    const who = this._order[this.turnIdx % this._order.length];
    if (who === '__player__') return null;
    const actor = this.d.players().find((c) => c.id === who);
    if (!actor) { this.turnIdx++; return this.turn(); }
    // bold characters pick dare; guarded pick truth
    const kind = actor.stats.dominance + actor.stats.openness > 90 ? 'dare' : 'truth';
    const prompt = this.draw(kind);
    // decide to complete based on compliance + how spicy it is
    const willing = actor.compliance > (prompt.tier * 12);
    const outcome = willing ? 'complete' : 'refuse';
    feed(`${actor.name} picks ${kind}: "${prompt.text}"`, 'dialogue');
    return { auto: true, prompt, kind, result: this.resolve(prompt, outcome) };
  }

  end() {
    this.active = false;
    feed('The game breaks up, everyone a little more exposed than before.', 'gate');
    emit('tod.ended', {});
  }
}
