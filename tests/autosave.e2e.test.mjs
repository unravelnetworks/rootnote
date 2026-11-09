// Opt-in recovery draft: off writes nothing; on keeps a
// validated draft after changes; a found draft is offered, never loaded silently, and is
// not overwritten until restored or discarded; Off deletes it and a write already on its
// way (another tab) cannot recreate it; an edit made while a restore is checked wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { launch, installed, sleep } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
const snap = 'window.__fieldnote.snapshot()';
const IDB = (op) => `new Promise((resolve, reject) => {
  const r = indexedDB.open('fieldnote-recovery', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const s = tx.objectStore('kv'); let out;
    (${op})(s, (v) => { out = v; }); tx.oncomplete = () => { db.close(); resolve(out); }; tx.onabort = () => reject(tx.error); };
  r.onerror = () => reject(r.error);
})`;
const readStore = IDB(`(s, done) => { const m = s.get('meta'); const d = s.get('draft'); d.onsuccess = () => done({ meta: m.result ?? null, draft: d.result ? JSON.parse(d.result.json).project.title : null }); }`);
const GATE = `(() => { window.pendingDecodes = []; const o = window.createImageBitmap; window.createImageBitmap = async (...a) => { const b = await o(...a); if (!window.releaseAll) await new Promise((r) => window.pendingDecodes.push(r)); return b; }; })()`;
const type = (sel, v) => `(() => { const i = document.querySelector('${sel}'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const nav = (label) => `[...document.querySelectorAll('.navitem')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(label)})).click()`;

for (const [engine, port] of [['chrome', 9597], ['firefox', 9697]]) test(`opt-in recovery draft in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  const fresh = async () => {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
    await sleep(300); // startup reads the preference
  };
  const waitDraft = (title) => b.waitFor(`${readStore}.then((s) => s.draft === ${JSON.stringify(title)})`, 15000);
  try {
    await fresh();
    if (!await b.evaluate("typeof indexedDB !== 'undefined'")) { t.skip('no IndexedDB on file:// here'); return; }

    await t.test('off by default: changes write nothing', async () => {
      await b.evaluate(type('[data-testid=title]', 'Off by default'));
      await sleep(5500);
      const s = await b.evaluate(readStore);
      assert.equal(s.draft, null);
      assert.notEqual(s.meta?.enabled, true);
    });

    await t.test('on: a validated draft follows the changes', async () => {
      await b.evaluate(nav('Check'));
      assert.match(await b.evaluate("document.querySelector('[data-testid=draft-toggle]').closest('.toggle').textContent"), /unencrypted recovery draft in this browser profile/);
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.meta?.enabled === true)`));
      await b.evaluate(nav('Details & cover'));
      await b.evaluate(type('[data-testid=title]', 'Kept draft'));
      assert.ok(await waitDraft('Kept draft'), 'draft not written');
      assert.ok(await b.waitFor("/Draft kept/.test(document.querySelector('[data-testid=draft-note]').textContent)"));
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true, 'a draft is not a saved file');
    });

    await t.test('a found draft is offered, not loaded, and is not overwritten while waiting', async () => {
      await fresh();
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=draft-banner]').hidden"));
      assert.equal(await b.evaluate(`${snap}.project.title`), '', 'not loaded silently');
      await b.evaluate(type('[data-testid=title]', 'Typed before choosing'));
      await sleep(5500);
      assert.equal((await b.evaluate(readStore)).draft, 'Kept draft', 'pending draft kept');
    });

    await t.test('restore brings the draft back as unsaved work; an edit during the check wins', async () => {
      await fresh();
      // Clear the draft still waiting from the previous step, then make one with images.
      if (!await b.evaluate("document.querySelector('[data-testid=draft-banner]').hidden")) {
        await b.evaluate("document.querySelector('[data-testid=draft-discard]').click()");
        assert.ok(await b.waitFor("document.querySelector('[data-testid=draft-banner]').hidden"));
      }
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
      await b.evaluate(type('[data-testid=title]', 'Draft with images'));
      assert.ok(await waitDraft('Draft with images'));
      await fresh();
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=draft-banner]').hidden"));
      await b.evaluate(GATE);
      await b.evaluate("document.querySelector('[data-testid=draft-restore]').click()");
      assert.ok(await b.waitFor('window.pendingDecodes.length > 0'));
      await b.evaluate(type('[data-testid=title]', 'Edited during restore'));
      await b.evaluate('window.releaseAll = true; window.pendingDecodes.splice(0).forEach((f) => f())');
      assert.ok(await b.waitFor("/not restored because the project changed/.test(document.querySelector('.status').textContent)"));
      assert.equal(await b.evaluate(`${snap}.project.title`), 'Edited during restore');
      // Still offered; restore now (no gate) succeeds.
      await fresh();
      await b.evaluate("document.querySelector('[data-testid=draft-restore]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
      assert.equal(await b.evaluate(`${snap}.project.title`), 'Draft with images');
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);
    });

    await t.test('discard removes the draft', async () => {
      await fresh();
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=draft-banner]').hidden"));
      await b.evaluate("document.querySelector('[data-testid=draft-discard]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.draft === null)`));
      await fresh();
      assert.equal(await b.evaluate("document.querySelector('[data-testid=draft-banner]').hidden"), true);
    });

    await t.test('turned off in another tab: a write on its way cannot recreate the draft', async () => {
      await b.evaluate(type('[data-testid=title]', 'Before the other tab'));
      assert.ok(await waitDraft('Before the other tab'));
      // Another tab turns drafts off: preference off, epoch moved on, draft deleted.
      await b.evaluate(IDB(`(s, done) => { const m = s.get('meta'); m.onsuccess = () => { s.put({ enabled: false, epoch: m.result.epoch + 1 }, 'meta'); s.delete('draft'); done(); }; }`));
      await b.evaluate(type('[data-testid=title]', 'After the other tab'));
      assert.ok(await b.waitFor("/turned off in another tab/.test(document.querySelector('.status').textContent)", 15000));
      assert.equal((await b.evaluate(readStore)).draft, null);
    });

    await t.test('Off deletes the draft', async () => {
      await b.evaluate(nav('Check'));
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').checked || document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.meta?.enabled === true)`));
      await b.evaluate(nav('Details & cover'));
      await b.evaluate(type('[data-testid=title]', 'To be deleted'));
      assert.ok(await waitDraft('To be deleted'));
      await b.evaluate(nav('Check'));
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor("/drafts are off and the draft was deleted/.test(document.querySelector('.status').textContent)"));
      const s = await b.evaluate(readStore);
      assert.equal(s.draft, null);
      assert.equal(s.meta.enabled, false);
    });

    const enableAndKeep = async (title) => {
      await b.evaluate(nav('Check'));
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').checked || document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.meta?.enabled === true)`));
      await b.evaluate(nav('Details & cover'));
      await b.evaluate(type('[data-testid=title]', title));
      assert.ok(await waitDraft(title));
    };

    await t.test('Restore asks before replacing work typed after the offer', async () => {
      await enableAndKeep('Offered draft');
      await fresh();
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=draft-banner]').hidden"));
      await b.evaluate(type('[data-testid=title]', 'New unsaved work'));
      await b.evaluate("document.querySelector('[data-testid=draft-restore]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"), 'confirmation shown');
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      await sleep(300);
      assert.equal(await b.evaluate(`${snap}.project.title`), 'New unsaved work', 'cancel keeps the new work');
      await b.evaluate("document.querySelector('[data-testid=draft-restore]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
      await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.project.title === 'Offered draft'`));
    });

    await t.test('turning drafts off while the startup check runs means no offer appears', async () => {
      await enableAndKeep('Startup race');
      await b.addInitScript((`window.pendingDecodes = []; window.addEventListener('DOMContentLoaded', () => {}); (() => { const o = window.createImageBitmap; window.createImageBitmap = async (...a) => { const b = await o(...a); if (!window.releaseAll) await new Promise((r) => window.pendingDecodes.push(r)); return b; }; })();`));
      // The draft must hold an image so the startup check has something to decode.
      await b.setFile('[data-testid=open-input]', fixture);
      if (await b.waitFor("!!document.querySelector('dialog.confirm')", 3000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
      await b.evaluate(type('[data-testid=title]', 'Startup race with images'));
      await b.evaluate('window.releaseAll = true; (window.pendingDecodes || []).splice(0).forEach((f) => f())');
      assert.ok(await waitDraft('Startup race with images'));
      await fresh();
      assert.ok(await b.waitFor('window.pendingDecodes.length > 0'), 'startup check paused');
      await b.evaluate(nav('Check'));
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.meta?.enabled === false && s.draft === null)`));
      await b.evaluate('window.releaseAll = true; window.pendingDecodes.splice(0).forEach((f) => f())');
      await sleep(800);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=draft-banner]').hidden"), true, 'deleted draft not offered');
    });

    await t.test('drafts turned off in another tab during the startup check are not offered', async () => {
      await enableAndKeep('Cross-tab startup');
      await b.setFile('[data-testid=open-input]', fixture);
      if (await b.waitFor("!!document.querySelector('dialog.confirm')", 2000)) await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
      await b.evaluate(type('[data-testid=title]', 'Cross-tab with images'));
      await b.evaluate('window.releaseAll = true; (window.pendingDecodes || []).splice(0).forEach((f) => f())');
      assert.ok(await waitDraft('Cross-tab with images'));
      await fresh();
      assert.ok(await b.waitFor('window.pendingDecodes.length > 0'), 'startup check paused');
      // "Tab B": turns drafts off directly in the shared store.
      await b.evaluate(IDB(`(s, done) => { const m = s.get('meta'); m.onsuccess = () => { s.put({ enabled: false, epoch: m.result.epoch + 1 }, 'meta'); s.delete('draft'); done(); }; }`));
      await b.evaluate('window.releaseAll = true; window.pendingDecodes.splice(0).forEach((f) => f())');
      await sleep(800);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=draft-banner]').hidden"), true, 'no stale offer');
    });

    await t.test('if deleting the draft fails, messages never claim the browser holds nothing', async () => {
      await fresh();
      await b.evaluate("IDBObjectStore.prototype.delete = function () { throw new DOMException('injected', 'UnknownError'); }; 0");
      await b.evaluate(nav('Check'));
      if (!await b.evaluate("document.querySelector('[data-testid=draft-toggle]').checked")) await b.evaluate("document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor(`${readStore}.then((s) => s.meta?.enabled === true)`));
      await b.evaluate("document.querySelector('[data-testid=draft-toggle]').click()");
      assert.ok(await b.waitFor("/could not be confirmed deleted/.test(document.querySelector('.status').textContent)"));
      await b.evaluate("document.querySelector('[data-testid=download-project], [data-testid=save]').click()");
      assert.ok(await b.waitFor("/sent to your browser's downloads/.test(document.querySelector('.status').textContent)"));
      const msg = await b.evaluate("document.querySelector('.status').textContent");
      assert.doesNotMatch(msg, /nothing is stored/);
      assert.match(msg, /may still be stored/);
    });
  } finally {
    await b.close();
  }
});
