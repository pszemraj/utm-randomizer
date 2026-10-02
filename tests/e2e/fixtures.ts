import path from 'node:path';
import {
  chromium,
  expect as baseExpect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { startPlayground } from '../../scripts/playground.mjs';

/** The local server that hosts tests/fixtures/playground.html. */
interface Playground {
  /** Base URL, e.g. `http://127.0.0.1:41234`. */
  origin: string;
  /** Stops the server. */
  close: () => Promise<void>;
}

/** Fixtures available to every end-to-end test. */
export interface ExtensionFixtures {
  /** Persistent Chromium context with the built extension from dist/ loaded. */
  context: BrowserContext;
  /** The extension's service worker. */
  serviceWorker: Worker;
  /** The extension's generated id, for chrome-extension:// URLs. */
  extensionId: string;
  /** The playground page, loaded and in front. */
  playground: Page;
  /** Current clipboard text, read through an extension page. */
  readClipboard: () => Promise<string>;
  /** Writes the clipboard from outside the page, like the browser's own "Copy link address" or another app. */
  writeClipboardExternally: (text: string) => Promise<void>;
  /** Waits for watcher settings and the shared clipboard document's lifecycle to settle. */
  waitForWatcher: (running: boolean) => Promise<void>;
  /** Writes extension settings (see `src/lib/settings.ts`) straight to storage. */
  setSettings: (settings: Record<string, unknown>) => Promise<void>;
}

/** Per-project options set in playwright.config.ts. */
export interface ExtensionOptions {
  /** Extra Chromium flag, used to switch the `clipboardchange` event on or off. */
  blinkFeature: string;
}

const EXTENSION_PATH = path.resolve('dist');

/** Opens an extension page with a textarea for reading and writing the clipboard in tests. */
async function extensionPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(() => {
    const field = document.createElement('textarea');
    field.id = 'test-clipboard';
    document.body.append(field);
  });
  return page;
}

/** Playwright `test` with the extension fixtures. */
export const test = base.extend<ExtensionFixtures & ExtensionOptions, { server: Playground }>({
  blinkFeature: ['', { option: true }],

  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
    async ({}, use) => {
      const server = await startPlayground();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  context: async ({ blinkFeature }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Set CHROMIUM_PATH to reuse an installed Chromium instead of Playwright's download.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        ...(blinkFeature ? [blinkFeature] : []),
      ],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  playground: async ({ context, server }, use) => {
    // No clipboard permission is granted to the page: the content script must get by with the
    // extension's own clipboardRead/clipboardWrite permissions, as in a normal browser profile.
    const page = await context.newPage();
    await page.goto(`${server.origin}/`);
    await use(page);
  },

  readClipboard: async ({ context, extensionId, playground }, use) => {
    // Read through an extension page, which may paste thanks to the clipboardRead permission. (Not
    // offscreen.html: loaded in a tab it would start a second clipboard watcher.)
    const reader = await extensionPage(context, extensionId);
    await playground.bringToFront();
    await use(() =>
      reader.evaluate(() => {
        const field = document.querySelector<HTMLTextAreaElement>('#test-clipboard');
        if (!field) {
          throw new Error('test textarea is missing');
        }
        field.value = '';
        field.focus();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- pasting is only scriptable via execCommand
        document.execCommand('paste');
        return field.value;
      }),
    );
    await reader.close();
  },

  writeClipboardExternally: async ({ context, extensionId, playground }, use) => {
    const writer = await extensionPage(context, extensionId);
    await playground.bringToFront();
    await use(async (text) => {
      await writer.evaluate((value) => {
        const field = document.querySelector<HTMLTextAreaElement>('#test-clipboard');
        if (!field) {
          throw new Error('test textarea is missing');
        }
        field.value = value;
        field.select();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- copying from a script needs execCommand here
        document.execCommand('copy');
      }, text);
    });
    await writer.close();
  },

  waitForWatcher: async ({ serviceWorker }, use) => {
    await use(async (running) => {
      await baseExpect
        .poll(
          () =>
            serviceWorker
              .evaluate(async () => {
                const contexts = await chrome.runtime.getContexts({
                  contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
                });
                const settings = await chrome.storage.local.get(['enabled', 'watchClipboard']);
                return {
                  document: contexts.length > 0,
                  watching: settings.enabled !== false && settings.watchClipboard !== false,
                  enabled: settings.enabled !== false,
                };
              })
              .then((state) => state.watching === running && state.document === state.enabled),
          { timeout: 10_000 },
        )
        .toBe(true);
      // Let a freshly started watcher take its baseline reading of the clipboard.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
  },

  setSettings: async ({ serviceWorker }, use) => {
    await use(async (settings) => {
      await serviceWorker.evaluate((values) => chrome.storage.local.set(values), settings);
    });
  },
});

/** Playwright `expect`, re-exported for convenience. */
export const expect = test.expect;
