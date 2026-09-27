// @ts-check
// Inviting someone to the bed. Being turned down is a real answer, so every
// topic has a refusal line gated on the bond instead of a topic `cond` (a topic
// that silently fails to match reads as the parser not understanding you).
// The `bed` field on a line — not the topic — asks src/sim/bedScene.js to act,
// so a refusal can never seat anyone.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';
import { registerIntents } from '../../src/dialogue/parser/intents.js';

registerIntents([
  { id: 'bed_invite', keywords: ['bed'],
    phrases: ['come sit', 'sit with me', 'join me', 'come here', 'sit on the bed', 'come to bed'], base: 0.6 },
  { id: 'bed_stay', keywords: ['tonight'],
    phrases: ['stay the night', 'stay with me', 'stay tonight', 'dont go', "don't go"], base: 0.65 },
  { id: 'bed_dismiss', keywords: [],
    phrases: ['you can go', 'goodnight', 'get some rest', 'leave me be'], base: 0.55 },
]);

/** One narration line per stay, per character. Implied, never described. */
export const BED_NARRATION = {
  lola: [
    'Lola keeps one hand near her knife even asleep. Tonight, the other stays in yours.',
    'The sirens go on without you. Lola doesn\'t say a word, and doesn\'t need to.',
  ],
  aria: [
    'Aria talks until she doesn\'t. The city hums. For a few hours, neither of you is alone.',
    'Somewhere below, the riot burns itself out. Aria\'s breathing slows beside you.',
  ],
  kai: [
    'Kai counts the drones until he loses count. The dark is kinder than it was.',
    'Rain on the glass. Kai\'s shoulder against yours. Three hours pass like one.',
  ],
  _default: ['The city hums on. For a few hours, neither of you is alone.'],
};

/** @param {string} charId @param {{pick?: (arr: string[]) => string}} [rng] */
export function narrationFor(charId, rng) {
  const pool = BED_NARRATION[charId] || BED_NARRATION._default;
  return rng?.pick ? rng.pick(pool) : pool[0];
}

/** @param {string} char @param {{invite: string, invitePlus: string, refuse: string, stay: string, stayRefuse: string, bye: string}} t */
const bedTopics = (char, t) => [
  topic(`${char}.bed.invite`, {
    char, priority: 7, cooldownMin: 5,
    triggers: [onIntent('bed_invite', 0.45)],
    lines: [
      { when: { bondBelow: 'ally' }, text: t.refuse, fx: { tension: 1 } },
      { when: { bondAtLeast: 'trusted' }, text: t.invitePlus, bed: 'invite' },
      { when: { bondAtLeast: 'ally' }, text: t.invite, bed: 'invite' },
    ],
    branches: [{ chip: 'Stay the night?', goto: `${char}.bed.stay`, intents: ['bed_stay'] }],
  }),
  topic(`${char}.bed.stay`, {
    char, priority: 8, cooldownMin: 60,
    triggers: [onIntent('bed_stay', 0.45)],
    lines: [
      { when: { bondBelow: 'trusted' }, text: t.stayRefuse, fx: { tension: 1 } },
      { when: { bondAtLeast: 'trusted' }, text: t.stay, bed: 'stay' },
    ],
  }),
  topic(`${char}.bed.dismiss`, {
    char, priority: 5, cooldownMin: 1,
    triggers: [onIntent('bed_dismiss', 0.45)],
    lines: [{ text: t.bye, bed: 'dismiss' }],
  }),
];

registerTopics([
  ...bedTopics('lola', {
    refuse: "[[face:neutral]] [[look:player]] I sit where I can see the door. That isn't there.",
    invite: "[[look:player]] Fine. Five minutes. Don't make it strange.",
    invitePlus: "[[face:smirk]] [[look:player]] Move over. You're hogging the good side.",
    stayRefuse: "[[face:neutral]] Ask me that when you've earned it.",
    stay: "[[look:player]] [[beat:0.6]] ...Fine. But I'm sleeping with my boots on.",
    bye: "[[look:player]] Try to sleep. One of us should.",
  }),
  ...bedTopics('aria', {
    refuse: "[[face:frown]] I— no. Not yet. Sorry.",
    invite: "[[face:smile]] [[look:player]] Okay. Yes. It's quieter over there anyway.",
    invitePlus: "[[face:smile]] [[look:player]] I was hoping you'd ask.",
    stayRefuse: "[[face:frown]] [[look:player]] I'm not ready for that. Give me time?",
    stay: "[[face:smile]] [[beat:0.5]] Don't let go of my hand, okay?",
    bye: "[[face:smile]] Goodnight. Wake me if the world ends.",
  }),
  ...bedTopics('kai', {
    refuse: "[[look:player]] I'm good here, thanks.",
    invite: "[[look:player]] Sure. My back's killing me anyway.",
    invitePlus: "[[face:smirk]] [[look:player]] You don't have to ask twice.",
    stayRefuse: "[[look:player]] Let's not rush it.",
    stay: "[[look:player]] [[beat:0.5]] Yeah. I'd like that.",
    bye: "[[look:player]] Night. Holler if something moves.",
  }),
]);
