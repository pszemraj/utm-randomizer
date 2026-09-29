import type { ExtensionMessage } from './lib/messages';
import { rewriteUrl, type Mode } from './lib/rewrite';
import { describeMode, loadSettings, saveSettings, watchSettings, type Settings } from './lib/settings';

const COMMAND_COPY_PAGE = 'copy-clean-page-url';
const MODE_HINTS: Record<Mode, string> = {
  randomize: 'Swaps values for nonsense, e.g. utm_source=carrier-pigeon',
  strip: 'Deletes tracking parameters from the link',
};

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`Popup markup is missing #${id}`);
  }
  return found;
}

const enabledToggle = element('enabled', HTMLInputElement);
const notifyToggle = element('notify', HTMLInputElement);
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
const modeHint = element('modeHint', HTMLParagraphElement);
const enabledHint = element('enabledHint', HTMLSpanElement);
const copyButton = element('copyPage', HTMLButtonElement);
const copyStatus = element('copyStatus', HTMLParagraphElement);
const totalCount = element('totalCount', HTMLElement);
const sessionCount = element('sessionCount', HTMLElement);
const shortcut = element('shortcut', HTMLElement);
const changeShortcut = element('changeShortcut', HTMLAnchorElement);

let settings: Settings;
let pageUrl: string | null = null;

function render(current: Settings): void {
  settings = current;
  enabledToggle.checked = current.enabled;
  notifyToggle.checked = current.notify;
  for (const input of modeInputs) {
    input.checked = input.value === current.mode;
  }
  modeHint.textContent = MODE_HINTS[current.mode];
  enabledHint.textContent = current.enabled
    ? 'Rewrites tracking in links you copy on web pages'
    : 'Paused: copied links are left as they are';
  document.body.classList.toggle('paused', !current.enabled);
}

function renderCount(target: HTMLElement, value: unknown): void {
  target.textContent = (Number(value) || 0).toLocaleString();
}

function setStatus(message: string, isError = false): void {
  copyStatus.textContent = message;
  copyStatus.classList.toggle('error', isError);
}

async function copyPageLink(): Promise<void> {
  if (!pageUrl) {
    return;
  }
  const result = rewriteUrl(pageUrl, { mode: settings.mode });
  try {
    await navigator.clipboard.writeText(result?.url ?? pageUrl);
  } catch {
    setStatus('Could not write to the clipboard', true);
    return;
  }
  if (result) {
    const { emoji, verb } = describeMode(settings.mode);
    setStatus(`${emoji} Copied with tracking ${verb}`);
    const message: ExtensionMessage = { type: 'count', urls: 1 };
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } else {
    setStatus('Copied (no tracking found)');
  }
}

async function init(): Promise<void> {
  element('version', HTMLSpanElement).textContent = `v${chrome.runtime.getManifest().version}`;
  render(await loadSettings());
  watchSettings(render);

  const [{ totalCount: total }, { sessionCount: session }] = await Promise.all([
    chrome.storage.local.get('totalCount'),
    chrome.storage.session.get('sessionCount'),
  ]);
  renderCount(totalCount, total);
  renderCount(sessionCount, session);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.totalCount) {
      renderCount(totalCount, changes.totalCount.newValue);
    }
    if (area === 'session' && changes.sessionCount) {
      renderCount(sessionCount, changes.sessionCount.newValue);
    }
  });

  // Opening the popup grants activeTab, which exposes the current tab's URL.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/i.test(tab.url)) {
    pageUrl = tab.url;
    copyButton.disabled = false;
  } else {
    setStatus('Only available on web pages');
  }

  const commands = await chrome.commands.getAll();
  const command = commands.find(({ name }) => name === COMMAND_COPY_PAGE);
  shortcut.textContent = command?.shortcut || 'not set';
}

enabledToggle.addEventListener('change', () => void saveSettings({ enabled: enabledToggle.checked }));
notifyToggle.addEventListener('change', () => void saveSettings({ notify: notifyToggle.checked }));
for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (input.checked) {
      void saveSettings({ mode: input.value === 'strip' ? 'strip' : 'randomize' });
    }
  });
}
copyButton.addEventListener('click', () => void copyPageLink());
changeShortcut.addEventListener('click', (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void init();
