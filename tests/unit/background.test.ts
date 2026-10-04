import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../../src/lib/messages';
import { DEFAULT_SETTINGS, loadSettings, watchSettings, type Settings } from '../../src/lib/settings';

vi.mock('../../src/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/settings')>()),
  loadSettings: vi.fn(),
  watchSettings: vi.fn(),
}));

/** Installs the worker's clipboard lifecycle, settings, and focus dependencies. */
async function startBackground(
  settings: Partial<Settings> = {},
  focused = true,
  initialFocus?: Promise<{ id: number; focused: boolean }>,
) {
  let exists = false;
  let currentSettings = { ...DEFAULT_SETTINGS, enabled: false, ...settings };
  const getContexts = vi.fn(() => Promise.resolve(exists ? [{}] : []));
  const createDocument = vi.fn(() => {
    exists = true;
    return Promise.resolve();
  });
  const sendMessage = vi.fn<(message: ExtensionMessage) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
  const getLastFocused = vi.fn().mockResolvedValue({ id: 1, focused });
  if (initialFocus) getLastFocused.mockReturnValueOnce(initialFocus);
  const onFocusChanged = vi.fn<(listener: (windowId: number) => void) => void>();
  const onMessage =
    vi.fn<
      (
        listener: (
          message: unknown,
          sender: chrome.runtime.MessageSender,
          respond: (response: { ok: boolean }) => void,
        ) => boolean,
      ) => void
    >();
  const onStorageChanged =
    vi.fn<(listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => void>();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener: onMessage },
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts,
      sendMessage,
    },
    offscreen: { createDocument, Reason: { CLIPBOARD: 'CLIPBOARD' } },
    storage: { onChanged: { addListener: onStorageChanged } },
    windows: { getLastFocused, WINDOW_ID_NONE: -1, onFocusChanged: { addListener: onFocusChanged } },
  });
  vi.mocked(loadSettings).mockResolvedValue(currentSettings);
  await import('../../src/background');
  await vi.waitFor(() => expect(initialFocus ? getLastFocused : getContexts).toHaveBeenCalled());
  const settingsListener = vi.mocked(watchSettings).mock.calls[0]?.[0];
  const storageListener = onStorageChanged.mock.calls[0]?.[0];
  const focusListener = onFocusChanged.mock.calls[0]?.[0];
  if (!settingsListener || !storageListener || !focusListener) throw new Error('listeners were not registered');
  return {
    getContexts,
    createDocument,
    sendMessage,
    getLastFocused,
    onFocusChanged,
    requestFocus(
      sender: chrome.runtime.MessageSender = {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/offscreen.html',
      },
    ) {
      const respond = vi.fn();
      const listener = onMessage.mock.calls[0]?.[0];
      if (!listener) throw new Error('Missing worker listener');
      listener({ type: 'watch-focus' }, sender, respond);
      return respond;
    },
    changeFocus(nextFocused: boolean, windowId = 1, queriedFocus = nextFocused) {
      getLastFocused.mockResolvedValue({ id: windowId, focused: queriedFocus });
      focusListener(nextFocused ? windowId : -1);
    },
    changeSettings(next: Partial<Settings>) {
      storageListener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'local');
      currentSettings = { ...currentSettings, ...next };
      vi.mocked(loadSettings).mockResolvedValue(currentSettings);
      settingsListener(currentSettings);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it('applies mode changes, disables polling, and resumes without creating a second document', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
    }),
  );
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'strip', focused: true } }),
  );
  worker.changeSettings({ enabled: false });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: null }));
  worker.sendMessage.mockClear();
  worker.changeSettings({ enabled: true });
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'strip', focused: true } }),
  );
  expect(worker.createDocument).toHaveBeenCalledOnce();
});

it('does not create a clipboard document while disabled', async () => {
  const worker = await startBackground();
  expect(worker.createDocument).not.toHaveBeenCalled();
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it('starts suspended while Chrome is unfocused and configures polling on focus regain', async () => {
  const worker = await startBackground({ enabled: true }, false);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: false },
    }),
  );
  worker.sendMessage.mockClear();
  worker.changeFocus(true);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
    }),
  );
  expect(worker.createDocument).toHaveBeenCalledOnce();
});

it('flushes on focus loss and resumes without an artificial suspension', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.changeFocus(false);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: false },
    }),
  );
  worker.sendMessage.mockClear();
  worker.changeFocus(true);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
    }),
  );
  expect(worker.sendMessage).not.toHaveBeenCalledWith({ type: 'watch-config', config: null });
  expect(worker.onFocusChanged).toHaveBeenCalledWith(expect.any(Function), {
    windowTypes: ['normal', 'popup', 'devtools'],
  });
});

it('queries actual focus on each request without rereading settings or blocking on lifecycle work', async () => {
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
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeFocus(false);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'strip', focused: false },
    }),
  );
  const response = worker.requestFocus();
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(vi.mocked(loadSettings)).toHaveBeenCalledOnce();
  release();
});

it('keeps polling through a menu NONE event when the window remains focused', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.changeFocus(false, 1, true);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
    }),
  );
  // A real blur after the menu may have no new event, so the next poll must query it.
  worker.getLastFocused.mockResolvedValue({ id: 1, focused: false });
  const response = worker.requestFocus();
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(worker.sendMessage).toHaveBeenLastCalledWith({
    type: 'watch-config',
    config: { mode: 'hybrid', focused: false },
  });
  expect(vi.mocked(loadSettings)).toHaveBeenCalledOnce();
});

it('rejects a focus request from an extension tab', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  expect(
    worker.requestFocus({
      id: 'extension-id',
      url: 'chrome-extension://extension-id/offscreen.html',
      tab: { id: 7 } as chrome.tabs.Tab,
    }),
  ).toHaveBeenCalledWith({ ok: false });
  expect(worker.sendMessage).not.toHaveBeenCalled();
});

it.each([true, false])('ignores a late startup query after a focus event reports %s', async (focused) => {
  let release!: () => void;
  const initialFocus = new Promise<{ id: number; focused: boolean }>((resolve) => {
    release = () => resolve({ id: 1, focused: !focused });
  });
  const worker = await startBackground({ enabled: true }, !focused, initialFocus);
  worker.changeFocus(focused);
  release();
  worker.changeSettings({ mode: 'strip' });
  const config = { mode: 'strip', focused };
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config }));
  expect(worker.sendMessage).not.toHaveBeenCalledWith({
    type: 'watch-config',
    config: { mode: 'strip', focused: !focused },
  });
  expect(worker.getLastFocused.mock.calls.length).toBeGreaterThan(1);
});

it('discards an old mode configuration when settings change during offscreen lookup', async () => {
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
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeSettings({ mode: 'silly' });
  release();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'silly', focused: true } }),
  );
  expect(worker.sendMessage).toHaveBeenCalledOnce();
});

it('rejects a stale configuration after focus changes during offscreen lookup', async () => {
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
  worker.changeSettings({ mode: 'strip' });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeFocus(false);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'strip', focused: false },
    }),
  );
  worker.changeFocus(true);
  release();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-config', config: { mode: 'strip', focused: true } }),
  );
  expect(worker.sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'watch-config', config: { mode: 'strip', focused: false } },
    { type: 'watch-config', config: { mode: 'strip', focused: true } },
  ]);
});

it('discards a pending disable when cleaning resumes during offscreen lookup', async () => {
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
  worker.changeSettings({ enabled: false });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeSettings({ enabled: true });
  release();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
    }),
  );
  expect(worker.sendMessage).toHaveBeenCalledOnce();
});
