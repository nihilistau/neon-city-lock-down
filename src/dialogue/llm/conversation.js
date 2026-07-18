// @ts-check
// Per-character rolling conversation memory for the LLM agent. Keeps the
// guest's recent lines and the character's own last reply so the prompt can
// give continuity without shipping the whole transcript (which some GGUFs
// choke on — see the reference's history quirk).

const MAX_PLAYER_LINES = 6;

export class Conversation {
  constructor() {
    /** @type {Record<string, {playerLines:string[], lastReply:string}>} */
    this._byChar = {};
  }

  _slot(id) {
    return (this._byChar[id] ||= { playerLines: [], lastReply: '' });
  }

  /** Record a player utterance addressed to (or heard by) a character. */
  notePlayer(id, text) {
    const s = this._slot(id);
    s.playerLines.push(text);
    if (s.playerLines.length > MAX_PLAYER_LINES) s.playerLines.shift();
  }

  /** Record what the character last said (clean text, no tags). */
  noteReply(id, cleanText) {
    this._slot(id).lastReply = cleanText;
  }

  history(id) {
    return this._slot(id);
  }

  reset() { this._byChar = {}; }
}
