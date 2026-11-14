// The parts serializer (src/app/serialize.js) gives exactly the bytes of JSON.stringify for
// the shipped projects and for text JSON escapes, and falls back (null) for any other shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectParts, partsToBlob } from '../src/app/serialize.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../release-template/${p}`, import.meta.url), 'utf8'));
const same = async (project, label) => {
  const r = projectParts(project);
  assert.ok(r, `${label}: no parts`);
  const want = Buffer.from(JSON.stringify(project), 'utf8');
  assert.equal(r.bytes, want.length, `${label}: byte count`);
  const blob = await partsToBlob(r.parts, { step: 1000 });
  assert.equal(blob.size, want.length, `${label}: blob size`);
  assert.ok(Buffer.from(await blob.arrayBuffer()).equals(want), `${label}: bytes differ`);
  return r;
};

test('shipped projects serialize to the same bytes as JSON.stringify', async () => {
  for (const name of ['sample-project.rootnote.json', 'sample-project-cvss40.rootnote.json', 'starters/web-application-test.rootnote.json', 'starters/api-test.rootnote.json']) {
    const r = await same({ ...read(name), appVersion: '0.3.1', savedAt: '2026-11-14T10:00:00.000Z' }, name);
    const images = read(name).images.length;
    if (images) assert.equal(r.parts.filter((p) => p.startsWith('data:image/')).length, images, `${name}: each data URL is its own part`);
  }
});

test('text that JSON escapes, and token-like text, stays exact', async () => {
  const p = read('sample-project.rootnote.json');
  const tricky = 'quote " backslash \\ tab \t CR \r LF \n NUL \u0000 bell \u0007 LS   PS   FFFD � astral 𝄞 lone \ud800 "dataUrl":"" ],"images":[ data:image/png;base64,AAAA';
  p.project.title = tricky;
  p.findings[0].description = tricky;
  p.images[2].caption = tricky;
  p.project.labels.cvss = '"images":[]';
  await same(p, 'tricky text');
});

test('repeated screenshots, no screenshots, and fields JSON skips', async () => {
  const p = read('sample-project.rootnote.json');
  p.images.push({ ...p.images[3], id: 'IMG-0099' }, { ...p.images[3], id: 'IMG-0100' });
  await same(p, 'repeated data URLs');
  await same({ ...p, images: [] }, 'no images');
  await same({ ...p, extra: undefined, images: p.images.map((im, i) => (i === 0 ? { ...im, note: undefined } : im)) }, 'undefined fields skipped');
});

test('a data URL JSON would escape is serialized inline, still exact', async () => {
  const p = read('sample-project.rootnote.json');
  p.images[0] = { ...p.images[0], dataUrl: p.images[0].dataUrl + '"\n' };
  const r = await same(p, 'escaped data URL');
  assert.ok(!r.parts.includes(p.images[0].dataUrl));
});

test('other shapes are not split (caller serializes them whole)', () => {
  assert.equal(projectParts(null), null);
  assert.equal(projectParts({ images: 'x' }), null);
  assert.equal(projectParts({ images: [[]] }), null);
  assert.equal(projectParts({ images: [{ toJSON: () => 1 }] }), null);
  assert.equal(projectParts(Object.assign(Object.create({ inherited: 1 }), { images: [] })), null);
});

test('partsToBlob stops when the work is no longer current', async () => {
  let n = 0;
  const parts = Array.from({ length: 10 }, () => 'x'.repeat(100));
  assert.equal(await partsToBlob(parts, { step: 150, isCurrent: () => ++n < 2 }), null);
  const whole = await partsToBlob(parts, { step: 150 });
  assert.equal(await whole.text(), parts.join(''));
});
