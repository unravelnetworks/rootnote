import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {createReportPlan} from '../../src/export-docx/plan.js';
import {exportDocx} from '../../src/export-docx/index.js';
import {cvssBadge,ratingBadge,reportDesign} from '../../src/export-docx/design.js';
const load=async()=>JSON.parse(await fs.readFile(new URL('./v2-small.json',import.meta.url),'utf8'));

test('no-cover first emitted report section starts a new page in either paper size and section order',async()=>{
  for(const paperSize of ['A4','Letter']){
    const p=await load();p.project.cover.enabled=false;
    p.project.executiveSummary='';p.project.sections.report.reverse();
    const plan=createReportPlan(p,{paperSize});
    assert.equal(plan.reportSections[0].key,'findingsSummary');
    assert.equal(plan.reportSections[0].pageBreakBefore,true);
    assert.ok(plan.reportSections.slice(1).every(s=>s.pageBreakBefore===false));
    const z=await JSZip.loadAsync(await exportDocx(p,{paperSize})),xml=await z.file('word/document.xml').async('string');
    const paras=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
    const first=paras.find(x=>x.includes('w:name="report_summary"'));
    assert.match(first,/<w:pageBreakBefore\/>/);
    assert.match(xml,/<w:titlePg/);assert.match(xml,/w:start="1"/);
    p.project.cover.enabled=true;
    assert.ok(createReportPlan(p,{paperSize}).reportSections.every(s=>s.pageBreakBefore===false));
    const covered=await JSZip.loadAsync(await exportDocx(p,{paperSize}));
    const coveredParas=(await covered.file('word/document.xml').async('string')).match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
    assert.doesNotMatch(coveredParas.find(x=>x.includes('w:name="report_summary"')),/<w:pageBreakBefore/);
  }
  const p=await load();p.project.cover.enabled=false;p.project.executiveSummary='';
  p.project.sections.report.find(s=>s.key==='engagement').enabled=false;
  const plan=createReportPlan(p);assert.equal(plan.reportSections[0].key,'scope');assert.equal(plan.reportSections[0].pageBreakBefore,true);
  p.project.sections.report.forEach(s=>s.enabled=false);
  assert.deepEqual(createReportPlan(p).reportSections,[],'no empty forced-break section is introduced');
});

test('short finding sections group bounded text, bullet lines stay together, long sections still flow',async()=>{
  const p=await load(),f=p.findings[0];f.recommendation='- GROUP_A\n- GROUP_B\n- GROUP_C';f.formats.recommendation='plain';
  f.impact='LONG_SECTION '.repeat(80);f.affectedAssets=[...Array(12).fill(''),'asset'];
  const sections=createReportPlan(p).findings[0].sections;
  assert.equal(sections.find(s=>s.key==='recommendation').keepTogether,true);
  assert.equal(sections.find(s=>s.key==='impact').keepTogether,false);
  assert.equal(sections.find(s=>s.key==='assets').keepTogether,false,'literal blank lines count toward the limit');
  const zip=await JSZip.loadAsync(await exportDocx(p)),xml=await zip.file('word/document.xml').async('string');
  const paras=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
  for(const [i,marker]of ['GROUP_A','GROUP_B','GROUP_C'].entries()){
    const para=paras.find(x=>x.includes(marker));assert.match(para,/<w:keepLines\/>/);
    if(i<2)assert.match(para,/<w:keepNext\/>/);else assert.doesNotMatch(para,/<w:keepNext\/>/);
  }
});

