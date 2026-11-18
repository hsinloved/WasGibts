// The JavaScript-page renderer (lib/render.js) must never reach private networks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../lib/render.js';

test('rendering refuses private and non-http addresses before any browser starts', async () => {
  for (const url of ['http://127.0.0.1:8890/', 'http://10.0.0.5/menu', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd']) {
    await assert.rejects(renderPage(url), /not reachable|Only http and https/, url);
  }
});
