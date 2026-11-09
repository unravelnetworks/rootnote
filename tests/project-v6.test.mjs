// Schema v6 (schema/project.v6.schema.json):
// the user's own report sections, and a CWE and vulnerability type per finding, with library v3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import JSZip from 'jszip';
import {
  createEmptyProject, createEmptyProjectV5, migrateV5toV6, openProjectFile, validateProjectFile, validateProjectFileV6,
  projectFromSettings, SETTINGS_KEPT, SETTINGS_DROPPED, CUSTOM_LIMITS, customKey, newCustomSectionId, CUSTOM_SECTION_ID, LABEL_KEYS_V6, LIMITS, defaultFormats,
} from '../src/app/project.js';
import { createReportPlan } from '../src/export-docx/plan.js';
import { exportDocx } from '../src/export-docx/index.js';
import { checklist } from '../src/editor/checklist.js';
import { findingText } from '../src/app/finding-text.js';
import { libraryErrors, openLibraryFile, entryFromFinding, findingFromEntry, LIBRARY_VERSION, serializeLibrary } from '../src/app/library.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v6.schema.json', import.meta.url), 'utf8'));
const json = (d) => JSON.stringify(d);
const check = (d) => validateProjectFile(json(d), Buffer.byteLength(json(d)));
const errorsOf = async (d) => (await check(d)).errors ?? [];
const NOW = new Date('2026-11-03T00:00:00.000Z');
const finding = (n, extra = {}) => ({ id: `F-00${n}`, title: `Finding ${n}`, rating: 'High', cvss: null, affectedAssets: [], description: 'D', impact: '',
  threat: '', recommendation: '', formats: defaultFormats(), details: [], evidence: [], status: 'open', cwe: '', vulnerabilityType: '', ...extra });
/** A v6 project with one custom section placed before the findings summary. */
function withCustom(text = 'We tested by hand.', { title = 'Methodology', id = 'Cmethod', enabled = true, format = 'plain' } = {}) {
  const d = createEmptyProject(NOW);
  d.project.title = 'Custom';
  d.project.customSections.push({ id, title, text, format });
  const list = d.project.sections.report;
  list.splice(list.findIndex((s) => s.key === 'findingsSummary'), 0, { key: customKey(id), label: title, enabled });
  return d;
}

test('the JSON schema accepts what migration produces: contents stored last is still valid', async () => {
  const { createEmptyProjectV3 } = await import('../src/app/project.js');
  const v3 = createEmptyProjectV3(NOW);
  const r = await openProjectFile(json(v3), Buffer.byteLength(json(v3)));
  assert.ok(r.ok);
  assert.notEqual(r.project.project.sections.report[0].key, 'contents', 'stored order kept');
  assert.equal(schema.properties.project.properties.sections.properties.report.prefixItems, undefined);
  assert.equal(createReportPlan({ ...r.project, project: { ...r.project.project, sections: { ...r.project.project.sections,
    report: r.project.project.sections.report.map((s) => ({ ...s, enabled: true })) } } }).reportSections[0].kind, 'contents');
});

test('the frozen v6 schema names the new fields and bounds', () => {
  assert.equal(schema.properties.schemaVersion.const, 6);
  const P = schema.properties.project;
  assert.equal(P.properties.sections.properties.report.maxItems, 16);
  assert.equal(P.properties.customSections.maxItems, 10);
  assert.ok(P.required.includes('customSections') && P.required.includes('classificationDisplay'));
  assert.deepEqual([...P.properties.labels.required].sort(), [...LABEL_KEYS_V6].sort());
  assert.ok(schema.properties.findings.items.required.includes('cwe'));
  assert.match(schema.$comment, /\(22\) project\.customSections/);
  assert.match(schema.$comment, /\(23\) finding\.cwe/);
});

test('a new project is v6: no custom sections, classification in key facts only, new labels', async () => {
  const d = createEmptyProject(NOW);
  assert.equal(d.schemaVersion, 6);
  assert.deepEqual(d.project.customSections, []);
  assert.deepEqual(d.project.classificationDisplay, { keyFacts: true, summaryColumn: false });
  assert.deepEqual([d.project.labels.cwe, d.project.labels.vulnerabilityType, d.project.labels.classification], ['CWE', 'Vulnerability type', 'Classification']);
  assert.equal(d.project.sections.report.length, 6);
  assert.ok((await check(d)).ok);
  assert.ok((await validateProjectFileV6(json(d), Buffer.byteLength(json(d)))).ok);
  const r = await openProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.migratedFrom, null);
  assert.deepEqual(r.project, d);
});

test('ids are a letter and at most 23 more word characters, random, and fit a 40-character bookmark', () => {
  const ids = new Set(Array.from({ length: 200 }, newCustomSectionId));
  assert.equal(ids.size, 200);
  for (const id of ids) { assert.match(id, CUSTOM_SECTION_ID); assert.ok(`report_custom_${id}`.length <= 38); }
});

