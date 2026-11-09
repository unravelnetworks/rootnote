import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {migrateV2toV3,migrateV3toV4,createEmptyProjectV4,validateProjectFileV4,referenceUrlErrors,referenceTitleErrors} from '../../src/app/project.js';
import {createReportPlan,resolveEngagementValue} from '../../src/export-docx/plan.js';
import {exportDocx} from '../../src/export-docx/index.js';
import {ratingCounts} from '../../src/scoring/index.js';
import {v4Fixture,longReferenceUrl} from './generate-v4.mjs';
const visible=z=>Promise.all(Object.keys(z.files).filter(n=>/^word\/.*\.xml$/.test(n)).sort().map(async n=>[n,[...((await z.file(n).async('string')).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))].map(m=>m[1])]));
const figures=plan=>plan.findings.flatMap(f=>f.sections.flatMap(s=>s.kind==='evidence'?s.images:s.kind==='blocks'?s.blocks.filter(b=>b.kind==='evidence').map(b=>b.image):[])).map(im=>[im.imageId,im.figure,im.parts]);

test('v4 plan is pure, validates hidden references, resolves bound status and exposes literal rows',async()=>{
  const p=await v4Fixture(),before=structuredClone(p),plan=createReportPlan(p);
  assert.equal(plan.version,3);assert.deepEqual(p,before);
  assert.deepEqual(plan.metadata.engagementStatus,{key:'retest_due',label:'Retest due'});
  assert.equal(resolveEngagementValue({source:'engagementStatus'},p.project),'Retest due');
  assert.equal(plan.findings[0].status.label,'Open');
  assert.deepEqual(plan.findings[0].sections.find(s=>s.kind==='references').rows,p.findings[0].references);
  plan.findings[0].sections.find(s=>s.kind==='references').rows[0].title='Plan-only change';assert.deepEqual(p,before);
  p.project.sections.finding.find(s=>s.key==='references').enabled=false;
  assert.ok(createReportPlan(p).findings.every(f=>!f.sections.some(s=>s.kind==='references')));
  for(const refs of [null,[{title:'x',url:'javascript:alert(1)'}],[{title:'\uFFFF',url:''}],Array.from({length:21},()=>({title:'x',url:''}))]){
    p.findings[0].references=refs;assert.throws(()=>createReportPlan(p));
  }
  assert.ok(referenceTitleErrors('title\n').length);assert.ok(referenceUrlErrors('https://example.test/\n').length);
});

test('all status display combinations retain independent counts, scores and figures',async()=>{
  const p=await v4Fixture(),baseline=createReportPlan(p),ratings=ratingCounts(p),originalFigures=figures(baseline);
  for(const keyFacts of [false,true])for(const summaryColumn of [false,true])for(const counts of [false,true])for(const enabled of [false,true]){
    p.project.findingStatusDisplay={keyFacts,summaryColumn,counts};p.project.sections.report.find(s=>s.key==='findingsSummary').enabled=enabled;
    p.findings.forEach(f=>{f.status='false_positive';});
    const plan=createReportPlan(p);
    assert.equal(plan.findings.length,p.findings.length);assert.deepEqual(ratingCounts(p),ratings);assert.deepEqual(figures(plan),originalFigures);
    assert.equal(plan.findings[0].keyFacts.some(r=>r.key==='status'),keyFacts);
    assert.equal(plan.summary.columns.some(c=>c.key==='status'),summaryColumn&&enabled);
    assert.equal(!!plan.summary.statusCounts,counts&&enabled);assert.equal(!!plan.summary.statusNote,(counts||summaryColumn)&&enabled);
    if(plan.summary.statusCounts){assert.equal(plan.summary.statusCounts.rows.find(r=>r.key==='false_positive').count,3);assert.equal(plan.summary.statusCounts.total,3);}
  }
});

