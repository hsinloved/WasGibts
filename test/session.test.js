// "Refine my picks": session context (shared/session.js) and how both
// recommenders use it. Session context is for this meal only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { normalizeProfile } from '../shared/model.js';
import { normalizeMenu, dishText } from '../shared/menu.js';
import { recommendLocally } from '../shared/recommend.js';
import { guardRecommendation } from '../shared/guard.js';
import * as S from '../shared/session.js';
import * as P from '../shared/profile.js';
import { recommend } from '../lib/ai.js';

const menu = normalizeMenu(JSON.parse(readFileSync(new URL('../shared/sample-menu.json', import.meta.url))));
const seed = () => normalizeProfile(JSON.parse(readFileSync(new URL('./fixtures/sample-profile.json', import.meta.url))));
const say = (...lines) => lines.reduce((s, t) => S.applyStatement(s, t).session, S.emptySession());
const ids = (recs) => recs.picks.map((p) => p.dishId);

test('the five example refinements are understood', () => {
  const cases = [
    ['I’ve already eaten', 'context', { hunger: 'ate' }],
    ['I want something starchy', 'craving', { cravings: ['starchy'] }],
    ['I’d like more protein', 'craving', { cravings: ['protein'] }],
    ['I can share some of my partner’s food', 'context', { sharing: 'partner' }],
    ['Actually, I don’t feel like fish today', 'correction', { avoid: ['fish'] }],
  ];
  for (const [text, kind, expect] of cases) {
    const { session, entry } = S.applyStatement(S.emptySession(), text);
    assert.equal(entry.kind, kind, text);
    assert.deepEqual(entry.unparsed, [], text);
    for (const [k, v] of Object.entries(expect)) assert.deepEqual(session[k], v, text);
  }
});

test('later statements override earlier ones and say what they replaced', () => {
  let s = say('I’m starving', 'no fish today');
  const { session, entry } = S.applyStatement(s, 'Actually I’ve already eaten, and I do want fish');
  assert.equal(session.hunger, 'ate');
  assert.deepEqual(session.avoid, []);
  assert.deepEqual(session.cravings, ['fish']);
  assert.equal(entry.kind, 'correction');
  assert.ok(entry.overridden.includes('very hungry') && entry.overridden.includes('no fish'));
  s = S.removeFromSession(session, 'cravings', 'fish');
  assert.deepEqual(s.cravings, []);
});

test('German phrasings work too', () => {
  const s = say('Ich habe schon gegessen', 'keine Lust auf Fisch heute', 'zum Teilen');
  assert.equal(s.hunger, 'ate');
  assert.deepEqual(s.avoid, ['fish']);
  assert.equal(s.sharing, 'group');
});

test('a specific food is not a whole group: "no noodles" keeps rice and bread', () => {
  const s = say('something light, no noodles');
  assert.equal(s.hunger, 'light');
  assert.deepEqual(s.avoid, ['noodles']);
  const recs = recommendLocally(menu, seed(), { session: s });
  assert.ok(!ids(recs).includes('d8'), 'dan dan noodles set aside');
  assert.ok(recs.setAside.some((x) => x.dishId === 'd8'));
});

test('lasting statements become a suggestion, never a silent profile change', () => {
  const { entry } = S.applyStatement(S.emptySession(), 'I never eat coriander');
  assert.equal(entry.kind, 'durable');
  assert.deepEqual(entry.suggestions, [{ polarity: 'dislike', subject: 'coriander', restriction: false }]);
  assert.equal(S.applyStatement(S.emptySession(), 'I’m allergic to sesame').entry.suggestions[0].restriction, true);
  assert.deepEqual(S.applyStatement(S.emptySession(), 'no coriander today').entry.suggestions, [], '"today" is never durable');
});

test('the profile is never written by a refinement', () => {
  const p = seed();
  const before = JSON.stringify(p);
  recommendLocally(menu, p, { session: say('I never eat coriander', 'I hate mushrooms', 'more protein') });
  assert.equal(JSON.stringify(p), before);
});

test('"not today" beats a stored like, and says the profile is unchanged', () => {
  const p = seed(); // likes mushrooms
  const recs = recommendLocally(menu, p, { session: say('no mushrooms today') });
  assert.match(recs.headline, /Leaving out mushrooms today, though you usually like it; your profile is unchanged/);
  for (const id of ids(recs)) assert.ok(!S.groupMatch('mushrooms', menu.dishes.find((d) => d.id === id), dishText(menu.dishes.find((d) => d.id === id))));
  assert.ok(P.profileForAI(p).preferences.some((x) => x.like === 'mushrooms'), 'still liked in the profile');
});

