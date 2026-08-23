// @ts-check
// Chat-first UI: transcript, free-text input, addressee picker, reply chips.
// The typewriter reveals cleanText and reports character offsets back to the
// engine so inline stage directions fire at their authored moments.
import { on, emit } from '../core/bus.js';
import { iconUrl } from './icons.js';

export class ChatPanel {
  /**
   * @param {import('../dialogue/engine.js').DialogueEngine} engine
   * @param {Record<string, import('../chars/character.js').Character>} cast
   */
  constructor(engine, cast) {
    this.engine = engine;
    this.cast = cast;
    this.root = document.getElementById('chat');
    this.root.innerHTML = `
      <div id="chat-log" class="clickable" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div id="chat-chips"></div>
      <div id="chat-inputrow" class="clickable">
        <select id="chat-target">
          <option value="room">◦ room</option>
          ${Object.values(cast).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <button id="chat-whisper" class="chat-whisper" title="Whisper (only the addressee hears)"><img class="chip-ico" alt=""><span class="chip-lab">whisper</span></button>
        <input id="chat-input" type="text" maxlength="500" placeholder="say something…" autocomplete="off" spellcheck="false">
        <button id="chat-send">▸</button>
      </div>`;
    this.log = this.root.querySelector('#chat-log');
    this.chips = this.root.querySelector('#chat-chips');
    this.input = /** @type {HTMLInputElement} */ (this.root.querySelector('#chat-input'));
    this.targetSel = /** @type {HTMLSelectElement} */ (this.root.querySelector('#chat-target'));

    this._typing = null;      // active typewriter timer
    this._finishTyping = null; // completes the in-flight line instantly
    this._busy = false;
    this._whisper = false;

    const whisperBtn = this.root.querySelector('#chat-whisper');
    whisperBtn.addEventListener('click', () => {
      this._whisper = !this._whisper;
      whisperBtn.classList.toggle('on', this._whisper);
      const lab = whisperBtn.querySelector('.chip-lab');
      if (lab) lab.textContent = this._whisper ? 'on' : 'whisper';
    });
    const wImg = whisperBtn.querySelector('img');
    const paintWhisper = () => { if (wImg) wImg.src = iconUrl('whisper'); };
    paintWhisper();
    setTimeout(paintWhisper, 500);

    this.root.querySelector('#chat-send').addEventListener('click', () => this._send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._send();
      e.stopPropagation();     // don't trigger camera keys while typing
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());

    on('chat.reply', (msg) => this._enqueueReply(msg));
    on('chat.player', ({ text }) => this._addPlayerLine(text));
    on('char.registered', ({ character }) => {
      if ([...this.targetSel.options].some((o) => o.value === character.id)) return;
      const opt = document.createElement('option');
      opt.value = character.id;
      opt.textContent = character.name;
      this.targetSel.appendChild(opt);
    });
  }

  async _send() {
    const text = this.input.value.trim();
    if (!text || this._busy) return;
    this.input.value = '';
    this.chips.innerHTML = '';
    this._busy = true;
    try {
      const replies = await this.engine.playerSays(text, this.targetSel.value, { whisper: this._whisper });
      const last = replies[replies.length - 1];
      if (last?.line?.branches) this._showChips(last.line.branches);
      else emit('chat.idle');
    } finally {
      this._busy = false;
    }
  }

  _addPlayerLine(text) {
    const div = document.createElement('div');
    div.className = 'chat-line player';
    div.innerHTML = `<span class="chat-name">You</span>${escapeHtml(text)}`;
    this.log.appendChild(div);
    this._trim();
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** typewriter queue — one reply at a time so directions stay ordered */
  _enqueueReply(msg) {
    const div = document.createElement('div');
    div.className = 'chat-line npc';
    const accent = typeof msg.accent === 'string' ? msg.accent : '#39e6ff';
    div.innerHTML = `<span class="chat-name" style="color:${accent}">${msg.name}</span><span class="chat-text"></span>`;
    this.log.appendChild(div);
    this._trim();
    const textEl = div.querySelector('.chat-text');
    const full = msg.compiled.cleanText;
    let i = 0;
    const speed = 28; // chars/sec
    const step = () => {
      i = Math.min(full.length, i + 1);
      textEl.textContent = full.slice(0, i);
      this.engine.onReveal(i);
      this.log.scrollTop = this.log.scrollHeight;
      if (i < full.length) {
        this._typing = setTimeout(step, 1000 / speed);
      } else {
        this.engine.flushDirections();
        this._typing = null;
        this._finishTyping = null;
      }
    };
    // Snap the previous line to its FULL text before starting this one. Cancelling
    // the timer alone left the interrupted reply half-typed in the log forever —
    // its remaining characters lived only in that closure.
    const finish = () => {
      if (i < full.length) {
        i = full.length;
        textEl.textContent = full;
        this.engine.onReveal(i);
      }
      this.engine.flushDirections();
    };
    if (this._typing) clearTimeout(this._typing);
    this._finishTyping?.();
    this._finishTyping = finish;
    step();
  }

  _showChips(branches) {
    this.chips.innerHTML = '';
    for (const b of branches.slice(0, 3)) {
      const btn = document.createElement('button');
      btn.className = 'chat-chip clickable';
      btn.textContent = b.chip;
      btn.addEventListener('click', () => {
        this.chips.innerHTML = '';
        emit('chat.idle');
        // chips send their label as the utterance; branch intents give it weight
        this.input.value = b.chip;
        this._send();
      });
      this.chips.appendChild(btn);
    }
  }

  _trim() {
    while (this.log.children.length > 60) this.log.firstChild.remove();
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
