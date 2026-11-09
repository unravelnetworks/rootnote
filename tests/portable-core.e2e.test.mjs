// Portable core: the same workflow in every installed engine (Chrome,
// Edge, Firefox), opened both from file: and from a local static server that sends the
// hosted-version response headers. Create a finding, add
// screenshots by file chooser and paste, save, export DOCX, refuse a hostile project and
// reopen the saved project in a fresh page. Asserts no requests beyond the page itself and
// no page errors. Run `npm run build` first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

// Synthetic paste: Firefox drops clipboardData from the ClipboardEvent init, so the same
// DataTransfer is also attached to the event object (identical in Chrome and Edge). Real
// paste from the system clipboard stays a manual check in every browser.
const require = createRequire(import.meta.url);
const { launch, installed, waitForFile, ENGINES } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const small = JSON.parse(readFileSync(here('./fixtures/small.json'), 'utf8'));
let port = 9620;

// Hosted stand-in: the response CSP repeats the release policy from the file's meta tag
// and adds frame-ancestors, as the hosted decision requires.
const html = existsSync(dist) ? readFileSync(dist) : Buffer.alloc(0);
const metaCsp = (html.toString('utf8').match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
const server = createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/rootnote.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': metaCsp + "; frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store'
  });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const MODES = {
  file: { url: pathToFileURL(dist).href, pageUrl: pathToFileURL(dist).href },
  hosted: { url: origin + '/rootnote.html', pageUrl: origin + '/rootnote.html' }
};
const strip = (d) => ({ ...d, savedAt: null, appVersion: null });

for (const name of Object.keys(ENGINES)) {
  for (const [mode, { url, pageUrl }] of Object.entries(MODES)) {
    test(`portable core in ${name} (${mode})`, { skip: !installed(name) && 'browser not installed', timeout: 150000 }, async () => {
      assert.ok(existsSync(dist), 'run npm run build first');
      assert.ok(metaCsp, 'CSP meta not found in dist');
      const out = here(`./out/portable-${name}-${mode}`);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      const shots = small.images.slice(0, 2).map((im, i) => {
        const file = join(out, `shot${i + 1}.${im.mime === 'image/png' ? 'png' : 'jpg'}`);
        writeFileSync(file, Buffer.from(im.dataUrl.split(',')[1], 'base64'));
        return { file, im };
      });
      const pasted = small.images[2];

      const b = await launch(name, port++, { downloadDir: out, pageUrl, savePicker: true });
      try {
        await b.navigate(url);
        assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"), 'app did not boot');
        await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen

        const type = (sel, value) => b.evaluate(`(() => { const el = document.querySelector('${sel}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        const click = (sel) => b.evaluate(`document.querySelector('${sel}').click()`);
        const snap = () => b.evaluate('window.__fieldnote.snapshot()');

        await type('[data-testid=title]', 'Portable synthetic report ü \u{1D518}');
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
        assert.equal(before.findings[0].description, 'Line one\n\n- bullet\n\tcontrol removed');
        assert.deepEqual(before.findings[0].details.filter((x) => x.type === 'image').map((x) => x.imageId), ['IMG-0001', 'IMG-0002', 'IMG-0003']);
        assert.deepEqual(before.images.map((im) => im.sha256), [shots[0].im.sha256, shots[1].im.sha256, pasted.sha256], 'imported bytes changed');

        // With a native save picker (Chrome, Edge) use the explicit Download button; without
        // one (Firefox, Safari) Save itself downloads.
        const hasPicker = await b.evaluate("typeof window.showSaveFilePicker === 'function'");
        assert.equal(hasPicker, b.engine !== 'firefox');
        await click(hasPicker ? '[data-testid=download-project]' : '[data-testid=save]');
        const saved = await waitForFile(out, /\.rootnote\.json$/);
        assert.ok(await b.waitFor('window.__fieldnote.isDirty() === false'), 'still dirty after save');

        await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Check')).click()");
        await type('[data-testid=export-paper]', 'Letter');
        await click(hasPicker ? '[data-testid=export-download]' : '[data-testid=export]');
        const docx = await waitForFile(out, /\.docx$/);
        const zip = await JSZip.loadAsync(readFileSync(docx));
        const xml = await zip.file('word/document.xml').async('string');
        // Three screenshots export as six picture parts: the tall fixture images split into
        // page-sized pieces.
        assert.equal((xml.match(/<a:blip /g) || []).length, 6, 'unexpected DOCX picture count');
        assert.match(xml, /w:w="12240" w:h="15840"/);
        assert.ok(xml.includes('&lt;id&gt; &amp;'));

        const hostile = JSON.parse(readFileSync(saved, 'utf8'));
        hostile.project.title = 'HOSTILE';
        hostile.images[0].dataUrl = hostile.images[0].dataUrl.slice(0, 200);
        const hostileFile = join(out, 'hostile.json');
        writeFileSync(hostileFile, JSON.stringify(hostile));
        await b.setFile('[data-testid=open-input]', hostileFile);
        assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"), 'hostile file not refused');
        assert.deepEqual(strip(await snap()), strip(before));

        await b.navigate(url);
        assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
        await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
        await b.setFile('[data-testid=open-input]', saved);
        assert.ok(await b.waitFor('window.__fieldnote.snapshot().findings.length === 1'), 'reopen failed');
        assert.deepEqual(strip(await snap()), strip(before));

        assert.deepEqual(b.requests, []);
        assert.deepEqual(b.errors, []);
      } finally {
        await b.close();
      }
    });
  }
}
