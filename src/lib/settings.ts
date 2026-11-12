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

/** Whether a value is one of the supported replacement modes. */
export function isMode(value: unknown): value is Mode {
  return MODES.some((mode) => mode === value);
}

/** Fills in defaults for missing or malformed stored values. */
function normalize(stored: Record<string, unknown>): Settings {
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    mode: isMode(stored.mode) ? stored.mode : DEFAULT_SETTINGS.mode,
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

/** Calls `listener` with the full settings whenever local settings change during the page's lifetime. */
export function watchSettings(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SETTING_KEYS.some((key) => key in changes)) {
      void loadSettings().then(listener);
    }
  });
}
