// Schema v8 (schema/project.v8.schema.json): the same project as v7 with larger limits:
// 150 findings, 400 screenshot references, 402 images, 256 MiB (268,435,456 bytes). Files of
// v1-v7 are still held to their own bounds before they are converted. Boundaries are checked
// one above each limit; the file-size boundary is checked on a real project file at the cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  createEmptyProject, createEmptyProjectV7, migrateV7toV8, openProjectFile, validateProjectFileV8, validateProjectFileV7,
  defaultFormats, imageBlock, findingId, imageId, savedSize, limitsForVersion, LIMITS, LIMITS_V7, LIMITS_V8, SCHEMA_VERSION,
} from '../src/app/project.js';
import { createReportPlan } from '../src/export-docx/plan.js';
import { findingStatusCounts } from '../src/scoring/status.js';

const schemaOf = async (v) => JSON.parse(await fs.readFile(new URL(`../schema/project.v${v}.schema.json`, import.meta.url), 'utf8'));
const json = (d) => JSON.stringify(d);
const open = (d, opts) => openProjectFile(json(d), Buffer.byteLength(json(d)), opts);
const NOW = new Date('2026-11-14T00:00:00.000Z');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
// A valid PNG; `stored` keeps the pixel data uncompressed (large files).
function png(width, height, stored = false) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: stored ? 0 : 6 })), chunk('IEND', Buffer.alloc(0))]);
}
const image = (n, bytes, w, h) => ({
  id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: w, height: h,
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), caption: '', tallMode: 'auto',
});
const finding = (n) => ({ id: findingId(n), title: `Finding ${n}`, rating: 'High', cvss: null, affectedAssets: [], description: '', impact: '',
  threat: '', recommendation: '', formats: defaultFormats(), details: [], evidence: [], references: [], status: 'open', cwe: '', vulnerabilityType: '' });
/** A project of `version` with `nf` findings and `ns` screenshots (half gallery, half inline blocks). */
function project(version, nf, ns) {
  const d = version === 8 ? createEmptyProject(NOW) : createEmptyProjectV7(NOW);
  const tiny = png(2, 2);
  d.findings = Array.from({ length: nf }, (_, i) => finding(i + 1));
  d.images = Array.from({ length: ns }, (_, i) => image(i + 1, tiny, 2, 2));
  d.images.forEach((im, i) => {
    const f = d.findings[i % nf];
    if (i % 2) f.details.push(imageBlock(im.id, `b${i}`)); else f.evidence.push(im.id);
  });
  d.project.nextFindingNumber = nf + 1;
  d.project.nextImageNumber = ns + 1;
  return d;
}

test('the frozen v8 schema changes the version and the size bounds only; v7 stays byte-identical', async () => {
  const v7 = await schemaOf(7), v8 = await schemaOf(8);
  const raw7 = await fs.readFile(new URL('../schema/project.v7.schema.json', import.meta.url));
  assert.equal(createHash('sha256').update(raw7).digest('hex').slice(0, 16), '9814cbe69636f3f3', 'v7 schema unchanged');
  assert.equal(v8.properties.schemaVersion.const, 8);
  assert.equal(v8.properties.findings.maxItems, 150);
  assert.equal(v8.properties.findings.items.properties.evidence.maxItems, 400);
  assert.equal(v8.properties.images.maxItems, 402);
  assert.match(v8.$comment, /\(1\) raw file <= 268435456 bytes/);
  assert.match(v8.$comment, /v7 to v8: schemaVersion only/);
  // Everything else is the v7 schema.
  const strip = (s) => { const c = structuredClone(s); delete c.$id; delete c.title; delete c.$comment; c.properties.schemaVersion = null;
    c.properties.findings.maxItems = c.properties.findings.items.properties.evidence.maxItems = c.properties.images.maxItems = null; return c; };
  assert.deepEqual(strip(v8), strip(v7));
});

test('the limits: v8 is larger; v1-v7 keep theirs; unknown versions have none', () => {
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(LIMITS, LIMITS_V8);
  assert.deepEqual([LIMITS_V8.fileBytes, LIMITS_V8.findings, LIMITS_V8.evidence, LIMITS_V8.images], [268435456, 150, 400, 402]);
  assert.deepEqual([LIMITS_V7.fileBytes, LIMITS_V7.findings, LIMITS_V7.evidence, LIMITS_V7.images], [26214400, 20, 30, 32]);
  for (const k of ['imageBytes', 'imagePixels', 'imageSide', 'engagementRows', 'label', 'prefix', 'assets', 'line', 'text', 'detailBlocks']) assert.equal(LIMITS_V8[k], LIMITS_V7[k], k);
  for (let v = 1; v <= 7; v++) assert.equal(limitsForVersion(v), LIMITS_V7);
  assert.equal(limitsForVersion(8), LIMITS_V8);
  for (const v of [0, 9, '8', null, 7.5]) assert.equal(limitsForVersion(v), null);
});

test('a new project is v8 and opens as it is; a v7 project converts changing only its version', async () => {
  const d = createEmptyProject(NOW);
  assert.equal(d.schemaVersion, 8);
  assert.ok((await validateProjectFileV8(json(d), Buffer.byteLength(json(d)))).ok);
  const r = await open(d);
  assert.deepEqual([r.ok, r.migratedFrom, r.overBudgetBytes], [true, null, 0]);
  assert.deepEqual(r.project, d);
  const v7 = project(7, 3, 4);
  const m = migrateV7toV8(structuredClone(v7));
  const { schemaVersion, ...rest } = m;
  assert.equal(schemaVersion, 8);
  assert.deepEqual(rest, (({ schemaVersion: _, ...x }) => x)(v7));
  const o = await open(v7);
  assert.deepEqual([o.ok, o.migratedFrom], [true, 7]);
  assert.deepEqual(o.project, m);
  assert.ok((await validateProjectFileV7(json(m), 10)).errors.includes('Not a schema v7 project file.'));
});

