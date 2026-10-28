import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'..');
const dir=mkdtempSync(path.join(tmpdir(),'restyle-test-'));
let child,base='',port;
const jpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==';
let session='';let submissionId='';let photoId='';
async function pickPort(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function request(uri,options={}){const r=await fetch(base+uri,{...options,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...options.headers}});const data=(r.headers.get('content-type')||'').includes('json')?await r.json():null;return {r,data};}
before(async()=>{port=await pickPort();base=`http://127.0.0.1:${port}`;child=spawn(process.execPath,['server.mjs'],{cwd:project,env:{...process.env,PORT:String(port),DATA_DIR:dir,ADMIN_PASSWORD:'test-password-do-not-use-2026',SESSION_SECRET:'test-secret-example-unsafe-not-for-use-anywhere-9090909090',PUBLIC_BASE_URL:base,COOKIE_SECURE:'false',RAILWAY_ENVIRONMENT_NAME:'staging',RESEND_API_KEY:'',EMAIL_FROM:'',OPENAI_API_KEY:'',ADMIN_NOTIFY_EMAIL:'staff@example.com',AGREEMENT_PILOT_MODE:'true',CONSIGNMENT_AGREEMENT_TEXT:'PILOT NONBINDING TEST ONLY. Consignor retains ownership until completed sale. This draft is not for genuine customers and no goods may be shipped. No commission structure is finalized.',CONSIGNMENT_SHIPPING_INSTRUCTIONS:'PILOT MODE: DO NOT SHIP. No real receiving address is supplied.'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let n=0;const interval=setInterval(async()=>{try{const r=await fetch(base+'/api/health');if(r.ok){clearInterval(interval);resolve();}}catch{}if(++n>80){clearInterval(interval);reject(Error('Server failed to start'));}},75);});});
after(()=>{child?.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});});
test('Health and public landing render',async()=>{const x=await request('/api/health');assert.equal(x.r.status,200);assert.equal(x.data.ok,true);const r=await fetch(base+'/');assert.equal(r.status,200);const page=await r.text();assert.match(page,/<title>SHUKCHIC \| Designer Fashion Consignment &amp; Resale<\/title>|<title>SHUKCHIC \| Designer Fashion Consignment & Resale<\/title>/);assert.match(page,/src="\/assets\/shukchic-logo.svg\?v=20261027-black80"/);const logo=await fetch(base+'/assets/shukchic-logo.svg?v=20261027-black80');assert.equal(logo.status,200);const vector=await logo.text();assert.match(vector,/<svg/);assert.match(vector,/SHUKCHIC/);assert.doesNotMatch(vector,/<image\b/i);assert.match(page,/href="https:\/\/www\.ebay\.com\/sch\/i\.html\?_ssn=ssammikat99u2"[^>]*>Shop Now/);assert.match(page,/href="\/submit">Upload Your Item for Review/);});
test('Email-safe SHUKCHIC PNG renders for transactional email clients',async()=>{const r=await fetch(base+'/assets/shukchic-email-logo.png');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/png/);const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const file=new DatabaseSync(path.join(dir,'restyle.sqlite'));file.close();});
test('Staging stays non-indexable while metadata describes eBay resale',async()=>{const r=await fetch(base+'/');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');const h=await r.text();assert.match(h,/<meta name="description"[^>]*eBay/);assert.match(h,/Where will my items be sold/);assert.match(h,/SHUKCHIC is an independent service/);assert.doesNotMatch(h,/meta name="keywords"/i);});
test('Photo submission rejects missing photos',async()=>{const x=await request('/api/submissions',{method:'POST',body:JSON.stringify({firstName:'Demo',email:'demo@example.com',brand:'Coach',category:'Handbags',condition:'Excellent',consent:true,ownerConfirmed:true,photos:[]})});assert.equal(x.r.status,400);});
test('Creates real submission and email outbox without falsely claiming sent',async()=>{const b={firstName:'Demo',email:'demo@example.com',brand:'Coach',category:'Handbags',condition:'Excellent',description:'Gently used handbag',consent:true,ownerConfirmed:true,photos:[{name:'test.jpg',data:jpeg}]};const x=await request('/api/submissions',{method:'POST',body:JSON.stringify(b)});assert.equal(x.r.status,201,JSON.stringify(x.data));assert.match(x.data.id,/^RS-[A-F0-9]{10}$/);assert.equal(x.data.emailStatus,'SETUP_REQUIRED');submissionId=x.data.id;const file=new DatabaseSync(path.join(dir,'restyle.sqlite'));const email=file.prepare("SELECT html FROM mail_outbox WHERE submission_id=? AND kind='confirmation'").get(submissionId);file.close();assert.match(email.html,/shukchic-email-logo\.png/);});
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

test('Approval signing flow stores protected PDF and queues shipping only after signature',async()=>{
 const payload={firstName:'Alex',email:'alex@example.com',brand:'Prada',category:'Handbags',condition:'Excellent',description:'Test only',consent:true,ownerConfirmed:true,photos:[{name:'photo.jpg',data:jpeg}]};
 const submitted=await request('/api/submissions',{method:'POST',body:JSON.stringify(payload)});
 assert.equal(submitted.r.status,201);
 const id=submitted.data.id;
 let detail=(await request(`/api/admin/submissions/${id}`)).data;
 assert.equal(detail.mails.filter(x=>x.kind==='confirmation').length,1);
 assert.equal(detail.mails.filter(x=>x.kind==='admin_notification').length,1);
 const approved=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'ACCEPTED',estimateDollars:150})});
 assert.equal(approved.r.status,200,JSON.stringify(approved.data));
 detail=(await request(`/api/admin/submissions/${id}`)).data;
 assert.equal(detail.agreement.state,'PENDING');
 assert.equal(detail.mails.some(x=>x.kind==='approval_sign'),true);
 assert.equal(detail.mails.some(x=>x.kind==='shipping'),false);
 const blocked=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'AWAITING_SHIPMENT'})});
 assert.equal(blocked.r.status,409);
 const db=new DatabaseSync(path.join(dir,'restyle.sqlite'));
 const row=db.prepare("SELECT html FROM mail_outbox WHERE submission_id=? AND kind='approval_sign'").get(id);
 db.close();
 const token=row.html.match(/\/sign\/([a-f0-9]{64})/)?.[1];
 assert.match(token,/^[a-f0-9]{64}$/);
 const page=await fetch(base+`/sign/${token}`);assert.equal(page.status,200);assert.match(await page.text(),/Electronic signature/);
 const view=await request(`/api/agreements/${token}`);assert.equal(view.r.status,200);
 assert.match(view.data.terms,/PILOT NONBINDING/);
 const wrong=await request(`/api/agreements/${token}`,{method:'POST',body:JSON.stringify({signerName:'Alex Reviewer',email:'wrong@example.com',electronicConsent:true,agreeTerms:true,typedSignature:true})});
 assert.equal(wrong.r.status,400);
 const signed=await request(`/api/agreements/${token}`,{method:'POST',body:JSON.stringify({signerName:'Alex Reviewer',email:'alex@example.com',electronicConsent:true,agreeTerms:true,typedSignature:true})});
 assert.equal(signed.r.status,200,JSON.stringify(signed.data));
 detail=(await request(`/api/admin/submissions/${id}`)).data;
 assert.equal(detail.agreement.state,'SIGNED');
 assert.equal(detail.item.status,'AWAITING_SHIPMENT');
 assert.equal(detail.mails.some(x=>x.kind==='shipping'),true);
 assert.equal(detail.mails.some(x=>x.kind==='signed_receipt'),true);
 assert.equal(detail.mails.some(x=>x.kind==='agreement_signed_admin'),true);
 assert.equal(detail.mails.filter(x=>x.kind==='shipping')[0].state,'SETUP_REQUIRED');
 const signedPdf=await fetch(base+`/api/admin/submissions/${id}/agreement.pdf`,{headers:{Cookie:session}});
 assert.equal(signedPdf.status,200);assert.match(signedPdf.headers.get('content-type'),/application\/pdf/);assert.ok((await signedPdf.arrayBuffer()).byteLength > 800);
 const noAccess=await fetch(base+`/api/admin/submissions/${id}/agreement.pdf`);assert.equal(noAccess.status,401);
 const second=await request(`/api/agreements/${token}`,{method:'POST',body:JSON.stringify({signerName:'Alex Reviewer',email:'alex@example.com',electronicConsent:true,agreeTerms:true,typedSignature:true})});assert.equal(second.r.status,409);
 const signedPdfCustomer=await fetch(base+`/api/agreements/${token}/pdf`);assert.equal(signedPdfCustomer.status,200);
 // Staff listing-draft gate: signed alone is not enough until warehouse confirms possession.
 const before=await request(`/api/admin/submissions/${id}/listing`);
 assert.equal(before.r.status,200);assert.equal(before.data.publishingEnabled,false);assert.equal(before.data.aiAvailable,false);
 assert.ok(before.data.gates.some(x=>x.includes('Warehouse')));
 const blockedDraft=await request(`/api/admin/submissions/${id}/listing/generate`,{method:'POST',body:JSON.stringify({mode:'starter',confirmPhysicalFacts:true})});
 assert.equal(blockedDraft.r.status,409);
 const warehouse=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'RECEIVED',receivedVerified:true,sku:'RS-PRADA-1',binLocation:'B-1'})});
 assert.equal(warehouse.r.status,200);
 const draft=await request(`/api/admin/submissions/${id}/listing/generate`,{method:'POST',body:JSON.stringify({mode:'starter',confirmPhysicalFacts:true,size:'Medium',color:'Black',flaws:'Minor corner scuff'})});
 assert.equal(draft.r.status,200,JSON.stringify(draft.data));assert.equal(draft.data.draft.source,'starter');
 assert.match(draft.data.draft.title,/Prada/);assert.match(draft.data.draft.description,/Minor corner scuff/);
 const aiUnavailable=await request(`/api/admin/submissions/${id}/listing/generate`,{method:'POST',body:JSON.stringify({mode:'ai',confirmPhysicalFacts:true})});
 assert.equal(aiUnavailable.r.status,409);
 const stillThere=await request(`/api/admin/submissions/${id}/listing`);
 assert.equal(stillThere.data.draft.source,'starter');
 const saved=await request(`/api/admin/submissions/${id}/listing/save`,{method:'POST',body:JSON.stringify({title:'Prada Black Leather Handbag Medium',description:stillThere.data.draft.description,categorySuggestion:'Handbags',categoryId:'169291',price:'290'})});
 assert.equal(saved.r.status,200,JSON.stringify(saved.data));assert.equal(saved.data.draft.price_cents,29000);
 const reviewed=await request(`/api/admin/submissions/${id}/listing/approve`,{method:'POST',body:'{}'});
 assert.equal(reviewed.r.status,200,JSON.stringify(reviewed.data));assert.equal(reviewed.data.draft.status,'REVIEWED');assert.equal(reviewed.data.publishingEnabled,false);
 const noPublish=await request(`/api/admin/submissions/${id}/listing/publish`,{method:'POST',body:'{}'});
 assert.equal(noPublish.r.status,404,'No eBay publishing endpoint exists');
 const unauthed=await fetch(base+`/api/admin/submissions/${id}/listing`);assert.equal(unauthed.status,401);
});

