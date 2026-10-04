import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtensionMessage, isWorkerSender } from '../../src/lib/messages';

const config = { mode: 'strip' };

afterEach(() => vi.unstubAllGlobals());

describe('runtime message payloads', () => {
  it.each([
    { type: 'offscreen-blur' },
    { type: 'count', urls: 1 },
    { type: 'rewritten', urls: 2 },
    { type: 'watch-config', config },
    { type: 'watch-config', config: null },
    { type: 'offscreen-copy', text: 'copy' },
    { type: 'copy-clipboard', text: 'copy' },
    { type: 'offscreen-copy', text: 'x'.repeat(100_001) },
    { type: 'copy-clipboard', text: 'x'.repeat(100_001) },
    { type: 'offscreen-restore' },
    { type: 'undo-clipboard' },
  ])('accepts a valid $type payload', (message) => {
    expect(isExtensionMessage(message)).toBe(true);
  });

  it.each([
    null,
    [],
    { type: 'unknown' },
    { type: 'clipboard-epoch' },
    { type: 'count', urls: '1000' },
    { type: 'count', urls: 0 },
    { type: 'count', urls: -1 },
    { type: 'count', urls: 1.5 },
    { type: 'count', urls: Number.POSITIVE_INFINITY },
    { type: 'count', urls: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'rewritten', urls: 0 },
    { type: 'rewritten', urls: '1' },
    { type: 'offscreen-copy' },
    { type: 'offscreen-copy', text: 5 },
    { type: 'copy-clipboard', text: 5 },
    { type: 'restore-clipboard', text: 'x'.repeat(100_001) },
    { type: 'restore-clipboard', text: null },
    { type: 'watch-config', config: { mode: 'invalid' } },
    { type: 'toast', toast: { message: 'ok', undoText: 5 } },
    { type: 'toast', toast: { message: 'x'.repeat(100_001) } },
    { type: 'reconcile-clipboard' },
    { type: 'clipboard-intent' },
    { type: 'offscreen-intent' },
    { type: 'offscreen-epoch' },
    { type: 'inspect-clipboard' },
    { type: 'offscreen-reconcile' },
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
    expect(isWorkerSender({ id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' })).toBe(false);
    expect(isWorkerSender({ id: 'test-extension', url: 'chrome-extension://test-extension/offscreen.html' })).toBe(
      false,
    );
    expect(isWorkerSender({ id: 'test-extension', tab: { id: 7 } as chrome.tabs.Tab })).toBe(false);
  });
});
