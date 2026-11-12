// Pre-export warnings. They certify nothing. Most never block export; those whose text says
// "export will fail" do (a missing screenshot, a CVSS score in another version than the
// report's while CVSS is shown). `go` names the view that fixes each one: 'details', 'layout'
// or a finding id.
import { resolveFindingPrefix, screenshotRefs } from '../app/project.js';
import { countPrompts } from '../app/starter-library.js';
import { cvssVersion, reportCvssVersion } from '../scoring/index.js';

const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum|XXX)\b|\[(insert|placeholder)[^\]]*\]/i;

export function checklist(doc) {
  const warnings = [];
  const p = doc.project;
  const enabled = (group, key) => p.sections[group].find((s) => s.key === key).enabled;
  const mode = p.scoring.mode;
  if (!p.title.trim()) warnings.push({ where: 'Details & cover', go: 'details', text: 'Report title is empty.' });
  if (!(p.client || '').trim()) warnings.push({ where: 'Details & cover', go: 'details', text: 'Client is empty.' });
  if (enabled('report', 'executiveSummary') && !(p.executiveSummary || '').trim()) warnings.push({ where: 'Details & cover', go: 'details', text: 'Executive summary is empty.' });
  if (enabled('report', 'scope') && !(p.scope || '').trim()) warnings.push({ where: 'Details & cover', go: 'details', text: 'Scope is empty.' });
  if (!doc.findings.length) warnings.push({ where: 'Findings', text: 'The report has no findings.' });
  const hidden = [...p.sections.report, ...p.sections.finding].filter((s) => !s.enabled).map((s) => s.label);
  if (hidden.length) warnings.push({ where: 'Sections & scoring', go: 'layout', text: `Hidden in the report: ${hidden.join(', ')}. Their content stays saved.` });

  const images = new Map(doc.images.map((im) => [im.id, im]));
  const scan = (where, go, value) => {
    if (PLACEHOLDER.test(value || '')) warnings.push({ where, go, text: 'Contains placeholder text (TODO, TBD, lorem ipsum, [insert …]).' });
    // Starter library and starter project prompts.
    const n = countPrompts(value);
    if (n) warnings.push({ where, go, text: `${n} unfilled [[…]] prompt${n > 1 ? 's' : ''}: replace ${n > 1 ? 'each' : 'it'} with what you observed, or delete ${n > 1 ? 'them' : 'it'}.` });
  };
  scan('Details & cover', 'details', [p.title, p.subtitle, p.client, p.scope, p.executiveSummary, p.ratingMethod?.text,
    ...(p.customSections ?? []).flatMap((c) => [c.title, c.text]),
    ...p.engagement.rows.map((r) => `${r.label}\n${r.value || ''}`)].join('\n'));

  const prefix = resolveFindingPrefix(p);
  const label = (key) => p.sections.finding.find((s) => s.key === key).label;
  doc.findings.forEach((f, i) => {
    const where = `${prefix}-${i + 1} ${f.title || '(untitled)'}`;
    if (!f.title.trim()) warnings.push({ where, go: f.id, text: 'Title is empty.' });
    if (mode !== 'cvss' && f.rating === null) warnings.push({ where, go: f.id, text: `${mode.startsWith('risk') ? p.labels.risk : p.labels.severity} is not set (exported as ${p.labels.unscored}).` });
    if (mode.endsWith('cvss') && f.cvss === null) warnings.push({ where, go: f.id, text: `No CVSS vector (exported as ${p.labels.unscored}).` });
    // A score in another CVSS version than the report's must be rescored or cleared: the report
    // would otherwise mix scores that cannot be compared. The CSV always holds CVSS scores.
    if (f.cvss && cvssVersion(f.cvss) !== reportCvssVersion(doc)) {
      warnings.push({ where, go: f.id, text: mode.endsWith('cvss')
        ? `Scored in CVSS ${cvssVersion(f.cvss)}, but this report uses CVSS ${reportCvssVersion(doc)}. Rescore or clear it; until then, export will fail.`
        : `Has a CVSS ${cvssVersion(f.cvss)} vector, but this report uses CVSS ${reportCvssVersion(doc)}. CVSS is hidden in the report; Findings as CSV is refused until you rescore or clear it.` });
    }
    if (enabled('finding', 'assets') && !(f.affectedAssets || []).length) warnings.push({ where, go: f.id, text: `${label('assets')} is empty.` });
    for (const key of ['description', 'impact', 'recommendation']) {
      if (enabled('finding', key) && !(f[key] || '').trim()) warnings.push({ where, go: f.id, text: `${label(key)} is empty.` });
    }
    const refs = screenshotRefs(f);
    const shown = refs.filter((r) => enabled('finding', r.where));
    if (!shown.length && (enabled('finding', 'details') || enabled('finding', 'evidence'))) warnings.push({ where, go: f.id, text: 'No screenshots.' });
    for (const key of ['details', 'evidence']) {
      const n = refs.filter((r) => r.where === key).length;
      if (n && !enabled('finding', key)) warnings.push({ where, go: f.id, text: `${n} screenshot${n > 1 ? 's are' : ' is'} in ${label(key)}, which is hidden in the report, so ${n > 1 ? 'they are' : 'it is'} not exported.` });
    }
    for (const { imageId: id } of refs) {
      const im = images.get(id);
      if (!im) warnings.push({ where, go: f.id, text: `Screenshot ${id} is missing from the project; export will fail.` });
      else if (!im.caption.trim()) warnings.push({ where, go: f.id, text: `Screenshot ${id} has no caption.` });
    }
    const detailsText = (f.details || []).filter((b) => b.type === 'text').map((b) => b.text);
    const references = f.references || [];
    scan(where, f.id, [f.title, f.vulnerabilityType ?? '', ...(f.affectedAssets || []), f.description, ...detailsText, f.impact, f.threat, f.recommendation, ...refs.map((r) => images.get(r.imageId)?.caption),
      ...references.flatMap((r) => [r.title, r.url])].join('\n'));
    // Duplicates are allowed (rule 18) but are usually a slip.
    const seen = new Set();
    const dup = references.filter((r) => { const k = `${r.title}\n${r.url}`; if (seen.has(k)) return true; seen.add(k); return false; }).length;
    if (dup) warnings.push({ where, go: f.id, text: `${dup} duplicate reference${dup > 1 ? 's' : ''} in ${label('references')}.` });
  });
  return warnings;
}
