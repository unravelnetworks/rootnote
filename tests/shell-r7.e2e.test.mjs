// the start screen, the More menu, a file state that never overstates a save, and
// Check & export that says where the report stands and links each suggestion to its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sample = here('../release-template/sample-project.rootnote.json');
const snap = 'window.__fieldnote.snapshot()';
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;
const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`;

for (const [engine, port] of [['chrome', 9591], ['firefox', 9691]]) test(`R7 shell in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const dir = here(`./out/shell-r7-${engine}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const b = await launch(engine, port, { downloadDir: dir });
  try {
    // Counts document click listeners, to show redraws do not add any.
    await b.addInitScript("(() => { let n = 0; const add = Document.prototype.addEventListener; Document.prototype.addEventListener = function (type, ...rest) { if (type === 'click') window.__clickListeners = ++n; return add.call(this, type, ...rest); }; })()");
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));

    await t.test('the app opens on the start screen, without the sections list', async () => {
      assert.ok(await b.waitFor(visible('[data-testid=start]')));
      assert.equal(await b.evaluate(visible('.nav')), false);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=file-state]').hidden"), true);
    });

    await t.test('New report goes to Details & cover and keeps the empty project', async () => {
      await b.evaluate("document.querySelector('[data-testid=start-new]').click()");
      assert.ok(await b.waitFor(visible('[data-testid=engagement-customize]')));
      assert.ok(await b.evaluate(visible('.nav')));
      assert.equal(await b.evaluate(`${snap}.findings.length`), 0);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    });

    await t.test('values shown from other fields follow each edit without a redraw', async () => {
      const bound = "document.querySelector('[data-bound=client]').textContent";
      assert.equal(await b.evaluate(bound), '(empty)');
      const client = "[...document.querySelectorAll('main label.field')].find((l) => l.textContent.startsWith('Client')).querySelector('input')";
      await b.evaluate(`(() => { const i = ${client}; i.focus(); i.value = 'Acme (fictional)'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      assert.equal(await b.evaluate(bound), 'Acme (fictional)');
      assert.equal(await b.evaluate(`document.activeElement === ${client}`), true, 'typing keeps focus');
      // the engagement ID row and the paper size in the summary.
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=engagement-id]'); i.value = 'UPDATED-ENGAGEMENT'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.equal(await b.evaluate("document.querySelector('[data-bound=engagementId]').textContent"), 'UPDATED-ENGAGEMENT');
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=paper]'); s.value = 'Letter'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      assert.match(await b.evaluate("document.querySelector('[data-summary=branding]').textContent"), /^Letter · /);
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=paper]'); s.value = 'A4'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      assert.match(await b.evaluate("document.querySelector('[data-summary=branding]').textContent"), /cover page/);
      await b.evaluate("document.querySelector('[data-testid=cover]').click()");
      assert.match(await b.evaluate("document.querySelector('[data-summary=branding]').textContent"), /no cover page/);
      await b.evaluate("document.querySelector('[data-testid=cover]').click()");
    });

    await t.test('More holds Save as, Download and About; Escape closes it', async () => {
      await b.evaluate("document.querySelector('[data-testid=more-menu] summary').click()");
      assert.ok(await b.waitFor("document.querySelector('[data-testid=more-menu]').open"));
      assert.ok(await b.evaluate(visible('[data-testid=licences]')));
      await b.evaluate("document.querySelector('[data-testid=more-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=more-menu]').open"), false);
      assert.equal(await b.evaluate("document.activeElement === document.querySelector('[data-testid=more-menu] summary')"), true);
      // a disclosure of ordinary buttons, not an ARIA menu.
      assert.equal(await b.evaluate("document.querySelectorAll('[role=menu], [role=menuitem]').length"), 0);
    });

    await t.test('focus comes back after About closes and after switching the rows view', async () => {
      const summary = "document.querySelector('[data-testid=more-menu] summary')";
      for (const how of ['escape', 'button']) {
        await b.evaluate(`${summary}.click()`);
        await b.evaluate("(() => { const a = document.querySelector('[data-testid=licences]'); a.focus(); a.click(); })()");
        assert.ok(await b.waitFor("!!document.querySelector('dialog.text[open]')"));
        if (how === 'escape') await b.press('Escape');
        else await b.evaluate("document.querySelector('dialog.text button').click()");
        assert.ok(await b.waitFor("!document.querySelector('dialog.text')"));
        assert.ok(await b.waitFor(`document.activeElement === ${summary}`), `focus after ${how}`);
      }
      const mode = "document.querySelector('[data-testid=engagement-customize]')";
      await b.evaluate(`(() => { const m = ${mode}; m.focus(); m.click(); })()`);
      assert.equal(await b.evaluate(`document.activeElement === ${mode} && ${mode}.textContent === 'Done'`), true);
      await b.evaluate(`${mode}.click()`);
      assert.equal(await b.evaluate(`document.activeElement === ${mode} && ${mode}.textContent === 'Customize rows…'`), true);
    });

    await t.test('opening a file leaves the start screen; Go to opens the finding a suggestion names', async () => {
      await b.setFile('[data-testid=open-input]', sample);
      // The edits above are unsaved, so opening asks first.
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 60000));
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=start]')"), false);
      await b.evaluate(nav('Check'));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=review-state]').textContent"), 'Almost ready');
      const item = "[...document.querySelectorAll('[data-testid=warnings] li')].find((li) => li.textContent.includes('Security headers missing'))";
      await b.evaluate(`${item}.querySelector('button.go').click()`);
      assert.ok(await b.waitFor("document.querySelector('.navitem.active')?.textContent.includes('Security headers missing')"));
    });

    await t.test('stage 3: the title leads, text grows with content, finding actions sit in its menu', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset token')).click()");
      assert.ok(await b.waitFor("!!document.querySelector('input.title-input[data-testid=finding-title]')"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=finding-id]').textContent"), /-1$/);
      assert.doesNotMatch(await b.evaluate("document.querySelector('main').textContent"), /\bnull\b/);
      const area = "document.querySelector('[data-testid=impact]')";
      const before = await b.evaluate(`${area}.getBoundingClientRect().height`);
      await b.evaluate(`(() => { const a = ${area}; a.value += '\\n\\nOne more paragraph.\\n\\nAnd another.'; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      assert.ok(await b.evaluate(`${area}.getBoundingClientRect().height`) > before + 20, 'the box grew');
      assert.ok(await b.evaluate("[...document.querySelectorAll('[data-testid=finding-menu] button')].some((x) => x.textContent === 'Delete')"));
      assert.equal(await b.evaluate("document.querySelectorAll('.blocks .insert.end').length"), 1);
      // a long block keeps its full height when another block is added.
      await b.evaluate("(() => { const a = document.querySelector('[data-testid=details-text]'); a.value = Array.from({ length: 25 }, (_, i) => 'line ' + i).join('\\n'); a.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate("document.querySelector('.blocks .insert.end [data-testid=add-text]').click()");
      assert.ok(await b.waitFor("(() => { const a = document.querySelector('[data-testid=details-text]'); return a.scrollHeight - a.clientHeight <= 2 && a.clientHeight > 300; })()", 5000), 'refitted after the local redraw');
      // visiting findings adds no document listeners.
      const listeners = await b.evaluate('window.__clickListeners');
      for (let k = 0; k < 10; k++) await b.evaluate(`document.querySelectorAll('.nav li.sortable .navitem')[${k % 3}].click()`);
      assert.equal(await b.evaluate('window.__clickListeners'), listeners);
    });

    await t.test('a download says "Download requested", never "Saved"; an edit shows Unsaved changes', async () => {
      // Without a save dialog (Firefox), Save itself downloads.
      await b.evaluate("(document.querySelector('[data-testid=download-project]') || document.querySelector('[data-testid=save]')).click()");
      await waitForFile(dir, /\.rootnote\.json$/);
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=file-state]').hidden"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=file-state]').textContent"), /^Download requested · /);
      await b.evaluate(nav('Details & cover'));
      await b.evaluate("(() => { const i = document.querySelector('main input[type=text]'); i.value = i.value + ' x'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      assert.ok(await b.waitFor("document.querySelector('[data-testid=file-state]').hidden"));
      assert.equal(await b.evaluate("document.querySelector('.dirty').hidden"), false);
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
