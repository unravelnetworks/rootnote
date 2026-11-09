// Schema v2 rules (frozen, still validated in their own version), v1 -> v2 -> v3 opening
// and the over-budget recovery classification (schema/project.v2.schema.json).
// v3-only rules are in project-v3.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  createEmptyProjectV1, createEmptyProjectV2 as createEmptyProject, migrateV1toV2, migrateV2toV3, migrateV3toV4, migrateV4toV5, migrateV5toV6, validateProjectFile, openProjectFile,
  resolveFindingPrefix, savedSize, findingId, imageId, LIMITS, LABEL_KEYS,
} from '../src/app/project.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v2.schema.json', import.meta.url), 'utf8'));

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Uncompressed (stored) PNG, so its size is predictable for the budget test.
function png(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

function image(n, bytes, w, h, tallMode = 'split') {
  return {
    id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    width: w, height: h, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    caption: `Screenshot ${n}`, tallMode,
  };
}

const tiny = png(2, 2);
const finding = (n, extra = {}) => ({
  id: findingId(n), title: `Finding ${n}`, rating: null, cvss: null,
  formats: { description: 'plain', details: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' },
  evidence: [], ...extra,
});

function sampleV2() {
  const p = createEmptyProject(new Date('2026-11-01T00:00:00Z'));
  p.project.title = 'Synthetic v2 — 𝔘';
  p.images = [image(1, tiny, 2, 2), image(2, tiny, 2, 2), image(3, tiny, 2, 2, 'auto')];
  p.findings = [finding(1, { rating: 'High', cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', evidence: ['IMG-0001', 'IMG-0002'] })];
  p.project.branding.testerLogo.imageId = 'IMG-0003';
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = 4;
  return p;
}

const check = (obj) => {
  const raw = JSON.stringify(obj);
  return validateProjectFile(raw, Buffer.byteLength(raw));
};

test('empty v2 project is valid and matches the committed schema shape', async () => {
  const p = createEmptyProject();
  const r = await check(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const proj = schema.properties.project;
  for (const k of proj.required) assert.ok(k in p.project, `missing required ${k}`);
  for (const k of Object.keys(p.project)) assert.ok(k in proj.properties, `not in schema: ${k}`);
  assert.deepEqual([...LABEL_KEYS].sort(), [...proj.properties.labels.required].sort());
  assert.deepEqual(Object.keys(p.project.labels).sort(), [...LABEL_KEYS].sort());
  assert.equal(p.project.cover.enabled, true);
  assert.equal(p.project.sections.report.find((s) => s.key === 'engagement').enabled, true);
});

test('sample v2 project passes (CVSS, auto tall mode, logo outside evidence)', async () => {
  const r = await check(sampleV2());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('32 images allowed: 30 evidence plus two distinct logos; 33 refused', async () => {
  const p = createEmptyProject();
  p.images = Array.from({ length: 32 }, (_, i) => image(i + 1, tiny, 2, 2));
  p.findings = [finding(1, { evidence: p.images.slice(0, 30).map((im) => im.id) })];
  p.project.branding.testerLogo.imageId = 'IMG-0031';
  p.project.branding.clientLogo.imageId = 'IMG-0032';
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = 34;
  assert.equal((await check(p)).ok, true);
  p.images.push(image(33, tiny, 2, 2));
  p.findings[0].evidence.push('IMG-0033');
  const r = await check(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /more than 32|limit is 30/);
});

const rejects = (name, mutate, pattern) => test(`v2 rejects: ${name}`, async () => {
  const p = sampleV2();
  mutate(p);
  const r = await check(p);
  assert.equal(r.ok, false, `${name} was accepted`);
  assert.match(r.errors.join(' | '), pattern);
});

rejects('logo that is also evidence', (p) => { p.project.branding.clientLogo.imageId = 'IMG-0001'; }, /also used as a screenshot/);
rejects('dangling logo', (p) => { p.project.branding.clientLogo.imageId = 'IMG-0099'; }, /referenced but not present/);
rejects('unreferenced image', (p) => { p.project.branding.testerLogo.imageId = null; }, /IMG-0003 is not used/);
rejects('v1 severity field', (p) => { p.findings[0].severity = 'High'; }, /unknown field "severity"/);
rejects('v1 logoImageId field', (p) => { p.project.logoImageId = null; }, /unknown field "logoImageId"/);
rejects('CVSS with a temporal metric', (p) => { p.findings[0].cvss += '/E:P'; }, /CVSS 3\.1 Base vector/);
rejects('CVSS 3.0 prefix', (p) => { p.findings[0].cvss = p.findings[0].cvss.replace('3.1', '3.0'); }, /CVSS 3\.1 Base vector/);
rejects('CVSS metrics out of order', (p) => { p.findings[0].cvss = 'CVSS:3.1/AC:L/AV:N/PR:N/UI:N/S:U/C:H/I:H/A:H'; }, /CVSS 3\.1 Base vector/);
rejects('missing formats', (p) => { delete p.findings[0].formats; }, /formats: missing/);
rejects('bad text format', (p) => { p.findings[0].formats.details = 'markdown'; }, /plain or code/);
rejects('duplicate report section', (p) => { p.project.sections.report[1].key = 'scope'; }, /exactly once/);
rejects('missing finding section', (p) => { p.project.sections.finding.pop(); }, /exactly once/);
rejects('unknown section key', (p) => { p.project.sections.finding[0].key = 'html'; }, /exactly once/);
rejects('empty section label', (p) => { p.project.sections.finding[0].label = '   '; }, /must not be empty/);
rejects('label over 80', (p) => { p.project.labels.figure = 'x'.repeat(81); }, /longer than 80/);
rejects('missing label key', (p) => { delete p.project.labels.date; }, /labels\.date: missing/);
rejects('duplicate bound engagement row', (p) => { p.project.engagement.rows.push({ source: 'client', label: 'Client again', enabled: true }); }, /client appears more than once/);
rejects('bound row with its own value', (p) => { p.project.engagement.rows[0].value = 'x'; }, /unknown field "value"/);
rejects('custom row without value', (p) => { delete p.project.engagement.rows[3].value; }, /value: missing/);
rejects('21 engagement rows', (p) => { while (p.project.engagement.rows.length < 21) p.project.engagement.rows.push({ source: 'custom', label: 'x', enabled: true, value: '', format: 'plain' }); }, /at most 20/);
rejects('prefix with a tab', (p) => { p.project.findingPrefix = 'A\tB'; }, /without tabs/);
rejects('prefix over 40', (p) => { p.project.findingPrefix = 'P'.repeat(41); }, /at most 40/);
rejects('bad scoring mode', (p) => { p.project.scoring.mode = 'dread'; }, /must be one of/);
rejects('missing backToSummaryLinks', (p) => { delete p.project.backToSummaryLinks; }, /backToSummaryLinks: missing/);
rejects('control character in a label', (p) => { p.project.labels.page = 'Pa\u0001ge'; }, /cannot be written to Word/);
rejects('newer schema 7', (p) => { p.schemaVersion = 7; }, /newer version/);

test('v1 still rejects the v2-only auto tall mode', async () => {
  const p = createEmptyProjectV1();
  p.images = [image(1, tiny, 2, 2, 'auto')];
  p.findings = [{ id: 'F-001', title: 't', severity: null, evidence: ['IMG-0001'] }];
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = 2;
  const r = await check(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /fit or split/);
});

test('visible finding prefix: trimmed override, then engagement ID, else F, never truncated', () => {
  const meta = (findingPrefix, engagementId) => ({ findingPrefix, engagementId });
  assert.equal(resolveFindingPrefix(meta('  ACME-24  ', 'ENG')), 'ACME-24');
  assert.equal(resolveFindingPrefix(meta('', ' ENG-7 ')), 'ENG-7');
  assert.equal(resolveFindingPrefix(meta('   ', 'E'.repeat(40))), 'E'.repeat(40));
  assert.equal(resolveFindingPrefix(meta('', 'E'.repeat(41))), 'F');
  assert.equal(resolveFindingPrefix(meta('', 'A\tB')), 'F');
  assert.equal(resolveFindingPrefix(meta('', '   ')), 'F');
});

// ---- migration ----

async function openText(raw) {
  return openProjectFile(raw, Buffer.byteLength(raw), { appVersion: '0.2.0' });
}

for (const name of ['small', 'bounds']) {
  test(`${name} v1 fixture migrates with every value preserved`, async () => {
    const raw = await fs.readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
    const v1 = JSON.parse(raw);
    const r = await openText(raw);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.migratedFrom, 1);
    assert.equal(r.overBudgetBytes, 0);
    const v2 = r.project;
    assert.equal(v2.schemaVersion, 6); // v1 -> v2 -> v3 -> v4 -> v5 -> v6; the v1 values are checked below
    assert.equal(v2.appVersion, '0.2.0');
    assert.equal(v2.createdAt, v1.createdAt);
    assert.equal(v2.savedAt, v1.savedAt);
    const { logoImageId = null, ...meta } = v1.project;
    for (const [k, val] of Object.entries(meta)) assert.deepEqual(v2.project[k], val, `project.${k}`);
    assert.equal(v2.project.branding.testerLogo.imageId, logoImageId);
    assert.equal(v2.project.branding.testerLogo.front, true);
    assert.equal(v2.project.branding.clientLogo.imageId, null);
    assert.equal(v2.project.cover.enabled, false);
    assert.equal(v2.project.sections.report.find((s) => s.key === 'engagement').enabled, false);
    assert.equal(v2.project.sections.finding.find((s) => s.key === 'details').label, 'Request and reproduction');
    assert.equal(v2.findings.length, v1.findings.length);
    v1.findings.forEach((f, i) => {
      const g = v2.findings[i];
      assert.equal(g.id, f.id);
      assert.equal(g.title, f.title);
      assert.equal(g.rating, f.severity);
      assert.equal(g.cvss, null);
      assert.deepEqual(g.details, f.reproduction === undefined ? [] : [{ id: `B-${f.id}-details`, type: 'text', text: f.reproduction, format: 'code' }]);
      assert.equal('details' in g.formats, false);
      for (const k of ['affectedAssets', 'description', 'impact', 'recommendation', 'evidence']) assert.deepEqual(g[k], f[k], `${f.id}.${k}`);
      assert.equal('threat' in g, false);
    });
    assert.deepEqual(v2.images, v1.images);
    // The converted project is itself a valid v4 file.
    const again = await check(v2);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    // The input object was not modified.
    assert.deepEqual(JSON.parse(raw), v1);
  });
}

test('migration keeps reproduction text literally, including fence lines, tabs and spaces', async () => {
  const p = createEmptyProjectV1();
  const literal = '```\n\tGET /?q=`x` HTTP/1.1\n  Host: a\n```\n\n- not a bullet\r\nend  ';
  p.findings = [{ id: 'F-001', title: 't', severity: 'Low', reproduction: literal, evidence: [] }];
  p.project.nextFindingNumber = 2;
  const r = await openText(JSON.stringify(p));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.project.findings[0].details, [{ id: 'B-F-001-details', type: 'text', text: literal, format: 'code' }]);
});

test('migration keeps absent optional fields absent and nulls null', () => {
  const p = createEmptyProjectV1();
  p.findings = [{ id: 'F-001', title: '', severity: null, evidence: [] }];
  const v2 = migrateV1toV2(p);
  assert.deepEqual(Object.keys(v2.findings[0]), ['id', 'title', 'rating', 'cvss', 'formats', 'evidence']);
  assert.equal(v2.findings[0].rating, null);
});

test('a v2 file opens converted through v3, v4 and v5 to v6, with nothing else changed', async () => {
  const raw = JSON.stringify(sampleV2());
  const r = await openText(raw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 2);
  assert.deepEqual(r.project, migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(JSON.parse(raw), { appVersion: '0.2.0' }), { appVersion: '0.2.0' }), { appVersion: '0.2.0' }), { appVersion: '0.2.0' }));
});

test('an invalid v1 file is refused before migration', async () => {
  const p = createEmptyProjectV1();
  p.findings = [{ id: 'F-000', title: '', severity: null, evidence: [] }];
  const r = await openText(JSON.stringify(p));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /F-001/);
});

test('near-cap v1: opens in recovery with the measured overage; over-cap v1 and v2 refused', async () => {
  // Nine ~2 MB images, then text padding so the v1 file sits just under 25 MiB and the
  // fixed v2 settings push the converted project over it.
  const p = createEmptyProjectV1(new Date('2026-11-01T00:00:00Z'));
  const big = png(1000, 690);
  assert.ok(big.length <= LIMITS.imageBytes);
  p.images = Array.from({ length: 9 }, (_, i) => image(i + 1, big, 1000, 690));
  p.findings = Array.from({ length: 20 }, (_, i) => ({
    id: findingId(i + 1), title: '', severity: null, description: '', impact: '', recommendation: '', reproduction: '',
    evidence: i === 0 ? p.images.map((im) => im.id) : [],
  }));
  p.project.nextFindingNumber = 21;
  p.project.nextImageNumber = 10;
  const growth = savedSize(migrateV2toV3(migrateV1toV2(p, { appVersion: '0.2.0' }))) - savedSize({ ...p, appVersion: '0.2.0' });
  assert.ok(growth > 1000, `growth ${growth}`);
  const pad = (target) => {
    let need = target - Buffer.byteLength(JSON.stringify(p));
    for (const f of p.findings) for (const k of ['description', 'impact', 'recommendation', 'reproduction']) {
      const add = Math.min(need, LIMITS.text - f[k].length);
      if (add > 0) { f[k] += 'a'.repeat(add); need -= add; }
    }
    assert.equal(need, 0, 'padding capacity');
  };
  pad(LIMITS.fileBytes - Math.floor(growth / 2));
  const raw = JSON.stringify(p);
  assert.ok(Buffer.byteLength(raw) <= LIMITS.fileBytes);
  const r = await openText(raw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 1);
  assert.ok(r.overBudgetBytes > 0 && r.overBudgetBytes <= growth, `over ${r.overBudgetBytes}`);
  assert.equal(r.overBudgetBytes, savedSize(r.project) - LIMITS.fileBytes);
  // The same converted project saved as a v3 file is refused (no recovery for native v3).
  const v2raw = JSON.stringify(r.project);
  const v2 = await openText(v2raw);
  assert.equal(v2.ok, false);
  assert.match(v2.errors[0], /limit is 26214400/);
  // A v1 file over the limit is refused before parsing.
  const over = await openProjectFile(raw, LIMITS.fileBytes + 1);
  assert.equal(over.ok, false);
});

test('v2 whose saved form exceeds 25 MiB opens in recovery after conversion (was refused before v3)', async () => {
  const p = createEmptyProject(new Date('2026-11-01T00:00:00Z'));
  p.savedAt = '2026-11-01T00:00:00Z'; // valid, 4 characters shorter than the app writes
  const big = png(1000, 690);
  p.images = Array.from({ length: 9 }, (_, i) => image(i + 1, big, 1000, 690));
  p.findings = Array.from({ length: 20 }, (_, i) => finding(i + 1, {
    description: '', impact: '', recommendation: '', details: '', evidence: i === 0 ? p.images.map((im) => im.id) : [],
  }));
  p.project.nextFindingNumber = 21;
  p.project.nextImageNumber = 10;
  let need = LIMITS.fileBytes - 1 - Buffer.byteLength(JSON.stringify(p));
  for (const f of p.findings) for (const k of ['description', 'impact', 'recommendation', 'details']) {
    const add = Math.min(need, LIMITS.text - f[k].length);
    if (add > 0) { f[k] += 'a'.repeat(add); need -= add; }
  }
  assert.equal(need, 0, 'padding capacity');
  const raw = JSON.stringify(p);
  assert.equal(Buffer.byteLength(raw), LIMITS.fileBytes - 1);
  assert.ok(savedSize(p) > LIMITS.fileBytes);
  // The file is a valid v2 file as such...
  assert.equal((await validateProjectFile(raw, Buffer.byteLength(raw))).ok, true);
  // ...and since v3 a v2 file is converted, so it opens in the recovery state with the
  // measured overage instead of being refused (v3 rule 7). Native v3: project-v3.test.mjs.
  const r = await openProjectFile(raw, Buffer.byteLength(raw));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 2);
  assert.equal(r.overBudgetBytes, savedSize(r.project) - LIMITS.fileBytes);
  assert.ok(r.overBudgetBytes > 0);
});

test('callers cannot skip image checks through options', async () => {
  const p = sampleV2();
  p.images[0].sha256 = '0'.repeat(64);
  const raw = JSON.stringify(p);
  for (const fn of [validateProjectFile, openProjectFile]) {
    const r = await fn(raw, Buffer.byteLength(raw), { skipImageData: true });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /sha256/);
  }
});
