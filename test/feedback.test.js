// Feedback that separates lasting taste from a passing craving or a good fit
// for the moment, and keeps every piece of evidence reversible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, makeHistoryEntry, normalizeProfile } from '../shared/model.js';
import * as P from '../shared/profile.js';

const noodles = { originalName: '担担面 Dan Dan Mian', translatedName: 'Dan dan noodles', cuisine: 'Sichuan', ingredients: ['wheat noodles', 'minced pork', 'chilli oil'], attributes: ['spicy', 'filling'] };
const order = (p, fields = {}) => P.recordHistory(p, { action: 'ordered', dish: noodles, restaurant: { name: 'Haus Zhang' }, ...fields });
const pref = (p, subject) => p.preferences.find((x) => x.subject === subject);

test('"Right for the moment" likes the dish on that occasion only, with no ingredient spread', () => {
  const p = emptyProfile();
  const e = order(p, { occasion: 'office' });
  const { touched } = P.applyFeedback(p, e.id, ['right_for_moment']);
  assert.equal(touched.length, 1);
  const dish = pref(p, 'Dan dan noodles');
  assert.equal(dish.category, 'dish');
  assert.deepEqual(dish.contexts, ['office']);
  assert.match(dish.evidence[0].note, /Right for the moment — Dan dan noodles at Haus Zhang \(for office lunch only\)|\(for .* only\)/);
  assert.ok(!pref(p, 'wheat noodles') && !pref(p, 'spicy'), 'nothing inferred about ingredients or style');
  // Scoped: it does not apply on other occasions.
  assert.ok(P.appliesTo(dish, 'office') && !P.appliesTo(dish, 'solo'));
});

test('"Right for the moment" with no occasion counts half and stays unscoped', () => {
  const p = emptyProfile();
  const e = order(p);
  P.applyFeedback(p, e.id, ['right_for_moment']);
  const dish = pref(p, 'Dan dan noodles');
  assert.deepEqual(dish.contexts, []);
  assert.equal(dish.evidence[0].weight, 0.5);
  assert.match(dish.evidence[0].note, /occasion unknown; counts half/);
});

test('loving a dish ordered for a craving counts half towards lasting taste', () => {
  const plain = emptyProfile();
  P.applyFeedback(plain, order(plain).id, ['loved']);
  const craved = emptyProfile();
  const e = order(craved, { context: { hunger: 'very hungry', cravings: ['something starchy'], matched: ['something starchy'] } });
  P.applyFeedback(craved, e.id, ['loved']);
  for (const subject of ['wheat noodles', 'spicy']) {
    assert.equal(pref(craved, subject).evidence[0].weight, pref(plain, subject).evidence[0].weight / 2, subject);
    assert.ok(pref(craved, subject).confidence <= pref(plain, subject).confidence);
  }
  assert.match(pref(craved, 'spicy').evidence[0].note, /ordered while craving something starchy; counts half/);
});

test('a craving the dish did not answer does not discount it; "order again" is about the dish and is never discounted', () => {
  const p = emptyProfile();
  const e = order(p, { context: { cravings: ['something sweet'], matched: [] } });
  P.applyFeedback(p, e.id, ['loved', 'order_again']);
  assert.equal(pref(p, 'spicy').evidence[0].weight, 0.5);
  const q = emptyProfile();
  const f = order(q, { context: { cravings: ['something starchy'], matched: ['something starchy'] } });
  P.applyFeedback(q, f.id, ['order_again']);
  assert.equal(pref(q, 'Dan dan noodles').evidence[0].weight, 1.5);
});

test('evidence stays reversible: changing or removing feedback withdraws it', () => {
  const p = emptyProfile();
  const e = order(p, { occasion: 'office', context: { cravings: ['something starchy'], matched: ['something starchy'] } });
  P.applyFeedback(p, e.id, ['loved', 'right_for_moment']);
  assert.ok(pref(p, 'Dan dan noodles') && pref(p, 'spicy'));
  P.applyFeedback(p, e.id, ['right_for_moment']);
  assert.ok(!pref(p, 'spicy'), 'the ingredient guess is withdrawn');
  assert.ok(pref(p, 'Dan dan noodles'));
  P.removeHistory(p, e.id);
  assert.equal(p.preferences.length, 0);
});

test('the order context is stored as plain words and survives a round trip', () => {
  const e = makeHistoryEntry({ dish: noodles, context: { hunger: 'already eaten', cravings: ['something sweet', 42], avoid: ['fish'], matched: [], junk: 'x' } });
  assert.deepEqual(e.context, { hunger: 'already eaten', sharing: null, novelty: null, cravings: ['something sweet', '42'], avoid: ['fish'], matched: [] });
  assert.equal(makeHistoryEntry({ dish: noodles, context: {} }).context, null);
  assert.equal(makeHistoryEntry({ dish: noodles }).context, null, 'old entries have none');
  const p = emptyProfile(); p.history.push(e);
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p))).history[0].context, e.context);
});

test('the AI sees which past orders answered a craving', () => {
  const p = emptyProfile();
  const e = order(p, { occasion: 'solo', context: { cravings: ['something starchy'], matched: ['something starchy'] } });
  P.applyFeedback(p, e.id, ['loved']);
  const h = P.profileForAI(p).recentOrders[0];
  assert.deepEqual(h.orderedWhileCraving, ['something starchy']);
  assert.equal(h.occasion, 'solo');
});

test('a durable "Right for the moment" preference is visible and dismissable like any other', () => {
  const p = emptyProfile();
  P.applyFeedback(p, order(p, { occasion: 'office' }).id, ['right_for_moment']);
  const dish = pref(p, 'Dan dan noodles');
  assert.equal(dish.origin, 'inferred');
  assert.equal(dish.status, 'suggested', 'a suggestion until confirmed');
  P.dismissPreference(p, dish.id);
  assert.equal(pref(p, 'Dan dan noodles').status, 'dismissed');
});
