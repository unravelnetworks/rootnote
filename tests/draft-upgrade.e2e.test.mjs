// Draft storage version 2 while a tab of the previous version still holds version 1 open: the
// app is told storage is blocked, the version-1 draft survives, and once the old connection
// closes the upgrade completes without leaving a connection nobody owns (a later upgrade is
// not blocked); a second app page then offers the old draft. Pages are served over a local
// http server so the holder page and the app share one origin in every engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const old = JSON.parse(readFileSync(here('./fixtures/small.json'), 'utf8'));
old.project.title = 'Draft kept by the previous version';
const json = JSON.stringify(old);

for (const [engine, port] of [['chrome', 9586], ['firefox', 9686]]) test(`draft storage upgrade blocked by an older tab in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const http = port + 10;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/app')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(dist)); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>holder</title><body></body>');
  }).listen(http, '127.0.0.1');
  const b = await launch(engine, port);
  // Reads the app frame's page from outside (the app's policy forbids eval inside it).
  const frame = (i, js) => `((document) => ${js})(document.querySelectorAll('iframe')[${i}].contentDocument)`;
  try {
    await b.navigate(`http://127.0.0.1:${http}/holder`);
    // The "older tab": version 1 with drafts on and a text draft, connection kept open.
    await b.evaluate(`new Promise((resolve, reject) => {
      const r = indexedDB.open('fieldnote-recovery', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { window.__old = r.result; const tx = r.result.transaction('kv', 'readwrite'); const s = tx.objectStore('kv');
        s.put({ enabled: true, epoch: 1 }, 'meta'); s.put({ savedAt: '2026-11-14T09:00:00.000Z', appVersion: '0.3.0', bytes: ${json.length}, json: ${JSON.stringify(json)}, epoch: 1 }, 'draft');
        tx.oncomplete = () => resolve(true); tx.onabort = () => reject(tx.error); };
      r.onerror = () => reject(r.error);
    })`);
    const addApp = (n) => b.evaluate(`new Promise((resolve) => { const f = document.createElement('iframe'); f.style.width = '1200px'; f.style.height = '800px'; f.src = '/app?${n}'; f.onload = () => resolve(true); document.body.append(f); })`);

    await t.test('while version 1 is held open, the app cannot use draft storage and the draft is untouched', async () => {
      await addApp(1);
      assert.ok(await b.waitFor(frame(0, "document.getElementById('app')?.dataset.ready === '1'"), 20000));
      await sleep(1500);
      assert.equal(await b.evaluate(frame(0, "!!document.querySelector('[data-testid=draft-banner]') && !document.querySelector('[data-testid=draft-banner]').hidden")), false, 'nothing offered while blocked');
      assert.equal(await b.evaluate(`new Promise((ok) => { const g = window.__old.transaction('kv').objectStore('kv').get('draft'); g.onsuccess = () => ok(g.result.json === ${JSON.stringify(json)}); })`), true);
    });

    await t.test('after the old connection closes, the upgrade completes, no connection is left open, and the draft is offered', async () => {
      await b.evaluate('window.__old.close(); true');
      await sleep(1500);
      // The upgraded database still holds the text draft.
      assert.equal(await b.evaluate(`new Promise((ok, no) => { const r = indexedDB.open('fieldnote-recovery'); r.onsuccess = () => { const db = r.result; const v = db.version; const g = db.transaction('kv').objectStore('kv').get('draft'); g.onsuccess = () => { db.close(); ok(v === 2 && g.result.json === ${JSON.stringify(json)}); }; }; r.onerror = () => no(r.error); })`), true, 'version 2 with the draft');
      // A second app page offers it.
      await addApp(2);
      assert.ok(await b.waitFor(frame(1, "!!document.querySelector('[data-testid=draft-banner]') && !document.querySelector('[data-testid=draft-banner]').hidden"), 20000), 'offered');
      // Nothing holds the database without an owner: a further upgrade is not blocked.
      const blocked = await b.evaluate(`new Promise((ok) => { let was = false; const r = indexedDB.open('fieldnote-recovery', 3); r.onblocked = () => { was = true; }; r.onsuccess = () => { r.result.close(); ok(was); }; r.onerror = () => ok('error'); setTimeout(() => ok(was ? 'blocked' : 'timeout'), 8000); })`);
      assert.equal(blocked, false, `version 3 upgrade: ${blocked}`);
    });
  } finally {
    await b.close();
    server.close();
  }
});
