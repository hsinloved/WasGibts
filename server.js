// WasGibts HTTP server. Stateless: it holds no user data. It serves the web
// app, reads menus, and runs the AI layer on the profile view each request
// carries. Adding accounts later means adding /api/profile routes backed by a
// database here and a RemoteRepository in public/js/store.js.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMenu, recommend, parseProfile, aiInfo, aiAvailable, AIError } from './lib/ai.js';
import { partsFromUrl, partsFromFiles, SourceError } from './lib/sources.js';
import { normalizeMenu } from './shared/menu.js';

const PORT = Number(process.env.PORT) || 8890;
const HOST = process.env.HOST || '127.0.0.1';
const ROOTS = {
  '/shared/': fileURLToPath(new URL('./shared/', import.meta.url)),
  '/': fileURLToPath(new URL('./public/', import.meta.url)),
};
const LIMITS = { extract: 32 * 1024 * 1024, default: 1024 * 1024 };

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'",
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'Content-Type': json ? 'application/json' : 'text/plain; charset=utf-8', ...HEADERS, ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

async function readJson(req, limit) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'That upload is too large.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

// Small in-memory rate limit for the AI endpoints (per IP, sliding window).
const hits = new Map();
function rateLimit(req, max = Number(process.env.WASGIBTS_RATE_LIMIT) || 40, windowMs = 10 * 60_000) {
  const ip = req.socket.remoteAddress ?? '?';
  const t = Date.now();
  const list = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Slow down a little — try again in a few minutes.');
  list.push(t); hits.set(ip, list);
}

function requireAI() {
  if (!aiAvailable()) throw new HttpError(503, 'No AI key is configured on this server, so only the sample menu and the built-in matcher are available.');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function serveStatic(pathname, res) {
  const prefix = pathname.startsWith('/shared/') ? '/shared/' : '/';
  const root = ROOTS[prefix];
  const rel = pathname === '/' ? 'index.html' : pathname.slice(prefix.length);
  const file = normalize(join(root, decodeURIComponent(rel)));
  if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', ...HEADERS });
    res.end(data);
  } catch {
    // Client-side routes fall back to the app shell.
    if (!extname(file)) return serveStatic('/', res);
    send(res, 404, 'Not found');
  }
}

const routes = {
  'GET /healthz': async () => ({ ok: true }),
  'GET /api/status': async () => aiInfo(),

  'POST /api/menu/extract': async (req) => {
    requireAI();
    rateLimit(req);
    const body = await readJson(req, LIMITS.extract);
    const src = body.source ?? {};
    const input = src.type === 'url' ? await partsFromUrl(String(src.url ?? '').trim())
      : src.type === 'files' ? partsFromFiles(src.files)
      : (() => { throw new HttpError(400, 'Provide a URL or files.'); })();
    const raw = await extractMenu({ parts: input.parts, translateTo: body.translateTo || 'English' });
    const menu = normalizeMenu({ ...raw, source: { kind: input.kind, label: input.label, url: input.url } });
    if (input.truncated) menu.notes.push('The page was very long; only the first part was read.');
    if (!menu.dishes.length) throw new HttpError(422, menu.notes[0] || 'No dishes found in that source.');
    return menu;
  },

  'POST /api/recommend': async (req) => {
    requireAI();
    rateLimit(req);
    const body = await readJson(req, LIMITS.default * 4);
    if (!body.menu?.dishes?.length) throw new HttpError(400, 'Missing menu');
    const menu = normalizeMenu(body.menu);
    return recommend({
      menu,
      profileView: body.profile ?? { preferences: [], restrictions: [] },
      occasion: body.occasion,
      request: String(body.request ?? '').slice(0, 500),
      screen: Array.isArray(body.screen) ? body.screen.slice(0, 50) : [],
    });
  },

  'POST /api/profile/parse': async (req) => {
    requireAI();
    rateLimit(req);
    const body = await readJson(req, LIMITS.default);
    const text = String(body.text ?? '').trim();
    if (text.length < 10) throw new HttpError(400, 'Tell me a little more about how you eat.');
    if (text.length > 20_000) throw new HttpError(413, 'That is a lot — please keep it under 20,000 characters.');
    return parseProfile({ text });
  },
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${pathname}`];
  try {
    if (handler) return send(res, 200, await handler(req));
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(pathname, res);
  } catch (err) {
    const known = err instanceof HttpError || err instanceof SourceError || err instanceof AIError;
    if (!known) console.error(err);
    send(res, known ? err.status : 500, { error: known ? err.message : 'Something went wrong.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WasGibts on http://${HOST}:${PORT}  (AI: ${aiAvailable() ? aiInfo().model : 'off — sample menu + built-in matcher only'})`);
});
