// Menu history (public/js/menu-history.js), run against a fake localStorage.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
let quota = Infinity;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (v.length > quota) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;
const { menuHistory } = await import('../public/js/menu-history.js');

const menu = (name, url, n = 3) => ({ restaurant: { name, cuisine: 'Indian' }, source: { kind: 'website', label: name, url }, dishes: Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, originalName: `Dish ${i + 1}` })) });
const recs = { picks: [{ dishId: 'd2' }, { dishId: 'd1' }] };

beforeEach(() => { mem.clear(); quota = Infinity; });

test('a read menu is saved with its picks, newest first, and the same source replaces itself', () => {
  menuHistory.save({ menu: menu('A', 'https://a.example/menu'), recs });
  menuHistory.save({ menu: menu('B', 'https://b.example/menu'), recs });
  const id = menuHistory.save({ menu: menu('A again', 'https://a.example/menu'), recs: { picks: [] } });
  const list = menuHistory.list();
  assert.deepEqual(list.map((e) => e.name), ['A again', 'B']);
  assert.equal(menuHistory.get(id).menu.dishes.length, 3);
  assert.deepEqual(list[1].topPicks, ['Dish 2', 'Dish 1']);
});

test('the sample menu is never saved; remove and clear work', () => {
  assert.equal(menuHistory.save({ menu: { ...menu('S', null), source: { kind: 'sample' } }, recs }), null);
  const id = menuHistory.save({ menu: menu('A', 'https://a.example/menu'), recs });
  menuHistory.save({ menu: menu('B', 'https://b.example/menu'), recs });
  menuHistory.remove(id);
  assert.deepEqual(menuHistory.list().map((e) => e.name), ['B']);
  menuHistory.clear();
  assert.deepEqual(menuHistory.list(), []);
});

test('at most 15 menus, and the oldest go first when storage is full', () => {
  for (let i = 0; i < 20; i++) menuHistory.save({ menu: menu(`M${i}`, `https://m${i}.example/`), recs });
  assert.equal(menuHistory.list().length, 15);
  assert.equal(menuHistory.list()[0].name, 'M19');
  quota = JSON.stringify(menuHistory.list().slice(0, 3)).length + 2000;
  menuHistory.save({ menu: menu('Big', 'https://big.example/', 5), recs });
  const names = menuHistory.list().map((e) => e.name);
  assert.equal(names[0], 'Big');
  assert.ok(names.length < 15 && names.length >= 1);
});
