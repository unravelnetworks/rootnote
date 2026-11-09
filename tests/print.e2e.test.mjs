// Print / Save as PDF: the browser prints only the preview page boxes, one
// per sheet, at the report's paper size, with the internal summary links kept.
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

for (const [name, port] of [['chrome', 9593], ['edge', 9593], ['firefox', 9693]]) {
  test(`print to PDF (${name})`, { skip: !installed(name) && `${name} not installed`, timeout: 180000 }, async (t) => {
    assert.ok(existsSync(dist), 'run npm run build first');
    const b = await launch(name, port);
    try {
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 20', 60000));
      await b.evaluate('window.print = () => { window.__printed = (window.__printed || 0) + 1; }; 0');

      for (const [paper, box] of [['A4', [595.28, 841.89]], ['Letter', [612, 792]]]) {
        await t.test(`${paper}: one sheet per preview page at the paper size, links kept`, async () => {
          await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith('Check')).click()");
          await b.evaluate(`document.querySelector('[data-testid=export-paper]').value = '${paper}'`);
          const before = await b.evaluate('window.__printed || 0');
          await b.evaluate("document.querySelector('[data-testid=export-pdf]').click()");
          assert.ok(await b.waitFor(`(window.__printed || 0) > ${before}`, 30000), 'print dialog not requested');
          assert.equal(await b.evaluate("document.querySelector('.navitem.active').textContent"), 'Preview report');
          // The print rule is a constructed style sheet (the CSP pins the page's one <style>).
          const printRules = () => b.evaluate("[...document.adoptedStyleSheets].map((s) => [...s.cssRules].map((r) => r.cssText).join(' ')).filter((t) => /size: (210mm 297mm|8\.5in 11in)/.test(t)).join('|')");
          assert.match(await printRules(), paper === 'A4' ? /size: 210mm 297mm/ : /size: 8\.5in 11in/);
          await sleep(200);
          const pages = await b.evaluate("document.querySelectorAll('.pv-page').length");
          const pdf = (await b.printPdf(paper)).toString('latin1');
          const sheets = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
          assert.equal(sheets, pages, 'one PDF sheet per preview page');
          // Every sheet within 1 pt of the paper size (Firefox rounds sheet sizes to whole points).
          const boxes = (pdf.match(/MediaBox\s*\[[^\]]+\]/g) || []).map((m) => m.match(/[\d.]+/g).slice(2).map(Number));
          assert.ok(boxes.length >= pages);
          for (const [w, h] of boxes) assert.ok(Math.abs(w - box[0]) <= 1 && Math.abs(h - box[1]) <= 1, `sheet ${w}x${h} is not ${paper}`);
          // Chrome and Edge keep one internal link per summary title. Firefox prints plain-text
          // twins instead (it would store the page address in each link; print-links.e2e covers it).
          assert.equal((pdf.match(/\/Subtype\s*\/Link/g) || []).length, name === 'firefox' ? 0 : 20, 'summary links in the PDF');
          await b.evaluate("window.dispatchEvent(new Event('afterprint'))");
          assert.equal(await printRules(), '', 'print page rule removed after printing');
        });
      }

      // BiDi cannot emulate print media; in Firefox the one-sheet-per-preview-page check above
      // is the evidence that nothing else prints.
      await t.test('print hides the app chrome and preview controls', { skip: name === 'firefox' && 'no print media emulation in BiDi' }, async () => {
        await b.send('Emulation.setEmulatedMedia', { media: 'print' });
        const visible = await b.evaluate("['.top', '.nav', '.pv-note', '.pv-toolbar', '.pv-control'].filter((s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== 'none'))");
        await b.send('Emulation.setEmulatedMedia', { media: '' });
        assert.deepEqual(visible, []);
      });

      await t.test('Check & export shows the Google Drive folder hint', async () => {
        await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith('Check')).click()");
        assert.match(await b.evaluate("document.querySelector('[data-testid=drive-hint]').textContent"), /Google Drive for desktop/);
      });
      assert.deepEqual(b.errors, [], 'page errors or CSP violations');
      assert.deepEqual(b.requests, [], 'network requests');
    } finally {
      await b.close();
    }
  });
}
