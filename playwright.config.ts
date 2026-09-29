import { defineConfig } from '@playwright/test';
import type { ExtensionOptions } from './tests/e2e/fixtures';

// Two runs: one with the `clipboardchange` event (Chrome 144+ behavior) and one without it (older Chrome).
export default defineConfig<ExtensionOptions>({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  projects: [
    { name: 'clipboardchange', use: { blinkFeature: '--enable-blink-features=ClipboardChangeEvent' } },
    { name: 'legacy-polling', use: { blinkFeature: '--disable-blink-features=ClipboardChangeEvent' } },
  ],
});