test('contents follows emitted output order with stable unique targets, duplicate titles and no empty list',async()=>{
  const p=await v4Fixture();p.findings[1].title=p.findings[0].title;p.project.findingPrefix='CUSTOM';
  p.project.executiveSummary='';p.project.sections.report.reverse();
  const plan=createReportPlan(p);assert.equal(plan.contents.enabled,true);
  assert.deepEqual(plan.contents.rows.map(r=>r.anchor),[...plan.reportSections.filter(s=>s.kind!=='contents').map(s=>s.anchor),plan.findingsAnchor,...plan.findings.map(f=>f.anchor)]);
  assert.equal(new Set(plan.contents.rows.map(r=>r.anchor)).size,plan.contents.rows.length);
  assert.ok(!plan.contents.rows.some(r=>r.anchor==='report_executive_summary'));
  assert.match(plan.contents.rows.at(-1).text,/^CUSTOM-3 /);
  p.findings.reverse();assert.deepEqual(new Set(createReportPlan(p).findings.map(f=>f.anchor)),new Set(plan.findings.map(f=>f.anchor)));
  const empty=createEmptyProjectV4();empty.project.cover.enabled=false;empty.project.sections.report.forEach(s=>{s.enabled=s.key==='contents';});
  const none=createReportPlan(empty);assert.equal(none.contents.enabled,false);assert.deepEqual(none.contents.rows,[]);assert.deepEqual(none.reportSections,[]);
  empty.project.sections.report.find(s=>s.key==='findingsSummary').enabled=true;
  const zero=createReportPlan(empty);assert.equal(zero.reportSections[0].kind,'contents');assert.equal(zero.reportSections[0].pageBreakBefore,true);assert.deepEqual(zero.contents.rows.map(r=>r.anchor),['report_summary']);
});

for(const paperSize of ['A4','Letter'])test('v4 DOCX: internal contents, literal maximum URL, independent status table and fields: '+paperSize,async()=>{
  const p=await v4Fixture(),raw=JSON.stringify(p);assert((await validateProjectFileV4(raw,Buffer.byteLength(raw))).ok);
  const plan=createReportPlan(p,{paperSize}),zip=await JSZip.loadAsync(await exportDocx(p,{paperSize})),xml=await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes(longReferenceUrl));assert.match(xml,/Synthetic reference 1 &lt;&amp;&gt;/);
  const urlParagraph=(xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[]).find(x=>x.includes(longReferenceUrl));
  assert.match(urlParagraph,/<w:keepLines\/>/);assert.match(urlParagraph,/<w:wordWrap w:val="0"\/>/);
  assert.match(xml,/Counts include every finding in this report, whatever its status\./);
  assert.equal(plan.summary.countTables.length,3);
  assert.equal((xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)||[]).filter(t=>t.includes('>Findings</w:t>')).length,3);
  assert.equal(plan.summary.columns.length,5);
  const bookmarks=[...xml.matchAll(/<w:bookmarkStart\b[^>]*w:name="([^"]+)"/g)].map(m=>m[1]);
  const links=[...xml.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(bookmarks).size,bookmarks.length);assert.ok(links.length>p.findings.length);
  assert.ok(links.every(a=>bookmarks.filter(b=>b===a).length===1));
  assert.ok(plan.contents.rows.every(r=>bookmarks.includes(r.anchor)));
  assert.doesNotMatch(xml,/TOC |PAGEREF /);assert.doesNotMatch(await zip.file('word/settings.xml').async('string'),/<w:updateFields/);
  const ids=[];for(const name of Object.keys(zip.files)){
    if(name.endsWith('.rels'))assert.doesNotMatch(await zip.file(name).async('string'),/TargetMode="External"/);
    if(/^word\/.*\.xml$/.test(name)){
      const text=await zip.file(name).async('string');ids.push(...[...text.matchAll(/<wp:docPr\b[^>]*\bid="([0-9]+)"/g)].map(m=>m[1]));
      for(const pr of text.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g)||[])assert.ok((pr.match(/<w:pStyle\b/g)||[]).length<=1);
    }
  }assert.equal(new Set(ids).size,ids.length);
});

test('migration alone preserves all visible Word text, media, captions and existing fields',async()=>{
  const old=JSON.parse(await fs.readFile(new URL('./v2-small.json',import.meta.url),'utf8'));
  const v3=migrateV2toV3(old),v4=migrateV3toV4(v3);
  for(const paperSize of ['A4','Letter']){
    const z3=await JSZip.loadAsync(await exportDocx(v3,{paperSize})),z4=await JSZip.loadAsync(await exportDocx(v4,{paperSize}));
    assert.deepEqual(await visible(z4),await visible(z3));
    for(const name of Object.keys(z3.files).filter(n=>n.startsWith('word/media/')&&!z3.files[n].dir))assert.deepEqual(await z4.file(name).async('uint8array'),await z3.file(name).async('uint8array'));
    const a=await z3.file('word/document.xml').async('string'),b=await z4.file('word/document.xml').async('string');
    assert.deepEqual(b.match(/SEQ Figure[^<]*/g),a.match(/SEQ Figure[^<]*/g));
  }
});
