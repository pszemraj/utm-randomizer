import { expect, test } from './fixtures';

const ARTICLE =
  'https://example.com/article?id=42&utm_source=newsletter&utm_medium=email&utm_campaign=spring&fbclid=IwAR3xyz';

/**
 * Polls the clipboard until `accept` holds for its text and returns that text. Empty text is never
 * accepted: the clipboard starts empty, and a check like "no longer contains the original" must not
 * pass before the page has written anything.
 */
async function waitForClipboard(read: () => Promise<string>, accept: (text: string) => boolean): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        text = await read();
        return text !== '' && accept(text);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return text;
}

/** Asserts that `copied` has the same parameters as `original` with at least one tracking value replaced. */
function expectReplaced(copied: string, original: string): void {
  const before = new URL(original).searchParams;
  const after = new URL(copied).searchParams;
  expect([...after.keys()]).toEqual([...before.keys()]);
  let changed = 0;
  for (const [key, value] of before) {
    if (after.get(key) !== value) {
      changed += 1;
    }
  }
  expect(changed).toBeGreaterThan(0);
}

/** Reads the clipboard several times over `ms` and asserts it never changes (no watcher ping-pong). */
async function expectStable(read: () => Promise<string>, ms: number): Promise<string> {
  const first = await read();
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await read()).toBe(first);
  }
  return first;
}

