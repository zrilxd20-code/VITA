// VITA static dev server — pure Node.js stdlib, no dependencies.
// Serves repo root over http (required for Service Worker + PWA).
// version.json is always no-store so update polling never sees stale cache.
// Run: npm run dev  (default http://localhost:8000)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (p === '' || p.endsWith('/')) p += 'index.html';
    if (p.includes('..')) { res.writeHead(400); res.end('bad path'); return; }
    const file = join(ROOT, p);
    const data = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': p === 'version.json' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    try {
      const fallback = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(fallback);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  }
}).listen(PORT, () => console.log(`VITA dev server: http://localhost:${PORT}`));
