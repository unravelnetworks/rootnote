// Check & export lists {client}/{application} left in report text: metadata, labels and section
// names (routed to Sections & scoring), vulnerability type, hidden sections and captions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checklist } from '../src/editor/checklist.js';

const sample = () => JSON.parse(readFileSync(new URL('../release-template/sample-project.rootnote.json', import.meta.url), 'utf8'));
const tokens = (doc) => checklist(doc).filter((w) => w.kind === 'token');

test('the sample has no name tokens', () => assert.deepEqual(tokens(sample()), []));

test('metadata, labels, section names, vulnerability type, hidden sections and captions are checked', () => {
  const s = sample();
  s.project.organisation = '{application} Ltd';
  s.project.labels.findings = '{client} findings';
  s.project.sections.finding.find((x) => x.key === 'threat').enabled = false;
  s.findings[0].threat = 'Hidden {client}';
  s.findings[0].vulnerabilityType = '{client} IDOR';
  s.images.find((im) => im.id === s.findings[0].details.find((b) => b.type === 'image').imageId).caption = 'From {application}';
  const w = tokens(s);
  assert.deepEqual(w.map((x) => [x.go, x.text]), [
    ['details', 'Unfilled {application} in Organisation. Replace it with the right name, or delete it.'],
    ['layout', 'Unfilled {client} in Labels. Replace it with the right name, or delete it.'],
    [s.findings[0].id, 'Unfilled {client} in Vulnerability type and Threat; {application} in captions. Replace each with the right name, or delete it.'],
  ]);
});

test('{{client}} is not a token', () => {
  const s = sample();
  s.findings[0].description += ' payload {{client}}';
  assert.deepEqual(tokens(s), []);
});
