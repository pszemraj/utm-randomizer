// Zips dist/ into release/utm-randomizer-<version>.zip for the Chrome Web Store.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.version !== version) {
  throw new Error(`dist/ is stale: manifest ${manifest.version} vs package ${version}; run npm run build`);
}

/** @type {Record<string, Uint8Array>} */
const files = {};
for (const relative of (await readdir('dist', { recursive: true })).sort()) {
  const absolute = path.join('dist', relative);
  if ((await stat(absolute)).isFile()) {
    files[relative.split(path.sep).join('/')] = await readFile(absolute);
  }
}

await mkdir('release', { recursive: true });
const output = `release/utm-randomizer-${version}.zip`;
await writeFile(output, zipSync(files, { level: 9 }));
console.log(`${output} (${Object.keys(files).length} files)`);
