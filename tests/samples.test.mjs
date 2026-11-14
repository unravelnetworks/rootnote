// The projects shipped with a release (release-template/): the sample in CVSS 3.1 and CVSS 4.0,
// and the starters, are saved in the current project format, so opening them converts nothing.
// The CVSS 4.0 sample is the 3.1 sample with only its scoring changed, and its committed Word
// report is the 4.0 one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { openProjectFile, SCHEMA_VERSION } from '../src/app/project.js';
import { parseCvss40 } from '../src/scoring/cvss40.js';

const read = (p) => readFileSync(new URL(`../release-template/${p}`, import.meta.url));
const projects = ['sample-project.rootnote.json', 'sample-project-cvss40.rootnote.json', 'starters/web-application-test.rootnote.json', 'starters/api-test.rootnote.json'];

test('shipped projects are in the current format and open without conversion', async () => {
  for (const name of projects) {
    const raw = read(name).toString('utf8');
    assert.equal(JSON.parse(raw).schemaVersion, SCHEMA_VERSION, name);
    const r = await openProjectFile(raw, Buffer.byteLength(raw), { appVersion: 'test' });
    assert.ok(r.ok, `${name}: ${(r.errors || []).join(' · ')}`);
    assert.equal(r.migratedFrom, null, name);
  }
});

test('the CVSS 4.0 sample is the 3.1 sample with only its scoring changed', () => {
  const v31 = JSON.parse(read('sample-project.rootnote.json'));
  const v40 = JSON.parse(read('sample-project-cvss40.rootnote.json'));
  assert.equal(v40.project.scoring.cvssVersion, '4.0');
  assert.equal(v40.project.labels.cvss, 'CVSS 4.0 Base');
  assert.match(v40.project.ratingMethod.text, /CVSS 4\.0 Base is the score/);
  v40.findings.forEach((f, i) => {
    const old = v31.findings[i];
    assert.equal(!!f.cvss, !!old.cvss, `${f.id}: scored in one version only`);
    if (f.cvss) assert.ok(f.cvss.startsWith('CVSS:4.0/') && parseCvss40(f.cvss).score !== undefined, `${f.id}: ${f.cvss}`);
  });
  // Everything else is identical.
  const strip = (d) => ({ ...d, project: { ...d.project, scoring: null, labels: { ...d.project.labels, cvss: null }, ratingMethod: null }, findings: d.findings.map((f) => ({ ...f, cvss: null })) });
  assert.deepEqual(strip(v40), strip(v31));
});

test('the committed CVSS 4.0 Word report shows CVSS 4.0 only', async () => {
  const text = (await (await JSZip.loadAsync(read('sample-report-cvss40.docx'))).file('word/document.xml').async('string')).replace(/<[^>]+>/g, '');
  assert.match(text, /CVSS 4\.0 Base/);
  assert.equal((text.match(/CVSS:4\.0\//g) || []).length, 6);
  // Each scored finding's score and vector, as in the project.
  const v40 = JSON.parse(read('sample-project-cvss40.rootnote.json'));
  const scored = v40.findings.filter((f) => f.cvss).map((f) => [f.id, parseCvss40(f.cvss).score.toFixed(1), f.cvss]);
  assert.deepEqual(scored.map(([, s]) => s), ['9.3', '8.6', '8.4', '5.3', '6.9', '2.3']);
  for (const [id, score, vector] of scored) assert.ok(text.includes(score + vector), `${id}: ${score} ${vector} not in the Word report`);
  assert.doesNotMatch(text, /CVSS 3\.1|CVSS:3\.1/);
});
