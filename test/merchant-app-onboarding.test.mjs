import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('app-first merchant registration, pending approval, in-app signing and protected inventory', {timeout:30000},async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shukchic-app-onboarding-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',DATA_DIR:temp,NODE_ENV:'test',ADMIN_PASSWORD:'merchant-test-admin-password',SESSION_SECRET:'x'.repeat(40),RESEND_API_KEY:'',EMAIL_FROM:'',ADMIN_NOTIFY_EMAIL:'',PUBLIC_BASE_URL:'http://localhost'},stdio:['ignore','pipe','pipe']});
 let stderr='';
 child.stderr.on('data',d=>stderr+=d.toString());
 try{
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout '+stderr.slice(0,500))),9000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Exit '+code+': '+stderr.slice(0,500)));});child.stdout.on('data',data=>{const m=data.toString().match(/SHUKCHIC MVP listening on (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});});
  const base='http://127.0.0.1:'+port;
  const req=(method,p,data,cookie='')=>fetch(base+p,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const post=(p,data,cookie='')=>req('POST',p,data,cookie),get=(p,cookie='')=>req('GET',p,null,cookie);
  const homepage=await (await get('/')).text();
  const partners=await (await get('/partners')).text();
  const merchant=await (await get('/merchant?start=1')).text();
  const worker=await get('/merchant-sw.js'),manifest=await get('/merchant/manifest.webmanifest');
  assert.match(homepage,/Get the Merchant App/);
  assert.match(partners,/Install Merchant App/);
  assert.doesNotMatch(partners,/id="partnerApplyForm"/);
  assert.match(merchant,/id="merchantRegisterForm"/);
  assert.match(merchant,/id="merchantPendingAgreementForm"/);
  assert.equal(worker.status,200);assert.match(await worker.text(),/do not cache authenticated/);
  assert.equal((await manifest.json()).start_url,'/merchant?start=1');
  assert.doesNotThrow(()=>new Function(read('public/assets/merchant-app.js')));
  const signup={business:'App Boutique',contact:'Boutique Owner',email:'appboutique@example.org',phone:'9540001111',
   street:'123 Boutique Ave',city:'Orlando',state:'FL',postalCode:'32801',description:'Designer vintage apparel',
   password:'a-test-app-password-12',confirmBusinessInventory:true};
  const registered=await post('/api/merchant/register',signup);
  assert.equal(registered.status,201,await registered.text().catch(()=>'')); 
  const pendingCookie=(registered.headers.get('set-cookie')||'').split(';')[0];
  assert.ok(pendingCookie.startsWith('shukchic_applicant='));
  const pending=(await (await get('/api/merchant/session',pendingCookie)).json()).onboarding;
  assert.equal(pending.status,'APPLIED');assert.equal(pending.agreementText,undefined);
  assert.equal((await get('/api/merchant/items',pendingCookie)).status,401);
  assert.equal((await post('/api/merchant/onboarding/activate',{signature:'Boutique Owner',accept:true,confirmBusinessInventory:true},pendingCookie)).status,403);
  assert.equal((await post('/api/merchant/register',signup)).status,409);
  const invalid=(await post('/api/merchant/login',{email:signup.email,password:'wrong-password'}));assert.equal(invalid.status,401);
  const pendingLogin=await post('/api/merchant/login',{email:signup.email,password:signup.password});
  assert.equal(pendingLogin.status,200);
  const renewedCookie=(pendingLogin.headers.get('set-cookie')||'').split(';')[0];
  assert.equal((await (await get('/api/merchant/session',renewedCookie)).json()).onboarding.status,'APPLIED');
  const admin=await post('/api/admin/login',{password:'merchant-test-admin-password'});
  const staffCookie=(admin.headers.get('set-cookie')||'').split(';')[0];assert.equal(admin.status,200);
  const applications=(await (await get('/api/admin/partners',staffCookie)).json()).applications;
  const application=applications.find(a=>a.email===signup.email);
  assert.equal(application.ship_street,'123 Boutique Ave');
  const terms='Merchant supplies verified authentic merchandise from the registered business location and maintains current stock. SHUKCHIC may list approved goods and communicate with buyers through its seller account. Merchant ships when instructed, complies with dispatch schedules, and resolves returns or disputes according to the agreed contract. The contract specifies the payment calculation and commission, the applicable return and dispute deductions, data privacy obligations, shipping label handling, cancellation, and settlement verification. SHUKCHIC commission is twenty-five percent. Both parties agree to independent review before eBay publication.';
  const approve=await post('/api/admin/partners/'+application.id+'/invite',{commissionPercent:25,agreementText:terms,reviewedTerms:true},staffCookie);
  assert.equal(approve.status,200);
  const approval=await approve.json();
  assert.equal(approval.inAppOnboarding,true);
  assert.equal(approval.inviteUrl,undefined,'App-first merchants should not be sent back through invitation links');
  const reviewed=(await (await get('/api/merchant/session',pendingCookie)).json()).onboarding;
  assert.equal(reviewed.status,'INVITED');assert.equal(reviewed.readyToSign,true);
  assert.equal(reviewed.commissionPercent,25);
  assert.match(reviewed.agreementText,/Merchant supplies verified/);
  assert.equal((await get('/api/merchant/items',pendingCookie)).status,401);
  const signed=await post('/api/merchant/onboarding/activate',{signature:'Boutique Owner',accept:true,confirmBusinessInventory:true},pendingCookie);
  assert.equal(signed.status,200);
  const liveCookie=(signed.headers.get('set-cookie')||'').split(';')[0];
  assert.ok(liveCookie.startsWith('shukchic_merchant='));
  const live=(await (await get('/api/merchant/session',liveCookie)).json());
  assert.equal(live.authenticated,true);assert.equal(live.merchant.business,'App Boutique');
  assert.equal(live.merchant.storeReady,true);
  assert.equal((await post('/api/merchant/onboarding/activate',{signature:'Again',accept:true,confirmBusinessInventory:true},pendingCookie)).status,403);
  const item={brand:'Vintage Designer',category:'Jewelry',condition:'Excellent',stockConfirmed:true,photos:[{data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO++p6cAAAAASUVORK5CYII='}]};
  const listing=await post('/api/merchant/items',item,liveCookie);assert.equal(listing.status,201);
  assert.equal((await get('/api/merchant/items',liveCookie)).status,200);
  assert.equal((await get('/api/admin/partners',liveCookie)).status,401);
  const relog=await post('/api/merchant/login',{email:signup.email,password:signup.password});assert.equal(relog.status,200);
  assert.ok((relog.headers.get('set-cookie')||'').startsWith('shukchic_merchant='));
 }finally{child.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
});

test('merchant public entry points and browser scripts parse',()=>{
 assert.match(read('public/index.html'),/href="\/merchant\?start=1"/);
 assert.match(read('public/partners.html'),/href="\/merchant\?start=1"/);
 assert.doesNotThrow(()=>new Function(read('public/assets/merchant-app.js')));
 assert.doesNotThrow(()=>new Function(read('public/merchant-sw.js')));
});
