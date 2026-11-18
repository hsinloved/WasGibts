// Post-generation guard (shared/guard.js) and the AI view's occasion rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { normalizeProfile, emptyProfile } from '../shared/model.js';
import { normalizeMenu } from '../shared/menu.js';
import { recommendLocally } from '../shared/recommend.js';
import { guardRecommendation, allowedRefsFrom, scrub } from '../shared/guard.js';
import * as P from '../shared/profile.js';
import { recommend } from '../lib/ai.js';

const menu = normalizeMenu(JSON.parse(readFileSync(new URL('../shared/sample-menu.json', import.meta.url))));
const seed = () => normalizeProfile(JSON.parse(readFileSync(new URL('./fixtures/sample-profile.json', import.meta.url))));
const byId = (id) => menu.dishes.find((d) => d.id === id);

/** A plausible AI answer that ignores the peanut allergy and over-claims. */
function sloppyAI(profile) {
  const mushroom = profile.preferences.find((p) => p.subject === 'mushrooms');
  return {
    engine: 'ai',
    headline: 'A Sichuan menu with lots for you.',
    picks: [
      { dishId: 'd2', role: 'Start here', whyYou: 'Spicy and cold, a classic.', evidence: [{ type: 'menu', ref: null, text: 'Chicken in chilli oil with peanuts.' }], concerns: [], occasionFit: '' },
      { dishId: 'd6', role: 'Safe bet', whyYou: 'You love aubergine. It is vegetarian. It is gluten-free and costs 9,90 €.', evidence: [
        { type: 'preference', ref: 'pref_does_not_exist', text: 'You love aubergine.' },
        { type: 'preference', ref: null, text: 'You like sweet and sour.' },
        { type: 'menu', ref: null, text: 'Topped with crumbled feta and walnuts.' },
        { type: 'menu', ref: null, text: 'Aubergine in a sweet-sour chilli sauce.' },
      ], concerns: [], occasionFit: '' },
      { dishId: 'd3', role: 'A little stretch', whyYou: 'Fermented and rich. 14,50 € well spent.', evidence: [{ type: 'preference', ref: mushroom.id, text: 'You like mushrooms.' }], concerns: [], occasionFit: '' },
      { dishId: 'd99', role: 'Ghost', whyYou: 'Not on the menu.', evidence: [], concerns: [], occasionFit: '' },
    ],
    cautions: [],
    orderingTip: 'Everything here is safe for you.',
    occasionQuestion: null,
  };
}

test('strict restrictions are enforced after generation, with a caution and a reason', () => {
  const p = seed();
  const out = guardRecommendation(sloppyAI(p), menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(P.profileForAI(p), p.restrictions) });
  assert.ok(!out.picks.some((x) => x.dishId === 'd2'), 'peanut chicken removed');
  assert.ok(out.cautions.some((c) => c.dishId === 'd2' && /peanuts/.test(c.reason)));
  assert.deepEqual(out.guard.removed.map((r) => [r.dishId, r.kind]), [['d2', 'restriction'], ['d99', 'unknown-dish']]);
});

test('restrictions kept private from the AI are still enforced in the browser', () => {
  const p = seed();
  p.settings.shareRestrictionsWithAI = false;
  const view = P.profileForAI(p);
  assert.equal(view.restrictions, null, 'the AI never saw the allergy');
  const out = guardRecommendation(sloppyAI(p), menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(view, p.restrictions) });
  assert.ok(!out.picks.some((x) => x.dishId === 'd2'));
});

test('evidence must cite real profile items and real menu facts', () => {
  const p = seed();
  const out = guardRecommendation(sloppyAI(p), menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(P.profileForAI(p), p.restrictions) });
  const aub = out.picks.find((x) => x.dishId === 'd6');
  const texts = aub.evidence.map((e) => e.text);
  assert.ok(!texts.includes('You love aubergine.'), 'unknown preference id dropped');
  assert.ok(!texts.includes('You like sweet and sour.'), 'personal claim without a ref dropped');
  assert.ok(!texts.some((t) => /feta/.test(t)), 'ingredient not on the dish dropped');
  assert.ok(texts.includes('Aubergine in a sweet-sour chilli sauce.'), 'grounded menu fact kept');
  const mapo = out.picks.find((x) => x.dishId === 'd3');
  assert.equal(mapo.evidence.length, 1, 'a real preference id is kept');
  assert.ok(out.guard.droppedEvidence >= 3);
});

