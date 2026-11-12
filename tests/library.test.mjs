// Finding library model (src/app/library.js): file validation, bounds after every change,
// text-only entries, fresh ids on insert, merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyLibrary, openLibraryFile, checkLibrary, serializeLibrary, entryFromFinding, findingFromEntry, mergeLibraries,
  newEntryId, LIBRARY_LIMITS, LIBRARY_VERSION,
} from '../src/app/library.js';
import { createEmptyProject, validateProjectFile, defaultFormats } from '../src/app/project.js';

const finding = () => ({
  id: 'F-007', title: 'IDOR on invoices', rating: 'High', cvss: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N',
  affectedAssets: ['GET /api/invoices/{id}'], description: 'd', impact: 'i', threat: 't', recommendation: '- fix',
  formats: { ...defaultFormats(), recommendation: 'plain' },
  details: [{ id: 'B-1', type: 'text', text: 'Step 1', format: 'plain' }, { id: 'B-2', type: 'image', imageId: 'IMG-0001' }, { id: 'B-3', type: 'text', text: 'GET /x', format: 'code' }],
  evidence: ['IMG-0002'],
});
const open = (lib) => { const raw = serializeLibrary(lib, { appVersion: '0.3.0' }); return openLibraryFile(raw, Buffer.byteLength(raw)); };
const withEntry = () => { const lib = createEmptyLibrary(); lib.entries.push(entryFromFinding(finding()).entry); return lib; };

test('entry from a finding keeps text, drops and counts screenshots, has no block ids', () => {
  const { entry, droppedScreenshots } = entryFromFinding(finding());
  assert.equal(droppedScreenshots, 2);
  assert.deepEqual(entry.details, [{ type: 'text', text: 'Step 1', format: 'plain' }, { type: 'text', text: 'GET /x', format: 'code' }]);
  assert.match(entry.id, /^L-[0-9a-f]{32}$/);
  assert.equal(entry.name, 'IDOR on invoices');
  assert.equal(entry.cvss, finding().cvss);
});

test('a saved library reopens identically', () => {
  const lib = withEntry();
  const r = open(lib);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.library.entries, lib.entries);
});

