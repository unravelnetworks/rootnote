// removing an engagement row that holds the user's text can be undone;
// an empty custom row or a row that shows a report detail is removed at once, since nothing is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const snap = 'window.__fieldnote.snapshot()';
const rows = `${snap}.project.engagement.rows`;
const removeLast = "[...document.querySelectorAll('[data-testid=engagement] .erow')].at(-1).querySelector('button[aria-label^=\"Remove row\"]').click()";

for (const [engine, port] of [['chrome', 9592], ['firefox', 9692]]) test(`engagement row removal in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
    await b.evaluate("document.querySelector('[data-testid=engagement-customize]').click()"); // rows are added and removed in Customize rows
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=add-row]')"));
    const start = (await b.evaluate(rows)).length;

    await t.test('an empty custom row goes without a question', async () => {
      await b.evaluate("document.querySelector('[data-testid=add-row]').click()");
      assert.equal((await b.evaluate(rows)).length, start + 1);
      await b.evaluate(removeLast);
      assert.ok(await b.waitFor(`${rows}.length === ${start}`));
      assert.equal(await b.evaluate("!!document.querySelector('dialog.confirm')"), false);
    });

    // Undo replaced the confirmation question; the
    // over-budget recovery state still asks (references-budget.e2e.test.mjs).
    await t.test('a custom row with text is removed at once and offered for Undo, which restores it', async () => {
      await b.evaluate("document.querySelector('[data-testid=add-row]').click()");
      await b.evaluate("(() => { const a = [...document.querySelectorAll('[data-testid=engagement] .erow')].at(-1).querySelector('textarea'); a.value = 'Jane Roe, IT lead'; a.dispatchEvent(new Event('input', { bubbles: true })); })()");
      const before = await b.evaluate(rows);
      assert.equal(before.at(-1).value, 'Jane Roe, IT lead');
      await b.evaluate(removeLast);
      assert.equal(await b.evaluate("!!document.querySelector('dialog.confirm')"), false);
      assert.equal((await b.evaluate(rows)).length, start);
      assert.match(await b.evaluate("document.querySelector('[data-testid=undo-text]').textContent"), /Removed the row "New row"\./);
      await b.evaluate("document.querySelector('[data-testid=undo]').click()");
      assert.deepEqual(await b.evaluate(rows), before);
      await b.evaluate(removeLast);
      assert.ok(await b.waitFor(`${rows}.length === ${start}`));
    });

    await t.test('a row that shows a report detail goes without a question', async () => {
      const first = (await b.evaluate(rows))[0];
      assert.notEqual(first.source, 'custom');
      await b.evaluate("document.querySelector('[data-testid=engagement] .erow button[aria-label=\"Remove row 1\"]').click()");
      assert.ok(await b.waitFor(`${rows}.length === ${start - 1}`));
      assert.equal(await b.evaluate("!!document.querySelector('dialog.confirm')"), false);
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
