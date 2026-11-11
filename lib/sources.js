// Turns a menu source (website URL, photos, PDF) into content blocks for the
// AI layer. Websites are fetched server-side with a guard against reaching
// private networks, reduced to readable text, and — when the page mostly links
// to a PDF menu — the PDF is fetched instead.

import { shopFor } from './shops.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_PAGE = 8 * 1024 * 1024; // delivery platforms embed large JSON
const MAX_PDF = 20 * 1024 * 1024;
const MAX_TEXT = 120_000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const PDF_TYPE = 'application/pdf';

export class SourceError extends Error {
  /** reason: 'blocked' (site refused us) | 'thin' (no readable menu) | undefined */
  constructor(message, status = 400, reason) { super(message); this.status = status; this.reason = reason; }
}

const UA = 'Mozilla/5.0 (compatible; WasGibts/0.1; menu reader)';

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new SourceError('That does not look like a web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SourceError('Only http and https links are supported.');
  if (url.username || url.password) throw new SourceError('Links with credentials are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new SourceError('Could not find that website.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new SourceError('That address is not reachable from here.');
  return url;
}

/**
 * Follow redirects (e.g. maps.app.goo.gl → google.com/maps/place/…) without
 * downloading pages, stopping early once `stop(url)` is satisfied.
 */
export async function resolveRedirects(rawUrl, stop = () => false, hops = 6) {
  let current = rawUrl;
  for (let i = 0; i <= hops; i++) {
    if (stop(current)) return current;
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } })
      .catch(() => { throw new SourceError('Could not open that link.', 502); });
    res.body?.cancel().catch(() => {});
    const loc = res.headers.get('location');
    if (!(res.status >= 300 && res.status < 400 && loc)) return current;
    current = new URL(loc, url).href;
  }
  return current;
}

async function fetchLimited(rawUrl, limit, redirects = 4) {
  const url = await assertPublicUrl(rawUrl);
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5', 'Accept-Language': 'de,en;q=0.8' },
  }).catch(() => { throw new SourceError('Could not connect to that website.', 502, 'blocked'); });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (!redirects) throw new SourceError('Too many redirects.');
    return fetchLimited(new URL(res.headers.get('location'), url).href, limit, redirects - 1);
  }
  if (!res.ok) throw new SourceError(`The website answered with ${res.status}.`, 502, [401, 403, 429, 503].includes(res.status) ? 'blocked' : undefined);
  const chunks = []; let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > limit) throw new SourceError('That page is too large to read.', 413);
    chunks.push(c);
  }
  return { url: res.url || url.href, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks) };
}

/** JSON from a public API, with the same address check, timeout and size limit as pages. */
async function fetchJson(rawUrl) {
  const res = await fetchLimited(rawUrl, MAX_PAGE);
  try { return JSON.parse(res.body.toString('utf8')); } catch { throw new SourceError('The menu service answered with something unreadable.', 502); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', eacute: 'é', egrave: 'è', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Readable text from HTML, keeping line structure, plus title and menu-ish links. */
export function htmlToText(html, baseUrl) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    try { links.push({ href: new URL(decode(m[1]), baseUrl).href, label }); } catch { /* ignore bad hrefs */ }
  }
  // JSON-LD often carries structured menus on restaurant sites, and delivery
  // platforms embed their whole menu as JSON for the page's JavaScript.
  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).join('\n');
  const embedded = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs, body]) => /id=["']__NEXT_DATA__["']|type=["']application\/json["']/i.test(attrs) && body.length > 200)
    .map(([, , body]) => body.trim())
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .join('\n');
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article|\/dt|\/dd)\b[^>]*>/gi, '\n')
      .replace(/<(td|th)\b[^>]*>/gi, ' \t ')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text, links, jsonLd, embedded };
}

const MENU_WORD = /(menu|speisekarte|karte|carte|carta|menü|メニュー|菜单|food|lunch|dinner|mittag|abend)/i;

