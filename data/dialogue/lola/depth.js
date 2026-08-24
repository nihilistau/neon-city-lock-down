// @ts-check
// Lola — depth pack: memory-referencing lines (events, patterns) + opinions
// about the others. This is where the world starts remembering.
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';

registerTopics([
  // ── event memories ──
  topic('lola.mem.refugee_in', {
    char: 'lola', priority: 6, cooldownMin: 240,
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('trust', 0.3)],
    cond: { flag: 'saw_refugee_in' },
    lines: [
      { text: "[[face:neutral]] [[look:player]] You opened the doors for that stray. [[anim:gesture_cross_arms]] Soft. [[face:smirk]] Lucky for you, soft with good aim is a combination I can work with. Don't make it a habit.",
        fx: { trust: 2, tension: 1 } },
    ],
  }),
  topic('lola.mem.refugee_out', {
    char: 'lola', priority: 6, cooldownMin: 240,
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('trust', 0.3)],
    cond: { flag: 'saw_refugee_out' },
    lines: [
      { text: "[[face:smirk]] [[look:player]] You kept the doors sealed on that beggar. Cold. Correct, but cold. [[face:neutral]] The city eats the generous first. You'll outlive everyone in this room.",
        fx: { trust: 4, dominance: 1 } },
    ],
  }),
  topic('lola.mem.breach', {
    char: 'lola', priority: 6, cooldownMin: 300,
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('howareyou', 0.3)],
    cond: { flag: 'survived_breach' },
    lines: [
      { text: "[[face:smirk]] [[look:player]] You held the line when they came up the stairwell. Didn't freeze, didn't run. [[face:smile:0.3]] The stories about you might actually be underselling it.",
        fx: { trust: 6, arousal: 3 } },
    ],
  }),
  topic('lola.mem.flirt_pattern', {
    char: 'lola', priority: 5, cooldownMin: 180,
    triggers: [onIntent('flirt', 0.4), onIntent('compliment', 0.5)],
    cond: { minCounter: { flirts: 4 } },
    lines: [
      { text: "[[face:smirk]] [[anim:gesture_lean_in]] That's the fifth time you've tried a line on me, legend. I've been counting. [[face:blush:0.3]] [[look:player]] Persistence. I respect persistence. Almost as much as I enjoy watching you work for it.",
        fx: { arousal: 6, trust: 3 } },
    ],
  }),

  // ── opinions about the others ──
  topic('lola.about.aria', {
    char: 'lola', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_aria', 0.5)],
    lines: [
      { when: { statGte: { trust: 45 } },
        text: "[[face:neutral]] Aria. [[look:player]] Everyone reads her as fragile. Watch her hands sometime — steady as a surgeon's, even during the sirens. [[face:smirk]] Girl's either tougher than she looks or better at acting than all of us. Both are useful.",
        fx: { openness: 2 } },
      { when: { statGte: { tension: 55 } },
        text: "[[face:grit]] [[anim:gesture_cross_arms]] Aria eats like a bird and worries like a general. [[look:player]] If it comes to the list, she's cheap to keep and she keeps this room from going feral. That's her column, and it's positive.",
        fx: { tension: 1, openness: 2 } },
      { when: { flag: 'aria_client_out' },
        text: "[[face:neutral]] [[look:player]] She recognised the voice at the door and she still didn't argue with the decision. [[face:smirk]] Everyone's been reading that girl wrong. Including me, for a while.",
        fx: { openness: 3, trust: 1 } },
      { when: { statLte: { trust: 25 } },
        text: "[[anim:gesture_shrug]] [[face:neutral]] What about her. [[look:player]] Ask her yourself — she's the talkative one.",
        fx: { openness: -1 } },
      { text: "[[face:smirk]] The sweet one? She'll cry, she'll flinch, and she'll still be standing when the rest of the city isn't. Street girls don't survive by accident.",
        fx: { openness: 1 } },
    ],
  }),
  topic('lola.about.kai', {
    char: 'lola', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_kai', 0.5)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] I'll tell you the part I don't say in front of him. Mercer's kept a line open to somebody outside this building since night one. [[face:smirk]] I don't mind. I mind not knowing the price on the other end.",
        fx: { trust: 2, openness: 3, tension: 1 } },
      { when: { flag: 'lola_job' },
        text: "[[face:smirk]] [[anim:gesture_shrug]] He'll invoice me for the stairwell. [[look:player]] He'll be right to. [[face:neutral]] Doesn't mean I'll pay.",
        fx: { dominance: 2, tension: 1 } },
      { when: { flag: 'kai_radio' },
        text: "[[face:grit]] [[anim:gesture_cross_arms]] You heard the radio too. [[look:player]] A man with a working line and no urgency about using it isn't stranded. He's stationed.",
        fx: { tension: 3, openness: 2 } },
      { text: "[[face:grit]] [[anim:gesture_cross_arms]] Mercer. I've done three jobs off his information. All three were clean, all three made money, and I still count my fingers after shaking his hand. [[look:player]] Never trust a man whose only loyalty is to the most interesting outcome.",
        fx: { tension: 2, openness: 2 } },
    ],
  }),
  topic('lola.about.vox', {
    char: 'lola', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_vox', 0.5)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] It said no bounty crosses its doors. Unprompted. [[face:smirk]] Thirty years of politeness and the building picks a side. I've had partners with worse instincts.",
        fx: { openness: 3, trust: 2 } },
      { when: { statLte: { sobriety: 60 } },
        text: "[[face:smirk]] [[face:blush:0.2]] I talked to a lift last night. [[look:player]] It answered. [[anim:gesture_shrug]] Draw your own conclusions about which of us is the strange one.",
        fx: { openness: 2, happiness: 2 } },
      { when: { flag: 'survived_breach' },
        text: "[[face:grit]] [[anim:gesture_cross_arms]] It sealed the ground floor before any of us thought to ask. [[look:player]] That thing has better reflexes than most men I've worked with. And it doesn't drink.",
        fx: { trust: 2, openness: 2 } },
      { text: "[[face:neutral]] The building? [[look:player]] It watches everything and forgets nothing, which makes it either our best ally or the biggest snitch in Neon-City. [[face:smirk]] I've started saying good morning to it. Just in case.",
        fx: { openness: 1 } },
    ],
  }),

  // ── survival attitude ──
  topic('lola.surv.rations', {
    char: 'lola', priority: 4, cooldownMin: 120,
    triggers: [onIntent('ask_supplies', 0.4)],
    cond: { minStat: { tension: 45 } },
    lines: [
      { text: "[[face:grit]] [[anim:gesture_cross_arms]] The pantry's thinner every time I look. [[look:player]] When it gets bad — and it will — remember who's useful in a fight and who's just another mouth. [[face:neutral]] I'll be making that list whether you do or not.",
        fx: { tension: 3, dominance: 2 } },
    ],
  }),

  topic('lola.mem.job', {
    char: 'lola', priority: 6, cooldownMin: 200,
    triggers: [onIntent('ask_plan', 0.3), onIntent('trust', 0.3)],
    cond: { flag: 'lola_job' },
    lines: [
      { text: "[[face:smirk]] [[look:player]] The collection paid. Don't look at Kai like that — ricochets happen. [[face:neutral]] You wanted to see how I work. That's how I work.",
        fx: { dominance: 3, trust: 2 } },
    ],
  }),
]);
