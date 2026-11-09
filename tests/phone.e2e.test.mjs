// Phones: explore Rootnote and the sample. At phone width the
// section list folds behind "Report contents", choosing a section shows it from its top, the
// start screen says a computer is for writing, and the preview fits whole pages to the width
// with Actual size for reading. Desktop emulation only: this is a layout check, not a real phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`;
const noOverflow = "[...document.querySelectorAll('.main *')].every((e) => e.closest('.pv.pv-scroll') || e.getBoundingClientRect().right <= innerWidth + 1)";

for (const [engine, port] of [['chrome', 9585], ['firefox', 9685]]) test(`phone layout in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 150000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.setViewport({ width: 390, height: 844 });
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));

    await t.test('the start screen says a computer is for writing', async () => {
      assert.equal(await b.evaluate(shown('[data-testid=phone-note]')), true);
      assert.match(await b.evaluate("document.querySelector('[data-testid=phone-note]').textContent"), /To write and save reports, use a computer/);
    });

    await t.test('the sections fold behind Report contents; choosing one shows it', async () => {
      await b.evaluate("document.querySelector('[data-testid=start-sample]').click()");
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 8'));
      assert.equal(await b.evaluate(shown('[data-testid=nav-toggle]')), true);
      assert.equal(await b.evaluate(shown('#report-nav')), false, 'the list is folded');
      await b.evaluate("document.querySelector('[data-testid=nav-toggle]').click()");
      assert.equal(await b.evaluate(shown('#report-nav')), true);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=nav-toggle]').getAttribute('aria-expanded')"), 'true');
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset')).click()");
      assert.equal(await b.evaluate(shown('#report-nav')), false, 'choosing closes the list');
      assert.equal(await b.evaluate("document.activeElement.tagName"), 'H1', 'the chosen section has focus at its heading');
      assert.match(await b.evaluate("document.querySelector('[data-testid=nav-toggle]').textContent"), /Password reset token/);
      assert.equal(await b.evaluate(noOverflow), true, 'nothing runs past the screen edge');
    });

    await t.test('the top Check & export button also closes the list and shows the view from its top', async () => {
      await b.evaluate("document.querySelector('[data-testid=nav-toggle]').click()");
      assert.equal(await b.evaluate(shown('#report-nav')), true);
      await b.evaluate('window.scrollTo(0, 400)');
      await b.evaluate("document.querySelector('[data-testid=top-export]').click()");
      assert.equal(await b.evaluate(shown('#report-nav')), false, 'the list closes');
      assert.equal(await b.evaluate('window.scrollY'), 0, 'the view starts at the top');
      assert.equal(await b.evaluate("document.activeElement.tagName"), 'H1');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=nav-toggle]').getAttribute('aria-expanded')"), 'false');
    });

    await t.test('the preview fits whole pages, and Actual size scrolls inside the preview', async () => {
      await b.evaluate("document.querySelector('[data-testid=nav-toggle]').click()");
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith('Preview')).click()");
      assert.ok(await b.waitFor("document.querySelectorAll('.pv-page').length > 3"));
      assert.ok(await b.waitFor("(() => { const r = document.querySelector('.pv-page').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })()"), 'the first page fits');
      assert.equal(await b.evaluate(noOverflow), true);
      const full = await b.evaluate("document.querySelector('.pv-page').offsetWidth");
      await b.evaluate("document.querySelector('[data-testid=preview-zoom]').click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=preview-zoom]').textContent"), 'Fit width');
      assert.equal(await b.evaluate("Math.round(document.querySelector('.pv-page').getBoundingClientRect().width)"), full, 'Actual size shows the real page width');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=preview].pv-scroll') !== null"), true);
      assert.equal(await b.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, 'the page itself does not scroll sideways');
    });

    await t.test('printing while the pages are fitted prints them at full size', { skip: engine !== 'chrome' && 'print media emulation is Chrome-only here' }, async () => {
      await b.evaluate("document.querySelector('[data-testid=preview-zoom]').click()"); // back to Fit width
      assert.ok(await b.waitFor("document.querySelectorAll('.pv-fit').length > 0"), 'pages are scaled on screen');
      await b.send('Emulation.setEmulatedMedia', { media: 'print' });
      try {
        const full = await b.evaluate("(() => { const p = document.querySelector('.pv-fit > .pv-page'); return [getComputedStyle(p).transform, Math.round(p.getBoundingClientRect().width), p.offsetWidth]; })()");
        assert.equal(full[0], 'none', 'no scaling in print');
        assert.equal(full[1], full[2], 'the printed page has its real width');
      } finally { await b.send('Emulation.setEmulatedMedia', { media: '' }); }
    });

    await t.test('on a computer nothing changes: no toggle, no note, no scaling', async () => {
      await b.setViewport({ width: 1400, height: 900 });
      await b.evaluate("window.dispatchEvent(new Event('resize'))");
      assert.ok(await b.waitFor("!document.querySelector('.pv-fit')"), 'no scaled pages at desktop width');
      assert.equal(await b.evaluate(shown('[data-testid=nav-toggle]')), false);
      assert.equal(await b.evaluate(shown('#report-nav')), true);
    });
  } finally {
    await b.close();
  }
});