test('v8 takes 150 findings, 400 screenshots (gallery and inline together) and 402 images; one more is refused', async () => {
  const full = project(8, 150, 400);
  assert.equal((await open(full)).ok, true);
  const plan = createReportPlan(full);
  assert.equal(plan.findings.length, 150);
  assert.equal(findingStatusCounts(full).total, 150);
  const more = project(8, 151, 10);
  assert.match((await open(more)).errors.join(' '), /findings: more than 150/);
  const refs = project(8, 150, 401);
  assert.match((await open(refs)).errors.join(' '), /more than 402|401 screenshot references; the limit is 400/);
  // 402 images: 400 screenshots and two logos.
  const logos = project(8, 150, 400);
  const tiny = png(3, 3);
  logos.images.push(image(401, tiny, 3, 3), image(402, png(4, 4), 4, 4));
  logos.project.branding = { testerLogo: { imageId: 'IMG-0401', front: true, header: false, footer: false }, clientLogo: { imageId: 'IMG-0402', front: true, header: false, footer: false } };
  logos.project.nextImageNumber = 403;
  assert.equal((await open(logos)).ok, true, (await open(logos)).errors?.join('; '));
  logos.images.push(image(403, png(5, 5), 5, 5));
  logos.project.nextImageNumber = 404;
  assert.match((await open(logos)).errors.join(' '), /images: more than 402/);
});

test('an older file is held to its own bounds: it never becomes valid by converting', async () => {
  assert.match((await open(project(7, 21, 2))).errors.join(' '), /findings: more than 20/);
  assert.match((await open(project(7, 20, 31))).errors.join(' '), /limit is 30|more than 30/);
  assert.match((await open(project(7, 20, 33))).errors.join(' '), /images: more than 32/);
  // Raw size: a v7 file over 25 MiB is refused after its version is read (before images are checked);
  // the same size as a v8 file passes that check. (Allocation-light: the size argument is the file's byte count.)
  const v7 = json(project(7, 1, 0)), v8 = json(project(8, 1, 0));
  const r7 = await openProjectFile(v7, LIMITS_V7.fileBytes + 1);
  assert.match(r7.errors[0], /limit is 26214400 \(25 MB\)/);
  assert.equal((await openProjectFile(v7, LIMITS_V7.fileBytes)).ok, true);
  assert.equal((await openProjectFile(v8, LIMITS_V7.fileBytes + 1)).ok, true);
  assert.equal((await openProjectFile(v8, LIMITS_V8.fileBytes)).ok, true);
  assert.match((await openProjectFile(v8, LIMITS_V8.fileBytes + 1)).errors[0], /limit is 268435456 \(256 MB\)/);
  // An unknown or newer version over the largest cap is refused before parsing.
  assert.match((await openProjectFile('{', LIMITS_V8.fileBytes + 1)).errors[0], /limit is 268435456/);
  // The report builder applies the bounds of the project's own version.
  const big7 = project(7, 20, 2);
  big7.findings.push(finding(21));
  assert.throws(() => createReportPlan(big7), /format 7 holds at most 20/);
});

test('a real v8 file of exactly 268,435,456 bytes opens; one byte more (multibyte text) is refused', async () => {
  // About 95 large stored PNGs (~2 MiB each) and text padding up to the cap.
  const big = png(980, 700, true);
  assert.ok(big.length <= LIMITS.imageBytes, `${big.length}`);
  const d = createEmptyProject(NOW);
  d.findings = Array.from({ length: 150 }, (_, i) => finding(i + 1));
  const per = Math.ceil(big.length / 3) * 4 + 300;
  const n = Math.floor((LIMITS.fileBytes - 5e6) / per);
  d.images = Array.from({ length: n }, (_, i) => image(i + 1, big, 980, 700));
  d.images.forEach((im, i) => d.findings[i % 150].evidence.push(im.id));
  d.project.nextFindingNumber = 151;
  d.project.nextImageNumber = n + 1;
  d.appVersion = '0.3.0';
  // Pad with 3-byte characters, then single bytes, to the exact cap of the saved form.
  let need = LIMITS.fileBytes - savedSize(d);
  for (const f of d.findings) for (const k of ['description', 'impact', 'threat', 'recommendation']) {
    if (need <= 0) break;
    const room = LIMITS.text - f[k].length;
    const three = Math.min(Math.floor(need / 3), room);
    f[k] += '€'.repeat(three); need -= three * 3;
    const one = Math.min(need, room - three);
    if (one > 0) { f[k] += 'a'.repeat(one); need -= one; }
  }
  assert.equal(need, 0, 'padding capacity');
  assert.equal(savedSize(d), LIMITS.fileBytes);
  const raw = json(d);
  const r = await openProjectFile(raw, Buffer.byteLength(raw), { appVersion: '0.3.0' });
  assert.equal(r.ok, true, r.errors?.join('; '));
  // One more 3-byte character: the saved form is over the cap and the file is refused.
  d.findings[149].title += '€';
  const raw2 = json(d);
  const r2 = await openProjectFile(raw2, Buffer.byteLength(raw2), { appVersion: '0.3.0' });
  assert.equal(r2.ok, false);
  assert.match(r2.errors[0], /limit is 268435456 \(256 MB\)/);
});
