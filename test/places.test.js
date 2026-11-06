import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMapsUrl, parseMapsUrl, platformFor, nameFromPlatformUrl, splitSharedText } from '../lib/places.js';
import { htmlToText } from '../lib/sources.js';

test('recognises Google Maps links in their common shapes', () => {
  for (const u of [
    'https://maps.app.goo.gl/AbC123xyz',
    'https://goo.gl/maps/AbC123',
    'https://www.google.com/maps/place/Restaurant+Lenbach/@48.14,11.56,17z',
    'https://www.google.de/maps/place/Xyz',
    'https://maps.google.com/?q=Schneider+Br%C3%A4uhaus',
    'https://consent.google.com/m?continue=https://www.google.com/maps/place/Foo',
  ]) assert.ok(isMapsUrl(u), u);
  assert.ok(!isMapsUrl('https://www.google.com/search?q=pizza'));
  assert.ok(!isMapsUrl('https://goo.gl/abc'));
  assert.ok(!isMapsUrl('https://restaurant.de/maps'));
});

test('parses place name and coordinates', () => {
  const p = parseMapsUrl('https://www.google.com/maps/place/Schneider+Br%C3%A4uhaus+M%C3%BCnchen/@48.1371,11.5754,17z/data=!3m1!4b1');
  assert.equal(p.name, 'Schneider Bräuhaus München');
  assert.equal(p.lat, 48.1371);
  assert.equal(p.lng, 11.5754);
  assert.equal(parseMapsUrl('https://maps.google.com/?q=Pizzeria+Bella').name, 'Pizzeria Bella');
  assert.equal(parseMapsUrl('https://consent.google.com/m?continue=' + encodeURIComponent('https://www.google.com/maps/place/Café+Luitpold/@48.14,11.57,17z')).name, 'Café Luitpold');
  assert.equal(parseMapsUrl('https://www.google.com/maps/search/?api=1&query=Tantris&query_place_id=ChIJ123').placeId, 'ChIJ123');
});

test('splits text shared from the Maps app', () => {
  const r = splitSharedText('Ristorante Da Mario\nAdalbertstraße 2, 80799 München\nhttps://maps.app.goo.gl/xyz123');
  assert.equal(r.url, 'https://maps.app.goo.gl/xyz123');
  assert.equal(r.name, 'Ristorante Da Mario');
  assert.equal(r.address, 'Adalbertstraße 2, 80799 München');
  assert.deepEqual(splitSharedText(''), { url: null, name: null, address: null });
});

test('detects delivery platforms and derives a name from the slug', () => {
  assert.equal(platformFor('https://www.lieferando.de/speisekarte/sushi-ya-muenchen')?.name, 'Lieferando');
  assert.equal(platformFor('https://wolt.com/de/deu/munich/restaurant/the-italian-shot')?.name, 'Wolt');
  assert.equal(platformFor('https://www.ubereats.com/de/store/burger-haus/abc')?.name, 'Uber Eats');
  assert.equal(platformFor('https://www.restaurant-lieferando-fan.de/'), null);
  assert.equal(nameFromPlatformUrl('https://www.lieferando.de/speisekarte/sushi-ya-muenchen'), 'Sushi Ya Muenchen');
  assert.equal(nameFromPlatformUrl('https://wolt.com/de/deu/munich/restaurant/the-italian-shot'), 'The Italian Shot');
  assert.equal(nameFromPlatformUrl('https://www.ubereats.com/de/store/burger-haus/a1b2c3d4e5'), 'Burger Haus');
});

test('embedded page JSON (delivery platforms) is kept for the extractor', () => {
  const data = JSON.stringify({ props: { menu: [{ name: 'Pad Thai', price: 12.9 }] }, pad: 'x'.repeat(300) });
  const html = `<html><body><div id="root"></div><script id="__NEXT_DATA__" type="application/json">${data}</script><script>var x=1</script></body></html>`;
  const r = htmlToText(html, 'https://www.lieferando.de/speisekarte/x');
  assert.match(r.embedded, /Pad Thai/);
  assert.doesNotMatch(r.text, /Pad Thai/);
});
