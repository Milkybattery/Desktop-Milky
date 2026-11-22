// Animalese: every spoken letter plays sounds/<LETTER>.mp3 at a slightly random pitch.
// Also plays the feet up/down sound effects.

export class Voice {
  constructor() {
    this.ctx = null;
    this.letters = {};   // 'A' -> { buf, offset }
    this.fx = { up: [], down: [] };
    this.volume = 0.8;
    this.muted = false;
    this.loading = null;
  }

  // Browsers only allow audio after a click or keypress, so this is called from one.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.loading) this.loading = this._load();
  }

  async _load() {
    const get = async (url) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch { return null; }
    };
    const jobs = [];
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      jobs.push(get(`./sounds/${c}.mp3`).then((buf) => {
        if (buf) this.letters[c] = { buf, offset: leadingSilence(buf) };
      }));
    }
    for (const [kind, prefix] of [['up', 'boing'], ['down', 'lower']]) {
      for (let i = 1; i <= 3; i++) {
        jobs.push(get(`./sounds/${prefix}${i}.mp3`).then((buf) => { if (buf) this.fx[kind].push(buf); }));
      }
    }
    await Promise.all(jobs);
  }

  setVolume(v) { this.volume = v; }

  blip(ch, maxSeconds = 0.14) {
    if (!this.ctx || this.muted) return;
    const l = this.letters[ch.toUpperCase()];
    if (!l) return;
    const src = this.ctx.createBufferSource();
    src.buffer = l.buf;
    src.playbackRate.value = 0.92 + Math.random() * 0.4;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(this.volume, now);
    g.gain.setTargetAtTime(0, now + maxSeconds * 0.7, maxSeconds * 0.15); // keep blips short
    src.connect(g).connect(this.out);
    src.start(now, l.offset, maxSeconds * 2);
  }

  sfx(kind) {
    if (!this.ctx || this.muted) return;
    const list = this.fx[kind];
    if (!list || !list.length) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    const g = this.ctx.createGain();
    g.gain.value = this.volume;
    src.connect(g).connect(this.out);
    src.start();
  }
}

// seconds of near-silence at the start of a clip, so each blip starts on the sound itself
function leadingSilence(buf) {
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.02) return i / buf.sampleRate;
  return 0;
}
