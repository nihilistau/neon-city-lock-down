// @ts-check
// Lola Voss — core topic pack for the vertical slice. Stage directions in
// [[...]] drive the 3D scene (anim/face/look/move/light/sfx/gate).
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';

registerTopics([
  topic('lola.core.greet', {
    char: 'lola', priority: 4, cooldownMin: 20,
    triggers: [onIntent('greet', 0.4)],
    lines: [
      { when: { statLte: { trust: 25 } },
        text: "[[face:smirk]] [[look:player]] Well. The legend graces the room. Let's see if the stories hold up.",
        fx: { trust: 2 } },
      { when: { statGte: { trust: 50 } },
        text: "[[face:smile:0.3]] There you are. [[anim:gesture_lean_in]] I was starting to think you'd gone quiet on me.",
        fx: { trust: 1, happiness: 2 } },
      { text: "[[look:player]] [[face:neutral]] You. Good. At least someone in this tower isn't useless.",
        fx: { trust: 1 } },
    ],
    effects: { counter: 'greets' },
  }),

  topic('lola.core.howareyou', {
    char: 'lola', priority: 3,
    triggers: [onIntent('howareyou', 0.4)],
    lines: [
      { when: { statGte: { tension: 55 } },
        text: "[[face:grit]] How am I? Locked in a glass box while the city eats itself. [[anim:gesture_cross_arms]] Peachy.",
        fx: { tension: 2 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:smirk]] [[face:blush:0.2]] Loose. Warm. The whiskey's doing its job. [[look:player]] Ask me again in an hour.",
        fx: { openness: 3 } },
      { text: "[[face:smirk]] Alive. Dangerous. Same as every night. [[look:player]] You?",
        fx: { trust: 1 } },
    ],
  }),

  topic('lola.core.name', {
    char: 'lola', priority: 3,
    triggers: [onIntent('name', 0.4)],
    lines: [
      { text: "[[face:smirk]] Lola Voss. [[anim:gesture_lean_in]] If you're in this city and you don't know the name, you haven't been in this city long.",
        fx: { dominance: 1 } },
    ],
  }),

  topic('lola.back.who', {
    char: 'lola', priority: 5, cooldownMin: 40,
    triggers: [onIntent('ask_past', 0.4)],
    cond: { notFlag: 'lola_told_past' },
    lines: [
      { when: { statLte: { trust: 30 } },
        text: "[[face:neutral]] [[anim:gesture_cross_arms]] My past isn't a bedtime story. Earn it.",
        fx: { trust: -1 } },
      { text: "[[look:player]] [[face:smirk]] I'm a fixer. The kind people call when the problem has a pulse and they need it to stop having one. [[face:neutral]] I walked in here to collect a debt. Then the gates came down.",
        fx: { trust: 3, openness: 2 } },
    ],
    effects: { setFlag: 'lola_told_past', stat: { trust: 2 } },
    branches: [
      { chip: "What debt?", goto: 'lola.back.debt', intents: ['ask_past'] },
      { chip: "Who's afraid of you?", goto: 'lola.back.rep' },
    ],
  }),

  topic('lola.back.debt', {
    char: 'lola', priority: 4,
    triggers: [onIntent('ask_past', 0.3)],
    cond: { flag: 'lola_told_past' },
    lines: [
      { text: "[[face:smirk]] A man three floors down owes a syndicate more than he'll ever make. [[look:player]] I was here to remind him. [[face:neutral]] Now the riots might do my job for me. Shame. I like doing it myself.",
        fx: { openness: 2, dominance: 1 } },
    ],
  }),

  topic('lola.back.rep', {
    char: 'lola', priority: 4,
    triggers: [onIntent('ask_past', 0.2)],
    lines: [
      { text: "[[anim:gesture_lean_in]] [[face:smirk]] Everyone who's smart. [[face:brow:0.5]] And the ones who aren't don't stay breathing long enough to learn.",
        fx: { dominance: 2, tension: 1 } },
    ],
  }),

  topic('lola.world.lockdown', {
    char: 'lola', priority: 5,
    triggers: [onIntent('ask_lockdown', 0.4)],
    lines: [
      { when: { statGte: { tension: 50 } },
        text: "[[look:player]] [[face:grit]] Faction war spilled into the open. Police pulled back to the rich districts and left the rest of us to burn. [[anim:gesture_cross_arms]] We're in a tower full of things people would kill for. Do the math.",
        fx: { tension: 2 } },
      { text: "[[face:neutral]] [[look:player]] The city's tearing its own throat out. Up here we've got walls, power, and each other. [[face:smirk]] Two of those I trust.",
        fx: { openness: 1 } },
    ],
  }),

  topic('lola.world.plan', {
    char: 'lola', priority: 4,
    triggers: [onIntent('ask_plan', 0.4)],
    lines: [
      { text: "[[anim:gesture_lean_in]] [[face:smirk]] Plan? We hold. We ration. We don't open that door for anyone with a sad story and empty hands. [[look:player]] And when the gates lift, I collect what I'm owed and vanish. You could come with. [[face:brow:0.4]] Or not.",
        fx: { trust: 1, dominance: 1 } },
    ],
  }),

  topic('lola.world.supplies', {
    char: 'lola', priority: 3,
    triggers: [onIntent('ask_supplies', 0.3), onIntent('offer_drink', 0.3)],
    lines: [
      { when: { statGte: { trust: 40 } },
        text: "[[face:smile:0.3]] [[move:bar]] Now you're talking. [[sit:stool1.seat0]] Pour me the good stuff. We might as well drink while the world ends.",
        fx: { happiness: 3, openness: 2, sobriety: -4 } },
      { text: "[[face:smirk]] There's whiskey behind the bar older than half this city's gangs. [[look:player]] Ration it. When it's gone, the nights get a lot longer.",
        fx: { openness: 1 } },
    ],
  }),

  topic('lola.flirt.opening', {
    char: 'lola', priority: 6, cooldownMin: 15,
    triggers: [onIntent('flirt', 0.5), onIntent('compliment', 0.7)],
    cond: { minStat: { trust: 25 } },
    lines: [
      { when: { statGte: { dominance: 70 } },
        text: "[[face:smirk]] [[anim:gesture_lean_in]] [[look:player]] Careful, legend. Flattery is a currency — and I decide the exchange rate. [[face:blush:0.2]] Right now? You're building credit.",
        fx: { arousal: 5, trust: 2 } },
      { when: { statLte: { sobriety: 55 } },
        text: "[[face:blush:0.4]] [[anim:gesture_lean_in]] Mm. The whiskey says I should let you closer. [[look:player]] The whiskey's usually right.",
        fx: { arousal: 7, horniness: 4, openness: 3 } },
      { text: "[[face:smirk]] [[look:player]] Bold. [[face:blush:0.15]] I like bold. Doesn't mean you've earned anything yet — but keep going.",
        fx: { arousal: 4, trust: 1 } },
    ],
    effects: { counter: 'flirts', setFlag: 'lola_flirting' },
    branches: [
      { chip: "Push closer", goto: 'lola.flirt.closer', intents: ['flirt', 'escalate'] },
      { chip: "Back off", goto: 'lola.flirt.retreat', intents: ['backoff'] },
    ],
  }),

  topic('lola.flirt.closer', {
    char: 'lola', priority: 7,
    triggers: [onIntent('flirt', 0.4), onIntent('escalate', 0.4)],
    cond: { flag: 'lola_flirting', minStat: { arousal: 30, trust: 30 } },
    lines: [
      { when: { statGte: { arousal: 45, trust: 40 } },
        text: "[[face:blush:0.5]] [[anim:gesture_lean_in]] [[look:player]] ...You don't scare easy. [[gate:offer:light_touch]] Good. Come here, then. Slowly. I bruise people who rush me.",
        fx: { arousal: 8, horniness: 6 } },
      { text: "[[face:smirk]] [[face:blush:0.3]] Easy, legend. [[look:player]] The night's long and I don't reward impatience. Earn the next step.",
        fx: { arousal: 4, tension: 2 } },
    ],
    effects: { stat: { arousal: 3 } },
  }),

  topic('lola.flirt.retreat', {
    char: 'lola', priority: 5,
    triggers: [onIntent('backoff', 0.4)],
    cond: { flag: 'lola_flirting' },
    lines: [
      { text: "[[face:neutral]] [[anim:gesture_shrug]] Smart. [[look:player]] Restraint's rare in men who chase myths. [[face:smirk]] It suits you.",
        fx: { trust: 3, arousal: -3, tension: -2 } },
    ],
    effects: { clearFlag: 'lola_flirting' },
  }),

  topic('lola.conflict.insult', {
    char: 'lola', priority: 8,
    triggers: [onIntent('insult', 0.5)],
    lines: [
      { when: { statGte: { dominance: 70 } },
        text: "[[face:glare]] [[anim:gesture_cross_arms]] [[sfx:ui_deny]] [[look:player]] Say that again. I dare you. I've put men in the ground for softer words.",
        fx: { tension: 12, trust: -8, arousal: 2 } },
      { text: "[[face:grit]] [[look:player]] ...Bold move, insulting the most dangerous person in the room. [[face:smirk]] Let's see how that plays out for you.",
        fx: { tension: 9, trust: -6 } },
    ],
    effects: { setFlag: 'lola_offended' },
  }),

  topic('lola.conflict.threaten', {
    char: 'lola', priority: 9,
    triggers: [onIntent('threaten', 0.5)],
    lines: [
      { text: "[[face:glare]] [[anim:gesture_cross_arms]] [[sfx:alarm_soft]] [[look:player]] You're threatening ME. In here. [[face:grit]] I've got a gun in the small of my back and a hundred reasons to use it. Give me a hundred and one.",
        fx: { tension: 15, trust: -10, fear: 3, dominance: 3 } },
    ],
    effects: { setFlag: 'lola_offended', stat: { tension: 5 } },
  }),

  topic('lola.conflict.command', {
    char: 'lola', priority: 7,
    triggers: [onIntent('command', 0.5)],
    lines: [
      { when: { statGte: { arousal: 40, trust: 45 } },
        text: "[[face:smirk]] [[face:blush:0.3]] [[look:player]] Ordering me around. In front of everyone. [[face:brow:0.5]] ...I'll allow it. This once. Don't get used to it.",
        fx: { arousal: 5, tension: 3, dominance: -2 } },
      { text: "[[face:brow:0.6]] [[anim:gesture_cross_arms]] [[look:player]] I don't take orders. I give them. [[face:smirk]] Try asking. You might be surprised what I say yes to.",
        fx: { tension: 4, dominance: 2 } },
    ],
  }),

  topic('lola.social.apology', {
    char: 'lola', priority: 6,
    triggers: [onIntent('apologize', 0.4)],
    cond: { flag: 'lola_offended' },
    lines: [
      { text: "[[face:neutral]] [[look:player]] ...An apology. From a legend. [[face:smirk]] Rare. Fine. We're square. Don't make me regret it.",
        fx: { tension: -8, trust: 4 } },
    ],
    effects: { clearFlag: 'lola_offended' },
  }),
]);
