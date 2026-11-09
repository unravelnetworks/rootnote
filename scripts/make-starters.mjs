// Neutral starter project files: a web application test and an API test,
// with [[...]] prompts where the tester fills in details and no findings. Written to
// release-template/starters/ and validated as project files.
// Usage: node scripts/make-starters.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { createEmptyProject, validateProjectFile } from '../src/app/project.js';

const STARTERS = {
  'web-application-test': {
    title: 'Web application penetration test',
    scope: 'In scope:\n- [[application name and URL(s)]]\n- [[user roles tested, for example anonymous, standard user, administrator]]\n\nOut of scope:\n- [[systems, functions or test types excluded]]',
    executiveSummary: '[[Customer]] asked [[organisation]] to assess the security of [[application]] between [[start date]] and [[end date]].\n\n[[Overall result in two or three sentences: the most important risks and what they allow an attacker to do.]]\n\n[[Main recommendations, in priority order.]]',
    rows: { 'Customer contact': '[[name, role]]', 'Scope summary': '[[one line, for example the customer portal and its login]]', 'Analysed data': '[[test accounts, source code, documentation provided]]',
      Methodology: 'Manual testing guided by the OWASP Web Security Testing Guide 4.2, supported by [[tools used]].', Limitations: '[[time, environment or access limits that affected coverage; "None" if none]]' },
  },
  'api-test': {
    title: 'API penetration test',
    scope: 'In scope:\n- [[API base URL(s) and version]]\n- [[authentication methods and client roles tested]]\n\nOut of scope:\n- [[endpoints, environments or test types excluded]]',
    executiveSummary: '[[Customer]] asked [[organisation]] to assess the security of [[API name]] between [[start date]] and [[end date]].\n\n[[Overall result in two or three sentences: the most important risks and what they allow an attacker to do.]]\n\n[[Main recommendations, in priority order.]]',
    rows: { 'Customer contact': '[[name, role]]', 'Scope summary': '[[one line, for example the public REST API v2]]', 'Analysed data': '[[API specification, test accounts and tokens, documentation provided]]',
      Methodology: 'Manual testing against the OWASP API Security Top 10 2023 and the OWASP Web Security Testing Guide 4.2, supported by [[tools used]].', Limitations: '[[time, environment or access limits that affected coverage; "None" if none]]' },
  },
};

const at = (p) => new URL(`../${p}`, import.meta.url);
await mkdir(at('release-template/starters/'), { recursive: true });
for (const [name, s] of Object.entries(STARTERS)) {
  const doc = createEmptyProject(new Date('2026-01-01T00:00:00.000Z'));
  Object.assign(doc.project, { title: s.title, client: '[[Customer]]', scope: s.scope, executiveSummary: s.executiveSummary });
  for (const row of doc.project.engagement.rows) if (row.source === 'custom' && s.rows[row.label] !== undefined) row.value = s.rows[row.label];
  const text = JSON.stringify(doc, null, 2) + '\n';
  const check = await validateProjectFile(text, Buffer.byteLength(text));
  if (!check.ok) throw new Error(`${name}: ${check.errors.join('; ')}`);
  await writeFile(at(`release-template/starters/${name}.rootnote.json`), text);
  console.log(`release-template/starters/${name}.rootnote.json`);
}
