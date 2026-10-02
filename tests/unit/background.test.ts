import { afterEach, expect, it, vi } from 'vitest';
import { rewriteUrl } from '../../src/lib/rewrite';
import {
  createOrReadSecret,
  DEFAULT_SETTINGS,
  loadSettings,
  watchSettings,
  type Settings,
} from '../../src/lib/settings';

vi.mock('../../src/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/settings')>()),
  loadSettings: vi.fn(),
  watchSettings: vi.fn(),
  createOrReadSecret: vi.fn(),
}));

/** Background runtime listener captured by the test Chrome implementation. */
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: { ok: boolean; secret?: string }) => void,
) => boolean;

const EPOCH = '00000000-0000-4000-8000-000000000001';
const extensionId = 'test-extension';
const popupSender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const offscreenSender = { id: extensionId, url: `chrome-extension://${extensionId}/offscreen.html` };
const contentSender = { id: extensionId, tab: { id: 7 } as chrome.tabs.Tab, url: 'https://example.com/' };

/** Installs menu APIs and the worker's storage/offscreen dependencies. */
async function startBackground(settings: Partial<Settings> = {}) {
  let exists = false;
  const getContexts = vi.fn(() => Promise.resolve(exists ? [{}] : []));
  const createDocument = vi.fn(() => {
    exists = true;
    return Promise.resolve();
  });
  const closeDocument = vi.fn(() => {
    exists = false;
    return Promise.resolve();
  });
  const update = vi.fn<(id: string, properties: object) => Promise<void>>().mockResolvedValue(undefined);
  const removeAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  const tabsSendMessage = vi.fn().mockResolvedValue(true);
  const tabsQuery = vi.fn().mockResolvedValue([{ id: 9 }]);
  const localSet = vi.fn().mockResolvedValue(undefined);
  const sessionSet = vi.fn().mockResolvedValue(undefined);
  const onInstalled = vi.fn<(listener: () => void) => void>();
  const onMessage = vi.fn<(listener: MessageListener) => void>();
  const onStorageChanged =
    vi.fn<(listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => void>();
  const onClicked = vi.fn<(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) => void>();
  const menuCreate = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      lastError: undefined,
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts,
      sendMessage,
      onInstalled: { addListener: onInstalled },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: onMessage },
    },
    contextMenus: { update, removeAll, create: menuCreate, onClicked: { addListener: onClicked } },
    commands: { onCommand: { addListener: vi.fn() } },
    offscreen: { createDocument, closeDocument, Reason: { CLIPBOARD: 'CLIPBOARD' } },
    storage: {
      onChanged: { addListener: onStorageChanged },
      local: {
        get: vi.fn().mockResolvedValue({ totalCount: 0 }),
        set: localSet,
        remove: vi.fn().mockResolvedValue(undefined),
      },
      session: { get: vi.fn().mockResolvedValue({ sessionCount: 0 }), set: sessionSet },
    },
    tabs: { sendMessage: tabsSendMessage, query: tabsQuery },
  });
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false, ...settings });
  vi.mocked(createOrReadSecret).mockResolvedValue('test-key');
  await import('../../src/background');
  await vi.waitFor(() => expect(getContexts).toHaveBeenCalled());
  const listener = onMessage.mock.calls[0]?.[0];
  const settingsListener = vi.mocked(watchSettings).mock.calls[0]?.[0];
  const storageListener = onStorageChanged.mock.calls[0]?.[0];
  const installListener = onInstalled.mock.calls[0]?.[0];
  const menuListener = onClicked.mock.calls[0]?.[0];
  if (!listener || !settingsListener || !storageListener || !installListener || !menuListener)
    throw new Error('listeners were not registered');
  return {
    getContexts,
    createDocument,
    closeDocument,
    update,
    removeAll,
    menuCreate,
    sendMessage,
    tabsSendMessage,
    tabsQuery,
    localSet,
    sessionSet,
    listener,
    installListener,
    menuListener,
    changeSettings(next: Partial<Settings>) {
      storageListener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'local');
      const changed = { ...DEFAULT_SETTINGS, ...next };
      vi.mocked(loadSettings).mockResolvedValue(changed);
      settingsListener(changed);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it('applies mode and Pause independently of menu updates', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'decoy', key: 'test-key' },
    }),
  );
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'strip', key: 'test-key' },
    }),
  );
  worker.changeSettings({ enabled: false });
  await vi.waitFor(() => expect(worker.closeDocument).toHaveBeenCalledOnce());
  expect(worker.update).toHaveBeenCalledTimes(4);
});

it('keeps the coordinator idle when whole-clipboard polling is disabled', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  expect(worker.createDocument).toHaveBeenCalledOnce();
  expect(worker.closeDocument).not.toHaveBeenCalled();
});