test('invented prices and unbacked dietary assurances are removed; backed ones stay', () => {
  const p = seed();
  const out = guardRecommendation(sloppyAI(p), menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(P.profileForAI(p), p.restrictions) });
  const aub = out.picks.find((x) => x.dishId === 'd6');
  assert.match(aub.whyYou, /It is vegetarian\./, 'the menu prints "vegetarisch"');
  assert.doesNotMatch(aub.whyYou, /You love aubergine/, 'a personal claim with no surviving evidence is removed');
  assert.doesNotMatch(aub.whyYou, /gluten-free|9,90/, 'unprinted claim and wrong price removed');
  const mapo = out.picks.find((x) => x.dishId === 'd3');
  assert.match(mapo.whyYou, /14,50 €/, 'the real price stays');
  assert.equal(out.orderingTip, null, '"safe for you" is never backed by a menu');
  assert.equal(scrub('Gut. 12.90 € ist ok.', byId('d1'))[1], 1, 'a decimal point is not a sentence end');
  assert.equal(scrub('素食，不含肉。很好吃。', byId('d1'))[1], 1, 'Chinese claims are checked too');
});

test('the local matcher already satisfies the guard', () => {
  const p = seed();
  for (const occasion of [null, 'solo', 'office', 'sharing']) {
    const view = P.profileForAI(p, { occasion });
    const out = guardRecommendation(recommendLocally(menu, p, { occasion }), menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(view, p.restrictions) });
    assert.equal(out.guard.droppedEvidence, 0, `occasion ${occasion}`);
    assert.equal(out.guard.removed.length, 0);
  }
});

test('with no occasion, occasion-only preferences are listed apart and never citable', () => {
  const p = seed(); // "vegetable-forward dishes" applies only to quick lunches and office
  const view = P.profileForAI(p);
  assert.ok(!view.preferences.some((x) => x.like === 'vegetable-forward dishes'));
  assert.deepEqual(view.occasionDependent, [{ like: 'vegetable-forward dishes', onlyFor: ['quick', 'office'] }]);
  const pref = p.preferences.find((x) => x.subject === 'vegetable-forward dishes');
  const ai = { picks: [{ dishId: 'd1', role: 'x', whyYou: 'Veg.', evidence: [{ type: 'preference', ref: pref.id, text: 'You like vegetable-forward dishes.' }], concerns: [], occasionFit: '' }], cautions: [] };
  const out = guardRecommendation(ai, menu, { restrictions: p.restrictions, allowedRefs: allowedRefsFrom(view, p.restrictions) });
  assert.equal(out.picks[0].evidence.length, 0, 'cannot be cited when the occasion is unknown');
  assert.equal(P.profileForAI(p, { occasion: 'office' }).occasionDependent, undefined);
});

test('the AI view and the local matcher use the same preferences on every occasion', () => {
  const p = seed();
  for (const occasion of [null, 'solo', 'sharing', 'office', 'delivery', 'adventurous', 'quick']) {
    const ai = new Set(P.profileForAI(p, { occasion }).preferences.map((x) => x.id));
    const local = new Set(p.preferences.filter((x) => x.status !== 'dismissed' && !P.isEmerging(x) && P.appliesTo(x, occasion)).map((x) => x.id));
    assert.deepEqual([...ai].sort(), [...local].sort(), `occasion ${occasion}`);
  }
});

test('the server guards AI picks before they leave (stubbed OpenAI)', async () => {
  const p = seed();
  const view = P.profileForAI(p, { occasion: 'solo' });
  const server = createServer(async (req, res) => {
    for await (const _ of req); // drain
    const body = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(sloppyAI(p)) }] }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const saved = { ...process.env };
  Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
  try {
    const out = await recommend({ menu, profileView: view, occasion: 'solo' });
    assert.ok(!out.picks.some((x) => x.dishId === 'd2' || x.dishId === 'd99'));
    assert.ok(out.cautions.some((c) => c.dishId === 'd2'));
    assert.equal(out.engine, 'ai');
  } finally {
    server.close();
    for (const k of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});

test('an empty profile with no restrictions passes through untouched', () => {
  const out = guardRecommendation(recommendLocally(menu, emptyProfile(), {}), menu, { restrictions: [], allowedRefs: new Set() });
  assert.equal(out.guard.removed.length, 0);
});