test('v5 -> v6 adds no custom row, the display defaults, the labels and empty classification only', async () => {
  const v5 = createEmptyProjectV5(NOW);
  v5.project.sections.report.reverse();
  v5.project.sections.report.unshift(...v5.project.sections.report.splice(v5.project.sections.report.findIndex((s) => s.key === 'contents'), 1));
  v5.findings.push({ ...finding(1) });
  delete v5.findings[0].cwe; delete v5.findings[0].vulnerabilityType;
  v5.project.nextFindingNumber = 2;
  const v6 = migrateV5toV6(structuredClone(v5));
  assert.equal(v6.schemaVersion, 6);
  assert.deepEqual(v6.project.sections, v5.project.sections, 'order and rows unchanged');
  const { customSections, classificationDisplay, labels, ...rest } = v6.project;
  const { labels: l5, ...rest5 } = v5.project;
  assert.deepEqual(rest, rest5);
  assert.deepEqual(customSections, []);
  assert.deepEqual(labels, { ...l5, cwe: 'CWE', vulnerabilityType: 'Vulnerability type', classification: 'Classification' });
  assert.deepEqual(v6.findings, v5.findings.map((f) => ({ ...f, cwe: '', vulnerabilityType: '' })));
  const opened = await openProjectFile(json(v5), Buffer.byteLength(json(v5)));
  assert.equal(opened.migratedFrom, 5);
  assert.deepEqual(opened.project.findings, v6.findings);
});

test('the validator refuses broken custom sections, classification and display settings', async () => {
  const cases = [
    [(d) => { for (let i = 0; i < 11; i++) d.project.customSections.push({ id: `C${i}`, title: `S${i}`, text: '', format: 'plain' }); }, /customSections: must be a list of at most 10/],
    [(d) => { d.project.customSections[0].id = '1bad'; d.project.sections.report.find((s) => s.key === 'custom-Cmethod').key = 'custom-1bad'; }, /id: must be a letter/],
    [(d) => { d.project.customSections[0].id = 'C'.padEnd(25, 'x'); }, /id: must be a letter/],
    [(d) => { d.project.customSections.push({ ...d.project.customSections[0] }); }, /duplicate Cmethod/],
    [(d) => { d.project.sections.report = d.project.sections.report.filter((s) => !s.key.startsWith('custom-')); }, /must list each of/],
    [(d) => { d.project.sections.report.push({ key: 'custom-Corphan', label: 'Orphan', enabled: true }); }, /must list each of/],
    [(d) => { d.project.sections.report.find((s) => s.key === 'custom-Cmethod').label = 'Other'; }, /must be labelled with its title/],
    [(d) => { d.project.customSections[0].title = ' Spaced'; d.project.sections.report.find((s) => s.key === 'custom-Cmethod').label = ' Spaced'; }, /must not start or end with spaces/],
    [(d) => { d.project.customSections[0].title = 'x'.repeat(81); }, /longer than 80/],
    [(d) => { d.project.customSections[0].format = 'html'; }, /must be plain or code/],
    [(d) => { d.project.customSections[0].text = 'x'.repeat(LIMITS.text + 1); }, /longer than 20000/],
    [(d) => { d.project.customSections[0].extra = 1; }, /unknown field "extra"/],
    [(d) => { d.findings.push(finding(1, { cwe: 'cwe-79' })); d.project.nextFindingNumber = 2; }, /cwe: must look like CWE-79/],
    [(d) => { d.findings.push(finding(1, { cwe: 'CWE-123456' })); d.project.nextFindingNumber = 2; }, /cwe: must look like CWE-79/],
    [(d) => { d.findings.push(finding(1, { cwe: ' CWE-79' })); d.project.nextFindingNumber = 2; }, /cwe: must look like CWE-79/],
    [(d) => { d.findings.push(finding(1, { vulnerabilityType: 'x'.repeat(121) })); d.project.nextFindingNumber = 2; }, /longer than 120/],
    [(d) => { d.findings.push(finding(1, { vulnerabilityType: 'a\nb' })); d.project.nextFindingNumber = 2; }, /single line/],
    [(d) => { const f = finding(1); delete f.cwe; d.findings.push(f); d.project.nextFindingNumber = 2; }, /cwe: missing/],
    [(d) => { delete d.project.classificationDisplay; }, /classificationDisplay: missing/],
    [(d) => { d.project.classificationDisplay.counts = true; }, /unknown field "counts"/],
    [(d) => { delete d.project.labels.cwe; }, /labels\.cwe: missing/],
  ];
  for (const [mutate, re] of cases) {
    const d = withCustom();
    mutate(d);
    assert.match((await errorsOf(d)).join('\n'), re, re.source);
  }
  const v5 = createEmptyProjectV5(NOW);
  v5.project.customSections = [];
  assert.match((await errorsOf(v5)).join(), /unknown field "customSections"/);
  assert.equal((await openProjectFile(json({ ...createEmptyProject(NOW), schemaVersion: 7 }), 10)).newer, true);
});

