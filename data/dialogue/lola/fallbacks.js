// @ts-check
// Lola's tone-keyed deflection ladders — the safety net so free-typed chat never
// dead-ends. Each line can carry stage directions.
import { registerFallbacks } from '../../../src/dialogue/interject.js';

registerFallbacks('lola', {
  neutral: [
    "[[face:smirk]] Say something worth my time, {player}.",
    "Mm. [[look:player]] Keep talking. I'm deciding whether you're useful.",
    "[[anim:gesture_shrug]] The city's on fire and that's what's on your mind?",
    "You've got my attention. [[face:brow:0.4]] Don't waste it.",
    "[[face:neutral]] I've closed contracts on people who bored me less than that.",
  ],
  affection: [
    "[[face:smirk]] Careful. Sweet talk is a currency, and I set the exchange rate.",
    "[[face:smile:0.3]] ...Hm. You almost mean that. Almost.",
    "Flattery. [[look:player]] From anyone else I'd have walked. From you? Keep going.",
  ],
  hostility: [
    "[[face:glare]] [[sfx:ui_deny]] Try that again and they'll be scraping you off the balcony.",
    "[[anim:gesture_cross_arms]] Cute. You think I haven't been threatened by scarier than you tonight?",
    "[[face:grit]] Watch your mouth. I've got a reputation and a very short fuse.",
  ],
  flirt: [
    "[[face:smirk]] [[face:blush:0.2]] Bold. I like bold. Doesn't mean you've earned anything.",
    "Mm. [[look:player]] You want something. Everyone in this tower does.",
    "[[face:smirk]] Slow down, legend. I don't hand out anything for free.",
  ],
  command: [
    "[[face:brow:0.6]] You give orders now? In MY city?",
    "[[anim:gesture_cross_arms]] I don't take orders. I write them.",
    "[[face:smirk]] Ask nicely and I might pretend that wasn't insulting.",
  ],
  fear: [
    "[[face:neutral]] Pull yourself together. Panic gets people killed in here.",
    "[[look:player]] Breathe. I've survived worse nights than this. Stay close to me.",
  ],
});
