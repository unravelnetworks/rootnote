// Schema v3 rules (schema/project.v3.schema.json, frozen c987a73f): Additional details blocks, one shared pool of
// screenshot references, v2 -> v3 migration and recovery for converted files only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  createEmptyProjectV3 as createEmptyProject, createEmptyProjectV2, migrateV2toV3, validateProjectFile, openProjectFile, screenshotRefs,
  detailsTextLength, textBlock, imageBlock, newBlockId, savedSize, findingId, imageId, LIMITS, FORMAT_KEYS, projectFromSettings, migrateV3toV4, migrateV4toV5, migrateV5toV6, migrateV6toV7, migrateV7toV8,
  LIMITS_V7,
} from '../src/app/project.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v3.schema.json', import.meta.url), 'utf8'));
const schemaBytes = await fs.readFile(new URL('../schema/project.v3.schema.json', import.meta.url));

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height), { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const tiny = png(2, 2);
const image = (n, bytes = tiny, w = 2, h = 2) => ({
  id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
  width: w, height: h, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  caption: `Screenshot ${n}`, tallMode: 'auto',
});
const finding = (n, extra = {}) => ({
  id: findingId(n), title: `Finding ${n}`, rating: null, cvss: null,
  formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, evidence: [], ...extra,
});

function sampleV3() {
  const p = createEmptyProject(new Date('2026-11-01T00:00:00Z'));
  p.images = [image(1), image(2), image(3)];
  p.findings = [finding(1, {
    details: [
      { id: 'B-a', type: 'text', text: 'Request:', format: 'plain' },
      { id: 'B-b', type: 'image', imageId: 'IMG-0001' },
      { id: 'B-c', type: 'text', text: 'GET /x\n\tHost: a', format: 'code' },
    ],
    evidence: ['IMG-0002'],
  })];
  p.project.branding.testerLogo.imageId = 'IMG-0003';
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = 4;
  return p;
}
const check = (obj) => { const raw = JSON.stringify(obj); return validateProjectFile(raw, Buffer.byteLength(raw)); };
const open = (obj, opts = {}) => { const raw = JSON.stringify(obj); return openProjectFile(raw, Buffer.byteLength(raw), opts); };

test('the committed v3 schema is the frozen one', () => {
  assert.equal(createHash('sha256').update(schemaBytes).digest('hex'), 'c987a73f6917876e9bb2e74f4677324563bdbf5782a76ac607c02e030442e70c');
});

test('empty v3 project: valid, schema-shaped, Evidence gallery off, Additional details on', async () => {
  const p = createEmptyProject();
  assert.equal(p.schemaVersion, 3);
  const r = await check(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  for (const k of schema.properties.project.required) assert.ok(k in p.project, `missing required ${k}`);
  const sec = Object.fromEntries(p.project.sections.finding.map((s) => [s.key, s.enabled]));
  assert.equal(sec.evidence, false);
  assert.equal(sec.details, true);
  assert.deepEqual([...FORMAT_KEYS].sort(), [...schema.properties.findings.items.properties.formats.required].sort());
});

test('sample with text, inline image and code blocks plus a gallery passes', async () => {
  const r = await check(sampleV3());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('screenshotRefs: details image blocks first, then gallery, with block ids', () => {
  assert.deepEqual(screenshotRefs(sampleV3().findings[0]), [
    { imageId: 'IMG-0001', where: 'details', blockId: 'B-b' },
    { imageId: 'IMG-0002', where: 'evidence', blockId: null },
  ]);
});

test('block helpers make unique, valid ids', () => {
  const ids = new Set(Array.from({ length: 200 }, newBlockId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^B-[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(textBlock('x', 'code')), ['id', 'type', 'text', 'format']);
  assert.deepEqual(Object.keys(imageBlock('IMG-0001')), ['id', 'type', 'imageId']);
});

const rejects = (name, mutate, pattern) => test(`v3 rejects: ${name}`, async () => {
  const p = sampleV3();
  mutate(p);
  const r = await check(p);
  assert.equal(r.ok, false, `${name} was accepted`);
  assert.match(r.errors.join(' | '), pattern);
});
const d = (p) => p.findings[0].details;
rejects('details as v2 text', (p) => { p.findings[0].details = 'text'; }, /at most 100 blocks/);
rejects('formats.details (v2 key)', (p) => { p.findings[0].formats.details = 'plain'; }, /unknown field "details"/);
rejects('missing format key', (p) => { delete p.findings[0].formats.threat; }, /formats\.threat: missing/);
rejects('duplicate block id', (p) => { d(p)[2].id = 'B-a'; }, /duplicate B-a/);
rejects('block id with a space', (p) => { d(p)[0].id = 'B a'; }, /letters, digits/);
rejects('block id over 64', (p) => { d(p)[0].id = 'B'.repeat(65); }, /letters, digits/);
rejects('unknown block type', (p) => { d(p)[0].type = 'html'; }, /must be text or image/);
rejects('text block without format', (p) => { delete d(p)[0].format; }, /plain or code/);
rejects('extra field on a block', (p) => { d(p)[1].caption = 'x'; }, /unknown field "caption"/);
rejects('101 blocks', (p) => { while (d(p).length < 101) d(p).push({ id: `B-${d(p).length}`, type: 'text', text: '', format: 'plain' }); }, /at most 100 blocks/);
rejects('text blocks over 20000 in total', (p) => { d(p)[0].text = 'a'.repeat(10001); d(p)[2].text = 'b'.repeat(10000); }, /total 20001 characters/);
rejects('image block referencing a missing image', (p) => { d(p)[1].imageId = 'IMG-0099'; }, /IMG-0099 is referenced but not present/);
rejects('same image inline and in the gallery', (p) => { p.findings[0].evidence = ['IMG-0001']; p.images.splice(1, 1); }, /IMG-0001 is used more than once/);
rejects('same image in two findings', (p) => {
  p.findings.push(finding(2, { details: [{ id: 'B-z', type: 'image', imageId: 'IMG-0001' }] })); p.project.nextFindingNumber = 3;
}, /IMG-0001 is used more than once/);
rejects('inline image that is also the logo', (p) => { p.project.branding.clientLogo.imageId = 'IMG-0001'; }, /also used as a screenshot/);
rejects('image in a disabled section still counted', (p) => {
  p.project.sections.finding.find((s) => s.key === 'details').enabled = false;
  p.findings[0].evidence = ['IMG-0001']; p.images.splice(1, 1);
}, /IMG-0001 is used more than once/);
rejects('newer schema 9', (p) => { p.schemaVersion = 9; }, /newer version/);

test('30 screenshot references across inline blocks and galleries are allowed; 31 refused', async () => {
  const p = createEmptyProject();
  p.images = Array.from({ length: 31 }, (_, i) => image(i + 1));
  p.findings = [
    finding(1, { details: p.images.slice(0, 15).map((im, i) => ({ id: `B-${i}`, type: 'image', imageId: im.id })) }),
    finding(2, { evidence: p.images.slice(15, 30).map((im) => im.id) }),
  ];
  p.project.branding.testerLogo.imageId = 'IMG-0031';
  p.project.nextFindingNumber = 3;
  p.project.nextImageNumber = 32;
  assert.equal((await check(p)).ok, true);
  p.project.branding.testerLogo.imageId = null;
  p.findings[1].evidence.push('IMG-0031');
  const r = await check(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /31 screenshot references; the limit is 30/);
});

test('detailsTextLength sums only text blocks', () => {
  assert.equal(detailsTextLength(sampleV3().findings[0]), 'Request:'.length + 'GET /x\n\tHost: a'.length);
  assert.equal(detailsTextLength({ details: [] }), 0);
});

// ---- v2 -> v3 ----

function sampleV2() {
  const p = createEmptyProjectV2(new Date('2026-11-01T00:00:00Z'));
  p.images = [image(1), image(2)];
  p.findings = [
    { id: 'F-001', title: 'a', rating: 'High', cvss: null, description: 'd', details: '```\n\tGET /?q=`x`\n  Host: a\n```\n- not a bullet\r\nend  🔒',
      impact: 'i', threat: 't', recommendation: 'r', formats: { description: 'plain', details: 'code', impact: 'plain', threat: 'plain', recommendation: 'plain' }, evidence: ['IMG-0001'] },
    { id: 'F-002', title: 'b', rating: null, cvss: null, details: '', formats: { description: 'plain', details: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, evidence: [] },
    { id: 'F-004', title: 'c', rating: null, cvss: null, formats: { description: 'plain', details: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, evidence: [] },
  ];
  p.project.branding.testerLogo.imageId = 'IMG-0002';
  p.project.sections.finding.find((s) => s.key === 'evidence').label = 'Screens';
  p.project.nextFindingNumber = 5;
  p.project.nextImageNumber = 3;
  return p;
}

test('v2 -> v3: exact details text and format in one block, absent -> [], everything else unchanged', async () => {
  const v2 = sampleV2();
  const before = structuredClone(v2);
  const r = await open(v2, { appVersion: '0.3.0' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 2);
  assert.equal(r.overBudgetBytes, 0);
  // Opening goes on to v4; the v3 step is checked here, the v4 step in project-v4.test.
  const v3 = migrateV2toV3(v2, { appVersion: '0.3.0' });
  assert.deepEqual(r.project, migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(v3, { appVersion: '0.3.0' }), { appVersion: '0.3.0' }), { appVersion: '0.3.0' }), { appVersion: '0.3.0' })));
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.appVersion, '0.3.0');
  assert.deepEqual(v3.findings[0].details, [{ id: 'B-F-001-details', type: 'text', text: before.findings[0].details, format: 'code' }]);
  assert.deepEqual(v3.findings[1].details, [{ id: 'B-F-002-details', type: 'text', text: '', format: 'plain' }]);
  assert.deepEqual(v3.findings[2].details, []);
  v3.findings.forEach((f, i) => {
    const { details, formats, ...rest } = before.findings[i];
    const { details: _, ...fmt } = formats;
    assert.deepEqual(f.formats, fmt);
    for (const [k, val] of Object.entries(rest)) assert.deepEqual(f[k], val, `${f.id}.${k}`);
    assert.deepEqual(Object.keys(f).filter((k) => k !== 'details'), Object.keys(before.findings[i]).filter((k) => k !== 'details'));
  });
  // Gallery section flag/label/position and every other setting are carried over.
  assert.deepEqual(v3.project, before.project);
  assert.deepEqual(v3.images, before.images);
  assert.deepEqual(v2, before, 'input not modified');
  assert.equal((await check(v3)).ok, true);
});

test('a v3 file opens converted through v4, v5 and v6 to v7, with only the v4 to v7 additions', async () => {
  const p = sampleV3();
  const r = await open(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 3);
  assert.deepEqual(r.project, migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(JSON.parse(JSON.stringify(p))))))));
});

