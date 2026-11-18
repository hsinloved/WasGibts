// Matches dish photos found on a restaurant's own page to extracted dishes.
// Only the restaurant's photos are used: nothing is generated or searched for,
// so a picture always shows what that restaurant actually serves.

const STOCK = /^https:\/\/(?:[\w-]+\.)*(?:unsplash\.com|pexels\.com|pixabay\.com|shutterstock\.com|istockphoto\.com|gettyimages\.\w+|freepik\.com|stock\.adobe\.com|depositphotos\.com)\//i;

/** "2. Chicken Soup 🌶️🌶️" → "chicken soup" */
export function nameKey(s) {
  return String(s ?? '').toLowerCase()
    .replace(/^\s*(?:nr\.?\s*)?\d+[a-z]?\s*[.):-]?\s*/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * @param dishes  normalised dishes
 * @param images  [{ src, alt, card }] from the rendered page
 * @returns dishes, with `image` set where exactly one photo names the dish
 */
export function attachPhotos(dishes, images = []) {
  if (!images.length) return dishes;
  // A photo shown for several dishes is a placeholder, and stock-photo sites
  // show *a* dish, not this one: neither is a picture of what you'd get.
  const uses = new Map();
  for (const im of images) uses.set(im.src, (uses.get(im.src) ?? 0) + 1);
  const candidates = images
    .filter((im) => /^https:\/\//.test(im.src) && uses.get(im.src) === 1 && !STOCK.test(im.src) && !/logo|icon|avatar|sprite|placeholder/i.test(im.src))
    .map((im) => ({ src: im.src, keys: [nameKey(im.alt), nameKey(String(im.card).split('\n')[0])].filter((k) => k.length >= 3) }));
  const used = new Set();
  return dishes.map((d) => {
    if (d.image) return d;
    const key = nameKey(d.originalName);
    if (key.length < 3) return d;
    const hits = candidates.filter((c) => !used.has(c.src) && c.keys.some((k) => k === key));
    const pick = hits.length ? hits[0] : null;
    if (!pick) return d;
    used.add(pick.src);
    return { ...d, image: pick.src };
  });
}
