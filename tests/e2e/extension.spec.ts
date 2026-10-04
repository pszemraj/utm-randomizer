import { expect, test } from './fixtures';

const ARTICLE =
  'https://example.com/article?id=42&utm_source=newsletter&utm_medium=email&utm_campaign=spring&fbclid=IwAR3xyz';
const CLEAN = 'https://example.com/article?id=42';
const BASELINE = 'test clipboard baseline';

test.beforeEach(async ({ writeClipboardExternally, waitForWatcher }) => {
  await writeClipboardExternally(BASELINE);
  await waitForWatcher(true);
});

/** Waits for a nonempty clipboard value satisfying the expected outcome. */
async function waitForClipboard(read: () => Promise<string>, accept: (text: string) => boolean): Promise<string> {
  let text = '';
  await expect
    .poll(
      async () => {
        text = await read();
        return text !== '' && text !== BASELINE && accept(text);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return text;
}

/** Checks that observations, settings changes, and focus do not repeatedly rewrite an entry. */
async function expectStable(read: () => Promise<string>, ms = 800): Promise<string> {
  const first = await read();
  for (let elapsed = 0; elapsed < ms; elapsed += 200) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await read()).toBe(first);
  }
  return first;
}

test.describe('native clipboard processing', () => {
  test('draws fresh replacements for repeated page writeText copies', async ({
    playground,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    const outputs = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      await playground.getByTestId('copy-writetext').click();
      const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE && !outputs.has(text));
      const url = new URL(copied);
      expect(url.searchParams.get('id')).toBe('42');
      expect(url.searchParams.get('utm_source')).not.toBe('newsletter');
      outputs.add(copied);
    }
    expect(outputs.size).toBe(4);
    expect(outputs.has(await expectStable(readClipboard))).toBe(true);
  });

  for (const mode of ['strip', 'silly', 'hybrid'] as const) {
    test(`applies ${mode} to an entire copied URL`, async ({
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode });
      await waitForWatcher(true);
      await playground.getByTestId('copy-writetext').click();
      const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
      expect(new URL(copied).searchParams.get('id')).toBe('42');
      if (mode === 'strip') expect(copied).toBe(CLEAN);
      if (mode === 'silly')
        expect(new URL(copied).searchParams.get('utm_source')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
    });
  }

  for (const action of ['copy', 'cut'] as const) {
    test(`cleans keyboard ${action} while preserving native text-field behavior`, async ({
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode: 'strip' });
      await waitForWatcher(true);
      const field = playground.getByTestId('select-textarea');
      await field.fill(ARTICLE);
      await field.press('ControlOrMeta+A');
      await field.press(action === 'copy' ? 'ControlOrMeta+C' : 'ControlOrMeta+X');
      await expect.poll(readClipboard).toBe(CLEAN);
      await expect(field).toHaveValue(action === 'copy' ? ARTICLE : '');
    });
  }

  for (const button of ['copy-execcommand', 'copy-setdata', 'copy-delayed']) {
    test(`cleans the native clipboard from ${button}`, async ({ playground, readClipboard, waitForWatcher }) => {
      await waitForWatcher(true);
      const control = playground.getByTestId(button);
      const original = await control.evaluate((element) => element.closest<HTMLElement>('[data-url]')?.dataset.url);
      if (!original) throw new Error('Missing fixture URL');
      await control.click();
      const copied = await waitForClipboard(readClipboard, (text) => text !== original);
      expect(new URL(copied).pathname).toBe(new URL(original).pathname);
    });
  }

  test('processes a URL with the extension tab active and no webpage reader', async ({
    context,
    extensionId,
    writeClipboardExternally,
    readClipboard,
    waitForWatcher,
    setSettings,
  }) => {
    await setSettings({ mode: 'strip' });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await waitForWatcher(true);
    await writeClipboardExternally(ARTICLE);
    await expect.poll(readClipboard).toBe(CLEAN);
    await page.close();
  });

  test('processes copies on insecure HTTP without a webpage Clipboard API', async ({
    playground,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    const response = await playground.request.get(playground.url());
    await playground.route('http://insecure.test/**', (route) => route.fulfill({ response }));
    await playground.goto('http://insecure.test/');
    expect(await playground.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await playground.evaluate(() => typeof navigator.clipboard)).toBe('undefined');
    await setSettings({ mode: 'strip' });
    await waitForWatcher(true);
    const field = playground.getByTestId('select-textarea');
    await field.fill(ARTICLE);
    await field.press('ControlOrMeta+A');
    await field.press('ControlOrMeta+C');
    await expect.poll(readClipboard).toBe(CLEAN);
  });

  test('preserves unrelated text, multiple URLs, labels, relative and signed links', async ({
    writeClipboardExternally,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    for (const text of [
      'ordinary document text',
      `Read ${ARTICLE} today`,
      `${ARTICLE}\n${ARTICLE}`,
      `${ARTICLE} https://example.org/?utm_source=other`,
      '/article?utm_source=newsletter',
      'https://example.com/?id=42&si=abc',
      'https://example.com/?utm_source=email&X-Amz-Signature=abc&X-Amz-Algorithm=AWS4-HMAC-SHA256',
    ]) {
      await writeClipboardExternally(text);
      expect(await expectStable(readClipboard, 500)).toBe(text);
    }
  });

  test('trims surrounding whitespace and writes a rewritten URL as plain text', async ({
    writeClipboardExternally,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip' });
    await waitForWatcher(true);
    await writeClipboardExternally(` \n\t${ARTICLE}\n `);
    await expect.poll(readClipboard).toBe(CLEAN);
  });

  test('keeps output stable and expires its record after unrelated contents', async ({
    playground,
    writeClipboardExternally,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    await playground.getByTestId('copy-writetext').click();
    const first = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    await playground.locator('h1').click();
    await playground.keyboard.press('a');
    await setSettings({ mode: 'hybrid' });
    expect(await expectStable(readClipboard)).toBe(first);
    await writeClipboardExternally('unrelated contents');
    expect(await expectStable(readClipboard, 500)).toBe('unrelated contents');
    await writeClipboardExternally(first);
    const second = await waitForClipboard(readClipboard, (text) => text !== first && text !== 'unrelated contents');
    expect(new URL(second).searchParams.get('id')).toBe('42');
    expect(await expectStable(readClipboard)).toBe(second);
  });

  test('counts each rewritten clipboard URL once', async ({
    playground,
    readClipboard,
    serviceWorker,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    await playground.getByTestId('copy-writetext').click();
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    await expectStable(readClipboard);
    expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('totalCount')).totalCount)).toBe(1);
    expect(
      await serviceWorker.evaluate(async () => (await chrome.storage.session.get('sessionCount')).sessionCount),
    ).toBe(1);
  });

  test('preserves percent-encoded identifier and functional bytes', async ({
    writeClipboardExternally,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    const id = '0123456789abcdef0123456789abcdef';
    const encoded = id.replace(/./g, (char) => `%${char.charCodeAt(0).toString(16)}`);
    const original = `https://example.com/?msclkid=${encoded}&keep=%2F`;
    await writeClipboardExternally(original);
    const copied = await waitForClipboard(readClipboard, (text) => text !== original);
    expect(copied).toMatch(/^https:\/\/example\.com\/\?msclkid=(?:%[0-9a-fA-F]{2}){32}&keep=%2F$/);
    expect(new URL(copied).searchParams.get('msclkid')).not.toBe(id);
  });

  test('does nothing while paused and baselines existing contents on resume', async ({
    playground,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ enabled: false });
    await waitForWatcher(false);
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).toBe(ARTICLE);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
    await setSettings({ enabled: true });
    await waitForWatcher(true);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
  });
});

