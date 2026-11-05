import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProfile, emptyProfile } from '../shared/model.js';
import * as P from '../shared/profile.js';

const seed = () => normalizeProfile(JSON.parse(readFileSync(new URL('../shared/seed-profile.json', import.meta.url))));
const dish = { originalName: 'Mapo Doufu', translatedName: 'Mapo tofu', cuisine: 'Sichuan', ingredients: ['silken tofu', 'doubanjiang'], attributes: ['spicy', 'rich'] };

test('seed loads as explicit, active preferences with evidence and history', () => {
  const p = seed();
  assert.ok(p.preferences.length > 0);
  for (const x of p.preferences) {
    assert.equal(x.origin, 'explicit');
    assert.equal(x.status, 'active');
    assert.equal(x.evidence[0].source, 'seed');
    assert.equal(x.history[0].action, 'created');
  }
  assert.equal(p.restrictions[0].type, 'allergy');
});

test('recording an order alone never changes preferences', () => {
  const p = emptyProfile();
  P.recordHistory(p, { action: 'ordered', dish, recommended: true });
  assert.equal(p.preferences.length, 0);
});

test('feedback creates suggested, capped, inferred preferences with evidence', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish, restaurant: { name: 'Haus Zhang' } });
  const { touched } = P.applyFeedback(p, e.id, ['too_rich']);
  assert.equal(touched.length, 1);
  const pref = touched[0];
  assert.equal(pref.origin, 'inferred');
  assert.equal(pref.status, 'suggested');
  assert.equal(pref.polarity, 'dislike');
  assert.equal(pref.evidence[0].ref, e.id);
  assert.match(pref.evidence[0].note, /Too rich — Mapo tofu at Haus Zhang/);
  assert.ok(pref.confidence <= P.INFERRED_CAP);
});

test('inferred confidence grows with repeated feedback but stays capped until confirmed', () => {
  const p = emptyProfile();
  for (let i = 0; i < 10; i++) {
    const e = P.recordHistory(p, { action: 'ordered', dish: { ...dish, originalName: `Dish ${i}` } });
    P.applyFeedback(p, e.id, ['wanted_veg']);
  }
  const pref = P.findPreference(p, { subject: 'vegetable-forward dishes', polarity: 'like' });
  assert.equal(pref.confidence, P.INFERRED_CAP);
  assert.equal(pref.status, 'suggested');
  P.confirmPreference(p, pref.id);
  assert.equal(pref.status, 'active');
  assert.ok(pref.confidence >= 0.85);
  assert.equal(pref.history.at(-1).action, 'confirmed');
});

test('"not today" is recorded but teaches nothing', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['not_today']);
  assert.deepEqual(p.history[0].feedback, ['not_today']);
  assert.equal(p.preferences.length, 0);
});

test('re-rating replaces earlier feedback instead of double counting', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['order_again']);
  P.applyFeedback(p, e.id, ['order_again']);
  const pref = P.findPreference(p, { subject: 'Mapo tofu', polarity: 'like' });
  assert.equal(pref.evidence.length, 1);
  P.applyFeedback(p, e.id, ['disliked']);
  assert.equal(P.findPreference(p, { subject: 'Mapo tofu', polarity: 'like' }), undefined, 'withdrawn suggestion disappears');
  assert.ok(P.findPreference(p, { subject: 'Mapo tofu', polarity: 'dislike' }));
});

test('removing a history entry withdraws what it taught', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['loved']);
  assert.ok(p.preferences.length > 0);
  P.removeHistory(p, e.id);
  assert.equal(p.preferences.length, 0);
  assert.equal(p.history.length, 0);
});

test('dismissed patterns stay dismissed when new evidence arrives', () => {
  const p = emptyProfile();
  const a = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, a.id, ['too_spicy']);
  const pref = P.findPreference(p, { subject: 'strong chilli heat', polarity: 'dislike' });
  P.dismissPreference(p, pref.id);
  const b = P.recordHistory(p, { action: 'ordered', dish: { ...dish, originalName: 'Other' } });
  P.applyFeedback(p, b.id, ['too_spicy']);
  assert.equal(pref.status, 'dismissed');
  assert.equal(pref.evidence.length, 2);
});

test('feedback on an explicit preference adds evidence but keeps it explicit', () => {
  const p = emptyProfile();
  const stated = P.addPreference(p, { polarity: 'like', category: 'style', subject: 'Vegetable-forward dishes' });
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['wanted_veg']);
  assert.equal(stated.origin, 'explicit');
  assert.equal(stated.evidence.length, 2);
  assert.equal(p.preferences.length, 1);
});

test('correcting an inferred preference makes it explicit and logs the change', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  const { touched: [pref] } = P.applyFeedback(p, e.id, ['too_rich']);
  P.updatePreference(p, pref.id, { subject: 'cream sauces' });
  assert.equal(pref.origin, 'explicit');
  assert.equal(pref.status, 'active');
  assert.match(pref.history.at(-1).detail, /subject: rich, heavy dishes → cream sauces/);
});

test('stating something already inferred promotes it rather than duplicating', () => {
  const p = emptyProfile();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['wanted_veg']);
  const promoted = P.addPreference(p, { polarity: 'like', subject: 'vegetable-forward dishes', category: 'style' });
  assert.equal(p.preferences.length, 1);
  assert.equal(promoted.origin, 'explicit');
});

test('profileForAI hides dismissed, emerging and out-of-context items, and withholds restrictions on request', () => {
  const p = seed();
  const view = P.profileForAI(p, { occasion: 'solo' });
  assert.ok(!view.preferences.some((x) => x.like === 'vegetable-forward dishes'), 'lunch-only preference excluded at dinner');
  assert.ok(P.profileForAI(p, { occasion: 'quick' }).preferences.some((x) => x.like === 'vegetable-forward dishes'));
  assert.ok(view.restrictions.length > 0);
  p.settings.shareRestrictionsWithAI = false;
  const hidden = P.profileForAI(p);
  assert.equal(hidden.restrictions, null);
  assert.equal(hidden.restrictionsWithheld, true);

  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['liked']); // weak signals only
  assert.ok(!P.profileForAI(p).preferences.some((x) => x.source.startsWith('unconfirmed')), 'emerging signals are not sent');
});

test('export round-trips through normalizeProfile', () => {
  const p = seed();
  const e = P.recordHistory(p, { action: 'ordered', dish });
  P.applyFeedback(p, e.id, ['loved', 'too_rich'], 'great but heavy');
  const again = normalizeProfile(JSON.parse(JSON.stringify(P.exportProfile(p))));
  assert.deepEqual(again.preferences, p.preferences);
  assert.deepEqual(again.history, p.history);
});