export function findMenuPdf(links) {
  const pdfs = links.filter((l) => /\.pdf(\?|#|$)/i.test(l.href));
  return pdfs.find((l) => MENU_WORD.test(l.href) || MENU_WORD.test(l.label)) ?? (pdfs.length === 1 ? pdfs[0] : null);
}

/** Website → content parts + a label. */
export async function partsFromUrl(rawUrl) {
  const page = await fetchLimited(rawUrl, MAX_PDF);
  if (page.type === PDF_TYPE || page.body.subarray(0, 5).toString() === '%PDF-') {
    return { parts: [pdfPart(page.body)], label: new URL(page.url).hostname, url: page.url, kind: 'pdf-url' };
  }
  if (IMAGE_TYPES.includes(page.type)) {
    return { parts: [imagePart(page.type, page.body)], label: new URL(page.url).hostname, url: page.url, kind: 'image-url' };
  }
  if (page.body.length > MAX_PAGE) throw new SourceError('That page is too large to read.', 413);
  const html = page.body.toString('utf8');
  const { title, text, links, jsonLd, embedded } = htmlToText(html, page.url);
  // Online-shop platforms load the menu with JavaScript; ask their API instead.
  const shop = text.length < 2000 ? shopFor(html, page.url) : null;
  if (shop) {
    const found = await shop.read(page.url, fetchJson).catch(() => null);
    if (found) {
      return {
        parts: [{ type: 'text', text: `<website_content>\nWebsite: ${page.url}\nMenu from the restaurant's ${shop.name} online shop (structured menu data):\n\n${found.text.slice(0, MAX_TEXT * 2)}\n</website_content>` }],
        label: `${found.name || title || new URL(page.url).hostname} · ${shop.name} online shop`,
        url: page.url,
        kind: 'shop',
        context: `This menu comes from the restaurant's ${shop.name} online-ordering shop. Prices are the shop's prices. Ingredients and allergens listed there come from the restaurant, so they count as stated on the menu.`,
        notes: [found.note].filter(Boolean),
        truncated: found.text.length > MAX_TEXT * 2,
      };
    }
  }
  const pdf = findMenuPdf(links);
  // A thin page that links to a PDF menu: the PDF is the real menu.
  if (pdf && text.length < 4000) {
    try {
      const doc = await fetchLimited(pdf.href, MAX_PDF);
      if (doc.body.subarray(0, 5).toString() === '%PDF-') {
        return {
          parts: [pdfPart(doc.body), { type: 'text', text: `This PDF was linked from ${page.url} ("${title}"). Page text for context:\n${text.slice(0, 4000)}` }],
          label: title || new URL(page.url).hostname, url: page.url, kind: 'website+pdf',
        };
      }
    } catch { /* fall back to page text */ }
  }
  if (text.length < 200 && !jsonLd && !embedded) {
    throw new SourceError('That page has almost no readable text — the menu may be an image or load with JavaScript. Try a photo or the PDF instead.', 422, 'thin');
  }
  const menuLinks = links.filter((l) => MENU_WORD.test(l.label) || MENU_WORD.test(l.href)).slice(0, 15);
  const body = [
    `Website: ${page.url}`, title && `Title: ${title}`,
    jsonLd && `Structured data:\n${jsonLd.slice(0, 30_000)}`,
    embedded && `Embedded page data (JSON; may contain the menu):\n${embedded.slice(0, 80_000)}`,
    `Page text:\n${text.slice(0, MAX_TEXT)}`,
    menuLinks.length && `Menu-related links on the page (not fetched):\n${menuLinks.map((l) => `- ${l.label || '(no label)'}: ${l.href}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
  return {
    parts: [{ type: 'text', text: `<website_content>\n${body}\n</website_content>` }],
    label: title || new URL(page.url).hostname,
    url: page.url,
    kind: 'website',
    truncated: text.length > MAX_TEXT,
  };
}

const pdfPart = (buf) => ({ type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data: buf.toString('base64') } });
const imagePart = (type, buf) => ({ type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } });

/** Uploaded files ({ mediaType, data: base64, name }) → content parts. */
export function partsFromFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new SourceError('No files received.');
  if (files.length > 8) throw new SourceError('Up to 8 pages at a time, please.');
  const parts = files.map((f) => {
    const data = String(f.data ?? '').replace(/^data:[^,]+,/, '').replace(/\s/g, '');
    if (!data) throw new SourceError('One of the files is empty.');
    if (f.mediaType === PDF_TYPE) return { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data } };
    if (IMAGE_TYPES.includes(f.mediaType)) return { type: 'image', source: { type: 'base64', media_type: f.mediaType, data } };
    throw new SourceError(`${f.name || 'A file'} is not a photo or PDF.`, 415);
  });
  const names = files.map((f) => f.name).filter(Boolean);
  return {
    parts: [...parts, { type: 'text', text: files.length > 1 ? `These ${files.length} files are pages of the same menu.` : 'This is a restaurant menu.' }],
    label: names.length ? names.join(', ') : 'Uploaded menu',
    url: null,
    kind: files.every((f) => f.mediaType === PDF_TYPE) ? 'pdf' : 'photo',
  };
}
