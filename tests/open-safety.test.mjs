// Opening checks every screenshot before decoding it, also when the list of error messages is
// already full; an oversized screenshot is refused before its base64 is decoded; up to four
// screenshots are decoded at a time and the result waits for all of them. The Word export keeps
// JPEG screenshots and logos as JPEG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createEmptyProjectV1, openProjectFile, findingId, imageId, LIMITS } from '../src/app/project.js';
import { exportDocx } from '../src/export-docx/index.js';
import { v4Fixture } from './fixtures/generate-v4.mjs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
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
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * Math.min(height, 4));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const image = (n, bytes, w, h) => ({
  id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: w, height: h,
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), caption: `Screenshot ${n}`, tallMode: 'split',
});
function project(images) {
  const p = createEmptyProjectV1(new Date('2026-11-01T00:00:00Z'));
  p.images = images;
  p.findings = [{ id: findingId(1), title: 'Finding', severity: 'High', affectedAssets: [], evidence: images.map((im) => im.id) }];
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = images.length + 1;
  return p;
}
const open = (p, opts) => { const raw = JSON.stringify(p); return openProjectFile(raw, Buffer.byteLength(raw), opts); };

test('a screenshot that fails its own checks is never decoded, even with 100 errors already listed', async () => {
  for (const [what, spoil] of [
    ['header larger than allowed', () => { const b = png(LIMITS.imageSide + 1, 2); return image(1, b, LIMITS.imageSide + 1, 2); }],
    ['wrong hash', () => { const im = image(1, png(4, 3), 4, 3); im.sha256 = '0'.repeat(64); return im; }],
    ['wrong byte count', () => { const im = image(1, png(4, 3), 4, 3); im.bytes += 1; return im; }],
  ]) {
    const p = project([spoil()]);
    for (let k = 0; k < 120; k++) p[`unknownField${k}`] = k; // fills the 100 kept messages before the images
    const decoded = [];
    const r = await open(p, { decodeImage: async (bytes) => { decoded.push(bytes.length); return { width: 4, height: 3 }; } });
    assert.equal(r.ok, false, what);
    assert.equal(r.errors.length, 100, `${what}: the kept messages stay capped`);
    assert.deepEqual(decoded, [], `${what}: not decoded`);
  }
});

test('an oversized screenshot is refused before its base64 is decoded', async () => {
  const limit = Math.ceil(LIMITS.imageBytes / 3) * 4;
  const big = Buffer.alloc(LIMITS.imageBytes + 3000, 1);
  const p = project([image(1, big, 4, 3)]);
  const seen = [];
  const realFrom = Uint8Array.fromBase64, realAtob = globalThis.atob;
  if (realFrom) Uint8Array.fromBase64 = function (s, ...a) { seen.push(s.length); return realFrom.call(this, s, ...a); };
  globalThis.atob = (s) => { seen.push(s.length); return realAtob(s); };
  try {
    const r = await open(p, { decodeImage: async () => ({ width: 4, height: 3 }) });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /larger than 2 MB/);
  } finally {
    if (realFrom) Uint8Array.fromBase64 = realFrom;
    globalThis.atob = realAtob;
  }
  assert.ok(seen.every((n) => n <= limit), `decoded a string of ${Math.max(...seen)} characters (limit ${limit})`);
});

test('at most four screenshots are decoded at a time, in any order, and opening waits for all', async () => {
  const p = project(Array.from({ length: 9 }, (_, i) => image(i + 1, png(4 + i, 3), 4 + i, 3)));
  for (const failing of [null, 6]) {
    let active = 0, most = 0, started = 0;
    const waiting = [];
    const decodeImage = (bytes) => new Promise((resolve, reject) => {
      const n = ++started; active++; most = Math.max(most, active);
      waiting.push(() => { active--; n === failing ? reject(new Error('bad')) : resolve({ width: 3 + n, height: 3 }); });
    });
    let done = false;
    const result = open(p, { decodeImage }).then((r) => { done = true; return r; });
    // Finish decodes in a scrambled order, one at a time, checking the result is not ready early.
    while (started < 9 || waiting.length) {
      await new Promise((r) => setTimeout(r, 5));
      assert.ok(active <= 4, `${active} decodes at once`);
      if (waiting.length) { assert.equal(done, false, 'opening did not wait for every decode'); waiting.splice(waiting.length > 1 ? 1 : 0, 1)[0](); }
    }
    const r = await result;
    assert.equal(most, 4, 'four at a time');
    if (failing) { assert.equal(r.ok, false); assert.match(r.errors.join('\n'), /images\[5\]: image data cannot be decoded/); }
    else assert.ok(r.ok, r.errors?.join('\n'));
  }
});

