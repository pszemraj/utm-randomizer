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
  initialFocus?: Promise<{ id: number; focused: boolean }[]>,
  initialSettings?: Promise<Settings>,
) {
  let exists = false;
  let currentSettings = { ...DEFAULT_SETTINGS, enabled: false, ...settings };
  const getContexts = vi.fn(() => Promise.resolve(exists ? [{}] : []));
  const createDocument = vi.fn(() => {
    exists = true;
    return Promise.resolve();
  });
  const sendMessage = vi.fn<(message: ExtensionMessage) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
  const getAll = vi.fn().mockResolvedValue([{ id: 1, focused }]);
  if (initialFocus) getAll.mockReturnValueOnce(initialFocus);
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
  const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
  const setBadgeText = vi.fn().mockResolvedValue(undefined);
  const setTitle = vi.fn().mockResolvedValue(undefined);
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
    action: { setBadgeBackgroundColor, setBadgeText, setTitle },
    storage: { onChanged: { addListener: onStorageChanged } },
    windows: { getAll, WINDOW_ID_NONE: -1, onFocusChanged: { addListener: onFocusChanged } },
  });
  if (initialSettings) vi.mocked(loadSettings).mockReturnValueOnce(initialSettings);
  else vi.mocked(loadSettings).mockResolvedValue(currentSettings);
  await import('../../src/background');
  if (!initialSettings) await vi.waitFor(() => expect(initialFocus ? getAll : getContexts).toHaveBeenCalled());
  const settingsListener = vi.mocked(watchSettings).mock.calls[0]?.[0];
  const storageListener = onStorageChanged.mock.calls[0]?.[0];
  const focusListener = onFocusChanged.mock.calls[0]?.[0];
  if (!settingsListener || !storageListener || !focusListener) throw new Error('listeners were not registered');
  return {
    getContexts,
    createDocument,
    sendMessage,
    getAll,
    onFocusChanged,
    setBadgeBackgroundColor,
    setBadgeText,
    setTitle,
    send(
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender = {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/offscreen.html',
      },
    ) {
      const respond = vi.fn();
      const listener = onMessage.mock.calls[0]?.[0];
      if (!listener) throw new Error('Missing worker listener');
      listener(message, sender, respond);
      return respond;
    },
    requestFocus(sender?: chrome.runtime.MessageSender) {
      return this.send({ type: 'watch-focus' }, sender);
    },
    changeFocus(nextFocused: boolean, windowId = 1, queriedFocus = nextFocused) {
      getAll.mockResolvedValue([{ id: windowId, focused: queriedFocus }]);
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
      baseline: true,
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
      skipFinalTick: true,
    }),
  );
  worker.sendMessage.mockClear();
  worker.changeFocus(true);
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
      baseline: true,
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
      skipFinalTick: true,
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
  worker.getAll.mockResolvedValue([{ id: 1, focused: false }]);
  const response = worker.requestFocus();
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(worker.sendMessage).toHaveBeenLastCalledWith({
    type: 'watch-config',
    config: { mode: 'hybrid', focused: false },
  });
  expect(vi.mocked(loadSettings)).toHaveBeenCalledOnce();
});

it('forces an untouched baseline when focus returns before a blur query resolves', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  let releaseBlur!: () => void;
  worker.getAll.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseBlur = () => resolve([{ id: 1, focused: false }]);
      }),
  );
  worker.changeFocus(false);
  await vi.waitFor(() => expect(releaseBlur).toBeDefined());
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalledWith({ type: 'watch-flush' }));
  worker.changeFocus(true);
  releaseBlur();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
      baseline: true,
    }),
  );
});

it('cancels a delayed blur flush when focus returns before startup settings resolve', async () => {
  let releaseSettings!: () => void;
  const initialSettings = new Promise<Settings>((resolve) => {
    releaseSettings = () => resolve({ ...DEFAULT_SETTINGS, enabled: true });
  });
  const worker = await startBackground({ enabled: true }, true, undefined, initialSettings);
  worker.changeFocus(false);
  worker.changeFocus(true);
  releaseSettings();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'hybrid', focused: true },
      baseline: true,
    }),
  );
  expect(worker.sendMessage).not.toHaveBeenCalledWith({ type: 'watch-flush' });
});

