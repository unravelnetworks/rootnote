// Moving a reference with its arrow buttons keeps keyboard focus on that reference in its new
// row, and the Guide menu link returns focus to the menu button.
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
const titles = `${snap}.findings[0].references.map((r) => r.title)`;
const focused = "document.activeElement.getAttribute('aria-label') || document.activeElement.dataset.testid || ''";

for (const [engine, port] of [['chrome', 9584], ['firefox', 9684]]) test(`reference moves keep focus in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate("document.querySelector('[data-testid=start-sample]').click()");
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`));
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset')).click()");
    assert.ok(await b.waitFor("document.querySelectorAll('li.reference').length === 2"));
    const [first, second] = await b.evaluate(titles);

    await t.test('Move down: the reference moves and focus lands on the same reference', async () => {
      await b.evaluate("document.querySelector('[aria-label=\"Move reference 1 down\"]').focus()");
      await b.evaluate("document.activeElement.click()");
      assert.deepEqual(await b.evaluate(titles), [second, first]);
      // Row 2 is the last row, so its Move down is disabled: focus goes to that reference's title.
      assert.equal(await b.evaluate(focused), 'Reference 2 title');
      assert.equal(await b.evaluate("document.activeElement.value"), first);
    });

    await t.test('Move up: focus follows the reference to row 1 (its title, as Move up is now disabled)', async () => {
      await b.evaluate("document.querySelector('[aria-label=\"Move reference 2 up\"]').focus()");
      await b.evaluate("document.activeElement.click()");
      assert.deepEqual(await b.evaluate(titles), [first, second]);
      assert.equal(await b.evaluate(focused), 'Reference 1 title', 'row 1 Move up is disabled, so its title gets focus');
      assert.equal(await b.evaluate("document.activeElement.value"), first);
    });

    await t.test('the Guide link is a plain new-tab link and returns focus to the menu', async () => {
      const link = await b.evaluate("(() => { const a = document.querySelector('[data-testid=guide-link]'); return [a.tagName, a.getAttribute('href'), a.target, a.rel]; })()");
      assert.deepEqual(link, ['A', 'https://rootnote.unravelnetworks.com/guide/', '_blank', 'noopener noreferrer']);
      // Close behaviour only: prevent the navigation itself in the test.
      await b.evaluate("(() => { const m = document.querySelector('[data-testid=more-menu]'); m.open = true; const a = m.querySelector('[data-testid=guide-link]'); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); })()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=more-menu]').open"), false);
      assert.equal(await b.evaluate("document.activeElement === document.querySelector('[data-testid=more-menu] summary')"), true);
    });
  } finally {
    await b.close();
  }
});
