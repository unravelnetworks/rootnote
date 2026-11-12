// Findings as a spreadsheet. One row per finding, in report order, with the
// report's own wording for the rating column. Every field is quoted. A cell a spreadsheet
// would read as a formula (starting with =, +, -, @, tab or carriage return) gets a leading
// apostrophe, as the OWASP CSV injection guidance recommends, so opening the file never runs
// anything. Screenshots appear as [Screenshot id: caption]; images are not exported. Sections
// hidden in the report are left empty.
// UTF-8 with a byte-order mark and CRLF line ends, which Excel reads correctly.
import { resolveFindingPrefix } from './project.js';
import { parseCvss, cvssLabel, reportCvssVersion, formatFindingStatus } from '../scoring/index.js';

// Also after leading spaces or invisible characters, and full-width look-alikes, since some
// spreadsheet imports trim or fold them, including direction marks,
// soft hyphens, the minus sign and small-form look-alikes.
const FORMULA_START = /^[\s­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]*[=+\-@−﹢﹣﹦﹫＝＋－＠]|^[\t\r]/;

/** One CSV field: neutralised if it could be a formula, then quoted. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The whole file as text (with the byte-order mark), for the project `doc`. */
export function findingsCsv(doc) {
  const p = doc.project;
  const labels = p.labels;
  const label = (key) => p.sections.finding.find((s) => s.key === key)?.label ?? key;
  // A section hidden in the report stays empty here too.
  const shown = (key) => p.sections.finding.find((s) => s.key === key)?.enabled !== false;
  const cell = (key, text) => (shown(key) ? text : '');
  const prefix = resolveFindingPrefix(p);
  const images = new Map(doc.images.map((im) => [im.id, im]));
  const header = ['ID', 'Title', p.scoring.mode.startsWith('risk') ? labels.risk : labels.severity, `${cvssLabel(labels.cvss, reportCvssVersion(doc))} score`, `${cvssLabel(labels.cvss, reportCvssVersion(doc))} vector`,
    labels.status, labels.vulnerabilityType ?? 'Vulnerability type', labels.cwe ?? 'CWE', label('assets'), label('description'), label('details'),
    label('impact'), label('threat'), label('recommendation'), label('references')];
  const rows = doc.findings.map((f, i) => {
    // The score stays a number; the vector column next to it names its CVSS version.
    const score = f.cvss ? parseCvss(f.cvss).score.toFixed(1) : '';
    const details = !shown('details') ? '' : (f.details ?? []).map((b) => (b.type === 'text' ? b.text
      : `[Screenshot ${b.imageId}${images.get(b.imageId)?.caption ? `: ${images.get(b.imageId).caption}` : ''}]`)).join('\n\n');
    const evidence = !shown('evidence') ? [] : (f.evidence ?? []).map((id) => `[Screenshot ${id}${images.get(id)?.caption ? `: ${images.get(id).caption}` : ''}]`);
    // In CVSS-only mode the report shows no rating, so neither does this column.
    return [`${prefix}-${i + 1}`, f.title, p.scoring.mode === 'cvss' ? '' : f.rating ?? labels.unscored, score, f.cvss ?? '',
      doc.schemaVersion >= 4 || f.status !== undefined ? formatFindingStatus(f.status ?? null, { notSet: labels.statusNotSet }) : '',
      f.vulnerabilityType ?? '', f.cwe ?? '', cell('assets', (f.affectedAssets ?? []).join('\n')), cell('description', f.description ?? ''),
      [details, ...evidence].filter(Boolean).join('\n\n'), cell('impact', f.impact ?? ''), cell('threat', f.threat ?? ''), cell('recommendation', f.recommendation ?? ''),
      cell('references', (f.references ?? []).map((r) => (r.url ? `${r.title} ${r.url}` : r.title)).join('\n'))];
  });
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
