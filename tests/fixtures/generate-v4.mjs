// Synthetic v4 export fixtures from the existing reviewed v2 inputs, not client data.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {migrateV2toV3,migrateV3toV4,validateProjectFileV4} from '../../src/app/project.js';
export const longReferenceUrl='https://example.test/'+ 'a'.repeat(2048-'https://example.test/'.length);
export async function v4Fixture(bounds=false){
  const old=JSON.parse(await fs.readFile(new URL(bounds?'./v2-bounds.json':'./v2-small.json',import.meta.url),'utf8'));
  const p=migrateV3toV4(migrateV2toV3(old));
  p.project.engagementStatus='retest_due';p.project.findingStatusDisplay={keyFacts:true,summaryColumn:true,counts:true};
  p.project.sections.report.find(s=>s.key==='contents').enabled=true;p.project.backToSummaryLinks=true;
  p.project.engagement.rows.push({source:'engagementStatus',label:'Engagement status',enabled:true});
  const states=['open','fixed','partly_fixed','risk_accepted','false_positive',null];
  p.findings.forEach((f,i)=>{f.status=states[i%states.length];f.references=[{title:'Synthetic reference '+(i+1)+' <&>',url:i===0?longReferenceUrl:'https://example.test/reference/'+(i+1)}];});
  p.findings[0].references.unshift({title:'[[keep only the references that match the tested case, then delete this row]]',url:''});
  const raw=JSON.stringify(p);const result=await validateProjectFileV4(raw,Buffer.byteLength(raw));
  if(!result.ok)throw Error(result.errors.join('\n'));
  return p;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const [name,bounds] of [['v4-small.json',false],['v4-bounds.json',true]]){
    const p=await v4Fixture(bounds);await fs.writeFile(new URL(name,import.meta.url),JSON.stringify(p,null,2)+'\n');
    console.log(name+': '+p.findings.length+' findings / '+p.images.length+' images');
  }
}