test('insert: fresh F-number and block ids, valid in a v3 project', async () => {
  const lib = withEntry();
  const f = findingFromEntry(lib.entries[0], 12);
  assert.equal(f.id, 'F-012');
  assert.deepEqual(f.evidence, []);
  assert.equal(f.details.length, 2);
  for (const b of f.details) assert.match(b.id, /^B-[0-9a-f]{32}$/);
  const g = findingFromEntry(lib.entries[0], 13);
  assert.notEqual(f.details[0].id, g.details[0].id);
  const p = createEmptyProject();
  p.findings = [f];
  p.project.nextFindingNumber = 13;
  const raw = JSON.stringify(p);
  const v = await validateProjectFile(raw, Buffer.byteLength(raw));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

const rejects = (name, mutate, pattern) => test(`library rejects: ${name}`, () => {
  const lib = withEntry();
  const data = JSON.parse(serializeLibrary(lib, { appVersion: '0.3.0' }));
  mutate(data);
  const raw = JSON.stringify(data);
  const r = openLibraryFile(raw, Buffer.byteLength(raw));
  assert.equal(r.ok, false, `${name} accepted`);
  assert.match(r.errors.join(' | '), pattern);
});
const e0 = (d) => d.entries[0];
rejects('a project file', (d) => { d.format = 'fieldnote-project'; }, /not a finding library/);
rejects('newer version', (d) => { d.libraryVersion = 5; }, /newer version/);
rejects('unknown file field', (d) => { d.extra = 1; }, /unknown field "extra"/);
rejects('image block', (d) => { e0(d).details.push({ type: 'image', imageId: 'IMG-0001' }); }, /no screenshots/);
rejects('block with an id', (d) => { e0(d).details[0].id = 'B-1'; }, /unknown field "id"/);
rejects('data URL field', (d) => { e0(d).dataUrl = 'data:image/png;base64,AA=='; }, /unknown field "dataUrl"/);
rejects('blank name', (d) => { e0(d).name = '   '; }, /must not be empty/);
rejects('name over 120', (d) => { e0(d).name = 'n'.repeat(121); }, /longer than 120/);
rejects('bad id', (d) => { e0(d).id = 'L-1'; }, /32 hex/);
rejects('duplicate id', (d) => { d.entries.push({ ...e0(d) }); }, /duplicate/);
rejects('non-canonical CVSS order', (d) => { e0(d).cvss = 'CVSS:3.1/AC:L/AV:N/PR:L/UI:N/S:U/C:H/I:H/A:N'; }, /canonical/);
rejects('format key details', (d) => { e0(d).formats.details = 'plain'; }, /unknown field "details"/);
rejects('missing formats', (d) => { delete e0(d).formats; }, /formats: missing/);
rejects('control character', (d) => { e0(d).description = 'a\u0001b'; }, /cannot be written to Word/);
rejects('details text over 20000', (d) => { e0(d).details = [{ type: 'text', text: 'a'.repeat(10001), format: 'plain' }, { type: 'text', text: 'b'.repeat(10000), format: 'plain' }]; }, /total 20001/);
rejects('control character in appVersion', (d) => { d.appVersion = 'v\u0001'; }, /appVersion: invalid/);
rejects('impossible savedAt', (d) => { d.savedAt = '2026-99-99T99:99:99Z'; }, /valid ISO date-time/);
rejects('impossible offset', (d) => { d.savedAt = '2026-11-01T12:00:00+99:99'; }, /valid ISO date-time/);
rejects('February 30', (d) => { d.savedAt = '2026-02-30T10:00:00Z'; }, /valid ISO date-time/);
rejects('501 entries', (d) => { while (d.entries.length < 501) d.entries.push({ ...e0(d), id: newEntryId() }); }, /more than 500/);
rejects('prototype pollution key', (d) => { const raw = JSON.stringify(e0(d)).replace('{', '{"__proto__":{"x":1},'); d.entries[0] = JSON.parse(raw); }, /unknown field "__proto__"/);

test('file over 5 MB is refused before parsing', () => {
  const r = openLibraryFile('{}', LIBRARY_LIMITS.fileBytes + 1);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /5 MB/);
});

test('merge appends new ids, skips existing; the union is checked against the caps', () => {
  const a = withEntry();
  const b = withEntry();
  b.entries.push(a.entries[0]);
  const m = mergeLibraries(a, b);
  assert.equal(m.added, 1);
  assert.equal(m.skipped, 1);
  assert.equal(m.library.entries.length, 2);
  assert.deepEqual(checkLibrary(m.library, '0.3.0'), []);
  // A union over 500 entries is reported by checkLibrary, so the caller keeps the old library.
  const big = createEmptyLibrary();
  for (let i = 0; i < 499; i++) big.entries.push({ ...a.entries[0], id: newEntryId() });
  const over = mergeLibraries(big, b);
  assert.equal(over.library.entries.length, 501);
  assert.match(checkLibrary(over.library, '0.3.0').join(' '), /more than 500/);
  assert.equal(big.entries.length, 499, 'inputs unchanged');
});

test('checkLibrary enforces the written 5 MB size', () => {
  const lib = createEmptyLibrary();
  const e = entryFromFinding({ ...finding(), description: 'x'.repeat(20000), impact: 'y'.repeat(20000), threat: 'z'.repeat(20000), recommendation: 'w'.repeat(20000) }).entry;
  for (let i = 0; i < 70; i++) lib.entries.push({ ...e, id: newEntryId() });
  assert.match(checkLibrary(lib, '0.3.0').join(' '), /limit is 5242880/);
});

test('checkLibrary validates the candidate itself (root fields, format, version)', () => {
  const lib = withEntry();
  assert.deepEqual(checkLibrary(lib, '0.3.0'), []);
  assert.match(checkLibrary({ ...lib, extra: 1 }, '0.3.0').join(' '), /unknown field "extra"/);
  assert.match(checkLibrary({ ...lib, format: 'fieldnote-project' }, '0.3.0').join(' '), /not a finding library/);
  assert.match(checkLibrary({ ...lib, libraryVersion: 99 }, '0.3.0').join(' '), /newer version/);
});

test('a 119-character title ending in an astral character makes a valid default name', () => {
  const title = 'a'.repeat(119) + '\u{1F512}';
  const { entry } = entryFromFinding({ ...finding(), title });
  assert.equal(entry.title, title, 'title kept whole');
  assert.equal(entry.name, 'a'.repeat(119), 'the pair would exceed 120 UTF-16 units, so it is left out whole');
  const lib = createEmptyLibrary();
  lib.entries.push(entry);
  assert.deepEqual(checkLibrary(lib, '0.3.0'), []);
  const long = entryFromFinding({ ...finding(), title: 'b'.repeat(120) + '\u{1F512}' }).entry;
  assert.equal(long.name, 'b'.repeat(120), 'cap does not split the pair');
});

// ---- library v2 ----

test('library: a v1 file opens as the current version with entries untouched; v1 still refuses references', () => {
  const lib = withEntry();
  const v1raw = JSON.stringify({ format: 'fieldnote-library', libraryVersion: 1, savedAt: '2026-11-01T00:00:00.000Z', entries: lib.entries });
  const r = openLibraryFile(v1raw, Buffer.byteLength(v1raw));
  assert.ok(r.ok, r.errors?.join('; '));
  assert.equal(r.openedVersion, 1);
  assert.equal(r.library.libraryVersion, 4);
  assert.deepEqual(r.library.entries, lib.entries);
  assert.ok(!('references' in r.library.entries[0]));
  const withRefs = JSON.stringify({ format: 'fieldnote-library', libraryVersion: 1, entries: [{ ...lib.entries[0], references: [] }] });
  assert.match(openLibraryFile(withRefs, Buffer.byteLength(withRefs)).errors.join(' '), /unknown field "references"/);
  assert.match(serializeLibrary(r.library), /"libraryVersion":4/);
});

test('library v2: references follow the project rules and survive save, reopen, copy and insert', () => {
  const f = { ...finding(), status: 'fixed', references: [{ title: 'OWASP WSTG v4.2 WSTG-ATHZ-04', url: 'https://owasp.org/' }, { title: 'Internal policy 3', url: '' }] };
  const { entry } = entryFromFinding(f);
  assert.ok(!('status' in entry), 'status never goes into the library');
  assert.deepEqual(entry.references, f.references);
  assert.notEqual(entry.references, f.references);
  const lib = { ...createEmptyLibrary(), entries: [entry] };
  const back = open(lib);
  assert.ok(back.ok, back.errors?.join('; '));
  assert.equal(back.openedVersion, LIBRARY_VERSION, 'a new library opens in the current version');
  const g = findingFromEntry(back.library.entries[0], 9);
  assert.equal(g.status, 'open');
  assert.deepEqual(g.references, f.references);
  assert.notEqual(g.references, back.library.entries[0].references);
  for (const [refs, re] of [
    [Array.from({ length: 21 }, (_, i) => ({ title: `R${i}`, url: '' })), /at most 20/],
    [[{ title: ' x', url: '' }], /start or end with spaces/],
    [[{ title: 'x', url: 'javascript:alert(1)' }], /http/],
    [[{ title: 'x', url: 'https://e.org/￾' }], /cannot be written to Word/],
  ]) {
    assert.match(checkLibrary({ ...lib, entries: [{ ...entry, references: refs }] }, '0.4.0').join(' '), re);
  }
});

test('library v4 keeps a CVSS 4.0 vector; v1 to v3 files still accept only CVSS 3.1', () => {
  const v40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
  const base = createEmptyLibrary();
  const entry = { id: newEntryId(), name: 'Four', title: 'Four', rating: null, cvss: v40, formats: defaultFormats(), details: [] };
  assert.equal(LIBRARY_VERSION, 4);
  assert.deepEqual(checkLibrary({ ...base, entries: [entry] }, '0.2.0'), []);
  for (const libraryVersion of [1, 2, 3]) {
    assert.match(checkLibrary({ ...base, libraryVersion, entries: [entry] }, '0.2.0').join(' '), /canonical CVSS 3\.1 Base vector/, `v${libraryVersion}`);
  }
  // Not canonical (metrics out of order) or with a Threat metric: refused.
  const shuffled = 'CVSS:4.0/AC:L/AV:N/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
  assert.match(checkLibrary({ ...base, entries: [{ ...entry, cvss: shuffled }] }, '0.2.0').join(' '), /3\.1 or 4\.0/);
  assert.match(checkLibrary({ ...base, entries: [{ ...entry, cvss: v40 + '/E:A' }] }, '0.2.0').join(' '), /3\.1 or 4\.0/);
  // Inserting keeps the vector as stored: no conversion either way.
  assert.equal(findingFromEntry(entry, 1).cvss, v40);
});