test('ten sections with long titles, code text and Unicode fit and validate', async () => {
  const d = createEmptyProject(NOW);
  for (let i = 0; i < CUSTOM_LIMITS.sections; i++) {
    const id = newCustomSectionId();
    const title = `${i} ${'Ünïcødé 🔒 '.repeat(8)}`.slice(0, 78).trim();
    d.project.customSections.push({ id, title, text: i % 2 ? 'GET / HTTP/1.1\r\n\tHost: a' : `Text ${i}`, format: i % 2 ? 'code' : 'plain' });
    d.project.sections.report.push({ key: customKey(id), label: title, enabled: true });
  }
  assert.ok((await check(d)).ok, (await errorsOf(d)).join('\n'));
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  const plan = createReportPlan(d);
  const custom = plan.reportSections.filter((s) => s.key.startsWith('custom-'));
  assert.equal(custom.length, 10);
  assert.equal(new Set(custom.map((s) => s.anchor)).size, 10);
  assert.ok(custom.every((s) => s.anchor.length <= 38));
  assert.equal(custom[1].format, 'code');
});

test('the plan prints a custom section in stored order, only when on and not blank, linked once from Contents', () => {
  const d = withCustom();
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.project.scope = 'Scope';
  let plan = createReportPlan(d);
  const keys = plan.reportSections.map((s) => s.key);
  assert.equal(keys[0], 'contents');
  assert.equal(keys.indexOf('custom-Cmethod'), keys.indexOf('findingsSummary') - 1);
  const s = plan.reportSections.find((x) => x.key === 'custom-Cmethod');
  assert.deepEqual({ kind: s.kind, label: s.label, text: s.text, format: s.format, anchor: s.anchor },
    { kind: 'text', label: 'Methodology', text: 'We tested by hand.', format: 'plain', anchor: 'report_custom_Cmethod' });
  assert.equal(plan.contents.rows.filter((r) => r.anchor === 'report_custom_Cmethod').length, 1);
  // Moved first among the others: it follows Contents.
  const list = d.project.sections.report;
  list.splice(1, 0, ...list.splice(list.findIndex((x) => x.key === 'custom-Cmethod'), 1));
  plan = createReportPlan(d);
  assert.equal(plan.reportSections[1].key, 'custom-Cmethod');
  // Blank or hidden: nothing, and no Contents entry.
  d.project.customSections[0].text = ' \n ';
  assert.ok(!JSON.stringify(createReportPlan(d)).includes('report_custom_Cmethod'));
  d.project.customSections[0].text = 'Back';
  list.find((x) => x.key === 'custom-Cmethod').enabled = false;
  assert.ok(!JSON.stringify(createReportPlan(d)).includes('report_custom_Cmethod'));
});

test('classification: key facts by default, the optional summary column combines both or shows a dash', () => {
  const d = createEmptyProject(NOW);
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.project.scoring.mode = 'severity+cvss';
  d.project.findingStatusDisplay = { keyFacts: true, summaryColumn: true, counts: true };
  d.findings.push(finding(1, { cwe: 'CWE-79', vulnerabilityType: 'Stored cross-site scripting' }), finding(2, { cwe: 'CWE-89' }), finding(3, { vulnerabilityType: 'Weak TLS' }), finding(4));
  d.project.nextFindingNumber = 5;
  let plan = createReportPlan(d);
  assert.deepEqual(plan.findings[0].keyFacts.slice(-2).map((k) => [k.key, k.value]), [['vulnerabilityType', 'Stored cross-site scripting'], ['cwe', 'CWE-79']]);
  assert.ok(!plan.findings[3].keyFacts.some((k) => k.key === 'cwe' || k.key === 'vulnerabilityType'), 'empty values print nothing');
  assert.ok(!plan.summary.columns.some((c) => c.key === 'classification'));
  d.project.classificationDisplay = { keyFacts: false, summaryColumn: true };
  plan = createReportPlan(d);
  assert.ok(!plan.findings[0].keyFacts.some((k) => k.key === 'cwe'));
  assert.deepEqual(plan.summary.rows.map((r) => r.values.classification), ['Stored cross-site scripting (CWE-79)', 'CWE-89', 'Weak TLS', '–']);
  const widths = plan.summary.columns.map((c) => c.widthPct);
  assert.ok(widths.every((w) => w > 5), JSON.stringify(plan.summary.columns.map((c) => [c.key, Math.round(c.widthPct)])));
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.01);
  assert.ok(plan.summary.columns.find((c) => c.key === 'title').widthPct >= 18, 'the title keeps room');
  assert.equal(plan.summary.ratingCounts.distributions[0].total, 4, 'counts unchanged');
  // Summary off: no column.
  d.project.sections.report.find((s) => s.key === 'findingsSummary').enabled = false;
  assert.equal(createReportPlan(d).summary.columns.some((c) => c.key === 'classification'), false);
});

