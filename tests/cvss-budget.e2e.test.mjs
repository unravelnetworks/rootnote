// A CVSS vector refused by the 25 MB budget is not left on screen as if it were stored: the box
// and menus go back to the stored value and the note says it was not saved (Codex 148 R1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyProject, defaultFormats, LIMITS } from '../src/app/project.js';
import { APP_VERSION } from '../src/app/version.js';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dist = here('../dist/rootnote.html');
const snap = 'window.__fieldnote.snapshot()';
const V31 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

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

/** A valid current-schema project 16 bytes under the limit; finding 1 has no vector, finding 2 a 3.1 vector. */
function nearLimitProject() {
  const p = createEmptyProject(new Date('2026-11-12T00:00:00.000Z'));
  p.appVersion = APP_VERSION;
  p.project.title = 'Near budget CVSS';
  const png = noisyPng(800, 870);
  p.images = Array.from({ length: 9 }, (_, i) => ({ id: `IMG-000${i + 1}`, mime: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: 800, height: 870, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), caption: 'Synthetic', tallMode: 'fit' }));
  p.findings = Array.from({ length: 20 }, (_, i) => ({ id: `F-${String(i + 1).padStart(3, '0')}`, title: `Budget finding ${i + 1}`, rating: null, cvss: i === 1 ? V31 : null,
    affectedAssets: [], description: '', impact: '', threat: '', recommendation: '', formats: defaultFormats(), details: [], status: 'open',
    evidence: i ? [] : p.images.map((im) => im.id), references: [], cwe: '', vulnerabilityType: '' }));
  p.project.nextFindingNumber = 21;
  p.project.nextImageNumber = 10;
  let need = LIMITS.fileBytes - 16 - Buffer.byteLength(JSON.stringify(p));
  for (const f of p.findings) for (const k of ['description', 'impact', 'threat', 'recommendation']) {
    const n = Math.min(need, LIMITS.text);
    f[k] = 'x'.repeat(n);
    need -= n;
  }
  assert.equal(need, 0, 'padding capacity');
  return JSON.stringify(p);
}

test('a CVSS vector refused by the budget is not shown as stored', { skip: !installed('chrome') && 'chrome not installed', timeout: 180000 }, async (t) => {
  assert.ok(existsSync(dist), 'run npm run build first');
  mkdirSync(here('./out'), { recursive: true });
  const file = here('./out/cvss-near-limit.json');
  writeFileSync(file, nearLimitProject());
  const b = await launch('chrome', 9541);
  const paste = (v) => `(() => { const i = document.querySelector('[data-testid=cvss]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true })); })()`;
  const state = `({ stored: ${snap}.findings[__I__].cvss, input: document.querySelector('[data-testid=cvss]').value, note: document.querySelector('[data-testid=cvss-note]').textContent, kind: document.querySelector('[data-testid=cvss-note]').dataset.kind })`;
  try {
    await b.navigate(pathToFileURL(dist).href);
    assert.ok(await b.waitFor("document.getElementById('app').dataset.ready === '1'"));
    await b.setFile('[data-testid=open-input]', file);
    assert.ok(await b.waitFor(`${snap}.findings.length === 20`, 90000));

    await t.test('empty finding: a 3.1 vector refused by the budget is cleared from the box', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[0].click()");
      await b.evaluate(paste(V31));
      const s = await b.evaluate(state.replace('__I__', '0'));
      assert.equal(s.stored, null);
      assert.equal(s.input, '', 'the box shows what Save writes');
      assert.equal(s.kind, 'error');
      assert.match(s.note, /Not saved: the project is at its size limit\. Not scored\./);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-AV]').value"), '', 'menus stay empty');
    });

    await t.test('scored finding: a vector in the other version is refused and the 3.1 vector stays', async () => {
      await b.evaluate("document.querySelectorAll('.nav li.sortable .navitem')[1].click()");
      await b.evaluate(paste(V40));
      const s = await b.evaluate(state.replace('__I__', '1'));
      assert.equal(s.stored, V31);
      assert.equal(s.kind, 'error', 'the refused text stays flagged, like any invalid vector');
      assert.match(s.note, /This report uses CVSS 3\.1\..*Still stored: CVSS:3\.1\//);
      assert.equal(await b.evaluate("document.querySelector('[data-testid=cvss-AV]').value"), 'N');
    });
    assert.deepEqual(b.errors, [], 'page errors or CSP violations');
    assert.deepEqual(b.requests, [], 'network requests');
  } finally {
    await b.close();
  }
});