it('starts watcher synchronization despite rejected cosmetic menu updates', async () => {
  const worker = await startBackground();
  worker.update.mockRejectedValue(new Error('menu update failed'));
  worker.changeSettings({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'decoy', key: 'test-key' },
    }),
  );
});

it('waits for menu removal before creating entries', async () => {
  const worker = await startBackground();
  let complete: (() => void) | undefined;
  worker.removeAll.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  worker.installListener();
  await vi.waitFor(() => expect(worker.removeAll).toHaveBeenCalledOnce());
  expect(worker.menuCreate).not.toHaveBeenCalled();
  complete?.();
  await vi.waitFor(() => expect(worker.menuCreate).toHaveBeenCalledTimes(2));
});

it.each([
  { type: 'count', urls: '1000' },
  { type: 'count', urls: -1 },
  { type: 'rewritten', urls: 1.5 },
  {
    type: 'reconcile-clipboard',
    pageCopy: true,
    text: 5,
    embedded: true,
    types: ['text/plain'],
    epoch: EPOCH,
  },
  { type: 'restore-clipboard' },
])('rejects malformed commands without side effects %#', async (message) => {
  const worker = await startBackground();
  const response = vi.fn();
  expect(worker.listener(message, contentSender, response)).toBe(false);
  expect(response).toHaveBeenCalledWith({ ok: false });
  expect(worker.localSet).not.toHaveBeenCalled();
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it('rejects content attempts to count as a popup or control the offscreen document', async () => {
  const worker = await startBackground();
  for (const message of [
    { type: 'count', urls: 1 },
    { type: 'offscreen-copy', text: 'spoof' },
    { type: 'watch-config', config: null },
    { type: 'rewritten', urls: 1, tabId: 99 },
  ]) {
    const response = vi.fn();
    worker.listener(message, contentSender, response);
    expect(response).toHaveBeenCalledWith({ ok: false });
  }
  expect(worker.localSet).not.toHaveBeenCalled();
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it('leaves legitimate worker controls for the offscreen receiver', async () => {
  const worker = await startBackground();
  const response = vi.fn();
  expect(worker.listener({ type: 'offscreen-copy', text: 'copy' }, { id: extensionId }, response)).toBe(false);
  expect(response).not.toHaveBeenCalled();
});

it('acknowledges failed or lost Undo forwarding without silently reporting success', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  for (const result of [{ ok: false }, undefined]) {
    worker.sendMessage.mockResolvedValueOnce(result);
    const response = vi.fn();
    expect(worker.listener({ type: 'restore-clipboard', text: 'original' }, contentSender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
  }
  worker.sendMessage.mockRejectedValueOnce(new Error('Worker acknowledgement lost'));
  const failedResponse = vi.fn();
  worker.listener({ type: 'restore-clipboard', text: 'original' }, contentSender, failedResponse);
  await vi.waitFor(() => expect(failedResponse).toHaveBeenCalledWith({ ok: false }));
  const restored = vi.fn();
  worker.listener({ type: 'restore-clipboard', text: 'original' }, contentSender, restored);
  await vi.waitFor(() => expect(restored).toHaveBeenCalledWith({ ok: true }));
  expect(worker.closeDocument).not.toHaveBeenCalled();
});

it('forwards page reconciliation with fresh settings and the originating frame URL', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false, mode: 'strip' });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  const response = vi.fn();
  worker.listener(
    {
      type: 'reconcile-clipboard',
      pageCopy: true,
      text: 'current',
      embedded: true,
      types: ['text/plain'],
      epoch: EPOCH,
      baseline: 'before',
    },
    {
      ...contentSender,
      url: 'https://www.youtube.com/frame',
      tab: { id: 7, url: 'https://example.com/' } as chrome.tabs.Tab,
    },
    response,
  );
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(worker.sendMessage).toHaveBeenCalledWith({
    type: 'offscreen-reconcile',
    text: 'current',
    embedded: true,
    types: ['text/plain'],
    epoch: EPOCH,
    baseline: 'before',
    baseUrl: 'https://www.youtube.com/frame',
    config: { mode: 'strip', key: 'test-key' },
    tabId: 7,
  });
});

for (const boundary of ['coordinator lookup', 'key lookup'] as const) {
  it.each(['Pause', 'mode change', 'Pause and resume'] as const)(
    `cancels automatic reconciliation after %s during ${boundary}`,
    async (change) => {
      const worker = await startBackground({ enabled: true, watchClipboard: false, mode: 'strip' });
      await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
      let release: (() => void) | undefined;
      if (boundary === 'coordinator lookup') {
        worker.getContexts.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve([{}]);
            }),
        );
      } else {
        vi.mocked(createOrReadSecret).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve('test-key');
            }),
        );
      }
      const response = vi.fn();
      worker.listener(
        {
          type: 'reconcile-clipboard',
          pageCopy: true,
          text: 'https://example.com/?utm_source=email',
          embedded: false,
          types: ['text/plain'],
          epoch: EPOCH,
        },
        contentSender,
        response,
      );
      await vi.waitFor(() => expect(release).toBeDefined());
      const settings = { enabled: true, watchClipboard: false, mode: 'strip' as const };
      worker.changeSettings(
        change === 'mode change' ? { ...settings, mode: 'silly' } : { ...settings, enabled: false },
      );
      if (change === 'Pause and resume') worker.changeSettings(settings);
      release?.();
      await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
      expect(worker.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'offscreen-reconcile' }));
      // Explicit Copy remains available after the same setting changes.
      const copied = vi.fn();
      worker.listener({ type: 'copy-clipboard', text: 'explicit copy' }, popupSender, copied);
      await vi.waitFor(() => expect(copied).toHaveBeenCalledWith({ ok: true }));
      expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-copy', text: 'explicit copy' });
    },
  );
}

