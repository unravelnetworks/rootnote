// Schema v7 (schema/project.v7.schema.json): CVSS 4.0 Base alongside 3.1. A report uses one
// CVSS version (project.scoring.cvssVersion); a vector in the other version is kept and shown
// with its version, and blocks a CVSS export until rescored. Older versions stay strictly 3.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import {
  createEmptyProject, createEmptyProjectV6, migrateV6toV7, openProjectFile, validateProjectFile, validateProjectFileV7, validateProjectFileV6,
  projectFromSettings, defaultFormats, SCHEMA_VERSION,
} from '../src/app/project.js';
import { createReportPlan } from '../src/export-docx/plan.js';
import { ratingCounts } from '../src/scoring/index.js';
import { findingsCsv } from '../src/app/csv.js';
import { reportMarkdown } from '../src/app/report-markdown.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v7.schema.json', import.meta.url), 'utf8'));
const json = (d) => JSON.stringify(d);
const check = (d) => validateProjectFile(json(d), Buffer.byteLength(json(d)));
const NOW = new Date('2026-11-12T00:00:00.000Z');
const V31 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
const finding = (n, cvss) => ({ id: `F-00${n}`, title: `Finding ${n}`, rating: 'High', cvss, affectedAssets: [], description: 'D', impact: '',
  threat: '', recommendation: '', formats: defaultFormats(), details: [], evidence: [], references: [], status: 'open', cwe: '', vulnerabilityType: '' });
function mixed(mode = 'severity+cvss') {
  const d = createEmptyProject(NOW);
  d.project.scoring.mode = mode;
  d.findings = [finding(1, V31), finding(2, V40), finding(3, null)];
  d.project.nextFindingNumber = 4;
  return d;
}

test('the frozen v7 schema adds cvssVersion and the CVSS 4.0 Base pattern only', () => {
  assert.equal(schema.properties.schemaVersion.const, 7);
  assert.deepEqual(schema.properties.project.properties.scoring.required, ['mode', 'cvssVersion']);
  assert.deepEqual(schema.properties.project.properties.scoring.properties.cvssVersion.enum, ['3.1', '4.0']);
  const patterns = schema.properties.findings.items.properties.cvss.oneOf.filter((o) => o.pattern).map((o) => new RegExp(o.pattern));
  assert.ok(patterns.some((p) => p.test(V31)) && patterns.some((p) => p.test(V40)));
  assert.equal(V40.length, 63, 'a canonical 4.0 Base vector fits the 64-character bound');
  assert.match(schema.$comment, /\(13\) finding\.cvss, when non-null, is a canonical CVSS 3\.1 Base vector .* or a canonical CVSS 4\.0 Base vector/);
  assert.match(schema.$comment, /v6 to v7: project\.scoring\.cvssVersion "3\.1"/);
});

test('a new project is v7: the report uses CVSS 3.1 until changed; the label keeps its default', async () => {
  const d = createEmptyProject(NOW);
  assert.equal(SCHEMA_VERSION, 7);
  assert.equal(d.schemaVersion, 7);
  assert.equal(d.project.scoring.cvssVersion, '3.1');
  assert.equal(d.project.labels.cvss, 'CVSS 3.1 Base');
  assert.ok((await check(d)).ok);
  assert.ok((await validateProjectFileV7(json(d), Buffer.byteLength(json(d)))).ok);
  const r = await openProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.migratedFrom, null);
  assert.deepEqual(r.project, d);
});

test('v6 to v7 adds cvssVersion 3.1 and changes nothing else; labels and vectors are kept', async () => {
  const v6 = createEmptyProjectV6(NOW);
  v6.project.labels.cvss = 'CVSS 3.1 Base';
  v6.findings = [finding(1, V31)];
  v6.project.nextFindingNumber = 2;
  const v7 = migrateV6toV7(structuredClone(v6));
  assert.equal(v7.schemaVersion, 7);
  assert.equal(v7.project.scoring.cvssVersion, '3.1');
  assert.equal(v7.project.labels.cvss, 'CVSS 3.1 Base');
  assert.deepEqual(v7.findings, v6.findings);
  const { cvssVersion, ...scoring } = v7.project.scoring;
  assert.deepEqual({ ...v7.project, scoring }, v6.project);
  const r = await openProjectFile(json(v6), Buffer.byteLength(json(v6)));
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.equal(r.migratedFrom, 6);
  assert.deepEqual(r.project, v7);
});

