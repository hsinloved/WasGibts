// Turns whatever the user shared into menu content for the extractor:
//   - restaurant website or PDF link → read directly
//   - Google Maps link → identify the place, search for its own menu, read that
//   - delivery platform link → read directly; if blocked, find the restaurant's
//     own menu instead and say that prices may differ
// When nothing works, the error tells the user exactly which screenshots to take.

import { partsFromUrl, resolveRedirects, SourceError } from './sources.js';
import { isMapsUrl, parseMapsUrl, platformFor, nameFromPlatformUrl, splitSharedText } from './places.js';
import { findMenuOnline } from './ai.js';

const SCREENSHOT_TIP = {
  maps: 'In Google Maps, open the place, then Menu (or Photos → Menu), take screenshots and add them under Photos.',
  platform: (p) => `Take screenshots of the menu in the ${p} app or website and add them under Photos.`,
};

async function firstReadable(urls, { skipPlatforms = false } = {}) {
  for (const u of urls) {
    if (skipPlatforms && platformFor(u)) continue;
    try { return { ...(await partsFromUrl(u)), triedUrl: u }; } catch (err) { if (!(err instanceof SourceError)) throw err; }
  }
  return null;
}

/**
 * @param {{ url?: string, text?: string }} src  url, or text shared from another app
 * @param {{ homeCity?: string, onStep?: (s: string) => void }} opts
 */
export async function resolveLinkSource(src, { homeCity = '' } = {}) {
  const shared = splitSharedText(src.text);
  const url = String(src.url || shared.url || '').trim();
  if (!url) throw new SourceError('Paste a link first.');

  // --- Google Maps ---
  if (isMapsUrl(url)) {
    // If the short link can't be followed, the name shared alongside it still works.
    const full = await resolveRedirects(url, (u) => /\/maps\/place\//.test(u) || /consent\.google\./.test(u) || /[?&](q|query)=/.test(u))
      .catch((err) => { if (shared.name) return url; throw err; });
    const place = parseMapsUrl(full) ?? parseMapsUrl(url);
    const name = place?.name ?? shared.name;
    if (!name) throw new SourceError(`I couldn’t tell which place that Maps link points to. ${SCREENSHOT_TIP.maps}`, 422);
    const found = await findMenuOnline({ name, address: shared.address, lat: place?.lat ?? null, lng: place?.lng ?? null, homeCity });
    const read = found?.urls.length ? await firstReadable(found.urls, { skipPlatforms: true }) ?? await firstReadable(found.urls) : null;
    if (!read) throw new SourceError(`I couldn’t find a readable menu for ${name} online. ${SCREENSHOT_TIP.maps}`, 422);
    const notes = [
      `Found online for “${name}” from your Google Maps link: ${read.triedUrl}`,
      found.notes,
      found.confidence === 'low' ? 'I’m not certain this is the same branch — check the address.' : '',
    ].filter(Boolean);
    return {
      ...read,
      kind: 'maps',
      label: `${found.restaurant ?? name} · via Google Maps`,
      context: `This menu was found online for the restaurant "${found.restaurant ?? name}"${found.address ? ` (${found.address})` : ''}. It may be out of date.`,
      notes,
    };
  }

  // --- Delivery platforms ---
  const platform = platformFor(url);
  if (platform) {
    try {
      const read = await partsFromUrl(url);
      return {
        ...read,
        kind: 'platform',
        label: `${platform.name} · ${read.label}`,
        context: `This is the restaurant's ${platform.name} delivery menu. Prices are ${platform.name} delivery prices. Ignore platform navigation, ads and other restaurants on the page.`,
        notes: [],
      };
    } catch (err) {
      if (!(err instanceof SourceError) || !['blocked', 'thin'].includes(err.reason)) throw err;
    }
    const name = shared.name ?? nameFromPlatformUrl(url);
    const found = name ? await findMenuOnline({ name, address: shared.address, platform: platform.name, homeCity }) : null;
    const read = found?.urls.length ? await firstReadable(found.urls, { skipPlatforms: true }) : null;
    if (!read) throw new SourceError(`${platform.name} doesn’t let me read its pages. ${SCREENSHOT_TIP.platform(platform.name)}`, 422);
    return {
      ...read,
      kind: 'platform-fallback',
      label: `${found.restaurant ?? name} · own menu (${platform.name} was blocked)`,
      context: `${platform.name} could not be read, so this is the restaurant's own menu. Dishes and prices on ${platform.name} may differ.`,
      notes: [`${platform.name} couldn’t be read, so this is the restaurant’s own menu from ${read.triedUrl}. Dishes and prices on ${platform.name} may differ.`, found.notes].filter(Boolean),
    };
  }

  // --- Anything else: a website, PDF or image link ---
  const read = await partsFromUrl(url);
  return { ...read, context: '', notes: [] };
}
