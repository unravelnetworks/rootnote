// Engagements screen (folders Engagements\Customer\Engagement\).
// A folder dialog cannot be driven by a test, so the page gets an in-memory folder with the
// same interface the dialog hands over (values, getFile, getDirectoryHandle, getFileHandle,
// createWritable). Everything the app writes is read back from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const sampleText = readFileSync(here('../release-template/sample-project.rootnote.json'), 'utf8');
const snap = 'window.__fieldnote.snapshot()';

const FAKE_FS = `(() => {
  const file = (name, data) => ({ kind: 'file', name, data,
    async getFile() { return new File([this.data], this.name, { lastModified: 1761000000000 }); },
    async queryPermission() { return window.__ask ? 'prompt' : 'granted'; },
    requestPermission() { return new Promise((r) => { window.__answer = r; }); },
    async createWritable() { const self = this, parts = []; return { async write(b) { parts.push(b); }, async close() { self.data = new Blob(parts); window.__writes = (window.__writes || 0) + 1; }, async abort() {} }; } });
  const dir = (name) => ({ kind: 'directory', name, children: new Map(),
    async *values() { yield* this.children.values(); },
    async getDirectoryHandle(n, o = {}) { if (!this.children.has(n)) { if (!o.create) throw new DOMException('missing', 'NotFoundError'); this.children.set(n, dir(n)); } return this.children.get(n); },
    async getFileHandle(n, o = {}) { if (!this.children.has(n)) { if (!o.create) throw new DOMException('missing', 'NotFoundError'); this.children.set(n, file(n, '')); } return this.children.get(n); } });
  const root = dir('Engagements');
  const put = (path, data) => { let d = root; const parts = path.split('/'); for (const p of parts.slice(0, -1)) { if (!d.children.has(p)) d.children.set(p, dir(p)); d = d.children.get(p); } d.children.set(parts.at(-1), file(parts.at(-1), data)); };
  put('Brightwater Logistics/2026-10 Customer portal/customer-portal.rootnote.json', window.__sample);
  put('Brightwater Logistics/2026-10 Customer portal/customer-portal-report.docx', 'PK');
  put('Acme Bank/2026-11 Mobile API/broken.rootnote.json', 'not json');
  put('Acme Bank/2026-11 Mobile API/notes.txt', 'ignored');
  put('loose.rootnote.json', '{}');
  window.__root = root;
  window.__read = async (path) => { let d = root; for (const p of path.split('/')) { d = d.children.get(p); if (!d) return null; } return d.kind === 'file' ? await new Blob([d.data]).text() : [...d.children.keys()]; };
})()`;

