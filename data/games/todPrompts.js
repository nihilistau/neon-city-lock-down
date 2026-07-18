// @ts-check
// Truth or Dare — 21 truths + 21 dares, tiered by intimacy gate. Refusals cost
// compliance/trust; completions shift stats. Higher-tier prompts only appear
// when the gate ladder + explicitness cap allow.

/** @typedef {{ id:string, text:string, tier:number, gate?:string, fx:Object, refuseFx?:Object }} Prompt */

/** @type {Prompt[]} */
export const TRUTHS = [
  { id: 't_name', text: 'What name do you use when you don\'t want to be found?', tier: 1, fx: { trust: 3, openness: 3 } },
  { id: 't_scared', text: 'What actually scares you? Not riots. Something real.', tier: 1, fx: { trust: 4, openness: 4, fear: 2 } },
  { id: 't_lie', text: 'What\'s the last lie you told someone in this room?', tier: 1, fx: { trust: 2, tension: 3, openness: 3 } },
  { id: 't_regret', text: 'What\'s the one job you wish you\'d never taken?', tier: 1, fx: { trust: 4, openness: 5 } },
  { id: 't_kill', text: 'How many people have you actually killed?', tier: 1, fx: { trust: 2, tension: 4, dominance: 2 } },
  { id: 't_crush', text: 'Who in this tower do you find hardest to ignore?', tier: 2, gate: 'light_touch', fx: { arousal: 5, trust: 3, happiness: 2 } },
  { id: 't_firsttime', text: 'When did you last let someone actually see you?', tier: 2, gate: 'light_touch', fx: { openness: 5, trust: 4 } },
  { id: 't_bodycount', text: 'How many lovers, honestly?', tier: 2, gate: 'kiss', fx: { arousal: 4, openness: 4 } },
  { id: 't_fantasy_soft', text: 'Describe the last time you wanted someone you shouldn\'t.', tier: 3, gate: 'kiss', fx: { arousal: 8, horniness: 6, openness: 4 } },
  { id: 't_turnon', text: 'What\'s the fastest way to get under your skin — the good way?', tier: 3, gate: 'kiss', fx: { arousal: 9, horniness: 7 } },
  { id: 't_wet', text: 'Is anyone here making it hard to concentrate right now?', tier: 3, gate: 'touch', fx: { arousal: 10, horniness: 8, tension: 2 } },
  { id: 't_dominant', text: 'In bed — do you take control, or give it up?', tier: 3, gate: 'touch', fx: { arousal: 9, dominance: 3, openness: 4 } },
  { id: 't_fantasy_hard', text: 'Tell the room the filthiest thing you\'ve ever actually done.', tier: 4, gate: 'intimate', fx: { arousal: 12, horniness: 11, openness: 5 } },
  { id: 't_want_now', text: 'Right now, tonight — what do you want, and from whom?', tier: 4, gate: 'intimate', fx: { arousal: 13, horniness: 12, trust: 3 } },
  { id: 't_first', text: 'Who was your first, and did it ruin you or make you?', tier: 2, gate: 'light_touch', fx: { openness: 5, trust: 3 } },
  { id: 't_debt', text: 'Who do you owe that you can never repay?', tier: 1, fx: { trust: 3, openness: 4, tension: 2 } },
  { id: 't_betray', text: 'Have you ever sold out someone who trusted you?', tier: 1, fx: { trust: 2, tension: 4, openness: 3 } },
  { id: 't_softest', text: 'What\'s the softest thing you\'ve never let anyone see?', tier: 2, gate: 'light_touch', fx: { trust: 5, openness: 5, happiness: 2 } },
  { id: 't_worst', text: 'What\'s the worst thing you\'d do to survive the lockdown?', tier: 1, fx: { tension: 3, dominance: 2, openness: 3 } },
  { id: 't_love', text: 'Have you ever actually been in love? What happened?', tier: 2, gate: 'light_touch', fx: { openness: 6, trust: 4, happiness: 2 } },
  { id: 't_deepest', text: 'If tonight were your last, whose bed would you want to be in?', tier: 4, gate: 'intimate', fx: { arousal: 12, horniness: 10, trust: 5 } },
];

