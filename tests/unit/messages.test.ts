import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtensionMessage, isWorkerSender } from '../../src/lib/messages';

const config = { mode: 'strip' };

afterEach(() => vi.unstubAllGlobals());

describe('runtime message payloads', () => {
  it.each([{ type: 'offscreen-blur' }, { type: 'watch-config', config }, { type: 'watch-config', config: null }])(
    'accepts a valid $type payload',
    (message) => {
      expect(isExtensionMessage(message)).toBe(true);
    },
  );

  it.each([
    null,
    [],
    { type: 'unknown' },
    { type: 'watch-config' },
    { type: 'watch-config', config: false },
    { type: 'watch-config', config: { mode: 'invalid' } },
    { type: 'copy-clipboard', text: 'obsolete action' },
  ])('rejects malformed messages %#', (message) => {
    expect(isExtensionMessage(message)).toBe(false);
  });
});

describe('offscreen worker authorization', () => {
  it('accepts only the same extension worker without a tab', () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}` },
    });
    expect(isWorkerSender({ id: 'test-extension' })).toBe(true);
    expect(isWorkerSender({ id: 'test-extension', url: 'chrome-extension://test-extension/background.js' })).toBe(true);
    expect(isWorkerSender({ id: 'other-extension' })).toBe(false);
    expect(isWorkerSender({ id: 'test-extension', url: 'chrome-extension://test-extension/options.html' })).toBe(false);
    expect(isWorkerSender({ id: 'test-extension', url: 'chrome-extension://test-extension/offscreen.html' })).toBe(
      false,
    );
    expect(isWorkerSender({ id: 'test-extension', tab: { id: 7 } as chrome.tabs.Tab })).toBe(false);
  });
});
