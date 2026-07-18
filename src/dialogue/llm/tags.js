// @ts-check
// Make raw LLM output safe to run through the authored pipeline.
//
// The model is asked to emit [[tag:...]] cues, but it will improvise tags,
// values, and prose that our strict compileLine() would reject (it throws on
// unknown tags) or that would puppet the player / other cast. This module:
//   1. maps the model's loose tag intent onto our EXACT executable vocabulary,
//   2. drops any tag we cannot execute (so compileLine never throws),
//   3. scrubs prose that narrates the player or other characters.
//
// Gates stay authoritative: [[consent:*]] is downgraded to [[gate:offer:*]] —
// the character can SIGNAL willingness, but actual escalation still goes through
// stat thresholds + the explicitness cap at the ActorQueue.

// Our dispatcher's real animation clips (data/poses/*).
const CLIPS = new Set([
  'crouch', 'dance_sway', 'gesture_cross_arms', 'gesture_lean_in', 'gesture_shrug',
  'idle_confident', 'idle_shy', 'idle_stand', 'lounge', 'sit_lean_partner', 'sit_relaxed', 'walk',
]);
// Friendly aliases the model tends to use → a real clip.
const ANIM_ALIAS = {
  beckon: 'gesture_lean_in', wave: 'gesture_lean_in', gesture: 'gesture_lean_in',
  lean_in: 'gesture_lean_in', lean: 'gesture_lean_in', point: 'gesture_lean_in',
  shrug: 'gesture_shrug', cross_arms: 'gesture_cross_arms', guarded: 'gesture_cross_arms',
  arms_crossed: 'gesture_cross_arms', dance: 'dance_sway', sway: 'dance_sway',
  sit: 'sit_relaxed', sit_down: 'sit_relaxed', sit_chair: 'sit_relaxed',
  recline: 'lounge', lie_down: 'lounge', drape: 'lounge', sprawl: 'lounge',
  crouch: 'crouch', duck: 'crouch', cover: 'crouch', kneel: 'crouch', hide: 'crouch',
  stand: 'idle_stand', idle: 'idle_stand', still: 'idle_stand',
  confident: 'idle_confident', pose: 'idle_confident', hand_on_hip: 'idle_confident',
  shy: 'idle_shy', demure: 'idle_shy', walk: 'walk', pace: 'walk',
};

// Penthouse zones the ActorQueue can path to.
const ZONES = new Set(['lounge', 'fireplace', 'bar', 'balcony', 'bed_alcove', 'vanity', 'shower']);
const ZONE_ALIAS = {
  bedroom: 'bed_alcove', bed: 'bed_alcove', bath: 'shower', bathroom: 'shower',
  living: 'lounge', 'living_room': 'lounge', couch: 'lounge', sofa: 'lounge',
  kitchen: 'bar', fire: 'fireplace', hearth: 'fireplace', mirror: 'vanity', window: 'balcony',
};

// Face expressions parseFace() understands.
const FACES = new Set(['smile', 'smirk', 'grin', 'frown', 'pout', 'open', 'grit', 'neutral', 'blush', 'wink', 'brow', 'glare']);
const FACE_ALIAS = {
  happy: 'smile', warm: 'smile', laugh: 'grin', laughing: 'grin', angry: 'glare',
  anger: 'glare', furious: 'glare', mad: 'glare', sad: 'frown', hurt: 'frown',
  surprised: 'open', shock: 'open', shocked: 'open', gasp: 'open', raise_brow: 'brow',
  eyebrow: 'brow', seductive: 'smirk', sultry: 'smirk', tease: 'smirk', bite_lip: 'pout',
  flushed: 'blush', wide_eyes: 'open',
};
const OUTFITS = new Set(['street_armor', 'evening_wear', 'casual_lounge', 'workout', 'swim', 'sleepwear', 'robe', 'towel', 'underwear', 'none']);
const COVERAGE_MAP = { full: 'evening_wear', outer_off: 'underwear', lingerie: 'underwear', partial: 'towel', nude: 'none', naked: 'none', robe: 'robe', towel: 'towel' };
const STATS = new Set(['arousal', 'pleasure', 'happiness', 'horniness', 'openness', 'dominance', 'trust', 'tension', 'energy', 'sobriety', 'loyalty', 'fear']);
const GATE_TIERS = new Set(['light_touch', 'kiss', 'touch', 'undress', 'intimate', 'explicit', 'depraved']);

const TAG_RE = /\[\[\s*([a-zA-Z_]+)\s*(?::([^\]]*))?\]\]/g;

// The model sometimes copies the placeholder token from the tag sheet verbatim.
const PLACEHOLDERS = new Set(['x', 'word', 'name', 'tier', 'preset', 'clip', 'expr', 'zone', 'level', 'n', 'state', 'feeling', 'emotion', 'value']);

