import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyProjectV4,FINDING_STATUSES,ENGAGEMENT_STATUSES} from '../../src/app/project.js';
import {formatFindingStatus,formatEngagementStatus,findingStatusCounts,ratingCounts} from '../../src/scoring/index.js';

test('status enums have exact distinct labels and null is never a guessed state',()=>{
  assert.deepEqual(FINDING_STATUSES.map(s=>formatFindingStatus(s)),['Open','Fixed','Partly fixed','Risk accepted','False positive']);
  assert.deepEqual(ENGAGEMENT_STATUSES.map(s=>formatEngagementStatus(s)),['Draft','In review','Delivered','Retest due']);
  for(const fn of [formatFindingStatus,formatEngagementStatus]){
    assert.equal(fn(null),'Not set');assert.equal(fn(null,{notSet:'Unrecorded <&>'}),'Unrecorded <&>');
    for(const invalid of [undefined,'null','','Open','__proto__',0,false,{},[]])assert.throws(()=>fn(invalid));
  }
  assert.throws(()=>formatFindingStatus('delivered'));assert.throws(()=>formatEngagementStatus('fixed'));
});
test('status counts include every distinct state plus null, retain zeros, ignore presentation and never alter ratings',()=>{
  const p=createEmptyProjectV4();
  p.project.labels.status='Disposition';p.project.labels.statusNotSet='Not recorded';
  p.findings=[...FINDING_STATUSES,null,'fixed','risk_accepted'].map(status=>({status,rating:'High',cvss:null}));
  const before=structuredClone(p),ratings=ratingCounts(p),counts=findingStatusCounts(p);
  assert.deepEqual(p,before);assert.equal(counts.total,8);
  assert.deepEqual(counts.rows.map(r=>r.key),[...FINDING_STATUSES,null]);
  assert.deepEqual(counts.rows.map(r=>r.count),[1,2,1,2,1,1]);
  assert.equal(counts.label,'Disposition');assert.equal(counts.rows.at(-1).label,'Not recorded');
  p.project.findingStatusDisplay={keyFacts:false,summaryColumn:true,counts:true};p.findings.reverse();
  p.project.sections.report.find(s=>s.key==='findingsSummary').enabled=false;
  assert.deepEqual(findingStatusCounts(p),counts);assert.deepEqual(ratingCounts(p),ratings);
  p.findings=[];assert.ok(findingStatusCounts(p).rows.every(r=>r.count===0));
  p.findings=[{status:'null'}];assert.throws(()=>findingStatusCounts(p));
  assert.throws(()=>findingStatusCounts({...p,schemaVersion:3}));
});
