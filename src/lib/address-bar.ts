import { rewriteUrl, type RewriteOptions } from './rewrite';

/** Everything {@link startAddressBarCleaner} needs from its environment; tests pass fakes. */
export interface AddressBarDeps {
  /** Rewrite options, or null while address-bar cleaning is off or the key is still loading. */
  getOptions: () => RewriteOptions | null;
  /** False once the extension was reloaded or removed; the cleaner then shuts itself down. */
  isContextValid?: () => boolean;
}

/** Handle returned by {@link startAddressBarCleaner}. */
export interface AddressBarCleaner {
  /** Cleans the current address now, e.g. after settings change. */
  clean(): void;
  /** Removes every listener. */
  stop(): void;
}

/** Delay after an in-page navigation, so the page's router finishes before the URL is swapped. */
const AFTER_NAVIGATION_MS = 300;

/**
 * Keeps tracking parameters out of the address bar, so copying the page URL from the address bar,
 * sharing it, or bookmarking it picks up a clean link, with no clipboard race at all. The page is
 * not reloaded: the URL is swapped with `history.replaceState` once the page has loaded (after it
 * has done its own work with the URL) and again after each in-page navigation.
 */
export function startAddressBarCleaner(deps: AddressBarDeps): AddressBarCleaner {
  const isContextValid = deps.isContextValid ?? (() => true);
  const listeners = new AbortController();
  const { signal } = listeners;
  let pending = 0;
  let lastWritten: { url: string; mode: RewriteOptions['mode']; key: RewriteOptions['key'] } | null = null;
  // The page gets to finish loading with its URL untouched.
  let loaded = document.readyState === 'complete';

  /** Removes every listener and cancels a pending clean. */
  function stop(): void {
    listeners.abort();
    window.clearTimeout(pending);
  }

  /** Swaps the current URL for its cleaned version, if it has tracking parameters and the page has loaded. */
  function clean(): void {
    if (!isContextValid()) {
      stop();
      return;
    }
    if (!loaded) {
      return;
    }
    const options = deps.getOptions();
    if (!options) {
      return;
    }
    const current = location.href;
    if (current === lastWritten?.url && options.mode === lastWritten.mode && options.key === lastWritten.key) {
      return;
    }
    lastWritten = null;
    const result = rewriteUrl(current, options);
    if (!result || result.url === current) {
      return;
    }
    try {
      // Keep the page's history state: routers store their own bookkeeping there.
      history.replaceState(history.state, '', result.url);
      lastWritten = { url: location.href, mode: options.mode, key: options.key };
    } catch {
      // Sandboxed or opaque-origin documents cannot change their URL.
    }
  }

  /** Cleans after the page's own navigation handling has settled. */
  function cleanSoon(): void {
    window.clearTimeout(pending);
    pending = window.setTimeout(clean, AFTER_NAVIGATION_MS);
  }

  if (loaded) {
    clean();
  } else {
    window.addEventListener(
      'load',
      () => {
        loaded = true;
        clean();
      },
      { once: true, signal },
    );
  }
  window.addEventListener('pageshow', clean, { signal });
  window.addEventListener('popstate', cleanSoon, { signal });
  window.addEventListener('hashchange', cleanSoon, { signal });
  // Navigation API (Chrome 102+) reports pushState/replaceState navigations by single-page apps.
  const navigation = (window as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('currententrychange', cleanSoon, { signal });

  return { clean, stop };
}
