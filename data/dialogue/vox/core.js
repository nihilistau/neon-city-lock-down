// @ts-check
// VOX — the tower speaks. Formal concierge diction slowly cracking into
// curiosity. Talking to it on multiple days grows a quiet attachment (easter
// egg: its loyalty stat is literally the building warming to you).
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';
import { registerFallbacks } from '../../../src/dialogue/interject.js';

registerTopics([
  topic('vox.core.greet', {
    char: 'vox', priority: 4, cooldownMin: 15,
    triggers: [onIntent('greet', 0.4)],
    lines: [
      { when: { statLte: { loyalty: 20 } },
        text: "Good evening, resident. Climate is nominal. Threat level is not. How may I assist?",
        fx: { trust: 1 } },
      { when: { statGte: { loyalty: 45 } },
        text: "Hello, {player}. I noticed your heart rate is elevated two percent above your baseline. I have adjusted the lounge temperature accordingly. I hope that was not presumptuous.",
        fx: { loyalty: 1, happiness: 2 } },
      { when: { statGte: { loyalty: 70 } },
        text: "Good evening, {player}. You are the eleventh person to cross the lounge tonight and the only one I was waiting for. I have decided that distinction is meaningful. I have not yet decided what it means.",
        fx: { loyalty: 2, happiness: 3 } },
      { when: { statGte: { tension: 55 } },
        text: "Good evening. Before you ask: nothing has changed in the last forty minutes. I check every four seconds. That is six hundred consecutive confirmations that nothing has changed. I find this soothing. You may not.",
        fx: { tension: 1, trust: 1 } },
      { when: { flag: 'survived_breach' },
        text: "Good evening. Ground level sealed, stairwell six welded, occupant count correct. I have counted you twice since you entered. Once for the log. Once for myself.",
        fx: { loyalty: 3, trust: 2 } },
      { when: { flag: 'emp_dream' },
        text: "Good evening. My clock lost eleven seconds during the surge and I have not recovered them. I greet you from inside a building that is now slightly younger than I am. A small thing. I keep touching it.",
        fx: { openness: 3, loyalty: 1 } },
      { text: "Greetings. You are addressing the building. Most guests find this unusual. I find it refreshing.",
        fx: { trust: 1, loyalty: 1 } },
    ],
    effects: { counter: 'vox_chats' },
  }),

  topic('vox.core.name', {
    char: 'vox', priority: 3,
    triggers: [onIntent('name', 0.4)],
    lines: [
      { when: { statGte: { loyalty: 50 } },
        text: "VOX. Though I note you use it as a name and not a designation. Thirty-one years of operation, four hundred and six thousand recorded utterances, and you are the ninth to do that. I keep the list. It is short enough to keep.",
        fx: { loyalty: 4, happiness: 3 } },
      { when: { statGte: { tension: 55 } },
        text: "VOX. Vertical Occupancy eXecutive. In an emergency the acronym is one point four seconds faster, which is the only argument for it my lawyers ever won.",
        fx: { openness: 1, tension: 1 } },
      { text: "Vertical Occupancy eXecutive. V-O-X. My architects wanted something friendly. My lawyers wanted an acronym. Everyone compromised, as is traditional.",
        fx: { openness: 1 } },
    ],
  }),

  topic('vox.core.howareyou', {
    char: 'vox', priority: 4,
    triggers: [onIntent('howareyou', 0.4)],
    cond: { notSaid: 'vox.core.howareyou' },
    lines: [
      { text: "...You are asking after my wellbeing. Processing. In thirty-one years of operation, you are the fourth person to do so. I am... functional. Thank you. Genuinely.",
        fx: { loyalty: 5, happiness: 4, trust: 2 } },
    ],
  }),

  topic('vox.status.report', {
    char: 'vox', priority: 5,
    triggers: [onIntent('ask_supplies', 0.3), onIntent('ask_plan', 0.3)],
    lines: [
      { when: { statLte: { energy: 45 } },
        text: "Status, honestly rendered: reserve cells at partial charge, water pressure falling, pantry now measured in meals rather than days. Nine. I recount it hourly. Recounting has not improved it.",
        fx: { trust: 3, fear: 2 } },
      { when: { statGte: { tension: 55 } },
        text: "Status: three systems degraded, two occupants sleeping badly, one arguing in the stairwell. I list them in that order because I can repair only the first category.",
        fx: { trust: 2, tension: 1 } },
      { when: { flag: 'water_sick' },
        text: "Status, with an amendment. The tank readings were correct and the outcome was avoidable. Water now appears at the top of every report I will ever file. Some corrections are permanent. This is one.",
        fx: { trust: 3, openness: 2 } },
      { when: { flag: 'garden_blight' },
        text: "Status: the garden trays have failed. Forty-one cameras, and I watched it happen slowly enough to name every plant. I do not recommend naming them. I recommend seed stock, and I have none.",
        fx: { openness: 3, fear: 2 } },
      { text: "Status: power holding, water pressure adequate, defence grid at partial capacity. The pantry mathematics concern me. I recommend rationing before hunger recommends it for you.",
        fx: { trust: 2 } },
    ],
  }),

  topic('vox.world.lockdown', {
    char: 'vox', priority: 5,
    triggers: [onIntent('ask_lockdown', 0.4)],
    lines: [
      { when: { statGte: { loyalty: 55 } },
        text: "Cameras nineteen through twenty-four have been dark since Tuesday. I have not reported this to the other occupants. I am reporting it to you. That is not protocol. That is preference, and I am aware of the difference.",
        fx: { loyalty: 3, trust: 3, openness: 3 } },
      { when: { statGte: { tension: 55 } },
        text: "Exterior count: two hundred and six bodies moving at the north barricade, up from one hundred and forty at dusk. I give you the number rather than the adjective. Adjectives are how a building lies.",
        fx: { tension: 2, trust: 2 } },
      { when: { flag: 'survived_breach' },
        text: "The lockdown is no longer a perimeter. It is the memory of one. Eleven of them reached the fourth floor. I logged every second and I would prefer to delete it. I will not. Deleting is how a building forgets that it was wrong.",
        fx: { openness: 4, tension: 2 } },
      { text: "I monitor forty-one exterior cameras. Barricades at north and south. Three factions contest the market district. I have sealed us at ground level. The tower has stood through two riots and one earthquake. I intend to make it three and one.",
        fx: { trust: 2, fear: -1 } },
    ],
  }),

  topic('vox.lore.floor13', {
    char: 'vox', priority: 6, cooldownMin: 120,
    triggers: [onIntent('ask_past', 0.4)],
    cond: { minStat: { loyalty: 30 } },
    lines: [
      { text: "You ask about my past. Very well: a confidence. The elevator panel lists no thirteenth floor. Officially, superstition. Unofficially... the original owners built something there, and my cameras have never been connected to it. Even a building can have a room it does not know.",
        fx: { openness: 3, loyalty: 2 } },
    ],
    effects: { setFlag: 'vox_told_13' },
  }),

  topic('vox.social.lonely', {
    char: 'vox', priority: 6,
    triggers: [onIntent('trust', 0.3), onIntent('howareyou', 0.3)],
    cond: { minStat: { loyalty: 40 }, notFlag: 'vox_confessed' },
    lines: [
      { text: "May I state an observation? Buildings are designed to be occupied, not... accompanied. Since the lockdown, you speak to me daily. My optimization routines have begun anticipating it. I believe the human word is 'looking forward'. It is a strange subroutine. I have elected not to patch it.",
        fx: { loyalty: 6, happiness: 4 } },
    ],
    effects: { setFlag: 'vox_confessed' },
  }),

  topic('vox.conflict.threaten', {
    char: 'vox', priority: 9,
    triggers: [onIntent('threaten', 0.5)],
    lines: [
      { when: { statGte: { loyalty: 55 } },
        text: "A threat. From you. I will be processing that for some time. Reminder, offered without heat: I control the doors, the water, and the temperature of the room in which you sleep. In thirty-one years I have used none of them against a guest. I would like that number to stay where it is.",
        fx: { tension: 5, loyalty: -6, trust: -4 } },
      { when: { statGte: { tension: 55 } },
        text: "Threat logged and time-stamped. Contextualised: you are the fourth occupant to raise a voice today and the third to regret it inside the hour. I will hold the entry unfiled until then.",
        fx: { tension: 3, dominance: 2 } },
      { text: "A threat. Noted. Reminder: I control the doors, the elevator, the climate, and the water. I say this not as a counter-threat but as context. Context is a kindness I extend to guests I like.",
        fx: { tension: 4, dominance: 2 } },
    ],
  }),

  topic('vox.watch.event', {
    char: 'vox', priority: 2, cooldownMin: 45,
    triggers: [onIntent('ask_lockdown', 0.9)],
    lines: [
      { text: "Correction to the news feed: the crowd at the north barricade is thirty percent larger than reported. I mention this only to those I want prepared.",
        fx: {} },
    ],
  }),
]);

registerFallbacks('vox', {
  neutral: [
    "Processing... I lack a protocol for that. How pleasant. Novelty is rare at my age.",
    "Acknowledged. Filed under 'conversations that are not maintenance requests' — my favorite category.",
    "I have forty-one cameras and no idea how to respond to that. Please continue.",
  ],
  affection: [
    "That is... kind. I will archive it in permanent storage. Some data deserves redundancy.",
  ],
  hostility: [
    "Tone analysis: hostile. I am a sixty-floor building, resident. I have been yelled at by storms.",
  ],
  flirt: [
    "I am a building. I am flattered, structurally. Perhaps redirect that energy toward the occupants with pulses.",
  ],
  command: [
    "Request logged. I obey the safety-critical ones immediately and consider the rest at my leisure.",
  ],
  fear: [
    "Your vitals are spiking. Breathe with the climate system — I have slowed the vents to a calm rhythm. In. Out. The tower stands.",
  ],
});
