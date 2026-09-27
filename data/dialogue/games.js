// @ts-check
// The door to the minigames.
//
// A full card game and three mystery cases shipped with exactly two ways in:
// pick a scenario on the new-run screen, or open the debug Director panel.
// Nothing a player could do INSIDE a run reached any of it. This is a large
// pool of unreachable content in the repo, and the fix is not a new system —
// it is asking someone to play, which is how a person would start a game
// anyway.
//
// Each topic sets `effects.game`, which src/dialogue/effects.js turns into a
// `game.requested` event and src/core/app.js acts on.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';
import { registerIntents } from '../../src/dialogue/parser/intents.js';

registerIntents([
  { id: 'play_cards', keywords: ['cards', 'deck', 'deal', 'poker', 'hand'],
    phrases: ['play cards', 'a game of cards', 'deal me in', 'play a hand', 'fancy a game'], base: 0.6 },
]);

/**
 * @param {string} char @param {string} id @param {string} intent
 * @param {string} game @param {{text:string, fx?:any, when?:any}[]} lines
 * @param {any} [extra] additional topic fields (priority, cooldown, cond)
 */
const gameTopic = (char, id, intent, game, lines, extra = {}) => topic(id, {
  char, priority: 7, cooldownMin: 30,
  triggers: [onIntent(intent, 0.45)],
  effects: { game },
  lines,
  ...extra,
});

registerTopics([
  // ── cards ───────────────────────────────────────────────────────────────
  // Kai's game, by temperament — he's the one who counts things.
  gameTopic('kai', 'kai.games.cards', 'play_cards', 'cards', [
    { when: { statGte: { trust: 30 } },
      text: "[[anim:sit_relaxed]] [[look:player]] You want to lose money to me? Sit down. I'll be gentle. [[face:smirk]]",
      fx: { happiness: 3, trust: 1 } },
    { text: "[[look:player]] Cards. Sure. Beats listening to the street. [[anim:sit_relaxed]]",
      fx: { happiness: 2 } },
  ]),
  gameTopic('lola', 'lola.games.cards', 'play_cards', 'cards', [
    { text: "[[face:smirk]] [[look:player]] I don't play for matchsticks. But it's a long night — deal.",
      fx: { happiness: 2, tension: -2 } },
  ]),
  gameTopic('aria', 'aria.games.cards', 'play_cards', 'cards', [
    { text: "[[face:smile]] [[look:player]] Oh — yes. Please. Something with rules for five minutes.",
      fx: { happiness: 4, fear: -2, tension: -3 } },
  ]),
]);
