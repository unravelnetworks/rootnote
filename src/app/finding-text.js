// One finding as Markdown or plain text, to paste into an issue tracker or a bounty form.
// Built from the report plan, so the ID, labels, section order and hidden sections
// match the report. Text stays literal: Markdown escapes the characters it would otherwise
// format, code goes in a fence longer than any backtick run inside it, and assets and
// addresses go in code spans. Screenshots become placeholders naming the figure; images are
// never embedded.
import { createReportPlan } from '../export-docx/plan.js';

const ESCAPE = /[\\`*_[\]<>|#~]/g;
export const escapeMd = (s) => s.replace(ESCAPE, '\\$&');
const longestRun = (s) => Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
export const codeSpan = (s) => {
  const ticks = '`'.repeat(longestRun(s) + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${s}${pad}${ticks}`;
};
export const fence = (s) => {
  const ticks = '`'.repeat(Math.max(3, longestRun(s) + 1));
  return `${ticks}\n${s}\n${ticks}`;
};
const isBullet = (line) => /^- /.test(line);

/** Text of a plain or code field, following the report's rules: a blank line starts a
 * paragraph and a line starting with "- " is a bullet. */
export function body(text, format, md) {
  if (format === 'code') return md ? fence(text) : text;
  if (!md) return text.trim();
  return text.trim().split(/\n{2,}/).map((para) => {
    const lines = para.split('\n');
    return lines.map((line, i) => {
      if (isBullet(line)) return `- ${escapeMd(line.slice(2))}`;
      // Leading characters Markdown would read as a list, a heading underline or a rule stay literal.
      const t = escapeMd(line).replace(/^(\d+)([.)])/, '$1\\$2').replace(/^([+=-])/, '\\$1');
      const next = lines[i + 1];
      // A line after a bullet starts its own block; lines inside a paragraph keep their breaks.
      return (i && isBullet(lines[i - 1]) ? '\n' : '') + (next !== undefined && !isBullet(next) ? `${t}  ` : t);
    }).join('\n');
  }).join('\n\n');
}

function figureText(image, md, labels) {
  const text = `${labels.figure} ${image.figure}${image.caption ? `: ${image.caption}` : ''}`;
  return md ? `*[${escapeMd(text)} (screenshot not included)]*` : `[${text} (screenshot not included)]`;
}

/** Markdown (default) or plain text for the finding at `index` of `project`. */
export function findingText(project, index, { markdown = true } = {}) {
  const plan = createReportPlan(project);
  const f = plan.findings[index];
  if (!f) throw new Error(`no finding at ${index}`);
  return findingBlock(plan, f, markdown, 2) + '\n';
}

/** One planned finding; `level` is the Markdown heading level of its title (sections go one deeper).
 * A ticket handoff (one finding) always adds status and classification; the whole report shows
 * exactly the key facts the Word report shows. */
export function findingBlock(plan, f, md, level, { handoff = true } = {}) {
  const out = [];
  const hashes = '#'.repeat(level);
  const title = `${f.displayId} ${f.title || '(untitled)'}`;
  out.push(md ? `${hashes} ${escapeMd(title)}` : `${title}\n${'='.repeat(Math.min(title.length, 72))}`);

  // Key facts as in the report; for a ticket the status is always included, since a ticket needs it.
  const facts = f.keyFacts.filter((k) => k.key !== 'id');
  if (handoff && f.status && !facts.some((k) => k.key === 'status')) facts.push({ label: plan.labels.status, value: f.status.label });
  // So is the classification (v6), whatever the report shows.
  if (handoff && f.classification?.vulnerabilityType && !facts.some((k) => k.key === 'vulnerabilityType')) facts.push({ label: plan.labels.vulnerabilityType, value: f.classification.vulnerabilityType });
  if (handoff && f.classification?.cwe && !facts.some((k) => k.key === 'cwe')) facts.push({ label: plan.labels.cwe, value: f.classification.cwe });
  // A finding copied out on its own leaves the report's label behind, so its score names its version.
  const value = (k) => (handoff && k.versioned ? k.versioned : k.value);
  const name = (k) => (handoff && k.mismatch ? k.ownLabel : k.label); // a kept score in another version names its own
  if (facts.length || handoff) out.push(facts.map((k) => (md
    ? `- **${escapeMd(name(k))}:** ${escapeMd(value(k))}${k.detail ? ` (${codeSpan(k.detail)})` : ''}`
    : `${name(k)}: ${value(k)}${k.detail ? ` (${k.detail})` : ''}`)).join('\n'));

  for (const s of f.sections) {
    const parts = [];
    if (s.kind === 'text') {
      parts.push(s.key === 'assets'
        ? s.text.split('\n').filter(Boolean).map((a) => (md ? `- ${codeSpan(a)}` : `- ${a}`)).join('\n')
        : body(s.text, s.format, md));
    } else if (s.kind === 'blocks') {
      for (const b of s.blocks) parts.push(b.kind === 'text' ? body(b.text, b.format, md) : figureText(b.image, md, plan.labels));
    } else if (s.kind === 'evidence') {
      for (const image of s.images) parts.push(figureText(image, md, plan.labels));
    } else if (s.kind === 'references') {
      parts.push(s.rows.map((r) => {
        if (!md) return `- ${r.title}${r.url ? `: ${r.url}` : ''}`;
        return `- ${escapeMd(r.title)}${r.url ? `: ${/[<>]/.test(r.url) ? codeSpan(r.url) : `<${r.url}>`}` : ''}`;
      }).join('\n'));
    }
    const content = parts.filter((p) => p.trim() !== '').join('\n\n');
    if (!content) continue;
    out.push(md ? `${hashes}# ${escapeMd(s.label)}` : `${s.label}\n${'-'.repeat(Math.min(s.label.length, 72))}`, content);
  }
  return out.join('\n\n');
}
