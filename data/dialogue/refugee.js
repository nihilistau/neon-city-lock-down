// @ts-check
// Dialogue pack for a spawned refugee. `registerRefugeeTopics(id)` binds the
// same beats to whatever id buildRefugee assigned.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';

/** @param {string} id */
export function registerRefugeeTopics(id) {
  registerTopics([
    topic(`${id}.core.greet`, {
      char: id, priority: 4, cooldownMin: 15,
      triggers: [onIntent('greet', 0.4)],
      lines: [
        { text: "[[face:fear]] [[look:player]] Hey. I — I'm not here to take anything. I just needed a door that closed.",
          fx: { trust: 2, fear: -2 } },
      ],
    }),
    topic(`${id}.core.howareyou`, {
      char: id, priority: 3,
      triggers: [onIntent('howareyou', 0.4)],
      lines: [
        { text: "[[face:frown]] Alive. That's the whole report. The streets are a meat grinder and I still have both hands.",
          fx: { openness: 2 } },
      ],
    }),
    topic(`${id}.back.who`, {
      char: id, priority: 5, cooldownMin: 40,
      triggers: [onIntent('ask_past', 0.4)],
      lines: [
        { text: "[[look:player]] I ran a stall on the south spine. Fruit, mostly. Then the barricades burned and the stall was a stall in a fire. I ran until the tower.",
          fx: { trust: 3, openness: 3 } },
      ],
    }),
    topic(`${id}.world.lockdown`, {
      char: id, priority: 4,
      triggers: [onIntent('ask_lockdown', 0.35)],
      lines: [
        { text: "[[face:fear]] You can hear it through the glass. People who used to buy my oranges are the ones screaming. I don't know what that makes me.",
          fx: { fear: 3, tension: 2 } },
      ],
    }),
  ]);
}
