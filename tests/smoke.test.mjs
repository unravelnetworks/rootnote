// Opens dist/rootnote.html from file: in headless Chrome and Edge and checks that
// the app boots with zero network requests. Run `npm run build` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, BROWSERS } = require('./harness/cdp.cjs');
const dist = fileURLToPath(new URL('../dist/rootnote.html', import.meta.url));
let port = 9420;

for (const name of Object.keys(BROWSERS)) {
  test(`boots offline from file: in ${name}`, { skip: !existsSync(BROWSERS[name]) && 'browser not installed' }, async () => {
    assert.ok(existsSync(dist), 'dist/rootnote.html missing; run npm run build');
    const b = await launch(name, port++);
    try {
      const requests = [];
      b.listeners.push((m) => {
        if (m.method === 'Network.requestWillBeSent' && !/^(file|data|blob):/.test(m.params.request.url)) {
          requests.push(m.params.request.url);
        }
      });
      await b.send('Network.enable');
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"), 'app did not boot');
      assert.deepEqual(requests, []);
    } finally {
      await b.close();
    }
  });
}
