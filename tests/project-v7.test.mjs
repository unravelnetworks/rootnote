// Schema v7 (schema/project.v7.schema.json): CVSS 4.0 Base alongside 3.1. Each finding's
// vector names its own version; project.scoring.cvssVersion only picks the calculator for a
// finding without a vector. Older versions stay strictly CVSS 3.1.
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

test('a new project is v7: CVSS 3.1 by default for new findings, neutral label', async () => {
  const d = createEmptyProject(NOW);
  assert.equal(SCHEMA_VERSION, 7);
  assert.equal(d.schemaVersion, 7);
  assert.equal(d.project.scoring.cvssVersion, '3.1');
  assert.equal(d.project.labels.cvss, 'CVSS Base');
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

test('every score in the report names its own version; counts use each score', () => {
  const d = mixed();
  const plan = createReportPlan(d);
  const cvss = (i) => plan.findings[i].scoring.find((s) => s.key === 'cvss');
  assert.equal(cvss(0).value, '9.8 (3.1)');
  assert.equal(cvss(1).value, '9.3 (4.0)');
  assert.equal(cvss(2).value, d.project.labels.unscored, 'no vector is Unscored, not 0');
  assert.deepEqual([cvss(0).version, cvss(1).version, cvss(2).version], ['3.1', '4.0', null]);
  assert.deepEqual(plan.summary.rows.map((r) => r.values.cvss), ['9.8 (3.1)', '9.3 (4.0)', d.project.labels.unscored]);
  const bands = ratingCounts(d).distributions.find((x) => x.key === 'cvss').rows;
  assert.deepEqual(Object.fromEntries(bands.map((r) => [r.key, r.count])), { Critical: 2, High: 0, Medium: 0, Low: 0, None: 0, unscored: 1 });
  // A 4.0 vector with no impact is 0.0 (None), still distinct from unscored.
  d.findings[1].cvss = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N';
  assert.equal(createReportPlan(d).findings[1].scoring.find((s) => s.key === 'cvss').value, '0.0 (4.0)');
  assert.equal(ratingCounts(d).distributions.find((x) => x.key === 'cvss').rows.find((r) => r.key === 'None').count, 1);
});

test('CSV keeps a numeric score beside the version-bearing vector; Markdown shows the version', () => {
  const d = mixed('cvss');
  const csv = findingsCsv(d);
  assert.match(csv, /"9\.3","CVSS:4\.0\/AV:N/);
  assert.match(csv, /"9\.8","CVSS:3\.1\/AV:N/);
  const md = reportMarkdown(d);
  assert.match(md, /9\.3 \(4\.0\)/);
  assert.match(md, /9\.8 \(3\.1\)/);
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
