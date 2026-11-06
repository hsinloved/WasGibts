// Recognising the kinds of links people share: Google Maps places and food
// delivery platforms. Pure functions, plus one helper that follows short-link
// redirects without downloading pages.

/** Delivery platforms common in Germany and elsewhere. */
export const PLATFORMS = [
  { id: 'lieferando', name: 'Lieferando', hosts: ['lieferando.de', 'lieferando.at', 'lieferando.nl', 'thuisbezorgd.nl', 'just-eat.co.uk', 'just-eat.ch', 'takeaway.com'] },
  { id: 'wolt', name: 'Wolt', hosts: ['wolt.com'] },
  { id: 'ubereats', name: 'Uber Eats', hosts: ['ubereats.com'] },
  { id: 'deliveroo', name: 'Deliveroo', hosts: ['deliveroo.de', 'deliveroo.co.uk', 'deliveroo.fr', 'deliveroo.it', 'deliveroo.be', 'deliveroo.nl'] },
  { id: 'foodora', name: 'foodora', hosts: ['foodora.at', 'foodora.se', 'foodora.no'] },
  { id: 'foodpanda', name: 'foodpanda', hosts: ['foodpanda.com', 'foodpanda.de'] },
];

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const endsWith = (host, base) => host === base || host.endsWith(`.${base}`);

export function platformFor(url) {
  const host = hostOf(url);
  return PLATFORMS.find((p) => p.hosts.some((h) => endsWith(host, h))) ?? null;
}

export function isMapsUrl(url) {
  const host = hostOf(url);
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') return host === 'maps.app.goo.gl' || /^\/maps/.test(safePath(url));
  if (host === 'maps.google.com' || /^maps\.google\.[a-z.]+$/.test(host)) return true;
  if (/^google\.[a-z.]+$/.test(host)) return /^\/maps/.test(safePath(url));
  if (host === 'consent.google.com') return isMapsUrl(new URL(url).searchParams.get('continue') ?? '');
  return false;
}

const safePath = (u) => { try { return new URL(u).pathname; } catch { return ''; } };
const clean = (s) => decodeURIComponent(String(s).replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Pull the place name and coordinates out of a full Google Maps URL.
 * Short links (maps.app.goo.gl) must be resolved first.
 */
export function parseMapsUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.hostname === 'consent.google.com' && url.searchParams.get('continue')) {
    return parseMapsUrl(url.searchParams.get('continue'));
  }
  const out = { name: null, lat: null, lng: null, placeId: null };
  const place = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (place) out.name = clean(place[1]);
  const at = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? url.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (at) { out.lat = Number(at[1]); out.lng = Number(at[2]); }
  const q = url.searchParams.get('q') ?? url.searchParams.get('query');
  if (!out.name && q && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(q)) out.name = clean(q);
  out.placeId = url.searchParams.get('query_place_id') ?? url.searchParams.get('cid') ?? null;
  return out.name || out.lat != null ? out : null;
}

/**
 * Text shared from the Google Maps app looks like "Name\nAddress\nhttps://…".
 * Returns the first URL and the lines before it as a name/address hint.
 */
export function splitSharedText(text) {
  const s = String(text ?? '');
  const m = s.match(/https?:\/\/\S+/);
  const url = m ? m[0].replace(/[)\].,>»"']+$/, '') : null;
  const before = (m ? s.slice(0, m.index) : s).split('\n').map((l) => l.trim()).filter(Boolean);
  return { url, name: before[0] ?? null, address: before.slice(1).join(', ') || null };
}

/** A readable restaurant name from a delivery-platform URL slug. */
export function nameFromPlatformUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => ['speisekarte', 'menu', 'restaurant', 'store', 'menue', 'venue'].includes(p.toLowerCase()));
  const slug = i >= 0 ? parts[i + 1] : parts.at(-1);
  if (!slug) return null;
  const words = slug.split('-').filter((w) => w && !/^[0-9a-f]{6,}$/i.test(w) && !/^\d+$/.test(w));
  if (!words.length) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
