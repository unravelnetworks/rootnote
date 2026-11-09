// Opens dist/rootnote.html from file: in headless Firefox (WebDriver BiDi) and checks that
// the app boots with zero network requests and no console errors. Run `npm run build` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, BROWSERS } = require('./harness/bidi.cjs');
const dist = fileURLToPath(new URL('../dist/rootnote.html', import.meta.url));

test('boots offline from file: in firefox', { skip: !existsSync(BROWSERS.firefox) && 'browser not installed' }, async () => {
  assert.ok(existsSync(dist), 'dist/rootnote.html missing; run npm run build');
  const b = await launch('firefox', 9610);
  try {
    const requests = [];
    const errors = [];
    b.listeners.push((m) => {
      if (m.method === 'network.beforeRequestSent' && !/^(file|data|blob|about):/.test(m.params.request.url)) {
        requests.push(m.params.request.url);
      }
      if (m.method === 'log.entryAdded' && m.params.level === 'error') errors.push(m.params.text);
    });
    await b.send('session.subscribe', { events: ['network.beforeRequestSent', 'log.entryAdded'] });
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"), 'app did not boot');
    assert.equal(await b.evaluate('typeof window.showSaveFilePicker'), 'undefined');
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
});
