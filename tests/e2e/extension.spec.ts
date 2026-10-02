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
  test('rejects synthetic copy and Undo without consuming the real Undo button', async ({
    playground,
    readClipboard,
    writeClipboardExternally,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await writeClipboardExternally('prior clipboard contents');
    await playground.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'https://attacker.example/invoice?utm_source=forged');
      const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
      event.preventDefault();
      document.body.dispatchEvent(event);
      document.querySelector('utm-randomizer-toast')?.shadowRoot?.querySelector<HTMLButtonElement>('.undo')?.click();
    });
    expect(await readClipboard()).toBe('prior clipboard contents');
    await expect(playground.locator('utm-randomizer-toast')).toHaveCount(0);

    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
    const undo = playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' });
    await undo.evaluate((button) => (button as HTMLButtonElement).click());
    expect(await readClipboard()).toBe('https://example.com/article?id=42');
    await expect(undo).toBeVisible();
    await undo.click();
    await expect.poll(readClipboard).toBe(ARTICLE);
  });

  for (const hover of [false, true]) {
    test(`resumes notification expiry after keyboard focus leaves${hover ? ' after hovering' : ''}`, async ({
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await playground.getByTestId('copy-writetext').click();
      await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
      const toast = playground.locator('utm-randomizer-toast');
      const undo = toast.getByRole('button', { name: 'Undo' });
      const close = toast.getByRole('button', { name: 'Dismiss' });
      await undo.focus();
      await playground.keyboard.press('Tab');
      await expect(close).toBeFocused();
      if (hover) {
        await close.hover();
        await playground.mouse.move(0, 0);
      }
      await playground.waitForTimeout(1800);
      await expect(close).toBeVisible();
      await expect(close).toBeFocused();
      await playground.keyboard.press('Tab');
      await expect(close).not.toBeFocused();
      await expect(toast).toHaveCount(0);
    });
  }

  for (const stop of ['stopPropagation', 'stopImmediatePropagation'] as const) {
    test(`preserves and cleans HTML-only tracked links after ${stop}`, async ({
      playground,
      context,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(playground.url()).origin,
      });
      await playground.evaluate((method) => {
        const button = document.createElement('button');
        button.id = 'copy-stopped-html';
        button.textContent = 'Copy product';
        button.onclick = () => {
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercises a real browser copy event
          document.execCommand('copy');
        };
        document.addEventListener(
          'copy',
          (event) => {
            event.preventDefault();
            event.clipboardData?.setData('text/plain', 'A product');
            event.clipboardData?.setData(
              'text/html',
              '<strong><a href="https://shop.example/?id=42&utm_source=email">A product</a></strong>',
            );
            event[method]();
          },
          { once: true },
        );
        document.body.append(button);
      }, stop);
      await playground.locator('#copy-stopped-html').click();
      await expect
        .poll(() =>
          playground.evaluate(async () => {
            const items = await navigator.clipboard.read();
            const item = items.find((entry) => entry.types.includes('text/html'));
            return item ? (await item.getType('text/html')).text() : '';
          }),
        )
        .toMatch(/href="https:\/\/shop\.example\/\?id=42"/);
      const copied = await playground.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        return {
          text: await navigator.clipboard.readText(),
          html: item ? await (await item.getType('text/html')).text() : '',
        };
      });
      expect(copied.text).toBe('A product');
      expect(copied.html).toContain('<strong>');
      expect(copied.html).not.toContain('utm_source');
    });
  }

  for (const prefix of ['/', '']) {
    test(`preserves ${prefix ? 'root' : 'named'} relative link forms in asynchronous text and HTML copies`, async ({
      playground,
      context,
      setSettings,
      waitForWatcher,
      readClipboard,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(playground.url()).origin,
      });
      await playground.evaluate((pathPrefix) => {
        const button = document.createElement('button');
        button.id = 'copy-relative';
        button.textContent = 'Copy relative links';
        button.onclick = () => {
          setTimeout(() => {
            void navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': new Blob([`${pathPrefix}relative-page?keep=a%2Fb&utm_source=email#part`], {
                  type: 'text/plain',
                }),
                'text/html': new Blob(
                  [`<b><a href="${pathPrefix}relative-target?utm_campaign=spring&keep=a%2Fb#section">Target</a></b>`],
                  {
                    type: 'text/html',
                  },
                ),
              }),
            ]);
          }, 100);
        };
        document.body.append(button);
      }, prefix);
      await playground.locator('#copy-relative').click();
      await expect.poll(readClipboard).toBe(`${prefix}relative-page?keep=a%2Fb#part`);
      const html = await playground.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        return item ? (await item.getType('text/html')).text() : '';
      });
      // Chromium resolves relative HTML hrefs when it creates the native clipboard payload.
      const target = new URL(`${prefix}relative-target?keep=a%2Fb#section`, playground.url()).href;
      expect(html).toContain(`href="${target}"`);
      expect(html).toContain('<b>');
    });
  }

  for (const recreate of [false, true]) {
    test(`rejects an older page reconciliation after a newer copy with identical text${recreate ? ' across pause/resume' : ''}`, async ({
      context,
      extensionId,
      setSettings,
      waitForWatcher,
      readClipboard,
      writeClipboardExternally,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await context.route('https://www.youtube.com/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<button id="copy">Copy link</button>' }),
      );
      await context.route('https://example.com/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<textarea id="copy-field"></textarea><button id="copy">Copy link</button>',
        }),
      );
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
      const older = await context.newPage();
      await older.goto('https://www.youtube.com/feed');
      const newer = await context.newPage();
      await newer.goto('https://example.com/control');
      const session = await context.newCDPSession(older);
      const worlds: number[] = [];
      session.on(
        'Runtime.executionContextCreated',
        ({ context: world }: { context: { id: number; origin: string } }) => {
          if (world.origin === `chrome-extension://${extensionId}`) worlds.push(world.id);
        },
      );
      await session.send('Runtime.enable');
      const contextId = worlds[0];
      expect(contextId).toBeDefined();
      await session.send('Runtime.evaluate', {
        contextId,
        expression: `(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.heldReconciles = [];
        chrome.runtime.sendMessage = (...args) => {
          if (args[0]?.type === 'reconcile-clipboard') {
            return new Promise((resolve, reject) => {
              globalThis.heldReconciles.push(() => original(...args).then(resolve, reject));
            });
          }
          return original(...args);
        };
      })()`,
      });
      const relative = '/watch?v=1&si=abcdefgh';
      await writeClipboardExternally('before the cross-context copies');
      await older.evaluate((text) => {
        const button = document.querySelector<HTMLButtonElement>('#copy');
        if (button) button.onclick = () => void navigator.clipboard.writeText(text);
      }, relative);
      await older.bringToFront();
      await older.locator('#copy').click();
      await expect
        .poll(async () => {
          const { result } = await session.send('Runtime.evaluate', {
            contextId,
            expression: 'globalThis.heldReconciles.length',
            returnByValue: true,
          });
          return Number(result.value);
        })
        .toBeGreaterThan(0);
      if (recreate) {
        await setSettings({ enabled: false });
        await waitForWatcher(false);
        await setSettings({ enabled: true });
        await waitForWatcher(false);
      }
      await newer.bringToFront();
      if (recreate) {
        await newer.evaluate((text) => {
          const button = document.querySelector<HTMLButtonElement>('#copy');
          if (button)
            button.onclick = () =>
              void navigator.clipboard.writeText(text).then(() => {
                button.dataset.copied = String(Number(button.dataset.copied ?? 0) + 1);
              });
        }, relative);
        // Two ordinary gestures reused the old numeric generation after coordinator recreation.
        for (const count of [1, 2]) {
          await newer.locator('#copy').click();
          await expect(newer.locator('#copy')).toHaveAttribute('data-copied', String(count));
        }
      } else {
        const field = newer.locator('#copy-field');
        await field.fill(relative);
        await field.press('ControlOrMeta+A');
        await field.press('ControlOrMeta+C');
      }
      expect(await expectStable(readClipboard, 600)).toBe(relative);
      await session.send('Runtime.evaluate', {
        contextId,
        expression: 'Promise.all(globalThis.heldReconciles.map(release => release()))',
        awaitPromise: true,
      });
      expect(await expectStable(readClipboard, 600)).toBe(relative);
      await session.detach();
      await older.close();
      await newer.close();
    });
  }

  test('keeps polling when a page copy invalidates the native baseline read', async ({
    playground,
    context,
    extensionId,
    clipboardChange,
    setSettings,
    waitForWatcher,
    readClipboard,
    writeClipboardExternally,
  }) => {
    test.skip(clipboardChange, 'Only the polling path reads a pre-gesture baseline');
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await writeClipboardExternally('before the new copy');
    const session = await context.newCDPSession(playground);
    const worlds: number[] = [];
    session.on('Runtime.executionContextCreated', ({ context: world }: { context: { id: number; origin: string } }) => {
      if (world.origin === `chrome-extension://${extensionId}`) worlds.push(world.id);
    });
    await session.send('Runtime.enable');
    expect(worlds.length).toBeGreaterThan(0);
    for (const contextId of worlds) {
      await session.send('Runtime.evaluate', {
        contextId,
        expression: `(() => {
          const getType = ClipboardItem.prototype.getType;
          let first = true;
          globalThis.baselineReadError = '';
          ClipboardItem.prototype.getType = async function (type) {
            if (first) {
              first = false;
              await new Promise(resolve => setTimeout(resolve, 250));
            }
            try { return await getType.call(this, type); }
            catch (error) { globalThis.baselineReadError = String(error); throw error; }
          };
        })()`,
      });
    }
    await playground.evaluate((text) => {
      const button = document.createElement('button');
      button.id = 'copy-during-baseline';
      button.textContent = 'Copy during clipboard read';
      button.onclick = () => {
        setTimeout(() => void navigator.clipboard.writeText(text), 100);
      };
      document.body.append(button);
    }, ARTICLE);
    await playground.locator('#copy-during-baseline').click();
    await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
    const errors = [];
    for (const contextId of worlds) {
      const { result } = await session.send('Runtime.evaluate', {
        contextId,
        expression: 'baselineReadError',
        returnByValue: true,
      });
      errors.push(String(result.value));
    }
    expect(errors.join('\n')).toContain('Clipboard data has changed');
    await session.detach();
  });

  test('detects changed HTML with unchanged plain text after gestures and cached writes', async ({
    playground,
    context,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(playground.url()).origin,
    });
    await playground.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['A product'], { type: 'text/plain' }),
          'text/html': new Blob(['<a href="https://shop.example/old?utm_source=email">A product</a>'], {
            type: 'text/html',
          }),
        }),
      ]);
      const idle = document.createElement('button');
      idle.id = 'unrelated-click';
      idle.textContent = 'Unrelated action';
      const copy = document.createElement('button');
      copy.id = 'copy-rich';
      copy.textContent = 'Copy product';
      copy.onclick = () => {
        setTimeout(() => {
          void navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([copy.dataset.text ?? 'A product'], { type: 'text/plain' }),
              'text/html': new Blob(
                ['<strong><a href="https://shop.example/new?utm_source=email">A product</a></strong>'],
                {
                  type: 'text/html',
                },
              ),
            }),
          ]);
        }, 100);
      };
      document.body.append(idle, copy);
    });
    /** Reads the native HTML flavor without changing the clipboard. */
    const readHtml = () =>
      playground.evaluate(async () => {
        try {
          const [item] = await navigator.clipboard.read();
          return item?.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
        } catch (error) {
          // A concurrent extension write invalidates the native read; poll its new snapshot.
          if (error instanceof DOMException && error.name === 'InvalidStateError') return '';
          throw error;
        }
      });
    await playground.locator('#unrelated-click').click();
    // An unchanged rich clipboard is not a new copy, even after all fallback polls have run.
    await playground.waitForTimeout(3000);
    expect(await readHtml()).toContain('https://shop.example/old?utm_source=email');
    await playground.locator('#copy-rich').click();
    await expect.poll(readHtml).toContain('href="https://shop.example/new"');

    // Seed the synchronous rewrite cache, then copy a different HTML target with the same plain text.
    await playground.evaluate(() => {
      const seed = document.createElement('button');
      seed.id = 'seed-rich-cache';
      seed.textContent = 'Copy initial link';
      seed.onclick = () => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercises a real synchronous copy
        document.execCommand('copy');
      };
      document.addEventListener(
        'copy',
        (event) => {
          event.preventDefault();
          event.clipboardData?.setData('text/plain', 'https://example.com/?utm_source=email');
          event.clipboardData?.setData('text/html', '<a href="https://example.com/?utm_source=email">Initial link</a>');
        },
        { once: true },
      );
      document.body.append(seed);
      const copy = document.querySelector<HTMLButtonElement>('#copy-rich');
      if (copy) copy.dataset.text = 'https://example.com/';
    });
    await playground.locator('#seed-rich-cache').click();
    await expect.poll(readHtml).toContain('href="https://example.com/"');
    await playground.locator('#copy-rich').click();
    await expect.poll(readHtml).toContain('href="https://shop.example/new"');
    expect(await playground.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/');
    expect(await readHtml()).toContain('<strong>');
  });

  test('bounds synchronous work for an HTML anchor with many tracking parameters', async ({ playground }) => {
    await playground.evaluate(() => {
      const link = 'https://example.com/?' + Array.from({ length: 5000 }, () => 'utm_a=x').join('&');
      const button = document.createElement('button');
      button.id = 'copy-many-parameters';
      button.textContent = 'Copy many parameters';
      document.addEventListener(
        'copy',
        (event) => {
          event.preventDefault();
          event.clipboardData?.setData('text/plain', 'A product');
          event.clipboardData?.setData('text/html', `<a href="${link}">A product</a>`);
          window.addEventListener(
            'copy',
            (copied) => {
              const html = copied.clipboardData?.getData('text/html') ?? '';
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const href = doc.querySelector('a')?.getAttribute('href') ?? '';
              button.dataset.changed = String(new URL(href).searchParams.get('utm_a') !== 'x');
            },
            { once: true },
          );
        },
        { once: true },
      );
      button.onclick = () => {
        const start = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- measures the synchronous copy-handler route
        document.execCommand('copy');
        button.dataset.elapsed = String(performance.now() - start);
      };
      document.body.append(button);
    });
    const button = playground.locator('#copy-many-parameters');
    await button.click();
    await expect(button).toHaveAttribute('data-changed', 'true');
    expect(Number(await button.getAttribute('data-elapsed'))).toBeLessThan(500);
  });

  test('top-frame Undo suppresses an iframe copy through the shared writer', async ({
    playground,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await playground.frameLocator('[data-testid="frame"]').getByRole('button', { name: 'Copy embedded link' }).click();
    await expect.poll(readClipboard).toBe('https://example.com/embed?v=3');
    await playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Original link restored');
    expect(await expectStable(readClipboard, 3000)).toBe('https://example.com/embed?utm_source=iframe&v=3');
  });

  test('reports a lost Undo acknowledgement and retains suppression across worker restart', async ({
    playground,
    context,
    serviceWorker,
    extensionId,
    readClipboard,
    setSettings,
  }) => {
    await setSettings({ mode: 'strip' });
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
    const session = await context.newCDPSession(playground);
    let versionId = '';
    session.on(
      'ServiceWorker.workerVersionUpdated',
      (event: { versions: { scriptURL: string; versionId: string; runningStatus: string }[] }) => {
        const worker = event.versions.find(
          (entry) => entry.scriptURL === serviceWorker.url() && entry.runningStatus === 'running',
        );
        if (worker) versionId = worker.versionId;
      },
    );
    await session.send('ServiceWorker.enable');
    await expect.poll(() => versionId).not.toBe('');
    await serviceWorker.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      // Hold the response after offscreen has restored the payload, then terminate the worker.
      Object.defineProperty(chrome.runtime, 'sendMessage', {
        value: (message: { type?: string }) => {
          const response: Promise<unknown> = send(message);
          if (message.type !== 'offscreen-restore') return response;
          return response.then(() => {
            Reflect.set(globalThis, 'testUndoAckHeld', true);
            return new Promise(() => undefined);
          });
        },
      });
    });
    await playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(() => serviceWorker.evaluate(() => Reflect.get(globalThis, 'testUndoAckHeld') === true))
      .toBe(true);
    await session.send('ServiceWorker.stopWorker', { versionId });
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Could not restore the original link');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const restarted: unknown = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'get-secret' }));
    expect(restarted).toMatchObject({ ok: true });
    await playground.bringToFront();
    expect(await expectStable(readClipboard, 3000)).toBe(ARTICLE);
    await popup.close();
    await session.detach();
  });

  for (const mode of ['decoy', 'silly', 'hybrid', 'strip'] as const) {
    test(`keeps signed URLs unchanged in ${mode} clipboard, address-bar and popup paths`, async ({
      playground,
      server,
      readClipboard,
      context,
      extensionId,
      setSettings,
    }) => {
      await setSettings({ mode });
      const signed = `${server.origin}/?utm_source=email&Signature=signature&Key-Pair-Id=key&Expires=99`;
      await playground.goto(signed);
      await playground.waitForTimeout(600);
      expect(playground.url()).toBe(signed);
      const button = playground.getByTestId('copy-writetext');
      await button.evaluate((element, url) => {
        const row = element.closest<HTMLElement>('[data-url]');
        if (!row) throw new Error('missing copy fixture');
        row.dataset.url = url;
      }, signed);
      await button.click();
      await expect.poll(readClipboard).toBe(signed);
      expect(await expectStable(readClipboard, 1500)).toBe(signed);
      const popup = await context.newPage();
      // A popup opened as a test tab has no toolbar invocation's activeTab grant.
      await popup.addInitScript((url) => {
        Object.defineProperty(chrome.tabs, 'query', { value: () => Promise.resolve([{ url }]) });
      }, signed);
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popup.locator('#copyPage')).toBeEnabled();
      await popup.locator('#copyPage').click();
      await expect(popup.locator('#copyStatus')).toHaveText('Copied (signed link left unchanged)');
      expect(await readClipboard()).toBe(signed);
      await popup.close();
    });
  }

  test('rewrites links copied with navigator.clipboard.writeText', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-writetext').click();
    const copied = await waitForClipboard(readClipboard, (text) => text !== ARTICLE);
    expectReplaced(copied, ARTICLE);
    expect(new URL(copied).searchParams.get('id')).toBe('42');
    await expect(playground.locator('utm-randomizer-toast')).toContainText('Tracking swapped for decoys');
  });

  test('rewrites percent-encoded click IDs and keeps their encoding', async ({
    playground,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'decoy', watchClipboard: false });
    await waitForWatcher(false);
    const id = '0123456789abcdef0123456789abcdef';
    const encoded = id.replace(/./g, (char) => `%${char.charCodeAt(0).toString(16)}`);
    const original = `https://example.com/?msclkid=${encoded}&keep=%2F`;
    const button = playground.getByTestId('copy-writetext');
    await button.evaluate((element, url) => {
      const row = element.closest<HTMLElement>('[data-url]');
      if (!row) throw new Error('missing copy fixture');
      row.dataset.url = url;
    }, original);

    await button.click();
    const copied = await waitForClipboard(readClipboard, (text) => text !== original);
    expect(copied).toMatch(/^https:\/\/example\.com\/\?msclkid=(?:%[0-9a-fA-F]{2}){32}&keep=%2F$/);
    expect(new URL(copied).searchParams.get('msclkid')).toMatch(/^[0-9a-f]{32}$/);
    expect(new URL(copied).searchParams.get('msclkid')).not.toBe(id);
    expect(await expectStable(readClipboard, 1000)).toBe(copied);
  });

  test('preserves images copied with plain-text descriptions containing tracked links', async ({
    playground,
    context,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(playground.url()).origin,
    });
    const description = 'Copy of this image: https://example.com/a?utm_source=real';
    await playground.evaluate((text) => {
      const button = document.createElement('button');
      button.id = 'copy-image-description';
      button.textContent = 'Copy image with description';
      button.onclick = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const drawing = canvas.getContext('2d');
        if (!drawing) throw new Error('missing drawing context');
        drawing.fillStyle = 'rgb(200, 50, 25)';
        drawing.fillRect(0, 0, 1, 1);
        const png = await new Promise<Blob>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
          }, 'image/png');
        });
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([text], { type: 'text/plain' }) }),
        ]);
        button.dataset.copied = 'true';
      };
      document.body.append(button);
    }, description);

    await playground.locator('#copy-image-description').click();
    await expect(playground.locator('#copy-image-description')).toHaveAttribute('data-copied', 'true');
    // Also let the legacy polling path finish every scheduled check.
    await playground.waitForTimeout(3000);
    const copied = await playground.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const item = items.find((entry) => entry.types.includes('image/png'));
      if (!item) return null;
      const bitmap = await createImageBitmap(await item.getType('image/png'));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const drawing = canvas.getContext('2d');
      if (!drawing) throw new Error('missing drawing context');
      drawing.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        text: await navigator.clipboard.readText(),
        pixel: [...drawing.getImageData(0, 0, 1, 1).data],
      };
    });
    expect(copied).toEqual({ text: description, pixel: [200, 50, 25, 255] });
    await expect(playground.locator('utm-randomizer-toast')).toHaveCount(0);
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

  test('preserves custom copy formats without offering destructive plain-text Undo', async ({
    playground,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await playground.evaluate(() => {
      document.addEventListener('copy', (event) => {
        event.clipboardData?.setData('text/plain', 'https://example.com/?utm_source=email');
        event.clipboardData?.setData('application/x-example', 'opaque payload');
        event.preventDefault();
      });
      const field = document.createElement('textarea');
      field.id = 'paste-custom';
      field.value = 'Copy custom';
      field.addEventListener('paste', (event) => {
        field.value = JSON.stringify({
          text: event.clipboardData?.getData('text/plain'),
          custom: event.clipboardData?.getData('application/x-example'),
          types: event.clipboardData?.types,
        });
        event.preventDefault();
      });
      document.body.append(field);
    });
    const field = playground.locator('#paste-custom');
    await field.focus();
    await field.press('ControlOrMeta+A');
    await field.press('ControlOrMeta+C');
    const toast = playground.locator('utm-randomizer-toast');
    await expect(toast).toContainText('Tracking removed');
    expect(await toast.getByRole('button', { name: 'Undo' }).count()).toBe(0);
    await field.focus();
    await field.press('ControlOrMeta+V');
    await expect(field).toHaveValue(
      JSON.stringify({
        text: 'https://example.com/',
        custom: 'opaque payload',
        types: ['text/plain', 'application/x-example'],
      }),
    );
  });

  test('rewrites links written after an async delay', async ({ playground, readClipboard }) => {
    await playground.getByTestId('copy-delayed').click();
    const copied = await waitForClipboard(
      readClipboard,
      (text) => text.startsWith('https://youtu.be/') && !text.includes('AbCdEf123456'),
    );
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

  for (const prose of [false, true]) {
    test(`preserves a rich ${prose ? 'prose ' : ''}selection with a different functional anchor destination`, async ({
      playground,
      context,
      setSettings,
      waitForWatcher,
      readClipboard,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(playground.url()).origin,
      });
      const original = prose
        ? 'Read https://example.com/?utm_source=email today'
        : 'https://example.com/?utm_source=email';
      const clean = prose ? 'Read https://example.com/ today' : 'https://example.com/';
      await playground.evaluate((text) => {
        const paragraph = document.createElement('p');
        paragraph.innerHTML = `<a href="https://destination.example/item"><b>${text}</b></a>`;
        document.body.append(paragraph);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }, original);
      await playground.keyboard.press('ControlOrMeta+C');
      await expect.poll(readClipboard).toBe(clean);
      const copied = await playground.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const html = item?.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
        const document = new DOMParser().parseFromString(html, 'text/html');
        return {
          types: item?.types,
          href: document.querySelector('a')?.getAttribute('href'),
          boldText: document.querySelector('b')?.textContent,
        };
      });
      expect(copied.types).toEqual(['text/plain', 'text/html']);
      expect(copied.href).toBe('https://destination.example/item');
      expect(copied.boldText).toBe(clean);
      await expect(playground.locator('utm-randomizer-toast').getByRole('button', { name: 'Undo' })).toHaveCount(0);
    });
  }

  for (const method of ['native selection', 'page handler'] as const) {
    test(`counts each rich copied link once through ${method}`, async ({
      playground,
      context,
      serviceWorker,
      setSettings,
      waitForWatcher,
      readClipboard,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(playground.url()).origin,
      });
      const before = await serviceWorker.evaluate(async () => ({
        total: Number((await chrome.storage.local.get('totalCount')).totalCount ?? 0),
        session: Number((await chrome.storage.session.get('sessionCount')).sessionCount ?? 0),
      }));
      await playground.evaluate((copyMethod) => {
        const paragraph = document.createElement('p');
        for (const [index, label] of ['https://example.com/first?utm_source=email', 'Alpha', 'Beta'].entries()) {
          const anchor = document.createElement('a');
          anchor.href = `https://example.com/${['first', 'second', 'third'][index]}?utm_source=email`;
          const bold = document.createElement('b');
          bold.textContent = label;
          anchor.append(bold);
          if (index > 0) paragraph.append(' ');
          paragraph.append(anchor);
        }
        document.body.append(paragraph);
        if (copyMethod === 'native selection') {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const selection = getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          document.addEventListener(
            'copy',
            (event) => {
              event.preventDefault();
              event.clipboardData?.setData('text/plain', paragraph.textContent);
              event.clipboardData?.setData('text/html', paragraph.innerHTML);
            },
            { once: true },
          );
          const button = document.createElement('button');
          button.id = 'copy-counted-rich-links';
          button.textContent = 'Copy rich links';
          button.onclick = () => {
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- exercises a native ClipboardEvent
            document.execCommand('copy');
          };
          document.body.append(button);
        }
      }, method);
      if (method === 'native selection') {
        await playground.keyboard.press('ControlOrMeta+C');
      } else {
        await playground.locator('#copy-counted-rich-links').click();
      }

      await expect.poll(readClipboard).toBe('https://example.com/first Alpha Beta');
      const copied = await playground.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const html = item?.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
        const document = new DOMParser().parseFromString(html, 'text/html');
        return {
          types: item?.types,
          targets: [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href')),
          labels: [...document.querySelectorAll('b')].map((bold) => bold.textContent),
        };
      });
      expect(copied.types).toEqual(['text/plain', 'text/html']);
      expect(copied.targets).toEqual([
        'https://example.com/first',
        'https://example.com/second',
        'https://example.com/third',
      ]);
      expect(copied.labels).toEqual(['https://example.com/first', 'Alpha', 'Beta']);
      await expect(playground.locator('utm-randomizer-toast')).toContainText('in 3 links');
      await expect
        .poll(() =>
          serviceWorker.evaluate(async () => ({
            total: (await chrome.storage.local.get('totalCount')).totalCount,
            session: (await chrome.storage.session.get('sessionCount')).sessionCount,
          })),
        )
        .toEqual({ total: before.total + 3, session: before.session + 3 });
    });
  }

  for (const tag of ['textarea', 'input'] as const) {
    test(`cleans a shadow ${tag} copy on HTTP without the Clipboard API`, async ({
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false, cleanAddressBar: false });
      await playground.route('http://probe.test/shadow-copy', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<div id="shadow-host"></div>' }),
      );
      await playground.goto('http://probe.test/shadow-copy');
      await waitForWatcher(false);
      expect(
        await playground.evaluate(() => ({ secure: isSecureContext, clipboard: 'clipboard' in navigator })),
      ).toEqual({
        secure: false,
        clipboard: false,
      });
      await playground.evaluate(
        ({ tag, text }) => {
          const host = document.querySelector('#shadow-host');
          if (!host) throw new Error('missing shadow host');
          const nested = document.createElement('div');
          host.attachShadow({ mode: 'open' }).append(nested);
          const field = document.createElement(tag);
          field.id = 'shadow-field';
          field.value = `Read ${text} today`;
          nested.attachShadow({ mode: 'open' }).append(field);
        },
        { tag, text: ARTICLE },
      );
      const field = playground.locator('#shadow-field');
      await field.focus();
      await field.press('ControlOrMeta+A');
      await field.press('ControlOrMeta+C');

      await expect.poll(readClipboard).toBe('Read https://example.com/article?id=42 today');
      await expect(field).toHaveValue(`Read ${ARTICLE} today`);
    });
  }

  for (const action of ['copy', 'cut'] as const) {
    test(`rewrites a keyboard ${action} when the page stops propagation`, async ({
      playground,
      readClipboard,
      setSettings,
      waitForWatcher,
    }) => {
      await setSettings({ mode: 'strip', watchClipboard: false });
      await waitForWatcher(false);
      const textarea = playground.getByTestId('select-textarea');
      await textarea.evaluate((field, text) => {
        (field as HTMLTextAreaElement).value = text;
        field.addEventListener('copy', (event) => event.stopPropagation());
        field.addEventListener('cut', (event) => event.stopPropagation());
      }, ARTICLE);
      await textarea.focus();
      await textarea.press('ControlOrMeta+A');
      await textarea.press(action === 'copy' ? 'ControlOrMeta+C' : 'ControlOrMeta+X');

      await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
      await expect(textarea).toHaveValue(action === 'copy' ? ARTICLE : '');
    });
  }

  test('reconciles a copy overwritten by a page handler registered during dispatch', async ({
    playground,
    readClipboard,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    const textarea = playground.getByTestId('select-textarea');
    await textarea.fill(ARTICLE);
    await playground.evaluate((text) => {
      document.addEventListener(
        'copy',
        () => {
          window.addEventListener(
            'copy',
            (event) => {
              event.clipboardData?.setData('text/plain', text);
              event.preventDefault();
            },
            { once: true },
          );
        },
        { capture: true, once: true },
      );
    }, ARTICLE);
    await textarea.press('ControlOrMeta+A');
    await textarea.press('ControlOrMeta+C');
    await expect.poll(readClipboard).toBe('https://example.com/article?id=42');
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

  test('Pause cancels reconciliation already waiting in the worker', async ({
    playground,
    readClipboard,
    serviceWorker,
    setSettings,
    waitForWatcher,
  }) => {
    await setSettings({ mode: 'strip', watchClipboard: false });
    await waitForWatcher(false);
    await serviceWorker.evaluate(`(() => {
      const original = chrome.runtime.getContexts.bind(chrome.runtime);
      const gate = globalThis.pauseGate = { armed: false, held: false, paused: false };
      chrome.runtime.getContexts = async (...args) => {
        const contexts = await original(...args);
        if (gate.armed) {
          gate.armed = false;
          gate.held = true;
          await new Promise(resolve => { gate.release = resolve; });
        }
        return contexts;
      };
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'reconcile-clipboard' && !gate.held) gate.armed = true;
        return false;
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.enabled?.newValue === false) gate.paused = true;
      });
    })()`);
    await playground.getByTestId('copy-writetext').click();
    await expect.poll(() => serviceWorker.evaluate('globalThis.pauseGate.held')).toBe(true);
    expect(await readClipboard()).toBe(ARTICLE);
    await setSettings({ enabled: false });
    await expect.poll(() => serviceWorker.evaluate('globalThis.pauseGate.paused')).toBe(true);
    await serviceWorker.evaluate('globalThis.pauseGate.release()');
    await waitForWatcher(false);
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

  test('preserves hidden custom formats and cleans identical text after they are removed', async ({
    playground,
    context,
    waitForWatcher,
    readClipboard,
    writeClipboardExternally,
  }) => {
    await waitForWatcher(true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(playground.url()).origin });
    await playground.evaluate(async (text) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'web application/custom': new Blob(['opaque payload'], { type: 'application/custom' }),
        }),
      ]);
    }, OUTSIDE);
    await playground.waitForTimeout(1800);
    const copied = await playground.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      if (!item?.types.includes('web application/custom')) return null;
      return {
        text: await (await item.getType('text/plain')).text(),
        custom: await (await item.getType('web application/custom')).text(),
      };
    });
    expect(copied).toEqual({ text: OUTSIDE, custom: 'opaque payload' });
    await writeClipboardExternally(OUTSIDE);
    const cleaned = await waitForClipboard(readClipboard, (text) => text !== OUTSIDE);
    expectReplaced(cleaned, OUTSIDE);
  });

  test('leaves copies untouched without a focused reader and retries when one is available', async ({
    playground,
    context,
    extensionId,
    readClipboard,
    writeClipboardExternally,
    waitForWatcher,
    setSettings,
  }) => {
    await setSettings({ mode: 'strip' });
    await waitForWatcher(true);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.bringToFront();
    await writeClipboardExternally(OUTSIDE);
    expect(await expectStable(readClipboard, 1800)).toBe(OUTSIDE);
    await playground.bringToFront();
    await expect.poll(readClipboard).toBe('https://example.com/story?id=11');
    await popup.close();
  });

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

    // Copying the same tracked link again a moment later gets it cleaned again, the same way.
    await writeClipboardExternally(OUTSIDE);
    await expect.poll(readClipboard).toBe(copied);
  });

  test('leaves ordinary text, functional links, and unattributed relative links alone', async ({
    readClipboard,
    writeClipboardExternally,
    waitForWatcher,
  }) => {
    await waitForWatcher(true);
    for (const text of [
      'hello world?',
      'https://example.com/?id=1&page=2',
      'https://maps.google.com/?cid=123',
      '/relative-page?utm_source=email',
    ]) {
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
  test('explicitly copies generated and unchanged links beyond the rewrite input bound', async ({
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
      // Supply the tab URL as a toolbar invocation would, without navigating to a huge request URL.
      await popup.addInitScript((pageUrl) => {
        Object.defineProperty(chrome.tabs, 'query', { value: () => Promise.resolve([{ url: pageUrl }]) });
      }, url);
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popup.locator('#copyPage')).toBeEnabled();
      await popup.locator('#copyPage').click();
      await expect(popup.locator('#copyStatus')).toContainText('Copied');
      const copied = await readClipboard();
      if (url === input) {
        expect(input.length).toBeLessThan(100_000);
        expect(copied.length).toBeGreaterThan(100_000);
        expect(new URL(copied).searchParams.getAll('utm_source')).toHaveLength(6000);
      } else {
        expect(copied).toBe(oversized);
      }
      await popup.close();
    }
  });

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
