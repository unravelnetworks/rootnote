// Negative controls for the cross-engine capture in harness/driver.cjs: each engine must
// report a deliberate console.error, an uncaught error, a CSP-blocked inline script and
// image in the built app, and a real request from a page without the app's CSP. If any
// control is missed, a clean run of the portable gates proves nothing. Run `npm run build` first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, ENGINES, sleep } = require('./harness/driver.cjs');
const dist = fileURLToPath(new URL('../dist/rootnote.html', import.meta.url));
let port = 9640;

// A page with no CSP, from which a request to /probe must be captured.
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.url === '/plain' ? '<!doctype html><title>plain</title>' : 'ok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const waitUntil = async (fn, timeout = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(100); }
  return false;
};

for (const name of Object.keys(ENGINES)) {
  test(`capture negative controls in ${name}`, { skip: !installed(name) && 'browser not installed', timeout: 60000 }, async () => {
    assert.ok(existsSync(dist), 'run npm run build first');
    const page = pathToFileURL(dist).href;
    const b = await launch(name, port++, { pageUrl: page });
    try {
      await b.navigate(page);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      assert.deepEqual(b.errors, [], 'app boot is not clean');

      await b.evaluate("console.error('NEG-CONSOLE')");
      await b.evaluate("setTimeout(() => { throw new Error('NEG-UNCAUGHT'); }, 0)");
      await b.evaluate("(() => { const s = document.createElement('script'); s.textContent = 'window.NEG = 1'; document.body.append(s); })()");
      await b.evaluate("(() => { const i = new Image(); i.src = 'http://127.0.0.1:9/neg-img.png'; document.body.append(i); })()");

      const has = (re) => b.errors.some((e) => re.test(e));
      assert.ok(await waitUntil(() => has(/NEG-CONSOLE/)), 'console.error not captured: ' + JSON.stringify(b.errors));
      assert.ok(await waitUntil(() => has(/NEG-UNCAUGHT/)), 'uncaught error not captured: ' + JSON.stringify(b.errors));
      assert.ok(await waitUntil(() => has(/script-src/)), 'blocked inline script not captured: ' + JSON.stringify(b.errors));
      assert.ok(await waitUntil(() => has(/img-src/)), 'blocked image not captured: ' + JSON.stringify(b.errors));
      assert.equal(await b.evaluate('window.NEG === undefined'), true, 'inline script ran despite CSP');

      // A navigation the page starts itself (not the test) is a request too.
      await b.evaluate(`(() => { location.href = ${JSON.stringify(origin + '/plain')}; })()`);
      assert.ok(await waitUntil(() => b.requests.includes(origin + '/plain')), 'page-initiated navigation not reported: ' + JSON.stringify(b.requests));
      assert.ok(await b.waitFor("document.title === 'plain'"));
      await b.evaluate(`fetch(${JSON.stringify(origin + '/probe?neg=1')}).then(() => 1, () => 0)`);
      assert.ok(await waitUntil(() => b.requests.some((u) => u.includes('/probe?neg=1'))), 'request not captured: ' + JSON.stringify(b.requests));
    } finally {
      await b.close();
    }
  });
}
