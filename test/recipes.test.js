// Recipe ideas for meal prep (shared/recipes.js and the server route).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkRecipeIdeas, safeStorage } from '../shared/recipes.js';
import { recipeIdeas } from '../lib/ai.js';

const idea = (title, items, extra = {}) => ({ title, titleOriginal: null, cuisine: 'Taiwanese', summary: 's', servings: 3, activeMinutes: 30, ingredients: items.map((item) => ({ item, amount: null })), steps: ['Cook.'], keepsDays: 5, storage: '', reheat: 'Microwave 2 min.', allergens: [], tags: [], whyItBoxesWell: '', ...extra });

test('keep-days are capped to the home standard: 4 days, 2 for fish, seafood and rice', () => {
  assert.equal(safeStorage(idea('Three-cup chicken', ['chicken thighs', 'basil'])).keepsDays, 4);
  assert.equal(safeStorage(idea('Miso salmon', ['salmon fillet'])).keepsDays, 2);
  assert.equal(safeStorage(idea('Chicken fried rice', ['cooked rice', 'egg'])).keepsDays, 2);
  assert.equal(safeStorage(idea('Japchae', ['glass noodles'], { keepsDays: 3 })).keepsDays, 3, 'a shorter estimate is kept');
});

test('reheating advice always ends with steaming hot', () => {
  assert.match(safeStorage(idea('x', ['beef'])).reheat, /Microwave 2 min\. Reheat until steaming hot/);
  assert.equal(safeStorage(idea('x', ['beef'], { reheat: 'Reheat in a pan until piping hot.' })).reheat, 'Reheat in a pan until piping hot.');
});

test('a strict restriction removes the recipe; flexible ones and dislikes are flagged', () => {
  const out = checkRecipeIdeas([
    idea('Peanut noodles', ['wheat noodles', 'peanut butter']),
    idea('Sesame spinach', ['spinach', 'sesame seeds']),
    idea('Coriander chicken', ['chicken', 'coriander']),
  ], { restrictions: [{ type: 'allergy', subject: 'peanuts', severity: 'strict' }, { type: 'avoid', subject: 'sesame', severity: 'flexible' }], dislikes: ['coriander'] });
  assert.deepEqual(out.removed, [{ title: 'Peanut noodles', reason: 'contains peanuts' }]);
  assert.deepEqual(out.ideas.map((r) => r.title), ['Sesame spinach', 'Coriander chicken']);
  assert.match(out.ideas[0].flags[0], /sesame/);
  assert.ok(out.ideas[0].allergens.includes('sesame'));
  assert.match(out.ideas[1].flags[0], /coriander, which someone would rather avoid/);
});

test('the server route sends restrictions to the AI and checks the answer (stubbed AI)', async () => {
  let sent = '';
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    sent = body;
    const ideas = [idea('Peanut noodles', ['peanut sauce']), idea('Braised tofu', ['tofu', 'soy sauce'], { keepsDays: 9 })];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ideas }) }] }] }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const saved = { ...process.env };
  Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
  try {
    const out = await recipeIdeas({ cuisine: 'Taiwanese', restrictions: [{ type: 'allergy', subject: 'peanuts', severity: 'strict' }], dislikes: ['coriander'] });
    assert.match(sent, /<restrictions>/);
    assert.match(sent, /coriander/);
    assert.deepEqual(out.ideas.map((r) => [r.title, r.keepsDays]), [['Braised tofu', 4]]);
    assert.equal(out.removed[0].title, 'Peanut noodles');
  } finally {
    server.close();
    for (const k of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
});
