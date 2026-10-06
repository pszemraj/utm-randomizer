// Renders assets/icon.svg into the PNG sizes the manifest uses (needs a Playwright Chromium).
// Set CHROMIUM_PATH to use an existing Chromium binary instead of Playwright's download.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Transparent padding per side; the Chrome Web Store asks for 96x96 artwork on the 128x128 icon.
const SIZES = [
  [16, 0],
  [32, 1],
  [48, 2],
  [128, 16],
];

const svg = await readFile('assets/icon.svg');
const source = `data:image/svg+xml;base64,${svg.toString('base64')}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [size, padding] of SIZES) {
  const art = size - 2 * padding;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0"><img src="${source}" width="${art}" height="${art}" style="display:block;margin:${padding}px"></body>`,
  );
  await page.screenshot({ path: `assets/icons/icon${size}.png`, omitBackground: true });
  console.log(`assets/icons/icon${size}.png`);
}

await browser.close();
