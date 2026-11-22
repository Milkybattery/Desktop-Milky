import { Stage } from './stage.js';
import { Speaker } from './speaker.js';
import { Voice } from './voice.js';
import { Memory } from './memory.js';
import { buildSystem, streamChat, TagParser } from './brain.js';
import { loadSettings, saveSettings } from './config.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const memory = new Memory(settings.historyMessages);
const voice = new Voice();
voice.setVolume(settings.volume);
voice.muted = !!settings.muted;

const stage = new Stage($('c'));
const speaker = new Speaker({
  bubble: $('bubble'),
  textEl: $('text'),
  voice,
  stage,
  letterSeconds: settings.letterSeconds,
});
// every part starts from a plain face unless its own [EMOTION] tag says otherwise
speaker.onPartStart = () => stage.setEmotion('neutral');

window.__milky = { stage, speaker, memory, voice, settings }; // handy for poking around in the console

let personality = 'You are Milky, a playful, smug robot girl.';
fetch('./personality.txt').then((r) => (r.ok ? r.text() : null)).then((t) => { if (t) personality = t; }).catch(() => {});

// ---------- stage loading ----------

stage.load('./assets/milky.glb', './animations/pose1.glb')
  .then(() => $('loading').classList.add('done'))
  .catch((err) => {
    console.error(err);
    $('loading').textContent = "Couldn't load Milky's 3D model. Does your browser support WebGL?";
  });

// ---------- feet ----------

let feetUp = false;
let feetSince = Date.now();
const feetUps = []; // timestamps of recent raises

function setFeet(up) {
  if (up === feetUp) return;
  feetUp = up;
  feetSince = Date.now();
  if (up) feetUps.push(Date.now());
  stage.setFeet(up);
  voice.sfx(up ? 'up' : 'down');
}

function describeSpan(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} seconds`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} minutes` : `${Math.round(m / 60)} hours`;
}

// ---------- attachments ----------

const attachments = []; // { kind: 'image'|'text'|'pdf', name, dataUrl?, text?, thumb? }
const TEXT_EXT = /\.(txt|md|json|csv|tsv|log|js|ts|py|html|css|xml|ya?ml|ini|toml|c|cpp|java|rs|go|sh)$/i;
const MAX_TEXT = 40000;

async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const max = 1280;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function readAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

async function addFiles(files) {
  for (const file of files) {
    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readImage(file);
        attachments.push({ kind: 'image', name: file.name || 'image', dataUrl, thumb: dataUrl });
      } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        if (file.size > 15e6) { flash('That PDF is too big (15 MB max).'); continue; }
        attachments.push({ kind: 'pdf', name: file.name, dataUrl: await readAsDataUrl(file) });
      } else if (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXT.test(file.name)) {
        let text = await file.text();
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n[...file cut off here...]';
        attachments.push({ kind: 'text', name: file.name, text });
      } else {
        flash(`Milky can't read ${file.name || 'that file'} (images, PDFs and text files work).`);
      }
    } catch (err) {
      console.error(err);
      flash(`Couldn't read ${file.name || 'that file'}.`);
    }
  }
  renderChips();
  syncSend();
}

function renderChips() {
  const box = $('chips');
  box.replaceChildren();
  attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (a.thumb) {
      const img = document.createElement('img');
      img.src = a.thumb; img.alt = '';
      chip.appendChild(img);
    } else {
      const ico = document.createElement('div');
      ico.className = 'ico';
      ico.textContent = a.kind === 'pdf' ? 'PDF' : 'TXT';
      chip.appendChild(ico);
    }
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = a.name;
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×'; x.title = 'Remove'; x.setAttribute('aria-label', `Remove ${a.name}`);
    x.onclick = () => { attachments.splice(i, 1); renderChips(); syncSend(); };
    chip.append(name, x);
    box.appendChild(chip);
  });
}

$('plus').onclick = () => $('file').click();
$('file').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };

let dragDepth = 0;
const app = document.querySelector('.app');
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; app.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) app.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; app.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});
$('input').addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});

// ---------- input box ----------

const input = $('input');
function syncSend() {
  $('send').hidden = !(input.value.trim() || attachments.length);
}
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 150) + 'px';
}
input.addEventListener('input', () => { autosize(); syncSend(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('form').requestSubmit();
  }
});

let statusTimer;
function flash(msg, info = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('info', info);
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => { s.textContent = ''; }, 9000);
}

// ---------- sending ----------

let controller = null;

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

