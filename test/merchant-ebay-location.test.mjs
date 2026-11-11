import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createMerchantPortal} from '../merchant-portal.mjs';
function setup(){
 const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE submissions(id TEXT PRIMARY KEY, status TEXT,sku TEXT,received_verified INTEGER);");
 const portal=createMerchantPortal({db,sessionSecret:'s'.repeat(40),uploadDir:'/tmp',getEbayToken:async()=>'fake-seller-token',getEbayPublishingToken:async()=>'fake-publishing-token'});
 const appId=crypto.randomUUID(),merchantId=crypto.randomUUID();
 db.prepare("INSERT INTO merchant_applications(id,business,contact,email,city,state,postal_code,created_at) VALUES(?,?,?,?,?,?,?,?)").run(appId,'Test Boutique','Owner','owner@example.com','Winter Garden','FL','34787',new Date().toISOString());
 db.prepare("INSERT INTO merchant_accounts(id,application_id,business,email,contact,city,state,postal_code,password_hash,commission_percent,agreement_text,agreement_sha,signature,signed_at,active,ship_street,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)")
 .run(merchantId,appId,'Test Boutique','owner@example.com','Owner','Winter Garden','FL','34787','fakehash',25,'Merchant agreement terms','abc','Owner',new Date().toISOString(),'12 Test Street',new Date().toISOString());
 const results=[];
 const request=async()=>{
  let status=0,result='';
  const res={writeHead:(code)=>{status=code;},end:body=>{result=body||'';}};
  await portal.handle({method:'POST',headers:{}},res,new URL('https://shukchic.com/api/admin/partners/'+merchantId+'/location'),{admin:true,checkOrigin:()=>true,throttle:()=>true,readJson:async()=>({}),ipOf:()=>''});
  results.push({status,body:JSON.parse(result||'{}')});return results.at(-1);
 };
 return {db,portal,merchantId,request};
}
test('staff registers a merchant-specific eBay shipping location and verifies the actual address',async()=>{
 const x=setup(),prior=globalThis.fetch;let calls=[],created=false;
 try{
  globalThis.fetch=async(url,opts)=>{
   calls.push({url,method:opts?.method||'GET'});
   if(!created&&(!opts?.method||opts.method==='GET'))return {status:404,ok:false};
   if(opts?.method==='POST'){const b=JSON.parse(opts.body);assert.equal(b.location.address.postalCode,'34787');assert.equal(b.location.address.addressLine1,'12 Test Street');created=true;return {status:204,ok:true};}
   return {ok:true,json:async()=>({merchantLocationStatus:'ENABLED',location:{address:{addressLine1:'12 Test Street',city:'Winter Garden',stateOrProvince:'FL',postalCode:'34787',country:'US'}}})};
  };
  const r=await x.request();assert.equal(r.status,200,r.body.error);assert.match(r.body.locationKey,/^SCM_/);assert.equal(calls.length,3);
  assert.equal(x.db.prepare('SELECT ebay_location_key FROM merchant_accounts WHERE id=?').get(x.merchantId).ebay_location_key,r.body.locationKey);
 }finally{globalThis.fetch=prior;x.db.close();}
});
test('eBay location mismatch fails closed without binding merchant account',async()=>{
 const x=setup(),prior=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({merchantLocationStatus:'ENABLED',location:{address:{addressLine1:'DIFFERENT SHOP',city:'Miami',stateOrProvince:'FL',postalCode:'33101',country:'US'}}})});
  const r=await x.request();assert.equal(r.status,409);
  assert.equal(x.db.prepare('SELECT ebay_location_key FROM merchant_accounts WHERE id=?').get(x.merchantId).ebay_location_key,'');
 }finally{globalThis.fetch=prior;x.db.close();}
});
