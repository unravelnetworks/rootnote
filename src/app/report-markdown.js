// The whole report as one Markdown file, for wikis, Git and ticket systems. Built from the
// report plan, so section names, order, hidden sections and finding IDs match the Word report.
// Text stays literal by the same rules as one finding (finding-text.js). Screenshots become
// placeholders naming the figure; images are never embedded. The table of contents and the
// count tables are left out: Markdown viewers build their own navigation.
import { createReportPlan } from '../export-docx/plan.js';
import { escapeMd, body, findingBlock } from './finding-text.js';

// A table cell is one line: line breaks become spaces, and escapeMd already escapes "|".
const cell = (v) => escapeMd(String(v ?? '').replace(/\s*\n\s*/g, ' ').trim()) || ' ';

function summaryTable(summary) {
  const head = summary.columns.map((c) => cell(c.label));
  const rows = summary.rows.map((r) => summary.columns.map((c) => cell(r.values[c.key])));
  return [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

/** Markdown for the whole report of `project`. */
export function reportMarkdown(project) {
  const plan = createReportPlan(project);
  const m = plan.metadata;
  const out = [`# ${escapeMd(m.title || '(untitled report)')}`];
  if (m.subtitle) out.push(escapeMd(m.subtitle));
  if (plan.cover.details.length) out.push(plan.cover.details.map((d) => `- **${escapeMd(d.label)}:** ${escapeMd(d.value)}`).join('\n'));

  for (const s of plan.reportSections) {
    let content = '';
    if (s.kind === 'contents') continue;
    if (s.kind === 'summary') content = plan.findings.length ? summaryTable(plan.summary) : '';
    else if (s.kind === 'engagement') content = s.rows.map((r) => `- **${escapeMd(r.label)}:** ${r.format === 'code' ? escapeMd(r.value.replace(/\s*\n\s*/g, ' ')) : escapeMd(r.value).replace(/\n/g, '  \n  ')}`).join('\n');
    else content = body(s.text, s.format, true);
    if (plan.summary.statusNote && s.kind === 'summary' && content) content += `\n\n*${escapeMd(plan.summary.statusNote)}*`;
    out.push(`## ${escapeMd(s.label)}`);
    if (content.trim()) out.push(content);
  }

  if (plan.findings.length) {
    out.push(`## ${escapeMd(plan.labels.findings)}`);
    for (const f of plan.findings) out.push(findingBlock(plan, f, true, 3));
  }
  return out.join('\n\n') + '\n';
}
