// Save dialog path (File System Access API), with a scripted fake picker because headless
// browsers cannot answer the real dialog:
// dialog opened before any await, cancel, denial, write failure, stale save, Save reusing
// the chosen file, Save as asking again, handles dropped on New, DOCX through the dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { waitForFile } = require('./harness/driver.cjs'); // waits for a complete download
const { launch, BROWSERS, sleep } = require('./harness/cdp.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');


// Installed after load; the app checks for the picker when it saves, and the header's
// "Save as…" button was rendered while the native picker was present (savePicker: true).
const FAKE = `(() => {
  const w = window;
  w.__picker = { mode: 'ok', writeMode: 'ok', calls: [], saves: [], aborts: 0, gate: null };
  const handle = (name) => ({
    name, kind: 'file',
    queryPermission: async () => (w.__picker.writeMode === 'deny' ? 'denied' : 'granted'),
    requestPermission: async () => 'denied',
    createWritable: async () => {
      const parts = [];
      return {
        write: async (data) => {
          if (w.__picker.gate) await w.__picker.gate;
          if (w.__picker.writeMode === 'fail') throw new DOMException('disk full', 'QuotaExceededError');
          // Like the real writable: bytes or a Blob.
          parts.push(data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data));
        },
        close: async () => {
          const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
          w.__picker.saves.push({ name, size: bytes.length, text: name.endsWith('.json') ? new TextDecoder().decode(bytes) : null,
            zip: bytes[0] === 0x50 && bytes[1] === 0x4b });
        },
        abort: async () => { w.__picker.aborts++; },
      };
    },
  });
  w.showSaveFilePicker = async (opts) => {
    w.__picker.calls.push({ suggestedName: opts.suggestedName, id: opts.id, startIn: opts.startIn ? opts.startIn.name : null,
      accept: Object.keys(opts.types[0].accept)[0] });
    if (w.__picker.mode === 'cancel') throw new DOMException('cancelled', 'AbortError');
    if (w.__picker.mode === 'deny') throw new DOMException('blocked', 'NotAllowedError');
    return handle('chosen-' + w.__picker.calls.length + (opts.suggestedName.endsWith('.docx') ? '.docx' : '.rootnote.json'));
  };
})()`;

