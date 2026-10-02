// Builds the unpacked extension into dist/ (load that folder in chrome://extensions).
// Usage: node scripts/build.mjs [--watch]
import { cp, mkdir, readFile, rm, watch, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const OUT_DIR = 'dist';
const STATIC_FILES = ['popup.html', 'popup.css', 'offscreen.html'];
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    offscreen: 'src/offscreen.ts',
    popup: 'src/popup.ts',
  },
  outdir: OUT_DIR,
  bundle: true,
  format: 'iife',
  target: 'chrome123',
  // Unminified output keeps Chrome Web Store review straightforward; the bundle is tiny either way.
  minify: false,
  sourcemap: isWatch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

/** Copies HTML, CSS, and icons into dist/ and writes the manifest with the package version. */
async function copyStaticFiles() {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
  manifest.version = version;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await Promise.all(STATIC_FILES.map((file) => cp(`src/${file}`, `${OUT_DIR}/${file}`)));
  await cp('assets/icons', `${OUT_DIR}/icons`, { recursive: true });
}

await rm(OUT_DIR, { recursive: true, force: true });
await copyStaticFiles();

if (isWatch) {
  const context = await esbuild.context(options);
  await context.watch();
  for await (const { filename } of watch('src', { recursive: true })) {
    if (filename && /\.(?:html|css|json)$/.test(filename)) {
      await copyStaticFiles();
      console.log(`copied static files (${filename} changed)`);
    }
  }
} else {
  await esbuild.build(options);
}
