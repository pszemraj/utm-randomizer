// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAddressBarCleaner, type AddressBarCleaner } from '../../src/lib/address-bar';
import type { RewriteOptions } from '../../src/lib/rewrite';

let cleaner: AddressBarCleaner | undefined;

/** Starts a cleaner with the given options (null means cleaning is off). */
function start(options: RewriteOptions | null, isContextValid = () => true): AddressBarCleaner {
  cleaner = startAddressBarCleaner({ getOptions: () => options, isContextValid });
  return cleaner;
}

afterEach(() => {
  cleaner?.stop();
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('address bar cleaning', () => {
  it.each(['decoy', 'silly', 'hybrid', 'strip'] as const)('preserves signed page addresses in %s mode', (mode) => {
    const link = '/report.pdf?utm_source=email&Expires=2000000000&Signature=abc%2Bdef&Key-Pair-Id=K123';
    history.replaceState({ page: 1 }, '', link);
    start({ mode, key: 'signed-key' }).clean();
    expect(location.pathname + location.search).toBe(link);
    expect(history.state).toEqual({ page: 1 });
  });

  it('removes tracking parameters from the current URL without navigating', () => {
    history.replaceState({ page: 1 }, '', '/article?id=5&utm_source=newsletter&fbclid=IwAR3abc#top');
    start({ mode: 'strip' });

    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/article?id=5#top');
    expect(history.state).toEqual({ page: 1 });
  });

  it('swaps in decoys that stay put when cleaned again', () => {
    history.replaceState(null, '', '/article?utm_source=newsletter&utm_medium=email');
    const addressBar = start({ mode: 'decoy', key: 'k' });
    const once = location.href;
    expect(once).not.toContain('utm_source=newsletter');

    addressBar.clean();
    expect(location.href).toBe(once);
  });

  it('cleans again after an in-page navigation', () => {
    vi.useFakeTimers();
    start({ mode: 'strip' });
    history.pushState(null, '', '/next?utm_campaign=launch&page=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(500);

    expect(`${location.pathname}${location.search}`).toBe('/next?page=2');
  });

  it('does not follow its own Navigation API replacement with another rewrite', () => {
    vi.useFakeTimers();
    const navigation = new EventTarget();
    vi.stubGlobal('navigation', navigation);
    history.replaceState(null, '', '/article?utm_source=newsletter');
    const replace = history.replaceState.bind(history);
    const writes = vi.spyOn(history, 'replaceState').mockImplementation((...args) => {
      replace(...args);
      navigation.dispatchEvent(new Event('currententrychange'));
    });
    start({ mode: 'decoy', key: 'k' });
    const once = location.href;
    vi.advanceTimersByTime(2_000);
    expect(location.href).toBe(once);
    expect(writes).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cleans its own output after a mode change', () => {
    history.replaceState(null, '', '/article?utm_source=newsletter');
    let options: RewriteOptions = { mode: 'decoy', key: 'k' };
    cleaner = startAddressBarCleaner({ getOptions: () => options });
    expect(location.search).toContain('utm_source=');
    options = { mode: 'strip', key: 'k' };
    cleaner.clean();
    expect(location.search).toBe('');
  });

  it('leaves the URL alone while cleaning is off or the extension is gone', () => {
    history.replaceState(null, '', '/?utm_source=newsletter');
    start(null).clean();
    expect(location.search).toBe('?utm_source=newsletter');
    cleaner?.stop();

    start({ mode: 'strip' }, () => false).clean();
    expect(location.search).toBe('?utm_source=newsletter');
  });
});
