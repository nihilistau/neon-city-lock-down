// @ts-check
// Normalize free-typed player input: lowercase, expand contractions, strip
// punctuation (keeping tone signals), cheap suffix-stemming. Pure.

const CONTRACTIONS = {
  "don't": 'do not', "won't": 'will not', "can't": 'can not', "cant": 'can not',
  "i'm": 'i am', "im": 'i am', "you're": 'you are', "youre": 'you are',
  "it's": 'it is', "that's": 'that is', "let's": 'let us', "we're": 'we are',
  "i'll": 'i will', "i'd": 'i would', "i've": 'i have', "you'll": 'you will',
  "ain't": 'is not', "aren't": 'are not', "isn't": 'is not', "wasn't": 'was not',
  "weren't": 'were not', "hasn't": 'has not', "haven't": 'have not', "hadn't": 'had not',
  "doesn't": 'does not', "didn't": 'did not', "couldn't": 'could not',
  "wouldn't": 'would not', "shouldn't": 'should not', "wouldnt": 'would not',
  "gonna": 'going to', "wanna": 'want to', "gotta": 'got to',
  "lemme": 'let me', "gimme": 'give me', "kinda": 'kind of', "dunno": 'do not know',
};

/** cheap plural/verb suffix stemmer — good enough for keyword matching */
export function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * @param {string} raw
 * @returns {{ text:string, tokens:string[], stems:string[], raw:string,
 *             exclaim:number, question:boolean, caps:boolean, wordCount:number }}
 */
export function normalize(raw) {
  const trimmed = raw.trim();
  const exclaim = (trimmed.match(/!/g) || []).length;
  const question = /\?\s*$/.test(trimmed) ||
    /^(who|what|when|where|why|how|are|do|did|can|could|would|will|is|whats|hows)\b/i.test(trimmed);
  const letters = trimmed.replace(/[^a-z]/gi, '');
  const caps = letters.length > 3 && letters === letters.toUpperCase();

  let text = trimmed.toLowerCase();
  for (const [k, v] of Object.entries(CONTRACTIONS)) {
    text = text.replace(new RegExp(`\\b${k.replace(/'/g, "['’]?")}\\b`, 'g'), v);
  }
  text = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = text ? text.split(' ') : [];
  const stems = tokens.map(stem);
  return { text, tokens, stems, raw: trimmed, exclaim, question, caps, wordCount: tokens.length };
}
