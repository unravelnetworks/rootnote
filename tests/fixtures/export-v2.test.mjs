import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { exportDocx } from '../../src/export-docx/index.js';
import { validateProjectFile } from '../../src/app/project.js';
const load = async (name='small') => JSON.parse(await fs.readFile(new URL('./v2-'+name+'.json',import.meta.url),'utf8'));
const xmlOf = async z => (await Promise.all(Object.keys(z.files).filter(n=>/^word\/.*\.xml$/.test(n)).map(async n=>[n,await z.file(n).async('string')])));

for (const paperSize of ['A4','Letter']) test('v2 '+paperSize+' cover, two running logos, internal links, sequential display IDs and scoring',async()=>{
  const p=await load(), before=structuredClone(p), z=await JSZip.loadAsync(await exportDocx(p,{paperSize}));
  const xml=await z.file('word/document.xml').async('string'), all=await xmlOf(z);
  assert.deepEqual(p,before); assert.equal((xml.match(/<w:sectPr[ >]/g)||[]).length,2);
  assert.ok(xml.includes('SYN-2026-1'));assert.ok((xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g)||[]).some(row=>row.includes('CVSS 3.1 Base')&&row.includes('>9.8</w:t>')));
  const bookmarks=[...xml.matchAll(/<w:bookmarkStart\b[^>]*w:name="([^"]+)"/g)].map(m=>m[1]);
  const anchors=[...xml.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(bookmarks.length,4);assert.equal(new Set(bookmarks).size,4);assert.equal(anchors.length,6);
  assert.ok(anchors.every(a=>bookmarks.filter(b=>b===a).length===1));
  assert.equal((xml.match(/SEQ Figure/g)||[]).length,6);
  const drawingIds=all.flatMap(([,x])=>[...x.matchAll(/<wp:docPr\b[^>]*\bid="([0-9]+)"/g)].map(m=>m[1]));
  assert.equal(drawingIds.length,12);assert.equal(new Set(drawingIds).size,drawingIds.length);
  assert.ok(all.some(([name,x])=>name.includes('footer')&&x.includes('SECTIONPAGES')));
  assert.ok(xml.includes('w:start="1"'));
  for(const [,x]of all)for(const pr of x.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g)||[])assert.ok((pr.match(/<w:pStyle\b/g)||[]).length<=1);
  for(const name of Object.keys(z.files).filter(n=>n.endsWith('.rels')))assert.doesNotMatch(await z.file(name).async('string'),/TargetMode="External"/);
  assert.doesNotMatch(await z.file('word/settings.xml').async('string'),/<w:updateFields/);
  assert.ok(xml.includes('```'));assert.ok(xml.includes('<w:tab/>'));assert.ok(xml.includes('- literal evidence line'));
});

test('v2 disabled summary/evidence omit their output without dangling hyperlinks or deleting data',async()=>{
  const p=await load();p.project.cover.enabled=false;p.project.sections.report.find(s=>s.key==='findingsSummary').enabled=false;
  p.project.sections.finding.find(s=>s.key==='evidence').enabled=false;
  const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
  assert.doesNotMatch(xml,/<w:hyperlink\b/);assert.doesNotMatch(xml,/SEQ Figure/);assert.equal(p.images.length,8);
  assert.equal((xml.match(/<w:sectPr[ >]/g)||[]).length,1);
});

test('v2 fixture validation and bounds export retain 20 findings/30 original captions plus two logos',async()=>{
  const p=await load('bounds'),raw=JSON.stringify(p);assert.equal((await validateProjectFile(raw,Buffer.byteLength(raw))).ok,true);
  const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
  assert.equal((xml.match(/SEQ Figure/g)||[]).length,30);assert.equal((xml.match(/<w:bookmarkStart/g)||[]).length,21);
  assert.ok(xml.includes('SYN-2026-20'));assert.equal(p.images.length,32);
});

test('renameable Findings chapter starts a page without an extra break before its first finding',async()=>{
  const p=await load();p.project.labels.findings='Technical observations';
  const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
  const paragraphs=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
  const chapter=paragraphs.find(x=>x.includes('>Technical observations</w:t>'));
  assert.ok(chapter);assert.match(chapter,/<w:pStyle w:val="Heading1"/);assert.match(chapter,/<w:pageBreakBefore/);
  const first=paragraphs.find(x=>x.includes('w:name="finding_F_001"'));
  const second=paragraphs.find(x=>x.includes('w:name="finding_F_002"'));
  assert.doesNotMatch(first,/<w:pageBreakBefore/);assert.match(second,/<w:pageBreakBefore/);
  assert.ok(xml.indexOf('Technical observations')<xml.indexOf('w:name="finding_F_001"'));
  p.findings=[];p.images=[];p.project.branding.testerLogo.imageId=null;p.project.branding.clientLogo.imageId=null;
  const empty=await JSZip.loadAsync(await exportDocx(p));assert.ok(!(await empty.file('word/document.xml').async('string')).includes('Technical observations'));
});

test('single-line metadata, bound rows, assets and scoring labels preserve leading dash and tabs literally',async()=>{
  const p=await load();p.project.subtitle='- Draft\tfor review';p.project.client='- Client row';p.project.reportVersion='- Version row';
  p.project.organisation='- Attribution';p.project.testerName='Tester';p.project.classification='- Classification';
  p.project.labels.severity='- Rating';p.findings[0].affectedAssets=['- literal asset'];
  p.findings[0].description='- intentional section bullet';
  p.project.engagement.rows.find(r=>r.source==='custom').value='- intentional custom bullet';
  const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
  const paragraphs=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
  for(const marker of ['- Draft','- Client row','- Version row','- Attribution | Tester','- Classification','- literal asset','- Rating']){
    const found=paragraphs.filter(x=>x.includes(marker));assert.ok(found.length,marker);for(const x of found)assert.doesNotMatch(x,/<w:numPr>/,marker);
  }
  assert.ok(paragraphs.some(x=>x.includes('- Draft')&&x.includes('<w:tab/>')));
  for(const marker of ['intentional section bullet','intentional custom bullet'])assert.ok(paragraphs.some(x=>x.includes('>'+marker+'</w:t>')&&x.includes('<w:numPr>')),marker);
});
