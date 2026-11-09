// Drives the built single file in headless Chrome and Edge: create a finding, add
// screenshots by file chooser and by paste, save, export DOCX, refuse a hostile
// project without touching current work, and reopen the saved project in a fresh
// page. Asserts zero network requests throughout. Run `npm run build` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

// Synthetic paste: Firefox drops clipboardData from the ClipboardEvent init, so the same
// DataTransfer is also attached to the event object (identical in Chrome and Edge). Real
// paste from the system clipboard stays a manual check in every browser.
const require = createRequire(import.meta.url);
const { waitForFile } = require('./harness/driver.cjs'); // waits for a complete download
const { launch, BROWSERS } = require('./harness/cdp.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const small = JSON.parse(readFileSync(here('./fixtures/small.json'), 'utf8'));
let port = 9460;


const strip = (d) => ({ ...d, savedAt: null, appVersion: null });

for (const name of Object.keys(BROWSERS)) {
  test(`editor end-to-end offline in ${name}`, { skip: !existsSync(BROWSERS[name]) && 'browser not installed', timeout: 120000 }, async () => {
    assert.ok(existsSync(dist), 'run npm run build first');
    const out = here(`./out/e2e-${name}`);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    // Two real screenshots from the small fixture via the file chooser, a third by paste.
    const shots = small.images.slice(0, 2).map((im, i) => {
      const file = join(out, `shot${i + 1}.${im.mime === 'image/png' ? 'png' : 'jpg'}`);
      writeFileSync(file, Buffer.from(im.dataUrl.split(',')[1], 'base64'));
      return { file, im };
    });
    const pasted = small.images[2];

    const b = await launch(name, port++);
    const requests = [];
    const errors = [];
    b.listeners.push((m) => {
      if (m.method === 'Network.requestWillBeSent' && !/^(file|data|blob):/.test(m.params.request.url)) requests.push(m.params.request.url);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    });
    try {
      await b.send('Network.enable');
      await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen

      const type = (sel, value) => b.evaluate(`(() => { const el = document.querySelector('${sel}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const click = (sel) => b.evaluate(`document.querySelector('${sel}').click()`);
      const snap = () => b.evaluate('window.__fieldnote.snapshot()');

      await type('[data-testid=title]', 'E2E synthetic report ü \u{1D518}');
      await click('[data-testid=add-finding]');
      await type('[data-testid=finding-title]', 'IDOR on /api/orders/<id> & "quotes"');
      await type('[data-testid=rating]', 'High');
      await type('[data-testid=description]', 'Line one\n\n- bullet\n\tcontrol\u0007 removed');

      for (const [i, s] of shots.entries()) {
        await b.setFile('[data-testid=image-input]', s.file);
        assert.ok(await b.waitFor(`window.__fieldnote.snapshot().images.length === ${i + 1}`), 'file chooser import failed');
      }
      await b.evaluate(`(() => {
        const bin = atob(${JSON.stringify(pasted.dataUrl.split(',')[1])}); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], 'clip', { type: ${JSON.stringify(pasted.mime)} }));
        document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
      })()`);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().images.length === 3'), 'paste did not add an image');
      await b.evaluate(`document.querySelectorAll('[data-testid=caption]').forEach((el, i) => { el.value = 'Caption ' + (i + 1); el.dispatchEvent(new Event('input', { bubbles: true })); })`);

      const before = await snap();
      assert.equal(before.findings[0].description, 'Line one\n\n- bullet\n\tcontrol removed', 'control character not sanitized');
      // v3: new screenshots go into Additional details as image blocks, in order.
      assert.deepEqual(before.findings[0].details.filter((x) => x.type === 'image').map((x) => x.imageId), ['IMG-0001', 'IMG-0002', 'IMG-0003']);
      assert.deepEqual(before.findings[0].evidence, []);
      assert.deepEqual(before.images.map((im) => im.sha256), [shots[0].im.sha256, shots[1].im.sha256, pasted.sha256], 'imported bytes changed');
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);

      await click('[data-testid=save]');
      const saved = await waitForFile(out, /\.rootnote\.json$/);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);

      await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check')).click()");
      await type('[data-testid=export-paper]', 'Letter');
      await click('[data-testid=export]');
      const docx = await waitForFile(out, /\.docx$/);
      const zip = await JSZip.loadAsync(readFileSync(docx));
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok((xml.match(/<a:blip /g) || []).length >= 3, 'images missing from DOCX');
      assert.match(xml, /w:w="12240" w:h="15840"/);
      assert.ok(xml.includes('>F-1 ') && xml.includes('&lt;id&gt; &amp;'));

      // A corrupt image inside an otherwise valid file must leave current work unchanged.
      const hostile = JSON.parse(readFileSync(saved, 'utf8'));
      hostile.project.title = 'HOSTILE';
      hostile.images[0].dataUrl = hostile.images[0].dataUrl.slice(0, 200);
      const hostileFile = join(out, 'hostile.json');
      writeFileSync(hostileFile, JSON.stringify(hostile));
      await b.setFile('[data-testid=open-input]', hostileFile);
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"), 'hostile file not refused');
      assert.deepEqual(strip(await snap()), strip(before));

      // Reopen in a fresh page: identical content and image hashes.
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
      await b.setFile('[data-testid=open-input]', saved);
      assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 1'), 'reopen failed');
      assert.deepEqual(strip(await snap()), strip(before));

      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
    } finally {
      await b.close();
    }
  });
}
