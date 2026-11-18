// Long text menus are read in parts (lib/ai.js splitMenuText / mergeMenus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { splitMenuText, mergeMenus, extractMenu } from '../lib/ai.js';

/** A made-up rendered shop page: sections, dish name, description, price, a basket button. */
function longPage(n = 90) {
  const lines = ['Page text:', 'ZUR GOLDENEN GABEL', 'Home', 'Menü'];
  for (let i = 1; i <= n; i++) {
    if (i % 10 === 1) lines.push(`Abschnitt ${Math.ceil(i / 10)}`, '10 Gerichte');
    lines.push(`${i}. Gericht ${i}`, '', `Beschreibung von Gericht ${i}.`, '', `€${(4 + (i % 20)).toFixed(2)}`, 'In den Korb');
  }
  lines.push('Impressum');
  return `<website_content>\nWebsite: https://example.org/menu\nTitle: Zur goldenen Gabel\n\n${lines.join('\n')}\n</website_content>`;
}

test('a short menu is read in one call', () => {
  assert.equal(splitMenuText([{ type: 'text', text: longPage(30) }]), null);
  assert.equal(splitMenuText([{ type: 'image', source: {} }]), null, 'photos are never split');
});

test('a long menu is split after price lines, keeping every dish whole', () => {
  const { chunks } = splitMenuText([{ type: 'text', text: longPage(90) }]);
  assert.equal(chunks.length, 3);
  for (const [i, c] of chunks.entries()) {
    assert.match(c, /^<website_content>\nWebsite: https:\/\/example\.org\/menu/, 'each part carries the header');
    assert.match(c, /<\/website_content>$/);
    if (i) assert.match(c, /\[End of the previous part, for context only/);
  }
  const own = chunks.map((c) => (c.includes('[This part:]') ? c.split('[This part:]\n').pop() : c));
  for (let d = 1; d <= 90; d++) {
    const holders = own.filter((c) => c.includes(`${d}. Gericht ${d}\n`));
    assert.equal(holders.length, 1, `dish ${d} in exactly one part`);
    assert.ok(holders[0].includes(`Beschreibung von Gericht ${d}.`), `dish ${d} keeps its description`);
  }
});

test('parts are merged in order with fresh ids and no duplicates', () => {
  const dish = (name, price) => ({ id: 'd1', section: 'S', originalName: name, price: { amount: price, display: `${price} €` } });
  const m = mergeMenus([
    { restaurant: { name: null, cuisine: 'Indian', menuLanguage: 'German', currency: 'EUR' }, dishes: [dish('A', 5), dish('B', 6)], notes: ['Drinks skipped.'] },
    { restaurant: { name: 'Zur goldenen Gabel', cuisine: null, menuLanguage: null, currency: null }, dishes: [dish('B', 6), dish('C', 7)], notes: ['Drinks skipped.'] },
  ]);
  assert.deepEqual(m.dishes.map((d) => [d.id, d.originalName]), [['d1', 'A'], ['d2', 'B'], ['d3', 'C']]);
  assert.deepEqual(m.restaurant, { name: 'Zur goldenen Gabel', cuisine: 'Indian', menuLanguage: 'German', currency: 'EUR' });
  assert.deepEqual(m.notes, ['Drinks skipped.']);
});

test('extraction of a long menu makes parallel calls and returns every dish (stubbed AI)', async () => {
  let calls = 0; let inFlight = 0; let maxInFlight = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const sent = JSON.parse(body).input[0].content.map((c) => c.text ?? '').join('\n');
    const own = sent.includes('[This part:]') ? sent.split('[This part:]\n').pop() : sent;
    const names = [...own.matchAll(/^(\d+)\. Gericht \d+$/gm)].map((m) => m[1]);
    const menu = { restaurant: { name: 'Zur goldenen Gabel', cuisine: null, menuLanguage: 'German', currency: 'EUR' }, notes: [], dishes: names.map((n) => ({ id: 'x', section: null, originalName: `${n}. Gericht ${n}`, translatedName: null, glosses: [], menuDescription: null, price: { amount: 5, currency: 'EUR', display: null }, explanation: '', ingredients: [], preparation: [], flavours: [], textures: [], cuisine: null, region: null, culturalNote: null, attributes: [], dietary: { menuStated: [], likely: [] }, uncertainty: null })) };
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(menu) }] }] }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const saved = { ...process.env };
  Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
  try {
    const menu = await extractMenu({ parts: [{ type: 'text', text: longPage(90) }] });
    assert.equal(calls, 3);
    assert.ok(maxInFlight > 1, 'parts are read at the same time');
    assert.equal(menu.dishes.length, 90);
    assert.deepEqual(menu.dishes.slice(0, 2).map((d) => d.id), ['d1', 'd2']);
    assert.equal(menu.dishes[89].originalName, '90. Gericht 90');
  } finally {
    server.close();
    for (const k of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});
