// Online-shop platforms (FoodAmigos) whose menu loads from an API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foodamigosMenuText, shopFor, SHOP_PLATFORMS } from '../lib/shops.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/foodamigos-menus.json', import.meta.url)));
const SHELL = '<html><head><script type="module" src="https://www.foodamigos-storefront-online-shop.com/assets/index.js"></script></head><body><div id="root"></div></body></html>';

test('a FoodAmigos storefront shell is recognised; ordinary pages are not', () => {
  assert.equal(shopFor(SHELL, 'https://www.example.de/speisekarte')?.name, 'FoodAmigos');
  assert.equal(shopFor('<html><body><h1>Speisekarte</h1></body></html>', 'https://x.de/'), null);
});

test('menu JSON becomes readable sections in menu order, without the "most popular" repeats', () => {
  const { text, dishes } = foodamigosMenuText(fixture, { name: 'Test Grill', currency: 'EUR' });
  assert.equal(dishes, 3);
  assert.match(text, /^Restaurant: Test Grill/);
  assert.ok(text.indexOf('## Vorspeisen') < text.indexOf('## Suppen'), 'sorted by sorting_order');
  assert.doesNotMatch(text, /Am Beliebtesten/);
  assert.doesNotMatch(text, /Versteckt/, 'categories outside every menu are left out');
  assert.match(text, /- 10\. Pho Bo — 12,90 € — Rinderbrühe mit Reisnudeln — ingredients: Rindfleisch, Reisnudeln, Koriander — allergens: celery, soy/);
  assert.match(text, /- 11\. Pho Ga — 11,50 € — \(currently unavailable\)/);
  assert.match(text, /- V1\. Sommerrollen — 6,00 € — allergens: peanuts/);
  assert.equal((text.match(/Pho Bo/g) || []).length, 1, 'no duplicates');
});

test('read() finds the company by hostname, then fetches its menu', async () => {
  const asked = [];
  const fetchJson = async (url) => {
    asked.push(url);
    if (url.includes('/franchises?hostname=')) return { data: { name: 'Grill', companies: [{ id: 1799, slug: 'annamgrill', name: 'ANNAM GRILL' }] } };
    if (url.endsWith('/companies/1799/menus')) return fixture;
    throw new Error(`unexpected ${url}`);
  };
  const r = await SHOP_PLATFORMS[0].read('https://www.annamgrill.de/speisekarte', fetchJson);
  assert.equal(asked[0], 'https://app.foodamigos.io/api/franchises?hostname=www.annamgrill.de');
  assert.equal(r.name, 'ANNAM GRILL');
  assert.match(r.text, /Pho Bo/);
});

test('read() returns null when the shop has no company or no dishes', async () => {
  assert.equal(await SHOP_PLATFORMS[0].read('https://x.de/', async () => ({ data: { companies: [] } })), null);
  const empty = async (url) => (url.includes('franchises') ? { data: { companies: [{ id: 1 }] } } : { data: { menus: [], categories: {}, products: {} } });
  assert.equal(await SHOP_PLATFORMS[0].read('https://x.de/', empty), null);
});
