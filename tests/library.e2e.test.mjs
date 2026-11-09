// Finding library in the app: save a finding as a text-only entry, add it to
// a report with fresh ids, replace an entry, save and reopen the library file, merge, and
// refuse a hostile library without changing the current one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, sleep, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
const out = here('./out/library');
const snap = 'window.__fieldnote.snapshot()';
const status = "document.querySelector('.status').textContent";
const choose = (value) => `document.querySelector('dialog [data-choice="${value}"]').click()`;
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;

for (const [engine, port] of [['chrome', 9596], ['firefox', 9696]]) test(`finding library in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const b = await launch(engine, port);
  try {
    await b.allowDownloads(out);
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
    await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()");

    await t.test('save a finding: text only, screenshots counted and dropped', async () => {
      await b.evaluate("document.querySelector('[data-testid=save-to-library]').click()");
      assert.match(await b.evaluate(status), /in the finding library\. 2 screenshots were not saved/);
      await b.evaluate(nav('Finding library'));
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
    });

    await t.test('add to report: new finding with a fresh id, no screenshots, same text', async () => {
      const before = await b.evaluate(snap);
      await b.evaluate("document.querySelector('[data-testid=library-insert]').click()");
      const after = await b.evaluate(snap);
      assert.equal(after.findings.length, 4);
      const f = after.findings[3];
      assert.equal(f.id, `F-${String(before.project.nextFindingNumber).padStart(3, '0')}`);
      assert.equal(after.project.nextFindingNumber, before.project.nextFindingNumber + 1);
      assert.deepEqual(f.evidence, []);
      assert.equal(f.title, before.findings[0].title);
      assert.equal(f.description, before.findings[0].description);
      const textOf = (g) => (g.details ?? []).filter((x) => x.type === 'text').map((x) => x.text);
      assert.deepEqual(textOf(f), textOf(before.findings[0]));
      const oldIds = new Set((before.findings[0].details ?? []).map((x) => x.id));
      assert.ok(f.details.every((x) => !oldIds.has(x.id)), 'fresh block ids');
    });

    await t.test('saving again from an added finding offers Replace and keeps one entry', async () => {
      await b.evaluate("(() => { const i = document.querySelector('[data-testid=finding-title]'); i.value = 'Renamed in report'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await b.evaluate("document.querySelector('[data-testid=save-to-library]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=replace]')"));
      await b.evaluate(choose('replace'));
      assert.ok(await b.waitFor(`/Replaced/.test(${status})`));
      await b.evaluate(nav('Finding library'));
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
      assert.match(await b.evaluate("document.querySelector('.library-entry .hint').textContent"), /Renamed in report/);
    });

    let saved;
    await t.test('the library downloads as its own file and reopens', async () => {
      await b.evaluate("document.querySelector('[data-testid=library-save]').click()");
      // Waits until the download is complete: on a slow machine a fixed pause read a half-written file.
      saved = await waitForFile(out, /\.rootnote-library\.json$/);
      assert.ok(saved, 'no library download');
      const data = JSON.parse(readFileSync(saved, 'utf8'));
      assert.equal(data.format, 'fieldnote-library');
      assert.equal(data.entries.length, 1);
      assert.ok(!JSON.stringify(data).includes('data:image'), 'no image data in the library');
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.evaluate(nav('Finding library'));
      await b.setFile('[data-testid=library-input]', saved);
      assert.ok(await b.waitFor(`/Opened the finding library/.test(${status})`));
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
    });

    await t.test('merging the same file again skips existing entries', async () => {
      await b.setFile('[data-testid=library-input]', saved);
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=merge]')"));
      await b.evaluate(choose('merge'));
      assert.ok(await b.waitFor(`/Added 0 entries/.test(${status})`));
      assert.match(await b.evaluate(status), /1 already in the library were skipped/);
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
    });

    await t.test('a hostile library is refused and the current library is unchanged', async () => {
      const data = JSON.parse(readFileSync(saved, 'utf8'));
      data.entries[0].details.push({ type: 'image', imageId: 'IMG-0001' });
      const bad = join(out, 'hostile.rootnote-library.json');
      writeFileSync(bad, JSON.stringify(data));
      await b.setFile('[data-testid=library-input]', bad);
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"));
      assert.match(await b.evaluate(status), /not a usable finding library/);
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 1);
    });

    await t.test('emptied but unsaved library still asks before Open replaces it', async () => {
      await b.evaluate("document.querySelector('.library-entry button.danger').click()");
      await b.evaluate("document.querySelector('dialog [data-confirm]').click()");
      assert.ok(await b.waitFor("document.querySelectorAll('.library-entry').length === 0"));
      await b.setFile('[data-testid=library-input]', saved);
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"), 'unsaved-changes confirmation shown');
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      assert.equal(await b.evaluate("document.querySelectorAll('.library-entry').length"), 0, 'cancel keeps the current library');
    });

    await t.test('a library that opens is one that can be saved and reopened', async () => {
      // 500 entries x 100 empty blocks: valid raw, and the compact saved form stays under 5 MB.
      const data = JSON.parse(readFileSync(saved, 'utf8'));
      const e = data.entries[0];
      data.entries = Array.from({ length: 500 }, (_, i) => ({ ...e, id: `L-${String(i).padStart(32, '0')}`, details: Array.from({ length: 100 }, () => ({ type: 'text', text: '', format: 'plain' })) }));
      const big = join(out, 'big.rootnote-library.json');
      writeFileSync(big, JSON.stringify(data));
      await b.setFile('[data-testid=library-input]', big);
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`/Opened the finding library/.test(${status})`));
      for (const n of readdirSync(out)) if (n.startsWith('findings.')) rmSync(join(out, n));
      await b.evaluate("document.querySelector('[data-testid=library-save]').click()");
      let file;
      for (let i = 0; i < 80 && !file; i++) { file = readdirSync(out).find((n) => n.startsWith('findings.') && n.endsWith('.json')); if (!file) await sleep(100); }
      assert.ok(file, 'saved');
      await sleep(300);
      const bytes = readFileSync(join(out, file));
      assert.ok(bytes.length <= 5242880, `${bytes.length} bytes`);
    });
  } finally {
    await b.close();
  }
});