test.describe('copying on web pages', () => {
  test('rewrites links copied with navigator.clipboard.writeText', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-writetext').click();
    const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    expectReplaced(copied, ARTICLE);
    expect(new URL(copied).searchParams.get('id')).toBe('42');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking swapped for decoys');
  });

  test('keeps the rewritten link stable: watchers never fight over it', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-writetext').click();
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    expect(await expectStable(readClipboard, 3000)).not.toBe(ARTICLE);
  });

  test('rewrites links copied with execCommand', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-execcommand').click();
    const original = 'https://shop.example/p/123?gclid=Cj0KCQjw&utm_source=google&utm_medium=cpc';
    expectReplaced(await waitForClipboard(readClipboard, (text) => !text.includes('gclid=Cj0KCQjw')), original);
  });

  test('rewrites clipboard data set by page copy handlers', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-setdata').click();
    const copied = await waitForClipboard(readClipboard, (text) => !text.includes('mc_eid=def456'));
    expect(copied).toMatch(/^https:\/\/example\.com\/post\?ref=share&mc_cid=[^&]+&mc_eid=[0-9a-f]{6}&keep=yes$/);
  });

  test('rewrites links written after an async delay', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-delayed').click();
    const copied = await waitForClipboard(readClipboard, (text) => text.startsWith('https://youtu.be/'));
    // Decoy identifiers keep the original's format: prefix, case pattern, and length.
    expect(copied).toMatch(/^https:\/\/youtu\.be\/dQw4w9WgXcQ\?si=AbCd[A-Z][a-z][0-9]{6}$/);
    expect(copied).not.toContain('AbCdEf123456');
  });

  test('rewrites a selected link copied with the keyboard', async ({ playground, readClipboard }) => {
    const code = playground.getByTestId('select-code');
    await code.click({ clickCount: 3 });
    await playground.keyboard.press('ControlOrMeta+C');
    const copied = await waitForClipboard(readClipboard, (text) => !text.includes('msclkid=abc123def'));
    // Triple-click selects the whole block, including its line break; whitespace is preserved.
    expect(copied.trim()).toMatch(/^https:\/\/example\.com\/deal\?id=9&utm_source=[^&]+&msclkid=[0-9a-f]{9}$/);
  });

  test('rewrites links inside text copied from a text area', async ({ playground, readClipboard, setSettings }) => {
    await setSettings({ mode: 'strip' });
    const textarea = playground.getByTestId('select-textarea');
    await textarea.focus();
    await textarea.press('ControlOrMeta+A');
    await textarea.press('ControlOrMeta+C');
    await expect.poll(readClipboard).toBe('Notes: https://example.com/a?id=1 and https://example.com/b?id=2.');
  });

  test('removes tracking entirely in Remove mode', async ({ playground, readClipboard, setSettings }) => {
    await setSettings({ mode: 'strip' });
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking removed');
  });

  test('uses obvious nonsense in Silly mode', async ({ playground, readClipboard, setSettings }) => {
    await setSettings({ mode: 'silly' });
    await playground.getByTestId('copy-writetext').click();
    const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    expect(new URL(copied).searchParams.get('utm_source')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
  });

  test('mixes decoys and nonsense in Hybrid mode', async ({ playground, readClipboard, setSettings }) => {
    await setSettings({ mode: 'hybrid' });
    await playground.getByTestId('copy-writetext').click();
    const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    expect(new URL(copied).searchParams.get('id')).toBe('42');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking swapped for decoys and nonsense');
    expect(await expectStable(readClipboard, 2000)).toBe(copied);
  });

  test('leaves functional links untouched', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-functional-youtube').click();
    await playground.waitForTimeout(2000);
    expect(await readClipboard()).toBe('https://www.youtube.com/results?search_query=lofi+beats');
    await expect(playground.locator('utm-randomizer-toast')).toHaveCount(0);
  });

  test('does nothing while paused', async ({ playground, readClipboard, setSettings, waitForWatcher }) => {
    await setSettings({ enabled: false });
    await waitForWatcher(false);
    await playground.getByTestId('copy-writetext').click();
    await playground.waitForTimeout(2000);
    expect(await readClipboard()).toBe(ARTICLE);
  });

  test('Undo restores the original link, and it stays restored', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-writetext').click();
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    await playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(readClipboard).toBe(ARTICLE);
    // Neither the page nor the background watcher may rewrite it again.
    expect(await expectStable(readClipboard, 3000)).toBe(ARTICLE);
  });

  test('counts each rewrite once', async ({ playground, readClipboard, serviceWorker }) => {
    await playground.getByTestId('copy-writetext').click();
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    await playground.waitForTimeout(2000);
    expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('totalCount')).totalCount)).toBe(1);
    expect(
      await serviceWorker.evaluate(async () => (await chrome.storage.session.get('sessionCount')).sessionCount),
    ).toBe(1);
  });

  test('rewrites a link the browser copied after a right-click (Copy link address)', async ({
    playground,
    readClipboard,
    writeClipboardExternally,
  }) => {
    const link = playground.getByTestId('link-utm');
    const href = await link.getAttribute('href');
    await link.click({ button: 'right' });
    await writeClipboardExternally(href ?? '');
    expectReplaced(await waitForClipboard(readClipboard, (text) => !text.includes('utm_source=facebook')), href ?? '');
  });

  test('rewrites links copied inside iframes and shows the toast on the page', async ({
    playground,
    readClipboard,
  }) => {
    await playground.frameLocator('[data-testid="frame"]').getByRole('button', { name: 'Copy embedded link' }).click();
    const copied = await waitForClipboard(readClipboard, (text) => !text.includes('utm_source=iframe'));
    expect(copied).toMatch(/^https:\/\/example\.com\/embed\?utm_source=[^&]+&v=3$/);
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking swapped for decoys');
  });
});

