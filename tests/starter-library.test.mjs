// Built-in OWASP starter library and starter projects: valid library v1,
// read-only, empty rating and CVSS, versioned references, [[...]] prompts flagged by the checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STARTER_LIBRARY, countPrompts } from '../src/app/starter-library.js';
import { libraryErrors, findingFromEntry } from '../src/app/library.js';
import { createEmptyProject, validateProjectFile } from '../src/app/project.js';
import { checklist } from '../src/editor/checklist.js';

const texts = (e) => [e.title, e.description, e.impact, e.threat, e.recommendation, ...(e.affectedAssets || []), ...e.details.map((b) => b.text), ...(e.references || []).flatMap((r) => [r.title, r.url])];

test('the starter library is a valid library v1 file and frozen', () => {
  // The reviewed starter catalog, library v2, copied byte for byte.
  assert.equal(STARTER_LIBRARY.libraryVersion, 2);
  assert.equal(STARTER_LIBRARY.entries.length, 12);
  // References are structured, led by the selection prompt row; no old References block remains.
  for (const e of STARTER_LIBRARY.entries) {
    assert.deepEqual(e.references[0], { title: '[[keep only the references that match the tested case, then delete this row]]', url: '' }, e.name);
    assert.ok(!e.details.some((b) => /^References:/m.test(b.text)), e.name);
  }
  assert.deepEqual(libraryErrors(JSON.parse(JSON.stringify(STARTER_LIBRARY))), []);
  assert.ok(Object.isFrozen(STARTER_LIBRARY.entries));
  for (const e of STARTER_LIBRARY.entries) assert.ok(Object.isFrozen(e));
});

test('starter entries leave rating and CVSS to the tester and cite versioned references', () => {
  for (const e of STARTER_LIBRARY.entries) {
    assert.equal(e.rating, null, e.name);
    assert.equal(e.cvss, null, e.name);
    const all = texts(e).join('\n');
    assert.match(all, /OWASP (Top 10:2025|Top 10 2025|API Security Top 10 2023|API Security Top 10:2023)|WSTG/, `${e.name}: no versioned OWASP reference`);
    assert.match(all, /CWE-\d+/, `${e.name}: no CWE reference`);
    assert.ok(countPrompts(all) > 0, `${e.name}: no [[observation]] prompt`);
    // Tester guidance that is not a [[prompt]] would survive into the delivered report.
    assert.doesNotMatch(all, /candidate classification|API use case|related testing guidance|Evidence to complete/, `${e.name}: unflagged tester guidance`);
    assert.doesNotMatch(all, /endorsed by OWASP|OWASP[- ]certified|OWASP[- ]compliant/i, `${e.name}: endorsement or compliance claim`);
  }
});

test('prompts are counted; ordinary brackets are not', () => {
  assert.equal(countPrompts('a [[host]] b [[observed response]]'), 2);
  assert.equal(countPrompts('array[0] and [link](x) and [[]]'), 0);
  assert.equal(countPrompts(undefined), 0);
});

test('the checklist flags unfilled prompts in report details and findings, without blocking', () => {
  const doc = createEmptyProject();
  doc.project.scope = 'In scope: [[application URL]]';
  doc.findings.push({ ...findingFromEntry({ title: 'Example', rating: null, cvss: null, affectedAssets: ['[[endpoint]]'], description: 'Seen at [[URL]].',
    recommendation: 'Fix it.', formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, details: [{ type: 'text', text: 'Request: [[request]]', format: 'plain' }] }, 1) });
  const w = checklist(doc).filter((x) => /unfilled \[\[/.test(x.text));
  assert.deepEqual(w.map((x) => [x.where, x.text]), [
    ['Details & cover', '1 unfilled [[…]] prompt: replace it with what you observed, or delete it.'],
    ['F-1 Example', '3 unfilled [[…]] prompts: replace each with what you observed, or delete them.'],
  ]);
});

for (const name of ['web-application-test', 'api-test']) {
  test(`starter project ${name} opens, has no findings and flags its prompts`, async () => {
    const raw = readFileSync(new URL(`../release-template/starters/${name}.rootnote.json`, import.meta.url), 'utf8');
    const v = await validateProjectFile(raw, Buffer.byteLength(raw));
    assert.ok(v.ok, v.errors?.join('; '));
    const doc = JSON.parse(raw);
    assert.equal(doc.findings.length, 0);
    assert.equal(doc.images.length, 0);
    assert.ok(checklist(doc).some((x) => x.where === 'Details & cover' && /unfilled \[\[/.test(x.text)));
  });
}

test('the checklist scans reference titles and addresses for prompts and flags duplicates (v4)', () => {
  const doc = createEmptyProject();
  const f = findingFromEntry({ title: 'Example', rating: null, cvss: null, description: 'd', recommendation: 'r',
    formats: { description: 'plain', impact: 'plain', threat: 'plain', recommendation: 'plain' }, details: [] }, 1);
  f.references = [{ title: '[[keep only the references that match the tested case, then delete this row]]', url: '' },
    { title: 'CWE-639', url: 'https://cwe.mitre.org/data/definitions/639.html' }, { title: 'CWE-639', url: 'https://cwe.mitre.org/data/definitions/639.html' }];
  doc.findings.push(f);
  const w = checklist(doc).filter((x) => x.where.startsWith('F-1'));
  assert.ok(w.some((x) => x.text === '1 unfilled [[…]] prompt: replace it with what you observed, or delete it.'));
  assert.ok(w.some((x) => x.text === '1 duplicate reference in References.'));
});
