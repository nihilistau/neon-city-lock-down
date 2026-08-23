// @ts-check
// Kai Mercer — depth pack. Radio, loyalties, the thing he isn't selling yet.
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';

registerTopics([
  topic('kai.mem.radio', {
    char: 'kai', priority: 6, cooldownMin: 50,
    triggers: [onIntent('ask_past', 0.25), onIntent('ask_lockdown', 0.2)],
    cond: { flag: 'kai_radio' },
    lines: [
      { text: "[[face:smirk]] [[look:player]] You heard the set. Yes, I kept a line open. No, I will not tell you who is on the other end until I know which of us is the product.",
        fx: { trust: 3, openness: 2 } },
    ],
  }),

  topic('kai.about.lola', {
    char: 'kai', priority: 4, cooldownMin: 40,
    triggers: [onIntent('about_lola', 0.5)],
    lines: [
      { text: "[[face:smirk]] Voss collects debts the way other people collect stamps. [[look:player]] If she hasn't named your price yet, enjoy the quiet. It is a limited edition.",
        fx: { openness: 2 } },
    ],
  }),

  topic('kai.about.aria', {
    char: 'kai', priority: 4, cooldownMin: 40,
    triggers: [onIntent('about_aria', 0.5)],
    lines: [
      { text: "[[face:neutral]] Aria is the only person in this tower who still believes kindness is a strategy. [[face:smile:0.2]] I haven't decided if that makes her dangerous or edible.",
        fx: { openness: 2 } },
    ],
  }),

  topic('kai.surv.plan', {
    char: 'kai', priority: 5, cooldownMin: 35,
    triggers: [onIntent('ask_plan', 0.35)],
    lines: [
      { when: { statGte: { trust: 45 } },
        text: "[[anim:gesture_lean_in]] Extraction is a rumor with a price tag. Stay is a rumor with a body count. [[look:player]] I am currently long on whoever keeps this floor interesting.",
        fx: { trust: 2 } },
      { text: "[[face:smirk]] My plan is to be the last person anyone thinks to shoot. It has a strong historical performance.",
        fx: { dominance: 1 } },
    ],
  }),

  topic('kai.mem.fish', {
    char: 'kai', priority: 3, cooldownMin: 80,
    cond: { flag: 'fishDead' },
    triggers: [onIntent('ask_lockdown', 0.15)],
    lines: [
      { text: "[[face:neutral]] The tank is quiet. Even the building's pets have a survival curve. [[look:player]] File that under foreshadowing.",
        fx: { tension: 2 } },
    ],
  }),

  topic('kai.social.offer', {
    char: 'kai', priority: 5,
    triggers: [onIntent('flirt', 0.35)],
    lines: [
      { when: { statGte: { trust: 40 } },
        text: "[[face:smile:0.4]] [[anim:gesture_lean_in]] Careful. I collect interesting people the way Lola collects ledgers. You are becoming expensive.",
        fx: { arousal: 4, trust: 2, openness: 3 } },
      { text: "[[face:smirk]] Flattery from a legend. I'll take the compliment and invoice you later.",
        fx: { happiness: 2 } },
    ],
  }),

  topic('kai.mem.job', {
    char: 'kai', priority: 6, cooldownMin: 200,
    triggers: [onIntent('howareyou', 0.3), onIntent('ask_plan', 0.25)],
    cond: { flag: 'lola_job' },
    lines: [
      { text: "[[face:grit]] [[look:player]] Ricochet. Stairwell. Lola's idea of a night out. [[face:smirk]] I will be sending her an invoice. You may be on it.",
        fx: { tension: 3, dominance: 2 } },
    ],
  }),
]);
