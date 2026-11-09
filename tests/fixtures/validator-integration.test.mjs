import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateProjectFile} from '../../src/app/project.js';
for(const name of ['small','bounds'])test(name+' fixture passes frozen schema v1 app validation unchanged',async()=>{
 const raw=await fs.readFile(new URL('./'+name+'.json',import.meta.url),'utf8');const result=await validateProjectFile(raw,Buffer.byteLength(raw,'utf8'));assert.equal(result.ok,true,JSON.stringify(result.errors));assert.deepEqual(result.project,JSON.parse(raw));
});
