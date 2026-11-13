// Schema v4 in the app: engagement and finding status,
// where status is shown, references (rule 18, literal and wrapped, A2) and the linked contents
// list (rule 20), plus a converted older file showing Not set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { validateProjectFile } = await import('../src/app/project.js');
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const v2fixture = here('./fixtures/v2-small.json');
const snap = 'window.__fieldnote.snapshot()';
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;
const select = (sel, value) => `(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const type = (sel, value) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const check = (label) => `(() => { const c = [...document.querySelectorAll('label.check')].find((l) => l.textContent.trim() === ${JSON.stringify(label)}).querySelector('input'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const LONG_URL = `https://example.org/${'a'.repeat(2048 - 20)}`;

for (const [engine, port] of [['chrome', 9598], ['firefox', 9698]]) test(`schema v4 features in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  assert.equal(LONG_URL.length, 2048);
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen

    await t.test('a new project is current (v6) and Draft; the engagement status can be changed', async () => {
      const d = await b.evaluate(snap);
      assert.equal(d.schemaVersion, 8);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=engagement-status]').selectedOptions[0].textContent"), 'Draft');
      await b.evaluate(select('[data-testid=engagement-status]', 'delivered'));
      assert.equal(await b.evaluate(`${snap}.project.engagementStatus`), 'delivered');
      await b.evaluate(select('[data-testid=engagement-status]', ''));
      assert.equal(await b.evaluate(`${snap}.project.engagementStatus`), null);
    });

    await t.test('a new finding is Open; its status shows in key facts', async () => {
      await b.evaluate("document.querySelector('[data-testid=add-finding]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 1`));
      assert.equal(await b.evaluate(`${snap}.findings[0].status`), 'open');
      await b.evaluate(type('[data-testid=finding-title]', 'IDOR on invoices'));
      await b.evaluate(select('[data-testid=finding-status]', 'partly_fixed'));
      assert.equal(await b.evaluate(`${snap}.findings[0].status`), 'partly_fixed');
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("!!document.querySelector('.pv-keyfacts')"));
      assert.ok(await b.evaluate("[...document.querySelectorAll('.pv-keyfacts tr')].some((r) => r.textContent === 'StatusPartly fixed')"));
    });

    await t.test('references: valid rows are stored and printed as text; invalid ones are refused whole', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('IDOR on invoices')).click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=references]')"));
      await b.evaluate(type('[data-testid=new-reference-title]', 'OWASP WSTG v4.2 WSTG-ATHZ-04'));
      await b.evaluate(type('[data-testid=new-reference-url]', 'https://owasp.org/www-project-web-security-testing-guide/'));
      await b.evaluate("document.querySelector('[data-testid=add-reference]').click()");
      assert.deepEqual(await b.evaluate(`${snap}.findings[0].references`), [{ title: 'OWASP WSTG v4.2 WSTG-ATHZ-04', url: 'https://owasp.org/www-project-web-security-testing-guide/' }]);
      await b.evaluate(type('[data-testid=new-reference-title]', 'Bad'));
      await b.evaluate(type('[data-testid=new-reference-url]', 'javascript:alert(1)'));
      await b.evaluate("document.querySelector('[data-testid=add-reference]').click()");
      assert.match(await b.evaluate("document.querySelector('[data-testid=reference-error]').textContent"), /^Not added: .*http/);
      assert.equal(await b.evaluate(`${snap}.findings[0].references.length`), 1);
      // Characters Word cannot store are refused, not stored and later rejected on reopen.
      await b.evaluate(type('[data-testid=new-reference-title]', 'Odd'));
      await b.evaluate(type('[data-testid=new-reference-url]', 'https://owasp.org/￾'));
      await b.evaluate("document.querySelector('[data-testid=add-reference]').click()");
      assert.match(await b.evaluate("document.querySelector('[data-testid=reference-error]').textContent"), /cannot be written to Word/);
      assert.equal(await b.evaluate(`${snap}.findings[0].references.length`), 1);
      for (const bad of ['￿', '\uD800']) {
        await b.evaluate(type('[data-testid=reference-url]', `https://owasp.org/${bad}`));
        assert.match(await b.evaluate("document.querySelector('[data-testid=reference-error]').textContent"), /^Not changed: .*cannot be written to Word/);
        assert.equal(await b.evaluate(`${snap}.findings[0].references[0].url`), 'https://owasp.org/www-project-web-security-testing-guide/');
      }
      // What Save would write still opens.
      const saved = JSON.stringify(await b.evaluate(snap));
      assert.equal((await validateProjectFile(saved, Buffer.byteLength(saved))).ok, true);
      // Editing a stored row to an invalid address leaves it unchanged.
      await b.evaluate(type('[data-testid=reference-url]', 'https://user:pw@owasp.org/'));
      assert.match(await b.evaluate("document.querySelector('[data-testid=reference-error]').textContent"), /user name or password/);
      assert.equal(await b.evaluate(`${snap}.findings[0].references[0].url`), 'https://owasp.org/www-project-web-security-testing-guide/');
      await b.evaluate(type('[data-testid=new-reference-title]', 'Very long address'));
      await b.evaluate(type('[data-testid=new-reference-url]', LONG_URL));
      await b.evaluate("document.querySelector('[data-testid=add-reference]').click()");
      assert.equal(await b.evaluate(`${snap}.findings[0].references.length`), 2);
    });

    await t.test('the preview prints references literally, the long address wrapped inside the page (A2)', async () => {
      for (const paper of ['A4', 'Letter']) {
        await b.evaluate(nav('Preview'));
        await b.evaluate(select('[data-testid=preview-paper]', paper));
        assert.ok(await b.waitFor("document.querySelectorAll('.pv-reference').length === 2"));
        const urls = await b.evaluate("[...document.querySelectorAll('.pv-reference-url')].map((e) => e.textContent)");
        assert.deepEqual(urls, ['https://owasp.org/www-project-web-security-testing-guide/', LONG_URL]);
        assert.equal(await b.evaluate("document.querySelectorAll('.pv-reference a').length"), 0, 'no links from references');
        const overflow = await b.evaluate("[...document.querySelectorAll('.pv-page')].map((p) => p.scrollWidth - p.clientWidth).filter((d) => d > 0).length");
        assert.equal(overflow, 0, `${paper}: a page box overflows`);
        const url = await b.evaluate("(() => { const u = document.querySelectorAll('.pv-reference-url')[1].getBoundingClientRect(); const p = document.querySelectorAll('.pv-reference-url')[1].closest('.pv-page').getBoundingClientRect(); return u.right <= p.right + 0.5 && u.height > 40; })()");
        assert.ok(url, `${paper}: the long address does not wrap inside the page`);
      }
    });

    await t.test('status column, status counts and the note appear only when switched on', async () => {
      await b.evaluate(nav('Preview'));
      assert.equal(await b.evaluate("document.querySelectorAll('.pv-counts[data-distribution=status]').length"), 0);
      await b.evaluate(nav('Sections & scoring'));
      await b.evaluate(check('Add a status column to the findings summary'));
      await b.evaluate(check('Count findings by status in the findings summary'));
      assert.deepEqual(await b.evaluate(`${snap}.project.findingStatusDisplay`), { keyFacts: true, summaryColumn: true, counts: true });
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("!!document.querySelector('.pv-counts[data-distribution=status]')"));
      // Compact table: statuses across, one count row, a zero Not set column left out.
      const rows = await b.evaluate("[...document.querySelectorAll('.pv-counts[data-distribution=status] tr')].map((r) => [...r.cells].map((c) => c.textContent))");
      assert.deepEqual(rows, [['Status', 'Open', 'Fixed', 'Partly fixed', 'Risk accepted', 'False positive', 'Total'], ['Findings', '0', '0', '1', '0', '0', '1']]);
      assert.equal(await b.evaluate("document.querySelector('.pv-status-note').textContent"), 'Counts include every finding in this report, whatever its status.');
      assert.ok(await b.evaluate("[...document.querySelectorAll('.pv-summary th')].some((th) => th.textContent === 'Status')"));
      assert.equal(await b.evaluate("document.querySelector('.pv-counts[data-distribution=status] .pv-badge')"), null, 'status rows use no rating colours');
    });

    await t.test('the contents list links every emitted section and finding to exactly one target', async () => {
      await b.evaluate(nav('Sections & scoring'));
      await b.evaluate("(() => { const c = document.querySelector('[aria-label=\"Show Contents\"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()");
      assert.equal(await b.evaluate(`${snap}.project.sections.report.find((s) => s.key === 'contents').enabled`), true);
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("document.querySelectorAll('.pv-contents').length > 0"));
      const links = await b.evaluate("[...document.querySelectorAll('.pv-contents a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))");
      assert.ok(links.some((l) => l.text === 'F-1 IDOR on invoices'), JSON.stringify(links));
      assert.ok(links.some((l) => l.text === 'Findings'));
      for (const l of links) {
        assert.equal(await b.evaluate(`document.querySelectorAll('[id="${l.href.slice(1)}"]').length`), 1, l.href);
      }
      assert.ok(!links.some((l) => l.text === 'Contents'), 'the list excludes itself');
    });

    await t.test('a converted older file shows Not set and adds nothing to the report', async () => {
      await b.evaluate("document.querySelector('[data-testid=new-project]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=blank]')"));
      await b.evaluate("document.querySelector('dialog [data-choice=blank]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 0`));
      await b.setFile('[data-testid=open-input]', v2fixture);
      assert.ok(await b.waitFor(`${snap}.findings.length === 3`), await b.evaluate("document.querySelector('.status').textContent + ' | dialog: ' + (document.querySelector('dialog')?.textContent ?? 'none')"));
      const d = await b.evaluate(snap);
      assert.equal(d.schemaVersion, 8); // converted to the current schema
      assert.equal(d.project.engagementStatus, null);
      assert.ok(d.findings.every((f) => f.status === null));
      assert.match(await b.evaluate("document.querySelector('.status').textContent"), /converted this project from an older version. It now uses this version.s limits: up to 150 findings and 400 screenshots. When you save, it is written as project format 8. Rootnote 0.2.x and earlier cannot open that./);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=engagement-status]').selectedOptions[0].textContent"), 'Not set');
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("!!document.querySelector('.pv-summary')"));
      assert.equal(await b.evaluate("document.querySelectorAll('.pv-contents, .pv-reference, .pv-counts[data-distribution=status], .pv-status-note').length"), 0);
      assert.ok(!(await b.evaluate("[...document.querySelectorAll('.pv-keyfacts th')].some((th) => th.textContent === 'Status')")), 'no status row for converted files');
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
