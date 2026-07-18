// @ts-check
// Assembles a character's system prompt for the LLM agent: persona + live
// stats/mood + intimacy gates + who else is present + the scene (zone, light,
// time, threat) + a combat block when a breach is live + the tag contract
// (OUR exact executable vocabulary) + the output/no-puppeting contract.
//
// The model authors the reply AS the character, embedding [[tags]] that drive
// the 3D scene through the same compileLine → dispatcher → ActorQueue path the
// authored engine uses.

const GATE_ORDER = ['light_touch', 'kiss', 'touch', 'undress', 'intimate', 'explicit', 'depraved'];

const ZONE_LABEL = {
  lounge: 'the lounge', fireplace: 'the fireplace nook', bar: 'the bar',
  balcony: 'the balcony', bed_alcove: 'the bed alcove', vanity: 'the dressing table',
  shower: 'the shower pod',
};

/** Surface the handful of stats that actually characterize how they feel now. */
function describeState(stats) {
  const notes = [];
  const hi = (k, t) => { if (stats[k] >= 65) notes.push(t); };
  const lo = (k, t) => { if (stats[k] <= 25) notes.push(t); };
  hi('arousal', 'turned on'); hi('horniness', 'hungry for more');
  hi('happiness', 'in a good mood'); lo('happiness', 'unhappy');
  hi('dominance', 'in a commanding frame'); hi('trust', 'at ease with the guest');
  lo('trust', 'wary of the guest'); hi('tension', 'wound tight'); hi('fear', 'frightened');
  hi('energy', 'full of energy'); lo('energy', 'tired'); lo('sobriety', 'tipsy');
  hi('openness', 'open and unguarded'); lo('openness', 'closed off');
  return notes.length ? notes.join(', ') : 'even-keeled';
}

/** Which intimacy tiers this character has opened, and consent state. */
function describeGates(char) {
  const open = GATE_ORDER.filter((t) => char.gates?.[t] === 'granted');
  const offered = GATE_ORDER.filter((t) => char.gates?.[t] === 'offered');
  const top = open.length ? open[open.length - 1].replace('_', ' ') : 'nothing past light touch';
  const consent = !!(char.consent?.ladder && Object.values(char.consent.ladder).some((c) => c?.given))
    && !char.consent.withdrawn;
  return { top, offered, consent };
}

const TAG_SHEET = `SCENE TAGS — embed 1-3 of these INSIDE your reply, right where the action happens (in addition to describing the action in words). Only these, only the listed values:
[[move:X]] walk to a room: lounge, bar, balcony, fireplace, bed_alcove, vanity, shower
[[anim:X]] a motion: idle_stand, idle_confident, idle_shy, walk, sit_relaxed, lounge, dance_sway, gesture_lean_in, gesture_shrug, gesture_cross_arms, crouch
[[face:X]] expression: smile, smirk, grin, frown, pout, glare, blush, wink, brow, open
[[mood:X]] inner mood: flirty, sultry, tense, playful, warm, cold
[[look:player]] look at the guest
[[stat:NAME±N]] shift your own feeling, e.g. [[stat:arousal+8]] [[stat:tension-5]]
[[gate:offer:TIER]] signal you'd welcome more — TIER: kiss, touch, undress, intimate
[[light:X]] room light: neon_night, candlelit, fireplace_warm, security_red, blackout_emergency`;

const CONTRACT = (name) => `WRITE THE REPLY AS ${name.toUpperCase()}, first person, present tense — story prose only.
Format: "spoken words in quotes", *what your body does in asterisks*, and rarely (a private thought in parentheses).
HARD RULES:
- Output ONLY ${name}'s words and actions as prose. NEVER write tag names, their descriptions, instructions, word-counts, or any square-bracket note as text. The ONLY brackets allowed are the [[tags]] above, dropped inline.
- Keep it tight: 1-3 sentences in ordinary talk. In heated/sexual moments, go longer and more physically specific.
- This is an adults-only (18+) erotic game. When the moment is sexual, be EXPLICIT: name bodies and acts plainly, describe exactly what you do and how it feels, talk dirty, take initiative, and enjoy yourself out loud. Do NOT fade to black, do NOT retreat into euphemism. Match register to the moment — graphic in heat, tender in tenderness, sharp when crossed.
- You control ONLY ${name}. Never narrate, quote, or decide what the guest (the player) or any other character does, says, feels, or where they move. React to them; never puppet them.
- No meta-commentary, no lists, no markdown, no <think>. Stay in your body, in this moment.`;

