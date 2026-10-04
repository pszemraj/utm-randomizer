import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtensionMessage, isWorkerSender } from '../../src/lib/messages';

const EPOCH = '00000000-0000-4000-8000-000000000001';
const config = { mode: 'strip' };
const snapshot = { text: 'https://example.com/?utm_source=email', html: null, types: ['text/plain'] };

afterEach(() => vi.unstubAllGlobals());

describe('runtime message payloads', () => {
  it.each([
    { type: 'inspect-clipboard' },
    { type: 'clipboard-epoch' },
    { type: 'clipboard-intent' },
    { type: 'offscreen-intent' },
    { type: 'offscreen-epoch' },
    { type: 'count', urls: 1 },
    { type: 'rewritten', urls: 2, relayToast: { message: 'Cleaned', undoText: '' }, tabId: 7 },
    { type: 'rewritten', urls: 1, clipboard: { before: snapshot, after: snapshot } },
    {
      type: 'reconcile-clipboard',
      text: 'ordinary prose',
      embedded: true,
      pageCopy: true,
      types: ['text/plain'],
      epoch: EPOCH,
      observeOnly: true,
    },
    { type: 'toast', toast: { message: 'Cleaned' } },
    { type: 'watch-config', config },
    { type: 'watch-config', config: null },
    { type: 'offscreen-copy', text: 'copy' },
    { type: 'copy-clipboard', text: 'copy' },
    { type: 'offscreen-copy', text: 'x'.repeat(100_001) },
    { type: 'copy-clipboard', text: 'x'.repeat(100_001) },
    { type: 'restore-clipboard', text: 'original' },
    { type: 'offscreen-restore', text: 'original' },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: '',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
      baseline: 'before',
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
      tabId: 7,
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
      baseUrl: 'https://example.com/',
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: false,
      text: '',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: '',
      embedded: true,
      types: ['text/plain', 'web application/custom'],
      epoch: EPOCH,
    },
  ])('accepts a valid $type payload', (message) => {
    expect(isExtensionMessage(message)).toBe(true);
  });

  it.each(['reconcile-clipboard', 'offscreen-reconcile'])('bounds current text but not the $type baseline', (type) => {
    const message = {
      type,
      pageCopy: true,
      text: 'https://example.com/page?utm_source=newsletter',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      baseline: 'x'.repeat(150_000),
      config,
    };
    expect(isExtensionMessage(message)).toBe(true);
    expect(isExtensionMessage({ ...message, text: 'x'.repeat(100_001) })).toBe(false);
    expect(isExtensionMessage({ ...message, baseline: 5 })).toBe(false);
  });

  it.each([
    null,
    [],
    { type: 'unknown' },
    { type: 'count', urls: '1000' },
    { type: 'count', urls: 0 },
    { type: 'count', urls: -1 },
    { type: 'count', urls: 1.5 },
    { type: 'count', urls: Number.POSITIVE_INFINITY },
    { type: 'count', urls: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'rewritten', urls: 1, relayToast: { message: 42 } },
    { type: 'rewritten', urls: 1, tabId: -1 },
    {
      type: 'reconcile-clipboard',
      text: 'ordinary prose',
      embedded: true,
      pageCopy: true,
      types: ['text/plain'],
      epoch: EPOCH,
      observeOnly: 'yes',
    },
    { type: 'rewritten', urls: 1, clipboard: { before: null, after: snapshot } },
    { type: 'rewritten', urls: 1, clipboard: { before: snapshot, after: { ...snapshot, html: 7 } } },
    { type: 'offscreen-copy' },
    { type: 'offscreen-copy', text: 5 },
    { type: 'copy-clipboard', text: 5 },
    { type: 'offscreen-restore', text: 'x'.repeat(100_001) },
    { type: 'restore-clipboard', text: 'x'.repeat(100_001) },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'x'.repeat(100_001),
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'offscreen-reconcile',
      text: 'x'.repeat(100_001),
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
    },
    { type: 'restore-clipboard', text: null },
    { type: 'watch-config', config: { mode: 'invalid' } },
    { type: 'toast', toast: { message: 'ok', undoText: 5 } },
    { type: 'toast', toast: { message: 'x'.repeat(100_001) } },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: 'true',
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
      baseline: 5,
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
      tabId: 1.5,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: ['text/plain', 5],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: ['x'.repeat(257)],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: [''],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: Array<string>(101).fill('text/plain'),
      epoch: EPOCH,
    },
    { type: 'reconcile-clipboard', pageCopy: true, text: 'copy', embedded: true, types: ['text/plain'] },
    { type: 'reconcile-clipboard', pageCopy: true, text: 'copy', embedded: true, types: ['text/plain'], epoch: -1 },
    { type: 'reconcile-clipboard', pageCopy: true, text: 'copy', embedded: true, types: ['text/plain'], epoch: 1.5 },
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'copy',
      embedded: true,
      types: ['text/plain'],
      epoch: Number.MAX_SAFE_INTEGER + 1,
    },
    { type: 'offscreen-reconcile', text: 'copy', embedded: true, types: ['text/plain'], config, epoch: '0' },
    {
      type: 'reconcile-clipboard',
      text: 'copy',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'reconcile-clipboard',
      pageCopy: 'true',
      text: 'copy',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
      baseUrl: 5,
    },
    {
      type: 'offscreen-reconcile',
      text: 'copy',
      embedded: false,
      types: ['text/plain'],
      epoch: EPOCH,
      config,
      baseUrl: 'x'.repeat(100_001),
    },
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

it.each([0, '', '0', EPOCH.slice(1), EPOCH.replace('4', 'g')])(
  'rejects invalid generation tokens on both reconciliation routes %#',
  (epoch) => {
    expect(
      isExtensionMessage({
        type: 'reconcile-clipboard',
        pageCopy: true,
        text: 'copy',
        embedded: false,
        types: ['text/plain'],
        epoch,
      }),
    ).toBe(false);
    expect(
      isExtensionMessage({
        type: 'offscreen-reconcile',
        text: 'copy',
        embedded: false,
        types: ['text/plain'],
        config,
        epoch,
      }),
    ).toBe(false);
  },
);
