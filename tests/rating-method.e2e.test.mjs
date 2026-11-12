// B2 in the app: "How findings are rated" is filled from the default only on request,
// switched on when filled, shown in the preview with one Contents link, kept when the
// scoring mode changes, and replacing written text asks first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultRatingMethodText } from '../src/app/rating-method.js';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('./fixtures/v4-small.json'); // a real v4 file, converted on open
const snap = 'window.__fieldnote.snapshot()';
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;
const area = "document.querySelector('[data-testid=rating-method]')";

for (const [engine, port] of [['chrome', 9595], ['firefox', 9695]]) test(`rating explanation in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`, 60000));

    await t.test('a converted v4 file has the section off and empty', async () => {
      const p = await b.evaluate(snap);
      assert.equal(p.schemaVersion, 7); // converted to the current schema
      assert.deepEqual(p.project.ratingMethod, { text: '' });
      assert.equal(p.project.sections.report.find((s) => s.key === 'ratingMethod').enabled, false);
    });

    await t.test('Fill writes the default for the current scoring and switches the section on', async () => {
      await b.evaluate(nav('Details & cover'));
      await b.evaluate("document.querySelector('[data-testid=rating-method-fill]').click()");
      const p = await b.evaluate(snap);
      assert.equal(p.project.ratingMethod.text, defaultRatingMethodText(p.project.scoring.mode, p.project.labels));
      assert.equal(p.project.sections.report.find((s) => s.key === 'ratingMethod').enabled, true);
      assert.equal(await b.evaluate(`${area}.value`), p.project.ratingMethod.text);
    });

    await t.test('the preview shows it once, linked from Contents', async () => {
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("!!document.getElementById('pv-report_rating_method')"));
      assert.equal(await b.evaluate("document.getElementById('pv-report_rating_method').textContent"), 'How findings are rated');
      assert.equal(await b.evaluate("document.querySelectorAll('[id=\"pv-report_rating_method\"]').length"), 1);
      assert.ok(await b.evaluate("[...document.querySelectorAll('.pv-contents a')].some((a) => a.getAttribute('href') === '#pv-report_rating_method')"));
    });

    await t.test('edited text survives a scoring change; replacing it asks, and Cancel keeps it', async () => {
      await b.evaluate(nav('Details & cover'));
      await b.evaluate(`(() => { const e = ${area}; e.value = 'Our own method.'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await b.evaluate(nav('Sections & scoring'));
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=scoring-mode]'); s.value = 'cvss'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      assert.equal(await b.evaluate(`${snap}.project.ratingMethod.text`), 'Our own method.');
      await b.evaluate(nav('Details & cover'));
      assert.match(await b.evaluate("document.querySelector('[data-testid=rating-method-fill]').textContent"), /CVSS Base$/);
      await b.evaluate("document.querySelector('[data-testid=rating-method-fill]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      assert.ok(await b.waitFor("!document.querySelector('dialog.confirm')"));
      assert.equal(await b.evaluate(`${snap}.project.ratingMethod.text`), 'Our own method.');
      await b.evaluate("document.querySelector('[data-testid=rating-method-fill]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.project.ratingMethod.text.startsWith('CVSS 3.1 Base is the score')`));
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
