import http from 'node:http';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { createApp } from '../backend/src/app';
import { logger } from '../backend/src/util/logger';
import artwork from '../electron/artwork.cjs';

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const token = process.argv[4];
if (!/^[a-f0-9]{64}$/.test(token) || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid Android runtime configuration');
const matches = (value: string) => value.length === token.length &&
  timingSafeEqual(Buffer.from(value), Buffer.from(token));
const api = createApp({ token: '' }).callback();
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Bootstrap once from the native activity; other local apps cannot access the API.
    if (url.pathname === '/bootstrap' && matches(url.searchParams.get('token') || '')) {
      res.writeHead(302, {
        'Set-Cookie': `qqmui_local=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        Location: '/index.html',
      });
      res.end();
      return;
    }
    const cookie = /(?:^|;\s*)qqmui_local=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1] || '';
    if (req.headers.host !== `127.0.0.1:${port}` || !matches(cookie)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      req.url = url.pathname.slice(4) + url.search;
      api(req, res);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return; }
    if (url.pathname === '/art') {
      const result = await artwork.fetchArtwork(url.searchParams.get('url'));
      res.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') || 'text/plain',
        'Cache-Control': result.headers.get('cache-control') || 'no-store',
      });
      if (req.method === 'HEAD' || !result.body) res.end();
      else Readable.fromWeb(result.body as never).on('error', () => res.destroy()).pipe(res);
      return;
    }
    let requested: string;
    try { requested = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400).end(); return; }
    const filename = path.resolve(root, '.' + requested);
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative) ||
      !(relative === 'index.html' || /^(src|assets)[/\\]/.test(relative)) ||
      !(await stat(filename).catch(() => null))?.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    if (req.method === 'HEAD') res.end();
    else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE', message: '音乐服务暂时不可用，请重试' } }));
  }
});
server.listen(port, '127.0.0.1', () => logger.info('android.ready', { port }));
server.on('error', (error: NodeJS.ErrnoException) => logger.error('android.failed', { code: error.code }));
