// Synthetic v2 fixtures; never rewrites frozen v1 fixtures.
import fs from 'node:fs/promises';
import { migrateV1toV2, validateProjectFile } from '../../src/app/project.js';
for (const name of ['small','bounds']) {
  const project = migrateV1toV2(JSON.parse(await fs.readFile(new URL('./'+name+'.json',import.meta.url),'utf8')), {appVersion:'0.2.0'});
  const p = project.project;
  p.cover.enabled = true; p.engagementId = 'SYN-2026'; p.subtitle = 'Synthetic Phase 1b layout fixture';
  p.scoring.mode = 'severity+cvss'; p.backToSummaryLinks = true;
  p.sections.report.find(s=>s.key === 'engagement').enabled = true;
  project.findings[0].cvss = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  project.findings[0].details = '```\n  \t- literal evidence line\nGET /?q=<tag>&a=1 HTTP/1.1\n```';
  project.findings[0].threat = 'Synthetic threat scenario; no customer data.';
  p.engagement.rows.push({source:'custom',label:'Synthetic note',enabled:true,format:'plain',value:'Editable engagement details.'});
  for (const [index,role] of ['testerLogo','clientLogo'].entries()) {
    const id = 'IMG-'+String(p.nextImageNumber++).padStart(4,'0');
    project.images.push({...project.images[index],id,caption:'Synthetic '+role,tallMode:'fit'});
    p.branding[role] = {imageId:id,front:true,header:true,footer:true};
  }
  const raw = JSON.stringify(project,null,2)+'\n', checked = await validateProjectFile(raw,Buffer.byteLength(raw));
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  await fs.writeFile(new URL('./v2-'+name+'.json',import.meta.url),raw);
}
