// In the app: the read-only OWASP starter library (add to report, copy
// to my library, unfilled prompts listed in Check & export) and New report from settings
// (what is kept is shown first; client and finding text never come along).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STARTER_LIBRARY, countPrompts } from '../src/app/starter-library.js';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/v2-small.json');
const snap = 'window.__fieldnote.snapshot()';
const status = "document.querySelector('.status').textContent";
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;
const clickNew = "document.querySelector('[data-testid=new-project]').click()";

for (const [engine, port] of [['chrome', 9597], ['firefox', 9697]]) test(`starter library and New from settings in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`));

    await t.test('New shows what is kept, and Keep layout and branding drops client and findings', async () => {
      const before = await b.evaluate(snap);
      await b.evaluate(clickNew);
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=new-dialog]')"));
      const text = await b.evaluate("document.querySelector('[data-testid=new-dialog]').textContent");
      assert.match(text, /report layout/);
      assert.match(text, /never copies:.*findings and screenshots/s);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=new-copied-values]').textContent"),
        `Text copied as is: Your name: ${before.project.testerName.trim() || '(empty)'} · Organisation: ${before.project.organisation.trim() || '(empty)'} · Classification: ${before.project.classification.trim() || '(empty)'}`);
      await b.evaluate("document.querySelector('dialog [data-choice=settings]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 0`));
      const after = await b.evaluate(snap);
      assert.equal(after.project.client, '');
      assert.equal(after.project.title, '');
      assert.equal(after.project.testerName, before.project.testerName);
      assert.deepEqual(after.project.sections, before.project.sections);
      assert.equal(after.images.length, 1, 'only the tester logo');
      assert.equal(after.project.branding.clientLogo.imageId, null);
      assert.match(await b.evaluate(status), /Client details, findings and screenshots were not copied/);
    });

    await t.test('Cancel on New changes nothing', async () => {
      await b.evaluate("(() => { const el = document.querySelector('[data-testid=title]'); el.value = 'Keep me'; el.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate(clickNew);
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=new-dialog]')"));
      await b.evaluate("document.querySelector('dialog button.secondary').click()");
      assert.ok(await b.waitFor("!document.querySelector('dialog')"));
      assert.equal(await b.evaluate(`${snap}.project.title`), 'Keep me');
    });

    await t.test('the starter tab is read-only and labelled', async () => {
      await b.evaluate(nav('Finding library'));
      await b.evaluate("document.querySelector('[data-testid=library-tab-starter]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=starter-note]')"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=starter-note]').textContent"), /Not affiliated with or endorsed by OWASP/);
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), STARTER_LIBRARY.entries.length);
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry input').length"), 0, 'no rename or edit controls');
      // The prompt count includes the reference selection row.
      const e = STARTER_LIBRARY.entries[0];
      const expected = [e.title, e.description, e.impact, e.threat, e.recommendation, ...(e.affectedAssets || []), ...e.details.map((b) => b.text),
        ...e.references.flatMap((r) => [r.title, r.url])].reduce((n, t) => n + countPrompts(t), 0);
      assert.ok(e.references.some((r) => countPrompts(r.title)), 'the A1 row is a prompt');
      assert.match(await b.evaluate("document.querySelector('.library-entry .hint').textContent"), new RegExp(` · ${expected} prompts to fill$`));
    });

    await t.test('add a starter entry, copy one, and see its prompts in Check & export', { skip: !STARTER_LIBRARY.entries.length && 'starter content not in this build yet' }, async () => {
      const entry = STARTER_LIBRARY.entries[0];
      await b.evaluate("document.querySelector('[data-testid=starter-insert]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 1`));
      const f = (await b.evaluate(snap)).findings[0];
      assert.equal(f.title, entry.title);
      assert.equal(f.rating, null);
      assert.equal(f.cvss, null);
      await b.evaluate(nav('Finding library'));
      await b.evaluate("document.querySelector('[data-testid=library-tab-starter]').click()");
      await b.evaluate("document.querySelector('[data-testid=starter-copy]').click()");
      assert.ok(await b.waitFor("document.querySelector('[data-testid=starter-copy]').textContent === 'In your library'"));
      await b.evaluate("document.querySelector('[data-testid=library-tab-mine]').click()");
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
      await b.evaluate(nav('Check'));
      assert.match(await b.evaluate("document.querySelector('[data-testid=warnings]').textContent"), /unfilled \[\[…\]\] prompt/);
    });

    await t.test('the preview shows compact finding counts per level after the findings table', async () => {
      await b.evaluate(nav('Preview'));
      assert.ok(await b.waitFor("!!document.querySelector('.pv-counts')"));
      const tables = await b.evaluate("[...document.querySelectorAll('.pv-counts')].map((t) => ({ d: t.dataset.distribution, head: [...t.querySelectorAll('th')].map((c) => c.textContent), body: [...t.querySelectorAll('td')].map((c) => c.textContent) }))");
      const mode = await b.evaluate(`${snap}.project.scoring.mode`);
      assert.deepEqual(tables.map((t) => t.d), [...(mode === 'cvss' ? [] : ['rating']), ...(mode.includes('cvss') ? ['cvss'] : [])]);
      for (const t of tables) {
        // Levels across, counts below; Unscored shows because it is not zero.
        assert.deepEqual(t.head.slice(-2), ['Unscored', 'Total']);
        assert.deepEqual(t.body.slice(-2), ['1', '1'], 'the starter finding has no rating or vector');
        assert.equal(t.body[0], 'Findings');
      }
      assert.ok(await b.evaluate("document.querySelector('.pv-summary').compareDocumentPosition(document.querySelector('.pv-counts')) & Node.DOCUMENT_POSITION_FOLLOWING"));
      // The back-to-summary target is the summary heading, above the counts, and unique.
      const id = await b.evaluate("[...document.querySelectorAll('.pv-pages h1[id]')].find((e) => !e.classList.contains('pv-finding')).id");
      assert.equal(await b.evaluate(`document.querySelectorAll('[id="${id}"]').length`), 1);
      assert.ok(await b.evaluate(`document.getElementById('${id}').compareDocumentPosition(document.querySelector('.pv-counts')) & Node.DOCUMENT_POSITION_FOLLOWING`));
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
