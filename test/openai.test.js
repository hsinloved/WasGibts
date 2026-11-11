// The OpenAI provider (AI_PROVIDER=openai), against a local stub of the
// Responses API so no real key or network is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { toOpenAIContent } from '../lib/openai.js';
import { provider, aiInfo, extractMenu, findMenuOnline, AIError } from '../lib/ai.js';
import { handle } from '../server.js';

/** Start a fake /v1/responses; `reply(body)` returns [status, json]. Records every request body. */
async function stubOpenAI(reply) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    seen.push({ path: req.url, auth: req.headers.authorization, body });
    const [status, json] = reply(body);
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { seen, base: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}

async function withEnv(env, fn) {
  const saved = {}; for (const k of Object.keys(env)) saved[k] = process.env[k];
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const message = (text) => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] });
const MENU = { restaurant: { name: 'Stub Grill', cuisine: null, menuLanguage: 'German', currency: 'EUR' }, notes: [], dishes: [{
  id: 'd1', section: null, originalName: 'Forelle', translatedName: 'Trout', glosses: [], menuDescription: null,
  price: { amount: 18, currency: 'EUR', display: '18,00 €' }, explanation: 'A whole grilled trout.',
  ingredients: [{ name: 'trout', source: 'menu' }], preparation: [{ method: 'grilled', source: 'typical' }],
  flavours: [], textures: [], cuisine: null, region: null, culturalNote: null, attributes: [], dietary: { menuStated: [], likely: [] }, uncertainty: null,
}] };
const OPENAI = (base) => ({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: base, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });

test('provider: explicit setting wins; otherwise Anthropic first, then OpenAI', async () => {
  await withEnv({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: undefined, OPENAI_API_KEY: 'o' }, () => assert.equal(provider(), 'anthropic'));
  await withEnv({ AI_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, OPENAI_API_KEY: 'o' }, () => assert.equal(provider(), 'openai'));
  await withEnv({ AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', OPENAI_MODEL: 'gpt-test' }, () => {
    assert.equal(provider(), 'openai');
    assert.deepEqual(aiInfo(), { available: true, provider: 'openai', model: 'gpt-test' });
  });
  await withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: undefined }, () => assert.equal(aiInfo().available, false));
});

test('content blocks convert to Responses API input parts', () => {
  const out = toOpenAIContent([
    { type: 'text', text: 'hello' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
  ]);
  assert.deepEqual(out, [
    { type: 'input_text', text: 'hello' },
    { type: 'input_image', image_url: 'data:image/jpeg;base64,AAA', detail: 'high' },
    { type: 'input_file', filename: 'menu.pdf', file_data: 'data:application/pdf;base64,BBB' },
  ]);
});

test('extractMenu sends a strict JSON schema request and parses the answer', async () => {
  const stub = await stubOpenAI(() => [200, message(JSON.stringify(MENU))]);
  try {
    await withEnv({ ...OPENAI(stub.base), OPENAI_MODEL: 'gpt-5' }, async () => {
      const menu = await extractMenu({ parts: [{ type: 'text', text: 'Forelle 18,00 €' }], translateTo: 'English' });
      assert.equal(menu.dishes[0].originalName, 'Forelle');
      const { path, auth, body } = stub.seen[0];
      assert.equal(path, '/v1/responses');
      assert.equal(auth, 'Bearer sk-test');
      assert.equal(body.model, 'gpt-5');
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.name, 'menu');
      assert.ok(body.text.format.schema.properties.dishes);
      assert.equal(body.reasoning.effort, 'medium');
      assert.equal(body.input[0].content[0].type, 'input_text');
    });
  } finally { stub.close(); }
});

test('non-reasoning models get no reasoning parameter', async () => {
  const stub = await stubOpenAI(() => [200, message(JSON.stringify(MENU))]);
  try {
    await withEnv({ ...OPENAI(stub.base), OPENAI_MODEL: 'gpt-4.1' }, async () => {
      await extractMenu({ parts: [{ type: 'text', text: 'x' }] });
      assert.equal(stub.seen[0].body.reasoning, undefined);
    });
  } finally { stub.close(); }
});

test('refusals, truncation and HTTP errors become clear AIErrors', async () => {
  const cases = [
    [[200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }], 422],
    [[200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }], 413],
    [[200, message('not json')], 502],
    [[401, { error: { message: 'bad key' } }], 500],
    [[429, { error: { message: 'quota' } }], 429],
    [[400, { error: { message: 'bad schema' } }], 400],
  ];
  for (const [reply, status] of cases) {
    const stub = await stubOpenAI(() => reply);
    try {
      await withEnv(OPENAI(stub.base), async () => {
        await assert.rejects(extractMenu({ parts: [{ type: 'text', text: 'x' }] }), (e) => e instanceof AIError && e.status === status);
      });
    } finally { stub.close(); }
  }
});

test('findMenuOnline uses web search and reads the <result> block', async () => {
  const answer = 'Found it.\n<result>{"restaurant":"Stub Grill","address":"Munich","website":"https://stub.example/","menuUrls":["https://stub.example/menu.pdf"],"confidence":"high","notes":"Own site."}</result>';
  const stub = await stubOpenAI(() => [200, message(answer)]);
  try {
    await withEnv(OPENAI(stub.base), async () => {
      const r = await findMenuOnline({ name: 'Stub Grill', address: 'Munich' });
      assert.deepEqual(r.urls, ['https://stub.example/menu.pdf', 'https://stub.example/']);
      assert.equal(r.confidence, 'high');
      assert.deepEqual(stub.seen[0].body.tools, [{ type: 'web_search' }]);
    });
  } finally { stub.close(); }
});

test('findMenuOnline returns null when search fails', async () => {
  const stub = await stubOpenAI(() => [400, { error: { message: 'web_search not enabled' } }]);
  try {
    await withEnv(OPENAI(stub.base), async () => assert.equal(await findMenuOnline({ name: 'X' }), null));
  } finally { stub.close(); }
});

test('the server reads a photo menu end to end through OpenAI', async () => {
  const stub = await stubOpenAI(() => [200, message(JSON.stringify(MENU))]);
  const app = createServer(handle).listen(0, '127.0.0.1');
  await new Promise((r) => app.once('listening', r));
  try {
    await withEnv({ ...OPENAI(stub.base), APP_PASSCODE: undefined }, async () => {
      const base = `http://127.0.0.1:${app.address().port}`;
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.available, true);
      assert.equal(status.provider, 'openai');
      const res = await fetch(`${base}/api/menu/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { type: 'files', files: [{ name: 'p.jpg', mediaType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') }] } }),
      });
      assert.equal(res.status, 200);
      const menu = await res.json();
      assert.equal(menu.restaurant.name, 'Stub Grill');
      assert.equal(stub.seen[0].body.input[0].content[0].type, 'input_image');
    });
  } finally { app.close(); stub.close(); }
});