it('targets offscreen reconciliation notifications and honors notification settings', async () => {
  const worker = await startBackground({ notify: false });
  const message = { type: 'rewritten', urls: 1, relayToast: { message: 'Cleaned' }, tabId: 7 };
  worker.listener(message, offscreenSender, vi.fn());
  await vi.waitFor(() => expect(worker.localSet).toHaveBeenCalledWith({ totalCount: 1 }));
  expect(worker.tabsSendMessage).not.toHaveBeenCalled();
  vi.mocked(loadSettings).mockResolvedValue(DEFAULT_SETTINGS);
  worker.listener(message, offscreenSender, vi.fn());
  await vi.waitFor(() =>
    expect(worker.tabsSendMessage).toHaveBeenCalledWith(
      7,
      { type: 'toast', toast: message.relayToast },
      { frameId: 0 },
    ),
  );
});

it('accepts the popup count and rejects a foreign extension sender', async () => {
  const worker = await startBackground();
  const response = vi.fn();
  worker.listener({ type: 'get-secret' }, { ...popupSender, id: 'foreign' }, response);
  expect(response).toHaveBeenCalledWith({ ok: false });
  worker.listener({ type: 'count', urls: 2 }, popupSender, vi.fn());
  await vi.waitFor(() => expect(worker.localSet).toHaveBeenCalledWith({ totalCount: 2 }));
  expect(worker.sessionSet).toHaveBeenCalledWith({ sessionCount: 2 });
});

it('copies signed links unchanged through the menu and explains the skip', async () => {
  const worker = await startBackground();
  const url = 'https://cdn.example/report.pdf?utm_source=email&Signature=signature&Key-Pair-Id=key&Expires=99';
  worker.menuListener({ menuItemId: 'copy-clean-link', linkUrl: url, editable: false }, { id: 7 } as chrome.tabs.Tab);
  await vi.waitFor(() =>
    expect(worker.tabsSendMessage).toHaveBeenCalledWith(
      7,
      { type: 'toast', toast: { message: '📋 Signed link copied unchanged' } },
      { frameId: 0 },
    ),
  );
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-copy', text: url });
  expect(worker.localSet).not.toHaveBeenCalled();
});

it('routes explicit copies beyond the rewrite input limit while paused', async () => {
  const worker = await startBackground();
  const input = `https://example.com/?${Array<string>(6000).fill('utm_source=x').join('&')}`;
  const rewritten = rewriteUrl(input, { mode: 'decoy', key: 'test-key' })?.url;
  expect(input.length).toBeLessThan(100_000);
  expect(rewritten?.length).toBeGreaterThan(100_000);
  if (!rewritten) throw new Error('Missing rewritten link');
  const unchanged = `https://example.com/?data=${'x'.repeat(100_001)}`;
  for (const text of [rewritten, unchanged]) {
    const response = vi.fn();
    expect(worker.listener({ type: 'copy-clipboard', text }, popupSender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-copy', text });
  }
  worker.sendMessage.mockClear();
  worker.menuListener({ menuItemId: 'copy-clean-link', linkUrl: input, editable: false }, { id: 7 } as chrome.tabs.Tab);
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-copy', text: rewritten }));
});

it('requests native clipboard inspection from the active page without blocking nested reconciliation', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.tabsSendMessage.mockImplementation(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        worker.listener(
          {
            type: 'reconcile-clipboard',
            pageCopy: false,
            text: 'current',
            embedded: false,
            types: ['text/plain'],
            epoch: EPOCH,
          },
          { ...contentSender, tab: { id: 9 } as chrome.tabs.Tab },
          resolve,
        );
      }),
  );
  const response = vi.fn();
  expect(worker.listener({ type: 'inspect-clipboard' }, offscreenSender, response)).toBe(true);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(worker.tabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  expect(worker.tabsSendMessage).toHaveBeenCalledWith(9, { type: 'inspect-clipboard' }, { frameId: 0 });
  expect(worker.sendMessage).toHaveBeenCalledWith({
    type: 'offscreen-reconcile',
    text: 'current',
    embedded: false,
    types: ['text/plain'],
    epoch: EPOCH,
    baseline: undefined,
    baseUrl: undefined,
    config: { mode: 'decoy', key: 'test-key' },
    tabId: 9,
  });
});

