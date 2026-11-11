// The whole report as one Markdown file, for wikis, Git and ticket systems. Built from the
// report plan, so section names, order, hidden sections, key facts and finding IDs match the
// Word report. Text stays literal by the same rules as one finding (finding-text.js). Screenshots
// become placeholders naming the figure; images are never embedded. The table of contents and
// the count tables are left out: Markdown viewers build their own navigation.
import { createReportPlan } from '../export-docx/plan.js';
import { escapeMd, body, fence, findingBlock } from './finding-text.js';

// A table cell is one line: line breaks become spaces, and escapeMd already escapes "|".
const cell = (v) => escapeMd(String(v ?? '').replace(/\s*\n\s*/g, ' ').trim()) || ' ';

function summaryTable(summary) {
  const head = summary.columns.map((c) => cell(c.label));
  const rows = summary.rows.map((r) => summary.columns.map((c) => cell(r.values[c.key])));
  return [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

// Metadata is never formatted: a subtitle such as "- Draft", "1. Final" or "---" stays text,
// not a list or a rule. Lines keep their breaks.
const literalLines = (s) => s.trim().split('\n')
  .map((line) => escapeMd(line).replace(/^(\d+)([.)])/, '$1\\$2').replace(/^([+=-])/, '\\$1'))
  .join('  \n');

// A code row keeps every character in a fence under its label; other rows stay on the list line.
// The fence is indented after each whole line break, so a CRLF pair is never split.
function engagementRow(r) {
  const label = `- **${escapeMd(r.label)}:**`;
  if (r.format === 'code') return `${label}\n\n${fence(r.value).replace(/(^|\r\n|\n|\r)/g, '$1  ')}\n`;
  return `${label} ${escapeMd(r.value).replace(/\n/g, '  \n  ')}`;
}

/** Markdown for the whole report of `project`. */
export function reportMarkdown(project) {
  const plan = createReportPlan(project);
  const m = plan.metadata;
  const out = [`# ${escapeMd(m.title || '(untitled report)')}`];
  if (m.subtitle) out.push(literalLines(m.subtitle));
  if (plan.cover.details.length) out.push(plan.cover.details.map((d) => `- **${escapeMd(d.label)}:** ${escapeMd(d.value)}`).join('\n'));

  for (const s of plan.reportSections) {
    let content = '';
    if (s.kind === 'contents') continue;
    if (s.kind === 'summary') content = plan.findings.length ? summaryTable(plan.summary) : '';
    else if (s.kind === 'engagement') content = s.rows.map(engagementRow).join('\n');
    else content = body(s.text, s.format, true);
    if (plan.summary.statusNote && s.kind === 'summary' && content) content += `\n\n*${escapeMd(plan.summary.statusNote)}*`;
    out.push(`## ${escapeMd(s.label)}`);
    if (content.trim()) out.push(content);
  }

  if (plan.findings.length) {
    out.push(`## ${escapeMd(plan.labels.findings)}`);
    // Key facts exactly as the Word report shows them (no ticket-handoff extras).
    for (const f of plan.findings) out.push(findingBlock(plan, f, true, 3, { handoff: false }));
  }
  return out.join('\n\n') + '\n';
}
