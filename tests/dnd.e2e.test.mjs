// Drag and drop reordering: report and finding sections, engagement rows,
// findings in the side list and Additional details blocks. The arrows remain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
const snap = 'window.__fieldnote.snapshot()';

// Drags the handle of row `from` onto row `to` within the rows matched by `rows`.
const DRAG = (rows, from, to) => `(() => {
  const list = [...document.querySelectorAll(${JSON.stringify(rows)})];
  const dt = new DataTransfer();
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  const handle = list[${from}].querySelector('[data-testid=drag-handle]');
  fire(handle, 'dragstart');
  fire(list[${to}], 'dragover');
  fire(list[${to}], 'drop');
  fire(handle, 'dragend');
})()`;

for (const [engine, port] of [['chrome', 9594], ['firefox', 9694]]) test(`drag and drop reordering in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  const nav = (label) => b.evaluate(`[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`));

    await t.test('report sections: drag the last section to the top; Contents stays pinned first', async () => {
      await nav('Sections & scoring');
      const before = (await b.evaluate(snap)).project.sections.report.map((s) => s.key);
      assert.ok(before.indexOf('contents') > 0, 'a converted file has Contents appended (schema v4), not first');
      // Contents is pinned: no handle or arrows, shown first whatever its stored place.
      assert.equal(await b.evaluate("document.querySelector('[data-testid=sections-report] > li input[data-key]').dataset.key"), 'contents');
      assert.equal(await b.evaluate("document.querySelectorAll('[data-testid=pinned-contents] [data-testid=drag-handle], [data-testid=pinned-contents] button').length"), 0);
      const others = before.filter((k) => k !== 'contents');
      const last = others.length - 1;
      await b.evaluate(DRAG('[data-testid=sections-report] > li:not(.pinned)', last, 0));
      const after = (await b.evaluate(snap)).project.sections.report.map((s) => s.key);
      assert.deepEqual(after, ['contents', others[last], ...others.slice(0, last)]);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=sections-report] > li:not(.pinned) input[data-key]').dataset.key"), others[last], 'list redrawn in the new order');
    });

    await t.test('a drag from one list is ignored by another list', async () => {
      const report = (await b.evaluate(snap)).project.sections.report.map((s) => s.key);
      const finding = (await b.evaluate(snap)).project.sections.finding.map((s) => s.key);
      await b.evaluate(`(() => {
        const dt = new DataTransfer();
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        const handle = document.querySelector('[data-testid=sections-report] > li [data-testid=drag-handle]');
        const target = document.querySelectorAll('[data-testid=sections-finding] > li')[2];
        fire(handle, 'dragstart'); fire(target, 'dragover'); fire(target, 'drop'); fire(handle, 'dragend');
      })()`);
      assert.deepEqual((await b.evaluate(snap)).project.sections.report.map((s) => s.key), report);
      assert.deepEqual((await b.evaluate(snap)).project.sections.finding.map((s) => s.key), finding);
    });

    await t.test('engagement rows', async () => {
      await nav('Details & cover');
      await b.evaluate("document.querySelector('[data-testid=engagement-customize]').click()"); // rows move in Customize rows
      const before = (await b.evaluate(snap)).project.engagement.rows.map((r) => r.label);
      await b.evaluate(DRAG('.erow', 0, 2));
      const after = (await b.evaluate(snap)).project.engagement.rows.map((r) => r.label);
      assert.deepEqual(after, [before[1], before[2], before[0], ...before.slice(3)]);
    });

    await t.test('findings in the side list renumber after a drag', async () => {
      const ids = (await b.evaluate(snap)).findings.map((f) => f.id);
      await b.evaluate(DRAG('.nav li.sortable', 2, 0));
      assert.deepEqual((await b.evaluate(snap)).findings.map((f) => f.id), [ids[2], ids[0], ids[1]]);
      assert.match(await b.evaluate("document.querySelector('.nav li.sortable .fid').textContent"), /-1$/);
    });

    await t.test('Additional details blocks', async () => {
      await b.evaluate("document.querySelector('.nav li.sortable .navitem').click()");
      // Add a second text block so there are two to reorder.
      await b.evaluate("document.querySelectorAll('[data-testid=details-blocks] [data-testid=add-text]')[1].click()");
      const before = (await b.evaluate(snap)).findings[0].details.map((x) => x.id);
      assert.equal(before.length, 2);
      await b.evaluate(DRAG('[data-testid=details-blocks] .block.sortable', 1, 0));
      assert.deepEqual((await b.evaluate(snap)).findings[0].details.map((x) => x.id), [before[1], before[0]]);
    });

    await t.test('screenshot cards keep image and caption side by side with the handle', async () => {
      await b.setViewport({ width: 1440, height: 1000 });
      const r = await b.evaluate(`(() => { const c = document.querySelector('figure.card.sortable'); const img = c.querySelector('img').getBoundingClientRect(); const cap = c.querySelector('figcaption').getBoundingClientRect();
        return { imgRight: img.right, capLeft: cap.left, capWidth: cap.width, sameRow: Math.abs(img.top - cap.top) < 20 }; })()`);
      assert.ok(r.capLeft >= r.imgRight, JSON.stringify(r));
      assert.ok(r.sameRow && r.capWidth > 400, JSON.stringify(r));
      await b.setViewport(null);
    });
  } finally {
    await b.close();
  }
});
