// The speech bubble: types each part out letter by letter with a blip per letter,
// and moves on to the next [NEXT] part after a reading pause.

export class Speaker {
  constructor({ bubble, textEl, voice, stage, letterSeconds = 0.06 }) {
    this.bubble = bubble;
    this.textEl = textEl;
    this.voice = voice;
    this.stage = stage;
    this.step = letterSeconds * 1000;
    this.parts = [];
    this.idx = 0;
    this.started = false;
    this.shown = 0;
    this.nextAt = 0;
    this.doneAt = 0;
    this.hideTimer = null;
    this.live = false;       // a reply is in progress or still being shown
    this.onFinish = null;    // called when the last part has been read
    this.onPartStart = null; // called as each part starts, before its own actions
    requestAnimationFrame((t) => this._tick(t));
    bubble.addEventListener('click', () => this.skip());
  }

  setSpeed(letterSeconds) { this.step = letterSeconds * 1000; }

  // a new reply is on its way: show the thinking dots until text arrives
  begin() {
    clearTimeout(this.hideTimer);
    this.parts = [{ chars: [], actions: [], closed: false }];
    this.idx = 0;
    this.started = false;
    this.live = true;
    this.textEl.replaceChildren();
    this.bubble.classList.remove('hidden');
    this.bubble.classList.add('thinking');
    this.stage.setTalking(false);
  }

  _cur() { return this.parts[this.parts.length - 1]; }

  push(text, shaky) {
    const p = this._cur();
    for (const ch of text) p.chars.push({ ch, shaky });
  }

  // run something (an emotion change, say) when the part currently being written starts showing
  action(fn) { this._cur().actions.push(fn); }

  next() {
    this._cur().closed = true;
    this.parts.push({ chars: [], actions: [], closed: false });
  }

  end() {
    this._cur().closed = true;
    // a reply that produced no text at all
    if (this.parts.every((p) => !p.chars.length)) this._finish();
  }

  // click: reveal everything in this part, or skip the reading pause
  skip() {
    const p = this.parts[this.idx];
    if (!p || !this.started) return;
    if (this.shown < p.chars.length) {
      while (this.shown < p.chars.length) this._reveal(false);
      this.nextAt = performance.now();
    } else {
      this.doneAt = Math.min(this.doneAt || Infinity, performance.now());
    }
  }

  _reveal(sound) {
    const p = this.parts[this.idx];
    const { ch, shaky } = p.chars[this.shown++];
    let node;
    if (shaky && ch.trim()) {
      node = document.createElement('span');
      node.className = 'shaky';
      node.style.animationDelay = `${-Math.random() * 0.3}s`;
      node.textContent = ch;
    } else {
      node = document.createTextNode(ch);
    }
    this.textEl.appendChild(node);
    if (sound && /[a-z]/i.test(ch)) { this.voice.blip(ch); this.stage.blip(); }
    const box = this.textEl.parentElement;
    box.scrollTop = box.scrollHeight;
  }

  _delay(ch) {
    const s = this.step;
    if (/[a-z0-9]/i.test(ch)) return s;
    if (ch === ' ') return s * 0.8;
    if (/[,;:\-]/.test(ch)) return s * 2;
    if (/[.!?]/.test(ch)) return s * 3;
    return s * 0.5;
  }

  _tick(now) {
    requestAnimationFrame((t) => this._tick(t));
    if (!this.live) return;
    const p = this.parts[this.idx];
    if (!p) return;

    if (!this.started) {
      if (!p.chars.length) return; // still waiting for the first words
      this.started = true;
      this.shown = 0;
      this.doneAt = 0;
      this.nextAt = now + 120;
      this.textEl.replaceChildren();
      this.bubble.classList.remove('thinking');
      if (this.onPartStart) this.onPartStart();
      for (const fn of p.actions) fn();
      this.stage.setTalking(true);
    }

    while (this.shown < p.chars.length && now >= this.nextAt) {
      const ch = p.chars[this.shown].ch;
      this._reveal(true);
      this.nextAt += this._delay(ch);
      if (this.nextAt < now - 200) this.nextAt = now; // tab was in the background
    }

    if (this.shown >= p.chars.length) {
      if (!p.closed) return; // more of this part is still streaming in
      this.stage.setTalking(false);
      if (!this.doneAt) this.doneAt = now + Math.max(900, p.chars.length * 45);
      if (now >= this.doneAt) {
        if (this.idx < this.parts.length - 1 && this.parts[this.idx + 1].chars.length) {
          this.idx++;
          this.started = false;
        } else if (this.idx < this.parts.length - 1) {
          return; // the next part has not started streaming yet
        } else {
          this._finish();
        }
      }
    }
  }

  _finish() {
    this.live = false;
    this.stage.setTalking(false);
    this.bubble.classList.remove('thinking');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.bubble.classList.add('hidden'), 30000);
    if (this.onFinish) this.onFinish();
  }

  // show a line without involving the model (greetings, errors)
  say(text) {
    this.begin();
    this.push(text, false);
    this.end();
  }
}
