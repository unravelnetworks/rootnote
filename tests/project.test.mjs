// Import validation rules from schema/project.schema.json (numbered $comment rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  createEmptyProjectV1, validateProjectFile, sanitizeText, sanitizeLine, sniffImage,
  findingId, imageId, LIMITS,
} from '../src/app/project.js';

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
  const raw = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function image(n, bytes, w, h) {
  return {
    id: imageId(n), mime: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    width: w, height: h, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    caption: `Screenshot ${n}`, tallMode: 'split',
  };
}

function sample() {
  const p = createEmptyProjectV1(new Date('2026-11-01T00:00:00Z'));
  p.project.title = 'Synthetic test — ünïcödé 𝔘';
  const a = png(4, 3), b = png(2, 9);
  p.images = [image(1, a, 4, 3), image(2, b, 2, 9)];
  p.findings = [{ id: findingId(1), title: 'Reflected XSS <script>&"', severity: 'High', affectedAssets: ['https://example.test/?q=' + 'A'.repeat(200)], evidence: ['IMG-0001', 'IMG-0002'] }];
  p.project.nextFindingNumber = 2;
  p.project.nextImageNumber = 3;
  return p;
}

const check = (obj) => {
  const raw = JSON.stringify(obj);
  return validateProjectFile(raw, Buffer.byteLength(raw));
};

test('valid project passes and keeps Unicode', async () => {
  const r = await check(sample());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.project.project.title, 'Synthetic test — ünïcödé 𝔘');
});

test('empty project passes', async () => {
  assert.equal((await check(createEmptyProjectV1())).ok, true);
});

test('sniffs PNG size', () => {
  assert.deepEqual(sniffImage(png(7, 5)), { mime: 'image/png', width: 7, height: 5 });
  assert.equal(sniffImage(Buffer.from('GIF89a....')), null);
});

const rejects = async (name, mutate, pattern) => {
  test(`rejects: ${name}`, async () => {
    const p = sample();
    mutate(p);
    const r = await check(p);
    assert.equal(r.ok, false);
    if (pattern) assert.match(r.errors.join('\n'), pattern);
  });
};

rejects('newer schema', (p) => { p.schemaVersion = 9; }, /newer version/);
rejects('wrong format marker', (p) => { p.format = 'x'; }, /Not a project file/);
rejects('unknown field', (p) => { p.findings[0].html = '<b>'; }, /unknown field/);
rejects('id 000', (p) => { p.findings[0].id = 'F-000'; }, /F-001/);
rejects('duplicate finding id', (p) => { p.findings.push({ ...p.findings[0], evidence: [] }); }, /duplicate F-001/);
rejects('counter not above highest id', (p) => { p.project.nextFindingNumber = 1; }, /highest finding id/);
rejects('image counter not above highest id', (p) => { p.project.nextImageNumber = 2; }, /highest image id/);
rejects('dangling evidence reference', (p) => { p.findings[0].evidence.push('IMG-0009'); p.project.nextImageNumber = 10; }, /not present/);
rejects('unreferenced image', (p) => { p.findings[0].evidence.pop(); }, /not used/);
rejects('image used twice', (p) => { p.project.logoImageId = 'IMG-0001'; }, /more than once/);
rejects('sha mismatch', (p) => { p.images[0].sha256 = '0'.repeat(64); }, /sha256/);
rejects('dimension mismatch', (p) => { p.images[0].width = 5; }, /width\/height/);
rejects('bytes mismatch', (p) => { p.images[0].bytes += 1; }, /bytes/);
rejects('mime mismatch', (p) => { p.images[0].mime = 'image/jpeg'; }, /type does not match|not a valid/);
rejects('not an image', (p) => { p.images[0].dataUrl = 'data:image/png;base64,' + Buffer.from('hello world!').toString('base64'); }, /not a valid/);
rejects('control character', (p) => { p.findings[0].description = 'a\u0007b'; }, /cannot be written to Word/);
rejects('unpaired surrogate', (p) => { p.project.scope = 'x\uD800y'; }, /cannot be written to Word/);
rejects('U+FFFF', (p) => { p.project.scope = '￿'; }, /cannot be written to Word/);
rejects('newline in a line field', (p) => { p.findings[0].title = 'a\nb'; }, /single line/);
rejects('bad severity', (p) => { p.findings[0].severity = 'Severe'; }, /severity/);
rejects('more than 30 evidence references', (p) => {
  p.findings = Array.from({ length: 2 }, (_, i) => ({ id: findingId(i + 1), title: 't', severity: null, evidence: [] }));
  const bytes = png(1, 1);
  p.images = Array.from({ length: 31 }, (_, i) => image(i + 1, bytes, 1, 1));
  p.images.forEach((im, i) => p.findings[i % 2].evidence.push(im.id));
  p.project.nextImageNumber = 32; p.project.nextFindingNumber = 3;
}, /31 screenshot references/);

