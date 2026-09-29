import { expect, test } from './fixtures';

/** Tracking parameters that must not survive with their original values. */
function expectRandomized(copied: string, original: string): void {
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

test.describe('copying on web pages', () => {
  test('rewrites links copied with navigator.clipboard.writeText', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-writetext').click();
    const original =
      'https://example.com/article?id=42&utm_source=newsletter&utm_medium=email&utm_campaign=spring&fbclid=IwAR3xyz';
    await expect.poll(readClipboard).not.toBe(original);
    const copied = await readClipboard();
    expectRandomized(copied, original);
    expect(new URL(copied).searchParams.get('id')).toBe('42');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking randomized');
  });

  test('rewrites links copied with execCommand', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-execcommand').click();
    const original = 'https://shop.example/p/123?gclid=Cj0KCQjw&utm_source=google&utm_medium=cpc';
    await expect.poll(readClipboard).not.toContain('gclid=Cj0KCQjw');
    expectRandomized(await readClipboard(), original);
  });

  test('rewrites clipboard data set by page copy handlers', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-setdata').click();
    await expect.poll(readClipboard).not.toContain('mc_eid=def456');
    const copied = await readClipboard();
    expect(copied).toMatch(/^https:\/\/example\.com\/post\?ref=share&mc_cid=[a-z0-9-]+&mc_eid=[a-z0-9-]+&keep=yes$/);
    expect(copied).not.toContain('mc_cid=abc123');
  });

  test('rewrites links written after an async delay', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-delayed').click();
    await expect.poll(readClipboard, { timeout: 8000 }).toMatch(/^https:\/\/youtu\.be\/dQw4w9WgXcQ\?si=[a-z0-9-]+$/);
    expect(await readClipboard()).not.toContain('AbCdEf123456');
  });

  test('rewrites a selected link copied with the keyboard', async ({ playground, readClipboard }) => {
    const code = playground.getByTestId('select-code');
    await code.click({ clickCount: 3 });
    await playground.keyboard.press('ControlOrMeta+C');
    await expect.poll(readClipboard).not.toContain('msclkid=abc123def');
    // Triple-click selects the whole block, including its line break; whitespace is preserved.
    const copied = (await readClipboard()).trim();
    expect(copied).toMatch(/^https:\/\/example\.com\/deal\?id=9&utm_source=[a-z0-9-]+&msclkid=[a-z0-9-]+$/);
    expect(copied).not.toContain('utm_source=bing');
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

  test('leaves functional links untouched', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-functional-youtube').click();
    await playground.waitForTimeout(1500);
    expect(await readClipboard()).toBe('https://www.youtube.com/results?search_query=lofi+beats');
    await expect(playground.locator('utm-randomizer-toast')).toHaveCount(0);
  });

  test('does nothing while paused', async ({ playground, readClipboard, setSettings }) => {
    await setSettings({ enabled: false });
    await playground.getByTestId('copy-writetext').click();
    await playground.waitForTimeout(1500);
    expect(await readClipboard()).toBe(
      'https://example.com/article?id=42&utm_source=newsletter&utm_medium=email&utm_campaign=spring&fbclid=IwAR3xyz',
    );
  });

  test('Undo restores the original link', async ({ playground, readClipboard }) => {
    const original =
      'https://example.com/article?id=42&utm_source=newsletter&utm_medium=email&utm_campaign=spring&fbclid=IwAR3xyz';
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).not.toBe(original);
    await playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(readClipboard).toBe(original);
    await playground.waitForTimeout(1000);
    expect(await readClipboard()).toBe(original);
  });

  test('counts rewrites', async ({ playground, readClipboard, serviceWorker }) => {
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).not.toContain('utm_source=newsletter');
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.storage.local.get('totalCount')).totalCount))
      .toBe(1);
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.storage.session.get('sessionCount')).sessionCount))
      .toBe(1);
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
    await expect.poll(readClipboard, { timeout: 10_000 }).not.toContain('utm_source=facebook');
    expectRandomized(await readClipboard(), href ?? '');
  });

  test('leaves clipboard changes from elsewhere alone when the page was not used', async ({
    playground,
    readClipboard,
    writeClipboardExternally,
  }) => {
    const tracked = 'https://example.com/?utm_source=elsewhere';
    await playground.waitForTimeout(200);
    await writeClipboardExternally(tracked);
    await playground.waitForTimeout(1500);
    expect(await readClipboard()).toBe(tracked);
  });

  test('rewrites links copied inside iframes and shows the toast on the page', async ({
    playground,
    readClipboard,
  }) => {
    await playground.frameLocator('[data-testid="frame"]').getByRole('button', { name: 'Copy embedded link' }).click();
    await expect.poll(readClipboard).not.toContain('utm_source=iframe');
    expect(await readClipboard()).toMatch(/^https:\/\/example\.com\/embed\?utm_source=[a-z0-9-]+&v=3$/);
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking randomized');
  });
});

test.describe('extension pages', () => {
  test('popup shows and saves settings', async ({ context, extensionId, serviceWorker }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'UTM Randomizer' })).toBeVisible();
    await expect(popup.getByRole('switch', { name: /Clean copied links/ })).toBeChecked();
    await expect(popup.getByRole('radio', { name: 'Randomize' })).toBeChecked();

    await popup.getByText('Remove', { exact: true }).click();
    await popup.getByRole('switch', { name: /Show notifications/ }).uncheck();
    await expect
      .poll(() => serviceWorker.evaluate(() => chrome.storage.local.get(['mode', 'notify'])))
      .toEqual({ mode: 'strip', notify: false });
    await expect(popup.getByText('Deletes tracking parameters from the link')).toBeVisible();
  });

  test('offscreen document writes to the clipboard for the context menu and shortcut', async ({
    serviceWorker,
    readClipboard,
  }) => {
    const response = await serviceWorker.evaluate(async () => {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: 'test',
      });
      const result: unknown = await chrome.runtime.sendMessage({
        type: 'offscreen-copy',
        text: 'https://example.com/clean',
      });
      await chrome.offscreen.closeDocument();
      return result;
    });
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