test.describe('clipboard formats', () => {
  for (const text of [ARTICLE, 'A product']) {
    test(`whole URL classification controls HTML and hidden metadata (${text === ARTICLE ? 'URL' : 'label'})`, async ({
      context,
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(playground.url()).origin,
      });
      await setSettings({ mode: 'strip' });
      await waitForWatcher(true);
      for (const extra of ['text/html', 'web application/x-test']) {
        await playground.evaluate(
          async ({ value, type }) => {
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': new Blob([value], { type: 'text/plain' }),
                [type]: new Blob(
                  [type === 'text/html' ? '<a href="https://example.com/?utm_source=real">A product</a>' : 'metadata'],
                  { type },
                ),
              }),
            ]);
          },
          { value: text, type: extra },
        );
        if (text === ARTICLE) await expect.poll(readClipboard).toBe(CLEAN);
        else expect(await expectStable(readClipboard, 500)).toBe(text);
        const types = await playground.evaluate(async () => (await navigator.clipboard.read())[0]?.types);
        if (text === ARTICLE) expect(types).toEqual(['text/plain']);
        else {
          expect(types).toContain(extra);
          const payload = await playground.evaluate(async (type) => {
            const [item] = await navigator.clipboard.read();
            return item ? (await item.getType(type)).text() : '';
          }, extra);
          expect(payload).toBe(
            extra === 'text/html' ? '<a href="https://example.com/?utm_source=real">A product</a>' : 'metadata',
          );
        }
      }
    });
  }

  test('leaves detected custom clipboard formats unchanged', async ({ playground, readClipboard, waitForWatcher }) => {
    await waitForWatcher(true);
    await playground.evaluate((text) => {
      document.addEventListener(
        'copy',
        (event) => {
          event.preventDefault();
          event.clipboardData?.setData('text/plain', text);
          event.clipboardData?.setData('application/x-test', 'metadata');
        },
        { once: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- real native legacy copy
      document.execCommand('copy');
    }, ARTICLE);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
  });

  test('leaves image plus URL clipboard data unchanged', async ({
    context,
    playground,
    readClipboard,
    waitForWatcher,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(playground.url()).origin });
    await waitForWatcher(true);
    await playground.evaluate(async (text) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const png = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
        }, 'image/png'),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'image/png': png }),
      ]);
    }, ARTICLE);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
    expect(await playground.evaluate(async () => (await navigator.clipboard.read())[0]?.types)).toContain('image/png');
  });
});

