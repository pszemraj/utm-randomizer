import { defineConfig } from '@playwright/test';
import type { ExtensionOptions } from './tests/e2e/fixtures';

// Exercise native clipboard events and the polling fallback in the same Chromium version.
export default defineConfig<ExtensionOptions>({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  projects: [
    { name: 'clipboardchange', use: { clipboardChange: true } },
    { name: 'legacy-polling', use: { clipboardChange: false } },
  ],
});
