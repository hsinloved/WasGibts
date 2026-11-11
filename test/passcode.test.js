// The optional APP_PASSCODE guard on the AI endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handle } from '../server.js';

async function withServer(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const server = createServer(handle).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally {
    server.close();
    for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
}
const status = (base, code) => fetch(`${base}/api/status`, { headers: code ? { 'X-WasGibts-Passcode': code } : {} }).then((r) => r.json());
// Profile parsing rejects short text before calling the AI, so a 400 proves the passcode check passed.
const parse = (base, code) => fetch(`${base}/api/profile/parse`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(code ? { 'X-WasGibts-Passcode': code } : {}) }, body: JSON.stringify({ text: 'hi' }),
});

test('without APP_PASSCODE nothing is locked', async () => {
  await withServer({ ANTHROPIC_API_KEY: 'test-key', APP_PASSCODE: '' }, async (base) => {
    assert.equal((await status(base)).locked, false);
    assert.equal((await parse(base)).status, 400);
  });
});

test('with APP_PASSCODE the AI endpoints need the right passcode', async () => {
  await withServer({ ANTHROPIC_API_KEY: 'test-key', APP_PASSCODE: 'sesame' }, async (base) => {
    assert.equal((await status(base)).locked, true);
    assert.equal((await status(base, 'wrong')).locked, true);
    assert.equal((await status(base, 'sesame')).locked, false);
    assert.equal((await parse(base)).status, 401);
    assert.equal((await parse(base, 'nope')).status, 401);
    assert.equal((await parse(base, 'sesame')).status, 400);
  });
});

test('wrong passcodes are rate limited', async () => {
  await withServer({ ANTHROPIC_API_KEY: 'test-key', APP_PASSCODE: 'sesame2' }, async (base) => {
    let last;
    for (let i = 0; i < 12; i++) last = await parse(base, `guess-${i}`);
    assert.equal(last.status, 429);
  });
});

test('no AI key means not locked, just unavailable', async () => {
  await withServer({ ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', APP_PASSCODE: 'sesame' }, async (base) => {
    const s = await status(base);
    assert.equal(s.available, false);
    assert.equal(s.locked, false);
  });
});
