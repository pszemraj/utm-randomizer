import type { Mode } from './rewrite';

/** User settings, stored in `chrome.storage.local` and edited from the popup. */
export interface Settings {
  /** Automatically rewrite links copied on web pages. */
  enabled: boolean;
  /** Randomize tracking values or remove the parameters. */
  mode: Mode;
  /** Show an on-page notification after a rewrite. */
  notify: boolean;
}

/** Settings used until the user changes them, and for any stored value that is missing or invalid. */
export const DEFAULT_SETTINGS: Settings = { enabled: true, mode: 'randomize', notify: true };

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Fills in defaults for missing or malformed stored values. */
function normalize(stored: Record<string, unknown>): Settings {
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    mode: stored.mode === 'strip' || stored.mode === 'randomize' ? stored.mode : DEFAULT_SETTINGS.mode,
    notify: typeof stored.notify === 'boolean' ? stored.notify : DEFAULT_SETTINGS.notify,
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

/** Calls `listener` with the full settings whenever any of them change. Returns an unsubscribe function. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && SETTING_KEYS.some((key) => key in changes)) {
      void loadSettings().then(listener);
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}

/** Toast/menu wording for the current mode. */
export function describeMode(mode: Mode): { verb: string; emoji: string } {
  return mode === 'strip' ? { verb: 'removed', emoji: '🧹' } : { verb: 'randomized', emoji: '🎲' };
}
