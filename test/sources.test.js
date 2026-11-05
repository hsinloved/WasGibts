import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, findMenuPdf, isPrivateAddress, partsFromFiles, partsFromUrl } from '../lib/sources.js';

test('htmlToText keeps text, drops scripts, resolves links', () => {
  const html = `<html><head><title>Café &amp; Bar</title><script>alert(1)</script></head>
    <body><h1>Speisekarte</h1><p>Schnitzel &euro; 14</p><a href="/files/karte.pdf">Unsere Karte</a></body></html>`;
  const r = htmlToText(html, 'https://example.com/x');
  assert.equal(r.title, 'Café & Bar');
  assert.match(r.text, /Schnitzel € 14/);
  assert.doesNotMatch(r.text, /alert/);
  assert.equal(findMenuPdf(r.links).href, 'https://example.com/files/karte.pdf');
});

test('private and loopback addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  assert.ok(!isPrivateAddress('93.184.216.34'));
});

test('partsFromUrl refuses internal targets before fetching', async () => {
  await assert.rejects(partsFromUrl('http://127.0.0.1:8890/'), /not reachable/);
  await assert.rejects(partsFromUrl('file:///etc/passwd'), /Only http/);
});

test('partsFromFiles builds image and document blocks and rejects other types', () => {
  const r = partsFromFiles([{ name: 'a.jpg', mediaType: 'image/jpeg', data: 'data:image/jpeg;base64,AAAA' }, { name: 'b.pdf', mediaType: 'application/pdf', data: 'BBBB' }]);
  assert.equal(r.parts[0].type, 'image');
  assert.equal(r.parts[0].source.data, 'AAAA');
  assert.equal(r.parts[1].type, 'document');
  assert.throws(() => partsFromFiles([{ name: 'x.exe', mediaType: 'application/x', data: 'AA' }]), /not a photo or PDF/);
});
