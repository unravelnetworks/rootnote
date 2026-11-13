// The released build at its real 256 MiB limit (the budget rules in detail run on the test-only
// 25 MiB build, tests/harness/test-budget.mjs). A v8 project 16 KiB under the limit opens;
// a screenshot that does not fit is refused, and so is a text edit that does not fit, with
// nothing changed; a small edit still works; the project saves and reopens with the same content.
// Chrome only: one large project is enough to show the real limit; other engines run the same code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyProject, defaultFormats, findingId, imageId, savedSize, LIMITS } from '../src/app/project.js';
import { APP_VERSION } from '../src/app/version.js';

const require = createRequire(import.meta.url);
const { launch, installed, waitForFile } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const out = here('./out/real-cap');
const snap = 'window.__fieldnote.snapshot()';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** A valid PNG with its pixel data stored uncompressed; `shade` makes each one different. */
function png(width, height, shade) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, shade);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0; // filter byte
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const image = (n, bytes, w, h) => ({
  id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: w, height: h,
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), caption: `Screenshot ${n}`, tallMode: 'auto',
});

/** A v8 project whose saved form is `headroom` bytes under the limit. */
function nearCap(headroom) {
  const d = createEmptyProject(new Date('2026-11-14T00:00:00Z'));
  d.appVersion = APP_VERSION;
  d.findings = Array.from({ length: 150 }, (_, i) => ({ id: findingId(i + 1), title: `Finding ${i + 1}`, rating: 'High', cvss: null,
    affectedAssets: [], description: '', impact: '', threat: '', recommendation: '', formats: defaultFormats(), details: [], evidence: [],
    references: [], status: 'open', cwe: '', vulnerabilityType: '' }));
  const per = Math.ceil(png(980, 700, 1).length / 3) * 4 + 300;
  const n = Math.floor((LIMITS.fileBytes - headroom - 3e6) / per);
  d.images = Array.from({ length: n }, (_, i) => image(i + 1, png(980, 700, (i * 37) % 251 + 1), 980, 700));
  d.images.forEach((im, i) => d.findings[i % 150].evidence.push(im.id));
  d.project.nextFindingNumber = 151;
  d.project.nextImageNumber = n + 1;
  let need = LIMITS.fileBytes - headroom - savedSize(d);
  for (const f of d.findings) for (const k of ['description', 'impact', 'threat', 'recommendation']) {
    const add = Math.min(need, LIMITS.text - f[k].length);
    if (add > 0) { f[k] += 'a'.repeat(add); need -= add; }
  }
  assert.equal(need, 0, 'padding capacity');
  return d;
}

test('the released build at its 256 MiB limit in chrome', { skip: !installed('chrome') && 'chrome not installed', timeout: 900000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const headroom = 16 * 1024; // less than one long text edit adds
  const d = nearCap(headroom);
  const file = join(out, 'near-cap.rootnote.json');
  writeFileSync(file, JSON.stringify(d));
  const b = await launch('chrome', 9597);
  try {
    await b.setViewport({ width: 1500, height: 1000 });
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`window.__fieldnote.snapshot().findings.length === 150 && /^Opened /.test(document.querySelector('.status').textContent)`, 300000), 'near-cap project did not open');
    const before = await b.evaluate('window.__fieldnote.savedBytes()');
    assert.ok(before <= LIMITS.fileBytes - headroom && before > LIMITS.fileBytes - headroom - 4096, `saved size ${before}`);
    await b.evaluate("[...document.querySelectorAll('.nav li.sortable .navitem')][0].click()");

    await t.test('a screenshot that does not fit is refused and nothing changes', async () => {
      const big = join(out, 'big.png');
      writeFileSync(big, png(980, 700, 250));
      const images = await b.evaluate(`${snap}.images.length`);
      await b.setFile('[data-testid=image-input]', big);
      assert.ok(await b.waitFor("/would take the project over 256 MB/.test(document.querySelector('.status').textContent)", 60000), await b.evaluate("document.querySelector('.status').textContent"));
      assert.equal(await b.evaluate(`${snap}.images.length`), images);
      assert.equal(await b.evaluate('window.__fieldnote.savedBytes()'), before);
    });

    await t.test('a text edit that does not fit is refused, the field shows the stored text; a small one works', async () => {
      const area = "document.querySelector('[data-testid=description]')";
      const stored = await b.evaluate(`${snap}.findings[0].description`);
      await b.evaluate(`(() => { const a = ${area}; a.value = a.value.slice(0, 10) + 'é'.repeat(19990); a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      assert.ok(await b.waitFor("/would take the project over 256 MB/.test(document.querySelector('.status').textContent)", 30000), await b.evaluate("document.querySelector('.status').textContent"));
      assert.equal(await b.evaluate(`${snap}.findings[0].description`), stored, 'model unchanged');
      assert.equal(await b.evaluate(`${area}.value`), stored, 'the field shows what Save writes');
      assert.equal(await b.evaluate('window.__fieldnote.savedBytes()'), before);
      await b.evaluate("(() => { const t = document.querySelector('[data-testid=finding-title]'); t.value = 'Finding 1 at the limit'; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()");
      assert.ok(await b.waitFor(`${snap}.findings[0].title === 'Finding 1 at the limit'`, 10000));
    });

    await t.test('it saves within the limit and reopens with the same content in a fresh page', async () => {
      const dl = join(out, 'saved');
      mkdirSync(dl, { recursive: true });
      await b.allowDownloads(dl);
      const expected = await b.evaluate(`(() => { const s = ${snap}; return JSON.stringify({ ...s, savedAt: '' }).length; })()`);
      await b.evaluate("document.querySelector('[data-testid=save]').click()");
      const saved = await waitForFile(dl, /\.rootnote\.json$/, 300000);
      assert.ok(statSync(saved).size <= LIMITS.fileBytes, `saved file ${statSync(saved).size} bytes`);
      await b.navigate('about:blank');
      await b.navigate(pathToFileURL(dist).href);
      assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
      await b.setFile('[data-testid=open-input]', saved);
      assert.ok(await b.waitFor(`window.__fieldnote.snapshot().findings.length === 150 && /^Opened /.test(document.querySelector('.status').textContent)`, 300000), 'saved project did not reopen');
      const again = await b.evaluate(`(() => { const s = ${snap}; return { title: s.findings[0].title, images: s.images.length, len: JSON.stringify({ ...s, savedAt: '' }).length }; })()`);
      assert.deepEqual(again, { title: 'Finding 1 at the limit', images: d.images.length, len: expected });
    });
    assert.deepEqual(b.errors, [], 'page errors');
  } finally {
    await b.close();
  }
});