/** @type {Prompt[]} */
export const DARES = [
  { id: 'd_drink', text: 'Down a shot of the good whiskey, right now.', tier: 1, fx: { sobriety: -8, happiness: 3, openness: 3 } },
  { id: 'd_compliment', text: 'Give a genuine compliment to the person you trust least here.', tier: 1, fx: { trust: 4, tension: -2, happiness: 2 } },
  { id: 'd_secret', text: 'Tell the room a secret you\'d normally take to the grave.', tier: 1, fx: { openness: 5, trust: 3, tension: 2 } },
  { id: 'd_impression', text: 'Do your best impression of someone else in the room.', tier: 1, fx: { happiness: 5, tension: -3 } },
  { id: 'd_stare', text: 'Hold eye contact with someone for a full thirty seconds.', tier: 2, gate: 'light_touch', fx: { arousal: 5, tension: 2, trust: 2 } },
  { id: 'd_handhold', text: 'Hold hands with the person on your left until your next turn.', tier: 2, gate: 'light_touch', fx: { arousal: 4, trust: 3, tension: -2 } },
  { id: 'd_whisper', text: 'Whisper something you want into someone\'s ear.', tier: 2, gate: 'light_touch', fx: { arousal: 6, horniness: 4 } },
  { id: 'd_lapdance_soft', text: 'Sit in someone\'s lap for the next round.', tier: 3, gate: 'kiss', fx: { arousal: 8, horniness: 6, dominance: -2 } },
  { id: 'd_kiss', text: 'Kiss the person you\'ve been avoiding looking at.', tier: 3, gate: 'kiss', fx: { arousal: 10, horniness: 8, pleasure: 5 } },
  { id: 'd_neck', text: 'Kiss someone\'s neck and watch them try to stay composed.', tier: 3, gate: 'kiss', fx: { arousal: 9, horniness: 7 } },
  { id: 'd_strip_one', text: 'Remove one item of clothing. Your choice which.', tier: 3, gate: 'undress', fx: { arousal: 8, horniness: 7, openness: 3 } },
  { id: 'd_bodyshot', text: 'Take a body shot off someone brave enough to volunteer.', tier: 4, gate: 'touch', fx: { arousal: 11, horniness: 10, sobriety: -6 } },
  { id: 'd_touch', text: 'Let someone run their hands wherever they like for ten seconds.', tier: 4, gate: 'touch', fx: { arousal: 12, horniness: 11, trust: 3 } },
  { id: 'd_lapdance', text: 'Give someone a slow, deliberate lap dance.', tier: 4, gate: 'touch', fx: { arousal: 13, horniness: 12, dominance: 3 } },
  { id: 'd_makeout', text: 'Make out with someone until the room tells you to stop.', tier: 4, gate: 'kiss', fx: { arousal: 12, horniness: 11, pleasure: 8 } },
  { id: 'd_undress_other', text: 'Undress the person of your choosing, one piece at a time.', tier: 5, gate: 'undress', fx: { arousal: 13, horniness: 12, dominance: 4 } },
  { id: 'd_lead_away', text: 'Take someone by the hand and lead them somewhere private.', tier: 5, gate: 'intimate', fx: { arousal: 14, horniness: 13, trust: 4 } },
  { id: 'd_confess_want', text: 'Say out loud, to their face, exactly what you want to do to them.', tier: 5, gate: 'intimate', fx: { arousal: 14, horniness: 14, openness: 4 } },
  { id: 'd_dealer_choice', text: 'The room picks: do whatever they dare, no refusals.', tier: 5, gate: 'explicit', fx: { arousal: 15, horniness: 14, dominance: -4, trust: 5 } },
  { id: 'd_serenade', text: 'Play something on the synth for someone you like.', tier: 1, fx: { happiness: 5, trust: 3, arousal: 2 } },
  { id: 'd_truth_gift', text: 'Give up your next truth for free — answer anything asked.', tier: 2, gate: 'light_touch', fx: { openness: 6, trust: 4 } },
];
