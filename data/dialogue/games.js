// @ts-check
// The door to the minigames.
//
// 39 bed actions, 42 truth-or-dare prompts, a full card game and three mystery
// cases shipped with exactly two ways in: pick a scenario on the new-run screen,
// or open the debug Director panel. Nothing a player could do INSIDE a run
// reached any of it. This is the single largest pool of unreachable content in
// the repo, and the fix is not a new system — it is asking someone to play,
// which is how a person would start a game anyway.
//
// Each topic sets `effects.game`, which src/dialogue/effects.js turns into a
// `game.requested` event and src/core/app.js acts on. Consent for the bed game
// is NOT decided here: BedGame.start() owns it and refuses with an in-character
// line, so a topic can offer without being able to force.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';
import { registerIntents } from '../../src/dialogue/parser/intents.js';

registerIntents([
  { id: 'play_cards', keywords: ['cards', 'deck', 'deal', 'poker', 'hand'],
    phrases: ['play cards', 'a game of cards', 'deal me in', 'play a hand', 'fancy a game'], base: 0.6 },
  { id: 'play_tod', keywords: ['dare', 'truth'],
    phrases: ['truth or dare', 'play a game', 'lets play', 'play truth'], base: 0.6 },
  { id: 'go_to_bed', keywords: ['bed'],
    phrases: ['come to bed', 'take me to bed', 'go to bed', 'lets go to bed', 'bed with me'], base: 0.7 },
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

  // ── truth or dare ───────────────────────────────────────────────────────
  // Wants a little warmth first; a stranger asking is just a stranger asking.
  // Lola's refusal is deliberately NOT gated behind the same cond as her
  // acceptance — a topic that fails to match reads as the parser not
  // understanding you, whereas being turned down is a real answer. The topic
  // therefore has no `cond`, and the openness check lives on the accepting
  // LINE. The refusal must not carry effects.game or it would open the game
  // while she is declining, which is why this one topic sets it per-line.
  topic('lola.games.tod', {
    char: 'lola', priority: 7, cooldownMin: 30,
    triggers: [onIntent('play_tod', 0.45)],
    lines: [
      { when: { statGte: { openness: 30 } },
        text: "[[face:smirk]] [[look:player]] Truth or dare. In a siege. [[beat:0.5]] Fine. But you go first, and you don't get to lie.",
        fx: { openness: 3, arousal: 2 }, game: 'tod' },
      { when: { statLte: { openness: 29 } },
        text: "[[face:neutral]] Ask me that again when I know you better.",
        fx: { tension: 1 } },
    ],
  }),
  gameTopic('aria', 'aria.games.tod', 'play_tod', 'tod', [
    { text: "[[face:smile]] [[look:player]] Truth or dare? God. Yes. Anything that isn't the news.",
      fx: { happiness: 4, openness: 3, fear: -3 } },
  ], { cond: { minStat: { trust: 20 } } }),
  gameTopic('kai', 'kai.games.tod', 'play_tod', 'tod', [
    { text: "[[look:player]] [[face:smirk]] I'm bad at this game because I answer honestly. Go on then.",
      fx: { openness: 3 } },
  ], { cond: { minStat: { openness: 25 } } }),

  // ── bed ─────────────────────────────────────────────────────────────────
  // Deliberately no `cond` here. The gate ladder is BedGame's job, and it
  // refuses in character — being turned down is a real answer and belongs in
  // the fiction, whereas a topic that silently fails to match reads as the
  // parser not understanding you.
  gameTopic('lola', 'lola.games.bed', 'go_to_bed', 'bed', [
    { text: "[[face:smirk]] [[look:player]] Took you long enough to ask.", fx: { arousal: 4 } },
  ], { cooldownMin: 5 }),
  gameTopic('aria', 'aria.games.bed', 'go_to_bed', 'bed', [
    { text: "[[face:smile]] [[look:player]] [[beat:0.5]] Okay. Yes. Don't let go of my hand.", fx: { arousal: 4, trust: 2 } },
  ], { cooldownMin: 5 }),
  gameTopic('kai', 'kai.games.bed', 'go_to_bed', 'bed', [
    { text: "[[look:player]] You're sure? [[beat:0.5]] Good. So am I.", fx: { arousal: 4 } },
  ], { cooldownMin: 5 }),
]);
