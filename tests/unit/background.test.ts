import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, watchSettings } from '../../src/lib/settings';

vi.mock('../../src/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/settings')>()),
  loadSettings: vi.fn(),
  watchSettings: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it('synchronizes the clipboard watcher with callback-only context menu updates', async () => {
  const getContexts = vi.fn().mockResolvedValue([]);
  const closeDocument = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn((_id: string, _properties: object, callback?: () => void) => {
    callback?.();
  });
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: { message: 'Menu not created yet' },
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getContexts,
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    contextMenus: { update, onClicked: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    offscreen: { closeDocument },
  });
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false });

  await import('../../src/background');
  await vi.waitFor(() => expect(getContexts).toHaveBeenCalledOnce());
  getContexts.mockResolvedValue([{}]);
  const listener = vi.mocked(watchSettings).mock.calls[0]?.[0];
  if (!listener) throw new Error('settings listener not registered');
  listener({ ...DEFAULT_SETTINGS, enabled: false });

  await vi.waitFor(() => expect(closeDocument).toHaveBeenCalledOnce());
  expect(update).toHaveBeenCalledTimes(2);
});
