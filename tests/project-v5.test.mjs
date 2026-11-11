// Since schema v6 the current version is 6; these tests build v5 projects explicitly
// (createEmptyProjectV5 imported as createEmptyProject) and check the v5 rules and outputs.
// Schema v5 (schema/project.v5.schema.json):
// the authored "How findings are rated" section. Converting adds nothing; the text prints only
// when the section is on and the text is not blank; the default is filled only on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import JSZip from 'jszip';
import {
  createEmptyProjectV5 as createEmptyProject, createEmptyProjectV4, migrateV4toV5, migrateV5toV6, migrateV6toV7, openProjectFile, validateProjectFile, validateProjectFileV5,
  projectFromSettings, SETTINGS_KEPT, REPORT_SECTIONS_V5, LIMITS, RATING_METHOD_LABEL,
} from '../src/app/project.js';
import { createReportPlan } from '../src/export-docx/plan.js';
import { exportDocx } from '../src/export-docx/index.js';
import { defaultRatingMethodText } from '../src/app/rating-method.js';
import { checklist } from '../src/editor/checklist.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v5.schema.json', import.meta.url), 'utf8'));
const json = (d) => JSON.stringify(d);
const check = (d) => validateProjectFile(json(d), Buffer.byteLength(json(d)));
const errorsOf = async (d) => (await check(d)).errors ?? [];
const NOW = new Date('2026-11-02T00:00:00.000Z');
const section = (d) => d.project.sections.report.find((s) => s.key === 'ratingMethod');
const finding = (n) => ({ id: `F-00${n}`, title: `Finding ${n}`, severity: null, rating: 'High', cvss: null, affectedAssets: [], description: 'D', impact: '',
  threat: '', recommendation: '', formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, details: [], evidence: [], status: 'open', references: [] });

test('the frozen v5 schema names the new section and field', () => {
  assert.equal(schema.properties.schemaVersion.const, 5);
  const report = schema.properties.project.properties.sections.properties.report;
  assert.equal(report.minItems, 6);
  assert.deepEqual([...report.items.properties.key.enum].sort(), [...REPORT_SECTIONS_V5].sort());
  assert.ok(schema.properties.project.required.includes('ratingMethod'));
  assert.match(schema.$comment, /\(21\) project\.ratingMethod\.text/);
});

test('a new project is v5: the section sits before the findings summary, off, with empty text', async () => {
  const d = createEmptyProject(NOW);
  assert.equal(d.schemaVersion, 5);
  assert.deepEqual(d.project.sections.report.map((s) => s.key), ['contents', 'executiveSummary', 'engagement', 'scope', 'ratingMethod', 'findingsSummary']);
  assert.deepEqual(section(d), { key: 'ratingMethod', label: RATING_METHOD_LABEL, enabled: false });
  assert.deepEqual(d.project.ratingMethod, { text: '' });
  assert.ok((await check(d)).ok);
  assert.ok((await validateProjectFileV5(json(d), Buffer.byteLength(json(d)))).ok);
  const r = await openProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.migratedFrom, 5, 'v5 files open converted to v7');
  assert.deepEqual(r.project, migrateV6toV7(migrateV5toV6(d)));
});

test('v4 -> v5 appends the section off with empty text and changes nothing else', () => {
  const v4 = createEmptyProjectV4(NOW);
  v4.project.sections.report.reverse();
  v4.findings.push(finding(1));
  v4.project.nextFindingNumber = 2;
  const v5 = migrateV4toV5(structuredClone(v4));
  assert.equal(v5.schemaVersion, 5);
  assert.deepEqual(v5.project.sections.report.slice(0, -1), v4.project.sections.report, 'old order kept');
  assert.deepEqual(v5.project.sections.report.at(-1), { key: 'ratingMethod', label: RATING_METHOD_LABEL, enabled: false });
  const { ratingMethod, sections, ...rest } = v5.project;
  const { sections: s4, ...rest4 } = v4.project;
  assert.deepEqual(rest, rest4);
  assert.deepEqual(ratingMethod, { text: '' });
  assert.deepEqual(v5.findings, v4.findings);
  assert.deepEqual(v5.images, v4.images);
});

test('the validator refuses a missing, malformed, oversized or Word-invalid rating text', async () => {
  const cases = [
    [(d) => { delete d.project.ratingMethod; }, /project\.ratingMethod: missing/],
    [(d) => { d.project.ratingMethod = { text: '', extra: 1 }; }, /unknown field "extra"/],
    [(d) => { d.project.ratingMethod = {}; }, /ratingMethod\.text: missing/],
    [(d) => { d.project.ratingMethod.text = 5; }, /ratingMethod\.text: must be text/],
    [(d) => { d.project.ratingMethod.text = 'x'.repeat(LIMITS.text + 1); }, /ratingMethod\.text: longer than/],
    [(d) => { d.project.ratingMethod.text = 'bad \u0001'; }, /ratingMethod/],
    [(d) => { d.project.sections.report = d.project.sections.report.filter((s) => s.key !== 'ratingMethod'); }, /must list each of/],
  ];
  for (const [mutate, re] of cases) {
    const d = createEmptyProject(NOW);
    mutate(d);
    assert.match((await errorsOf(d)).join('\n'), re, re.source);
  }
  const v4WithField = createEmptyProjectV4(NOW);
  v4WithField.project.ratingMethod = { text: '' };
  assert.match((await errorsOf(v4WithField)).join(), /unknown field "ratingMethod"/);
  assert.equal((await openProjectFile(json({ ...createEmptyProject(NOW), schemaVersion: 8 }), 10)).newer, true);
});

