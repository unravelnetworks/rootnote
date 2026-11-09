// the live page beside a finding. It is off until asked for, shows only the pages
// of the finding being edited (same plan and renderer as Preview, so the page numbers agree),
// follows edits after a pause, is read-only, never duplicates Preview's ids, and is not printed.
// Preview gains a Go to list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('../release-template/sample-project.rootnote.json');
const snap = 'window.__fieldnote.snapshot()';
const open = (t) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`;
const shown = "[...document.querySelectorAll('[data-testid=live-pane] .pv-page')].filter((p) => !p.hidden)";

for (const [engine, port] of [['chrome', 9593], ['firefox', 9693]]) test(`live page in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.setViewport({ width: 1600, height: 1000 });
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
    await b.evaluate(open('Customers can read'));

    await t.test('on by default (agreed mockup); shows only this finding\'s pages, numbered as in Preview', async () => {
      assert.ok(await b.waitFor(`${shown}.length > 0`, 20000));
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=live-show]').hidden"), true, 'no Show button while it is shown');
      const text = await b.evaluate(`${shown}.map((p) => p.textContent).join(' ')`);
      assert.match(text, /Customers can read/);
      assert.doesNotMatch(text, /Password reset token disclosed/);
      const where = await b.evaluate("document.querySelector('[data-testid=live-where]').textContent");
      const [, from, total] = where.match(/page (\d+)(?:–\d+)? of (\d+)/);
      // The same page in the full Preview carries this finding's heading.
      await b.evaluate(open('Preview'));
      assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=preview] .pv-page').length > 0", 20000));
      // Numbered like the report footer: body pages only.
      const bodyPages = "document.querySelectorAll('[data-testid=preview] .pv-page-body')";
      assert.equal(String(await b.evaluate(`${bodyPages}.length`)), total);
      assert.match(await b.evaluate(`${bodyPages}[${from} - 1].textContent`), /Customers can read/);
      assert.match(await b.evaluate(`${bodyPages}[${from} - 1].querySelector('.pv-running-footer').textContent`), new RegExp(`${from} of ${total}$`));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=live-pane]').hidden"), true, 'not beside Preview');
    });

    await t.test('it follows an edit, has no controls or links, and no ids', async () => {
      await b.evaluate(open('Customers can read'));
      assert.ok(await b.waitFor(`${shown}.length > 0`, 20000), 'stays on when coming back');
      await b.evaluate("(() => { const a = document.querySelector('[data-testid=impact]'); a.value = 'LIVE-MARKER impact text.'; a.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.ok(await b.waitFor(`${shown}.some((p) => p.textContent.includes('LIVE-MARKER'))`, 10000));
      assert.equal(await b.evaluate("document.querySelectorAll('[data-testid=live-pane] .pv-control, [data-testid=live-pane] select, [data-testid=live-pane] [id], [data-testid=live-pane] a[href]').length"), 0);
    });

    await t.test('a pending redraw keeps focus on Full preview; another finding starts at the top', async () => {
      await b.evaluate("(() => { const a = document.querySelector('[data-testid=impact]'); a.value += ' more'; a.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate("document.querySelector('[data-testid=live-full]').focus()");
      await new Promise((r) => setTimeout(r, 900));
      assert.equal(await b.evaluate("document.activeElement === document.querySelector('[data-testid=live-full]')"), true);
      await b.evaluate("document.querySelector('[data-testid=live-pane]').scrollTop = 600");
      assert.ok(await b.evaluate("document.querySelector('[data-testid=live-pane]').scrollTop > 100"));
      await b.evaluate(open('Stored cross-site'));
      assert.ok(await b.waitFor(`${shown}.some((p) => p.textContent.includes('Stored cross-site'))`, 20000));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=live-pane]').scrollTop"), 0);
    });

    await t.test('Preview\'s Go to list scrolls to a finding', async () => {
      await b.evaluate(open('Preview'));
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=preview-jump]')", 20000));
      const target = await b.evaluate("[...document.querySelectorAll('[data-testid=preview-jump] option')].find((o) => o.textContent.includes('Security headers')).value");
      await b.evaluate(`(() => { const s = document.querySelector('[data-testid=preview-jump]'); s.value = ${JSON.stringify(target)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      assert.ok(await b.waitFor(`Math.abs(document.getElementById('pv-${target}').getBoundingClientRect().top) < 200`, 5000));
    });

    await t.test('turning it off hides it; the print style hides it too', async () => {
      await b.evaluate(open('Customers can read'));
      await b.evaluate("document.querySelector('[data-testid=live-hide]').click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=live-pane]').hidden"), true);
      assert.ok(await b.evaluate("[...document.styleSheets].some((s) => [...s.cssRules].some((r) => r.media?.mediaText === 'print' && r.cssText.includes('.live')))"));
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
