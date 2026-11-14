// Schema v6 in the app: the user's own report sections and a CWE and
// vulnerability type per finding. Adding, renaming (title and report-order name together),
// writing, moving among other sections, the preview and Contents, removing (asks when it has
// text), and the classification fields with their report display settings.
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
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;
const type = (sel, v) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;

for (const [engine, port] of [['chrome', 9594], ['firefox', 9694]]) test(`own sections and classification in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    // A blank report: the sample already has its own section and classifications.
    await b.evaluate("document.querySelector('[data-testid=start-new]').click()");
    assert.ok(await b.waitFor(`${snap}.schemaVersion === 8 && ${snap}.findings.length === 0`));

    await t.test('Add creates an enabled, empty section before the findings summary; nothing prints yet', async () => {
      await b.evaluate("document.querySelector('[data-testid=custom-add]').click()");
      const p = (await b.evaluate(snap)).project;
      assert.equal(p.customSections.length, 1);
      const c = p.customSections[0];
      assert.match(c.id, /^C[0-9a-f]{23}$/);
      const keys = p.sections.report.map((s) => s.key);
      assert.equal(keys.indexOf(`custom-${c.id}`), keys.indexOf('findingsSummary') - 1);
      assert.equal(p.sections.report.find((s) => s.key === `custom-${c.id}`).enabled, true);
      assert.equal(await b.evaluate("document.activeElement.dataset.testid"), 'custom-title', 'the title is ready to type');
    });

    await t.test('typing the title renames the report-order name too; the text prints with a Contents link', async () => {
      await b.evaluate(type('[data-testid=custom-title]', 'Conclusion'));
      await b.evaluate(type('[data-testid=custom-text]', 'The portal needs the two critical fixes before release.'));
      const p = (await b.evaluate(snap)).project;
      const c = p.customSections[0];
      assert.equal(c.title, 'Conclusion');
      assert.equal(p.sections.report.find((s) => s.key === `custom-${c.id}`).label, 'Conclusion');
      await b.evaluate(nav('Sections & scoring'));
      await b.evaluate("document.querySelector('[data-testid=sections-report] input[aria-label=\"Show Contents\"]').click()"); // off in a new report
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor(`!!document.getElementById('pv-report_custom_${c.id}')`, 20000));
      assert.equal(await b.evaluate(`document.getElementById('pv-report_custom_${c.id}').textContent`), 'Conclusion');
      assert.ok(await b.evaluate(`[...document.querySelectorAll('.pv-contents a')].some((a) => a.getAttribute('href') === '#pv-report_custom_${c.id}')`));
    });

    await t.test('in Sections & scoring it moves like any section and renaming there renames it everywhere', async () => {
      await b.evaluate(nav('Sections & scoring'));
      const c = (await b.evaluate(snap)).project.customSections[0];
      const input = `[data-testid=sections-report] input[data-key="custom-${c.id}"]`;
      assert.ok(await b.evaluate(`!!document.querySelector('${input}')`));
      await b.evaluate(type(input, 'Conclusions'));
      let p = (await b.evaluate(snap)).project;
      assert.equal(p.customSections[0].title, 'Conclusions');
      assert.equal(p.sections.report.find((s) => s.key === `custom-${c.id}`).label, 'Conclusions');
      // An emptied name keeps the old one.
      await b.evaluate(type(input, '   '));
      assert.equal((await b.evaluate(snap)).project.customSections[0].title, 'Conclusions');
      await b.evaluate(`document.querySelector('${input}').closest('li').querySelector('button[aria-label^="Move"][aria-label$="up"], button[aria-label*="up"]').click()`);
      p = (await b.evaluate(snap)).project;
      assert.equal(p.sections.report[0].key, 'contents', 'Contents stays first');
      assert.ok(p.sections.report.findIndex((s) => s.key === `custom-${c.id}`) < p.sections.report.findIndex((s) => s.key === 'ratingMethod'));
    });

    await t.test('Remove asks when the section has text; Cancel keeps it; Remove takes it and its row out', async () => {
      await b.evaluate(nav('Details & cover'));
      await b.evaluate("document.querySelector('[data-testid=custom-remove]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      assert.match(await b.evaluate("document.querySelector('dialog.confirm').textContent"), /Remove the section "Conclusions" and its text\?/);
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      assert.ok(await b.waitFor("!document.querySelector('dialog.confirm')"));
      assert.equal((await b.evaluate(snap)).project.customSections.length, 1);
      await b.evaluate("document.querySelector('[data-testid=custom-remove]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.project.customSections.length === 0`));
      assert.ok(!(await b.evaluate(snap)).project.sections.report.some((s) => s.key.startsWith('custom-')));
    });

    await t.test('at most ten sections', async () => {
      for (let i = 0; i < 10; i++) await b.evaluate("document.querySelector('[data-testid=custom-add]').click()");
      assert.equal((await b.evaluate(snap)).project.customSections.length, 10);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=custom-add]').disabled"), true);
      // Empty sections go without a question.
      for (let i = 0; i < 10; i++) await b.evaluate("document.querySelector('[data-testid=custom-remove]').click()");
      assert.ok(await b.waitFor(`${snap}.project.customSections.length === 0`));
    });

    await t.test('CWE and vulnerability type: an invalid CWE is not stored and says so; valid values show in key facts', async () => {
      await b.evaluate("document.querySelector('[data-testid=add-finding]').click()");
      await b.evaluate(type('[data-testid=finding-title]', 'Password reset token disclosed'));
      await b.evaluate(type('[data-testid=finding-cwe]', 'cwe 640'));
      assert.equal((await b.evaluate(snap)).findings[0].cwe, '');
      assert.match(await b.evaluate("document.querySelector('[data-testid=cwe-note]').textContent"), /Not saved yet/);
      await b.evaluate(type('[data-testid=finding-cwe]', 'CWE-640'));
      await b.evaluate(type('[data-testid=finding-type]', 'Weak password recovery'));
      const f = (await b.evaluate(snap)).findings[0];
      assert.deepEqual([f.cwe, f.vulnerabilityType], ['CWE-640', 'Weak password recovery']);
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("[...document.querySelectorAll('.pv-keyfacts')].some((t) => t.textContent.includes('CWE-640') && t.textContent.includes('Weak password recovery'))", 20000));
      assert.equal(await b.evaluate("[...document.querySelectorAll('.pv-summary th')].some((th) => th.textContent === 'Classification')"), false, 'no column by default');
      await b.evaluate(nav('Sections & scoring'));
      await b.evaluate("[...document.querySelectorAll('[data-testid=classification-display] label')].find((l) => l.textContent.includes('classification column')).querySelector('input').click()");
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("[...document.querySelectorAll('.pv-summary th')].some((th) => th.textContent === 'Classification')", 20000));
      assert.ok(await b.evaluate("[...document.querySelectorAll('.pv-summary td')].some((td) => td.textContent === 'Weak password recovery (CWE-640)')"));
    });

    await t.test('a finding added with + Add finding is a valid v6 finding: it previews and its project saves valid', async () => {
      await b.evaluate("document.querySelector('[data-testid=add-finding]').click()");
      const f = (await b.evaluate(snap)).findings.at(-1);
      assert.deepEqual([f.cwe, f.vulnerabilityType], ['', ''], 'optional fields stay empty');
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=preview] .pv-page').length > 0", 20000));
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=preview] .hint')"), false, 'no "could not be built" message');
      const { validateProjectFile } = await import('../src/app/project.js');
      const raw = JSON.stringify(await b.evaluate(snap));
      const v = await validateProjectFile(raw, Buffer.byteLength(raw));
      assert.ok(v.ok, (v.errors || []).join('; '));
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
