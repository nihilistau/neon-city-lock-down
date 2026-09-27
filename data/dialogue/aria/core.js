// @ts-check
// Aria Chen — slice topic pack (small; the deep pack lands in Phase 3).
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';
import { registerFallbacks } from '../../../src/dialogue/interject.js';

registerTopics([
  topic('aria.core.greet', {
    char: 'aria', priority: 4, cooldownMin: 20,
    triggers: [onIntent('greet', 0.4)],
    lines: [
      { when: { statLte: { trust: 35 } },
        text: "[[face:blush:0.3]] Oh — hi. [[anim:idle_shy]] Sorry, you startled me. It's... you're really *the* {player}, aren't you?",
        fx: { trust: 2, fear: -1 } },
      { when: { statGte: { trust: 55 } },
        text: "[[face:smile]] Hey, you. [[look:player]] I was hoping you'd come find me.",
        fx: { happiness: 3 } },
      { when: { statGte: { fear: 50 } },
        text: "[[face:frown]] [[anim:idle_shy]] Oh — thank god, it's you. [[look:player]] I've been sitting here doing that thing where you count the sirens. I'm at nineteen.",
        fx: { fear: -3, trust: 3 } },
      { when: { statGte: { happiness: 65 } },
        text: "[[face:smile]] [[look:player]] Hi! [[face:blush:0.2]] Sorry — that came out loud. It's just been a long time since a door opening was good news.",
        fx: { happiness: 3, trust: 2 } },
      { when: { statLte: { energy: 35 } },
        text: "[[face:smile:0.2]] [[anim:idle_shy]] Hi. [[look:player]] Don't look at me too closely, I haven't slept properly since the gates. Nobody warns you that fear is exhausting.",
        fx: { trust: 2, openness: 2 } },
      { when: { flag: 'survived_breach' },
        text: "[[face:smile:0.3]] [[look:player]] Hey. [[anim:idle_shy]] I still do a little check when you walk in. Count you, count everyone. [[face:blush:0.3]] It's a new habit. I don't love it.",
        fx: { trust: 3, loyalty: 2, fear: -2 } },
      { when: { bondAtLeast: 'trusted' },
        text: "[[face:blush:0.5]] [[face:smile]] [[look:player]] Hi. [[anim:gesture_lean_in]] I've been thinking about you all morning and I've decided I'm going to say that out loud now instead of just thinking it.",
        fx: { happiness: 4, arousal: 3, trust: 2 } },
      { text: "[[face:smile:0.4]] [[look:player]] Hi. Weird night, huh? Every night is a weird night now.",
        fx: { trust: 1 } },
    ],
  }),

  topic('aria.core.howareyou', {
    char: 'aria', priority: 3,
    triggers: [onIntent('howareyou', 0.4)],
    lines: [
      { when: { statGte: { fear: 45 } },
        text: "[[face:frown]] Honestly? Scared. The sirens haven't stopped for two days. [[anim:idle_shy]] But don't tell Lola I said that.",
        fx: { trust: 3, fear: -2 } },
      { when: { statGte: { trust: 60 } },
        text: "[[face:smile:0.3]] [[look:player]] Do you want the party answer or the real one? [[anim:idle_shy]] ...The real one is that I'm holding up better than I expected and it frightens me a little. I think I'm getting good at this.",
        fx: { trust: 4, openness: 3 } },
      { when: { statGte: { tension: 60 } },
        text: "[[face:frown]] [[anim:idle_shy]] Everyone's snapping at each other and pretending it's about rations. [[look:player]] I can read a room. That's literally my whole job. This room is about to break something.",
        fx: { tension: 2, trust: 2, fear: 1 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:blush:0.4]] [[face:smile]] Warm. Silly. [[look:player]] Ask me something you'd normally be too polite to ask. [[anim:gesture_lean_in]] Tonight's a good night for it.",
        fx: { openness: 4, arousal: 3, happiness: 3 } },
      { when: { statGte: { happiness: 65 } },
        text: "[[face:smile]] [[face:blush:0.2]] Good. [[look:player]] Which is an insane thing to say in a siege, so please don't repeat it to Lola. She'd look at me.",
        fx: { happiness: 3, trust: 2 } },
      { text: "[[face:smile:0.3]] I'm... okay. Better when there's someone to talk to. [[face:blush:0.2]] Better now, I mean.",
        fx: { trust: 2, happiness: 2 } },
    ],
  }),

  topic('aria.back.who', {
    char: 'aria', priority: 5, cooldownMin: 40,
    triggers: [onIntent('ask_past', 0.4)],
    cond: { notFlag: 'aria_told_past' },
    lines: [
      { when: { statLte: { trust: 40 } },
        text: "[[face:blush:0.3]] Me? I'm... nobody interesting. I keep people company. Expensive company. [[anim:idle_shy]] It's not what people think it is. Mostly it's listening.",
        fx: { openness: 2 } },
      { text: "[[face:smile:0.3]] [[look:player]] I work the high-end circuit. Company, conversation, someone warm at a cold party. I came up here for a client meeting and then the whole world slammed shut. [[face:neutral]] He never showed. Probably dead.",
        fx: { trust: 4, openness: 3 } },
    ],
    effects: { setFlag: 'aria_told_past' },
    branches: [
      { chip: "That sounds lonely", goto: 'aria.back.lonely' },
      { chip: "Are you safe here?", goto: 'aria.back.safe' },
    ],
  }),

  topic('aria.back.lonely', {
    char: 'aria', priority: 4,
    triggers: [onIntent('ask_past', 0.2)],
    cond: { flag: 'aria_told_past' },
    lines: [
      { text: "[[face:smile:0.2]] [[face:blush:0.3]] ...Yeah. Sometimes. You learn everyone's stories and nobody asks for yours. [[look:player]] You just did, though. That's new.",
        fx: { trust: 6, happiness: 4, loyalty: 2 } },
    ],
  }),

  topic('aria.back.safe', {
    char: 'aria', priority: 4,
    triggers: [onIntent('ask_past', 0.2)],
    cond: { flag: 'aria_told_past' },
    lines: [
      { text: "[[face:neutral]] Safer than the street, colder than I'd like. [[look:player]] Lola scares me a little. Kai scares me a lot — he's too calm. [[face:smile:0.3]] You? Jury's still out.",
        fx: { trust: 3, openness: 2 } },
    ],
  }),

  topic('aria.world.lockdown', {
    char: 'aria', priority: 4,
    triggers: [onIntent('ask_lockdown', 0.4)],
    lines: [
      { when: { statGte: { fear: 45 } },
        text: "[[face:frown]] [[anim:idle_shy]] Don't make me picture it. [[look:player]] I know every one of those streets. I know which corner sells the good noodles. [[face:neutral]] Knowing it is what makes it unbearable.",
        fx: { fear: 3, trust: 2 } },
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] Here's the thing nobody says out loud. [[anim:idle_shy]] The lockdown didn't change the city. It just took the lid off. [[face:frown]] All of that was already down there, waiting for the police to stop pretending.",
        fx: { openness: 4, trust: 2 } },
      { when: { flag: 'saw_refugee_in' },
        text: "[[face:smile:0.3]] [[look:player]] It's the same city it was last week. Same people. [[face:blush:0.2]] We proved that at the door, didn't we. One person, one decision. That's all it ever is.",
        fx: { trust: 3, happiness: 2, loyalty: 2 } },
      { when: { statLte: { trust: 30 } },
        text: "[[face:frown]] [[anim:idle_shy]] I don't really watch the feeds any more. [[look:player]] Is that terrible? I think I'm allowed one thing I don't look at.",
        fx: { fear: 2, openness: 1 } },
      { text: "[[face:frown]] I watched the barricades go up from the balcony. People just... left on the wrong side. [[face:neutral]] The city doesn't care who you are when the gates come down. [[look:player]] That's why I'd rather be up here. With you all. Even Lola.",
        fx: { fear: 2, trust: 2 } },
    ],
  }),

  topic('aria.flirt.opening', {
    char: 'aria', priority: 6, cooldownMin: 15,
    triggers: [onIntent('flirt', 0.5), onIntent('compliment', 0.7)],
    lines: [
      { when: { statLte: { trust: 35 } },
        text: "[[face:blush:0.7]] Oh. [[anim:idle_shy]] I— people say things like that all the time and don't mean them. [[look:player]] ...Did you mean it?",
        fx: { arousal: 3, trust: 2, fear: 1 } },
      { when: { statGte: { openness: 45 } },
        text: "[[face:blush:0.5]] [[face:grin]] Careful. I'm shy, not made of glass. [[look:player]] Say it again. Slower.",
        fx: { arousal: 6, horniness: 4, happiness: 3 } },
      { when: { statGte: { trust: 65 } },
        text: "[[face:blush:0.5]] [[face:smile]] [[look:player]] You know what's strange? I've been paid a great deal of money to hear things like that. [[anim:gesture_lean_in]] This is the first time one landed anywhere.",
        fx: { arousal: 7, trust: 4, happiness: 4 } },
      { when: { bondAtLeast: 'ally' },
        text: "[[face:blush:0.6]] [[face:grin]] [[look:player]] You're allowed to just come here, you know. [[anim:gesture_lean_in]] You don't have to build up to me every single time. [[face:smile]] ...Though I do like watching you try.",
        fx: { arousal: 9, horniness: 6, happiness: 3 } },
      { when: { statGte: { fear: 50 } },
        text: "[[face:blush:0.4]] [[anim:idle_shy]] Oh — [[face:frown]] not right now. [[look:player]] I want to want that. My hands are still shaking and I'd rather you saw me when they're not.",
        fx: { arousal: 2, trust: 3, fear: -2 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:blush:0.6]] [[face:grin]] [[look:player]] Mm. Say it again. [[anim:gesture_lean_in]] I'm about two drinks past the part where I pretend I don't like hearing it.",
        fx: { arousal: 8, horniness: 5, openness: 4 } },
      { text: "[[face:blush:0.5]] [[face:smile]] That's... you're sweet. [[anim:gesture_lean_in]] Nobody's sweet in this city for free, but... thank you.",
        fx: { arousal: 4, trust: 3 } },
    ],
    effects: { counter: 'flirts' },
  }),

  topic('aria.conflict.insult', {
    char: 'aria', priority: 8,
    triggers: [onIntent('insult', 0.5)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:frown]] [[look:player]] ...From you. [[anim:idle_shy]] Everyone else in this tower, fine, I have a smile for that. [[face:neutral]] I didn't have one ready for you.",
        fx: { happiness: -9, trust: -10, fear: 3 } },
      { when: { statGte: { fear: 50 } },
        text: "[[anim:idle_shy]] [[face:frown]] Okay. [[look:player]] Okay. I'm going to go stand somewhere else for a while. [[face:neutral]] Not angry. Just — somewhere else.",
        fx: { happiness: -6, trust: -7, fear: 6 } },
      { when: { statGte: { openness: 55 } },
        text: "[[face:neutral]] [[look:player]] Mm. [[anim:idle_shy]] I've been talked to like that by men in better suits than yours, and they at least tipped. [[face:frown]] Try again when you've thought about it.",
        fx: { happiness: -5, trust: -6, dominance: 2 } },
      { text: "[[face:frown]] [[anim:idle_shy]] ...Okay. [[face:neutral]] You know, I've heard worse from better people. [[look:player]] Doesn't mean it doesn't land.",
        fx: { happiness: -6, trust: -8, fear: 4 } },
    ],
  }),
]);

