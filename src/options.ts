import { loadSettings, saveSettings, watchSettings, type Settings } from './lib/settings';
import type { Mode } from './lib/rewrite';

const MODES: readonly Mode[] = ['decoy', 'silly', 'hybrid', 'strip'];

/** Finds a settings control and checks its markup type. */
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`Options markup is missing #${id}`);
  }
  return found;
}

const enabledToggle = element('enabled', HTMLInputElement);
const modeSelect = element('mode', HTMLSelectElement);

/** Displays the stored settings without changing them. */
function render(settings: Settings): void {
  enabledToggle.checked = settings.enabled;
  modeSelect.value = settings.mode;
}

/** Loads the controls and keeps them synchronized with storage. */
async function init(): Promise<void> {
  render(await loadSettings());
  watchSettings(render);
  enabledToggle.disabled = false;
  modeSelect.disabled = false;
}

enabledToggle.addEventListener('change', () => void saveSettings({ enabled: enabledToggle.checked }));
modeSelect.addEventListener('change', () => {
  const mode = MODES.find((candidate) => candidate === modeSelect.value);
  if (mode) {
    void saveSettings({ mode });
  }
});

void init();
