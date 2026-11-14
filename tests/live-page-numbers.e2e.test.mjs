// The live page lays out only the shown finding and numbers its pages from remembered page
// counts of everything else. For every finding, its live page numbers (header and every
// footer) must equal its pages in the full Preview, also after edits that change pagination:
// a long title, Letter paper, a deleted finding, and the pane hidden on a narrow window.
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
const go = (t) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(t)})).click()`;

for (const [engine, port] of [['chrome', 9594], ['firefox', 9694]]) test(`live page numbers in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 300000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  // Every finding's live numbers against the full Preview.
  const compare = async () => {
    const n = await b.evaluate("document.querySelectorAll('.nav li.sortable').length");
    const live = [];
    for (let i = 0; i < n; i++) {
      await b.evaluate(`document.querySelectorAll('.nav li.sortable .navitem')[${i}].click()`);
      assert.ok(await b.waitFor("/page [0-9]/.test(document.querySelector('[data-testid=live-where]')?.textContent || '')", 20000), `finding ${i}: no page numbers`);
      live.push(await b.evaluate("({ where: document.querySelector('[data-testid=live-where]').textContent, foot: [...document.querySelectorAll('[data-testid=live-pane] .pv-running-footer > span:last-child')].map((s) => s.textContent) })"));
    }
    await b.evaluate(go('Preview report'));
    assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=preview] .pv-page').length > 0", 20000));
    const full = await b.evaluate(`(() => { const body = [...document.querySelectorAll('[data-testid=preview] .pv-page-body')];
      return { total: body.length, starts: [...document.querySelectorAll('[data-testid=preview] h1.pv-finding')].map((h) => body.indexOf(h.closest('.pv-page')) + 1) }; })()`);
    for (let i = 0; i < n; i++) {
      const first = full.starts[i], last = full.starts[i + 1] ? full.starts[i + 1] - 1 : full.total;
      assert.ok(live[i].where.includes(`page ${first}${last > first ? `–${last}` : ''} of ${full.total}`), `finding ${i}: live "${live[i].where}", Preview pages ${first}-${last} of ${full.total}`);
      assert.deepEqual(live[i].foot.map((s) => s.replace(/^\D*/, '')), Array.from({ length: last - first + 1 }, (_, k) => `${first + k} of ${full.total}`), `finding ${i}: footers`);
    }
    return full.total;
  };
  try {
    await b.setViewport({ width: 1600, height: 1000 });
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', sample);
    assert.ok(await b.waitFor("document.querySelectorAll('.nav li.sortable').length === 8", 60000));

    await t.test('as opened', async () => { await compare(); });

    await t.test('after a title long enough to wrap', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()");
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=finding-title]'); i.value = ${JSON.stringify('Customers can read and change other customers\' invoices '.repeat(3).trim())}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 800));
      await compare();
    });

    await t.test('after a long description pushes a finding onto another page', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[2].click()");
      await b.evaluate(`(() => { const a = document.querySelector('[data-testid=description]'); a.value = ${JSON.stringify('A long paragraph that adds a page. '.repeat(160))}; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 800));
      await compare();
    });

    await t.test('on Letter paper', async () => {
      await b.evaluate(go('Preview report'));
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=preview-paper]')", 20000));
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=preview-paper]'); s.value = 'Letter'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await compare();
    });

    await t.test('after a finding is deleted', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[4].click()");
      const del = await b.evaluate("(() => { const x = [...document.querySelectorAll('[data-testid=finding-menu] button')].find((e) => e.textContent === 'Delete'); if (!x) return false; x.click(); return true; })()");
      assert.ok(del, 'Delete finding control found');
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')", 10000));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor("document.querySelectorAll('.nav li.sortable').length === 7", 10000));
      await compare();
    });

    await t.test('after the pane was hidden on a narrow window and shown again', async () => {
      await b.setViewport({ width: 1000, height: 900 });
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[3].click()");
      await b.evaluate(`(() => { const a = document.querySelector('[data-testid=impact]'); a.value = ${JSON.stringify('Narrow window edit. '.repeat(120))}; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 800));
      await b.setViewport({ width: 1600, height: 1000 });
      await compare();
    });
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
  } finally {
    await b.close();
  }
});
