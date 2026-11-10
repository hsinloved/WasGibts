import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProfile, emptyProfile } from '../shared/model.js';
import { normalizeMenu } from '../shared/menu.js';
import { recommendLocally, matches } from '../shared/recommend.js';
import * as P from '../shared/profile.js';

const json = (f) => JSON.parse(readFileSync(new URL(`../shared/${f}`, import.meta.url)));
const menu = normalizeMenu(json('sample-menu.json'));
const seed = () => normalizeProfile(JSON.parse(readFileSync(new URL('./fixtures/sample-profile.json', import.meta.url))));
const realSeed = () => normalizeProfile(json('seed-profile.json'));

test('sample menu normalises with unique ids and provenance', () => {
  assert.equal(menu.dishes.length, 9);
  assert.equal(new Set(menu.dishes.map((d) => d.id)).size, 9);
  assert.ok(menu.dishes.every((d) => d.ingredients.every((i) => ['menu', 'typical'].includes(i.source))));
});

test('normalizeMenu never invents prices and dedupes ids', () => {
  const m = normalizeMenu({ dishes: [{ id: 'a', originalName: 'X', price: { amount: null } }, { id: 'a', originalName: 'Y' }] });
  assert.equal(m.dishes[0].price.amount, null);
  assert.deepEqual(m.dishes.map((d) => d.id), ['a', 'a-2']);
});

test('strict allergy keeps a dish out of picks and flags it', () => {
  const recs = recommendLocally(menu, seed(), { occasion: 'solo' });
  assert.ok(!recs.picks.some((p) => p.dishId === 'd2'), 'peanut chicken not recommended');
  assert.ok(recs.cautions.some((c) => c.dishId === 'd2' && /Menu lists peanuts/.test(c.reason)));
  assert.ok(recs.picks.length >= 3 && recs.picks.length <= 5);
});

test('every personal claim is backed by evidence', () => {
  const recs = recommendLocally(menu, seed(), { occasion: 'solo' });
  for (const p of recs.picks) {
    if (p.evidence.length) for (const e of p.evidence.filter((x) => x.type === 'preference')) assert.ok(e.ref);
  }
  assert.ok(recs.picks[0].evidence.length > 0);
});

test('occasion changes the picks', () => {
  const p = seed();
  const office = recommendLocally(menu, p, { occasion: 'office' }).picks.map((x) => x.dishId);
  assert.ok(!office.includes('d9'), 'no soup for office delivery');
});

test('dislikes become concerns', () => {
  const p = emptyProfile();
  P.addPreference(p, { polarity: 'dislike', category: 'style', subject: 'rich food' });
  P.addPreference(p, { polarity: 'like', category: 'ingredient', subject: 'tofu' });
  const small = { ...menu, dishes: menu.dishes.filter((d) => ['d1', 'd3', 'd9'].includes(d.id)) };
  const recs = recommendLocally(small, p, {});
  const mapo = recs.picks.find((x) => x.dishId === 'd3');
  assert.ok(mapo, 'tofu dish still shown on a short menu');
  assert.ok(mapo.concerns.some((c) => /rich/.test(c)));
});

test('a preference matching the whole menu goes in the headline, not every dish', () => {
  const recs = recommendLocally(menu, seed(), { occasion: 'solo' });
  assert.match(recs.headline, /Sichuan/);
  assert.ok(recs.picks.every((p) => !p.whyYou.includes('You like Sichuan')));
});

test('matches only on typical ingredients are hedged', () => {
  const p = emptyProfile();
  P.addPreference(p, { polarity: 'like', category: 'ingredient', subject: 'mushrooms' });
  const soup = recommendLocally(menu, p, {}).picks.find((x) => x.dishId === 'd9');
  assert.match(soup.whyYou, /menu doesn’t say/);
});

test('unknown occasion asks, and context-scoped preferences wait for an answer', () => {
  const recs = recommendLocally(menu, seed(), {});
  assert.ok(recs.occasionQuestion);
  assert.ok(!recs.picks.some((p) => /vegetable-forward dishes/.test(p.whyYou)), 'lunch-only preference not applied');
  assert.equal(recommendLocally(menu, seed(), { occasion: 'solo' }).occasionQuestion, null);
});

test('adventurous slot is filled when the profile asks for it', () => {
  const p = realSeed();
  const recs = recommendLocally(menu, p, { occasion: 'sharing' });
  assert.equal(recs.picks.filter((x) => x.role === 'A little adventure').length, 1);
  assert.ok(recs.picks.length <= 5);
});

test('real seed: fish matches fish dishes, hedges unverified likes, flags alcohol only when present', () => {
  const p = realSeed();
  const fishMenu = normalizeMenu({ dishes: [
    { id: 'a', originalName: 'Dorade vom Grill', translatedName: '烤鯛魚', glosses: [{ language: 'English', name: 'Grilled sea bream' }], ingredients: [{ name: 'sea bream', source: 'menu' }, { name: 'lemon', source: 'menu' }, { name: 'olive oil', source: 'menu' }], attributes: ['grilled', 'seafood', 'light'] },
    { id: 'b', originalName: 'Schweinebraten mit Dunkelbiersoße', ingredients: [{ name: 'pork', source: 'menu' }, { name: 'dark beer', source: 'menu' }], attributes: ['rich', 'meat-heavy'] },
    { id: 'c', originalName: 'Fischsemmel', ingredients: [{ name: 'shellfish', source: 'typical' }], attributes: [] },
  ] });
  const recs = recommendLocally(fishMenu, p, { occasion: 'solo' });
  const bream = recs.picks.find((x) => x.dishId === 'a');
  assert.equal(recs.picks[0].dishId, 'a');
  assert.match(bream.whyYou, /not confirmed yet/);
  assert.match(bream.whyYou, /olive oil and lemon/);
  assert.ok(recs.cautions.some((c) => c.dishId === 'b' && /Menu lists alcohol/.test(c.reason)), 'Dunkelbiersoße flagged as alcohol');
  assert.ok(recs.picks.some((x) => x.dishId === 'b'), 'flexible restriction flags but does not exclude');
  assert.equal(matches('fish', 'shellfish platter'), null);
  assert.equal(matches('fish', 'fish-fragrant aubergine'), null);
  assert.equal(matches('seafood mezze', 'fish poached in chilli oil', ['seafood'], 'dish'), null, 'a specific dish needs to be named');
  assert.equal(matches('rich, heavy dishes', 'pork belly', ['rich'], 'style'), 'rich');
  assert.ok(matches('fish', 'grilled fish of the day'));
  assert.ok(matches('mushroom', 'wood-ear mushrooms'));
  const tricky = normalizeMenu({ dishes: [{ id: 'r', originalName: 'Rumpsteak mit Champignons' }, { id: 'w', originalName: 'Weißwurst', menuDescription: 'mit Weißbier' }] });
  const flagged = recommendLocally(tricky, p, { occasion: 'solo' }).cautions.map((c) => c.dishId);
  assert.deepEqual(flagged, ['w']);
});

test('matches handles phrases, attributes and multi-word subjects', () => {
  assert.equal(matches('rich, heavy dishes', 'pork belly', ['rich']), 'rich');
  assert.ok(matches('Sichuan pepper', 'with sichuan pepper and chilli'));
  assert.ok(matches('black vinegar', 'cucumber · vinegar · black'));
  assert.equal(matches('coriander', 'tofu · chilli'), null);
});