test('Word: the custom section heading, its bookmark and Contents link, and the classification key facts', async () => {
  const d = withCustom('Line one\n\n- a bullet');
  d.project.sections.report.forEach((s) => { s.enabled = true; });
  d.project.classificationDisplay.summaryColumn = true;
  d.findings.push(finding(1, { cwe: 'CWE-79', vulnerabilityType: 'Stored XSS' }));
  d.project.nextFindingNumber = 2;
  const xml = await (await JSZip.loadAsync(await exportDocx(d, {}))).file('word/document.xml').async('string');
  assert.match(xml, /w:name="report_custom_Cmethod"/);
  assert.match(xml, /w:anchor="report_custom_Cmethod"/);
  assert.match(xml, />Methodology</);
  assert.match(xml, />Stored XSS \(CWE‑79\)</);
  assert.match(xml, />CWE-79</);
  assert.match(xml, />Vulnerability type</);
});

test('New from settings keeps own sections\' names, order and format but not their text, never a finding\'s CWE or type', () => {
  const d = withCustom('Brightwater plans to fix the critical findings.', { format: 'code' });
  d.project.classificationDisplay = { keyFacts: false, summaryColumn: true };
  d.findings.push(finding(1, { cwe: 'CWE-79', vulnerabilityType: 'XSS' }));
  const next = projectFromSettings(d, NOW);
  assert.deepEqual(next.project.customSections, [{ id: 'Cmethod', title: 'Methodology', text: '', format: 'code' }]);
  assert.deepEqual(next.project.sections.report, d.project.sections.report);
  assert.deepEqual(next.project.classificationDisplay, { keyFacts: false, summaryColumn: true });
  assert.equal(next.findings.length, 0);
  assert.ok(SETTINGS_KEPT.some((s) => /own report sections .*text starts empty/.test(s)));
  assert.ok(SETTINGS_DROPPED.some((s) => /text of your own report sections/.test(s)));
  assert.ok(SETTINGS_DROPPED.some((s) => /CWE and vulnerability type/.test(s)));
});

test('Check & export scans custom sections; Copy as text always includes the classification', () => {
  const d = withCustom('Tested with [[tool]].');
  d.project.classificationDisplay.keyFacts = false;
  d.findings.push(finding(1, { cwe: 'CWE-79', vulnerabilityType: 'Stored XSS' }));
  d.project.nextFindingNumber = 2;
  assert.ok(checklist(d).some((w) => w.go === 'details' && /1 unfilled \[\[/.test(w.text)));
  const md = findingText(d, 0);
  assert.match(md, /\*\*Vulnerability type:\*\* Stored XSS/);
  assert.match(md, /\*\*CWE:\*\* CWE-79/);
});

test('library v3 keeps CWE and type; v1 and v2 entries open with none; bad values are refused', () => {
  assert.equal(LIBRARY_VERSION, 3);
  const f = finding(1, { cwe: 'CWE-79', vulnerabilityType: 'Stored XSS' });
  const { entry } = entryFromFinding(f);
  assert.equal(entry.cwe, 'CWE-79');
  const back = findingFromEntry(entry, 7);
  assert.deepEqual([back.id, back.cwe, back.vulnerabilityType, back.status], ['F-007', 'CWE-79', 'Stored XSS', 'open']);
  const lib = { format: 'fieldnote-library', libraryVersion: 3, entries: [entry] };
  assert.deepEqual(libraryErrors(JSON.parse(serializeLibrary(lib))), []);
  assert.match(libraryErrors({ ...lib, entries: [{ ...entry, cwe: 'CWE-x' }] }).join(), /cwe: must look like CWE-79/);
  const v2 = { format: 'fieldnote-library', libraryVersion: 2, entries: [{ ...entry }] };
  assert.match(libraryErrors(v2).join(), /unknown field "cwe"/, 'v2 rules unchanged');
  const { cwe, vulnerabilityType, ...plain } = entry;
  const opened = openLibraryFile(JSON.stringify({ ...v2, entries: [plain] }), 1000);
  assert.ok(opened.ok);
  assert.equal(opened.openedVersion, 2);
  const g = findingFromEntry(opened.library.entries[0], 2);
  assert.deepEqual([g.cwe, g.vulnerabilityType], ['', '']);
});