test.describe('focus and navigation', () => {
  test('ignores copies while minimized and keeps the return-focus baseline through paste and navigation', async ({
    playground,
    serviceWorker,
    writeClipboardExternally,
    readClipboard,
    waitForWatcher,
    server,
  }) => {
    test.skip(
      !process.env.HEADED,
      'Headless Chromium changes window state without dispatching native focus events; run HEADED=1 for this control.',
    );
    await waitForWatcher(true);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing browser window');
      await chrome.windows.update(current.id, { state: 'minimized' });
    });
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.windows.getLastFocused()).focused))
      .toBe(false);
    // Let the final focused observation finish before simulating an outside copy.
    await playground.waitForTimeout(300);
    await writeClipboardExternally(ARTICLE);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing browser window');
      await chrome.windows.update(current.id, { state: 'normal', focused: true });
    });
    await waitForWatcher(true);
    await playground.bringToFront();
    await playground.getByTestId('paste').press('ControlOrMeta+V');
    await expect(playground.getByTestId('paste')).toHaveValue(ARTICLE);
    await playground.goto(`${server.origin}/?utm_source=linkedin`);
    expect(playground.url()).toBe(`${server.origin}/?utm_source=linkedin`);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
    await writeClipboardExternally('different text');
    await expect.poll(readClipboard).toBe('different text');
    await writeClipboardExternally(ARTICLE);
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
  });

  test('flushes a fresh focused copy on blur and baselines later outside copies', async ({
    serviceWorker,
    writeClipboardExternally,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    test.skip(
      !process.env.HEADED,
      'Headless Chromium changes window state without dispatching native focus events; run HEADED=1 for this control.',
    );
    await setSettings({ mode: 'strip' });
    await waitForWatcher(true);
    await writeClipboardExternally(ARTICLE);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing window');
      await chrome.windows.update(current.id, { state: 'minimized' });
    });
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.windows.getLastFocused()).focused))
      .toBe(false);
    await expect.poll(readClipboard).toBe(CLEAN);
    const outside = 'https://example.com/outside?utm_source=other';
    await writeClipboardExternally(outside);
    expect(await expectStable(readClipboard)).toBe(outside);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing window');
      await chrome.windows.update(current.id, { state: 'normal', focused: true });
    });
    await waitForWatcher(true);
    expect(await expectStable(readClipboard)).toBe(outside);
  });

  test('retains completed processing while the service worker restarts', async ({
    context,
    extensionId,
    playground,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    await playground.getByTestId('copy-writetext').click();
    const before = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    const session = await context.newCDPSession(playground);
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    // Opening the real popup wakes its worker through the popup's count request.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'UTM Randomizer' })).toBeVisible();
    expect(await expectStable(readClipboard, 1200)).toBe(before);
    await popup.close();
    await session.detach();
  });

  test('keeps page URL and links unchanged after settings and navigation', async ({
    playground,
    server,
    setSettings,
  }) => {
    await playground.goto(`${server.origin}/?utm_source=linkedin`);
    const address = playground.url();
    const href = await playground.getByTestId('link-utm').getAttribute('href');
    for (const mode of ['strip', 'silly', 'hybrid', 'decoy']) {
      await setSettings({ mode });
      await playground.waitForTimeout(250);
      expect(playground.url()).toBe(address);
      expect(await playground.getByTestId('link-utm').getAttribute('href')).toBe(href);
    }
    await playground.getByTestId('push-tracked').click();
    expect(playground.url()).toBe(`${server.origin}/?page=2&utm_source=homepage&utm_content=promo_tile`);
  });
});

