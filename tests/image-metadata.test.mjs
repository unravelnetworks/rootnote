// Hidden metadata in screenshots (EXIF and GPS, XMP, IPTC,
// comments, PNG text chunks, data appended after the image) must not reach the project
// file or the Word report. Pixels and colour information stay byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { stripImageMetadata, imageOrientation } from '../src/app/image-metadata.js';
import { sniffImage, bytesToBase64, openProjectFile } from '../src/app/project.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportDocx } from '../src/export-docx/index.js';
import { v4Fixture } from './fixtures/generate-v4.mjs';

const require = createRequire(import.meta.url);
const { launch, installed } = require('./harness/driver.cjs');
const SECRET = 'SYNTHETIC-SECRET-51.5007N-0.1246W';
const has = (bytes, s = SECRET) => Buffer.from(bytes).includes(Buffer.from(s));

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
};
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngParts() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(5, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  return { ihdr: chunk('IHDR', ihdr), idat: chunk('IDAT', deflateSync(Buffer.alloc((5 * 3 + 1) * 4))), iend: chunk('IEND', Buffer.alloc(0)),
    gama: chunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])), phys: chunk('pHYs', Buffer.from([0, 0, 0x0e, 0xc3, 0, 0, 0x0e, 0xc3, 1])) };
}
/** Inserts PNG metadata chunks after IHDR. */
function pngWithMetadata(png) {
  const ihdrEnd = 8 + 12 + 13;
  const meta = Buffer.concat([chunk('tEXt', Buffer.from(`Author\0${SECRET}`)), chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(Buffer.from(SECRET))])),
    chunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`)), chunk('eXIf', Buffer.from(`MM\0*${SECRET}`)), chunk('tIME', Buffer.from([7, 234, 11, 4, 9, 30, 0])),
    chunk('prVt', Buffer.from(SECRET))]);
  return Buffer.concat([png.subarray(0, ihdrEnd), meta, png.subarray(ihdrEnd)]);
}
const seg = (marker, data) => { const len = Buffer.alloc(2); len.writeUInt16BE(data.length + 2); return Buffer.concat([Buffer.from([0xff, marker]), len, data]); };
/** Inserts JPEG metadata segments after SOI and appends data after EOI. */
function jpegWithMetadata(jpeg) {
  const meta = Buffer.concat([
    seg(0xe1, Buffer.from(`Exif\0\0MM\0*GPS ${SECRET}`)), seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRET}</x:xmpmeta>`)),
    seg(0xe2, Buffer.from(`MPF\0${SECRET}`)), seg(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`)), seg(0xe5, Buffer.from(SECRET)), seg(0xfe, Buffer.from(SECRET))]);
  return Buffer.concat([jpeg.subarray(0, 2), meta, jpeg.subarray(2), Buffer.from(`appended ${SECRET}`)]);
}
/** A structurally valid JPEG: SOI, JFIF, ICC profile, Adobe, DQT, SOF0, DHT, SOS, scan data, EOI. */
function syntheticJpeg() {
  const sof = Buffer.from([8, 0, 4, 0, 5, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), Buffer.from('colour profile bytes')])), seg(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1')),
    seg(0xdb, Buffer.alloc(65)), seg(0xc0, sof), seg(0xc4, Buffer.alloc(29)), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]), Buffer.from([0xff, 0xd9])]);
}

test('PNG: text, EXIF, time and unknown chunks are removed; image and colour chunks stay byte for byte', () => {
  const p = pngParts();
  const clean = Buffer.concat([PNG_SIG, p.ihdr, p.gama, p.phys, p.idat, p.iend]);
  const dirty = pngWithMetadata(clean);
  assert.ok(has(dirty) && sniffImage(new Uint8Array(dirty)), 'the dirty file is a valid PNG with the marker');
  const out = stripImageMetadata(new Uint8Array(dirty), 'image/png');
  assert.equal(has(out), false);
  assert.deepEqual(Buffer.from(out), clean);
  assert.equal(stripImageMetadata(new Uint8Array(clean), 'image/png').byteLength, clean.length);
});

test('JPEG: EXIF/GPS, XMP, multi-picture, IPTC, other APPn, comments and appended data are removed; JFIF, ICC, Adobe and the image stay', () => {
  const clean = syntheticJpeg();
  const dirty = jpegWithMetadata(clean);
  assert.ok(has(dirty) && sniffImage(new Uint8Array(dirty)), 'the dirty file is a valid JPEG structure with the marker');
  const out = stripImageMetadata(new Uint8Array(dirty), 'image/jpeg');
  assert.equal(has(out), false);
  assert.equal(has(out, 'appended'), false);
  assert.deepEqual(Buffer.from(out), clean);
  assert.deepEqual(sniffImage(out), sniffImage(new Uint8Array(clean)));
});

test('JPEG: metadata between the scans of a progressive image and a whole JPEG appended after the end go too', () => {
  const clean = syntheticJpeg();
  const eoi = clean.length - 2;
  // A second scan, as in a progressive JPEG, with comment and EXIF segments before it.
  const secondScan = Buffer.concat([seg(0xc4, Buffer.alloc(29)), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0x10])), Buffer.from([0x9a, 0xff, 0x00, 0xbc, 0xff, 0xd1, 0xde])]);
  const progressive = Buffer.concat([clean.subarray(0, eoi), secondScan, clean.subarray(eoi)]);
  const between = Buffer.concat([clean.subarray(0, eoi), seg(0xfe, Buffer.from(SECRET)), seg(0xe1, Buffer.from(`Exif\0\0${SECRET}`)), secondScan, clean.subarray(eoi)]);
  assert.ok(sniffImage(new Uint8Array(between)));
  const out = stripImageMetadata(new Uint8Array(between), 'image/jpeg');
  assert.equal(has(out), false, 'segments between scans removed');
  assert.deepEqual(Buffer.from(out), progressive, 'both scans and their tables kept byte for byte');
  // An appended JPEG carrying EXIF ends with its own end marker; the first image's end is the real one.
  const appended = Buffer.concat([clean, jpegWithMetadata(syntheticJpeg()).subarray(0, -Buffer.byteLength(`appended ${SECRET}`))]);
  assert.ok(has(appended) && sniffImage(new Uint8Array(appended)));
  const out2 = stripImageMetadata(new Uint8Array(appended), 'image/jpeg');
  assert.equal(has(out2), false, 'appended JPEG removed');
  assert.deepEqual(Buffer.from(out2), clean);
  assert.equal(stripImageMetadata(new Uint8Array(progressive), 'image/jpeg').length, progressive.length, 'a clean progressive image is untouched');
});

test('a file without metadata is returned as is; a file it cannot fully walk gives null, so it is refused', () => {
  const p = pngParts();
  const clean = new Uint8Array(Buffer.concat([PNG_SIG, p.ihdr, p.idat, p.iend]));
  assert.equal(stripImageMetadata(clean, 'image/png'), clean);
  const jpeg = new Uint8Array(syntheticJpeg());
  assert.equal(stripImageMetadata(jpeg, 'image/jpeg'), jpeg);
  assert.equal(stripImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg'), null);
  // One stray byte between segments after the scan: decoders skip it, so it must not let
  // what follows through unchecked.
  const j = syntheticJpeg();
  const eoi = j.length - 2;
  const afterTable = Buffer.concat([j.subarray(0, eoi), seg(0xc4, Buffer.alloc(29)), Buffer.from([0x00]), seg(0xfe, Buffer.from(SECRET)), j.subarray(eoi)]);
  assert.equal(stripImageMetadata(new Uint8Array(afterTable), 'image/jpeg'), null, 'stray byte after a segment: refused');
  // Right after image data a stray byte is image data as far as any parser can tell; the
  // comment after it is still found and removed.
  const afterScan = Buffer.concat([j.subarray(0, eoi), Buffer.from([0x00]), seg(0xfe, Buffer.from(SECRET)), j.subarray(eoi)]);
  assert.equal(has(stripImageMetadata(new Uint8Array(afterScan), 'image/jpeg')), false, 'stray byte after the scan: comment still removed');
});

test('JPEG headers: only a standard JFIF or Adobe header is kept, rebuilt without thumbnail; unknown APP0 and JFXX go', () => {
  const j = syntheticJpeg();
  const variants = [
    seg(0xe0, Buffer.from(SECRET)),
    seg(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10', 'latin1'), Buffer.from(SECRET)])),
    seg(0xe0, Buffer.concat([Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from(SECRET)])),
    seg(0xee, Buffer.concat([Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1'), Buffer.from(SECRET)])),
  ];
  for (const v of variants) {
    const dirty = Buffer.concat([j.subarray(0, 2), v, j.subarray(2)]);
    const out = stripImageMetadata(new Uint8Array(dirty), 'image/jpeg');
    assert.ok(out, v.subarray(4, 8).toString('latin1'));
    assert.equal(has(out), false, v.subarray(4, 8).toString('latin1'));
  }
  // A JFIF header with a 1x1 thumbnail replaces the original one: the thumbnail goes, version and density stay.
  const thumb = Buffer.concat([Buffer.from('JFIF\0\x01\x02\x01\0\x48\0\x48\x01\x01', 'latin1'), Buffer.from('abc')]);
  const withThumb = Buffer.concat([j.subarray(0, 2), seg(0xe0, thumb), j.subarray(20)]);
  const out = Buffer.from(stripImageMetadata(new Uint8Array(withThumb), 'image/jpeg'));
  assert.deepEqual([...out.subarray(2, 20)], [0xff, 0xe0, 0, 16, ...Buffer.from('JFIF\0\x01\x02\x01\0\x48\0\x48\0\0', 'latin1')]);
});

// IFD0 with the orientation and an ImageDescription pointing at the secret.
function exifWith(orientation, le = false) {
  const t = Buffer.alloc(38 + SECRET.length + 1);
  const u16 = (v, at) => (le ? t.writeUInt16LE(v, at) : t.writeUInt16BE(v, at));
  const u32 = (v, at) => (le ? t.writeUInt32LE(v, at) : t.writeUInt32BE(v, at));
  t.write(le ? 'II' : 'MM', 0, 'latin1'); u16(42, 2); u32(8, 4); u16(2, 8);
  u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(orientation, 18);
  u16(0x010e, 22); u16(2, 24); u32(SECRET.length + 1, 26); u32(38, 30);
  t.write(SECRET, 38, 'latin1');
  return t;
}

test('orientation is kept as a tag holding only that value; everything else in EXIF goes', () => {
  const j = syntheticJpeg();
  for (const le of [false, true]) {
    const dirty = Buffer.concat([j.subarray(0, 2), seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifWith(3, le)])), j.subarray(2)]);
    assert.equal(imageOrientation(new Uint8Array(dirty), 'image/jpeg'), 3);
    const out = stripImageMetadata(new Uint8Array(dirty), 'image/jpeg');
    assert.equal(has(out), false);
    assert.equal(imageOrientation(out, 'image/jpeg'), 3, 'the orientation survives');
    assert.ok(out.length <= j.length + 36, 'the new EXIF block is minimal');
  }
  const upright = Buffer.concat([j.subarray(0, 2), seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifWith(1)])), j.subarray(2)]);
  assert.deepEqual(Buffer.from(stripImageMetadata(new Uint8Array(upright), 'image/jpeg')), j, 'orientation 1 needs no tag');
  const p = pngParts();
  const png = Buffer.concat([PNG_SIG, p.ihdr, chunk('eXIf', exifWith(4)), p.idat, p.iend]);
  const pout = stripImageMetadata(new Uint8Array(png), 'image/png');
  assert.equal(has(pout), false);
  assert.equal(imageOrientation(pout, 'image/png'), 4);
  assert.ok(sniffImage(pout));
});

test('PNG: a colour profile keeps its data but gets a fixed name', () => {
  const p = pngParts();
  const profile = deflateSync(Buffer.from('synthetic profile bytes'));
  const name = SECRET.slice(0, 40);
  const png = Buffer.concat([PNG_SIG, p.ihdr, chunk('iCCP', Buffer.concat([Buffer.from(`${name}\0\0`, 'latin1'), profile])), p.idat, p.iend]);
  const out = Buffer.from(stripImageMetadata(new Uint8Array(png), 'image/png'));
  assert.equal(has(out, name), false);
  assert.ok(out.includes(Buffer.concat([Buffer.from('iCCPICC Profile\0\0', 'latin1'), profile])));
  const at = out.indexOf(Buffer.from('iCCP')) - 4;
  const len = out.readUInt32BE(at);
  assert.equal(out.readUInt32BE(at + 8 + len), crc32(out.subarray(at + 4, at + 8 + len)), 'CRC recomputed');
});

test('opening a project cleans every screenshot it holds, so re-saved files and printed PDFs are clean', async () => {
  const d = JSON.parse(readFileSync(new URL('../release-template/sample-project.rootnote.json', import.meta.url), 'utf8'));
  const im = d.images.find((x) => x.mime === 'image/png');
  const dirty = pngWithMetadata(Buffer.from(im.dataUrl.split(',')[1], 'base64'));
  Object.assign(im, { dataUrl: `data:image/png;base64,${dirty.toString('base64')}`, bytes: dirty.length, sha256: createHash('sha256').update(dirty).digest('hex') });
  const raw = JSON.stringify(d);
  const decodeImage = async (bytes) => { const s = sniffImage(bytes); if (!s) throw new Error('x'); return s; };
  const r = await openProjectFile(raw, Buffer.byteLength(raw), { decodeImage });
  assert.ok(r.ok, r.errors?.join('\n'));
  assert.equal(r.cleanedImages, 1);
  const stored = r.project.images.find((x) => x.id === im.id);
  const bytes = Buffer.from(stored.dataUrl.split(',')[1], 'base64');
  assert.equal(has(bytes), false);
  assert.deepEqual([stored.bytes, stored.sha256], [bytes.length, createHash('sha256').update(bytes).digest('hex')]);
  const saved = JSON.stringify(r.project);
  const again = await openProjectFile(saved, Buffer.byteLength(saved), { decodeImage });
  assert.deepEqual([again.ok, again.cleanedImages], [true, 0], 'a cleaned project reopens unchanged');
});

test('the Word export never carries screenshot metadata, even from a project saved before this fix', async () => {
  const p = await v4Fixture();
  const png = p.images.find((im) => im.mime === 'image/png');
  const jpg = p.images.find((im) => im.mime === 'image/jpeg');
  for (const [im, add] of [[png, pngWithMetadata], [jpg, jpegWithMetadata]]) {
    const bytes = add(Buffer.from(im.dataUrl.split(',')[1], 'base64'));
    assert.ok(sniffImage(new Uint8Array(bytes)), `${im.id} stays a valid image`);
    im.dataUrl = `data:${im.mime};base64,${bytesToBase64(new Uint8Array(bytes))}`;
    im.bytes = bytes.length;
  }
  const zip = await JSZip.loadAsync(await exportDocx(p, { paperSize: 'A4' }));
  const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir);
  assert.ok(media.length >= 2, 'images are embedded');
  for (const n of media) assert.equal(has(await zip.file(n).async('uint8array')), false, n);
});

for (const [engine, port] of [['chrome', 9586], ['firefox', 9686]]) test(`screenshots lose their metadata on import and still decode in ${engine}`, { skip: !installed(engine) && `${engine} not installed`, timeout: 120000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/editor/images.js', import.meta.url))], bundle: true, format: 'iife', globalName: 'I', write: false });
  const b = await launch(engine, port);
  try {
    // A file page is a secure context (the hash needs crypto.subtle), like the real app.
    await b.navigate(pathToFileURL(fileURLToPath(new URL('../dist/rootnote.html', import.meta.url))).href);
    await b.evaluate(`${bundle.outputFiles[0].text};0`);
    // Real images from the browser's own encoder, then the same metadata as above.
    const made = JSON.parse(await b.evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 30;
      const g = c.getContext('2d'); g.fillStyle = '#1e6091'; g.fillRect(0, 0, 40, 30); g.fillStyle = '#fff'; g.fillRect(5, 5, 10, 10);
      const enc = (type) => new Promise((r) => c.toBlob(async (bl) => r([...new Uint8Array(await bl.arrayBuffer())]), type, 0.9));
      return JSON.stringify({ png: await enc('image/png'), jpeg: await enc('image/jpeg') });
    })()`));
    for (const [kind, add] of [['png', pngWithMetadata], ['jpeg', jpegWithMetadata]]) {
      const dirty = add(Buffer.from(made[kind]));
      const rec = JSON.parse(await b.evaluate(`I.importImageBytes(new Uint8Array(${JSON.stringify([...dirty])}), { name: 'shot.${kind}' }).then((r) => JSON.stringify(r), (e) => JSON.stringify({ error: e.message }))`));
      assert.equal(rec.error, undefined, rec.error);
      const stored = Buffer.from(rec.dataUrl.split(',')[1], 'base64');
      assert.equal(has(stored), false, `${kind}: no metadata in the stored image`);
      assert.deepEqual([rec.width, rec.height, rec.bytes], [40, 30, stored.length]);
      assert.ok(stored.length < dirty.length);
    }
    // what the browser shows must not change. An 8x4 JPEG, red left and blue right,
    // with EXIF orientation 3 (turned 180°) shows blue at top left; so must the stored copy.
    const halves = JSON.parse(await b.evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 4;
      const g = c.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 4, 4); g.fillStyle = '#00f'; g.fillRect(4, 0, 4, 4);
      return JSON.stringify(await new Promise((r) => c.toBlob(async (bl) => r([...new Uint8Array(await bl.arrayBuffer())]), 'image/jpeg', 0.95)));
    })()`));
    const exif = (o) => seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifWith(o)]));
    const rotated = (o) => { const j = Buffer.from(halves); return Buffer.concat([j.subarray(0, 2), exif(o), j.subarray(2)]); };
    const topLeft = (expr) => b.evaluate(`(async () => { const bytes = ${expr}; const bm = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
      const [r, , bl] = g.getImageData(1, 1, 1, 1).data; return r > bl ? 'red' : 'blue'; })()`);
    for (const o of [2, 3, 4]) {
      const dirty = rotated(o);
      const shown = await topLeft(`new Uint8Array(${JSON.stringify([...dirty])})`);
      const rec = JSON.parse(await b.evaluate(`I.importImageBytes(new Uint8Array(${JSON.stringify([...dirty])}), { name: 'photo.jpg' }).then((r) => JSON.stringify(r), (e) => JSON.stringify({ error: e.message }))`));
      assert.equal(rec.error, undefined, rec.error);
      const stored = Buffer.from(rec.dataUrl.split(',')[1], 'base64');
      assert.equal(has(stored), false, `orientation ${o}: no other EXIF data`);
      assert.equal(await topLeft(`new Uint8Array(${JSON.stringify([...stored])})`), shown, `orientation ${o}: looks the same after import`);
    }
    assert.equal(await topLeft(`new Uint8Array(${JSON.stringify([...rotated(3)])})`), 'blue', 'the test image really is turned');
    // A quarter turn (5–8) is refused with a reason, not stored turned back.
    const quarter = JSON.parse(await b.evaluate(`I.importImageBytes(new Uint8Array(${JSON.stringify([...rotated(6)])}), { name: 'photo.jpg' }).then(() => '{}', (e) => JSON.stringify({ error: e.message }))`));
    assert.match(quarter.error ?? '', /quarter turn/);
    // A file the stripper cannot fully walk is refused.
    const j = Buffer.from(halves);
    const strayFile = Buffer.concat([j.subarray(0, j.length - 2), seg(0xc4, Buffer.alloc(29)), Buffer.from([0x00]), seg(0xfe, Buffer.from(SECRET)), j.subarray(j.length - 2)]);
    const stray = JSON.parse(await b.evaluate(`I.importImageBytes(new Uint8Array(${JSON.stringify([...strayFile])}), { name: 'odd.jpg' }).then(() => '{}', (e) => JSON.stringify({ error: e.message }))`));
    assert.ok(stray.error, 'refused');
    assert.deepEqual(b.errors, []);
    assert.deepEqual(b.requests, []);
  } finally {
    await b.close();
  }
});
