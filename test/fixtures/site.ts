import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';

/**
 * The fixture test site (master prompt P3): a local server with PLANTED
 * issues and DECOYS (things that must NOT be flagged). This is the gate:
 * every planted issue found, decoys not flagged.
 */

export type PlantedIssue = {
  id: string;
  type: string;
  description: string;
};

export const PLANTED: PlantedIssue[] = [
  { id: 'broken-internal-404', type: 'broken-link', description: '/broken-404 link (404)' },
  { id: 'broken-external-500', type: 'broken-link', description: '/broken-500 link (500)' },
  { id: 'js-pageerror', type: 'js-error', description: 'uncaught page error from <script>' },
  { id: 'js-console-error', type: 'js-error', description: 'console.error call' },
  { id: 'missing-image', type: 'missing-image', description: '<img> with a dead src' },
  { id: 'missing-meta-title', type: 'missing-meta', description: '/no-meta page has no <title>' },
  { id: 'page-weight', type: 'page-weight', description: '/heavy page over the weight limit' },
  { id: 'load-timing', type: 'load-timing', description: '/slow page over the load limit' },
  { id: 'redirect-chain', type: 'redirect-chain', description: '/chain1 → /chain2 → /chain3 → /final (4 hops)' },
  { id: 'redirect-loop', type: 'redirect-loop', description: '/loop-a ↔ /loop-b infinite loop' },
];

export const DECOYS: PlantedIssue[] = [
  { id: 'decoy-slow-external', type: 'broken-link', description: 'a link that is SLOW but returns 200 — not broken' },
  { id: 'decoy-bot-blocked', type: 'broken-link', description: 'an external link returning 403 (bot-blocked) — unverifiable, not broken' },
  { id: 'decoy-working-image', type: 'missing-image', description: 'a working <img> with naturalWidth > 0 — not missing' },
];

export function startFixtureSite(): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><head><title>Fixture home</title><meta name="description" content="test"><meta property="og:title" content="Fixture"><meta property="og:image" content="/og.png"></head><body>
        <a href="/page2">Page 2</a>
        <a href="/broken-404">Broken 404</a>
        <a href="/broken-500">Broken 500</a>
        <a href="/error-page">JS error page</a>
        <a href="/no-meta">No meta page</a>
        <a href="/heavy">Heavy page</a>
        <a href="/slow">Slow page</a>
        <a href="/chain1">Redirect chain</a>
        <a href="/loop-a">Redirect loop</a>
        <img src="/real-image.png" alt="working">
        <img src="/dead-image.png" alt="dead">
        <a href="/decoy-slow">Decoy: slow but fine</a>
        <a href="/decoy-403">Decoy: bot-blocked</a>
      </body></html>`);
      return;
    }
    if (url === '/real-image.png') {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjy9QAAAABJRU5ErkJggg==', 'base64');
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) });
      res.end(png);
      return;
    }
    if (url === '/page2') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>Page 2</title><meta name="description" content="p2"><meta property="og:title" content="P2"><meta property="og:image" content="/og.png"></head><body><a href="/">Back</a></body></html>');
      return;
    }
    if (url === '/broken-404') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>404</title></head><body>Not found</body></html>');
      return;
    }
    if (url === '/broken-500') {
      res.writeHead(500);
      res.end('Server error');
      return;
    }
    if (url === '/error-page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>Error page</title><meta name="description" content="e"><meta property="og:title" content="E"><meta property="og:image" content="/og.png"></head><body><script>throw new Error("planted page error");</script><script>console.error("planted console error");</script></body></html>');
      return;
    }
    if (url === '/no-meta') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head></head><body>No meta here</body></html>');
      return;
    }
    if (url === '/heavy') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>Heavy</title><meta name="description" content="h"><meta property="og:title" content="H"><meta property="og:image" content="/og.png"></head><body>' + 'x'.repeat(4 * 1024 * 1024) + '</body></html>');
      return;
    }
    if (url === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html><head><title>Slow</title><meta name="description" content="s"><meta property="og:title" content="S"><meta property="og:image" content="/og.png"></head><body>Finally loaded</body></html>');
      }, 8_000); // over the load-timing threshold
      return;
    }
    if (url === '/chain1') { res.writeHead(302, { location: '/chain2' }); res.end(); return; }
    if (url === '/chain2') { res.writeHead(302, { location: '/chain3' }); res.end(); return; }
    if (url === '/chain3') { res.writeHead(302, { location: '/chain-final' }); res.end(); return; }
    if (url === '/chain-final') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><title>Chain end</title><meta name="description" content="c"><meta property="og:title" content="C"><meta property="og:image" content="/og.png"></head><body>End of chain</body></html>');
      return;
    }
    if (url === '/loop-a') { res.writeHead(302, { location: '/loop-b' }); res.end(); return; }
    if (url === '/loop-b') { res.writeHead(302, { location: '/loop-a' }); res.end(); return; }
    if (url === '/decoy-slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html><head><title>Decoy</title><meta name="description" content="d"><meta property="og:title" content="D"><meta property="og:image" content="/og.png"></head><body>Slow but works</body></html>');
      }, 2_000); // slow but fine — must NOT be flagged as broken
      return;
    }
    if (url === '/decoy-403') {
      res.writeHead(403); // bot-blocking — must NOT be flagged as broken
      res.end('Forbidden (bot blocked)');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        server,
        port,
        close: async () => {
          for (const s of sockets) s.destroy();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
