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
];
