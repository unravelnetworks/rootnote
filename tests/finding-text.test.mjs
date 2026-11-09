// A2: one finding as Markdown or plain text. Literal text survives, fences cannot be closed by
// the evidence itself, screenshots are placeholders, and Sections & scoring decides what is included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findingText } from '../src/app/finding-text.js';
import { createReportPlan } from '../src/export-docx/plan.js';

const sample = () => JSON.parse(readFileSync(new URL('../release-template/sample-project.rootnote.json', import.meta.url), 'utf8'));
const details = (p, i) => p.findings[i].details;

test('Markdown follows the report: display ID, key facts, section names and order', () => {
  const p = sample();
  const plan = createReportPlan(p);
  const md = findingText(p, 0);
  assert.ok(md.startsWith(`## ${plan.findings[0].displayId} `));
  assert.match(md, /- \*\*Severity:\*\* Critical/);
  assert.match(md, /\(`CVSS:3\.1\/AV:N[^`]*`\)/);
  assert.match(md, /- \*\*Status:\*\* Open/);
  const headings = [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, plan.findings[0].sections.map((s) => s.label));
});

test('a section hidden in Sections & scoring is left out, and a renamed one uses its new name', () => {
  const p = sample();
  p.project.sections.finding.find((s) => s.key === 'threat').enabled = false;
  p.project.sections.finding.find((s) => s.key === 'impact').label = 'Business impact';
  const md = findingText(p, 0);
  assert.doesNotMatch(md, /^### Threat$/m);
  assert.match(md, /^### Business impact$/m);
});

test('code is copied byte for byte inside a fence its own backticks cannot close', () => {
  const p = sample();
  const code = 'GET /x?q=```&t=\té\u{1D518} HTTP/1.1\n==not a mark== *not bold* <script>\n````';
  details(p, 0).unshift({ id: 'BLK-9001', type: 'text', text: code, format: 'code' });
  const md = findingText(p, 0);
  assert.ok(md.includes(`\`\`\`\`\`\n${code}\n\`\`\`\`\``), 'five-backtick fence around a four-backtick run');
  assert.ok(findingText(p, 0, { markdown: false }).includes(code), 'plain text keeps it as typed');
});

test('plain paragraphs are escaped in Markdown so they display as typed, but not in plain text', () => {
  const p = sample();
  p.findings[0].description = '# not a heading *x* _y_ [z](u) <b>\n1. not a list\n---\n- a real bullet';
  const md = findingText(p, 0);
  assert.match(md, /\\# not a heading \\\*x\\\* \\_y\\_ \\\[z\\\]\(u\) \\<b\\>/);
  assert.match(md, /^1\\\. not a list {2}$/m);
  assert.match(md, /^\\---$/m);
  assert.match(md, /^- a real bullet$/m);
  assert.ok(findingText(p, 0, { markdown: false }).includes(p.findings[0].description));
});

test('screenshots become numbered placeholders in their place; nothing is embedded', () => {
  const p = sample();
  const md = findingText(p, 0);
  assert.match(md, /\*\[Figure 1: [^\]]+ \(screenshot not included\)\]\*/);
  assert.doesNotMatch(md, /data:image|base64/);
  const order = findingText(p, 0, { markdown: false });
  assert.ok(order.indexOf('[Figure 1') > order.indexOf('2. The response contains'), 'figure follows the step that introduces it');
});

test('assets and reference addresses are code spans or autolinks, never rewritten', () => {
  const p = sample();
  p.findings[0].affectedAssets = ['GET /a_b*c`d'];
  p.findings[0].references = [{ title: 'T_1', url: 'https://e.org/a_b' }, { title: 'No address', url: '' }];
  const md = findingText(p, 0);
  assert.match(md, /^- ``GET \/a_b\*c`d``$/m);
  assert.match(md, /^- T\\_1: <https:\/\/e\.org\/a_b>$/m);
  assert.match(md, /^- No address$/m);
});

test('the status is included even when the report hides it in key facts', () => {
  const p = sample();
  p.project.findingStatusDisplay.keyFacts = false;
  assert.match(findingText(p, 2), /- \*\*Status:\*\* Partly fixed/);
});