for (const browser of ['chrome', 'edge']) {
  test(`save dialog path (${browser})`, { skip: !existsSync(BROWSERS[browser]) && `${browser} not installed`, timeout: 120000 }, async (t) => {
    assert.ok(existsSync(dist), 'run npm run build first');
    const b = await launch(browser, browser === 'chrome' ? 9571 : 9572, { savePicker: true });
    const status = () => b.evaluate("document.querySelector('.status').textContent");
    const dirty = () => b.evaluate('window.__fieldnote.isDirty()');
    const picker = () => b.evaluate('window.__picker');
    const typeTitle = (text) => b.evaluate(`(() => { const i = document.querySelector('[data-testid=title]'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    // Clicks and reports how many dialogs were opened before the handler's first await.
    const clickCounting = (testid) => b.evaluate(`(() => { const n = window.__picker.calls.length; document.querySelector('[data-testid=${testid}]').click(); return window.__picker.calls.length - n; })()`);
    const settled = (pattern) => b.waitFor(`${pattern}.test(document.querySelector('.status').textContent)`, 20000);
    try {
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.evaluate(FAKE);
      assert.equal(await b.evaluate("!!document.querySelector('[data-testid=save-as]')"), true, 'Save as… shown when the picker exists');
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 3'));
      await typeTitle('Edited title');
      assert.equal(await dirty(), true);

      await t.test('cancel writes nothing and keeps unsaved changes', async () => {
        await b.evaluate("window.__picker.mode = 'cancel'");
        assert.equal(await clickCounting('save'), 1, 'dialog opened synchronously from the click');
        assert.ok(await settled(/Save cancelled/), await status());
        assert.equal((await picker()).saves.length, 0);
        assert.equal(await dirty(), true);
      });

      await t.test('denied dialog is an error and keeps unsaved changes', async () => {
        await b.evaluate("window.__picker.mode = 'deny'");
        await clickCounting('save');
        assert.ok(await settled(/not saved: the browser did not allow/), await status());
        assert.equal(await b.evaluate("document.querySelector('.status').dataset.kind"), 'error');
        assert.equal(await dirty(), true);
      });

      await t.test('write failure aborts the file and keeps unsaved changes', async () => {
        await b.evaluate("window.__picker.mode = 'ok'; window.__picker.writeMode = 'fail'");
        await clickCounting('save');
        assert.ok(await settled(/not saved: there is not enough space/), await status());
        assert.equal((await picker()).aborts, 1);
        assert.equal((await picker()).saves.length, 0);
        assert.equal(await dirty(), true);
      });

      await t.test('write permission refused on a chosen file', async () => {
        await b.evaluate("window.__picker.writeMode = 'deny'");
        await clickCounting('save');
        assert.ok(await settled(/not saved: the browser did not allow saving there/), await status());
        assert.equal(await dirty(), true);
      });

      await t.test('successful save, then Save reuses the file without a dialog', async () => {
        await b.evaluate("window.__picker.writeMode = 'ok'");
        const before = (await picker()).calls.length;
        await clickCounting('save');
        assert.ok(await settled(/^Saved "chosen-/), await status());
        let p = await picker();
        assert.equal(p.calls.length, before + 1);
        assert.equal(p.calls.at(-1).id, 'fieldnote-project');
        assert.equal(p.calls.at(-1).accept, 'application/json');
        assert.match(p.calls.at(-1).suggestedName, /^Edited-title\.rootnote\.json$/);
        assert.equal(JSON.parse(p.saves.at(-1).text).project.title, 'Edited title');
        assert.equal(await dirty(), false);
        await typeTitle('Second edit');
        // Ctrl+S goes through the same path.
        assert.equal(await b.evaluate(`(() => { const n = window.__picker.calls.length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); return window.__picker.calls.length - n; })()`), 0);
        assert.ok(await b.waitFor('window.__picker.saves.length === 2'));
        p = await picker();
        assert.equal(p.saves[1].name, p.saves[0].name, 'same file written again');
        assert.equal(JSON.parse(p.saves[1].text).project.title, 'Second edit');
        assert.equal(await dirty(), false);
      });

      await t.test('Save as asks again and starts in the last folder', async () => {
        await typeTitle('Third edit');
        assert.equal(await clickCounting('save-as'), 1);
        assert.ok(await b.waitFor('window.__picker.saves.length === 3'));
        const p = await picker();
        assert.equal(p.calls.at(-1).startIn, p.saves[1].name);
        assert.notEqual(p.saves[2].name, p.saves[1].name);
        assert.equal(await dirty(), false);
      });

      await t.test('an edit made while the file is written keeps the project dirty', async () => {
        await typeTitle('Before slow save');
        await b.evaluate('window.__picker.gate = new Promise((r) => { window.__releaseWrite = r; }); 0');
        await clickCounting('save');
        await typeTitle('Edited during save');
        await b.evaluate('window.__releaseWrite(); window.__picker.gate = null');
        assert.ok(await settled(/changed the project while it was being saved/), await status());
        const p = await picker();
        assert.equal(JSON.parse(p.saves.at(-1).text).project.title, 'Before slow save', 'file holds the clicked state');
        assert.equal(await dirty(), true);
      });

      await t.test('Word export opens the dialog first, cancel writes nothing', async () => {
        await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check & export')).click()");
        await b.evaluate("window.__picker.mode = 'cancel'");
        const saves = (await picker()).saves.length;
        assert.equal(await clickCounting('export'), 1, 'dialog opened before the export started');
        assert.ok(await settled(/Export cancelled/), await status());
        assert.equal((await picker()).saves.length, saves);
      });

      await t.test('Word export writes a DOCX through the dialog', async () => {
        await b.evaluate("window.__picker.mode = 'ok'");
        await clickCounting('export');
        assert.ok(await settled(/^Saved Word file "chosen-/), await status());
        const p = await picker();
        assert.equal(p.calls.at(-1).id, 'fieldnote-docx');
        assert.equal(p.saves.at(-1).zip, true);
        assert.ok(p.saves.at(-1).size > 10000);
      });

      await t.test('dialog present but blocked: no automatic download, explicit Download works', async () => {
        const dir = here(`./out/picker-download-${browser}`);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
        await b.evaluate("window.__picker.mode = 'deny'");
        try {
          // Word: blocked dialog, then Download Word.
          await clickCounting('export');
          assert.ok(await settled(/Word file was not saved: the browser did not allow.*Download Word/), await status());
          // Save as always opens the dialog (Save would reuse the file chosen earlier).
          await clickCounting('save-as');
          assert.ok(await settled(/project was not saved: the browser did not allow.*use Download/), await status());
          await sleep(1500);
          assert.deepEqual(readdirSync(dir), [], 'nothing downloaded automatically');
          assert.equal(await dirty(), true);
          await b.evaluate("document.querySelector('[data-testid=export-download]').click()");
          const docx = readFileSync(await waitForFile(dir, /.docx$/));
          assert.equal(docx.subarray(0, 2).toString(), 'PK');
          // Project: Download writes the current state and clears unsaved changes.
          await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Details & cover')).click()");
          await typeTitle('Downloaded title');
          const calls = (await picker()).calls.length;
          await b.evaluate("document.querySelector('[data-testid=download-project]').click()");
          const saved = JSON.parse(readFileSync(await waitForFile(dir, /.rootnote.json$/), 'utf8'));
          assert.equal(saved.project.title, 'Downloaded title');
          assert.equal((await picker()).calls.length, calls, 'Download does not open the dialog');
          assert.equal(await dirty(), false);
        } finally {
          await b.evaluate("window.__picker.mode = 'ok'");
        }
      });

      await t.test('New forgets the chosen project file', async () => {
        await b.evaluate("document.querySelector('[data-testid=save]').click()"); // clean first
        assert.ok(await settled(/^Saved "chosen-/), await status());
        await b.evaluate("document.querySelector('[data-testid=new-project]').click()");
        assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=blank]')"));
        await b.evaluate("document.querySelector('dialog [data-choice=blank]').click()");
        // Wait for the blank project itself: on a slow machine Save could otherwise still see the old one.
        assert.ok(await b.waitFor("!document.querySelector('dialog') && window.__fieldnote.snapshot().project.title === ''"));
        await typeTitle('New project');
        assert.equal(await clickCounting('save'), 1, 'a new project asks where to save');
        assert.ok(await settled(/^Saved "chosen-/), await status());
      });
    } finally {
      await b.close();
    }
  });
}