registerFallbacks('aria', {
  neutral: [
    "[[face:smile:0.2]] Mm? Sorry — I drift off. The city noise does that to me.",
    "[[face:blush:0.2]] I'm listening. I'm always listening — occupational habit.",
    "[[anim:idle_shy]] I don't really know what to say to that. But say more?",
    "[[face:smile:0.3]] [[look:player]] You're strange. Good strange. I think.",
  ],
  affection: [
    "[[face:blush:0.5]] [[face:smile]] ...You keep doing that. Being kind. It's disarming.",
    "[[face:blush:0.3]] Careful — I remember every nice thing anyone's ever said to me.",
  ],
  hostility: [
    "[[face:frown]] [[anim:idle_shy]] Please don't. The world outside is angry enough.",
    "[[face:neutral]] ...I've defused scarier men than you at nicer parties. Don't make me try.",
  ],
  flirt: [
    "[[face:blush:0.6]] [[face:smile]] Oh. Um. [[look:player]] That's — you can't just SAY things like that.",
    "[[face:blush:0.4]] [[face:grin]] I charge for that kind of attention, you know. ...Usually.",
  ],
  command: [
    "[[face:blush:0.3]] [[anim:idle_shy]] O-okay... wait, no. Ask nicely. Even Lola asks nicely. Sometimes.",
  ],
  fear: [
    "[[face:frown]] Hey — hey. Breathe. We're forty floors above the worst of it. [[look:player]] Stay with me.",
  ],
});