for (const [engine, port] of [['chrome', 9587], ['firefox', 9687]]) test(`engagements in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate(`window.__sample = ${JSON.stringify(sampleText)}; 0`);
    await b.evaluate(FAKE_FS);
    const canWrite = await b.evaluate("typeof window.showDirectoryPicker === 'function'");

    await t.test('the start screen leads to Engagements, which says how this browser can use the folders', async () => {
      await b.evaluate("document.querySelector('[data-testid=start-engagements]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=engagements]')"));
      if (canWrite) assert.ok(await b.evaluate("!!document.querySelector('[data-testid=engagements-pick]')"));
      else {
        assert.ok(await b.evaluate("document.querySelector('[data-testid=engagements-input]').hasAttribute('webkitdirectory')"), 'folder input');
        assert.match(await b.evaluate("document.querySelector('[data-testid=engagements]').textContent"), /cannot save into them/);
      }
    });

    await t.test('customers and engagements are listed from the folders, with what each project holds', async () => {
      await b.evaluate('window.__fieldnote.useEngagementsFolder(window.__root)');
      assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=customer]').length === 2", 10000));
      assert.deepEqual(await b.evaluate("[...document.querySelectorAll('[data-testid=customer] h2')].map((x) => x.firstChild.textContent)"), ['Acme Bank', 'Brightwater Logistics']);
      const bw = "document.querySelector('[data-engagement=\"2026-10 Customer portal\"]')";
      assert.ok(await b.waitFor(`/Customer Portal Security Assessment/.test(${bw}.textContent)`, 10000));
      assert.match(await b.evaluate(`${bw}.textContent`), /8 findings: 1 critical, 2 high/);
      assert.match(await b.evaluate(`${bw}.textContent`), /Word · customer-portal-report\.docx/);
      assert.match(await b.evaluate("document.querySelector('[data-engagement=\"2026-11 Mobile API\"]').textContent"), /Not a readable project file/);
      assert.doesNotMatch(await b.evaluate("document.querySelector('[data-testid=engagements]').textContent"), /loose|notes\.txt/);
    });

    await t.test('Open runs the full open and remembers the engagement', async () => {
      await b.evaluate("document.querySelector('[data-engagement=\"2026-10 Customer portal\"] [data-testid=eng-open]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 30000));
      assert.match(await b.evaluate("document.querySelector('.status').textContent"), /from Brightwater Logistics › 2026-10 Customer portal/);
    });

    if (!canWrite) return; // writing into folders needs Chrome or Edge

    await t.test('Save writes the project back into its engagement folder', async () => {
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=title]'); i.value = 'Portal assessment v2'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      const saved = await b.waitFor("window.__read('Brightwater Logistics/2026-10 Customer portal/customer-portal.rootnote.json').then((t) => t.includes('Portal assessment v2'))", 15000);
      assert.ok(saved, await b.evaluate("document.querySelector('.status').textContent"));
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    });

    await t.test('CSV and Word go into the same folder; replacing a file asks first', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check')).click()");
      assert.match(await b.evaluate("document.querySelector('[data-testid=export-target]').textContent"), /Brightwater Logistics › 2026-10 Customer portal/);
      const passed = await b.evaluate("document.querySelector('[data-testid=checks-passed]').textContent");
      assert.match(passed, /^Passed: every fill-in field is filled · no example text left · every screenshot has a caption · table of contents included$/);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=export]').textContent"), 'Save Word report', 'no "…": no dialog opens');
      // Scrolled to the bottom, a new message still shows, pinned under the header, with the nav below it.
      // A desktop width: below 760 px the nav is part of the page by design (Edge opens at 754 px).
      if (engine !== 'firefox') await b.setViewport({ width: 1280, height: 800 });
      await b.evaluate('window.scrollTo(0, document.documentElement.scrollHeight); 0');
      await b.evaluate("document.querySelector('[data-testid=export-csv]').click()");
      const csvName = "window.__read('Brightwater Logistics/2026-10 Customer portal').then((n) => n.find((x) => x.endsWith('-findings.csv')))";
      assert.ok(await b.waitFor(`${csvName}.then(Boolean)`, 10000));
      assert.ok(await b.evaluate('window.scrollY > 0'), 'the page is scrolled');
      const pinned = await b.evaluate("(() => { const s = document.querySelector('.status').getBoundingClientRect(); const n = document.querySelector('.nav').getBoundingClientRect(); return [Math.round(s.top), Math.round(n.top - s.bottom)]; })()");
      assert.deepEqual(pinned, [52, 0], 'status under the header, nav right below it');
      const csv = await b.evaluate(`${csvName}.then((n) => window.__read('Brightwater Logistics/2026-10 Customer portal/' + n))`);
      assert.ok(csv.startsWith('"ID","Title","Severity"'), csv.slice(0, 40)); // text() drops the byte-order mark (unit-tested)
      await b.evaluate("document.querySelector('[data-testid=export-csv]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      assert.match(await b.evaluate("document.querySelector('dialog.confirm').textContent"), /Replace ".*-findings\.csv" in Brightwater Logistics › 2026-10 Customer portal\?/);
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      assert.ok(await b.waitFor("/CSV export cancelled/.test(document.querySelector('.status').textContent)"));
      await b.evaluate("document.querySelector('[data-testid=export]').click()");
      assert.ok(await b.waitFor("window.__read('Brightwater Logistics/2026-10 Customer portal').then((n) => n.some((x) => x.endsWith('.docx') && x !== 'customer-portal-report.docx'))", 30000));
    });

    await t.test('a write waiting on the browser permission prompt says so instead of looking stuck', async () => {
      await b.evaluate('window.__ask = true; 0');
      await b.waitFor("!/Creating the Word/.test(document.querySelector('.status').textContent)", 30000);
      await b.evaluate("document.querySelector('[data-testid=export-csv]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor("/asking whether this page may edit files in Brightwater Logistics › 2026-10 Customer portal/.test(document.querySelector('.status').textContent)"));
      await b.evaluate("window.__ask = false; window.__answer('granted'); 0");
      assert.ok(await b.waitFor("/^Saved \".*-findings\\.csv\" in Brightwater/.test(document.querySelector('.status').textContent)"));
    });

    await t.test('New engagement checks folder names, creates the folders and saves there', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Engagements')).click()");
      await b.evaluate("document.querySelector('[data-testid=eng-new]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=eng-name]')"));
      const set = (id, v) => b.evaluate(`(() => { const i = document.querySelector('[data-testid=${id}]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await set('eng-name', 'bad/name');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=eng-create]').disabled"), true);
      await set('eng-customer', 'Acme Bank');
      await set('eng-name', '2026-12 Retest');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=eng-create]').disabled"), false);
      await b.evaluate("document.querySelector('[data-testid=eng-create]').click()");
      assert.ok(await b.waitFor("window.__read('Acme Bank/2026-12 Retest').then((n) => Array.isArray(n) && n.some((x) => x.endsWith('.rootnote.json')))", 15000));
      assert.ok(await b.waitFor("!!document.querySelector('[data-engagement=\"2026-12 Retest\"]')", 10000), 'the list shows it');
      assert.ok(await b.evaluate("document.querySelector('[data-engagement=\"2026-12 Retest\"]').classList.contains('current')"));
    });

    await t.test('New engagement asks each time and can start an empty report for the customer', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Engagements')).click()");
      await b.evaluate("document.querySelector('[data-testid=eng-new]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=eng-create-empty]')"));
      assert.match(await b.evaluate("document.querySelector('[data-testid=eng-which]').textContent"), /an empty one, or the open report "Portal assessment v2"/);
      assert.match(await b.evaluate("document.querySelector('dialog.confirm').textContent"), /Creates Engagements\\Customer\\Engagement\\/);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=eng-customer]').value"), 'Acme Bank', 'the open report\'s customer folder, not its client field');
      const set = (id, v) => b.evaluate(`(() => { const i = document.querySelector('[data-testid=${id}]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await set('eng-customer', 'Northwind Clinic');
      await set('eng-name', '2027-01 API test');
      await b.evaluate("document.querySelector('[data-testid=eng-create-empty]').click()");
      const file = "window.__read('Northwind Clinic/2027-01 API test').then((n) => Array.isArray(n) && n.find((x) => x.endsWith('.rootnote.json')))";
      assert.ok(await b.waitFor(`${file}.then(Boolean)`, 15000));
      assert.ok(await b.waitFor("/^Saved \"API-test\\.rootnote\\.json\" in Northwind Clinic › 2027-01 API test\\./.test(document.querySelector('.status').textContent)", 10000),
        await b.evaluate("document.querySelector('.status').textContent"));
      const saved = JSON.parse(await b.evaluate(`${file}.then((n) => window.__read('Northwind Clinic/2027-01 API test/' + n))`));
      assert.deepEqual([saved.project.client, saved.project.title, saved.findings.length], ['Northwind Clinic', 'API test', 0]);
      assert.equal(await b.evaluate(`${snap}.findings.length`), 0);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
      assert.ok(await b.waitFor("window.__read('Acme Bank/2026-12 Retest').then((n) => n.length === 1)"), 'the earlier engagement is untouched');
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
