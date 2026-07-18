// Game-side wiring of the lmstudio-engine for Neon-City: Lock-Down.
// Server-side (Node). Builds the Engine, defines the game's scene-tag schema,
// and exposes SSE routes the browser drives:
//   GET  /engine/status         → { ok, model, loaded }
//   POST /engine/chat  (SSE)    → stream the roleplay reply, then a structured
//                                 `tags` directive object, then `done`.
//
// The browser builds the persona/system prompt (it holds the character state)
// and sends { system, input, extract:{zone,name} }. The big model streams clean
// prose; the tiny function model reads that prose into the tag schema below,
// which the browser injects through its normal stage-direction pipeline.
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, EngineServer, z, timing } from '../lmstudio-engine/index.mjs';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));

// Scene-tag vocabulary — MUST stay in sync with the browser dispatcher.
const ZONES = ['', 'lounge', 'bar', 'balcony', 'fireplace', 'bed_alcove', 'vanity', 'shower'];
const CLIPS = ['none', 'idle_stand', 'idle_confident', 'idle_shy', 'walk', 'sit_relaxed',
  'lounge', 'dance_sway', 'gesture_lean_in', 'gesture_shrug', 'gesture_cross_arms', 'crouch'];
const FACES = ['neutral', 'smile', 'smirk', 'grin', 'frown', 'pout', 'glare', 'blush', 'wink', 'open', 'brow'];
const MOODS = ['flirty', 'sultry', 'playful', 'cold', 'tense', 'warm', 'guarded', 'confident'];
const GATES = ['', 'kiss', 'touch', 'undress', 'intimate'];

const TAG_SCHEMA = z.object({
  move: z.enum(ZONES).describe('room the character walks to, or "" to stay put'),
  anim: z.enum(CLIPS).describe('body motion that matches the line, or "none"'),
  face: z.enum(FACES).describe('facial expression'),
  mood: z.enum(MOODS).describe('inner mood'),
  look_at_player: z.boolean().describe('are they looking at the guest'),
  arousal_delta: z.number().int().describe('change in the character\'s arousal, -15..+15'),
  tension_delta: z.number().int().describe('change in tension, -15..+15'),
  offer_gate: z.enum(GATES).describe('an intimacy the character now welcomes, or ""'),
});

let _engine = null;
function engine() {
  if (_engine) return _engine;
  _engine = new Engine({
    apiKeyFile: join(ROOT, 'lmstudio-api-key.txt'),
    baseUrl: process.env.LMS_BASE_URL || 'ws://127.0.0.1:1234',
    models: { chat: process.env.LMS_CHAT_MODEL || '', function: 'google/functiongemma-270m' },
  });
  if (process.env.LMS_VERBOSE) _engine.use(timing((s) => console.log(s)));
  return _engine;
}

/** Build the extraction prompt fed to the function model. */
function extractPrompt(prose, extract = {}) {
  const where = extract.zone ? `They are in the ${extract.zone}.` : '';
  return `Read this roleplay line by ${extract.name || 'a character'} and label the scene cues.
LINE: "${prose}"
${where}
RULES:
- move: ONLY a room if the line explicitly says they WALK there. If they stay put, use "".
- anim: a body motion the line literally describes, else "none".
- face/mood: the expression/feeling the line conveys.
- look_at_player: true only if their gaze is on the guest.
- arousal_delta / tension_delta: small (-10..10), 0 if unchanged.
- offer_gate: an intimacy they clearly invite (kiss/touch/undress/intimate), else "".
Be conservative: prefer ""/"none"/0 unless the line clearly shows it.`;
}

let _server = null;
function server() {
  if (_server) return _server;
  const e = engine();
  const s = new EngineServer(e);

  s.route('POST', '/chat', async (body, { sse, signal }) => {
    if (!sse) return { error: 'chat requires SSE (Accept: text/event-stream)' };
    let prose = '';
    const res = await e.chat(
      { system: body.system, input: body.input, temperature: body.temperature ?? 0.85,
        maxTokens: body.maxTokens ?? 320, signal },
      (frag, m) => { if (!m.reasoning) { prose += frag; sse.send('fragment', { text: frag }); } });
    const clean = (res.content || prose).trim();
    sse.send('reply', { text: clean, stats: res.stats });
    // structured directive extraction from the finished prose
    let tags = null;
    try {
      tags = await e.extract({ input: extractPrompt(clean, body.extract), schema: TAG_SCHEMA, signal });
    } catch { /* tags optional */ }
    sse.send('tags', tags);
    sse.send('done', { ok: true });
  });

  _server = s;
  return s;
}

/** Mount point for tools/serve.mjs. Returns true if the request was ours. */
export async function handleEngine(req, res, url) {
  return server().handle(req, res, url);
}
