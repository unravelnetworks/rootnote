// The sample project is built into the page (build.mjs, template#app-sample), so "Open the sample"
// works online without the download and without a file picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sampleFile = readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8');
const sample = JSON.parse(sampleFile);
const snap = 'window.__fieldnote.snapshot()';
const status = "document.querySelector('.status').textContent";

for (const [engine, port] of [['chrome', 9583], ['firefox', 9683]]) test(`built-in sample in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));

    await t.test('the embedded copy is the shipped sample file, byte for byte', async () => {
      const embedded = await b.evaluate("document.getElementById('app-sample').content.textContent");
      assert.equal(embedded, sampleFile);
    });

    await t.test('Open the sample opens it in one click, without the file picker', async () => {
      await b.evaluate("document.querySelector('[data-testid=open-input]').addEventListener('click', () => { window.__pickerOpened = true; })");
      await b.evaluate("document.querySelector('[data-testid=start-sample]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === ${sample.findings.length}`));
      assert.equal(await b.evaluate('window.__pickerOpened === true'), false);
      const s = await b.evaluate(snap);
      assert.equal(s.project.title, sample.project.title);
      assert.equal(s.project.client, sample.project.client);
      assert.equal(s.images.length, sample.images.length);
      assert.match(await b.evaluate(status), /Opened "sample-project\.rootnote\.json" \(8 findings, 9 screenshots\)/);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    });

  } finally {
    await b.close();
  }
});
