import { createSecret } from './prng';
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
const SECRET_KEY = 'secret';

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

/**
 * The per-install key that seeds replacement values (see `RewriteOptions.key`), or null before the
 * service worker has created it. It never leaves this browser profile.
 */
export async function readSecret(): Promise<string | null> {
  const { [SECRET_KEY]: stored } = await chrome.storage.local.get(SECRET_KEY);
  return typeof stored === 'string' && stored ? stored : null;
}

/**
 * Reads the per-install key, creating it if needed. Only the service worker calls this (once, see
 * background.ts): two contexts creating keys at the same time would disagree about replacement values.
 */
export async function createOrReadSecret(): Promise<string> {
  const stored = await readSecret();
  if (stored) {
    return stored;
  }
  const secret = createSecret();
  await chrome.storage.local.set({ [SECRET_KEY]: secret });
  return secret;
}

/** Calls `listener` whenever the per-install key is created or replaced. Returns an unsubscribe function. */
export function watchSecret(listener: (secret: string) => void): () => void {
  return watchLocalChanges((changes) => {
    const next: unknown = changes[SECRET_KEY]?.newValue;
    if (typeof next === 'string' && next) {
      listener(next);
    }
  });
}

/** The per-install key for contexts other than the service worker: read it, or ask the worker to create it. */
export async function requestSecret(): Promise<string> {
  const stored = await readSecret();
  if (stored) {
    return stored;
  }
  const response: unknown = await chrome.runtime.sendMessage({ type: 'get-secret' });
  if (
    typeof response === 'object' &&
    response !== null &&
    'secret' in response &&
    typeof response.secret === 'string'
  ) {
    return response.secret;
  }
  throw new Error('The service worker did not provide a key');
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
