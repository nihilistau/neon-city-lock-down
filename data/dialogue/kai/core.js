// @ts-check
// Kai Mercer — core pack. Measured, amused, always three moves ahead. His
// interjection topics fire when the player works the others (he watches).
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';
import { registerFallbacks } from '../../../src/dialogue/interject.js';

registerTopics([
  topic('kai.core.greet', {
    char: 'kai', priority: 4, cooldownMin: 20,
    triggers: [onIntent('greet', 0.4)],
    lines: [
      { when: { statLte: { trust: 30 } },
        text: "[[face:smirk]] [[look:player]] Ah. The famous {player}. I've sold rumors about you for good money. Shall I tell you which ones were true?",
        fx: { trust: 1 } },
      { when: { statGte: { trust: 55 } },
        text: "[[face:smile:0.3]] [[anim:gesture_lean_in]] There you are. I was just thinking the evening needed better company.",
        fx: { happiness: 2 } },
      { text: "[[face:smirk]] Evening. [[look:player]] Don't mind me — I'm just enjoying the show. Everyone in this tower is a show.",
        fx: { trust: 1 } },
    ],
  }),

  topic('kai.core.name', {
    char: 'kai', priority: 3,
    triggers: [onIntent('name', 0.4)],
    lines: [
      { text: "[[face:smirk]] Kai Mercer. Broker of introductions, secrets, and the occasional miracle. [[anim:gesture_shrug]] My card would say 'consultant', if cards weren't traceable.",
        fx: { openness: 1 } },
    ],
  }),

  topic('kai.core.howareyou', {
    char: 'kai', priority: 3,
    triggers: [onIntent('howareyou', 0.4)],
    lines: [
      { text: "[[face:smile:0.2]] Comfortable. [[look:player]] Which in a city on fire is either wisdom or sociopathy. I let people decide for themselves.",
        fx: { openness: 1 } },
    ],
  }),

  topic('kai.back.who', {
    char: 'kai', priority: 5, cooldownMin: 40,
    triggers: [onIntent('ask_past', 0.4)],
    cond: { notFlag: 'kai_told_past' },
    lines: [
      { when: { statLte: { trust: 35 } },
        text: "[[face:smirk]] My past? [[anim:gesture_shrug]] I'm a middleman. The middle is a very safe place to stand — everyone needs you and no one aims at you first.",
        fx: { openness: 1 } },
      { text: "[[look:player]] [[face:neutral]] I broker information between people who'd rather kill each other than talk. Factions, syndicates, the tower boards. [[face:smirk]] I came up here to watch the city burn from a comfortable chair. I confess the company has exceeded expectations.",
        fx: { trust: 3, openness: 2 } },
    ],
    effects: { setFlag: 'kai_told_past' },
    branches: [
      { chip: "Who do you work for?", goto: 'kai.back.masters' },
      { chip: "What do you know about me?", goto: 'kai.back.dossier' },
    ],
  }),

  topic('kai.back.masters', {
    char: 'kai', priority: 4,
    triggers: [onIntent('ask_past', 0.2)],
    cond: { flag: 'kai_told_past' },
    lines: [
      { text: "[[face:smirk]] Everyone. No one. [[anim:gesture_shrug]] Loyalty is a subscription service, and all my clients are behind on payments. [[look:player]] Right now? I work for whoever keeps this tower interesting.",
        fx: { openness: 2 } },
    ],
  }),

  topic('kai.back.dossier', {
    char: 'kai', priority: 5,
    triggers: [onIntent('ask_past', 0.2)],
    cond: { flag: 'kai_told_past' },
    lines: [
      { text: "[[anim:gesture_lean_in]] [[face:smirk]] About you? The ghost who cracked the Meridian vaults. The myth the syndicates blame when anything goes wrong. [[face:neutral]] Half the stories are impossible. [[look:player]] Which is what makes the other half so valuable.",
        fx: { trust: 2, openness: 2 } },
    ],
    effects: { fact: { knows_player_rep: true } },
  }),

  topic('kai.world.lockdown', {
    char: 'kai', priority: 4,
    triggers: [onIntent('ask_lockdown', 0.4)],
    lines: [
      { text: "[[face:neutral]] [[look:player]] Three factions, one grid, no adults in the room. The barricades will hold a week. The food riots start before that. [[face:smirk]] I'd say I hate being right, but we both know better.",
        fx: { openness: 2 } },
    ],
  }),

  topic('kai.world.plan', {
    char: 'kai', priority: 4,
    triggers: [onIntent('ask_plan', 0.4)],
    lines: [
      { text: "[[face:smirk]] Plans are for people without information. [[anim:gesture_lean_in]] I know which faction wins. I know when the gates open. [[look:player]] Stay useful to me and you'll know it too — about an hour before everyone else.",
        fx: { tension: 2, openness: 1 } },
    ],
  }),

  topic('kai.flirt.opening', {
    char: 'kai', priority: 6, cooldownMin: 15,
    triggers: [onIntent('flirt', 0.5), onIntent('compliment', 0.7)],
    cond: { minStat: { trust: 20 } },
    lines: [
      { when: { statGte: { arousal: 40 } },
        text: "[[face:smirk]] [[anim:gesture_lean_in]] [[look:player]] Careful. I collect weaknesses professionally, and you're volunteering yours. [[face:smile:0.3]] ...Keep volunteering.",
        fx: { arousal: 6, horniness: 4 } },
      { text: "[[face:smile:0.3]] [[look:player]] Flattery, from you. Now that's a data point I'll be turning over all night.",
        fx: { arousal: 4, trust: 2 } },
    ],
    effects: { counter: 'flirts' },
  }),

  topic('kai.conflict.threaten', {
    char: 'kai', priority: 9,
    triggers: [onIntent('threaten', 0.5)],
    lines: [
      { text: "[[face:neutral]] [[look:player]] Mm. A threat. [[face:smirk]] I've been threatened by professionals, {player} — people with org charts and budgets for it. [[anim:gesture_shrug]] You're better than that. And I'm more useful alive.",
        fx: { tension: 5, trust: -4 } },
    ],
  }),

  topic('kai.conflict.insult', {
    char: 'kai', priority: 8,
    triggers: [onIntent('insult', 0.5)],
    lines: [
      { text: "[[face:smile:0.2]] [[look:player]] Noted, logged, filed. [[face:smirk]] I keep a ledger of everyone who's underestimated me. It's a very profitable document.",
        fx: { tension: 3, trust: -3 } },
    ],
  }),

  // Interjections — Kai comments when the player works the room
  topic('kai.watch.flirt', {
    char: 'kai', priority: 2, cooldownMin: 30,
    triggers: [onIntent('flirt', 0.8), onIntent('compliment', 1.0)],
    lines: [
      { text: "[[face:smirk]] Don't mind me. I'm merely taking notes on technique.",
        fx: {} },
      { text: "[[face:smile:0.2]] Ah, the legend has a soft side. That rumor will fetch a fine price.",
        fx: {} },
    ],
  }),
  topic('kai.watch.conflict', {
    char: 'kai', priority: 2, cooldownMin: 30,
    triggers: [onIntent('threaten', 0.8), onIntent('insult', 0.9)],
    lines: [
      { text: "[[face:neutral]] [[anim:gesture_shrug]] For the record, the smart money's against you. The smart money is always against whoever raises their voice first.",
        fx: {} },
    ],
  }),

  topic('kai.social.trust', {
    char: 'kai', priority: 5,
    triggers: [onIntent('trust', 0.4)],
    lines: [
      { when: { statGte: { trust: 50 } },
        text: "[[face:neutral]] [[look:player]] Trust me? No. Never fully. [[face:smile:0.3]] But believe this — of everyone in this tower, I'm the only one whose interests currently align with yours completely. That's rarer than trust.",
        fx: { trust: 4, openness: 3 } },
      { text: "[[face:smirk]] Trust is a currency I deal in daily, which is exactly why I don't spend my own. [[look:player]] Ask me again when the food runs low. Answers improve under pressure.",
        fx: { openness: 2 } },
    ],
  }),
]);

registerFallbacks('kai', {
  neutral: [
    "[[face:smile:0.2]] Mm. An interesting choice of words. I'll remember them.",
    "[[face:smirk]] [[look:player]] Go on. I find you're most revealing when you think I'm not listening.",
    "[[anim:gesture_shrug]] The city burns, the whiskey holds, and you want to discuss that. Fascinating.",
    "[[face:neutral]] I heard you. I hear everything in this tower. It's a curse with excellent margins.",
  ],
  affection: [
    "[[face:smile:0.3]] Kindness, freely given. [[face:smirk]] Either you're genuine or you're very good. I'm enjoying not knowing.",
  ],
  hostility: [
    "[[face:neutral]] [[look:player]] Anger is information. Thank you for the free sample.",
    "[[face:smirk]] Sharp words. I'd return fire, but I prefer compound interest.",
  ],
  flirt: [
    "[[face:smirk]] [[anim:gesture_lean_in]] Bold. I approve of bold — it's how the best mistakes get made.",
  ],
  command: [
    "[[face:smile:0.2]] I don't take orders, but I do take requests under advisement. Consider it advised.",
  ],
  fear: [
    "[[face:neutral]] Steady. Fear is expensive and the exchange rate tonight is terrible.",
  ],
});
