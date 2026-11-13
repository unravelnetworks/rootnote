// A reference edit refused by the 25 MB budget leaves the stored value on screen as well as in
// the model: the field shows what Save writes, and a refused Add keeps its draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyProject, createEmptyProjectV4, defaultFormats, validateProjectFile, LIMITS } from '../src/app/project.js';
import { APP_VERSION } from '../src/app/version.js';
import { TEST_BUDGET_DIST, TEST_FILE_BYTES } from './harness/test-budget.mjs';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
// The test-only budget build (25 MiB project limit): see tests/harness/test-budget.mjs.
const dist = TEST_BUDGET_DIST;
const out = here('./out/references-budget');
const snap = 'window.__fieldnote.snapshot()';

function crc32(buf) {
  let crc = 0xffffffff;
  for (const x of buf) { crc ^= x; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Random-pixel PNG stored uncompressed, so its size is about w*h*3 bytes. */
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

/** A valid current-schema project 16 bytes under the limit whose first finding has one reference, "Old". */
function nearLimitProject(make = createEmptyProject) {
  const p = make(new Date('2026-11-02T00:00:00.000Z')); // current schema: an older one would grow when converted
  p.appVersion = APP_VERSION;
  p.project.title = 'Near budget references';
  const png = noisyPng(800, 870);
  assert.ok(png.length <= LIMITS.imageBytes);
  p.images = Array.from({ length: 9 }, (_, i) => ({ id: `IMG-000${i + 1}`, mime: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: 800, height: 870, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), caption: 'Synthetic', tallMode: 'fit' }));
  p.findings = Array.from({ length: 20 }, (_, i) => ({ id: `F-${String(i + 1).padStart(3, '0')}`, title: `Budget finding ${i + 1}`, rating: null, cvss: null,
    affectedAssets: [], description: '', impact: '', threat: '', recommendation: '', formats: defaultFormats(), details: [], status: 'open',
    evidence: i ? [] : p.images.map((im) => im.id), ...(i ? {} : { references: [{ title: 'Old', url: '' }] }),
    ...(p.schemaVersion >= 6 ? { cwe: '', vulnerabilityType: '' } : {}) }));
  p.project.nextFindingNumber = 21;
  p.project.nextImageNumber = 10;
  let need = TEST_FILE_BYTES - 16 - Buffer.byteLength(JSON.stringify(p));
  for (const f of p.findings) for (const k of ['description', 'impact', 'threat', 'recommendation']) {
    const n = Math.min(need, LIMITS.text);
    f[k] = 'x'.repeat(n);
    need -= n;
  }
  assert.equal(need, 0, 'padding capacity');
  return JSON.stringify(p);
}

for (const [engine, port] of [['chrome', 9599], ['firefox', 9699]]) test(`reference edits refused by the budget in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const raw = nearLimitProject();
  assert.equal(Buffer.byteLength(raw), TEST_FILE_BYTES - 16);
  assert.ok((await validateProjectFile(raw, Buffer.byteLength(raw))).ok);
  const file = join(out, 'near-limit.rootnote.json');
  writeFileSync(file, raw);
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 20`, 90000));
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Budget finding 1')).click()");
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=reference-title]')"));

    for (const [sel, value, key, stored] of [['[data-testid=reference-title]', 'N'.repeat(300), 'title', 'Old'], ['[data-testid=reference-url]', `https://example.org/${'a'.repeat(280)}`, 'url', '']]) {
      await t.test(`a refused ${key} edit shows the stored value again`, async () => {
        await b.evaluate(`(() => { const e = document.querySelector('${sel}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        assert.equal(await b.evaluate(`${snap}.findings[0].references[0].${key}`), stored);
        assert.match(await b.evaluate("document.querySelector('.status').textContent"), /would take the project over 25 MB/);
        assert.equal(await b.evaluate(`document.querySelector('${sel}').value`), stored, 'the field matches what Save writes');
      });
    }

    await t.test('a refused Add keeps the draft for the user to shorten', async () => {
      const title = 'T'.repeat(300);
      await b.evaluate(`(() => { const i = document.querySelector('[data-testid=new-reference-title]'); i.value = ${JSON.stringify(title)}; })()`);
      await b.evaluate("document.querySelector('[data-testid=add-reference]').click()");
      assert.equal(await b.evaluate(`${snap}.findings[0].references.length`), 1);
      assert.match(await b.evaluate("document.querySelector('.status').textContent"), /would take the project over 25 MB/);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=new-reference-title]').value"), title);
      const saved = JSON.stringify(await b.evaluate(snap));
      assert.ok((await validateProjectFile(saved, Buffer.byteLength(saved))).ok);
    });

    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

// a valid v4 file near the limit grows past it when converted (recovery state). Copy
// as text then explains instead of failing, as Export does.
for (const [engine, port] of [['chrome', 9598], ['firefox', 9698]]) test(`copy as text in the over-budget recovery state in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async () => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'near-limit-v4.rootnote.json');
  writeFileSync(file, nearLimitProject(createEmptyProjectV4));
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 20`, 90000));
    assert.equal(await b.evaluate(`${snap}.schemaVersion`), 8);
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Budget finding 1')).click()");
    await b.evaluate("document.querySelector('[data-testid=copy-finding]').click()");
    assert.ok(await b.waitFor("!!document.querySelector('[data-testid=copy-dialog][open]')"));
    assert.equal(await b.evaluate("document.querySelector('[data-testid=copy-text]').value"), '');
    assert.match(await b.evaluate("document.querySelector('[data-testid=copy-note]').textContent"), /over the 25 MB limit/);
    // in this state Undo could not restore, so removal asks first.
    await b.evaluate("document.querySelector('[data-testid=copy-dialog] button.secondary').click()");
    assert.ok(await b.waitFor("!document.querySelector('[data-testid=copy-dialog]')"));
    await b.evaluate("document.querySelector('[data-testid=references] button[aria-label=\"Remove reference 1\"]').click()");
    assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
    assert.match(await b.evaluate("document.querySelector('dialog.confirm').textContent"), /Remove the reference "Old"\?/);
    await b.evaluate("document.querySelector('dialog.confirm button.secondary').click()");
    assert.ok(await b.waitFor("!document.querySelector('dialog.confirm')"));
    assert.equal(await b.evaluate(`${snap}.findings[0].references[0].title`), 'Old');
    assert.equal(await b.evaluate("document.querySelector('[data-testid=undo-bar]').hidden"), true);
    // a question left open while another project opens removes nothing from it.
    await b.evaluate("document.querySelector('[data-testid=references] button[aria-label=\"Remove reference 1\"]').click()");
    assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
    await b.setFile('[data-testid=open-input]', here('../release-template/sample-project.rootnote.json'));
    assert.ok(await b.waitFor(`${snap}.findings.length === 8`, 90000));
    const opened = await b.evaluate(snap);
    await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
    assert.ok(await b.waitFor("!document.querySelector('dialog.confirm')"));
    assert.deepEqual(await b.evaluate(snap), opened, 'the new project is untouched');
    assert.equal(await b.evaluate('window.__fieldnote.isDirty()'), false);
    assert.equal(await b.evaluate("document.querySelector('[data-testid=undo-bar]').hidden"), true);
    // The same for Delete finding: its image ids must never remove another project's images.
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Password reset token')).click()");
    await b.evaluate("[...document.querySelectorAll('[data-testid=finding-menu] button')].find((x) => x.textContent === 'Delete').click()");
    assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"));
    await b.evaluate("document.querySelector('.status').textContent = ''");
    await b.setFile('[data-testid=open-input]', here('../release-template/sample-project.rootnote.json'));
    assert.ok(await b.waitFor("/^Opened /.test(document.querySelector('.status').textContent)", 90000), 'this Open finished');
    const reopened = await b.evaluate(snap);
    await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
    assert.ok(await b.waitFor("!document.querySelector('dialog.confirm')"));
    assert.deepEqual(await b.evaluate(snap), reopened, 'nothing deleted from the reopened project');
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});

// a removal confirmed in the over-budget state that brings
// the project back under the limit offers no Undo, since none was promised when it was asked.
for (const [engine, port] of [['chrome', 9597], ['firefox', 9697]]) test(`a removal that ends the over-budget state offers no Undo in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 240000 }, async () => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'near-limit-v4-r9.rootnote.json');
  writeFileSync(file, nearLimitProject(createEmptyProjectV4));
  const b = await launch(engine, port);
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 20`, 90000));
    assert.equal(await b.evaluate("document.querySelector('[data-testid=download-original]') !== null"), true, 'in the recovery state');
    await b.evaluate("[...document.querySelectorAll('.navitem')].find((e) => e.textContent.includes('Budget finding 1')).click()");
    await b.evaluate("[...document.querySelector('[data-section=evidence] [data-image=\"IMG-0001\"]').querySelectorAll('button')].find((x) => x.textContent === 'Remove').click()");
    assert.ok(await b.waitFor("!!document.querySelector('dialog.confirm')"), 'asks, as Undo is not available');
    await b.evaluate("document.querySelector('dialog.confirm [data-confirm]').click()");
    assert.ok(await b.waitFor(`!${snap}.images.some((im) => im.id === 'IMG-0001')`));
    assert.ok(await b.waitFor("document.querySelector('.recovery[aria-label=\"Size limit\"]').hidden"), 'back under the limit');
    assert.equal(await b.evaluate("document.querySelector('[data-testid=undo-bar]').hidden"), true, 'no Undo offered');
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
