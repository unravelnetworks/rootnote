import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {exportDocx} from '../../src/export-docx/index.js';
const load=async(name='small')=>JSON.parse(await fs.readFile(new URL('./'+name+'.json',import.meta.url),'utf8'));
for(const [paper,w,h]of [['A4',11906,16838],['Letter',12240,15840]])test('editable OOXML has images, stable IDs, cached SEQ captions and '+paper+' dimensions',async()=>{
 const p=await load();const z=await JSZip.loadAsync(await exportDocx(p,{paperSize:paper}));
 const xml=await z.file('word/document.xml').async('string');
 const styles=await z.file('word/styles.xml').async('string');
 assert.match(xml,new RegExp('w:w="'+w+'" w:h="'+h+'"'));
 for(const f of p.findings)assert.ok(xml.includes(f.id));
 assert.equal((xml.match(/<a:blip /g)||[]).length,6);
 const drawIds=[...xml.matchAll(/<wp:docPr\b[^>]*\bid="([0-9]+)"/g)].map(m=>m[1]);assert.equal(drawIds.length,6);assert.equal(new Set(drawIds).size,6);
 assert.equal((xml.match(/SEQ Figure \\?/g)||[]).length,6);
 const styleIds=[...styles.matchAll(/w:styleId="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(styleIds).size,styleIds.length);
 for(const s of ['Title','Body','Code','Caption','Heading1','Heading2'])assert.ok(styles.includes('w:styleId="'+s+'"'));
 for(const name of Object.keys(z.files).filter(n=>n.endsWith('.rels')))assert.doesNotMatch(await z.file(name).async('string'),/TargetMode="External"/);
 assert.ok(xml.includes('&lt;tag&gt;')&&xml.includes('&amp;'));
 const foot=await z.file('word/footer1.xml').async('string');assert.match(foot,/PAGE/);assert.match(foot,/NUMPAGES/);
});
test('bounds fixture exports every evidence image and caption',async()=>{
 const p=await load('bounds');const z=await JSZip.loadAsync(await exportDocx(p));const xml=await z.file('word/document.xml').async('string');
 assert.equal((xml.match(/<a:blip /g)||[]).length,30);assert.equal((xml.match(/SEQ Figure/g)||[]).length,30);
 for(const f of p.findings)assert.ok(xml.includes(f.id));
});
test('stable IDs survive finding reorder',async()=>{const p=await load();p.findings.reverse();const z=await JSZip.loadAsync(await exportDocx(p));const xml=await z.file('word/document.xml').async('string');assert.ok(xml.indexOf('F-003')<xml.indexOf('F-001'));});
test('invalid XML text, missing evidence and duplicate references reject visibly',async()=>{
 for(const mutate of [p=>p.findings[0].title='bad\u0000text',p=>p.findings[0].evidence.push('IMG-9999'),p=>p.findings[1].evidence.push(p.findings[0].evidence[0])]){const p=await load();mutate(p);await assert.rejects(exportDocx(p));}
});
test('unscored severity and astral Unicode remain explicit',async()=>{const p=await load();p.findings[0].severity=null;p.findings[0].description='Astral Unicode: ðŸ”’';const z=await JSZip.loadAsync(await exportDocx(p));const xml=await z.file('word/document.xml').async('string');assert.ok(xml.includes('Unscored'));assert.ok(xml.includes('ðŸ”’'));});

test('body bullets have one pStyle; code preserves hyphens, spaces and real tabs',async()=>{
 const p=await load();p.findings[0].description='Intro\n- body bullet';p.findings[0].reproduction='  \t- literal HTTP body\n- diff removal\n+ diff addition';
 const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string');
 for(const ppr of xml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/g)||[])assert.ok((ppr.match(/<w:pStyle\b/g)||[]).length<=1,'duplicate paragraph style');
 const ps=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)||[];
 const code=ps.filter(s=>s.includes('w:val="Code"'));assert.ok(code.some(s=>s.includes('- literal HTTP body')&&s.includes('<w:tab/>')&&s.includes('>  </w:t>')));
 assert.ok(code.some(s=>s.includes('>- diff removal</w:t>')));assert.ok(code.every(s=>!s.includes('<w:numPr>')));
 assert.ok(ps.some(s=>s.includes('>body bullet</w:t>')&&s.includes('<w:numPr>')));
});
test('no forced fields update, no empty sections, clean footer classification separator',async()=>{
 const p=await load();p.project.classification='';p.project.scope='';for(const f of p.findings)f.impact='';
 const z=await JSZip.loadAsync(await exportDocx(p)),xml=await z.file('word/document.xml').async('string'),settings=await z.file('word/settings.xml').async('string'),footer=await z.file('word/footer1.xml').async('string');
 assert.doesNotMatch(settings,/<w:updateFields/);assert.ok(!xml.includes('>Impact</w:t>'));assert.ok(!xml.includes('>Scope</w:t>'));assert.ok(!footer.includes(' | Page '));assert.ok(footer.includes('>Page </w:t>'));
});

test('body bullet numbering contains U+2022 rather than a question mark',async()=>{
 const z=await JSZip.loadAsync(await exportDocx(await load()));
 const xml=await z.file('word/numbering.xml').async('string');
 assert.match(xml,/<w:lvlText w:val="(?:\u2022|&#8226;|&#x2022;)"\s*\/>/);
 assert.doesNotMatch(xml,/<w:lvlText w:val="\?"/);
});
