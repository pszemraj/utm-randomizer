import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rewriteUrl } from '../../src/lib/rewrite';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from '../../src/lib/settings';

vi.mock('../../src/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/settings')>()),
  loadSettings: vi.fn(),
  watchSettings: vi.fn(),
}));

/** Background runtime listener captured by the test Chrome implementation. */
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: { ok: boolean; epoch?: string }) => void,
) => boolean;

const extensionId = 'test-extension';
const popupSender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const offscreenSender = { id: extensionId, url: `chrome-extension://${extensionId}/offscreen.html` };
const contentSender = { id: extensionId, tab: { id: 7, windowId: 1 } as chrome.tabs.Tab, url: 'https://example.com/' };

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
  const getLastFocused = vi.fn().mockResolvedValue({ id: 1, focused: true });
  const onFocusChanged = vi.fn<(listener: (windowId: number) => void) => void>();
  const onStorageChanged =
    vi.fn<(listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => void>();
  const onClicked = vi.fn<(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) => void>();
  const menuCreate = vi.fn();
  const setBadgeText = vi.fn().mockResolvedValue(undefined);
  const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
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
    action: { setBadgeText, setBadgeBackgroundColor },
    windows: { getLastFocused, WINDOW_ID_NONE: -1, onFocusChanged: { addListener: onFocusChanged } },
  });
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false, ...settings });
  await import('../../src/background');
  await vi.waitFor(() => expect(getContexts).toHaveBeenCalled());
  const listener = onMessage.mock.calls[0]?.[0];
  const settingsListener = vi.mocked(watchSettings).mock.calls[0]?.[0];
  const storageListener = onStorageChanged.mock.calls[0]?.[0];
  const installListener = onInstalled.mock.calls[0]?.[0];
  const menuListener = onClicked.mock.calls[0]?.[0];
  const focusListener = onFocusChanged.mock.calls[0]?.[0];
  if (!listener || !settingsListener || !storageListener || !installListener || !menuListener || !focusListener)
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
    setBadgeText,
    setBadgeBackgroundColor,
    installListener,
    menuListener,
    getLastFocused,
    changeFocus(focused: boolean, windowId = 1) {
      getLastFocused.mockResolvedValue({ id: windowId, focused });
      focusListener(focused ? windowId : -1);
    },
    changeSettings(next: Partial<Settings>) {
      storageListener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'local');
      const changed = { ...DEFAULT_SETTINGS, ...next };
      vi.mocked(loadSettings).mockResolvedValue(changed);
      settingsListener(changed);
    },
  };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it('applies mode and Pause independently of menu updates', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'decoy' },
    }),
  );
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'strip' },
    }),
  );
  worker.changeSettings({ enabled: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  expect(worker.closeDocument).not.toHaveBeenCalled();
  expect(worker.update).toHaveBeenCalledTimes(4);
});

it('flushes the watcher on focus loss and rejects explicit copies while Chrome is unfocused', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.changeFocus(false);
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-blur' });
  const response = vi.fn();
  worker.listener({ type: 'copy-clipboard', text: 'explicit' }, popupSender, response);
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
  expect(worker.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'offscreen-copy' }));
});

it.each(['copy-clipboard', 'undo-clipboard'] as const)(
  'rejects a queued %s after focus loss and regain',
  async (type) => {
    const worker = await startBackground({ enabled: true });
    await vi.waitFor(() =>
      expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'decoy' } }),
    );
    worker.sendMessage.mockClear();
    let release: (() => void) | undefined;
    worker.getContexts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([{}]);
        }),
    );
    const response = vi.fn();
    worker.listener({ type, text: 'old action' }, popupSender, response);
    await vi.waitFor(() => expect(release).toBeDefined());
    worker.changeFocus(false);
    worker.changeFocus(true);
    release?.();
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
    expect(worker.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: type === 'copy-clipboard' ? 'offscreen-copy' : 'offscreen-restore' }),
    );
  },
);

it('rejects a menu copy when focus changes during its settings lookup', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'decoy' } }),
  );
  worker.sendMessage.mockClear();
  let release: (() => void) | undefined;
  vi.mocked(loadSettings).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve(DEFAULT_SETTINGS);
      }),
  );
  worker.menuListener(
    { menuItemId: 'copy-clean-link', linkUrl: 'https://example.com/?utm_source=email', editable: false },
    { id: 7, windowId: 1 } as chrome.tabs.Tab,
  );
  worker.changeFocus(false);
  worker.changeFocus(true);
  release?.();
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenCalledWith({ text: '!' }));
  expect(worker.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'offscreen-copy' }));
});

it('resumes configured polling on focus gain without an artificial suspension', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.changeFocus(true);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'decoy' } }),
  );
  expect(worker.sendMessage).not.toHaveBeenCalledWith({ type: 'watch-config', config: null });
});

