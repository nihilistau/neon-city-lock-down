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
      { text: "[[face:smirk]] The sweet one? She'll cry, she'll flinch, and she'll still be standing when the rest of the city isn't. Street girls don't survive by accident.",
        fx: { openness: 1 } },
    ],
  }),
  topic('lola.about.kai', {
    char: 'lola', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_kai', 0.5)],
    lines: [
      { text: "[[face:grit]] [[anim:gesture_cross_arms]] Mercer. I've done three jobs off his information. All three were clean, all three made money, and I still count my fingers after shaking his hand. [[look:player]] Never trust a man whose only loyalty is to the most interesting outcome.",
        fx: { tension: 2, openness: 2 } },
    ],
  }),
  topic('lola.about.vox', {
    char: 'lola', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_vox', 0.5)],
    lines: [
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
]);
