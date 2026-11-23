// Defaults. The settings panel (cog, top right of the stage) overrides these per browser.
export const DEFAULTS = {
  apiKey: "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",
  model: "nemotron-3.5-super-vl:free",
  maxTokens: 3000,
  historyMessages: 16,   // how many recent messages she remembers verbatim
  letterSeconds: 0.06,   // typewriter / animalese speed
  volume: 0.8,
};

const KEY = 'milky.settings';

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    // only store what differs from the defaults
    const diff = {};
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) diff[k] = s[k];
    localStorage.setItem(KEY, JSON.stringify(diff));
  } catch { /* storage blocked: settings just won't persist */ }
}
