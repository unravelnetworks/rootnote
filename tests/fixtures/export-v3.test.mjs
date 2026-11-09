import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {migrateV2toV3,validateProjectFile,screenshotRefs} from '../../src/app/project.js';
import {createReportPlan} from '../../src/export-docx/plan.js';
import {exportDocx} from '../../src/export-docx/index.js';

const load=async()=>migrateV2toV3(JSON.parse(await fs.readFile(new URL('./v2-small.json',import.meta.url),'utf8')));
const text=(id,value,format='plain')=>({id,type:'text',text:value,format});
const image=(id,imageId)=>({id,type:'image',imageId});
async function inlineSample(){
  const p=await load(),f=p.findings[0],id=f.evidence.shift();
  f.details=[text('before','BEFORE_INLINE'),image('capture',id),text('after','AFTER_INLINE\n\t- literal code <&>', 'code')];
  return p;
}
const figures=p=>p.findings.flatMap(f=>f.sections.flatMap(s=>s.kind==='evidence'?s.images:s.kind==='blocks'?s.blocks.filter(b=>b.kind==='evidence').map(b=>b.image):[]));

test('v3 inline fixture validates; plan preserves block order, immutable source and shared references',async()=>{
  const p=await inlineSample(),before=structuredClone(p),raw=JSON.stringify(p);
  assert.equal((await validateProjectFile(raw,Buffer.byteLength(raw))).ok,true);
  const plan=createReportPlan(p),details=plan.findings[0].sections.find(s=>s.key==='details');
  assert.equal(plan.version,2);assert.equal(details.kind,'blocks');
  assert.deepEqual(details.blocks.map(b=>b.blockId),['before','capture','after']);
  assert.deepEqual(details.blocks.map(b=>b.kind),['text','evidence','text']);
  assert.equal(details.blocks[2].format,'code');assert.equal(details.blocks[2].text,p.findings[0].details[2].text);
  assert.deepEqual(figures(plan).map(im=>im.figure),[1,2,3,4,5,6]);
  assert.deepEqual(screenshotRefs(p.findings[0]).map(r=>r.imageId),figures(plan).slice(0,2).map(im=>im.imageId));
  assert.deepEqual(p,before);
});

for(const paperSize of ['A4','Letter'])test('v3 '+paperSize+' DOCX has text/image/text in order, captions once, safe fields and relationships',async()=>{
  const p=await inlineSample(),z=await JSZip.loadAsync(await exportDocx(p,{paperSize}));
  const xml=await z.file('word/document.xml').async('string');
  const before=xml.indexOf('BEFORE_INLINE'),capture=xml.indexOf('title="'+p.findings[0].details[1].imageId+'"',before),after=xml.indexOf('AFTER_INLINE');
  assert.ok(before>=0&&capture>before&&after>capture);
  assert.equal((xml.match(/SEQ Figure/g)||[]).length,6);
  const paragraphs=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
  const code=paragraphs.find(x=>x.includes('- literal code &lt;&amp;&gt;'));
  assert.ok(code);assert.match(code,/<w:tab\/>/);assert.doesNotMatch(code,/<w:numPr>/);
  const ids=[];
  for(const name of Object.keys(z.files)){
    if(/^word\/.*\.xml$/.test(name)){
      const x=await z.file(name).async('string');
      ids.push(...[...x.matchAll(/<wp:docPr\b[^>]*\bid="([0-9]+)"/g)].map(m=>m[1]));
      for(const pr of x.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g)||[])assert.ok((pr.match(/<w:pStyle\b/g)||[]).length<=1);
    }
    if(name.endsWith('.rels'))assert.doesNotMatch(await z.file(name).async('string'),/TargetMode="External"/);
  }
  assert.equal(new Set(ids).size,ids.length);
  assert.doesNotMatch(await z.file('word/settings.xml').async('string'),/<w:updateFields/);
});

test('v3 figure numbers follow enabled section and block order, not shared helper traversal order',async()=>{
  const p=await inlineSample(),f=p.findings[0],inline=f.details[1].imageId,gallery=f.evidence[0];
  p.project.sections.finding.reverse();
  let plan=createReportPlan(p);assert.deepEqual(figures(plan).slice(0,2).map(im=>im.imageId),[gallery,inline]);
  assert.deepEqual(figures(plan).map(im=>im.figure),[1,2,3,4,5,6]);
  p.project.sections.finding.find(s=>s.key==='details').enabled=false;
  plan=createReportPlan(p);assert.equal(figures(plan).length,5);assert.equal(figures(plan)[0].imageId,gallery);
  assert.deepEqual(figures(plan).map(im=>im.figure),[1,2,3,4,5]);
  assert.equal(f.details[1].imageId,inline,'hidden source remains stored');
  const z=await JSZip.loadAsync(await exportDocx(p));assert.equal(((await z.file('word/document.xml').async('string')).match(/SEQ Figure/g)||[]).length,5);
});

test('v3 disabled duplicates, missing assets, logo overlaps and malformed blocks refuse planning',async()=>{
  const p=await inlineSample();p.project.sections.finding.find(s=>s.key==='details').enabled=false;
  const duplicate=structuredClone(p);duplicate.findings[0].evidence.push(duplicate.findings[0].details[1].imageId);
  assert.throws(()=>createReportPlan(duplicate),/references/);
  const missing=structuredClone(p);missing.findings[0].details[1].imageId='IMG-9998';assert.throws(()=>createReportPlan(missing),/references/);
  const logo=structuredClone(p);logo.project.branding.testerLogo.imageId=logo.findings[0].details[1].imageId;assert.throws(()=>createReportPlan(logo),/logo/);
  const ids=structuredClone(p);ids.findings[0].details[2].id='before';assert.throws(()=>createReportPlan(ids),/block id/);
  const large=structuredClone(p);large.findings[0].details=[text('a','a'.repeat(10001)),text('b','b'.repeat(10000))];assert.throws(()=>createReportPlan(large),/block bounds/);
  const many=structuredClone(p);many.findings[0].details=Array.from({length:101},(_,i)=>text('b'+i,''));assert.throws(()=>createReportPlan(many),/block bounds/);
});

test('v3 omitted/blank details omitted; blank code inside a populated section remains literal',async()=>{
  const p=await load();delete p.findings[0].details;p.findings[1].details=[text('blank',' \t\n','code')];
  let plan=createReportPlan(p);assert.ok(plan.findings.slice(0,2).every(f=>!f.sections.some(s=>s.key==='details')));
  p.findings[1].details.push(text('real','nonempty'));plan=createReportPlan(p);
  assert.equal(plan.findings[1].sections.find(s=>s.key==='details').blocks[0].text,' \t\n');
});

test('v3 inline tall captures retain balanced complete source-row coverage in A4 and Letter',async()=>{
  const p=await load(),tall=p.images.find(im=>im.height>3000),f=p.findings.find(f=>f.evidence.includes(tall.id));
  f.evidence=f.evidence.filter(id=>id!==tall.id);f.details=[text('intro','Tall response:'),image('tall',tall.id),text('tail','End of response')];tall.tallMode='split';
  for(const paperSize of ['A4','Letter']){
    const im=figures(createReportPlan(p,{paperSize})).find(im=>im.imageId===tall.id);let y=0;
    assert.ok(im.parts.length>1);
    for(const part of im.parts){assert.equal(part.y,y);y+=part.sourceHeight;}
    assert.equal(y,tall.height);assert.equal(im.parts[0].sequence,'increment');
    assert.ok(im.parts.slice(1).every(p=>p.sequence==='repeat'));
  }
});
