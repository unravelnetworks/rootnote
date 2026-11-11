// The whole report as Markdown: same sections, order and IDs as the Word report, literal text,
// table cells that cannot break the table, and screenshots as placeholders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportMarkdown } from '../src/app/report-markdown.js';
import { findingText } from '../src/app/finding-text.js';
import { createReportPlan } from '../src/export-docx/plan.js';

const sample = () => JSON.parse(readFileSync(new URL('../release-template/sample-project.rootnote.json', import.meta.url), 'utf8'));

test('headings follow the report plan: report sections, then Findings, then each finding', () => {
  const p = sample();
  const plan = createReportPlan(p);
  const md = reportMarkdown(p);
  assert.ok(md.startsWith(`# ${plan.metadata.title}\n`));
  const h2 = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(h2, [...plan.reportSections.filter((s) => s.kind !== 'contents').map((s) => s.label), plan.labels.findings]);
  const h3 = [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(h3, plan.findings.map((f) => `${f.displayId} ${f.title}`));
});

test('each finding matches the single-finding export, one heading level deeper', () => {
  const p = sample();
  const md = reportMarkdown(p);
  const one = findingText(p, 1).replace(/^(#+) /gm, '#$1 ');
  assert.ok(md.includes(one.trimEnd()), 'finding 2 appears exactly as the copy-as-Markdown output, shifted one level');
});

test('the summary is a table with one row per finding, and a "|" in a title cannot split a cell', () => {
  const p = sample();
  p.findings[0].title = 'Pipe | in title\nand a line break';
  const md = reportMarkdown(p);
  const table = md.split('\n').filter((l) => l.startsWith('| '));
  assert.equal(table.length, 2 + p.findings.length);
  const cols = (l) => l.replace(/\\\|/g, '').split('|').length;
  assert.ok(table.every((l) => cols(l) === cols(table[0])), 'every row has the same number of cells');
  assert.match(table[2], /Pipe \\\| in title and a line break/);
});

test('sections hidden in Sections & scoring are left out', () => {
  const p = sample();
  p.project.sections.report.find((s) => s.key === 'scope').enabled = false;
  p.project.sections.finding.find((s) => s.key === 'threat').enabled = false;
  const md = reportMarkdown(p);
  assert.doesNotMatch(md, /^## Scope$/m);
  assert.doesNotMatch(md, /^#### Threat$/m);
});

test('no image data is embedded; every screenshot is a placeholder', () => {
  const p = sample();
  const md = reportMarkdown(p);
  assert.doesNotMatch(md, /data:image|base64|!\[/);
  assert.ok((md.match(/screenshot not included/g) ?? []).length > 0);
});

test('a report with no findings has no Findings heading and no empty table', () => {
  const p = sample();
  p.findings = [];
  const md = reportMarkdown(p);
  assert.doesNotMatch(md, /^## Findings$/m);
  assert.doesNotMatch(md, /^\| /m);
});

test('key facts the Word report hides stay hidden; Copy as Markdown for one finding still adds them', () => {
  const p = sample();
  p.project.findingStatusDisplay = { keyFacts: false, summaryColumn: false, counts: false };
  p.project.classificationDisplay = { keyFacts: false, summaryColumn: false };
  p.findings[0].vulnerabilityType = 'HIDDEN-CLASSIFICATION-PROBE';
  const md = reportMarkdown(p);
  assert.doesNotMatch(md, /\*\*Status:\*\*/);
  assert.doesNotMatch(md, /HIDDEN-CLASSIFICATION-PROBE/);
  const one = findingText(p, 0);
  assert.match(one, /\*\*Status:\*\*/);
  assert.match(one, /HIDDEN-CLASSIFICATION-PROBE/);
});

test('a subtitle that looks like a list or a rule stays literal text', () => {
  for (const subtitle of ['- Draft', '1. Final', '---', '+ v2']) {
    const p = sample();
    p.project.subtitle = subtitle;
    const line = reportMarkdown(p).split('\n')[2];
    assert.ok(!/^([-+*]\s|\d+[.)]\s|---$)/.test(line), `${subtitle} -> ${line}`);
  }
});

test('a code engagement row keeps every character in a fence', () => {
  const p = sample();
  const row = p.project.engagement.rows.find((x) => x.source === 'custom');
  row.enabled = true;
  row.format = 'code';
  row.label = 'Code row';
  row.value = 'GET /literal HTTP/1.1\n\tX-Header: value\n- body ```` end';
  const md = reportMarkdown(p);
  const start = md.indexOf('- **Code row:**');
  const block = md.slice(start, md.indexOf('\n\n', md.indexOf('`````', start) + 5) + 1 || undefined);
  const inner = block.split('\n').slice(3, -2).map((l) => l.slice(2)).join('\n');
  assert.equal(inner, row.value);
  assert.match(block, /`{5}/, 'fence longer than the four-backtick run inside');
});