it.each([undefined, false, { ok: false }])('rejects unacknowledged native clipboard inspections %#', async (result) => {
  const worker = await startBackground({ enabled: true, watchClipboard: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.tabsSendMessage.mockResolvedValueOnce(result);
  const response = vi.fn();
  worker.listener({ type: 'inspect-clipboard' }, offscreenSender, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it('fails clipboard inspection when the active page cannot receive it', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: true });
  worker.tabsSendMessage.mockRejectedValueOnce(new Error('No content script'));
  const response = vi.fn();
  worker.listener({ type: 'inspect-clipboard' }, offscreenSender, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
});

it('rejects clipboard inspection from a content script or while global watching is disabled', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false });
  const spoofed = vi.fn();
  expect(worker.listener({ type: 'inspect-clipboard' }, contentSender, spoofed)).toBe(false);
  expect(spoofed).toHaveBeenCalledWith({ ok: false });
  const disabled = vi.fn();
  worker.listener({ type: 'inspect-clipboard' }, offscreenSender, disabled);
  await vi.waitFor(() => expect(disabled).toHaveBeenCalledWith({ ok: false }));
  expect(worker.tabsQuery).not.toHaveBeenCalled();
});

it('returns the persistent coordinator generation before a page reads the clipboard', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  for (const epoch of [EPOCH, '00000000-0000-4000-8000-000000000002']) {
    worker.sendMessage.mockResolvedValueOnce({ ok: true, epoch });
    const response = vi.fn();
    expect(worker.listener({ type: 'clipboard-epoch' }, contentSender, response)).toBe(true);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true, epoch }));
  }
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-epoch' });
  expect(worker.createDocument).toHaveBeenCalledOnce();
  expect(worker.closeDocument).not.toHaveBeenCalled();
});

it('forwards trusted content intent with whole-clipboard polling disabled', async () => {
  const worker = await startBackground({ enabled: true, watchClipboard: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  const response = vi.fn();
  worker.sendMessage.mockResolvedValueOnce({ ok: true, epoch: EPOCH });
  expect(worker.listener({ type: 'clipboard-intent' }, contentSender, response)).toBe(true);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true, epoch: EPOCH }));
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-intent' });
  expect(worker.closeDocument).not.toHaveBeenCalled();
});

it('does not create a coordinator for automatic intent while paused', async () => {
  const worker = await startBackground();
  const response = vi.fn();
  worker.listener({ type: 'clipboard-intent' }, contentSender, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
  expect(worker.createDocument).not.toHaveBeenCalled();
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it.each([
  undefined,
  { ok: false, epoch: EPOCH },
  { ok: true },
  { ok: true, epoch: '0' },
  { ok: true, epoch: '' },
  { ok: true, epoch: 0 },
  { ok: true, epoch: -1 },
  { ok: true, epoch: 1.5 },
  { ok: true, epoch: Number.MAX_SAFE_INTEGER + 1 },
])('rejects missing or malformed coordinator generations %#', async (result) => {
  const worker = await startBackground();
  worker.sendMessage.mockResolvedValueOnce(result);
  const response = vi.fn();
  worker.listener({ type: 'clipboard-epoch' }, contentSender, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
});

it('rejects popup generation requests and content attempts to query the offscreen control channel', async () => {
  const worker = await startBackground();
  for (const [message, sender] of [
    [{ type: 'clipboard-epoch' }, popupSender],
    [{ type: 'offscreen-epoch' }, contentSender],
    [{ type: 'clipboard-intent' }, popupSender],
    [{ type: 'offscreen-intent' }, contentSender],
  ] as const) {
    const response = vi.fn();
    expect(worker.listener(message, sender, response)).toBe(false);
    expect(response).toHaveBeenCalledWith({ ok: false });
  }
  expect(worker.sendMessage).not.toHaveBeenCalled();
});
