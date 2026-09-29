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

  it('leaves the URL alone while cleaning is off or the extension is gone', () => {
    history.replaceState(null, '', '/?utm_source=newsletter');
    start(null).clean();
    expect(location.search).toBe('?utm_source=newsletter');
    cleaner?.stop();

    start({ mode: 'strip' }, () => false).clean();
    expect(location.search).toBe('?utm_source=newsletter');
  });
});