test('a v2 near its 25 MiB bound converts within the v8 limit (no recovery); the result opens natively', async () => {
  const p = createEmptyProjectV2(new Date('2026-11-01T00:00:00Z'));
  const big = png(1000, 690);
  p.images = Array.from({ length: 9 }, (_, i) => image(i + 1, big, 1000, 690));
  const fmt = { description: 'plain', details: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' };
  p.findings = Array.from({ length: 20 }, (_, i) => ({ id: findingId(i + 1), title: '', rating: null, cvss: null,
    description: '', details: '', impact: '', recommendation: '', formats: { ...fmt }, evidence: i === 0 ? p.images.map((im) => im.id) : [] }));
  p.project.nextFindingNumber = 21;
  p.project.nextImageNumber = 10;
  const growth = savedSize(migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(p))))))) - savedSize(p); // to the current schema
  assert.ok(growth > 500, `growth ${growth}`);
  let need = LIMITS_V7.fileBytes - Math.floor(growth / 2) - Buffer.byteLength(JSON.stringify(p));
  for (const f of p.findings) for (const k of ['description', 'impact', 'recommendation', 'details']) {
    const add = Math.min(need, LIMITS.text - f[k].length);
    if (add > 0) { f[k] += 'a'.repeat(add); need -= add; }
  }
  assert.equal(need, 0, 'padding capacity');
  const r = await open(p);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.migratedFrom, 2);
  assert.equal(r.overBudgetBytes, 0);
  assert.ok(savedSize(r.project) > LIMITS_V7.fileBytes, 'over the old bound after conversion');
  const native = await open(r.project);
  assert.equal(native.ok, true, JSON.stringify(native.errors));
});

