import type { ExtensionMessage } from './lib/messages';
import { getRewriteSkipReason, hasTrackingParams, rewriteUrl, type Mode } from './lib/rewrite';
import { describeMode, loadSettings, requestSecret, saveSettings, watchSettings, type Settings } from './lib/settings';

const COMMAND_COPY_PAGE = 'copy-clean-page-url';
const MODE_HINTS: Record<Mode, string> = {
  decoy: 'Believable fakes that poison analytics, e.g. utm_source=bing',
  silly: 'Obvious nonsense, e.g. utm_source=carrier-pigeon',
  hybrid: 'Believable fakes and obvious nonsense, mixed value by value',
  strip: 'Deletes tracking parameters from the link',
};
const MODES: readonly Mode[] = ['decoy', 'silly', 'hybrid', 'strip'];

/** Looks up a popup element by id and checks its type, so markup drift fails loudly. */
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`Popup markup is missing #${id}`);
  }
  return found;
}

const enabledToggle = element('enabled', HTMLInputElement);
const notifyToggle = element('notify', HTMLInputElement);
const addressBarToggle = element('cleanAddressBar', HTMLInputElement);
const clipboardToggle = element('watchClipboard', HTMLInputElement);
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
let key = '';
let pageUrl: string | null = null;

/** Syncs the controls and hints with the given settings. */
function render(current: Settings): void {
  settings = current;
  enabledToggle.checked = current.enabled;
  notifyToggle.checked = current.notify;
  addressBarToggle.checked = current.cleanAddressBar;
  clipboardToggle.checked = current.watchClipboard;
  for (const input of modeInputs) {
    input.checked = input.value === current.mode;
  }
  modeHint.textContent = MODE_HINTS[current.mode];
  enabledHint.textContent = current.enabled
    ? 'Rewrites tracking in links you copy'
    : 'Paused: links are left as they are';
  document.body.classList.toggle('paused', !current.enabled);
}

/** Displays a stored counter, treating missing values as zero. */
function renderCount(target: HTMLElement, value: unknown): void {
  target.textContent = (Number(value) || 0).toLocaleString();
}

/** Shows a status line under the copy button. */
function setStatus(message: string, isError = false): void {
  copyStatus.textContent = message;
  copyStatus.classList.toggle('error', isError);
}

/** Copies the active tab's URL with its tracking parameters rewritten. */
async function copyPageLink(): Promise<void> {
  if (!pageUrl) {
    return;
  }
  const result = rewriteUrl(pageUrl, { mode: settings.mode, key });
  try {
    const message: ExtensionMessage = { type: 'copy-clipboard', text: result?.url ?? pageUrl };
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (!(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)) {
      throw new Error('Clipboard coordinator rejected the copy');
    }
  } catch {
    setStatus('Could not write to the clipboard', true);
    return;
  }
  const { emoji, done } = describeMode(settings.mode);
  if (result) {
    setStatus(`${emoji} Copied, tracking ${done}`);
    const message: ExtensionMessage = { type: 'count', urls: 1 };
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } else if (getRewriteSkipReason(pageUrl) === 'signed') {
    setStatus('Copied (signed link left unchanged)');
  } else if (getRewriteSkipReason(pageUrl) === 'too-long') {
    setStatus('Copied (link too long to rewrite)');
  } else if (hasTrackingParams(pageUrl)) {
    // The address bar was already cleaned, so the link carries replacements already.
    setStatus(`${emoji} Copied, tracking already ${done}`);
  } else {
    setStatus('Copied unchanged');
  }
}

/** Loads settings, statistics, the active tab, and the configured shortcut into the popup. */
async function init(): Promise<void> {
  element('version', HTMLSpanElement).textContent = `v${chrome.runtime.getManifest().version}`;
  render(await loadSettings());
  watchSettings(render);
  key = await requestSecret();

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
addressBarToggle.addEventListener('change', () => void saveSettings({ cleanAddressBar: addressBarToggle.checked }));
clipboardToggle.addEventListener('change', () => void saveSettings({ watchClipboard: clipboardToggle.checked }));
for (const input of modeInputs) {
  input.addEventListener('change', () => {
    const mode = MODES.find((candidate) => candidate === input.value);
    if (input.checked && mode) {
      void saveSettings({ mode });
    }
  });
}
copyButton.addEventListener('click', () => void copyPageLink());
changeShortcut.addEventListener('click', (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void init();
