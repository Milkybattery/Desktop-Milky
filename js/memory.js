// Everything she remembers lives in this browser's localStorage.

const KEY = 'milky.memory';

function blank() { return { history: [], notes: [], log: [] }; }

export class Memory {
  constructor(maxMessages = 16) {
    this.max = maxMessages;
    this.data = blank();
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.history)) this.data = { ...blank(), ...d };
    } catch { /* ignore */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  get history() { return this.data.history.slice(-this.max); }
  get notes() { return this.data.notes; }
  get log() { return this.data.log; }

  addExchange(userText, reply) {
    this.data.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    this.data.history = this.data.history.slice(-this.max * 2);
    this.save();
  }

  addLog(who, text) {
    this.data.log.push({ who, text, t: Date.now() });
    this.data.log = this.data.log.slice(-300);
    this.save();
  }

  addNote(text) {
    text = text.trim().slice(0, 300);
    if (!text || this.data.notes.includes(text)) return;
    this.data.notes.push(text);
    this.data.notes = this.data.notes.slice(-40);
    this.save();
  }

  clear() { this.data = blank(); this.save(); }
}
