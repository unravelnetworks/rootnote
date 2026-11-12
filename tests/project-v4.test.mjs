// Project schema v4 model:
// v4 defaults, the v3 -> v4 migration, references rules (rule 18), statuses, and opening v4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  createEmptyProject, createEmptyProjectV3, createEmptyProjectV4, migrateV2toV3, migrateV3toV4, migrateV4toV5, migrateV5toV6, migrateV6toV7, openProjectFile, validateProjectFile, validateProjectFileV4,
  REPORT_SECTIONS_V4, FINDING_SECTIONS_V4, FINDING_STATUSES, ENGAGEMENT_STATUSES, findingId,
} from '../src/app/project.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/project.v4.schema.json', import.meta.url), 'utf8'));
const json = (d) => JSON.stringify(d);
const v4 = async (d) => validateProjectFileV4(json(d), Buffer.byteLength(json(d)));
const errorsOf = async (d) => (await v4(d)).errors ?? [];
const finding = (n, extra = {}) => ({
  id: findingId(n), title: `Finding ${n}`, rating: null, cvss: null, formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' },
  details: [], evidence: [], status: 'open', ...extra,
});
const withFinding = (extra) => { const d = createEmptyProjectV4(); d.findings.push(finding(1, extra)); d.project.nextFindingNumber = 2; return d; };
const ref = (title = 'OWASP WSTG v4.2 WSTG-ATHZ-04', url = 'https://owasp.org/') => ({ title, url });

async function v3Fixture() {
  const raw = await fs.readFile(new URL('./fixtures/v2-small.json', import.meta.url), 'utf8');
  const v3 = migrateV2toV3(JSON.parse(raw), { appVersion: 'test' });
  assert.ok((await validateProjectFile(JSON.stringify(v3), Buffer.byteLength(JSON.stringify(v3)))).ok);
  return v3;
}

test('the frozen v4 schema is the signed one and names the new fields', () => {
  assert.equal(schema.properties.schemaVersion.const, 4);
  assert.deepEqual(schema.properties.project.properties.sections.properties.report.items.properties.key.enum, [...REPORT_SECTIONS_V4.slice(1), 'contents']);
  assert.deepEqual(schema.properties.project.properties.sections.properties.finding.items.properties.key.enum, [...FINDING_SECTIONS_V4]);
  assert.deepEqual(schema.properties.findings.items.properties.status.enum, [...FINDING_STATUSES, null]);
  assert.deepEqual(schema.properties.project.properties.engagementStatus.enum, [...ENGAGEMENT_STATUSES, null]);
});

test('a new v4 project: Draft, status in key facts only, Contents first and off, References last and on', async () => {
  const d = createEmptyProjectV4(new Date('2026-11-02T00:00:00.000Z'));
  assert.deepEqual(await v4(d), { ok: true, project: d });
  assert.equal(d.project.engagementStatus, 'draft');
  assert.deepEqual(d.project.findingStatusDisplay, { keyFacts: true, summaryColumn: false, counts: false });
  assert.deepEqual(d.project.sections.report[0], { key: 'contents', label: 'Contents', enabled: false });
  assert.deepEqual(d.project.sections.finding.at(-1), { key: 'references', label: 'References', enabled: true });
  assert.equal(d.project.sections.finding.find((s) => s.key === 'evidence').enabled, false);
  assert.equal(d.project.labels.status, 'Status');
  assert.equal(d.project.labels.statusNotSet, 'Not set');
});

test('v3 -> v4 adds only the new fields, guesses no status, and leaves the source untouched', async () => {
  const v3 = await v3Fixture();
  const before = structuredClone(v3);
  const out = migrateV3toV4(v3);
  assert.deepEqual(v3, before, 'source not mutated');
  assert.ok((await v4(out)).ok, (await errorsOf(out)).join('; '));
  assert.equal(out.schemaVersion, 4);
  assert.equal(out.project.engagementStatus, null);
  assert.deepEqual(out.project.findingStatusDisplay, { keyFacts: false, summaryColumn: false, counts: false });
  assert.deepEqual(out.project.sections.report.slice(0, 4), v3.project.sections.report, 'old report order kept');
  assert.deepEqual(out.project.sections.report[4], { key: 'contents', label: 'Contents', enabled: false });
  assert.deepEqual(out.project.sections.finding.slice(0, 7), v3.project.sections.finding);
  assert.deepEqual(out.project.sections.finding[7], { key: 'references', label: 'References', enabled: true });
  out.findings.forEach((f, i) => {
    const { status, ...rest } = f;
    assert.equal(status, null);
    assert.deepEqual(rest, v3.findings[i], 'every v3 finding value identical, no references added');
    assert.ok(!('references' in f));
  });
  const { engagementStatus, findingStatusDisplay, sections, labels, ...meta } = out.project;
  const { sections: s3, labels: l3, ...meta3 } = v3.project;
  assert.deepEqual(meta, meta3);
  assert.deepEqual({ ...labels, status: undefined, statusNotSet: undefined }, { ...l3, status: undefined, statusNotSet: undefined });
  for (const k of ['createdAt', 'savedAt', 'appVersion']) assert.equal(out[k], v3[k], k);
  assert.deepEqual(out.images, v3.images);
});

