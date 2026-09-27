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
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] [[look:player]] Evening. [[anim:gesture_shrug]] Everyone's voice is half a tone higher than yesterday. Yours included. I'm keeping a record.",
        fx: { openness: 1, tension: 1 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:smile:0.2]] [[look:player]] Ah. [[anim:gesture_lean_in]] I've had exactly enough to be honest and not quite enough to regret it. A narrow window. Use it.",
        fx: { openness: 3 } },
      { when: { flag: 'survived_breach' },
        text: "[[face:neutral]] [[look:player]] Good. You're in the count. [[face:smirk]] I do one every morning now. It's a grim little habit and I recommend it.",
        fx: { trust: 2 } },
      { when: { flag: 'kai_radio' },
        text: "[[face:smirk]] [[look:player]] Evening. [[anim:gesture_shrug]] No, there's nothing new on the set. [[face:neutral]] You were going to ask. You always look at the shelf first.",
        fx: { openness: 2, trust: 1 } },
      { text: "[[face:smirk]] Evening. [[look:player]] Don't mind me — I'm just enjoying the show. Everyone in this tower is a show.",
        fx: { trust: 1 } },
    ],
  }),

  topic('kai.core.name', {
    char: 'kai', priority: 3,
    triggers: [onIntent('name', 0.4)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:smile:0.2]] [[look:player]] Kai. [[anim:gesture_shrug]] Mercer is a working name — I've had four. This one's lasted longest, so it's nearly mine.",
        fx: { trust: 2, openness: 3 } },
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] Mercer. [[look:player]] Learn it properly. If this goes badly you'll want to be able to tell somebody who was standing here.",
        fx: { tension: 2, openness: 1 } },
      { text: "[[face:smirk]] Kai Mercer. Broker of introductions, secrets, and the occasional miracle. [[anim:gesture_shrug]] My card would say 'consultant', if cards weren't traceable.",
        fx: { openness: 1 } },
    ],
  }),

  topic('kai.core.howareyou', {
    char: 'kai', priority: 3,
    triggers: [onIntent('howareyou', 0.4)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] Honestly? Bored, and I'd forgotten how much I dislike it. [[face:smirk]] I've spent twenty years being the calmest man in the room. It turns out that's a job, and there's no one to hand it to.",
        fx: { openness: 3, trust: 2 } },
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] [[anim:gesture_shrug]] Fine. [[look:player]] I'm always fine. It's the least useful thing about me — nobody checks on the man who's fine.",
        fx: { openness: 2, tension: 1 } },
      { when: { statLte: { energy: 40 } },
        text: "[[face:smile:0.2]] Awake, which is doing a great deal of work in that sentence. [[look:player]] I sleep in twenty-minute pieces. Old habit. Bad one.",
        fx: { openness: 2 } },
      { when: { flag: 'lola_job' },
        text: "[[face:grit]] [[look:player]] Ask the arm. [[face:smirk]] The rest of me is comfortable. The arm has notes.",
        fx: { openness: 2, tension: 2 } },
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
      { when: { statGte: { trust: 55 } },
        text: "[[anim:gesture_lean_in]] [[look:player]] It isn't a riot. A riot ends. [[face:neutral]] This is a transfer of ownership, and the paperwork is being done with fire because the paperwork is always done with fire. In six weeks somebody respectable will own the market district and nobody will ask how.",
        fx: { openness: 4, trust: 2 } },
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] [[look:player]] Two of my estimates were wrong this week. [[anim:gesture_shrug]] That's not modesty, it's a warning. When my numbers stop working it means somebody changed the rules and didn't tell the market.",
        fx: { tension: 3, openness: 2 } },
      { when: { flag: 'kai_radio' },
        text: "[[face:smirk]] [[look:player]] The feeds are a week behind the truth and the truth is a week behind the money. [[face:neutral]] I listen to the money. It's quieter and it lies less.",
        fx: { openness: 3 } },
      { when: { flag: 'survived_breach' },
        text: "[[face:neutral]] [[look:player]] The relevant number changed. [[anim:gesture_shrug]] It used to be how long the barricades hold. Now it's how many people know this address. [[face:smirk]] The second number only goes up.",
        fx: { tension: 3, openness: 2 } },
      { text: "[[face:neutral]] [[look:player]] Three factions, one grid, no adults in the room. The barricades will hold a week. The food riots start before that. [[face:smirk]] I'd say I hate being right, but we both know better.",
        fx: { openness: 2 } },
    ],
  }),

  topic('kai.world.plan', {
    char: 'kai', priority: 4,
    triggers: [onIntent('ask_plan', 0.4)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] Then here it is, free. There's a service corridor behind the carpark that isn't on the tower's own plans. [[face:smirk]] I've paid for that sentence twice and I've never said it aloud before. Do with it what you like.",
        fx: { trust: 4, openness: 4 } },
      { when: { statGte: { tension: 55 } },
        text: "[[anim:gesture_shrug]] [[look:player]] My plan is unchanged: be indispensable, be unarmed, be somewhere else when the shouting starts. [[face:neutral]] Three parts. The third one is the difficult one, in a sealed building.",
        fx: { tension: 2, openness: 2 } },
      { when: { statLte: { trust: 25 } },
        text: "[[face:smirk]] [[anim:gesture_shrug]] I have several. [[look:player]] You appear in some of them. That's as much as the current rate gets you.",
        fx: { openness: 1 } },
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
      { when: { statGte: { trust: 60 } },
        text: "[[face:neutral]] [[look:player]] I should tell you I'm very good at this and none of it would be true tonight. [[face:smile:0.3]] [[anim:gesture_lean_in]] That's the compliment. I've stopped working on you.",
        fx: { arousal: 7, trust: 3, openness: 3 } },
      { when: { bondAtLeast: 'ally' },
        text: "[[anim:gesture_lean_in]] [[face:smile:0.4]] [[look:player]] You've noticed I don't ask twice for anything. [[face:smirk]] I've asked you rather a lot of times. Draw the obvious conclusion and act on it.",
        fx: { arousal: 9, horniness: 6 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:smile:0.3]] [[look:player]] Two drinks and I get precise instead of quiet. [[anim:gesture_lean_in]] So: I'd like you to stay in this chair, and I'd like to keep talking, and I'd like both of those to take a while.",
        fx: { arousal: 7, horniness: 4, openness: 4 } },
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
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] Ah. [[anim:gesture_shrug]] That one I'll actually think about tonight, which is more than the others get. [[face:smile:0.2]] Well done. You've found the expensive way to reach me.",
        fx: { tension: 4, trust: -5, happiness: -4 } },
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] [[look:player]] Everyone's saying things like that this week. [[anim:gesture_shrug]] I've noticed the room gets exactly this loud about six hours before it gets quiet. Sit down.",
        fx: { tension: 5, trust: -3 } },
      { when: { statLte: { trust: 25 } },
        text: "[[face:smirk]] [[anim:gesture_shrug]] Correct on two counts, oddly. [[look:player]] You'd have to know me better to land the third, and at this rate you won't.",
        fx: { tension: 2, trust: -4, openness: -2 } },
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
      { when: { statGte: { tension: 55 } },
        text: "[[face:neutral]] [[look:player]] Bad week to ask. [[anim:gesture_shrug]] Trust is priced off scarcity like everything else, and there is very little of it left in this building. [[face:smirk]] I'd be overpaying and we'd both know it.",
        fx: { tension: 2, openness: 2 } },
      { when: { flag: 'survived_breach' },
        text: "[[face:neutral]] [[look:player]] You stood between the stairwell and the rest of us. [[anim:gesture_shrug]] I don't trust people. I do update on evidence. [[face:smile:0.2]] Consider yourself repriced.",
        fx: { trust: 5, openness: 3 } },
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