it('treats any currently focused Chrome window as active', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.sendMessage.mockClear();
  worker.getAll.mockResolvedValue([
    { id: 1, focused: false, type: 'normal' },
    { id: 2, focused: true, type: 'devtools' },
  ]);
  const response = worker.requestFocus();
  await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ ok: true }));
  expect(worker.sendMessage).toHaveBeenLastCalledWith({
    type: 'watch-config',
    config: { mode: 'hybrid', focused: true },
  });
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

it('shows an exact Chrome-only success confirmation while focused', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  const response = worker.send({ type: 'rewrite-complete' });
  expect(response).toHaveBeenCalledWith({ ok: true });
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenCalledWith({ text: '✓' }));
  expect(worker.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#2e7d32' });
  expect(worker.setTitle).toHaveBeenCalledWith({ title: 'Your link was randomized.' });
});

it('resets Chrome-owned confirmation state whenever the worker starts', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenCalledWith({ text: '' }));
  expect(worker.setTitle).toHaveBeenCalledWith({ title: 'UTM Randomizer' });
});

it('does not show rewrite confirmation when Chrome is unfocused', async () => {
  const worker = await startBackground({ enabled: true }, false);
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.send({ type: 'rewrite-complete' });
  await vi.waitFor(() => expect(worker.getAll.mock.calls.length).toBeGreaterThan(1));
  expect(worker.setBadgeText).not.toHaveBeenCalledWith({ text: '✓' });
  expect(worker.setTitle).not.toHaveBeenCalledWith({ title: 'Your link was randomized.' });
});

it('clears a confirmation whose action update overlaps a real blur', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  let release!: () => void;
  worker.setBadgeText.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  worker.send({ type: 'rewrite-complete' });
  await vi.waitFor(() => expect(release).toBeDefined());
  worker.changeFocus(false);
  release();
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenLastCalledWith({ text: '' }));
  expect(worker.setTitle).toHaveBeenLastCalledWith({ title: 'UTM Randomizer' });
});

it('clears a visible confirmation when cleaning is disabled', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  worker.send({ type: 'rewrite-complete' });
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenCalledWith({ text: '✓' }));
  worker.changeSettings({ enabled: false });
  await vi.waitFor(() => expect(worker.setBadgeText).toHaveBeenLastCalledWith({ text: '' }));
  expect(worker.setTitle).toHaveBeenLastCalledWith({ title: 'UTM Randomizer' });
});

it('rejects rewrite confirmation from an extension tab', async () => {
  const worker = await startBackground({ enabled: true });
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
  const response = worker.send(
    { type: 'rewrite-complete' },
    { id: 'extension-id', url: 'chrome-extension://extension-id/options.html', tab: { id: 7 } as chrome.tabs.Tab },
  );
  expect(response).toHaveBeenCalledWith({ ok: false });
  expect(worker.setBadgeText).not.toHaveBeenCalledWith({ text: '✓' });
});

it.each([true, false])('ignores a late startup query after a focus event reports %s', async (focused) => {
  let release!: () => void;
  const initialFocus = new Promise<{ id: number; focused: boolean }[]>((resolve) => {
    release = () => resolve([{ id: 1, focused: !focused }]);
  });
  const worker = await startBackground({ enabled: true }, !focused, initialFocus);
  worker.changeFocus(focused);
  release();
  worker.changeSettings({ mode: 'strip' });
  const config = { mode: 'strip', focused };
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config,
      ...(focused ? { baseline: true } : {}),
    }),
  );
  expect(worker.sendMessage).not.toHaveBeenCalledWith({
    type: 'watch-config',
    config: { mode: 'strip', focused: !focused },
  });
  expect(worker.getAll.mock.calls.length).toBeGreaterThan(1);
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

it('keeps focus transitions ordered while settings sync is delayed', async () => {
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
      skipFinalTick: true,
    }),
  );
  worker.changeFocus(true);
  release();
  await vi.waitFor(() =>
    expect(worker.sendMessage).toHaveBeenCalledWith({
      type: 'watch-config',
      config: { mode: 'strip', focused: true },
      baseline: true,
    }),
  );
  expect(worker.sendMessage.mock.calls.map(([message]) => message)).toEqual([
    { type: 'watch-flush' },
    { type: 'watch-config', config: { mode: 'strip', focused: false }, skipFinalTick: true },
    { type: 'watch-config', config: { mode: 'strip', focused: true }, baseline: true },
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
