import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'..');
const dir=mkdtempSync(path.join(tmpdir(),'restyle-test-'));
let child,base='',port;
const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==';
let session='';let submissionId='';let photoId='';
async function pickPort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function request(uri,options={}){const r=await fetch(base+uri,{...options,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...options.headers}});const data=(r.headers.get('content-type')||'').includes('json')?await r.json():null;return {r,data};}
before(async()=>{port=await pickPort();base=`http://127.0.0.1:${port}`;child=spawn(process.execPath,['server.mjs'],{cwd:project,env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_PASSWORD:'test-password-do-not-use-2026',SESSION_SECRET:'test-secret-example-unsafe-not-for-use-anywhere-9090909090',PUBLIC_BASE_URL:base,COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let n=0;const interval=setInterval(async()=>{try{const r=await fetch(base+'/api/health');if(r.ok){clearInterval(interval);resolve();}}catch{}if(++n>80){clearInterval(interval);reject(Error('Server failed to start'));}},75);});});
after(()=>{child?.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});});
test('Health and public landing render',async()=>{const x=await request('/api/health');assert.equal(x.r.status,200);assert.equal(x.data.ok,true);const r=await fetch(base+'/');assert.equal(r.status,200);const page=await r.text();assert.match(page,/Give Your Style a Second Life/);assert.match(page,/href="https:\/\/www\.ebay\.com\/sch\/i\.html\?_ssn=ssammikat99u2"[^>]*>Shop Now/);assert.match(page,/href="\/submit">Upload Your Item for Review/);});
test('Photo submission rejects missing photos',async()=>{const x=await request('/api/submissions',{method:'POST',body:JSON.stringify({firstName:'Demo',email:'demo@example.com',brand:'Coach',category:'Handbags',condition:'Excellent',consent:true,ownerConfirmed:true,photos:[]})});assert.equal(x.r.status,400);});
test('Creates real submission and email outbox without falsely claiming sent',async()=>{const b={firstName:'Demo',email:'demo@example.com',brand:'Coach',category:'Handbags',condition:'Excellent',description:'Gently used handbag',consent:true,ownerConfirmed:true,photos:[{name:'test.jpg',data:jpeg}]};const x=await request('/api/submissions',{method:'POST',body:JSON.stringify(b)});assert.equal(x.r.status,201,JSON.stringify(x.data));assert.match(x.data.id,/^RS-[A-F0-9]{10}$/);assert.equal(x.data.emailStatus,'SETUP_REQUIRED');submissionId=x.data.id;});
test('Admin endpoints require authentication',async()=>{const x=await request('/api/admin/submissions');assert.equal(x.r.status,401);});
test('Login obtains HttpOnly authenticated cookie',async()=>{const x=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:'test-password-do-not-use-2026'})});assert.equal(x.r.status,200);const c=x.r.headers.get('set-cookie')||'';assert.match(c,/HttpOnly/);session=c.split(';')[0];assert.equal((await request('/api/admin/session')).data.authenticated,true);});
test('Admin can retrieve submission details and protected photos',async()=>{const rows=(await request('/api/admin/submissions')).data.items;assert.equal(rows.length,1);assert.equal(rows[0].id,submissionId);const r=(await request(`/api/admin/submissions/${submissionId}`)).data;assert.equal(r.photos.length,1);photoId=r.photos[0].id;const ok=await fetch(base+`/api/admin/photos/${photoId}`,{headers:{Cookie:session}});assert.equal(ok.status,200);const denied=await fetch(base+`/api/admin/photos/${photoId}`);assert.equal(denied.status,401);});
test('Warehouse verification gate blocks listing unreceived merchandise',async()=>{const id=submissionId;const blocked=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'LISTED',receivedVerified:false})});assert.equal(blocked.r.status,409);const allowed=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'RECEIVED',receivedVerified:true,sku:'REST-1',binLocation:'A1',estimateDollars:140})});assert.equal(allowed.r.status,200);const detail=(await request(`/api/admin/submissions/${id}`)).data.item;assert.equal(detail.received_verified,1);assert.equal(detail.estimate_cents,14000);});


test('Staging pilot accepts five-character password; other production environments reject it', async()=>{
  const shortPassword='P7k3!';
  const safeSession='unit-test-session-secret-at-least-thirty-two-chars-6789';
  const stageDir=mkdtempSync(path.join(tmpdir(),'restyle-stage-password-'));
  const stagePort=await pickPort();
  const stageBase=`http://127.0.0.1:${stagePort}`;
  const stage=spawn(process.execPath,['server.mjs'],{cwd:project,env:{...process.env,NODE_ENV:'production',RAILWAY_ENVIRONMENT_NAME:'staging',PORT:String(stagePort),DATA_DIR:stageDir,ADMIN_PASSWORD:shortPassword,SESSION_SECRET:safeSession,COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
  try{
    let ready=false;
    for(let i=0;i<80;i++){
      await new Promise(resolve=>setTimeout(resolve,75));
      try{const response=await fetch(stageBase+'/api/health');if(response.ok){ready=true;break;}}catch{}
    }
    assert.equal(ready,true,'five-character staging pilot password allows server startup');
    const response=await fetch(stageBase+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:shortPassword})});
    assert.equal(response.status,200,'five-character password works for staging login');
  } finally {
    stage.kill('SIGTERM');
    rmSync(stageDir,{recursive:true,force:true});
  }

  const prodDir=mkdtempSync(path.join(tmpdir(),'restyle-prod-password-'));
  const prodPort=await pickPort();
  const prod=spawn(process.execPath,['server.mjs'],{cwd:project,env:{...process.env,NODE_ENV:'production',RAILWAY_ENVIRONMENT_NAME:'production',PORT:String(prodPort),DATA_DIR:prodDir,ADMIN_PASSWORD:shortPassword,SESSION_SECRET:safeSession},stdio:['ignore','pipe','pipe']});
  try{
    let output='';
    prod.stderr.on('data',chunk=>{output+=chunk.toString();});
    const exitCode=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{prod.kill('SIGTERM');reject(Error('Production password test timed out'));},4000);prod.once('exit',code=>{clearTimeout(timeout);resolve(code);});});
    assert.notEqual(exitCode,0,'five-character production password is rejected');
    assert.match(output,/14\+ chars/);
  } finally {
    prod.kill('SIGTERM');
    rmSync(prodDir,{recursive:true,force:true});
  }
});