test('rejects oversized file before parsing', async () => {
  const r = await validateProjectFile('{', LIMITS.fileBytes + 1);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /256 MB/);
});

test('rejects invalid JSON', async () => {
  const r = await validateProjectFile('{"format":', 10);
  assert.equal(r.ok, false);
});

test('sanitizers remove XML-invalid characters and keep valid Unicode', () => {
  assert.equal(sanitizeText('a\u0000b\tc\n\uD800d😀'), 'ab\tc\nd😀');
  assert.equal(sanitizeLine('a\r\nb'), 'a b');
});

// structural checks, decode hook, deep nesting.
const truncatedPng = () => {
  const b = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(b);
  b.writeUInt32BE(1, 16); b.writeUInt32BE(1, 20);
  return b;
};
const replaceImage = (p, bytes, w, h) => {
  Object.assign(p.images[0], image(1, bytes, w, h));
};

rejects('24-byte PNG header with no pixel data', (p) => replaceImage(p, truncatedPng(), 1, 1), /not a valid/);
rejects('PNG without IEND', (p) => { const b = png(4, 3); replaceImage(p, b.subarray(0, b.length - 12), 4, 3); }, /not a valid/);
rejects('PNG with trailing bytes', (p) => replaceImage(p, Buffer.concat([png(4, 3), Buffer.from('junk')]), 4, 3), /not a valid/);
rejects('PNG with chunk length past end of file', (p) => { const b = Buffer.from(png(4, 3)); b.writeUInt32BE(0x7fffffff, 33); replaceImage(p, b, 4, 3); }, /not a valid/);

const jpeg = (eoi = true) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x04, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x12, 0x34,
  ...(eoi ? [0xff, 0xd9] : []),
]);

test('JPEG structure: frame size read, EOI required', () => {
  assert.deepEqual(sniffImage(jpeg()), { mime: 'image/jpeg', width: 4, height: 3 });
  assert.equal(sniffImage(jpeg(false)), null);
});

test('decodeImage hook: failure and size mismatch are rejected', async () => {
  const raw = JSON.stringify(sample());
  const bytes = Buffer.byteLength(raw);
  const fail = await validateProjectFile(raw, bytes, { decodeImage: async () => { throw new Error('bad'); } });
  assert.equal(fail.ok, false);
  assert.match(fail.errors.join('\n'), /cannot be decoded/);
  const mismatch = await validateProjectFile(raw, bytes, { decodeImage: async () => ({ width: 1, height: 1 }) });
  assert.match(mismatch.errors.join('\n'), /decoded size/);
  const good = await validateProjectFile(raw, bytes, { decodeImage: async (b) => sniffImage(b) });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test('deeply nested unknown field is rejected without a stack overflow', async () => {
  const p = sample();
  const depth = 100000;
  const raw = JSON.stringify(p).replace('"evidence":', `"deep":${'['.repeat(depth)}${']'.repeat(depth)},"evidence":`);
  const r = await validateProjectFile(raw, Buffer.byteLength(raw));
  assert.equal(r.ok, false);
});

test('decode hook is not called when cheaper checks already failed', async () => {
  const huge = Buffer.from(png(4, 3));
  huge.writeUInt32BE(50000, 16); huge.writeUInt32BE(50000, 20);
  const cases = [
    (p) => Object.assign(p.images[0], image(1, huge, 4, 3)),
    (p) => Object.assign(p.images[0], image(1, huge, 50000, 50000)),
    (p) => { p.images[0].sha256 = '0'.repeat(64); },
    (p) => { p.images[0].bytes += 1; },
    (p) => { p.images[0].width = 5; },
  ];
  for (const mutate of cases) {
    const p = sample();
    mutate(p);
    const raw = JSON.stringify(p);
    const calls = [];
    const r = await validateProjectFile(raw, Buffer.byteLength(raw), { decodeImage: async (b) => { calls.push(b.length); return sniffImage(b); } });
    assert.equal(r.ok, false);
    assert.equal(calls.length, 1, 'only the untouched second image may be decoded');
  }
});
