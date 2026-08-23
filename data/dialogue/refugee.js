// @ts-check
// Dialogue pack for a spawned refugee. `registerRefugeeTopics(id)` binds the
// same beats to whatever id buildRefugee assigned.
//
// Note the fallback ladder is registered here too, per-id, for the same reason:
// a refugee with topics but no ladder answers anything unmatched with total
// silence, which reads as a broken NPC rather than a frightened one.
import { topic, onIntent } from '../schema.js';
import { registerTopics } from '../../src/dialogue/topics.js';
import { registerFallbacks } from '../../src/dialogue/interject.js';

/** @param {string} id */
export function registerRefugeeTopics(id) {
  registerTopics([
    topic(`${id}.core.greet`, {
      char: id, priority: 4, cooldownMin: 15,
      triggers: [onIntent('greet', 0.4)],
      lines: [
        { when: { statGte: { trust: 45 } },
          text: "[[face:smile:0.3]] [[look:player]] Hey. [[anim:idle_stand]] I slept four hours straight last night. First time since the barricades. I keep wanting to tell someone and you're the only one who'd care.",
          fx: { trust: 2, fear: -3, happiness: 3 } },
        { when: { statGte: { fear: 55 } },
          text: "[[anim:idle_shy]] [[look:player]] Don't — sorry. Sorry. [[face:frown]] Every time a door moves I think it's the one that puts me back outside.",
          fx: { fear: 2, trust: 1 } },
        { when: { statGte: { tension: 60 } },
          text: "[[face:frown]] [[anim:idle_shy]] I know. I know what the room's doing the arithmetic on. [[look:player]] I eat less than any of you. I've been counting so you don't have to.",
          fx: { tension: 2, trust: 1, fear: 2 } },
        { when: { statLte: { energy: 35 } },
          text: "[[face:neutral]] [[anim:idle_shy]] Hey. [[look:player]] Don't mind me sitting. My legs did four days of running and they've only just found out it stopped.",
          fx: { trust: 2, openness: 2 } },
        { text: "[[face:frown]] [[look:player]] Hey. I — I'm not here to take anything. I just needed a door that closed.",
          fx: { trust: 2, fear: -2 } },
      ],
    }),
    topic(`${id}.core.howareyou`, {
      char: id, priority: 3,
      triggers: [onIntent('howareyou', 0.4)],
      lines: [
        { when: { statGte: { trust: 45 } },
          text: "[[face:smile:0.2]] [[look:player]] Better. [[anim:idle_stand]] Which is a strange thing to say in a siege, but I've got walls and you keep asking, and those are the two things I didn't have last week.",
          fx: { trust: 3, happiness: 3, fear: -3 } },
        { when: { statGte: { fear: 55 } },
          text: "[[anim:idle_shy]] [[face:frown]] Bad. [[look:player]] I'm sorry, I know that's not what people want to hear. I've run out of the version where I say fine.",
          fx: { openness: 3, trust: 2 } },
        { when: { statLte: { sobriety: 65 } },
          text: "[[face:smile:0.2]] [[look:player]] Drunk, honestly. [[anim:idle_stand]] Someone handed me a glass and didn't ask me to earn it first. That's the part that got me, not the drink.",
          fx: { openness: 4, happiness: 3, trust: 2 } },
        { text: "[[face:frown]] Alive. That's the whole report. The streets are a meat grinder and I still have both hands.",
          fx: { openness: 2 } },
      ],
    }),
    topic(`${id}.back.who`, {
      char: id, priority: 5, cooldownMin: 40,
      triggers: [onIntent('ask_past', 0.4)],
      lines: [
        { when: { statGte: { trust: 45 } },
          text: "[[look:player]] [[face:neutral]] Nine years on that pitch. I knew which customers were skimming and I let them, because they came back. [[anim:idle_stand]] [[face:frown]] I ran a business on knowing people. Then it turned out I didn't know them at all.",
          fx: { trust: 4, openness: 4 } },
        { when: { statGte: { fear: 55 } },
          text: "[[anim:idle_shy]] [[face:frown]] Does it matter? [[look:player]] Whoever I was is on the wrong side of a barricade. Ask me again when I've decided who I am up here.",
          fx: { openness: 1, fear: 1 } },
        { when: { statLte: { trust: 20 } },
          text: "[[face:neutral]] [[anim:idle_shy]] Market trade. Small stall. [[look:player]] That's the short version, and the short version is what you get from someone who might be back on the street by morning.",
          fx: { openness: 2, trust: 1 } },
        { text: "[[look:player]] I ran a stall on the south spine. Fruit, mostly. Then the barricades burned and the stall was a stall in a fire. I ran until the tower.",
          fx: { trust: 3, openness: 3 } },
      ],
    }),
    topic(`${id}.world.lockdown`, {
      char: id, priority: 4,
      triggers: [onIntent('ask_lockdown', 0.35)],
      lines: [
        { when: { statGte: { trust: 45 } },
          text: "[[look:player]] [[face:neutral]] You want the part the feeds don't run? [[anim:idle_stand]] It's organised. Somebody's paying the ones at the north barricade — they rotate, they eat in shifts. [[face:frown]] Riots don't have shift patterns.",
          fx: { trust: 3, openness: 4, tension: 2 } },
        { when: { statGte: { fear: 55 } },
          text: "[[anim:idle_shy]] [[face:frown]] I can't. [[look:player]] I'm sorry. I was down there four days ago and I'm not — I'm not ready to be a person who talks about it yet.",
          fx: { fear: 4, trust: 1 } },
        { when: { statGte: { tension: 60 } },
          text: "[[face:frown]] [[look:player]] It'll come up the building. That's what it does. [[anim:idle_shy]] Not tonight, maybe not this week. But a locked door is just a slower door.",
          fx: { tension: 3, fear: 3 } },
        { text: "[[face:frown]] You can hear it through the glass. People who used to buy my oranges are the ones screaming. I don't know what that makes me.",
          fx: { fear: 3, tension: 2 } },
      ],
    }),
  ]);

  registerFallbacks(id, {
    neutral: [
      "[[face:neutral]] [[look:player]] Sorry — say it again? I'm still half listening for the stairs.",
      "[[anim:idle_shy]] I don't have an answer for that. I've mostly been running. Running doesn't teach you much.",
      "[[face:frown]] Mm. [[look:player]] Everything's a big question up here. Down there it was only ever one.",
      "[[face:neutral]] [[anim:idle_stand]] You're talking to me like I live here. [[look:player]] Give me a day to get used to it.",
      "[[look:player]] [[face:smile:0.2]] I'll take any conversation that isn't about rations. Keep going.",
    ],
    affection: [
      "[[face:smile:0.3]] [[look:player]] ...Careful. Nobody's been kind to me in about a week and I'm not braced for it.",
      "[[anim:idle_shy]] [[face:blush:0.3]] You don't have to do that. [[look:player]] But thank you. I'll be holding onto it.",
      "[[face:smile:0.2]] Whatever you're doing — it's working. I've stopped counting the exits every minute.",
    ],
    hostility: [
      "[[anim:idle_shy]] [[face:frown]] Okay. [[look:player]] Okay. Just tell me if you want me gone and I'll go. I'd rather hear it than feel it.",
      "[[face:frown]] I've had that shouted at me by better-armed people this week. [[look:player]] It landed harder from you.",
      "[[face:neutral]] [[anim:idle_shy]] I'm not going to fight you. I don't have anything left to fight with.",
    ],
    flirt: [
      "[[face:blush:0.4]] [[anim:idle_shy]] Oh — [[look:player]] I'm filthy, I'm exhausted, and you're saying that to me. This city makes no sense at all.",
      "[[face:blush:0.3]] [[face:smile:0.2]] I'd say something clever back. [[look:player]] I used to be clever. Give me a night's sleep and try again.",
      "[[look:player]] [[face:blush:0.3]] Careful what you offer someone with nothing. [[face:smile:0.2]] I might believe you.",
    ],
    command: [
      "[[anim:idle_shy]] [[face:neutral]] Yeah. [[look:player]] Of course. Tell me where you want me.",
      "[[face:frown]] I'll do it. [[look:player]] I'd just rather you asked, so I can keep pretending I chose it.",
      "[[face:neutral]] [[anim:idle_stand]] Say the word and it's done. I know exactly what my place here costs.",
    ],
    fear: [
      "[[face:frown]] [[look:player]] You too? [[anim:idle_shy]] Good. Then I'm not the only one and I can stop apologising for it.",
      "[[anim:idle_shy]] Sit down. Put your back to something solid. [[look:player]] That's all I've got — it's what got me here.",
      "[[face:frown]] Listen for the vents instead. [[look:player]] The building's still breathing. Four days out there and I'd have killed for that sound.",
    ],
  });
}
