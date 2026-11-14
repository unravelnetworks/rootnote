// The 25 MB file budget is exact and enforced on every change, including multi-byte
// Unicode text: the project can
// always be saved, whatever the mix of images and multi-byte text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEST_BUDGET_DIST, TEST_FILE_BYTES } from './harness/test-budget.mjs';

// Synthetic paste: Firefox drops clipboardData from the ClipboardEvent init, so the same
// DataTransfer is also attached to the event object (identical in Chrome and Edge). Real
// paste from the system clipboard stays a manual check in every browser.
const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
// The test-only budget build (25 MiB project limit): see tests/harness/test-budget.mjs.
const dist = TEST_BUDGET_DIST;
const fixture = here('./fixtures/small.json');
const LIMIT = TEST_FILE_BYTES;

function crc32(buf) {
  let crc = 0xffffffff;
  for (const x of buf) { crc ^= x; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Random-pixel PNG stored uncompressed: about w*h*3 bytes. */
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


const CJK = '漢字試験'; // 3 bytes each in UTF-8

for (const [engine, port] of [['chrome', 9540], ['firefox', 9740]]) test(`25 MB budget in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 300000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  const b = await launch(engine, port);
  const out = here('./out/budget');
  const snap = 'window.__fieldnote.snapshot()';
  const paste = (b64, name) => b.evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'image/png' }));
    document.dispatchEvent(Object.defineProperty(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }), 'clipboardData', { value: dt }));
  })()`);
  const status = () => b.evaluate("document.querySelector('.status').textContent");
  const pasteAndWait = async (b64, name) => {
    await b.evaluate("document.querySelector('.status').textContent = ''");
    await paste(b64, name);
    assert.ok(await b.waitFor("/^(Added|.*not added|.*limit)/.test(document.querySelector('.status').textContent)", 30000), await status());
    return status();
  };
  const save = async (dir) => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await b.allowDownloads(dir);
    await b.evaluate("document.querySelector('[data-testid=save]').click()");
    return waitForFile(dir, /\.rootnote\.json$/);
  };
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', fixture);
    assert.ok(await b.waitFor(`${snap}.findings.length === 3`));
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('F-1')).click()");

    await t.test('accounting is exact with multi-byte names and text', async () => {
      await pasteAndWait(noisyPng(8, 8).toString('base64'), CJK.repeat(50) + '.png');
      await b.evaluate(`(() => { const el = document.querySelector('[data-testid=description]'); el.value = ${JSON.stringify(CJK.repeat(500))}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const predicted = await b.evaluate('window.__fieldnote.savedBytes()');
      const file = await save(join(out, 'exact'));
      // savedAt differs from the placeholder but has the same length.
      assert.equal(statSync(file).size, predicted);
    });

    await t.test('filling to the limit never makes the project unsaveable', async () => {
      // Greedy fill: large images until refused, then smaller ones, with long CJK names.
      for (const side of [780, 560, 400, 280, 200, 140, 100, 70, 50, 35, 24]) {
        const b64 = noisyPng(side, side).toString('base64');
        for (let i = 0; i < 30; i++) {
          if ((await b.evaluate(`${snap}.findings.reduce((n, f) => n + f.evidence.length, 0)`)) >= 30) break;
          const msg = await pasteAndWait(b64, CJK.repeat(60) + side + '.png');
          if (!msg.startsWith('Added')) break;
        }
      }
      const before = await b.evaluate('window.__fieldnote.savedBytes()');
      assert.ok(before <= LIMIT, `over the limit after images: ${before}`);
      assert.ok(before > LIMIT - 120000, `fill stopped too far from the limit: ${before}`);
      // Multi-byte text on top is refused once it would not fit: up to five text fields of
      // 19,800 three-byte characters (about 290 KB, more than the 120 KB left at most).
      for (const key of ['description', 'details', 'impact', 'threat', 'recommendation']) {
        await b.evaluate(`(() => { const el = document.querySelector('[data-testid=${key}]'); el.value = ${JSON.stringify(CJK.repeat(4950))}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        if (/not made/.test(await status())) break;
      }
      const after = await b.evaluate('window.__fieldnote.savedBytes()');
      assert.ok(after <= LIMIT, `over the limit after text: ${after}`);
      assert.match(await status(), /not made/, 'text that does not fit should be refused');
      const file = await save(join(out, 'full'));
      assert.ok(statSync(file).size <= LIMIT);
      assert.ok((await status()).startsWith('Project file'), await status());
    });
  } finally {
    await b.close();
  }
});
