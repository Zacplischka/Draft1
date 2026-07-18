import { existsSync, createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Server as HttpServer } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Serves the built SPA (dist/) from the room-engine's http server — "served alongside"
 *  per issue #12. Socket.IO already owns /socket.io; unknown paths fall back to
 *  index.html (SPA routing). No-op when dist/ hasn't been built (dev uses vite). */
export function serveSpa(http: HttpServer, dir: string = join(process.cwd(), 'dist')): void {
  if (!existsSync(join(dir, 'index.html'))) return;
  const root = resolve(dir);
  http.on('request', (req, res) => {
    if (res.headersSent || req.url?.startsWith('/socket.io') || req.url?.startsWith('/api/')) return;
    const path = resolve(join(root, (req.url ?? '/').split('?')[0]!));
    // Traversal guard + SPA fallback: anything outside root or without a file serves index.html.
    const file = path.startsWith(root) && extname(path) && existsSync(path) ? path : join(root, 'index.html');
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
}