test.describe('extension controls', () => {
  test('explicit copies support generated and unchanged URLs beyond the automatic bound', async ({
    context,
    extensionId,
    readClipboard,
    setSettings,
  }) => {
    await setSettings({ enabled: false, mode: 'decoy' });
    const input = `https://example.com/?${Array<string>(6000).fill('utm_source=x').join('&')}`;
    const oversized = `https://example.com/?data=${'x'.repeat(100_001)}`;
    for (const url of [input, oversized]) {
      const popup = await context.newPage();
      // A tab-hosted popup has no toolbar invocation grant; supply only that active-tab input.
      await popup.addInitScript((pageUrl) => {
        Object.defineProperty(chrome.tabs, 'query', { value: () => Promise.resolve([{ url: pageUrl }]) });
      }, url);
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator('#copyPage').click();
      await expect(popup.locator('#copyStatus')).toContainText('Copied');
      const copied = await readClipboard();
      if (url === oversized) expect(copied).toBe(oversized);
      else {
        expect(copied.length).toBeGreaterThan(100_000);
        expect(new URL(copied).searchParams.getAll('utm_source')).toHaveLength(6000);
      }
      await popup.close();
    }
  });

  test('popup saves settings without obsolete cleaning-layer controls', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'UTM Randomizer' })).toBeVisible();
    await expect(popup.getByRole('switch', { name: /Clean links automatically/ })).toBeChecked();
    await expect(popup.getByRole('switch', { name: /Watch browser copies|Clean the address bar/ })).toHaveCount(0);
    await popup.getByText('Remove', { exact: true }).click();
    await popup.locator('#notify').uncheck();
    await expect
      .poll(() => serviceWorker.evaluate(() => chrome.storage.local.get(['mode', 'notify'])))
      .toEqual({ mode: 'strip', notify: false });
    expect(await serviceWorker.evaluate(() => chrome.runtime.getManifest().permissions)).not.toContain('notifications');
  });

  test('focus loss cancels an explicit copy already queued even after focus returns', async ({
    context,
    extensionId,
    serviceWorker,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    test.skip(
      !process.env.HEADED,
      'Headless Chromium changes window state without dispatching native focus events; run HEADED=1 for this control.',
    );
    await setSettings({ enabled: false });
    await waitForWatcher(false);
    const popup = await context.newPage();
    await popup.addInitScript((url) => {
      Object.defineProperty(chrome.tabs, 'query', { value: () => Promise.resolve([{ url }]) });
    }, ARTICLE);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await serviceWorker.evaluate(`(() => {
      const original = chrome.runtime.getContexts.bind(chrome.runtime);
      const gate = globalThis.explicitGate = { held: false };
      chrome.runtime.getContexts = async (...args) => {
        const contexts = await original(...args);
        if (!gate.held) {
          gate.held = true;
          await new Promise(resolve => { gate.release = resolve; });
        }
        return contexts;
      };
    })()`);
    await popup.locator('#copyPage').click();
    await expect.poll(() => serviceWorker.evaluate('globalThis.explicitGate.held')).toBe(true);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing window');
      await chrome.windows.update(current.id, { state: 'minimized' });
    });
    await expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.windows.getLastFocused()).focused))
      .toBe(false);
    await serviceWorker.evaluate(async () => {
      const current = await chrome.windows.getLastFocused();
      if (current.id === undefined) throw new Error('Missing window');
      await chrome.windows.update(current.id, { state: 'normal', focused: true });
    });
    await serviceWorker.evaluate('globalThis.explicitGate.release()');
    await expect(popup.locator('#copyStatus')).toHaveText('Could not write to the clipboard');
    expect(await readClipboard()).toBe(BASELINE);
    await popup.close();
  });

  test('explicit popup copy works while automatic cleaning is paused', async ({
    context,
    extensionId,
    readClipboard,
    setSettings,
  }) => {
    await setSettings({ enabled: false, mode: 'strip' });
    const popup = await context.newPage();
    await popup.addInitScript((url) => {
      Object.defineProperty(chrome.tabs, 'query', { value: () => Promise.resolve([{ url }]) });
    }, ARTICLE);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#copyPage').click();
    await expect(popup.locator('#copyStatus')).toContainText('Copied');
    expect(await readClipboard()).toBe(CLEAN);
    await popup.close();
  });

  test('popup Undo restores only the current rewritten URL', async ({
    context,
    extensionId,
    playground,
    readClipboard,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    await playground.getByTestId('copy-writetext').click();
    await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#undoClipboard').click();
    await expect.poll(readClipboard).toBe(ARTICLE);
    expect(await expectStable(readClipboard)).toBe(ARTICLE);
    await popup.close();
  });

  test('registers menu entries and the shortcut without claiming native invocation', async ({ serviceWorker }) => {
    expect((await serviceWorker.evaluate(() => chrome.commands.getAll())).map((command) => command.name)).toContain(
      'copy-clean-page-url',
    );
    for (const id of ['copy-clean-link', 'copy-clean-page']) {
      await expect
        .poll(() =>
          serviceWorker.evaluate(
            (menuId) =>
              chrome.contextMenus.update(menuId, {}).then(
                () => true,
                () => false,
              ),
            id,
          ),
        )
        .toBe(true);
    }
  });
});
