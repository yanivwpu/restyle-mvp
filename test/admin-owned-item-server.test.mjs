import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('staff-owned inventory is private, saved, and generates no customer consent or mail', {timeout:20000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shukchic-staff-'));
 const child=spawn(process.execPath,['server.mjs'],{
  cwd:root,env:{...process.env,PORT:'0',DATA_DIR:temp,NODE_ENV:'test',ADMIN_PASSWORD:'test-safe-password-12345',SESSION_SECRET:'a'.repeat(40),RESEND_API_KEY:'',EMAIL_FROM:'',ADMIN_NOTIFY_EMAIL:''},
  stdio:['ignore','pipe','pipe']
 });
 let stderr='';
 child.stderr.on('data',part=>{stderr+=part.toString();});
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server did not start: '+stderr.slice(0,500))),8500);
   child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+stderr.slice(0,500)));});
   child.stdout.on('data',chunk=>{
    const match=chunk.toString().match(/SHUKCHIC MVP listening on (\d+)/);
    if(match){clearTimeout(timer);resolve(Number(match[1]));}
   });
  });
  const origin='http://127.0.0.1:'+port;
  const get=async(url,cookie='')=>fetch(origin+url,{headers:cookie?{Cookie:cookie}:{}});
  const post=async(url,body,cookie='')=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await get('/admin/new-item')).status,401);
  assert.equal((await post('/api/admin/owned-items',{brand:'Test',category:'Jewelry',condition:'Excellent'})).status,401);
  const login=await post('/api/admin/login',{password:'test-safe-password-12345'});
  assert.equal(login.status,200);
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];assert.ok(cookie.startsWith('restyle_session='));
  assert.equal((await get('/admin/new-item',cookie)).status,200);
  const item=await post('/api/admin/owned-items',{brand:'SHUKCHIC Test',category:'Jewelry',condition:'Excellent',description:'Company stock',photos:[]},cookie);
  assert.equal(item.status,201);const saved=await item.json();
  const detail=await get('/api/admin/submissions/'+saved.id,cookie);assert.equal(detail.status,200);
  const data=await detail.json();
  assert.equal(data.item.intake_source,'STAFF_OWNED');
  assert.equal(data.item.status,'RECEIVED');
  assert.equal(data.item.email_status,'NOT_APPLICABLE');
  assert.equal(data.item.email,'');
  assert.equal(data.mails.length,0);
  assert.equal(data.agreement,null);
  const update=await post('/api/admin/submissions/'+saved.id+'/update',{status:'READY_TO_LIST',receivedVerified:true,sku:'STAFF-001',binLocation:'A-1',estimateDollars:''},cookie);
  assert.equal(update.status,200,await update.text().catch(()=>''));
  const publicSubmission=await post('/api/submissions',{firstName:'Customer',email:'customer@example.com',brand:'Brand',category:'Jewelry',condition:'Excellent',photos:[]});
  assert.equal(publicSubmission.status,400);
 }finally{
  child.kill('SIGTERM');
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
