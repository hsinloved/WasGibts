// Renders a web page in headless Chromium, for restaurant sites that are empty
// shells until their JavaScript loads the menu (single-page apps backed by an
// API or a hosted database). Used only when a plain fetch finds no menu.
//
// Safety: every request the page makes, including redirects, scripts and API
// calls, goes through the same public-address check as normal page fetches,
// so a page cannot reach private networks. Images, fonts and media are
// skipped. The browser runs with a fresh context, no downloads, and a hard
// time limit.
//
// Browser: on Vercel/serverless, the Chromium build from @sparticuz/chromium;
// elsewhere CHROMIUM_PATH, or Playwright's own browser if one is installed.
// If none is available, renderPage() returns null and the caller falls back.

import { assertPublicUrl, SourceError } from './sources.js';

const TIMEOUT = 25_000;
const SKIP = new Set(['image', 'font', 'media', 'manifest', 'texttrack', 'eventsource', 'websocket']);
const MAX_TEXT = 200_000;

let launching = null;

async function launch() {
  const { chromium } = await import('playwright-core');
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (serverless) {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    return chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true });
  }
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath, headless: true });
}

/** A browser, or null when this machine has none. Reused across requests while the process lives. */
async function browser() {
  if (process.env.WASGIBTS_RENDER === 'off') return null;
  launching ??= launch().catch(() => null);
  const b = await launching;
  if (!b || !b.isConnected()) { launching = null; return null; }
  return b;
}

/** Hosts already checked during this render (DNS lookups are the slow part). */
async function allowed(url, cache) {
  let host;
  try { host = new URL(url).host; } catch { return false; }
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (!cache.has(host)) cache.set(host, assertPublicUrl(url).then(() => true, () => false));
  return cache.get(host);
}

/**
 * @returns {Promise<{ url, title, text, links: Array<{href,label}> } | null>} null when no browser is available
 * @throws SourceError when the page itself cannot be opened
 */
export async function renderPage(rawUrl, { timeout = TIMEOUT } = {}) {
  await assertPublicUrl(rawUrl);
  const b = await browser();
  if (!b) return null;
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 WasGibts/0.1 (menu reader)',
    locale: 'de-DE', acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: true,
    viewport: { width: 1280, height: 2000 },
  });
  const cache = new Map();
  try {
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (SKIP.has(req.resourceType()) || !(await allowed(req.url(), cache))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const res = await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout }).catch(() => null);
    if (!res) throw new SourceError('Could not open that page.', 502, 'blocked');
    if (res.status() >= 400) throw new SourceError(`The website answered with ${res.status()}.`, 502, [401, 403, 429, 503].includes(res.status()) ? 'blocked' : undefined);
    // Wait until the app has fetched its data, then until prices show up (or time runs out).
    await page.waitForLoadState('networkidle', { timeout: Math.min(15_000, timeout) }).catch(() => {});
    await page.waitForFunction(() => /\d[.,]\d{2}\s?€|€\s?\d/.test(document.body?.innerText ?? ''), null, { timeout: 4000 }).catch(() => {});
    // Lazy-loaded sections: scroll through the page once.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight && y < 40_000; y += 1500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    const out = await page.evaluate(() => ({
      title: document.title,
      text: document.body?.innerText ?? '',
      links: [...document.querySelectorAll('a[href]')].slice(0, 400).map((a) => ({ href: a.href, label: (a.innerText || a.title || '').trim().slice(0, 120) })),
    }));
    return { url: page.url(), title: out.title, text: out.text.replace(/\n{3,}/g, '\n\n').slice(0, MAX_TEXT), links: out.links };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Close the shared browser (tests, shutdown). */
export async function closeRenderer() {
  const b = await launching?.catch(() => null);
  launching = null;
  await b?.close().catch(() => {});
}
