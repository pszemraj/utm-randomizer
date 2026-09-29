// Serves the manual test page (tests/fixtures/) on http://127.0.0.1:<port>.
// Usage: node scripts/playground.mjs [--port 5173]
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

/** Starts the playground server; resolves with its origin once listening. */
export function startPlayground(port = 0, host = '127.0.0.1') {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const file = path.join(ROOT, pathname === '/' ? 'playground.html' : path.normalize(pathname));
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      // Loopback addresses are secure contexts, so the async Clipboard API works over plain http.
      const origin = `http://${host}:${typeof address === 'object' && address ? address.port : port}`;
      resolve({ origin, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag === -1 ? 5173 : Number(process.argv[portFlag + 1]);
  const { origin } = await startPlayground(port);
  console.log(`UTM Randomizer playground: ${origin}/`);
  console.log('Load dist/ as an unpacked extension first (npm run build). Ctrl+C to stop.');
}