test('a v4 project opens converted through v5 and v6 to v7 with nothing else changed; the v4-only validator refuses other versions', async () => {
  // New projects are v5 since R5 B2 (project-v5.test.mjs); v4 files are converted on open.
  const d = createEmptyProjectV4();
  assert.equal(d.schemaVersion, 4);
  const r = await openProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.equal(r.migratedFrom, 4);
  assert.deepEqual(r.project, migrateV6toV7(migrateV5toV6(migrateV4toV5(d))));
  assert.equal(createEmptyProject().schemaVersion, 7);
  const later = { ...d, schemaVersion: 8 };
  assert.equal((await openProjectFile(json(later), Buffer.byteLength(json(later)))).newer, true);
  const v3 = createEmptyProjectV3();
  assert.deepEqual((await validateProjectFileV4(json(v3), Buffer.byteLength(json(v3)))).errors, ['Not a schema v4 project file.']);
});

test('finding status: every value and null; anything else, or missing, is refused', async () => {
  for (const status of [...FINDING_STATUSES, null]) assert.ok((await v4(withFinding({ status }))).ok, String(status));
  for (const status of ['null', '', 'Open', 'OPEN', 'partly fixed', 'closed', 0, false]) {
    assert.match((await errorsOf(withFinding({ status }))).join(), /status: must be one of/, JSON.stringify(status));
  }
  const d = withFinding();
  delete d.findings[0].status;
  assert.match((await errorsOf(d)).join(), /findings\[0\]\.status: missing/);
});

test('engagement status and status display: exact values and keys', async () => {
  for (const s of [...ENGAGEMENT_STATUSES, null]) { const d = createEmptyProjectV4(); d.project.engagementStatus = s; assert.ok((await v4(d)).ok, String(s)); }
  for (const s of ['null', 'Draft', 'in review', '']) { const d = createEmptyProjectV4(); d.project.engagementStatus = s; assert.match((await errorsOf(d)).join(), /engagementStatus: must be one of/); }
  const missing = createEmptyProjectV4(); delete missing.project.engagementStatus;
  assert.match((await errorsOf(missing)).join(), /engagementStatus: missing/);
  const extra = createEmptyProjectV4(); extra.project.findingStatusDisplay.filter = true;
  assert.match((await errorsOf(extra)).join(), /unknown field "filter"/);
  const gone = createEmptyProjectV4(); delete gone.project.findingStatusDisplay.counts;
  assert.match((await errorsOf(gone)).join(), /findingStatusDisplay\.counts: missing/);
  const notBool = createEmptyProjectV4(); notBool.project.findingStatusDisplay.keyFacts = 'yes';
  assert.match((await errorsOf(notBool)).join(), /keyFacts: must be true or false/);
});

test('sections, labels and the engagementStatus bound row', async () => {
  const noContents = createEmptyProjectV4(); noContents.project.sections.report.shift();
  assert.match((await errorsOf(noContents)).join(), /sections\.report: must list each/);
  const dup = createEmptyProjectV4(); dup.project.sections.finding[7] = { key: 'assets', label: 'X', enabled: true };
  assert.match((await errorsOf(dup)).join(), /sections\.finding\[7\]\.key/);
  const v3Shape = createEmptyProjectV4(); v3Shape.project.sections.finding.pop();
  assert.match((await errorsOf(v3Shape)).join(), /sections\.finding: must list each/);
  for (const [v, re] of [['', /labels\.status: must not be empty/], ['x'.repeat(81), /labels\.status: longer than 80/]]) {
    const d = createEmptyProjectV4(); d.project.labels.status = v; assert.match((await errorsOf(d)).join(), re);
  }
  const row = createEmptyProjectV4(); row.project.engagement.rows.push({ source: 'engagementStatus', label: 'Engagement status', enabled: true });
  assert.ok((await v4(row)).ok);
  const twice = structuredClone(row); twice.project.engagement.rows.push({ source: 'engagementStatus', label: 'Again', enabled: true });
  assert.match((await errorsOf(twice)).join(), /engagementStatus appears more than once/);
  const valued = createEmptyProjectV4(); valued.project.engagement.rows.push({ source: 'engagementStatus', label: 'S', enabled: true, value: 'Draft' });
  assert.match((await errorsOf(valued)).join(), /unknown field "value"/);
});

