// The recovery-draft check (openProjectData with useProofs) skips a screenshot only if this
// session checked exactly that data URL completely before, with the same type, size,
// dimensions and SHA-256. A changed attribute, other data, or a screenshot that needed its
// metadata removed is checked in full; opening a file never uses the records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openProjectFile, openProjectData, sniffImage } from '../src/app/project.js';

const raw = readFileSync(new URL('../release-template/sample-project.rootnote.json', import.meta.url), 'utf8');
const fresh = () => JSON.parse(raw);
const bytesOf = (im) => Buffer.from(im.dataUrl.slice(im.dataUrl.indexOf(',') + 1), 'base64');
// Decodes by reading the header (the browser decoder is not available in Node); counts calls.
const decoder = () => {
  const d = { calls: 0, decode: async (bytes) => { d.calls++; const s = sniffImage(bytes); return { width: s.width, height: s.height }; } };
  return d;
};
const check = (data, proofs, d) => openProjectData(data, Buffer.byteLength(raw), { appVersion: 't', decodeImage: d.decode, proofs, useProofs: true });

test('a second draft check skips screenshots already checked, with the same data and attributes', async () => {
  const proofs = new Map();
  const first = decoder();
  assert.ok((await check(fresh(), proofs, first)).ok);
  const n = fresh().images.length;
  assert.equal(first.calls, n, 'every screenshot decoded once');
  assert.equal(proofs.size, n, 'each recorded');
  const second = decoder();
  assert.ok((await check(fresh(), proofs, second)).ok);
  assert.equal(second.calls, 0, 'nothing decoded again');
});

test('a changed attribute or other data on a recorded screenshot is checked in full', async () => {
  const proofs = new Map();
  assert.ok((await check(fresh(), proofs, decoder())).ok);
  const wrongSize = fresh(); wrongSize.images[3].width += 1;
  assert.match((await check(wrongSize, proofs, decoder())).errors.join(' '), /images\[3\]: width\/height do not match/);
  const wrongHash = fresh(); wrongHash.images[3].sha256 = 'a'.repeat(64);
  assert.match((await check(wrongHash, proofs, decoder())).errors.join(' '), /images\[3\]\.sha256: does not match/);
  const wrongBytes = fresh(); wrongBytes.images[3].bytes += 1;
  assert.match((await check(wrongBytes, proofs, decoder())).errors.join(' '), /images\[3\]\.bytes: does not match/);
  const otherData = fresh(); otherData.images[3].dataUrl = otherData.images[3].dataUrl.slice(0, -8) + 'AAAAAAAA';
  assert.equal((await check(otherData, proofs, decoder())).ok, false, 'different data is not trusted');
  const mime = fresh(); mime.images[3].mime = mime.images[3].mime === 'image/png' ? 'image/jpeg' : 'image/png';
  assert.equal((await check(mime, proofs, decoder())).ok, false);
});

test('opening a file never uses the records', async () => {
  const proofs = new Map();
  assert.ok((await check(fresh(), proofs, decoder())).ok);
  const d = decoder();
  assert.ok((await openProjectFile(raw, Buffer.byteLength(raw), { appVersion: 't', decodeImage: d.decode, proofs })).ok);
  assert.equal(d.calls, fresh().images.length, 'every screenshot decoded');
});

test('a screenshot that needed its metadata removed is not recorded', async () => {
  const p = fresh();
  const im = p.images.find((x) => x.mime === 'image/png' && x.id !== 'IMG-0001');
  const png = bytesOf(im);
  const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const td = Buffer.concat([Buffer.from('tEXt'), Buffer.from('Author\0someone')]);
  const len = Buffer.alloc(4); len.writeUInt32BE(td.length - 4);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  const withMeta = Buffer.concat([png.subarray(0, 33), len, td, crc, png.subarray(33)]);
  const original = `data:image/png;base64,${withMeta.toString('base64')}`;
  Object.assign(im, { dataUrl: original, bytes: withMeta.length, sha256: createHash('sha256').update(withMeta).digest('hex') });
  const proofs = new Map();
  const r = await openProjectData(p, Buffer.byteLength(JSON.stringify(p)), { appVersion: 't', decodeImage: decoder().decode, proofs, useProofs: true });
  assert.ok(r.ok && r.cleanedImages === 1, (r.errors || []).join(' '));
  assert.equal(proofs.has(im.id), false, 'neither the data with metadata nor the cleaned copy, which was not checked');
  assert.equal(proofs.size, p.images.length - 1);
});