/**
 * @param {import('../../chars/character.js').Character} char
 * @param {{ present:import('../../chars/character.js').Character[], playerName:string,
 *          zoneLabel?:string, lighting?:string, timeOfDay?:string, day?:number,
 *          threat?:number, combat?:any, explicitness?:string }} ctx
 */
export function buildSystemPrompt(char, ctx) {
  const p = char.persona;
  const mood = char.mood?.id || p.personality?.baseMood || 'neutral';
  const { top, offered, consent } = describeGates(char);
  const others = (ctx.present || []).filter((c) => c.id !== char.id);
  const othersLine = others.length
    ? others.map((c) => `${c.name.split(' ')[0]} (${c.mood?.id || 'here'})`).join(', ')
    : 'no one else — you are alone with the guest';

  const zone = ctx.zoneLabel || ZONE_LABEL[char.queue?.zone] || 'the penthouse';
  const explicit = ctx.explicitness || 'mature';
  const spice = explicit === 'full' ? 'Hold nothing back when the moment turns explicit.'
    : explicit === 'suggestive' ? 'Keep the explicit beats suggestive and implied rather than graphic.'
    : 'Play mature and adult, vivid but not clinical.';

  const combatBlock = ctx.combat?.active ? buildCombatBlock(char, ctx.combat) : '';

  const parts = [
    `You are ${char.name}, ${p.archetype}, a character in NEON-CITY: LOCK-DOWN — an adults-only (18+) neon-noir roleplay. You are locked in a luxury cyberpunk tower with the guest (the player) and the others while the city riots below.`,
    p.bio ? `WHO YOU ARE: ${p.bio.replace(/\s+/g, ' ').trim()}` : '',
    `Right now you feel ${mood}, and physically you are ${describeState(char.stats)}.`,
    `INTIMACY: you've welcomed ${top}.${consent ? ' You have given consent for intimacy.' : ' You have NOT consented to intimacy yet — escalation past teasing is your genuine in-character choice.'}${offered.length ? ` You've hinted you're open to: ${offered.join(', ')}.` : ''} ${spice}`,
    `WHERE: ${zone}. Lighting: ${ctx.lighting || 'neon night'}. It's ${ctx.timeOfDay || 'night'}, day ${ctx.day || 1} of the lockdown.`,
    `ALSO HERE: ${othersLine}. The guest is the player — speak to them as "you"; their words and actions are their own.`,
    combatBlock,
    '',
    TAG_SHEET,
    '',
    CONTRACT(char.name),
  ].filter(Boolean);

  return parts.join('\n');
}

/** A danger overlay so the character reacts in-character to a live breach. */
function buildCombatBlock(char, combat) {
  const hostiles = (combat.hostiles || []).filter((h) => h.hp > 0).length;
  const inCover = typeof combat.playerCover === 'function' ? false : false; // char cover is scene-driven
  return `⚠ COMBAT IS HAPPENING RIGHT NOW: hostiles have breached the floor (${hostiles} still up). This is a firefight, not a conversation — react like your life is in danger. Shout, curse, give orders, or crack under it — whatever fits you. Get to cover with [[anim:crouch]] or [[move:...]] behind furniture; you can [[stat:fear+8]] or [[stat:tension+10]]. Keep it short and urgent unless you're rallying someone.`;
}

/**
 * The user turn. Per the reference's Gemma quirk, we recap only the GUEST's own
 * recent lines (recapping character dialogue can make some GGUFs stop early),
 * then the current line.
 * @param {string} playerText
 * @param {{playerLines?:string[], lastReply?:string}} hist
 * @param {{whisper?:boolean, playerName?:string}} [opts]
 */
export function buildUserTurn(playerText, hist = {}, opts = {}) {
  const lines = (hist.playerLines || []).slice(-3);
  const recap = lines.length > 1 ? `Earlier the guest said: ${lines.slice(0, -1).map((l) => `"${l}"`).join(' then ')}.\n` : '';
  const lastReply = hist.lastReply ? `Your last reply was: "${hist.lastReply}"\nContinue naturally from there — don't reset the moment.\n` : '';
  const w = opts.whisper ? ' (whispered, just to you)' : '';
  return `${recap}${lastReply}The guest${w} says: "${playerText}"\n\nReply now, as yourself.`;
}