test.describe('copying anywhere else (whole-clipboard watcher)', () => {
  const OUTSIDE =
    'https://example.com/story?id=11&utm_source=twitter&utm_medium=social&gclid=Cj0KCQjw9-KzBhDVARIsAF_BwE';

  test('rewrites links copied outside any page, such as from the address bar or another app', async ({
    playground,
    readClipboard,
    writeClipboardExternally,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    // No interaction with the page: only the background watcher can catch this.
    await writeClipboardExternally(OUTSIDE);
    const copied = await waitForClipboard(readClipboard, (text) => text !== OUTSIDE);
    expectReplaced(copied, OUTSIDE);
    const gclid = new URL(copied).searchParams.get('gclid') ?? '';
    const originalGclid = new URL(OUTSIDE).searchParams.get('gclid') ?? '';
    expect(gclid).toHaveLength(originalGclid.length);
    expect(gclid.slice(0, 4)).toBe('Cj0K');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking swapped for decoys');
    expect(await expectStable(readClipboard, 2000)).toBe(copied);
  });

  test('leaves text and links without tracking alone', async ({
    readClipboard,
    writeClipboardExternally,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    for (const text of ['hello world?', 'https://example.com/?id=1&page=2', 'https://maps.google.com/?cid=123']) {
      await writeClipboardExternally(text);
      expect(await expectStable(readClipboard, 1500)).toBe(text);
    }
  });

  test('can be switched off', async ({ readClipboard, setSettings, writeClipboardExternally, waitForWatcher }) => {
    await setSettings({ watchClipboard: false });
    await waitForWatcher(false);
    await writeClipboardExternally(OUTSIDE);
    expect(await expectStable(readClipboard, 2000)).toBe(OUTSIDE);
  });
});

test.describe('address bar', () => {
  test('swaps tracking in the address bar for decoys once the page has loaded', async ({ playground }) => {
    await playground.getByTestId('open-tracked').click();
    await expect.poll(() => playground.url()).not.toContain('fbclid=IwAR3xYz123AbC456dEf789');
    const url = new URL(playground.url());
    expect(url.searchParams.get('id')).toBe('5');
    expect([...url.searchParams.keys()]).toEqual(['id', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid']);
    // Cleaning again (for example after settings change) leaves the decoys in place.
    await playground.waitForTimeout(1000);
    expect(playground.url()).toBe(url.href);
  });

  test('removes tracking from the address bar in Remove mode, including after in-page navigation', async ({
    playground,
    setSettings,
    server,
  }) => {
    await setSettings({ mode: 'strip' });
    await playground.getByTestId('open-tracked').click();
    await expect.poll(() => playground.url()).toBe(`${server.origin}/?id=5`);

    await playground.getByTestId('push-tracked').click();
    await expect.poll(() => playground.url()).toBe(`${server.origin}/?page=2`);
  });

  test('can be switched off', async ({ playground, setSettings }) => {
    await setSettings({ cleanAddressBar: false });
    await playground.getByTestId('open-tracked').click();
    await playground.waitForTimeout(1500);
    expect(playground.url()).toContain('fbclid=IwAR3xYz123AbC456dEf789');
  });
});

test.describe('extension pages', () => {
  test('popup shows and saves settings', async ({ context, extensionId, serviceWorker }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'UTM Randomizer' })).toBeVisible();
    await expect(popup.getByRole('switch', { name: /Clean links automatically/ })).toBeChecked();
    await expect(popup.getByRole('switch', { name: /Clean the address bar/ })).toBeChecked();
    await expect(popup.getByRole('switch', { name: /Watch the whole clipboard/ })).toBeChecked();
    await expect(popup.getByRole('radio', { name: 'Decoy' })).toBeChecked();
    await expect(popup.getByRole('radio', { name: 'Hybrid' })).not.toBeChecked();

    await popup.getByText('Remove', { exact: true }).click();
    await popup.getByRole('switch', { name: /Show notifications/ }).uncheck();
    await popup.getByRole('switch', { name: /Watch the whole clipboard/ }).uncheck();
    await expect
      .poll(() => serviceWorker.evaluate(() => chrome.storage.local.get(['mode', 'notify', 'watchClipboard'])))
      .toEqual({ mode: 'strip', notify: false, watchClipboard: false });
    await expect(popup.getByText('Deletes tracking parameters from the link')).toBeVisible();
  });

  test('offscreen document writes to the clipboard for the context menu and shortcut', async ({
    serviceWorker,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    const response: unknown = await serviceWorker.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'offscreen-copy', text: 'https://example.com/clean' }),
    );
    expect(response).toEqual({ ok: true });
    expect(await readClipboard()).toBe('https://example.com/clean');
  });

  test('registers the context menu entries and the shortcut', async ({ serviceWorker }) => {
    const commands = await serviceWorker.evaluate(() => chrome.commands.getAll());
    expect(commands.map((command) => command.name)).toContain('copy-clean-page-url');
    // contextMenus has no getter, but updating an entry fails when it does not exist.
    const menuExists = (id: string) =>
      serviceWorker.evaluate(
        (menuId) =>
          chrome.contextMenus.update(menuId, {}).then(
            () => true,
            () => false,
          ),
        id,
      );
    await expect.poll(() => menuExists('copy-clean-link')).toBe(true);
    await expect.poll(() => menuExists('copy-clean-page')).toBe(true);
    expect(await menuExists('not-a-menu')).toBe(false);
  });
});
