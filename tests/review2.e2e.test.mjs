// Regressions from an independent review: engagement writes that fail or overlap,
// an unknown status in a folder, the screenshot editor's discard and size limit, focus after
// a view change, the ⋯ menu and phone width. The folder is the in-memory kind the engagements
// test uses, with removeEntry and switchable failures.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_FS = `(() => {
  const file = (name, data) => ({ kind: 'file', name, data,
    async getFile() { return new File([this.data], this.name, { lastModified: 1761000000000 }); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async createWritable() {
      const self = this, parts = [];
      return { async write(b) { if (window.__fail) throw new DOMException('full', window.__fail); if (window.__slow) await new Promise((r) => setTimeout(r, window.__slow)); parts.push(b); },
        async close() { self.data = new Blob(parts); }, async abort() {} };
    } });
  const dir = (name) => ({ kind: 'directory', name, children: new Map(),
    async *values() { if (this.delay) await new Promise((r) => setTimeout(r, this.delay)); yield* this.children.values(); },
    async getDirectoryHandle(n, o = {}) { if (!this.children.has(n)) { if (!o.create) throw new DOMException('missing', 'NotFoundError'); this.children.set(n, dir(n)); } return this.children.get(n); },
    async getFileHandle(n, o = {}) { if (!this.children.has(n)) { if (!o.create) throw new DOMException('missing', 'NotFoundError'); this.children.set(n, file(n, '')); } return this.children.get(n); },
    async removeEntry(n) { if (!this.children.delete(n)) throw new DOMException('missing', 'NotFoundError'); } });
  const make = (rootName, entries) => {
    const root = dir(rootName);
    for (const [path, data] of entries) {
      let d = root; const parts = path.split('/');
      for (const p of parts.slice(0, -1)) { if (!d.children.has(p)) d.children.set(p, dir(p)); d = d.children.get(p); }
      d.children.set(parts.at(-1), file(parts.at(-1), data));
    }
    return root;
  };
  const odd = JSON.parse(window.__sample); odd.project.engagementStatus = 'on_hold';
  window.__A = make('A', [['Brightwater/2026-10 Portal/portal.rootnote.json', window.__sample], ['Acme/2026-11 API/odd.rootnote.json', JSON.stringify(odd)]]);
  window.__B = make('B', [['Zeta/2026-12 Web/web.rootnote.json', window.__sample]]);
  window.__list = (root, path) => { let d = root; for (const p of path.split('/')) d = d.children.get(p); return [...d.children.entries()].map(([n, f]) => n + ':' + (f.kind === 'file' ? f.data.size ?? f.data.length : 'dir')); };
})()`;

for (const [engine, port] of [['chrome', 9573]]) test(`folder, export and focus regressions in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 300000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  const status = () => b.evaluate("document.querySelector('.status').textContent");
  // Tab and Enter with the key codes Chrome needs to move focus and activate.
  const key = async (k, { shift = false } = {}) => {
    const [code, vk] = { Tab: ['Tab', 9], Enter: ['Enter', 13], ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40] }[k];
    const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
    await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...(k === 'Enter' ? { text: '\r' } : {}) });
    if (k === 'Enter') await b.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(100);
  };
  const openEngagements = () => b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent === 'Engagements').click()");
  const row = (customer, name) => `document.querySelector('[data-testid=engagement][data-customer="${customer}"][data-engagement="${name}"]')`;
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.evaluate(`window.__sample = ${JSON.stringify(sampleText)}; 0`);
    await b.evaluate(FAKE_FS);
    await b.evaluate("document.querySelector('[data-testid=start-engagements]').click()");
    await b.evaluate('window.__fieldnote.useEngagementsFolder(window.__A)');
    assert.ok(await b.waitFor("document.querySelectorAll('[data-testid=engagement]').length === 2"));

    await t.test('a project file with an unknown status is listed and does not break the screen', async () => {
      assert.match(await b.evaluate(`${row('Acme', '2026-11 API')}.textContent`), /8 findings/);
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Details')).click()");
      await openEngagements();
      assert.equal(await b.evaluate("document.querySelectorAll('[data-testid=engagement]').length"), 2);
    });

    await t.test('the open project opened from a folder', async () => {
      await b.evaluate(`${row('Brightwater', '2026-10 Portal')}.querySelector('[data-testid=eng-open]').click()`);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 8', 60000));
      await openEngagements();
      assert.ok(await b.waitFor(`!!${row('Brightwater', '2026-10 Portal')}.querySelector('.chip')`));
    });

    await t.test('a failed CSV export leaves no empty file and says why', async () => {
      await b.evaluate("window.__fail = 'QuotaExceededError'");
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check & export')).click()");
      await b.evaluate("document.querySelector('[data-testid=export-csv]').click()");
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('not enough space')"), await status());
      await b.evaluate("document.querySelector('[data-testid=export]').click()");
      assert.ok(await b.waitFor("/Export failed: there is not enough space\\./.test(document.querySelector('.status').textContent)"), await status());
      assert.deepEqual(await b.evaluate("window.__list(window.__A, 'Brightwater/2026-10 Portal')").then((l) => l.map((x) => x.split(':')[0])), ['portal.rootnote.json']);
    });

    await t.test('a failed "Save open project here" leaves no file and keeps the project where it was', async () => {
      await openEngagements();
      await b.evaluate(`${row('Acme', '2026-11 API')}.querySelector('[data-testid=eng-save-here]').click()`);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('not saved')"), await status());
      assert.deepEqual(await b.evaluate("window.__list(window.__A, 'Acme/2026-11 API')").then((l) => l.map((x) => x.split(':')[0])), ['odd.rootnote.json']);
      assert.ok(await b.evaluate(`!!${row('Brightwater', '2026-10 Portal')}.querySelector('.chip') && !${row('Acme', '2026-11 API')}.querySelector('.chip')`));
      await b.evaluate('window.__fail = null');
    });

    await t.test('"Save open project here" during a save is refused and changes nothing', async () => {
      await b.evaluate('window.__slow = 1500');
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      await sleep(200);
      await b.evaluate(`${row('Acme', '2026-11 API')}.querySelector('[data-testid=eng-save-here]').click()`);
      assert.match(await status(), /still being saved/);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.startsWith('Saved \"portal.rootnote.json\"')", 10000), await status());
      await b.evaluate('window.__slow = 0');
      assert.deepEqual(await b.evaluate("window.__list(window.__A, 'Acme/2026-11 API')").then((l) => l.map((x) => x.split(':')[0])), ['odd.rootnote.json']);
      await openEngagements();
      assert.ok(await b.evaluate(`!!${row('Brightwater', '2026-10 Portal')}.querySelector('.chip')`));
    });

    await t.test('"Save open project here" that succeeds moves the project and keeps focus on the button', async () => {
      await b.evaluate(`${row('Acme', '2026-11 API')}.querySelector('[data-testid=eng-save-here]').click()`);
      assert.ok(await b.waitFor(`!!${row('Acme', '2026-11 API')}?.querySelector('.chip')`, 10000), await status());
      assert.equal(await b.evaluate('document.activeElement.dataset.testid'), 'eng-save-here');
      assert.equal((await b.evaluate("window.__list(window.__A, 'Acme/2026-11 API')")).length, 2);
    });

    await t.test('the newest folder choice wins over a slower earlier scan', async () => {
      await b.evaluate("window.__A.delay = 1500; window.__fieldnote.useEngagementsFolder(window.__A); window.__fieldnote.useEngagementsFolder(window.__B); 0");
      await sleep(2500);
      assert.deepEqual(await b.evaluate("[...document.querySelectorAll('[data-testid=engagement]')].map((e) => e.dataset.customer)"), ['Zeta']);
      assert.equal(await b.evaluate("document.querySelectorAll('[data-testid=engagement] .chip:not(.neutral)').length"), 0, '"Open now" belongs to folder A only');
    });

    await t.test('a view change from the nav or the top bar keeps keyboard focus', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Sections')).click()");
      assert.match(await b.evaluate('document.activeElement.textContent'), /Sections & scoring/);
      await b.evaluate("document.querySelector('[data-testid=top-export]').click()");
      assert.equal(await b.evaluate('document.activeElement.tagName'), 'H1');
    });

    await t.test('tabbing out of the ⋯ menu closes it', async () => {
      await b.evaluate("document.querySelector('[data-testid=more-menu] summary').focus()");
      await key('Enter');
      assert.ok(await b.waitFor("document.querySelector('[data-testid=more-menu]').open"));
      const items = await b.evaluate("document.querySelectorAll('[data-testid=more-menu] .menu-item').length");
      for (let k = 0; k <= items; k++) await key('Tab');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=more-menu]').open"), false);
    });

    await t.test('the screenshot editor asks once before discarding edits, and Undo ends when the project is saved', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()");
      await b.evaluate("document.querySelector('[data-testid=edit-screenshot]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.redact canvas')"));
      const drag = `(() => { const c = document.querySelector('dialog.redact canvas'); const r = c.getBoundingClientRect();
        const at = (type, fx, fy) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, button: 0, buttons: 1 }));
        at('pointerdown', 0.1, 0.1); at('pointermove', 0.4, 0.4); at('pointerup', 0.4, 0.4); })()`;
      await b.evaluate(drag);
      await b.press('Escape');
      await sleep(300);
      assert.ok(await b.evaluate("!!document.querySelector('dialog.redact')"), 'one Escape keeps the edits');
      assert.match(await b.evaluate("document.querySelector('dialog.redact .redact-note').textContent"), /Discard 1 edit\?/);
      await b.evaluate("document.querySelector('[data-testid=redact-save]').click()");
      assert.ok(await b.waitFor("!document.querySelector('[data-testid=undo-bar]').hidden"));
      assert.equal(await b.evaluate('document.activeElement.dataset.testid'), 'edit-screenshot', 'focus returns to the screenshot');
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      assert.ok(await b.waitFor("document.querySelector('[data-testid=undo-bar]').hidden"), 'saving ends the Undo offer');
    });

    await t.test('"Discard changes" answered after the project changed again does not open the file', async () => {
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Details')).click()");
      const type = (v) => `(() => { const i = document.querySelector('[data-testid=title]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
      await b.evaluate(type('Edited before opening'));
      assert.ok(await b.evaluate('window.__fieldnote.isDirty()'));
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=open-input]'); const dt = new DataTransfer();
        dt.items.add(new File([window.__sample], 'other.rootnote.json', { type: 'application/json' })); i.files = dt.files; i.dispatchEvent(new Event('change')); })()`);
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-confirm]')"));
      await b.evaluate(type('Edited while the question was open'));
      await b.evaluate("document.querySelector('dialog [data-confirm]').click()");
      assert.ok(await b.waitFor("/was not opened: the project changed/.test(document.querySelector('.status').textContent)"), await status());
      assert.equal(await b.evaluate('window.__fieldnote.snapshot().project.title'), 'Edited while the question was open');
    });

    await t.test('the screenshot editor works from the keyboard, and finding sections are headings', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()");
      assert.ok(await b.evaluate("[...document.querySelectorAll('.main [role=heading][aria-level=\"2\"]')].some((x) => x.textContent.includes('Description'))"));
      const image = "window.__fieldnote.snapshot().images.find((x) => x.id === document.querySelector('.main [data-image]').dataset.image)";
      const before = await b.evaluate(`${image}.sha256`);
      await b.evaluate("document.querySelector('.main [data-testid=edit-screenshot]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog.redact canvas')"));
      await b.evaluate("document.querySelector('[data-testid=redact-blackout]').focus()");
      await key('ArrowRight');
      assert.equal(await b.evaluate('document.activeElement.dataset.testid'), 'redact-pixelate', 'arrows move along the toolbar');
      await key('ArrowLeft');
      await b.evaluate("document.querySelector('[data-testid=redact-canvas]').focus()");
      await key('ArrowDown');
      await key('ArrowRight', { shift: true });
      assert.match(await b.evaluate("document.querySelector('dialog.redact .redact-note').textContent"), /Selection 2\d% from the left, 2\d% from the top, 2\d% wide, 25% high\. Enter applies Black out\./);
      await key('Enter');
      assert.equal(await b.evaluate("document.querySelector('[data-testid=redact-save]').disabled"), false, 'one edit made');
      // The middle of the selection is now black in the editor's canvas.
      const px = await b.evaluate("(() => { const c = document.querySelector('[data-testid=redact-canvas]'); return [...c.getContext('2d').getImageData(Math.round(c.width * 0.37), Math.round(c.height * 0.4), 1, 1).data]; })()");
      assert.deepEqual(px.slice(0, 3), [0, 0, 0]);
      await b.evaluate("document.querySelector('[data-testid=redact-save]').click()");
      assert.ok(await b.waitFor(`${image}.sha256 !== ${JSON.stringify(before)}`, 10000));
    });

    await t.test('at 320 px the page does not scroll sideways and Check & export is on screen', async () => {
      await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      for (const view of ['Details', 'Check & export', 'Preview']) {
        await b.evaluate(`[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes(${JSON.stringify(view)})).click()`);
        await sleep(view === 'Preview' ? 2000 : 300);
        assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), view);
      }
      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Details')).click()");
      const r = await b.evaluate("(() => { const x = document.querySelector('[data-testid=top-export]').getBoundingClientRect(); return [x.left, x.right, document.documentElement.clientWidth]; })()");
      assert.ok(r[0] >= 0 && r[1] <= r[2], JSON.stringify(r));
      const top = await b.evaluate("[document.querySelector('header.top').getBoundingClientRect().bottom, document.querySelector('.status').getBoundingClientRect().top]");
      assert.ok(top[1] >= top[0] - 1, `status below the wrapped header ${top}`);
    });
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});