test('older versions stay strictly CVSS 3.1; v7 takes 3.1 and 4.0 side by side', async () => {
  const v6 = createEmptyProjectV6(NOW);
  v6.findings = [finding(1, V40)];
  v6.project.nextFindingNumber = 2;
  assert.match(((await check(v6)).errors ?? []).join(' '), /must be a CVSS 3\.1 Base vector/);
  assert.equal((await openProjectFile(json(v6), Buffer.byteLength(json(v6)))).ok, false, 'a v6 file holding a 4.0 vector is refused, not migrated');
  assert.ok((await check(mixed())).ok);
  assert.ok((await validateProjectFileV6(json(mixed()), 10)).errors.includes('Not a schema v6 project file.'));
});

test('the validator refuses a bad cvssVersion, non-canonical or extended 4.0 vectors, and v8', async () => {
  const bad = async (edit, re) => { const d = mixed(); edit(d); assert.match(((await check(d)).errors ?? []).join(' '), re); };
  await bad((d) => { d.project.scoring.cvssVersion = '4'; }, /cvssVersion: must be 3\.1 or 4\.0/);
  await bad((d) => { delete d.project.scoring.cvssVersion; }, /cvssVersion/);
  await bad((d) => { d.findings[1].cvss = 'CVSS:4.0/AC:L/AV:N/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'; }, /canonical CVSS 3\.1 or 4\.0/);
  await bad((d) => { d.findings[1].cvss = V40 + '/E:A'; }, /canonical CVSS 3\.1 or 4\.0/);
  await bad((d) => { d.findings[1].cvss = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:S/SA:N'; }, /canonical CVSS 3\.1 or 4\.0/);
  assert.equal((await openProjectFile(json({ ...mixed(), schemaVersion: 8 }), 10)).newer, true);
});

test('the label names the report version; only a score in the other version names its own', () => {
  const d = mixed();
  const plan = createReportPlan(d);
  const cvss = (i) => plan.findings[i].scoring.find((s) => s.key === 'cvss');
  assert.equal(cvss(0).label, 'CVSS 3.1 Base');
  assert.equal(cvss(0).value, '9.8');
  assert.equal(cvss(1).value, '9.3 (4.0)', 'a mismatched score names its version');
  assert.equal(cvss(1).mismatch, true);
  assert.equal(cvss(0).versioned, '9.8 (3.1)', 'text copied out always names the version');
  assert.equal(cvss(2).value, d.project.labels.unscored, 'no vector is Unscored, not 0');
  assert.deepEqual([cvss(0).version, cvss(1).version, cvss(2).version], ['3.1', '4.0', null]);
  assert.deepEqual(plan.summary.rows.map((r) => r.values.cvss), ['9.8', '9.3 (4.0)', d.project.labels.unscored]);
  // In a 4.0 report the same label reads 4.0, and the 3.1 score is the one named.
  d.project.scoring.cvssVersion = '4.0';
  const four = createReportPlan(d);
  assert.equal(four.summary.columns.find((c) => c.key === 'cvss').label, 'CVSS 4.0 Base');
  assert.deepEqual(four.summary.rows.map((r) => r.values.cvss), ['9.8 (3.1)', '9.3', d.project.labels.unscored]);
  d.project.labels.cvss = 'Score';
  assert.equal(createReportPlan(d).summary.columns.find((c) => c.key === 'cvss').label, 'Score (4.0)');
  d.project.labels.cvss = 'CVSS 3.1 Base';
  d.project.scoring.cvssVersion = '3.1';
  const bands = ratingCounts(d).distributions.find((x) => x.key === 'cvss').rows;
  assert.deepEqual(Object.fromEntries(bands.map((r) => [r.key, r.count])), { Critical: 2, High: 0, Medium: 0, Low: 0, None: 0, unscored: 1 });
  // A 4.0 vector with no impact is 0.0 (None), still distinct from unscored.
  d.findings[1].cvss = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N';
  assert.equal(createReportPlan(d).findings[1].scoring.find((s) => s.key === 'cvss').value, '0.0 (4.0)', 'mismatched: named');
  assert.equal(ratingCounts(d).distributions.find((x) => x.key === 'cvss').rows.find((r) => r.key === 'None').count, 1);
});

test('CSV keeps a numeric score beside the version-bearing vector; copied text names the version', async () => {
  const { findingText } = await import('../src/app/finding-text.js');
  const d = mixed('cvss');
  const csv = findingsCsv(d);
  assert.match(csv, /"CVSS 3\.1 Base score","CVSS 3\.1 Base vector"/);
  assert.match(csv, /"9\.3","CVSS:4\.0\/AV:N/);
  assert.match(csv, /"9\.8","CVSS:3\.1\/AV:N/);
  const md = reportMarkdown(d);
  assert.match(md, /\*\*CVSS 3\.1 Base:\*\* 9\.8 \(/);
  assert.match(md, /9\.3 \(4\.0\)/);
  assert.match(findingText(d, 0), /\*\*CVSS 3\.1 Base:\*\* 9\.8 \(3\.1\)/);
});

test('New from settings keeps the CVSS version choice, never findings or vectors', () => {
  const d = mixed();
  d.project.scoring.cvssVersion = '4.0';
  const fresh = projectFromSettings(d, NOW);
  assert.equal(fresh.project.scoring.cvssVersion, '4.0');
  assert.deepEqual(fresh.findings, []);
});

test('every display option works on a v7 project: status counts and column, classification column, Contents', () => {
  const d = mixed();
  Object.assign(d.project.findingStatusDisplay, { keyFacts: true, summaryColumn: true, counts: true });
  Object.assign(d.project.classificationDisplay, { keyFacts: true, summaryColumn: true });
  for (const s of d.project.sections.report) s.enabled = true;
  const plan = createReportPlan(d);
  assert.ok(plan.summary.statusCounts, 'status counts are built');
  assert.ok(plan.summary.columns.some((c) => c.key === 'status') && plan.summary.columns.some((c) => c.key === 'classification'));
  assert.equal(plan.reportSections[0].kind, 'contents');
});

test('a project holding a mismatched 4.0 vector saves and reopens unchanged; Word names it on A4 and Letter', async () => {
  const { default: JSZip } = await import('jszip');
  const { exportDocx } = await import('../src/export-docx/index.js');
  const d = mixed();
  Object.assign(d.project.findingStatusDisplay, { keyFacts: true, summaryColumn: true, counts: true });
  Object.assign(d.project.classificationDisplay, { keyFacts: true, summaryColumn: true });
  d.project.engagementId = 'A-VERY-LONG-ENGAGEMENT-IDENTIFIER-2026';
  d.findings.forEach((f) => { f.cwe = 'CWE-79'; f.vulnerabilityType = 'Stored cross-site scripting'; });
  const raw = json(d);
  const r = await openProjectFile(raw, Buffer.byteLength(raw));
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.equal(r.migratedFrom, null);
  assert.deepEqual(r.project, d, 'nothing changes on reopen');
  for (const paperSize of ['A4', 'Letter']) {
    const xml = await (await JSZip.loadAsync(await exportDocx(r.project, { paperSize }))).file('word/document.xml').async('string');
    assert.match(xml, />9\.8</, paperSize);
    assert.match(xml, /9\.3 \(4\.0\)/, `${paperSize}: a mismatched score names its version`);
    assert.match(xml, /CVSS 3\.1 Base/, paperSize);
    assert.match(xml, /CVSS:4\.0\/AV:N\/AC:L\/AT:N/, `${paperSize}: the vector is kept as stored`);
  }
});

test('a library with a 4.0 entry saves and reopens as library format 4', async () => {
  const { createEmptyLibrary, entryFromFinding, serializeLibrary, openLibraryFile } = await import('../src/app/library.js');
  const lib = { ...createEmptyLibrary(), entries: [entryFromFinding(mixed().findings[1]).entry] };
  const text = serializeLibrary(lib, { appVersion: '0.2.0' });
  assert.match(text, /"libraryVersion":4/);
  const back = openLibraryFile(text, Buffer.byteLength(text));
  assert.equal(back.ok, true, back.errors?.join('; '));
  assert.equal(back.library.entries[0].cvss, V40);
});

test('the report version picks the mismatches: none after rescoring, and the rule follows a switch', async () => {
  const { cvssMismatches } = await import('../src/scoring/index.js');
  const d = mixed();
  assert.deepEqual(cvssMismatches(d).map((f) => f.id), ['F-002']);
  d.project.scoring.cvssVersion = '4.0';
  assert.deepEqual(cvssMismatches(d).map((f) => f.id), ['F-001']);
  d.findings[0].cvss = null;
  assert.deepEqual(cvssMismatches(d), []);
});