test('references: counts, summed length, titles and addresses (rule 18)', async () => {
  assert.ok((await v4(withFinding({ references: [] }))).ok);
  assert.ok((await v4(withFinding({ references: Array.from({ length: 20 }, (_, i) => ref(`Ref ${i}`)) }))).ok);
  assert.match((await errorsOf(withFinding({ references: Array.from({ length: 21 }, (_, i) => ref(`Ref ${i}`)) }))).join(), /references: must be a list of at most 20/);
  // 20,000 units exactly across titles and URLs, then one more.
  const fill = (n) => Array.from({ length: 20 }, (_, i) => ref('t'.repeat(300), `https://e.org/${'a'.repeat(n - 300 - 14 - String(i).length)}${i}`));
  const exact = fill(1000);
  assert.equal(exact.reduce((s, r) => s + r.title.length + r.url.length, 0), 20000);
  assert.ok((await v4(withFinding({ references: exact }))).ok);
  const over = structuredClone(exact); over[0].title += 'x';
  assert.match((await errorsOf(withFinding({ references: over }))).join(), /total 20001 characters; the limit is 20000/);

  const titleCases = [['', /must not be empty/], ['  ', /must not be empty/], [' a', /must not start or end with spaces/], ['a ', /must not start or end/],
    ['a\nb', /single line/], ['a\rb', /single line/], ['t'.repeat(301), /longer than 300/]];
  for (const [title, re] of titleCases) assert.match((await errorsOf(withFinding({ references: [ref(title)] }))).join(), re, JSON.stringify(title));
  assert.ok((await v4(withFinding({ references: [ref('𝔘 astral ✓')] }))).ok);

  const goodUrls = ['', 'https://owasp.org/x?y=1#z', 'HTTP://Example.org', 'https://10.0.0.5:8443/policy', `https://e.org/${'a'.repeat(2048 - 14)}`];
  for (const url of goodUrls) assert.ok((await v4(withFinding({ references: [ref('T', url)] }))).ok, url.slice(0, 40));
  const badUrls = [['ftp://e.org', /http/], ['javascript:alert(1)', /http/], ['file:///C:/x', /http/], ['data:text/html,x', /http/], ['//e.org', /http/],
    ['e.org/x', /http/], ['http:e.org', /http/], ['https://user:pw@e.org', /user name or password/], ['https://e.org/a b', /spaces or control/],
    ['https://e.org/\t', /spaces or control/], ['https://e.org/\u007f', /spaces or control/], [`https://e.org/${'a'.repeat(2048 - 13)}`, /longer than 2048/]];
  for (const [url, re] of badUrls) assert.match((await errorsOf(withFinding({ references: [ref('T', url)] }))).join(), re, url.slice(0, 40));
  assert.match((await errorsOf(withFinding({ references: [ref('T', 'https://e.org/\uFFFE')] }))).join(), /cannot be written to Word/);
  assert.match((await errorsOf(withFinding({ references: [{ title: 'T' }] }))).join(), /url: missing/);
  assert.match((await errorsOf(withFinding({ references: [{ ...ref(), note: 'x' }] }))).join(), /unknown field "note"/);
});

test('v3 files stay frozen: v4-only fields are refused there', async () => {
  const d = createEmptyProjectV3();
  d.project.engagementStatus = 'draft';
  const r = await validateProjectFile(json(d), Buffer.byteLength(json(d)));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown field "engagementStatus"/);
});

test('reference rules refuse text Word cannot store, so the editor can never store it', async () => {
  const { referenceUrlErrors, referenceTitleErrors } = await import('../src/app/project.js');
  for (const bad of ['￾', '￿', '\uD800', '\uDC00x']) {
    assert.ok(referenceUrlErrors(`https://e.org/${bad}`).some((m) => /cannot be written to Word/.test(m)), JSON.stringify(bad));
    assert.ok(referenceTitleErrors(`Title ${bad}`).some((m) => /cannot be written to Word/.test(m)), JSON.stringify(bad));
  }
  assert.deepEqual(referenceUrlErrors('https://e.org/\u{1D518}'), [], 'astral characters are fine');
  assert.deepEqual(referenceTitleErrors('Ref \u{1D518}'), []);
});
