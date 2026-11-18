// Dish photos come only from the restaurant's own page (lib/photos.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachPhotos, nameKey } from '../lib/photos.js';
import { normalizeDish } from '../shared/menu.js';

const im = (alt, src) => ({ alt, card: alt, src });

test('names are compared without menu numbers, emoji or punctuation', () => {
  assert.equal(nameKey('4. Mulligatawn-Soup 🌶️🌶️'), 'mulligatawn soup');
  assert.equal(nameKey('Nr. 12 Samosa Chat'), 'samosa chat');
});

test('a dish gets the restaurant photo that names it', () => {
  const out = attachPhotos([{ originalName: 'Dal Ka Shorba' }, { originalName: 'Gulab Jamun' }], [
    im('1. Dal Ka Shorba', 'https://example.org/images/dal.png'), im('Logo', 'https://example.org/logo.png'),
  ]);
  assert.equal(out[0].image, 'https://example.org/images/dal.png');
  assert.equal(out[1].image, undefined, 'no photo is invented');
});

test('placeholders shared by several dishes and stock photos are not used', () => {
  const stock = 'https://images.unsplash.com/photo-1?w=600';
  const shared = 'https://example.org/images/default.png';
  const out = attachPhotos([{ originalName: 'Chicken Soup' }, { originalName: 'Pani Puri' }, { originalName: 'Samosa' }], [
    im('2. Chicken Soup', shared), im('10. Pani Puri', shared), im('11. Samosa', 'https://images.unsplash.com/photo-2'), im('x', stock),
  ]);
  assert.ok(out.every((d) => !d.image));
});

test('only https photo addresses survive normalisation', () => {
  assert.equal(normalizeDish({ image: 'https://example.org/a.png' }, 0).image, 'https://example.org/a.png');
  for (const bad of ['http://example.org/a.png', 'javascript:alert(1)', 'https://x.org/a.png" onerror="x', undefined]) assert.equal(normalizeDish({ image: bad }, 0).image, null, String(bad));
});
