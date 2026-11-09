import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createEmptyProjectV2, migrateV2toV3 } from '../../src/app/project.js';
import { ratingCounts, cvssBand } from '../../src/scoring/index.js';
import { cvssBadge } from '../../src/export-docx/design.js';
import { createReportPlan } from '../../src/export-docx/plan.js';
import { exportDocx } from '../../src/export-docx/index.js';

const vector = impact => `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:${impact}/I:${impact}/A:${impact}`;
function sample(mode='severity+cvss') {
  const p=migrateV2toV3(createEmptyProjectV2(new Date('2026-11-02T00:00:00.000Z')));
  p.project.scoring.mode=mode;
  p.findings=[
    {id:'F-001',title:'Manual Low; CVSS Critical',rating:'Low',cvss:vector('H')},
    {id:'F-002',title:'Manual High; CVSS zero',rating:'High',cvss:vector('N')},
    {id:'F-003',title:'Neither scored',rating:null,cvss:null},
    {id:'F-004',title:'Informational; CVSS Medium',rating:'Informational',cvss:'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N'},
  ].map(f=>({...f,affectedAssets:[],description:'',impact:'',threat:'',recommendation:'',details:[],evidence:[],formats:{description:'plain',impact:'plain',threat:'plain',recommendation:'plain'}}));
  p.project.nextFindingNumber=5;
  return p;
}
const counts = d=>Object.fromEntries(d.rows.map(r=>[r.key,r.count]));

test('FIRST qualitative boundaries and badge colours share the same interpretation',()=>{
  for(const [score,band] of [[null,null],[0,'None'],[0.1,'Low'],[3.9,'Low'],[4,'Medium'],[6.9,'Medium'],[7,'High'],[8.9,'High'],[9,'Critical'],[10,'Critical']]){
    assert.equal(cvssBand(score),band);
    assert.equal(cvssBadge(score)?.level??null,band);
  }
  for(const invalid of [undefined,NaN,Infinity,-1,10.1,'0'])assert.throws(()=>cvssBand(invalid));
});

for(const mode of ['severity','risk','cvss','severity+cvss','risk+cvss'])test('counts preserve independent scoring distributions: '+mode,()=>{
  const p=sample(mode),before=structuredClone(p),result=ratingCounts(p);
  assert.deepEqual(p,before);
  assert.equal(result.total,4);
  assert.deepEqual(result.distributions.map(d=>d.key),mode==='cvss'?['cvss']:mode.includes('+')?['rating','cvss']:['rating']);
  for(const d of result.distributions){
    assert.equal(d.total,4);assert.equal(d.rows.reduce((sum,r)=>sum+r.count,0),4);
    assert.equal(d.rows.length,6);assert.equal(d.rows.at(-1).key,'unscored');
    assert.deepEqual(counts(d),d.key==='rating'?{Critical:0,High:1,Medium:0,Low:1,Informational:1,unscored:1}:{Critical:1,High:0,Medium:1,Low:0,None:1,unscored:1});
  }
});

test('zero findings, all-unscored, custom labels, reorder and hidden fields',()=>{
  const p=sample('risk+cvss');p.project.labels.risk='Business priority <&>';p.project.labels.cvss='Base metric';p.project.labels.unscored='Not assessed';
  let result=ratingCounts(p);
  assert.deepEqual(result.distributions.map(d=>d.label),['Business priority <&>','Base metric']);
  assert.ok(result.distributions.every(d=>d.rows.at(-1).label==='Not assessed'));
  p.findings.reverse();assert.deepEqual(ratingCounts(p),result);
  p.findings.forEach(f=>{f.rating=null;f.cvss=null;});
  assert.ok(ratingCounts(p).distributions.every(d=>d.rows.at(-1).count===4));
  p.findings=[];
  assert.ok(ratingCounts(p).distributions.every(d=>d.total===0&&d.rows.every(r=>r.count===0)));
  p.findings=[{rating:'Critical',cvss:null}];p.project.scoring.mode='cvss';
  result=ratingCounts(p);assert.equal(result.distributions[0].rows.at(-1).count,1);
  assert.equal(result.distributions[0].rows[0].count,0,'hidden manual Critical is not a CVSS score');
});

test('malformed active scores fail instead of becoming an unscored or zero finding',()=>{
  const p=sample('severity');p.findings[0].rating='Prototype';assert.throws(()=>ratingCounts(p));
  p.project.scoring.mode='cvss';p.findings[0].cvss='CVSS:3.1/incomplete';assert.throws(()=>ratingCounts(p));
  assert.throws(()=>ratingCounts({project:{scoring:{mode:'unsupported'}},findings:[]}));
});

for(const paperSize of ['A4','Letter'])test('DOCX emits compact counts after linked findings, respects disabled summary: '+paperSize,async()=>{
  const p=sample();p.project.labels.severity='Manual rating <&>';p.project.labels.cvss='Computed Base';
  const plan=createReportPlan(p,{paperSize});assert.deepEqual(plan.summary.ratingCounts,ratingCounts(p));
  let zip=await JSZip.loadAsync(await exportDocx(p,{paperSize}));
  const xml=await zip.file('word/document.xml').async('string');
  const tables=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)||[];
  const countTables=tables.filter(x=>x.includes('>Findings</w:t>'));
  assert.equal(countTables.length,2);
  assert.match(countTables[0],/Manual rating &lt;&amp;&gt;/);assert.match(countTables[1],/Computed Base/);
  for(const [index,table] of countTables.entries()){
    const rows=table.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)||[];
    assert.equal(rows.length,2,'horizontal header and count row');
    const values=rows.map(r=>[...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]));
    assert.deepEqual(values[0].slice(1),index===0?['Critical','High','Medium','Low','Informational','Unscored','Total']:['Critical','High','Medium','Low','None','Unscored','Total']);
    assert.deepEqual(values[1],index===0?['Findings','0','1','0','1','1','1','4']:['Findings','1','0','1','0','1','1','4']);
    assert.match(rows[0],/<w:tblHeader/);
  }
  assert.ok(xml.indexOf(countTables[0])>xml.indexOf('Manual Low; CVSS Critical'));
  assert.match(xml,/w:anchor="finding_F_001"/);assert.doesNotMatch(xml,/<w:updateFields/);
  p.project.sections.report.find(s=>s.key==='findingsSummary').enabled=false;
  zip=await JSZip.loadAsync(await exportDocx(p,{paperSize}));
  const hiddenXml=await zip.file('word/document.xml').async('string');
  assert.equal((hiddenXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)||[]).filter(t=>t.includes('>Findings</w:t>')).length,0);
});
