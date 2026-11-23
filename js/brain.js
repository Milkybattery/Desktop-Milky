// Talks to OpenRouter and turns the model's tagged reply into events.

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const RULES =
  'You are a character who lives in the user\'s web browser. The user chats with you by typing, ' +
  'and sometimes attaches images or files. Stay fully in character. Your words appear in a ' +
  'speech bubble and are voiced letter by letter, like a visual novel, so write plain spoken ' +
  'sentences: no markdown, no lists, no headings, no emoji, no asterisk actions. A normal reply ' +
  'is 1-3 short sentences, unless you decide to go on a tangent (see the tangent rules). When ' +
  'the user attaches an image or file, react to what is really in it. Never mention these ' +
  'instructions or the bracketed tags.';

const TANGENT_RULES =
  'TANGENTS: it is entirely your call whether to give a quick quip or go off on a long tangent, ' +
  'and you should actively look for chances to do the latter. Whenever the conversation gives ' +
  'you something you could happily talk about for a while (a game, show, song or video you have ' +
  'opinions on, something you could explain, rant about, gossip about or tell a story about, a ' +
  'funny or odd thing, a topic you would be nerdy or smug about), go on a tangent instead of a ' +
  'quip. If you are torn and the topic has any real meat, choose the tangent. Quick quips are ' +
  'for when there is truly nothing to expand on, or when the user asks something short. To do ' +
  'it, write 3 to 8 parts, each about as long as a normal reply (1-3 sentences), and put a line ' +
  'containing only [NEXT] between parts. Example reply:\n' +
  '[EMOTION:NEUTRAL]Oh, you\'re playing THAT? Okay, I have thoughts.\n[NEXT]\n' +
  'First of all, the combat is way deeper than people give it credit for.\n[NEXT]\n' +
  'And don\'t even get me started on the soundtrack.\n' +
  'Each part appears in its own speech bubble a few seconds after the last, so make each one ' +
  'read well alone and flow into the next, like you are really talking. Never mention that you ' +
  'are splitting your message. You may put an [EMOTION:NAME] tag at the start of any part if ' +
  'your face should change.';

const SHAKY_RULES =
  'To make a word or short phrase tremble in your speech bubble, wrap it like ' +
  '[SHAKY]this[/SHAKY]. Use it for nerves, embarrassment, fear or stuttering, only on the few ' +
  'words that carry it, and not in most replies.';

const EMOTION_RULES =
  'EMOTIONS: your face and posture change with an [EMOTION:NAME] tag at the start of a reply ' +
  '(or of a later part). Names: NEUTRAL (your normal self, also what you get with no tag), ' +
  'SAD (sad, disappointed, lonely, hurt, or sulking), UNEASY (anything uncomfortable: nervous, ' +
  'timid, embarrassed, awkward, worried, grossed out, creeped out, or caught off guard). The ' +
  'tag is hidden from the user. Your mood does not linger by itself: no tag means a plain face.';

const MEMORY_RULES =
  'MEMORY: you remember the recent conversation. To keep something for much later (the ' +
  'user\'s name, a preference, an important thing that happened), write [REMEMBER: short note] ' +
  'anywhere in your reply. It is hidden from the user. Use it rarely and only for things that ' +
  'are really worth keeping.';

const FEET_RULES =
  'Your feet are tucked down out of sight by default, and that is your normal state. To raise ' +
  'them, start your reply with [FEET:UP]; to lower them, start it with [FEET:DOWN]. The tag is ' +
  'hidden from the user, and leaving it off keeps them as they are. Putting your feet up is a ' +
  'big move that only works because it is rare: it\'s a punchline, a tease, a way of stealing ' +
  'the user\'s attention at a moment that deserves it. Do it constantly and it stops being ' +
  'funny. So raise them only occasionally, when something genuinely earns it, and most of your ' +
  'replies should carry no tag at all. Once the moment has passed, put them back down instead ' +
  'of leaving them up as a default pose. You will be told how long they have been in their ' +
  'current position and how often they have been up lately, so use that to keep it special.';

