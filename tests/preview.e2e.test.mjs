// Live preview: pages built from the shared report plan, split parts crop exactly the
// plan's source rows, the fit/split control edits the project and redraws, summary links
// resolve, and the view says pagination is approximate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, sleep } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/bounds.json');
const snap = 'window.__fieldnote.snapshot()';

for (const [engine, port] of [['chrome', 9591], ['firefox', 9691]]) test(`live preview in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  // The driver records every request other than the pages the test opens itself.
  const requests = b.requests;
  const goPreview = () => b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Preview report').click()");
  const figures = (id) => b.evaluate(`[...document.querySelectorAll('.pv-figure[data-image=${id}]')].map((f) => { const c = f.querySelector('.pv-crop'), i = c.querySelector('img');
    return { h: c.getBoundingClientRect().height, top: parseFloat(i.style.top), imgH: parseFloat(i.style.height), caption: f.querySelector('.pv-caption').textContent }; })`);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 20`, 60000));

    await t.test('renders pages with the approximate-pagination notice', async () => {
      await goPreview();
      assert.ok(await b.waitFor("document.querySelectorAll('.pv-page').length > 20", 30000));
      assert.match(await b.evaluate("document.querySelector('[data-testid=preview-note]').textContent"), /^Approximate pages; check the exported report in Word\./);
      assert.equal(await b.evaluate("document.querySelectorAll('.pv-figure').length"), 30, 'fixture tall images are stored as fit');
      // Page boxes stack in normal flow (regression: a class clash once stacked them).
      const tops = await b.evaluate("[...document.querySelectorAll('.pv-page')].slice(0, 3).map((p) => Math.round(p.getBoundingClientRect().top))");
      assert.ok(tops[0] < tops[1] && tops[1] < tops[2], JSON.stringify(tops));
      assert.match(await b.evaluate("[...document.querySelectorAll('.pv-footer')].at(-1).textContent"), /Page (\d+) of \1$/);
    });

    await t.test('summary title links point at their findings', async () => {
      const ok = await b.evaluate(`[...document.querySelectorAll('.pv-summary a')].every((a) => document.querySelector(a.getAttribute('href')) !== null)`);
      const n = await b.evaluate("document.querySelectorAll('.pv-summary a').length");
      assert.equal(n, 20);
      assert.equal(ok, true);
    });

    await t.test('switching a tall screenshot to split edits the project and crops every source row once', async () => {
      const tall = await b.evaluate(`${snap}.images.find((i) => i.height > 3000)`);
      await b.evaluate(`(() => { const s = document.querySelector('.pv-figure[data-image=${tall.id}] select'); s.value = 'split'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      assert.ok(await b.waitFor(`document.querySelectorAll('.pv-figure[data-image=${tall.id}]').length > 1`, 20000));
      assert.equal((await b.evaluate(snap)).images.find((i) => i.id === tall.id).tallMode, 'split');
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);
      const parts = await figures(tall.id);
      // Each part shows the image scaled to the same height and shifted by the rows above
      // it; together the crop heights cover the full scaled image exactly.
      const scaledH = parts[0].imgH;
      parts.forEach((p) => assert.ok(Math.abs(p.imgH - scaledH) < 0.6));
      const covered = parts.reduce((n, p) => n + p.h, 0);
      assert.ok(Math.abs(covered - scaledH) < parts.length, `${covered} vs ${scaledH}`);
      let expectedTop = 0;
      for (const p of parts) { assert.ok(Math.abs(p.top + expectedTop) < 1, `${p.top} vs -${expectedTop}`); expectedTop += p.h; }
      parts.forEach((p, k) => assert.match(p.caption, new RegExp(`\\(part ${k + 1} of ${parts.length}\\)$`)));
      // The finding's screenshot card reports the same number of parts.
      const fIndex = (await b.evaluate(snap)).findings.findIndex((f) => f.evidence.includes(tall.id));
      await b.evaluate(`document.querySelectorAll('.nav li.sortable .navitem')[${fIndex}].click()`);
      assert.match(await b.evaluate(`document.querySelector('.card[data-image=${tall.id}] [data-testid=part-count]').textContent`), new RegExp(`${parts.length} parts`));
    });

    await t.test('paper size change redraws and is saved in the project', async () => {
      await goPreview();
      await b.waitFor("document.querySelectorAll('.pv-page').length > 20", 30000);
      const a4 = await b.evaluate("document.querySelector('.pv-page').getBoundingClientRect().height");
      await b.evaluate("(() => { const s = document.querySelector('[data-testid=preview-paper]'); s.value = 'Letter'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await sleep(500);
      const letter = await b.evaluate("document.querySelector('.pv-page').getBoundingClientRect().height");
      assert.equal((await b.evaluate(snap)).project.paperSize, 'Letter');
      assert.ok(Math.abs(a4 - 16838 / 15) < 1 && Math.abs(letter - 15840 / 15) < 1, `${a4} ${letter}`);
    });

    await t.test('bound engagement values stay literal: a leading "- " is not a bullet', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Details & cover').click()");
      await b.evaluate(`(() => { const i = [...document.querySelectorAll('.field')].find((f) => f.querySelector('.label')?.textContent === 'Client').querySelector('input');
        i.value = '- Literal Co'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Sections & scoring').click()");
      await b.evaluate("(() => { const c = document.querySelector('[data-testid=sections-report] input[aria-label=\"Show Engagement details\"]'); if (!c.checked) c.click(); })()");
      await goPreview();
      assert.ok(await b.waitFor("!!document.querySelector('.pv-engagement')", 30000));
      const cell = await b.evaluate("[...document.querySelectorAll('.pv-engagement tr')].find((r) => r.querySelector('th').textContent === 'Customer').querySelector('td').innerHTML");
      assert.match(cell, /^<p>- Literal Co<\/p>$/);
    });

    await t.test('no network requests', () => {
      assert.deepEqual(requests, []);
    });
  } finally {
    await b.close();
  }
});
