// @ts-check
// Tone axes from a small lexicon. Runs alongside intent matching; feeds
// fallback selection and side-effect stat nudges (hostile tone raises tension
// even when the topic lands). Pure.

const LEX = {
  affection: ['love', 'like', 'sweet', 'beautiful', 'gorgeous', 'cute', 'dear', 'honey',
    'babe', 'darling', 'adore', 'care', 'trust', 'kind', 'warm', 'thank', 'please', 'sorry',
    'gentle', 'soft', 'nice', 'good', 'appreciate'],
  hostility: ['hate', 'shut', 'idiot', 'stupid', 'bitch', 'bastard', 'kill', 'die', 'fuck',
    'threat', 'threaten', 'liar', 'lie', 'coward', 'weak', 'pathetic', 'useless', 'enemy',
    'shoot', 'hurt', 'attack', 'angry', 'furious', 'disgust', 'despise', 'ugly'],
  command: ['do', 'go', 'come', 'stop', 'give', 'get', 'move', 'now', 'must', 'will', 'obey',
    'kneel', 'strip', 'tell', 'show', 'bring', 'sit', 'stand', 'wait', 'listen', 'drink'],
  flirt: ['kiss', 'touch', 'want', 'need', 'desire', 'tease', 'seduce', 'body', 'lips', 'skin',
    'bed', 'close', 'closer', 'hot', 'sexy', 'naughty', 'dirty', 'crave'],
  fear: ['scared', 'afraid', 'help', 'please', 'run', 'hide', 'danger', 'panic', 'terrified'],
};

/**
 * @param {import('./normalize.js').normalize} n normalized input
 * @returns {{affection:number, hostility:number, command:number, flirt:number, fear:number, dominant:number}}
 */
export function toneOf(n) {
  const t = { affection: 0, hostility: 0, command: 0, flirt: 0, fear: 0, dominant: 0 };
  for (const stem of n.stems) {
    for (const axis of Object.keys(LEX)) {
      if (LEX[axis].includes(stem)) t[axis] += 1;
    }
  }
  // caps + exclaim amplify intensity toward command/hostility
  if (n.caps) { t.command += 1; t.hostility += 0.5; }
  t.command += Math.min(n.exclaim, 2) * 0.5;
  // dominance = command + hostility - fear
  t.dominant = t.command + t.hostility * 0.6 - t.fear;
  // normalize by word count so long sentences don't dominate
  const scale = 1 / Math.max(1, Math.sqrt(n.wordCount));
  for (const k of Object.keys(t)) t[k] *= scale;
  return t;
}

/** dominant tone label for fallback keying */
export function dominantTone(tone) {
  const entries = [['affection', tone.affection], ['hostility', tone.hostility],
    ['flirt', tone.flirt], ['command', tone.command], ['fear', tone.fear]];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0.15 ? entries[0][0] : 'neutral';
}