it('delivers the final blur tick immediately while an explicit operation holds the queue', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  let release!: () => void;
  worker.getContexts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve([{}]);
      }),
  );
  const response = vi.fn();
  worker.listener({ type: 'copy-clipboard', text: 'old action' }, popupSender, response);
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeFocus(false);
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-blur' });
  release();
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: false }));
  expect(worker.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'offscreen-copy' }));
});

it('rejects a stale focused-window lookup after focus loss', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  let release!: () => void;
  worker.getLastFocused.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ id: 1, focused: true });
      }),
  );
  worker.changeSettings({ enabled: true, mode: 'strip' });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeFocus(false);
  release();
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-blur' }));
  expect(worker.sendMessage).toHaveBeenCalledOnce();
});

it('starts watcher synchronization despite rejected cosmetic menu updates', async () => {
  const worker = await startBackground();
  worker.update.mockRejectedValue(new Error('menu update failed'));
  worker.changeSettings({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'decoy' },
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

it('shows browser badge feedback only when enabled and Chrome is focused', async () => {
  const worker = await startBackground({ notify: false });
  const message = { type: 'rewritten', urls: 1 };
  worker.listener(message, offscreenSender, vi.fn());
  await vi.waitFor(() => expect(worker.localSet).toHaveBeenCalledWith({ totalCount: 1 }));
  expect(worker.setBadgeText).not.toHaveBeenCalled();
  vi.mocked(loadSettings).mockResolvedValue(DEFAULT_SETTINGS);
  worker.listener(message, offscreenSender, vi.fn());
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenCalled());
  expect(worker.setBadgeBackgroundColor).toHaveBeenCalled();
  expect(worker.tabsSendMessage).not.toHaveBeenCalled();
  worker.setBadgeText.mockClear();
  worker.getLastFocused.mockResolvedValue({ id: 1, focused: false });
  worker.listener(message, offscreenSender, vi.fn());
  await vi.waitFor(() => expect(worker.localSet).toHaveBeenCalledTimes(3));
  expect(worker.setBadgeText).not.toHaveBeenCalled();
});

it('focus-gates popup Undo and acknowledges a rejected restore', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  const spoofed = vi.fn();
  expect(worker.listener({ type: 'undo-clipboard' }, contentSender, spoofed)).toBe(false);
  expect(spoofed).toHaveBeenCalledWith({ ok: false });
  expect(worker.sendMessage).not.toHaveBeenCalled();
  worker.sendMessage.mockResolvedValueOnce({ ok: false });
  const rejected = vi.fn();
  worker.listener({ type: 'undo-clipboard' }, popupSender, rejected);
  await vi.waitFor(() => expect(rejected).toHaveBeenCalledWith({ ok: false }));
  const restored = vi.fn();
  worker.listener({ type: 'undo-clipboard' }, popupSender, restored);
  await vi.waitFor(() => expect(restored).toHaveBeenCalledWith({ ok: true }));
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-restore' });
  worker.changeFocus(false);
  expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-blur' });
  worker.sendMessage.mockClear();
  const unfocused = vi.fn();
  worker.listener({ type: 'undo-clipboard' }, popupSender, unfocused);
  await vi.waitFor(() => expect(unfocused).toHaveBeenCalledWith({ ok: false }));
  expect(worker.sendMessage).not.toHaveBeenCalledWith({ type: 'offscreen-restore' });
});

it('accepts the popup count and rejects a foreign extension sender', async () => {
  const worker = await startBackground();
  const response = vi.fn();
  worker.listener({ type: 'count', urls: 2 }, { ...popupSender, id: 'foreign' }, response);
  expect(response).toHaveBeenCalledWith({ ok: false });
  worker.listener({ type: 'count', urls: 2 }, popupSender, vi.fn());
  await vi.waitFor(() => expect(worker.localSet).toHaveBeenCalledWith({ totalCount: 2 }));
  expect(worker.sessionSet).toHaveBeenCalledWith({ sessionCount: 2 });
});

it('copies signed links unchanged through the menu', async () => {
  const worker = await startBackground();
  const url = 'https://cdn.example/report.pdf?utm_source=email&Signature=signature&Key-Pair-Id=key&Expires=99';
  worker.menuListener({ menuItemId: 'copy-clean-link', linkUrl: url, editable: false }, { id: 7 } as chrome.tabs.Tab);
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'offscreen-copy', text: url }));
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
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledOnce());
  const copied = worker.sendMessage.mock.calls[0]?.[0] as { type: string; text: string };
  expect(copied.type).toBe('offscreen-copy');
  expect(copied.text.length).toBeGreaterThan(100_000);
  expect(copied.text).not.toBe(input);
});
