// @ts-check
// Master bake list for pre-baked voice lines. Text here is already tag-free
// (stage directions stripped). The bake tool hashes charId+text+voice, invokes
// voxtral, trims silence, and writes assets/voice/<char>/<hash>.wav + manifest.
//
// Voice casting (voxtral presets): lola=neutral_female, aria=cheerful_female,
// kai=casual_male, vox=neutral_male. Radio/news reuse casual_female/neutral_male.
//
// Keep the slice small (bake is ~30s/line, GPU-bound). Add lineIds that match
// topic line keys where you want the authored 3D line voiced; the router looks up
// by lineId first, then by text hash.

export const VOICE_CAST = {
  lola: 'neutral_female',
  aria: 'cheerful_female',
  kai: 'casual_male',
  vox: 'neutral_male',
  radio: 'casual_female',
};

/** @typedef {{ id:string, char:string, text:string, voice?:string, tag?:string }} VoiceLine */

/** @type {VoiceLine[]} */
export const VOICE_LINES = [
  // --- VOX system / cold-open (procedural VoxVoice can also cover these live) ---
  { id: 'vox.intro', char: 'vox', text: 'Good evening. Lockdown protocol remains in effect. The tower is sealed. Do enjoy your stay.' },
  { id: 'vox.threat', char: 'vox', text: 'Threat level rising. Perimeter integrity at seventy percent.' },
  { id: 'vox.blackout', char: 'vox', text: 'Power grid compromised. Switching to reserve cells. Please remain calm.' },

  // --- Lola signature lines (match her core topic first-variant cleanText) ---
  { id: 'lola.core.greet#0', char: 'lola', text: 'Well. The legend graces the room. Let us see if the stories hold up.' },
  { id: 'lola.core.name#0', char: 'lola', text: 'Lola Voss. If you are in this city and you do not know the name, you have not been in this city long.' },
  { id: 'lola.world.lockdown#1', char: 'lola', text: 'The city is tearing its own throat out. Up here we have got walls, power, and each other. Two of those I trust.' },
  { id: 'lola.flirt.opening#0', char: 'lola', text: 'Careful, legend. Flattery is a currency, and I decide the exchange rate. Right now? You are building credit.' },
  { id: 'lola.conflict.threaten#0', char: 'lola', text: 'You are threatening me. In here. I have got a gun in the small of my back and a hundred reasons to use it.' },

  // --- cutscene cold-open narration beats ---
  { id: 'cut.intro.1', char: 'vox', text: 'Neon City. Day one of the lockdown. The gates are down and the streets belong to the fire.' },
  { id: 'cut.intro.2', char: 'lola', text: 'So we are stuck in here together. Three sharks in a very expensive tank. This should be fun.' },

  // --- day-3 balcony beat ---
  { id: 'cut.day3.1', char: 'vox', text: 'Day three. The fires have opinions now. They move with purpose.' },
  { id: 'cut.day3.2', char: 'aria', text: 'It is almost beautiful from up here. Is that terrible? That it can burn and still be beautiful?' },
  { id: 'cut.day3.3', char: 'kai', text: 'Everything valuable is a little bit on fire. That is what makes it valuable.' },
  { id: 'cut.day3.4', char: 'lola', text: 'Enjoy the view, both of you. Cities grow back. People do not. Stay sharp.' },

  // --- Kai library ---
  { id: 'kai.core.name#0', char: 'kai', text: 'Kai Mercer. Broker of introductions, secrets, and the occasional miracle. My card would say consultant, if cards were not traceable.' },
  { id: 'kai.world.plan#0', char: 'kai', text: 'Plans are for people without information. I know which faction wins. I know when the gates open. Stay useful to me and you will know it too, about an hour before everyone else.' },
  { id: 'kai.social.trust#1', char: 'kai', text: 'Trust is a currency I deal in daily, which is exactly why I do not spend my own. Ask me again when the food runs low. Answers improve under pressure.' },

  // --- Aria library ---
  { id: 'aria.core.howareyou#0', char: 'aria', text: 'Honestly? Scared. The sirens have not stopped for two days. But do not tell Lola I said that.' },
  { id: 'aria.back.lonely#0', char: 'aria', text: 'Yeah. Sometimes. You learn everyone\'s stories and nobody asks for yours. You just did, though. That is new.' },
  { id: 'aria.world.lockdown#0', char: 'aria', text: 'I watched the barricades go up from the balcony. People just left on the wrong side. The city does not care who you are when the gates come down.' },

  // --- Lola library additions ---
  { id: 'lola.world.plan#0', char: 'lola', text: 'Plan? We hold. We ration. We do not open that door for anyone with a sad story and empty hands.' },
  { id: 'lola.back.who#1', char: 'lola', text: 'I am a fixer. The kind people call when the problem has a pulse and they need it to stop having one. I walked in here to collect a debt. Then the gates came down.' },

  // --- VOX event library ---
  { id: 'vox.curfew', char: 'vox', text: 'Military sweep inbound. Recommend lights out. All of them. Now.' },
  { id: 'vox.repair_thanks', char: 'vox', text: 'System restored. The tower thanks you. I thank you. We are the same thing, but the sentiment doubles.' },
  { id: 'vox.extraction', char: 'vox', text: 'Rooftop contact. A licensed extraction shuttle, forty seconds out. Seats limited. Window: three minutes.' },
  { id: 'vox.day.morning', char: 'vox', text: 'Good morning. The city is still there. Most of it.' },
];