function planOf(d) { return createReportPlan(d); }
const reportKeys = (plan) => plan.reportSections?.map((s) => s.key) ?? [];

test('the plan prints the text only when on and not blank, in stored order, with one fixed anchor in Contents', () => {
  const d = createEmptyProject(NOW);
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.project.scope = 'Scope';
  d.findings.push(finding(1));
  d.project.nextFindingNumber = 2;
  // On but blank: nothing.
  d.project.ratingMethod.text = '  \n ';
  let plan = planOf(d);
  assert.ok(!JSON.stringify(plan).includes('report_rating_method'));
  // On with text: an ordinary text section after Scope, linked once from Contents.
  d.project.ratingMethod.text = 'We rate by hand.';
  plan = planOf(d);
  const keys = reportKeys(plan);
  assert.ok(keys.indexOf('ratingMethod') === keys.indexOf('scope') + 1, keys.join());
  const s = plan.reportSections.find((x) => x.key === 'ratingMethod');
  assert.deepEqual({ kind: s.kind, text: s.text, anchor: s.anchor, label: s.label }, { kind: 'text', text: 'We rate by hand.', anchor: 'report_rating_method', label: RATING_METHOD_LABEL });
  assert.equal(plan.contents.rows.filter((r) => r.anchor === 'report_rating_method').length, 1);
  assert.equal(plan.reportSections[0].kind, 'contents', 'Contents stays first');
  // Off: nothing, even with text.
  section(d).enabled = false;
  assert.ok(!JSON.stringify(planOf(d)).includes('report_rating_method'));
});

test('v5 keeps every v4 feature in the plan (statuses, counts, references, contents)', () => {
  const d = createEmptyProject(NOW);
  d.project.findingStatusDisplay = { keyFacts: true, summaryColumn: true, counts: true };
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.findings.push({ ...finding(1), status: 'fixed', references: [{ title: 'Ref', url: 'https://e.org/' }] });
  d.project.nextFindingNumber = 2;
  const plan = planOf(d);
  assert.equal(plan.version, 3);
  assert.ok(plan.contents.enabled);
  assert.equal(plan.findings[0].status.label, 'Fixed');
  assert.ok(plan.summary.statusCounts);
  assert.ok(plan.findings[0].sections.some((s) => s.kind === 'references'));
});

test('the Word export carries the heading, the bookmark and the authored text', async () => {
  const d = createEmptyProject(NOW);
  d.project.title = 'Rating test';
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.project.ratingMethod.text = 'Ratings are the tester\'s judgment.\n\n- Critical: urgent';
  const zip = await JSZip.loadAsync(await exportDocx(d, {}));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /w:name="report_rating_method"/);
  assert.match(xml, /How findings are rated/);
  assert.match(xml, /Ratings are the tester(&apos;|')s judgment\./);
  assert.match(xml, /w:anchor="report_rating_method"/, 'Contents links to it');
});

test('default text: manual ratings are a judgment, CVSS is calculated with the FIRST bands, labels are the report\'s', () => {
  const labels = { ...createEmptyProject(NOW).project.labels, severity: 'Gravity', cvss: 'CVSS score', unscored: 'No score' };
  const sev = defaultRatingMethodText('severity', labels);
  assert.match(sev, /Gravity rating that the tester assigns/);
  assert.match(sev, /not a calculated score/);
  assert.doesNotMatch(sev, /CVSS/);
  for (const level of ['Critical', 'High', 'Medium', 'Low', 'Informational']) assert.match(sev, new RegExp(`^- ${level}: `, 'm'));
  const both = defaultRatingMethodText('risk+cvss', labels);
  assert.match(both, /Risk rating/);
  assert.match(both, /CVSS score is the score calculated from the finding's CVSS Base metrics, shown with its version and vector. A report can use CVSS 3.1 and CVSS 4.0 side by side/);
  assert.match(both, /- Critical: 9\.0 to 10\.0[\s\S]*- None: 0\.0/);
  assert.match(both, /shown as No score\./);
  assert.doesNotMatch(defaultRatingMethodText('cvss', labels), /judgment/);
  for (const mode of ['severity', 'risk', 'cvss', 'severity+cvss', 'risk+cvss']) assert.ok(defaultRatingMethodText(mode, labels).length < LIMITS.text);
});

test('New from settings keeps the rating text and says so', () => {
  const d = createEmptyProject(NOW);
  d.project.ratingMethod.text = 'Our method';
  section(d).enabled = true;
  const next = projectFromSettings(d, NOW);
  assert.deepEqual(next.project.ratingMethod, { text: 'Our method' });
  assert.equal(section(next).enabled, true);
  assert.ok(SETTINGS_KEPT.some((s) => /How findings are rated/.test(s)));
});

test('Check & export lists [[prompts]] left in the rating text', () => {
  const d = createEmptyProject(NOW);
  d.project.ratingMethod.text = 'We rate by [[your method]].';
  const w = checklist(d).warnings ?? checklist(d);
  assert.ok(JSON.stringify(w).includes('1 unfilled [[…]] prompt'), JSON.stringify(w));
});
