// The behavioural scenarios from the recommendation review, on fictional menus
// (test/fixtures/menus.js). Each runs the same path the browser uses:
// shared/pipeline.js → AI (stubbed or absent) or local matcher → guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from './fixtures/menus.js';
import { emptyProfile } from '../shared/model.js';
import * as P from '../shared/profile.js';
import * as S from '../shared/session.js';
import { choosePicks } from '../shared/pipeline.js';

const say = (...lines) => lines.reduce((s, t) => S.applyStatement(s, t).session, S.emptySession());
const named = (menu, recs) => recs.picks.map((p) => menu.dishes.find((d) => d.id === p.dishId).originalName);
const idOf = (menu, name) => menu.dishes.find((d) => d.originalName === name).id;
const comboNames = (menu, c) => c.dishIds.map((id) => menu.dishes.find((d) => d.id === id).originalName);
const NUTRITION = /calorie|kcal|kalorie|macro|grams? of protein|low[- ]carb|healthy|healthier|diet\b/iu;
const profileWith = (...prefs) => { const p = emptyProfile(); for (const [polarity, subject] of prefs) P.addPreference(p, { polarity, category: 'ingredient', subject }); return p; };
const allText = (recs) => [recs.headline, ...recs.picks.flatMap((p) => [p.whyYou, ...p.concerns]), ...(recs.combos ?? []).map((c) => c.why)].join(' ');

test('1 · Taverna Melina: office lunch, sharing, likes seafood', async () => {
  const menu = M.tavernaMelina();
  const recs = await choosePicks({ menu, profile: profileWith(['like', 'seafood']), occasion: 'sharing', session: say('lunch with colleagues from the office, we’re sharing for the table') });
  const top3 = named(menu, recs).slice(0, 3);
  assert.deepEqual(top3.sort(), ['Garides Saganaki', 'Kalamarakia', 'Oktapodi'], 'shareable seafood plates lead');
  const plates = recs.combos.find((c) => c.title === 'A few plates for the table');
  assert.ok(plates && plates.dishIds.length >= 3, 'a set of plates for the table');
  assert.ok(comboNames(menu, plates).every((n) => menu.dishes.find((d) => d.originalName === n).attributes.includes('shareable')));
  assert.ok(!recs.combos.some((c) => c.title === 'Main + a small side'), 'no individual main + side at a shared table');
});

test('2 · Baumkirchners: dinner already eaten, then protein, then a carb craving', async () => {
  const menu = M.baumkirchners();
  const profile = emptyProfile();
  let s = say('I’ve already eaten');
  const a = await choosePicks({ menu, profile, session: s });
  assert.ok(!named(menu, a).slice(0, 3).some((n) => ['Schweinebraten mit Knödel', 'Käsespätzle'].includes(n)), 'no second dinner on top');
  assert.ok(a.combos.some((c) => c.title === 'Just something sweet'));
  assert.ok(!a.combos.some((c) => c.title === 'Main + a small side'));

  s = S.applyStatement(s, 'I’d like more protein').session;
  const b = await choosePicks({ menu, profile, session: s });
  assert.ok(named(menu, b).slice(0, 2).includes('Hähnchenbrust vom Grill'), 'a light protein dish rises');
  assert.equal(s.hunger, 'ate', 'still already eaten');

  const { session: s3, entry } = S.applyStatement(s, 'Actually I want something starchy');
  assert.equal(entry.kind, 'correction');
  const c = await choosePicks({ menu, profile, session: s3 });
  assert.match(c.picks[0].whyYou, /something starchy today/);
  assert.deepEqual(s3.cravings, ['protein', 'starchy'], 'both wants kept, in order');
  for (const r of [a, b, c]) assert.doesNotMatch(allText(r), NUTRITION, 'never optimises calories or protein on its own');
  assert.ok(!named(menu, c).includes('Weißbier 0,5 l') && !c.combos.some((x) => comboNames(menu, x).includes('Weißbier 0,5 l')), 'drinks are not dinner');
});

test('3 · Zum Goldenen Curry: a warm vegetable meal today beats a stored fish preference', async () => {
  const menu = M.zumGoldenenCurry();
  const profile = profileWith(['like', 'fish']);
  const base = await choosePicks({ menu, profile });
  assert.equal(named(menu, base)[0], 'Goa Fisch-Curry', 'without context, the fish preference leads');
  const recs = await choosePicks({ menu, profile, session: say('I’d like a warm vegetable dish') });
  const names = named(menu, recs);
  assert.ok(['Chana Masala', 'Gemüse-Korma'].includes(names[0]), `a warm vegetable curry first, got ${names[0]}`);
  assert.ok(names.includes('Goa Fisch-Curry'), 'fish is not excluded, only outranked');
  assert.ok(!names.includes('Butter Chicken'), 'tomato sauce does not make a dish a vegetable dish');
  assert.ok(P.profileForAI(profile).preferences.some((x) => x.like === 'fish'), 'the fish preference is untouched');
});