test('the Word export keeps JPEG screenshots and logos as JPEG', async () => {
  const p = await v4Fixture();
  const zip = await JSZip.loadAsync(await exportDocx(p, { paperSize: 'A4' }));
  const types = await zip.file('[Content_Types].xml').async('string');
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir);
  let jpegs = 0;
  for (const n of media) {
    const b = await zip.file(n).async('uint8array');
    const kind = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : 'other';
    const ext = n.split('.').pop().toLowerCase();
    assert.ok(kind === 'jpeg' ? ['jpg', 'jpeg'].includes(ext) : ext === kind, `${n} holds a ${kind}`);
    const entry = [...types.matchAll(/<Default\b[^>]*>/g)].map((m) => m[0]).find((d) => d.includes(`Extension="${ext}"`));
    const declared = /ContentType="([^"]+)"/.exec(entry ?? '')?.[1];
    assert.equal(declared, kind === 'jpeg' ? 'image/jpeg' : 'image/png', `${n} content type`);
    if (kind === 'jpeg') jpegs++;
  }
  // Every distinct JPEG (screenshots and the customer logo) is stored once, as JPEG.
  const distinct = new Set(p.images.filter((im) => im.mime === 'image/jpeg').map((im) => im.sha256)).size;
  assert.ok(distinct >= 3 && p.images.some((im) => im.mime === 'image/jpeg' && im.id === p.project.branding.clientLogo.imageId), 'fixture has JPEG screenshots and a JPEG logo');
  assert.equal(jpegs, distinct, 'JPEG pictures in the file');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  for (const [, target] of rels.matchAll(/Target="(media\/[^"]+)"/g)) assert.ok(zip.file(`word/${target}`), target);
});

test('the recovery-draft check skips decoding only screenshots this session decoded, by verified content', async () => {
  const a = png(4, 3), b = png(5, 3);
  const p = project([image(1, a, 4, 3), image(2, b, 5, 3)]);
  const seen = [];
  // Reads the size from the PNG header, like a real decode would report it.
  const decodeImage = async (bytes) => { seen.push(bytes.length); const v = new DataView(bytes.buffer, bytes.byteOffset); return { width: v.getUint32(16), height: v.getUint32(20) }; };
  const decodedImages = new Map();
  assert.ok((await open(p, { decodeImage, decodedImages })).ok);
  assert.equal(seen.length, 2, 'first check decodes both');
  assert.equal(decodedImages.size, 2);
  seen.length = 0;
  assert.ok((await open(p, { decodeImage, decodedImages })).ok);
  assert.equal(seen.length, 0, 'unchanged screenshots are not decoded again');
  // A replaced screenshot (other bytes) is decoded.
  const c = png(6, 3);
  p.images[1] = image(2, c, 6, 3);
  assert.ok((await open(p, { decodeImage, decodedImages })).ok);
  assert.deepEqual(seen, [c.length]);
  // A file claiming a remembered hash for other bytes fails the hash check before any decode.
  const forged = project([image(1, a, 4, 3)]);
  forged.images[0] = { ...image(1, png(4, 3).subarray(0), 4, 3), sha256: createHash('sha256').update(b).digest('hex') };
  seen.length = 0;
  assert.equal((await open(forged, { decodeImage, decodedImages })).ok, false);
  assert.equal(seen.length, 0);
  // Without the map (opening a file or a draft), every screenshot is decoded.
  seen.length = 0;
  assert.ok((await open(project([image(1, a, 4, 3)]), { decodeImage })).ok);
  assert.equal(seen.length, 1);
});
