// Engagement folders: the Customer\Engagement tree, file kinds, safe folder names, the scan
// limits, and the summary shown before a project is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, folderNameProblem, groupPaths, projectSummary, planBatch, scanHandle, ENGAGEMENT_LIMITS } from '../src/editor/engagements.js';

test('file kinds: projects, Word and PDF reports, CSV sheets; everything else ignored', () => {
  assert.equal(kindOf('portal.rootnote.json'), 'project');
  assert.equal(kindOf('Portal.FIELDNOTE.JSON'), 'project');
  assert.equal(kindOf('Portal.rootnote.json'), 'project');
  assert.equal(kindOf('Portal.ROOTNOTE.JSON'), 'project');
  assert.equal(kindOf('report.docx'), 'report');
  assert.equal(kindOf('report.pdf'), 'report');
  assert.equal(kindOf('findings.csv'), 'sheet');
  assert.equal(kindOf('portal-report.md'), 'report');
  for (const n of ['notes.txt', 'portal.json', 'library.rootnote-library.json', 'x.docx.tmp']) assert.equal(kindOf(n), null, n);
});

test('folder names that work on Windows, macOS and Linux', () => {
  for (const ok of ['Brightwater Logistics', '2026-10 Customer portal', 'Acme (EU)', 'Café Ñandú']) assert.equal(folderNameProblem(ok), null, ok);
  for (const bad of ['', '  ', ' lead', 'trail ', 'a/b', 'a\\b', 'a:b', 'what?', 'end.', 'CON', 'com1.txt', '..', 'x'.repeat(101), 'tab\there']) {
    assert.ok(folderNameProblem(bad), JSON.stringify(bad));
  }
});

test('only Root/Customer/Engagement/file paths count; sorted naturally', () => {
  const f = (path, size = 10) => ({ path, size, modified: 0, open: async () => null });
  const tree = groupPaths([
    f('E/Brightwater/2027-02 Retest/retest.rootnote.json'),
    f('E/Brightwater/2026-10 Portal/portal.rootnote.json'),
    f('E/Brightwater/2026-10 Portal/portal.docx'),
    f('E/Brightwater/2026-10 Portal/notes.txt'),
    f('E/Brightwater/2026-10 Portal/old/deeper.rootnote.json'),
    f('E/Brightwater/loose.rootnote.json'),
    f('E/Acme/2026-11 API/api.rootnote.json'),
  ]);
  assert.deepEqual(tree.map((c) => c.name), ['Acme', 'Brightwater']);
  const bw = tree[1];
  assert.deepEqual(bw.engagements.map((e) => e.name), ['2026-10 Portal', '2027-02 Retest']);
  assert.deepEqual(bw.engagements[0].files.map((x) => [x.name, x.kind]), [['portal.docx', 'report'], ['portal.rootnote.json', 'project']]);
});

test('the handle scan gives the same tree and keeps handles for saving', async () => {
  const file = (name, size) => ({ kind: 'file', name, getFile: async () => ({ size, lastModified: 5 }) });
  const dir = (name, children) => ({ kind: 'directory', name, async *values() { yield* children; } });
  const root = dir('E', [dir('Brightwater', [dir('2026-10 Portal', [file('portal.rootnote.json', 3), file('a.txt', 1), dir('sub', [])])]), file('top.rootnote.json', 1)]);
  const tree = await scanHandle(root);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].engagements[0].files.length, 1);
  assert.ok(tree[0].engagements[0].dir && tree[0].engagements[0].files[0].handle, 'handles kept');
});

test('the summary reads title, client, status and counts, and refuses what is not a project', () => {
  const s = projectSummary(JSON.stringify({ schemaVersion: 6, project: { title: 'Portal', client: 'BW', engagementStatus: 'in_review' }, findings: [{ rating: 'High' }, { rating: 'High' }, { rating: null }] }));
  assert.deepEqual({ ...s, counts: { ...s.counts } }, { title: 'Portal', client: 'BW', status: 'in_review', findings: 3, counts: { High: 2, Unscored: 1 }, schemaVersion: 6 });
  // A null project (found by the long fuzz run) and a rating named __proto__.
  for (const bad of ['not json', '[]', '{"project":1,"findings":[]}', '{"project":{}}', '{"project":null,"findings":[]}']) assert.equal(projectSummary(bad), null, bad);
  const odd = projectSummary('{"project":{},"findings":[{"rating":"__proto__"},{"rating":"__proto__"}]}');
  assert.equal(odd.counts.__proto__, 2);
  assert.equal(Object.prototype.toString.call({}), '[object Object]');
});

test('a scan reads at most 50 files or 200 MiB at a time and never reads files over 25 MiB', () => {
  const files = (n, size) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, size }));
  let b = planBatch(files(60, 1000));
  assert.equal(b.read.length, ENGAGEMENT_LIMITS.batchFiles);
  assert.equal(b.rest.length, 10);
  b = planBatch(files(20, 20 * 1024 * 1024));
  assert.equal(b.read.length, 10, '10 × 20 MiB = 200 MiB');
  b = planBatch([{ name: 'big', size: 26 * 1024 * 1024 }, { name: 'ok', size: 10 }]);
  assert.deepEqual([b.skipped.map((x) => x.name), b.read.map((x) => x.name), b.rest.length], [['big'], ['ok'], 0]);
});
