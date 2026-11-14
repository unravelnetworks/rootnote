// Schema v7 (schema/project.v7.schema.json): CVSS 4.0 Base alongside 3.1. A report uses one
// CVSS version (project.scoring.cvssVersion); a vector in the other version is kept and shown
// with its version, and blocks a CVSS export until rescored. Older versions stay strictly 3.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import {
  createEmptyProject, createEmptyProjectV6, createEmptyProjectV7, migrateV6toV7, migrateV7toV8, openProjectFile, validateProjectFile, validateProjectFileV7, validateProjectFileV6,
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

test('a v7 project: the report uses CVSS 3.1 until changed; the label keeps its default; it opens as v8 unchanged', async () => {
  const d = createEmptyProjectV7(NOW);
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(d.schemaVersion, 7);
  assert.equal(d.project.scoring.cvssVersion, '3.1');
  assert.equal(d.project.labels.cvss, 'CVSS 3.1 Base');
  assert.ok((await check(d)).ok);
  assert.ok((await validateProjectFileV7(json(d), Buffer.byteLength(json(d)))).ok);
  const r = await openProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.migratedFrom, 7);
  assert.deepEqual(r.project, migrateV7toV8(d));
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
  assert.deepEqual(r.project, migrateV7toV8(v7));
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

test('the validator refuses a bad cvssVersion, non-canonical or extended 4.0 vectors, and v9', async () => {
  const bad = async (edit, re) => { const d = mixed(); edit(d); assert.match(((await check(d)).errors ?? []).join(' '), re); };
  await bad((d) => { d.project.scoring.cvssVersion = '4'; }, /cvssVersion: must be 3\.1 or 4\.0/);
  await bad((d) => { delete d.project.scoring.cvssVersion; }, /cvssVersion/);
  await bad((d) => { d.findings[1].cvss = 'CVSS:4.0/AC:L/AV:N/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'; }, /canonical CVSS 3\.1 or 4\.0/);
  await bad((d) => { d.findings[1].cvss = V40 + '/E:A'; }, /canonical CVSS 3\.1 or 4\.0/);
  await bad((d) => { d.findings[1].cvss = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:S/SA:N'; }, /canonical CVSS 3\.1 or 4\.0/);
  assert.equal((await openProjectFile(json({ ...mixed(), schemaVersion: 9 }), 10)).newer, true);
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
  d.project.labels.cvss = 'CVSS 3.1 Base';
  d.project.scoring.cvssVersion = '3.1';
  // A 4.0 vector with no impact is 0.0 (None), still distinct from unscored.
  d.findings[1].cvss = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N';
  assert.equal(createReportPlan(d).findings[1].scoring.find((s) => s.key === 'cvss').value, '0.0 (4.0)', 'mismatched: named');
});

test('only the default label follows the report; a custom label is kept and the version shown beside it', async () => {
  const { cvssLabel, staleCvssLabel, switchedCvssLabel } = await import('../src/scoring/index.js');
  assert.equal(cvssLabel('CVSS 3.1 Base', '4.0'), 'CVSS 4.0 Base');
  assert.equal(cvssLabel('Client methodology 3.1', '4.0'), 'Client methodology 3.1 (CVSS 4.0)', 'other numbers are never rewritten');
  assert.equal(switchedCvssLabel('Client methodology 3.1', '4.0'), 'Client methodology 3.1');
  assert.equal(cvssLabel('CVSS v3.1', '4.0'), 'CVSS v3.1 (CVSS 4.0)');
  assert.equal(staleCvssLabel('CVSS v3.1', '4.0'), '3.1', 'a custom label naming another version is flagged');
  assert.equal(staleCvssLabel('CVSSv4.0 score', '4.0'), null);
  assert.equal(cvssLabel('CVSS v4.0', '4.0'), 'CVSS v4.0');
  assert.equal(cvssLabel('CVSS Base', '4.0'), 'CVSS Base (4.0)');
  assert.equal(cvssLabel('Score', '4.0'), 'Score (CVSS 4.0)');
  const d = mixed();
  d.findings[1].cvss = null;
  d.project.labels.cvss = 'CVSS v3.1';
  d.project.scoring.cvssVersion = '4.0';
  d.findings[0].cvss = null;
  const { checklist } = await import('../src/editor/checklist.js');
  assert.ok(checklist(d).some((w) => /The CVSS label "CVSS v3\.1" names CVSS 3\.1, but this report uses CVSS 4\.0/.test(w.text)));
});

test('CVSS counts never mix versions: withheld with a note while a finding is in the other version', () => {
  const d = mixed();
  Object.assign(d.project.findingStatusDisplay, { counts: true });
  const counts = ratingCounts(d);
  assert.equal(counts.distributions.some((x) => x.key === 'cvss'), false);
  assert.equal(counts.cvssWithheld, 1);
  assert.ok(counts.distributions.some((x) => x.key === 'rating'), 'severity counts stay');
  assert.match(createReportPlan(d).summary.cvssCountsNote, /CVSS 3\.1 Base counts are not shown: 1 finding is scored in another CVSS version/);
  d.findings[1].cvss = null;
  const bands = ratingCounts(d).distributions.find((x) => x.key === 'cvss').rows;
  assert.deepEqual(Object.fromEntries(bands.map((r) => [r.key, r.count])), { Critical: 1, High: 0, Medium: 0, Low: 0, None: 0, unscored: 2 });
  assert.equal(createReportPlan(d).summary.cvssCountsNote, null);
});

test('every exporter refuses a report mixing CVSS versions; CSV even when CVSS is hidden', async () => {
  const { exportDocx } = await import('../src/export-docx/index.js');
  const d = mixed();
  const refused = /1 finding is scored in another CVSS version than this report's CVSS 3\.1/;
  assert.throws(() => findingsCsv(d), refused);
  assert.throws(() => reportMarkdown(d), refused);
  await assert.rejects(exportDocx(d, { paperSize: 'A4' }), refused);
  d.project.scoring.mode = 'severity';
  assert.throws(() => findingsCsv(d), refused, 'the CSV always holds CVSS scores');
  assert.doesNotThrow(() => reportMarkdown(d), 'CVSS hidden: the report is allowed');
});

test('CSV keeps a numeric score beside the version-bearing vector; copied text names the version', async () => {
  const { findingText } = await import('../src/app/finding-text.js');
  const d = mixed('cvss');
  d.project.scoring.cvssVersion = '4.0';
  d.findings[0].cvss = null;
  const csv = findingsCsv(d);
  assert.match(csv, /"CVSS 4\.0 Base score","CVSS 4\.0 Base vector"/);
  assert.match(csv, /"9\.3","CVSS:4\.0\/AV:N/);
  const md = reportMarkdown(d);
  assert.match(md, /\*\*CVSS 4\.0 Base:\*\* 9\.3 \(/);
  assert.match(findingText(d, 1), /\*\*CVSS 4\.0 Base:\*\* 9\.3 \(4\.0\)/);
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

test('a project holding a mismatched 4.0 vector saves and reopens unchanged; once rescored, Word exports on A4 and Letter', async () => {
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
  r.project.findings[1].cvss = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N';
  for (const paperSize of ['A4', 'Letter']) {
    const xml = await (await JSZip.loadAsync(await exportDocx(r.project, { paperSize }))).file('word/document.xml').async('string');
    assert.match(xml, />9\.8</, paperSize);
    assert.match(xml, />6\.1</, paperSize);
    assert.doesNotMatch(xml, /\((3\.1|4\.0)\)/, `${paperSize}: matching scores are plain`);
    assert.match(xml, /CVSS 3\.1 Base/, paperSize);
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

test('a finding kept in the other version, copied on its own, is labelled with its own version', async () => {
  const { findingText } = await import('../src/app/finding-text.js');
  const d = mixed();
  assert.match(findingText(d, 1), /\*\*CVSS 4\.0 Base:\*\* 9\.3 \(4\.0\)/);
  assert.match(findingText(d, 0), /\*\*CVSS 3\.1 Base:\*\* 9\.8 \(3\.1\)/);
  d.project.labels.cvss = 'Score';
  assert.match(findingText(d, 1), /\*\*Score \(CVSS 4\.0\):\*\* 9\.3 \(4\.0\)/);
});

test('switch suggestions: only metrics whose meaning carries over, never a whole vector', async () => {
  const { cvssSuggestions } = await import('../src/scoring/index.js');
  assert.deepEqual(cvssSuggestions('CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:L/A:N', '4.0'), { AV: 'N', PR: 'L', UI: 'N', VC: 'H', VI: 'L', VA: 'N' }, 'AC never: 3.1 AC split into AC and AT');
  assert.deepEqual(cvssSuggestions('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', '4.0'), { AV: 'N', PR: 'N' }, 'UI:R (passive or active?) and S:C impacts are left to the tester');
  assert.deepEqual(cvssSuggestions(V40, '3.1'), { AV: 'N', PR: 'N', UI: 'N' });
  assert.deepEqual(cvssSuggestions('CVSS:4.0/AV:A/AC:L/AT:P/PR:H/UI:A/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', '3.1'), { AV: 'A', PR: 'H', UI: 'R' });
  assert.deepEqual(cvssSuggestions(V31, '3.1'), {}, 'same version: nothing to suggest');
  for (const v of [V31, V40]) {
    const target = v.startsWith('CVSS:3.1') ? '4.0' : '3.1';
    const n = Object.keys(cvssSuggestions(v, target)).length;
    assert.ok(n < (target === '4.0' ? 11 : 8), 'a suggestion is never a complete vector');
  }
});

test('a pending finding key fact names the version of its score; the summary column keeps the report version', () => {
  const d = mixed();
  d.project.scoring.cvssVersion = '4.0';
  d.project.labels.cvss = 'CVSS 4.0 Base';
  const plan = createReportPlan(d);
  assert.equal(plan.findings[0].scoring.find((s) => s.key === 'cvss').label, 'CVSS 3.1 Base');
  assert.equal(plan.findings[1].scoring.find((s) => s.key === 'cvss').label, 'CVSS 4.0 Base');
  assert.equal(plan.summary.columns.find((c) => c.key === 'cvss').label, 'CVSS 4.0 Base');
});
