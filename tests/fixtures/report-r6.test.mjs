import test from 'node:test';import assert from 'node:assert/strict';import JSZip from 'jszip';
import {v4Fixture} from './generate-v4.mjs';import {migrateV4toV5} from '../../src/app/project.js';
import {createReportPlan} from '../../src/export-docx/plan.js';import {exportDocx} from '../../src/export-docx/index.js';

test('summary starts a page without introducing a duplicate cover break',async()=>{
 const p=migrateV4toV5(await v4Fixture());
 for(const cover of [true,false])for(const contents of [true,false])for(const before of [true,false]){
  p.project.cover.enabled=cover;p.project.ratingMethod.text='Our rating method.';
  p.project.sections.report.forEach(s=>{s.enabled=s.key==='findingsSummary'||(s.key==='contents'&&contents)||(s.key==='ratingMethod'&&before)});
  const rank={contents:0,ratingMethod:1,findingsSummary:2};p.project.sections.report.sort((a,b)=>(rank[a.key]??10)-(rank[b.key]??10));
  const plan=createReportPlan(p),i=plan.reportSections.findIndex(s=>s.kind==='summary');
  assert.equal(plan.reportSections[i].pageBreakBefore,!cover||i>0);
  if(contents)assert.equal(plan.reportSections[0].kind,'contents');
 }
});

for(const note of [true,false])test('only the final summary row joins the complete count chain; note='+note,async()=>{
 const p=await v4Fixture();p.project.findingStatusDisplay={keyFacts:false,summaryColumn:note,counts:note};
 const plan=createReportPlan(p),z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
 const tables=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g),summary=tables.find(t=>t.includes('w:anchor="finding_F_001"'));
 const rows=summary.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
 assert.equal(rows.length,p.findings.length+1);
 for(const [i,row] of rows.entries()){
  assert.match(row,/<w:cantSplit\/>/);
  const paras=row.match(/<w:p>[\s\S]*?<\/w:p>/g);
  assert.ok(paras.every(p=>/<w:keepNext\/>/.test(p)===(i===rows.length-1)),'earlier rows do not drag the whole summary');
 }
 const counts=tables.filter(t=>t.includes('>Findings</w:t>'));assert.equal(counts.length,plan.summary.countTables.length);
 for(const t of counts){
  assert.equal((t.match(/<w:cantSplit\/>/g)||[]).length,2);
  assert.ok((t.match(/<w:p>[\s\S]*?<\/w:p>/g)||[]).every(p=>/<w:keepNext\/>/.test(p)));
 }
 const start=xml.indexOf(summary)+summary.length,end=xml.indexOf(counts.at(-1))+counts.at(-1).length;
 const bridge=xml.slice(start,end);assert.match(bridge,/^<w:p>[\s\S]*?<w:keepNext\/>/);
 const gaps=bridge.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g,'').match(/<w:p>[\s\S]*?<\/w:p>/g)||[];
 assert.ok(gaps.every(p=>/<w:keepNext\/>/.test(p)),'spacers cannot break the keep chain');
 const tail=xml.slice(end).match(/^<w:p>[\s\S]*?<\/w:p>/)[0];
 assert.equal(/<w:keepNext\/>/.test(tail),note,'last spacer ends chain when there is no note');
 if(note){const para=xml.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*Counts include every finding(?:(?!<\/w:p>)[\s\S])*<\/w:p>/)[0];assert.match(para,/<w:keepLines\/>/);assert.doesNotMatch(para,/<w:keepNext\/>/);}
});
