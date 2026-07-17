// @ts-check
// Optional OpenAI-compatible surface-text rewriter. Authored effects/gates/
// directions are ALWAYS the authored ones — this only restyles cleanText.
// Fully exercised in Phase 3; safe no-op when disabled/unconfigured.

import { settings } from '../core/settings.js';

export class LLMAdapter {
  constructor() { this.refresh(); }

  refresh() {
    const c = settings.llm;
    this.enabled = !!(c.enabled && c.baseUrl && c.model);
    this.cfg = c;
  }

  /**
   * @param {import('../chars/character.js').Character} char
   * @param {string} authoredText  the meaning/register to convey
   * @param {{tone:any}} ctx
   * @returns {Promise<string|null>} replacement text, or null to keep authored
   */
  async rewrite(char, authoredText, ctx) {
    if (!this.enabled) return null;
    const persona = char.persona;
    const sys = `You are ${persona.name}, ${persona.archetype}. ${persona.bio}\n` +
      `Current mood: ${char.mood?.id}. Stay in character, in a neon-noir cyberpunk penthouse under city lockdown.\n` +
      `Rewrite the given line preserving its meaning and register. Max 2 sentences. ` +
      `Do NOT escalate intimacy beyond what the line implies. No stage directions, no quotes.`;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.cfg.model, temperature: 0.85, max_tokens: 90,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: `Line to rewrite: "${authoredText}"` },
          ],
        }),
      });
      clearTimeout(to);
      if (!res.ok) return null;
      const data = await res.json();
      const out = data.choices?.[0]?.message?.content?.trim();
      if (!out || out.length > 300) return null;
      return out.replace(/^["']|["']$/g, '');
    } catch {
      return null; // timeout / network / refusal-shaped → authored text plays
    }
  }
}
