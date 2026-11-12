// A report uses one CVSS version. A finding that holds a score in the other version (here
// from a file; in practice from a finding library) is kept and flagged, and every export that
// carries CVSS scores is refused until it is rescored or cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyProject, defaultFormats } from '../src/app/project.js';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const snap = 'window.__fieldnote.snapshot()';
const V31 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

function mixedProject() {
  const d = createEmptyProject(new Date('2026-11-12T00:00:00.000Z'));
  d.project.title = 'Mixed CVSS';
  d.project.client = 'Fictional client';
  d.project.scoring.mode = 'severity+cvss';
  d.findings = [V31, V40].map((cvss, i) => ({ id: `F-00${i + 1}`, title: `Finding ${i + 1}`, rating: 'High', cvss, affectedAssets: [], description: 'D', impact: '',
    threat: '', recommendation: '', formats: defaultFormats(), details: [], evidence: [], references: [], status: 'open', cwe: '', vulnerabilityType: '' }));
  d.project.nextFindingNumber = 3;
  return JSON.stringify(d);
}

for (const [engine, port] of [['chrome', 9543], ['firefox', 9643]]) test(`mixed CVSS versions in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(here('./out'), { recursive: true });
  const file = here(`./out/cvss-mixed-${engine}.json`);
  writeFileSync(file, mixedProject());
  const b = await launch(engine, port);
  const status = () => b.evaluate("document.querySelector('.status').textContent");
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 2`));

    await t.test('the mismatched score is kept, shown with its version and flagged on the finding', async () => {
      assert.equal(await b.evaluate(`${snap}.findings[1].cvss`), V40, 'nothing deleted on open');
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()");
      const note = await b.evaluate("document.querySelector('[data-testid=cvss-note]')");
      assert.ok(note);
      assert.match(await b.evaluate("document.querySelector('[data-testid=cvss-note]').textContent"), /Existing CVSS 4\.0 score: 9\.3\. CVSS 3\.1 assessment pending/);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-note]').dataset.kind"), 'error');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-calculator]').open"), true, 'the calculator opens to rescore');
    });

    await t.test('Check & export lists it as blocking, and Word, Markdown and CSV exports are refused', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check & export')).click()");
      assert.equal(await b.evaluate("document.querySelector('[data-testid=review-state]').textContent"), 'Cannot export yet');
      assert.match(await b.evaluate("document.querySelector('.warnings li.fails').textContent"), /CVSS 3\.1 assessment pending \(it has a CVSS 4\.0 score\)\. Apply a CVSS 3\.1 assessment or clear its score; until then, export will fail/);
      for (const id of ['export', 'export-markdown', 'export-csv']) {
        await b.evaluate(`document.querySelector('[data-testid=${id}]').click()`);
        assert.ok(await b.waitFor("/Not exported: 1 finding is scored in another CVSS version/.test(document.querySelector('.status').textContent)"), `${id}: ${await status()}`);
      }
    });

    await t.test('the preview withholds CVSS counts, and no print route shows the report', async () => {
      await b.evaluate("document.querySelector('[data-testid=top-preview]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=preview] .pv-page')"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=cvss-counts-withheld]').textContent"), /counts are not shown: 1 finding is scored in another CVSS version/);
      assert.equal(await b.evaluate("!!document.querySelector('[data-distribution=cvss]')"), false, 'no blended CVSS count table');
      assert.equal(await b.evaluate("getComputedStyle(document.querySelector('[data-testid=print-block]')).display"), 'none', 'on screen the pages stay for correcting');
      if (engine === 'chrome') {
        // Ctrl+P and the browser menu print the page with print media; only the notice shows.
        await b.send('Emulation.setEmulatedMedia', { media: 'print' });
        try {
          assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.pv-pages')).display"), 'none');
          assert.equal(await b.evaluate("getComputedStyle(document.querySelector('[data-testid=print-block]')).display"), 'block');
          assert.match(await b.evaluate("document.querySelector('[data-testid=print-block]').textContent"), /This report was not printed/);
        } finally { await b.send('Emulation.setEmulatedMedia', { media: '' }); }
      }
    });

    await t.test('rescoring in the report version clears the block', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()");
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = ${JSON.stringify(V31)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      assert.equal(await b.evaluate(`${snap}.findings[1].cvss`), V31);
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check & export')).click()");
      assert.notEqual(await b.evaluate("document.querySelector('[data-testid=review-state]').textContent"), 'Cannot export yet');
      await b.evaluate("document.querySelector('[data-testid=top-preview]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-distribution=cvss]')"), 'CVSS counts are back');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=preview]').hasAttribute('data-print-blocked')"), false);
    });
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
