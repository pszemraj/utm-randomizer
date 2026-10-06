import type { Mode } from './rewrite';

/** User settings, stored in `chrome.storage.local` and edited from Extension options. */
export interface Settings {
  /** Enable automatic clipboard URL rewriting. */
  enabled: boolean;
  /** Believable decoys, obvious nonsense, or removal. */
  mode: Mode;
}

/** Settings used until the user changes them, and for any stored value that is missing or invalid. */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'hybrid',
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
const MODES: readonly Mode[] = ['decoy', 'silly', 'hybrid', 'strip'];

/** Fills in defaults for missing or malformed stored values. */
function normalize(stored: Record<string, unknown>): Settings {
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    mode: MODES.find((mode) => mode === stored.mode) ?? DEFAULT_SETTINGS.mode,
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