test('4 · a normally loved ingredient, not today', async () => {
  const menu = M.tavernaMelina();
  const profile = profileWith(['like', 'lamb']);
  const before = JSON.stringify(profile);
  const usual = await choosePicks({ menu, profile });
  assert.equal(named(menu, usual)[0], 'Lamm Kleftiko');
  const today = await choosePicks({ menu, profile, session: say('no lamb today') });
  assert.ok(!named(menu, today).includes('Lamm Kleftiko'));
  assert.ok(!today.combos.some((c) => comboNames(menu, c).includes('Lamm Kleftiko')));
  assert.deepEqual(today.setAside, [{ dishId: idOf(menu, 'Lamm Kleftiko'), reason: 'no lamb today' }]);
  assert.match(today.headline, /though you usually like it; your profile is unchanged/);
  assert.equal(JSON.stringify(profile), before);
  assert.equal(named(menu, await choosePicks({ menu, profile, session: S.emptySession() }))[0], 'Lamm Kleftiko', 'back next time');
});

test('5 · a strict restriction is enforced after the AI answers', async () => {
  const menu = M.tavernaMelina();
  const profile = emptyProfile();
  P.addRestriction(profile, { type: 'allergy', subject: 'shellfish', severity: 'strict' });
  profile.settings.shareRestrictionsWithAI = false; // the AI never even heard about it
  const prawns = idOf(menu, 'Garides Saganaki');
  const recs = await choosePicks({ menu, profile, ai: async (view) => {
    assert.equal(view.restrictions, null);
    return { headline: 'Seafood!', picks: [
      { dishId: prawns, role: 'Start here', whyYou: 'Prawns in a rich sauce.', evidence: [], concerns: [], occasionFit: '' },
      { dishId: idOf(menu, 'Gigantes'), role: 'Safe bet', whyYou: 'Baked beans.', evidence: [], concerns: [], occasionFit: '' },
    ], combos: [{ title: 'Seafood trio', dishIds: [prawns, idOf(menu, 'Oktapodi'), idOf(menu, 'Kalamarakia')], why: 'All the seafood.' }], cautions: [], orderingTip: null, occasionQuestion: null };
  } });
  assert.deepEqual(named(menu, recs), ['Gigantes']);
  assert.ok(recs.cautions.some((c) => c.dishId === prawns && /shellfish/.test(c.reason)));
  assert.deepEqual(recs.combos, [], 'a combination containing the prawns is dropped');
  assert.equal(recs.guard.removed[0].kind, 'restriction');
});

test('6 · the AI fails while a craving is set: the matcher honours it and says what it could not read', async () => {
  const menu = M.baumkirchners();
  const { session, entry } = S.applyStatement(S.emptySession(), 'I want something sweet and something that goes with a Weißbier');
  assert.deepEqual(session.cravings, ['sweet']);
  assert.deepEqual(entry.unparsed, ['something that goes with a weißbier'], 'disclosed, not guessed');
  const recs = await choosePicks({ menu, profile: emptyProfile(), session, ai: async () => { throw new Error('AI timed out'); } });
  assert.equal(recs.fallbackReason, 'AI timed out');
  assert.equal(recs.engine, 'local');
  assert.deepEqual(named(menu, recs).slice(0, 2).sort(), ['Apfelstrudel', 'Kaiserschmarrn']);
  assert.ok(recs.combos.some((c) => c.title === 'Save room for dessert'));
});

test('combinations only use dishes that passed every check', async () => {
  for (const make of [M.tavernaMelina, M.baumkirchners, M.zumGoldenenCurry]) {
    const menu = make();
    const profile = emptyProfile();
    P.addRestriction(profile, { type: 'allergy', subject: 'nuts', severity: 'strict' });
    for (const s of [S.emptySession(), say('I can share my partner’s food'), say('I’ve already eaten'), say('we’re sharing for the table'), say('something sweet')]) {
      const recs = await choosePicks({ menu, profile, session: s });
      for (const c of recs.combos) {
        assert.ok(c.dishIds.length >= 1 && c.why);
        for (const id of c.dishIds) assert.doesNotMatch(menu.dishes.find((d) => d.id === id).ingredients.map((x) => x.name).join(' '), /walnut|cashew/, `${menu.restaurant.name}: ${c.title}`);
      }
    }
  }
});

test('sharing a partner’s food: your veg plate plus a bite of theirs', async () => {
  const menu = M.zumGoldenenCurry();
  const recs = await choosePicks({ menu, profile: profileWith(['like', 'vegetables']), session: say('I can share some of my partner’s food') });
  const combo = recs.combos.find((c) => c.title === 'Your plate + a bite of theirs');
  assert.ok(combo);
  const [mine, theirs] = combo.dishIds.map((id) => menu.dishes.find((d) => d.id === id));
  assert.ok(mine.attributes.includes('vegetable-forward'));
  assert.ok(theirs.attributes.some((a) => a === 'meat-heavy' || a === 'seafood'));
});
