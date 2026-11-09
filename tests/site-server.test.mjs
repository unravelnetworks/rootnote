// The local site server (site/serve-headers.mjs) serves only files inside its output folder,
// survives malformed requests, and follows _headers and _redirects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';

const PORT = 9579;
const server = fileURLToPath(new URL('../site/serve-headers.mjs', import.meta.url));

// Raw request, so the path reaches the server exactly as written (no client-side normalising).
const get = (path) => new Promise((ok, no) => {
  const r = request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', no); r.end();
});

test('local site server', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'rootnote-site-'));
  const out = join(base, 'out');
  mkdirSync(join(out, 'guide', 'start-here'), { recursive: true });
  writeFileSync(join(base, 'secret.txt'), 'outside the site');
  writeFileSync(join(out, 'index.html'), 'home');
  writeFileSync(join(out, '404.html'), 'not found');
  writeFileSync(join(out, 'guide', 'start-here', 'index.html'), 'start here');
  writeFileSync(join(out, '_headers'), '/*\n  X-Test: on\n');
  writeFileSync(join(out, '_redirects'), '/help /guide/ 301\n/help/* /guide/:splat 301\n');
  const proc = spawn(process.execPath, [server, String(PORT), out], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok) => proc.stdout.once('data', ok));
  t.after(() => { proc.kill(); rmSync(base, { recursive: true, force: true }); });

  await t.test('serves a page with its headers', async () => {
    const r = await get('/');
    assert.equal(r.status, 200); assert.equal(r.body, 'home'); assert.equal(r.headers['x-test'], 'on');
  });
  await t.test('follows redirects, keeping the rest of the path', async () => {
    const a = await get('/help');
    assert.equal(a.status, 301); assert.equal(a.headers.location, '/guide/');
    const b = await get('/help/start-here/');
    assert.equal(b.status, 301); assert.equal(b.headers.location, '/guide/start-here/');
  });
  await t.test('never serves a file outside the folder', async () => {
    for (const p of ['/%2e%2e%5csecret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/guide/%5c..%5c..%5csecret.txt', '/a%00b']) {
      const r = await get(p);
      assert.notEqual(r.status, 200, p); assert.doesNotMatch(r.body, /outside the site/, p);
    }
  });
  await t.test('a malformed address gets 400 and the server keeps running', async () => {
    assert.equal((await get('/%E0%A4%A')).status, 400);
    assert.equal((await get('/guide/start-here/')).body, 'start here');
  });
  await t.test('unknown paths get the 404 page; _headers itself is not served', async () => {
    const r = await get('/nope');
    assert.equal(r.status, 404); assert.equal(r.body, 'not found');
    assert.equal((await get('/_headers')).status, 404);
  });
});
