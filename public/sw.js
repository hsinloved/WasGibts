// WasGibts service worker. Its only job is the share target: when the user
// shares a link, text or screenshots into the installed app, stash them and
// hand them to the page. Nothing else is cached; the app always loads fresh.

const SHARE_CACHE = 'wasgibts-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const cache = await caches.open(SHARE_CACHE);
      for (const key of await cache.keys()) await cache.delete(key);
      const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: [], at: Date.now() };
      const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size);
      for (const [i, f] of files.slice(0, 8).entries()) {
        const key = `/__share/file-${i}`;
        await cache.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || `page-${i + 1}`) } }));
        meta.files.push(key);
      }
      await cache.put('/__share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect('/?share=1', 303);
    } catch {
      return Response.redirect('/?share=failed', 303);
    }
  })());
});