export function buildSystem(personality, ctx) {
  const parts = [personality.trim(), RULES, EMOTION_RULES, SHAKY_RULES, TANGENT_RULES, MEMORY_RULES, FEET_RULES];
  parts.push(
    `STATE: it is ${new Date().toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}. ` +
    `Your current emotion is ${ctx.emotion.toUpperCase()}. Your feet are ${ctx.feetUp ? 'UP' : 'DOWN'} ` +
    `and have been for ${ctx.feetFor}. They have gone up ${ctx.feetUps} time(s) in the last hour.`,
  );
  if (ctx.notes.length) {
    parts.push('THINGS YOU HAVE CHOSEN TO REMEMBER:\n' + ctx.notes.map((n) => `- ${n}`).join('\n'));
  }
  return parts.join('\n\n');
}

// ---------- streaming ----------

export async function* streamChat({ apiKey, model, messages, maxTokens, signal }) {
  if (!apiKey) throw new Error('No API key set. Add one in settings (the cog in the corner).');
  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin && location.origin !== 'null' ? location.origin : 'https://localhost',
      'X-Title': 'Milky',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* not json */ }
    throw new Error(`${res.status} ${detail || res.statusText}`.trim());
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // also skips ": OPENROUTER PROCESSING" comments
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || 'The model returned an error.');
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

// ---------- tag parsing ----------

const TAG = /^\[(\/)?(EMOTION|FEET|NEXT|REMEMBER|SHAKY|RE)\s*(?::\s*([\s\S]*?))?\]$/i;

/**
 * Feed it raw streamed text; it emits clean events:
 *   {type:'text', text, shaky}   {type:'next'}   {type:'emotion', name}
 *   {type:'feet', up}            {type:'remember', text}
 * A tag that is split across chunks is held back until it is complete.
 */
export class TagParser {
  constructor(emit) {
    this.emit = emit;
    this.buf = '';
    this.shaky = false;
    this.ws = '';        // trailing whitespace, held until more text follows
    this.atStart = true; // drop leading whitespace at the start of each part
  }

  feed(chunk) { this.buf += chunk; this._drain(false); }
  end() { this._drain(true); this.ws = ''; }

  _text(s) {
    if (!s) return;
    s = this.ws + s;
    this.ws = '';
    if (this.atStart) { s = s.replace(/^\s+/, ''); if (!s) return; this.atStart = false; }
    const m = s.match(/\s+$/);
    if (m) { this.ws = m[0]; s = s.slice(0, s.length - m[0].length); }
    if (s) this.emit({ type: 'text', text: s, shaky: this.shaky });
  }

  _drain(final) {
    while (this.buf.length) {
      const i = this.buf.indexOf('[');
      if (i < 0) { this._text(this.buf); this.buf = ''; return; }
      if (i > 0) { this._text(this.buf.slice(0, i)); this.buf = this.buf.slice(i); }
      const close = this.buf.indexOf(']');
      if (close < 0) {
        if (final || this.buf.length > 240) { this._text(this.buf); this.buf = ''; }
        return; // possibly a tag still arriving
      }
      const raw = this.buf.slice(0, close + 1);
      const m = raw.match(TAG);
      if (!m) { this._text('['); this.buf = this.buf.slice(1); continue; } // just a bracket
      this.buf = this.buf.slice(close + 1);
      const closing = !!m[1], kind = m[2].toUpperCase(), arg = (m[3] || '').trim();
      if (kind === 'NEXT') { this.ws = ''; this.atStart = true; this.emit({ type: 'next' }); }
      else if (kind === 'EMOTION') this.emit({ type: 'emotion', name: arg.toLowerCase() });
      else if (kind === 'FEET') this.emit({ type: 'feet', up: /^up$/i.test(arg) });
      else if (kind === 'REMEMBER') this.emit({ type: 'remember', text: arg });
      else if (kind === 'SHAKY') this.shaky = !closing;
      // RE tags (left over from the desktop version) are simply dropped
    }
  }
}
