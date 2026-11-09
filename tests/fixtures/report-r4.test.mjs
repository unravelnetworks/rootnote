import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createReportPlan} from '../../src/export-docx/plan.js';
import {exportDocx} from '../../src/export-docx/index.js';
import {ratingCounts} from '../../src/scoring/index.js';
import {v4Fixture} from './generate-v4.mjs';

test('Contents is first without mutating stored order and next section starts a page',async()=>{
  const p=await v4Fixture();
  p.project.sections.report.push(p.project.sections.report.shift());
  const before=structuredClone(p);
  for(const cover of [true,false]){
    p.project.cover.enabled=cover;
    const plan=createReportPlan(p);
    assert.equal(plan.reportSections[0].kind,'contents');
    assert.equal(plan.reportSections[0].pageBreakBefore,!cover);
    assert.equal(plan.reportSections[1].pageBreakBefore,true);
    assert.deepEqual(plan.reportSections.slice(1).map(s=>s.key),createReportPlan({...p,project:{...p.project,sections:{...p.project.sections,report:p.project.sections.report.map(s=>s.key==='contents'?{...s,enabled:false}:s)}}}).reportSections.map(s=>s.key));
  }
  p.project.cover.enabled=before.project.cover.enabled;
  assert.deepEqual(p,before);
});

test('horizontal presentation omits only zero Unscored/Not set, keeps zero scored bands',async()=>{
  const p=await v4Fixture();p.findings.forEach(f=>{f.rating='High';f.cvss='CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';f.status='open';});
  const plan=createReportPlan(p);
  assert.deepEqual(plan.summary.ratingCounts,ratingCounts(p));
  assert.equal(plan.summary.ratingCounts.distributions[0].rows.at(-1).key,'unscored');
  assert.equal(plan.summary.statusCounts.rows.at(-1).key,null);
  for(const t of plan.summary.countTables){
    assert.equal(t.columns.at(-1).key,'total');assert.equal(t.columns.at(-1).count,3);
    assert.ok(!t.columns.some(c=>c.key==='unscored'||c.key===null));
    assert.equal(t.columns.slice(0,-1).reduce((n,c)=>n+c.count,0),3);
  }
  assert.equal(plan.summary.countTables.find(t=>t.key==='cvss').columns.find(c=>c.key==='None').count,0);
  const status=plan.summary.countTables.find(t=>t.key==='status');
  assert.deepEqual(status.columns.slice(0,-1).map(c=>c.key),['open','fixed','partly_fixed','risk_accepted','false_positive']);
  assert.ok(status.columns.every(c=>c.badge===null));
  p.findings[0].status=null;p.findings[0].rating=null;p.findings[0].cvss=null;
  assert.ok(createReportPlan(p).summary.countTables.every(t=>t.columns.some(c=>(c.key==='unscored'||c.key===null)&&c.count===1)));
});

for(const paperSize of ['A4','Letter'])test('Word IDs stay literal with noWrap and shared widths: '+paperSize,async()=>{
  const p=await v4Fixture();p.project.findingPrefix='UNR-2026-014';
  const plan=createReportPlan(p,{paperSize});assert.equal(plan.summary.idFontPt,10);
  assert.equal(plan.summary.columns.reduce((n,c)=>n+c.widthTwips,0),Math.round(plan.geometry.contentWidth*15));
  const xml=await (await JSZip.loadAsync(await exportDocx(p,{paperSize}))).file('word/document.xml').async('string');
  const tables=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g),summary=tables.find(t=>t.includes('w:anchor="finding_F_001"'));
  assert.ok(summary);
  const cell=(summary.match(/<w:tc>[\s\S]*?<\/w:tc>/g)).find(c=>c.includes('>UNR-2026-014-1</w:t>'));
  assert.match(cell,/<w:noWrap\/>[\s\S]*<w:tcMar>/);assert.match(cell,/<w:sz w:val="20"\/>/);
  const horizontal=tables.filter(t=>t.includes('>Findings</w:t>'));
  assert.equal(horizontal.length,3);assert.ok(xml.indexOf(summary)<xml.indexOf(horizontal[0]));
  for(const t of horizontal)assert.equal((t.match(/<w:tr>/g)||[]).length,2);
  p.project.findingPrefix='W'.repeat(40);
  const long=createReportPlan(p,{paperSize});assert.equal(long.summary.rows[0].displayId,'W'.repeat(40)+'-1');
  assert.ok(long.summary.idFontPt<10&&long.summary.idFontPt>0);
});
