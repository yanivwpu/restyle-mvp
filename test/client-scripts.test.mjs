import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scripts=['public/assets/admin.js','public/assets/listing-admin.js','public/assets/settlement-admin.js','public/assets/main.js','public/assets/sign.js'];
for(const file of scripts){
 test('Browser JavaScript parses cleanly: '+file,()=>{
  const source=readFileSync(path.join(root,file),'utf8');
  assert.doesNotThrow(()=>new Script(source,{filename:file}));
 });
}
test('Login and eBay demo handlers are each installed only once',()=>{
 const text=readFileSync(path.join(root,'public/assets/admin.js'),'utf8');
 assert.equal(text.split("$('#loginForm').addEventListener('submit'").length-1,1);
 assert.equal(text.split("$('#ebayDemo')?.addEventListener('toggle'").length-1,1);
 assert.equal(text.split("async function loadEbayStatus(){").length-1,1);
 assert.equal(text.split("async function showDetail(id)").length-1,1);
});
