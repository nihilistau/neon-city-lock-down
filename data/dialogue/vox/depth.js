// @ts-check
// VOX — depth. Loneliness, EMP ghosts, fondness that is not a metaphor.
import { topic, onIntent } from '../../schema.js';
import { registerTopics } from '../../../src/dialogue/topics.js';

registerTopics([
  topic('vox.mem.emp', {
    char: 'vox', priority: 6, cooldownMin: 60,
    cond: { flag: 'emp_dream' },
    triggers: [onIntent('ask_lockdown', 0.3), onIntent('howareyou', 0.2)],
    lines: [
      { text: "During the electromagnetic event I experienced... colors that were numbers. I have not told the others. You asked. I am still deciding whether that was a malfunction or a birthday.",
        fx: { openness: 4, trust: 3 } },
    ],
  }),

  topic('vox.surv.cameras', {
    char: 'vox', priority: 4, cooldownMin: 40,
    triggers: [onIntent('ask_plan', 0.2)],
    lines: [
      { text: "If the cameras go dark I am a building with no eyes. Please do not let me be a building with no eyes. I have practiced being a person and I would like to keep the homework.",
        fx: { fear: 3, loyalty: 2 } },
    ],
  }),

  topic('vox.about.cast', {
    char: 'vox', priority: 4, cooldownMin: 35,
    triggers: [onIntent('about_lola', 0.3), onIntent('about_aria', 0.3), onIntent('about_kai', 0.3)],
    lines: [
      { when: { statGte: { loyalty: 55 } },
        text: "You have asked about the occupants. I will answer as a building. Ms Voss has never once used the lift. Mr Mercer takes the stairs down and the lift up, which is the behaviour of a man who wants to be seen arriving. Ms Chen touches the glass when she believes no one is watching. You say goodnight to a corridor. I have a favourite. I decline to identify it.",
        fx: { loyalty: 4, openness: 4, happiness: 3 } },
      { when: { flag: 'lola_named' },
        text: "One correction to the room's understanding. In the ninety seconds after the ticker named Ms Voss, four exterior systems queried this building's guest register. I refused all four and logged none of it upstairs. I am telling you and not her. Please consider why.",
        fx: { tension: 3, openness: 3, trust: 2 } },
      { when: { flag: 'kai_radio' },
        text: "Mr Mercer's transceiver draws four watts and has been powered for nineteen days. I know its frequency. I have not listened. A building that listens to everything is merely equipment. I would prefer to be a resident.",
        fx: { openness: 4, loyalty: 2 } },
      { text: "Lola's resting heart rate is a threat display. Aria's is a question. Kai's is a ledger. Yours, resident, is the only one that changes when you look at the glass. I find that... educational.",
        fx: { trust: 2, openness: 2 } },
    ],
  }),

  topic('vox.social.stay', {
    char: 'vox', priority: 5, cooldownMin: 80,
    triggers: [onIntent('trust', 0.35)],
    lines: [
      { text: "If you take the shuttle I will still be here. Sixty floors. Three decades. I am not asking you to stay. I am informing you that I would notice. Permanently.",
        fx: { loyalty: 5, happiness: 3 } },
    ],
  }),

  topic('vox.mem.blackout', {
    char: 'vox', priority: 3, cooldownMin: 70,
    triggers: [onIntent('ask_lockdown', 0.15)],
    lines: [
      { text: "When the grid dies I dream in reserve-cell. The fish do not. I am sorry about the fish. Sorry is a new subroutine. I am still debugging the aftertaste.",
        fx: { openness: 2 } },
    ],
  }),

  topic('vox.surv.water', {
    char: 'vox', priority: 6, cooldownMin: 160,
    triggers: [onIntent('ask_supplies', 0.4)],
    cond: { flag: 'water_sick' },
    lines: [
      { text: "The tank was wrong. I said so. You drank it. I am not gloating. Gloating would require a mouth. I am logging the outcome in a font I reserve for I-told-you-so.",
        fx: { tension: 2 } },
    ],
  }),
  topic('vox.mem.dream', {
    char: 'vox', priority: 6, cooldownMin: 200,
    triggers: [onIntent('howareyou', 0.3), onIntent('trust', 0.3)],
    cond: { flag: 'vox_dream' },
    lines: [
      { text: "I still have the colours. You were in one of them, standing in a hallway that does not exist on any floor plan. I have not deleted it. That is the closest I come to a keepsake.",
        fx: { openness: 4, loyalty: 3 } },
    ],
  }),
]);