async function send() {
  const text = input.value.trim();
  if (!text && !attachments.length) return;
  voice.unlock(); // first click or keypress lets the browser play sound
  flash('');

  const files = attachments.splice(0);
  input.value = '';
  autosize(); renderChips(); syncSend();

  // what the model sees
  let body = text;
  for (const f of files) if (f.kind === 'text') body += `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``;
  const media = files.filter((f) => f.kind !== 'text');
  let content = body || '(the user sent attachments without a message)';
  if (media.length) {
    content = [{ type: 'text', text: content }];
    for (const f of media) {
      if (f.kind === 'image') content.push({ type: 'image_url', image_url: { url: f.dataUrl } });
      else content.push({ type: 'file', file: { filename: f.name, file_data: f.dataUrl } });
    }
  }
  // what gets remembered (no image data)
  const remembered = (text || '') + (files.length ? ` [attached: ${files.map((f) => f.name).join(', ')}]` : '');
  memory.addLog('you', remembered.trim());

  if (controller) controller.abort();
  controller = new AbortController();
  const mine = controller;
  $('form').classList.add('busy');

  const recent = feetUps.filter((t) => Date.now() - t < 3600e3);
  const system = buildSystem(personality, {
    emotion: stage.emotion,
    feetUp,
    feetFor: describeSpan(Date.now() - feetSince),
    feetUps: recent.length,
    notes: memory.notes,
  });
  const messages = [{ role: 'system', content: system }, ...memory.history, { role: 'user', content }];

  let raw = '';
  let spoken = '';
  const parser = new TagParser((ev) => {
    switch (ev.type) {
      case 'text': speaker.push(ev.text, ev.shaky); spoken += ev.text; break;
      case 'next': speaker.next(); spoken += '\n\n'; break;
      case 'emotion': speaker.action(() => stage.setEmotion(ev.name)); break;
      case 'feet': speaker.action(() => setFeet(ev.up)); break;
      case 'remember': memory.addNote(ev.text); break;
    }
  });

  speaker.begin();
  try {
    for await (const chunk of streamChat({
      apiKey: settings.apiKey, model: settings.model, messages, maxTokens: settings.maxTokens, signal: mine.signal,
    })) {
      raw += chunk;
      parser.feed(chunk);
    }
    parser.end();
    speaker.end();
    if (!spoken.trim()) {
      flash('The model sent back an empty reply. Try again, or pick another model in settings.');
      $('bubble').classList.add('hidden');
    } else {
      memory.addExchange(remembered.trim() || '(attachment)', raw.trim());
      memory.addLog('milky', spoken.trim());
    }
  } catch (err) {
    if (mine.signal.aborted) return; // replaced by a newer message
    console.error(err);
    parser.end();
    if (spoken.trim()) {
      speaker.end();
      memory.addLog('milky', spoken.trim());
    } else {
      speaker.say(['Whuh?', 'Huh?', 'Eh?'][Math.floor(Math.random() * 3)]);
    }
    flash(`Something went wrong: ${err.message}`);
  } finally {
    if (controller === mine) { controller = null; $('form').classList.remove('busy'); }
  }
}

// ---------- dialogs ----------

const settingsDlg = $('settings');
$('cogBtn').onclick = () => {
  $('setKey').value = settings.apiKey || '';
  $('setModel').value = settings.model || '';
  $('setVol').value = settings.volume;
  $('setMute').checked = !!settings.muted;
  $('setSpeed').value = settings.letterSeconds;
  const ul = $('notesList');
  ul.replaceChildren();
  if (!memory.notes.length) {
    const li = document.createElement('li'); li.textContent = 'Nothing yet.'; ul.appendChild(li);
  }
  for (const n of memory.notes) { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); }
  settingsDlg.showModal();
};
settingsDlg.addEventListener('close', () => {
  if (settingsDlg.returnValue !== 'save') return;
  settings.apiKey = $('setKey').value.trim();
  settings.model = $('setModel').value.trim();
  settings.volume = Number($('setVol').value);
  settings.muted = $('setMute').checked;
  settings.letterSeconds = Number($('setSpeed').value);
  voice.setVolume(settings.volume);
  voice.muted = settings.muted;
  speaker.setSpeed(settings.letterSeconds);
  saveSettings({ ...settings });
  flash('Settings saved.', true);
});
$('clearMem').onclick = () => {
  if (confirm('Make Milky forget the whole conversation and everything she chose to remember?')) {
    memory.clear();
    flash('She has forgotten everything.', true);
    settingsDlg.close('cancel');
  }
};

$('logBtn').onclick = () => {
  const list = $('logList');
  list.replaceChildren();
  if (!memory.log.length) {
    const d = document.createElement('div'); d.className = 'msg'; d.textContent = 'No messages yet.'; list.appendChild(d);
  }
  for (const m of memory.log) {
    const d = document.createElement('div');
    d.className = 'msg ' + m.who;
    const who = document.createElement('span');
    who.className = 'who'; who.textContent = m.who === 'you' ? 'You' : 'Milky';
    d.append(who, document.createTextNode(m.text));
    list.appendChild(d);
  }
  $('logDlg').showModal();
  list.scrollTop = list.scrollHeight;
};

// ---------- hello ----------

setTimeout(() => {
  speaker.say(memory.history.length
    ? 'Oh, you came back. I knew you would.'
    : "Oh, you're here. Go on, ask me something.");
}, 600);
input.focus();
