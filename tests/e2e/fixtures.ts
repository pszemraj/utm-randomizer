import path from 'node:path';
import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { startPlayground } from '../../scripts/playground.mjs';

interface Playground {
  origin: string;
  close: () => Promise<void>;
}

export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  playground: Page;
  readClipboard: () => Promise<string>;
  /** Writes the clipboard from outside the page, like the browser's own "Copy link address". */
  writeClipboardExternally: (text: string) => Promise<void>;
  setSettings: (settings: Record<string, unknown>) => Promise<void>;
}

export interface ExtensionOptions {
  blinkFeature: string;
}

const EXTENSION_PATH = path.resolve('dist');

export const test = base.extend<ExtensionFixtures & ExtensionOptions, { server: Playground }>({
  blinkFeature: ['', { option: true }],

  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
    async ({}, use) => {
      const server = (await startPlayground()) as Playground;
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
    // Read through an extension page, which may paste thanks to the clipboardRead permission.
    const reader = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/offscreen.html`);
    await playground.bringToFront();
    await use(() =>
      reader.evaluate(() => {
        const field = document.querySelector('textarea');
        if (!field) {
          throw new Error('offscreen.html has no textarea');
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
    const writer = await context.newPage();
    await writer.goto(`chrome-extension://${extensionId}/offscreen.html`);
    await playground.bringToFront();
    await use(async (text) => {
      await writer.evaluate((value) => {
        const field = document.querySelector('textarea');
        if (!field) {
          throw new Error('offscreen.html has no textarea');
        }
        field.value = value;
        field.select();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- copying from a script needs execCommand here
        document.execCommand('copy');
      }, text);
    });
    await writer.close();
  },

  setSettings: async ({ serviceWorker }, use) => {
    await use(async (settings) => {
      await serviceWorker.evaluate((values) => chrome.storage.local.set(values), settings);
    });
  },
});

export const expect = test.expect;