test('an invalid v2 file is refused before conversion', async () => {
  const p = sampleV2();
  p.findings[0].formats.details = 'markdown';
  const r = await open(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /plain or code/);
});

// ---- New report from settings ----

test('New report from settings keeps layout and branding, never client or finding text', async () => {
  const raw = await fs.readFile(new URL('./fixtures/v2-small.json', import.meta.url), 'utf8');
  const opened = await openProjectFile(raw, Buffer.byteLength(raw), { appVersion: 'test' });
  assert.ok(opened.ok);
  const src = opened.project;
  src.project.sections.finding[0].label = 'Systems affected';
  src.project.labels.severity = 'Rating';
  src.project.engagement.rows.find((r) => r.source === 'custom').value = 'Jane Client, CISO';
  src.project.findingStatusDisplay = { keyFacts: true, summaryColumn: true, counts: false };
  src.project.engagementStatus = 'delivered';
  src.project.engagement.rows.push({ source: 'engagementStatus', label: 'Engagement status', enabled: true });
  const next = projectFromSettings(src, new Date('2026-11-02T00:00:00.000Z'));
  const text = JSON.stringify(next);
  const v = await validateProjectFile(text, Buffer.byteLength(text));
  assert.ok(v.ok, v.errors?.join('; '));
  assert.equal(next.findings.length, 0);
  for (const k of ['title', 'subtitle', 'client', 'engagementId', 'findingPrefix', 'startDate', 'endDate', 'reportDate', 'scope', 'executiveSummary']) assert.equal(next.project[k], '', k);
  for (const k of ['testerName', 'organisation', 'classification', 'paperSize', 'accentColor']) assert.equal(next.project[k], src.project[k], k);
  assert.deepEqual(next.project.sections, src.project.sections);
  assert.deepEqual(next.project.labels, src.project.labels);
  assert.deepEqual(next.project.scoring, src.project.scoring);
  assert.deepEqual(next.project.findingStatusDisplay, src.project.findingStatusDisplay);
  assert.equal(next.project.engagementStatus, 'draft', 'a new report starts as Draft');
  assert.ok(next.project.engagement.rows.some((r) => r.source === 'engagementStatus'), 'the bound row is layout and comes along');
  assert.ok(next.project.engagement.rows.every((r) => r.source !== 'custom' || r.value === ''));
  assert.deepEqual(next.project.engagement.rows.map((r) => r.label), src.project.engagement.rows.map((r) => r.label));
  assert.doesNotMatch(text, /Jane Client/);
  // Only the tester logo comes along, as the first image; the client logo stays behind.
  assert.equal(next.images.length, 1);
  assert.equal(next.project.branding.testerLogo.imageId, 'IMG-0001');
  assert.equal(next.project.branding.clientLogo.imageId, null);
  const logo = src.images.find((im) => im.id === src.project.branding.testerLogo.imageId);
  assert.ok(logo.dataUrl.startsWith('data:image/'));
  assert.equal(next.images[0].dataUrl, logo.dataUrl);
  assert.equal(next.images[0].sha256, logo.sha256);
  assert.equal(next.project.nextImageNumber, 2);
  assert.equal(next.project.nextFindingNumber, 1);
  assert.equal(next.project.reportVersion, '1.0');
  // Bound engagement rows hold no value of their own; they read the new, blank metadata.
  assert.ok(next.project.engagement.rows.filter((r) => r.source !== 'custom').every((r) => !('value' in r)));
  // The source project is unchanged.
  assert.equal(src.findings.length, 3);
});