test('Rejection queues notification without agreement link and blocks unsigned listing',async()=>{
 const payload={firstName:'Sam',email:'sam@example.com',brand:'Coach',category:'Handbags',condition:'Excellent',description:'Test item',consent:true,ownerConfirmed:true,photos:[{name:'photo.jpg',data:jpeg}]};
 const added=await request('/api/submissions',{method:'POST',body:JSON.stringify(payload)});assert.equal(added.r.status,201);
 const id=added.data.id;
 const rejected=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'REJECTED'})});assert.equal(rejected.r.status,200);
 const d=(await request(`/api/admin/submissions/${id}`)).data;
 assert.equal(d.mails.some(x=>x.kind==='status_REJECTED'),true);
 assert.equal(d.agreement,null);
 const cannotList=await request(`/api/admin/submissions/${id}/update`,{method:'POST',body:JSON.stringify({status:'LISTED',receivedVerified:true})});assert.equal(cannotList.r.status,409);
});

test('SHUKCHIC payout ledger enforces net-proceeds tiers, disputes and 30-day hold',async()=>{
 const payload={firstName:'Pat',email:'pat@example.com',brand:'Chanel',category:'Handbags',condition:'Good',description:'Settlement test only',consent:true,ownerConfirmed:true,photos:[{name:'photo.jpg',data:jpeg}]};
 const made=await request('/api/submissions',{method:'POST',body:JSON.stringify(payload)});
 assert.equal(made.r.status,201,JSON.stringify(made.data));const id=made.data.id;
 const approval=await request('/api/admin/submissions/'+id+'/update',{method:'POST',body:JSON.stringify({status:'ACCEPTED'})});
 assert.equal(approval.r.status,200);
 const db=new DatabaseSync(path.join(dir,'restyle.sqlite'));
 const email=db.prepare("SELECT html FROM mail_outbox WHERE submission_id=? AND kind='approval_sign'").get(id).html;db.close();
 const token=email.match(/\/sign\/([a-f0-9]{64})/)?.[1];assert.match(token,/^[a-f0-9]{64}$/);
 const signed=await request('/api/agreements/'+token,{method:'POST',body:JSON.stringify({signerName:'Pat Seller',email:'pat@example.com',electronicConsent:true,agreeTerms:true,typedSignature:true})});
 assert.equal(signed.r.status,200,JSON.stringify(signed.data));
 const item=await request('/api/admin/submissions/'+id+'/update',{method:'POST',body:JSON.stringify({status:'SOLD',sku:'CH-001',binLocation:'B2',receivedVerified:true})});
 assert.equal(item.r.status,200,JSON.stringify(item.data));
 const directPaid=await request('/api/admin/submissions/'+id+'/update',{method:'POST',body:JSON.stringify({status:'PAID'})});
 assert.equal(directPaid.r.status,409);
 const unauthorized=await fetch(base+'/api/admin/submissions/'+id+'/settlement');assert.equal(unauthorized.status,401);
 const oldDate=new Date(Date.now()-45*86400000).toISOString().slice(0,10);
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const baseSale={salePrice:'650.00',marketplaceFee:'97.50',outboundShipping:'12.50',returnShipping:'0',otherCost:'0',refund:'0',caseStatus:'OPEN',fundsCleared:false,deliveredDate:oldDate,note:'Test only; no funds actually collected'};
 let saved=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify(baseSale)});
 assert.equal(saved.r.status,200,JSON.stringify(saved.data));
 assert.equal(saved.data.split_percent,70);
 assert.equal(saved.data.net_cents,54000);
 assert.equal(saved.data.consignor_cents,37800);
 assert.equal(saved.data.restyle_cents,16200);
 assert.equal(saved.data.state,'CASE_HOLD');
 assert.equal(saved.data.canRecordPayment,false);
 const brokenDate=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,deliveredDate:'2026-99-50'})});
 assert.equal(brokenDate.r.status,400);
 const unresolved=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,caseStatus:'CLEAR',fundsCleared:true,deliveredDate:yesterday})});
 assert.equal(unresolved.r.status,200);assert.equal(unresolved.data.state,'THIRTY_DAY_HOLD');
 saved=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,caseStatus:'RESOLVED',fundsCleared:true})});
 assert.equal(saved.r.status,200);assert.equal(saved.data.state,'READY_FOR_MANUAL_PAYOUT');assert.equal(saved.data.canRecordPayment,false,'Pilot mode cannot mark paid');
 const payAttempt=await request('/api/admin/submissions/'+id+'/settlement/record-payment',{method:'POST',body:JSON.stringify({paymentReference:'MANUAL-12345'})});
 assert.equal(payAttempt.r.status,409,'Pilot mode blocks recording external payout');
 const refunded=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,caseStatus:'REFUNDED',fundsCleared:true,refund:'650.00'})});
 assert.equal(refunded.r.status,200);assert.equal(refunded.data.net_cents,0);assert.equal(refunded.data.state,'NO_PAYABLE_PROCEEDS');
 const cheapTier=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,salePrice:'300.00',marketplaceFee:'45.00',outboundShipping:'5.00',caseStatus:'CLEAR',fundsCleared:true})});
 assert.equal(cheapTier.r.status,200);assert.equal(cheapTier.data.split_percent,60);assert.equal(cheapTier.data.consignor_cents,15000);
 const highTier=await request('/api/admin/submissions/'+id+'/settlement/save',{method:'POST',body:JSON.stringify({...baseSale,salePrice:'1200.00',marketplaceFee:'180.00',outboundShipping:'20.00',caseStatus:'CLEAR',fundsCleared:true})});
 assert.equal(highTier.r.status,200);assert.equal(highTier.data.split_percent,80);assert.equal(highTier.data.consignor_cents,80000);
 const loaded=await request('/api/admin/submissions/'+id);
 assert.equal(loaded.r.status,200);assert.equal(loaded.data.settlement.split_percent,80);
 assert.equal(loaded.data.item.status,'SOLD');
});
