// Async race regressions found in an editor review.
// createImageBitmap is paused so imports and opens are still in flight while the user acts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic paste: Firefox drops clipboardData from the ClipboardEvent init, so the same
// DataTransfer is also attached to the event object (identical in Chrome and Edge). Real
// paste from the system clipboard stays a manual check in every browser.
const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const { createEmptyProjectV3, defaultFormats, validateProjectFile } = await import('../src/app/project.js');

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const fixture = here('./fixtures/small.json');
let port = 9500;

const GATE = `(() => {
  window.pendingDecodes = [];
  const original = window.createImageBitmap;
  window.createImageBitmap = async (...args) => {
    const bitmap = await original(...args);
    await new Promise((resolve) => window.pendingDecodes.push(resolve));
    return bitmap;
  };
})()`;
const RELEASE = 'window.pendingDecodes.splice(0).forEach((f) => f())';
const PASTE = (count) => `(() => {
  const im = window.__fieldnote.snapshot().images[0];
  const bytes = Uint8Array.from(atob(im.dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  for (let i = 0; i < ${count}; i++) {
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'added.png', { type: im.mime }));
    document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
  }
})()`;
const snap = 'window.__fieldnote.snapshot()';

function crc32(buf) {
  let crc = 0xffffffff;
  for (const x of buf) { crc ^= x; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** A PNG of random pixels, so it barely compresses: about w*h*3 bytes. */
function noisyPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = randomBytes((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = here('./out/races');
mkdirSync(out, { recursive: true });

async function fresh(b) {
  await b.navigate(pathToFileURL(dist).href);
  assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
  await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
}

async function opened(b, file = fixture) {
  await b.navigate(pathToFileURL(dist).href);
  assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
  await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
  await b.setFile('[data-testid=open-input]', file);
  assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
  await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('F-1')).click()");
}

for (const engine of ['chrome', 'firefox']) test(`editor async races in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, engine === 'chrome' ? port : port + 100);
  try {
    await t.test('concurrent pastes get unique image ids', async () => {
      await opened(b);
      await b.evaluate(GATE);
      await b.evaluate(PASTE(2));
      assert.ok(await b.waitFor('window.pendingDecodes.length === 2'));
      await b.evaluate(RELEASE);
      assert.ok(await b.waitFor(`${snap}.images.length === 8`));
      const s = await b.evaluate(snap);
      assert.equal(new Set(s.images.map((x) => x.id)).size, 8);
      assert.equal(s.project.nextImageNumber, 9);
      assert.equal(new Set(s.findings.flatMap((f) => [...f.evidence, ...f.details.filter((x) => x.type === 'image').map((x) => x.imageId)])).size, 8);
    });

    await t.test('v3: a paste lands right after the focused details text block', async () => {
      await opened(b);
      const first = await b.evaluate(`${snap}.findings[0].details[0].id`);
      await b.evaluate(`document.querySelector('[data-block="${first}"] textarea').focus()`);
      await b.evaluate(PASTE(2));
      assert.ok(await b.waitFor(`${snap}.findings[0].details.length === 3`));
      const d = await b.evaluate(`${snap}.findings[0].details`);
      assert.deepEqual(d.map((x) => x.type), ['text', 'image', 'image'], 'two screenshots after the text, in paste order');
      assert.equal(d[0].id, first);
    });

    await t.test('v3: removing the insertion point while a screenshot decodes cancels it', async () => {
      await opened(b);
      const d0 = await b.evaluate(`${snap}.findings[0].details`);
      const first = d0[0].id;
      const images = await b.evaluate(`${snap}.images.length`);
      await b.evaluate(`document.querySelector('[data-block="${first}"] textarea').focus()`);
      await b.evaluate(GATE);
      await b.evaluate(PASTE(1));
      assert.ok(await b.waitFor('window.pendingDecodes.length === 1'));
      // Empty the block so Remove needs no confirmation, then remove it.
      await b.evaluate(`(() => { const t = document.querySelector('[data-block="${first}"] textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await b.evaluate(`[...document.querySelectorAll('[data-block="${first}"] button')].find((x) => x.textContent === 'Remove').click()`);
      assert.ok(await b.waitFor(`${snap}.findings[0].details.length === ${d0.length - 1}`));
      await b.evaluate(RELEASE);
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"));
      assert.match(await b.evaluate("document.querySelector('.status').textContent"), /place where the screenshots were being added was removed/);
      assert.equal(await b.evaluate(`${snap}.images.length`), images, 'no image committed');
    });

    await t.test('v3: moving a screenshot between Evidence and Additional details keeps the same image', async () => {
      await opened(b);
      const before = await b.evaluate(snap);
      const id = before.findings[0].evidence[0];
      await b.evaluate(`document.querySelector('[data-section=evidence] [data-image="${id}"] [data-testid=move-section]').click()`);
      let s = await b.evaluate(snap);
      assert.equal(s.findings[0].evidence.includes(id), false);
      assert.equal(s.findings[0].details.at(-1).imageId, id);
      assert.deepEqual(s.images, before.images, 'image records unchanged');
      await b.evaluate(`document.querySelector('[data-testid=details-blocks] [data-image="${id}"] [data-testid=move-section]').click()`);
      s = await b.evaluate(snap);
      assert.equal(s.findings[0].evidence.at(-1), id);
      assert.equal(s.findings[0].details.some((x) => x.imageId === id), false);
    });

    // an omitted (optional) details field and the 100-block cap.
    const v3File = (name, mutate) => {
      const p = createEmptyProjectV3(new Date('2026-11-01T00:00:00Z'));
      const im = JSON.parse(readFileSync(fixture, 'utf8')).images[0];
      p.images = [{ ...im, id: 'IMG-0001' }];
      p.findings = [{ id: 'F-001', title: 'v3', rating: null, cvss: null, formats: defaultFormats(), evidence: ['IMG-0001'] }];
      p.project.sections.finding.find((s) => s.key === 'evidence').enabled = true;
      p.project.nextFindingNumber = 2;
      p.project.nextImageNumber = 2;
      mutate(p);
      const file = join(out, name);
      writeFileSync(file, JSON.stringify(p));
      return file;
    };
    const openV3 = async (file) => {
      await fresh(b);
      await b.setFile('[data-testid=open-input]', file);
      assert.ok(await b.waitFor(`${snap}.findings.length === 1`));
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()");
    };

    await t.test('a finding without the optional details field opens and edits', async () => {
      // Page errors recorded by the driver from here on.
      const mark = b.errors.length;
      await openV3(v3File('no-details.json', () => {}));
      assert.equal(await b.evaluate(`'details' in ${snap}.findings[0]`), false);
      assert.ok(await b.waitFor("!!document.querySelector('[data-testid=details-blocks] textarea')"), 'details editor not shown');
      await b.evaluate("(() => { const t = document.querySelector('[data-testid=details-blocks] textarea'); t.value = 'Step 1'; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
      const d = await b.evaluate(`${snap}.findings[0].details`);
      assert.equal(d.length, 1);
      assert.equal(d[0].text, 'Step 1');
      assert.deepEqual(b.errors.slice(mark), []);
    });

    await t.test('at 100 blocks, +Text, a paste and a gallery move are refused and change nothing', async () => {
      await openV3(v3File('full-blocks.json', (p) => {
        p.findings[0].details = Array.from({ length: 100 }, (_, i) => ({ id: `B-${i}`, type: 'text', text: '', format: 'plain' }));
      }));
      const before = await b.evaluate(snap);
      await b.evaluate("document.querySelector('[data-testid=details-blocks] [data-testid=add-text]').click()");
      assert.match(await b.evaluate("document.querySelector('.status').textContent"), /at most 100/);
      await b.evaluate("document.querySelector('[data-section=evidence] [data-testid=move-section]').click()");
      await b.evaluate("document.querySelector('[data-block=\"B-99\"] textarea').focus()");
      await b.evaluate(PASTE(1));
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error' && /at most 100/.test(document.querySelector('.status').textContent)"));
      const after = await b.evaluate(snap);
      assert.equal(after.findings[0].details.length, 100);
      assert.deepEqual(after.findings[0].evidence, before.findings[0].evidence);
      assert.equal(after.images.length, before.images.length);
      assert.equal(after.project.nextImageNumber, before.project.nextImageNumber);
      // What Save would write still opens.
      const raw = JSON.stringify(after);
      assert.equal((await validateProjectFile(raw, Buffer.byteLength(raw))).ok, true);
    });

    await t.test('New during a pending import leaves the new project empty', async () => {
      await opened(b);
      await b.evaluate(GATE);
      await b.evaluate(PASTE(1));
      assert.ok(await b.waitFor('window.pendingDecodes.length === 1'));
      await b.evaluate("document.querySelector('[data-testid=new-project]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=blank]')"));
      await b.evaluate("document.querySelector('dialog [data-choice=blank]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 0`));
      await b.evaluate(RELEASE);
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"));
      const s = await b.evaluate(snap);
      assert.equal(s.images.length, 0);
      assert.equal(s.project.nextImageNumber, 1);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    });

    await t.test('an edit made while a file is being opened is not silently lost', async () => {
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.evaluate("document.querySelector('[data-testid=start-new]')?.click()"); // past the start screen
      await b.evaluate(GATE);
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor('window.pendingDecodes.length === 1'));
      await b.evaluate(`(() => { const el = document.querySelector('[data-testid=title]'); el.value = 'EDIT DURING OPEN'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await b.evaluate(`window.releaseTimer = setInterval(() => ${RELEASE}, 10)`);
      assert.ok(await b.waitFor('!!document.querySelector("dialog.confirm")'), 'no reconfirmation dialog');
      // Cancel: the edit stays and the file is not opened.
      await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('was not opened')"));
      const s = await b.evaluate(snap);
      assert.equal(s.project.title, 'EDIT DURING OPEN');
      assert.equal(s.findings.length, 0);
      assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), true);
      await b.evaluate('clearInterval(window.releaseTimer)');
    });

    await t.test('New during a pending open wins even when the project is clean', async () => {
      await fresh(b);
      await b.evaluate(GATE);
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor('window.pendingDecodes.length === 1'));
      await b.evaluate("document.querySelector('[data-testid=new-project]').click()");
      assert.ok(await b.waitFor("!!document.querySelector('dialog [data-choice=blank]')"));
      await b.evaluate("document.querySelector('dialog [data-choice=blank]').click()");
      await b.evaluate(`window.releaseTimer = setInterval(() => ${RELEASE}, 10)`);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('was not opened')"));
      assert.equal((await b.evaluate(snap)).findings.length, 0);
      await b.evaluate('clearInterval(window.releaseTimer)');
    });

    await t.test('counters stop at the last id the schema can save', async () => {
      const p = JSON.parse(readFileSync(fixture, 'utf8'));
      p.project.nextFindingNumber = 998;
      p.project.nextImageNumber = 9998;
      const file = join(out, 'near-limit.json');
      writeFileSync(file, JSON.stringify(p));
      await fresh(b);
      await opened(b, file);
      await b.evaluate("document.querySelector('[data-testid=add-finding]').click()");
      assert.ok(await b.waitFor(`${snap}.findings.length === 4`));
      assert.equal(await b.evaluate("document.querySelector('[data-testid=add-finding]').disabled"), true);
      await b.evaluate(PASTE(2));
      assert.ok(await b.waitFor("document.querySelector('.status').dataset.kind === 'error'"));
      const s = await b.evaluate(snap);
      assert.deepEqual([s.project.nextFindingNumber, s.project.nextImageNumber], [999, 9999]);
      assert.equal(s.images.length, 7, 'exactly one image (IMG-9998) fits');
      // The project at the boundary saves and reopens in a fresh page.
      const dl = join(out, 'boundary');
      rmSync(dl, { recursive: true, force: true });
      mkdirSync(dl, { recursive: true });
      await b.allowDownloads(dl);
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      const saved = await waitForFile(dl, /\.rootnote\.json$/);
      await fresh(b);
      await b.setFile('[data-testid=open-input]', saved);
      assert.ok(await b.waitFor(`${snap}.findings.length === 4`), 'boundary project did not reopen');
      assert.deepEqual((await b.evaluate(snap)).findings.map((f) => f.id), ['F-001', 'F-002', 'F-003', 'F-998']);
    });

    await t.test('a file read failure on open is reported and changes nothing', async () => {
      await fresh(b);
      await b.evaluate("Blob.prototype.arrayBuffer = () => Promise.reject(new Error('read failed'))");
      const mark = b.errors.length;
      await b.setFile('[data-testid=open-input]', fixture);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('could not be read')"));
      assert.deepEqual(b.errors.slice(mark), []);
      assert.equal((await b.evaluate(snap)).findings.length, 0);
    });

    await t.test('an oversized pasted file is refused before it is read', async () => {
      await opened(b);
      await b.evaluate(`(() => {
        window.reads = 0;
        const original = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () { window.reads++; return original.call(this); };
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(2097153)], 'big.png', { type: 'image/png' }));
        document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
      })()`);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('over the 2 MB limit')"));
      assert.equal(await b.evaluate('window.reads'), 0);
    });

    await t.test('screenshots that would push the project past 25 MB are refused, so it stays saveable', async () => {
      await opened(b);
      const png = noisyPng(780, 780).toString('base64'); // ~1.8 MB, ~2.4 MB as base64
      await b.evaluate(`(() => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        for (let i = 0; i < 12; i++) dt.items.add(new File([bytes], 'noise' + i + '.png', { type: 'image/png' }));
        document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
      })()`);
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.includes('exceed the 25 MB limit')", 60000));
      const s = await b.evaluate(snap);
      assert.ok(s.images.length > 6 && s.images.length < 18, `unexpected image count ${s.images.length}`);
      assert.ok(Buffer.byteLength(JSON.stringify(s, null, 1)) <= 26214400 - 1024);
      await b.allowDownloads(out);
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      assert.ok(await b.waitFor("document.querySelector('.status').textContent.startsWith('Project file')"));
    });
  } finally {
    await b.close();
  }
});
