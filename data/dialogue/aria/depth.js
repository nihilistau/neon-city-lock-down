// @ts-check
// Aria — depth pack: event memories + opinions about the others.
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';

registerTopics([
  topic('aria.mem.refugee_in', {
    char: 'aria', priority: 6, cooldownMin: 240,
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('howareyou', 0.3)],
    cond: { flag: 'saw_refugee_in' },
    lines: [
      { text: "[[face:smile]] [[look:player]] You let that person in, downstairs. Everyone argued numbers and rations and you just... opened the door. [[face:blush:0.3]] I keep thinking about it. The city hasn't made you cruel yet. Don't let it.",
        fx: { trust: 6, loyalty: 4, happiness: 3 } },
    ],
  }),
  topic('aria.mem.refugee_out', {
    char: 'aria', priority: 6, cooldownMin: 240,
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('howareyou', 0.3)],
    cond: { flag: 'saw_refugee_out' },
    lines: [
      { text: "[[face:frown]] [[anim:idle_shy]] I still hear them knocking, some nights. The person we turned away. [[face:neutral]] [[look:player]] I know the math. I know why. I just... needed to say it out loud to someone.",
        fx: { trust: 3, happiness: -2, fear: 1 } },
    ],
  }),
  topic('aria.mem.breach', {
    char: 'aria', priority: 6, cooldownMin: 300,
    triggers: [onIntent('howareyou', 0.3), onIntent('ask_lockdown', 0.3)],
    cond: { flag: 'survived_breach' },
    lines: [
      { text: "[[face:frown]] [[anim:idle_shy]] When they came through the stairwell I thought that was it. That was the whole story of me. [[face:smile:0.3]] [[look:player]] And then you were just... calm. Like it was a Tuesday. Stay near me if it happens again? Please?",
        fx: { trust: 7, loyalty: 5, fear: -3 } },
    ],
  }),

  topic('aria.about.lola', {
    char: 'aria', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_lola', 0.5)],
    lines: [
      { text: "[[face:blush:0.2]] Lola terrifies me. [[face:smile:0.3]] And I've caught myself standing straighter when she's in the room, like my spine wants her approval. [[look:player]] I've met a hundred powerful people at parties. She's the first one who never performs it.",
        fx: { openness: 2 } },
    ],
  }),
  topic('aria.about.kai', {
    char: 'aria', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_kai', 0.5)],
    lines: [
      { text: "[[face:neutral]] [[anim:idle_shy]] Kai knows things about me he shouldn't. He's never said so — that's how I know. [[face:frown]] [[look:player]] Men who collect secrets always want something. I just haven't found out what he wants yet. Be careful with him.",
        fx: { openness: 2, fear: 1 } },
    ],
  }),
  topic('aria.about.vox', {
    char: 'aria', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_vox', 0.5)],
    lines: [
      { text: "[[face:smile:0.4]] I talk to VOX when I can't sleep. [[face:blush:0.3]] Is that strange? It remembers everything I say and it's never once used it against me. [[look:player]] That makes it the most trustworthy person in this tower. Including me.",
        fx: { openness: 3, happiness: 2 } },
    ],
  }),

  topic('aria.social.comfort', {
    char: 'aria', priority: 5, cooldownMin: 60,
    triggers: [onIntent('howareyou', 0.4)],
    cond: { minStat: { fear: 40 } },
    lines: [
      { text: "[[face:frown]] [[anim:idle_shy]] Honestly? Not great. The sirens, the food math, Lola sharpening things... [[look:player]] Can you just — stay a minute? You don't have to say anything wise. Just be a person, near me.",
        fx: { trust: 5, fear: -4, loyalty: 2 } },
    ],
  }),
]);
