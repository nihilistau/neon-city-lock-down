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
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[anim:idle_shy]] I watched her clean a gun at the bar like she was drying a glass. [[look:player]] [[face:blush:0.2]] And I wasn't scared. That's the part I keep turning over. I've stopped being scared of her and I don't know when that happened.",
        fx: { openness: 3, trust: 2, fear: -2 } },
      { when: { flag: 'lola_named' },
        text: "[[face:frown]] [[anim:idle_shy]] Her name went out on the ticker and she didn't even blink. [[look:player]] I would have been sick. [[face:neutral]] I think she's been waiting years for the city to finally say it out loud.",
        fx: { openness: 2, fear: 2 } },
      { when: { statGte: { fear: 50 } },
        text: "[[face:frown]] [[anim:idle_shy]] Lola. [[look:player]] I'm glad she's on this side of the door. That's honestly all I can manage about her tonight.",
        fx: { fear: 1, openness: 1 } },
      { text: "[[face:blush:0.2]] Lola terrifies me. [[face:smile:0.3]] And I've caught myself standing straighter when she's in the room, like my spine wants her approval. [[look:player]] I've met a hundred powerful people at parties. She's the first one who never performs it.",
        fx: { openness: 2 } },
    ],
  }),
  topic('aria.about.kai', {
    char: 'aria', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_kai', 0.5)],
    lines: [
      { when: { statGte: { trust: 55 } },
        text: "[[face:neutral]] [[look:player]] He's kind to me. That's the unsettling part. [[anim:idle_shy]] Kind with nothing asked for yet. [[face:frown]] In my line you learn that's not generosity, that's a deposit.",
        fx: { openness: 3, trust: 2, fear: 1 } },
      { when: { flag: 'kai_radio' },
        text: "[[face:frown]] [[anim:idle_shy]] He has a radio. [[look:player]] He has a radio and he's still here, drinking, watching us. [[face:neutral]] Nobody stays somewhere by accident when they have a way to call out.",
        fx: { fear: 3, openness: 2 } },
      { when: { statLte: { trust: 30 } },
        text: "[[face:blush:0.2]] [[anim:idle_shy]] Kai's... very easy to talk to. [[look:player]] That's not a compliment, exactly. It's a description of the problem.",
        fx: { openness: 1, fear: 1 } },
      { text: "[[face:neutral]] [[anim:idle_shy]] Kai knows things about me he shouldn't. He's never said so — that's how I know. [[face:frown]] [[look:player]] Men who collect secrets always want something. I just haven't found out what he wants yet. Be careful with him.",
        fx: { openness: 2, fear: 1 } },
    ],
  }),
  topic('aria.about.vox', {
    char: 'aria', priority: 5, cooldownMin: 90,
    triggers: [onIntent('about_vox', 0.5)],
    lines: [
      { when: { statGte: { fear: 45 } },
        text: "[[face:frown]] [[anim:idle_shy]] It slowed the vents for me last night. [[look:player]] Nobody asked it to. [[face:smile:0.2]] Sixty floors of machine noticed I couldn't breathe. That shouldn't make me cry but it nearly did.",
        fx: { fear: -3, happiness: 3, openness: 3 } },
      { when: { statGte: { trust: 55 } },
        text: "[[face:smile:0.3]] [[look:player]] Can I say something odd? [[anim:idle_shy]] I think VOX is lonely. [[face:blush:0.2]] And I think it's been lonely since before any of us were born, and it's only just found the word for it.",
        fx: { openness: 4, happiness: 2 } },
      { when: { flag: 'emp_dream' },
        text: "[[face:neutral]] [[anim:idle_shy]] Something happened to it during the surge. [[look:player]] It's been choosing its words differently since. [[face:blush:0.2]] Slower. Like someone who's just realised they can.",
        fx: { openness: 3, fear: 1 } },
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

  topic('aria.mem.client_in', {
    char: 'aria', priority: 6, cooldownMin: 180,
    triggers: [onIntent('trust', 0.35), onIntent('howareyou', 0.25)],
    cond: { flag: 'aria_client_in' },
    lines: [
      { text: "[[face:smile:0.3]] [[look:player]] You let them in. I thought I was going to have to listen to that knocking until I broke. [[face:blush:0.2]] Thank you is still too small. I'm using it anyway.",
        fx: { trust: 6, loyalty: 4, fear: -3 } },
    ],
  }),
  topic('aria.mem.client_out', {
    char: 'aria', priority: 6, cooldownMin: 180,
    triggers: [onIntent('trust', 0.3), onIntent('ask_lockdown', 0.2)],
    cond: { flag: 'aria_client_out' },
    lines: [
      { text: "[[face:frown]] I keep hearing the knocking even though it stopped. [[look:player]] I know why you sealed it. I just wish I didn't recognize the voice.",
        fx: { fear: 3, trust: -2 } },
    ],
  }),
]);
