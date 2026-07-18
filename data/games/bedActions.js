// @ts-check
// Bed game — 38 actions across 5 escalation tiers. Each action names the gate
// tier it requires (checked through gates.js — the sole authority), stat
// effects, an optional paired/solo anim, and 2-3 authored outcome lines.
//
// Register (updated 2026-07-19): this is an adults-only (18+) game and the
// intimate content is written EXPLICIT, not fade-to-black. Tiers 1-2 are the
// sensual build; tiers 3-5 are graphic — bodies and acts named plainly. All
// characters are adults; every escalation is consent-gated through gates.js and
// the global explicitness cap (gates.EXPLICITNESS_CAP) still bounds which tiers
// unlock. The LLM agent voices these beats live when enabled; these are the
// authored floor.

/**
 * @typedef {Object} BedAction
 * @property {string} id @property {string} label @property {number} tier 1-5
 * @property {import('../../src/core/types.js').GateTier} gate
 * @property {Partial<Record<string,number>>} fx  initiator-perceived stat effects on partner
 * @property {string} [anim] partner clip @property {string} [selfAnim]
 * @property {string[]} lines outcome prose (mood/gate-flavored, picked by rng)
 * @property {string[]} [refuse] lines when the partner declines (gate not met)
 */

/** @type {BedAction[]} */
export const BED_ACTIONS = [
  // ── Tier 1 — light_touch ──────────────────────────────────
  { id: 'hold_hand', label: 'Take their hand', tier: 1, gate: 'light_touch',
    fx: { trust: 3, arousal: 2, tension: -2 }, anim: 'idle_confident',
    lines: ['You lace your fingers through theirs. They let you.',
            'Their hand is warmer than you expected. Neither of you pulls away.'] },
  { id: 'brush_hair', label: 'Brush the hair from their face', tier: 1, gate: 'light_touch',
    fx: { trust: 2, arousal: 3, happiness: 2 },
    lines: ['You tuck a strand behind their ear. Their breath catches, just slightly.',
            'They go still under your hand, watching you like they\'re deciding something.'] },
  { id: 'trace_jaw', label: 'Trace their jaw', tier: 1, gate: 'light_touch',
    fx: { arousal: 4, horniness: 2 },
    lines: ['Your fingertips follow the line of their jaw. Their eyes half-close.',
            'They tilt into the touch before they catch themselves.'] },
  { id: 'whisper_close', label: 'Whisper against their ear', tier: 1, gate: 'light_touch',
    fx: { arousal: 4, trust: 2, tension: -1 }, anim: 'gesture_lean_in',
    lines: ['You lean in close and lower your voice. Whatever you said, it lands.',
            'They shiver at the warmth of your breath more than the words.'] },
  { id: 'rest_head', label: 'Draw their head to your shoulder', tier: 1, gate: 'light_touch',
    fx: { trust: 4, happiness: 3, tension: -3 },
    lines: ['They settle against your shoulder. For a moment the sirens don\'t matter.',
            'You feel the tension leave them by degrees.'] },
  { id: 'hold_gaze', label: 'Hold their gaze', tier: 1, gate: 'light_touch',
    fx: { arousal: 3, tension: 1 },
    lines: ['Neither of you looks away. The room gets very quiet.',
            'The staring contest becomes something else entirely.'] },

  // ── Tier 2 — kiss ─────────────────────────────────────────
  { id: 'kiss_soft', label: 'Kiss them, softly', tier: 2, gate: 'kiss',
    fx: { arousal: 6, horniness: 4, pleasure: 5, tension: -2 }, anim: 'gesture_lean_in',
    lines: ['You kiss them, slow and unhurried. They melt into it.',
            'Soft, testing, then certain. They kiss you back like an answer.'] },
  { id: 'kiss_deep', label: 'Kiss them, deeply', tier: 2, gate: 'kiss',
    fx: { arousal: 9, horniness: 7, pleasure: 6 },
    lines: ['The kiss deepens. Their hand fists in your collar.',
            'They pull you in harder. Whatever restraint was left is going fast.'] },
  { id: 'kiss_neck', label: 'Kiss their neck', tier: 2, gate: 'kiss',
    fx: { arousal: 8, horniness: 6 },
    lines: ['You press your mouth to the curve of their neck. They gasp.',
            'A sound escapes them that they clearly didn\'t plan to make.'] },
  { id: 'kiss_shoulder', label: 'Trail kisses along their shoulder', tier: 2, gate: 'kiss',
    fx: { arousal: 7, pleasure: 5, horniness: 4 },
    lines: ['You work slowly across the bare skin of their shoulder.',
            'They arch, just slightly, chasing the warmth of your mouth.'] },
  { id: 'bite_lip', label: 'Catch their lip between yours', tier: 2, gate: 'kiss',
    fx: { arousal: 8, horniness: 6, tension: 2 },
    lines: ['You catch their lower lip and tug. Their pupils blow wide.',
            'The small sharpness makes them grin against your mouth.'] },
  { id: 'foreheads', label: 'Rest your forehead to theirs', tier: 2, gate: 'kiss',
    fx: { trust: 4, arousal: 3, tension: -3 },
    lines: ['Foreheads together, breathing each other\'s air. Intimate as anything.',
            'Neither of you speaks. You don\'t need to.'] },

  // ── Tier 3 — touch ────────────────────────────────────────
  { id: 'caress', label: 'Run your hands down their sides', tier: 3, gate: 'touch',
    fx: { arousal: 10, horniness: 9, pleasure: 7 },
    lines: ['Your hands map the shape of them. They press into every touch.',
            'They make a low sound and pull you closer by the hips.'] },
  { id: 'pull_close', label: 'Pull them flush against you', tier: 3, gate: 'touch',
    fx: { arousal: 9, horniness: 8, tension: 2 },
    lines: ['You pull them against you, no space left between. They don\'t protest.',
            'Bodies aligned, hearts hammering. The night tips over an edge.'] },
  { id: 'straddle', label: 'Draw them into your lap', tier: 3, gate: 'touch',
    fx: { arousal: 11, horniness: 10, dominance: -2 },
    lines: ['They settle into your lap, knees either side, gaze fever-bright.',
            'The new closeness rewrites the whole conversation.'] },
  { id: 'grip_hip', label: 'Grip their hip', tier: 3, gate: 'touch',
    fx: { arousal: 9, horniness: 8, dominance: 3 },
    lines: ['Your fingers dig in. They gasp and roll toward the pressure.',
            'The grip says what words haven\'t. They answer in kind.'] },
  { id: 'roam_back', label: 'Slide your hands up their back', tier: 3, gate: 'touch',
    fx: { arousal: 8, pleasure: 8, trust: 2 },
    lines: ['Your palms travel the length of their spine. They shudder.',
            'They curve into you like a drawn bow.'] },
  { id: 'thigh', label: 'Trace the inside of their thigh', tier: 3, gate: 'touch',
    fx: { arousal: 12, horniness: 11, pleasure: 6 },
    lines: ['Your fingers trail higher. Their breath goes ragged.',
            'They tense and then, deliberately, relax — a permission.'] },

  // ── Tier 4 — undress / intimate ──────────────────────────
  { id: 'undress_them', label: 'Strip them bare', tier: 4, gate: 'undress',
    fx: { arousal: 12, horniness: 11, trust: 3 }, anim: 'lounge',
    lines: ['You peel the last of it away and drink in every inch of bare skin. They let you look, chin up, unashamed.',
            'Clasp by clasp you undress them until they\'re naked under your hands, nipples tightening in the cool air.'] },
  { id: 'undress_self', label: 'Let them strip you', tier: 4, gate: 'undress',
    fx: { arousal: 11, horniness: 10, trust: 4, dominance: -3 },
    lines: ['You let them undress you, their breath ragged as they bare your body and take in the sight of you hard for them.',
            'Their hands shake pulling your clothes off. When you\'re naked they groan and press their mouth to your chest.'] },
  { id: 'press_skin', label: 'Press bare skin to bare skin', tier: 4, gate: 'intimate',
    fx: { arousal: 13, horniness: 12, pleasure: 10, tension: -4 },
    lines: ['Naked and flush against each other, every hot inch touching. They grind against you with a needy little sound.',
            'Skin to skin, their hard body writhing under yours, slick where you\'re pressed together.'] },
  { id: 'go_down', label: 'Use your mouth on them', tier: 4, gate: 'intimate',
    fx: { arousal: 15, pleasure: 16, horniness: 13, trust: 4 },
    lines: ['You work your way down and take them in your mouth. They buck and fist the sheets, cursing your name.',
            'You lick and suck until their thighs are shaking around your head and they\'re begging you not to stop.'] },
  { id: 'worship', label: 'Take them apart slowly with your hands', tier: 4, gate: 'intimate',
    fx: { arousal: 12, pleasure: 14, happiness: 5, trust: 5 },
    lines: ['You stroke them right where they need it, watching their face, reading every gasp, keeping them on the edge.',
            'Your fingers work them slick and desperate until they\'re rocking into your hand, chasing it.'] },
  { id: 'pin', label: 'Pin them down and take them', tier: 4, gate: 'intimate',
    fx: { arousal: 14, horniness: 13, dominance: 5, tension: 2 },
    lines: ['You pin their wrists and press into them; they arch up with a broken moan and take all of you.',
            'Held down and spread open, they wrap their legs around you and pull you deeper, gasping your name.'] },

  // ── Tier 5 — explicit / depraved ─────────────────────────
  { id: 'together', label: 'Fuck them slow and deep', tier: 5, gate: 'explicit',
    fx: { arousal: 15, horniness: 14, pleasure: 16 }, anim: 'lounge',
    lines: ['You sink into them and set a slow, deep rhythm; they meet every thrust, moaning, clinging, wrecked already.',
            'Buried deep, you roll your hips and they fall apart around you, gasping filth and your name in the same breath.'] },
  { id: 'lose_control', label: 'Take them hard, no restraint', tier: 5, gate: 'explicit',
    fx: { arousal: 16, horniness: 15, pleasure: 15, sobriety: -2 },
    lines: ['All the careful distance collapses. You fuck them hard and fast and they beg for more, louder, harder.',
            'The bed slams the wall. They\'re a mess of curses and pleasure, taking everything you give and demanding the rest.'] },
  { id: 'devote', label: 'Give them absolutely everything', tier: 5, gate: 'depraved',
    fx: { arousal: 16, horniness: 16, pleasure: 18, loyalty: 6 },
    lines: ['Nothing held back — every filthy thing they whisper, you give them, until you\'re both wrecked and gasping and grinning.',
            'You take each other apart every way you both want, greedy and shameless. Dawn finds you tangled, ruined, and glowing.'] },

  // ── afterglow / cooldown (any gate ≥ kiss) ───────────────
  { id: 'aftercare', label: 'Hold them after', tier: 2, gate: 'kiss',
    fx: { trust: 6, happiness: 6, loyalty: 4, tension: -6, arousal: -8 },
    lines: ['You gather them close and just breathe. The aftercare matters as much as the rest.',
            'Wrapped together in the quiet, something softer than desire settles in.'] },
  { id: 'praise', label: 'Tell them how good that was', tier: 2, gate: 'kiss',
    fx: { happiness: 5, trust: 4, loyalty: 3 },
    lines: ['You murmur exactly how good that was. They flush with unguarded pleasure.',
            'The praise lands harder than you expected. They tuck their face against you.'] },

  // ── teasing / edging (intimate, tempo-scaled) ────────────
  { id: 'tease', label: 'Slow down, make them wait', tier: 4, gate: 'intimate',
    fx: { arousal: 10, horniness: 14, tension: 4, dominance: 6 },
    lines: ['You ease off deliberately. Their frustrated groan is deeply satisfying.',
            'Making them wait is its own reward. They\'re begging without words.'] },
  { id: 'let_lead', label: 'Let them set the pace', tier: 4, gate: 'intimate',
    fx: { arousal: 11, dominance: -5, trust: 4, pleasure: 9 },
    lines: ['You surrender the rhythm to them. They take it, and take you, with relish.',
            'Handing over control turns out to be its own thrill.'] },

  // ── talk / connection interludes (light_touch, resets tension) ──
  { id: 'confess', label: 'Say something true', tier: 1, gate: 'light_touch',
    fx: { trust: 7, loyalty: 4, tension: -5, happiness: 3 },
    lines: ['You tell them something you\'ve told no one. They hold it, and you, carefully.',
            'The honesty costs you something. They see that, and treasure it.'] },
  { id: 'laugh', label: 'Break the tension with a joke', tier: 1, gate: 'light_touch',
    fx: { happiness: 6, tension: -6, trust: 2 },
    lines: ['You crack a joke at exactly the wrong-perfect moment. They laugh helplessly.',
            'Laughter dissolves the nerves. Everything feels easier after.'] },

  // extra tier-3 variety
  { id: 'mark', label: 'Leave a mark', tier: 3, gate: 'touch',
    fx: { arousal: 10, horniness: 9, dominance: 4, tension: 2 },
    lines: ['You leave a bloom of color at their throat. They touch it and smile, wicked.',
            'A mark they\'ll have to explain tomorrow. Neither of you cares.'] },
  { id: 'guide_hands', label: 'Guide their hands to you', tier: 3, gate: 'touch',
    fx: { arousal: 11, horniness: 10, trust: 3, dominance: -2 },
    lines: ['You take their wrists and show them exactly where you want them.',
            'They learn fast, and improvise faster.'] },
  { id: 'undress_slow', label: 'Undress them agonizingly slowly', tier: 4, gate: 'undress',
    fx: { arousal: 13, horniness: 12, tension: 3 },
    lines: ['Every clasp takes a small forever. By the end they\'re trembling.',
            'You draw it out until they\'re begging you to hurry. You don\'t hurry.'] },
  { id: 'reverence', label: 'Kiss every inch you uncover', tier: 4, gate: 'intimate',
    fx: { arousal: 12, pleasure: 13, trust: 4, happiness: 4 },
    lines: ['You map them with your mouth, unhurried and reverent.',
            'Worshipped, they forget how to be guarded at all.'] },
  { id: 'whisper_filthy', label: 'Whisper what you want', tier: 5, gate: 'explicit',
    fx: { arousal: 14, horniness: 15, tension: 2 },
    lines: ['You tell them exactly what you want, low and unhurried. Their reaction is immediate.',
            'The words alone nearly undo them.'] },
  { id: 'wreck', label: 'Take them apart completely', tier: 5, gate: 'depraved',
    fx: { arousal: 16, horniness: 16, pleasure: 20, loyalty: 5 },
    lines: ['By the time you\'re done there\'s nothing left of their composure. Just you, and them, and the wreckage of a very good night.',
            'You take them apart and put them back together wrong — better.'] },
];

/** grouping helper for the UI */
export const BED_TIERS = [1, 2, 3, 4, 5].map((t) => ({
  tier: t,
  name: ['Tender', 'Heated', 'Hungry', 'Intimate', 'Unrestrained'][t - 1],
  actions: BED_ACTIONS.filter((a) => a.tier === t),
}));