test('a craving lifts a matching dish to the top and the change is explained', () => {
  const p = seed();
  const before = recommendLocally(menu, p, {});
  const after = recommendLocally(menu, p, { session: say('I want something starchy') });
  assert.equal(after.picks[0].dishId, 'd8', 'noodles first');
  assert.equal(after.picks[0].evidence[0].type, 'session');
  const lines = S.explainChange(before, after, menu);
  assert.ok(lines.some((l) => l.kind === 'in' && /Dan dan noodles — you asked for something starchy today \(noodle\)/.test(l.text)), JSON.stringify(lines));
});

test('already eaten favours light and shareable dishes', () => {
  const recs = recommendLocally(menu, seed(), { session: say('I’ve already eaten') });
  const top = menu.dishes.find((d) => d.id === recs.picks[0].dishId);
  assert.ok(top.attributes.some((a) => ['light', 'shareable', 'sweet', 'quick'].includes(a)));
  assert.ok(!ids(recs).slice(0, 2).includes('d7'), 'rich twice-cooked pork is not near the top');
});

test('"not today" is enforced on AI picks too', () => {
  const ai = { picks: [{ dishId: 'd5', role: 'x', whyYou: 'y', evidence: [], concerns: [], occasionFit: '' }, { dishId: 'd1', role: 'x', whyYou: 'y', evidence: [], concerns: [], occasionFit: '' }], cautions: [] };
  const out = S.enforceSession(ai, menu, say('Actually, I don’t feel like fish today'), dishText);
  assert.deepEqual(ids(out), ['d1']);
  assert.deepEqual(out.setAside, [{ dishId: 'd5', reason: 'no fish today' }]);
  // Fish-fragrant aubergine has no fish in it.
  assert.deepEqual(ids(S.enforceSession({ picks: [{ dishId: 'd6' }] }, menu, say('no fish'), dishText)), ['d6']);
});

test('session evidence is dropped when nothing was said', () => {
  const ai = { picks: [{ dishId: 'd1', role: 'x', whyYou: 'Cucumber.', evidence: [{ type: 'session', ref: null, text: 'You asked for something light.' }], concerns: [], occasionFit: '' }], cautions: [] };
  assert.equal(guardRecommendation(ai, menu, { session: S.emptySession() }).picks[0].evidence.length, 0);
  assert.equal(guardRecommendation(ai, menu, { session: say('something light') }).picks[0].evidence.length, 1);
});

test('junk from storage or the network is normalised', () => {
  const s = S.normalizeSession({ hunger: 'ravenous', sharing: 'group', cravings: ['starchy', '<script>', 7], avoid: 'fish', log: [{ text: 'x'.repeat(999) }] });
  assert.equal(s.hunger, null);
  assert.equal(s.sharing, 'group');
  assert.deepEqual(s.cravings, ['starchy']);
  assert.deepEqual(s.avoid, []);
  assert.equal(s.log[0].text.length, 300);
});

test('unrecognised text is disclosed, not guessed at', () => {
  const { entry } = S.applyStatement(S.emptySession(), 'what goes with a Riesling?');
  assert.equal(entry.kind, 'unclear');
  assert.deepEqual(entry.unparsed, ['what goes with a riesling']);
  assert.equal(S.isEmptySession(S.emptySession()), true);
});

test('the server sends the session and previous picks to the AI and enforces "not today"', async () => {
  const p = seed();
  let prompt = '';
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    prompt = body;
    const answer = { headline: 'h', picks: [{ dishId: 'd5', role: 'r', whyYou: 'w', evidence: [], concerns: [], occasionFit: '' }, { dishId: 'd8', role: 'r', whyYou: 'Noodles.', evidence: [{ type: 'session', ref: null, text: 'You asked for something starchy.' }], concerns: [], occasionFit: '' }], cautions: [], orderingTip: null, occasionQuestion: null, changeNote: 'Noodles moved up for the starch craving.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const saved = { ...process.env };
  Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
  try {
    const out = await recommend({ menu, profileView: P.profileForAI(p), occasion: null, session: say('something starchy', 'no fish today'), previous: ['d1', 'd3'] });
    assert.match(prompt, /<session>/);
    assert.match(prompt, /avoidToday/);
    assert.match(prompt, /<previous>/);
    assert.deepEqual(ids(out), ['d8'], 'the fish pick is set aside after generation');
    assert.equal(out.changeNote, 'Noodles moved up for the starch craving.');
    assert.equal(out.picks[0].evidence.length, 1, 'session evidence kept while a session exists');
  } finally {
    server.close();
    for (const k of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});