/** Turn one raw model tag into a safe canonical tag string, or '' to drop it. */
function canonTag(type, arg) {
  type = type.toLowerCase();
  arg = (arg || '').trim();
  const first = arg.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_');
  if (PLACEHOLDERS.has(first) && type !== 'stat') return '';
  switch (type) {
    case 'move': {
      const z = ZONES.has(first) ? first : ZONE_ALIAS[first];
      return z ? `[[move:${z}]]` : '';
    }
    case 'anim': {
      const c = CLIPS.has(first) ? first : ANIM_ALIAS[first];
      return c ? `[[anim:${c}]]` : '';
    }
    case 'face': case 'emote': case 'expr': {
      const f = FACES.has(first) ? first : FACE_ALIAS[first];
      return f ? `[[face:${f}]]` : '';
    }
    case 'mood':
      return first ? `[[mood:${first}]]` : '';
    case 'look': {
      const t = first === 'player' || first === 'guest' || first === 'you' ? 'player' : first;
      return t ? `[[look:${t}]]` : '';
    }
    case 'stat': {
      // [[stat:arousal+10]] / [[stat:trust-5]]
      const m = /^([a-z]+)\s*([+-]\s*\d+)$/.exec(arg.toLowerCase().replace(/\s+/g, ''));
      if (m && STATS.has(m[1])) return `[[stat:${m[1]}${m[2]}]]`;
      return '';
    }
    case 'outfit': case 'coverage': case 'wardrobe': {
      const o = OUTFITS.has(first) ? first : COVERAGE_MAP[first];
      return o ? `[[outfit:${o}]]` : '';
    }
    case 'consent': {
      // downgrade to an OFFER — real escalation still needs stats + explicitness
      const tier = GATE_TIERS.has(first) ? first : (first === 'on' || first === 'yes' ? 'kiss' : '');
      return tier ? `[[gate:offer:${tier}]]` : '';
    }
    case 'gate': {
      const [action, tier] = arg.split(':').map((s) => s.trim().toLowerCase());
      const safeAction = action === 'grant' ? 'offer' : action; // never let the model hard-grant
      if (['offer', 'revoke', 'withdraw'].includes(safeAction) && GATE_TIERS.has(tier)) return `[[gate:${safeAction}:${tier}]]`;
      return '';
    }
    case 'light': {
      const presets = ['neon_night', 'blackout_emergency', 'candlelit', 'fireplace_warm', 'security_red', 'club_pulse', 'golden_hour', 'dawn_grey', 'storm', 'morning_haze'];
      const L = { evening: 'neon_night', night: 'neon_night', candle: 'candlelit', candlelight: 'candlelit', red: 'security_red', red_light: 'security_red', blackout: 'blackout_emergency', warm: 'fireplace_warm', fire: 'fireplace_warm' };
      const p = presets.includes(first) ? first : L[first];
      return p ? `[[light:${p}]]` : '';
    }
    case 'look_at':
      return arg ? `[[look:${first}]]` : '';
    // silently drop tags we don't execute (prop, remember, forget, voice, trait, cam, sfx, scene, pair…)
    default:
      return '';
  }
}

/**
 * Sanitize a raw model reply: canonicalize/drop tags, collapse whitespace,
 * strip stray markdown. The result is safe to hand to compileLine().
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeTags(raw) {
  let text = String(raw || '');
  text = text.replace(TAG_RE, (_m, type, arg) => canonTag(type, arg));
  // strip stray markdown FENCE MARKERS (keep the content) and hr separators
  text = text.replace(/```[a-z]*/gi, ' ').replace(/^\s*[-*_]{3,}\s*$/gm, ' ');
  text = text.replace(/\[\[[^\]]*\]\]/g, (m) => (/^\[\[(move|anim|face|mood|look|stat|outfit|gate|light):/.test(m) ? m : ' '));
  // single-bracket spans are never dialogue — the model leaks tag descriptions
  // like "[the ability to influence…]"; drop them (but keep our real [[tags]]).
  text = text.replace(/(?<!\[)\[[^\[\]]{0,80}\](?!\])/g, ' ');
  // meta-parentheticals: "(I'll keep it to 3 sentences)", "(in character)" —
  // strip parentheticals that are about the WRITING, keep genuine inner thoughts.
  text = text.replace(/\([^)]*\b(sentence|sentences|reply|replies|respond|in character|present tense|first person|word count|the ability|the tag|tags?|as an ai|the guest is|the player is)\b[^)]*\)/gi, ' ');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Remove prose that puppets the player or other cast — the model sometimes
 * narrates "You lean in…" or writes another character's line. Conservative:
 * only strips asterisk-action spans and "Name:"/"Name said" lines that clearly
 * belong to someone else.
 * @param {string} text
 * @param {{playerName?:string, otherNames?:string[]}} ctx
 */
export function scrubPuppeting(text, ctx = {}) {
  let out = text;
  const names = (ctx.otherNames || []).filter(Boolean);
  // leading "Speaker:" label the model sometimes prepends
  out = out.replace(/^\s*[A-Z][a-zA-Z]{1,20}:\s+/, '');
  // *actions* that puppet the guest/you
  out = out.replace(/\*[^*]*\b(you|the guest|the player)\b[^*]*\*/gi, (m) =>
    /\byou(r)?\b/i.test(m) && /\b(said|says|smile|nod|lean|walk|steps?|reaches?|takes?|grabs?|pulls?|kisses?|touch)/i.test(m) ? ' ' : m);
  // other cast members' quoted dialogue lines: "Name said, "..."" / "Name:"
  for (const n of names) {
    const first = n.split(' ')[0];
    const re = new RegExp(`\\b${first}\\s+(said|says|replies|replied|adds|murmurs|whispers|laughs)\\b[^.!?]*[.!?]`, 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\s+([.!?,;])/g, '$1').trim();
}

/** Full clean: scrub puppeting, then sanitize tags. */
export function cleanReply(raw, ctx = {}) {
  return sanitizeTags(scrubPuppeting(String(raw || ''), ctx));
}