test('presentation uses raw rating and CVSS bands independently, including zero and Unscored',async()=>{
  const p=await load();p.findings[0].rating='Low';p.project.labels.severity='Local priority';
  const plan=createReportPlan(p),f=plan.findings[0];
  assert.equal(f.scoring[0].badge.fill,'2E7D32');assert.equal(f.scoring[1].badge.fill,'7B1FA2');
  assert.equal(plan.summary.rows[0].badges.rating.level,'Low');assert.equal(plan.summary.rows[0].badges.cvss.level,'Critical');
  assert.ok(f.keyFacts.some(r=>r.key==='id'&&r.value===f.displayId));
  assert.ok(f.keyFacts.some(r=>r.key==='cvss'&&r.detail===p.findings[0].cvss));
  assert.equal(ratingBadge(null),null);assert.equal(cvssBadge(null),null);assert.equal(cvssBadge(0).level,'None');
  for(const [score,level]of[[0.1,'Low'],[3.9,'Low'],[4,'Medium'],[6.9,'Medium'],[7,'High'],[8.9,'High'],[9,'Critical'],[10,'Critical']])assert.equal(cvssBadge(score).level,level);
});

test('cover metadata is authoritative, label-aware and typography/colour tokens are shared',async()=>{
  const p=await load();p.project.labels.client='Prepared for';
  const plan=createReportPlan(p);assert.ok(plan.cover.details.some(r=>r.label==='Prepared for'&&r.value===p.project.client));
  assert.ok(plan.cover.details.some(r=>r.value===p.project.engagementId));assert.equal(plan.design.titlePt,32);
  assert.equal(plan.running.footerPrefix,[p.project.organisation,p.project.classification].join(' | '));
  assert.equal(reportDesign('FFFFFF').onAccent,'172B45');assert.equal(reportDesign('102337').onAccent,'FFFFFF');
});

test('visual Word structures retain editable text, tab alignment, shaded code, badges and field invariants',async()=>{
  const p=await load();p.findings[0].rating='Low';const zip=await JSZip.loadAsync(await exportDocx(p));
  const xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string');
  assert.match(xml,/w:fill="2E7D32"/);assert.match(xml,/w:fill="7B1FA2"/);assert.match(xml,/w:fill="F2F5F8"/);
  assert.match(styles,/w:styleId="Title"[\s\S]*?<w:sz w:val="64"/);
  assert.ok(xml.includes('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'));
  const footer=await zip.file('word/footer2.xml').async('string'),header=await zip.file('word/header2.xml').async('string');
  for(const text of[footer,header]){assert.match(text,/<w:tab w:val="right"/);assert.match(text,/<w:tab\/>/);assert.match(text,/<w:pBdr>/);}
  assert.match(footer,/SECTIONPAGES/);assert.match(xml,/SEQ Figure/);
});

test('no-cover first-page header avoids duplicate logos without suppressing page-one footer',async()=>{
  const p=await load();p.project.cover.enabled=false;const plan=createReportPlan(p);
  assert.equal(plan.cover.logos.length,2);assert.equal(plan.running.headerLogos.length,2);assert.equal(plan.running.firstPageHeaderLogos.length,0);
  const headerOnly=structuredClone(p);headerOnly.project.branding.clientLogo.front=false;
  assert.deepEqual(createReportPlan(headerOnly).running.firstPageHeaderLogos.map(l=>l.role),['clientLogo'],'header-only role remains visible on page one');
  const zip=await JSZip.loadAsync(await exportDocx(p)),xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/<w:titlePg/);assert.match(xml,/<w:headerReference w:type="first"/);assert.match(xml,/<w:footerReference w:type="first"/);
  const headers=await Promise.all(Object.keys(zip.files).filter(n=>/^word\/header.*\.xml$/.test(n)).map(n=>zip.file(n).async('string')));
  assert.ok(headers.some(x=>!(x.includes('<a:blip '))));assert.ok(headers.some(x=>(x.match(/<a:blip /g)||[]).length===2));
  const footers=await Promise.all(Object.keys(zip.files).filter(n=>/^word\/footer.*\.xml$/.test(n)).map(n=>zip.file(n).async('string')));
  assert.ok(footers.every(x=>x.includes('SECTIONPAGES')&&x.includes('PAGE')));
});
