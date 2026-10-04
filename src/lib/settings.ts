import type { Mode } from './rewrite';

/** User settings, stored in `chrome.storage.local` and edited from the popup. */
export interface Settings {
  /** Master switch for everything automatic; explicit copies (menu, shortcut, popup) always work. */
  enabled: boolean;
  /** Believable decoys, obvious nonsense, or removal. */
  mode: Mode;
  /** Watch the whole clipboard, catching links copied anywhere (address bar, other apps). */
  watchClipboard: boolean;
  /** Show an on-page notification after a rewrite. */
  notify: boolean;
}

/** Settings used until the user changes them, and for any stored value that is missing or invalid. */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'decoy',
  watchClipboard: true,
  notify: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
const MODES: readonly Mode[] = ['decoy', 'silly', 'hybrid', 'strip'];

/** Fills in defaults for missing or malformed stored values. */
function normalize(stored: Record<string, unknown>): Settings {
  const flag = (key: 'enabled' | 'watchClipboard' | 'notify') => {
    const value = stored[key];
    return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key];
  };
  return {
    enabled: flag('enabled'),
    mode: MODES.find((mode) => mode === stored.mode) ?? DEFAULT_SETTINGS.mode,
    watchClipboard: flag('watchClipboard'),
    notify: flag('notify'),
  };
}

/** Reads the current settings from storage. */
export async function loadSettings(): Promise<Settings> {
  return normalize(await chrome.storage.local.get(SETTING_KEYS));
}

/** Persists the given settings; every open context picks them up through {@link watchSettings}. */
export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(changes);
}

/** Subscribes to local storage changes and returns an unsubscribe function. */
function watchLocalChanges(listener: (changes: Record<string, chrome.storage.StorageChange>) => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local') {
      listener(changes);
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

/** Calls `listener` with the full settings whenever any of them change. Returns an unsubscribe function. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  return watchLocalChanges((changes) => {
    if (SETTING_KEYS.some((key) => key in changes)) {
      void loadSettings().then(listener);
    }
  });
}

/** Wording for notifications and menus in the given mode. */
export function describeMode(mode: Mode): { emoji: string; done: string; copyLink: string; copyPage: string } {
  switch (mode) {
    case 'decoy':
      return {
        emoji: '🎭',
        done: 'swapped for decoys',
        copyLink: 'Copy link with decoy tracking',
        copyPage: 'Copy page link with decoy tracking',
      };
    case 'silly':
      return {
        emoji: '🎲',
        done: 'randomized',
        copyLink: 'Copy link with tracking randomized',
        copyPage: 'Copy page link with tracking randomized',
      };
    case 'hybrid':
      return {
        emoji: '🃏',
        done: 'swapped for decoys and nonsense',
        copyLink: 'Copy link with hybrid tracking',
        copyPage: 'Copy page link with hybrid tracking',
      };
    case 'strip':
      return {
        emoji: '🧹',
        done: 'removed',
        copyLink: 'Copy link without tracking',
        copyPage: 'Copy page link without tracking',
      };
  }
}
